/**
 * FR-044 behavioural half: **the consumer imports nothing from
 * `packages/adapters/**`, at build time or at runtime** (T037;
 * `package-boundary.md` §3).
 *
 * ## Why a build-graph assertion rather than a manifest inspection
 *
 * `bun run check:deps` already reads `package.json` and rejects a declared
 * dependency edge in either direction, and Phase A observed both guards firing
 * (`evidence/negative-cases/dep-consumer-to-adapter/`,
 * `dep-adapter-to-consumer/`). That is the *declaration* half, and it is not
 * sufficient on its own: a relative import that reaches across the workspace —
 * `../adapters/catalog-backstage/src/index.ts` — declares nothing, so a manifest
 * check cannot see it, and it would resolve and build perfectly well.
 *
 * So this test bundles the consumer's entry point and inspects the **actual
 * module graph** Bun resolved, which sees a relative import and a package
 * import alike. It also scans the source tree for import specifiers, so a
 * dynamic `import()` reachable only at runtime is caught as well.
 *
 * ## Why the boundary matters at all, restated
 *
 * The envelope file on disk is the entire interface between the two packages,
 * and each declares the envelope's shape independently. If the consumer imported
 * the generator's serializer, the digest check would be comparing the generator
 * against itself and would detect nothing. This test is what keeps that from
 * happening quietly.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PACKAGE_NAME } from '../src/index.ts';

const PACKAGE_ROOT = join(import.meta.dir, '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');
const ENTRYPOINT = join(SRC_DIR, 'index.ts');

const FORBIDDEN_PATH_SEGMENT = 'packages/adapters/';

/**
 * Every adapter package name, read from the workspace rather than hard-coded.
 *
 * Two reasons, and the second is the operative one:
 *
 * - It is the stronger rule. FR-003 and FR-044 forbid reaching **any** adapter,
 *   not one named adapter, and a hard-coded name would silently stop covering a
 *   future one.
 * - Phase A's locality guard at
 *   `packages/adapters/catalog-backstage/test/envelope-shape-locality.test.ts`
 *   forbids any `.ts` file under this package from naming the adapter package,
 *   which a self-referential guard would otherwise have to do. Phase A resolves
 *   the same self-reference problem for its own guards with an
 *   `EXCLUDED_FROM_SCAN` list, but that list lives in the adapter's tree, which
 *   this phase does not own. Deriving the names is the resolution available
 *   here, and it happens to be the better rule anyway.
 */
function adapterPackageNames(): string[] {
  const adaptersDir = join(PACKAGE_ROOT, '..', 'adapters');
  const names: string[] = [];
  for (const entry of readdirSync(adaptersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(adaptersDir, entry.name, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
      if (manifest.name !== undefined) names.push(manifest.name);
    } catch {
      // A directory without a readable manifest is not an adapter package. The
      // count assertion below is what catches this having swallowed everything.
    }
  }
  return names.sort();
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Every module Bun resolved while bundling the consumer's entry point. */
async function bundledModules(): Promise<readonly string[]> {
  const build = await Bun.build({
    entrypoints: [ENTRYPOINT],
    target: 'node',
    // The workspace's TypeScript sources resolve under the `bun` condition,
    // matching how `bun run typecheck` and `bun test` resolve them.
    conditions: ['bun'],
  });

  if (!build.success) {
    throw new Error(`the consumer's entry point did not build:\n${build.logs.map(String).join('\n')}`);
  }

  const text = await build.outputs[0]!.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('// ') && !line.includes(' '.repeat(2)))
    .map((line) => line.slice(3).trim().replaceAll('\\', '/'))
    .filter((path) => path.includes('/'));
}

describe('the consumer imports nothing from an adapter', () => {
  test('the build graph contains no module under packages/adapters/', async () => {
    const modules = await bundledModules();

    // Report what was examined. A graph that came back empty — because the
    // comment format changed, say — would otherwise satisfy the assertion below
    // while having looked at nothing, which is the exact failure ADR-0016 is
    // about.
    expect(modules.length).toBeGreaterThan(20);
    expect(modules.some((path) => path.includes('packages/catalog-envelope/src/'))).toBe(true);
    expect(modules.some((path) => path.includes('packages/core/src/'))).toBe(true);

    const offending = modules.filter((path) => path.includes(FORBIDDEN_PATH_SEGMENT));
    expect(offending).toEqual([]);
  });

  test('no source file names any adapter package or its path', () => {
    const files = sourceFiles(SRC_DIR);
    const adapters = adapterPackageNames();
    expect(files.length).toBeGreaterThanOrEqual(6);
    // Report what was examined: an empty adapter list would make the specifier
    // rule below silently weaker than it claims to be.
    expect(adapters.length).toBeGreaterThanOrEqual(2);

    const offending: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Import specifiers only — static, dynamic and `require` alike. A prose
      // mention of the adapter in a comment is not an edge, and treating it as
      // one would make the boundary documentation unwritable.
      for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        // Relative specifiers are resolved before being checked. A raw
        // substring test would miss `../../adapters/catalog-backstage/src/…`,
        // which is precisely the form that also evades the manifest check —
        // observed in
        // `evidence/negative-cases/consumer-adapter-import/case-b-relative-path-import`.
        const resolved = specifier.startsWith('.')
          ? resolve(dirname(file), specifier).replaceAll('\\', '/')
          : specifier;
        const namesAnAdapter = adapters.some(
          (name) => resolved === name || resolved.startsWith(`${name}/`),
        );
        if (resolved.includes(FORBIDDEN_PATH_SEGMENT) || namesAnAdapter) {
          offending.push(`${file.slice(PACKAGE_ROOT.length + 1)}: ${specifier}`);
        }
      }
    }

    expect(offending).toEqual([]);
  });

  test('the consumer declares no dependency on any adapter', () => {
    // The weakest of the three, kept because it is the one `check:deps` enforces
    // in CI and because its absence here would be a gap between what this test
    // claims and what the repository check actually covers.
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const adapters = new Set(adapterPackageNames());
    expect(adapters.size).toBeGreaterThanOrEqual(2);

    expect(manifest.dependencies).toEqual({ '@adrkit/core': 'workspace:*' });
    for (const block of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
      expect(Object.keys(block ?? {}).filter((name) => adapters.has(name))).toEqual([]);
    }
  });

  test('the package under test is the consumer, statically imported', () => {
    // A specific observed value rather than an absence, so that a suite which
    // somehow tested the wrong package would say so (ADR-0016 clause 3).
    expect(PACKAGE_NAME).toBe('@adrkit/catalog-envelope');
    expect(adapterPackageNames()).not.toContain(PACKAGE_NAME);
  });
});
