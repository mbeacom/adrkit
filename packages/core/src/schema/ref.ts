/**
 * @adrkit/core — ADR reference parsing.
 *
 * The single shared primitive for splitting an `AdrRef` string into its optional
 * `log` qualifier and its bare `id`. Promoted from the private `parseRef` formerly
 * duplicated in `packages/evaluator/src/rules/no-orphan-refs.ts`, and consumed by
 * `@adrkit/mcp` to detect whether a caller-supplied ref is log-qualified.
 *
 * There is deliberately no inverse `formatAdrRef`: nothing re-serializes a
 * `(log, id)` pair; every ref echoed to a caller reuses the original string verbatim.
 */

export interface ParsedAdrRef {
  readonly id: string;
  readonly log?: string;
}

// Splits on the first ':'. A leading ':' or no ':' at all is unqualified and
// returns { id: ref } with `id` the untouched original string (never split in that
// case); a qualified ref returns { log, id } split on the first colon. This is the
// behavior- and object-shape-preserving promotion of no-orphan-refs.ts's private copy.
export function parseAdrRef(ref: string): ParsedAdrRef {
  const idx = ref.indexOf(':');
  if (idx <= 0) return { id: ref };
  return { log: ref.slice(0, idx), id: ref.slice(idx + 1) };
}
