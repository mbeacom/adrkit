/**
 * T050 — the separator rule inside `isValidApiVersion`.
 *
 * ADR-0015 states two properties of the `apiVersion` binding "since the split is
 * not obvious from the predicate alone", quoted here verbatim:
 *
 * > `isValidPrefixAndOrSuffix` splits on `/` and **rejects any value containing two
 * > or more separators**, and a value with **no** separator is validated against
 * > the suffix predicate alone — so a bare `v1` passes without the subdomain rule
 * > ever being consulted.
 *
 * Both halves matter and both are easy to get wrong in opposite directions. An
 * implementation that split on the *first* `/` and ignored the rest would accept
 * `a/b/c`. One that required a prefix would reject the bare `v1` that ADR-0015
 * explicitly says passes.
 *
 * @see `docs/adr/0015-validate-descriptors-against-backstage-field-formats-before-canonicalizing.md`
 * @see `specs/010-catalog-backstage/spec.md` FR-017
 */

/** How a value splits across the `/` separator. */
export type SeparatorSplit =
  /** No separator: the whole value is a suffix, and no prefix rule is consulted. */
  | { readonly kind: 'suffix-only'; readonly suffix: string }
  /** Exactly one separator: prefix and suffix are each validated by their own rule. */
  | { readonly kind: 'prefix-and-suffix'; readonly prefix: string; readonly suffix: string }
  /** Two or more separators: rejected outright, whatever the parts contain. */
  | { readonly kind: 'too-many-separators'; readonly separatorCount: number };

/**
 * Split `value` on `/` according to ADR-0015's separator rule.
 *
 * Counting separators *before* deciding anything is what makes the two-or-more
 * rejection independent of what the parts happen to be.
 */
export function splitOnSeparator(value: string): SeparatorSplit {
  const parts = value.split('/');
  const separatorCount = parts.length - 1;

  if (separatorCount >= 2) return { kind: 'too-many-separators', separatorCount };
  if (separatorCount === 0) return { kind: 'suffix-only', suffix: value };

  return {
    kind: 'prefix-and-suffix',
    prefix: parts[0] as string,
    suffix: parts[1] as string,
  };
}
