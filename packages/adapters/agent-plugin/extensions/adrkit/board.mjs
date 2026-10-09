// @ts-check
/**
 * The read-only `decision-board` canvas for the GitHub Copilot app (ADR-0050),
 * kept free of the Copilot SDK.
 *
 * Where `decision-review` is scoped to one session's change, the board shows
 * the whole corpus: how the decisions relate (`adr graph --format json`) and
 * what is waiting for review (`adr queue --format json`). It renders what the
 * CLI computed and derives nothing of its own:
 *
 * - A focus or a kind filter re-runs `adr graph --focus <id> --kind <kind>`,
 *   so the board and `adr graph` cannot disagree about a neighborhood.
 * - It shows a queue row's raw review facts and never a verdict on them. No
 *   field check can say a record would pass ratification: review state alone
 *   misses refusals such as an empty `deciders` (ADR-0044), so a "ready" label
 *   would be a claim the board cannot back.
 * - It writes nothing, starts no workflow, sends no prompt, and spends no
 *   credits. There is no approve, object, or ratify control, and the row
 *   allowlists keep any such field the CLI's JSON might gain off the page.
 *
 * Every process, server, and clock is passed in, so this runs under Bun's test
 * runner as well as in the Node process the host forks. Nothing runs at import:
 * the server starts inside `open()`, as `decision-review`'s does, because the
 * app starts one extension process per restored session. The HTTP hardening is
 * shared with `decision-review` through `panel-http.mjs`.
 *
 * Failures reach the page and the agent as fixed notes chosen by explicit
 * checks, never as CLI stderr or exception text.
 */

import { Buffer } from 'node:buffer';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { createServer as nodeCreateServer } from 'node:http';
import { isAbsolute, resolve, sep } from 'node:path';
import { BOARD_CSS, BOARD_JS, renderBoardPage } from './board-page.mjs';
import { NODE_LIMIT, layoutBoard } from './board-layout.mjs';
import { computeQueue, shownQueueItem } from './canvas.mjs';
import { BODY_LIMIT, BodyTooLarge, SECURITY_HEADERS, postAllowed, readBody, reply, replyJson, tokenMatches } from './panel-http.mjs';
import { resolveCli } from './review.mjs';
import { staysInside } from './tools.mjs';

export const BOARD_ID = 'decision-board';
export const BOARD_TITLE = 'Decision board';

/** The relationship kinds `adr graph --kind` accepts, in its own order. */
export const EDGE_KINDS = /** @type {const} */ (['supersedes', 'relatesTo', 'conflictsWith']);
/** A record's own id grammar (`adr.schema.ts`): 4+ digits or a ULID, no namespace. */
export const RECORD_ID = /^(?:[0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/;
/** The most relationships the board draws; the count of the rest is kept. */
export const EDGE_LIMIT = 1000;
/** The most serialized bytes one board snapshot may carry, by `Buffer.byteLength`. */
export const BOARD_BYTES_LIMIT = 512 * 1024;
/** How long `adr graph` may take before the board shows a note instead. */
export const GRAPH_TIMEOUT_MS = 30_000;
/** Display caps for repository text: a title, an id, a status. */
const TITLE_LIMIT = 200;
const ID_LIMIT = 64;
const STATUS_LIMIT = 32;
const DIR_LIMIT = 1024;

/**
 * Fixed notes. Never the CLI's stderr or an exception's text: these reach the
 * page and the agent, and a fixed message selected by an explicit check is the
 * rule since CodeQL's stack-trace finding on the first canvas.
 */
export const BOARD_NOTES = {
  start: 'The decision graph is unavailable: the adr CLI could not be started.',
  unreadable: 'The decision graph is unavailable: adr graph did not return a readable graph.',
  tooLarge: 'The decision graph is unavailable: the adr graph output was too large to read.',
  timeout: 'The decision graph is unavailable: adr graph did not finish in time.',
  refused:
    'The decision graph is unavailable: adr graph refused the request (exit 2). The focus record may not exist in this ' +
    'corpus, or the corpus directory may be unreachable.',
  /** @param {number} code */
  exit: (code) => `The decision graph is unavailable: adr graph exited ${code}.`,
  corpusErrors: 'adr graph reported corpus errors (exit 1); records that failed validation are not drawn. adr lint shows them.',
  overNodes: `This graph has more records than the board draws (${NODE_LIMIT}). Counts by status are shown instead; focus on a record to see its neighborhood.`,
  overExtent:
    'This graph would be too wide or tall to draw (a very long supersession chain, or a supersession cycle in a malformed ' +
    'corpus). Counts by status are shown instead; focus on a record, or filter by kind, to see part of it.',
  /** @param {number} n */
  longIds: (n) => `${n} record(s) with an id longer than 64 characters are not drawn, and neither are their relationships.`,
  /** @param {number} shown @param {number} total */
  edges: (shown, total) => `Showing the first ${shown} of ${total} relationships.`,
  overBytes: 'The decision graph was too large to send to the page; counts by status are shown instead. Focus on a record to see its neighborhood.',
  queueOverBytes: 'The open-proposal rows were dropped to keep the board within its size budget.',
};

/** Fixed refusals for invalid input, chosen by which check failed. */
export const INPUT_ERRORS = {
  shape: 'Input must be an object (or null) with only the documented keys.',
  id: 'id must be a record id: four or more digits, or a 26-character ULID.',
  kinds: 'kinds must be an array of distinct values from supersedes, relatesTo, conflictsWith.',
  dir: "dir must be a relative or absolute path of at most 1024 characters, not starting with '-', with no control characters.",
  dirEscape: 'dir must resolve inside the session repository, also after following symbolic links. Nothing was run.',
};

/**
 * @import { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http'
 * @import { CommandResult } from './review.mjs'
 * @import { QueueView } from './canvas.mjs'
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} CwdRunner
 * @typedef {{ id: string | null, kinds: string[] }} Filter
 * @typedef {{ id: string, title: string, status: string, x: number, y: number }} BoardNode
 * @typedef {{ from: string, to: string, kind: string }} BoardEdge
 * @typedef {{
 *   available: boolean, exitCode: number | null, mode: 'graph' | 'summary' | null,
 *   totalNodes: number, totalEdges: number, nodes: BoardNode[], edges: BoardEdge[],
 *   width: number, height: number, byStatus: Array<{ status: string, count: number }>, notes: string[],
 *   filter: Filter,
 * }} GraphView
 * @typedef {{
 *   workingDirectory: string, filter: Filter, graph: GraphView | null, queue: QueueView | null,
 *   notes: string[], updatedAt: string,
 * }} BoardSnapshot
 * @typedef {{
 *   dir: string | undefined, filter: Filter, graph: GraphView | null, graphSeq: number, updatedAt: string,
 * }} View One panel's own state: its corpus directory, the filter last asked
 *   for, and the graph last applied, which carries the filter it was read with.
 * @typedef {{ queue: QueueView | null, seq: number, pending: Promise<void> | null }} SharedQueue
 *   The queue, shared by every panel on one working directory and corpus directory.
 * @typedef {{
 *   instanceId: string, cwd: string, token: string, origin: string, url: string,
 *   server: Server, clients: Set<ServerResponse>,
 * }} Instance
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} text @param {number} limit */
const clipTo = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/** @param {unknown} value */
const intOr = (value, fallback = 0) => (Number.isInteger(value) ? /** @type {number} */ (value) : fallback);

/** A refusal carrying a code the handlers compare, and a fixed message. */
class InputError extends Error {
  /** @param {keyof typeof INPUT_ERRORS} kind */
  constructor(kind) {
    super(INPUT_ERRORS[kind]);
    this.kind = kind;
  }
}

/** @param {unknown} value @returns {string | undefined} */
function checkDir(value) {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > DIR_LIMIT ||
    value.startsWith('-') ||
    // Control characters, written as escapes so this file stays printable.
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new InputError('dir');
  }
  return value;
}

/** @param {unknown} value @returns {string | null} */
function checkId(value) {
  if (value === undefined || value === null) return null;
  // Refused rather than clipped: a clipped id would name a record that does not exist.
  if (typeof value !== 'string' || value.length > ID_LIMIT || !RECORD_ID.test(value)) throw new InputError('id');
  return value;
}

/** @param {unknown} value @returns {string[]} */
function checkKinds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > EDGE_KINDS.length) throw new InputError('kinds');
  const seen = new Set();
  for (const kind of value) {
    if (typeof kind !== 'string' || !(/** @type {readonly string[]} */ (EDGE_KINDS).includes(kind)) || seen.has(kind)) {
      throw new InputError('kinds');
    }
    seen.add(kind);
  }
  // `adr graph`'s own order, so the same filter always produces the same argv.
  return EDGE_KINDS.filter((kind) => seen.has(kind));
}

/**
 * Validate a board input before anything is spawned. Unknown keys are refused,
 * so a misspelled key fails loudly instead of being ignored, and nothing here
 * can choose the executable. Throws an `InputError` with a fixed message.
 *
 * @param {unknown} raw
 * @param {readonly string[]} allowed the keys this entry point takes
 * @returns {{ dir?: string, id?: string | null, kinds?: string[] }}
 */
export function validateBoardInput(raw, allowed) {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) throw new InputError('shape');
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new InputError('shape');
  /** @type {{ dir?: string, id?: string | null, kinds?: string[] }} */
  const out = {};
  if ('dir' in raw) out.dir = checkDir(raw['dir']);
  if ('id' in raw) out.id = checkId(raw['id']);
  if ('kinds' in raw) out.kinds = checkKinds(raw['kinds']);
  return out;
}

/**
 * The argv for one graph read. Exported so the tests can assert it whole.
 *
 * @param {{ dir?: string, filter: Filter }} options
 */
export function graphArgs({ dir, filter }) {
  return [
    'graph',
    '--format',
    'json',
    ...(dir ? ['--dir', dir] : []),
    ...(filter.id ? ['--focus', filter.id] : []),
    ...filter.kinds.flatMap((kind) => ['--kind', kind]),
  ];
}

/**
 * Keep a queue row's fields by allowlist: the nine `decision-review` keeps
 * (ADR-0047), plus the resolved objection count and how many findings the row
 * carries. The findings themselves are not kept; `adr lint` and `adr queue`
 * show them. Any field the JSON gains later, a ratifying command among them,
 * is dropped without anyone having to name it.
 *
 * @param {Record<string, unknown>} item
 */
export function boardQueueItem(item) {
  return {
    ...shownQueueItem(item),
    resolvedObjectionCount: intOr(item['resolvedObjectionCount']),
    itemFindingCount: Array.isArray(item['itemFindings']) ? item['itemFindings'].length : 0,
  };
}

/** @param {string[]} notes @returns {Omit<GraphView, 'filter'>} */
const unavailableGraph = (notes, exitCode = /** @type {number | null} */ (null)) => ({
  available: false,
  exitCode,
  mode: null,
  totalNodes: 0,
  totalEdges: 0,
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
  byStatus: [],
  notes,
});

/**
 * The relationship graph from `adr graph --format json`, filtered by the CLI
 * itself, kept by allowlist, bounded, and laid out. Read-only and free: one CLI
 * call, no model. Exit 0 and 1 both carry a graph (1 means another record is
 * invalid); anything else is a fixed note. Nothing here throws.
 *
 * @param {{
 *   cwd: string, dir?: string, filter: Filter, run: CwdRunner, env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean, timeoutMs?: number, signal?: AbortSignal,
 * }} deps
 * @returns {Promise<GraphView>}
 */
export async function computeGraph(deps) {
  const graph = await readGraph(deps);
  // The filter this read used, so a snapshot can never pair one filter with
  // another filter's graph (review M1).
  return { ...graph, filter: { id: deps.filter.id, kinds: [...deps.filter.kinds] } };
}

/**
 * @param {{
 *   cwd: string, dir?: string, filter: Filter, run: CwdRunner, env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean, timeoutMs?: number, signal?: AbortSignal,
 * }} deps
 * @returns {Promise<Omit<GraphView, 'filter'>>}
 */
async function readGraph({ cwd, dir, filter, run, env, exists, timeoutMs = GRAPH_TIMEOUT_MS, signal }) {
  const corpus = dir ?? env['ADRKIT_DIR'];
  /** @type {CommandResult} */
  let result;
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const TIMED_OUT = Symbol('timed out');
  try {
    const cli = resolveCli({ env, cwd, exists });
    const running = run(cli.command, [...cli.args, ...graphArgs({ dir: corpus, filter })], {
      cwd,
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    const settled = await Promise.race([running, expired]);
    if (settled === TIMED_OUT) {
      controller.abort();
      // The abandoned run rejects once signalled; nothing is waiting for it.
      running.catch(() => {});
      return unavailableGraph([BOARD_NOTES.timeout]);
    }
    result = /** @type {CommandResult} */ (settled);
  } catch (error) {
    // Selected by explicit code comparisons; the error's own text is never used.
    if (isRecord(error) && error['code'] === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return unavailableGraph([BOARD_NOTES.tooLarge]);
    if (signal?.aborted) return unavailableGraph([BOARD_NOTES.timeout]);
    return unavailableGraph([BOARD_NOTES.start]);
  } finally {
    clearTimeout(timer);
  }
  if (result.exitCode === 2) return unavailableGraph([BOARD_NOTES.refused], 2);
  if (result.exitCode !== 0 && result.exitCode !== 1) return unavailableGraph([BOARD_NOTES.exit(result.exitCode)], result.exitCode);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return unavailableGraph([BOARD_NOTES.unreadable], result.exitCode);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['nodes']) || !Array.isArray(parsed['edges'])) {
    return unavailableGraph([BOARD_NOTES.unreadable], result.exitCode);
  }

  /** @type {string[]} */
  const notes = result.exitCode === 1 ? [BOARD_NOTES.corpusErrors] : [];
  // The allowlist: id, title, and status on a node; from, to, and kind on an
  // edge. Anything else the JSON carries never reaches the page.
  const seen = new Set();
  const named = parsed['nodes'].filter(isRecord).filter((node) => typeof node['id'] === 'string' && node['id'].length > 0);
  // An id is never clipped: a clipped id names no record, so its edges and its
  // focus would silently fail. A longer one is left out and counted instead.
  const longIds = named.filter((node) => /** @type {string} */ (node['id']).length > ID_LIMIT).length;
  if (longIds > 0) notes.push(BOARD_NOTES.longIds(longIds));
  const nodes = named
    .filter((node) => /** @type {string} */ (node['id']).length <= ID_LIMIT)
    .map((node) => ({
      id: /** @type {string} */ (node['id']),
      title: typeof node['title'] === 'string' ? clipTo(node['title'], TITLE_LIMIT) : '',
      status: typeof node['status'] === 'string' ? clipTo(node['status'], STATUS_LIMIT) : 'unknown',
    }))
    .filter((node) => (seen.has(node.id) ? false : (seen.add(node.id), true)));
  const allEdges = parsed['edges']
    .filter(isRecord)
    .filter(
      (edge) =>
        typeof edge['from'] === 'string' &&
        typeof edge['to'] === 'string' &&
        /** @type {readonly unknown[]} */ (EDGE_KINDS).includes(edge['kind']) &&
        seen.has(edge['from']) &&
        seen.has(edge['to']),
    )
    .map((edge) => ({ from: String(edge['from']), to: String(edge['to']), kind: String(edge['kind']) }));

  const layout = layoutBoard({ nodes, edges: allEdges });
  if (layout.mode === 'summary') {
    return {
      ...unavailableGraph([...notes, layout.reason === 'extent' ? BOARD_NOTES.overExtent : BOARD_NOTES.overNodes], result.exitCode),
      available: true,
      mode: 'summary',
      totalNodes: layout.totalNodes,
      totalEdges: layout.totalEdges,
      byStatus: layout.byStatus,
    };
  }
  const edges = allEdges.slice(0, EDGE_LIMIT);
  if (allEdges.length > edges.length) notes.push(BOARD_NOTES.edges(edges.length, allEdges.length));
  const at = new Map(layout.positions.map((position) => [position.id, position]));
  return {
    available: true,
    exitCode: result.exitCode,
    mode: 'graph',
    totalNodes: nodes.length,
    totalEdges: allEdges.length,
    nodes: nodes.map((node) => {
      const position = /** @type {{ x: number, y: number }} */ (at.get(node.id));
      return { ...node, x: position.x, y: position.y };
    }),
    edges,
    width: layout.width,
    height: layout.height,
    byStatus: [],
    notes,
  };
}

/** Counts by status for a graph that is drawn as a summary instead. @param {GraphView} graph @returns {GraphView} */
function summarized(graph) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const node of graph.nodes) counts.set(node.status, (counts.get(node.status) ?? 0) + 1);
  return {
    ...graph,
    mode: 'summary',
    nodes: [],
    edges: [],
    width: 0,
    height: 0,
    byStatus: [...counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([status, count]) => ({ status, count })),
    notes: [...graph.notes, BOARD_NOTES.overBytes],
  };
}

/**
 * The snapshot a page or the agent receives, held to `limit` serialized bytes.
 * Per-string caps and the count budgets keep it far below that by
 * construction; this is the backstop, and every route, action, and broadcast
 * goes through it. The graph goes to a summary first, then the queue rows go.
 * `filter` is the one the shown graph was read with, never a pending request.
 *
 * @param {string} cwd
 * @param {View} view
 * @param {QueueView | null} queue
 * @param {number} limit
 * @returns {BoardSnapshot}
 */
function snapshotOf(cwd, view, queue, limit) {
  const filter = view.graph?.filter ?? { id: null, kinds: [] };
  /** @type {BoardSnapshot} */
  let snapshot = {
    workingDirectory: cwd,
    filter: { id: filter.id, kinds: [...filter.kinds] },
    graph: view.graph,
    queue,
    notes: [],
    updatedAt: view.updatedAt,
  };
  const size = () => Buffer.byteLength(JSON.stringify(snapshot));
  if (size() > limit && snapshot.graph?.mode === 'graph') snapshot = { ...snapshot, graph: summarized(snapshot.graph) };
  if (size() > limit && snapshot.queue) {
    snapshot = { ...snapshot, queue: { ...snapshot.queue, items: [], note: BOARD_NOTES.queueOverBytes } };
  }
  return snapshot;
}

/** @param {number} n @param {string} noun */
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** @param {BoardSnapshot} snapshot */
function statusLine(snapshot) {
  const graph = snapshot.graph;
  const parts = [];
  if (!graph || !graph.available) parts.push('graph unavailable');
  else parts.push(`${count(graph.totalNodes, 'record')} · ${count(graph.totalEdges, 'relationship')}`);
  if (snapshot.filter.id) parts.push(`focus ${snapshot.filter.id}`);
  if (snapshot.queue?.available) parts.push(`${snapshot.queue.totalItems} open`);
  return parts.join(' · ');
}

/**
 * `null` is accepted everywhere input is optional: the app's agent was
 * measured sending `input: null` to open_canvas.
 */
const OPEN_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    dir: { type: 'string', description: 'ADR corpus directory; default $ADRKIT_DIR or docs/adr.' },
    id: {
      type: ['string', 'null'],
      // The runtime checks this before the handler runs; the extension's own check stays the authority.
      pattern: RECORD_ID.source,
      maxLength: ID_LIMIT,
      description: 'Focus record id (adr graph --focus): four or more digits, or a ULID; omit or null for the whole corpus.',
    },
    kinds: {
      type: ['array', 'null'],
      items: { type: 'string', enum: [...EDGE_KINDS] },
      description: 'Relationship kinds to keep (adr graph --kind); omit or empty for all.',
    },
  },
};
const REFRESH_SCHEMA = { type: ['object', 'null'], properties: { dir: OPEN_SCHEMA.properties.dir } };
const FOCUS_SCHEMA = { type: ['object', 'null'], properties: { id: OPEN_SCHEMA.properties.id, kinds: OPEN_SCHEMA.properties.kinds } };

/**
 * Build the board's options for the SDK's `createCanvas`. `extension.mjs`
 * supplies the real dependencies; the tests supply fakes.
 *
 * @param {{
 *   run: CwdRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   makeError?: (code: string, message: string) => Error,
 *   createServer?: (handler: RequestListener) => Server,
 *   randomBytes?: (size: number) => Buffer,
 *   now?: () => string,
 *   timeoutMs?: number,
 *   bytesLimit?: number,
 * }} deps
 */
export function createDecisionBoardCanvas({
  run,
  env,
  exists,
  makeError = (code, message) => Object.assign(new Error(message), { code }),
  createServer = nodeCreateServer,
  randomBytes = nodeRandomBytes,
  now = () => new Date().toISOString(),
  timeoutMs = GRAPH_TIMEOUT_MS,
  bytesLimit = BOARD_BYTES_LIMIT,
}) {
  /** Panels by `instanceId`; a promise, so two concurrent opens share one server. @type {Map<string, Promise<Instance>>} */
  const instances = new Map();
  /** Started panels, for broadcasting. @type {Set<Instance>} */
  const live = new Set();
  /**
   * Each panel's own filter and graph, by `instanceId` (review M2): a focus in
   * one board must not move another board on the same repository. In memory only.
   * @type {Map<string, View>}
   */
  const views = new Map();
  /** The queue, shared by working directory and corpus directory. @type {Map<string, SharedQueue>} */
  const queues = new Map();

  /** @returns {View} */
  const newView = () => ({ dir: undefined, filter: { id: null, kinds: [] }, graph: null, graphSeq: 0, updatedAt: now() });

  /** Get or create a panel's view. Only `open` stores one. @param {string} instanceId */
  const viewFor = (instanceId) => {
    let view = views.get(instanceId);
    if (!view) {
      view = newView();
      views.set(instanceId, view);
    }
    return view;
  };

  /**
   * The view an action or route works on. A panel that is open (or opening)
   * has a stored one. An action with no open panel gets a view for this call
   * only, so nothing is held once it returns (review R1-L1).
   *
   * @param {string} instanceId
   */
  const viewOf = (instanceId) => views.get(instanceId) ?? (instances.has(instanceId) ? viewFor(instanceId) : newView());

  /** @param {string} cwd @param {string | undefined} dir */
  const queueKey = (cwd, dir) => `${cwd}\0${dir ?? ''}`;

  /** @param {string} cwd @param {string | undefined} dir */
  const sharedQueueFor = (cwd, dir) => {
    const key = queueKey(cwd, dir);
    let shared = queues.get(key);
    if (!shared) {
      shared = { queue: null, seq: 0, pending: null };
      queues.set(key, shared);
    }
    return shared;
  };

  /** Never creates a view. @param {string} cwd @param {View} view */
  const snapshotFor = (cwd, view) => {
    return snapshotOf(cwd, view, queues.get(queueKey(cwd, view.dir))?.queue ?? null, bytesLimit);
  };

  /**
   * @param {unknown} input
   * @param {readonly string[]} allowed
   */
  const validated = (input, allowed) => {
    try {
      return validateBoardInput(input, allowed);
    } catch (error) {
      // The message is one of INPUT_ERRORS, picked by the failing check.
      if (error instanceof InputError) throw makeError('invalid_input', INPUT_ERRORS[/** @type {keyof typeof INPUT_ERRORS} */ (error.kind)]);
      throw makeError('invalid_input', INPUT_ERRORS.shape);
    }
  };

  /**
   * A model-chosen corpus directory must stay inside the session repository,
   * lexically and after symbolic links are followed, the same rule the
   * read-only tools apply (ADR-0048, review L8): its titles come back in the
   * action result.
   * `ADRKIT_DIR` from the environment is the user's own choice and is trusted.
   *
   * @param {string} cwd
   * @param {string | undefined} dir
   */
  const confined = (cwd, dir) => {
    if (dir === undefined) return;
    const root = resolve(cwd);
    const target = resolve(cwd, dir);
    const inside = target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
    if (!inside || !staysInside(cwd, dir)) throw makeError('invalid_input', INPUT_ERRORS.dirEscape);
  };

  /** @param {any} ctx */
  const workingDirectoryOf = (ctx) => {
    // The documented source, as for decision-review: the app runtime's own cwd is `/`.
    const dir = ctx?.session?.workingDirectory;
    if (typeof dir !== 'string' || dir.length === 0 || !isAbsolute(dir)) {
      throw makeError('workspace_unavailable', 'The session has no working directory, so there is no corpus to show.');
    }
    return dir;
  };

  /** @param {any} ctx */
  const cwdFor = async (ctx) => {
    const pending = instances.get(ctx?.instanceId);
    if (pending) return (await pending).cwd;
    return workingDirectoryOf(ctx);
  };

  /** @param {Instance} instance */
  const push = (instance) => {
    const view = views.get(instance.instanceId);
    if (!view?.graph) return;
    const message = `event: state\ndata: ${JSON.stringify(snapshotFor(instance.cwd, view))}\n\n`;
    for (const client of instance.clients) client.write(message);
  };

  /** A panel's own graph changed: tell that panel only. @param {string} instanceId */
  const broadcastView = (instanceId) => {
    for (const instance of live) if (instance.instanceId === instanceId) push(instance);
  };

  /** A shared queue changed: tell every panel reading it. @param {string} cwd @param {string | undefined} dir */
  const broadcastQueue = (cwd, dir) => {
    for (const instance of live) {
      if (instance.cwd === cwd && views.get(instance.instanceId)?.dir === dir) push(instance);
    }
  };

  /**
   * Re-read one panel's graph with the filter it last asked for. Only the
   * newest read is applied; an older one that lands later is dropped. The
   * first read still fills an empty panel. Resolves to whether this read was
   * applied.
   *
   * @param {string} cwd
   * @param {string} instanceId
   * @param {View} view
   */
  const refreshGraph = async (cwd, instanceId, view) => {
    const seq = ++view.graphSeq;
    const graph = await computeGraph({ cwd, dir: view.dir, filter: view.filter, run, env, exists, timeoutMs });
    if (seq !== view.graphSeq && view.graph !== null) return false;
    view.graph = graph;
    view.updatedAt = now();
    broadcastView(instanceId);
    return true;
  };

  /** Re-read the shared queue. A newer read wins. @param {string} cwd @param {string | undefined} dir */
  const refreshQueue = (cwd, dir) => {
    const shared = sharedQueueFor(cwd, dir);
    const seq = ++shared.seq;
    const done = computeQueue({
      cwd,
      input: dir === undefined ? {} : { dir },
      run,
      env,
      exists,
      timeoutMs,
      shownItem: boardQueueItem,
    })
      .then((queue) => {
        if (seq === shared.seq || shared.queue === null) {
          shared.queue = queue;
          broadcastQueue(cwd, dir);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (shared.pending === done) shared.pending = null;
      });
    shared.pending = done;
    return done;
  };

  /**
   * Re-read both. The graph is awaited; the queue is awaited only when asked,
   * so opening a panel or serving the page never waits on a slow queue.
   *
   * @param {string} cwd
   * @param {string} instanceId
   * @param {View} view
   * @param {{ waitForQueue?: boolean }} [opts]
   */
  const refresh = async (cwd, instanceId, view, { waitForQueue = true } = {}) => {
    const queueDone = refreshQueue(cwd, view.dir);
    await refreshGraph(cwd, instanceId, view);
    if (waitForQueue) await queueDone;
    return snapshotFor(cwd, view);
  };

  /** @param {string} cwd @param {string} instanceId @param {View} view */
  const stateFor = async (cwd, instanceId, view, { waitForQueue = true } = {}) => {
    const shared = sharedQueueFor(cwd, view.dir);
    if (!view.graph) await refresh(cwd, instanceId, view, { waitForQueue });
    else if (!shared.queue && !shared.pending) {
      // A panel whose corpus directory has no queue read yet starts one.
      const done = refreshQueue(cwd, view.dir);
      if (waitForQueue) await done;
    }
    else if (waitForQueue && shared.pending) await shared.pending;
    return snapshotFor(cwd, view);
  };

  /**
   * Apply a validated focus to one panel and re-read only its graph: the queue
   * is corpus-wide and a focus does not change it. A call whose read a later
   * focus overtook gets the panel's current, consistent state and
   * `superseded: true`, never another call's neighborhood under its own name.
   *
   * @param {string} cwd
   * @param {string} instanceId
   * @param {View} view
   * @param {{ id?: string | null, kinds?: string[] }} focus
   */
  const applyFocus = async (cwd, instanceId, view, focus) => {
    view.filter = { id: focus.id ?? null, kinds: focus.kinds ?? [] };
    const applied = await refreshGraph(cwd, instanceId, view);
    const shared = sharedQueueFor(cwd, view.dir);
    if (!shared.queue && shared.pending) await shared.pending;
    const snapshot = snapshotFor(cwd, view);
    return applied ? snapshot : { ...snapshot, superseded: true };
  };

  /**
   * @param {Instance} instance
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  const handle = async (instance, req, res) => {
    const url = new URL(req.url ?? '/', instance.origin);
    if (!tokenMatches(instance.token, url.searchParams.get('token'))) return reply(res, 403, 'Forbidden');
    const { cwd, instanceId } = instance;

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /':
        return reply(res, 200, renderBoardPage(instance.token), 'text/html; charset=utf-8');
      case 'GET /app.js':
        return reply(res, 200, BOARD_JS, 'text/javascript; charset=utf-8');
      case 'GET /app.css':
        return reply(res, 200, BOARD_CSS, 'text/css; charset=utf-8');
      case 'GET /api/state':
        return replyJson(res, 200, await stateFor(cwd, instanceId, viewOf(instanceId), { waitForQueue: false }));
      case 'GET /events': {
        const snapshot = await stateFor(cwd, instanceId, viewOf(instanceId), { waitForQueue: false });
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
        instance.clients.add(res);
        req.on('close', () => instance.clients.delete(res));
        return;
      }
      case 'POST /api/refresh':
      case 'POST /api/focus':
        break;
      default:
        return reply(res, 404, 'Not found');
    }

    if (!postAllowed(instance, req)) return reply(res, 403, 'Forbidden');

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

    if (url.pathname === '/api/refresh') return replyJson(res, 200, await refresh(cwd, instanceId, viewOf(instanceId), { waitForQueue: false }));
    // POST /api/focus
    /** @type {{ id?: string | null, kinds?: string[] }} */
    let focus;
    try {
      focus = validateBoardInput(body, ['id', 'kinds']);
    } catch (error) {
      const kind = error instanceof InputError ? /** @type {keyof typeof INPUT_ERRORS} */ (error.kind) : 'shape';
      return replyJson(res, 400, { error: INPUT_ERRORS[kind] });
    }
    return replyJson(res, 200, await applyFocus(cwd, instanceId, viewOf(instanceId), focus));
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

  /** `null` input is no input. @param {any} ctx */
  const inputOf = (ctx) => (ctx?.input === null ? undefined : ctx?.input);

  return {
    id: BOARD_ID,
    displayName: BOARD_TITLE,
    description:
      'Read-only map of the whole decision corpus: how the records relate (adr graph) and what is waiting for review ' +
      '(adr queue), with raw review facts only. Writes nothing and spends no AI credits.',
    inputSchema: OPEN_SCHEMA,
    actions: [
      {
        name: 'get_state',
        description:
          "Return this board's snapshot: the filter its graph was read with, the relationship graph as adr graph " +
          '--format json reports it (records with id, title, and status; relationships with from, to, and kind; or ' +
          `counts by status past ${NODE_LIMIT} records), and the open proposals from adr queue with their raw review ` +
          'facts (approvals and quorum, objection counts, SLA state, deadline, routing, and finding count). It states ' +
          'no verdict on whether a record could be ratified. Read-only; no model calls.',
        handler: async (/** @type {any} */ ctx) => {
          const cwd = await cwdFor(ctx);
          return stateFor(cwd, ctx?.instanceId, viewOf(ctx?.instanceId));
        },
      },
      {
        name: 'refresh',
        description:
          "Re-run adr graph (with this board's filter) and adr queue in the session working directory and update the " +
          "board. Input { dir } replaces this board's corpus directory, which must be inside the session repository; " +
          'omit it to reuse it. Read-only; no model calls.',
        inputSchema: REFRESH_SCHEMA,
        handler: async (/** @type {any} */ ctx) => {
          const input = validated(inputOf(ctx), ['dir']);
          const cwd = await cwdFor(ctx);
          confined(cwd, input.dir);
          const view = viewOf(ctx?.instanceId);
          if ('dir' in input) view.dir = input.dir;
          return refresh(cwd, ctx?.instanceId, view);
        },
      },
      {
        name: 'focus',
        description:
          'Re-run adr graph --format json with --focus <id> and a --kind per kind, and show that on this board ' +
          '(other open boards keep their own view). { id } keeps one record and its direct neighbors; { kinds } keeps ' +
          'only those relationship kinds; omit both (or pass null) to show the whole corpus again. id must be a record ' +
          'id (four or more digits, or a ULID) and kinds must come from supersedes, relatesTo, conflictsWith; anything ' +
          'else is refused before the CLI runs. If a later focus overtakes this one, the result says superseded: true ' +
          "and shows the board's current state. Read-only; no model calls.",
        inputSchema: FOCUS_SCHEMA,
        handler: async (/** @type {any} */ ctx) => {
          const input = validated(inputOf(ctx), ['id', 'kinds']);
          const cwd = await cwdFor(ctx);
          return applyFocus(cwd, ctx?.instanceId, viewOf(ctx?.instanceId), input);
        },
      },
    ],

    /** @param {any} ctx */
    open: async (ctx) => {
      const cwd = workingDirectoryOf(ctx);
      const input = validated(inputOf(ctx), ['dir', 'id', 'kinds']);
      confined(cwd, input.dir);
      let pending = instances.get(ctx.instanceId);
      const isNew = !pending;
      const view = viewFor(ctx.instanceId);
      const changesDir = 'dir' in input && input.dir !== view.dir;
      const changesFilter =
        ('id' in input || 'kinds' in input) &&
        JSON.stringify({ id: input.id ?? null, kinds: input.kinds ?? [] }) !== JSON.stringify(view.filter);
      if ('dir' in input) view.dir = input.dir;
      if ('id' in input || 'kinds' in input) view.filter = { id: input.id ?? null, kinds: input.kinds ?? [] };
      if (!pending) {
        const starting = (async () => {
          await refresh(cwd, ctx.instanceId, view, { waitForQueue: false });
          return startInstance(ctx.instanceId, cwd);
        })();
        pending = starting;
        instances.set(ctx.instanceId, starting);
        // A failed open must not pin the panel id to a dead promise.
        starting.catch(() => {
          if (instances.get(ctx.instanceId) === starting) {
            instances.delete(ctx.instanceId);
            // Nor to a view nothing will ever close (review R1-L1).
            views.delete(ctx.instanceId);
          }
        });
      }
      const instance = await pending;
      // A re-open keeps its URL; new input is applied, not silently dropped.
      if (!isNew && changesDir) await refresh(instance.cwd, ctx.instanceId, view, { waitForQueue: false });
      else if (!isNew && changesFilter) await refreshGraph(instance.cwd, ctx.instanceId, view);
      return { url: instance.url, title: BOARD_TITLE, status: statusLine(snapshotFor(instance.cwd, view)) };
    },

    /**
     * How many panel views are held, for the tests that check nothing is left
     * behind after a close or a panel-less action. Not an SDK field:
     * `createCanvas` copies only the fields it knows.
     */
    viewCount: () => views.size,

    /** @param {any} ctx */
    onClose: async (ctx) => {
      const pending = instances.get(ctx.instanceId);
      views.delete(ctx.instanceId);
      if (!pending) return;
      instances.delete(ctx.instanceId);
      /** @type {Instance} */
      let instance;
      try {
        instance = await pending;
      } catch {
        views.delete(ctx.instanceId);
        return;
      }
      // Again after the await: an open that was still in flight when the close
      // arrived may have touched the view since (review R1-L1).
      views.delete(ctx.instanceId);
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
