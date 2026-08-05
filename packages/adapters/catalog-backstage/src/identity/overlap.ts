/**
 * T072 — **overlap between distinct canonical ids is not a collision**, and there is
 * no exclusive winner.
 *
 * # The rule
 *
 * `entity-identity.md` §4: two entities with **distinct** canonical ids whose
 * `adrkit.io/owned-paths` values both include the identical pattern "MUST both derive
 * successfully — this MUST NOT trigger `contracts/atomic-fail-closed.md`'s abort — and
 * a changed file matching that overlapping pattern MUST be recorded as owned by
 * **every** matching entity simultaneously, mirroring ADR-0009's own
 * union-not-winner `affects` semantics."
 *
 * # Why this module exists at all, given that nothing rejects overlap
 *
 * §4 is explicit that the rule "MUST be **positively demonstrated** (both entities'
 * derived `paths` retain the overlapping pattern, and the changed file matches both),
 * not merely asserted by the absence of a rejection rule." `data-model.md` §8 repeats
 * it: "must be **positively demonstrated**, never inferred from the absence of a
 * rejection."
 *
 * That is a real distinction. A generator that had silently dropped one of the two
 * overlapping entities would also produce no rejection, and a test asserting only "the
 * run did not abort" would pass. {@link ownersOf} makes the union observable: it
 * returns **every** matching entity, so a winner-takes-all implementation fails it by
 * returning one.
 *
 * # This module selects nothing
 *
 * There is deliberately no priority, no specificity ranking, no first-match, and no
 * tie-break parameter anywhere below. Those are the shapes an exclusive winner would
 * take, and a function that cannot express one cannot accidentally acquire one.
 *
 * @see `specs/009-catalog-binding-viability/contracts/entity-identity.md` §4
 * @see `specs/010-catalog-backstage/spec.md` FR-024
 */

import { compareCodeUnits } from '@adrkit/core';
import { type GlobCompiler, createGlobCompiler } from '../glob/dialect.ts';

/** One entity's derived ownership, reduced to what path matching needs. */
export interface OwnershipClaim {
  readonly canonicalId: string;
  /** Already `compareCodeUnits`-sorted and deduplicated by `glob/order.ts`. */
  readonly derivedPaths: readonly string[];
}

/**
 * Every entity whose `derivedPaths` match `changedPath`, in `compareCodeUnits` order
 * of canonical id.
 *
 * Returns a list rather than an entity-or-undefined. The type is the guarantee: a
 * caller cannot read "the owner" off this because there is no such field, so
 * union-not-winner survives a caller who was hoping for a single answer.
 *
 * `compiler` is the per-run compiler, so the matcher used here is the same object
 * `glob/validate.ts` built when it accepted the pattern. FR-032 requires that
 * validation and matching "cannot diverge", and sharing the compiler is what makes
 * that structural rather than a convention.
 */
export function ownersOf(
  claims: readonly OwnershipClaim[],
  changedPath: string,
  compiler: GlobCompiler = createGlobCompiler(),
): readonly string[] {
  const owners = claims
    .filter((claim) =>
      claim.derivedPaths.some((pattern) => {
        const compiled = compiler.compile(pattern);
        return compiled.ok && compiled.matcher(changedPath);
      }),
    )
    .map((claim) => claim.canonicalId);

  return [...new Set(owners)].sort(compareCodeUnits);
}

/** One pattern shared by two or more distinct canonical ids. */
export interface PathOverlap {
  readonly pattern: string;
  /** Every canonical id declaring it, `compareCodeUnits`-sorted. At least two. */
  readonly canonicalIds: readonly string[];
}

/**
 * Every pattern declared by more than one **distinct** canonical id.
 *
 * This is a *report*, not a rejection, and the distinction is the whole point of the
 * module. `identity/uniqueness.ts` returns a rejection when two entities share a ref;
 * this returns a description when two entities share a pattern. §4 is what makes those
 * opposite outcomes correct for two superficially similar "two entities agree on a
 * string" conditions.
 *
 * Claims are keyed by canonical id, so an entity listed twice cannot manufacture an
 * overlap with itself.
 */
export function pathOverlaps(claims: readonly OwnershipClaim[]): readonly PathOverlap[] {
  const byPattern = new Map<string, Set<string>>();

  for (const claim of claims) {
    for (const pattern of claim.derivedPaths) {
      const owners = byPattern.get(pattern) ?? new Set<string>();
      owners.add(claim.canonicalId);
      byPattern.set(pattern, owners);
    }
  }

  return [...byPattern.entries()]
    .filter(([, canonicalIds]) => canonicalIds.size > 1)
    .map(([pattern, canonicalIds]) => ({
      pattern,
      canonicalIds: [...canonicalIds].sort(compareCodeUnits),
    }))
    .sort((a, b) => compareCodeUnits(a.pattern, b.pattern));
}

/**
 * Whether overlap is present at all.
 *
 * Exported so a demonstration can assert it is **true** for the fixture before
 * asserting that the run nonetheless succeeded. Without that, "the run did not abort"
 * would be equally consistent with a fixture that had no overlap in it — which is the
 * vacuous pass §4's "positively demonstrated" wording exists to rule out.
 */
export function hasOverlap(claims: readonly OwnershipClaim[]): boolean {
  return pathOverlaps(claims).length > 0;
}
