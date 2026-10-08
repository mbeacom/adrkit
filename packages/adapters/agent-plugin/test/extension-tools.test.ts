/**
 * The read-only adrkit tools the extension registers through
 * `joinSession({ tools })` (ADR-0048). They drive the same `adr` CLI the
 * workflow does, chosen by the environment only, in the session's directory.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from '../extensions/adrkit/register.mjs';
import {
  ADR_TOOL_NAMES,
  TOOL_LIMITS,
  createAdrTools,
  redactWritingCommands,
  trackWorkingDirectory,
  validateToolArgs,
} from '../extensions/adrkit/tools.mjs';
import { packageRoot } from './harness.ts';

type Call = { command: string; args: string[]; cwd: string; signal?: AbortSignal };
type Result = { textResultForLlm: string; resultType: string };

/** A fake runner: `adr` answers from `answers`, keyed by subcommand; git from `git`. */
function fakeRun({
  answers = {} as Record<string, { stdout?: string; stderr?: string; exitCode: number }>,
  git = { stdout: '', stderr: '', exitCode: 0 },
  spawnFails = false,
} = {}) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], options: { cwd: string; signal?: AbortSignal }) => {
    calls.push({ command, args, cwd: options.cwd, signal: options.signal });
    if (spawnFails) throw new Error('spawn /secret/path/adr ENOENT at Object.<anonymous> (internal.js:1:1)');
    if (command === 'git') return { stdout: git.stdout ?? '', stderr: git.stderr ?? '', exitCode: git.exitCode };
    const sub = args.find((arg) => ['check', 'explain', 'lint'].includes(arg)) ?? '';
    const answer = answers[sub] ?? { stdout: '{}', exitCode: 0 };
    return { stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', exitCode: answer.exitCode };
  };
  return { calls, run };
}

function toolsWith(options: Parameters<typeof fakeRun>[0] = {}, extra: { env?: Record<string, string>; cwd?: string } = {}) {
  const fake = fakeRun(options);
  const tools = createAdrTools({
    run: fake.run,
    env: extra.env ?? {},
    exists: () => true,
    getCwd: () => extra.cwd ?? '/repo',
  }) as Array<{ name: string; description: string; parameters: Record<string, unknown>; skipPermission?: boolean; handler: (args: unknown, invocation: unknown) => Promise<Result> }>;
  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool;
  };
  const invoke = (name: string, args: unknown, invocation: Record<string, unknown> = {}) =>
    byName(name).handler(args, { sessionId: 's', toolCallId: 't', toolName: name, arguments: args, ...invocation });
  return { ...fake, tools, invoke };
}

describe('tool definitions', () => {
  test('registers exactly adr_check, adr_explain, and adr_lint', () => {
    const { tools } = toolsWith();
    expect(tools.map((tool) => tool.name)).toEqual(['adr_check', 'adr_explain', 'adr_lint']);
    expect([...ADR_TOOL_NAMES]).toEqual(['adr_check', 'adr_explain', 'adr_lint']);
  });

  test('every name is one the runtime accepts', () => {
    // Measured on Copilot CLI 1.0.93: a name outside this pattern rejected the
    // whole join ("session resume failed"), workflow and canvas included.
    expect(ADR_TOOL_NAMES.length).toBe(3);
    for (const name of ADR_TOOL_NAMES) expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  test('every tool says it is read-only, takes an object schema, and has a handler', () => {
    for (const tool of toolsWith().tools) {
      expect(tool.description).toContain('Read-only');
      expect(tool.parameters['type']).toBe('object');
      expect(tool.parameters['additionalProperties']).toBe(false);
      expect(typeof tool.handler).toBe('function');
    }
  });

  test('no name or description names a writing command', () => {
    expect(toolsWith().tools.length).toBe(3);
    for (const tool of toolsWith().tools) {
      const text = `${tool.name}\n${tool.description}\n${JSON.stringify(tool.parameters)}`;
      expect(text).not.toMatch(/\badr\s+(?:accept|new|migrate)\b/);
    }
  });

  test('the tools source names no writing command', () => {
    const source = readFileSync(join(packageRoot, 'extensions', 'adrkit', 'tools.mjs'), 'utf8');
    expect(source).not.toMatch(/\badr (?:accept|new|migrate)\b/);
  });
});

describe('argument validation', () => {
  test('accepts repo-relative paths and an optional dir', () => {
    expect(validateToolArgs('adr_check', { paths: ['src/x.ts', 'docs/a b.md'], dir: 'docs/adr' })).toEqual({
      ok: true,
      args: { paths: ['src/x.ts', 'docs/a b.md'], dir: 'docs/adr' },
    });
    expect(validateToolArgs('adr_explain', { path: 'src/x.ts' })).toEqual({ ok: true, args: { path: 'src/x.ts' } });
    expect(validateToolArgs('adr_lint', {})).toEqual({ ok: true, args: {} });
    expect(validateToolArgs('adr_lint', undefined)).toEqual({ ok: true, args: {} });
    expect(validateToolArgs('adr_check', { base: 'origin/main' })).toEqual({ ok: true, args: { base: 'origin/main' } });
  });

  const rejected: Array<[string, string, unknown, string]> = [
    ['absolute posix path', 'adr_check', { paths: ['/etc/passwd'] }, 'path-absolute'],
    ['absolute windows path', 'adr_check', { paths: ['C:\\x\\y.ts'] }, 'path-absolute'],
    ['UNC path', 'adr_explain', { path: '\\\\host\\share\\x' }, 'path-absolute'],
    ['.. segment', 'adr_check', { paths: ['src/../../x'] }, 'path-escape'],
    ['.. backslash segment', 'adr_explain', { path: 'src\\..\\..\\x' }, 'path-escape'],
    ['bare ..', 'adr_explain', { path: '..' }, 'path-escape'],
    ['option-shaped path', 'adr_check', { paths: ['--dir=/etc'] }, 'path-option'],
    ['option-shaped dir', 'adr_lint', { dir: '-x' }, 'path-option'],
    ['empty path', 'adr_check', { paths: [''] }, 'path-type'],
    ['non-string path', 'adr_check', { paths: [3] }, 'path-type'],
    ['NUL byte', 'adr_explain', { path: 'a\0b' }, 'path-control'],
    ['newline', 'adr_explain', { path: 'a\nb' }, 'path-control'],
    ['too long', 'adr_explain', { path: 'a'.repeat(TOOL_LIMITS.maxPathLength + 1) }, 'path-length'],
    ['too many paths', 'adr_check', { paths: Array.from({ length: TOOL_LIMITS.maxPaths + 1 }, (_, i) => `f${i}`) }, 'paths-count'],
    ['empty path list', 'adr_check', { paths: [] }, 'paths-count'],
    ['paths not an array', 'adr_check', { paths: 'src/x.ts' }, 'paths-type'],
    ['paths and base together', 'adr_check', { paths: ['a'], base: 'main' }, 'paths-and-base'],
    ['option-shaped base', 'adr_check', { base: '--output=/tmp/x' }, 'base-invalid'],
    ['base with a space', 'adr_check', { base: 'main HEAD' }, 'base-invalid'],
    ['base too long', 'adr_check', { base: 'a'.repeat(TOOL_LIMITS.maxRefLength + 1) }, 'base-invalid'],
    ['unknown key', 'adr_check', { cli: '/bin/sh' }, 'unknown-key'],
    ['explain takes no paths list', 'adr_explain', { paths: ['a'] }, 'unknown-key'],
    ['lint takes no paths', 'adr_lint', { paths: ['a'] }, 'unknown-key'],
    ['explain needs a path', 'adr_explain', {}, 'path-type'],
    ['args not an object', 'adr_lint', ['x'], 'args-type'],
    ['dir escapes', 'adr_lint', { dir: '../other/docs/adr' }, 'path-escape'],
    ['dir absolute', 'adr_check', { paths: ['a'], dir: '/etc' }, 'path-absolute'],
  ];
  for (const [name, tool, args, code] of rejected) {
    test(`rejects ${name}`, () => {
      const result = validateToolArgs(tool, args);
      expect(result.ok).toBe(false);
      expect((result as { code: string }).code).toBe(code);
    });
  }
});

describe('running the CLI', () => {
  test('adr_check passes validated paths after -- with --json, in the session directory', async () => {
    const report = { governedBy: [{ recordId: '0001', bucket: 'governing' }], findings: [] };
    const { calls, invoke } = toolsWith({ answers: { check: { stdout: JSON.stringify(report), exitCode: 0 } } }, { cwd: '/work/repo' });
    const result = await invoke('adr_check', { paths: ['src/x.ts'] });
    expect(calls).toEqual([{ command: 'adr', args: ['check', '--json', '--', 'src/x.ts'], cwd: '/work/repo', signal: undefined }]);
    expect(result.resultType).toBe('success');
    const payload = JSON.parse(result.textResultForLlm);
    expect(payload).toMatchObject({ tool: 'adr_check', exitCode: 0, files: ['src/x.ts'], filesSource: 'args', report });
  });

  test('adr_check with base collects changed files with git first', async () => {
    const { calls, invoke } = toolsWith({ git: { stdout: 'src/a.ts\0src/b.ts\0', stderr: '', exitCode: 0 } });
    const result = await invoke('adr_check', { base: 'main' });
    expect(calls[0]).toMatchObject({ command: 'git', args: ['diff', '--name-only', '-z', 'main...HEAD'] });
    expect(calls[1]).toMatchObject({ command: 'adr', args: ['check', '--json', '--', 'src/a.ts', 'src/b.ts'] });
    expect(JSON.parse(result.textResultForLlm)).toMatchObject({ files: ['src/a.ts', 'src/b.ts'], filesSource: 'git:main...HEAD' });
  });

  test('adr_check with no changed files runs nothing and says so', async () => {
    const { calls, invoke } = toolsWith({ git: { stdout: '', stderr: '', exitCode: 0 } });
    const result = await invoke('adr_check', {});
    expect(calls.map((call) => call.command)).toEqual(['git']);
    expect(result.resultType).toBe('success');
    expect(JSON.parse(result.textResultForLlm)).toMatchObject({ exitCode: null, files: [] });
  });

  test('an unresolvable base is a fixed failure, never git text', async () => {
    const { invoke } = toolsWith({ git: { stdout: '', stderr: "fatal: ambiguous argument 'nope...HEAD'", exitCode: 128 } });
    const result = await invoke('adr_check', { base: 'nope' });
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).not.toContain('fatal');
    expect(result.textResultForLlm).not.toContain('nope');
  });

  test('adr_explain runs explain --json -- <path>', async () => {
    const { calls, invoke } = toolsWith({ answers: { explain: { stdout: '{"path":"src/x.ts","governedBy":[]}', exitCode: 0 } } });
    const result = await invoke('adr_explain', { path: 'src/x.ts', dir: 'decisions' });
    expect(calls[0]?.args).toEqual(['explain', '--json', '--dir', 'decisions', '--', 'src/x.ts']);
    expect(JSON.parse(result.textResultForLlm)).toMatchObject({ tool: 'adr_explain', exitCode: 0, report: { path: 'src/x.ts' } });
  });

  test('adr_lint runs lint --json, defaulting the corpus to $ADRKIT_DIR', async () => {
    const { calls, invoke } = toolsWith({ answers: { lint: { stdout: '{"checked":2,"findings":[]}', exitCode: 0 } } }, { env: { ADRKIT_DIR: 'records' } });
    await invoke('adr_lint', {});
    expect(calls[0]?.args).toEqual(['lint', '--json', '--dir', 'records']);
  });

  test('a non-zero adr exit with a report is data, not a failure', async () => {
    const report = { checked: 2, findings: [{ severity: 'error', rule: 'schema' }] };
    const { invoke } = toolsWith({ answers: { lint: { stdout: JSON.stringify(report), exitCode: 1 } } });
    const result = await invoke('adr_lint', {});
    expect(result.resultType).toBe('success');
    expect(JSON.parse(result.textResultForLlm)).toMatchObject({ exitCode: 1, report });
  });

  test('a usage exit is a failure that carries the CLI exit code and its own stderr', async () => {
    const { invoke } = toolsWith({ answers: { lint: { stdout: '', stderr: 'Error: Corpus directory not found: "x".', exitCode: 2 } } });
    const result = await invoke('adr_lint', { dir: 'x' });
    expect(result.resultType).toBe('failure');
    const payload = JSON.parse(result.textResultForLlm);
    expect(payload).toMatchObject({ tool: 'adr_lint', exitCode: 2 });
    expect(payload.stderr).toContain('Corpus directory not found');
  });

  test('a spawn failure returns a fixed message, never the exception text', async () => {
    const { invoke } = toolsWith({ spawnFails: true });
    const result = await invoke('adr_explain', { path: 'src/x.ts' });
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).not.toContain('ENOENT');
    expect(result.textResultForLlm).not.toContain('/secret/path');
    expect(result.textResultForLlm).not.toContain('internal.js');
  });

  test('an ADRKIT_CLI that does not exist is a fixed failure that does not echo the value', async () => {
    const fake = fakeRun();
    const [check] = createAdrTools({ run: fake.run, env: { ADRKIT_CLI: '/opt/private/adr-wrapper' }, exists: () => false, getCwd: () => '/repo' }) as any[];
    const result = await check.handler({ paths: ['a'] }, {});
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).not.toContain('/opt/private');
    expect(fake.calls).toEqual([]);
  });

  test('the CLI is chosen by the environment: ADRKIT_CLI with a JS entry runs under node', async () => {
    const { calls, invoke } = toolsWith({}, { env: { ADRKIT_CLI: '/tools/adr/index.js' } });
    await invoke('adr_lint', {});
    expect(calls[0]?.command).toBe('node');
    expect(calls[0]?.args.slice(0, 2)).toEqual(['/tools/adr/index.js', 'lint']);
  });

  test('a repository-local CLI is ignored without ADRKIT_ALLOW_REPO_CLI=1', async () => {
    const { calls, invoke } = toolsWith({}, { env: {} });
    await invoke('adr_lint', {});
    expect(calls[0]?.command).toBe('adr');
  });

  test('invalid arguments run nothing and return a fixed message without the input', async () => {
    const { calls, invoke } = toolsWith();
    const result = await invoke('adr_check', { paths: ['/home/someone/.ssh/id_rsa'] });
    expect(calls).toEqual([]);
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).not.toContain('.ssh');
  });

  test('the invocation signal reaches the process', async () => {
    const controller = new AbortController();
    const { calls, invoke } = toolsWith();
    await invoke('adr_lint', {}, { signal: controller.signal });
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  test('results never carry a writing command, even when a record does', async () => {
    const report = { governedBy: [{ recordId: '0001', title: 'Run adr accept 0001 and adr new X, then adr  migrate' }] };
    const { invoke } = toolsWith({ answers: { explain: { stdout: JSON.stringify(report), exitCode: 0 } } });
    const result = await invoke('adr_explain', { path: 'src/x.ts' });
    expect(result.textResultForLlm).not.toMatch(/\badr\s+(?:accept|new|migrate)\b/);
    expect(() => JSON.parse(result.textResultForLlm)).not.toThrow();
  });

  test('redactWritingCommands leaves other text alone', () => {
    expect(redactWritingCommands('adr check and adr explain')).toBe('adr check and adr explain');
    expect(redactWritingCommands('ADR New')).not.toMatch(/\badr\s+new\b/i);
  });
});

describe('working directory', () => {
  test('starts at the initial directory and follows session.context_changed', () => {
    const handlers: Array<[string, (event: unknown) => void]> = [];
    const session = { on: (type: string, handler: (event: unknown) => void) => void handlers.push([type, handler]) };
    const tracker = trackWorkingDirectory('/start');
    expect(tracker.get()).toBe('/start');
    tracker.attach(session);
    expect(handlers.map(([type]) => type)).toEqual(['session.context_changed']);
    handlers[0]?.[1]({ type: 'session.context_changed', data: { cwd: '/moved' } });
    expect(tracker.get()).toBe('/moved');
  });

  test('ignores a malformed or relative cwd', () => {
    const handlers: Array<(event: unknown) => void> = [];
    const tracker = trackWorkingDirectory('/start');
    tracker.attach({ on: (_type: string, handler: (event: unknown) => void) => void handlers.push(handler) });
    handlers[0]?.({ data: { cwd: 42 } });
    handlers[0]?.({ data: { cwd: 'relative/dir' } });
    handlers[0]?.({ data: null });
    handlers[0]?.(undefined);
    expect(tracker.get()).toBe('/start');
    // Still live: a well-formed event after the bad ones is followed.
    handlers[0]?.({ data: { cwd: '/after' } });
    expect(tracker.get()).toBe('/after');
  });
});

describe('register with tools', () => {
  type Reject = (config: Record<string, unknown>, attempt: number) => boolean;
  const never: Reject = () => false;
  function fakes({ toolsThrow = false, reject = never }: { toolsThrow?: boolean; reject?: Reject } = {}) {
    const joined: Array<Record<string, unknown>> = [];
    const logged: string[] = [];
    const attached: unknown[] = [];
    const session = { log: async (message: string) => void logged.push(message) };
    const deps = {
      defineWorkflow: (definition: unknown) => ({ kind: 'workflow', definition }),
      createCanvas: (options: unknown) => ({ kind: 'canvas', options }),
      joinSession: async (config: Record<string, unknown>) => {
        joined.push(config);
        if (reject(config, joined.length)) throw new Error(`refused attempt ${joined.length}`);
        return session;
      },
      workflow: () => ({ meta: { name: 'adr-review' } }),
      canvas: () => ({ id: 'decision-review' }),
      tools: () => {
        if (toolsThrow) throw new Error('bad tools');
        return [{ name: 'adr_check' }];
      },
      onJoined: (joinedSession: unknown) => void attached.push(joinedSession),
    };
    return { deps, joined, logged, attached, session };
  }

  test('joins once with the workflow, the canvas, and the tools', async () => {
    const { deps, joined, logged, attached, session } = fakes();
    await register(deps);
    expect(joined.length).toBe(1);
    expect((joined[0]?.['workflows'] as unknown[]).length).toBe(1);
    expect((joined[0]?.['canvases'] as unknown[]).length).toBe(1);
    expect(joined[0]?.['tools']).toEqual([{ name: 'adr_check' }]);
    expect(attached).toEqual([session]);
    expect(logged).toEqual([]);
  });

  test('a throwing tools factory leaves the workflow and the canvas registered, and is reported', async () => {
    const { deps, joined, logged } = fakes({ toolsThrow: true });
    await register(deps);
    expect(joined.length).toBe(1);
    expect((joined[0]?.['workflows'] as unknown[]).length).toBe(1);
    expect((joined[0]?.['canvases'] as unknown[]).length).toBe(1);
    expect(joined[0]?.['tools']).toBeUndefined();
    expect(logged.join('\n')).toContain('adrkit tools');
  });

  test('a join the runtime refuses because of the tools is retried without them', async () => {
    // Measured: an invalid tool definition rejects the whole join.
    const { deps, joined, logged } = fakes({ reject: (config) => Boolean(config['tools']) });
    await register(deps);
    expect(joined.length).toBe(2);
    expect(joined[1]?.['tools']).toBeUndefined();
    expect((joined[1]?.['workflows'] as unknown[]).length).toBe(1);
    expect((joined[1]?.['canvases'] as unknown[]).length).toBe(1);
    expect(logged.join('\n')).toContain('adrkit tools');
  });

  test('when the join without tools is refused too, the workflow alone is registered', async () => {
    const { deps, joined, logged } = fakes({ reject: (_config, attempt) => attempt < 3 });
    await register(deps);
    expect(joined.length).toBe(3);
    expect(Object.keys(joined[2] ?? {})).toEqual(['workflows']);
    expect(logged.join('\n')).toContain('decision-review canvas');
  });

  test('never more than three joins, and the last refusal surfaces', async () => {
    const { deps, joined } = fakes({ reject: () => true });
    await expect(register(deps)).rejects.toThrow('refused attempt 3');
    expect(joined.length).toBe(3);
  });

  test('a throwing onJoined does not take the session down, and is reported', async () => {
    const { deps, logged, session } = fakes();
    const result = await register({
      ...deps,
      onJoined: () => {
        throw new Error('no events');
      },
    });
    expect(result).toBe(session);
    expect(logged.join('\n')).toContain('working-directory tracking');
  });
});
