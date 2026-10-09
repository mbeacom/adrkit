/**
 * No CLI stderr and no exception text reaches the panel page, `/api/state`, an
 * agent's canvas result, a tool result, hook context, or the workflow result.
 *
 * CodeQL `js/stack-trace-exposure` fired on the first canvas. These outputs
 * reach a model or a page, and stderr or an exception's text can carry install
 * paths, stack frames, and whatever a repository put in a path. Each test
 * plants one recognizable string in stderr, in a thrown error, or in an input
 * that used to be echoed, and asserts that it appears in none of the outputs.
 * The one decided exception, tools.mjs returning the CLI's own capped and
 * stack-stripped stderr on exit 2, is pinned in extension-tools.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, request as httpRequest } from 'node:http';
import { CANVAS_ID, computeSnapshot, createDecisionReviewCanvas } from '../extensions/adrkit/canvas.mjs';
import { createAdvisoryHooks } from '../extensions/adrkit/hooks.mjs';
import { reviewWorkflow } from '../extensions/adrkit/review.mjs';
import { createAdrTools } from '../extensions/adrkit/tools.mjs';

const SENTINEL = 'ZZ-SENTINEL-7f3a';
const STACK = `Error: ${SENTINEL}\n    at Object.<anonymous> (/Users/someone/.nvm/${SENTINEL}/adr.js:1:1)`;
const CWD = '/work/repo';

type Run = { stdout: string; stderr: string; exitCode: number };
type Answer = Run | Error;
type Script = { primary?: Answer; fallback?: Answer; check?: Answer; lint?: Answer; queue?: Answer };

const ok = (stdout = ''): Run => ({ stdout, stderr: '', exitCode: 0 });
const governing = (recordId: string) => ({ recordId, title: `Record ${recordId}`, status: 'accepted', bucket: 'governing', firedMatchers: [] });
const report = (entries: unknown[] = []) => JSON.stringify({ changedFiles: ['src/a.ts'], governedBy: entries, findings: [] });

/** git diff `<base>...HEAD` is `primary`, `git diff HEAD` is `fallback`. */
function scripted(script: Script) {
  return async (command: string, args: string[]): Promise<Run> => {
    const key =
      command === 'git'
        ? args.includes('HEAD') && !args.some((arg) => arg.endsWith('...HEAD'))
          ? 'fallback'
          : 'primary'
        : args.includes('check')
          ? 'check'
          : args.includes('queue')
            ? 'queue'
            : 'lint';
    const answer =
      script[key] ??
      (key === 'primary' || key === 'fallback' ? ok('src/a.ts\0') : key === 'check' ? ok(report([governing('0012')])) : ok());
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

const gitFails: Run = { stdout: '', stderr: `fatal: ${STACK}`, exitCode: 128 };
const thrown = () => Object.assign(new Error(STACK), { code: 'EWHATEVER' });

/** Each failure the extension has to report, as a script plus workflow args. */
const CASES: Array<[string, Script, unknown]> = [
  ['an explicit base that does not resolve', { primary: gitFails }, { base: 'feature' }],
  ['a default base that does not resolve (fallback used)', { primary: gitFails }, {}],
  ['git failing for both ranges', { primary: gitFails, fallback: gitFails }, {}],
  ['git that cannot be started', { primary: Object.assign(new Error(STACK), { code: 'ENOENT' }) }, {}],
  ['adr lint exiting 1 with stderr', { lint: { stdout: STACK, stderr: STACK, exitCode: 1 } }, {}],
  ['adr lint exiting 2 with stderr', { lint: { stdout: '', stderr: STACK, exitCode: 2 } }, {}],
  ['adr check exiting 3 with stderr', { check: { stdout: '', stderr: STACK, exitCode: 3 } }, {}],
  ['adr check exiting 0 with unreadable stdout', { check: { stdout: STACK, stderr: '', exitCode: 0 } }, {}],
  ['a runner rejection with no code', { check: thrown() }, {}],
  ['a runner rejection with ENOENT', { check: Object.assign(new Error(STACK), { code: 'ENOENT' }) }, {}],
  ['an echoed absolute file argument', {}, { files: [`/${SENTINEL}/a.ts`] }],
  ['an echoed .. file argument', {}, { files: [`${SENTINEL}/../../x`] }],
  ['an echoed unknown argument', {}, { [SENTINEL]: true }],
  ['an echoed option-shaped base', {}, { base: `-${SENTINEL}` }],
];

function fakeContext(args: unknown) {
  return {
    args,
    signal: new AbortController().signal,
    phase: () => {},
    log: () => {},
    step: async (_key: string, producer: () => unknown) => await producer(),
    agent: async () => ({ verdict: 'consistent', evidence: 'fine' }),
    pipeline: async (items: unknown[], stage: (previous: unknown, item: unknown) => Promise<unknown>) =>
      Promise.all(items.map((item) => stage(undefined, item))),
  };
}

const absent = (value: unknown) => expect(JSON.stringify(value) ?? '').not.toContain(SENTINEL);

describe('the workflow result carries no stderr or exception text', () => {
  test.each(CASES)('%s', async (_name, script, args) => {
    const result = await reviewWorkflow(fakeContext(args), { run: scripted(script), env: {}, cwd: CWD, exists: () => false });
    absent(result);
    // Something was still said: each failure leaves a note.
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test('an ADRKIT_CLI that does not exist is reported without its value', async () => {
    const result = await reviewWorkflow(fakeContext({}), {
      run: scripted({}),
      env: { ADRKIT_CLI: `/${SENTINEL}/adr` },
      cwd: CWD,
      exists: () => false,
    });
    absent(result);
    expect(result.status).toBe('usage-error');
  });
});

describe('the canvas snapshot carries no stderr or exception text', () => {
  test.each(CASES)('%s', async (_name, script, input) => {
    const snapshot = await computeSnapshot({ cwd: CWD, input, run: scripted(script), env: {}, exists: () => false, now: () => 'now' });
    absent(snapshot);
  });
});

const open: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

function canvasWith({ script = {}, session }: { script?: Script; session: Record<string, unknown> }) {
  const run = scripted(script);
  const options = createDecisionReviewCanvas({
    run: (command: string, args: string[]) => run(command, args),
    env: {},
    exists: () => false,
    getSession: () => session,
    createServer: (handler: any) => createServer(handler),
    sleep: async () => {},
    now: () => 'now',
  });
  const ctx = (extra: Record<string, unknown> = {}) => ({
    sessionId: 's',
    canvasId: CANVAS_ID,
    instanceId: 'panel-1',
    session: { workingDirectory: CWD },
    ...extra,
  });
  const action = (name: string) => (input?: unknown) =>
    Promise.resolve(options.actions.find((entry: { name: string }) => entry.name === name)!.handler({ ...ctx(), actionName: name, input }));
  const openPanel = async () => {
    const opened = await options.open(ctx());
    open.push(() => options.onClose(ctx()));
    return opened as { url: string };
  };
  return { options, action, openPanel };
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        // The event stream never ends; the first event is enough.
        if (res.headers['content-type']?.startsWith('text/event-stream') && data.includes('\n\n')) {
          resolve(data);
          req.destroy();
        }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

/** Everything an event stream sends within `ms`. */
function collect(url: string, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const req = httpRequest(url, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
    });
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    req.end();
    setTimeout(() => {
      req.destroy();
      resolve(data);
    }, ms);
  });
}

const at = (url: string, path: string) => {
  const parsed = new URL(url);
  const next = new URL(path, parsed.origin);
  next.searchParams.set('token', parsed.searchParams.get('token') as string);
  return next.toString();
};

const workflowSession = (rpc: { run?: () => Promise<unknown>; getRun?: () => Promise<unknown> }) => ({
  send: async () => 'm',
  log: async () => {},
  rpc: {
    workflow: {
      run: rpc.run ?? (async () => ({ runId: 'run-1', status: 'running' })),
      getRun: rpc.getRun ?? (async () => ({ runId: 'run-1', status: 'running' })),
    },
  },
});

describe('the panel page, /api/state, and agent results carry no stderr or exception text', () => {
  test('a failing check: state over HTTP, the event stream, and get_state', async () => {
    const { action, openPanel } = canvasWith({
      script: { check: { stdout: '', stderr: STACK, exitCode: 3 }, lint: { stdout: STACK, stderr: STACK, exitCode: 1 } },
      session: workflowSession({}),
    });
    const { url } = await openPanel();
    absent(await get(at(url, '/api/state')));
    absent(await get(at(url, '/events')));
    absent(await action('get_state')());
  });

  test.each([
    ['the workflow cannot start', { run: async () => Promise.reject(new Error(STACK)) }],
    ['the run cannot be read', { getRun: async () => Promise.reject(new Error(STACK)) }],
    ['the run ends with an error', { getRun: async () => ({ runId: 'run-1', status: 'error', error: STACK }) }],
    ['the run is halted with a reason', { getRun: async () => ({ runId: 'run-1', status: 'halted', reason: STACK }) }],
    ['the run completes without a readable result', { getRun: async () => ({ runId: 'run-1', status: 'completed', result: { status: STACK } }) }],
  ])('run_review when %s', async (_name, rpc) => {
    const { action, openPanel } = canvasWith({ session: workflowSession(rpc) });
    const { url } = await openPanel();
    // Every broadcast the page receives while the run is followed, not just
    // the last: a note can be shown and then replaced.
    const events = collect(at(url, '/events'), 100);
    absent(await action('run_review')());
    const seen = await events;
    absent(seen);
    expect(seen).toMatch(/adr-review (run run-1 |did not start)|Could not read adr-review run/);
    absent(await action('get_state')());
    absent(await get(at(url, '/api/state')));
  });

  test('run_review with invalid input refuses without echoing it', async () => {
    const { action, openPanel } = canvasWith({ session: workflowSession({}) });
    await openPanel();
    let message = '';
    try {
      await action('run_review')({ files: [`/${SENTINEL}`] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(SENTINEL);
  });

  test('refresh with invalid input notes the problem without echoing it', async () => {
    const { action, openPanel } = canvasWith({ session: workflowSession({}) });
    await openPanel();
    absent(await action('refresh')({ files: [`/${SENTINEL}`] }));
  });
});

describe('tool results carry no stderr or exception text', () => {
  const tools = (script: Script) =>
    createAdrTools({
      run: (command: string, args: string[]) => scripted(script)(command, args),
      env: {},
      exists: () => false,
      getCwd: () => CWD,
    });
  const call = async (script: Script, args: unknown) => {
    const tool = tools(script).find((entry: { name: string }) => entry.name === 'adr_check');
    return (await tool!.handler(args, {})) as { textResultForLlm: string; resultType: string };
  };

  test('base mode falling back to HEAD does not echo the git error', async () => {
    const result = await call({ primary: gitFails }, {});
    expect(result.resultType).toBe('success');
    absent(result.textResultForLlm);
  });

  test.each([
    ['an explicit base that does not resolve', { primary: gitFails }, { base: 'feature' }],
    ['git failing for both ranges', { primary: gitFails, fallback: gitFails }, {}],
    ['a runner rejection', { check: thrown() }, { paths: ['src/a.ts'] }],
    ['a crash with a stack on stderr', { check: { stdout: '', stderr: STACK, exitCode: 70 } }, { paths: ['src/a.ts'] }],
  ])('%s', async (_name, script, args) => {
    absent((await call(script, args)).textResultForLlm);
  });
});

describe('hook context and hook log lines carry no stderr or exception text', () => {
  const hooksWith = (run: (command: string, args: string[]) => Promise<Run>) => {
    const logged: string[] = [];
    const hooks = createAdvisoryHooks({
      run: (command: string, args: string[]) => run(command, args),
      env: {},
      exists: () => false,
      getSession: () => ({ log: async (message: string) => void logged.push(message) }),
      refreshCanvas: async () => {
        throw new Error(STACK);
      },
      setTimer: (fn: () => void) => {
        fn();
        return { unref: () => {} };
      },
      clearTimer: () => {},
    });
    return { hooks: hooks as NonNullable<typeof hooks>, logged };
  };

  test.each([
    ['a runner rejection', { primary: thrown(), check: thrown() }],
    ['git and adr failing with stderr', { primary: gitFails, fallback: gitFails, check: { stdout: '', stderr: STACK, exitCode: 3 } }],
  ])('%s', async (_name, script) => {
    const { hooks, logged } = hooksWith(scripted(script as Script));
    absent(await hooks.onSessionStart({ workingDirectory: CWD, source: 'new' }));
    absent(await hooks.onPostToolUse({ workingDirectory: CWD, sessionId: 's', toolName: 'edit', toolArgs: { path: `${CWD}/src/a.ts` } }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    absent(logged);
  });
});
