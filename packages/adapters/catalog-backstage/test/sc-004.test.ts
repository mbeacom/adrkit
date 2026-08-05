/**
 * T056 — SC-004 close-out.
 *
 * SC-004 (`spec.md`), in full: *"For every descriptor that any of ADR-0015's four
 * pinned validator predicates returns `false` for, the recorded trigger class is
 * `inadmissible-descriptor`, no canonical identity for that descriptor is computed
 * or emitted, and a descriptor set that would collide only after canonicalizing an
 * inadmissible descriptor is never reported as `duplicate-canonical-id`. The
 * exercised set includes **at least one inadmissible descriptor that canonicalizes
 * uniquely and collides with nothing** (FR-021) ... and each
 * `inadmissible-descriptor` record carries all three of the offending path, the
 * failing field, and the rejecting validator (FR-020)."*
 *
 * `admissibility.md` §8 is the observation requirement this closes out: each of the
 * four predicates, and the composition, lands only by constructing a descriptor
 * that should fail that specific validator, observing the failure and recording the
 * exact reason, then correcting the input and observing the pass.
 *
 * This file iterates **every admissibility failure mode** — one per validator, plus
 * the composition — and asserts the same four properties for each. It consolidates
 * T048–T055; it does not restate their individual contract citations.
 */

import { describe, expect, test } from 'bun:test';
import { classifyAdmissibility, inadmissibleRejection } from '../src/admissibility/classify.ts';
import { admit } from '../src/admissibility/index.ts';
import {
  ADMISSIBILITY_FIELDS,
  type AdmissibilityValidatorName,
} from '../src/admissibility/validators.ts';
import { canonicalize } from '../src/identity/canonicalize.ts';
import { type DescriptorSpec, ADMISSIBLE, descriptor } from './descriptor-fixtures.ts';

/**
 * One failure mode per validator, plus the composition, plus the FR-021 case.
 *
 * Each `bad` differs from `ADMISSIBLE` in exactly one field, so the attribution it
 * produces is unambiguous. Each `corrected` is the same descriptor with that field
 * repaired — §8's third move.
 */
const FAILURE_MODES: readonly {
  readonly label: string;
  readonly bad: DescriptorSpec;
  readonly corrected: DescriptorSpec;
  readonly validators: readonly AdmissibilityValidatorName[];
}[] = [
  {
    label: 'apiVersion — two separators',
    bad: { ...ADMISSIBLE, apiVersion: 'backstage.io/v1/alpha' },
    corrected: { ...ADMISSIBLE, apiVersion: 'backstage.io/v1alpha1' },
    validators: ['validateApiVersion'],
  },
  {
    label: 'apiVersion — prefix is not a DNS subdomain',
    bad: { ...ADMISSIBLE, apiVersion: 'Backstage.io/v1alpha1' },
    corrected: { ...ADMISSIBLE, apiVersion: 'backstage.io/v1alpha1' },
    validators: ['validateApiVersion'],
  },
  {
    label: 'kind — leading digit',
    bad: { ...ADMISSIBLE, kind: '1Component' },
    corrected: { ...ADMISSIBLE, kind: 'Component' },
    validators: ['validateKind'],
  },
  {
    label: 'metadata.name — character class (unsubstituted placeholder)',
    bad: { ...ADMISSIBLE, name: '${{ values.name }}' },
    corrected: { ...ADMISSIBLE, name: 'bulk-import-plugin' },
    validators: ['validateEntityName'],
  },
  {
    label: 'metadata.name — length alone',
    bad: { ...ADMISSIBLE, name: 'a'.repeat(64) },
    corrected: { ...ADMISSIBLE, name: 'a'.repeat(63) },
    validators: ['validateEntityName'],
  },
  {
    label: 'metadata.namespace — not a DNS label',
    bad: { ...ADMISSIBLE, namespace: 'Default' },
    corrected: { ...ADMISSIBLE, namespace: 'default' },
    validators: ['validateNamespace'],
  },
  {
    label: 'the composition — all four failing at once',
    bad: { apiVersion: 'A/B/C', kind: '1bad', name: '-bad-', namespace: 'BAD' },
    corrected: { ...ADMISSIBLE, namespace: 'default' },
    validators: [
      'validateApiVersion',
      'validateKind',
      'validateEntityName',
      'validateNamespace',
    ],
  },
];

describe('SC-004 — every failure mode yields `inadmissible-descriptor`', () => {
  test('every one of the four fields is covered by at least one mode', () => {
    const covered = new Set(
      FAILURE_MODES.flatMap((mode) => classifyAdmissibility(descriptor(mode.bad)).failedFields),
    );
    expect([...covered].sort()).toEqual([...ADMISSIBILITY_FIELDS].sort());
  });

  test.each(FAILURE_MODES.map((mode) => [mode.label, mode] as const))(
    '%s',
    (_label, mode) => {
      const outcome = admit(descriptor(mode.bad, 'packages/x/catalog-info.yaml'));

      // (1) The recorded trigger class is `inadmissible-descriptor`.
      expect(outcome.admissible).toBe(false);
      if (outcome.admissible) return;
      expect(outcome.rejection.triggerClass).toBe('inadmissible-descriptor');

      // (2) No canonical identity is computed or emitted for it.
      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain('canonicalId');
      expect(serialized).not.toContain('allRefs');
      expect(outcome).not.toHaveProperty('admitted');

      // (3) It is never reported as `duplicate-canonical-id`.
      expect(outcome.rejection.triggerClass).not.toBe('duplicate-canonical-id');

      // (4) The record carries all three attributions (FR-020).
      const detail = outcome.rejection.detail;
      expect(detail).toContain('packages/x/catalog-info.yaml');
      for (const validator of mode.validators) expect(detail).toContain(validator);
      for (const field of classifyAdmissibility(descriptor(mode.bad)).failedFields) {
        expect(detail).toContain(field);
      }
    },
  );

  test.each(FAILURE_MODES.map((mode) => [mode.label, mode] as const))(
    '%s — corrected, observed passing (\u00a78 move 3)',
    (_label, mode) => {
      const outcome = admit(descriptor(mode.corrected));
      expect(outcome.admissible).toBe(true);
      if (!outcome.admissible) return;
      expect(canonicalize(outcome.admitted).canonicalId).toMatch(/^[a-z0-9:/._-]+$/u);
    },
  );
});

describe('SC-004 — admissibility is decided before canonical identity is computed', () => {
  test('for every failure mode, no identity exists to have been computed', () => {
    for (const mode of FAILURE_MODES) {
      const result = classifyAdmissibility(descriptor(mode.bad));
      expect(result.admissible).toBe(false);
      // The rejection is constructible without any identity, and `AdmissibilityResult`
      // has no field that could hold one.
      expect(Object.keys(result).sort()).toEqual(['admissible', 'attributions', 'failedFields']);
      expect(inadmissibleRejection(result).detail).not.toContain(':default/');
    }
  });

  test('canonicalization of a corrected descriptor performs both steps', () => {
    // The other half of the ordering claim: once admissible, `entity-identity.md`
    // §1's two steps run and produce the id the contract's worked example gives.
    const omittedNamespace = admit(descriptor({ ...ADMISSIBLE, kind: 'Component', name: 'Billing' }));
    expect(omittedNamespace.admissible).toBe(true);
    if (!omittedNamespace.admissible) return;
    expect(canonicalize(omittedNamespace.admitted).canonicalId).toBe('component:default/billing');

    const explicitNamespace = admit(
      descriptor({ ...ADMISSIBLE, kind: 'Component', name: 'Payments', namespace: 'default' }),
    );
    expect(explicitNamespace.admissible).toBe(true);
    if (!explicitNamespace.admissible) return;
    expect(canonicalize(explicitNamespace.admitted).canonicalId).toBe('component:default/payments');
  });

  test('`entity-identity.md` \u00a71\u2019s worked example table, both rows', () => {
    // | Component / Default / Payments | component / default / payments | component:default/payments |
    // | Component / omitted / Billing  | component / default / billing  | component:default/billing  |
    //
    // Row 1's descriptor A carries `namespace: Default`, which ADR-0015's
    // `validateNamespace` rejects — so under this feature it never reaches
    // canonicalization at all. That is the narrowing ADR-0015 describes, and it is
    // recorded here rather than smoothed over: the §1 example predates ADR-0015.
    const uppercaseNamespace = admit(
      descriptor({ ...ADMISSIBLE, kind: 'Component', name: 'Payments', namespace: 'Default' }),
    );
    expect(uppercaseNamespace.admissible).toBe(false);

    const rowTwo = admit(descriptor({ ...ADMISSIBLE, kind: 'Component', name: 'Billing' }));
    expect(rowTwo.admissible).toBe(true);
    if (!rowTwo.admissible) return;
    expect(canonicalize(rowTwo.admitted).canonicalId).toBe('component:default/billing');
  });
});

describe('SC-004 — the FR-021 case is in the exercised set', () => {
  test('at least one exercised descriptor is inadmissible and canonicalizes uniquely', () => {
    // The full construction and its permanence are `test/inadmissible-and-unique.test.ts`.
    // What SC-004 needs here is that the criterion's exercised set contains it.
    const labels = FAILURE_MODES.map((mode) => mode.label);
    expect(labels).toContain('metadata.name — character class (unsubstituted placeholder)');

    const outcome = admit(descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' }));
    expect(outcome.admissible).toBe(false);
    if (outcome.admissible) return;
    expect(outcome.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('length and character class are exercised as separate populations (\u00a72.1)', () => {
    const byLength = classifyAdmissibility(descriptor({ ...ADMISSIBLE, name: 'a'.repeat(64) }));
    const byCharacterClass = classifyAdmissibility(
      descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' }),
    );
    expect(byLength.failedFields).toEqual(['metadata.name']);
    expect(byCharacterClass.failedFields).toEqual(['metadata.name']);
    // Same field, different populations. The `observed` value is what keeps them
    // distinguishable in a report.
    expect(byLength.attributions[0]?.observed).not.toBe(
      byCharacterClass.attributions[0]?.observed,
    );
  });
});
