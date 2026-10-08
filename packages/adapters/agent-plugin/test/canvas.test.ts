import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import {
  BODY_LIMIT,
  CANVAS_ID,
  CSP,
  buildExplainPrompt,
  computeSnapshot,
  createDecisionReviewCanvas,
  sanitizeReviewResult,
  tokenMatches,
} from '../extensions/adrkit/canvas.mjs';
import { PAGE_CSS, PAGE_HTML, PAGE_JS, renderPage } from '../extensions/adrkit/canvas-page.mjs';
import { packageRoot } from './harness.ts';

/**
 * The read-only `decision-review` canvas for the GitHub Copilot app, exercised
 * without the Copilot SDK.
 *
 * Like `review.mjs`, `canvas.mjs` takes its processes, its session, and its
 * server factory as arguments, so everything here runs under Bun. The HTTP
 * tests start a real loopback server: the token, header, and body-size rules
 * are the security boundary, and a fake request object would test the fake.
 */

type Run = { stdout: string; stderr: string; exitCode: number };
type Call = { command: string; args: string[]; cwd: string };

const CWD = '/work/repo';
const TITLE = 'Use <img src=x onerror=alert(1)> for everything';

const ok = (stdout = ''): Run => ({ stdout, stderr: '', exitCode: 0 });

const governed = (recordId: string, bucket: string, title = `Decision ${recordId}`) => ({
  recordId,
  title,
  status: bucket === 'governing' ? 'accepted' : bucket === 'history' ? 'superseded' : 'proposed',
  bucket,
  firedMatchers: [{ type: 'path', pattern: 'src/**' }],
});

const checkReport = (entries: unknown[], findings: unknown[] = []) =>
  JSON.stringify({ changedFiles: ['src/a.ts'], governedBy: entries, findings });

/** A scripted `run`: git diff, adr check, and adr lint answer from `script`. */
function fakeCli(script: { diff?: Run | Error; check?: Run | Error; lint?: Run | Error } = {}) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], { cwd }: { cwd: string }) => {
    calls.push({ command, args, cwd });
    const key = command === 'git' ? 'diff' : args.includes('check') ? 'check' : 'lint';
    const answer =
      script[key] ??
      (key === 'diff'
        ? ok('src/a.ts\0')
        : key === 'check'
          ? ok(checkReport([governed('0012', 'governing', TITLE)]))
          : ok());
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { run, calls };
}

type Session = {
  send: (options: { prompt: string }) => Promise<string>;
  log: (message: string, options?: unknown) => Promise<void>;
  rpc: {
    workflow: {
      run: (params: { name: string; args: unknown }) => Promise<Record<string, unknown>>;
      getRun: (params: { runId: string }) => Promise<Record<string, unknown>>;
    };
  };
};

function fakeSession(runs: Array<Record<string, unknown>> = []) {
  const sent: string[] = [];
  const started: Array<{ name: string; args: unknown }> = [];
  const polled: string[] = [];
  const queue = [...runs];
  const session: Session = {
    send: async ({ prompt }) => {
      sent.push(prompt);
      return 'message-1';
    },
    log: async () => {},
    rpc: {
      workflow: {
        run: async (params) => {
          started.push(params);
          return { runId: 'run-1', attempt: 1, status: 'running' };
        },
        getRun: async ({ runId }) => {
          polled.push(runId);
          return queue.length > 1 ? (queue.shift() as Record<string, unknown>) : (queue[0] ?? { runId, status: 'running' });
        },
      },
    },
  };
  return { session, sent, started, polled };
}

const openCanvases: Array<{ onClose: (ctx: unknown) => unknown; instanceId: string }> = [];

function makeCanvas(overrides: Record<string, unknown> = {}) {
  const cli = fakeCli();
  const fake = fakeSession();
  const servers: unknown[] = [];
  const options = createDecisionReviewCanvas({
    run: cli.run,
    env: {},
    exists: () => false,
    getSession: () => fake.session,
    createServer: (handler: any) => {
      const server = createServer(handler);
      servers.push(server);
      return server;
    },
    sleep: async () => {},
    now: () => '2026-10-08T00:00:00.000Z',
    ...overrides,
  });
  return { options, cli, fake, servers };
}

const ctxFor = (instanceId: string, extra: Record<string, unknown> = {}) => ({
  sessionId: 's',
  extensionId: 'plugin:adrkit:adrkit',
  canvasId: CANVAS_ID,
  instanceId,
  session: { workingDirectory: CWD },
  ...extra,
});

async function openPanel(options: ReturnType<typeof makeCanvas>['options'], instanceId = 'panel-1', extra = {}) {
  const ctx = ctxFor(instanceId, extra);
  const result = await options.open(ctx);
  openCanvases.push({ onClose: options.onClose, instanceId });
  return result as { url: string; title: string; status: string };
}

function action(options: ReturnType<typeof makeCanvas>['options'], name: string) {
  const found = options.actions.find((entry: { name: string }) => entry.name === name);
  if (!found) throw new Error(`no action ${name}`);
  return (input?: unknown, instanceId = 'panel-1'): Promise<any> =>
    Promise.resolve(found.handler({ ...ctxFor(instanceId), actionName: name, input }));
}

afterEach(async () => {
  for (const { onClose, instanceId } of openCanvases.splice(0)) await onClose(ctxFor(instanceId));
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

/** Read the first SSE event, then drop the connection. */
function firstEvent(url: string): Promise<{ headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.includes('\n\n')) {
          resolve({ headers: res.headers, text: data });
          req.destroy();
        }
      });
    });
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
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

async function settle(read: () => Promise<any>): Promise<any> {
  for (let i = 0; i < 50; i++) {
    const state = await read();
    if (state.status !== 'pending') return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('still pending');
}

describe('declaration', () => {
  test('names the canvas and exposes four actions, none reserved', () => {
    const { options } = makeCanvas();
    expect(options.id).toBe('decision-review');
    expect(options.displayName).toBe('Decision review');
    expect(options.description.length).toBeGreaterThan(20);
    expect(options.actions.map((entry: { name: string }) => entry.name)).toEqual([
      'get_state',
      'refresh',
      'show_review',
      'run_review',
    ]);
    for (const entry of options.actions) {
      expect(entry.name.startsWith('canvas.')).toBe(false);
      expect(typeof entry.handler).toBe('function');
    }
  });

  test('only run_review spends credits, and it says so', () => {
    const { options } = makeCanvas();
    const credits = options.actions.filter((entry: { description: string }) => /AI credits/.test(entry.description));
    expect(credits.map((entry: { name: string }) => entry.name)).toEqual(['run_review']);
    const refresh = options.actions.find((entry: { name: string }) => entry.name === 'refresh');
    expect(refresh?.description).toMatch(/no model/i);
  });

  test('the open schema has exactly the workflow arguments', () => {
    const { options } = makeCanvas();
    expect(Object.keys(options.inputSchema.properties).sort()).toEqual(['base', 'dir', 'files']);
  });
});

describe('tokenMatches', () => {
  const token = 'a'.repeat(64);

  test('accepts only the exact token', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token, 'b'.repeat(64))).toBe(false);
    expect(tokenMatches(token, token.slice(1))).toBe(false);
    expect(tokenMatches(token, '')).toBe(false);
    expect(tokenMatches(token, null)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
  });

  test('compares in constant time on equal-length buffers', () => {
    const seen: Array<[number, number]> = [];
    const compare = (a: Buffer, b: Buffer) => {
      seen.push([a.length, b.length]);
      return a.equals(b);
    };
    expect(tokenMatches(token, token, compare)).toBe(true);
    // A length mismatch still runs one comparison, so a wrong length is not
    // measurably faster to reject than a wrong value.
    expect(tokenMatches(token, 'short', compare)).toBe(false);
    expect(seen.length).toBe(2);
    for (const [a, b] of seen) expect(a).toBe(b);
  });
});

describe('computeSnapshot', () => {
  test('exit 0: governing, history, and active proposals are listed and the state is ok', async () => {
    const { run, calls } = fakeCli({
      check: ok(
        checkReport([governed('0012', 'governing'), governed('0003', 'history'), governed('0044', 'activeProposals')]),
      ),
    });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('ok');
    expect(snapshot.workingDirectory).toBe(CWD);
    expect(snapshot.files).toEqual(['src/a.ts']);
    expect(snapshot.filesSource).toBe('git:origin/main...HEAD');
    expect(snapshot.checkExitCode).toBe(0);
    expect(snapshot.lintExitCode).toBe(0);
    expect(snapshot.governing.map((d: { recordId: string }) => d.recordId)).toEqual(['0012']);
    expect(snapshot.history.map((d: { recordId: string }) => d.recordId)).toEqual(['0003']);
    expect(snapshot.activeProposals.map((d: { recordId: string }) => d.recordId)).toEqual(['0044']);
    expect(snapshot.review).toBeNull();
    expect(snapshot.updatedAt).toBe('T');
    // Every subprocess runs in the session's directory, never process.cwd().
    expect(calls.every((call) => call.cwd === CWD)).toBe(true);
    expect(calls.map((call) => call.args[0])).toEqual(['diff', 'check', 'lint']);
  });

  test('exit 1 is data: the report is kept and the state is findings', async () => {
    const finding = { rule: 'stale-marker', severity: 'warn', message: 'stale', path: 'src/a.ts' };
    const { run } = fakeCli({ check: { ...ok(checkReport([governed('0012', 'governing')], [finding])), exitCode: 1 } });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('findings');
    expect(snapshot.checkExitCode).toBe(1);
    expect(snapshot.governing.length).toBe(1);
    expect(snapshot.findings).toEqual([finding]);
  });

  test('exit 2 is a usage error carrying the CLI message', async () => {
    const { run } = fakeCli({ check: { stdout: '', stderr: 'no corpus at docs/adr', exitCode: 2 } });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('usage-error');
    expect(snapshot.checkExitCode).toBe(2);
    expect(snapshot.notes.join('\n')).toContain('no corpus at docs/adr');
  });

  test('a CLI that cannot be started is a usage error, never a crash and never ok', async () => {
    const { run } = fakeCli({ check: new Error('could not start "adr": not found') });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('usage-error');
    expect(snapshot.notes.join('\n')).toContain('could not start "adr"');
  });

  test('invalid input is a usage error, and nothing runs', async () => {
    const { run, calls } = fakeCli();
    const snapshot = await computeSnapshot({
      cwd: CWD,
      input: { cli: '/tmp/evil' },
      run,
      env: {},
      exists: () => false,
      now: () => 'T',
    });
    expect(snapshot.status).toBe('usage-error');
    expect(snapshot.notes.join('\n')).toContain('unknown argument: cli');
    expect(calls).toEqual([]);
  });

  test('explicit files skip git, and dir reaches the CLI', async () => {
    const { run, calls } = fakeCli();
    const snapshot = await computeSnapshot({
      cwd: CWD,
      input: { files: ['src/b.ts'], dir: 'decisions' },
      run,
      env: {},
      exists: () => false,
      now: () => 'T',
    });
    expect(snapshot.files).toEqual(['src/b.ts']);
    expect(snapshot.filesSource).toBe('args');
    expect(calls[0]?.args).toEqual(['check', '--json', '--dir', 'decisions', '--', 'src/b.ts']);
  });
});

describe('sanitizeReviewResult', () => {
  const valid = {
    status: 'findings',
    checkExitCode: 0,
    lintExitCode: 0,
    files: ['src/a.ts'],
    filesSource: 'args',
    notes: [],
    governing: [governed('0012', 'governing')],
    history: [],
    verdicts: [{ recordId: '0012', title: 'T', verdict: 'conflicts', evidence: 'because' }],
    unverified: [],
    findings: [],
  };

  test('keeps the known keys and drops everything else, nested too', () => {
    const cleaned: any = sanitizeReviewResult({
      ...valid,
      extra: 'dropped',
      verdicts: [{ ...valid.verdicts[0], script: 'dropped' }],
      governing: [{ ...valid.governing[0], injected: 'dropped' }],
    });
    expect(Object.keys(cleaned).sort()).toEqual(Object.keys(valid).sort());
    expect(cleaned.verdicts).toEqual(valid.verdicts);
    expect(Object.keys(cleaned.governing[0]).includes('injected')).toBe(false);
  });

  test('rejects anything that is not an adr-review result', () => {
    for (const bad of [
      null,
      'ok',
      [],
      { ...valid, status: 'great' },
      { ...valid, files: 'src/a.ts' },
      { ...valid, files: [1] },
      { ...valid, checkExitCode: '0' },
      { ...valid, verdicts: [{ recordId: '0012', title: 'T', verdict: 'maybe', evidence: 'x' }] },
      { ...valid, governing: [{ title: 'no id' }] },
      { ...valid, unverified: [{}] },
    ]) {
      expect(() => sanitizeReviewResult(bad)).toThrow();
    }
  });
});

describe('buildExplainPrompt', () => {
  test('names the record id and nothing from the repository', () => {
    const prompt = buildExplainPrompt('0012');
    expect(prompt).toContain('0012');
    expect(prompt).toMatch(/read-only/i);
    expect(prompt).toContain('adr explain');
  });

  test('refuses anything but a four-digit id', () => {
    for (const bad of ['12', '00123', '0012"; rm', '', 'abcd']) expect(() => buildExplainPrompt(bad)).toThrow();
  });
});

describe('open and close', () => {
  test('constructing the canvas starts no server; open starts exactly one', async () => {
    const { options, servers } = makeCanvas();
    expect(servers.length).toBe(0);
    const opened = await openPanel(options);
    expect(servers.length).toBe(1);
    expect(opened.title).toBe('Decision review');
    expect(opened.status).toBe('1 governing · ok');
    const url = new URL(opened.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(tokenOf(opened.url)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('open is idempotent per instance; a second instance gets its own server and token', async () => {
    const { options, servers } = makeCanvas();
    const first = await openPanel(options, 'panel-1');
    const again = await options.open(ctxFor('panel-1'));
    expect(again.url).toBe(first.url);
    expect(servers.length).toBe(1);
    const second = await openPanel(options, 'panel-2');
    expect(second.url).not.toBe(first.url);
    expect(tokenOf(second.url)).not.toBe(tokenOf(first.url));
    expect(servers.length).toBe(2);
  });

  test('concurrent opens of one instance share one server', async () => {
    const { options, servers } = makeCanvas();
    const [a, b] = await Promise.all([options.open(ctxFor('panel-1')), options.open(ctxFor('panel-1'))]);
    openCanvases.push({ onClose: options.onClose, instanceId: 'panel-1' });
    expect(a.url).toBe(b.url);
    expect(servers.length).toBe(1);
  });

  test('onClose closes the server, even with an event stream attached', async () => {
    const { options, servers } = makeCanvas();
    const opened = await openPanel(options);
    const stream = new Promise<void>((resolve) => {
      const req = httpRequest(withPath(opened.url, '/events'), (res) => {
        res.on('data', () => {});
        res.on('close', () => resolve());
      });
      req.on('error', () => resolve());
      req.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await options.onClose(ctxFor('panel-1'));
    await stream;
    expect((servers[0] as { listening: boolean }).listening).toBe(false);
    await expect(send(opened.url)).rejects.toThrow();
  });

  test('open without a working directory throws workspace_unavailable', async () => {
    const { options, servers } = makeCanvas();
    const error = await options.open({ ...ctxFor('panel-1'), session: undefined }).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('workspace_unavailable');
    expect(servers.length).toBe(0);
  });

  test('the injected error factory is used, so the host sees a CanvasError', async () => {
    class FakeCanvasError extends Error {
      constructor(
        readonly code: string,
        message: string,
      ) {
        super(message);
      }
    }
    const { options } = makeCanvas({ makeError: (code: string, message: string) => new FakeCanvasError(code, message) });
    const error = await options.open({ ...ctxFor('panel-1'), session: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FakeCanvasError);
  });

  test('importing the modules under Node opens no socket and leaves nothing running', () => {
    // Real Node, because that is what the host forks: a listen at module load
    // would show as a TCPServerWrap and keep the process alive.
    const dir = join(packageRoot, 'extensions', 'adrkit');
    const script = [
      `await import(${JSON.stringify(join(dir, 'canvas.mjs'))});`,
      `await import(${JSON.stringify(join(dir, 'canvas-page.mjs'))});`,
      `process.stdout.write(JSON.stringify(process.getActiveResourcesInfo()));`,
    ].join('\n');
    const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    const resources = JSON.parse(out) as string[];
    expect(resources.filter((name) => /TCP|Server|Timeout/.test(name))).toEqual([]);
  });

  test('under Node, a panel serves its page and onClose stops the listener', () => {
    // Bun's `closeAllConnections()` also stops listening; Node's does not, so
    // only a Node run shows whether `onClose` really closes the server.
    const canvasPath = join(packageRoot, 'extensions', 'adrkit', 'canvas.mjs');
    const script = `
      const { createDecisionReviewCanvas } = await import(${JSON.stringify(canvasPath)});
      const servers = [];
      const { createServer } = await import('node:http');
      const canvas = createDecisionReviewCanvas({
        run: async (command, args) => ({ stdout: command === 'git' ? 'a.ts\\0' : args.includes('check') ? '{"governedBy":[]}' : '', stderr: '', exitCode: 0 }),
        env: {}, exists: () => false, getSession: () => undefined,
        createServer: (handler) => { const server = createServer(handler); servers.push(server); return server; },
      });
      const ctx = { instanceId: 'p', session: { workingDirectory: '/work/repo' } };
      const { url } = await canvas.open(ctx);
      const page = await fetch(url);
      await page.text();
      await canvas.onClose(ctx);
      process.stdout.write(JSON.stringify({ status: page.status, csp: page.headers.get('content-security-policy'), listening: servers[0].listening }));
    `;
    const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(out)).toEqual({ status: 200, csp: CSP, listening: false });
  });
});

describe('HTTP boundary', () => {
  test('every route needs the token: missing or wrong gives 403', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    for (const path of ['/', '/app.js', '/app.css', '/api/state', '/events', '/nope']) {
      expect({ path, status: (await send(withPath(url, path, null))).status }).toEqual({ path, status: 403 });
      expect({ path, status: (await send(withPath(url, path, 'f'.repeat(64)))).status }).toEqual({ path, status: 403 });
    }
  });

  test('a token from another instance is refused', async () => {
    const { options } = makeCanvas();
    const first = await openPanel(options, 'panel-1');
    const second = await openPanel(options, 'panel-2');
    expect((await send(withPath(first.url, '/api/state', tokenOf(second.url)))).status).toBe(403);
  });

  test('serves the page, assets, and state with the right types', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    const page = await send(url);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    const js = await send(withPath(url, '/app.js'));
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    expect(js.body).toBe(PAGE_JS);
    const css = await send(withPath(url, '/app.css'));
    expect(css.headers['content-type']).toMatch(/^text\/css/);
    const state = await send(withPath(url, '/api/state'));
    expect(state.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(state.body).governing[0].title).toBe(TITLE);
  });

  test('the security headers are on every response type', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    const token = tokenOf(url);
    const responses = [
      await send(url),
      await send(withPath(url, '/app.js')),
      await send(withPath(url, '/app.css')),
      await send(withPath(url, '/api/state')),
      await send(withPath(url, '/nope')),
      await send(withPath(url, '/', null)),
      await send(withPath(url, '/api/refresh'), { method: 'POST' }),
      await send(withPath(url, '/api/refresh'), { method: 'POST', headers: { 'X-Adrkit-Token': token } }),
    ];
    const events = await firstEvent(withPath(url, '/events'));
    for (const headers of [...responses.map((r) => r.headers), events.headers]) {
      expect(headers['content-security-policy']).toBe(CSP);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cache-control']).toBe('no-store');
      expect(headers['x-frame-options']).toBeUndefined();
    }
    expect(CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *",
    );
  });

  test('unknown routes and methods give 404', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    expect((await send(withPath(url, '/nope'))).status).toBe(404);
    expect((await send(withPath(url, '/api/state'), { method: 'DELETE' })).status).toBe(404);
    expect((await send(withPath(url, '/api/refresh'))).status).toBe(404);
  });

  test('a POST needs the header token too, so a page that only knows the URL cannot forge one', async () => {
    const { options, cli } = makeCanvas();
    const { url } = await openPanel(options);
    const before = cli.calls.length;
    expect((await send(withPath(url, '/api/refresh'), { method: 'POST' })).status).toBe(403);
    expect(
      (await send(withPath(url, '/api/refresh'), { method: 'POST', headers: { 'X-Adrkit-Token': 'f'.repeat(64) } }))
        .status,
    ).toBe(403);
    expect(cli.calls.length).toBe(before);
    const good = await send(withPath(url, '/api/refresh'), { method: 'POST', headers: { 'X-Adrkit-Token': tokenOf(url) } });
    expect(good.status).toBe(200);
    expect(cli.calls.length).toBeGreaterThan(before);
  });

  test('a POST from a foreign origin is refused; the page’s own origin is accepted', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    const headers = { 'X-Adrkit-Token': tokenOf(url) };
    const foreign = await send(withPath(url, '/api/refresh'), {
      method: 'POST',
      headers: { ...headers, Origin: 'http://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const own = await send(withPath(url, '/api/refresh'), {
      method: 'POST',
      headers: { ...headers, Origin: new URL(url).origin },
    });
    expect(own.status).toBe(200);
  });

  test('an oversized body is rejected', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    const body = JSON.stringify({ recordId: '0012', pad: 'x'.repeat(BODY_LIMIT) });
    const response = await send(withPath(url, '/api/explain'), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url), 'Content-Type': 'application/json' },
      body,
    }).catch((error: unknown) => ({ status: -1, error }));
    expect(response.status).toBe(413);
    expect(BODY_LIMIT).toBe(64 * 1024);
  });

  test('the event stream sends the current state first', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options);
    const { headers, text } = await firstEvent(withPath(url, '/events'));
    expect(headers['content-type']).toMatch(/^text\/event-stream/);
    expect(text.startsWith('event: state\ndata: ')).toBe(true);
    const data = JSON.parse(text.slice('event: state\ndata: '.length).trim());
    expect(data.workingDirectory).toBe(CWD);
  });
});

describe('explain', () => {
  const post = (url: string, body: unknown) =>
    send(withPath(url, '/api/explain'), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('a known four-digit id sends a fixed prompt naming the id and no repository text', async () => {
    const { options, fake } = makeCanvas();
    const { url } = await openPanel(options);
    const response = await post(url, { recordId: '0012' });
    expect(response.status).toBe(200);
    expect(fake.sent.length).toBe(1);
    expect(fake.sent[0]).toBe(buildExplainPrompt('0012'));
    expect(fake.sent[0]).toContain('0012');
    expect(fake.sent[0]).not.toContain('onerror');
    expect(fake.sent[0]).not.toContain(TITLE);
  });

  test('an id that is malformed or not in the snapshot sends nothing', async () => {
    const { options, fake } = makeCanvas();
    const { url } = await openPanel(options);
    for (const recordId of ['9999', '12', '0012 and then', 12, null]) {
      const response = await post(url, { recordId });
      expect({ recordId, rejected: response.status >= 400 }).toEqual({ recordId, rejected: true });
    }
    expect((await send(withPath(url, '/api/explain'), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url) },
      body: '{not json',
    })).status).toBe(400);
    expect(fake.sent).toEqual([]);
  });
});

describe('actions', () => {
  test('get_state returns the snapshot shape', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    const state = await action(options, 'get_state')();
    expect(Object.keys(state).sort()).toEqual(
      [
        'workingDirectory',
        'base',
        'files',
        'filesSource',
        'status',
        'checkExitCode',
        'lintExitCode',
        'governing',
        'history',
        'activeProposals',
        'findings',
        'notes',
        'review',
        'updatedAt',
      ].sort(),
    );
  });

  test('refresh re-runs Collect and Check with new input and spends nothing', async () => {
    const { options, cli, fake } = makeCanvas();
    await openPanel(options);
    cli.calls.length = 0;
    const state = await action(options, 'refresh')({ files: ['src/c.ts'] });
    expect(state.files).toEqual(['src/c.ts']);
    expect(cli.calls.map((call) => call.args[0])).toEqual(['check', 'lint']);
    expect(fake.started).toEqual([]);
    expect(fake.sent).toEqual([]);
  });

  test('show_review displays a handed-over result and rejects a malformed one', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    const result = {
      status: 'findings',
      checkExitCode: 0,
      lintExitCode: 0,
      files: ['src/a.ts'],
      filesSource: 'args',
      notes: [],
      governing: [governed('0012', 'governing')],
      history: [],
      verdicts: [{ recordId: '0012', title: 'T', verdict: 'conflicts', evidence: 'e' }],
      unverified: [],
      findings: [],
      sneaky: true,
    };
    const state = await action(options, 'show_review')({ result });
    expect(state.status).toBe('findings');
    expect(state.review.runStatus).toBe('completed');
    expect(state.review.result.verdicts[0].verdict).toBe('conflicts');
    expect('sneaky' in state.review.result).toBe(false);
    await expect(Promise.resolve().then(() => action(options, 'show_review')({ result: { status: 'nope' } }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => action(options, 'show_review')({}))).rejects.toThrow();
  });

  test('run_review starts adr-review with validated args and polls it to its result', async () => {
    const terminal = {
      runId: 'run-1',
      status: 'completed',
      result: {
        status: 'ok',
        checkExitCode: 0,
        lintExitCode: 0,
        files: ['src/a.ts'],
        filesSource: 'args',
        notes: [],
        governing: [governed('0012', 'governing')],
        history: [],
        verdicts: [{ recordId: '0012', title: 'T', verdict: 'consistent', evidence: 'fine' }],
        unverified: [],
        findings: [],
      },
    };
    const fake = fakeSession([{ runId: 'run-1', status: 'running' }, terminal]);
    const { options } = makeCanvas({ getSession: () => fake.session });
    await openPanel(options);
    const started = await action(options, 'run_review')({ files: ['src/a.ts'], base: 'main' });
    expect(started).toEqual({ runId: 'run-1', status: 'running' });
    expect(fake.started).toEqual([{ name: 'adr-review', args: { files: ['src/a.ts'], base: 'main' } }]);
    const state = await settle(() => action(options, 'get_state')());
    expect(state.status).toBe('ok');
    const review = (state as unknown as { review: { runId: string; runStatus: string; result: { verdicts: unknown[] } } })
      .review;
    expect(review.runId).toBe('run-1');
    expect(review.runStatus).toBe('completed');
    expect(review.result.verdicts.length).toBe(1);
    expect(fake.polled.length).toBeGreaterThanOrEqual(2);
  });

  test('run_review refuses invalid args before spending anything', async () => {
    const fake = fakeSession();
    const { options } = makeCanvas({ getSession: () => fake.session });
    await openPanel(options);
    await expect(Promise.resolve().then(() => action(options, 'run_review')({ cli: 'x' }))).rejects.toThrow(/unknown argument/);
    expect(fake.started).toEqual([]);
  });

  test('a run that errors never reads as ok', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'error', error: 'boom' }]);
    const { options } = makeCanvas({ getSession: () => fake.session });
    await openPanel(options);
    await action(options, 'run_review')({});
    const state = await settle(() => action(options, 'get_state')());
    expect(state.status).not.toBe('ok');
    expect(state.notes.join('\n')).toContain('boom');
  });

  test('while a run is in flight the state is pending and a second request starts nothing', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'running' }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { options } = makeCanvas({ getSession: () => fake.session, sleep: () => gate });
    await openPanel(options);
    await action(options, 'run_review')({});
    expect((await action(options, 'get_state')()).status).toBe('pending');
    const again = await action(options, 'run_review')({});
    expect(again).toEqual({ runId: 'run-1', status: 'running' });
    expect(fake.started.length).toBe(1);
    release();
  });
});

describe('page', () => {
  test('the shipped JS has no HTML-injection sinks', () => {
    for (const sink of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /document\.write/, /\beval\s*\(/, /new Function\b/]) {
      expect({ sink: String(sink), found: sink.test(PAGE_JS) }).toEqual({ sink: String(sink), found: false });
    }
    expect(PAGE_JS).toContain('textContent');
  });

  test('the page has no inline script or style for the CSP to block', () => {
    expect(PAGE_HTML).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(PAGE_HTML).not.toMatch(/<style\b/);
    expect(PAGE_HTML).not.toMatch(/\son[a-z]+=/i);
  });

  test('renderPage substitutes only a hex token', () => {
    const token = 'ab'.repeat(32);
    const html = renderPage(token);
    expect(html).toContain(`app.js?token=${token}`);
    expect(html).toContain(`app.css?token=${token}`);
    expect(() => renderPage('"><script>')).toThrow();
  });

  test('styles use the documented app tokens with fallbacks', () => {
    for (const name of [
      '--background-color-default',
      '--text-color-default',
      '--text-color-muted',
      '--border-color-default',
      '--color-focus-outline',
      '--font-sans',
      '--font-mono',
      '--text-body-medium',
      '--leading-body-medium',
      '--true-color-red',
      '--true-color-green',
      '--true-color-yellow',
      '--true-color-blue',
    ]) {
      expect({ name, used: new RegExp(`var\\(${name}\\s*,`).test(PAGE_CSS) }).toEqual({ name, used: true });
    }
  });

  test('the run button names its cost', () => {
    expect(PAGE_JS + PAGE_HTML).toContain('Run review (uses AI credits)');
  });
});
