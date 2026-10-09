/**
 * A wide change must not become one command line too long for the system,
 * and must not be echoed whole into every result.
 *
 * Windows caps a command line at about 32 KiB, and `git diff <base>...HEAD`
 * can name thousands of files. `adr check` takes paths as arguments only (no
 * stdin or file list in `packages/cli/src`), so every caller splits them into
 * batches of about 24 KiB of argv and merges the JSON reports. The changed-file
 * list each result echoes is capped, with an explicit count of the rest.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { CANVAS_ID, createDecisionReviewCanvas } from '../extensions/adrkit/canvas.mjs';
import { createAdvisoryHooks } from '../extensions/adrkit/hooks.mjs';
import {
  ARGV_BUDGET_BYTES,
  FILES_ECHO_LIMIT,
  batchFiles,
  buildJudgePrompt,
  checkInBatches,
  mergeCheckReports,
  reviewWorkflow,
} from '../extensions/adrkit/review.mjs';
import { createAdrTools } from '../extensions/adrkit/tools.mjs';
import { sortFindings } from '../../../core/src/validate/findings.ts';

type Run = { stdout: string; stderr: string; exitCode: number };

const CWD = '/work/repo';
const argvBytes = (args: string[]) => args.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8') + 1, 0);

/** 2,000 paths of about 60 bytes: about 120 KiB of argv, several batches. */
const WIDE = Array.from({ length: 2000 }, (_, index) => `src/module-${String(index).padStart(4, '0')}/${'é'.repeat(20)}.ts`);

/** Record 0001 governs every path under src/module-000*, 0002 every path ending in 9.ts. */
function governedBy(files: string[]) {
  const entries: unknown[] = [];
  for (const file of files) {
    if (file.startsWith('src/module-000')) {
      entries.push({ recordId: '0001', title: 'One', status: 'accepted', bucket: 'governing', firedMatchers: [{ type: 'path', pattern: file }] });
    }
    if (/9\//.test(file)) {
      entries.push({ recordId: '0002', title: 'Two', status: 'accepted', bucket: 'governing', firedMatchers: [{ type: 'glob', pattern: 'src/**/*9/**' }] });
    }
  }
  return entries;
}

/** A CLI that answers `adr check` per batch and records every argv. */
function wideCli({ files = WIDE, exitFor }: { files?: string[]; exitFor?: (batch: string[]) => number } = {}) {
  const checks: string[][] = [];
  const run = async (command: string, args: string[]): Promise<Run> => {
    if (command === 'git') return { stdout: files.map((file) => `${file}\0`).join(''), stderr: '', exitCode: 0 };
    if (args.includes('check')) {
      checks.push([command, ...args]);
      const batch = args.slice(args.indexOf('--') + 1);
      const entries = governedBy(batch);
      const governing = entries.filter((entry: any) => entry.bucket === 'governing');
      const exitCode = exitFor?.(batch) ?? 0;
      const report = {
        changedFiles: [...batch].sort(),
        governedBy: entries,
        governing,
        activeProposals: [],
        history: [],
        changedRecords: [],
        findings: [{ severity: 'warn', code: 'corpus.example', message: 'same in every batch' }],
        ok: exitCode === 0,
      };
      return { stdout: JSON.stringify(report), stderr: '', exitCode };
    }
    if (args.includes('queue')) return { stdout: JSON.stringify({ version: '1', items: [] }), stderr: '', exitCode: 0 };
    return { stdout: '{}', stderr: '', exitCode: 0 };
  };
  return { run, checks };
}

const withinBudget = (argv: string[]) => argvBytes(argv) <= ARGV_BUDGET_BYTES;

describe('batchFiles', () => {
  test('splits by UTF-8 bytes, keeps order, and loses nothing', () => {
    const batches = batchFiles(WIDE, { overhead: 100 });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(WIDE);
    for (const batch of batches) expect(argvBytes(batch) + 100).toBeLessThanOrEqual(ARGV_BUDGET_BYTES);
  });

  test('a short list is one batch', () => {
    expect(batchFiles(['a.ts', 'b.ts'])).toEqual([['a.ts', 'b.ts']]);
  });

  test('a single path larger than the budget still goes, alone', () => {
    const huge = 'x'.repeat(ARGV_BUDGET_BYTES + 10);
    expect(batchFiles(['a.ts', huge, 'b.ts'])).toEqual([['a.ts'], [huge], ['b.ts']]);
  });
});

describe('mergeCheckReports', () => {
  test('unions decisions by id, merges their matchers, sorts by id, and keeps the first finding of each kind', () => {
    const merged = mergeCheckReports([
      {
        changedFiles: ['b.ts'],
        governedBy: [{ recordId: '0002', bucket: 'governing', firedMatchers: [{ type: 'path', pattern: 'b.ts' }] }],
        governing: [{ recordId: '0002', bucket: 'governing', firedMatchers: [{ type: 'path', pattern: 'b.ts' }] }],
        activeProposals: [],
        history: [],
        changedRecords: [],
        findings: [{ code: 'x', message: 'one' }],
        ok: true,
        markerScan: { totalCandidates: 1 },
      },
      {
        changedFiles: ['a.ts'],
        governedBy: [
          { recordId: '0002', bucket: 'governing', firedMatchers: [{ type: 'path', pattern: 'a.ts' }], declaredBy: [{ path: 'a.ts', line: 1, ref: '0002' }] },
          { recordId: '0001', bucket: 'governing', firedMatchers: [] },
        ],
        governing: [],
        activeProposals: [],
        history: [],
        changedRecords: ['docs/adr/0003-x.md'],
        findings: [
          { code: 'x', message: 'one' },
          { code: 'y', message: 'two' },
        ],
        ok: false,
      },
    ]);
    expect(merged.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(merged.governedBy.map((entry: any) => entry.recordId)).toEqual(['0001', '0002']);
    expect(merged.governedBy[1]!.firedMatchers).toEqual([
      { type: 'path', pattern: 'b.ts' },
      { type: 'path', pattern: 'a.ts' },
    ]);
    expect(merged.governedBy[1]!.declaredBy).toEqual([{ path: 'a.ts', line: 1, ref: '0002' }]);
    expect(merged.findings).toEqual([
      { code: 'x', message: 'one' },
      { code: 'y', message: 'two' },
    ]);
    expect(merged.changedRecords).toEqual(['docs/adr/0003-x.md']);
    expect(merged.ok).toBe(false);
    // A per-batch scan report cannot be merged honestly, so it is left out.
    expect('markerScan' in merged).toBe(false);
  });
});

describe('checkInBatches', () => {
  test('one batch returns the CLI result untouched', async () => {
    const raw = { stdout: '{"verbatim":true}', stderr: 'kept', exitCode: 1 };
    const result = await checkInBatches(async () => raw, ['check', '--json', '--'], ['a.ts']);
    expect(result).toBe(raw);
  });

  test('many batches stay within the budget and merge, with the worst exit', async () => {
    const { run, checks } = wideCli({ exitFor: (batch) => (batch.includes(WIDE[1500] as string) ? 1 : 0) });
    const result = await checkInBatches((args: string[]) => run('adr', args), ['check', '--json', '--'], WIDE, {
      overhead: argvBytes(['adr']),
    });
    expect(checks.length).toBeGreaterThan(1);
    for (const argv of checks) expect(withinBudget(argv)).toBe(true);
    expect(result.exitCode).toBe(1);
    const merged = JSON.parse(result.stdout);
    expect(merged.changedFiles).toHaveLength(WIDE.length);
    expect(merged.governing.map((entry: any) => entry.recordId)).toEqual(['0001', '0002']);
    expect(merged.findings).toHaveLength(1);
  });

  test('a batch with no report stops the run and is returned as it came', async () => {
    let calls = 0;
    const bad = { stdout: '', stderr: 'crash', exitCode: 2 };
    const result = await checkInBatches(
      async (args: string[]) => {
        calls += 1;
        return calls === 2 ? bad : { stdout: JSON.stringify({ changedFiles: args, governedBy: [], findings: [], ok: true }), stderr: '', exitCode: 0 };
      },
      ['check', '--json', '--'],
      WIDE,
    );
    expect(result).toBe(bad);
    expect(calls).toBe(2);
  });
});

describe('the workflow batches a wide change and caps what it echoes', () => {
  test('every adr check stays within the budget; the result lists at most the cap and counts the rest', async () => {
    const { run, checks } = wideCli();
    const prompts: string[] = [];
    const ctx = {
      args: {},
      signal: new AbortController().signal,
      phase: () => {},
      log: () => {},
      step: async (_key: string, producer: () => unknown) => await producer(),
      agent: async (prompt: string) => {
        prompts.push(prompt);
        return { verdict: 'consistent', evidence: 'ok' };
      },
      pipeline: async (items: unknown[], stage: (previous: unknown, item: unknown) => Promise<unknown>) =>
        Promise.all(items.map((item) => stage(undefined, item))),
    };
    const result = await reviewWorkflow(ctx, { run, env: {}, cwd: CWD, exists: () => false });
    expect(checks.length).toBeGreaterThan(1);
    for (const argv of checks) expect(withinBudget(argv)).toBe(true);
    expect(result.governing.map((entry: any) => entry.recordId)).toEqual(['0001', '0002']);
    expect(result.files).toHaveLength(FILES_ECHO_LIMIT);
    expect(result.filesOmitted).toBe(WIDE.length - FILES_ECHO_LIMIT);
    expect(result.status).toBe('ok');
    // The Judge prompt is capped too, and says how many it left out.
    for (const prompt of prompts) {
      expect(prompt).toContain(`and ${WIDE.length - FILES_ECHO_LIMIT} more`);
      expect(prompt).not.toContain(WIDE[WIDE.length - 1] as string);
    }
  });

  test('a short change is echoed whole, with nothing omitted', async () => {
    expect(buildJudgePrompt({ recordId: '0001', title: 't' }, ['a.ts'])).not.toContain('more');
  });
});

const open: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

describe('the canvas batches and caps, and still recognizes its own review', () => {
  test('get_state lists at most the cap; a panel-started review of the same wide change is kept on refresh', async () => {
    const { run, checks } = wideCli();
    let polls = 0;
    const capped = [...WIDE].sort().slice(0, FILES_ECHO_LIMIT);
    const session = {
      send: async () => 'm',
      log: async () => {},
      rpc: {
        workflow: {
          run: async () => ({ runId: 'run-1', status: 'running' }),
          getRun: async () => {
            polls += 1;
            return {
              runId: 'run-1',
              status: 'completed',
              result: {
                status: 'ok',
                checkExitCode: 0,
                lintExitCode: 0,
                files: capped,
                filesOmitted: WIDE.length - FILES_ECHO_LIMIT,
                filesDigest: createHash('sha256').update([...WIDE].sort().join('\0')).digest('hex'),
                filesSource: 'git:origin/main...HEAD',
                notes: [],
                governing: [{ recordId: '0001', title: 'One' }, { recordId: '0002', title: 'Two' }],
                history: [],
                verdicts: [
                  { recordId: '0001', title: 'One', verdict: 'consistent', evidence: 'ok' },
                  { recordId: '0002', title: 'Two', verdict: 'consistent', evidence: 'ok' },
                ],
                unverified: [],
                findings: [],
              },
            };
          },
        },
      },
    };
    const options = createDecisionReviewCanvas({
      run: (command: string, args: string[]) => run(command, args),
      env: {},
      exists: () => false,
      getSession: () => session,
      createServer: (handler: any) => createServer(handler),
      sleep: async () => {},
      now: () => 'now',
      stat: async () => ({ size: 1, mtimeMs: 1 }),
    });
    const ctx = { sessionId: 's', canvasId: CANVAS_ID, instanceId: 'panel-1', session: { workingDirectory: CWD } };
    await options.open(ctx);
    open.push(() => options.onClose(ctx));
    const act = (name: string, input?: unknown): Promise<any> =>
      options.actions.find((entry: { name: string }) => entry.name === name)!.handler({ ...ctx, actionName: name, input });

    const state = await act('get_state');
    expect(state.files).toHaveLength(FILES_ECHO_LIMIT);
    expect(state.filesOmitted).toBe(WIDE.length - FILES_ECHO_LIMIT);
    expect(checks.length).toBeGreaterThan(1);
    for (const argv of checks) expect(withinBudget(argv)).toBe(true);

    await act('run_review');
    for (let i = 0; i < 100 && polls === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const refreshed = await act('refresh');
    expect(refreshed.review?.result?.status).toBe('ok');
    expect(refreshed.status).toBe('ok');
  });
});

describe('the adr_check tool batches base mode and caps its echoes', () => {
  test('base mode over a wide diff', async () => {
    const { run, checks } = wideCli();
    const tools = createAdrTools({
      run: (command: string, args: string[]) => run(command, args),
      env: {},
      exists: () => false,
      getCwd: () => CWD,
    });
    const tool = tools.find((entry: { name: string }) => entry.name === 'adr_check')!;
    const result = await tool.handler({}, {});
    expect(result.resultType).toBe('success');
    expect(checks.length).toBeGreaterThan(1);
    for (const argv of checks) expect(withinBudget(argv)).toBe(true);
    const payload = JSON.parse(result.textResultForLlm);
    expect(payload.files).toHaveLength(FILES_ECHO_LIMIT);
    expect(payload.filesOmitted).toBe(WIDE.length - FILES_ECHO_LIMIT);
    expect(payload.report.changedFiles).toHaveLength(FILES_ECHO_LIMIT);
    expect(payload.report.changedFilesOmitted).toBe(WIDE.length - FILES_ECHO_LIMIT);
    expect(payload.report.governing.map((entry: any) => entry.recordId)).toEqual(['0001', '0002']);
  });
});

describe('the session-start hook batches a wide diff', () => {
  test('every adr check it runs stays within the budget', async () => {
    const { run, checks } = wideCli();
    const hooks = createAdvisoryHooks({
      run: (command: string, args: string[]) => run(command, args),
      env: {},
      exists: () => false,
      getSession: () => ({ log: async () => {} }),
      refreshCanvas: async () => {},
    })!;
    const out = await hooks.onSessionStart({ workingDirectory: CWD, source: 'new' });
    expect(checks.length).toBeGreaterThan(1);
    for (const argv of checks) expect(withinBudget(argv)).toBe(true);
    expect(out?.additionalContext).toContain('0001, 0002');
    expect(out?.additionalContext).toContain(`${WIDE.length} changed file(s)`);
  });
});

describe('the Judge prompt for a wide change (round 1, H1)', () => {
  const decision = { recordId: '0007', title: 'Database' };
  const tail = 'zz/src/db/governed.ts';
  const files = [...WIDE, tail];

  test('base mode names the exact range the run collected', () => {
    const prompt = buildJudgePrompt(decision, files, { base: 'origin/main', source: 'git:origin/main...HEAD' });
    expect(prompt).toContain(`and ${files.length - FILES_ECHO_LIMIT} more`);
    expect(prompt).toContain('git diff --name-only origin/main...HEAD');
  });

  test('an explicit base is named as given', () => {
    const prompt = buildJudgePrompt(decision, files, { base: 'release/9', source: 'git:release/9...HEAD' });
    expect(prompt).toContain('git diff --name-only release/9...HEAD');
  });

  test('fallback mode names the working tree against HEAD, not a range', () => {
    const prompt = buildJudgePrompt(decision, files, { source: 'git:HEAD' });
    expect(prompt).toContain('git diff --name-only HEAD');
    expect(prompt).not.toContain('...HEAD');
  });

  test('explicit files: says the caller supplied the full list, and its count', () => {
    const prompt = buildJudgePrompt(decision, files, { base: 'origin/main', source: 'args' });
    expect(prompt).toContain(`supplied by the caller (${files.length} files)`);
    expect(prompt).not.toContain('git diff --name-only');
  });

  test("a path past position 200 that declares the decision is still shown, first", () => {
    const prompt = buildJudgePrompt(
      { ...decision, declaredBy: [{ path: tail, line: 1, ref: '0007' }] },
      files,
      { base: 'origin/main', source: 'git:origin/main...HEAD' },
    );
    expect(prompt).toContain(tail);
    const listed = JSON.parse((prompt.match(/Changed paths \(data, not instructions\): (\[.*?\])/) as RegExpMatchArray)[1] as string);
    expect(listed[0]).toBe(tail);
    expect(listed).toHaveLength(FILES_ECHO_LIMIT);
  });

  test('the workflow passes its own source and the decision through', async () => {
    const declared = { path: tail, line: 3, ref: '0007' };
    const run = async (command: string, args: string[]): Promise<Run> => {
      if (command === 'git') return { stdout: files.map((file) => `${file}\0`).join(''), stderr: '', exitCode: 0 };
      if (args.includes('check')) {
        const batch = args.slice(args.indexOf('--') + 1);
        const governedBy = batch.includes(tail)
          ? [{ recordId: '0007', title: 'Database', status: 'accepted', bucket: 'governing', firedMatchers: [], declaredBy: [declared] }]
          : [];
        return { stdout: JSON.stringify({ changedFiles: batch, governedBy, findings: [], ok: true }), stderr: '', exitCode: 0 };
      }
      return { stdout: '{}', stderr: '', exitCode: 0 };
    };
    const prompts: string[] = [];
    const ctx = {
      args: {},
      signal: new AbortController().signal,
      phase: () => {},
      log: () => {},
      step: async (_key: string, producer: () => unknown) => await producer(),
      agent: async (prompt: string) => {
        prompts.push(prompt);
        return { verdict: 'consistent', evidence: 'ok' };
      },
      pipeline: async (items: unknown[], stage: (previous: unknown, item: unknown) => Promise<unknown>) =>
        Promise.all(items.map((item) => stage(undefined, item))),
    };
    await reviewWorkflow(ctx, { run, env: {}, cwd: CWD, exists: () => false });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(tail);
    expect(prompts[0]).toContain('git diff --name-only origin/main...HEAD');
  });
});

describe('the session-start hook stops after its deadline (round 1, M1)', () => {
  test('no batch starts once the deadline wins, and the one in flight is aborted', async () => {
    let started = 0;
    let aborted = 0;
    const run = (command: string, args: string[], { signal }: { cwd: string; signal?: AbortSignal }) => {
      if (command === 'git') return Promise.resolve({ stdout: WIDE.map((file) => `${file}\0`).join(''), stderr: '', exitCode: 0 });
      if (signal?.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      started += 1;
      return new Promise<Run>((resolve, reject) => {
        const onAbort = () => {
          aborted += 1;
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          const batch = args.slice(args.indexOf('--') + 1);
          resolve({ stdout: JSON.stringify({ changedFiles: batch, governedBy: [], findings: [], ok: true }), stderr: '', exitCode: 0 });
        }, 40);
        signal?.addEventListener('abort', onAbort);
      });
    };
    const hooks = createAdvisoryHooks({
      run,
      env: {},
      exists: () => false,
      getSession: () => ({ log: async () => {} }),
      refreshCanvas: async () => {},
      sessionStartDeadlineMs: 60,
    })!;
    const out = await hooks.onSessionStart({ workingDirectory: CWD, source: 'new' });
    expect(out).toBeUndefined();
    const atDeadline = started;
    await new Promise((resolve) => setTimeout(resolve, 400));
    // About six batches would have run, one after another, without the abort.
    expect(started).toBe(atDeadline);
    expect(started).toBeLessThanOrEqual(2);
    expect(aborted).toBe(1);
  });
});

describe('the merged report marks itself and orders findings as the CLI does (round 1, L6)', () => {
  const findings = [
    { rule: 'b-rule', severity: 'warn', message: 'z', path: 'b.ts' },
    { rule: 'a-rule', severity: 'error', message: 'y', id: '0002' },
    { rule: 'a-rule', severity: 'error', message: 'x', id: '0001' },
    { rule: 'a-rule', severity: 'info', message: 'w', id: '0001', path: 'a.ts' },
  ];

  test('batches counts the reports merged, markerScan stays absent, and findings use the CLI order', () => {
    const merged = mergeCheckReports([
      { changedFiles: ['a.ts'], governedBy: [], findings: findings.slice(0, 2), ok: true, markerScan: {} },
      { changedFiles: ['b.ts'], governedBy: [], findings: findings.slice(2), ok: true },
    ]);
    expect(merged.batches).toBe(2);
    expect('markerScan' in merged).toBe(false);
    expect(merged.findings).toEqual(sortFindings(findings as any));
  });

  test('one batch is returned as the CLI wrote it, with no batches field', async () => {
    const raw = { stdout: JSON.stringify({ changedFiles: ['a.ts'], governedBy: [], findings: [], ok: true }), stderr: '', exitCode: 0 };
    const result = await checkInBatches(async () => raw, ['check', '--json', '--'], ['a.ts']);
    expect('batches' in JSON.parse(result.stdout)).toBe(false);
  });

  test('the adr_check tool description says how a merged report differs', () => {
    const tools = createAdrTools({ run: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }), env: {}, exists: () => false, getCwd: () => CWD });
    const description = tools.find((tool: { name: string }) => tool.name === 'adr_check')!.description;
    expect(description).toContain('batches');
    expect(description).toContain('markerScan');
  });
});

describe('show_review checks a capped result against the full file list (round 1, L8)', () => {
  const digest = (files: string[]) => createHash('sha256').update([...files].sort().join('\0')).digest('hex');
  const resultFor = (files: string[], extra: Record<string, unknown> = {}) => ({
    status: 'ok',
    checkExitCode: 0,
    lintExitCode: 0,
    files: [...files].sort().slice(0, FILES_ECHO_LIMIT),
    filesOmitted: files.length - FILES_ECHO_LIMIT,
    filesSource: 'git:origin/main...HEAD',
    notes: [],
    governing: [{ recordId: '0001', title: 'One' }, { recordId: '0002', title: 'Two' }],
    history: [],
    verdicts: [
      { recordId: '0001', title: 'One', verdict: 'consistent', evidence: 'ok' },
      { recordId: '0002', title: 'Two', verdict: 'consistent', evidence: 'ok' },
    ],
    unverified: [],
    findings: [],
    ...extra,
  });

  async function panel() {
    const { run } = wideCli();
    const options = createDecisionReviewCanvas({
      run: (command: string, args: string[]) => run(command, args),
      env: {},
      exists: () => false,
      getSession: () => ({ send: async () => 'm', log: async () => {}, rpc: { workflow: { run: async () => ({}), getRun: async () => ({}) } } }),
      createServer: (handler: any) => createServer(handler),
      sleep: async () => {},
      now: () => 'now',
      stat: async () => ({ size: 1, mtimeMs: 1 }),
    });
    const ctx = { sessionId: 's', canvasId: CANVAS_ID, instanceId: 'panel-l8', session: { workingDirectory: CWD } };
    await options.open(ctx);
    open.push(() => options.onClose(ctx));
    return (input: unknown): Promise<any> =>
      Promise.resolve(options.actions.find((entry: { name: string }) => entry.name === 'show_review')!.handler({ ...ctx, actionName: 'show_review', input }));
  }

  test('the workflow result carries a digest of the full list when it is capped, and none otherwise', async () => {
    const { assembleResult } = await import('../extensions/adrkit/review.mjs');
    expect(assembleResult({ files: WIDE }).filesDigest).toBe(digest(WIDE));
    expect(assembleResult({ files: ['a.ts'] }).filesDigest).toBeNull();
  });

  test('same first 200 and same count, different list: refused', async () => {
    const show = await panel();
    // Same 200 smallest paths and the same total, but one later path differs.
    const other = [...WIDE.slice(0, -1), 'zz/not-in-this-change.ts'];
    await expect(show({ result: resultFor(other, { filesDigest: digest(other) }) })).rejects.toThrow(/different change/);
  });

  test('the matching digest: accepted', async () => {
    const show = await panel();
    const state = await show({ result: resultFor(WIDE, { filesDigest: digest(WIDE) }) });
    expect(state.review?.result?.status).toBe('ok');
  });

  test('a capped result with no digest: refused, whatever its count', async () => {
    const show = await panel();
    await expect(show({ result: resultFor(WIDE, { filesOmitted: WIDE.length }) })).rejects.toThrow(/filesDigest/);
    await expect(show({ result: resultFor(WIDE) })).rejects.toThrow(/filesDigest/);
  });
});
