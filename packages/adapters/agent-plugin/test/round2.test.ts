/**
 * Re-review round 1, optional Lows fixed before the PR: a capped result must
 * carry its digest (R1), a check our own signal or an abort ended is not
 * cached (R2), probing a group that still looks alive is bounded (R3), and
 * `base` is held to a conservative ref grammar wherever it is accepted.
 */
import { describe, expect, test } from 'bun:test';
import { sanitizeReviewResult } from '../extensions/adrkit/canvas.mjs';
import { createAdvisoryHooks } from '../extensions/adrkit/hooks.mjs';
import { isTrackedGroup, runCommand, validateArgs } from '../extensions/adrkit/review.mjs';
import { createAdrTools, validateToolArgs } from '../extensions/adrkit/tools.mjs';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('R1: a capped result must carry its digest', () => {
  const base = {
    status: 'ok',
    checkExitCode: 0,
    lintExitCode: 0,
    files: ['a.ts'],
    filesSource: 'args',
    notes: [],
    governing: [],
    history: [],
    verdicts: [],
    unverified: [],
    findings: [],
  };
  test('filesOmitted > 0 with no filesDigest is refused', () => {
    expect(() => sanitizeReviewResult({ ...base, filesOmitted: 5 })).toThrow(/filesDigest/);
    expect(() => sanitizeReviewResult({ ...base, filesOmitted: 5, filesDigest: null })).toThrow(/filesDigest/);
  });
  test('an uncapped result needs none', () => {
    expect(() => sanitizeReviewResult({ ...base, filesOmitted: 0 })).not.toThrow();
  });
});

describe('R2: a check ended by a signal or an abort is not cached', () => {
  test.each([
    ['killed by a signal', () => Object.assign(new Error('x'), { code: null, signal: 'SIGKILL' })],
    ['aborted', () => Object.assign(new Error('x'), { name: 'AbortError', code: 'ABORT_ERR' })],
    ['timed out', () => Object.assign(new Error('x'), { name: 'TimeoutError', code: 'ETIMEDOUT' })],
  ])('%s: the next edit of the same file checks again', async (_name, failure) => {
    let checks = 0;
    const run = async (_command: string, args: string[]) => {
      checks += 1;
      if (checks === 1) throw failure();
      const files = args.slice(args.indexOf('--') + 1);
      return {
        stdout: JSON.stringify({ changedFiles: files, governedBy: [{ recordId: '0001', status: 'accepted', bucket: 'governing' }], findings: [] }),
        stderr: '',
        exitCode: 0,
      };
    };
    const hooks = createAdvisoryHooks({
      run,
      env: {},
      exists: () => false,
      getSession: () => ({ log: async () => {} }),
      refreshCanvas: async () => {},
      setTimer: () => ({ unref: () => {} }),
      clearTimer: () => {},
    })!;
    const edit = { workingDirectory: '/w', sessionId: 's', toolName: 'edit', toolArgs: { path: '/w/src/a.ts' } };
    expect(await hooks.onPostToolUse(edit)).toBeUndefined();
    const second = await hooks.onPostToolUse(edit);
    expect(checks).toBe(2);
    expect(second?.additionalContext).toContain('0001');
  });

  test('a CLI that cannot start is still cached, so it is not retried on every edit', async () => {
    let checks = 0;
    const hooks = createAdvisoryHooks({
      run: async () => {
        checks += 1;
        throw Object.assign(new Error('x'), { code: 'ENOENT' });
      },
      env: {},
      exists: () => false,
      getSession: () => ({ log: async () => {} }),
      refreshCanvas: async () => {},
      setTimer: () => ({ unref: () => {} }),
      clearTimer: () => {},
    })!;
    const edit = { workingDirectory: '/w', sessionId: 's', toolName: 'edit', toolArgs: { path: '/w/src/a.ts' } };
    await hooks.onPostToolUse(edit);
    await hooks.onPostToolUse(edit);
    expect(checks).toBe(1);
  });
});

describe('R3: probing a group that still looks alive is bounded', () => {
  test('after 10 probes the group is no longer tracked', async () => {
    const listeners: Array<(...args: unknown[]) => void> = [];
    const child = {
      pid: 777001,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'close') listeners.push(listener);
      },
    };
    let probes = 0;
    const done = runCommand('adr', ['lint'], {
      cwd: '/repo',
      spawn: () => child,
      platform: 'linux',
      kill: (_pid: number, sig: string | number) => {
        if (sig === 0) probes += 1;
      },
      probeMs: 2,
    });
    await tick(1);
    for (const listener of listeners) listener(0, null);
    await done;
    expect(isTrackedGroup(777001)).toBe(true);
    await tick(100);
    expect(isTrackedGroup(777001)).toBe(false);
    expect(probes).toBe(10);
  });
});

describe('base: a conservative ref grammar wherever it is accepted', () => {
  const good = ['origin/main', 'HEAD~2', 'v1.0.0', 'release/9', 'HEAD^{commit}', 'main@{1}', 'a...b'];
  const bad = ['-x', 'a b', 'main`id`', '$(id)', 'a..b', 'a;b', 'a\tb', '../x', 'x..', "a'b"];
  test.each(good)('workflow and tools accept %p', (base) => {
    expect(validateArgs({ base })).toEqual({ base });
    expect(validateToolArgs('adr_check', { base }).ok).toBe(true);
  });
  test.each(bad)('workflow and tools refuse %p without echoing it', (base) => {
    let message = '';
    try {
      validateArgs({ base });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/base/);
    expect(message).not.toContain(base);
    expect(validateToolArgs('adr_check', { base })).toEqual({ ok: false, code: 'base-invalid' });
  });
  test('the tool refuses before running anything', async () => {
    let ran = 0;
    const tools = createAdrTools({ run: async () => (ran++, { stdout: '{}', stderr: '', exitCode: 0 }), env: {}, exists: () => false, getCwd: () => '/r' });
    const result = await tools.find((tool: { name: string }) => tool.name === 'adr_check')!.handler({ base: 'a..b' }, {});
    expect(JSON.parse(result.textResultForLlm).error).toBe('base-invalid');
    expect(ran).toBe(0);
  });
});
