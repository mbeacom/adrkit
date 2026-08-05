/**
 * T040 — FR-008: the three manifest-level version and capability rejections.
 *
 * Expected values come from `input-manifest.md` §2's table and `data-model.md` §8's
 * trigger enumeration. Nothing here is derived by running the code under test.
 *
 * ADR-0016: each of the three was **observed failing first**, with its emitted
 * reason recorded verbatim, before being observed passing. The observations are
 * retained at `specs/010-catalog-backstage/evidence/negative-cases/manifest-version/`.
 */

import { describe, expect, test } from 'bun:test';
import { TRIGGER_CLASSES } from '../src/diagnostics.ts';
import { validateManifestShape } from '../src/manifest/schema.ts';
import {
  SUPPORTED_CAPABILITY,
  SUPPORTED_MANIFEST_SCHEMA_VERSION,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
  checkManifestVersions,
} from '../src/manifest/version.ts';

const BASE = {
  manifestSchemaVersion: '1',
  requestedSnapshotSchemaVersion: '1',
  requiredCapabilities: ['pathOwnership'],
  repository: {
    id: 'github.com/mbeacom/adrkit-spike-fixture',
    revision: '0'.repeat(40),
  },
  sources: [{ path: 'catalog-info.yaml', digestAlgorithm: 'sha256', digest: 'a'.repeat(64) }],
} as const;

function manifest(overrides: Record<string, unknown> = {}) {
  const result = validateManifestShape({ ...structuredClone(BASE), ...overrides });
  if (!result.ok) throw new Error(`fixture failed the schema: ${result.rejection.detail}`);
  return result.value;
}

describe('T040 — the three version/capability rejections (FR-008)', () => {
  test('the accepted values are exactly the ones `input-manifest.md` §2 names', () => {
    expect(SUPPORTED_MANIFEST_SCHEMA_VERSION).toBe('1');
    expect(SUPPORTED_SNAPSHOT_SCHEMA_VERSION).toBe('1');
    expect(SUPPORTED_CAPABILITY).toBe('pathOwnership');
  });

  test('the contract-shaped manifest passes all three', () => {
    const result = checkManifestVersions(manifest());
    expect(result.ok).toBe(true);
  });

  test('`unsupported-manifest-version` — an unsupported manifestSchemaVersion', () => {
    const result = checkManifestVersions(manifest({ manifestSchemaVersion: '2' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unsupported-manifest-version');
    expect(result.rejection.triggerClass).toBe('unsupported-manifest-version');
    expect(result.rejection.detail).toBe(
      'manifestSchemaVersion must be "1"; observed "2"',
    );
  });

  test('`unsupported-snapshot-version` — an unsupported requestedSnapshotSchemaVersion', () => {
    const result = checkManifestVersions(manifest({ requestedSnapshotSchemaVersion: '2' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unsupported-snapshot-version');
    expect(result.rejection.triggerClass).toBe('unsupported-snapshot-version');
    expect(result.rejection.detail).toBe(
      'requestedSnapshotSchemaVersion must be "1"; observed "2"',
    );
  });

  test('`unsupported-capability` — any string other than pathOwnership in the array', () => {
    const result = checkManifestVersions(
      manifest({ requiredCapabilities: ['pathOwnership', 'entityGraph'] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unsupported-capability');
    expect(result.rejection.triggerClass).toBe('unsupported-capability');
    expect(result.rejection.detail).toBe(
      'requiredCapabilities[1] is "entityGraph"; the only defined capability is "pathOwnership"',
    );
  });

  test('the three reasons are mutually distinct', () => {
    const reasons = new Set(
      [
        checkManifestVersions(manifest({ manifestSchemaVersion: '2' })),
        checkManifestVersions(manifest({ requestedSnapshotSchemaVersion: '2' })),
        checkManifestVersions(manifest({ requiredCapabilities: ['entityGraph'] })),
      ].map((result) => (result.ok ? 'accepted' : result.rejection.reason)),
    );
    expect(reasons.size).toBe(3);
  });

  test('all three trigger classes are members of the closed enumeration', () => {
    for (const triggerClass of [
      'unsupported-manifest-version',
      'unsupported-snapshot-version',
      'unsupported-capability',
    ] as const) {
      expect(TRIGGER_CLASSES).toContain(triggerClass);
    }
  });

  test('a manifest violating two rules reports the first, deterministically', () => {
    // `input-manifest.md` §2 lists manifestSchemaVersion first, so a manifest that
    // is wrong on both version fields must report the manifest version — not
    // whichever the implementation happened to check first.
    const result = checkManifestVersions(
      manifest({ manifestSchemaVersion: '2', requestedSnapshotSchemaVersion: '3' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unsupported-manifest-version');
  });
});

describe('T040 — what §2\u2019s capability rule does and does not say', () => {
  test('the rejection is triggered by a present offending string', () => {
    // `input-manifest.md` §2: "triggered by any string other than "pathOwnership"
    // appearing in the array". An empty array contains no such string, so this
    // module does not invent a rejection the contract does not authorize. The
    // divergence from `data-model.md` §1's one-element tuple type is reported,
    // not resolved here.
    expect(checkManifestVersions(manifest({ requiredCapabilities: [] })).ok).toBe(true);
  });

  test('a repeated supported capability contains no offending string', () => {
    expect(
      checkManifestVersions(
        manifest({ requiredCapabilities: ['pathOwnership', 'pathOwnership'] }),
      ).ok,
    ).toBe(true);
  });

  test('capability matching is exact, never case-insensitive', () => {
    const result = checkManifestVersions(manifest({ requiredCapabilities: ['pathownership'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unsupported-capability');
  });
});
