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
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { stat as nodeStat } from 'node:fs/promises';
import { createServer as nodeCreateServer } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { setTimeout as nodeSleep } from 'node:timers/promises';
import { PAGE_CSS, PAGE_JS, renderPage } from './canvas-page.mjs';
import {
  BodyTooLarge,
  BODY_LIMIT,
  CSP,
  SECURITY_HEADERS,
  readBody,
  reply,
  replyJson,
  singleHeader,
  tokenMatches,
} from './panel-http.mjs';
import {
  VERDICTS,
  activeProposalDecisions,
  FILES_ECHO_LIMIT,
  assembleResult,
  capFiles,
  checkInBatches,
  checkNote,
  cliOverhead,
  collectChangedFiles,
  governingDecisions,
  historyDecisions,
  lintNote,
  publicMessage,
  resolveCli,
  sameFileSet,
  validateArgs,
} from './review.mjs';

export const CANVAS_ID = 'decision-review';
export const CANVAS_TITLE = 'Decision review';
export const REVIEW_WORKFLOW = 'adr-review';

// The shared hardening lives in panel-http.mjs (ADR-0050); re-exported so
// existing importers keep one name for it.
export { BODY_LIMIT, CSP, tokenMatches };

const RESULT_STATUSES = ['ok', 'findings', 'incomplete', 'usage-error'];
/** Severity order for combining a check status with a review status. */
const STATUS_RANK = { ok: 0, incomplete: 1, findings: 2, 'usage-error': 3 };
/** Severity of a status; an unknown one counts as the worst. @param {string} status */
const rank = (status) => STATUS_RANK[/** @type {keyof typeof STATUS_RANK} */ (status)] ?? 3;
/** Settled run states. `paused` settles the attempt, so polling stops there too. */
const TERMINAL_RUN_STATES = new Set(['completed', 'error', 'halted', 'paused', 'cancelled']);
const RECORD_ID = /^[0-9]{4}$/;
const SESSION_UNAVAILABLE = 'The Copilot session is not available yet; try again.';
const INVALID_REVIEW_ARGS = "The panel's review arguments are not valid; see its notes, then refresh with corrected ones.";
/** Exactly the keys of an `adr-review` result payload. */
const RESULT_KEYS = Object.keys(assembleResult({}));

/**
 * @import { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http'
 * @import { CommandResult, ReviewArgs } from './review.mjs'
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} CwdRunner
 * @typedef {{ path: string, line: number, ref: string }} Declaration
 * @typedef {{
 *   recordId: string, title: string, status?: string, bucket?: string, supersededBy?: string,
 *   firedMatchers?: unknown[], declaredBy?: Declaration[],
 * }} ShownDecision
 * @typedef {{
 *   id: string, title: string, sourcePath: string, slaState: string, deadlineDate: string | null,
 *   approvalCount: number, quorum: number | null, unresolvedObjectionCount: number, routingTargets: string[],
 * }} QueueItem
 * @typedef {{
 *   available: boolean, asOf: string | null, exitCode: number | null, totalItems: number,
 *   corpusFindings: number, items: QueueItem[], note: string | null,
 * }} QueueView
 * @typedef {{
 *   workingDirectory: string, base: string | null, files: string[], filesOmitted?: number, filesSource: string | null,
 *   status: string, checkExitCode: number | null, lintExitCode: number | null,
 *   governing: ShownDecision[], history: ShownDecision[], activeProposals: ShownDecision[],
 *   findings: unknown[], notes: string[], review: null | { runId?: string, runStatus: string, result: any },
 *   updatedAt: string, judgeCalls?: number, queue?: QueueView | null,
 * }} Snapshot
 * @typedef {{ runId: string | null, runStatus: string, result: any, watching: boolean, message?: string, governingKey?: string, fingerprint?: string }} ReviewState
 * @typedef {{ args: unknown, check: Snapshot | null, queue: QueueView | null, queuePending: Promise<void> | null, review: ReviewState | null, seq: number }} Workspace
 * @typedef {{
 *   instanceId: string, cwd: string, token: string, origin: string, url: string,
 *   server: Server, clients: Set<ServerResponse>,
 * }} Instance
 */

/**
 * Fixed notes for a review the panel follows. A run's own `error` or `reason`
 * and any exception's text are never shown: they reach the page and the agent.
 */
export const REVIEW_NOTES = {
  /** @param {string} runId */
  unreadable: (runId) => `Could not read adr-review run ${runId}; it may still be running. Refresh to try again.`,
  /** @param {string} runId */
  noResult: (runId) => `adr-review run ${runId} completed without a readable result.`,
  /** @param {string} runId @param {string} status */
  ended: (runId, status) => `adr-review run ${runId} ended ${status}; see the run's own log for why.`,
  /** @param {string} runId */
  stopped: (runId) => `Stopped following adr-review run ${runId} after an unexpected error.`,
  notStarted: 'adr-review did not start; check that the plugin is loaded in this session, then try again.',
  invalidResult: 'The result is not a valid adr-review result.',
};

/** A `sanitizeReviewResult` refusal: its message is built from this file's own text only. */
class InvalidResult extends Error {}

/** @param {string} text */
const clip = (text) => (text.length > 4000 ? `${text.slice(0, 4000)}…` : text);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
  // Provenance for an inbound marker: the changed file and line that named the
  // record. `adr check --json` reports it per file; an `affects` match carries
  // only the pattern, so there is no file to keep for one (ADR-0047).
  if (Array.isArray(entry['declaredBy'])) {
    out.declaredBy = entry['declaredBy']
      .filter(isRecord)
      .filter((d) => typeof d['path'] === 'string' && Number.isInteger(d['line']) && typeof d['ref'] === 'string')
      .map((d) => ({ path: clip(String(d['path'])), line: Number(d['line']), ref: clip(String(d['ref'])) }));
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
  if (!isRecord(raw)) throw new InvalidResult('result must be an adr-review result object');
  /** @param {string} message */
  const fail = (message) => {
    throw new InvalidResult(`result.${message}`);
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

  const filesOmitted = raw['filesOmitted'] ?? 0;
  if (!Number.isInteger(filesOmitted) || /** @type {number} */ (filesOmitted) < 0) fail('filesOmitted must be a non-negative integer');
  const filesDigest = raw['filesDigest'] ?? null;
  if (filesDigest !== null && (typeof filesDigest !== 'string' || !/^[0-9a-f]{64}$/.test(filesDigest))) {
    fail('filesDigest must be null or a SHA-256 hex digest');
  }
  // A capped list is compared by its digest; without one, a result from
  // another change that shares the first 200 paths and the total would pass.
  if (/** @type {number} */ (filesOmitted) > 0 && filesDigest === null) fail('filesDigest is required when filesOmitted is above 0');
  const fileCount = Array.isArray(raw['files']) ? raw['files'].length : 0;
  if (fileCount > FILES_ECHO_LIMIT) fail(`files must list at most ${FILES_ECHO_LIMIT} paths`);
  if (/** @type {number} */ (filesOmitted) > 0 && fileCount !== FILES_ECHO_LIMIT) {
    fail(`files must list exactly ${FILES_ECHO_LIMIT} paths when filesOmitted is above 0`);
  }
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
    filesOmitted,
    filesDigest,
    filesSource,
    notes: strings('notes'),
    governing: decisions('governing'),
    history: decisions('history'),
    verdicts,
    unverified: strings('unverified'),
    findings: array('findings').map(shownFinding),
  };
  // The status must not be cleaner than the payload under it: a result saying
  // `ok` over a conflict, an exit 1, or an unjudged record would put a clean
  // header on a review that is not clean. A worse status is allowed, because
  // `incomplete` and `usage-error` also come from inputs the payload does not
  // carry (a partial file set, a base that did not resolve).
  const implied = assembleResult({
    checkExitCode: /** @type {number | null} */ (result['checkExitCode']),
    lintExitCode: /** @type {number | null} */ (result['lintExitCode']),
    verdicts,
    unverified: /** @type {string[]} */ (result['unverified']),
  }).status;
  if (rank(/** @type {string} */ (result['status'])) < rank(implied)) {
    fail(`status ${result['status']} is cleaner than its own payload, which implies ${implied}`);
  }
  // Guard against `assembleResult` growing a key this projection does not know.
  return Object.fromEntries(RESULT_KEYS.map((key) => [key, result[key]]));
}

/**
 * Run the workflow's Collect and Check in `cwd` — no Judge, so no model spend —
 * and shape the outcome for the panel. Nothing here throws: invalid input, a
 * base that does not resolve, a CLI that cannot start, and an unreadable report
 * all become a `usage-error` snapshot with the message in `notes`, never `ok`.
 * The status comes from `assembleResult`, so the vocabulary is the workflow's,
 * and a governing record with no verdict keeps it at `incomplete` at best:
 * nothing here has been judged, so it never says `ok` over one.
 *
 * @param {{
 *   cwd: string, input: unknown, run: CwdRunner, env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean, now: () => string,
 * }} deps
 * @returns {Promise<Snapshot>}
 */
export async function computeSnapshot(deps) {
  const check = await computeCheck(deps);
  return { ...check, status: combinedStatus(check.status, check.governing, null) };
}

/**
 * `computeSnapshot` before the governing-without-verdict rule: the check's own
 * status, which the canvas combines with whatever review it holds.
 *
 * @param {Parameters<typeof computeSnapshot>[0]} deps
 * @returns {Promise<Snapshot>}
 */
async function computeCheck({ cwd, input, run, env, exists, now }) {
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
      // The full list, held in memory for the fingerprint and the stale-review
      // checks; `snapshotOf` caps what the page and the agent see.
      files: fields.files ?? [],
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
    notes.push(publicMessage(error));
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
    const check = await checkInBatches(adr, ['check', '--json', ...dirArgs, '--'], collected.files, { overhead: cliOverhead(cli) });
    const lint = await adr(['lint', ...dirArgs]);
    checked = { check, lint };
  } catch (error) {
    return usage(error, fileFields);
  }

  const { check, lint } = checked;
  const exits = { checkExitCode: check.exitCode, lintExitCode: lint.exitCode };
  if (lint.exitCode !== 0) {
    notes.push(lintNote(lint.exitCode));
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
    notes.push(checkNote(check.exitCode));
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

/** The most queue rows a snapshot carries; the count of the rest is kept. */
export const QUEUE_LIMIT = 200;
/** The most serialized bytes the queue rows may add to a snapshot. */
export const QUEUE_BYTES_LIMIT = 256 * 1024;
/** The most routing targets kept per queue row. */
const ROUTING_LIMIT = 50;
/** How long the queue may take before the panel shows a note instead. */
export const QUEUE_TIMEOUT_MS = 30_000;

/**
 * Fixed notes for a queue that could not be read. Never the CLI's own stderr
 * or an exception's text: these reach the page and the agent, and a fixed
 * message selected by an explicit check is the rule since CodeQL's
 * stack-trace finding on the first canvas.
 */
/**
 * Fixed notes for the governing view. An automatic refresh (the hooks') runs
 * under a signal; when it fires, the panel keeps its previous result and says
 * so, rather than showing the abort's exception text as a usage error.
 */
export const CANVAS_NOTES = {
  autoRefreshTimeout: 'Automatic refresh timed out; showing the previous result.',
};

export const QUEUE_NOTES = {
  args: "The open-proposal list was not computed: the panel's arguments are not valid.",
  start: 'The open-proposal list is unavailable: the adr CLI could not be started.',
  unreadable: 'The open-proposal list is unavailable: adr queue did not return a readable report.',
  version: 'The open-proposal list is unavailable: adr queue returned a report version this panel does not read.',
  tooLarge: 'The open-proposal list is unavailable: the adr queue report was too large to read.',
  timeout: 'The open-proposal list is unavailable: adr queue did not finish in time.',
  autoRefreshTimeout: 'The open-proposal list was not updated: the automatic refresh timed out; showing the previous list.',
  /** @param {number} code */
  exit: (code) => `The open-proposal list is unavailable: adr queue exited ${code}.`,
};

/** @param {unknown} value */
const intOr = (value, fallback = 0) => (Number.isInteger(value) ? /** @type {number} */ (value) : fallback);
/** @param {unknown} value */
const stringOrNull = (value) => (typeof value === 'string' ? value : null);

/**
 * Keep the queue fields the page renders, by allowlist. The allowlist is the
 * mechanism that keeps a ratifying command field out of the panel: the queue's
 * terminal view prints one for a human, and any such field the JSON gains
 * later is dropped here without anyone having to name it. It selects fields,
 * not text: `title` and the other kept strings are untrusted repository text,
 * bounded and shown as data (textContent only), and are not vetted for what
 * they say.
 *
 * @param {Record<string, unknown>} item
 * @returns {QueueItem}
 */
export function shownQueueItem(item) {
  return {
    id: clip(String(item['id'])),
    // Repository text, so each string is bounded like a CLI message: it is
    // broadcast to every panel and returned to the agent on each refresh.
    title: typeof item['title'] === 'string' ? clip(item['title']) : '',
    sourcePath: typeof item['sourcePath'] === 'string' ? clip(item['sourcePath']) : '',
    slaState: typeof item['slaState'] === 'string' ? clip(item['slaState']) : '',
    deadlineDate: typeof item['deadlineDate'] === 'string' ? clip(item['deadlineDate']) : null,
    approvalCount: intOr(item['approvalCount']),
    quorum: Number.isInteger(item['quorum']) ? /** @type {number} */ (item['quorum']) : null,
    unresolvedObjectionCount: intOr(item['unresolvedObjectionCount']),
    routingTargets: Array.isArray(item['routingTargets'])
      ? item['routingTargets']
          .filter((target) => typeof target === 'string')
          .slice(0, ROUTING_LIMIT)
          .map((target) => clip(target))
      : [],
  };
}

/**
 * The open `proposed` records, corpus-wide, from `adr queue --format json`
 * (QueueReport v1). Read-only and free: one CLI call, no model. It is computed
 * beside the check, never inside it, so it runs when no file changed, and
 * nothing here can change the check's status or its governing list. Exit 0
 * and 1 both carry a complete report (1 means corpus findings); anything else
 * becomes a fixed note. Nothing here throws.
 *
 * A queue that has not answered within `timeoutMs` is abandoned (its process
 * is signalled) and reported with a fixed note, so a hung `adr queue` never
 * holds the governing view.
 *
 * @param {{
 *   cwd: string, input: unknown, run: CwdRunner, env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean, timeoutMs?: number,
 *   shownItem?: (item: Record<string, unknown>) => any,
 * }} deps `shownItem` is the row allowlist; the decision board (ADR-0050)
 *   passes a wider one, and this panel's stays `shownQueueItem`.
 * @returns {Promise<QueueView>}
 */
export async function computeQueue({ cwd, input, run, env, exists, timeoutMs = QUEUE_TIMEOUT_MS, shownItem = shownQueueItem }) {
  /** @param {string} note @param {number | null} [exitCode] @returns {QueueView} */
  const unavailable = (note, exitCode = null) => ({
    available: false,
    asOf: null,
    exitCode,
    totalItems: 0,
    corpusFindings: 0,
    items: [],
    note,
  });
  /** @type {ReviewArgs} */
  let args;
  try {
    args = validateArgs(input);
  } catch {
    return unavailable(QUEUE_NOTES.args);
  }
  const dir = args.dir ?? env['ADRKIT_DIR'];
  /** @type {CommandResult} */
  let result;
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const TIMED_OUT = Symbol('timed out');
  try {
    const cli = resolveCli({ env, cwd, exists });
    const running = run(cli.command, [...cli.args, 'queue', '--format', 'json', ...(dir ? ['--dir', dir] : [])], {
      cwd,
      signal: controller.signal,
    });
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    const settled = await Promise.race([running, expired]);
    if (settled === TIMED_OUT) {
      controller.abort();
      // The abandoned run rejects once signalled; nothing is waiting for it.
      running.catch(() => {});
      return unavailable(QUEUE_NOTES.timeout);
    }
    result = /** @type {CommandResult} */ (settled);
  } catch (error) {
    // Selected by an explicit code comparison; the error's own text is never used.
    if (isRecord(error) && error['code'] === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return unavailable(QUEUE_NOTES.tooLarge);
    return unavailable(QUEUE_NOTES.start);
  } finally {
    clearTimeout(timer);
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) return unavailable(QUEUE_NOTES.exit(result.exitCode), result.exitCode);
  /** @type {unknown} */
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return unavailable(QUEUE_NOTES.unreadable, result.exitCode);
  }
  if (!isRecord(report) || !Array.isArray(report['items'])) return unavailable(QUEUE_NOTES.unreadable, result.exitCode);
  if (report['version'] !== '1') return unavailable(QUEUE_NOTES.version, result.exitCode);
  const all = report['items'].filter(isRecord).filter((item) => typeof item['id'] === 'string');
  // Capped by count, then by serialized size: per-string caps alone still let a
  // few hundred rows carry tens of megabytes into every broadcast.
  /** @type {QueueItem[]} */
  const items = [];
  let bytes = 0;
  for (const item of all.slice(0, QUEUE_LIMIT)) {
    const shown = shownItem(item);
    bytes += Buffer.byteLength(JSON.stringify(shown));
    if (bytes > QUEUE_BYTES_LIMIT) break;
    items.push(shown);
  }
  return {
    available: true,
    asOf: stringOrNull(report['asOf']),
    exitCode: result.exitCode,
    totalItems: intOr(report['totalItems'], all.length),
    corpusFindings: intOr(report['totalCorpusFindings']),
    items,
    note: all.length > items.length ? `Showing the first ${items.length} of ${all.length} open proposals.` : null,
  };
}

/** @param {string} a @param {string} b */
const worse = (a, b) => (rank(a) >= rank(b) ? a : b);

/** @param {ReviewState | null} review */
const usableResult = (review) => (review && review.runStatus === 'completed' && review.result ? review.result : null);

/**
 * Governing records in view that the review gave no verdict. Before any review
 * that is every governing record.
 *
 * @param {ShownDecision[]} governing
 * @param {ReviewState | null} review
 */
function unjudged(governing, review) {
  const result = usableResult(review);
  const judged = new Set(result ? result.verdicts.map((/** @type {{ recordId: string }} */ v) => v.recordId) : []);
  return governing.map((decision) => decision.recordId).filter((id) => !judged.has(id));
}

/**
 * The status the panel shows. `pending` while a run is being followed;
 * otherwise the worse of the check's status and the review's, and never better
 * than `incomplete` while a governing record has no verdict. `ok` is the
 * workflow's word for "judged clean", so a panel that has judged nothing must
 * not say it. Precedence stays usage-error > findings > incomplete > ok. A
 * review that settled without a usable result is `incomplete`.
 *
 * @param {string} checkStatus
 * @param {ShownDecision[]} governing
 * @param {ReviewState | null} review
 */
function combinedStatus(checkStatus, governing, review) {
  if (review?.watching) return 'pending';
  let status = checkStatus;
  if (review) status = worse(status, usableResult(review)?.status ?? 'incomplete');
  if (unjudged(governing, review).length > 0) status = worse(status, 'incomplete');
  return status;
}

/** Sorted, joined record ids: what a review is compared against on refresh. @param {ShownDecision[]} governing */
const governingKey = (governing) => governing.map((decision) => decision.recordId).sort().join(',');

/**
 * @param {Workspace} workspace
 * @returns {Snapshot}
 */
function snapshotOf(workspace) {
  const check = /** @type {Snapshot} */ (workspace.check);
  const { review } = workspace;
  const notes = [...check.notes];
  if (review?.message) notes.push(review.message);
  const missing = usableResult(review) ? unjudged(check.governing, review) : [];
  if (missing.length > 0) notes.push(`The review has no verdict for governing record(s) ${missing.join(', ')}.`);
  const shown = capFiles(check.files);
  return {
    ...check,
    files: shown.files,
    filesOmitted: shown.omitted,
    status: combinedStatus(check.status, check.governing, review),
    notes,
    judgeCalls: judgeCallsOf(check),
    queue: workspace.queue,
    review: review
      ? { ...(review.runId ? { runId: review.runId } : {}), runStatus: review.runStatus, result: review.result }
      : null,
  };
}

/**
 * What a review would cost before it is started. The workflow's Judge makes
 * one decision-checker call per governing decision (review.mjs), and skips the
 * Judge entirely when `adr check` or `adr lint` exit anything but 0 or 1, so
 * those make none.
 *
 * @param {Snapshot} check
 */
function judgeCallsOf(check) {
  const succeeded = (/** @type {number | null} */ code) => code === 0 || code === 1;
  return succeeded(check.checkExitCode) && succeeded(check.lintExitCode) ? check.governing.length : 0;
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

/**
 * Optional input is declared as object-or-null: the app's agent was measured
 * sending `input: null` to open_canvas, which the runtime rejected against a
 * plain `object` schema before `open` ran. Null means "no input" everywhere.
 */
const ARGS_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths; default: git diff <base>...HEAD.' },
    base: { type: 'string', description: 'Base ref; default origin/main.' },
    dir: { type: 'string', description: 'ADR corpus directory; default $ADRKIT_DIR or docs/adr.' },
  },
};

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
 *   stat?: (path: string) => Promise<{ size: number, mtimeMs: number }>,
 *   pollIntervalMs?: number,
 *   maxPolls?: number,
 *   queueTimeoutMs?: number,
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
  stat = (path) => nodeStat(path),
  pollIntervalMs = 2000,
  maxPolls = 1800,
  queueTimeoutMs = QUEUE_TIMEOUT_MS,
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
      workspace = { args: undefined, check: null, queue: null, queuePending: null, review: null, seq: 0 };
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
   * What a review was judged against beyond the file names: the base, the
   * file source, and each changed file's size and modification time. File
   * names alone miss an edit to a file already in the set, which would leave a
   * clean verdict over contents nobody reviewed. Held in memory only.
   *
   * @param {string} cwd
   * @param {Snapshot} check
   */
  const fingerprintOf = async (cwd, check) => {
    const marks = await Promise.all(
      [...check.files].sort().map(async (file) => {
        try {
          const found = await stat(resolve(cwd, file));
          return `${file}\0${found.size}:${found.mtimeMs}`;
        } catch {
          return `${file}\0missing`;
        }
      }),
    );
    return [`base:${check.base ?? ''}`, `source:${check.filesSource ?? ''}`, ...marks].join('\n');
  };

  /**
   * Recompute the snapshot for `cwd`. `input` replaces the remembered args when
   * given; the page's Refresh reuses them. A review stays only while it still
   * describes the same file set, the same file contents, and the same governing
   * records: otherwise its verdicts would be shown against files it never read,
   * or a record added since would sit unjudged under a clean header.
   *
   * The check commits and broadcasts as soon as it settles; the queue lands in
   * a second update under the same sequence guard. `waitForQueue: false` lets a
   * caller that must not wait (opening a panel, serving the page) return with
   * the governing view while a slow queue is still running.
   *
   * @param {string} cwd
   * @param {unknown} [input]
   * @param {{ waitForQueue?: boolean, signal?: AbortSignal }} [opts] `signal`
   *   bounds every git and adr call, the queue's included (the hooks' refresh
   *   passes one); the queue keeps its own timeout too.
   */
  const refresh = async (cwd, input, { waitForQueue = true, signal } = {}) => {
    const workspace = workspaceFor(cwd);
    if (input !== undefined) workspace.args = input;
    const seq = ++workspace.seq;
    /** @type {CwdRunner} */
    const bounded = signal
      ? (command, args, options) =>
          run(command, args, { ...options, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal })
      : run;
    // Beside the check, not inside it: the queue is corpus-wide, so it runs with
    // no changed files too, it can never alter the check's result, and neither
    // its time nor its failure holds the governing view.
    const queueRun = computeQueue({ cwd, input: workspace.args, run: bounded, env, exists, timeoutMs: queueTimeoutMs });
    const computed = await computeCheck({ cwd, input: workspace.args, run: bounded, env, exists, now });
    // An automatic refresh its signal cut short says nothing about the
    // repository: its snapshot would show the abort's exception text as a
    // usage error. Keep what the panel had and add a fixed note instead.
    const timedOut = Boolean(signal?.aborted);
    const previous = workspace.check;
    const snapshot =
      timedOut && previous
        ? { ...previous, notes: [...previous.notes.filter((note) => note !== CANVAS_NOTES.autoRefreshTimeout), CANVAS_NOTES.autoRefreshTimeout] }
        : timedOut
          ? { ...computed, notes: [CANVAS_NOTES.autoRefreshTimeout] }
          : computed;
    const fingerprint = await fingerprintOf(cwd, snapshot);
    // A slower, older refresh must not overwrite a newer one. It still fills
    // an empty workspace: two panels opened at once on one directory would
    // otherwise have the first to finish return a snapshot that does not exist
    // yet. The newer refresh overwrites it when it lands.
    if (seq === workspace.seq || workspace.check === null) {
      workspace.check = snapshot;
      const review = workspace.review;
      if (review && !review.watching && review.result) {
        // The result lists at most FILES_ECHO_LIMIT paths; the fingerprint below
        // covers the full list.
        const sameFiles = sameFileSet(review.result.files, review.result.filesOmitted ?? 0, snapshot.files, review.result.filesDigest ?? null);
        const sameGoverning = review.governingKey === undefined || review.governingKey === governingKey(snapshot.governing);
        const sameContents = review.fingerprint === fingerprint;
        if (!sameFiles || !sameGoverning || !sameContents) workspace.review = null;
      }
      broadcast(cwd);
    }
    const queueDone = queueRun
      .then((computedQueue) => {
        // Same rule for the queue: an aborted automatic refresh keeps the
        // previous list under a fixed note, never "could not be started".
        const queue =
          signal?.aborted && !computedQueue.available
            ? workspace.queue?.available
              ? { ...workspace.queue, note: QUEUE_NOTES.autoRefreshTimeout }
              : { ...computedQueue, note: QUEUE_NOTES.autoRefreshTimeout }
            : computedQueue;
        if (seq === workspace.seq || workspace.queue === null) {
          workspace.queue = queue;
          broadcast(cwd);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (workspace.queuePending === queueDone) workspace.queuePending = null;
      });
    // Only the newest refresh owns the hand-off: a stale one finishing late
    // must not make a waiting caller return before the newest queue lands.
    if (seq === workspace.seq) workspace.queuePending = queueDone;
    if (waitForQueue) await queueDone;
    return snapshotOf(workspace);
  };

  /** @param {string} cwd */
  const stateFor = async (cwd, { waitForQueue = true } = {}) => {
    const workspace = workspaceFor(cwd);
    if (!workspace.check) await refresh(cwd, undefined, { waitForQueue });
    else if (waitForQueue && workspace.queuePending) await workspace.queuePending;
    resume(cwd);
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
        if (failures >= 3) return stop(REVIEW_NOTES.unreadable(runId));
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
      } catch {
        review.message = REVIEW_NOTES.noResult(runId);
      }
    } else {
      // `current.status` is one of TERMINAL_RUN_STATES here; its `error` and
      // `reason` are the run's own text and are not repeated.
      review.message = REVIEW_NOTES.ended(runId, current.status);
    }
    broadcast(cwd);
  };

  /**
   * Run `watch` detached; an unexpected failure ends following, never silently.
   *
   * @param {string} cwd @param {ReviewState} review @param {any} session
   * @param {{ runId: string, status: string }} first
   */
  const follow = (cwd, review, session, first) => {
    const workspace = workspaceFor(cwd);
    watch(cwd, review, session, first).catch(() => {
      if (workspace.review === review && review.watching) {
        review.watching = false;
        review.message = REVIEW_NOTES.stopped(first.runId);
        broadcast(cwd);
      }
    });
  };

  /**
   * Pick a known run back up when following stopped before it settled (the
   * last panel closed mid-run). Without this the panel would show the run as
   * abandoned and offer a fresh, paid one while the first may have finished.
   * Only while a panel is open, since `watch` stops without one.
   *
   * @param {string} cwd
   */
  const resume = (cwd) => {
    const review = workspaceFor(cwd).review;
    if (!review || review.watching || !review.runId || TERMINAL_RUN_STATES.has(review.runStatus)) return;
    if (!panelOpenFor(cwd)) return;
    const session = getSession();
    if (!session?.rpc?.workflow) return;
    review.watching = true;
    delete review.message;
    broadcast(cwd);
    follow(cwd, review, session, { runId: review.runId, status: review.runStatus });
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
    const known = workspace.review;
    // A run in flight, or one known to the session and not yet settled, is
    // returned rather than paid for twice.
    if (known && (known.watching || (known.runId && !TERMINAL_RUN_STATES.has(known.runStatus)))) {
      resume(cwd);
      return { runId: known.runId, status: known.runStatus };
    }
    let args;
    try {
      args = validateArgs(input === undefined ? workspace.args : input);
    } catch (error) {
      throw makeError('invalid_input', publicMessage(error));
    }
    const session = getSession();
    if (!session?.rpc?.workflow) {
      throw makeError('session_unavailable', SESSION_UNAVAILABLE);
    }
    /** @type {ReviewState} */
    const review = { runId: null, runStatus: 'pending', result: null, watching: true };
    // Reserved before any await, so a second request cannot start a second run.
    workspace.review = review;
    // New input means a new file set: refresh first, so the panel never pairs
    // a check of one set with a review of another.
    if (input !== undefined || !workspace.check) await refresh(cwd, input, { waitForQueue: false });
    review.governingKey = governingKey(/** @type {Snapshot} */ (workspace.check).governing);
    review.fingerprint = await fingerprintOf(cwd, /** @type {Snapshot} */ (workspace.check));
    broadcast(cwd);

    let envelope;
    try {
      // `args` is required on the wire even when empty.
      envelope = await session.rpc.workflow.run({ name: REVIEW_WORKFLOW, args });
    } catch {
      review.watching = false;
      review.runStatus = 'error';
      review.message = REVIEW_NOTES.notStarted;
      broadcast(cwd);
      return { runId: null, status: 'error' };
    }
    review.runId = envelope.runId;
    review.runStatus = envelope.status;
    broadcast(cwd);
    follow(cwd, review, session, envelope);
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
        return replyJson(res, 200, await stateFor(cwd, { waitForQueue: false }));
      case 'GET /events': {
        const snapshot = await stateFor(cwd, { waitForQueue: false });
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

    if (url.pathname === '/api/refresh') return replyJson(res, 200, await refresh(cwd, undefined, { waitForQueue: false }));
    if (url.pathname === '/api/run-review') {
      try {
        await runReview(cwd);
      } catch (error) {
        // A fixed message, never the error's own text: the detail is already
        // in the panel's notes, and an exception's text does not belong in a
        // response.
        const code = isRecord(error) ? error['code'] : undefined;
        if (code === 'session_unavailable') return replyJson(res, 503, { error: SESSION_UNAVAILABLE });
        if (code === 'invalid_input') return replyJson(res, 400, { error: INVALID_REVIEW_ARGS });
        return replyJson(res, 500, { error: 'The review could not be started.' });
      }
      return replyJson(res, 200, await stateFor(cwd, { waitForQueue: false }));
    }

    // POST /api/explain
    const recordId = isRecord(body) ? body['recordId'] : undefined;
    if (typeof recordId !== 'string' || !RECORD_ID.test(recordId)) {
      return replyJson(res, 400, { error: 'recordId must be a four-digit record id.' });
    }
    if (!knownRecordIds(await stateFor(cwd, { waitForQueue: false })).has(recordId)) {
      return replyJson(res, 404, { error: `Record ${recordId} is not in this view.` });
    }
    const session = getSession();
    if (!session) return replyJson(res, 503, { error: 'The Copilot session is not available yet.' });
    try {
      await session.send({ prompt: buildExplainPrompt(recordId) });
    } catch (error) {
      return replyJson(res, 502, { error: 'Could not reach the agent.' });
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

  /** `null` input is no input: it never replaces the remembered args. @param {any} ctx */
  const inputOf = (ctx) => (ctx?.input === null ? undefined : ctx?.input);

  /** @param {any} ctx @param {(cwd: string, input: unknown) => Promise<unknown>} body */
  const withCwd = async (ctx, body) => body(await cwdFor(ctx), inputOf(ctx));

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
          'Return the panel snapshot: status, changed files, governing decisions (with what tied each to ' +
          'the change: firedMatchers for an affects pattern, declaredBy for an inbound marker), active ' +
          'proposals, history (listed, not judged), findings, notes, judgeCalls (the decision-checker calls ' +
          'a review would make now), queue (open proposed records corpus-wide, listed only), and the latest ' +
          'adr-review result if any. Read-only.',
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd) => stateFor(cwd)),
      },
      {
        name: 'refresh',
        description:
          'Re-run Collect and Check (git diff, adr check, adr lint) and the open-proposal list (adr queue) ' +
          'in the session working directory and update the panel. No model calls. Input replaces the remembered { base, files, dir }; omit it to reuse them.',
        inputSchema: ARGS_SCHEMA,
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd, input) => refresh(cwd, input)),
      },
      {
        name: 'show_review',
        description:
          'Display an adr-review result the panel did not start itself: pass the run result object as ' +
          '{ result }. Runs started from the panel or via run_review appear automatically; do not call this ' +
          'for them. It must describe the panel\'s current files and governing records, and its status must ' +
          'not be cleaner than its own verdicts and exit codes. Unknown keys are dropped. Starts nothing.',
        inputSchema: { type: 'object', required: ['result'], properties: { result: { type: 'object' } } },
        handler: (/** @type {any} */ ctx) =>
          withCwd(ctx, async (cwd, input) => {
            let result;
            try {
              if (!isRecord(input)) throw new InvalidResult('input must be { result }');
              result = sanitizeReviewResult(input['result']);
            } catch (error) {
              // Only this file's own refusal text is passed on, chosen by type.
              throw makeError('invalid_input', error instanceof InvalidResult ? error.message : REVIEW_NOTES.invalidResult);
            }
            const workspace = workspaceFor(cwd);
            if (!workspace.check) await refresh(cwd, undefined, { waitForQueue: false });
            const current = /** @type {Snapshot} */ (workspace.check);
            // A result for another change would put its verdicts over files and
            // records it never judged, so it must describe this panel's.
            const shownFiles = /** @type {string[]} */ (result['files']);
            const shownGoverning = /** @type {ShownDecision[]} */ (result['governing']);
            const sameFiles = sameFileSet(
              shownFiles,
              /** @type {number} */ (result['filesOmitted']),
              current.files,
              /** @type {string | null} */ (result['filesDigest']),
            );
            if (!sameFiles || governingKey(shownGoverning) !== governingKey(current.governing)) {
              throw makeError(
                'stale_result',
                "The result describes a different change: its files or governing records differ from the panel's. " +
                  'Refresh with its { base, files, dir }, or use run_review.',
              );
            }
            // Measured in the app: when a panel-started run finished, the agent
            // was told about it and handed the same result back, which relabelled
            // the panel's own run as agent-supplied. A run this panel started is
            // kept, running or settled, while it describes the same records.
            const own = workspace.review;
            const check = /** @type {Snapshot} */ (workspace.check);
            if (own?.runId && own.governingKey === governingKey(check.governing)) {
              return {
                ...snapshotOf(workspace),
                ignored: `the panel already shows run ${own.runId}, which it started itself`,
              };
            }
            workspace.review = {
              runId: null,
              runStatus: 'completed',
              result,
              watching: false,
              governingKey: governingKey(current.governing),
              fingerprint: await fingerprintOf(cwd, current),
            };
            broadcast(cwd);
            return snapshotOf(workspace);
          }),
      },
      {
        name: 'run_review',
        description:
          'Start the adr-review dynamic workflow for { base, files, dir } (default: the panel\'s). ' +
          'This spends AI credits: as the workflow is written it makes at most one decision-checker call per ' +
          "governing decision, and get_state's judgeCalls is that count for the panel's current files " +
          '(runtime retries are not counted; new input re-checks first, so the count can change). With 0 ' +
          'governing decisions, or when adr check or adr lint exits 2 or more, nothing is judged and ' +
          'judgeCalls is 0. One measured run judged two decisions for about 0.16 AI ' +
          'credits on Copilot CLI 1.0.93; that is a measurement, not a price. ' +
          'Returns { runId, status } at once; the panel follows the run and shows its verdicts. Advisory only.',
        inputSchema: ARGS_SCHEMA,
        handler: (/** @type {any} */ ctx) => withCwd(ctx, (cwd, input) => runReview(cwd, input)),
      },
    ],

    /** @param {any} ctx */
    open: async (ctx) => {
      const cwd = workingDirectoryOf(ctx);
      const input = inputOf(ctx);
      let pending = instances.get(ctx.instanceId);
      const isNew = !pending;
      if (!pending) {
        const starting = (async () => {
          await refresh(cwd, input, { waitForQueue: false });
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
      const workspace = workspaceFor(instance.cwd);
      // A re-open keeps its URL; new input is applied, not silently dropped.
      if (!isNew && input !== undefined && JSON.stringify(input) !== JSON.stringify(workspace.args)) {
        await refresh(instance.cwd, input, { waitForQueue: false });
      }
      resume(instance.cwd);
      return { url: instance.url, title: CANVAS_TITLE, status: statusLine(snapshotOf(workspace)) };
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

    /**
     * The advisory post-edit hook's way in (ADR-0049): the free `refresh` for
     * each directory with an open panel, and nothing when none is open. Never
     * starts `run_review`. Not an SDK field: `createCanvas` copies only the
     * fields it knows, so this stays in process. `signal` bounds the git and
     * adr calls. Resolves to the number of directories refreshed.
     *
     * @param {{ signal?: AbortSignal }} [options]
     */
    refreshOpen: async ({ signal } = {}) => {
      const cwds = new Set([...live].map((instance) => instance.cwd));
      for (const cwd of cwds) await refresh(cwd, undefined, { signal });
      return cwds.size;
    },
  };
}
