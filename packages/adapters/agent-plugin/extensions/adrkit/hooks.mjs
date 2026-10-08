// @ts-check
/**
 * Advisory session hooks (ADR-0049), kept free of the Copilot SDK.
 *
 * Three hooks, and none of them can stop anything:
 *
 * - `onSessionStart` adds a one-paragraph summary of the decisions that govern
 *   the session's changed files: one `git diff` and one `adr check --json`, no
 *   model call. Measured on Copilot CLI 1.0.93 (headless SDK host): a plugin
 *   extension joins after `session.start`, and the hook fires with the first
 *   prompt (`source: "new"`, after `userPromptSubmitted`), not at load.
 * - `onPreToolUse` adds a note naming the accepted decision(s) that govern the
 *   file an edit targets, once per path per session, from one cached
 *   `adr check` per distinct path.
 * - `onPostToolUse` schedules the decision-review canvas's free `refresh` for
 *   any panel open in this process, debounced. It never starts `run_review`.
 *
 * ADR-0022's stance binds every output here: a marker or an advisory adds
 * context and never gains authority. So the only key any hook returns is
 * `additionalContext`. No `permissionDecision` — not even `"allow"`, which
 * would override a user's `ask` — no `modifiedArgs`, `modifiedResult`, or
 * `suppressOutput`. A failure is silent to the model; one fixed
 * `session.log` line per process tells the person.
 *
 * What reaches the model is built from four-digit record ids, a fixed status
 * vocabulary, counts, and labels this file writes. Never a title, a path, or
 * an error's text: those are repository content or exception detail, and a
 * hook's context is read by the model as instructions.
 */

import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { collectChangedFiles, resolveCli } from './review.mjs';

/**
 * The runtime's own edit category (Copilot CLI 1.0.93 bundle): `edit` and
 * `create` take `{ path }` (measured absolute in local session logs),
 * `str_replace_editor` takes `{ path, … }`, and `apply_patch` takes the raw
 * patch text (measured: a string, with paths relative or absolute).
 */
export const EDIT_TOOLS = new Set(['edit', 'create', 'str_replace_editor', 'apply_patch']);

/** Every key a hook here may return. Asserted by test. */
export const ADVISORY_OUTPUT_KEYS = new Set(['additionalContext']);

export const HOOK_TIMEOUT_MS = 5000;
export const REFRESH_DEBOUNCE_MS = 1500;
/** Distinct paths checked per process; past this, edits are not checked. */
export const MAX_CHECKED_PATHS = 500;
/** Paths read from one tool call. */
const MAX_PATHS_PER_CALL = 20;
/** Sessions remembered for once-per-path notes (subagents get their own). */
const MAX_SESSIONS = 64;
/** Record ids listed in one summary before "and N more". */
const MAX_IDS = 20;

const RECORD_ID = /^[0-9]{4}$/;
const STATUSES = new Set(['accepted', 'proposed', 'draft']);
const OFF = new Set(['0', 'false', 'off', 'no']);
const PATCH_PATH = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

/**
 * `ADRKIT_HOOKS=0` (or `false`, `off`, `no`) turns every hook off. Measured on
 * Copilot CLI 1.0.93: an `ADRKIT_*` variable reaches the extension process
 * without `requestedEnvironmentVariables`, so nothing needs to be requested.
 *
 * @param {Record<string, string | undefined>} env
 */
export function hooksDisabled(env) {
  const value = env['ADRKIT_HOOKS'];
  return typeof value === 'string' && OFF.has(value.trim().toLowerCase());
}

/**
 * The file paths an edit-category tool call targets, as the tool gave them.
 * Anything else, or a shape this does not recognize, yields nothing.
 *
 * @param {unknown} toolName
 * @param {unknown} toolArgs
 * @returns {string[]}
 */
export function editTargets(toolName, toolArgs) {
  if (typeof toolName !== 'string' || !EDIT_TOOLS.has(toolName)) return [];
  if (toolName === 'apply_patch') {
    const text =
      typeof toolArgs === 'string'
        ? toolArgs
        : toolArgs !== null && typeof toolArgs === 'object' && typeof (/** @type {any} */ (toolArgs).input) === 'string'
          ? /** @type {string} */ (/** @type {any} */ (toolArgs).input)
          : null;
    if (text === null) return [];
    return [...text.matchAll(PATCH_PATH)].map((match) => /** @type {string} */ (match[1]).trim()).filter((path) => path.length > 0);
  }
  const path = toolArgs !== null && typeof toolArgs === 'object' ? /** @type {any} */ (toolArgs).path : undefined;
  return typeof path === 'string' && path.length > 0 ? [path] : [];
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
 * The session-start context, or undefined when nothing governs or proposes
 * against the change. `source` is a label `collectChangedFiles` writes.
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
  if (proposals.length > 0) parts.push(`Open proposals that also bind them: ${listIds(proposals)}.`);
  parts.push('Before changing these files, read the decisions with `adr explain <path>` or the /adr-check command.');
  return parts.join(' ');
}

/** @param {string[]} ids */
export function editAdvisory(ids) {
  const sorted = [...new Set(ids)].filter((id) => RECORD_ID.test(id)).sort();
  return (
    `adrkit (advisory; it cannot block this edit): the file(s) this edit targets are governed by accepted decision(s) ${listIds(sorted)}. ` +
    'Keep the change consistent with them; `adr explain <path>` shows each one.'
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
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR') {
    return `adrkit: an advisory hook skipped a check because the adr CLI did not finish within its time limit. Hooks never block; set ADRKIT_HOOKS=0 to turn them off.`;
  }
  if (code === 'adr_exit') {
    return 'adrkit: an advisory hook skipped a check because `adr check` returned no usable report (run `adr lint`). Hooks never block; set ADRKIT_HOOKS=0 to turn them off.';
  }
  return 'adrkit: an advisory hook could not run the adr CLI (set ADRKIT_CLI, or install @adrkit/cli). Hooks never block; set ADRKIT_HOOKS=0 to turn them off.';
}

/**
 * @import { CommandResult } from './review.mjs'
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} SignalRunner
 */

/**
 * Build the hooks, or undefined when `ADRKIT_HOOKS` turns them off.
 * `extension.mjs` supplies the real dependencies; the tests supply fakes.
 *
 * @param {{
 *   run: SignalRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   getSession: () => any,
 *   refreshCanvas: () => Promise<unknown>,
 *   timeoutMs?: number,
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
  debounceMs = REFRESH_DEBOUNCE_MS,
  maxPaths = MAX_CHECKED_PATHS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  if (hooksDisabled(env)) return undefined;

  const dir = env['ADRKIT_DIR'];
  const dirArgs = dir ? ['--dir', dir] : [];
  const corpusDir = posix.normalize((dir ?? 'docs/adr').split(sep).join(posix.sep)).replace(/\/+$/, '');

  /** Governing ids by `cwd\0path`, as a promise so concurrent edits share one check. @type {Map<string, Promise<string[]>>} */
  const checks = new Map();
  /** Paths already noted, by session. @type {Map<string, Set<string>>} */
  const noted = new Map();
  let logged = false;
  /** @type {any} */
  let timer = null;

  /** @param {unknown} error */
  const fail = async (error) => {
    if (logged) return;
    logged = true;
    try {
      await getSession()?.log(failureMessage(error), { level: 'warning' });
    } catch {
      // Nothing else can reach the person: stdout is the RPC channel.
    }
  };

  /** @param {string} cwd */
  const runner = (cwd) => /** @param {string} command @param {string[]} args */ (command, args) =>
    run(command, args, { cwd, signal: AbortSignal.timeout(timeoutMs) });

  /**
   * `adr check --json` over `files`, parsed, or a thrown `adr_exit` error.
   * @param {string} cwd @param {string[]} files
   */
  const check = async (cwd, files) => {
    const cli = resolveCli({ env, cwd, exists });
    const result = await runner(cwd)(cli.command, [...cli.args, 'check', '--json', ...dirArgs, '--', ...files]);
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
    return { cwd: /** @type {string} */ (cwd), paths: [...new Set(/** @type {string[]} */ (paths))].slice(0, MAX_PATHS_PER_CALL) };
  };

  const scheduleRefresh = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      Promise.resolve()
        .then(() => refreshCanvas())
        .catch((error) => fail(error));
    }, debounceMs);
    // A pending refresh must never keep the process alive.
    timer?.unref?.();
  };

  return {
    /** @param {any} input @param {unknown} [_invocation] */
    onSessionStart: async (input, _invocation) => {
      try {
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
      } catch (error) {
        await fail(error);
        return undefined;
      }
    },

    /** @param {any} input @param {unknown} [_invocation] */
    onPreToolUse: async (input, _invocation) => {
      // Fires for every tool call, child sessions included; anything that is
      // not an edit returns before touching git or the CLI.
      if (!EDIT_TOOLS.has(input?.toolName)) return undefined;
      try {
        const { cwd, paths } = targetsOf(input);
        if (paths.length === 0) return undefined;
        const seen = notedFor(typeof input?.sessionId === 'string' ? input.sessionId : '');
        const fresh = paths.filter((path) => !seen.has(`${cwd}\0${path}`));
        if (fresh.length === 0) return undefined;
        const found = await Promise.all(fresh.map((path) => governingFor(cwd, path)));
        /** @type {string[]} */
        const ids = [];
        fresh.forEach((path, index) => {
          const governing = /** @type {string[]} */ (found[index]);
          if (governing.length === 0) return;
          seen.add(`${cwd}\0${path}`);
          ids.push(...governing);
        });
        return ids.length > 0 ? { additionalContext: editAdvisory(ids) } : undefined;
      } catch (error) {
        await fail(error);
        return undefined;
      }
    },

    /** @param {any} input @param {unknown} [_invocation] */
    onPostToolUse: async (input, _invocation) => {
      if (!EDIT_TOOLS.has(input?.toolName)) return undefined;
      try {
        const { paths } = targetsOf(input);
        // A record edited mid-session can change what governs anything, so
        // every cached answer and note is dropped.
        if (paths.some((path) => path === corpusDir || path.startsWith(`${corpusDir}/`))) {
          checks.clear();
          noted.clear();
        }
        scheduleRefresh();
      } catch (error) {
        await fail(error);
      }
      return undefined;
    },
  };
}
