/**
 * T048 · T053 — admissibility runs **before** canonicalization, and no inadmissible
 * descriptor ever participates in a uniqueness comparison. Both enforced
 * structurally rather than by convention.
 *
 * # Why "structurally" is the requirement, not "in the right order"
 *
 * `admissibility.md` §4.1: reversing the order "would make some descriptors collide
 * *before* being found inadmissible, and the trigger class reported for the run
 * would then depend on document order within the manifest. Order-dependence of the
 * reported trigger is exactly the failure mode ADR-0015's ordering rule exists to
 * prevent."
 *
 * A comment saying "call `admit` first" would not prevent that. The mechanism used
 * here does:
 *
 * - {@link AdmittedDescriptor} carries a private brand that **cannot be constructed
 *   outside this module**. The only value of that type in existence comes from
 *   {@link admit} returning `admissible: true`.
 * - `identity/canonicalize.ts` accepts an {@link AdmittedDescriptor} and nothing
 *   else. A caller holding a raw `DescriptorDocument` cannot canonicalize it — not
 *   because it is discouraged, but because the program does not typecheck.
 * - {@link collectAdmitted} is **all-or-nothing**: handed a batch containing one
 *   inadmissible descriptor it returns the rejection and no descriptors at all. It
 *   has no "and the rest" branch to be tempted by, so the uniqueness comparison
 *   downstream is never reachable with an inadmissible member.
 *
 * # Duplicate detection is not a validity check (§6, FR-021)
 *
 * Two determinations, independent. Conformance evidence "MUST demonstrate that
 * independence rather than assert it", and specifically must include a descriptor
 * that is **inadmissible and canonically unique** — one that fails §2 while
 * colliding with nothing. Without such a case a passing suite is "equally consistent
 * with an implementation that has silently fused the two checks". That case is
 * `test/inadmissible-and-unique.test.ts` (T054), and it is retained permanently.
 *
 * @see `specs/010-catalog-backstage/contracts/admissibility.md` §4, §4.1, §6
 */

import type { Rejection } from '../diagnostics.ts';
import type { DescriptorDocument } from '../descriptor/read.ts';
import {
  type AdmissibilityResult,
  type AuthoredFields,
  type InadmissibilityReason,
  authoredFields,
  classifyAdmissibility,
  inadmissibleRejection,
} from './classify.ts';

/**
 * The brand.
 *
 * A real runtime symbol rather than a `declare`d type-only one, and **not
 * exported**. Type-only branding would be erased at runtime, so a plain object cast
 * with `as` would produce a value indistinguishable from a genuine admission once
 * compiled. This way the guarantee holds in both directions: TypeScript refuses to
 * construct the type outside this module, and at runtime the property key is a
 * symbol no other module holds a reference to.
 */
const ADMITTED: unique symbol = Symbol('adrkit.catalog-backstage.admitted');

/**
 * A descriptor that has passed all four validators.
 *
 * The only route to one is {@link admit}. This is the type-level expression of
 * ADR-0015's ordering rule: canonicalization consumes this, so canonicalization
 * cannot precede admissibility.
 */
export interface AdmittedDescriptor {
  readonly [ADMITTED]: true;
  readonly document: DescriptorDocument;
  /** The four fields **as authored** — the namespace has not been defaulted yet. */
  readonly fields: AuthoredFields;
}

/** The outcome of admitting one descriptor. */
export type AdmissionOutcome =
  | { readonly admissible: true; readonly admitted: AdmittedDescriptor }
  | {
      readonly admissible: false;
      readonly result: AdmissibilityResult;
      readonly rejection: Rejection<InadmissibilityReason>;
    };

/**
 * Decide admissibility for one parsed descriptor.
 *
 * Note what this does **not** return on the failure branch: an
 * {@link AdmittedDescriptor}, a canonical id, or a partially-usable descriptor.
 * There is nothing on that branch a caller could canonicalize even by mistake.
 */
export function admit(document: DescriptorDocument): AdmissionOutcome {
  const result = classifyAdmissibility(document);

  if (!result.admissible) {
    return { admissible: false, result, rejection: inadmissibleRejection(result) };
  }

  return {
    admissible: true,
    admitted: {
      [ADMITTED]: true,
      document,
      fields: authoredFields(document),
    },
  };
}

/** All-or-nothing admission over a batch. */
export type BatchAdmission =
  | { readonly ok: true; readonly admitted: readonly AdmittedDescriptor[] }
  | {
      readonly ok: false;
      readonly result: AdmissibilityResult;
      readonly rejection: Rejection<InadmissibilityReason>;
    };

/**
 * Admit a whole batch, or none of it.
 *
 * `admissibility.md` §5: on any inadmissible descriptor, "**no** entity from the
 * same run is emitted, including entities already determined admissible". The
 * failure branch carries no descriptors, so a caller cannot proceed to a uniqueness
 * comparison over a partially-admitted set — the set does not exist.
 *
 * Descriptors are processed in the order given, so the reported attribution for a
 * batch with two inadmissible members is deterministic rather than a function of
 * iteration order.
 */
export function collectAdmitted(
  documents: readonly DescriptorDocument[],
): BatchAdmission {
  const admitted: AdmittedDescriptor[] = [];

  for (const document of documents) {
    const outcome = admit(document);
    if (!outcome.admissible) {
      return { ok: false, result: outcome.result, rejection: outcome.rejection };
    }
    admitted.push(outcome.admitted);
  }

  return { ok: true, admitted };
}
