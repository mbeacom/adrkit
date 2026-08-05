/**
 * T060 — the **three** ownership states, kept distinct and never conflated.
 *
 * `owned-paths-annotation.md` §3 and `data-model.md` §7.2 define exactly three;
 * there is no fourth.
 *
 * | State | Condition | `derivedPaths` |
 * |---|---|---|
 * | `explicit-paths` | annotation present, decodes and validates, array **non-empty** | sorted, deduplicated, non-empty |
 * | `explicit-empty` | annotation present, is a string scalar, and **decodes** to an array of length zero | `[]` |
 * | `annotation-absent` | annotation key wholly absent (`annotationPresent === false`) | `[]` |
 *
 * # `explicit-empty` is decided on the **decoded** value
 *
 * §3 states this in bold and then explains it: it is "a decoded-value check, never a
 * raw-string equality check — `'[]'`, `'[ ]'`, `'[\n]'`, and any other JSON text
 * that decodes to `[]` all qualify identically; the classification happens strictly
 * after JSON decoding, exactly as §1's decode-then-validate order requires, never
 * before it."
 *
 * An implementation comparing the raw string to `'[]'` would classify `'[ ]'` as
 * something else — most likely as `explicit-paths` with a nonsense pattern, or as a
 * shape error — for a descriptor that is in fact perfectly well-formed.
 *
 * # The non-conflation rule
 *
 * `explicit-empty` and `annotation-absent` both yield `[]`. They MUST NOT be treated
 * as equivalent anywhere in the envelope or in any evidence: "each entity's record
 * carries the discriminator as its own explicit field (never inferring the
 * distinction from `derivedPaths` alone, which is identical `[]` for both)". This is
 * ADR-0012's own explicit instruction.
 *
 * # `["", ...]` is not `explicit-empty`
 *
 * §4: `["", "packages/**"]` and `[""]` are non-empty arrays whose empty-string
 * element is rejected by the glob dialect's rule 1. That is a per-pattern validation
 * failure — a distinct failure mode from the `[]`-versus-absent distinction, and §4
 * says it MUST NOT be conflated with it.
 *
 * @see `specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` §3, §4
 * @see `specs/010-catalog-backstage/data-model.md` §7.2
 */

import type { DecodedAnnotation } from './annotation.ts';

/** `data-model.md` §7.2. Exactly three values. */
export type OwnershipState = 'explicit-paths' | 'explicit-empty' | 'annotation-absent';

/** The three, as data, so the count is assertable at runtime. */
export const OWNERSHIP_STATES = [
  'explicit-paths',
  'explicit-empty',
  'annotation-absent',
] as const satisfies readonly OwnershipState[];

/**
 * Classify a successfully-decoded annotation into one of the three states.
 *
 * Takes the **decoded** annotation, never a raw string — the signature is what makes
 * §3's "decoded-value check, never a raw-string equality check" structural. There is
 * no parameter here that could carry `'[ ]'` for someone to compare against `'[]'`.
 */
export function classifyOwnershipState(decoded: DecodedAnnotation): OwnershipState {
  if (!decoded.diagnostics.annotationPresent) return 'annotation-absent';
  return (decoded.patterns ?? []).length === 0 ? 'explicit-empty' : 'explicit-paths';
}

/**
 * True when the two empty-`derivedPaths` states have been conflated.
 *
 * A helper for assertions rather than for production logic: the point of the
 * non-conflation rule is that the distinction cannot be recovered from
 * `derivedPaths`, so anything checking it must consult the discriminator. Having the
 * check written once, here, is cheaper than reasoning about it at each call site.
 */
export function bothYieldEmptyDerivedPaths(a: OwnershipState, b: OwnershipState): boolean {
  const empties: readonly OwnershipState[] = ['explicit-empty', 'annotation-absent'];
  return empties.includes(a) && empties.includes(b);
}
