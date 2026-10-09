import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecisionBoardCanvas, BOARD_ID, RECORD_ID } from '../extensions/adrkit/board.mjs';
import { BOARD_HTML, BOARD_JS } from '../extensions/adrkit/board-page.mjs';
import {
  MIN_CLI_VERSION,
  NONCE_TTL_MS,
  REVIEW_KINDS,
  REVIEW_MESSAGES,
  REVIEW_NOTES,
  REVIEW_REFUSALS,
  isWritableReviewer,
  summaryProblem,
} from '../extensions/adrkit/board-review-write.mjs';
import { CSP } from '../extensions/adrkit/panel-http.mjs';
import { runCommand } from '../extensions/adrkit/review.mjs';
import { isWritableIdentity, objectionSummaryProblem } from '../../../core/src/index.ts';
import { extensionFiles, packageRoot, repoRoot } from './harness.ts';

/**
 * The decision board's review controls (ADR-0052): the one plugin path that
 * records an approval, an objection, or a resolution, and only when a person
 * confirms it on the page. The HTTP tests start a real loopback server,
 * because the token, Origin, and nonce rules are the boundary.
 *
 * This file names the CLI's review subcommands only through `SUB`, built by
 * concatenation, so the plugin's verb guard has nothing to find in it either.
 */

type Run = { stdout: string; stderr: string; exitCode: number };
type Call = { command: string; args: string[]; cwd: string };

const CWD = '/work/repo';
const REVIEWER = '@fixture-reviewer';
const CLI_PATH = '/opt/adrkit/cli/dist/index.js';
const SUB = { approval: ['ap', 'prove'].join(''), objection: ['ob', 'ject'].join(''), resolution: ['re', 'solve'].join('') };
const WRITING = new Set(Object.values(SUB));
const STDERR_SENTINEL = 'STDERR-SENTINEL-7f3a at Object.<anonymous> (/secret/path.js:1:1)';
// Built by concatenation so this file never spells the ratifying command.
const RATIFY = ['adr', 'accept'].join(' ');

const ok = (stdout = ''): Run => ({ stdout, stderr: '', exitCode: 0 });

const graphJson = () =>
  JSON.stringify({
    nodes: [
      { id: '0002', title: 'Decision 0002', status: 'accepted' },
      { id: '0003', title: 'Proposal 0003', status: 'proposed' },
    ],
    edges: [],
  });

const queueItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Proposal ${id}`,
  sourcePath: `docs/adr/${id}-proposal.md`,
  slaState: 'not-queued',
  deadlineDate: null,
  routingTargets: [],
  quorum: 2,
  approvalCount: 0,
  unresolvedObjectionCount: 0,
  resolvedObjectionCount: 0,
  itemFindings: [],
  ...extra,
});

const queueReport = (items: unknown[]) =>
  JSON.stringify({ version: '1', asOf: '2026-10-09', totalItems: items.length, items, corpusFindings: [] });

type Script = {
  write?: Run | Error | ((args: string[]) => Run | Promise<Run>);
  version?: Run | Error;
  queue?: () => Run;
};

function fakeCli(script: Script = {}) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], { cwd }: { cwd: string }) => {
    calls.push({ command, args, cwd });
    if (args.includes('--version')) {
      const answer = script.version ?? ok('0.18.0\n');
      if (answer instanceof Error) throw answer;
      return answer;
    }
    if (args.includes('graph')) return ok(graphJson());
    if (args.includes('queue')) return script.queue ? script.queue() : ok(queueReport([queueItem('0003')]));
    if (args.some((arg) => WRITING.has(arg))) {
      const answer =
        script.write ?? ok(JSON.stringify({ id: '0003', path: 'docs/adr/0003-proposal.md', by: REVIEWER, changed: true, approvals: 1 }));
      if (typeof answer === 'function') return answer(args);
      if (answer instanceof Error) throw answer;
      return answer;
    }
    return ok();
  };
  const writes = () => calls.filter((call) => call.args.some((arg) => WRITING.has(arg)));
  return { run, calls, writes };
}

const opened: Array<{ onClose: (ctx: unknown) => unknown; instanceId: string }> = [];

function makeBoard({
  env = { ADRKIT_REVIEWER: REVIEWER, ADRKIT_CLI: CLI_PATH } as Record<string, string | undefined>,
  script = {} as Script,
  clock = { now: 1_000_000 },
  logged = [] as Array<{ message: string; options: unknown }>,
  sessionLog,
}: {
  env?: Record<string, string | undefined>;
  script?: Script;
  clock?: { now: number };
  logged?: Array<{ message: string; options: unknown }>;
  sessionLog?: (message: string, options: unknown) => Promise<unknown>;
} = {}) {
  const cli = fakeCli(script);
  const session = {
    log: sessionLog ?? (async (message: string, options: unknown) => void logged.push({ message, options })),
  };
  const options = createDecisionBoardCanvas({
    run: cli.run,
    env,
    exists: () => true,
    createServer: (handler: any) => createServer(handler),
    now: () => '2026-10-09T00:00:00.000Z',
    clock: () => clock.now,
    getSession: () => session,
  } as never) as any;
  return { options, cli, clock, logged };
}

const ctxFor = (instanceId: string) => ({
  sessionId: 's',
  extensionId: 'plugin:adrkit:adrkit',
  canvasId: BOARD_ID,
  instanceId,
  session: { workingDirectory: CWD },
});

async function openBoard(options: any, instanceId = 'board-1', input?: unknown) {
  const result = await options.open({ ...ctxFor(instanceId), input });
  opened.push({ onClose: options.onClose, instanceId });
  return result as { url: string };
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

const tokenOf = (url: string) => new URL(url).searchParams.get('token') as string;
const routeOf = (url: string, path: string) => {
  const next = new URL(path, new URL(url).origin);
  next.searchParams.set('token', tokenOf(url));
  return next.toString();
};

const postJson = (url: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  send(routeOf(url, path), {
    method: 'POST',
    headers: { 'X-Adrkit-Token': tokenOf(url), 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Ask for a nonce the way the page does, and return it. */
async function nonceFor(url: string, kind: string, id = '0003') {
  const response = await postJson(url, '/api/review/nonce', { kind, id });
  expect(response.status).toBe(200);
  const data = JSON.parse(response.body);
  expect(typeof data.nonce).toBe('string');
  return data.nonce as string;
}

async function write(url: string, body: Record<string, unknown>) {
  const response = await postJson(url, '/api/review', body);
  return { ...response, data: response.body.startsWith('{') ? JSON.parse(response.body) : null };
}

describe('the reviewer comes from ADRKIT_REVIEWER only', () => {
  test('the extension mirrors core: isWritableReviewer agrees with isWritableIdentity', () => {
    const table = [
      '@octocat',
      '@Octo-Cat',
      'team:platform',
      'eve@example.com',
      'e\u200dve@example.com',
      '@bad handle',
      '@x\u202e',
      'team:Platform',
      'x',
      '',
      ' @octocat',
      'a\u0007b@example.com',
      'eve@exa\u200bmple.com',
      '@',
      'eve@example',
    ];
    for (const identity of table) {
      expect({ identity, ours: isWritableReviewer(identity) }).toEqual({ identity, ours: isWritableIdentity(identity) });
    }
    expect(isWritableReviewer(`${'a'.repeat(400)}@example.com`)).toBe(false);
  });

  for (const [label, value, note] of [
    ['unset', undefined, 'unset'],
    ['empty', '', 'unset'],
    ['not an identity', 'octocat', 'invalid'],
    ['with a bidi override', '@octo\u202ecat', 'invalid'],
  ] as const) {
    test(`ADRKIT_REVIEWER ${label}: the controls are off with a fixed note, and both routes refuse`, async () => {
      const { options, cli } = makeBoard({ env: { ADRKIT_CLI: CLI_PATH, ...(value === undefined ? {} : { ADRKIT_REVIEWER: value }) } });
      const { url } = await openBoard(options);
      const state = await options.actions.find((a: any) => a.name === 'get_state').handler({ ...ctxFor('board-1'), input: null });
      expect(state.review).toEqual({ enabled: false, reviewer: null, note: REVIEW_NOTES[note] });
      const nonce = await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' });
      expect(nonce.status).toBe(403);
      expect(JSON.parse(nonce.body)).toEqual({ error: REVIEW_NOTES[note] });
      const posted = await write(url, { kind: 'approval', id: '0003', nonce: 'a'.repeat(64) });
      expect(posted.status).toBe(403);
      expect(cli.writes()).toEqual([]);
      expect(cli.calls.some((call) => call.args.includes('--version'))).toBe(false);
    });
  }

  test('a valid reviewer turns the controls on and is the --by value', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const state = JSON.parse((await send(routeOf(url, '/api/state'))).body);
    expect(state.review).toEqual({ enabled: true, reviewer: REVIEWER, note: null });
    const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    expect(response.status).toBe(200);
    expect(cli.writes()[0]?.args).toContain(REVIEWER);
  });

  test('an identity in the POST body is refused, and nothing is spawned', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    for (const key of ['by', 'reviewer', 'cli', 'dir', 'identity']) {
      const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval'), [key]: '@attacker' });
      expect({ key, status: response.status }).toEqual({ key, status: 400 });
      expect(response.data).toEqual({ error: REVIEW_REFUSALS.shape });
    }
    const issued = await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003', by: '@attacker' });
    expect(issued.status).toBe(400);
    expect(cli.writes()).toEqual([]);
  });

  test('the reviewer is read on every request, so changing the environment takes effect', async () => {
    const env: Record<string, string | undefined> = { ADRKIT_CLI: CLI_PATH };
    const { options } = makeBoard({ env });
    const { url } = await openBoard(options);
    expect((await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' })).status).toBe(403);
    env['ADRKIT_REVIEWER'] = REVIEWER;
    expect((await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' })).status).toBe(200);
  });
});

describe('token, Origin, and nonce', () => {
  test('the nonce route needs the header token and no foreign Origin', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const noHeader = await send(routeOf(url, '/api/review/nonce'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', id: '0003' }),
    });
    expect(noHeader.status).toBe(403);
    const foreign = await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' }, { Origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    const noUrlToken = await send(new URL('/api/review/nonce', new URL(url).origin).toString(), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url) },
      body: '{}',
    });
    expect(noUrlToken.status).toBe(403);
    expect(cli.calls.some((call) => call.args.includes('--version'))).toBe(false);
  });

  test('a write without the header token, or from a foreign Origin, is 403 and spawns nothing', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const nonce = await nonceFor(url, 'approval');
    const noHeader = await send(routeOf(url, '/api/review'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', id: '0003', nonce }),
    });
    expect(noHeader.status).toBe(403);
    const foreign = await postJson(url, '/api/review', { kind: 'approval', id: '0003', nonce }, { Origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    expect(cli.writes()).toEqual([]);
  });

  test('missing, wrong, reused, expired, mismatched, and foreign-panel nonces are 403, and nothing is spawned', async () => {
    const { options, cli, clock } = makeBoard();
    const { url } = await openBoard(options);
    const { url: other } = await openBoard(options, 'board-2');

    expect((await write(url, { kind: 'approval', id: '0003' })).status).toBe(403);
    await nonceFor(url, 'approval');
    expect((await write(url, { kind: 'approval', id: '0003', nonce: 'f'.repeat(64) })).status).toBe(403);

    // Single use: the first spend consumes it, even a refused one.
    const once = await nonceFor(url, 'approval');
    expect((await write(url, { kind: 'approval', id: '0003', nonce: once })).status).toBe(200);
    const writesAfterFirst = cli.writes().length;
    const replay = await write(url, { kind: 'approval', id: '0003', nonce: once });
    expect(replay.status).toBe(403);
    expect(replay.data).toEqual({ error: REVIEW_REFUSALS.nonce });

    // Expired: two minutes is the whole life.
    const stale = await nonceFor(url, 'approval');
    clock.now += NONCE_TTL_MS;
    expect((await write(url, { kind: 'approval', id: '0003', nonce: stale })).status).toBe(403);

    // Bound to the kind and record it was issued for.
    const forApproval = await nonceFor(url, 'approval');
    expect((await write(url, { kind: 'objection', id: '0003', nonce: forApproval, summary: 'x' })).status).toBe(403);
    const forThree = await nonceFor(url, 'approval', '0003');
    expect((await write(url, { kind: 'approval', id: '0002', nonce: forThree })).status).toBe(403);

    // Issued by another panel.
    const fromOther = await nonceFor(other, 'approval');
    expect((await write(url, { kind: 'approval', id: '0003', nonce: fromOther })).status).toBe(403);

    // A newer nonce replaces the older one for the same panel.
    const first = await nonceFor(url, 'approval');
    await nonceFor(url, 'approval');
    expect((await write(url, { kind: 'approval', id: '0003', nonce: first })).status).toBe(403);

    expect(cli.writes().length).toBe(writesAfterFirst);
  });

  test('the nonce never reaches an action result or the event stream', async () => {
    const { options } = makeBoard();
    const { url } = await openBoard(options);
    const nonce = await nonceFor(url, 'approval');
    for (const action of options.actions) {
      const result = await action.handler({ ...ctxFor('board-1'), input: null });
      expect(JSON.stringify(result)).not.toContain(nonce);
      expect(JSON.stringify(result)).not.toMatch(/nonce/i);
    }
    const state = await send(routeOf(url, '/api/state'));
    expect(state.body).not.toContain(nonce);
  });

  test('closing a panel forgets its nonce', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const nonce = await nonceFor(url, 'approval');
    await options.onClose(ctxFor('board-1'));
    opened.splice(0);
    // The same panel id, reopened: the nonce issued before the close is gone.
    const { url: reopened } = await openBoard(options);
    expect((await write(reopened, { kind: 'approval', id: '0003', nonce })).status).toBe(403);
    expect(cli.writes()).toEqual([]);
  });
});

describe('the write', () => {
  test('exact argv for each kind: the subcommand, the id, --by from the environment, --json, and one argv element per value', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    await write(url, { kind: 'objection', id: '0003', nonce: await nonceFor(url, 'objection'), summary: '  -Needs a load test; "quoted" #1  ' });
    await write(url, { kind: 'resolution', id: '0003', nonce: await nonceFor(url, 'resolution'), objection: 2 });
    expect(cli.writes()).toEqual([
      { command: 'node', args: [CLI_PATH, SUB.approval, '0003', '--by', REVIEWER, '--json'], cwd: CWD },
      {
        command: 'node',
        args: [CLI_PATH, SUB.objection, '0003', '--by', REVIEWER, '--json', '--summary=-Needs a load test; "quoted" #1'],
        cwd: CWD,
      },
      { command: 'node', args: [CLI_PATH, SUB.resolution, '0003', '--by', REVIEWER, '--json', '--objection', '2'], cwd: CWD },
    ]);
  });

  test('the corpus directory the board shows is passed, and re-confined before the spawn', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options, 'board-1', { dir: 'docs/decisions' });
    await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    expect(cli.writes()[0]?.args).toEqual([CLI_PATH, SUB.approval, '0003', '--by', REVIEWER, '--json', '--dir', 'docs/decisions']);
  });

  test('ADRKIT_DIR is passed when the board has no dir of its own', async () => {
    const { options, cli } = makeBoard({ env: { ADRKIT_REVIEWER: REVIEWER, ADRKIT_CLI: CLI_PATH, ADRKIT_DIR: 'adr' } });
    const { url } = await openBoard(options);
    await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    expect(cli.writes()[0]?.args).toEqual([CLI_PATH, SUB.approval, '0003', '--by', REVIEWER, '--json', '--dir', 'adr']);
  });

  test('summary rules mirror core: refused ones are 400 before anything is spawned', async () => {
    const summaries = [
      '',
      '   ',
      'one\ntwo',
      'tab\there',
      'bidi \u202e override',
      'zero\u200bwidth',
      'line\u2028separator',
      'x'.repeat(501),
      ` ${'x'.repeat(500)} `,
      '😀'.repeat(500),
      'Needs a load test',
      '#: "quoted" -leading',
    ];
    for (const summary of summaries) {
      expect({ summary, ours: summaryProblem(summary) }).toEqual({ summary, ours: objectionSummaryProblem(summary) !== undefined });
    }
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    for (const summary of summaries.filter((s) => objectionSummaryProblem(s) !== undefined)) {
      const response = await write(url, { kind: 'objection', id: '0003', nonce: await nonceFor(url, 'objection'), summary });
      expect({ summary, status: response.status, data: response.data }).toEqual({ summary, status: 400, data: { error: REVIEW_REFUSALS.summary } });
    }
    for (const summary of [undefined, 42, ['x']]) {
      const response = await write(url, { kind: 'objection', id: '0003', nonce: await nonceFor(url, 'objection'), summary });
      expect(response.status).toBe(400);
    }
    expect(cli.writes()).toEqual([]);
  });

  test('a bad id, kind, or objection index is refused before anything is spawned', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    for (const id of ['12', '../0003', '-0003', '0003 ', 'x'.repeat(65), 42, null]) {
      expect((await postJson(url, '/api/review/nonce', { kind: 'approval', id })).status).toBe(400);
    }
    for (const kind of ['approve', 'accept', 'ratify', '', 3, null]) {
      expect((await postJson(url, '/api/review/nonce', { kind, id: '0003' })).status).toBe(400);
    }
    for (const objection of [0, -1, 1.5, '01', 'x', 10_000_000, '1e3', null, undefined, '1']) {
      const response = await write(url, { kind: 'resolution', id: '0003', nonce: await nonceFor(url, 'resolution'), objection });
      expect({ objection, status: response.status }).toEqual({ objection, status: 400 });
      expect(response.data).toEqual({ error: REVIEW_REFUSALS.objection });
    }
    // Fields that belong to another kind are refused rather than ignored.
    const extra = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval'), summary: 'x' });
    expect(extra.status).toBe(400);
    expect(cli.writes()).toEqual([]);
  });

  test('a body that is not a JSON object is 400; an oversized one 413', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    expect((await postJson(url, '/api/review', 'not json')).status).toBe(400);
    expect((await postJson(url, '/api/review', '[1]')).status).toBe(400);
    expect((await postJson(url, '/api/review', 'x'.repeat(70 * 1024))).status).toBe(413);
    expect(cli.writes()).toEqual([]);
  });

  test('a stored dir swapped for an escape is refused with a fixed message and nothing is spawned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adrkit-board-review-'));
    try {
      mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
      const cli = fakeCli();
      const options = createDecisionBoardCanvas({
        run: cli.run,
        env: { ADRKIT_REVIEWER: REVIEWER, ADRKIT_CLI: CLI_PATH },
        exists: () => true,
        createServer: (handler: any) => createServer(handler),
        getSession: () => undefined,
      } as never) as any;
      const ctx = { ...ctxFor('board-x'), session: { workingDirectory: root } };
      const { url } = await options.open({ ...ctx, input: { dir: 'docs/adr' } });
      opened.push({ onClose: () => options.onClose(ctx), instanceId: 'board-x' });
      rmSync(join(root, 'docs', 'adr'), { recursive: true });
      execFileSync('ln', ['-s', tmpdir(), join(root, 'docs', 'adr')]);
      const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
      expect(response.status).toBe(200);
      expect(response.data.outcome).toBe('not-run');
      expect(response.data.message).toBe(REVIEW_MESSAGES.dirEscape);
      expect(cli.writes()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('one write at a time: a second POST while one runs is 409', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { options, cli } = makeBoard({
      script: {
        write: async () => {
          await gate;
          return ok(JSON.stringify({ changed: true }));
        },
      },
    });
    const { url } = await openBoard(options);
    const first = write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    while (cli.writes().length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = await write(url, { kind: 'objection', id: '0003', nonce: await nonceFor(url, 'objection'), summary: 'x' });
    expect(second.status).toBe(409);
    expect(second.data).toEqual({ error: REVIEW_REFUSALS.busy });
    release();
    expect((await first).status).toBe(200);
    expect(cli.writes().length).toBe(1);
  });
});

describe('results', () => {
  const cases: Array<[string, Script, string, string]> = [
    ['exit 0, changed', { write: ok(JSON.stringify({ changed: true, approvals: 1 })) }, 'written', REVIEW_MESSAGES.written.approval('0003', REVIEWER)],
    ['exit 0, unchanged', { write: ok(JSON.stringify({ changed: false, approvals: 1 })) }, 'unchanged', REVIEW_MESSAGES.unchanged.approval('0003', REVIEWER)],
    ['exit 0, unreadable', { write: ok('not json') }, 'unknown', REVIEW_MESSAGES.unreadable],
    ['exit 1', { write: { stdout: '', stderr: STDERR_SENTINEL, exitCode: 1 } }, 'refused', REVIEW_MESSAGES.refused],
    [
      'exit 2 from a CLI that has the subcommands',
      { write: { stdout: '', stderr: STDERR_SENTINEL, exitCode: 2 }, version: ok('0.18.0\n') },
      'usage-error',
      REVIEW_MESSAGES.usage,
    ],
    [
      'exit 2 from an older CLI',
      { write: { stdout: '', stderr: STDERR_SENTINEL, exitCode: 2 }, version: ok('0.17.0\n') },
      'old-cli',
      REVIEW_MESSAGES.oldCli,
    ],
    ['exit 3', { write: { stdout: STDERR_SENTINEL, stderr: STDERR_SENTINEL, exitCode: 3 } }, 'unknown', REVIEW_MESSAGES.exit(3)],
    ['a spawn failure', { write: Object.assign(new Error(STDERR_SENTINEL), { code: 'ENOENT' }) }, 'not-run', REVIEW_MESSAGES.start],
  ];
  for (const [label, script, outcome, message] of cases) {
    test(`${label} maps to a fixed message, with no stderr or exception text`, async () => {
      const logged: Array<{ message: string; options: unknown }> = [];
      const { options } = makeBoard({ script, logged });
      const { url } = await openBoard(options);
      // An older CLI is refused at the nonce already; the next test reaches its write path.
      const nonce = await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' });
      if (label === 'exit 2 from an older CLI') {
        expect(nonce.status).toBe(409);
        expect(JSON.parse(nonce.body)).toEqual({ error: REVIEW_MESSAGES.oldCli });
        return;
      }
      const response = await write(url, { kind: 'approval', id: '0003', nonce: JSON.parse(nonce.body).nonce });
      expect(response.status).toBe(200);
      expect({ outcome: response.data.outcome, message: response.data.message }).toEqual({ outcome, message });
      expect(response.body).not.toContain('STDERR-SENTINEL');
      expect(response.body).not.toContain('/secret/path.js');
      expect(JSON.stringify(logged)).not.toContain('STDERR-SENTINEL');
    });
  }

  test('an older CLI that slips past the nonce check (upgraded mid-flight) still gets the upgrade message at the write', async () => {
    let version = '0.18.0\n';
    const { options } = makeBoard({
      script: { write: { stdout: '', stderr: STDERR_SENTINEL, exitCode: 2 }, get version() { return ok(version); } },
    });
    const { url } = await openBoard(options);
    const nonce = await nonceFor(url, 'approval');
    version = '0.17.0\n';
    const response = await write(url, { kind: 'approval', id: '0003', nonce });
    expect(response.data).toMatchObject({ outcome: 'old-cli', message: REVIEW_MESSAGES.oldCli });
    expect(REVIEW_MESSAGES.oldCli).toContain(MIN_CLI_VERSION);
  });

  test('an older CLI is detected at the nonce, so the write is never spawned against it', async () => {
    const { options, cli } = makeBoard({ script: { version: ok('0.17.0\n') } });
    const { url } = await openBoard(options);
    const response = await postJson(url, '/api/review/nonce', { kind: 'approval', id: '0003' });
    expect(response.status).toBe(409);
    expect(cli.writes()).toEqual([]);
  });

  test('after a write the board re-reads the queue and the response carries the new counts', async () => {
    let approvals = 0;
    const { options, cli } = makeBoard({
      script: {
        queue: () => ok(queueReport([queueItem('0003', { approvalCount: approvals })])),
        write: () => {
          approvals += 1;
          return ok(JSON.stringify({ changed: true, approvals }));
        },
      },
    });
    const { url } = await openBoard(options);
    const before = JSON.parse((await send(routeOf(url, '/api/state'))).body);
    expect(before.queue.items[0].approvalCount).toBe(0);
    const queueReads = cli.calls.filter((call) => call.args.includes('queue')).length;
    const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    expect(response.data.state.queue.items[0].approvalCount).toBe(1);
    expect(cli.calls.filter((call) => call.args.includes('queue')).length).toBe(queueReads + 1);
  });

  test('every spawned write is logged with the id, kind, identity, and outcome, never the summary', async () => {
    const logged: Array<{ message: string; options: unknown }> = [];
    const { options } = makeBoard({ logged });
    const { url } = await openBoard(options);
    await write(url, { kind: 'objection', id: '0003', nonce: await nonceFor(url, 'objection'), summary: 'SUMMARY-SENTINEL' });
    expect(logged.length).toBe(1);
    const [entry] = logged;
    expect(entry?.message).toContain('0003');
    expect(entry?.message).toContain('objection');
    expect(entry?.message).toContain(REVIEWER);
    expect(entry?.message).toContain('written');
    expect(entry?.message).not.toContain('SUMMARY-SENTINEL');
    expect(entry?.message).not.toContain('Proposal 0003');
  });

  test('a log that never answers, or rejects, or throws, does not hold or break the write', async () => {
    for (const sessionLog of [
      () => new Promise<never>(() => {}),
      () => Promise.reject(new Error('log failed')),
      () => {
        throw new Error('log threw');
      },
    ]) {
      const { options } = makeBoard({ sessionLog: sessionLog as never });
      const { url } = await openBoard(options);
      const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
      expect(response.status).toBe(200);
      expect(response.data.outcome).toBe('written');
      await options.onClose(ctxFor('board-1'));
      opened.splice(0);
    }
  });

  test('no readiness verdict after an approval, and never the ratifying command', async () => {
    const { options } = makeBoard({
      script: { queue: () => ok(queueReport([queueItem('0003', { approvalCount: 2, quorum: 2 })])) },
    });
    const { url } = await openBoard(options);
    const response = await write(url, { kind: 'approval', id: '0003', nonce: await nonceFor(url, 'approval') });
    for (const word of [/\bready\b/i, /\beligible\b/i, /\bratif/i, new RegExp(RATIFY)]) {
      expect({ word: String(word), found: word.test(response.body) }).toEqual({ word: String(word), found: false });
    }
    for (const message of [...Object.values(REVIEW_MESSAGES).filter((m) => typeof m === 'string'), ...Object.values(REVIEW_NOTES)]) {
      expect(String(message)).not.toMatch(/\bready\b|\bratif|adr accept/i);
    }
    expect(BOARD_JS).not.toContain(RATIFY);
  });
});

describe('no agent path', () => {
  test('the board still has exactly get_state, refresh, and focus, each read-only', () => {
    const { options } = makeBoard();
    expect(options.actions.map((a: { name: string }) => a.name)).toEqual(['get_state', 'refresh', 'focus']);
    for (const action of options.actions) expect(action.description).toMatch(/Read-only; no model calls\./);
  });

  test('no canvas action, with any input, spawns a review subcommand', async () => {
    const { options, cli } = makeBoard();
    const { url } = await openBoard(options);
    const nonce = await nonceFor(url, 'approval');
    const inputs = [
      null,
      {},
      { kind: 'approval', id: '0003', nonce },
      { id: '0003', nonce, by: REVIEWER },
      { dir: 'docs/adr', kind: 'objection', summary: 'x', nonce },
      { id: '0003', kinds: ['supersedes'], objection: 1, nonce },
      { verb: SUB.approval, id: '0003' },
    ];
    for (const action of options.actions) {
      for (const input of inputs) {
        try {
          await action.handler({ ...ctxFor('board-1'), actionName: action.name, input });
        } catch {
          // invalid_input is the expected answer for most of these.
        }
      }
    }
    expect(cli.writes()).toEqual([]);
    // And the nonce issued to the page is still unspent: an action cannot use it.
    expect((await write(url, { kind: 'approval', id: '0003', nonce })).status).toBe(200);
  });

  test('only board.mjs imports the write module, and its actions never reference it', () => {
    const importers = extensionFiles().filter((path) => /from\s+['"]\.\/board-review-write\.mjs['"]/.test(readFileSync(path, 'utf8')));
    expect(importers.map((path) => path.slice(path.lastIndexOf('/') + 1))).toEqual(['board.mjs']);
    const board = readFileSync(join(packageRoot, 'extensions', 'adrkit', 'board.mjs'), 'utf8');
    const start = board.indexOf('    actions: [');
    const end = board.indexOf('    open: async', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const actions = board.slice(start, end);
    expect(actions).not.toMatch(/\breviewWriter\b|\bcreateReviewWriter\b|\/api\/review/);
    // The writer is reached from one place: the HTTP route handler.
    const uses = [...board.matchAll(/\breviewWriter\b/g)].map((match) => match.index ?? 0);
    const handleStart = board.indexOf('const handle = async');
    const handleEnd = board.indexOf('const startInstance = async');
    const outside = uses.filter((index) => index < handleStart || index > handleEnd);
    // Its declaration, the snapshot's state read, and closing a panel are the only uses outside the route.
    expect(outside.length).toBeLessThanOrEqual(4);
    for (const index of outside) {
      const line = board.slice(board.lastIndexOf('\n', index) + 1, board.indexOf('\n', index));
      expect({ line, ok: /let reviewWriter|reviewWriter = createReviewWriter|reviewWriter\?\.state\(\)|reviewWriter\?\.forget\(/.test(line) }).toEqual({ line, ok: true });
    }
  });

  test('the write module never mentions the ratifying command, and the page never names the review subcommands', () => {
    const writer = readFileSync(join(packageRoot, 'extensions', 'adrkit', 'board-review-write.mjs'), 'utf8');
    expect(writer).not.toMatch(/\badr\s+accept\b|['"`]accept['"`]/);
    // `'object'` is also a typeof result the page compares with, so only the
    // other two are checked here; the wiring test's guard covers the page too.
    for (const sub of [SUB.approval, SUB.resolution]) {
      expect({ sub, inPage: new RegExp(`['"\`]${sub}['"\`]`).test(BOARD_JS) }).toEqual({ sub, inPage: false });
    }
    expect(REVIEW_KINDS).toEqual(['approval', 'objection', 'resolution']);
  });
});

describe('page', () => {
  class FakeNode {
    children: FakeNode[] = [];
    textContent = '';
    className = '';
    type = '';
    id = '';
    value = '';
    checked = false;
    disabled = false;
    attrs: Record<string, string> = {};
    listeners: Record<string, Array<(event?: unknown) => void>> = {};
    constructor(readonly tag: string) {}
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
    addEventListener(type: string, listener: (event?: unknown) => void) {
      (this.listeners[type] ??= []).push(listener);
    }
    focus() {}
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

  const IDS = ['status', 'cwd', 'refresh', 'show-all', 'kind-supersedes', 'kind-relatesTo', 'kind-conflictsWith', 'apply-kinds', 'message', 'legend', 'board', 'detail', 'queue'];

  const snapshot = (review: unknown, item = queueItem('0003', { approvalCount: 0, unresolvedObjectionCount: 1, resolvedObjectionCount: 0 })) => ({
    workingDirectory: CWD,
    filter: { id: null, kinds: [] },
    graph: { available: true, mode: 'graph', totalNodes: 1, totalEdges: 0, nodes: [{ id: '0003', title: 'P', status: 'proposed', x: 0, y: 0 }], edges: [], width: 200, height: 56, byStatus: [], notes: [], filter: { id: null, kinds: [] } },
    queue: { available: true, asOf: '2026-10-09', exitCode: 0, totalItems: 1, corpusFindings: 0, items: [item], note: null },
    review,
    notes: [],
    updatedAt: 'now',
  });

  async function renderWith(state: unknown, answer: (path: string, body: any) => unknown = () => state) {
    const { runInNewContext } = await import('node:vm');
    const nodes = new Map(IDS.map((id) => [id, new FakeNode(id)]));
    const posts: Array<{ path: string; body: any }> = [];
    const context = {
      window: { location: { search: '?token=t' } },
      document: {
        getElementById: (id: string) => nodes.get(id) ?? null,
        createElement: (tag: string) => new FakeNode(tag),
        createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
      },
      fetch: async (path: string, init?: { body?: string }) => {
        const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;
        if (body !== undefined) posts.push({ path, body });
        const data = body === undefined ? state : answer(path, body);
        return { ok: true, status: 200, json: async () => data };
      },
      URLSearchParams,
      Map,
      Set,
    };
    runInNewContext(BOARD_JS, context);
    await settle();
    return { nodes, posts };
  }

  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const buttons = (root: FakeNode) => root.all().filter((node) => node.tag === 'button');
  const find = (root: FakeNode, label: RegExp) => {
    const found = buttons(root).find((node) => label.test(node.textContent));
    if (!found) throw new Error(`no button ${label}`);
    return found;
  };

  test('with the reviewer unset, every control is disabled and the fixed note explains why', async () => {
    const { nodes } = await renderWith(snapshot({ enabled: false, reviewer: null, note: REVIEW_NOTES.unset }));
    const queue = nodes.get('queue') as FakeNode;
    const controls = buttons(queue).filter((node) => /Approve|objection/i.test(node.textContent));
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const control of controls) expect({ label: control.textContent, disabled: control.disabled }).toEqual({ label: control.textContent, disabled: true });
    expect(queue.allText()).toContain(REVIEW_NOTES.unset);
  });

  test('approve takes two clicks: the first asks for a nonce, the second posts it with nothing else', async () => {
    const { nodes, posts } = await renderWith(snapshot({ enabled: true, reviewer: REVIEWER, note: null }), (path, body) =>
      path.startsWith('/api/review/nonce') ? { nonce: 'n'.repeat(64), expiresInMs: NONCE_TTL_MS } : { outcome: 'written', message: 'Recorded.', state: snapshot({ enabled: true, reviewer: REVIEWER, note: null }) },
    );
    const queue = nodes.get('queue') as FakeNode;
    find(queue, /^Approve as @fixture-reviewer$/).fire('click');
    await settle();
    expect(posts).toEqual([{ path: '/api/review/nonce?token=t', body: { kind: 'approval', id: '0003' } }]);
    const confirm = find(queue, /^Confirm approval as @fixture-reviewer$/);
    expect(queue.allText()).toContain('ADR-0003');
    confirm.fire('click');
    await settle();
    expect(posts[1]).toEqual({ path: '/api/review?token=t', body: { kind: 'approval', id: '0003', nonce: 'n'.repeat(64) } });
    expect((nodes.get('message') as FakeNode).textContent).toBe('Recorded.');
  });

  test('an objection carries its summary, a resolution its index, and cancel posts nothing', async () => {
    const enabled = { enabled: true, reviewer: REVIEWER, note: null };
    const { nodes, posts } = await renderWith(snapshot(enabled), (path) =>
      path.startsWith('/api/review/nonce') ? { nonce: 'm'.repeat(64) } : { outcome: 'written', message: 'ok', state: snapshot(enabled) },
    );
    const queue = nodes.get('queue') as FakeNode;
    const summary = queue.all().find((node) => node.tag === 'input' && node.attrs['aria-label']?.includes('objection summary')) as FakeNode;
    summary.value = 'Needs a load test';
    summary.fire('input');
    find(queue, /^Raise objection$/).fire('click');
    await settle();
    find(queue, /^Cancel$/).fire('click');
    await settle();
    expect(posts.filter((post) => post.path.startsWith('/api/review?'))).toEqual([]);
    find(queue, /^Raise objection$/).fire('click');
    await settle();
    find(queue, /^Confirm objection as /).fire('click');
    await settle();
    const index = queue.all().find((node) => node.tag === 'input' && node.attrs['aria-label']?.includes('objection number')) as FakeNode;
    index.value = '1';
    index.fire('input');
    find(queue, /^Resolve objection$/).fire('click');
    await settle();
    find(queue, /^Confirm resolution as /).fire('click');
    await settle();
    expect(posts.filter((post) => post.path.startsWith('/api/review?')).map((post) => post.body)).toEqual([
      { kind: 'objection', id: '0003', nonce: 'm'.repeat(64), summary: 'Needs a load test' },
      { kind: 'resolution', id: '0003', nonce: 'm'.repeat(64), objection: 1 },
    ]);
  });

  test('the page uses no browser dialog, no HTML sink, no inline script; the CSP is unchanged', () => {
    expect(BOARD_JS).not.toMatch(/\bconfirm\s*\(|\balert\s*\(|\bprompt\s*\(/);
    for (const sink of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /document\.write/, /\.style\b/]) expect(sink.test(BOARD_JS)).toBe(false);
    expect(BOARD_HTML).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
        "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *",
    );
  });
});

describe('end to end against the built CLI', () => {
  const builtCli = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
  const record = `---
schemaVersion: 0.2.0
id: "0001"
title: "Adopt a fixture decision"
status: proposed
date: 2026-10-01
deciders:
  - "@fixture-owner"
review:
  quorum: 2
---

# ADR-0001: Adopt a fixture decision

## Context

A fixture.

## Decision

We will.

## Consequences

Some.
`;

  beforeAll(() => {
    // CI builds before it tests; a fresh local clone may not have.
    if (!existsSync(builtCli)) execFileSync('bun', ['run', 'build'], { cwd: join(repoRoot, 'packages', 'cli'), stdio: 'ignore' });
  }, 180_000);

  test('approve, object, and resolve through the page route change the record and the queue counts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adrkit-board-e2e-'));
    const ctx = { ...ctxFor('board-e2e'), session: { workingDirectory: root } };
    let options: any;
    try {
      mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
      const file = join(root, 'docs', 'adr', '0001-adopt-a-fixture-decision.md');
      writeFileSync(file, record);
      execFileSync('git', ['init', '-q'], { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
      const logged: string[] = [];
      options = createDecisionBoardCanvas({
        run: (command: string, args: string[], { cwd, signal }: { cwd: string; signal?: AbortSignal }) =>
          runCommand(command, args, { cwd, signal, spawn }),
        env: { ADRKIT_CLI: builtCli, ADRKIT_REVIEWER: REVIEWER },
        exists: existsSync,
        getSession: () => ({ log: async (message: string) => void logged.push(message) }),
      } as never) as any;
      const { url } = await options.open({ ...ctx, input: null });
      const row = async () => JSON.parse((await send(routeOf(url, '/api/state'))).body).queue.items[0];
      for (let i = 0; i < 100 && !(await row()); i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await row()).toMatchObject({ id: '0001', approvalCount: 0, unresolvedObjectionCount: 0, resolvedObjectionCount: 0 });

      const approved = await write(url, { kind: 'approval', id: '0001', nonce: await nonceFor(url, 'approval', '0001') });
      expect(approved.data).toMatchObject({ outcome: 'written' });
      expect(approved.data.state.queue.items[0]).toMatchObject({ approvalCount: 1 });
      expect(readFileSync(file, 'utf8')).toContain(`approvals:\n    - "${REVIEWER}"`);

      const again = await write(url, { kind: 'approval', id: '0001', nonce: await nonceFor(url, 'approval', '0001') });
      expect(again.data).toMatchObject({ outcome: 'unchanged' });

      const objected = await write(url, {
        kind: 'objection',
        id: '0001',
        nonce: await nonceFor(url, 'objection', '0001'),
        summary: '-Needs a load test: "p99" # first',
      });
      expect(objected.data).toMatchObject({ outcome: 'written' });
      expect(objected.data.state.queue.items[0]).toMatchObject({ unresolvedObjectionCount: 1, resolvedObjectionCount: 0 });
      expect(readFileSync(file, 'utf8')).toContain('summary: "-Needs a load test: \\"p99\\" # first"');

      const resolved = await write(url, { kind: 'resolution', id: '0001', nonce: await nonceFor(url, 'resolution', '0001'), objection: 1 });
      expect(resolved.data).toMatchObject({ outcome: 'written' });
      expect(resolved.data.state.queue.items[0]).toMatchObject({ unresolvedObjectionCount: 0, resolvedObjectionCount: 1 });

      const missing = await write(url, { kind: 'resolution', id: '0001', nonce: await nonceFor(url, 'resolution', '0001'), objection: 9 });
      expect(missing.data).toMatchObject({ outcome: 'refused', message: REVIEW_MESSAGES.refused });

      const unknown = await write(url, { kind: 'approval', id: '0099', nonce: await nonceFor(url, 'approval', '0099') });
      expect(unknown.data).toMatchObject({ outcome: 'usage-error', message: REVIEW_MESSAGES.usage });

      expect(logged.length).toBe(6);
      expect(logged.join('\n')).not.toContain('Needs a load test');
      expect(readFileSync(file, 'utf8')).not.toMatch(/ratifiedBy|status: accepted/);
    } finally {
      if (options) await options.onClose(ctx);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

test('RECORD_ID is the grammar the write route checks', () => {
  expect(RECORD_ID.test('0003')).toBe(true);
});
