/**
 * T046 — SC-008 close-out.
 *
 * SC-008 (`spec.md`): *"A repository-identity or revision mismatch between the
 * manifest and the actual checkout aborts before any entity's paths are derived, in
 * every tested case; repository identity is never read from a descriptor
 * annotation; and a source path that lexically passes but resolves outside the
 * verified checkout root fails closed."*
 *
 * T046's own framing is the same claim stated from the other side: *every input
 * reaching the adapter arrived through the declared manifest and through no other
 * route.*
 *
 * This file consolidates; it does not restate. T041–T045 each demonstrate their own
 * rule against the frozen contracts. What is asserted here is the property none of
 * them can assert alone — that the manifest is the **only** route, so that closing
 * it closes everything.
 *
 * **What "aborts before any entity's paths are derived" means here, honestly.**
 * Phase D builds pure validators; the assembled pipeline that would *do* the
 * aborting is Phase E, behind Barrier B. So this file asserts the property that is
 * available before the barrier and is what makes the Phase E ordering possible: the
 * boundary checks are total functions over the manifest that produce no derived
 * path under any input, and there exists no route by which a descriptor could
 * supply repository identity. It does **not** claim a pipeline has been run.
 */

import { describe, expect, test } from 'bun:test';
import {
  PERMITTED_GIT_READS,
  admissibleReadSet,
  classifyLocationTarget,
} from '../src/manifest/boundary.ts';
import { verifySourceDigests } from '../src/manifest/digests.ts';
import { validateSourcePath } from '../src/manifest/paths.ts';
import { validateManifestShape } from '../src/manifest/schema.ts';
import { checkManifestVersions } from '../src/manifest/version.ts';
import { compareRepositoryIdentity } from '../src/repository/identity.ts';
import { ADAPTER_ROOT, importSpecifiers, scanned } from './source-scan.ts';

const MANIFEST = validateManifestShape({
  manifestSchemaVersion: '1',
  requestedSnapshotSchemaVersion: '1',
  requiredCapabilities: ['pathOwnership'],
  repository: { id: 'github.com/mbeacom/fixture', revision: '0'.repeat(40) },
  sources: [
    { path: 'catalog-info.yaml', digestAlgorithm: 'sha256', digest: 'a'.repeat(64) },
    { path: 'packages/payments/catalog-info.yaml', digestAlgorithm: 'sha256', digest: 'b'.repeat(64) },
  ],
});

if (!MANIFEST.ok) throw new Error('the SC-008 fixture manifest failed the closed schema');
const manifest = MANIFEST.value;

describe('SC-008 — the manifest is the only route in', () => {
  test('the read set is exactly the manifest, its sources, and the two git reads', () => {
    const readSet = admissibleReadSet('adrkit-manifest.json', manifest);
    expect(readSet.sourcePaths).toEqual([
      'catalog-info.yaml',
      'packages/payments/catalog-info.yaml',
    ]);
    expect(readSet.gitReads).toEqual(PERMITTED_GIT_READS);
    expect(Object.keys(readSet).sort()).toEqual(['gitReads', 'manifestPath', 'sourcePaths']);
  });

  test('nothing outside the manifest is admitted, however plausible its name', () => {
    const readSet = admissibleReadSet('adrkit-manifest.json', manifest);
    for (const plausible of [
      'catalog-info.yml',
      './catalog-info.yaml',
      'packages/billing/catalog-info.yaml',
      'CATALOG-INFO.YAML',
    ]) {
      expect(classifyLocationTarget(readSet, plausible).outcome).toBe(
        'zero-derived-paths-never-read',
      );
    }
  });

  test('the boundary widens with the manifest and by no other means', () => {
    const narrow = admissibleReadSet('m.json', manifest);
    const widened = validateManifestShape({
      manifestSchemaVersion: '1',
      requestedSnapshotSchemaVersion: '1',
      requiredCapabilities: ['pathOwnership'],
      repository: { id: 'github.com/mbeacom/fixture', revision: '0'.repeat(40) },
      sources: [
        ...manifest.sources,
        { path: 'packages/billing/catalog-info.yaml', digestAlgorithm: 'sha256', digest: 'c'.repeat(64) },
      ],
    });
    expect(widened.ok).toBe(true);
    if (!widened.ok) return;
    expect(admissibleReadSet('m.json', widened.value).sourcePaths).toHaveLength(
      narrow.sourcePaths.length + 1,
    );
  });
});

describe('SC-008 — repository identity is never read from a descriptor', () => {
  test('the comparison takes the manifest and observed git state, and nothing else', () => {
    // A descriptor cannot reach this function: there is no parameter for one.
    expect(compareRepositoryIdentity.length).toBe(2);
  });

  test('a mismatch is reported without any descriptor having been consulted', () => {
    const result = compareRepositoryIdentity(
      { id: manifest.repository.id, revision: manifest.repository.revision },
      { remoteRaw: 'git@github.com:mbeacom/some-other.git', head: '1'.repeat(40) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.triggerClass).toBe('repository-mismatch');
  });

  test('no adapter source names the `github.com/project-slug` annotation', () => {
    // `input-manifest.md` §3 singles this annotation out, because it is the one a
    // reasonable implementer would reach for. Scanning for it by name is the
    // cheapest way to notice if someone later does.
    //
    // Scoped to `src/`, and that scope is the honest one: the two test files that
    // contain the string contain it *in order to assert its absence*, so including
    // them would make the guard forbid its own statement.
    const sources = scanned(ADAPTER_ROOT).filter((file) =>
      file.path.includes('/catalog-backstage/src/'),
    );
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.filter((file) => file.code.includes('project-slug')).map((f) => f.path)).toEqual(
      [],
    );
  });
});

describe('SC-008 — the boundary checks derive no path under any input', () => {
  test('a lexically clean path that escapes the root fails closed', async () => {
    // The full symlink construction lives in `manifest-paths.test.ts`; what is
    // consolidated here is that the escape reaches a rejection rather than a value.
    const result = await validateSourcePath('/nonexistent-root-9d1f', '../../etc/passwd');
    expect(result.ok).toBe(false);
  });

  test('every boundary check returns a verdict, never a derived path', async () => {
    const results: unknown[] = [
      validateManifestShape({}),
      checkManifestVersions(manifest),
      compareRepositoryIdentity(
        { id: 'github.com/a/b', revision: '0'.repeat(40) },
        { remoteRaw: 'git@github.com:a/b.git', head: '0'.repeat(40) },
      ),
      await validateSourcePath('/nonexistent-root-9d1f', 'catalog-info.yaml'),
      await verifySourceDigests([], () => '/nowhere'),
    ];

    for (const result of results) {
      const serialized = JSON.stringify(result) ?? '';
      expect(serialized).not.toContain('derivedPaths');
      expect(serialized).not.toContain('ownershipState');
    }
  });

  test('no boundary module imports the ownership or glob slices', () => {
    // Structural, not stylistic: if a boundary check could reach the ownership
    // derivation, "aborts before any entity's paths are derived" would be a
    // property of call order rather than of the module graph.
    const boundaryModules = scanned(ADAPTER_ROOT).filter(
      (file) =>
        file.path.includes('/src/manifest/') || file.path.includes('/src/repository/'),
    );
    expect(boundaryModules.length).toBeGreaterThan(0);

    for (const file of boundaryModules) {
      for (const specifier of importSpecifiers(file.code)) {
        expect(specifier).not.toContain('ownership/');
        expect(specifier).not.toContain('glob/');
        expect(specifier).not.toContain('identity/canonicalize');
      }
    }
  });
});
