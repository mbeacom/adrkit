/**
 * T063 · T067 — FR-029 and FR-032: the frozen engine and options, the version read
 * at runtime, and each pattern compiled once per run.
 *
 * `glob-dialect.md` §1 and §6. The version literal `4.0.5` appears below **only as
 * an observation of what the lockfile currently resolves** — `research.md` R3
 * recorded that resolution — and never as the value the implementation uses. The
 * test that matters is that the implementation reads it rather than declaring it.
 */

import { describe, expect, test } from 'bun:test';
import picomatch from 'picomatch';
import {
  GLOB_ENGINE,
  GLOB_OPTIONS,
  createGlobCompiler,
  readGlobDialect,
  readGlobEngineVersion,
} from '../src/glob/dialect.ts';
import { validateGlobPattern, validateGlobPatterns } from '../src/glob/validate.ts';

describe('T063 — the engine and options are frozen', () => {
  test('the engine is `picomatch`', () => {
    expect(GLOB_ENGINE).toBe('picomatch');
  });

  test('the options are exactly \u00a71\u2019s three', () => {
    expect(GLOB_OPTIONS).toEqual({ dot: false, nocase: false, nonegate: true });
    expect(Object.keys(GLOB_OPTIONS).sort()).toEqual(['dot', 'nocase', 'nonegate']);
  });

  test('the options object is frozen, so a caller cannot change the dialect mid-run', () => {
    expect(Object.isFrozen(GLOB_OPTIONS)).toBe(true);
  });

  test('the options match the two core matchers\u2019 own compile options', async () => {
    // §1: "Identical to `packages/core/src/affects/inert.ts`'s and
    // `packages/core/src/affects/matchers/path.ts`'s own compile options — no new
    // option combination is introduced."
    const roots = ['../../../core/src/affects/inert.ts', '../../../core/src/affects/matchers/path.ts'];
    for (const relative of roots) {
      const source = await Bun.file(new URL(relative, import.meta.url)).text();
      expect(source).toContain('dot: false');
      expect(source).toContain('nocase: false');
      expect(source).toContain('nonegate: true');
    }
  });
});

describe('T063 — the version is read at runtime, never transcribed', () => {
  test('a version is read from the resolved dependency', async () => {
    const version = await readGlobEngineVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/u);
  });

  test('it agrees with the installed `picomatch/package.json` read independently', async () => {
    // Two independent reads of the same fact, both by path — ADR-0013/FR-002 forbid
    // `import.meta.resolve` here, so neither side may use it. If the implementation
    // had a literal, this would still pass today and silently start lying when the
    // lockfile moved, which is why the source-level assertion below exists as well.
    const manifest = (await Bun.file(
      new URL('../node_modules/picomatch/package.json', import.meta.url),
    ).json()) as { version: string };
    expect(await readGlobEngineVersion()).toBe(manifest.version);
  });

  test('the module contains no transcribed version literal', async () => {
    const source = await Bun.file(new URL('../src/glob/dialect.ts', import.meta.url)).text();
    const code = source.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    expect(code).not.toMatch(/\d+\.\d+\.\d+/u);
  });

  test('the currently resolved version is 4.0.5 \u2014 recorded as an observation', async () => {
    // `research.md` R3 verified this resolution. Recorded here so a change is
    // visible, not so the implementation can depend on it.
    expect(await readGlobEngineVersion()).toBe('4.0.5');
  });

  test('the full dialect identification is verified rather than assumed', async () => {
    const dialect = await readGlobDialect();
    expect(dialect.engine).toBe('picomatch');
    expect(dialect.options).toEqual(GLOB_OPTIONS);
    expect(dialect.version).toBe(await readGlobEngineVersion());
  });
});

describe('T063 — \u00a74\u2019s dotfile worked example, confirmed rather than reimplemented', () => {
  // §4: `dot: false` already implements the policy exactly; this requires "zero new
  // code in Option A's own validator beyond passing `dot: false`". The claim is
  // *observed behavioural parity*, never source-code equivalence.
  test.each([
    ['.github/**', '.github/workflows/ci.yml', true],
    ['packages/**', '.github/workflows/ci.yml', false],
    ['**', '.github/workflows/ci.yml', false],
  ] as const)('%j vs %j => %s', (pattern, path, expected) => {
    const compiler = createGlobCompiler();
    const result = validateGlobPattern(pattern, compiler);
    expect(result.outcome).toBe('accepted');

    const compiled = compiler.compile(pattern);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.matcher(path)).toBe(expected);
  });

  test('a bare `**` does not imply dotfile ownership', () => {
    const compiled = createGlobCompiler().compile('**');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.matcher('.github/workflows/ci.yml')).toBe(false);
    expect(compiled.matcher('packages/payments/index.ts')).toBe(true);
  });
});

describe('T067 — each pattern is compiled exactly once per run (FR-032)', () => {
  test('validating the same pattern twice compiles once', () => {
    const compiler = createGlobCompiler();
    validateGlobPattern('packages/**', compiler);
    validateGlobPattern('packages/**', compiler);
    expect(compiler.compileCount).toBe(1);
    expect(compiler.patternCount).toBe(1);
  });

  test('a batch with repeats compiles one matcher per distinct pattern', () => {
    const compiler = createGlobCompiler();
    validateGlobPatterns(['a/**', 'b/**', 'a/**', 'b/**', 'a/**'], compiler);
    expect(compiler.compileCount).toBe(2);
    expect(compiler.patternCount).toBe(2);
  });

  test('matching many paths does not recompile', () => {
    // §6: "never once per match check against each changed file".
    const compiler = createGlobCompiler();
    validateGlobPattern('packages/**', compiler);
    const compiled = compiler.compile('packages/**');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    for (let index = 0; index < 100; index += 1) {
      compiled.matcher(`packages/payments/file-${index}.ts`);
    }
    expect(compiler.compileCount).toBe(1);
  });

  test('validation and matching share one matcher, so they cannot diverge', () => {
    // FR-032's stated reason. The identity check is the demonstration: it is the
    // same object, not merely an equal one.
    const compiler = createGlobCompiler();
    validateGlobPattern('packages/**', compiler);
    const first = compiler.compile('packages/**');
    const second = compiler.compile('packages/**');
    expect(first).toBe(second);
  });

  test('a rejected pattern is never compiled at all', () => {
    const compiler = createGlobCompiler();
    validateGlobPatterns(['{a}', '[b]', '(c)', 'd,e'], compiler);
    expect(compiler.compileCount).toBe(0);
  });

  test('each run gets its own compiler, so one run cannot depend on another', () => {
    // A module-level cache would make results depend on what a previous run
    // happened to compile — and `owned-paths-annotation.md` §5 requires
    // byte-identical output across repeated runs.
    const first = createGlobCompiler();
    validateGlobPattern('packages/**', first);
    expect(first.compileCount).toBe(1);

    const second = createGlobCompiler();
    expect(second.compileCount).toBe(0);
    validateGlobPattern('packages/**', second);
    expect(second.compileCount).toBe(1);
  });

  test('the compiled matcher behaves identically to a fresh `picomatch` compile', () => {
    // The cache must not change semantics — only cost.
    const compiler = createGlobCompiler();
    const compiled = compiler.compile('packages/**');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const fresh = picomatch('packages/**', GLOB_OPTIONS);
    for (const path of [
      'packages/payments/index.ts',
      'docs/readme.md',
      '.github/workflows/ci.yml',
      'packages/a/b/c.ts',
    ]) {
      expect(compiled.matcher(path)).toBe(fresh(path));
    }
  });
});
