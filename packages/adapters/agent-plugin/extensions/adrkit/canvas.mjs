// @ts-check
/**
 * The read-only `decision-review` canvas for the GitHub Copilot app, kept free
 * of the Copilot SDK.
 *
 * It shows which decisions govern the current change and, once a review has
 * run, the `adr-review` verdicts. It is a view plus explicit actions: it writes
 * no file, persists nothing, and has no exit-code authority. `refresh` runs the
 * workflow's Collect and Check (git and the `adr` CLI) and spends nothing;
 * only `run_review` starts the workflow, and with it model calls.
 *
 * Like `review.mjs`, every process, server, clock, and session is passed in, so
 * this runs under Bun's test runner as well as in the Node process the host
 * forks. Nothing here runs at import: the server starts inside `open()`,
 * because the app starts one extension process per restored session and a
 * headless `copilot workflow run` loads this module too.
 *
 * Security is load-bearing. The panel is a loopback HTTP page, and any local
 * process or page can reach a loopback port. Each open instance gets its own
 * server and a 32-byte token that every route checks in constant time; a
 * state-changing POST must also carry the token in a header (which a foreign
 * page cannot set without a CORS preflight this server never answers) and must
 * not come from a foreign `Origin`. Repository text never reaches a prompt.
 */

import { Buffer } from 'node:buffer';
import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as nodeCreateServer } from 'node:http';
import { isAbsolute } from 'node:path';
import { setTimeout as nodeSleep } from 'node:timers/promises';
import { PAGE_CSS, PAGE_JS, renderPage } from './canvas-page.mjs';
import {
  VERDICTS,
  activeProposalDecisions,
  assembleResult,
  collectChangedFiles,
  governingDecisions,
  historyDecisions,
  resolveCli,
  validateArgs,
} from './review.mjs';

export const CANVAS_ID = 'decision-review';
export const CANVAS_TITLE = 'Decision review';
export const REVIEW_WORKFLOW = 'adr-review';

/** `frame-ancestors *` because the host frames the page; no `X-Frame-Options`. */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *";

/** Request bodies are tiny (`{ recordId }`); anything past this is refused. */
export const BODY_LIMIT = 64 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

const RESULT_STATUSES = ['ok', 'findings', 'incomplete', 'usage-error'];
/** Severity order for combining a check status with a review status. */
const STATUS_RANK = { ok: 0, incomplete: 1, findings: 2, 'usage-error': 3 };
/** Settled run states. `paused` settles the attempt, so polling stops there too. */
const TERMINAL_RUN_STATES = new Set(['completed', 'error', 'halted', 'paused', 'cancelled']);
const RECORD_ID = /^[0-9]{4}$/;
/** Exactly the keys of an `adr-review` result payload. */
const RESULT_KEYS = Object.keys(assembleResult({}));

/**
 * @import { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http'
 * @import { CommandResult, ReviewArgs } from './review.mjs'
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string }) => Promise<CommandResult>} CwdRunner
 * @typedef {{ recordId: string, title: string, status?: string, bucket?: string, supersededBy?: string, firedMatchers?: unknown[] }} ShownDecision
 * @typedef {{
 *   workingDirectory: string, base: string | null, files: string[], filesSource: string | null,
 *   status: string, checkExitCode: number | null, lintExitCode: number | null,
 *   governing: ShownDecision[], history: ShownDecision[], activeProposals: ShownDecision[],
 *   findings: unknown[], notes: string[], review: null | { runId?: string, runStatus: string, result: any },
 *   updatedAt: string,
 * }} Snapshot
 * @typedef {{ runId: string | null, runStatus: string, result: any, watching: boolean, message?: string }} ReviewState
 * @typedef {{ args: unknown, check: Snapshot | null, review: ReviewState | null, seq: number }} Workspace
 * @typedef {{
 *   instanceId: string, cwd: string, token: string, origin: string, url: string,
 *   server: Server, clients: Set<ServerResponse>,
 * }} Instance
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string} text */
const clip = (text) => (text.length > 4000 ? `${text.slice(0, 4000)}…` : text);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Compare a presented token with the instance's in constant time. A length
 * mismatch still runs one comparison, so a wrong length is not measurably
 * quicker to reject than a wrong value.
 *
 * @param {string} expected
 * @param {unknown} given
 * @param {(a: Buffer, b: Buffer) => boolean} [compare]
 */
export function tokenMatches(expected, given, compare = timingSafeEqual) {
  const want = Buffer.from(expected, 'utf8');
  const got = typeof given === 'string' ? Buffer.from(given, 'utf8') : null;
  if (got === null || got.length !== want.length) {
    compare(want, want);
    return false;
  }
  return compare(want, got);
}

/**
 * The one prompt the panel can send. It names the record id and nothing else:
 * a title or any other repository text in a prompt would let a record's author
 * write instructions for the agent. Like the Judge prompt, it states the
 * boundary as an allowlist.
 *
 * @param {string} recordId
 */
export function buildExplainPrompt(recordId) {
  if (typeof recordId !== 'string' || !RECORD_ID.test(recordId)) {
    throw new Error('recordId must be a four-digit record id');
  }
  return (
    `Explain architecture decision ${recordId} and how it applies to the current change. ` +
    'Read-only: you may run `adr explain` and `adr check` and read files; ' +
    'do not create, edit, or ratify any record.'
  );
}

/**
 * Keep the fields the page renders. Applied to the CLI's own output as well as
 * to a result an agent hands over, so the page sees one shape.
 *
 * @param {Record<string, unknown>} entry
 * @returns {ShownDecision}
 */
function shownDecision(entry) {
  /** @type {ShownDecision} */
  const out = { recordId: String(entry['recordId']), title: typeof entry['title'] === 'string' ? entry['title'] : '' };
  for (const key of /** @type {const} */ (['status', 'bucket', 'supersededBy'])) {
    if (typeof entry[key] === 'string') out[key] = /** @type {string} */ (entry[key]);
  }
  if (Array.isArray(entry['firedMatchers'])) {
    out.firedMatchers = entry['firedMatchers'].filter(isRecord).map((matcher) => {
      /** @type {Record<string, string>} */
      const kept = {};
      for (const [key, value] of Object.entries(matcher)) if (typeof value === 'string') kept[key] = value;
      return kept;
    });
  }
  return out;
}

/** @param {unknown} finding */
function shownFinding(finding) {
  if (!isRecord(finding)) return { message: String(finding) };
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of ['rule', 'code', 'severity', 'message', 'path', 'id', 'field', 'pattern', 'sourcePath']) {
    if (typeof finding[key] === 'string') out[key] = /** @type {string} */ (finding[key]);
  }
  return out;
}

/**
 * Validate an `adr-review` result an agent hands to `show_review`, and keep
 * only the keys `assembleResult` produces. The agent may have read untrusted
 * repository content, so the shape is checked rather than trusted, and an
 * unknown key never reaches the page.
 *
 * @param {unknown} raw
 */
export function sanitizeReviewResult(raw) {
  if (!isRecord(raw)) throw new Error('result must be an adr-review result object');
  /** @param {string} message */
  const fail = (message) => {
    throw new Error(`result.${message}`);
  };
  if (!RESULT_STATUSES.includes(/** @type {string} */ (raw['status']))) {
    fail(`status must be one of ${RESULT_STATUSES.join(', ')}`);
  }
  /** @param {string} key */
  const exitCode = (key) => {
    const value = raw[key] ?? null;
    if (value !== null && !Number.isInteger(value)) fail(`${key} must be an integer or null`);
    return /** @type {number | null} */ (value);
  };
  /** @param {string} key @returns {unknown[]} */
  const array = (key) => {
    const value = raw[key] ?? [];
    if (!Array.isArray(value)) fail(`${key} must be an array`);
    return /** @type {unknown[]} */ (value);
  };
  /** @param {string} key */
  const strings = (key) =>
    array(key).map((value, index) => {
      if (typeof value !== 'string') fail(`${key}[${index}] must be a string`);
      return /** @type {string} */ (value);
    });
  /** @param {string} key */
  const decisions = (key) =>
    array(key).map((value, index) => {
      if (!isRecord(value) || typeof value['recordId'] !== 'string') fail(`${key}[${index}].recordId must be a string`);
      return shownDecision(/** @type {Record<string, unknown>} */ (value));
    });

  const filesSource = raw['filesSource'] ?? null;
  if (filesSource !== null && typeof filesSource !== 'string') fail('filesSource must be a string or null');

  const verdicts = array('verdicts').map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value['recordId'] !== 'string' ||
      !VERDICTS.includes(/** @type {any} */ (value['verdict'])) ||
      typeof value['evidence'] !== 'string'
    ) {
      fail(`verdicts[${index}] must have a recordId, a verdict of ${VERDICTS.join('/')}, and evidence`);
    }
    const entry = /** @type {Record<string, unknown>} */ (value);
    return {
      recordId: /** @type {string} */ (entry['recordId']),
      title: typeof entry['title'] === 'string' ? entry['title'] : '',
      verdict: /** @type {string} */ (entry['verdict']),
      evidence: /** @type {string} */ (entry['evidence']),
    };
  });

  /** @type {Record<string, unknown>} */
  const result = {
    status: raw['status'],
    checkExitCode: exitCode('checkExitCode'),
    lintExitCode: exitCode('lintExitCode'),
    files: strings('files'),
    filesSource,
    notes: strings('notes'),
    governing: decisions('governing'),
    history: decisions('history'),
    verdicts,
    unverified: strings('unverified'),
    findings: array('findings').map(shownFinding),
  };
  // Guard against `assembleResult` growing a key this projection does not know.
  return Object.fromEntries(RESULT_KEYS.map((key) => [key, result[key]]));
}

/**
 * Run the workflow's Collect and Check in `cwd` — no Judge, so no model spend —
 * and shape the outcome for the panel. Nothing here throws: invalid input, a
 * base that does not resolve, a CLI that cannot start, and an unreadable report
 * all become a `usage-error` snapshot with the message in `notes`, never `ok`.
 * The status comes from `assembleResult`, so the vocabulary is the workflow's.
 *
 * @param {{
 *   cwd: string, input: unknown, run: CwdRunner, env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean, now: () => string,
 * }} deps
 * @returns {Promise<Snapshot>}
 */
export async function computeSnapshot({ cwd, input, run, env, exists, now }) {
  /** @type {string[]} */
  const notes = [];
  /** @param {string} command @param {string[]} args */
  const runHere = (command, args) => run(command, args, { cwd });
  /** @type {string | null} */
  let base = null;
  /** @type {Record<string, unknown[]>} */
  let proposals = { activeProposals: [] };

  /** @param {Parameters<typeof assembleResult>[0]} fields @returns {Snapshot} */
  const shape = (fields) => {
    const result = assembleResult({ ...fields, notes });
    return {
      workingDirectory: cwd,
      base,
      files: result.files,
      filesSource: result.filesSource,
      status: result.status,
      checkExitCode: result.checkExitCode,
      lintExitCode: result.lintExitCode,
      governing: result.governing.map((entry) => shownDecision(/** @type {any} */ (entry))),
      history: result.history.map((entry) => shownDecision(/** @type {any} */ (entry))),
      activeProposals: /** @type {any[]} */ (proposals['activeProposals']).map(shownDecision),
      findings: result.findings.map(shownFinding),
      notes: result.notes,
      review: null,
      updatedAt: now(),
    };
  };
  /** @param {unknown} error */
  const usage = (error, fields = {}) => {
    notes.push(messageOf(error));
    return shape({ ...fields, usageError: true });
  };

  /** @type {ReviewArgs} */
  let args;
  try {
    args = validateArgs(input);
  } catch (error) {
    return usage(error);
  }
  base = args.base ?? null;

  /** @type {{ files: string[], source: string, notes: string[] }} */
  let collected;
  try {
    collected = await collectChangedFiles(args, runHere);
  } catch (error) {
    return usage(error);
  }
  notes.push(...collected.notes);
  const fileFields = { files: collected.files, filesSource: collected.source, partial: collected.source === 'git:HEAD' };
  if (collected.files.length === 0) {
    notes.push('No changed files; nothing was checked.');
    return shape(fileFields);
  }

  const dir = args.dir ?? env['ADRKIT_DIR'];
  const dirArgs = dir ? ['--dir', dir] : [];
  /** @type {{ check: CommandResult, lint: CommandResult }} */
  let checked;
  try {
    const cli = resolveCli({ env, cwd, exists });
    /** @param {string[]} cliArgs */
    const adr = (cliArgs) => runHere(cli.command, [...cli.args, ...cliArgs]);
    const check = await adr(['check', '--json', ...dirArgs, '--', ...collected.files]);
    const lint = await adr(['lint', ...dirArgs]);
    checked = { check, lint };
  } catch (error) {
    return usage(error, fileFields);
  }

  const { check, lint } = checked;
  const exits = { checkExitCode: check.exitCode, lintExitCode: lint.exitCode };
  if (lint.exitCode !== 0) {
    notes.push(`adr lint exited ${lint.exitCode}: ${clip((lint.stderr || lint.stdout).trim())}`);
  }
  /** @type {unknown} */
  let outcome = null;
  if (check.exitCode === 0 || check.exitCode === 1) {
    try {
      outcome = JSON.parse(check.stdout);
    } catch {
      outcome = null;
    }
  }
  if (outcome === null || typeof outcome !== 'object') {
    notes.push(
      `adr check exited ${check.exitCode} without a readable report: ${clip(check.stderr.trim() || check.stdout.trim())}`,
    );
    return shape({ ...fileFields, ...exits, usageError: true });
  }
  proposals = { activeProposals: activeProposalDecisions(outcome) };
  const rawFindings = /** @type {{ findings?: unknown }} */ (outcome).findings;
  return shape({
    ...fileFields,
    ...exits,
    governing: governingDecisions(outcome),
    history: historyDecisions(outcome),
    findings: Array.isArray(rawFindings) ? rawFindings : [],
  });
}

/** @param {string} a @param {string} b */
const worse = (a, b) =>
  (STATUS_RANK[/** @type {keyof typeof STATUS_RANK} */ (a)] ?? 3) >= (STATUS_RANK[/** @type {keyof typeof STATUS_RANK} */ (b)] ?? 3)
    ? a
    : b;

/**
 * The status the panel shows. `pending` while a run is in flight; otherwise the
 * worse of the check's status and the review's. A review that settled without
 * a usable result is `incomplete`, never `ok`.
 *
 * @param {string} checkStatus
 * @param {ReviewState | null} review
 */
function effectiveStatus(checkStatus, review) {
  if (!review) return checkStatus;
  if (review.watching) return 'pending';
  const reviewStatus = review.runStatus === 'completed' && review.result ? review.result.status : 'incomplete';
  return worse(checkStatus, reviewStatus);
}

/**
 * @param {Workspace} workspace
 * @returns {Snapshot}
 */
function snapshotOf(workspace) {
  const check = /** @type {Snapshot} */ (workspace.check);
  const { review } = workspace;
  return {
    ...check,
    status: effectiveStatus(check.status, review),
    notes: review?.message ? [...check.notes, review.message] : check.notes,
    review: review
      ? { ...(review.runId ? { runId: review.runId } : {}), runStatus: review.runStatus, result: review.result }
      : null,
  };
}

/** @param {Snapshot} snapshot */
const statusLine = (snapshot) => `${snapshot.governing.length} governing · ${snapshot.status}`;

/** Every record id the current snapshot names; explain accepts only these. @param {Snapshot} snapshot */
function knownRecordIds(snapshot) {
  const ids = new Set();
  for (const list of [snapshot.governing, snapshot.history, snapshot.activeProposals]) {
    for (const decision of list) ids.add(decision.recordId);
  }
  const result = snapshot.review?.result;
  if (result) {
    for (const list of [result.governing, result.history, result.verdicts]) {
      for (const entry of list ?? []) ids.add(entry.recordId);
    }
  }
  return ids;
}

const ARGS_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths; default: git diff <base>...HEAD.' },
    base: { type: 'string', description: 'Base ref; default origin/main.' },
    dir: { type: 'string', description: 'ADR corpus directory; default $ADRKIT_DIR or docs/adr.' },
  },
};

class BodyTooLarge extends Error {}

/**
 * Read a request body, refusing more than `limit` bytes without buffering it.
 *
 * @param {IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return reject(new BodyTooLarge());
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Every response goes through here, so the security headers are on all of
 * them: pages, assets, JSON, errors, and refusals.
 *
 * @param {ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {string} [type]
 * @param {Record<string, string>} [extra]
 */
function reply(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': String(Buffer.byteLength(body)),
    ...extra,
  });
  res.end(body);
}

/** @param {ServerResponse} res @param {number} status @param {unknown} data */
const replyJson = (res, status, data) => reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

/** @param {string | string[] | undefined} value */
const singleHeader = (value) => (Array.isArray(value) ? undefined : value);

/**
 * Build the canvas's options for the SDK's `createCanvas`. `extension.mjs`
 * supplies the real dependencies; the tests supply fakes.
 *
 * @param {{
 *   run: CwdRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   getSession: () => any,
 *   makeError?: (code: string, message: string) => Error,
 *   createServer?: (handler: RequestListener) => Server,
 *   randomBytes?: (size: number) => Buffer,
 *   now?: () => string,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   pollIntervalMs?: number,
 *   maxPolls?: number,
 * }} deps
 */
export function createDecisionReviewCanvas({
  run,
  env,
  exists,
  getSession,
  makeError = (code, message) => Object.assign(new Error(message), { code }),
  createServer = nodeCreateServer,
  randomBytes = nodeRandomBytes,
  now = () => new Date().toISOString(),
  sleep = (ms) => nodeSleep(ms),
  pollIntervalMs = 2000,
  maxPolls = 1800,
}) {
  /**
   * Panels by `instanceId`. A promise, so two concurrent opens of one panel
   * share one server. `instanceId` names the panel, not the data.
   * @type {Map<string, Promise<Instance>>}
   */
  const instances = new Map();
  /** Started panels, for broadcasting. @type {Set<Instance>} */
  const live = new Set();
  /**
   * Derived state by working directory, recomputed on open and refresh and
   * held in memory only. @type {Map<string, Workspace>}
   */
  const workspaces = new Map();

  /** @param {string} cwd */
  const workspaceFor = (cwd) => {
    let workspace = workspaces.get(cwd);
    if (!workspace) {
      workspace = { args: undefined, check: null, review: null, seq: 0 };
      workspaces.set(cwd, workspace);
    }
    return workspace;
  };

  /** @param {any} ctx */
  const workingDirectoryOf = (ctx) => {
    // The documented source. The extension process's own cwd is measured to
    // match in the app, but the app runtime's is `/`, so it is never used.
    const dir = ctx?.session?.workingDirectory;
    if (typeof dir !== 'string' || dir.length === 0 || !isAbsolute(dir)) {
      throw makeError('workspace_unavailable', 'The session has no working directory, so there is no change to review.');
    }
    return dir;
  };

  /** @param {any} ctx */
  const cwdFor = async (ctx) => {
    const pending = instances.get(ctx?.instanceId);
    if (pending) return (await pending).cwd;
    return workingDirectoryOf(ctx);
  };

  /** @param {string} cwd */
  const broadcast = (cwd) => {
    const workspace = workspaces.get(cwd);
    if (!workspace?.check) return;
    const message = `event: state\ndata: ${JSON.stringify(snapshotOf(workspace))}\n\n`;
    for (const instance of live) {
      if (instance.cwd !== cwd) continue;
      for (const client of instance.clients) client.write(message);
    }
  };

  /** @param {string} cwd */
  const panelOpenFor = (cwd) => [...live].some((instance) => instance.cwd === cwd);

  /**
   * Recompute the snapshot for `cwd`. `input` replaces the remembered args when
   * given; the page's Refresh reuses them. A review stays only while it still
   * describes the same file set: otherwise its verdicts would be shown against
   * files it never read.
   *
   * @param {string} cwd
   * @param {unknown} [input]
   */
  const refresh = async (cwd, input) => {
    const workspace = workspaceFor(cwd);
    if (input !== undefined) workspace.args = input;
    const seq = ++workspace.seq;
    const snapshot = await computeSnapshot({ cwd, input: workspace.args, run, env, exists, now });
    // A slower, older refresh must not overwrite a newer one.
    if (seq === workspace.seq) {
      workspace.check = snapshot;
      const review = workspace.review;
      if (review && !review.watching && review.result) {
        const reviewed = [...review.result.files].sort().join('\0');
        if (reviewed !== [...snapshot.files].sort().join('\0')) {
          workspace.review = null;
        }
      }
      broadcast(cwd);
    }
    return snapshotOf(workspace);
  };

  /** @param {string} cwd */
  const stateFor = async (cwd) => {
    const workspace = workspaceFor(cwd);
    if (!workspace.check) await refresh(cwd);
    return snapshotOf(workspace);
  };

  /**
   * Follow a run until it settles, then show its result. Bounded, and it stops
   * when no panel for this directory is open or another review replaced it.
   *
   * @param {string} cwd
   * @param {ReviewState} review
   * @param {any} session
   * @param {{ runId: string, status: string, result?: unknown, error?: string, reason?: string }} first
   */
  const watch = async (cwd, review, session, first) => {
    const workspace = workspaceFor(cwd);
    const runId = first.runId;
    let current = first;
    let polls = 0;
    let failures = 0;
    /** @param {string} message */
    const stop = (message) => {
      review.watching = false;
      review.message = message;
      broadcast(cwd);
    };
    while (!TERMINAL_RUN_STATES.has(current.status)) {
      if (workspace.review !== review) return;
      if (!panelOpenFor(cwd)) return stop(`Stopped following adr-review run ${runId}: no panel is open.`);
      if (polls >= maxPolls) return stop(`Stopped following adr-review run ${runId} after ${polls} checks; it is still ${current.status}.`);
      await sleep(pollIntervalMs);
      polls += 1;
      try {
        current = await session.rpc.workflow.getRun({ runId });
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= 3) return stop(`Could not read adr-review run ${runId}: ${messageOf(error)}`);
        continue;
      }
      if (review.runStatus !== current.status) {
        review.runStatus = current.status;
        broadcast(cwd);
      }
    }
    if (workspace.review !== review) return;
    review.runStatus = current.status;
    review.watching = false;
    if (current.status === 'completed') {
      try {
        review.result = sanitizeReviewResult(current.result);
      } catch (error) {
        review.message = `adr-review run ${runId} completed without a readable result: ${messageOf(error)}`;
      }
    } else {
      review.message = `adr-review run ${runId} ended ${current.status}: ${current.error ?? current.reason ?? 'no reason given'}`;
    }
    broadcast(cwd);
  };

  /**
   * Start `adr-review` for `cwd`. Only one run per directory is followed at a
   * time; asking again while one is in flight returns it rather than spending
   * twice. A run that cannot start becomes panel state, not a thrown error.
   *
   * @param {string} cwd
   * @param {unknown} [input]
   */
  const runReview = async (cwd, input) => {
    const workspace = workspaceFor(cwd);
    if (workspace.review?.watching) {
      return { runId: workspace.review.runId, status: workspace.review.runStatus };
    }
    let args;
    try {
      args = validateArgs(input === undefined ? workspace.args : input);
    } catch (error) {
      throw makeError('invalid_input', messageOf(error));
    }
    const session = getSession();
    if (!session?.rpc?.workflow) {
      throw makeError('session_unavailable', 'The Copilot session is not available yet; try again.');
    }
    if (input !== undefined) workspace.args = input;
    /** @type {ReviewState} */
    const review = { runId: null, runStatus: 'pending', result: null, watching: true };
    workspace.review = review;
    if (!workspace.check) await refresh(cwd);
    broadcast(cwd);

    let envelope;
    try {
      // `args` is required on the wire even when empty.
      envelope = await session.rpc.workflow.run({ name: REVIEW_WORKFLOW, args });
    } catch (error) {
      review.watching = false;
      review.runStatus = 'error';
      review.message = `adr-review did not start: ${messageOf(error)}`;
      broadcast(cwd);
      return { runId: null, status: 'error' };
    }
    review.runId = envelope.runId;
    review.runStatus = envelope.status;
    broadcast(cwd);
    watch(cwd, review, session, envelope).catch((error) => {
      if (workspace.review === review && review.watching) {
        review.watching = false;
        review.message = `Stopped following adr-review run ${envelope.runId}: ${messageOf(error)}`;
        broadcast(cwd);
      }
    });
    return { runId: envelope.runId, status: envelope.status };
  };

  /**
   * @param {Instance} instance
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  const handle = async (instance, req, res) => {
    const url = new URL(req.url ?? '/', instance.origin);
    if (!tokenMatches(instance.token, url.searchParams.get('token'))) return reply(res, 403, 'Forbidden');
    const { cwd } = instance;

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /':
        return reply(res, 200, renderPage(instance.token), 'text/html; charset=utf-8');
      case 'GET /app.js':
        return reply(res, 200, PAGE_JS, 'text/javascript; charset=utf-8');
      case 'GET /app.css':
        return reply(res, 200, PAGE_CSS, 'text/css; charset=utf-8');
      case 'GET /api/state':
        return replyJson(res, 200, await stateFor(cwd));
      case 'GET /events': {
        const snapshot = await stateFor(cwd);
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
        instance.clients.add(res);
        req.on('close', () => instance.clients.delete(res));
        return;
      }
      case 'POST /api/refresh':
      case 'POST /api/run-review':
      case 'POST /api/explain':
        break;
      default:
        return reply(res, 404, 'Not found');
    }

    // State-changing requests: the URL token alone is not enough, because a
    // URL can leak (history, a screenshot). The header cannot be set by another
    // origin without a preflight, and a present Origin must be this server's.
    if (!tokenMatches(instance.token, singleHeader(req.headers['x-adrkit-token']))) return reply(res, 403, 'Forbidden');
    const origin = req.headers['origin'];
    if (origin !== undefined && origin !== instance.origin) return reply(res, 403, 'Forbidden');

    /** @type {string} */
    let raw;
    try {
      raw = await readBody(req, BODY_LIMIT);
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        res.on('finish', () => req.destroy());
        return reply(res, 413, 'Payload too large', 'text/plain; charset=utf-8', { Connection: 'close' });
      }
      throw error;
    }
    /** @type {unknown} */
    let body = {};
    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return replyJson(res, 400, { error: 'The request body is not JSON.' });
      }
    }

    if (url.pathname === '/api/refresh') return replyJson(res, 200, await refresh(cwd));
    if (url.pathname === '/api/run-review') {
      try {
        await runReview(cwd);
      } catch (error) {
        return replyJson(res, 400, { error: messageOf(error) });
      }
      return replyJson(res, 200, await stateFor(cwd));
    }

    // POST /api/explain
    const recordId = isRecord(body) ? body['recordId'] : undefined;
    if (typeof recordId !== 'string' || !RECORD_ID.test(recordId)) {
      return replyJson(res, 400, { error: 'recordId must be a four-digit record id.' });
    }
    if (!knownRecordIds(await stateFor(cwd)).has(recordId)) {
      return replyJson(res, 404, { error: `Record ${recordId} is not in this view.` });
    }
    const session = getSession();
    if (!session) return replyJson(res, 503, { error: 'The Copilot session is not available yet.' });
    try {
      await session.send({ prompt: buildExplainPrompt(recordId) });
    } catch (error) {
      return replyJson(res, 502, { error: `Could not reach the agent: ${messageOf(error)}` });
    }
    return replyJson(res, 200, { ok: true });
  };

  /**
   * @param {string} instanceId
   * @param {string} cwd
   * @returns {Promise<Instance>}
   */
  const startInstance = async (instanceId, cwd) => {
    /** @type {Instance} */
    const instance = {
      instanceId,
      cwd,
      token: randomBytes(32).toString('hex'),
      origin: '',
      url: '',
      server: /** @type {any} */ (null),
      clients: new Set(),
    };
    const server = createServer((req, res) => {
      handle(instance, req, res).catch(() => {
        if (!res.headersSent) reply(res, 500, 'Internal error');
        else res.end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(undefined);
      });
    });
    const address = server.address();
    const port = address !== null && typeof address === 'object' ? address.port : 0;
    instance.server = server;
    instance.origin = `http://127.0.0.1:${port}`;
    instance.url = `${instance.origin}/?token=${instance.token}`;
    live.add(instance);
    return instance;
  };

  /** @param {any} ctx @param {(cwd: string, input: unknown) => Promise<unknown>} body */
  const withCwd = async (ctx, body) => body(await cwdFor(ctx), ctx?.input);

  return {
    id: CANVAS_ID,
    displayName: CANVAS_TITLE,
    description:
      'Read-only view of the architecture decisions that govern the current change, ' +
      'with adr-review verdicts once a review has run.',
    inputSchema: ARGS_SCHEMA,
    actions: [
      {
        name: 'get_state',
        description:
          'Return the panel snapshot: status, changed files, governing decisions, active proposals, ' +
          'history (listed, not judged), findings, notes, and the latest adr-review result if any. Read-only.',
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd) => stateFor(cwd)),
      },
      {
        name: 'refresh',
        description:
          'Re-run Collect and Check (git diff, adr check, adr lint) in the session working directory and ' +
          'update the panel. No model calls. Input replaces the remembered { base, files, dir }; omit it to reuse them.',
        inputSchema: ARGS_SCHEMA,
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd, input) => refresh(cwd, input)),
      },
      {
        name: 'show_review',
        description:
          'Display an adr-review result you already have: pass the run result object as { result }. ' +
          'Its shape is validated and unknown keys are dropped. Starts nothing.',
        inputSchema: { type: 'object', required: ['result'], properties: { result: { type: 'object' } } },
        handler: (/** @type {any} */ ctx) =>
          withCwd(ctx, async (cwd, input) => {
            let result;
            try {
              if (!isRecord(input)) throw new Error('input must be { result }');
              result = sanitizeReviewResult(input['result']);
            } catch (error) {
              throw makeError('invalid_input', messageOf(error));
            }
            const workspace = workspaceFor(cwd);
            if (!workspace.check) await refresh(cwd);
            workspace.review = { runId: null, runStatus: 'completed', result, watching: false };
            broadcast(cwd);
            return snapshotOf(workspace);
          }),
      },
      {
        name: 'run_review',
        description:
          'Start the adr-review dynamic workflow for { base, files, dir } (default: the panel\'s). ' +
          'This spends AI credits: the adrkit decision-checker judges each governing decision. ' +
          'Returns { runId, status } at once; the panel follows the run and shows its verdicts. Advisory only.',
        inputSchema: ARGS_SCHEMA,
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd, input) => runReview(cwd, input)),
      },
    ],

    /** @param {any} ctx */
    open: async (ctx) => {
      const cwd = workingDirectoryOf(ctx);
      let pending = instances.get(ctx.instanceId);
      if (!pending) {
        const starting = (async () => {
          await refresh(cwd, ctx.input);
          return startInstance(ctx.instanceId, cwd);
        })();
        pending = starting;
        instances.set(ctx.instanceId, starting);
        // A failed open must not pin the panel id to a dead promise.
        starting.catch(() => {
          if (instances.get(ctx.instanceId) === starting) instances.delete(ctx.instanceId);
        });
      }
      const instance = await pending;
      return { url: instance.url, title: CANVAS_TITLE, status: statusLine(snapshotOf(workspaceFor(instance.cwd))) };
    },

    /** @param {any} ctx */
    onClose: async (ctx) => {
      const pending = instances.get(ctx.instanceId);
      if (!pending) return;
      instances.delete(ctx.instanceId);
      /** @type {Instance} */
      let instance;
      try {
        instance = await pending;
      } catch {
        return;
      }
      live.delete(instance);
      // `close()` waits for open connections, and an event stream never ends
      // on its own, so end the streams first.
      for (const client of instance.clients) client.end();
      instance.clients.clear();
      await new Promise((resolve) => {
        instance.server.close(() => resolve(undefined));
        instance.server.closeAllConnections?.();
      });
    },
  };
}
