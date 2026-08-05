/**
 * T057 — FR-025: ownership is derived from the `adrkit.io/owned-paths` annotation
 * **alone**.
 *
 * ADR-0012 and `owned-paths-annotation.md` §1: no inference from the descriptor's
 * own file location, its parent directory, the repository root, or any other signal.
 *
 * **The signature is the enforcement.** {@link deriveOwnership} takes a presence
 * discriminant and a raw annotation node. It does not take a descriptor path, a
 * directory, a repository root, or a filesystem — so there is nothing available to
 * infer from even if someone wanted to. A comment saying "do not infer from the
 * path" would be a request; a parameter list without a path is a guarantee.
 *
 * # Step 5 lives here
 *
 * `owned-paths-annotation.md` §1: "Only after steps 1–4 succeed does each string
 * element proceed to `contracts/glob-dialect.md`'s validator." Keeping step 5 in
 * this module — rather than inside `ownership/annotation.ts` — is what makes that
 * ordering observable: `decodeAnnotation` has no access to the glob validator at
 * all, so it *cannot* have validated a pattern early.
 *
 * # Warrant
 *
 * `admissibility.md` §7: an admissibility pass does not warrant "that any path
 * derived from it is a path anyone actually owns". Neither does this module. What it
 * returns is what the annotation declared, decoded and validated against a frozen
 * dialect — not a claim about who owns anything.
 *
 * @see `specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` §1, §3
 * @see `specs/010-catalog-backstage/spec.md` FR-025
 */

import type { Rejection } from '../diagnostics.ts';
import { type GlobCompiler, createGlobCompiler } from '../glob/dialect.ts';
import { orderDerivedPaths } from '../glob/order.ts';
import { type GlobOutcome, type RestrictedGlobPattern, validateGlobPatterns } from '../glob/validate.ts';
import {
  type AnnotationRejectionReason,
  type OwnedPathsAnnotation,
  decodeAnnotation,
} from './annotation.ts';
import { type OwnershipState, classifyOwnershipState } from './states.ts';

/** A successful derivation. */
export interface DerivedOwnership {
  readonly ownershipState: OwnershipState;
  /** Sorted with `compareCodeUnits` and deduplicated (FR-033). */
  readonly derivedPaths: readonly string[];
  readonly annotation: OwnedPathsAnnotation;
  /** Every pattern's verdict, in declared order. Empty unless `explicit-paths`. */
  readonly patterns: readonly RestrictedGlobPattern[];
}

/** Reasons a derivation can fail: steps 2–4's, plus step 5's `invalid-pattern`. */
export type OwnershipRejectionReason = AnnotationRejectionReason | 'invalid-pattern';

/** The outcome of deriving one entity's ownership. */
export type OwnershipDerivation =
  | { readonly ok: true; readonly value: DerivedOwnership }
  | {
      readonly ok: false;
      readonly rejection: Rejection<OwnershipRejectionReason>;
      readonly annotation: OwnedPathsAnnotation;
      /** Present only for a step-5 failure; the rejected pattern's verdict. */
      readonly pattern: RestrictedGlobPattern | undefined;
    };

/**
 * Derive one entity's owned paths from its annotation, and from nothing else.
 *
 * `present` and `rawNode` come from `descriptor/read.ts`'s `readAnnotationNode`,
 * which supplies presence as an explicit discriminant — §1 step 1 requires that it
 * never be inferred from a value being `undefined`.
 *
 * `compiler` is the per-run compiler. Passing the same one across every entity in a
 * run is what gives FR-032 its "once per run" rather than "once per entity".
 */
export function deriveOwnership(
  present: boolean,
  rawNode: unknown,
  compiler: GlobCompiler = createGlobCompiler(),
): OwnershipDerivation {
  // Steps 1–4.
  const decoded = decodeAnnotation(present, rawNode);
  if (!decoded.ok) {
    return { ok: false, rejection: decoded.rejection, annotation: decoded.diagnostics, pattern: undefined };
  }

  const ownershipState = classifyOwnershipState(decoded.value);

  // `annotation-absent` and `explicit-empty` both yield `[]`, and the two are kept
  // apart by `ownershipState` alone — never by inspecting `derivedPaths`, which is
  // identical for both (§3's non-conflation rule).
  if (ownershipState !== 'explicit-paths') {
    return {
      ok: true,
      value: {
        ownershipState,
        derivedPaths: [],
        annotation: decoded.value.diagnostics,
        patterns: [],
      },
    };
  }

  // Step 5 — per-pattern glob validation. Reached only now.
  const declared = decoded.value.patterns ?? [];
  const patterns = validateGlobPatterns(declared, compiler);
  const firstRejected = patterns.find((pattern) => pattern.outcome !== 'accepted');

  if (firstRejected !== undefined) {
    return {
      ok: false,
      rejection: {
        reason: 'invalid-pattern',
        triggerClass: 'invalid-pattern',
        detail: `pattern ${JSON.stringify(firstRejected.raw)} rejected at rule ${firstRejected.rule} (${firstRejected.outcome})`,
      },
      annotation: decoded.value.diagnostics,
      pattern: firstRejected,
    };
  }

  return {
    ok: true,
    value: {
      ownershipState,
      derivedPaths: orderDerivedPaths(declared),
      annotation: decoded.value.diagnostics,
      patterns,
    },
  };
}

/**
 * The rule-specific outcome for each declared pattern, evaluated in isolation.
 *
 * FR-031 requires that a mixed batch classify each pattern individually. Exposed
 * separately from {@link deriveOwnership} because that function stops at the first
 * rejection — which is the right *derivation* behaviour and the wrong *reporting*
 * behaviour for demonstrating rule-specificity across a batch.
 */
export function classifyPatterns(
  declared: readonly string[],
  compiler: GlobCompiler = createGlobCompiler(),
): readonly { readonly raw: string; readonly outcome: GlobOutcome }[] {
  return validateGlobPatterns(declared, compiler).map((pattern) => ({
    raw: pattern.raw,
    outcome: pattern.outcome,
  }));
}
