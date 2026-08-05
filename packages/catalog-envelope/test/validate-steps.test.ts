/**
 * The five ordered validation steps, each observed rejecting **at its own step**
 * (`snapshot-envelope.md` §2; `spec.md` FR-045; T028/T029).
 *
 * Two properties are asserted for every malformed fixture, and the second is the
 * one that is easy to omit:
 *
 * 1. it is rejected with the reason belonging to its step, and
 * 2. **it is not rejected at any earlier step.** A validator that rejected
 *    everything at step 2 would satisfy (1) for exactly one fixture and look
 *    broadly correct. Asserting the step number is what distinguishes
 *    "rejected for the right reason" from "rejected".
 *
 * The ADR-0016 observation that makes these assertions coverage rather than
 * decoration is recorded at
 * `specs/010-catalog-backstage/evidence/negative-cases/consumer-steps/`: each of
 * the five steps was deleted from the validator in turn, this file was run, and
 * the resulting failure was captured verbatim.
 */

import { describe, expect, test } from 'bun:test';
import {
  REASON_STEP,
  validateEnvelope,
  type EnvelopeRejectionReason,
  type ValidationStep,
} from '../src/index.ts';
import { VALIDATE_OPTIONS, fixtureText } from './helpers.ts';

interface Case {
  readonly fixture: string;
  readonly step: ValidationStep;
  readonly reason: EnvelopeRejectionReason;
  readonly detailContains: string;
}

/** One case per malformation kind, mapped 1:1 to the step it must fail at. */
const CASES: readonly Case[] = [
  {
    fixture: 'malformed-invalid-json.json',
    step: 1,
    reason: 'invalid-json',
    detailContains: 'does not parse as JSON',
  },
  {
    fixture: 'malformed-missing-or-wrong-field.json',
    step: 2,
    reason: 'missing-or-wrong-required-field',
    detailContains: 'entities[1].identity.allRefs is not a string array',
  },
  {
    fixture: 'malformed-unrecognized.json',
    step: 3,
    reason: 'unrecognized-schema-or-dialect-or-capability',
    detailContains: 'globDialect.engine is "minimatch"',
  },
  {
    fixture: 'malformed-missing-source-digest.json',
    step: 4,
    reason: 'missing-source-digest',
    detailContains: 'sources[0] (catalog-info.yaml) declares no digest',
  },
  {
    fixture: 'malformed-identity-only.json',
    step: 5,
    reason: 'identity-only-true',
    detailContains: 'completeness.identityOnly is true',
  },
];

describe('five ordered validation steps', () => {
  test('the reason-to-step mapping is 1:1 and closed', () => {
    expect(REASON_STEP).toEqual({
      'invalid-json': 1,
      'missing-or-wrong-required-field': 2,
      'unrecognized-schema-or-dialect-or-capability': 3,
      'missing-source-digest': 4,
      'identity-only-true': 5,
    });
    expect(Object.keys(REASON_STEP)).toHaveLength(5);
  });

  for (const testCase of CASES) {
    test(`${testCase.fixture} is rejected at step ${testCase.step} as ${testCase.reason}`, () => {
      const result = validateEnvelope(fixtureText(testCase.fixture), VALIDATE_OPTIONS);

      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;

      expect(result.failedStep).toBe(testCase.step);
      expect(result.reason).toBe(testCase.reason);
      expect(result.detail).toContain(testCase.detailContains);
      expect(result.validated).toBeUndefined();

      // Not rejected earlier than its target step: the examination reports the
      // highest step actually reached, and it must equal the failing step.
      expect(result.examined.stepsReached).toBe(testCase.step);
    });
  }

  test('the five rejections are five distinct reasons at five distinct steps', () => {
    const observed = CASES.map((testCase) => {
      const result = validateEnvelope(fixtureText(testCase.fixture), VALIDATE_OPTIONS);
      if (result.outcome !== 'rejected') throw new Error(`${testCase.fixture} was not rejected`);
      return { step: result.failedStep, reason: result.reason };
    });

    expect(new Set(observed.map((entry) => entry.reason)).size).toBe(5);
    expect(observed.map((entry) => entry.step)).toEqual([1, 2, 3, 4, 5]);
  });

  test('step 4 is reached only after steps 2 and 3 have passed', () => {
    // The missing-source-digest fixture is structurally complete and carries the
    // frozen dialect, so it exercises the ordering directly: a validator that
    // folded digest-presence into the shape check would reject it at step 2.
    const result = validateEnvelope(fixtureText('malformed-missing-source-digest.json'), VALIDATE_OPTIONS);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(4);
    // Every entity record was inspected during step 2 before step 4 was reached.
    expect(result.examined.entityRecordsInspected).toBe(3);
  });

  test('step 5 is reached only after every source digest has been verified', () => {
    const result = validateEnvelope(fixtureText('malformed-identity-only.json'), VALIDATE_OPTIONS);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(5);
    expect(result.examined.sourcesVerified).toEqual(['catalog-info.yaml']);
  });
});

describe('step 3 checks the frozen matcher contract by exact value', () => {
  // `snapshot-envelope.md` §2 step 3 names three insufficient implementations
  // explicitly. Each gets its own case.
  const variants: readonly { readonly name: string; readonly mutate: (env: Record<string, unknown>) => void; readonly detail: string }[] = [
    {
      name: 'an unrecognized schemaVersion',
      mutate: (env) => {
        env['schemaVersion'] = '2';
      },
      detail: 'schemaVersion is "2"',
    },
    {
      name: 'a globDialect.version other than 4.0.5',
      mutate: (env) => {
        (env['globDialect'] as Record<string, unknown>)['version'] = '4.0.4';
      },
      detail: 'globDialect.version is "4.0.4"',
    },
    {
      name: 'globDialect.options.dot true',
      mutate: (env) => {
        ((env['globDialect'] as Record<string, unknown>)['options'] as Record<string, unknown>)['dot'] = true;
      },
      detail: 'globDialect.options.dot is true',
    },
    {
      name: 'globDialect.options.nocase true',
      mutate: (env) => {
        ((env['globDialect'] as Record<string, unknown>)['options'] as Record<string, unknown>)['nocase'] = true;
      },
      detail: 'globDialect.options.nocase is true',
    },
    {
      name: 'globDialect.options.nonegate false',
      mutate: (env) => {
        ((env['globDialect'] as Record<string, unknown>)['options'] as Record<string, unknown>)['nonegate'] = false;
      },
      detail: 'globDialect.options.nonegate is false',
    },
    {
      name: 'an empty capabilities array',
      mutate: (env) => {
        env['capabilities'] = [];
      },
      detail: 'capabilities is []',
    },
    {
      name: 'an extra capability',
      mutate: (env) => {
        env['capabilities'] = ['pathOwnership', 'entityOwnership'];
      },
      detail: 'capabilities is ["pathOwnership","entityOwnership"]',
    },
    {
      name: 'a different single capability',
      mutate: (env) => {
        env['capabilities'] = ['entityOwnership'];
      },
      detail: 'capabilities is ["entityOwnership"]',
    },
  ];

  for (const variant of variants) {
    test(`rejects ${variant.name} at step 3`, () => {
      const envelope = JSON.parse(fixtureText('valid.json')) as Record<string, unknown>;
      variant.mutate(envelope);
      const result = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);

      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;
      expect(result.failedStep).toBe(3);
      expect(result.reason).toBe('unrecognized-schema-or-dialect-or-capability');
      expect(result.detail).toContain(variant.detail);
    });
  }
});

describe('step 4 rejects a mismatching digest as well as a missing one', () => {
  test('a source digest that does not match the actual bytes is rejected at step 4', () => {
    const envelope = JSON.parse(fixtureText('valid.json')) as Record<string, unknown>;
    (envelope['sources'] as Record<string, unknown>[])[0]!['digest'] = 'f'.repeat(64);
    const result = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(4);
    expect(result.reason).toBe('missing-source-digest');
    expect(result.detail).toContain('but its bytes hash to');
    // The source was actually opened and hashed — not skipped.
    expect(result.examined.sourcesVerified).toEqual(['catalog-info.yaml']);
  });

  test('a source whose file cannot be read is rejected at step 4, naming the path', () => {
    const envelope = JSON.parse(fixtureText('valid.json')) as Record<string, unknown>;
    (envelope['sources'] as Record<string, unknown>[])[0]!['path'] = 'no-such-descriptor.yaml';
    const result = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.failedStep).toBe(4);
    expect(result.detail).toContain('no-such-descriptor.yaml');
    expect(result.detail).toContain('could not be read');
  });
});

describe('step 5 reads the boolean and nothing else', () => {
  test('an envelope whose entities are all annotation-absent is accepted', () => {
    // `snapshot-envelope.md` §7 row 1b. Rejecting on the ownership-state
    // distribution is the specific bug step 5's wording exists to prevent, and
    // this is the contrast case that catches it.
    const result = validateEnvelope(fixtureText('all-annotation-absent.json'), VALIDATE_OPTIONS);

    expect(result.outcome).toBe('valid');
    if (result.outcome !== 'valid') return;
    expect(result.examined.stepsReached).toBe(5);
    expect(result.examined.entityRecordsInspected).toBe(3);
  });

  test('the valid fixture passes all five steps', () => {
    const result = validateEnvelope(fixtureText('valid.json'), VALIDATE_OPTIONS);

    expect(result.outcome).toBe('valid');
    if (result.outcome !== 'valid') return;
    expect(result.reason).toBeUndefined();
    expect(result.failedStep).toBeUndefined();
    expect(result.examined).toEqual({
      entityRecordsInspected: 3,
      sourcesVerified: ['catalog-info.yaml'],
      stepsReached: 5,
    });
  });
});

describe('step 2 checks every nesting level', () => {
  const nested: readonly { readonly name: string; readonly mutate: (env: Record<string, unknown>) => void }[] = [
    { name: 'repository.revision missing', mutate: (env) => { delete (env['repository'] as Record<string, unknown>)['revision']; } },
    { name: 'globDialect.options.nocase not a boolean', mutate: (env) => { ((env['globDialect'] as Record<string, unknown>)['options'] as Record<string, unknown>)['nocase'] = 'false'; } },
    { name: 'completeness.wholeCatalog not a boolean', mutate: (env) => { (env['completeness'] as Record<string, unknown>)['wholeCatalog'] = 0; } },
    { name: 'entities[0].derivedPaths not a string array', mutate: (env) => { (env['entities'] as Record<string, unknown>[])[0]!['derivedPaths'] = ['ok', 7]; } },
    { name: 'entities[0].sourceDocument.documentIndexInFile not an integer', mutate: (env) => { ((env['entities'] as Record<string, unknown>[])[0]!['sourceDocument'] as Record<string, unknown>)['documentIndexInFile'] = 1.5; } },
    { name: 'entities[2].ownershipState not recognized', mutate: (env) => { (env['entities'] as Record<string, unknown>[])[2]!['ownershipState'] = 'inferred'; } },
    { name: 'entities[0].provenance empty', mutate: (env) => { (env['entities'] as Record<string, unknown>[])[0]!['provenance'] = ''; } },
    { name: 'entities[0].identity.allRefs empty', mutate: (env) => { ((env['entities'] as Record<string, unknown>[])[0]!['identity'] as Record<string, unknown>)['allRefs'] = []; } },
    { name: 'an entity record carrying a sixth field', mutate: (env) => { (env['entities'] as Record<string, unknown>[])[0]!['rawKind'] = 'Component'; } },
    { name: 'a flatter canonicalId/refs/paths triple', mutate: (env) => { env['entities'] = [{ canonicalId: 'component:default/payments', refs: [], paths: [] }]; } },
    { name: 'an unrecognized top-level field', mutate: (env) => { env['generatedAt'] = '2026-08-05T00:00:00Z'; } },
    { name: 'sources not an array', mutate: (env) => { env['sources'] = {}; } },
  ];

  for (const variant of nested) {
    test(`rejects ${variant.name} at step 2`, () => {
      const envelope = JSON.parse(fixtureText('valid.json')) as Record<string, unknown>;
      variant.mutate(envelope);
      const result = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);

      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;
      expect(result.failedStep).toBe(2);
      expect(result.reason).toBe('missing-or-wrong-required-field');
      expect(result.detail.length).toBeGreaterThan(0);
    });
  }

  for (const field of ['schemaVersion', 'repository', 'generatorVersion', 'globDialect', 'capabilities', 'completeness', 'sources', 'entities', 'digest']) {
    test(`rejects an envelope missing ${field} at step 2`, () => {
      const envelope = JSON.parse(fixtureText('valid.json')) as Record<string, unknown>;
      delete envelope[field];
      const result = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);

      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;
      expect(result.failedStep).toBe(2);
      expect(result.detail).toContain(field);
    });
  }
});
