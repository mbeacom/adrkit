// @ts-check
/**
 * Advisory session hooks (ADR-0049), kept free of the Copilot SDK.
 *
 * Two hooks, and neither can stop anything:
 *
 * - `onSessionStart` adds a one-paragraph summary of the decisions that govern
 *   the session's changed files: one `git diff` and one `adr check --json`, no
 *   model call. Measured on Copilot CLI 1.0.93 (headless SDK host): a plugin
 *   extension joins after `session.start`, and the hook fires with the first
 *   prompt (`source: "new"`, after `userPromptSubmitted`), not at load.
 * - `onPostToolUse`, after an edit tool, adds a note naming the accepted
 *   decision(s) that govern the file just edited (once per path per session,
 *   from one cached `adr check` per distinct path), and schedules the
 *   decision-review canvas's free `refresh` for any panel open in this
 *   process: debounced and single-flight. It never starts `run_review`.
 *
 * There is deliberately no `onPreToolUse`. Measured on 1.0.93: a pre-tool hook
 * that hangs holds the tool call unexecuted (still pending after 90 s), so the
 * extension's liveness would become a gate on every tool call. A post-tool
 * hook runs after the edit has landed; it can delay the result but not stop
 * the edit, and this one bounds its own wait.
 *
 * ADR-0022's stance binds every output here: a marker or an advisory adds
 * context and never gains authority. So the only key any hook returns is
 * `additionalContext`. No `permissionDecision`, no `modifiedArgs`,
 * `modifiedResult`, or `suppressOutput`. A failure is silent to the model; one
 * fixed `session.log` line per process tells the person.
 *
 * What reaches the model is built from record ids in the schema's own id
 * grammar, a fixed status vocabulary, counts, and labels this file writes.
 * Never a title, a path, or an error's text: those are repository content or
 * exception detail, and a hook's context is read by the model as instructions.
 */

import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { collectChangedFiles, resolveCli } from './review.mjs';

/**
 * The tools the runtime treats as edits (Copilot CLI 1.0.93 bundle): `edit`
 * and `create` take `{ path }` (measured absolute in local session logs),
 * `str_replace` takes `edit`'s shape, `str_replace_editor` takes
 * `{ command, path }` and edits only for `create`, `str_replace`, and
 * `insert` (its `view` reads), and `apply_patch` takes the raw patch text
 * (measured: a string, with paths relative or absolute).
 */
export const EDIT_TOOLS = new Set(['edit', 'create', 'str_replace', 'str_replace_editor', 'apply_patch']);
const EDITOR_WRITES = new Set(['create', 'str_replace', 'insert']);

/** Every key a hook here may return. Asserted by test. */
export const ADVISORY_OUTPUT_KEYS = new Set(['additionalContext']);

/** Per `git` or `adr` call the hooks make themselves. */
export const HOOK_TIMEOUT_MS = 5000;
/** The most `onSessionStart` adds to the first prompt; work past it continues in the background, each call still bounded. */
export const SESSION_START_DEADLINE_MS = 5000;
/** The most the post-edit note holds a tool result; its check keeps filling the cache. */
export const NOTE_DEADLINE_MS = 2000;
/** One hook-triggered canvas refresh (git diff, adr check, adr lint) under one signal. */
export const REFRESH_TIMEOUT_MS = 15000;
export const REFRESH_DEBOUNCE_MS = 1500;
/** Hook-spawned `git`/`adr` processes running at once. */
export const MAX_CONCURRENT = 2;
/** Distinct paths checked per process; past this, edits are not checked. */
export const MAX_CHECKED_PATHS = 500;
/** Paths read from one tool call. */
const MAX_PATHS_PER_CALL = 20;
/** Sessions remembered for once-per-path notes. */
const MAX_SESSIONS = 64;
/** Record ids listed in one summary before "and N more". */
const MAX_IDS = 20;

/** `schema/adr.schema.json`'s id grammar: an optional namespace, then 4+ digits or a ULID. A closed character class, so safe to echo. */
const RECORD_ID = /^(?:[a-z0-9][a-z0-9-]*:)?(?:[0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/;
const STATUSES = new Set(['accepted', 'proposed', 'draft']);
const OFF = new Set(['0', 'false', 'off', 'no']);
const PATCH_PATH = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
const GAVE_UP = Symbol('gave-up');

/**
 * `ADRKIT_HOOKS=0` (or `false`, `off`, `no`) turns every hook off. Measured on
 * Copilot CLI 1.0.93 through the SDK host: an `ADRKIT_*` variable reaches the
 * extension process without `requestedEnvironmentVariables`.
 *
 * @param {Record<string, string | undefined>} env
 */
export function hooksDisabled(env) {
  const value = env['ADRKIT_HOOKS'];
  return typeof value === 'string' && OFF.has(value.trim().toLowerCase());
}

/**
 * The file paths an edit tool call targets, as the tool gave them, at most
 * `limit` of them; a patch stops being read once the limit is reached.
 * Anything else, or a shape this does not recognize, yields nothing.
 *
 * @param {unknown} toolName
 * @param {unknown} toolArgs
 * @param {number} [limit]
 * @returns {string[]}
 */
export function editTargets(toolName, toolArgs, limit = MAX_PATHS_PER_CALL) {
  if (typeof toolName !== 'string' || !EDIT_TOOLS.has(toolName)) return [];
  if (toolName === 'apply_patch') {
    const text =
      typeof toolArgs === 'string'
        ? toolArgs
        : toolArgs !== null && typeof toolArgs === 'object' && typeof (/** @type {any} */ (toolArgs).input) === 'string'
          ? /** @type {string} */ (/** @type {any} */ (toolArgs).input)
          : null;
    if (text === null) return [];
    /** @type {string[]} */
    const paths = [];
    for (const match of text.matchAll(PATCH_PATH)) {
      const path = /** @type {string} */ (match[1]).trim();
      if (path.length > 0) paths.push(path);
      if (paths.length >= limit) break;
    }
    return paths;
  }
  if (toolArgs === null || typeof toolArgs !== 'object') return [];
  const args = /** @type {any} */ (toolArgs);
  if (toolName === 'str_replace_editor' && !EDITOR_WRITES.has(args.command)) return [];
  return typeof args.path === 'string' && args.path.length > 0 ? [args.path] : [];
}

/**
 * `path` relative to the worktree, with `/` separators, or null when it is
 * outside it (or is the worktree itself). The working directory comes from the
 * hook input, never `process.cwd()`: the app's runtime runs from `/`.
 *
 * @param {string} path
 * @param {unknown} workingDirectory
 */
export function repoRelative(path, workingDirectory) {
  if (typeof workingDirectory !== 'string' || !isAbsolute(workingDirectory)) return null;
  const rel = relative(workingDirectory, resolve(workingDirectory, path));
  if (rel.length === 0 || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join(posix.sep);
}

/** @param {string[]} ids */
const listIds = (ids) => (ids.length > MAX_IDS ? `${ids.slice(0, MAX_IDS).join(', ')}, and ${ids.length - MAX_IDS} more` : ids.join(', '));

/**
 * Record ids in `bucket`, validated and sorted, with their statuses when the
 * status is one this file knows. Titles are read by nobody.
 *
 * @param {unknown} outcome
 * @param {string} bucket
 * @returns {Array<{ id: string, status: string | null }>}
 */
function recordsIn(outcome, bucket) {
  const governedBy = outcome !== null && typeof outcome === 'object' ? /** @type {any} */ (outcome).governedBy : undefined;
  if (!Array.isArray(governedBy)) return [];
  /** @type {Map<string, string | null>} */
  const byId = new Map();
  for (const entry of governedBy) {
    if (entry === null || typeof entry !== 'object' || entry.bucket !== bucket) continue;
    if (typeof entry.recordId !== 'string' || !RECORD_ID.test(entry.recordId) || byId.has(entry.recordId)) continue;
    byId.set(entry.recordId, typeof entry.status === 'string' && STATUSES.has(entry.status) ? entry.status : null);
  }
  return [...byId].sort(([a], [b]) => a.localeCompare(b)).map(([id, status]) => ({ id, status }));
}

/**
 * The session-start context, or undefined when nothing governs or is proposed
 * for the change. `source` is a label `collectChangedFiles` writes.
 *
 * @param {unknown} outcome `adr check --json` output
 * @param {{ fileCount: number, source: string }} where
 */
export function sessionSummary(outcome, { fileCount, source }) {
  const governing = recordsIn(outcome, 'governing').map((record) => record.id);
  const proposals = recordsIn(outcome, 'activeProposals').map((record) => (record.status ? `${record.id} (${record.status})` : record.id));
  if (governing.length === 0 && proposals.length === 0) return undefined;
  const label = source === 'git:HEAD' ? 'uncommitted changes against HEAD' : source.replace(/^git:/, 'git diff ');
  const parts = [
    `adrkit decision memory (advisory; record ids only, no authority to block): ${fileCount} changed file(s) in this session (${label}).`,
  ];
  if (governing.length > 0) parts.push(`Governed by accepted decision(s): ${listIds(governing)}.`);
  if (proposals.length > 0) parts.push(`Open proposals that would also govern them: ${listIds(proposals)}.`);
  parts.push('Before changing these files, read the decisions with `adr explain <path>` or the /adr-check command.');
  return parts.join(' ');
}

/** @param {string[]} ids */
export function editAdvisory(ids) {
  const sorted = [...new Set(ids)].filter((id) => RECORD_ID.test(id)).sort();
  return (
    `adrkit (advisory; it blocked nothing): the file(s) you just edited are governed by accepted decision(s) ${listIds(sorted)}. ` +
    'Check that the change is consistent with them; `adr explain <path>` shows each one.'
  );
}

/**
 * A fixed message per failure kind. Selected by explicit comparisons, never
 * by echoing the error: its text can carry paths or stack detail.
 *
 * @param {unknown} error
 */
function failureMessage(error) {
  const name = error !== null && typeof error === 'object' ? /** @type {any} */ (error).name : undefined;
  const code = error !== null && typeof error === 'object' ? /** @type {any} */ (error).code : undefined;
  const tail = ' Hooks never block; set ADRKIT_HOOKS=0 to turn them off.';
  if (error === GAVE_UP || name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR') {
    return `adrkit: an advisory hook skipped a check because git or the adr CLI did not finish within its time limit.${tail}`;
  }
  if (code === 'E2BIG') {
    return `adrkit: an advisory hook skipped a check because there were too many changed files to pass to the adr CLI in one call.${tail}`;
  }
  if (code === 'adr_exit') {
    return `adrkit: an advisory hook skipped a check because \`adr check\` returned no usable report (run \`adr lint\`).${tail}`;
  }
  if (code === 'refresh') {
    return `adrkit: an advisory hook could not refresh the decision-review panel; use its Refresh button.${tail}`;
  }
  return `adrkit: an advisory hook could not run the adr CLI (set ADRKIT_CLI, or install @adrkit/cli).${tail}`;
}

/**
 * @import { CommandResult } from './review.mjs'
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} SignalRunner
 */

/**
 * Settle with `promise`, or with GAVE_UP after `ms`. The timer is unref'd, so
 * it never keeps the process alive, and cleared once the race settles.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | typeof GAVE_UP>}
 */
function withDeadline(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(GAVE_UP), ms);
    timer.unref?.();
  });
  return /** @type {Promise<T | typeof GAVE_UP>} */ (Promise.race([promise, deadline])).finally(() => clearTimeout(timer));
}

/**
 * Build the hooks, or undefined when `ADRKIT_HOOKS` turns them off.
 * `extension.mjs` supplies the real dependencies; the tests supply fakes.
 *
 * @param {{
 *   run: SignalRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   getSession: () => any,
 *   refreshCanvas: (options: { signal: AbortSignal }) => Promise<unknown>,
 *   timeoutMs?: number,
 *   sessionStartDeadlineMs?: number,
 *   noteDeadlineMs?: number,
 *   refreshTimeoutMs?: number,
 *   debounceMs?: number,
 *   maxPaths?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} deps
 */
export function createAdvisoryHooks({
  run,
  env,
  exists,
  getSession,
  refreshCanvas,
  timeoutMs = HOOK_TIMEOUT_MS,
  sessionStartDeadlineMs = SESSION_START_DEADLINE_MS,
  noteDeadlineMs = NOTE_DEADLINE_MS,
  refreshTimeoutMs = REFRESH_TIMEOUT_MS,
  debounceMs = REFRESH_DEBOUNCE_MS,
  maxPaths = MAX_CHECKED_PATHS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  if (hooksDisabled(env)) return undefined;

  const dir = env['ADRKIT_DIR'];
  const dirArgs = dir ? ['--dir', dir] : [];

  /** Governing ids by `cwd\0path`, as a promise so concurrent edits share one check. @type {Map<string, Promise<string[]>>} */
  const checks = new Map();
  /** Paths already noted (or being noted), by session. @type {Map<string, Set<string>>} */
  const noted = new Map();
  let logged = false;
  /** @type {any} */
  let timer = null;
  let refreshing = false;
  let refreshQueued = false;
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];

  /** @param {unknown} error */
  const fail = async (error) => {
    if (logged) return;
    logged = true;
    try {
      await getSession()?.log(failureMessage(error), { level: 'warning' });
    } catch {
      // Nothing else can reach the person: stdout is the RPC channel. This
      // guard is what keeps the debounce path from an unhandled rejection.
    }
  };

  /**
   * At most MAX_CONCURRENT hook-spawned processes at once. The timeout starts
   * when the process does, not while it waits for a slot.
   *
   * @param {string} cwd @param {string} command @param {string[]} args
   */
  const spawn = async (cwd, command, args) => {
    if (active >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(() => resolve(undefined)));
    active += 1;
    try {
      return await run(command, args, { cwd, signal: AbortSignal.timeout(timeoutMs) });
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  /** @param {string} cwd */
  const runner = (cwd) => /** @param {string} command @param {string[]} args */ (command, args) => spawn(cwd, command, args);

  /**
   * `adr check --json` over `files`, parsed, or a thrown `adr_exit` error.
   * @param {string} cwd @param {string[]} files
   */
  const check = async (cwd, files) => {
    const cli = resolveCli({ env, cwd, exists });
    const result = await spawn(cwd, cli.command, [...cli.args, 'check', '--json', ...dirArgs, '--', ...files]);
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        return /** @type {unknown} */ (JSON.parse(result.stdout));
      } catch {
        // Falls through to the same failure as an unexpected exit.
      }
    }
    throw Object.assign(new Error('adr check returned no usable report'), { code: 'adr_exit' });
  };

  /** @param {string} cwd @param {string} path @returns {Promise<string[]>} */
  const governingFor = (cwd, path) => {
    const key = `${cwd}\0${path}`;
    let pending = checks.get(key);
    if (!pending) {
      if (checks.size >= maxPaths) return Promise.resolve([]);
      // A failure is cached as "nothing" too: retrying a missing CLI on every
      // edit would multiply the cost of the failure the cap exists to bound.
      pending = check(cwd, [path]).then(
        (outcome) => recordsIn(outcome, 'governing').map((record) => record.id),
        async (error) => {
          await fail(error);
          return [];
        },
      );
      checks.set(key, pending);
    }
    return pending;
  };

  /** @param {string} sessionId */
  const notedFor = (sessionId) => {
    let set = noted.get(sessionId);
    if (!set) {
      if (noted.size >= MAX_SESSIONS) noted.delete(/** @type {string} */ (noted.keys().next().value));
      set = new Set();
      noted.set(sessionId, set);
    }
    return set;
  };

  /** @param {any} input */
  const targetsOf = (input) => {
    const cwd = input?.workingDirectory;
    const paths = editTargets(input?.toolName, input?.toolArgs)
      .map((path) => repoRelative(path, cwd))
      .filter((path) => path !== null);
    return { cwd: /** @type {string} */ (cwd), paths: [...new Set(/** @type {string[]} */ (paths))] };
  };

  /**
   * One refresh at a time: a request while one is in flight is queued once,
   * and later requests fold into that one. Each refresh runs under one abort
   * signal, so its git and adr calls are bounded too.
   */
  const startRefresh = () => {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    Promise.resolve()
      .then(() => refreshCanvas({ signal: AbortSignal.timeout(refreshTimeoutMs) }))
      .catch(() => fail(Object.assign(new Error('refresh failed'), { code: 'refresh' })))
      .finally(() => {
        refreshing = false;
        if (refreshQueued) {
          refreshQueued = false;
          startRefresh();
        }
      });
  };

  const scheduleRefresh = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      startRefresh();
    }, debounceMs);
    // A pending refresh must never keep the process alive.
    timer?.unref?.();
  };

  /** @param {any} input */
  const sessionStart = async (input) => {
    const cwd = input?.workingDirectory;
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined;
    /** @type {{ files: string[], source: string }} */
    let collected;
    try {
      collected = await collectChangedFiles({}, runner(cwd));
    } catch (error) {
      // No history and no edits, or not a repository: nothing to say, and
      // not a failure worth a log line. A timeout still is.
      const name = error !== null && typeof error === 'object' ? /** @type {any} */ (error).name : undefined;
      if (name === 'AbortError' || name === 'TimeoutError') await fail(error);
      return undefined;
    }
    if (collected.files.length === 0) return undefined;
    const outcome = await check(cwd, collected.files);
    const additionalContext = sessionSummary(outcome, { fileCount: collected.files.length, source: collected.source });
    return additionalContext ? { additionalContext } : undefined;
  };

  /**
   * The note for an edit that already landed, or undefined. Paths are
   * reserved before the check, so concurrent edits of one file note it once;
   * a reservation that yields no note is released.
   *
   * @param {any} input @param {string} cwd @param {string[]} paths
   */
  const noteFor = async (input, cwd, paths) => {
    const seen = notedFor(typeof input?.sessionId === 'string' ? input.sessionId : '');
    const fresh = paths.filter((path) => !seen.has(`${cwd}\0${path}`));
    if (fresh.length === 0) return undefined;
    for (const path of fresh) seen.add(`${cwd}\0${path}`);
    const found = await withDeadline(Promise.all(fresh.map((path) => governingFor(cwd, path))), noteDeadlineMs);
    if (found === GAVE_UP) {
      // The checks keep running and fill the cache; the next edit is told.
      for (const path of fresh) seen.delete(`${cwd}\0${path}`);
      return undefined;
    }
    /** @type {string[]} */
    const ids = [];
    fresh.forEach((path, index) => {
      const governing = /** @type {string[]} */ (found[index]);
      if (governing.length === 0) seen.delete(`${cwd}\0${path}`);
      else ids.push(...governing);
    });
    return ids.length > 0 ? { additionalContext: editAdvisory(ids) } : undefined;
  };

  return {
    /** @param {any} input @param {unknown} [_invocation] */
    onSessionStart: async (input, _invocation) => {
      try {
        const out = await withDeadline(sessionStart(input), sessionStartDeadlineMs);
        if (out === GAVE_UP) {
          await fail(GAVE_UP);
          return undefined;
        }
        return out;
      } catch (error) {
        await fail(error);
        return undefined;
      }
    },

    /** @param {any} input @param {unknown} [_invocation] */
    onPostToolUse: async (input, _invocation) => {
      // Fires for every successful tool call; anything that is not an edit
      // returns before touching git, the CLI, or a timer.
      if (!EDIT_TOOLS.has(input?.toolName)) return undefined;
      try {
        const { cwd, paths } = targetsOf(input);
        // A record edited mid-session can change what governs anything, so
        // every cached answer and note is dropped. The corpus is resolved
        // against this input's directory, so an absolute ADRKIT_DIR works.
        const corpusDir = repoRelative(dir ?? 'docs/adr', cwd);
        if (corpusDir !== null && paths.some((path) => path === corpusDir || path.startsWith(`${corpusDir}/`))) {
          checks.clear();
          noted.clear();
        }
        scheduleRefresh();
        if (paths.length === 0) return undefined;
        return await noteFor(input, cwd, paths);
      } catch (error) {
        await fail(error);
        return undefined;
      }
    },
  };
}
