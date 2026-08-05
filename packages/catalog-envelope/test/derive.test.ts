/**
 * `CatalogSnapshot`-shaped derivation, gated behind every check
 * (`spec.md` FR-049; `data-model.md` §15; ADR-0020 clause 7; T034).
 *
 * The gate is asserted from both sides: the happy path, where derivation
 * succeeds only after admission; and every refusal path, where derivation is
 * unreachable. The refusal side lives in `no-early-read.test.ts`; this file
 * covers what derivation *produces* once it is permitted, and the two
 * properties of that output that are easy to get wrong — the lossy mapping, and
 * the standing of the result.
 */

import { describe, expect, test } from 'bun:test';
import {
  admitEnvelope,
  admittedEnvelopeOf,
  deriveCatalogSnapshot,
  type AdmissionStage,
} from '../src/index.ts';
import {
  ADMIT_OPTIONS_A,
  REPOSITORY_A,
  REVISION_A,
  SOURCE_BASE_DIR,
  fixtureText,
} from './helpers.ts';

function admitValid() {
  const result = admitEnvelope(fixtureText('valid.json'), ADMIT_OPTIONS_A);
  if (result.outcome !== 'admitted') {
    throw new Error(`valid.json was refused at ${result.refusedAt}: ${result.reason} — ${result.detail}`);
  }
  return result.admitted;
}

describe('admission runs every check in order before permitting derivation', () => {
  test('the valid fixture is admitted with all four verdicts recorded', () => {
    const admitted = admitValid();

    expect(admitted.digestCheck.outcome).toBe('match');
    expect(admitted.stalenessCheck.outcome).toBe('ok');
    expect(admitted.identityCheck.outcome).toBe('ok');
    // Not merely "did not fail": the specific values that were compared.
    expect(admitted.stalenessCheck.expectedRevision).toBe(REVISION_A);
    expect(admitted.identityCheck.expectedRepositoryId).toBe(REPOSITORY_A);
  });

  test('the refusal stage is named for every fixture that cannot be admitted', () => {
    const expected: readonly (readonly [string, AdmissionStage, string])[] = [
      ['malformed-invalid-json.json', 'validation', 'invalid-json'],
      ['malformed-missing-or-wrong-field.json', 'validation', 'missing-or-wrong-required-field'],
      ['malformed-unrecognized.json', 'validation', 'unrecognized-schema-or-dialect-or-capability'],
      ['malformed-missing-source-digest.json', 'validation', 'missing-source-digest'],
      ['malformed-identity-only.json', 'validation', 'identity-only-true'],
      ['tampered.json', 'digest', 'digest-mismatch'],
      ['stale.json', 'staleness', 'stale-revision'],
      ['wrong-repository.json', 'repository-identity', 'repository-identity-mismatch'],
    ];

    const observed = expected.map(([fixture]) => {
      const result = admitEnvelope(fixtureText(fixture), ADMIT_OPTIONS_A);
      if (result.outcome !== 'refused') throw new Error(`${fixture} was admitted`);
      return [fixture, result.refusedAt, result.reason] as const;
    });

    expect(observed).toEqual([...expected]);
  });

  test('the all-annotation-absent contrast case is admitted, not refused', () => {
    const result = admitEnvelope(fixtureText('all-annotation-absent.json'), ADMIT_OPTIONS_A);
    expect(result.outcome).toBe('admitted');
  });

  test('admission without a configured revision or repository still runs digest', () => {
    const result = admitEnvelope(fixtureText('tampered.json'), { sourceBaseDir: SOURCE_BASE_DIR });
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('digest');
  });
});

describe('derivation output', () => {
  test('every entity maps to a CatalogSnapshotEntity of id, refs and paths', () => {
    const derived = deriveCatalogSnapshot(admitValid());

    expect(derived.snapshot.entities).toEqual([
      {
        id: 'component:default/payments',
        refs: ['component:default/payments'],
        paths: ['apis/payments/**', 'packages/payments/**'],
      },
      { id: 'component:default/ledger', refs: ['component:default/ledger'], paths: [] },
      { id: 'component:default/gateway', refs: ['component:default/gateway'], paths: [] },
    ]);
  });

  test('the derived snapshot carries only the three core fields, never envelope fields', () => {
    // `spec.md` FR-005: the envelope is a separate artifact and is never added as
    // a field on `CatalogSnapshot` or `CatalogSnapshotEntity`.
    const derived = deriveCatalogSnapshot(admitValid());

    expect(Object.keys(derived.snapshot).sort()).toEqual(['entities']);
    for (const entity of derived.snapshot.entities) {
      expect(Object.keys(entity).sort()).toEqual(['id', 'paths', 'refs']);
    }
  });

  test('provenance for the derivation is recorded outside the snapshot', () => {
    const derived = deriveCatalogSnapshot(admitValid());

    expect(derived.derivedFrom).toEqual({
      repositoryId: REPOSITORY_A,
      revision: REVISION_A,
      envelopeDigest: '08b544b48fb8c3f1672c249623ad7bffb3b025cd2a8cabea208d98800e279df2',
    });
  });

  test('derivation is deterministic', () => {
    const first = JSON.stringify(deriveCatalogSnapshot(admitValid()));
    const second = JSON.stringify(deriveCatalogSnapshot(admitValid()));
    expect(first).toBe(second);
  });

  test('the snapshot does not alias the envelope arrays', () => {
    const admitted = admitValid();
    const derived = deriveCatalogSnapshot(admitted);
    const paths = derived.snapshot.entities[0]?.paths as string[];
    paths.push('mutated/**');

    expect(admittedEnvelopeOf(admitted).entities[0]?.derivedPaths).toEqual([
      'apis/payments/**',
      'packages/payments/**',
    ]);
  });
});

describe('the mapping is lossy by design', () => {
  test('explicit-empty and annotation-absent both map to an empty paths array', () => {
    const admitted = admitValid();
    const envelope = admittedEnvelopeOf(admitted);
    const derived = deriveCatalogSnapshot(admitted);

    // The distinction exists on the envelope...
    expect(envelope.entities.map((entity) => entity.ownershipState)).toEqual([
      'explicit-paths',
      'explicit-empty',
      'annotation-absent',
    ]);

    // ...and is simply not representable in `CatalogSnapshotEntity`, which has
    // no `ownershipState` field. It is kept on the envelope side rather than
    // smuggled into the core type; changing `CatalogSnapshot` to carry it is out
    // of scope (`spec.md` FR-004, FR-020).
    const ledger = derived.snapshot.entities[1];
    const gateway = derived.snapshot.entities[2];
    expect(ledger?.paths).toEqual([]);
    expect(gateway?.paths).toEqual([]);
    expect(ledger).not.toHaveProperty('ownershipState');
    expect(gateway).not.toHaveProperty('ownershipState');
  });

  test('an all-annotation-absent envelope derives a snapshot with no paths anywhere', () => {
    const result = admitEnvelope(fixtureText('all-annotation-absent.json'), ADMIT_OPTIONS_A);
    if (result.outcome !== 'admitted') throw new Error('contrast fixture was refused');
    const derived = deriveCatalogSnapshot(result.admitted);

    expect(derived.snapshot.entities).toHaveLength(3);
    for (const entity of derived.snapshot.entities) expect(entity.paths).toEqual([]);
  });
});
