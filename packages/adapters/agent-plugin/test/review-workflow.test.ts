import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from './harness.ts';
import {
  ADR_REVIEW_META,
  DECISION_CHECKER_AGENT,
  VERDICT_SCHEMA,
  assembleResult,
  buildJudgePrompt,
  collectChangedFiles,
  createReviewWorkflow,
  resolveCli,
  reviewWorkflow,
  runCommand,
  validateArgs,
} from '../extensions/adrkit/review.mjs';
import { trackWorkingDirectory } from '../extensions/adrkit/session-dir.mjs';

/**
 * The `adr-review` workflow's logic, exercised without the Copilot SDK.
 *
 * `review.mjs` imports nothing from `@github/copilot-sdk` precisely so this file
 * can run under Bun: every process, filesystem probe, and workflow context is
 * injected. What these tests pin is the part the host cannot: `copilot workflow
 * run` exits 0 whatever happens (ADR-0045), so a thrown error, a dropped
 * judgment, or a misread exit code would all read as success to a caller.
 */

type Run = { stdout: string; stderr: string; exitCode: number };

const missing = () => false;

describe('resolveCli', () => {
  test('$ADRKIT_CLI wins, made absolute against the workspace', () => {
    // Absolute so the value can never be read as a flag by node or by execFile.
    const resolved = resolveCli({
      env: { ADRKIT_CLI: 'tools/adr', ADRKIT_ALLOW_REPO_CLI: '1' },
      cwd: '/repo',
      exists: () => true,
    });
    expect(resolved).toEqual({ command: '/repo/tools/adr', args: [], source: 'env' });
  });

  test('an option-shaped $ADRKIT_CLI becomes a path, not a node flag', () => {
    const resolved = resolveCli({
      env: { ADRKIT_CLI: '--require=evil.js' },
      cwd: '/repo',
      exists: () => true,
    });
    expect(resolved).toEqual({ command: 'node', args: ['/repo/--require=evil.js'], source: 'env' });
  });

  test('a JavaScript entry point runs under node, as the Spec Kit helper does', () => {
    const resolved = resolveCli({
      env: { ADRKIT_CLI: '/src/cli/dist/index.js' },
      cwd: '/repo',
      exists: () => true,
    });
    expect(resolved).toEqual({ command: 'node', args: ['/src/cli/dist/index.js'], source: 'env' });
  });

  test('a configured CLI that does not exist is an error, not a silent fallback', () => {
    // Falling through to PATH would run a different CLI than the one the user
    // named, and report its answer as theirs.
    expect(() => resolveCli({ env: { ADRKIT_CLI: '/nope' }, cwd: '/r', exists: missing })).toThrow(
      /ADRKIT_CLI is set, but nothing exists at that path/,
    );
  });

  test('the repository-local CLI is used only when ADRKIT_ALLOW_REPO_CLI is exactly "1"', () => {
    const repoCli = '/repo/node_modules/.bin/adr';
    const exists = (path: string) => path === repoCli;
    expect(resolveCli({ env: { ADRKIT_ALLOW_REPO_CLI: '1' }, cwd: '/repo', exists })).toEqual({
      command: repoCli,
      args: [],
      source: 'repo',
    });
    // Plugin extensions run outside Copilot's permission prompts, and a
    // non-interactive run cannot ask, so anything short of the exact opt-in
    // leaves an inherited repository's binary unexecuted (ADR-0034).
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      expect({ value, resolved: resolveCli({ env: { ADRKIT_ALLOW_REPO_CLI: value }, cwd: '/repo', exists }) })
        .toEqual({ value, resolved: { command: 'adr', args: [], source: 'path' } });
    }
  });

  test('PATH is the last resort', () => {
    expect(resolveCli({ env: { ADRKIT_ALLOW_REPO_CLI: '1' }, cwd: '/repo', exists: missing })).toEqual({
      command: 'adr',
      args: [],
      source: 'path',
    });
  });
});

describe('runCommand', () => {
  type Listener = (...args: unknown[]) => void;

  /** A minimal ChildProcess: `emit` drives it, `calls` records the spawn. */
  function fakeSpawn(script: (child: ReturnType<typeof makeChild>) => void, pid = 4242) {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = (command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      const child = makeChild(pid);
      queueMicrotask(() => script(child));
      return child;
    };
    return { spawn, calls };
  }

  function makeChild(pid: number) {
    const emitter = () => {
      const listeners: Record<string, Listener[]> = {};
      return {
        on(event: string, listener: Listener) {
          (listeners[event] ??= []).push(listener);
          return this;
        },
        once(event: string, listener: Listener) {
          return this.on(event, listener);
        },
        emit(event: string, ...args: unknown[]) {
          for (const listener of listeners[event] ?? []) listener(...args);
        },
      };
    };
    return Object.assign(emitter(), { pid, stdout: emitter(), stderr: emitter(), kill: () => true });
  }

  // A group probe (signal 0) reports the group gone, so nothing stays tracked.
  const gone = (_pid: number, sig: string | number) => {
    if (sig === '0' || sig === 0) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  };
  const posix = { platform: 'darwin' as const, kill: gone };

  test('exit 0 resolves with the output, with stdin closed and its own process group on POSIX', async () => {
    const { spawn, calls } = fakeSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{}'));
      child.emit('close', 0, null);
    });
    const signal = new AbortController().signal;
    const result = await runCommand('adr', ['lint'], { cwd: '/repo', signal, spawn, ...posix });
    expect(result).toEqual({ stdout: '{}', stderr: '', exitCode: 0 });
    expect(calls[0]?.options['cwd']).toBe('/repo');
    expect((calls[0]?.options['stdio'] as string[])[0]).toBe('ignore');
    expect(calls[0]?.options['detached']).toBe(true);
    // The signal is handled here, by signalling the group, not by spawn.
    expect(calls[0]?.options['signal']).toBeUndefined();
  });

  test('on Windows the child is not detached and spawn handles the signal', async () => {
    const { spawn, calls } = fakeSpawn((child) => child.emit('close', 0, null));
    const signal = new AbortController().signal;
    await runCommand('adr', ['lint'], { cwd: '/repo', signal, spawn, platform: 'win32' });
    expect(calls[0]?.options['detached']).toBeUndefined();
    expect(calls[0]?.options['signal']).toBe(signal);
  });

  test('a non-zero exit is data, not a rejection', async () => {
    // `adr check` exits 1 with a complete report. Rejecting here would make the
    // run settle as an error that the host then reports with exit code 0.
    const { spawn } = fakeSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{"ok":false}'));
      child.stderr.emit('data', Buffer.from('warn'));
      child.emit('close', 1, null);
    });
    const result = await runCommand('adr', ['check'], { cwd: '/repo', spawn, ...posix });
    expect(result).toEqual({ stdout: '{"ok":false}', stderr: 'warn', exitCode: 1 });
  });

  test('a spawn failure rejects and names what is missing', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.emit('error', Object.assign(new Error('spawn adr ENOENT'), { code: 'ENOENT' }));
      child.emit('close', -2, null);
    });
    const failure = runCommand('adr', ['check'], { cwd: '/repo', spawn, ...posix });
    await expect(failure).rejects.toThrow(/"adr".*not found/);
    await expect(failure).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('cancellation rejects as an AbortError and signals the whole process group', async () => {
    const kills: Array<[number, string]> = [];
    const { spawn } = fakeSpawn(() => {}, 777);
    const controller = new AbortController();
    const failure = runCommand('adr', ['check'], {
      cwd: '/repo',
      signal: controller.signal,
      spawn,
      platform: 'linux',
      kill: (pid: number, sig: string | number) => void kills.push([pid, String(sig)]),
      graceMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await expect(failure).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Negative pid: the group, so a grandchild behind a shim goes too.
    expect(kills).toEqual([
      [-777, 'SIGTERM'],
      [-777, 'SIGKILL'],
    ]);
  });

  test('an already-aborted signal spawns nothing', async () => {
    const { spawn, calls } = fakeSpawn(() => {});
    const controller = new AbortController();
    controller.abort();
    await expect(runCommand('adr', ['check'], { cwd: '/repo', signal: controller.signal, spawn, ...posix })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toEqual([]);
  });

  test('a group that is already gone (ESRCH) is not an error', async () => {
    const { spawn } = fakeSpawn(() => {});
    const controller = new AbortController();
    const failure = runCommand('adr', ['check'], {
      cwd: '/repo',
      signal: controller.signal,
      spawn,
      platform: 'linux',
      kill: () => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      },
      graceMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await expect(failure).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  test('output past the buffer cap rejects with the maxBuffer code and ends the group', async () => {
    const kills: Array<[number, string]> = [];
    const { spawn } = fakeSpawn((child) => child.stdout.emit('data', Buffer.from('x'.repeat(20))), 99);
    const failure = runCommand('adr', ['check'], {
      cwd: '/repo',
      spawn,
      platform: 'linux',
      kill: (pid: number, sig: string | number) => void kills.push([pid, String(sig)]),
      maxBuffer: 10,
      graceMs: 1,
    });
    await expect(failure).rejects.toMatchObject({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    expect(kills[0]).toEqual([-99, 'SIGTERM']);
  });

  test('a child ended by a signal it did not get from us rejects with that signal', async () => {
    const { spawn } = fakeSpawn((child) => child.emit('close', null, 'SIGKILL'));
    await expect(runCommand('adr', ['check'], { cwd: '/repo', spawn, ...posix })).rejects.toMatchObject({ signal: 'SIGKILL' });
  });
});

describe.skipIf(process.platform === 'win32')('runCommand timeouts end the whole process tree (POSIX)', () => {
  // A version-manager shim is a shell script that starts node. Signalling only
  // the shell left the node process (the grandchild) running. The wrapper here
  // starts a long sleep in the background, records its pid, and waits on it.
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitGone = async (pid: number, ms: number) => {
    const until = Date.now() + ms;
    while (alive(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
    return !alive(pid);
  };
  let grandchild = 0;
  let dir = '';
  afterEach(() => {
    if (grandchild > 0 && alive(grandchild)) process.kill(grandchild, 'SIGKILL');
    grandchild = 0;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  function shim() {
    dir = mkdtempSync(join(tmpdir(), 'adrkit-tree-'));
    const script = join(dir, 'shim.sh');
    const pidFile = join(dir, 'grandchild.pid');
    writeFileSync(script, `#!/bin/sh\nsleep 300 &\necho $! > "${pidFile}"\nwait\n`, { mode: 0o755 });
    return { script, pidFile };
  }

  async function readPid(pidFile: string) {
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    for (let i = 0; i < 200; i++) {
      const text = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : '';
      if (/^\d+$/.test(text)) return Number(text);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the shim never recorded its grandchild');
  }

  test('a timeout signals the group, and the grandchild is gone afterwards', async () => {
    const { script, pidFile } = shim();
    const failure = runCommand('/bin/sh', [script], { cwd: dir, signal: AbortSignal.timeout(400), spawn: nodeSpawn });
    grandchild = await readPid(pidFile);
    expect(alive(grandchild)).toBe(true);
    await expect(failure).rejects.toMatchObject({ name: 'AbortError' });
    expect(await waitGone(grandchild, 5000)).toBe(true);
  });

  test('a normal extension exit takes running detached children with it', () => {
    // The extension process exits while a check is still running: the child
    // is in its own process group, so nothing else would end it.
    const { script, pidFile } = shim();
    const review = pathToFileURL(join(packageRoot, 'extensions', 'adrkit', 'review.mjs')).href;
    const program = [
      `import { spawn } from 'node:child_process';`,
      `import { existsSync, readFileSync } from 'node:fs';`,
      `import { runCommand } from ${JSON.stringify(review)};`,
      `runCommand('/bin/sh', [${JSON.stringify(script)}], { cwd: ${JSON.stringify(dir)}, spawn }).catch(() => {});`,
      `const started = Date.now();`,
      `const poll = setInterval(() => {`,
      `  if (existsSync(${JSON.stringify(pidFile)}) && readFileSync(${JSON.stringify(pidFile)}, 'utf8').trim()) { clearInterval(poll); process.exit(0); }`,
      `  if (Date.now() - started > 5000) process.exit(3);`,
      `}, 10);`,
    ].join('\n');
    execFileSync('node', ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10_000 });
    grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    const until = Date.now() + 3000;
    while (alive(grandchild) && Date.now() < until) Bun.sleepSync(25);
    expect(alive(grandchild)).toBe(false);
  });
});

describe('validateArgs', () => {
  test('accepts an empty object', () => {
    expect(validateArgs({})).toEqual({});
    expect(validateArgs(undefined)).toEqual({});
  });

  test('passes valid arguments through', () => {
    expect(
      validateArgs({ files: ['src/a.ts'], base: 'main', dir: 'docs/adr' }),
    ).toEqual({ files: ['src/a.ts'], base: 'main', dir: 'docs/adr' });
  });

  test.each([
    ['an absolute path', { files: ['/etc/passwd'] }],
    ['a Windows absolute path', { files: ['C:\\x\\y.ts'] }],
    ['a parent-directory segment', { files: ['src/../../secret'] }],
    ['an empty path', { files: [''] }],
    ['a non-string path', { files: [42] }],
    ['a non-array files', { files: 'src/a.ts' }],
    ['an option-shaped base', { base: '--output=/tmp/x' }],
    ['an option-shaped dir', { dir: '-x' }],
    // Arguments can be written by a model that read untrusted content, so they
    // never choose what is executed: both former keys are now unknown.
    ['a cli argument', { cli: '/tmp/evil' }],
    ['an allowRepoCli argument', { allowRepoCli: true }],
    ['an unknown key', { allowRepoCLI: true }],
    ['a non-object', ['src/a.ts']],
  ])('rejects %s', (_name, raw) => {
    expect(() => validateArgs(raw)).toThrow();
  });
});

describe('collectChangedFiles', () => {
  test('explicit files are used verbatim and run nothing', async () => {
    const run = async (): Promise<Run> => {
      throw new Error('must not run');
    };
    expect(await collectChangedFiles({ files: ['a.ts'] }, run)).toEqual({
      files: ['a.ts'],
      source: 'args',
      notes: [],
    });
  });

  test('without files, diffs against origin/main by default', async () => {
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]): Promise<Run> => {
      calls.push(args);
      return { stdout: 'a.ts\0b/c.ts\0', stderr: '', exitCode: 0 };
    };
    const result = await collectChangedFiles({}, run);
    expect(calls).toEqual([['diff', '--name-only', '-z', 'origin/main...HEAD']]);
    expect(result).toEqual({ files: ['a.ts', 'b/c.ts'], source: 'git:origin/main...HEAD', notes: [] });
  });

  test('an unresolved default base falls back to the working tree and records why', async () => {
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]): Promise<Run> => {
      calls.push(args);
      if (args.includes('origin/main...HEAD')) {
        return { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 };
      }
      return { stdout: 'x.ts\0', stderr: '', exitCode: 0 };
    };
    const result = await collectChangedFiles({}, run);
    // Deletions are included on the fallback too: removing a governed file can break its decision.
    expect(calls[1]).toEqual(['diff', '--name-only', '-z', 'HEAD']);
    expect(result.files).toEqual(['x.ts']);
    expect(result.source).toBe('git:HEAD');
    expect(result.notes.join('\n')).toMatch(/origin\/main.*fell back/);
  });

  test('an explicit base that does not resolve throws base-unresolved, with no fallback', async () => {
    // Falling back would review something other than what the caller asked for.
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]): Promise<Run> => {
      calls.push(args);
      if (args.includes('feature...HEAD')) {
        return { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 };
      }
      return { stdout: 'x.ts\0', stderr: '', exitCode: 0 };
    };
    await expect(collectChangedFiles({ base: 'feature' }, run)).rejects.toMatchObject({ code: 'base-unresolved' });
    expect(calls).toHaveLength(1);
  });

  test('an unresolved default base over a clean working tree throws instead of reviewing nothing', async () => {
    // The shallow-clone CI case: an empty fallback would read as a clean `ok`.
    const run = async (_command: string, args: string[]): Promise<Run> =>
      args.includes('origin/main...HEAD')
        ? { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 }
        : { stdout: '', stderr: '', exitCode: 0 };
    await expect(collectChangedFiles({}, run)).rejects.toThrow(
      'origin/main did not resolve and the working tree has no changes; pass files or base, ' +
        'or fetch history (e.g. actions/checkout fetch-depth: 0)',
    );
  });

  test('keeps non-ASCII and space-bearing paths byte-for-byte', async () => {
    // Without -z, core.quotepath prints "docs/\303\251t\303\251.md" with the
    // quotes, which no affects pattern matches: a silent false-clean.
    const run = async (): Promise<Run> => ({
      stdout: 'docs/été.md\0src/日本 語.ts\0',
      stderr: '',
      exitCode: 0,
    });
    expect((await collectChangedFiles({}, run)).files).toEqual(['docs/été.md', 'src/日本 語.ts']);
  });

  test('throws when both diffs fail, so the caller can report it', async () => {
    const run = async (): Promise<Run> => ({ stdout: '', stderr: 'not a git repository', exitCode: 128 });
    await expect(collectChangedFiles({}, run)).rejects.toMatchObject({ code: 'git-failed' });
  });
});

describe('buildJudgePrompt and the verdict contract', () => {
  const decision = {
    recordId: '0012',
    title: 'Use Postgres',
    status: 'accepted',
    bucket: 'governing',
    firedMatchers: [{ type: 'glob', pattern: 'db/**' }],
  };

  test('names the record, the paths, and the verdict vocabulary', () => {
    const prompt = buildJudgePrompt(decision, ['db/schema.sql'], { base: 'origin/main' });
    expect(prompt).toContain('0012');
    expect(prompt).toContain('db/schema.sql');
    expect(prompt).toContain('origin/main');
    for (const verdict of ['consistent', 'conflicts', 'unclear']) expect(prompt).toContain(verdict);
    expect(prompt).toMatch(/read-only/i);
  });

  test('treats a path as one quoted argument and a deletion as evidence', () => {
    // Paths come from the repository, so a hostile name must not become shell syntax.
    const prompt = buildJudgePrompt(decision, ['db/$(touch pwned).sql'], { base: 'origin/main' });
    expect(prompt).toContain(JSON.stringify(['db/$(touch pwned).sql']));
    expect(prompt).toMatch(/single quoted argument/);
    expect(prompt).toMatch(/deleted/i);
  });

  test('never names a writing command, even to forbid it', () => {
    // A host model reads an example as an instruction (the same reason the
    // wiring test forbids any mention in a component).
    const prompt = buildJudgePrompt(decision, ['db/schema.sql'], { base: 'origin/main' });
    expect(prompt).not.toMatch(/\badr (?:accept|new|migrate)\b/);
  });

  test('the schema requires a closed verdict and evidence', () => {
    expect(VERDICT_SCHEMA).toEqual({
      type: 'object',
      required: ['verdict', 'evidence'],
      properties: {
        verdict: { enum: ['consistent', 'conflicts', 'unclear'] },
        evidence: { type: 'string' },
      },
    });
  });

  test('the agent name is plugin-namespaced', () => {
    // Measured: the bare "decision-checker" resolves to null without throwing.
    expect(DECISION_CHECKER_AGENT).toBe('adrkit:decision-checker');
  });
});

describe('assembleResult status', () => {
  test.each([
    [0, 0, [], 'ok'],
    [1, 0, [], 'findings'],
    [0, 1, [], 'findings'],
    [0, 0, ['conflicts'], 'findings'],
    [0, 0, ['unclear', 'consistent'], 'ok'],
    [2, 0, [], 'usage-error'],
    [0, 2, [], 'usage-error'],
    [2, 1, ['conflicts'], 'usage-error'],
    [13, 0, [], 'usage-error'],
    [0, 13, [], 'usage-error'],
    [-1, 0, [], 'usage-error'],
    [137, 1, ['consistent'], 'usage-error'],
  ] as const)('check %p, lint %p, verdicts %p -> %p', (checkExitCode, lintExitCode, verdicts, status) => {
    const result = assembleResult({
      checkExitCode,
      lintExitCode,
      verdicts: verdicts.map((verdict, index) => ({
        recordId: `000${index}`,
        title: 't',
        verdict,
        evidence: 'e',
      })),
    });
    expect(result.status).toBe(status);
  });

  test('a partial file set is incomplete unless something worse fired', () => {
    expect(assembleResult({ checkExitCode: 0, lintExitCode: 0, partial: true }).status).toBe('incomplete');
    expect(assembleResult({ checkExitCode: 1, lintExitCode: 0, partial: true }).status).toBe('findings');
    expect(assembleResult({ checkExitCode: 2, lintExitCode: 0, partial: true }).status).toBe('usage-error');
  });

  test('always carries the full key set, even with no inputs', () => {
    expect(Object.keys(assembleResult({})).sort()).toEqual(
      [
        'checkExitCode',
        'files',
        'filesDigest',
        'filesOmitted',
        'filesSource',
        'findings',
        'governing',
        'history',
        'lintExitCode',
        'notes',
        'status',
        'unverified',
        'verdicts',
      ].sort(),
    );
  });

  test('an explicit usage error wins even without an exit code', () => {
    expect(assembleResult({ usageError: true }).status).toBe('usage-error');
  });

  const verdict = (recordId: string, value: string) => ({ recordId, title: 't', verdict: value, evidence: 'e' });

  // Precedence: usage-error > findings > incomplete > ok.
  test.each([
    ['every judgment missing', 'incomplete', { checkExitCode: 0, lintExitCode: 0, unverified: ['0001'] }],
    [
      'some judgments missing, the rest consistent',
      'incomplete',
      { checkExitCode: 0, lintExitCode: 0, verdicts: [verdict('0001', 'consistent')], unverified: ['0002'] },
    ],
    [
      'a conflict beside a missing judgment',
      'findings',
      { checkExitCode: 0, lintExitCode: 0, verdicts: [verdict('0001', 'conflicts')], unverified: ['0002'] },
    ],
    ['an adr exit 1 beside a missing judgment', 'findings', { checkExitCode: 1, lintExitCode: 0, unverified: ['0001'] }],
    ['a usage error beside a missing judgment', 'usage-error', { usageError: true, unverified: ['0001'] }],
    [
      'an undocumented exit beside a missing judgment',
      'usage-error',
      { checkExitCode: 0, lintExitCode: 13, unverified: ['0001'] },
    ],
  ] satisfies Array<[string, string, Parameters<typeof assembleResult>[0]]>)('%s -> %s', (_name, status, input) => {
    expect(assembleResult(input).status).toBe(status);
  });
});

describe('ADR_REVIEW_META', () => {
  test('declares the workflow without guessed limits', () => {
    expect(ADR_REVIEW_META.name).toBe('adr-review');
    expect(ADR_REVIEW_META.phases.map((phase: { title: string }) => phase.title)).toEqual([
      'Collect',
      'Check',
      'Judge',
    ]);
    expect('limits' in ADR_REVIEW_META).toBe(false);
    expect(ADR_REVIEW_META.description).toMatch(/advisory/i);
    expect(ADR_REVIEW_META.description).toMatch(/exit.code/i);
  });

  test('states the one gate and every status', () => {
    // The per-field data is detail; `status` alone is sufficient to gate on.
    expect(ADR_REVIEW_META.description).toContain('result.status is "ok"');
    for (const status of ['ok', 'findings', 'incomplete', 'usage-error']) {
      expect(ADR_REVIEW_META.description).toContain(status);
    }
  });
});

/**
 * A fake workflow context with the behaviors the docs promise: `step` runs its
 * producer, `pipeline` turns a throwing stage into `null` positionally, and
 * `agent` answers from a table keyed by label.
 */
function fakeContext(args: unknown, answers: Record<string, unknown> = {}) {
  const agentCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const steps: string[] = [];
  const ctx = {
    args,
    signal: new AbortController().signal,
    phase: () => {},
    log: (message: string) => logs.push(message),
    step: async (key: string, producer: () => unknown) => {
      steps.push(key);
      return await producer();
    },
    agent: async (prompt: string, options: Record<string, unknown>) => {
      agentCalls.push({ prompt, options });
      const answer = answers[String(options['label'])];
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    },
    pipeline: async (
      items: unknown[],
      stage: (previous: unknown, item: unknown, index: number) => Promise<unknown>,
    ) =>
      Promise.all(
        items.map(async (item, index) => {
          try {
            return await stage(undefined, item, index);
          } catch {
            return null;
          }
        }),
      ),
  };
  return { ctx, agentCalls, logs, steps };
}

const governing = (recordId: string) => ({
  recordId,
  title: `Record ${recordId}`,
  status: 'accepted',
  bucket: 'governing',
  firedMatchers: [],
});

function checkOutcome(governedBy: unknown[], findings: unknown[] = []) {
  return JSON.stringify({ changedFiles: [], governedBy, findings, ok: findings.length === 0 });
}

function fakeRunner(responses: { check?: Run; lint?: Run; git?: Run | ((args: string[]) => Run) }) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run = async (command: string, args: string[]): Promise<Run> => {
    calls.push({ command, args });
    if (command === 'git') {
      const git = responses.git;
      return (typeof git === 'function' ? git(args) : git) ?? { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'check') return responses.check ?? { stdout: checkOutcome([]), stderr: '', exitCode: 0 };
    if (args[0] === 'lint') return responses.lint ?? { stdout: '', stderr: '', exitCode: 0 };
    throw new Error(`unexpected ${command} ${args.join(' ')}`);
  };
  return { run, calls };
}

const deps = (run: (command: string, args: string[]) => Promise<Run>) => ({
  run,
  env: {},
  cwd: '/repo',
  exists: () => false,
});

describe('reviewWorkflow', () => {
  test('zero files returns ok before resolving or running the CLI', async () => {
    const { ctx, agentCalls } = fakeContext({ files: [] });
    const { run, calls } = fakeRunner({});
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('ok');
    expect(result.checkExitCode).toBeNull();
    expect(result.notes.join('\n')).toMatch(/no changed files/i);
    expect(calls).toEqual([]);
    expect(agentCalls).toEqual([]);
  });

  test('judges each governing record once, lists history, and never judges it', async () => {
    const outcome = checkOutcome([
      governing('0001'),
      { ...governing('0001'), firedMatchers: [{ type: 'glob', pattern: 'b/**' }] },
      governing('0002'),
      { ...governing('0003'), status: 'superseded', bucket: 'history', supersededBy: '0002' },
      { ...governing('0004'), status: 'proposed', bucket: 'activeProposals' },
    ]);
    const { ctx, agentCalls, steps } = fakeContext(
      { files: ['a.ts'] },
      {
        'judge:0001': { verdict: 'consistent', evidence: 'fine' },
        'judge:0002': { verdict: 'conflicts', evidence: 'uses MySQL' },
      },
    );
    const { run, calls } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));

    expect(steps).toEqual(['collect-v1', 'check-v1', 'lint-v1']);
    expect(calls.map((call) => call.args)).toEqual([
      ['check', '--json', '--', 'a.ts'],
      ['lint'],
    ]);
    expect(agentCalls.map((call) => call.options)).toEqual([
      { agent: 'adrkit:decision-checker', label: 'judge:0001', schema: VERDICT_SCHEMA },
      { agent: 'adrkit:decision-checker', label: 'judge:0002', schema: VERDICT_SCHEMA },
    ]);
    expect(result.governing.map((entry: { recordId: string }) => entry.recordId)).toEqual(['0001', '0002']);
    expect(result.history.map((entry: { recordId: string }) => entry.recordId)).toEqual(['0003']);
    expect(result.verdicts).toEqual([
      { recordId: '0001', title: 'Record 0001', verdict: 'consistent', evidence: 'fine' },
      { recordId: '0002', title: 'Record 0002', verdict: 'conflicts', evidence: 'uses MySQL' },
    ]);
    expect(result.unverified).toEqual([]);
    expect(result.status).toBe('findings');
  });

  test('a null or throwing judgment is reported as unverified, never dropped', async () => {
    const outcome = checkOutcome([governing('0001'), governing('0002'), governing('0003')]);
    const { ctx } = fakeContext(
      { files: ['a.ts'] },
      {
        'judge:0001': { verdict: 'consistent', evidence: 'ok' },
        'judge:0002': new Error('boom'),
        'judge:0003': { verdict: 'maybe', evidence: 'off-schema' },
      },
    );
    const { run } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.verdicts.map((entry: { recordId: string }) => entry.recordId)).toEqual(['0001']);
    expect(result.unverified).toEqual(['0002', '0003']);
    expect(result.status).toBe('incomplete');
  });

  test('a run whose every judgment is missing is incomplete, never ok', async () => {
    // The Judge phase failing outright must not look like a clean review.
    const outcome = checkOutcome([governing('0001'), governing('0002')]);
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(agentCalls).toHaveLength(2);
    expect(result.verdicts).toEqual([]);
    expect(result.unverified).toEqual(['0001', '0002']);
    expect(result.status).toBe('incomplete');
  });

  test('a conflict beside a missing judgment is findings', async () => {
    const outcome = checkOutcome([governing('0001'), governing('0002')]);
    const { ctx } = fakeContext({ files: ['a.ts'] }, { 'judge:0001': { verdict: 'conflicts', evidence: 'no' } });
    const { run } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.unverified).toEqual(['0002']);
    expect(result.status).toBe('findings');
  });

  test('lint exit 1 is data: Judge still runs, and the status is findings', async () => {
    // A corpus with error findings may have dropped a record, so a consistent
    // verdict over it is not enough for `ok`.
    const { ctx, agentCalls } = fakeContext(
      { files: ['a.ts'] },
      { 'judge:0001': { verdict: 'consistent', evidence: 'fine' } },
    );
    const { run } = fakeRunner({
      check: { stdout: checkOutcome([governing('0001')]), stderr: '', exitCode: 0 },
      lint: { stdout: '', stderr: '0007: invalid frontmatter', exitCode: 1 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(agentCalls).toHaveLength(1);
    expect(result.lintExitCode).toBe(1);
    expect(result.verdicts.map((entry: { verdict: string }) => entry.verdict)).toEqual(['consistent']);
    expect(result.notes.join('\n')).toContain('adr lint exited 1');
    expect(result.notes.join('\n')).not.toContain('0007: invalid frontmatter');
    expect(result.status).toBe('findings');
  });

  test('an explicit base that does not resolve is a usage-error with a fixed note', async () => {
    const { ctx, agentCalls } = fakeContext({ base: 'release/9' });
    const { run, calls } = fakeRunner({
      git: (args) =>
        args.includes('release/9...HEAD')
          ? { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 }
          : { stdout: 'src/x.ts\0', stderr: '', exitCode: 0 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('The given base did not resolve');
    expect(result.files).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(agentCalls).toEqual([]);
  });

  test('an unresolved origin/main over a clean working tree is a usage-error, not ok', async () => {
    const { ctx, agentCalls } = fakeContext({});
    const { run, calls } = fakeRunner({
      git: (args) =>
        args.includes('origin/main...HEAD')
          ? { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 }
          : { stdout: '', stderr: '', exitCode: 0 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain(
      'origin/main did not resolve and the working tree has no changes; pass files or base, ' +
        'or fetch history (e.g. actions/checkout fetch-depth: 0)',
    );
    expect(calls.every((call) => call.command === 'git')).toBe(true);
    expect(agentCalls).toEqual([]);
  });

  test('an unresolved origin/main with working-tree changes reviews them but is never ok', async () => {
    const { ctx, agentCalls } = fakeContext({}, { 'judge:0001': { verdict: 'consistent', evidence: 'fine' } });
    const { run, calls } = fakeRunner({
      git: (args) =>
        args.includes('origin/main...HEAD')
          ? { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 }
          : { stdout: 'src/x.ts\0', stderr: '', exitCode: 0 },
      check: { stdout: checkOutcome([governing('0001')]), stderr: '', exitCode: 0 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(calls[1]?.args).toEqual(['diff', '--name-only', '-z', 'HEAD']);
    expect(result.files).toEqual(['src/x.ts']);
    expect(result.filesSource).toBe('git:HEAD');
    expect(result.notes.join('\n')).toMatch(/origin\/main.*fell back/);
    expect(agentCalls[0]?.prompt).toContain('git diff HEAD -- <path>');
    // Incidental working-tree edits are not the change under review, so a
    // clean judgment of them must not read as a clean review.
    expect(result.status).toBe('incomplete');
  });

  test('check exit 1 is data: the report is still read and judged', async () => {
    const outcome = checkOutcome([governing('0001')], [{ rule: 'r', severity: 'error', message: 'm' }]);
    const { ctx, agentCalls } = fakeContext(
      { files: ['a.ts'] },
      { 'judge:0001': { verdict: 'consistent', evidence: 'ok' } },
    );
    const { run } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 1 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('findings');
    expect(result.checkExitCode).toBe(1);
    expect(result.findings).toEqual([{ rule: 'r', severity: 'error', message: 'm' }]);
    expect(agentCalls).toHaveLength(1);
  });

  test('check exit 2 skips Judge and returns usage-error with a fixed note', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: '', stderr: 'no ADR corpus at docs/adr', exitCode: 2 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('adr check exited 2 without a readable report');
    expect(result.notes.join('\n')).not.toContain('no ADR corpus at docs/adr');
    expect(agentCalls).toEqual([]);
  });

  test('lint exit 2 skips Judge and returns usage-error', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({
      check: { stdout: checkOutcome([governing('0001')]), stderr: '', exitCode: 0 },
      lint: { stdout: '', stderr: 'bad flag', exitCode: 2 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('adr lint exited 2');
    expect(result.notes.join('\n')).not.toContain('bad flag');
    expect(agentCalls).toEqual([]);
  });

  test('$ADRKIT_DIR is the corpus when dir is not given', async () => {
    const { ctx } = fakeContext({ files: ['a.ts'] });
    const { run, calls } = fakeRunner({});
    await reviewWorkflow(ctx, { ...deps(run), env: { ADRKIT_DIR: 'records' } });
    expect(calls.map((call) => call.args)).toEqual([
      ['check', '--json', '--dir', 'records', '--', 'a.ts'],
      ['lint', '--dir', 'records'],
    ]);
  });

  test.each([13, 139])('an undocumented check exit (%p) is a usage-error, even with a report', async (code) => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({
      check: { stdout: checkOutcome([governing('0001')]), stderr: 'crashed', exitCode: code },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.checkExitCode).toBe(code);
    expect(agentCalls).toEqual([]);
  });

  test('an undocumented lint exit is a usage-error and skips Judge', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({
      check: { stdout: checkOutcome([governing('0001')]), stderr: '', exitCode: 0 },
      lint: { stdout: '', stderr: 'segfault', exitCode: 13 },
    });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('adr lint exited 13');
    expect(result.notes.join('\n')).not.toContain('segfault');
    expect(agentCalls).toEqual([]);
  });

  test('explicit files are judged against origin/main by default, not HEAD', async () => {
    // A diff against HEAD is empty for committed work.
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({
      check: { stdout: checkOutcome([governing('0001')]), stderr: '', exitCode: 0 },
    });
    await reviewWorkflow(ctx, deps(run));
    expect(agentCalls[0]?.prompt).toContain('git diff origin/main...HEAD');
  });

  test('an argument cannot enable the repository-local CLI', async () => {
    const { ctx } = fakeContext({ files: ['a.ts'], allowRepoCli: true });
    const { run, calls } = fakeRunner({});
    const result = await reviewWorkflow(ctx, { ...deps(run), exists: () => true });
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toMatch(/an argument the workflow does not take was passed/);
    expect(calls).toEqual([]);
  });

  test('logs governedBy entries that are neither judged nor listed', async () => {
    const outcome = checkOutcome([{ ...governing('0004'), status: 'proposed', bucket: 'activeProposals' }]);
    const { ctx, logs } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: outcome, stderr: '', exitCode: 0 } });
    await reviewWorkflow(ctx, deps(run));
    expect(logs.join('\n')).toContain('0004 (activeProposals)');
  });

  test('unparseable check output is a usage-error, not a throw', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: 'not json', stderr: 'odd', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('adr check exited 0 without a readable report');
    expect(result.notes.join('\n')).not.toContain('odd');
    expect(agentCalls).toEqual([]);
  });

  test('invalid arguments return a usage-error instead of throwing', async () => {
    // A throw settles the run as an error with no result, behind exit 0.
    const { ctx } = fakeContext({ files: ['/etc/passwd'] });
    const { run, calls } = fakeRunner({});
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toMatch(/absolute/);
    expect(calls).toEqual([]);
  });

  test('a missing CLI returns a usage-error with a fixed note', async () => {
    const { ctx } = fakeContext({ files: ['a.ts'] });
    const run = async (command: string): Promise<Run> => {
      throw Object.assign(new Error(`could not start "${command}": not found`), { code: 'ENOENT' });
    };
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('The adr CLI could not be started');
  });

  test('passes --dir to both commands and collects files from git when none are given', async () => {
    const { ctx } = fakeContext({ dir: 'decisions', base: 'main' });
    const { run, calls } = fakeRunner({ git: { stdout: 'src/x.ts\0', stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['git', 'diff', '--name-only', '-z', 'main...HEAD'],
      ['adr', 'check', '--json', '--dir', 'decisions', '--', 'src/x.ts'],
      ['adr', 'lint', '--dir', 'decisions'],
    ]);
    expect(result.files).toEqual(['src/x.ts']);
    expect(result.filesSource).toBe('git:main...HEAD');
  });
});

describe('createReviewWorkflow follows the session directory', () => {
  // Measured on Copilot CLI 1.0.93: after `metadata.setWorkingDirectory` (what
  // `/cd` uses) the extension is not restarted and its `process.cwd()` does not
  // move, but it receives `session.context_changed`. The workflow reads the
  // tracked directory on each run, so a review after `/cd` reviews the new one.
  test('every git and adr call of a run uses the directory tracked at run time', async () => {
    const tracker = trackWorkingDirectory('/start');
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const definition = createReviewWorkflow({
      run: async (command: string, args: string[], options: { cwd: string; signal?: AbortSignal }) => {
        calls.push({ command, args, cwd: options.cwd });
        if (command === 'git') return { stdout: 'a.ts\0', stderr: '', exitCode: 0 };
        if (args.includes('check')) return { stdout: checkOutcome([]), stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      env: { ADRKIT_CLI: 'bin/adr' },
      exists: () => true,
      getCwd: tracker.get,
    });
    expect(definition.meta).toBe(ADR_REVIEW_META);
    tracker.observe({ type: 'session.context_changed', data: { cwd: '/moved' } });
    const { ctx } = fakeContext({});
    const result = await definition.run(ctx);
    expect(result.status).toBe('ok');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.cwd).toBe('/moved');
    // $ADRKIT_CLI is resolved against the tracked directory too.
    expect(calls.find((call) => call.command !== 'git')?.command).toBe('/moved/bin/adr');
  });
});
