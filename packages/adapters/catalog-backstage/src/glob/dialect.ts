/**
 * T063 · T067 — the frozen glob engine and options, and the compile-once
 * discipline.
 *
 * # Frozen (`glob-dialect.md` §1)
 *
 * | Property | Value |
 * |---|---|
 * | Engine | `picomatch` |
 * | Exact version | whatever `bun.lock` resolves — **read at runtime**, never transcribed |
 * | Options | `{ dot: false, nocase: false, nonegate: true }` |
 *
 * The options are identical to `packages/core/src/affects/inert.ts`'s and
 * `packages/core/src/affects/matchers/path.ts`'s own compile options: §1 forbids
 * introducing "a second glob-matching dependency or a different options
 * combination". Any future change to the engine, its version, or any option is a
 * **versioned reclassification** requiring regeneration evidence (§5) — never a
 * silent substitution.
 *
 * # Why the version is read rather than written down (FR-029)
 *
 * A transcribed version literal is correct exactly until the lockfile moves, and
 * then it is a false statement in every envelope the generator writes — the one
 * kind of error that is invisible precisely because it used to be true. FR-029:
 * the implementation "MUST record in the envelope's `globDialect` and MUST verify
 * rather than assume". So {@link readGlobEngineVersion} resolves
 * `picomatch/package.json` through the module resolver and reads it. `research.md`
 * R3 verified the current resolution as `picomatch@4.0.5`; that number appears in
 * this package only inside a test, as an *observation*, never as the source of
 * truth.
 *
 * # Compile once per run (§6, FR-032)
 *
 * §6: each accepted pattern is compiled "**exactly once** per derivation run —
 * never once per match check against each changed file". FR-032 adds the
 * correctness reason on top of the cost one: validation and matching must not be
 * able to diverge. {@link createGlobCompiler} is the mechanism — the matcher rule 15
 * builds during *validation* is the same object handed back for *matching*, so
 * there is no second compilation that could disagree with the first.
 *
 * @see `specs/009-catalog-binding-viability/contracts/glob-dialect.md` §1, §5, §6
 */

import { dirname, join } from 'node:path';
import picomatch from 'picomatch';

/** `glob-dialect.md` §1. */
export const GLOB_ENGINE = 'picomatch';

/**
 * `glob-dialect.md` §1's options, frozen.
 *
 * `Object.freeze` is not decoration: a caller mutating this object would change the
 * dialect for every subsequent compile in the run while the envelope still recorded
 * the original — a divergence between what was recorded and what was used, which is
 * the exact failure §1 and FR-029 exist to prevent.
 */
export const GLOB_OPTIONS = Object.freeze({
  dot: false,
  nocase: false,
  nonegate: true,
} as const);

/**
 * The resolved `picomatch` version, read from the dependency the package manager
 * actually installed.
 *
 * **Read by path, not by module resolution, and that is deliberate.** ADR-0013 and
 * FR-002 forbid *any* runtime module resolution in this package — `import()`,
 * `require.resolve`, and `import.meta.resolve` alike — and Phase A's
 * `test/no-dynamic-loader.test.ts` enforces it by scanning the source. So the
 * version is obtained the one way that satisfies both requirements at once: by
 * walking up from this module to the nearest `node_modules/picomatch/package.json`
 * and reading the file. That is a filesystem read of the installed dependency, not a
 * resolver invocation — it introduces no dynamic loading, no discovery, and no
 * registry, while still reading the resolution rather than a transcribed literal.
 *
 * The two requirements genuinely pull in opposite directions here, and the tension
 * is reported rather than resolved silently in favour of whichever was read last.
 *
 * Async because it reads files. Callers that need it synchronously should read it
 * once at the start of a run and carry the value — which is also what recording it
 * in an envelope requires.
 */
export async function readGlobEngineVersion(): Promise<string> {
  const manifestPath = await findEngineManifest();
  if (manifestPath === undefined) {
    throw new Error(
      `could not locate node_modules/picomatch/package.json by walking up from ${import.meta.dir}. ` +
        'Refusing to fall back to a transcribed literal: a recorded engine version that was ' +
        'not read out of the installed dependency is a claim this package has not verified ' +
        '(glob-dialect.md §1, FR-029).',
    );
  }

  const manifest = (await Bun.file(manifestPath).json()) as { version?: unknown };
  const version = manifest.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`could not read a version from ${manifestPath}.`);
  }
  return version;
}

/** Walk up from this module looking for the installed engine's own manifest. */
async function findEngineManifest(): Promise<string | undefined> {
  let directory = import.meta.dir;

  for (;;) {
    const candidate = join(directory, 'node_modules', GLOB_ENGINE, 'package.json');
    if (await Bun.file(candidate).exists()) return candidate;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** The engine identification recorded alongside any derivation. */
export interface GlobDialectIdentification {
  readonly engine: string;
  readonly version: string;
  readonly options: typeof GLOB_OPTIONS;
}

/** Read the full engine identification, verified rather than assumed. */
export async function readGlobDialect(): Promise<GlobDialectIdentification> {
  return { engine: GLOB_ENGINE, version: await readGlobEngineVersion(), options: GLOB_OPTIONS };
}

/** A compiled matcher, or the exception rule 15 caught trying to build one. */
export type CompileResult =
  | { readonly ok: true; readonly matcher: (path: string) => boolean }
  | { readonly ok: false; readonly error: Error };

/**
 * A per-run compiler that compiles each distinct pattern exactly once.
 *
 * Deliberately an explicit object rather than a module-level cache. A module-level
 * cache would persist across runs, which sounds like a stronger version of the same
 * property and is in fact a different, worse one: it would make one run's results
 * depend on what a previous run happened to compile, and `owned-paths-annotation.md`
 * §5 requires byte-identical output across repeated runs. A compiler created per run
 * has no such history.
 */
export interface GlobCompiler {
  /** Compile `pattern`, or return the already-compiled result for it. */
  compile(pattern: string): CompileResult;
  /** How many times `picomatch(...)` has actually been invoked. */
  readonly compileCount: number;
  /** How many distinct patterns have been compiled. */
  readonly patternCount: number;
}

/** Create a compiler for one derivation run. */
export function createGlobCompiler(): GlobCompiler {
  const cache = new Map<string, CompileResult>();
  let compileCount = 0;

  return {
    compile(pattern: string): CompileResult {
      const cached = cache.get(pattern);
      if (cached !== undefined) return cached;

      let result: CompileResult;
      try {
        compileCount += 1;
        const matcher = picomatch(pattern, GLOB_OPTIONS);
        result = { ok: true, matcher: (path: string) => matcher(path) };
      } catch (error) {
        result = { ok: false, error: error as Error };
      }

      cache.set(pattern, result);
      return result;
    },
    get compileCount() {
      return compileCount;
    },
    get patternCount() {
      return cache.size;
    },
  };
}
