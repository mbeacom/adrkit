/**
 * `@adrkit/sdk` — packaging and boundary invariants.
 *
 * Two of ADR-0031's clauses are enforceable as facts about files, and both fail silently
 * if they are not. These are those two.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));

describe('ADR-0031 clause 8 — no release is authorized', () => {
  // Clause 8 authorizes the SDK's design and construction and explicitly withholds its
  // release, which ADR-0029 clause 10 reserves to a later record. A published package
  // cannot be withdrawn, only deprecated, so this is a one-way door that must not be
  // opened by an unrelated edit to the release manifest.
  //
  // ADR-0016 clause 2: observed failing. With `@adrkit/sdk` temporarily added to
  // RELEASE_PACKAGES, this test reported the package present and failed; the retained
  // input is that manifest edit, reverted.
  test('the sdk is absent from RELEASE_PACKAGES', async () => {
    const releasePack = await readFile(join(repoRoot, 'scripts', 'release-pack.ts'), 'utf8');
    expect(releasePack).not.toContain('@adrkit/sdk');
  });

  test('the manifest declares version 0.0.0, no exports map, and no files list', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.exports).toBeUndefined();
    expect(manifest.files).toBeUndefined();
    expect(manifest.private ?? false).toBe(false);
  });
});

describe('ADR-0031 clause 4 — the sdk declares its own types', () => {
  // The record's central mechanism: "a facade that re-exports is an alias and insulates
  // nothing — the first core rename would reach every consumer." A single
  // `export ... from '@adrkit/core'` would convert this package into the thing it exists
  // to replace, and it would do so invisibly, because a re-export typechecks perfectly.
  //
  // The assertion is on `export ... from` specifically rather than on any mention of core:
  // an *implementation* of this surface will legitimately import from core, and forbidding
  // that would forbid the package from ever being built. What must never appear is core's
  // types leaving through this module's public surface.
  //
  // ADR-0016 clause 2: observed failing. With
  // `export type { Adr } from '@adrkit/core';` added to src/index.ts, this test failed on
  // the re-export assertion; the retained input is that line, removed.
  test('no core symbol is re-exported through the public surface', async () => {
    const source = await readFile(join(packageRoot, 'src', 'index.ts'), 'utf8');
    const reExports = [...source.matchAll(/^export\s[^;]*\sfrom\s+['"]([^'"]+)['"]/gm)].map(
      (match) => match[1],
    );
    expect(reExports).toEqual([]);
  });

  test('the three schema vocabulary unions are declared here, not imported', async () => {
    const source = await readFile(join(packageRoot, 'src', 'index.ts'), 'utf8');
    for (const name of ['DecisionStatus', 'DecisionStanding', 'SlaState']) {
      expect(source).toContain(`export type ${name} =`);
    }
  });
});
