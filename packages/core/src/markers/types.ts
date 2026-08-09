/**
 * @adrkit/core — inbound source annotations, the shapes.
 *
 * `affects` is the outbound edge: a record declares the patterns it governs, and the
 * resolver matches paths against them. These types carry the other direction — a
 * source file naming, in a comment, the decision it lives under.
 *
 * The edge is discovered at resolution time and never enters a record, so the CC0
 * schema is untouched: no new `affects` matcher type, no new frontmatter field
 * ([ADR-0021](../../../../docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md)).
 *
 * This module is deliberately types-only, so a type-only consumer cannot pull marker
 * runtime code into an otherwise unrelated bundle.
 */

/** One `@adr <ref>` marker found in a source file's header window. */
export interface SourceMarker {
  /** Repo-relative, forward-slash path of the file that carried the marker. */
  path: string;
  /** The reference exactly as written — `0012`, or `payments:0012` when federated. */
  ref: string;
  /** The bare id, with any log qualifier stripped. */
  id: string;
  /** The log qualifier, present only when the ref named another decision log. */
  log?: string;
  /** 1-based line number within the file. */
  line: number;
}

/** Where a marker-derived match came from, reported beside a governing decision. */
export interface MarkerDeclaration {
  path: string;
  line: number;
  ref: string;
}

/** One record, and every place a source file declared it. */
export interface MarkerMatch {
  recordId: string;
  declaredBy: MarkerDeclaration[];
}
