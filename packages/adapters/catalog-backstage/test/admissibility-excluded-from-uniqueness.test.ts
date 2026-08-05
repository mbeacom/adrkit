/**
 * T053 — FR-019: **no inadmissible descriptor participates in a uniqueness
 * comparison.** Duplicate detection is not a validity test and must never be
 * reached by an inadmissible input.
 *
 * `admissibility.md` §4.1: an inadmissible descriptor "never acquires a canonical
 * id. It therefore can never participate in a `duplicate-canonical-id`
 * determination, in either direction: it cannot be the first member of a collision
 * and it cannot be the second."
 *
 * **The uniqueness comparison used below is deliberately test-local.** The
 * production one is `src/identity/uniqueness.ts`, which `tasks.md` assigns to
 * Phase E, behind Barrier B; creating it here would be starting Phase E early. What
 * is demonstrated instead is the property that makes Phase E's version safe by
 * construction: a comparison can only be handed canonical identities, canonical
 * identities exist only for admitted descriptors, and a batch containing an
 * inadmissible member never produces a set of them at all.
 *
 * The probe below is written to be *maximally naive* — it is exactly the
 * first-wins/last-wins-free duplicate scan an implementer would write — so that if
 * an inadmissible descriptor could reach it, it would.
 */

import { describe, expect, test } from 'bun:test';
import { type AdmittedDescriptor, admit, collectAdmitted } from '../src/admissibility/index.ts';
import { canonicalize } from '../src/identity/canonicalize.ts';
import {
  ADMISSIBLE,
  INADMISSIBLE_AND_COLLIDING,
  INADMISSIBLE_AND_UNIQUE_BULK_IMPORT,
  descriptor,
} from './descriptor-fixtures.ts';

/**
 * A test-local duplicate scan.
 *
 * Note the parameter type: `AdmittedDescriptor[]`. There is no signature here that
 * accepts a raw descriptor, which is the whole point — an inadmissible descriptor
 * has no way in.
 */
function duplicateCanonicalIds(admitted: readonly AdmittedDescriptor[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const one of admitted) {
    const { canonicalId } = canonicalize(one);
    if (seen.has(canonicalId)) duplicates.push(canonicalId);
    seen.add(canonicalId);
  }
  return duplicates;
}

describe('T053 — the comparison is only reachable with admitted descriptors', () => {
  test('two admissible descriptors colliding are reported as a collision', () => {
    // The comparison works. Without this, "no inadmissible descriptor reaches it"
    // would be satisfiable by a comparison that reports nothing at all.
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'Payments', namespace: 'default' }),
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
    ]);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(duplicateCanonicalIds(admission.admitted)).toEqual(['component:default/payments']);
  });

  test('two admissible descriptors that differ are not a collision', () => {
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
      descriptor({ ...ADMISSIBLE, name: 'billing' }),
    ]);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(duplicateCanonicalIds(admission.admitted)).toEqual([]);
  });
});

describe('T053 — an inadmissible descriptor never reaches the comparison', () => {
  test('the fourteen-sharing placeholder form would collide, and never gets the chance', () => {
    // Two descriptors carrying `${{ values.name | dump }}` canonicalize identically
    // — that is exactly how ADR-0015 describes the fourteen. If admissibility ran
    // second, this batch would report `duplicate-canonical-id`.
    const admission = collectAdmitted([
      descriptor(INADMISSIBLE_AND_COLLIDING, 'a/catalog-info.yaml'),
      descriptor(INADMISSIBLE_AND_COLLIDING, 'b/catalog-info.yaml'),
    ]);

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
    expect(admission.rejection.triggerClass).not.toBe('duplicate-canonical-id');
  });

  test('the batch yields no admitted set, so there is nothing to compare', () => {
    const admission = collectAdmitted([
      descriptor(INADMISSIBLE_AND_COLLIDING, 'a/catalog-info.yaml'),
      descriptor(INADMISSIBLE_AND_COLLIDING, 'b/catalog-info.yaml'),
    ]);
    expect(admission.ok).toBe(false);
    expect(admission).not.toHaveProperty('admitted');
  });

  test('it cannot be the first member of a collision', () => {
    const admission = collectAdmitted([
      descriptor(INADMISSIBLE_AND_COLLIDING, 'first.yaml'),
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
    ]);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('it cannot be the second member of a collision either', () => {
    // §4.1: "in either direction". An implementation that checked admissibility
    // lazily, only for the descriptor it was about to canonicalize, would pass the
    // previous test and fail this one.
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
      descriptor(INADMISSIBLE_AND_COLLIDING, 'second.yaml'),
    ]);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('a single inadmissible descriptor produces no canonical id to compare', () => {
    const outcome = admit(descriptor(INADMISSIBLE_AND_UNIQUE_BULK_IMPORT));
    expect(outcome.admissible).toBe(false);
    expect(outcome).not.toHaveProperty('admitted');
    expect(JSON.stringify(outcome)).not.toContain('canonicalId');
  });
});

describe('T053 — duplicate detection is a statement about a pair, not about one descriptor', () => {
  test('the same descriptor is admissible alone and colliding only in company', () => {
    // `admissibility.md` §6 / FR-021: "canonical-id collision is a statement about a
    // *pair* of descriptors. It is not a property of either one alone, and it is
    // not an admissibility failure."
    const one = descriptor({ ...ADMISSIBLE, name: 'payments' });

    const alone = collectAdmitted([one]);
    expect(alone.ok).toBe(true);
    if (!alone.ok) return;
    expect(duplicateCanonicalIds(alone.admitted)).toEqual([]);

    const paired = collectAdmitted([one, descriptor({ ...ADMISSIBLE, name: 'payments' })]);
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(duplicateCanonicalIds(paired.admitted)).toEqual(['component:default/payments']);
  });

  test('admissibility is unchanged by what else is in the batch', () => {
    // The converse: admissibility is a property of one descriptor alone. If it
    // were not, the two determinations would be entangled in the other direction.
    const one = descriptor(INADMISSIBLE_AND_UNIQUE_BULK_IMPORT);
    const alone = admit(one);
    const inCompany = collectAdmitted([descriptor({ ...ADMISSIBLE, name: 'payments' }), one]);

    expect(alone.admissible).toBe(false);
    expect(inCompany.ok).toBe(false);
    if (alone.admissible || inCompany.ok) return;
    expect(alone.rejection.detail).toBe(inCompany.rejection.detail);
  });
});
