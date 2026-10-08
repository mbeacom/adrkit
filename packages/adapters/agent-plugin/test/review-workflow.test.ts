import { describe, expect, test } from 'bun:test';
import {
  ADR_REVIEW_META,
  DECISION_CHECKER_AGENT,
  VERDICT_SCHEMA,
  assembleResult,
  buildJudgePrompt,
  collectChangedFiles,
  resolveCli,
  reviewWorkflow,
  runCommand,
  validateArgs,
} from '../extensions/adrkit/review.mjs';

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
  test('an explicit cli argument wins over everything else', () => {
    const resolved = resolveCli(
      { cli: '/opt/adr', allowRepoCli: true },
      { env: { ADRKIT_CLI: '/env/adr' }, cwd: '/repo', exists: () => true },
    );
    expect(resolved).toEqual({ command: '/opt/adr', args: [], source: 'arg' });
  });

  test('$ADRKIT_CLI is next', () => {
    const resolved = resolveCli(
      { allowRepoCli: true },
      { env: { ADRKIT_CLI: '/env/adr' }, cwd: '/repo', exists: () => true },
    );
    expect(resolved).toEqual({ command: '/env/adr', args: [], source: 'env' });
  });

  test('a JavaScript entry point runs under node, as the Spec Kit helper does', () => {
    const resolved = resolveCli(
      { allowRepoCli: false },
      { env: { ADRKIT_CLI: '/src/cli/dist/index.js' }, cwd: '/repo', exists: () => true },
    );
    expect(resolved).toEqual({
      command: 'node',
      args: ['/src/cli/dist/index.js'],
      source: 'env',
    });
  });

  test('a configured CLI that does not exist is an error, not a silent fallback', () => {
    // Falling through to PATH would run a different CLI than the one the user
    // named, and report its answer as theirs.
    expect(() =>
      resolveCli({ allowRepoCli: false }, { env: { ADRKIT_CLI: '/nope' }, cwd: '/r', exists: missing }),
    ).toThrow(/ADRKIT_CLI.*\/nope/);
    expect(() =>
      resolveCli({ cli: '/gone', allowRepoCli: false }, { env: {}, cwd: '/r', exists: missing }),
    ).toThrow(/\/gone/);
  });

  test('the repository-local CLI is used only when allowRepoCli is true', () => {
    const repoCli = '/repo/node_modules/.bin/adr';
    const exists = (path: string) => path === repoCli;
    expect(resolveCli({ allowRepoCli: true }, { env: {}, cwd: '/repo', exists })).toEqual({
      command: repoCli,
      args: [],
      source: 'repo',
    });
  });

  test('a present repository-local CLI is skipped without allowRepoCli', () => {
    // Plugin extensions run outside Copilot's permission prompts, and a
    // non-interactive run cannot ask, so an inherited repository's binary is
    // never executed by default (ADR-0034's trust rule).
    const exists = (path: string) => path === '/repo/node_modules/.bin/adr';
    expect(resolveCli({ allowRepoCli: false }, { env: {}, cwd: '/repo', exists })).toEqual({
      command: 'adr',
      args: [],
      source: 'path',
    });
  });

  test('PATH is the last resort', () => {
    expect(resolveCli({ allowRepoCli: true }, { env: {}, cwd: '/repo', exists: missing })).toEqual({
      command: 'adr',
      args: [],
      source: 'path',
    });
  });
});

describe('runCommand', () => {
  type Callback = (error: unknown, stdout: string, stderr: string) => void;

  function fakeExecFile(outcome: { error?: unknown; stdout?: string; stderr?: string }) {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const execFile = (
      command: string,
      args: string[],
      options: Record<string, unknown>,
      callback: Callback,
    ) => {
      calls.push({ command, args, options });
      callback(outcome.error ?? null, outcome.stdout ?? '', outcome.stderr ?? '');
    };
    return { execFile, calls };
  }

  test('exit 0 resolves with the output', async () => {
    const { execFile, calls } = fakeExecFile({ stdout: '{}' });
    const signal = new AbortController().signal;
    const result = await runCommand('adr', ['lint'], { cwd: '/repo', signal, execFile });
    expect(result).toEqual({ stdout: '{}', stderr: '', exitCode: 0 });
    expect(calls[0]?.options['cwd']).toBe('/repo');
    expect(calls[0]?.options['signal']).toBe(signal);
  });

  test('a non-zero exit is data, not a rejection', async () => {
    // `adr check` exits 1 with a complete report. Rejecting here would make the
    // run settle as an error that the host then reports with exit code 0.
    const error = Object.assign(new Error('Command failed'), { code: 1 });
    const { execFile } = fakeExecFile({ error, stdout: '{"ok":false}', stderr: 'warn' });
    const result = await runCommand('adr', ['check'], { cwd: '/repo', execFile });
    expect(result).toEqual({ stdout: '{"ok":false}', stderr: 'warn', exitCode: 1 });
  });

  test('a spawn failure rejects and names what is missing', async () => {
    const error = Object.assign(new Error('spawn adr ENOENT'), { code: 'ENOENT' });
    const { execFile } = fakeExecFile({ error });
    await expect(runCommand('adr', ['check'], { cwd: '/repo', execFile })).rejects.toThrow(
      /"adr".*not found/,
    );
  });

  test('cancellation rejects rather than masquerading as an exit code', async () => {
    const error = Object.assign(new Error('The operation was aborted'), {
      code: 'ABORT_ERR',
      name: 'AbortError',
    });
    const { execFile } = fakeExecFile({ error });
    await expect(runCommand('adr', ['check'], { cwd: '/repo', execFile })).rejects.toThrow();
  });
});

describe('validateArgs', () => {
  test('defaults allowRepoCli to false and accepts an empty object', () => {
    expect(validateArgs({})).toEqual({ allowRepoCli: false });
    expect(validateArgs(undefined)).toEqual({ allowRepoCli: false });
  });

  test('passes valid arguments through', () => {
    expect(
      validateArgs({ files: ['src/a.ts'], base: 'main', dir: 'docs/adr', cli: '/x', allowRepoCli: true }),
    ).toEqual({ files: ['src/a.ts'], base: 'main', dir: 'docs/adr', cli: '/x', allowRepoCli: true });
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
    ['a non-boolean allowRepoCli', { allowRepoCli: 'yes' }],
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
      return { stdout: 'a.ts\nb/c.ts\n', stderr: '', exitCode: 0 };
    };
    const result = await collectChangedFiles({}, run);
    expect(calls).toEqual([['diff', '--name-only', '--diff-filter=d', 'origin/main...HEAD']]);
    expect(result).toEqual({ files: ['a.ts', 'b/c.ts'], source: 'git:origin/main...HEAD', notes: [] });
  });

  test('falls back to the working tree against HEAD and records why', async () => {
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]): Promise<Run> => {
      calls.push(args);
      if (args.includes('feature...HEAD')) {
        return { stdout: '', stderr: 'fatal: bad revision', exitCode: 128 };
      }
      return { stdout: 'x.ts\n', stderr: '', exitCode: 0 };
    };
    const result = await collectChangedFiles({ base: 'feature' }, run);
    expect(calls[1]).toEqual(['diff', '--name-only', 'HEAD']);
    expect(result.files).toEqual(['x.ts']);
    expect(result.source).toBe('git:HEAD');
    expect(result.notes.join('\n')).toMatch(/feature.*fell back/);
  });

  test('throws when both diffs fail, so the caller can report it', async () => {
    const run = async (): Promise<Run> => ({ stdout: '', stderr: 'not a git repository', exitCode: 128 });
    await expect(collectChangedFiles({}, run)).rejects.toThrow(/not a git repository/);
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

  test('always carries the full key set, even with no inputs', () => {
    expect(Object.keys(assembleResult({})).sort()).toEqual(
      [
        'checkExitCode',
        'files',
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

function fakeRunner(responses: { check?: Run; lint?: Run; git?: Run }) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run = async (command: string, args: string[]): Promise<Run> => {
    calls.push({ command, args });
    if (command === 'git') return responses.git ?? { stdout: '', stderr: '', exitCode: 0 };
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

  test('check exit 2 skips Judge and returns usage-error with stderr', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: '', stderr: 'no ADR corpus at docs/adr', exitCode: 2 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('no ADR corpus at docs/adr');
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
    expect(result.notes.join('\n')).toContain('bad flag');
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

  test('unparseable check output is a usage-error, not a throw', async () => {
    const { ctx, agentCalls } = fakeContext({ files: ['a.ts'] });
    const { run } = fakeRunner({ check: { stdout: 'not json', stderr: 'odd', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('odd');
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

  test('a missing CLI returns a usage-error naming it', async () => {
    const { ctx } = fakeContext({ files: ['a.ts'] });
    const run = async (command: string): Promise<Run> => {
      throw new Error(`could not start "${command}": not found`);
    };
    const result = await reviewWorkflow(ctx, deps(run));
    expect(result.status).toBe('usage-error');
    expect(result.notes.join('\n')).toContain('"adr"');
  });

  test('passes --dir to both commands and collects files from git when none are given', async () => {
    const { ctx } = fakeContext({ dir: 'decisions', base: 'main' });
    const { run, calls } = fakeRunner({ git: { stdout: 'src/x.ts\n', stderr: '', exitCode: 0 } });
    const result = await reviewWorkflow(ctx, deps(run));
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['git', 'diff', '--name-only', '--diff-filter=d', 'main...HEAD'],
      ['adr', 'check', '--json', '--dir', 'decisions', '--', 'src/x.ts'],
      ['adr', 'lint', '--dir', 'decisions'],
    ]);
    expect(result.files).toEqual(['src/x.ts']);
    expect(result.filesSource).toBe('git:main...HEAD');
  });
});
