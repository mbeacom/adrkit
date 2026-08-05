/**
 * SC-014 close-out: **consumer rejection and isolation**, asserted as one
 * consolidated statement (`snapshot-envelope.md` §7; T036).
 *
 * SC-014 reads:
 *
 * > Each of the five ordered consumer validation steps rejects at its own step
 * > for its own malformation kind; a mutated envelope is rejected on digest
 * > recomputation; an envelope whose revision is not exactly equal to the
 * > consuming checkout's is rejected on exact inequality; an envelope whose
 * > repository id does not match is rejected as misidentified; and — as the
 * > contrasting acceptance case — a **valid** envelope for a different
 * > repository is accepted, with the query simply returning no matches. In every
 * > rejection case, no `derivedPaths` value was read before rejection.
 *
 * The per-check detail lives in `validate-steps.test.ts`, `digest.test.ts`,
 * `identity.test.ts`, `no-early-read.test.ts` and `derive.test.ts`. This file
 * exists so the criterion is discharged by a **single table** covering every
 * clause at once, rather than by a reader assembling five files and hoping the
 * union is complete.
 *
 * The ADR-0016 observations that make these assertions coverage rather than
 * decoration are recorded under
 * `specs/010-catalog-backstage/evidence/negative-cases/`: `consumer-steps/`,
 * `consumer-digest/`, `consumer-staleness/`, `consumer-repository-identity/`.
 */

import { describe, expect, test } from 'bun:test';
import {
  admitEnvelope,
  deriveCatalogSnapshot,
  queryEntitiesForRepository,
  validateEnvelope,
  validateParsedEnvelope,
  type AdmissionStage,
} from '../src/index.ts';
import {
  ADMIT_OPTIONS_A,
  REPOSITORY_A,
  REPOSITORY_B,
  REVISION_B,
  SOURCE_BASE_DIR,
  VALIDATE_OPTIONS,
  fixtureText,
  fixtureValue,
} from './helpers.ts';

interface RejectionRow {
  readonly fixture: string;
  readonly stage: AdmissionStage;
  readonly reason: string;
  /** The step number, for the five validation-step rows only. */
  readonly step: number | undefined;
}

/** Every rejection SC-014 enumerates, in the order the criterion states them. */
const REJECTIONS: readonly RejectionRow[] = [
  { fixture: 'malformed-invalid-json.json', stage: 'validation', reason: 'invalid-json', step: 1 },
  { fixture: 'malformed-missing-or-wrong-field.json', stage: 'validation', reason: 'missing-or-wrong-required-field', step: 2 },
  { fixture: 'malformed-unrecognized.json', stage: 'validation', reason: 'unrecognized-schema-or-dialect-or-capability', step: 3 },
  { fixture: 'malformed-missing-source-digest.json', stage: 'validation', reason: 'missing-source-digest', step: 4 },
  { fixture: 'malformed-identity-only.json', stage: 'validation', reason: 'identity-only-true', step: 5 },
  { fixture: 'tampered.json', stage: 'digest', reason: 'digest-mismatch', step: undefined },
  { fixture: 'stale.json', stage: 'staleness', reason: 'stale-revision', step: undefined },
  { fixture: 'wrong-repository.json', stage: 'repository-identity', reason: 'repository-identity-mismatch', step: undefined },
];

describe('SC-014 — every rejection lands at its own stage with its own reason', () => {
  test('the eight rejections form eight distinct (stage, reason) pairs', () => {
    const observed = REJECTIONS.map((row) => {
      const result = admitEnvelope(fixtureText(row.fixture), ADMIT_OPTIONS_A);
      if (result.outcome !== 'refused') throw new Error(`${row.fixture} was admitted`);
      return { fixture: row.fixture, stage: result.refusedAt, reason: result.reason };
    });

    expect(observed).toEqual(
      REJECTIONS.map((row) => ({ fixture: row.fixture, stage: row.stage, reason: row.reason })),
    );
    expect(new Set(observed.map((entry) => entry.reason)).size).toBe(8);
    expect(new Set(observed.map((entry) => entry.stage)).size).toBe(4);
  });

  test('the five validation-step rejections land at steps 1 through 5, in order', () => {
    const steps = REJECTIONS.filter((row) => row.step !== undefined).map((row) => {
      const result = validateEnvelope(fixtureText(row.fixture), VALIDATE_OPTIONS);
      if (result.outcome !== 'rejected') throw new Error(`${row.fixture} was not rejected`);
      return result.failedStep;
    });

    expect(steps).toEqual([1, 2, 3, 4, 5]);
  });

  test('each rejection names specifics, not only a category', () => {
    for (const row of REJECTIONS) {
      const result = admitEnvelope(fixtureText(row.fixture), ADMIT_OPTIONS_A);
      if (result.outcome !== 'refused') throw new Error(`${row.fixture} was admitted`);
      expect(result.detail.length).toBeGreaterThan(20);
      expect(result.detail).not.toBe(result.reason);
    }
  });
});

describe('SC-014 — no derivedPaths value was read in any rejection case', () => {
  test('every rejected fixture reads derivedPaths only for step 2 type inspection', () => {
    for (const row of REJECTIONS) {
      if (row.fixture === 'malformed-invalid-json.json') {
        // Unparseable text never becomes an object, so there is nothing to
        // instrument and nothing that could be read.
        const result = admitEnvelope(fixtureText(row.fixture), ADMIT_OPTIONS_A);
        expect(result.outcome).toBe('refused');
        expect(result.validation.examined.entityRecordsInspected).toBe(0);
        continue;
      }

      let reads = 0;
      const parsed = fixtureValue(row.fixture);
      for (const entity of parsed['entities'] as Record<string, unknown>[]) {
        const actual = entity['derivedPaths'];
        delete entity['derivedPaths'];
        Object.defineProperty(entity, 'derivedPaths', {
          enumerable: true,
          configurable: true,
          get() {
            reads += 1;
            return actual;
          },
        });
      }

      // Driven through the post-parse seam rather than re-serialized: calling
      // `JSON.stringify` on the instrumented object would itself trip every
      // getter and the count would be measuring the harness.
      const result = validateParsedEnvelope(parsed, VALIDATE_OPTIONS);

      // Step 2 inspects the field's type once per record it reaches, and no
      // later step touches it. So the count can never exceed the number of
      // records step 2 actually inspected.
      expect(reads).toBeLessThanOrEqual(result.examined.entityRecordsInspected);
    }
  });

  test('derivation is unreachable for every rejected fixture', () => {
    for (const row of REJECTIONS) {
      const result = admitEnvelope(fixtureText(row.fixture), ADMIT_OPTIONS_A);
      expect(result.admitted).toBeUndefined();
      expect(() => deriveCatalogSnapshot(result.admitted)).toThrow();
    }
  });
});

describe('SC-014 — the contrasting acceptance cases', () => {
  test('a valid envelope for a different repository is accepted on its own terms', () => {
    const result = admitEnvelope(fixtureText('wrong-repository.json'), {
      sourceBaseDir: SOURCE_BASE_DIR,
      expectedRepositoryId: REPOSITORY_B,
      expectedRevision: REVISION_B,
    });

    // The same file rejected above as misidentified. Isolation is a property of
    // the query, not of the envelope — the envelope was never invalid.
    expect(result.outcome).toBe('admitted');
    if (result.outcome !== 'admitted') return;
    expect(result.admitted.digestCheck.outcome).toBe('match');
  });

  test('a query across both repositories returns only the scoped one, rejecting neither', () => {
    const a = validateEnvelope(fixtureText('valid.json'), VALIDATE_OPTIONS);
    const b = validateEnvelope(fixtureText('wrong-repository.json'), VALIDATE_OPTIONS);
    expect(a.outcome).toBe('valid');
    expect(b.outcome).toBe('valid');
    if (a.outcome !== 'valid' || b.outcome !== 'valid') return;

    const scoped = queryEntitiesForRepository([a.validated, b.validated], REPOSITORY_A);

    expect(scoped.returnedEntities).toHaveLength(3);
    expect(scoped.returnedEntities.every((entity) => entity.identity.canonicalId.startsWith('component:default/'))).toBe(true);
    expect(scoped.returnedEntities.map((entity) => entity.identity.canonicalId)).not.toContain(
      'component:default/billing',
    );
    // What was looked at, so an empty-looking result cannot be confused with a
    // query that never ran.
    expect(scoped.repositoriesConsidered).toEqual([REPOSITORY_A, REPOSITORY_B]);
    expect(scoped.envelopesOutOfScope).toBe(1);
  });

  test('an envelope whose entities are all annotation-absent is accepted', () => {
    // `snapshot-envelope.md` §7 row 1b: never rejected on ownership-state
    // distribution alone.
    const result = admitEnvelope(fixtureText('all-annotation-absent.json'), ADMIT_OPTIONS_A);
    expect(result.outcome).toBe('admitted');
  });

  test('the valid envelope is admitted and derives', () => {
    const result = admitEnvelope(fixtureText('valid.json'), ADMIT_OPTIONS_A);
    expect(result.outcome).toBe('admitted');
    if (result.outcome !== 'admitted') return;

    const derived = deriveCatalogSnapshot(result.admitted);
    expect(derived.snapshot.entities).toHaveLength(3);
    expect(derived.derivedFrom.repositoryId).toBe(REPOSITORY_A);
  });
});

describe('SC-014 — the fixture corpus is complete and synthetic', () => {
  test('ten fixtures, covering eight rejections and two acceptances', () => {
    // A criterion asserted against a corpus that had silently lost a fixture
    // would still pass every test above. This is the guard against that.
    const rejecting = new Set(REJECTIONS.map((row) => row.fixture));
    const accepting = new Set(['valid.json', 'all-annotation-absent.json', 'wrong-repository.json']);

    expect(rejecting.size).toBe(8);
    // `wrong-repository.json` appears in both roles — rejected by a consumer
    // expecting repository A, accepted by one expecting repository B. That
    // overlap is the §5/§6 distinction, not a bookkeeping error.
    expect([...accepting].filter((name) => rejecting.has(name))).toEqual(['wrong-repository.json']);
    expect(new Set([...rejecting, ...accepting]).size).toBe(10);
  });
});
