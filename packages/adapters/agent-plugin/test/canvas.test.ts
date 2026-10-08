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
import { register } from '../extensions/adrkit/register.mjs';
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
  test('exit 0: everything is listed, and governing records without a verdict make it incomplete', async () => {
    const { run, calls } = fakeCli({
      check: ok(
        checkReport([governed('0012', 'governing'), governed('0003', 'history'), governed('0044', 'activeProposals')]),
      ),
    });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    // `ok` is the workflow's word for "judged clean"; nothing has been judged.
    expect(snapshot.status).toBe('incomplete');
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
    expect(opened.status).toBe('1 governing · incomplete');
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

  test('two panels opened at once on one directory both open', async () => {
    // What the app's rehydrate does after a reload with two panels open: the
    // older refresh lands first and must still leave a snapshot to return.
    const { options, servers } = makeCanvas();
    const opened = await Promise.all([options.open(ctxFor('panel-a')), options.open(ctxFor('panel-b'))]);
    openCanvases.push({ onClose: options.onClose, instanceId: 'panel-a' }, { onClose: options.onClose, instanceId: 'panel-b' });
    expect(opened.map((entry: { status: string }) => entry.status)).toEqual(['1 governing · incomplete', '1 governing · incomplete']);
    expect(servers.length).toBe(2);
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
      `await import(${JSON.stringify(join(dir, 'register.mjs'))});`,
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
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *",
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

describe('register', () => {
  function fakes({ workflowThrows = false, canvasThrows = false } = {}) {
    const joined: Array<Record<string, unknown>> = [];
    const logged: Array<[string, unknown]> = [];
    const session = { log: async (message: string, options?: unknown) => void logged.push([message, options]) };
    return {
      joined,
      logged,
      deps: {
        defineWorkflow: (definition: unknown) => {
          if (workflowThrows) throw new Error('bad workflow');
          return { kind: 'workflow', definition };
        },
        createCanvas: (options: unknown) => {
          if (canvasThrows) throw new Error('bad canvas');
          return { kind: 'canvas', options };
        },
        joinSession: async (config: Record<string, unknown>) => {
          joined.push(config);
          return session;
        },
        workflow: () => ({ meta: { name: 'adr-review' } }),
        canvas: () => ({ id: 'decision-review' }),
      },
    };
  }

  test('joins once with both the workflow and the canvas', async () => {
    const { deps, joined, logged } = fakes();
    await register(deps);
    expect(joined.length).toBe(1);
    expect((joined[0]?.['workflows'] as unknown[]).length).toBe(1);
    expect((joined[0]?.['canvases'] as unknown[]).length).toBe(1);
    expect(logged).toEqual([]);
  });

  test('a throwing canvas does not stop the workflow from registering, and is reported', async () => {
    const { deps, joined, logged } = fakes({ canvasThrows: true });
    await register(deps);
    expect((joined[0]?.['workflows'] as unknown[]).length).toBe(1);
    expect(joined[0]?.['canvases']).toBeUndefined();
    expect(logged.length).toBe(1);
    expect(logged[0]?.[0]).toContain('bad canvas');
    expect(logged[0]?.[1]).toEqual({ level: 'error' });
  });

  test('a throwing workflow does not stop the canvas from registering, and is reported', async () => {
    const { deps, joined, logged } = fakes({ workflowThrows: true });
    await register(deps);
    expect((joined[0]?.['canvases'] as unknown[]).length).toBe(1);
    expect(joined[0]?.['workflows']).toBeUndefined();
    expect(logged[0]?.[0]).toContain('bad workflow');
  });

  test('the canvas factory gets the joined session through a getter', async () => {
    const { deps } = fakes();
    let getter: (() => unknown) | undefined;
    const session = await register({
      ...deps,
      canvas: (getSession: () => unknown) => {
        getter = getSession;
        return { id: 'decision-review' };
      },
    });
    expect(getter?.()).toBe(session);
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

/**
 * Findings from the whole-branch review: false-clean states (I2, I3), a
 * paid run that could be started twice (M1), and lifecycle gaps (M2, M7, M9).
 */
describe('review round', () => {
  const resultFor = (governing: string[], verdicts: Array<[string, string]>, files = ['src/a.ts']) => ({
    status: verdicts.some(([, verdict]) => verdict === 'conflicts') ? 'findings' : 'ok',
    checkExitCode: 0,
    lintExitCode: 0,
    files,
    filesSource: 'args',
    notes: [],
    governing: governing.map((id) => governed(id, 'governing')),
    history: [],
    verdicts: verdicts.map(([recordId, verdict]) => ({ recordId, title: 'T', verdict, evidence: 'e' })),
    unverified: [],
    findings: [],
  });

  test('I2: zero governing records and a clean check is ok', async () => {
    const { run } = fakeCli({ check: ok(checkReport([governed('0003', 'history')])) });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('ok');
  });

  test('I2: exit 1 is still findings while governing records await a verdict', async () => {
    const { run } = fakeCli({ check: { ...ok(checkReport([governed('0012', 'governing')])), exitCode: 1 } });
    const snapshot = await computeSnapshot({ cwd: CWD, input: {}, run, env: {}, exists: () => false, now: () => 'T' });
    expect(snapshot.status).toBe('findings');
  });

  test('I2: a review covering every governing record lifts incomplete to ok', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    expect((await action(options, 'get_state')()).status).toBe('incomplete');
    const state = await action(options, 'show_review')({ result: resultFor(['0012'], [['0012', 'consistent']]) });
    expect(state.status).toBe('ok');
  });

  test('I3: show_review that leaves a governing record unjudged is incomplete and says which', async () => {
    const script: { check?: Run } = {
      check: ok(checkReport([governed('0012', 'governing'), governed('0099', 'governing')])),
    };
    const cli = fakeCli(script);
    const { options } = makeCanvas({ run: cli.run });
    await openPanel(options);
    const state = await action(options, 'show_review')({
      result: { ...resultFor(['0012', '0099'], [['0012', 'consistent']]), status: 'incomplete', unverified: ['0099'] },
    });
    expect(state.status).toBe('incomplete');
    expect(state.notes.join('\n')).toContain('0099');
  });

  test('I3: refresh drops a kept review when the governing set changed but the files did not', async () => {
    const script: { check?: Run } = { check: ok(checkReport([governed('0012', 'governing')])) };
    const cli = fakeCli(script);
    const { options } = makeCanvas({ run: cli.run });
    await openPanel(options);
    await action(options, 'show_review')({ result: resultFor(['0012'], [['0012', 'consistent']]) });
    script.check = ok(checkReport([governed('0012', 'governing'), governed('0099', 'governing')]));
    const state = await action(options, 'refresh')();
    expect(state.review).toBeNull();
    expect(state.status).toBe('incomplete');
  });

  test('I3: refresh keeps a review whose files and governing set are unchanged', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    await action(options, 'show_review')({ result: resultFor(['0012'], [['0012', 'consistent']]) });
    const state = await action(options, 'refresh')();
    expect(state.review).not.toBeNull();
    expect(state.status).toBe('ok');
  });

  test('M1: a run left unfollowed by a closed panel is resumed on re-open, never started twice', async () => {
    let terminal = false;
    const started: unknown[] = [];
    const session = {
      send: async () => 'm',
      log: async () => {},
      rpc: {
        workflow: {
          run: async (params: unknown) => {
            started.push(params);
            return { runId: 'run-1', status: 'running' };
          },
          getRun: async () =>
            terminal
              ? { runId: 'run-1', status: 'completed', result: resultFor(['0012'], [['0012', 'consistent']]) }
              : { runId: 'run-1', status: 'running' },
        },
      },
    };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let sleep: () => Promise<void> = () => gate;
    const { options } = makeCanvas({ getSession: () => session, sleep: () => sleep() });
    await options.open(ctxFor('panel-1'));
    await action(options, 'run_review')({});
    await options.onClose(ctxFor('panel-1'));
    sleep = () => new Promise((resolve) => setTimeout(resolve, 1));
    release();
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    // No longer followed, still running: not pending, never ok.
    const orphaned = await action(options, 'get_state')();
    expect(orphaned.status).toBe('incomplete');
    expect(orphaned.review.runStatus).toBe('running');
    // The agent asks again with no panel open: the known, unsettled run is
    // returned, not paid for a second time.
    expect((await action(options, 'run_review')({})).runId).toBe('run-1');
    expect(started.length).toBe(1);

    // Re-opening resumes following the same run; asking for a review while it
    // is still in flight returns it instead of paying for a second.
    await openPanel(options, 'panel-2');
    expect((await action(options, 'get_state')(undefined, 'panel-2')).status).toBe('pending');
    const again = await action(options, 'run_review')({}, 'panel-2');
    expect(again.runId).toBe('run-1');
    expect(started.length).toBe(1);
    terminal = true;
    const settled = await settle(() => action(options, 'get_state')(undefined, 'panel-2'));
    expect(settled.status).toBe('ok');
    expect(settled.review.runStatus).toBe('completed');
  });

  test('M2: run_review with new input refreshes the check before starting', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'running' }]);
    const { options, cli } = makeCanvas({ getSession: () => fake.session, sleep: () => new Promise(() => {}) });
    await openPanel(options);
    cli.calls.length = 0;
    await action(options, 'run_review')({ files: ['src/z.ts'] });
    expect(cli.calls.some((call) => call.args.includes('src/z.ts'))).toBe(true);
    expect((await action(options, 'get_state')()).files).toEqual(['src/z.ts']);
  });

  test('M9: re-open with different input applies it and keeps the URL', async () => {
    const { options, cli, servers } = makeCanvas();
    const first = await openPanel(options);
    cli.calls.length = 0;
    const again = await options.open(ctxFor('panel-1', { input: { files: ['src/y.ts'] } }));
    expect(again.url).toBe(first.url);
    expect(servers.length).toBe(1);
    expect(cli.calls.some((call) => call.args.includes('src/y.ts'))).toBe(true);
  });

  test('M7: a runtime that rejects canvases still gets the workflow, and the failure is logged', async () => {
    const joined: Array<Record<string, unknown>> = [];
    const logged: string[] = [];
    const session = { log: async (message: string) => void logged.push(message) };
    await register({
      defineWorkflow: (definition: unknown) => ({ definition }),
      createCanvas: (options: unknown) => ({ options }),
      joinSession: async (config: Record<string, unknown>) => {
        joined.push(config);
        if (config['canvases']) throw new Error('unknown field canvases');
        return session;
      },
      workflow: () => ({}),
      canvas: () => ({}),
    });
    expect(joined.length).toBe(2);
    expect(joined[1]?.['canvases']).toBeUndefined();
    expect((joined[1]?.['workflows'] as unknown[]).length).toBe(1);
    expect(logged.join('\n')).toContain('unknown field canvases');
  });

  test('M7: a rejection with nothing left to retry still surfaces', async () => {
    await expect(
      register({
        defineWorkflow: () => {
          throw new Error('bad workflow');
        },
        createCanvas: (options: unknown) => ({ options }),
        joinSession: async () => {
          throw new Error('no canvases here');
        },
        workflow: () => ({}),
        canvas: () => ({}),
      }),
    ).rejects.toThrow('no canvases here');
  });

  test('M5: page lookups keyed by untrusted ids go through Map or own-property checks', () => {
    expect(PAGE_JS).toContain('new Map(');
    expect(PAGE_JS).toContain('hasOwnProperty');
    // No plain-object table indexed by a repository-supplied value.
    expect(PAGE_JS).not.toMatch(/_TONE\[/);
    expect(PAGE_JS).not.toMatch(/byId\[|seen\[/);
  });

  test('M6: an agent-supplied review is labelled apart from a followed run', () => {
    expect(PAGE_JS).toContain('supplied by the agent');
    expect(PAGE_JS).toContain('not a run this panel followed');
  });

  test('I1: inline style is allowed for the app theme, inline script is not', () => {
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(CSP).toContain("script-src 'self';");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});

/** A minimal DOM, enough to run the shipped page script and read what it built. */
class FakeNode {
  children: FakeNode[] = [];
  textContent = '';
  className = '';
  type = '';
  title = '';
  disabled = false;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
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
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  addEventListener(type: string, listener: () => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(' ');
  }
}

async function renderPageWith(state: unknown) {
  const { runInNewContext } = await import('node:vm');
  const nodes = new Map(['status', 'cwd', 'refresh', 'run-review', 'message', 'app'].map((id) => [id, new FakeNode(id)]));
  const context = {
    window: { location: { search: '?token=t' } },
    document: { getElementById: (id: string) => nodes.get(id) ?? null, createElement: (tag: string) => new FakeNode(tag) },
    fetch: async () => ({ ok: true, status: 200, json: async () => state }),
    URLSearchParams,
  };
  runInNewContext(PAGE_JS, context);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return nodes;
}

describe('app smoke round', () => {
  const completed = {
    status: 'ok',
    checkExitCode: 0,
    lintExitCode: 0,
    files: ['src/a.ts'],
    filesSource: 'args',
    notes: [],
    governing: [governed('0012', 'governing')],
    history: [],
    verdicts: [{ recordId: '0012', title: 'T', verdict: 'consistent', evidence: 'panel run' }],
    unverified: [],
    findings: [],
  };
  const agentCopy = { ...completed, verdicts: [{ ...completed.verdicts[0], evidence: 'agent copy' }] };

  test('show_review leaves a run the panel is following alone', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'running' }]);
    const { options } = makeCanvas({ getSession: () => fake.session, sleep: () => new Promise(() => {}) });
    await openPanel(options);
    await action(options, 'run_review')({});
    const state = await action(options, 'show_review')({ result: agentCopy });
    expect(state.ignored).toContain('run-1');
    expect(state.review.runId).toBe('run-1');
    expect(state.review.runStatus).toBe('running');
  });

  test('show_review leaves a completed panel-started run alone', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'completed', result: completed }]);
    const { options } = makeCanvas({ getSession: () => fake.session });
    await openPanel(options);
    await action(options, 'run_review')({});
    await settle(() => action(options, 'get_state')());
    const state = await action(options, 'show_review')({ result: agentCopy });
    expect(state.ignored).toContain('run-1');
    expect(state.review.runId).toBe('run-1');
    expect(state.review.result.verdicts[0].evidence).toBe('panel run');
  });

  test('show_review still displays a result when the panel started no run', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    const state = await action(options, 'show_review')({ result: agentCopy });
    expect(state.ignored).toBeUndefined();
    expect(state.review.result.verdicts[0].evidence).toBe('agent copy');
  });

  test('the show_review description steers the agent away from panel-started runs', () => {
    const { options } = makeCanvas();
    const show = options.actions.find((entry: { name: string }) => entry.name === 'show_review');
    expect(show?.description).toMatch(/did not start itself/);
    expect(show?.description).toMatch(/do not call this for them/);
  });

  test('a null input is accepted by every optional-input schema', () => {
    const { options } = makeCanvas();
    const schemas = [
      options.inputSchema,
      ...options.actions
        .filter((entry: { name: string }) => entry.name === 'refresh' || entry.name === 'run_review')
        .map((entry: { inputSchema?: unknown }) => entry.inputSchema),
    ];
    expect(schemas.length).toBe(3);
    for (const schema of schemas) expect((schema as { type: unknown }).type).toEqual(['object', 'null']);
  });

  test('null input means "no input": open works and refresh and run_review reuse remembered args', async () => {
    const fake = fakeSession([{ runId: 'run-1', status: 'running' }]);
    const { options, cli } = makeCanvas({ getSession: () => fake.session, sleep: () => new Promise(() => {}) });
    const opened = await openPanel(options, 'panel-1', { input: null });
    expect(opened.status).not.toContain('usage-error');
    await action(options, 'refresh')({ files: ['src/k.ts'] });
    cli.calls.length = 0;
    const refreshed = await action(options, 'refresh')(null);
    expect(refreshed.files).toEqual(['src/k.ts']);
    await action(options, 'run_review')(null);
    expect(fake.started).toEqual([{ name: 'adr-review', args: { files: ['src/k.ts'] } }]);
  });

  test('the run button is disabled with a stated reason when there are no changed files', async () => {
    const base = { workingDirectory: CWD, status: 'ok', governing: [], history: [], activeProposals: [], findings: [], notes: [], review: null };
    const empty = await renderPageWith({ ...base, files: [] });
    const button = empty.get('run-review') as FakeNode;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('No changed files to review');
    expect(button.attrs['aria-description']).toBe('No changed files to review');

    const some = await renderPageWith({ ...base, files: ['src/a.ts'] });
    const enabled = some.get('run-review') as FakeNode;
    expect(enabled.disabled).toBe(false);
    expect(enabled.attrs['aria-description']).toBeUndefined();
  });

  test('the page labels an agent-supplied review and not a followed one', async () => {
    const base = { workingDirectory: CWD, status: 'ok', files: ['src/a.ts'], governing: [], history: [], activeProposals: [], findings: [], notes: [] };
    const supplied = await renderPageWith({ ...base, review: { runStatus: 'completed', result: completed } });
    expect((supplied.get('app') as FakeNode).allText()).toContain('not a run this panel followed');
    const followed = await renderPageWith({ ...base, review: { runId: 'run-1', runStatus: 'completed', result: completed } });
    expect((followed.get('app') as FakeNode).allText()).not.toContain('not a run this panel followed');
  });
});

describe('PR review round', () => {
  const clean = {
    status: 'ok',
    checkExitCode: 0,
    lintExitCode: 0,
    files: ['src/a.ts'],
    filesSource: 'args',
    notes: [],
    governing: [governed('0012', 'governing')],
    history: [],
    verdicts: [{ recordId: '0012', title: 'T', verdict: 'consistent', evidence: 'e' }],
    unverified: [],
    findings: [],
  };
  const conflicting = { ...clean.verdicts[0], verdict: 'conflicts' };

  test('sanitizeReviewResult refuses a status cleaner than its own payload', () => {
    for (const bad of [
      { ...clean, checkExitCode: 1 },
      { ...clean, lintExitCode: 1 },
      { ...clean, checkExitCode: 2 },
      { ...clean, verdicts: [conflicting] },
      { ...clean, verdicts: [], unverified: ['0012'] },
      { ...clean, status: 'incomplete', verdicts: [conflicting] },
      { ...clean, status: 'findings', checkExitCode: 2 },
    ]) {
      expect(() => sanitizeReviewResult(bad)).toThrow(/status/);
    }
  });

  test('sanitizeReviewResult keeps a status at least as severe as its payload', () => {
    // `incomplete` and `usage-error` can come from inputs the payload does not
    // carry (a partial file set, an unresolved base), so worse is allowed.
    for (const good of [
      clean,
      { ...clean, status: 'incomplete' },
      { ...clean, status: 'usage-error' },
      { ...clean, status: 'findings', verdicts: [conflicting] },
    ]) {
      expect(sanitizeReviewResult(good).status).toBe(good.status);
    }
  });

  test('show_review refuses a result that describes a different change', async () => {
    const { options } = makeCanvas();
    await openPanel(options);
    const show = action(options, 'show_review');
    await expect(Promise.resolve().then(() => show({ result: { ...clean, files: ['src/other.ts'] } }))).rejects.toThrow(
      /different change/,
    );
    await expect(
      Promise.resolve().then(() =>
        show({
          result: {
            ...clean,
            governing: [governed('0012', 'governing'), governed('0099', 'governing')],
            unverified: ['0099'],
            status: 'incomplete',
          },
        }),
      ),
    ).rejects.toThrow(/different change/);
    expect((await action(options, 'get_state')()).review).toBeNull();
  });

  test('show_review accepts a result for the same files and records in any order', async () => {
    const cli = fakeCli({
      diff: ok('src/b.ts\0src/a.ts\0'),
      check: ok(checkReport([governed('0013', 'governing'), governed('0012', 'governing')])),
    });
    const { options } = makeCanvas({ run: cli.run });
    await openPanel(options);
    const state = await action(options, 'show_review')({
      result: {
        ...clean,
        files: ['src/a.ts', 'src/b.ts'],
        governing: [governed('0012', 'governing'), governed('0013', 'governing')],
        verdicts: [clean.verdicts[0], { ...clean.verdicts[0], recordId: '0013' }],
      },
    });
    expect(state.review).not.toBeNull();
    expect(state.status).toBe('ok');
  });

  /** A `stat` whose answers the test changes, keyed by absolute path. */
  function fakeStat() {
    const files = new Map<string, { size: number; mtimeMs: number }>([[join(CWD, 'src/a.ts'), { size: 10, mtimeMs: 1 }]]);
    const stat = async (path: string) => {
      const found = files.get(path);
      if (!found) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return found;
    };
    return { files, stat };
  }

  test('refresh drops a shown review once a reviewed file changes on disk', async () => {
    const disk = fakeStat();
    const { options } = makeCanvas({ stat: disk.stat });
    await openPanel(options);
    await action(options, 'show_review')({ result: clean });
    expect((await action(options, 'refresh')()).review).not.toBeNull();
    disk.files.set(join(CWD, 'src/a.ts'), { size: 10, mtimeMs: 2 });
    const state = await action(options, 'refresh')();
    expect(state.review).toBeNull();
    expect(state.status).toBe('incomplete');
  });

  test('refresh drops a panel run whose files changed after it started', async () => {
    const disk = fakeStat();
    let finish = false;
    const session = {
      send: async () => 'm',
      log: async () => {},
      rpc: {
        workflow: {
          run: async () => ({ runId: 'run-1', status: 'running' }),
          getRun: async () => (finish ? { runId: 'run-1', status: 'completed', result: clean } : { runId: 'run-1', status: 'running' }),
        },
      },
    };
    const { options } = makeCanvas({
      stat: disk.stat,
      getSession: () => session,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    });
    await openPanel(options);
    await action(options, 'run_review')({});
    // Edited while the run was judging the earlier contents.
    disk.files.set(join(CWD, 'src/a.ts'), { size: 11, mtimeMs: 1 });
    finish = true;
    const settled = await settle(() => action(options, 'get_state')());
    expect(settled.review.runId).toBe('run-1');
    const state = await action(options, 'refresh')();
    expect(state.review).toBeNull();
  });

  test('a run-review refusal over HTTP never echoes the error text', async () => {
    const { options } = makeCanvas();
    const { url } = await openPanel(options, 'panel-1', { input: { base: '-x' } });
    const response = await send(withPath(url, '/api/run-review'), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url) },
    });
    expect(response.status).toBe(400);
    expect(response.body).not.toContain("must not start with '-'");
    expect(response.body).not.toContain('-x');
    expect(JSON.parse(response.body).error.length).toBeGreaterThan(0);
  });

  test('an explain that cannot reach the agent never echoes the error text', async () => {
    const fake = fakeSession();
    fake.session.send = async () => {
      throw new Error('internal detail /Users/someone/secret');
    };
    const { options } = makeCanvas({ getSession: () => fake.session });
    const { url } = await openPanel(options);
    const response = await send(withPath(url, '/api/explain'), {
      method: 'POST',
      headers: { 'X-Adrkit-Token': tokenOf(url), 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: '0012' }),
    });
    expect(response.status).toBe(502);
    expect(response.body).not.toContain('internal detail');
  });
});
