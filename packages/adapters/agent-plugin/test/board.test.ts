import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BOARD_BYTES_LIMIT,
  BOARD_ID,
  BOARD_NOTES,
  EDGE_LIMIT,
  INPUT_ERRORS,
  RECORD_ID,
  createDecisionBoardCanvas,
  graphArgs,
} from '../extensions/adrkit/board.mjs';
import { BOARD_CSS, BOARD_HTML, BOARD_JS, renderBoardPage } from '../extensions/adrkit/board-page.mjs';
import { NODE_LIMIT } from '../extensions/adrkit/board-layout.mjs';
import { BODY_LIMIT, CSP } from '../extensions/adrkit/panel-http.mjs';
import { CSP as REVIEW_CSP } from '../extensions/adrkit/canvas.mjs';
import { register } from '../extensions/adrkit/register.mjs';
import { packageRoot } from './harness.ts';

/**
 * The read-only `decision-board` canvas (ADR-0050), exercised without the
 * Copilot SDK. Like the decision-review tests, the HTTP tests start a real
 * loopback server, because the token, header, and Origin rules are the
 * security boundary and a fake request would test the fake.
 */

type Run = { stdout: string; stderr: string; exitCode: number };
type Call = { command: string; args: string[]; cwd: string; signal?: AbortSignal };

const CWD = '/work/repo';
// Built by concatenation so this file never spells the ratifying command.
const RATIFY = ['adr', 'accept'].join(' ');

const ok = (stdout = ''): Run => ({ stdout, stderr: '', exitCode: 0 });

const graphNode = (id: string, status = 'accepted', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Decision ${id}`,
  status,
  ...extra,
});

const graphJson = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ nodes, edges });

const defaultGraph = () =>
  graphJson(
    [graphNode('0001', 'superseded'), graphNode('0002'), graphNode('0003', 'proposed')],
    [
      { from: '0002', to: '0001', kind: 'supersedes' },
      { from: '0003', to: '0002', kind: 'relatesTo' },
    ],
  );

/** One QueueReport v1 item, shaped as `adr queue --format json` emits it. */
const queueItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Proposal ${id}`,
  sourcePath: `docs/adr/${id}-proposal.md`,
  tier: null,
  tierLabel: null,
  queuedAt: null,
  slaDays: null,
  reviewBy: null,
  slaState: 'not-queued',
  deadlineDate: null,
  routingTargets: ['@fixture'],
  quorum: null,
  approvalCount: 0,
  unresolvedObjectionCount: 0,
  resolvedObjectionCount: 0,
  escalatedAt: null,
  decidedAt: null,
  itemFindings: [],
  ...extra,
});

const queueReport = (items: unknown[]) =>
  JSON.stringify({
    version: '1',
    asOf: '2026-10-09',
    corpusFingerprint: 'f'.repeat(64),
    totalItems: items.length,
    totalCorpusFindings: 0,
    itemsWithFindings: 0,
    items,
    corpusFindings: [],
  });

function fakeCli(script: { graph?: Run | Error | (() => Promise<Run>); queue?: Run | Error } = {}) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], { cwd, signal }: { cwd: string; signal?: AbortSignal }) => {
    calls.push({ command, args, cwd, signal });
    const key = args.includes('graph') ? 'graph' : args.includes('queue') ? 'queue' : 'other';
    const answer =
      key === 'graph'
        ? (script.graph ?? ok(defaultGraph()))
        : key === 'queue'
          ? (script.queue ?? ok(queueReport([queueItem('0003')])))
          : ok();
    if (typeof answer === 'function') return answer();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { run, calls };
}

const opened: Array<{ onClose: (ctx: unknown) => unknown; instanceId: string }> = [];

function makeBoard(overrides: Record<string, unknown> = {}) {
  const cli = fakeCli();
  const servers: unknown[] = [];
  const options = createDecisionBoardCanvas({
    run: cli.run,
    env: {},
    exists: () => false,
    createServer: (handler: any) => {
      const server = createServer(handler);
      servers.push(server);
      return server;
    },
    now: () => '2026-10-09T00:00:00.000Z',
    ...overrides,
  } as never) as any;
  return { options, cli, servers };
}

const ctxFor = (instanceId: string, extra: Record<string, unknown> = {}) => ({
  sessionId: 's',
  extensionId: 'plugin:adrkit:adrkit',
  canvasId: BOARD_ID,
  instanceId,
  session: { workingDirectory: CWD },
  ...extra,
});

async function openBoard(options: any, instanceId = 'board-1', extra: Record<string, unknown> = {}) {
  const result = await options.open(ctxFor(instanceId, extra));
  opened.push({ onClose: options.onClose, instanceId });
  return result as { url: string; title: string; status: string };
}

function action(options: any, name: string) {
  const found = options.actions.find((entry: { name: string }) => entry.name === name);
  if (!found) throw new Error(`no action ${name}`);
  return (input?: unknown, instanceId = 'board-1'): Promise<any> =>
    Promise.resolve(found.handler({ ...ctxFor(instanceId), actionName: name, input }));
}

afterEach(async () => {
  for (const { onClose, instanceId } of opened.splice(0)) await onClose(ctxFor(instanceId));
});

type Response = { status: number; headers: IncomingHttpHeaders; body: string };

function send(
  url: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const withPath = (url: string, path: string, token?: string | null) => {
  const parsed = new URL(url);
  const given = token === undefined ? parsed.searchParams.get('token') : token;
  const next = new URL(path, parsed.origin);
  if (given !== null) next.searchParams.set('token', given);
  return next.toString();
};

const tokenOf = (url: string) => new URL(url).searchParams.get('token') as string;

const postJson = (url: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  send(withPath(url, path), {
    method: 'POST',
    headers: { 'X-Adrkit-Token': tokenOf(url), 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// A small DOM: enough of HTML and SVG for the page script, recording how each
// node was made, so a test can tell an SVG class set by attribute from a
// `className` assignment a browser would ignore.
class FakeNode {
  children: FakeNode[] = [];
  textContent = '';
  className = '';
  type = '';
  id = '';
  value = '';
  checked = false;
  disabled = false;
  focused = false;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(event?: unknown) => void>> = {};
  constructor(
    readonly tag: string,
    readonly ns: string | null = null,
  ) {}
  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode) {
    this.children = this.children.filter((node) => node !== child);
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  setAttribute(name: string, value: unknown) {
    this.attrs[name] = String(value);
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  addEventListener(type: string, listener: (event?: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  focus() {
    this.focused = true;
  }
  fire(type: string, event: unknown = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(' ');
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

const PAGE_IDS = [
  'status',
  'cwd',
  'refresh',
  'show-all',
  'kind-supersedes',
  'kind-relatesTo',
  'kind-conflictsWith',
  'apply-kinds',
  'message',
  'legend',
  'board',
  'detail',
  'queue',
];

async function renderBoardWith(state: unknown, posts: Array<{ path: string; body: unknown }> = []) {
  const { runInNewContext } = await import('node:vm');
  const nodes = new Map(PAGE_IDS.map((id) => [id, new FakeNode(id)]));
  const context = {
    window: { location: { search: '?token=t' } },
    document: {
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: (tag: string) => new FakeNode(tag),
      createElementNS: (ns: string, tag: string) => new FakeNode(tag, ns),
    },
    fetch: async (path: string, init?: { body?: string }) => {
      if (init?.body !== undefined) posts.push({ path, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => state };
    },
    URLSearchParams,
    Map,
    Set,
  };
  runInNewContext(BOARD_JS, context);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return nodes;
}

const svgNodes = (root: FakeNode) => root.all().filter((node) => node.tag === 'g' && node.attrs['role'] === 'button');

describe('declaration', () => {
  test('a read-only canvas with exactly get_state, refresh, and focus', () => {
    const { options } = makeBoard();
    expect(options.id).toBe('decision-board');
    expect(options.displayName).toBe('Decision board');
    expect(options.actions.map((entry: { name: string }) => entry.name)).toEqual(['get_state', 'refresh', 'focus']);
    for (const entry of options.actions) {
      expect({ name: entry.name, readOnly: /Read-only; no model calls\./.test(entry.description) }).toEqual({
        name: entry.name,
        readOnly: true,
      });
    }
    expect(options.description).toMatch(/Read-only/);
    expect(options.description).toMatch(/spends no AI credits/);
  });

  test('every optional-input schema accepts null', () => {
    const { options } = makeBoard();
    const schemas = [options.inputSchema, ...options.actions.filter((a: any) => a.inputSchema).map((a: any) => a.inputSchema)];
    expect(schemas.length).toBe(3);
    for (const schema of schemas) expect(schema.type).toEqual(['object', 'null']);
  });

  test('the factory takes no session: there is nothing to send or start', () => {
    // No getSession dependency at all: the board cannot reach the agent or a workflow.
    const source = createDecisionBoardCanvas.toString();
    expect(source).not.toMatch(/getSession|rpc\.workflow|\.send\(/);
  });
});

describe('graph and queue', () => {
  test('open reads adr graph and adr queue as JSON, and keeps the CLI layout facts', async () => {
    const { options, cli } = makeBoard();
    const result = await openBoard(options);
    expect(result.title).toBe('Decision board');
    expect(result.status).toBe('3 records · 2 relationships · 1 open');
    const graphCall = cli.calls.find((call) => call.args.includes('graph'));
    expect(graphCall?.args).toEqual(['graph', '--format', 'json']);
    expect(graphCall?.cwd).toBe(CWD);
    const state = await action(options, 'get_state')();
    expect(state.graph.mode).toBe('graph');
    expect(state.graph.nodes.map((n: { id: string }) => n.id)).toEqual(['0001', '0002', '0003']);
    for (const node of state.graph.nodes) expect(Object.keys(node).sort()).toEqual(['id', 'status', 'title', 'x', 'y']);
    for (const edge of state.graph.edges) expect(Object.keys(edge).sort()).toEqual(['from', 'kind', 'to']);
    // 0002 supersedes 0001, so the replaced record is to its left.
    const x = Object.fromEntries(state.graph.nodes.map((n: { id: string; x: number }) => [n.id, n.x]));
    expect(x['0001']).toBeLessThan(x['0002']);
    expect(state.queue.items.map((item: { id: string }) => item.id)).toEqual(['0003']);
  });

  test('the status line counts in the singular for one', async () => {
    const scripted = fakeCli({ graph: ok(graphJson([graphNode('0004')], [])), queue: ok(queueReport([])) });
    const { options } = makeBoard({ run: scripted.run });
    const result = await openBoard(options);
    expect(result.status).toBe('1 record · 0 relationships · 0 open');
    const state = await action(options, 'get_state')();
    expect((await renderBoardWith(state)).get('status')?.textContent).toBe('1 record · 0 relationships');
  });

  test('refresh with { dir } passes it to both reads', async () => {
    const { options, cli } = makeBoard();
    await openBoard(options);
    cli.calls.length = 0;
    await action(options, 'refresh')({ dir: 'decisions' });
    const graphCall = cli.calls.find((call) => call.args.includes('graph'));
    const queueCall = cli.calls.find((call) => call.args.includes('queue'));
    expect(graphCall?.args).toEqual(['graph', '--format', 'json', '--dir', 'decisions']);
    expect(queueCall?.args).toEqual(['queue', '--format', 'json', '--dir', 'decisions']);
  });

  test('graph exit 1 is a complete graph with a fixed corpus-errors note', async () => {
    const scripted = fakeCli({ graph: { stdout: defaultGraph(), stderr: 'Error: SECRET-STDERR /Users/someone', exitCode: 1 } });
    const { options } = makeBoard({ run: scripted.run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.available).toBe(true);
    expect(state.graph.nodes.length).toBe(3);
    expect(state.graph.notes).toEqual([BOARD_NOTES.corpusErrors]);
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  for (const [label, answer, note] of [
    ['exit 2', { stdout: '', stderr: 'Error: SECRET-STDERR /Users/someone', exitCode: 2 }, BOARD_NOTES.refused],
    ['exit 3', { stdout: 'SECRET-OUT', stderr: 'SECRET-STDERR', exitCode: 3 }, BOARD_NOTES.exit(3)],
    ['a spawn failure', new Error('could not start SECRET-SPAWN /Users/someone'), BOARD_NOTES.start],
    ['unreadable output', ok('not json SECRET-OUT'), BOARD_NOTES.unreadable],
    ['the wrong shape', ok('{"nodes":"SECRET"}'), BOARD_NOTES.unreadable],
    ['an overflow', Object.assign(new Error('SECRET maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), BOARD_NOTES.tooLarge],
  ] as const) {
    test(`${label} becomes a fixed note, never CLI or exception text`, async () => {
      const scripted = fakeCli({ graph: answer as Run | Error });
      const { options } = makeBoard({ run: scripted.run });
      const { url } = await openBoard(options);
      const state = await action(options, 'get_state')();
      expect(state.graph.available).toBe(false);
      expect(state.graph.notes).toEqual([note]);
      expect(JSON.stringify(state)).not.toContain('SECRET');
      expect((await send(withPath(url, '/api/state'))).body).not.toContain('SECRET');
      const page = (await renderBoardWith(state)).get('board') as FakeNode;
      expect(page.allText()).toContain(note);
    });
  }

  test('a graph that does not answer in time is abandoned with a fixed note, and its process is signalled', async () => {
    const scripted = fakeCli({ graph: () => new Promise<Run>(() => {}) });
    const { options } = makeBoard({ run: scripted.run, timeoutMs: 10 });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.notes).toEqual([BOARD_NOTES.timeout]);
    const graphCall = scripted.calls.find((call) => call.args.includes('graph'));
    expect(graphCall?.signal?.aborted).toBe(true);
  });

  test('past the node budget the board carries counts by status, not records', async () => {
    const nodes = Array.from({ length: NODE_LIMIT + 1 }, (_, i) => graphNode(String(i + 1).padStart(4, '0'), i < 100 ? 'proposed' : 'accepted'));
    const scripted = fakeCli({ graph: ok(graphJson(nodes, [])) });
    const { options } = makeBoard({ run: scripted.run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.mode).toBe('summary');
    expect(state.graph.nodes).toEqual([]);
    expect(state.graph.totalNodes).toBe(NODE_LIMIT + 1);
    expect(state.graph.byStatus).toEqual([
      { status: 'accepted', count: 201 },
      { status: 'proposed', count: 100 },
    ]);
    expect(state.graph.notes).toContain(BOARD_NOTES.overNodes);
    const page = (await renderBoardWith(state)).get('board') as FakeNode;
    expect(page.allText()).toContain('accepted: 201');
    expect(page.all().some((node) => node.tag === 'input')).toBe(true);
  });

  test('past the edge budget the first relationships are kept and the rest counted', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => String(i + 1).padStart(4, '0'));
    const edges = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ from, to, kind: 'relatesTo' })));
    expect(edges.length).toBeGreaterThan(EDGE_LIMIT);
    const scripted = fakeCli({ graph: ok(graphJson(ids.map((id) => graphNode(id)), edges)) });
    const { options } = makeBoard({ run: scripted.run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.edges.length).toBe(EDGE_LIMIT);
    expect(state.graph.totalEdges).toBe(edges.length);
    expect(state.graph.notes).toContain(BOARD_NOTES.edges(EDGE_LIMIT, edges.length));
  });

  test('titles are clipped, and the snapshot stays within its byte budget', async () => {
    const nodes = Array.from({ length: NODE_LIMIT }, (_, i) =>
      graphNode(String(i + 1).padStart(4, '0'), 'accepted', { title: 'T'.repeat(5000) }),
    );
    const scripted = fakeCli({ graph: ok(graphJson(nodes, [])) });
    const { options } = makeBoard({ run: scripted.run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.mode).toBe('graph');
    expect(Math.max(...state.graph.nodes.map((n: { title: string }) => n.title.length))).toBeLessThanOrEqual(201);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(BOARD_BYTES_LIMIT);
    expect(BOARD_BYTES_LIMIT).toBe(512 * 1024);
  });

  test('over the byte budget the graph becomes a summary, then the queue rows go', async () => {
    const { options } = makeBoard({ bytesLimit: 900 });
    const { url } = await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.mode).toBe('summary');
    expect(state.graph.nodes).toEqual([]);
    expect(state.graph.notes).toContain(BOARD_NOTES.overBytes);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(900);
    expect(Buffer.byteLength((await send(withPath(url, '/api/state'))).body)).toBeLessThanOrEqual(900);
    const tiny = makeBoard({ bytesLimit: 400 });
    await openBoard(tiny.options, 'tiny');
    const squeezed = await action(tiny.options, 'get_state')(undefined, 'tiny');
    expect(squeezed.queue.items).toEqual([]);
    expect(squeezed.queue.note).toBe(BOARD_NOTES.queueOverBytes);
  });
});

describe('allowlist', () => {
  test('planted fields on nodes, edges, and queue rows never reach the snapshot, the state route, or the page', async () => {
    const graph = graphJson(
      [graphNode('0001', 'accepted', { acceptCommand: `${RATIFY} 0001 --by @someone`, nextStep: `${RATIFY} 0001` })],
      [{ from: '0001', to: '0001', kind: 'relatesTo', command: `${RATIFY} 0001`, ratify: { command: RATIFY } }],
    );
    const queue = queueReport([
      queueItem('0001', {
        acceptCommand: `${RATIFY} 0001 --by @someone`,
        nextStep: `${RATIFY} 0001 --by @someone`,
        ratify: { command: `${RATIFY} 0001` },
      }),
    ]);
    const scripted = fakeCli({ graph: ok(graph), queue: ok(queue) });
    const { options } = makeBoard({ run: scripted.run });
    const { url } = await openBoard(options);
    const state = await action(options, 'get_state')();
    const serialized = JSON.stringify(state);
    for (const banned of [RATIFY, 'acceptCommand', 'nextStep', 'ratify', '"command"']) expect(serialized).not.toContain(banned);
    expect(Object.keys(state.queue.items[0]).sort()).toEqual(
      [
        'id',
        'title',
        'sourcePath',
        'slaState',
        'deadlineDate',
        'approvalCount',
        'quorum',
        'unresolvedObjectionCount',
        'resolvedObjectionCount',
        'routingTargets',
        'itemFindingCount',
      ].sort(),
    );
    const served = await send(withPath(url, '/api/state'));
    expect(served.body).not.toContain(RATIFY);
    const page = await send(url);
    expect(page.body).not.toContain(RATIFY);
    const rendered = await renderBoardWith(state);
    for (const node of rendered.values()) expect(node.allText()).not.toContain(RATIFY);
    for (const shipped of [BOARD_HTML, BOARD_JS, BOARD_CSS]) expect(shipped).not.toContain(RATIFY);
    // "accepted" is a status the page shows; the bare verb is not.
    expect(BOARD_JS).not.toMatch(/\baccept\b/i);
  });

  test('an edge kind outside the three is dropped', async () => {
    const graph = graphJson([graphNode('0001'), graphNode('0002')], [{ from: '0001', to: '0002', kind: 'approves' }]);
    const { options } = makeBoard({ run: fakeCli({ graph: ok(graph) }).run });
    await openBoard(options);
    expect((await action(options, 'get_state')()).graph.edges).toEqual([]);
  });
});

describe('no readiness verdict', () => {
  test('a record at quorum with no objections renders its counts and nothing more', async () => {
    const queue = queueReport([
      queueItem('0003', { approvalCount: 2, quorum: 2, unresolvedObjectionCount: 0, resolvedObjectionCount: 1, slaState: 'on-track', deadlineDate: '2026-10-20' }),
    ]);
    const { options } = makeBoard({ run: fakeCli({ queue: ok(queue) }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    const item = state.queue.items[0];
    expect(item).toMatchObject({ approvalCount: 2, quorum: 2, unresolvedObjectionCount: 0, resolvedObjectionCount: 1, itemFindingCount: 0 });
    for (const key of Object.keys(item)) expect(key).not.toMatch(/ready|verdict|ratif|eligible|canAccept/i);
    const nodes = await renderBoardWith(state);
    const queueText = (nodes.get('queue') as FakeNode).allText();
    expect(queueText).toContain('approvals 2 of quorum 2');
    expect(queueText).toContain('objections: 0 unresolved, 1 resolved');
    expect(queueText).toContain('SLA on-track');
    expect(queueText).toContain('deadline 2026-10-20');
    for (const node of nodes.values()) expect(node.allText()).not.toMatch(/\bready\b|\bratif|\bcan be (?:merged|approved)\b/i);
    expect(BOARD_JS).not.toMatch(/\bready\b/i);
    expect(BOARD_HTML).not.toMatch(/\bready\b/i);
  });
});

describe('filters', () => {
  for (const [label, input, message] of [
    ['a short id', { id: '12' }, INPUT_ERRORS.id],
    ['an id with a shell tail', { id: '0046; rm -rf /' }, INPUT_ERRORS.id],
    ['an option-shaped id', { id: '--format' }, INPUT_ERRORS.id],
    ['a namespaced id', { id: 'team/0046' }, INPUT_ERRORS.id],
    ['a numeric id', { id: 46 }, INPUT_ERRORS.id],
    ['an unknown kind', { kinds: ['approves'] }, INPUT_ERRORS.kinds],
    ['a repeated kind', { kinds: ['supersedes', 'supersedes'] }, INPUT_ERRORS.kinds],
    ['kinds as a string', { kinds: 'supersedes' }, INPUT_ERRORS.kinds],
    ['an unknown key', { id: '0046', cli: '/bin/sh' }, INPUT_ERRORS.shape],
    ['an array input', ['0046'], INPUT_ERRORS.shape],
  ] as const) {
    test(`focus with ${label} is refused with invalid_input before any spawn`, async () => {
      const { options, cli } = makeBoard();
      await openBoard(options);
      const before = cli.calls.length;
      const error = await action(options, 'focus')(input).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe('invalid_input');
      expect((error as Error).message).toBe(message);
      expect(cli.calls.length).toBe(before);
    });
  }

  test('a valid focus passes the exact argv, in adr graph kind order, and does not re-run the queue', async () => {
    const { options, cli } = makeBoard();
    await openBoard(options);
    cli.calls.length = 0;
    const state = await action(options, 'focus')({ id: '0046', kinds: ['relatesTo', 'supersedes'] });
    expect(cli.calls.map((call) => call.args)).toEqual([
      ['graph', '--format', 'json', '--focus', '0046', '--kind', 'supersedes', '--kind', 'relatesTo'],
    ]);
    expect(state.filter).toEqual({ id: '0046', kinds: ['supersedes', 'relatesTo'] });
  });

  test('a ULID focus is accepted; null and {} clear the filter', async () => {
    const { options, cli } = makeBoard();
    await openBoard(options);
    const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    await action(options, 'focus')({ id: ulid });
    expect(cli.calls.at(-1)?.args).toEqual(['graph', '--format', 'json', '--focus', ulid]);
    const cleared = await action(options, 'focus')(null);
    expect(cleared.filter).toEqual({ id: null, kinds: [] });
    expect(cli.calls.at(-1)?.args).toEqual(['graph', '--format', 'json']);
    await action(options, 'focus')({ kinds: ['conflictsWith'] });
    expect(cli.calls.at(-1)?.args).toEqual(['graph', '--format', 'json', '--kind', 'conflictsWith']);
    expect((await action(options, 'focus')({})).filter).toEqual({ id: null, kinds: [] });
  });

  test('graphArgs is the one argv builder', () => {
    expect(graphArgs({ dir: 'd', filter: { id: '0001', kinds: ['conflictsWith'] } })).toEqual([
      'graph', '--format', 'json', '--dir', 'd', '--focus', '0001', '--kind', 'conflictsWith',
    ]);
  });

  test('invalid open input is refused before a server or a process starts', async () => {
    const { options, cli, servers } = makeBoard();
    for (const input of [{ id: 'x' }, { dir: '-rf' }, { dir: 'a\u0000b' }, { files: ['a'] }]) {
      const error = await options.open(ctxFor('bad', { input })).catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe('invalid_input');
    }
    expect(servers.length).toBe(0);
    expect(cli.calls.length).toBe(0);
  });

  test('open with a focus applies it', async () => {
    const { options, cli } = makeBoard();
    const result = await openBoard(options, 'board-1', { input: { id: '0046' } });
    expect(cli.calls.find((call) => call.args.includes('graph'))?.args).toEqual(['graph', '--format', 'json', '--focus', '0046']);
    expect(result.status).toContain('focus 0046');
  });

  test('POST /api/focus validates the same way, with a fixed message and no spawn', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const before = cli.calls.length;
    const refused = await postJson(url, '/api/focus', { id: '<script>SECRET</script>' });
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body)).toEqual({ error: INPUT_ERRORS.id });
    expect(refused.body).not.toContain('SECRET');
    expect(cli.calls.length).toBe(before);
    const good = await postJson(url, '/api/focus', { id: '0002' });
    expect(good.status).toBe(200);
    expect(JSON.parse(good.body).filter).toEqual({ id: '0002', kinds: [] });
    expect(cli.calls.at(-1)?.args).toEqual(['graph', '--format', 'json', '--focus', '0002']);
  });
});

describe('open and close', () => {
  test('constructing the board starts no server; open starts exactly one; onClose closes it', async () => {
    const { options, servers } = makeBoard();
    expect(servers.length).toBe(0);
    const { url } = await openBoard(options);
    expect(servers.length).toBe(1);
    expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(tokenOf(url)).toMatch(/^[0-9a-f]{64}$/);
    const again = await options.open(ctxFor('board-1'));
    expect(again.url).toBe(url);
    expect(servers.length).toBe(1);
    await options.onClose(ctxFor('board-1'));
    opened.splice(0);
    expect((servers[0] as { listening: boolean }).listening).toBe(false);
    await expect(send(url)).rejects.toThrow();
  });

  test('open without a working directory throws workspace_unavailable', async () => {
    const { options, servers } = makeBoard();
    const error = await options.open({ ...ctxFor('board-1'), session: undefined }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('workspace_unavailable');
    expect(servers.length).toBe(0);
  });

  test('importing the board modules under Node opens no socket and leaves nothing running', () => {
    const dir = join(packageRoot, 'extensions', 'adrkit');
    const script = [
      ...['board.mjs', 'board-page.mjs', 'board-layout.mjs', 'panel-http.mjs', 'register.mjs'].map(
        (file) => `await import(${JSON.stringify(join(dir, file))});`,
      ),
      `process.stdout.write(JSON.stringify(process.getActiveResourcesInfo()));`,
    ].join('\n');
    const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    const resources = JSON.parse(out) as string[];
    expect(resources.filter((name) => /TCP|Server|Timeout/.test(name))).toEqual([]);
  });

  test('under Node, a board serves its page and onClose stops the listener', () => {
    const boardPath = join(packageRoot, 'extensions', 'adrkit', 'board.mjs');
    const script = `
      const { createDecisionBoardCanvas } = await import(${JSON.stringify(boardPath)});
      const servers = [];
      const { createServer } = await import('node:http');
      const board = createDecisionBoardCanvas({
        run: async (command, args) => ({ stdout: args.includes('graph') ? '{"nodes":[],"edges":[]}' : '{}', stderr: '', exitCode: 0 }),
        env: {}, exists: () => false,
        createServer: (handler) => { const server = createServer(handler); servers.push(server); return server; },
      });
      const ctx = { instanceId: 'p', session: { workingDirectory: '/work/repo' } };
      const { url } = await board.open(ctx);
      const page = await fetch(url);
      await page.text();
      await board.onClose(ctx);
      process.stdout.write(JSON.stringify({ status: page.status, csp: page.headers.get('content-security-policy'), listening: servers[0].listening }));
    `;
    const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(out)).toEqual({ status: 200, csp: CSP, listening: false });
  });
});

describe('HTTP boundary', () => {
  test('the board and decision-review share one CSP', () => {
    expect(CSP).toBe(REVIEW_CSP);
    expect(CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *",
    );
  });

  test('every route needs the token: missing or wrong gives 403', async () => {
    const { options } = makeBoard();
    const { url } = await openBoard(options);
    for (const path of ['/', '/app.js', '/app.css', '/api/state', '/events', '/nope']) {
      expect({ path, status: (await send(withPath(url, path, null))).status }).toEqual({ path, status: 403 });
      expect({ path, status: (await send(withPath(url, path, 'f'.repeat(64)))).status }).toEqual({ path, status: 403 });
    }
  });

  test('a token from another board is refused', async () => {
    const { options } = makeBoard();
    const first = await openBoard(options, 'board-1');
    const second = await openBoard(options, 'board-2');
    expect((await send(withPath(first.url, '/api/state', tokenOf(second.url)))).status).toBe(403);
  });

  test('serves the page and assets with the security headers on every response', async () => {
    const { options } = makeBoard();
    const { url } = await openBoard(options);
    const page = await send(url);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain(`app.js?token=${tokenOf(url)}`);
    const js = await send(withPath(url, '/app.js'));
    expect(js.body).toBe(BOARD_JS);
    const css = await send(withPath(url, '/app.css'));
    expect(css.body).toBe(BOARD_CSS);
    const responses = [
      page,
      js,
      css,
      await send(withPath(url, '/api/state')),
      await send(withPath(url, '/nope')),
      await send(withPath(url, '/', null)),
      await send(withPath(url, '/api/refresh'), { method: 'POST' }),
      await postJson(url, '/api/focus', { id: 'x' }),
    ];
    for (const { headers } of responses) {
      expect(headers['content-security-policy']).toBe(CSP);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cache-control']).toBe('no-store');
      expect(headers['x-frame-options']).toBeUndefined();
    }
  });

  test('a POST needs the header token and no foreign Origin', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const before = cli.calls.length;
    expect((await send(withPath(url, '/api/refresh'), { method: 'POST' })).status).toBe(403);
    expect((await postJson(url, '/api/focus', { id: '0002' }, { 'X-Adrkit-Token': 'f'.repeat(64) })).status).toBe(403);
    expect((await postJson(url, '/api/focus', { id: '0002' }, { Origin: 'http://evil.example' })).status).toBe(403);
    expect(cli.calls.length).toBe(before);
    expect((await postJson(url, '/api/refresh', {}, { Origin: new URL(url).origin })).status).toBe(200);
    expect(cli.calls.length).toBeGreaterThan(before);
  });

  test('unknown routes and methods give 404; an oversized body 413', async () => {
    const { options } = makeBoard();
    const { url } = await openBoard(options);
    expect((await send(withPath(url, '/api/state'), { method: 'DELETE' })).status).toBe(404);
    expect((await send(withPath(url, '/api/focus'))).status).toBe(404);
    expect((await send(withPath(url, '/api/run-review'), { method: 'POST', headers: { 'X-Adrkit-Token': tokenOf(url) } })).status).toBe(404);
    expect((await send(withPath(url, '/api/explain'), { method: 'POST', headers: { 'X-Adrkit-Token': tokenOf(url) } })).status).toBe(404);
    const big = await postJson(url, '/api/focus', { id: '0002', pad: 'x'.repeat(BODY_LIMIT) }).catch(() => ({ status: -1 }));
    expect(big.status).toBe(413);
  });
});

describe('page', () => {
  test('the shipped JS has no HTML-injection sink and sets no inline style', () => {
    for (const sink of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /document\.write/, /\beval\s*\(/, /new Function\b/, /\.style\b/, /['"]style['"]/]) {
      expect({ sink: String(sink), found: sink.test(BOARD_JS) }).toEqual({ sink: String(sink), found: false });
    }
    expect(BOARD_JS).toContain('textContent');
    expect(BOARD_JS).toContain('createElementNS');
  });

  test('the page has no inline script or style, and renderBoardPage substitutes only a hex token', () => {
    expect(BOARD_HTML).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(BOARD_HTML).not.toMatch(/<style\b/);
    expect(BOARD_HTML).not.toMatch(/\son[a-z]+=/i);
    expect(renderBoardPage('ab'.repeat(32))).toContain(`app.css?token=${'ab'.repeat(32)}`);
    expect(() => renderBoardPage('"><script>')).toThrow();
  });

  test('styles reuse the app tokens decision-review uses', () => {
    for (const name of ['--background-color-default', '--text-color-default', '--text-color-muted', '--border-color-default', '--color-focus-outline', '--true-color-green', '--true-color-red', '--true-color-blue', '--true-color-yellow']) {
      expect({ name, used: new RegExp(`var\\(${name}\\s*,`).test(BOARD_CSS) }).toEqual({ name, used: true });
    }
    for (const kind of ['supersedes', 'relatesTo', 'conflictsWith']) expect(BOARD_CSS).toContain(`.edge-${kind}`);
  });

  test('records are SVG with status by class and by label; untrusted text stays text', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const graph = graphJson([graphNode('0001', 'accepted', { title: hostile }), graphNode('0002', 'weird"status')], [
      { from: '0002', to: '0001', kind: 'supersedes' },
    ]);
    const { options } = makeBoard({ run: fakeCli({ graph: ok(graph) }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    const nodes = await renderBoardWith(state);
    const board = nodes.get('board') as FakeNode;
    const svgRoot = board.all().find((node) => node.tag === 'svg');
    expect(svgRoot?.ns).toBe('http://www.w3.org/2000/svg');
    const records = svgNodes(board);
    expect(records.length).toBe(2);
    for (const record of records) {
      expect(record.ns).toBe('http://www.w3.org/2000/svg');
      expect(record.attrs['tabindex']).toBe('0');
      // SVG classes by attribute; a className assignment does nothing in a browser.
      expect(record.className).toBe('');
      expect(record.attrs['class']).toMatch(/\bnode\b/);
    }
    const [first, second] = records as [FakeNode, FakeNode];
    expect(first.attrs['class']).toContain('status-accepted');
    expect(first.allText()).toContain('0001 · accepted');
    expect(first.allText()).toContain(hostile);
    // A status outside the known set gets the neutral class, and its label is still shown as text.
    expect(second.attrs['class']).toContain('status-unknown');
    expect(second.attrs['class']).not.toContain('weird');
    expect(second.allText()).toContain('weird"status');
    const edge = board.all().find((node) => node.tag === 'line');
    expect(edge?.attrs['class']).toContain('edge-supersedes');
    // The legend names every status and every kind in text, not color alone.
    const legend = (nodes.get('legend') as FakeNode).allText();
    for (const word of ['accepted', 'proposed', 'draft', 'rejected', 'superseded', 'deprecated', 'supersedes', 'relates to', 'conflicts with', 'dashed', 'dotted']) {
      expect(legend).toContain(word);
    }
  });

  test('Enter on a focused record selects it: the detail pane shows its fields, neighbors, and queue row', async () => {
    const queue = queueReport([queueItem('0002', { approvalCount: 1, quorum: 2, routingTargets: ['@arb'] })]);
    const { options } = makeBoard({ run: fakeCli({ queue: ok(queue) }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    const posts: Array<{ path: string; body: unknown }> = [];
    const nodes = await renderBoardWith(state, posts);
    const target = svgNodes(nodes.get('board') as FakeNode).find((node) => node.attrs['aria-label']?.startsWith('0002'));
    expect(target).toBeDefined();
    (target as FakeNode).fire('keydown', { key: 'Tab' });
    expect((nodes.get('detail') as FakeNode).allText()).not.toContain('Neighbors');
    (target as FakeNode).fire('keydown', { key: 'Enter', preventDefault() {} });
    const detail = nodes.get('detail') as FakeNode;
    const text = detail.allText();
    expect(text).toContain('0002');
    expect(text).toContain('Decision 0002');
    expect(text).toContain('accepted');
    expect(text).toContain('supersedes');
    expect(text).toContain('0001');
    expect(text).toContain('relates to (from)');
    expect(text).toContain('0003');
    expect(text).toContain('approvals 1 of quorum 2');
    expect(text).toContain('routed to @arb');
    // The redrawn record gets keyboard focus back, marked as pressed.
    const redrawn = svgNodes(nodes.get('board') as FakeNode).find((node) => node.attrs['aria-label']?.startsWith('0002'));
    expect(redrawn?.attrs['aria-pressed']).toBe('true');
    expect(redrawn?.focused).toBe(true);
    // Focus from the detail pane posts the record id only.
    const focusButton = detail.all().find((node) => node.tag === 'button' && node.textContent === 'Focus on 0002');
    focusButton?.fire('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toEqual([{ path: '/api/focus?token=t', body: { id: '0002', kinds: [] } }]);
  });

  test('the page has no control that writes, starts a workflow, or reaches the agent', () => {
    for (const route of ['/api/run-review', '/api/explain']) expect(BOARD_JS).not.toContain(route);
    // Word-bounded: "supersession" is a word the page uses.
    expect(BOARD_JS).not.toMatch(/\bsession\b|\bworkflow\b/);
    const posted = [...BOARD_JS.matchAll(/act\('([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(posted)].sort()).toEqual(['/api/focus', '/api/refresh']);
  });
});

describe('register with the board', () => {
  function fakes({ boardThrows = false, reviewThrows = false, toolsThrow = false } = {}) {
    const joined: Array<Record<string, unknown>> = [];
    const logged: string[] = [];
    const session = { log: async (message: string) => void logged.push(message) };
    return {
      joined,
      logged,
      deps: {
        defineWorkflow: (definition: unknown) => ({ kind: 'workflow', definition }),
        createCanvas: (options: { id: string }) => ({ kind: 'canvas', id: options.id }),
        joinSession: async (config: Record<string, unknown>) => {
          joined.push(config);
          return session;
        },
        workflow: () => ({ meta: { name: 'adr-review' } }),
        canvas: () => {
          if (reviewThrows) throw new Error('bad review canvas');
          return { id: 'decision-review' };
        },
        board: () => {
          if (boardThrows) throw new Error('bad board');
          return { id: 'decision-board' };
        },
        tools: () => {
          if (toolsThrow) throw new Error('bad tools');
          return [{ name: 'adr_check' }];
        },
        hooks: () => ({ onSessionStart: () => undefined }),
      },
    };
  }

  test('joins once with both canvases, the workflow, the tools, and the hooks', async () => {
    const { deps, joined, logged } = fakes();
    await register(deps);
    expect(joined.length).toBe(1);
    expect((joined[0]?.['canvases'] as Array<{ id: string }>).map((c) => c.id)).toEqual(['decision-review', 'decision-board']);
    expect(joined[0]?.['workflows']).toBeDefined();
    expect(joined[0]?.['tools']).toBeDefined();
    expect(joined[0]?.['hooks']).toBeDefined();
    expect(logged).toEqual([]);
  });

  test('a throwing board costs nothing else, and is reported', async () => {
    const { deps, joined, logged } = fakes({ boardThrows: true });
    await register(deps);
    expect(joined.length).toBe(1);
    expect((joined[0]?.['canvases'] as Array<{ id: string }>).map((c) => c.id)).toEqual(['decision-review']);
    expect((joined[0]?.['workflows'] as unknown[]).length).toBe(1);
    expect(joined[0]?.['tools']).toBeDefined();
    expect(joined[0]?.['hooks']).toBeDefined();
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain('decision-board canvas');
    expect(logged[0]).toContain('bad board');
  });

  test('a throwing decision-review canvas does not cost the board', async () => {
    const { deps, joined, logged } = fakes({ reviewThrows: true });
    await register(deps);
    expect((joined[0]?.['canvases'] as Array<{ id: string }>).map((c) => c.id)).toEqual(['decision-board']);
    expect(logged[0]).toContain('bad review canvas');
  });

  test('a board that createCanvas rejects is isolated the same way', async () => {
    const { deps, joined, logged } = fakes();
    await register({
      ...deps,
      createCanvas: (options: { id: string }) => {
        if (options.id === 'decision-board') throw new Error('createCanvas refused the board');
        return { kind: 'canvas', id: options.id };
      },
    });
    expect((joined[0]?.['canvases'] as Array<{ id: string }>).map((c) => c.id)).toEqual(['decision-review']);
    expect(logged[0]).toContain('createCanvas refused the board');
  });

  test('a refused join that drops the canvases names both of them', async () => {
    const { deps, logged } = fakes();
    let attempts = 0;
    await register({
      ...deps,
      tools: undefined,
      hooks: undefined,
      joinSession: async (config: Record<string, unknown>) => {
        attempts += 1;
        if ('canvases' in config) throw new Error(`refused attempt ${attempts}`);
        return { log: async (message: string) => void logged.push(message) };
      },
    });
    expect(logged[0]).toContain('joined without the decision-review and decision-board canvases after');
  });
});

/**
 * Fix round 1 of the review of #G (CHANGES_REQUESTED): a focus result that
 * could report another call's neighborhood (M1), panels that shared one filter
 * (M2), guards no test covered (M3), and the Lows.
 */
describe('fix round 1', () => {
  type Gate = { promise: Promise<void>; release: () => void };
  const gate = (): Gate => {
    let release = () => {};
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };
  const focusedGraph = (args: string[]) => {
    const i = args.indexOf('--focus');
    if (i < 0) return defaultGraph();
    return graphJson([graphNode(args[i + 1] as string)], []);
  };
  /** A CLI whose `--focus <id>` reads wait on that id's gate, if it has one. */
  function gatedCli(gates: Record<string, Gate> = {}, queueAnswers: Array<{ gate?: Gate; stdout: string }> = []) {
    const calls: Call[] = [];
    let queueCalls = 0;
    const run = async (command: string, args: string[], { cwd, signal }: { cwd: string; signal?: AbortSignal }) => {
      calls.push({ command, args, cwd, signal });
      if (args.includes('graph')) {
        const i = args.indexOf('--focus');
        const id = i >= 0 ? (args[i + 1] as string) : '';
        if (gates[id]) await gates[id].promise;
        return ok(focusedGraph(args));
      }
      const answer = queueAnswers[queueCalls++];
      if (answer?.gate) await answer.gate.promise;
      return ok(answer?.stdout ?? queueReport([queueItem('0003')]));
    };
    return { run, calls };
  }
  const ids = (state: any) => state.graph.nodes.map((node: { id: string }) => node.id);

  test('M1: overlapping focus calls, slow first: the slow one is dropped, and every result reports the filter its own graph was computed with', async () => {
    const slow = gate();
    const cli = gatedCli({ '0001': slow });
    const { options } = makeBoard({ run: cli.run });
    await openBoard(options);
    const first = action(options, 'focus')({ id: '0001' });
    const second = await action(options, 'focus')({ id: '0002' });
    expect(second.superseded).toBeUndefined();
    expect(second.filter).toEqual({ id: '0002', kinds: [] });
    expect(ids(second)).toEqual(['0002']);
    slow.release();
    const late = await first;
    expect(late.superseded).toBe(true);
    // The late call is told it was superseded, and what it is shown is a consistent pair.
    expect(late.filter).toEqual(late.graph.filter);
    expect(late.filter.id).toBe('0002');
    expect(ids(late)).toEqual(['0002']);
    const now = await action(options, 'get_state')();
    expect(now.filter.id).toBe('0002');
    expect(ids(now)).toEqual(['0002']);
  });

  test('M1: get_state while a focus is pending reports the graph it has and that graph\'s own filter', async () => {
    const slow = gate();
    const cli = gatedCli({ '0001': slow });
    const { options } = makeBoard({ run: cli.run });
    await openBoard(options);
    const pending = action(options, 'focus')({ id: '0001' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const mid = await action(options, 'get_state')();
    expect(mid.filter).toEqual({ id: null, kinds: [] });
    expect(ids(mid)).toEqual(['0001', '0002', '0003']);
    slow.release();
    const done = await pending;
    expect(done.filter.id).toBe('0001');
    expect(ids(done)).toEqual(['0001']);
  });

  test('M2: opening panel B with a focus leaves panel A\'s filter, graph, and page unchanged', async () => {
    const cli = gatedCli();
    const { options } = makeBoard({ run: cli.run });
    const a = await openBoard(options, 'A');
    const frames: string[] = [];
    const stream = httpRequest(withPath(a.url, '/events'), (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => frames.push(chunk));
    });
    stream.on('error', () => {});
    stream.end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const b = await openBoard(options, 'B', { input: { id: '0002' } });
    expect(b.status).toContain('focus 0002');
    await action(options, 'focus')({ id: '0003' }, 'B');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stream.destroy();
    const stateA = await action(options, 'get_state')(undefined, 'A');
    expect(stateA.filter).toEqual({ id: null, kinds: [] });
    expect(ids(stateA)).toEqual(['0001', '0002', '0003']);
    expect(JSON.parse((await send(withPath(a.url, '/api/state'))).body).filter.id).toBeNull();
    const pushed = frames.join('');
    expect(pushed).toContain('event: state');
    expect(pushed).not.toContain('"id":"0002","kinds"');
    expect(pushed).not.toContain('"id":"0003","kinds"');
    const stateB = await action(options, 'get_state')(undefined, 'B');
    expect(stateB.filter.id).toBe('0003');
  });

  test('M3: every event-stream frame is held to the byte budget', async () => {
    const { options } = makeBoard({ bytesLimit: 900 });
    const { url } = await openBoard(options);
    const frames: string[] = [];
    let buffer = '';
    const stream = httpRequest(withPath(url, '/events'), (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          frames.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf('\n\n');
        }
      });
    });
    stream.on('error', () => {});
    stream.end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await postJson(url, '/api/refresh', {});
    await postJson(url, '/api/focus', { id: '0002' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stream.destroy();
    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      const data = frame.slice(frame.indexOf('data: ') + 'data: '.length);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(900);
    }
  });

  test('M3: a slower, older queue read does not overwrite a newer one', async () => {
    const slow = gate();
    const cli = gatedCli({}, [
      { stdout: queueReport([queueItem('0003')]) },
      { gate: slow, stdout: queueReport([queueItem('0010')]) },
      { stdout: queueReport([queueItem('0011')]) },
    ]);
    const { options } = makeBoard({ run: cli.run });
    await openBoard(options);
    const older = action(options, 'refresh')();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await action(options, 'refresh')();
    expect(newer.queue.items.map((item: { id: string }) => item.id)).toEqual(['0011']);
    slow.release();
    await older;
    const final = await action(options, 'get_state')();
    expect(final.queue.items.map((item: { id: string }) => item.id)).toEqual(['0011']);
  });

  test('L1: decision-review uses the shared postAllowed, so there is one copy of the POST check', () => {
    const source = readFileSync(join(packageRoot, 'extensions', 'adrkit', 'canvas.mjs'), 'utf8');
    expect(source).toContain('postAllowed(instance, req)');
    expect(source).not.toContain("req.headers['x-adrkit-token']");
    expect(source).not.toContain("req.headers['origin']");
  });

  test('L2: only supersedes edges carry an arrowhead', async () => {
    const graph = graphJson([graphNode('0001'), graphNode('0002'), graphNode('0003')], [
      { from: '0002', to: '0001', kind: 'supersedes' },
      { from: '0003', to: '0002', kind: 'relatesTo' },
      { from: '0003', to: '0001', kind: 'conflictsWith' },
    ]);
    const { options } = makeBoard({ run: fakeCli({ graph: ok(graph) }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    const board = (await renderBoardWith(state)).get('board') as FakeNode;
    const lines = board.all().filter((node) => node.tag === 'line');
    const marker = (kind: string) => lines.find((line) => line.attrs['class']?.includes(`edge-${kind}`))?.attrs['marker-end'];
    expect(marker('supersedes')).toBe('url(#arrow-supersedes)');
    expect(marker('relatesTo')).toBeUndefined();
    expect(marker('conflictsWith')).toBeUndefined();
    expect(board.all().filter((node) => node.tag === 'marker').map((node) => node.attrs['id'])).toEqual(['arrow-supersedes']);
  });

  test('L3: a broadcast keeps unapplied kind checkboxes, and a changed filter resyncs them', async () => {
    const { runInNewContext } = await import('node:vm');
    const base = { workingDirectory: CWD, graph: null, queue: null, notes: [], updatedAt: 'x' };
    const states = [
      { ...base, filter: { id: null, kinds: [] } },
      { ...base, filter: { id: null, kinds: [] } },
      { ...base, filter: { id: null, kinds: ['supersedes'] } },
    ];
    const nodes = new Map(PAGE_IDS.map((id) => [id, new FakeNode(id)]));
    let listener: ((event: { data: string }) => void) | undefined;
    class FakeEventSource {
      addEventListener(_type: string, fn: (event: { data: string }) => void) {
        listener = fn;
      }
    }
    runInNewContext(BOARD_JS, {
      window: { location: { search: '?token=t' } },
      document: {
        getElementById: (id: string) => nodes.get(id) ?? null,
        createElement: (tag: string) => new FakeNode(tag),
        createElementNS: (ns: string, tag: string) => new FakeNode(tag, ns),
      },
      fetch: async () => ({ ok: true, status: 200, json: async () => states[0] }),
      EventSource: FakeEventSource,
      URLSearchParams,
      Map,
      Set,
    });
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const box = nodes.get('kind-relatesTo') as FakeNode;
    box.checked = true; // the user ticks a box and has not pressed Apply
    listener?.({ data: JSON.stringify(states[1]) });
    expect(box.checked).toBe(true);
    listener?.({ data: JSON.stringify(states[2]) });
    expect(box.checked).toBe(false);
    expect((nodes.get('kind-supersedes') as FakeNode).checked).toBe(true);
  });

  test('L4: the action schemas give id the record-id pattern', () => {
    const { options } = makeBoard();
    const schemas = [options.inputSchema, options.actions.find((a: any) => a.name === 'focus').inputSchema];
    for (const schema of schemas) {
      expect(schema.properties.id.pattern).toBe(RECORD_ID.source);
      expect(new RegExp(schema.properties.id.pattern).test('0046')).toBe(true);
      expect(new RegExp(schema.properties.id.pattern).test('12')).toBe(false);
    }
  });

  test('L5: an id over 64 characters is refused, and one from the CLI is not drawn but counted', async () => {
    const long = '1'.repeat(65);
    const { options, cli } = makeBoard();
    await openBoard(options);
    const before = cli.calls.length;
    const error = await action(options, 'focus')({ id: long }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('invalid_input');
    expect((error as Error).message).toBe(INPUT_ERRORS.id);
    expect(cli.calls.length).toBe(before);

    const graph = graphJson([graphNode('0001'), graphNode(long)], [{ from: long, to: '0001', kind: 'supersedes' }]);
    const other = makeBoard({ run: fakeCli({ graph: ok(graph) }).run });
    await openBoard(other.options, 'long');
    const state = await action(other.options, 'get_state')(undefined, 'long');
    expect(ids(state)).toEqual(['0001']);
    expect(state.graph.edges).toEqual([]);
    expect(state.graph.notes).toContain(BOARD_NOTES.longIds(1));
    expect(JSON.stringify(state)).not.toContain(long.slice(0, 64));
  });

  test('L6: a layout past the extent cap is shown as a summary with a fixed note', async () => {
    const nodes = Array.from({ length: 120 }, (_, i) => graphNode(String(i + 1).padStart(4, '0')));
    // A 120-record cycle climbs to 119 columns, far past the extent cap.
    const edges = nodes.map((node, i) => ({ from: node.id, to: (nodes[(i + 1) % nodes.length] as { id: string }).id, kind: 'supersedes' }));
    const { options } = makeBoard({ run: fakeCli({ graph: ok(graphJson(nodes, edges)) }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.mode).toBe('summary');
    expect(state.graph.nodes).toEqual([]);
    expect(state.graph.notes).toContain(BOARD_NOTES.overExtent);
  });

  describe('L8: a model-chosen dir is confined to the session root', () => {
    for (const dir of ['../outside', '/etc', 'docs/../../x']) {
      test(`refresh({ dir: ${JSON.stringify(dir)} }) is refused before any spawn`, async () => {
        const { options, cli } = makeBoard();
        await openBoard(options);
        const before = cli.calls.length;
        const error = await action(options, 'refresh')({ dir }).catch((e: unknown) => e);
        expect((error as { code?: string }).code).toBe('invalid_input');
        expect((error as Error).message).toBe(INPUT_ERRORS.dirEscape);
        expect(cli.calls.length).toBe(before);
      });
    }

    test('open with an escaping dir starts no server and no process', async () => {
      const { options, cli, servers } = makeBoard();
      const error = await options.open(ctxFor('bad', { input: { dir: '..' } })).catch((e: unknown) => e);
      expect((error as Error).message).toBe(INPUT_ERRORS.dirEscape);
      expect(servers.length).toBe(0);
      expect(cli.calls.length).toBe(0);
    });

    test('a committed symlink out of the root is refused; a real directory inside is used', async () => {
      const root = mkdtempSync(join(tmpdir(), 'board-root-'));
      const outside = mkdtempSync(join(tmpdir(), 'board-out-'));
      try {
        mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
        symlinkSync(outside, join(root, 'linked'));
        const { options, cli } = makeBoard();
        await options.open(ctxFor('real', { session: { workingDirectory: root } }));
        opened.push({ onClose: options.onClose, instanceId: 'real' });
        const handler = options.actions.find((a: any) => a.name === 'refresh').handler;
        const call = (input: unknown) =>
          handler({ ...ctxFor('real'), session: { workingDirectory: root }, input }).catch((e: unknown) => e);
        expect(((await call({ dir: 'linked' })) as Error).message).toBe(INPUT_ERRORS.dirEscape);
        const fine = await call({ dir: 'docs/adr' });
        expect(fine.workingDirectory).toBe(root);
        expect(cli.calls.at(-1)?.args).toContain('docs/adr');
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

/** Round 2 of the review (R1-L1): per-panel views must not outlive their panel. */
describe('fix round 2: no view outlives its panel', () => {
  test('closing a panel during a gated focus leaves no view behind', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const run = async (_command: string, args: string[]) => {
      if (args.includes('--focus')) await held;
      return ok(args.includes('graph') ? defaultGraph() : queueReport([]));
    };
    const { options } = makeBoard({ run });
    await options.open(ctxFor('gone'));
    expect(options.viewCount()).toBe(1);
    const pending = action(options, 'focus')({ id: '0002' }, 'gone');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await options.onClose(ctxFor('gone'));
    release();
    await pending;
    expect(options.viewCount()).toBe(0);
  });

  test('closing a panel while its open is still in flight leaves no view behind', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const run = async (_command: string, args: string[]) => {
      if (args.includes('graph')) await held;
      return ok(args.includes('graph') ? defaultGraph() : queueReport([]));
    };
    const { options } = makeBoard({ run });
    const opening = options.open(ctxFor('opening'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const closing = options.onClose(ctxFor('opening'));
    release();
    await opening.catch(() => {});
    await closing;
    expect(options.viewCount()).toBe(0);
  });

  test('an action with no open panel stores no view', async () => {
    const { options } = makeBoard();
    const state = await action(options, 'get_state')(undefined, 'ghost');
    expect(state.graph.nodes.length).toBe(3);
    await action(options, 'focus')({ id: '0002' }, 'ghost');
    await action(options, 'refresh')(undefined, 'ghost');
    const handler = options.actions.find((a: any) => a.name === 'get_state').handler;
    await handler({ session: { workingDirectory: CWD } });
    expect(options.viewCount()).toBe(0);
  });

  test('an open that fails leaves no view behind, and a later close is harmless', async () => {
    const { options } = makeBoard({
      createServer: () => {
        throw new Error('no server');
      },
    });
    await expect(options.open(ctxFor('failed'))).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.viewCount()).toBe(0);
    await options.onClose(ctxFor('failed'));
    expect(options.viewCount()).toBe(0);
  });

  test('closing an idle panel removes its view', async () => {
    const { options } = makeBoard();
    await options.open(ctxFor('idle'));
    expect(options.viewCount()).toBe(1);
    await options.onClose(ctxFor('idle'));
    expect(options.viewCount()).toBe(0);
  });
});

/** After rebasing onto #272: the board's failure notes follow its fixed-message mapping. */
describe('rebase onto the hardened runCommand', () => {
  test('a session directory that no longer exists gets its own fixed note, not "could not be started"', async () => {
    const gone = Object.assign(new Error('spawn SECRET ENOENT'), { code: 'ENOENT', missing: 'cwd', tool: 'adr' });
    const { options } = makeBoard({ run: fakeCli({ graph: gone }).run });
    await openBoard(options);
    const state = await action(options, 'get_state')();
    expect(state.graph.notes).toEqual([BOARD_NOTES.cwdMissing]);
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  test('extension.mjs runs the board through spawn, like every other component', () => {
    const source = readFileSync(join(packageRoot, 'extensions', 'adrkit', 'extension.mjs'), 'utf8');
    expect(source).not.toMatch(/\bexecFile\b/);
    const board = source.slice(source.indexOf('createDecisionBoardCanvas({'));
    expect(board.slice(0, board.indexOf('makeError'))).toContain('runCommand(command, args, { cwd, signal, spawn })');
  });
});
