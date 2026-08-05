/**
 * T068 — FR-033: `derivedPaths` is sorted with `compareCodeUnits` and deduplicated.
 *
 * The point of both operations is stated in FR-033 itself: *"so that the envelope's
 * array ordering is a function of content alone"*. Two annotations declaring the
 * same patterns in different orders must produce byte-identical output
 * (`owned-paths-annotation.md` §5, SC-001).
 *
 * **`compareCodeUnits`, never `localeCompare`.** `packages/core/src/ordering/index.ts:12`
 * is the repository's sole comparator, and its own module note says why: a
 * locale-sensitive comparison makes output depend on the machine's environment,
 * which is not "a function of content alone" at all. It is imported here rather than
 * reimplemented so there is exactly one ordering source across the repository.
 *
 * **Dedup before sort, and `Set` is safe here.** `owned-paths-annotation.md` §5
 * names "a `Set` iteration order dependency" as a source of non-determinism, and
 * that warning is about *relying on* insertion order. Deduplicating with a `Set` and
 * then sorting cannot inherit that dependency: the sort is total over distinct
 * strings, so insertion order is discarded. The ordering below is therefore a
 * function of the pattern *set*, not of how it was built.
 *
 * @see `specs/010-catalog-backstage/spec.md` FR-033
 * @see `specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` §5
 */

import { compareCodeUnits } from '@adrkit/core';

/**
 * Sort and deduplicate derived paths.
 *
 * Returns a new array; the input is never mutated, so a caller holding the
 * annotation's decoded order can still report it.
 */
export function orderDerivedPaths(patterns: readonly string[]): readonly string[] {
  return [...new Set(patterns)].sort(compareCodeUnits);
}

/** True when `patterns` is already sorted and deduplicated. */
export function isOrdered(patterns: readonly string[]): boolean {
  const ordered = orderDerivedPaths(patterns);
  return (
    ordered.length === patterns.length &&
    ordered.every((pattern, index) => pattern === patterns[index])
  );
}
