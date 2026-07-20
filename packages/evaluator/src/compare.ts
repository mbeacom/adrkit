/**
 * @adrkit/evaluator — deterministic string comparison.
 *
 * `String.prototype.localeCompare` (no locale) is ECMA-402 implementation-/ICU-/locale-
 * dependent and non-injective (`"\u00e9".localeCompare("e\u0301") === 0`), so it cannot
 * back a byte-for-byte "across machines" guarantee (FR-005) or the envelope hash
 * recomputation. Every ordering that feeds canonical bytes or a hash MUST use this pure
 * code-unit comparator instead.
 */

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
