/**
 * @adrkit/mcp — deterministic search normalization (research §R5).
 *
 * `normalize(s) = s.trim().normalize('NFKC').toLowerCase()` — engine-builtin,
 * non-ICU, locale-independent. No stemming, fuzzy, weighting, or ranking.
 */
export function normalize(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}
