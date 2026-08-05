/**
 * The ordering guard: **no `derivedPaths` value is read before every check has
 * passed, and derivation before validation is refused**
 * (`spec.md` FR-046; `snapshot-envelope.md` §2, §3; T030).
 *
 * ## What "read" means here, stated precisely rather than gestured at
 *
 * There is exactly one place in `src/` where the validator touches
 * `derivedPaths`: a single **type inspection** in step 2, on the line marked
 * `STEP-2 TYPE INSPECTION`, which confirms the field is an array of strings and
 * consumes nothing. Step 2 could not do its job — "the complete shape with every
 * field the correct JSON type, at **every** nesting level" — without it.
 *
 * So the property this file enforces is the one that is actually meaningful, in
 * three parts:
 *
 * 1. **Count.** During validation, `derivedPaths` is read **at most once per
 *    entity record**, and never after the step at which a rejection occurred.
 *    An envelope rejected at step 1 produces **zero** reads.
 * 2. **Reachability.** No value-consuming read is reachable at all without an
 *    admission token, which cannot be forged from outside the module.
 * 3. **Locality.** `derivedPaths` appears in `src/` only in the shape
 *    declaration, in that one marked step-2 line, and behind the admission gate
 *    in `snapshot/index.ts`. This is what stops a later edit from adding a
 *    fourth, unguarded read.
 *
 * Asserting only (1) would be weak — a single read is enough to leak a value.
 * Asserting only (2) would be weak — the type system does not stop a cast.
 * Asserting only (3) would be weak — a file-level check cannot see order.
 * Together they say something.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EnvelopeDerivationRefusedError,
  admitEnvelope,
  checkEnvelopeDigest,
  checkRepositoryIdentity,
  checkStaleness,
  deriveCatalogSnapshot,
  validateParsedEnvelope,
} from '../src/index.ts';
import {
  ADMIT_OPTIONS_A,
  REPOSITORY_A,
  REVISION_A,
  VALIDATE_OPTIONS,
  fixtureText,
  fixtureValue,
} from './helpers.ts';

/**
 * Replace every entity's `derivedPaths` with an accessor that counts reads of
 * the property on that record, leaving the value itself unchanged.
 */
function instrument(envelope: Record<string, unknown>): { readonly value: unknown; reads: () => number } {
  let reads = 0;
  const entities = envelope['entities'];
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      if (typeof entity !== 'object' || entity === null) continue;
      const record = entity as Record<string, unknown>;
      if (!('derivedPaths' in record)) continue;
      const actual = record['derivedPaths'];
      delete record['derivedPaths'];
      Object.defineProperty(record, 'derivedPaths', {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1;
          return actual;
        },
      });
    }
  }
  return { value: envelope, reads: () => reads };
}

describe('no derivedPaths value is read before validation completes', () => {
  test('an envelope rejected at step 2 stops reading at the record that failed', () => {
    // `entities[1].identity.allRefs` is a string, so record 1 is rejected before
    // its own `derivedPaths` is reached. Exactly one read — record 0's — occurs.
    const instrumented = instrument(fixtureValue('malformed-missing-or-wrong-field.json'));
    const result = validateParsedEnvelope(instrumented.value, VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(2);
    expect(result.examined.entityRecordsInspected).toBe(2);
    expect(instrumented.reads()).toBe(1);
  });

  test('an envelope rejected at step 3 reads each record exactly once and then stops', () => {
    const instrumented = instrument(fixtureValue('malformed-unrecognized.json'));
    const result = validateParsedEnvelope(instrumented.value, VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(3);
    // Three records, three type inspections in step 2 — and nothing after,
    // because steps 3, 4 and 5 never touch the field.
    expect(result.examined.entityRecordsInspected).toBe(3);
    expect(instrumented.reads()).toBe(3);
  });

  test('an envelope rejected at step 4 reads no more than step 2 already did', () => {
    const instrumented = instrument(fixtureValue('malformed-missing-source-digest.json'));
    const result = validateParsedEnvelope(instrumented.value, VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(4);
    expect(instrumented.reads()).toBe(3);
  });

  test('an envelope rejected at step 5 reads no more than step 2 already did', () => {
    const instrumented = instrument(fixtureValue('malformed-identity-only.json'));
    const result = validateParsedEnvelope(instrumented.value, VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(5);
    expect(instrumented.reads()).toBe(3);
  });

  test('an envelope rejected at step 1 produces zero reads', () => {
    // Unparseable text never becomes an object, so there is nothing to read.
    const result = admitEnvelope(fixtureText('malformed-invalid-json.json'), ADMIT_OPTIONS_A);
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('validation');
    expect(result.validation.examined.entityRecordsInspected).toBe(0);
  });

  test('the staleness and identity checks read no derivedPaths, and the digest reads them only as bytes', () => {
    const instrumented = instrument(fixtureValue('valid.json'));
    const validation = validateParsedEnvelope(instrumented.value, VALIDATE_OPTIONS);
    expect(validation.outcome).toBe('valid');
    if (validation.outcome !== 'valid') return;

    const afterValidation = instrumented.reads();
    expect(afterValidation).toBe(3);

    // The digest is a SHA-256 over the canonical form of *every* field except
    // `digest` itself, so it necessarily serializes `derivedPaths` — at least
    // once per record, and in fact twice, because `canonicalStringify` makes a
    // key-filtering pass before its serializing pass (observed: 3 validation
    // reads, then 6 digest reads, 9 total). The lower bound is asserted rather
    // than the exact count, so an innocuous refactor inside `@adrkit/core` does
    // not fail this test for the wrong reason.
    //
    // None of that is an FR-046 violation, and it must not be described as one:
    // the digest check *is* one of the checks FR-046 requires to pass, and
    // hashing a field is not trusting its value. What FR-046 forbids is
    // consuming a value for ownership before every check has passed, and the
    // only code that does that is behind the admission gate.
    checkEnvelopeDigest(validation.validated);
    const afterDigest = instrumented.reads();
    expect(afterDigest).toBeGreaterThanOrEqual(afterValidation + 3);

    // Staleness and identity read `repository` only. The count must not move.
    checkStaleness(validation.validated, REVISION_A, REPOSITORY_A);
    checkRepositoryIdentity(validation.validated, REPOSITORY_A);
    expect(instrumented.reads()).toBe(afterDigest);
  });
});

describe('derivation before validation is refused', () => {
  const unadmitted: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: 'undefined', value: undefined },
    { name: 'null', value: null },
    { name: 'a raw parsed envelope object', value: fixtureValue('valid.json') },
    { name: 'a hand-built object claiming to be admitted', value: { admitted: true, envelope: fixtureValue('valid.json') } },
    { name: 'a string', value: fixtureText('valid.json') },
  ];

  for (const attempt of unadmitted) {
    test(`refuses derivation from ${attempt.name}`, () => {
      expect(() => deriveCatalogSnapshot(attempt.value)).toThrow(EnvelopeDerivationRefusedError);
      try {
        deriveCatalogSnapshot(attempt.value);
      } catch (error) {
        expect(error).toBeInstanceOf(EnvelopeDerivationRefusedError);
        expect((error as EnvelopeDerivationRefusedError).reason).toBe(
          'derivation-refused-envelope-not-admitted',
        );
        expect((error as Error).message).toContain('has not passed the five validation steps');
      }
    });
  }

  test('refuses derivation from every refused admission result', () => {
    for (const fixture of [
      'malformed-invalid-json.json',
      'malformed-missing-or-wrong-field.json',
      'malformed-unrecognized.json',
      'malformed-missing-source-digest.json',
      'malformed-identity-only.json',
      'tampered.json',
      'stale.json',
      'wrong-repository.json',
    ]) {
      const result = admitEnvelope(fixtureText(fixture), ADMIT_OPTIONS_A);
      expect(result.outcome).toBe('refused');
      expect(() => deriveCatalogSnapshot(result.admitted)).toThrow(EnvelopeDerivationRefusedError);
    }
  });
});

describe('derivedPaths is only reachable in three declared places', () => {
  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...sourceFiles(full));
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
  }

  test('no fourth reference to derivedPaths exists under src/', () => {
    const srcDir = join(import.meta.dir, '..', 'src');
    const files = sourceFiles(srcDir);

    // Report what was examined, not only what was concluded (ADR-0016). A file
    // list that had silently come back empty would otherwise pass this test.
    expect(files.length).toBeGreaterThanOrEqual(6);

    const referencing = files
      .filter((file) => readFileSync(file, 'utf8').includes('derivedPaths'))
      .map((file) => file.slice(srcDir.length + 1).replaceAll('\\', '/'))
      .sort();

    expect(referencing).toEqual(['envelope-shape.ts', 'snapshot/index.ts', 'validate/index.ts']);
  });

  test('the validator holds exactly one derivedPaths read, and it is the marked one', () => {
    const validator = readFileSync(join(import.meta.dir, '..', 'src', 'validate', 'index.ts'), 'utf8');
    const lines = validator.split('\n').filter((line) => line.includes('derivedPaths'));

    // One code line reading the property, one line naming it in a message, and
    // the comment lines that explain the discipline. The code read is the one
    // carrying the marker.
    const codeReads = lines.filter((line) => /record\['derivedPaths'\]/.test(line));
    expect(codeReads).toHaveLength(1);
    expect(codeReads[0]).toContain('STEP-2 TYPE INSPECTION');
  });
});
