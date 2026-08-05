/**
 * T039 — FR-007: one manifest describes exactly one repository.
 *
 * Every expected value here comes from `input-manifest.md` §1's manifest shape and
 * `data-model.md` §1's field list, both frozen. Nothing is derived by running the
 * code under test.
 *
 * The closed-schema rule (FR-006, T038) is exercised here too, because §1 states
 * both rules in the same paragraph and the single-repository rule is enforced *by*
 * the closed schema: `repositories` is rejected not by a special case but by being
 * an unrecognized top-level field.
 */

import { describe, expect, test } from 'bun:test';
import {
  MANIFEST_REPOSITORY_FIELDS,
  MANIFEST_SOURCE_FIELDS,
  MANIFEST_TOP_LEVEL_FIELDS,
  parseManifestText,
  validateManifestShape,
} from '../src/manifest/schema.ts';

/** `input-manifest.md` §1's worked manifest, transcribed field for field. */
const CONTRACT_MANIFEST = {
  manifestSchemaVersion: '1',
  requestedSnapshotSchemaVersion: '1',
  requiredCapabilities: ['pathOwnership'],
  repository: {
    id: 'github.com/mbeacom/adrkit-spike-fixture',
    revision: '0000000000000000000000000000000000000000',
  },
  sources: [
    {
      path: 'catalog-info.yaml',
      digestAlgorithm: 'sha256',
      digest: 'a'.repeat(64),
    },
  ],
} as const;

describe('T038 — the manifest schema is closed (FR-006)', () => {
  test('the field list matches `data-model.md` §1 exactly', () => {
    expect([...MANIFEST_TOP_LEVEL_FIELDS]).toEqual([
      'manifestSchemaVersion',
      'requestedSnapshotSchemaVersion',
      'requiredCapabilities',
      'repository',
      'sources',
    ]);
    expect([...MANIFEST_REPOSITORY_FIELDS]).toEqual(['id', 'revision']);
    expect([...MANIFEST_SOURCE_FIELDS]).toEqual(['path', 'digestAlgorithm', 'digest']);
  });

  test('`input-manifest.md` §1\u2019s worked manifest is accepted verbatim', () => {
    const result = validateManifestShape(structuredClone(CONTRACT_MANIFEST));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repository.id).toBe('github.com/mbeacom/adrkit-spike-fixture');
    expect(result.value.sources).toHaveLength(1);
  });

  test('an unrecognized top-level field is rejected, not ignored', () => {
    const result = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      futureField: 'harmless-looking',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unrecognized-top-level-field');
    expect(result.rejection.triggerClass).toBe('invalid-manifest-shape');
    expect(result.rejection.detail).toContain('futureField');
  });

  test('the closed rule applies to nested objects too', () => {
    const withExtraRepositoryField = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      repository: { ...CONTRACT_MANIFEST.repository, mirror: 'github.com/other/repo' },
    });
    expect(withExtraRepositoryField.ok).toBe(false);
    if (withExtraRepositoryField.ok) return;
    expect(withExtraRepositoryField.rejection.reason).toBe('unrecognized-nested-field');

    const withExtraSourceField = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      sources: [{ ...CONTRACT_MANIFEST.sources[0], encoding: 'utf8' }],
    });
    expect(withExtraSourceField.ok).toBe(false);
    if (withExtraSourceField.ok) return;
    expect(withExtraSourceField.rejection.reason).toBe('unrecognized-nested-field');
  });

  test('malformed JSON is its own reason, not a shape failure', () => {
    const result = parseManifestText('{ "manifestSchemaVersion": "1"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('manifest-not-json');
  });

  test('a missing required field and a wrongly typed one are distinguishable', () => {
    const clone = structuredClone(CONTRACT_MANIFEST) as Record<string, unknown>;
    delete clone['sources'];
    const missing = validateManifestShape(clone);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.rejection.reason).toBe('missing-required-field');

    const wrongType = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      manifestSchemaVersion: 1,
    });
    expect(wrongType.ok).toBe(false);
    if (wrongType.ok) return;
    expect(wrongType.rejection.reason).toBe('field-wrong-type');
  });
});

describe('T039 — single-repository binding (FR-007)', () => {
  test('a `repository` array naming two repositories is rejected', () => {
    const result = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      repository: [
        CONTRACT_MANIFEST.repository,
        { id: 'github.com/mbeacom/other', revision: 'b'.repeat(40) },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('multiple-repositories');
    expect(result.rejection.triggerClass).toBe('invalid-manifest-shape');
    expect(result.rejection.detail).toContain('exactly one repository');
  });

  test('a single-element `repository` array is still rejected — arity is not the rule', () => {
    const result = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      repository: [CONTRACT_MANIFEST.repository],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('multiple-repositories');
  });

  test('a second top-level `repositories` key is rejected by the closed schema', () => {
    const result = validateManifestShape({
      ...structuredClone(CONTRACT_MANIFEST),
      repositories: [{ id: 'github.com/mbeacom/other', revision: 'b'.repeat(40) }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unrecognized-top-level-field');
    expect(result.rejection.detail).toContain('repositories');
  });

  test('exactly one repository, expressed as one object, is accepted', () => {
    const result = validateManifestShape(structuredClone(CONTRACT_MANIFEST));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.value.repository)).toBe(false);
    expect(result.value.repository.revision).toBe(
      '0000000000000000000000000000000000000000',
    );
  });
});
