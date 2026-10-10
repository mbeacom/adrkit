/**
 * `portal-data.json` version 1 — the data contract of the static decision portal
 * ([ADR-0054](../../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clause 3).
 *
 * This file is types and constants only. It is the interface between three parties, and it
 * is written for the two that are not the builder:
 *
 * - **The page renderer** (`packages/portal/src/page/**`) reads this file's shape and nothing
 *   else. It builds its DOM with `createElement` and `textContent` only (clause 7), so every
 *   string below is **untrusted repository text** unless its doc comment says otherwise, and
 *   must be shown as text, never parsed as HTML or used as a class name or URL.
 * - **ADR-0055's REST server** produces the same file per request by calling the same pure
 *   builder (`buildPortalData`), with an `absent` path table (clause 12).
 *
 * ## Stability rules
 *
 * - **Additive only within version 1.** A field may be added; removing or reinterpreting one
 *   is `version: "2"` (clause 3).
 * - **No optional fields.** Every key is always present; "no value" is `null`. That keeps the
 *   serialized key set identical for every record, which is part of what makes identical
 *   inputs give byte-identical output.
 * - **Arrays, never id-keyed objects.** Order is part of the contract and is stated on each
 *   array.
 * - **No `generatedAt`, and no readiness verdict anywhere** (clauses 3 and 5).
 * - **This module stays import-free**, so the browser page can import its types without
 *   pulling in the SDK or anything else.
 */

/** The `version` of this contract. */
export const PORTAL_DATA_VERSION = '1' as const;

/** The file name the generator writes into the output directory. */
export const PORTAL_DATA_FILE = 'portal-data.json' as const;

/* ------------------------------------------------------------------ *
 * Vocabulary (schema enums; identical to `@adrkit/sdk`'s)
 * ------------------------------------------------------------------ */

/** A record's lifecycle status — the `status` enum of `schema/adr.schema.json`. */
export type PortalStatus = 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'deprecated';

/** Whether a record binds: `governing` binds now, `activeProposals` may, `history` no longer does. */
export type PortalStanding = 'governing' | 'activeProposals' | 'history';

/** A queued record's SLA state, as `adr queue --format json` spells it. */
export type PortalSlaState =
  | 'overdue'
  | 'escalated'
  | 'due'
  | 'within-sla'
  | 'missing-sla'
  | 'not-queued'
  | 'decided';

/** The three relationships a record can declare to another, `adr graph --kind`'s vocabulary. */
export type PortalEdgeKind = 'supersedes' | 'relatesTo' | 'conflictsWith';

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

/** The whole of `portal-data.json`. */
export interface PortalData {
  /** Contract version. A renderer that does not know the version must refuse to render. */
  readonly version: typeof PORTAL_DATA_VERSION;
  /**
   * The corpus directory the records were read from: repository-root-relative, POSIX
   * separators, no leading `./` and no trailing `/` (e.g. `docs/adr`), or `"."` when the
   * corpus is the repository root. The generator normalizes it, so `./docs/adr` and
   * `docs/adr` give the same file.
   */
  readonly dir: string;
  /**
   * The commit the bundle was built from: a 40- or 64-character lowercase hex object name,
   * or `null` when it is unknown (not a git repository, a repository with no commits, or a
   * host such as ADR-0055's server that was not given one) or when the bundle was built from
   * a checkout that differs from that commit: a staged or unstaged change to a tracked file,
   * or an untracked file inside the corpus directory. A non-null `commit` therefore means
   * every record and path table entry is as of that commit.
   */
  readonly commit: string | null;
  /** The UTC calendar date, `YYYY-MM-DD`, the queue's SLA states were computed against. */
  readonly asOf: string;
  /** Every record that loaded, in `@adrkit/sdk` `records` order (`adr lint --json` order). */
  readonly records: readonly PortalRecord[];
  /**
   * Everything the corpus could not resolve, in `adr lint --json` finding order. When any has
   * `severity: 'error'`, the page shows every error in a banner on every view (clause 9).
   */
  readonly issues: readonly PortalIssue[];
  /** The decision graph with edges of all three kinds. */
  readonly graph: PortalGraph;
  /** The review queue: `proposed` records only, in `adr queue --format json` order. */
  readonly queue: readonly PortalQueueEntry[];
  /** Governance by path (clause 6). */
  readonly pathTable: PortalPathTable;
}

/* ------------------------------------------------------------------ *
 * Records and issues
 * ------------------------------------------------------------------ */

/** One decision record. */
export interface PortalRecord {
  /** Zero-padded record id, e.g. `"0031"`. Ids are not guaranteed unique in an invalid corpus. */
  readonly id: string;
  /** Untrusted text. */
  readonly title: string;
  readonly status: PortalStatus;
  readonly standing: PortalStanding;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Repo-relative path of the record file. Untrusted text. */
  readonly path: string;
  /** Untrusted text, in record order. */
  readonly tags: readonly string[];
  /** Ids this record supersedes, in record order. */
  readonly supersedes: readonly string[];
  /** Id of the record that superseded this one, or `null`. */
  readonly supersededBy: string | null;
  /** The record's Markdown body, parsed into the restricted token tree below. */
  readonly body: readonly BodyBlock[];
}

/** Something the corpus could not resolve. */
export interface PortalIssue {
  /** Stable machine code, the `rule` of `adr lint --json` (e.g. `frontmatter-parse`). */
  readonly code: string;
  readonly severity: 'error' | 'warn' | 'info';
  /** Untrusted text: messages quote record content. */
  readonly message: string;
  /** Repo-relative path the issue is about, or `null` when it is not about one file. */
  readonly path: string | null;
}

/* ------------------------------------------------------------------ *
 * Graph
 * ------------------------------------------------------------------ */

/**
 * The decision graph. Node shape is the decision board's `LayoutNode` (`board-layout.mjs`),
 * so the generated copy of `layoutBoard` takes `{ nodes, edges }` as it stands.
 */
export interface PortalGraph {
  /**
   * Every loaded record, in `adr graph --format json` node order. A node's detail is the
   * record with the same id; when ids repeat (an invalid corpus), resolve to the **last**
   * record in `records` with that id, as the SDK's `get` does.
   */
  readonly nodes: readonly PortalGraphNode[];
  /** Edges of all three kinds, in `adr graph --format json` order (by `from`, `to`, then `kind`). */
  readonly edges: readonly PortalGraphEdge[];
}

export interface PortalGraphNode {
  readonly id: string;
  /** Untrusted text. */
  readonly title: string;
  readonly status: PortalStatus;
}

/**
 * A directed edge between two loaded records. `supersedes`: `from` is the successor, `to`
 * the record it replaced. `relatesTo` / `conflictsWith`: `from` declares, `to` is named.
 */
export interface PortalGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: PortalEdgeKind;
}

/* ------------------------------------------------------------------ *
 * Queue (clause 5: raw review facts, no verdict)
 * ------------------------------------------------------------------ */

/**
 * One `proposed` record in the review queue.
 *
 * **There is deliberately no readiness field**, and a renderer must not derive one: review
 * state does not decide whether a record can be ratified (an empty `deciders`, for instance,
 * is refused by ratification but invisible here), so "ready" would be a claim the portal
 * cannot back (ADR-0050, ADR-0054 clause 5). Show the counts.
 */
export interface PortalQueueEntry {
  readonly id: string;
  /** Untrusted text. */
  readonly title: string;
  /** Repo-relative path of the record file. */
  readonly path: string;
  /** Review routing tier, or `null` when the record declares none. */
  readonly tier: 'auto' | 'async' | 'arb' | null;
  readonly slaState: PortalSlaState;
  /** Review deadline, `YYYY-MM-DD`, or `null`. */
  readonly deadline: string | null;
  /** Distinct approving identities (ASCII casefold), not the raw list length. */
  readonly approvalCount: number;
  /** `review.quorum`, or `null` when the record sets none. */
  readonly quorum: number | null;
  readonly unresolvedObjectionCount: number;
  readonly resolvedObjectionCount: number;
  /** The record's `deciders`, in record order. Untrusted text. */
  readonly routingTargets: readonly string[];
  /** Advisory queue item findings attached to this record. */
  readonly itemFindingCount: number;
}

/* ------------------------------------------------------------------ *
 * Path table (clause 6, with clause 12's server case)
 * ------------------------------------------------------------------ */

/**
 * Governance by path: a table precomputed at build time from `governing(path)` for every
 * tracked file. The page looks a path up; it never matches globs itself.
 *
 * The table is as of one commit: it cannot answer for a branch, an uncommitted file, or a
 * path added since the build. What a renderer must say in each state — each wording is a
 * contract obligation, and a bare "ungoverned" is never one of them:
 *
 * - `available`: a hit shows the entry. A miss in an uncapped table says that no tracked
 *   file by that path at the bundle's `commit` (or in the index, when `commit` is `null` in
 *   a repository with no commits yet) is reached by any decision; a miss in a capped table
 *   says "not in this table". `available` does not imply a non-null `commit`.
 * - `unavailable`: resolution was withheld because the corpus has errors. Never show an empty
 *   or "ungoverned" result.
 * - `absent`: this host has no table (ADR-0055's server holds no source tree; or the bundle
 *   was built outside a git work tree). Never "ungoverned".
 */
export type PortalPathTable = PortalPathTableAvailable | PortalPathTableUnavailable | PortalPathTableAbsent;

export interface PortalPathTableAvailable {
  readonly state: 'available';
  /** True when at least one governed path was left out by a cap. */
  readonly capped: boolean;
  /** The caps this table was built under. */
  readonly caps: PortalPathTableCaps;
  /** How many tracked paths at least one decision reaches, before capping. */
  readonly governedPathCount: number;
  /** Governed paths, sorted by path in code-unit order; when capped, the leading prefix of that order. */
  readonly entries: readonly PortalPathEntry[];
}

export interface PortalPathTableUnavailable {
  readonly state: 'unavailable';
  /** Why the table is withheld. `corpus-errors`: the corpus has an error-severity issue. */
  readonly reason: 'corpus-errors';
}

export interface PortalPathTableAbsent {
  readonly state: 'absent';
}

export interface PortalPathTableCaps {
  /** The most entries the table keeps. */
  readonly count: number;
  /** The most UTF-8 bytes the serialized `entries` array may take. */
  readonly bytes: number;
}

/** One governed path and the decisions that reach it, grouped as `adr explain` groups them. */
export interface PortalPathEntry {
  /** Repo-relative path (git's `--full-name` form). Untrusted text. */
  readonly path: string;
  readonly governing: readonly PortalPathDecision[];
  readonly activeProposals: readonly PortalPathDecision[];
  readonly history: readonly PortalPathDecision[];
}

/** A decision reaching a path, by id, and how. */
export interface PortalPathDecision {
  readonly id: string;
  /**
   * How the decision reaches the path, deduplicated and sorted: `affects` (the record's own
   * matcher) and/or `marker` (an inbound `@adr` line in the file).
   */
  readonly evidence: readonly ('affects' | 'marker')[];
}

/* ------------------------------------------------------------------ *
 * Body token tree (clause 7)
 * ------------------------------------------------------------------ *
 * The output of the in-house Markdown subset parser (`markdown.ts`). The tree is closed: a
 * renderer handles exactly these `type`s and nothing else. Raw HTML and every unsupported
 * construct arrive as `text`, so rendering each `text` with `textContent` is all the
 * sanitizing a renderer needs. Every string is untrusted.
 */

/** A block-level token. */
export type BodyBlock =
  | BodyHeading
  | BodyParagraph
  | BodyList
  | BodyCodeBlock
  | BodyTable
  | BodyBlockquote;

/** An ATX heading (`#` to `######`). */
export interface BodyHeading {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * A GitHub-style anchor slug, unique within the record (`-1`, `-2`, … on repeats). A
   * `fragment` link names one of these. Restricted to `[a-z0-9_-]` plus non-ASCII letters
   * and digits; may be empty when the heading has no such characters.
   */
  readonly slug: string;
  readonly children: readonly BodyInline[];
}

export interface BodyParagraph {
  readonly type: 'paragraph';
  readonly children: readonly BodyInline[];
}

/** A bullet (`-`, `+`, `*`) or ordered (`1.`, `1)`) list. */
export interface BodyList {
  readonly type: 'list';
  readonly ordered: boolean;
  /** The first item's number for an ordered list, else `null`. */
  readonly start: number | null;
  /** Each item is its own block sequence (paragraphs, nested lists, code, …). */
  readonly items: readonly (readonly BodyBlock[])[];
}

/** A fenced code block (``` or ~~~). Unterminated fences run to the end of their container. */
export interface BodyCodeBlock {
  readonly type: 'code';
  /**
   * The info string's first word when it matches `^[A-Za-z0-9_+.#-]{1,32}$`, else `null`.
   * Safe as a label; still render it as text.
   */
  readonly lang: string | null;
  /** The code, verbatim, lines joined with `\n`, with no trailing newline. */
  readonly text: string;
}

/** A GFM table. Every row has exactly `align.length` cells (short rows padded, long rows cut). */
export interface BodyTable {
  readonly type: 'table';
  readonly align: readonly ('left' | 'center' | 'right' | null)[];
  readonly header: readonly (readonly BodyInline[])[];
  readonly rows: readonly (readonly (readonly BodyInline[])[])[];
}

/** A `>` blockquote. An addition to clause 7's list: ADR records routinely open with one. */
export interface BodyBlockquote {
  readonly type: 'blockquote';
  readonly children: readonly BodyBlock[];
}

/** An inline token. */
export type BodyInline = BodyText | BodyEmphasis | BodyStrong | BodyInlineCode | BodyLink;

/** Literal text. Soft line breaks inside a paragraph are kept as `\n`. */
export interface BodyText {
  readonly type: 'text';
  readonly text: string;
}

export interface BodyEmphasis {
  readonly type: 'emphasis';
  readonly children: readonly BodyInline[];
}

export interface BodyStrong {
  readonly type: 'strong';
  readonly children: readonly BodyInline[];
}

export interface BodyInlineCode {
  readonly type: 'inlineCode';
  readonly text: string;
}

/**
 * A link that survived the allowlist. Anything else in link syntax arrived as `text`. Link
 * children never contain another link.
 */
export type BodyLink = BodyExternalLink | BodyRecordLink | BodyFragmentLink;

/** An absolute `http:` or `https:` link. `href` is WHATWG-normalized (`new URL(...).href`). */
export interface BodyExternalLink {
  readonly type: 'link';
  readonly kind: 'external';
  readonly href: string;
  readonly children: readonly BodyInline[];
}

/**
 * A relative link that resolved to another record's file, rewritten to that record's hash
 * route. A `#fragment` on the original target is dropped: it cannot ride a hash route.
 */
export interface BodyRecordLink {
  readonly type: 'link';
  readonly kind: 'record';
  readonly id: string;
  /** Always `#/adr/<id>` (clause 8). */
  readonly href: string;
  readonly children: readonly BodyInline[];
}

/**
 * A same-document `#fragment` link. Under hash routing an `href="#x"` would replace the
 * route, so there is no `href`: a renderer scrolls to the heading whose `slug` equals
 * `fragment` within the same record, or renders the children as text when none does.
 */
export interface BodyFragmentLink {
  readonly type: 'link';
  readonly kind: 'fragment';
  /** The fragment without `#`, percent-decoded when it decodes. Untrusted text. */
  readonly fragment: string;
  readonly children: readonly BodyInline[];
}
