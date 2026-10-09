// @ts-check
/**
 * The decision board's one writing path (ADR-0052): a person confirms an
 * approval, an objection, or a resolution on the page, and this module runs
 * `adr approve`, `adr object`, or `adr resolve` (ADR-0051) for them.
 *
 * This is the only plugin module allowed to name those three subcommands; the
 * wiring test's verb guard exempts this one file and no other. Nothing a model
 * can call reaches it: `board.mjs` imports it and calls it only from its HTTP
 * route handler, never from a canvas action, and no tool, hook, or workflow
 * imports it. A test checks that import graph, and another drives every board
 * action with write-shaped input and asserts that nothing here was spawned.
 *
 * The boundary, each part tested:
 *
 * - **Identity** comes from `ADRKIT_REVIEWER`, read on every request, and never
 *   from the page, the model, or an argument. It must pass the same rule as the
 *   CLI's `isWritableIdentity` (mirrored here, because an extension cannot
 *   import core). Unset or invalid, the controls are off with a fixed note and
 *   both routes refuse. A body that carries any key beyond the documented ones
 *   (`by` among them) is refused.
 * - **A fresh nonce per write.** The page asks for one when a person arms a
 *   control, bound to that kind and record; it is single use, replaced by the
 *   next one issued to the same panel, and expires after two minutes. It is
 *   served only over the panel's POST route, which needs the token header and
 *   a same-origin `Origin`, and never reaches a canvas action's result.
 * - **argv only.** `[subcommand, id, '--by', reviewer, '--json', ...]` with the
 *   summary as one `--summary=<text>` element, so a summary that starts with
 *   `-` stays a value. Never a shell. The id, the summary (core's
 *   `objectionSummaryProblem`, mirrored), and the objection index are checked
 *   before anything is spawned.
 * - **Fixed results.** Exit codes map to fixed messages. The CLI writes its
 *   refusal reason to stderr only (measured on 0.18.0: with `--json`, a refusal
 *   prints nothing on stdout), so a refusal is one fixed message, and stderr is
 *   never read. An exit 2 is checked against `adr --version`, because an older
 *   CLI without these subcommands also exits 2 (measured on 0.17.0).
 * - **Logged, not narrated.** Every spawned write is logged through the
 *   session log, fire-and-forget, with the record id, the kind, the identity,
 *   and the outcome, never the summary or any repository text.
 *
 * Nothing runs at import, and every process, clock, and random source is
 * passed in.
 */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { BODY_LIMIT, BodyTooLarge, readBody, reply, replyJson, tokenMatches } from './panel-http.mjs';
import { resolveCli } from './review.mjs';

/**
 * @import { IncomingMessage, ServerResponse } from 'node:http'
 * @import { CommandResult } from './review.mjs'
 */

/** The first `@adrkit/cli` release with the review subcommands. */
export const MIN_CLI_VERSION = '0.18.0';
/** How long an issued nonce stays spendable. */
export const NONCE_TTL_MS = 2 * 60 * 1000;
/** How long one write may run before the page is told its outcome is unknown. */
export const WRITE_TIMEOUT_MS = 30_000;
/** How long the host's confirmation may stay unanswered before it counts as declined. */
export const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;
/**
 * How often the board may put a confirmation in front of the person (review
 * R1-M1): at most one per 10 s, and five per sliding 10 minutes, across every
 * board panel in this extension process. A model that holds a token could
 * otherwise keep a dialog permanently pending, and a per-panel budget would
 * reset each time it opened a new panel. A session belongs to one person, so a
 * shared budget throttles nobody else.
 */
export const DIALOG_SPACING_MS = 10_000;
export const DIALOG_WINDOW_MS = 10 * 60 * 1000;
export const DIALOG_WINDOW_MAX = 5;
/** How long `adr --version` may take. */
export const VERSION_TIMEOUT_MS = 5_000;
/** The longest objection summary, in code points (core's MAX_OBJECTION_SUMMARY_LENGTH). */
export const MAX_SUMMARY_LENGTH = 500;
/** The longest reviewer identity the board accepts; longer is off, not clipped. */
export const MAX_REVIEWER_LENGTH = 320;
/** The largest objection number the page may send. */
const MAX_OBJECTION = 999_999;

/** What the page asks for, by noun. The CLI subcommand is chosen here only. */
export const REVIEW_KINDS = /** @type {const} */ (['approval', 'objection', 'resolution']);
/** @type {Record<(typeof REVIEW_KINDS)[number], string>} */
const SUBCOMMANDS = { approval: 'approve', objection: 'object', resolution: 'resolve' };

/** Why the controls are off. Fixed text: it reaches the page and the agent. */
export const REVIEW_NOTES = {
  unset:
    'Recording review is off: set ADRKIT_REVIEWER to your @handle, team:slug, or email address in the environment ' +
    'GitHub Copilot runs in, then restart it. The page cannot supply an identity.',
  invalid:
    'Recording review is off: ADRKIT_REVIEWER is not an identity the adr CLI records (@handle, team:slug, or an ' +
    'email address, with no control or invisible characters). The page cannot supply an identity.',
  unavailable: 'Recording review is unavailable on this board.',
  noConfirm:
    'Recording review is off: this host cannot ask you to confirm a review write, so the board will not record one. ' +
    'Each write needs a confirmation from the host, which the model cannot answer.',
};

/** Fixed refusals for a request the route will not act on. */
export const REVIEW_REFUSALS = {
  nonce: 'This confirmation expired or was already used. Choose the control again to confirm.',
  shape: 'The request must be a JSON object with only the documented keys for its kind.',
  kind: 'kind must be one of approval, objection, resolution.',
  id: 'id must be a record id: four or more digits, or a 26-character ULID.',
  summary:
    'The objection summary must be one non-empty line of at most 500 characters, with no control or invisible characters.',
  objection: 'objection must be a whole number from 1, counting objections in file order.',
  pending: 'GitHub Copilot is already asking you to confirm a review write. Decline it unless you started it, then try again.',
  tooSoon: 'Nothing was asked or written: this board asked for a confirmation less than 10 seconds ago. Wait, then try again.',
  tooMany:
    'Nothing was asked or written: this board has asked for five confirmations in the last 10 minutes. Wait, then try again.',
};

/** How the pending-write message names each kind. */
const ACTION_PHRASE = { approval: 'an approval', objection: 'an objection', resolution: 'a resolution' };

/** Every confirmation ends with this. */
const CONFIRM_TAIL =
  ' This writes review state into the record under your identity. Decline unless you just asked for it on the board.';

/**
 * Fixed messages for a write's outcome. The id and the reviewer interpolated
 * into some are validated first: the id against the record grammar and the
 * reviewer against the identity rule.
 */
export const REVIEW_MESSAGES = {
  written: {
    /** @param {string} id @param {string} who */
    approval: (id, who) => `Recorded an approval of ADR-${id} by ${who}. Nothing was committed: review the diff and open a pull request.`,
    /** @param {string} id @param {string} who */
    objection: (id, who) => `Recorded an objection on ADR-${id} by ${who}. Nothing was committed: review the diff and open a pull request.`,
    /** @param {string} id @param {string} who */
    resolution: (id, who) => `Recorded ${who}'s objection on ADR-${id} as resolved. Nothing was committed: review the diff and open a pull request.`,
  },
  unchanged: {
    /** @param {string} id @param {string} who */
    approval: (id, who) => `Nothing changed: ADR-${id} already has an approval from ${who}.`,
    /** @param {string} id @param {string} who */
    objection: (id, who) => `Nothing changed: ADR-${id} already has this open objection from ${who}.`,
    /** @param {string} id @param {string} who */
    resolution: (id, who) => `Nothing changed: that objection on ADR-${id} is already resolved (${who}).`,
  },
  refused:
    'The adr CLI refused this (exit 1), and the record was not changed. The record may not be proposed or may not be ' +
    'valid, or, for a resolution, the objection may not exist or may not be yours. adr lint and adr queue show its state.',
  usage:
    'The adr CLI refused the request as a usage error (exit 2), and nothing was written. The record may not exist in ' +
    'this corpus, or the corpus directory may be unreachable.',
  oldCli: `This adr CLI does not support review commands; upgrade @adrkit/cli to ${MIN_CLI_VERSION} or later.`,
  unreadable: 'The adr CLI finished (exit 0) but its result was not readable. Refresh to see the record\'s state.',
  /** @param {number} code */
  exit: (code) => `The adr CLI exited ${code}; the record may not have changed. Refresh to see its state.`,
  start: 'The adr CLI could not be started, so nothing was written.',
  timeout: 'The adr CLI did not finish in time; the record may or may not have changed. Refresh to see its state.',
  dirEscape: 'Nothing was written: the board\'s corpus directory now resolves outside the repository.',
  notConfirmed: 'Nothing was written: the host confirmation was declined, cancelled, or not answered.',
  autopilot: 'Nothing was written: the session is in autopilot, where the board records no review.',
  modeUnknown: "Nothing was written: the session's agent mode could not be read, so the board did not ask.",
  /**
   * A write is already waiting for the host's confirmation. Names the pending
   * kind and record (both validated) so the person can tell a confirmation
   * they did not start from their own (review R1-M1).
   * @param {string} kind @param {string} id
   */
  pending: (kind, id) =>
    `GitHub Copilot is already asking you to confirm ${ACTION_PHRASE[/** @type {keyof typeof ACTION_PHRASE} */ (kind)] ?? 'a review write'} of ADR-${id}. ` +
    'Decline it unless you started it, then try again.',
  /**
   * The host's confirmation dialog. Built only from fixed text, the kind, the
   * id (validated against the record grammar), the identity (validated against
   * the identity rule), and numbers. Never the summary or a title: both are
   * untrusted, and a forged request controls the summary.
   */
  confirm: {
    // The first line is the record and the action, so they are what the person
    // reads first (review R1-M1); the explanation follows.
    /** @param {string} id @param {string} who */
    approval: (id, who) =>
      `ADR-${id} · approve as ${who}\n\nadrkit decision board: record an approval of ADR-${id} by ${who}?${CONFIRM_TAIL}`,
    /** @param {string} id @param {string} who @param {number} length */
    objection: (id, who, length) =>
      `ADR-${id} · object as ${who}\n\nadrkit decision board: record an objection on ADR-${id} by ${who}? Its summary (${length} characters) is shown on the board page, not here.${CONFIRM_TAIL}`,
    /** @param {string} id @param {string} who @param {number} n */
    resolution: (id, who, n) =>
      `ADR-${id} · resolve objection ${n} as ${who}\n\nadrkit decision board: mark objection ${n} on ADR-${id} as resolved by ${who}?${CONFIRM_TAIL}`,
  },
};

// The schema's Identity grammar (`adr.schema.ts`), and `isWritableIdentity`'s
// extra rule: no control or invisible format character, except ZWNJ and ZWJ
// inside the email form. A test compares this mirror with core's.
const IDENTITY = /^(@[A-Za-z0-9-]+|team:[a-z0-9-]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/;
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;
const JOINERS = /[\u200c\u200d]/gu;
const LINE_SEPARATORS = /[\u2028\u2029]/;

/**
 * Whether the board may write as `identity`: core's `isWritableIdentity`, plus
 * a length cap the page can display.
 *
 * @param {unknown} identity
 * @returns {identity is string}
 */
export function isWritableReviewer(identity) {
  if (typeof identity !== 'string' || identity.length > MAX_REVIEWER_LENGTH || !IDENTITY.test(identity)) return false;
  const email = !identity.startsWith('@') && !identity.startsWith('team:');
  return !INVISIBLE_OR_CONTROL.test(email ? identity.replace(JOINERS, '') : identity);
}

/**
 * Whether an objection summary would be refused: core's
 * `objectionSummaryProblem`, mirrored. A test compares the two.
 *
 * @param {unknown} summary
 */
export function summaryProblem(summary) {
  if (typeof summary !== 'string') return true;
  const trimmed = summary.trim();
  if (trimmed === '') return true;
  if (INVISIBLE_OR_CONTROL.test(summary) || LINE_SEPARATORS.test(summary)) return true;
  return [...trimmed].length > MAX_SUMMARY_LENGTH;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `0.17.0` is older than `0.18.0`; anything unparseable is unknown (`null`).
 *
 * @param {string} text
 * @returns {boolean | null}
 */
export function olderThanMinimum(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!match) return null;
  const have = match.slice(1, 4).map(Number);
  const want = MIN_CLI_VERSION.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (/** @type {number} */ (have[i]) !== /** @type {number} */ (want[i])) {
      return /** @type {number} */ (have[i]) < /** @type {number} */ (want[i]);
    }
  }
  return false;
}

/**
 * The text each refusal code answers with. A refusal carries only a code; the
 * reply's text is looked up here, never taken from an exception (the rule
 * since CodeQL's `js/stack-trace-exposure` finding on #267).
 */
const REFUSAL_TEXT = {
  ...REVIEW_REFUSALS,
  unset: REVIEW_NOTES.unset,
  invalid: REVIEW_NOTES.invalid,
  noConfirm: REVIEW_NOTES.noConfirm,
  oldCli: REVIEW_MESSAGES.oldCli,
};

/** A refusal the route answers with a fixed body chosen by its code. */
class Refusal extends Error {
  /**
   * @param {number} status
   * @param {keyof typeof REFUSAL_TEXT} code
   * @param {{ kind: string, id: string } | null} [pending] the validated pending request, for code `pending`
   */
  constructor(status, code, pending = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.pending = pending;
  }
}

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} CwdRunner
 * @typedef {{ enabled: boolean, reviewer: string | null, note: string | null, code: 'unset' | 'invalid' | 'noConfirm' | null }} ReviewState
 * @typedef {{ kind: (typeof REVIEW_KINDS)[number], id: string, nonce: string, expires: number }} Issued
 * @typedef {{
 *   kind: (typeof REVIEW_KINDS)[number], id: string, summary?: string, objection?: number,
 * }} WriteRequest
 * @typedef {{
 *   outcome: 'written' | 'unchanged' | 'refused' | 'usage-error' | 'old-cli' | 'unknown' | 'not-run' | 'not-confirmed',
 *   message: string,
 * }} WriteResult
 */

/**
 * Build the write path. `board.mjs` calls `handle` from its HTTP route only,
 * after checking the header token and an exact same-origin `Origin`.
 *
 * `canConfirm` and `confirm` are the host's elicitation (`session.ui.confirm`),
 * the one part of this path the model cannot drive: the model is given the
 * panel URL and token by the runtime's `open_canvas` result, so it can do
 * everything the page does over HTTP. Without them nothing is ever written.
 *
 * @param {{
 *   run: CwdRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   isRecordId: (id: string) => boolean,
 *   canConfirm?: () => boolean,
 *   confirm?: (message: string) => Promise<unknown>,
 *   agentMode?: () => Promise<unknown>,
 *   confirmTimeoutMs?: number,
 *   dialogLimits?: { spacingMs?: number, windowMs?: number, windowMax?: number },
 *   log?: (message: string) => unknown,
 *   clock?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   timeoutMs?: number,
 * }} deps
 */
export function createReviewWriter({
  run,
  env,
  exists,
  isRecordId,
  canConfirm = () => false,
  confirm = async () => false,
  agentMode = async () => null,
  confirmTimeoutMs = CONFIRM_TIMEOUT_MS,
  dialogLimits = {},
  log = () => undefined,
  clock = Date.now,
  randomBytes = nodeRandomBytes,
  timeoutMs = WRITE_TIMEOUT_MS,
}) {
  /** One live nonce per panel. @type {Map<string, Issued>} */
  const issued = new Map();
  /** CLIs already seen to be new enough, by command line and directory. @type {Set<string>} */
  const supported = new Set();
  let writing = false;
  /** The write that holds `writing`, validated, for the 409 message. @type {{ kind: string, id: string } | null} */
  let pendingWrite = null;
  /** When the board asked the host, across all panels, for the dialog limits. @type {number[]} */
  let dialogTimes = [];
  const spacingMs = dialogLimits.spacingMs ?? DIALOG_SPACING_MS;
  const windowMs = dialogLimits.windowMs ?? DIALOG_WINDOW_MS;
  const windowMax = dialogLimits.windowMax ?? DIALOG_WINDOW_MAX;

  /**
   * Whether any board panel may ask the host now: `null` if so, or the refusal code.
   * @returns {'tooSoon' | 'tooMany' | null}
   */
  const dialogRefusal = () => {
    const now = clock();
    const recent = dialogTimes.filter((at) => now - at < windowMs);
    dialogTimes = recent;
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < spacingMs) return 'tooSoon';
    if (recent.length >= windowMax) return 'tooMany';
    return null;
  };

  /** Whether the host offers elicitation; any throw is a no. */
  const hostCanConfirm = () => {
    try {
      return canConfirm() === true;
    } catch {
      return false;
    }
  };

  /**
   * Ask the person through the host, failing closed: only a literal `true`
   * within the time limit is a yes. A throw, a timeout, or any other answer is
   * a no, and nothing from the host's answer reaches the reply.
   *
   * @param {string} message
   */
  const confirmedByHost = async (message) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      const answer = await Promise.race([
        Promise.resolve().then(() => confirm(message)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), confirmTimeoutMs);
        }),
      ]);
      return answer === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * The session's agent mode as the board acts on it: `autopilot`, `unknown`
   * when reading it throws (refused, review R1-L1), or `ok`. A session with no
   * mode method at all answers `undefined`, which is `ok`: the host's
   * confirmation still guards.
   * @returns {Promise<'autopilot' | 'unknown' | 'ok'>}
   */
  const modeCheck = async () => {
    try {
      return (await agentMode()) === 'autopilot' ? 'autopilot' : 'ok';
    } catch {
      return 'unknown';
    }
  };

  /** The controls' state, read from the environment each time. @returns {ReviewState} */
  const state = () => {
    const reviewer = env['ADRKIT_REVIEWER'];
    if (reviewer === undefined || reviewer === '') return { enabled: false, reviewer: null, note: REVIEW_NOTES.unset, code: 'unset' };
    if (!isWritableReviewer(reviewer)) return { enabled: false, reviewer: null, note: REVIEW_NOTES.invalid, code: 'invalid' };
    if (!hostCanConfirm()) return { enabled: false, reviewer: null, note: REVIEW_NOTES.noConfirm, code: 'noConfirm' };
    return { enabled: true, reviewer, note: null, code: null };
  };

  /** Fire-and-forget: a log that hangs, rejects, or throws must not hold or break a write. @param {string} message */
  const note = (message) => {
    try {
      const pending = /** @type {any} */ (log(message));
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {
      // Nothing to report it through.
    }
  };

  /** @param {unknown} value */
  const checkKind = (value) => {
    if (typeof value !== 'string' || !(/** @type {readonly string[]} */ (REVIEW_KINDS).includes(value))) {
      throw new Refusal(400, 'kind');
    }
    return /** @type {(typeof REVIEW_KINDS)[number]} */ (value);
  };

  /** @param {unknown} value */
  const checkId = (value) => {
    if (typeof value !== 'string' || value.length > 64 || !isRecordId(value)) throw new Refusal(400, 'id');
    return value;
  };

  /**
   * The documented keys, and only those, for this kind.
   *
   * @param {Record<string, unknown>} body
   * @returns {WriteRequest}
   */
  const writeRequest = (body) => {
    const kind = checkKind(body['kind']);
    const allowed = ['kind', 'id', 'nonce', ...(kind === 'objection' ? ['summary'] : kind === 'resolution' ? ['objection'] : [])];
    for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new Refusal(400, 'shape');
    const id = checkId(body['id']);
    if (kind === 'objection') {
      const summary = body['summary'];
      if (summaryProblem(summary)) throw new Refusal(400, 'summary');
      return { kind, id, summary: /** @type {string} */ (summary).trim() };
    }
    if (kind === 'resolution') {
      const objection = body['objection'];
      if (typeof objection !== 'number' || !Number.isInteger(objection) || objection < 1 || objection > MAX_OBJECTION) {
        throw new Refusal(400, 'objection');
      }
      return { kind, id, objection };
    }
    return { kind, id };
  };

  /**
   * Whether this CLI is older than the review subcommands: `true`, `false`, or
   * `null` when it cannot say. A CLI seen new enough is not asked again at the
   * nonce, but an exit 2 always asks afresh: the CLI on `PATH` can change.
   *
   * @param {{ command: string, args: string[] }} cli
   * @param {string} cwd
   * @param {{ fresh?: boolean }} [options]
   */
  const tooOld = async (cli, cwd, { fresh = false } = {}) => {
    const key = [cli.command, ...cli.args, cwd].join('\0');
    if (!fresh && supported.has(key)) return false;
    supported.delete(key);
    /** @type {boolean | null} */
    let older = null;
    try {
      const result = await run(cli.command, [...cli.args, '--version'], { cwd, signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
      if (result.exitCode === 0) older = olderThanMinimum(result.stdout);
    } catch {
      older = null;
    }
    if (older === false) supported.add(key);
    return older;
  };

  /** @param {string} cwd */
  const cliFor = (cwd) => {
    try {
      return resolveCli({ env, cwd, exists });
    } catch {
      return null;
    }
  };

  /**
   * Spend a panel's nonce. It is gone after this call whatever the outcome, so
   * a refused or failed attempt cannot be replayed either.
   *
   * @param {string} instanceId
   * @param {Record<string, unknown>} body
   */
  const spend = (instanceId, body) => {
    const entry = issued.get(instanceId);
    issued.delete(instanceId);
    if (!entry) return false;
    if (!tokenMatches(entry.nonce, body['nonce'])) return false;
    if (clock() >= entry.expires) return false;
    return entry.kind === body['kind'] && entry.id === body['id'];
  };

  /**
   * Run one write and map its exit to a fixed result. Nothing here throws.
   *
   * @param {WriteRequest} request
   * @param {string} reviewer
   * @param {string} cwd
   * @param {string | undefined} dir
   * @returns {Promise<WriteResult>}
   */
  const perform = async (request, reviewer, cwd, dir) => {
    const cli = cliFor(cwd);
    if (!cli) return { outcome: 'not-run', message: REVIEW_MESSAGES.start };
    const args = [
      ...cli.args,
      SUBCOMMANDS[request.kind],
      request.id,
      // One element, so an email identity that starts with `-` stays a value.
      `--by=${reviewer}`,
      '--json',
      ...(dir ? ['--dir', dir] : []),
      // One argv element, so a summary that starts with `-` is still a value.
      ...(request.kind === 'objection' ? [`--summary=${request.summary}`] : []),
      ...(request.kind === 'resolution' ? ['--objection', String(request.objection)] : []),
    ];
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const TIMED_OUT = Symbol('timed out');
    /** @type {CommandResult} */
    let result;
    try {
      const running = run(cli.command, args, { cwd, signal: controller.signal });
      const expired = new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      });
      const settled = await Promise.race([running, expired]);
      if (settled === TIMED_OUT) {
        controller.abort();
        running.catch(() => {});
        return { outcome: 'unknown', message: REVIEW_MESSAGES.timeout };
      }
      result = /** @type {CommandResult} */ (settled);
    } catch {
      // The exception's text is never used: a fixed message by outcome only.
      return { outcome: 'not-run', message: REVIEW_MESSAGES.start };
    } finally {
      clearTimeout(timer);
    }

    if (result.exitCode === 0) {
      /** @type {unknown} */
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        parsed = null;
      }
      if (!isRecord(parsed) || typeof parsed['changed'] !== 'boolean') return { outcome: 'unknown', message: REVIEW_MESSAGES.unreadable };
      return parsed['changed']
        ? { outcome: 'written', message: REVIEW_MESSAGES.written[request.kind](request.id, reviewer) }
        : { outcome: 'unchanged', message: REVIEW_MESSAGES.unchanged[request.kind](request.id, reviewer) };
    }
    if (result.exitCode === 1) return { outcome: 'refused', message: REVIEW_MESSAGES.refused };
    if (result.exitCode === 2) {
      // An older CLI exits 2 on an unknown subcommand, exactly as this one does
      // on a usage error, so ask it which it is.
      return (await tooOld(cli, cwd, { fresh: true })) === true
        ? { outcome: 'old-cli', message: REVIEW_MESSAGES.oldCli }
        : { outcome: 'usage-error', message: REVIEW_MESSAGES.usage };
    }
    return { outcome: 'unknown', message: REVIEW_MESSAGES.exit(result.exitCode) };
  };

  /**
   * The dialog text for one validated request.
   *
   * @param {WriteRequest} request
   * @param {string} who
   */
  const confirmText = (request, who) => {
    if (request.kind === 'objection') return REVIEW_MESSAGES.confirm.objection(request.id, who, [...(request.summary ?? '')].length);
    if (request.kind === 'resolution') return REVIEW_MESSAGES.confirm.resolution(request.id, who, /** @type {number} */ (request.objection));
    return REVIEW_MESSAGES.confirm.approval(request.id, who);
  };

  /**
   * Read and parse a POST body. Returns `undefined` once it has answered.
   *
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @returns {Promise<Record<string, unknown> | undefined>}
   */
  const bodyOf = async (req, res) => {
    /** @type {string} */
    let raw;
    try {
      raw = await readBody(req, BODY_LIMIT);
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        res.on('finish', () => req.destroy());
        reply(res, 413, 'Payload too large', 'text/plain; charset=utf-8', { Connection: 'close' });
        return undefined;
      }
      throw error;
    }
    /** @type {unknown} */
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (!isRecord(body)) {
      replyJson(res, 400, { error: REVIEW_REFUSALS.shape });
      return undefined;
    }
    return body;
  };

  /**
   * The two POST routes: `/api/review/nonce` arms a control, `/api/review`
   * spends the nonce and runs the write. The caller has already checked the
   * URL token, the header token, and the `Origin`.
   *
   * @param {{
   *   instanceId: string, cwd: string, path: string, req: IncomingMessage, res: ServerResponse,
   *   dir: () => string | undefined, escapes: (cwd: string, dir: string | undefined) => boolean,
   *   afterWrite: () => Promise<unknown>,
   * }} route
   */
  const handle = async ({ instanceId, cwd, path, req, res, dir, escapes, afterWrite }) => {
    const body = await bodyOf(req, res);
    if (!body) return;
    try {
      if (path === '/api/review/nonce') {
        const current = state();
        if (!current.enabled) throw new Refusal(403, current.code ?? 'unset');
        for (const key of Object.keys(body)) if (key !== 'kind' && key !== 'id') throw new Refusal(400, 'shape');
        const kind = checkKind(body['kind']);
        const id = checkId(body['id']);
        const cli = cliFor(cwd);
        if (cli && (await tooOld(cli, cwd)) === true) throw new Refusal(409, 'oldCli');
        const nonce = randomBytes(32).toString('hex');
        issued.set(instanceId, { kind, id, nonce, expires: clock() + NONCE_TTL_MS });
        return replyJson(res, 200, { nonce, expiresInMs: NONCE_TTL_MS });
      }

      // POST /api/review. The nonce is spent first, so even a refused attempt uses it up.
      if (!spend(instanceId, body)) throw new Refusal(403, 'nonce');
      const current = state();
      if (!current.enabled) throw new Refusal(403, current.code ?? 'unset');
      const request = writeRequest(body);
      if (writing) throw new Refusal(409, 'pending', pendingWrite);
      const corpus = dir() ?? env['ADRKIT_DIR'];
      // The shown directory was confined when it was chosen; check it again
      // right before the spawn, as every graph and queue read does.
      if (escapes(cwd, dir())) return replyJson(res, 200, { outcome: 'not-run', message: REVIEW_MESSAGES.dirEscape });
      const who = /** @type {string} */ (current.reviewer);
      const limited = dialogRefusal();
      if (limited) {
        note(`adrkit: decision board review ${request.kind} on ADR-${request.id} as ${who}: rate-limited`);
        throw new Refusal(429, limited);
      }
      writing = true;
      pendingWrite = { kind: request.kind, id: request.id };
      /** @type {WriteResult} */
      let result;
      try {
        // The boundary (ADR-0052): the person confirms through the host, which
        // the model cannot answer. The page's two clicks and the nonce are
        // defence in depth only, because the model holds the panel's token.
        const mode = await modeCheck();
        if (mode !== 'ok') {
          result = { outcome: 'not-confirmed', message: mode === 'autopilot' ? REVIEW_MESSAGES.autopilot : REVIEW_MESSAGES.modeUnknown };
        } else {
          dialogTimes.push(clock());
          result = (await confirmedByHost(confirmText(request, who)))
            ? await perform(request, who, cwd, corpus)
            : { outcome: 'not-confirmed', message: REVIEW_MESSAGES.notConfirmed };
        }
      } finally {
        writing = false;
        pendingWrite = null;
      }
      note(`adrkit: decision board review ${request.kind} on ADR-${request.id} as ${who}: ${result.outcome}`);
      if (result.outcome === 'not-confirmed') return replyJson(res, 200, { ...result, state: null });
      /** @type {unknown} */
      let snapshot = null;
      try {
        snapshot = await afterWrite();
      } catch {
        snapshot = null;
      }
      return replyJson(res, 200, { ...result, state: snapshot });
    } catch (error) {
      // The text is looked up by the refusal's code, never read from the
      // error; a pending write is named from its own validated kind and id.
      if (error instanceof Refusal) {
        if (error.code === 'pending' && error.pending) {
          const { kind, id } = error.pending;
          return replyJson(res, error.status, { error: REVIEW_MESSAGES.pending(kind, id), pending: { kind, id } });
        }
        return replyJson(res, error.status, { error: REFUSAL_TEXT[error.code] });
      }
      throw error;
    }
  };

  return {
    state,
    handle,
    /** A closed panel's nonce is dropped; the dialog budget is not reset. @param {string} instanceId */
    forget: (instanceId) => void issued.delete(instanceId),
  };
}
