/**
 * Round 1 of the 0.8.1 review: the shared runner's ceiling timeout, its
 * group bookkeeping (L1, L2, L3), which tool a failure names (L5), cleanup
 * when the extension is stopped by a signal (M2), and the timeout path under
 * Node rather than Bun (L4).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMAND_CEILING_MS, publicMessage, REVIEW_MESSAGES, runCommand, isTrackedGroup } from '../extensions/adrkit/review.mjs';
import { packageRoot } from './harness.ts';

type Listener = (...args: unknown[]) => void;

function makeChild(pid: number) {
  const emitter = () => {
    const listeners: Record<string, Listener[]> = {};
    return {
      on(event: string, listener: Listener) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners[event] ?? []) listener(...args);
      },
    };
  };
  return Object.assign(emitter(), { pid, stdout: emitter(), stderr: emitter(), kill: () => true });
}

function fakeSpawn(pid: number) {
  const children: Array<ReturnType<typeof makeChild>> = [];
  const spawn = () => {
    const child = makeChild(pid);
    children.push(child);
    return child;
  };
  return { spawn, children };
}

/** A fake `kill` that records signals; `alive` decides what a signal-0 probe says. */
function fakeKill(state: { alive: boolean }) {
  const sent: Array<[number, string]> = [];
  const kill = (pid: number, sig: string | number) => {
    if (sig === 0 || sig === '0') {
      if (!state.alive) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      return;
    }
    sent.push([pid, String(sig)]);
  };
  return { kill, sent };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runCommand ceiling (M2)', () => {
  test('defaults to 120 s', () => {
    expect(COMMAND_CEILING_MS).toBe(120_000);
  });

  test('a call with no signal still ends at the ceiling, as a TimeoutError, and its group is signalled', async () => {
    const state = { alive: false };
    const { kill, sent } = fakeKill(state);
    const { spawn, children } = fakeSpawn(501);
    const failure = runCommand('adr', ['check'], { cwd: '/repo', spawn, platform: 'linux', kill, ceilingMs: 20, graceMs: 5 });
    await expect(failure).rejects.toMatchObject({ name: 'TimeoutError', code: 'ETIMEDOUT', tool: 'adr' });
    expect(sent[0]).toEqual([-501, 'SIGTERM']);
    children[0]!.emit('close', null, 'SIGTERM');
    expect(isTrackedGroup(501)).toBe(false);
  });
});

describe('runCommand group bookkeeping (L1, L2, L3)', () => {
  test('no SIGKILL once the whole group is gone (L1)', async () => {
    const state = { alive: false };
    const { kill, sent } = fakeKill(state);
    const { spawn, children } = fakeSpawn(502);
    const controller = new AbortController();
    const failure = runCommand('adr', ['check'], { cwd: '/repo', signal: controller.signal, spawn, platform: 'linux', kill, graceMs: 20 });
    await tick(1);
    controller.abort();
    await expect(failure).rejects.toMatchObject({ name: 'AbortError' });
    children[0]!.emit('close', null, 'SIGTERM');
    await tick(40);
    expect(sent).toEqual([[-502, 'SIGTERM']]);
    expect(isTrackedGroup(502)).toBe(false);
  });

  test('SIGKILL still follows when a member outlived the leader, and the group stays tracked until it is gone (L1, L2)', async () => {
    const state = { alive: true };
    const { kill, sent } = fakeKill(state);
    const { spawn, children } = fakeSpawn(503);
    const controller = new AbortController();
    const failure = runCommand('adr', ['check'], {
      cwd: '/repo',
      signal: controller.signal,
      spawn,
      platform: 'linux',
      kill,
      graceMs: 20,
      probeMs: 10,
    });
    await tick(1);
    controller.abort();
    await expect(failure).rejects.toMatchObject({ name: 'AbortError' });
    children[0]!.emit('close', null, 'SIGTERM');
    await tick(40);
    expect(sent).toEqual([
      [-503, 'SIGTERM'],
      [-503, 'SIGKILL'],
    ]);
    expect(isTrackedGroup(503)).toBe(true);
    state.alive = false;
    await tick(40);
    expect(isTrackedGroup(503)).toBe(false);
  });

  test('a normal close with a member still running keeps the group tracked (L2)', async () => {
    const state = { alive: true };
    const { kill } = fakeKill(state);
    const { spawn, children } = fakeSpawn(504);
    const done = runCommand('adr', ['check'], { cwd: '/repo', spawn, platform: 'linux', kill, probeMs: 10 });
    await tick(1);
    children[0]!.emit('close', 0, null);
    await done;
    expect(isTrackedGroup(504)).toBe(true);
    state.alive = false;
    await tick(30);
    expect(isTrackedGroup(504)).toBe(false);
  });

  test('overflow signals the group once, however many chunks follow (L3)', async () => {
    const state = { alive: false };
    const { kill, sent } = fakeKill(state);
    const { spawn, children } = fakeSpawn(505);
    const failure = runCommand('adr', ['check'], { cwd: '/repo', spawn, platform: 'linux', kill, maxBuffer: 4, graceMs: 5 });
    await tick(1);
    for (let i = 0; i < 5; i++) children[0]!.stdout.emit('data', Buffer.from('xxxxxx'));
    await expect(failure).rejects.toMatchObject({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    await tick(20);
    expect(sent.filter(([, sig]) => sig === 'SIGTERM')).toHaveLength(1);
  });
});

describe('fixed messages name the tool that failed (L5)', () => {
  test('a rejection says which program it came from', async () => {
    const { spawn, children } = fakeSpawn(506);
    const failure = runCommand('git', ['diff'], { cwd: '/repo', spawn, platform: 'linux', kill: fakeKill({ alive: false }).kill });
    await tick(1);
    children[0]!.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    await expect(failure).rejects.toMatchObject({ code: 'ENOENT', tool: 'git' });
  });

  test('a working directory that does not exist is named as such', async () => {
    const failure = runCommand(process.execPath, ['-e', ''], {
      cwd: join(tmpdir(), 'adrkit-no-such-dir-7f3a'),
      spawn: (await import('node:child_process')).spawn,
    });
    await expect(failure).rejects.toMatchObject({ code: 'ENOENT', missing: 'cwd' });
  });

  test.each([
    [{ code: 'ENOENT', tool: 'git' }, 'git-unavailable'],
    [{ code: 'ENOENT', tool: 'adr' }, 'cli-unavailable'],
    [{ code: 'ENOENT', tool: 'adr', missing: 'cwd' }, 'cwd-missing'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', tool: 'git' }, 'git-output-too-large'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', tool: 'adr' }, 'output-too-large'],
    [{ code: null, signal: 'SIGKILL', tool: 'git' }, 'git-killed'],
    [{ code: null, signal: 'SIGKILL', tool: 'adr' }, 'cli-killed'],
    [{ code: 'ETIMEDOUT', tool: 'git' }, 'git-timeout'],
    [{ code: 'ETIMEDOUT', tool: 'adr' }, 'cli-timeout'],
  ] as const)('%o', (fields, code) => {
    expect(publicMessage(Object.assign(new Error('ignored'), fields))).toBe(REVIEW_MESSAGES[code]);
  });
});

describe.skipIf(process.platform === 'win32')('under Node (L4, M2)', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let dir = '';
  let pids: number[] = [];
  afterEach(() => {
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    pids = [];
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  /** A node "shim" that starts a long-lived node grandchild and records its pid. */
  function nodeShim() {
    dir = mkdtempSync(join(tmpdir(), 'adrkit-node-tree-'));
    const pidFile = join(dir, 'grandchild.pid');
    const shim = join(dir, 'shim.mjs');
    writeFileSync(
      shim,
      [
        `import { spawn } from 'node:child_process';`,
        `import { writeFileSync } from 'node:fs';`,
        `const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
        `setTimeout(() => {}, 300000);`,
      ].join('\n'),
    );
    return { shim, pidFile };
  }

  const review = pathToFileURL(join(packageRoot, 'extensions', 'adrkit', 'review.mjs')).href;

  function runNode(program: string) {
    return spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', ['--input-type=module', '-e', program], {
      encoding: 'utf8',
      timeout: 20_000,
    });
  }

  async function waitGone(pid: number, ms: number) {
    const until = Date.now() + ms;
    while (alive(pid) && Date.now() < until) await tick(25);
    return !alive(pid);
  }

  test('a timeout under Node ends a node grandchild behind a node shim (L4)', async () => {
    const { shim, pidFile } = nodeShim();
    const result = runNode(
      [
        `import { spawn } from 'node:child_process';`,
        `import { runCommand } from ${JSON.stringify(review)};`,
        `const outcome = await runCommand(process.execPath, [${JSON.stringify(shim)}], { cwd: ${JSON.stringify(dir)}, spawn, signal: AbortSignal.timeout(1000) }).then(() => 'resolved', (e) => e.name);`,
        `process.stdout.write(outcome);`,
        `setTimeout(() => process.exit(0), 1500);`,
      ].join('\n'),
    );
    expect(result.stdout).toBe('AbortError');
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    pids.push(grandchild);
    expect(await waitGone(grandchild, 5000)).toBe(true);
  });

  test('a SIGTERM to the extension ends a running group, then the process dies by SIGTERM (M2)', async () => {
    const { shim, pidFile } = nodeShim();
    const result = runNode(
      [
        `import { spawn } from 'node:child_process';`,
        `import { existsSync, readFileSync } from 'node:fs';`,
        `import { runCommand } from ${JSON.stringify(review)};`,
        `runCommand(process.execPath, [${JSON.stringify(shim)}], { cwd: ${JSON.stringify(dir)}, spawn }).catch(() => {});`,
        `const poll = setInterval(() => {`,
        `  if (existsSync(${JSON.stringify(pidFile)}) && readFileSync(${JSON.stringify(pidFile)}, 'utf8')) { clearInterval(poll); process.kill(process.pid, 'SIGTERM'); }`,
        `}, 10);`,
      ].join('\n'),
    );
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    pids.push(grandchild);
    // The default disposition still ran: the process died of the signal.
    expect(result.signal).toBe('SIGTERM');
    expect(await waitGone(grandchild, 5000)).toBe(true);
  });

  test('with no group running, the extension keeps its own signal behavior (M2)', () => {
    const result = runNode(
      [
        `import { spawn } from 'node:child_process';`,
        `import { runCommand } from ${JSON.stringify(review)};`,
        `const before = ['SIGTERM', 'SIGINT', 'SIGHUP'].map((s) => process.listenerCount(s));`,
        `await runCommand(process.execPath, ['-e', ''], { cwd: process.cwd(), spawn });`,
        `await new Promise((r) => setTimeout(r, 50));`,
        `const after = ['SIGTERM', 'SIGINT', 'SIGHUP'].map((s) => process.listenerCount(s));`,
        `process.stdout.write(JSON.stringify({ before, after }));`,
      ].join('\n'),
    );
    expect(JSON.parse(result.stdout)).toEqual({ before: [0, 0, 0], after: [0, 0, 0] });
  });
});

// Keep the import used even where a platform skips the Node block.
void existsSync;

describe('the tools name a timeout and a missing directory (L5, M2)', () => {
  test.each([
    [{ code: 'ETIMEDOUT', name: 'TimeoutError', tool: 'adr' }, 'cli-timeout'],
    [{ code: 'ENOENT', tool: 'adr', missing: 'cwd' }, 'cwd-missing'],
    [{ code: 'ENOENT', tool: 'adr', missing: 'command' }, 'cli-unavailable'],
  ] as const)('%o', async (fields, code) => {
    const { createAdrTools } = await import('../extensions/adrkit/tools.mjs');
    const tools = createAdrTools({
      run: async () => {
        throw Object.assign(new Error('ignored'), fields);
      },
      env: {},
      exists: () => false,
      getCwd: () => '/repo',
    });
    const lint = tools.find((tool: { name: string }) => tool.name === 'adr_lint')!;
    const result = JSON.parse((await lint.handler({}, {})).textResultForLlm);
    expect(result.error).toBe(code);
  });
});
