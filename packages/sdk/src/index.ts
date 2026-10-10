/**
 * `@adrkit/sdk` — the accepted consumer contract design for adrkit's decision corpus.
 *
 * **Implemented, unpublished.** This module declares the surface
 * [ADR-0031](../../../docs/adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
 * action item 3 enumerated, and `openDecisions` implements it over `@adrkit/core`'s pure kernels
 * through the mapping layer in `./decision-set.ts`. The declared count is unchanged and still
 * measurable from this file: 7 callable entry points. The enumeration exists because ADR-0031's
 * own asserted count of the existing consumer's core imports was wrong by 11 (it says 3; the
 * measured figure is 14), and an argument for a narrower surface should not rest on an
 * unverified count.
 *
 * ADR-0031 was ratified by `@mbeacom` on 2026-08-24. It authorizes this surface's design and
 * construction, not publication: the package stays at version 0.0.0, with no exports map and no
 * entry in `RELEASE_PACKAGES`, until a later record authorizes the release.
 *
 * ## What the surface is derived from
 *
 * ADR-0029 clause 1 — the Tier 1 capabilities, which are the ones authorized without the
 * entity-ownership mapping:
 *
 * > Browsing the corpus, the ARB queue and its SLA state, the supersession graph, record
 * > status, the document layer of clause 9, and path-governance for a path that is
 * > **explicitly supplied**.
 *
 * Every entry point below traces to one of those. Nothing below traces to "core happens to
 * export it," which is the failure mode the action item exists to avoid.
 *
 * ## Why a facade is worth anything at all
 *
 * The weak argument is symbol count — that a consumer importing `@adrkit/core` faces 166+
 * exported symbols. The strong argument is **assembly**. Answering one Tier 1 question today
 * takes eight core calls in a specific order:
 *
 * ```text
 * adr explain <path>:
 *   lintCorpus -> readSourceMarkers -> resolveAffects -> resolveSourceMarkers
 *     -> mergeSourceDeclarations -> toGoverningDecisions -> bucketDecisions -> sortFindings
 * ```
 *
 * and the ARB queue additionally needs the `--as-of` resolver that decides which UTC calendar
 * date SLA state is computed against. That resolver was unexported when this surface was
 * enumerated; it is now `resolveAsOf` in `@adrkit/core` (ADR-0031 action item 7), which closes
 * that half of the gap. The eight-call `explain` chain above is unchanged. A consumer that
 * imports core still does not receive these capabilities; it receives the parts, plus the
 * obligation to assemble them correctly and to keep assembling them correctly as core changes.
 * The mapping layer is the product. ADR-0031 clause 4 says as much, and this file is what that
 * claim looks like when it is written down.
 *
 * ## The boundary
 *
 * **These types are declared here, not re-exported from `@adrkit/core`** (ADR-0031 clause 4).
 * The duplication is deliberate and is the entire point: a facade that re-exports is an alias,
 * and the first core rename would travel through it to every consumer. This follows
 * `packages/catalog-envelope`, whose own `//boundary` note records the identical choice for the
 * identical reason — the independence is what makes the boundary a boundary rather than a
 * tautology.
 *
 * Note what this file therefore does **not** contain: a type imported from `@adrkit/core`, or
 * any `export … from`. Its only core import is the `lintCorpus` value `openDecisions` calls; the
 * declared types have no edge to core at all. The one-way `sdk -> core` edge lives in the
 * implementation, `./decision-set.ts`, which maps every core result into a shape declared here.
 *
 * @see `docs/sdk-surface.md` — the enumeration, the counts, and the wrongness-signal verdict.
 */

import { resolve as resolvePath } from 'node:path';
import { lintCorpus } from '@adrkit/core';
import { corpusDirectoryError } from './corpus-directory.ts';
import { createDecisionSet } from './decision-set.ts';

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ *
 * These three unions are structurally identical to unions `@adrkit/core` also exports, and
 * that is deliberate rather than an oversight in the divergence discipline above.
 *
 * They are not core's vocabulary. They are `schema/adr.schema.json`'s — the statuses are the
 * schema's `status` enum, and the SLA states are the queue contract's. ADR-0029 clause 6 names
 * that schema as a contract in its own right, one which ADR-0031 does not narrow. So these
 * values are already committed to consumers by a different record, and re-deriving them under
 * new names here would not buy insulation; it would only add a translation table that can drift
 * from the schema it claims to describe.
 *
 * The rule this expresses: **diverge from core's implementation shapes, converge on the
 * schema's published vocabulary.** Where core and the schema agree, matching core is a
 * consequence, not a re-export.
 */

/**
 * A decision's lifecycle status — the `status` enum of `schema/adr.schema.json`.
 *
 * `rejected` is load-bearing rather than vestigial: the decision *not* to do something is the
 * one most often re-litigated, so a consumer browsing the corpus must be able to surface it.
 */
export type DecisionStatus = 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'deprecated';

/**
 * Which of the three governance groups a record falls in — the distinction a consumer needs
 * before it can render a record, because {@link DecisionStatus} alone does not say whether a
 * decision *binds*.
 *
 * - `governing` — binds now.
 * - `activeProposals` — under consideration; does not bind yet.
 * - `history` — superseded, rejected, or deprecated; binds nothing, and deleting it would
 *   destroy the "we tried that in 2023" record that is the corpus's main long-run value.
 */
export type DecisionStanding = 'governing' | 'activeProposals' | 'history';

/**
 * Where a queued decision stands against its review SLA, in ascending urgency.
 *
 * `not-queued` and `missing-sla` are distinct on purpose: the first is a record that never
 * entered review, the second is one that entered review without a deadline. Collapsing them
 * would hide the second, which is the one that needs a human.
 */
export type SlaState =
  | 'overdue'
  | 'escalated'
  | 'due'
  | 'within-sla'
  | 'missing-sla'
  | 'not-queued'
  | 'decided';

/* ------------------------------------------------------------------ *
 * Entry point 1 — opening the corpus
 * ------------------------------------------------------------------ */

/** Options for {@link openDecisions}. */
export interface OpenDecisionsOptions {
  /** Corpus directory, repo-relative. Defaults to `docs/adr`. */
  dir?: string;
  /** Directory the corpus directory is resolved against. Defaults to the process cwd. */
  cwd?: string;
}

/**
 * Read and validate a decision corpus once, returning a handle onto it.
 *
 * **The only I/O door in this surface.** Every other entry point is a projection of the
 * already-loaded corpus, which is why they are methods on {@link DecisionSet} rather than
 * free functions: the known first consumer is a Backstage backend serving many requests
 * against one corpus, and a surface of free functions would re-read and re-validate on every
 * one of them.
 *
 * Absorbs `lintCorpus`, corpus-directory resolution, and the unreachable-directory case that
 * `adr queue` and `adr explain` each handle separately today.
 *
 * **Does not throw for a corpus that fails to parse.** A consumer rendering a governance UI
 * needs to show *that* the corpus is broken alongside whatever it could still read, not to
 * catch an exception and render nothing. Problems arrive as {@link DecisionSet.issues}.
 * Reserved for the case where the corpus directory cannot be read at all.
 */
export async function openDecisions(options: OpenDecisionsOptions = {}): Promise<DecisionSet> {
  const cwd = resolvePath(options.cwd ?? process.cwd());
  const dir = options.dir ?? 'docs/adr';
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir, cwd });
  } catch (error) {
    throw corpusDirectoryError(error, dir, cwd) ?? error;
  }
  return createDecisionSet(corpus, cwd);
}

/* ------------------------------------------------------------------ *
 * Entry points 2-7 — the handle
 * ------------------------------------------------------------------ */

/**
 * A loaded corpus, and the five projections of it that Tier 1 needs.
 *
 * Methods here are counted as entry points in `docs/sdk-surface.md`, not hidden behind the
 * handle. The handle is a caching and cohesion decision, not a counting one.
 */
export interface DecisionSet {
  /**
   * **Entry point 2 — browsing the corpus.** Every record that loaded, in a stable order.
   *
   * Records that did *not* load are absent from here and present in {@link issues}; a
   * consumer that renders this list without also surfacing those is showing a corpus that
   * looks smaller and healthier than it is.
   */
  readonly records: readonly DecisionRecord[];

  /**
   * **Entry point 3 — corpus health.** Everything discovery or validation could not resolve.
   *
   * Named `issues` rather than `findings` because `findings` in this project already means
   * the lint/check finding type, and a consumer type that borrows the name would be assumed
   * to be that type.
   */
  readonly issues: readonly CorpusIssue[];

  /**
   * **Entry point 4 — record status for one record.** Look up a single decision by id.
   *
   * Present because a consumer's deep-link route (`/adr/0031`) resolves one record and should
   * not have to linear-scan {@link records} or reimplement id normalization to do it. Accepts
   * the zero-padded form the corpus uses.
   *
   * When a corpus (invalidly) gives two records one id, this returns the **last** in
   * {@link records} order — the record `governing` and `adr explain` resolve that id to — and
   * the duplicate is reported in {@link issues} as `unique-id`. {@link records} and
   * {@link DecisionGraph.nodes} still list both.
   */
  get(id: string): DecisionRecord | undefined;

  /** **Entry point 5 — the ARB queue and its SLA state.** */
  queue(options?: QueueOptions): QueueView;

  /**
   * **Entry point 6 — the decision graph.** Supersession edges by default; relationship edges
   * on request through {@link GraphOptions.kinds}.
   */
  graph(options?: GraphOptions): DecisionGraph;

  /**
   * **Entry point 7 — path governance for an explicitly supplied path.**
   *
   * Absorbs the eight-call `adr explain` assembly, including the inbound `@adr` marker scan.
   * Asynchronous because that scan reads the file at `path`; the corpus itself is already
   * loaded.
   *
   * **The Tier 1/Tier 2 line runs through this method's argument, not its body.** ADR-0029
   * clause 1 admits this capability only for a path that is *explicitly supplied* — typed by
   * a person, or set in configuration a person wrote. A path a caller derived from a catalog
   * entity field is Tier 2 and is not authorized. This surface cannot enforce that: a string
   * does not carry its provenance. The obligation sits with the caller, and it is stated here
   * because an unstated obligation is one that gets discharged by accident.
   */
  governing(path: string, options?: GoverningOptions): Promise<PathGovernance>;
}

/* ------------------------------------------------------------------ *
 * Result shapes
 * ------------------------------------------------------------------ */

/**
 * One decision record, flattened.
 *
 * Diverges from core's `Adr` deliberately and in three ways, each of which is the kind of
 * change that would otherwise reach consumers as a break:
 *
 * 1. **Flat.** Core nests the metadata under `frontmatter`; a consumer reads `record.status`,
 *    not `record.frontmatter.status`.
 * 2. **Narrowed.** The schema carries ~20 frontmatter fields. Tier 1 needs these. Adding one
 *    later is additive; the reverse is not, which is the whole argument for starting small.
 * 3. **`standing` is precomputed.** Core requires the caller to call `decisionBucketFor`.
 *    Making it a field means "does this bind?" cannot be got wrong by forgetting a call.
 *
 * {@link body} carries the record's prose. It was excluded from the first enumeration, on the
 * grounds that the document layer (ADR-0029 clause 9) reads the markdown itself; a static
 * portal and a REST API built on this surface have no other way to reach it without a second
 * read of every file, so it was added as part of the implementation scope.
 */
export interface DecisionRecord {
  /** Zero-padded record id, e.g. `"0031"`. */
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  /** Precomputed from {@link status}; see the note above on why this is a field. */
  readonly standing: DecisionStanding;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Repo-relative path to the record, e.g. `docs/adr/0031-....md`. */
  readonly path: string;
  readonly tags: readonly string[];
  /** Ids this record supersedes. The outbound half of the supersession edge. */
  readonly supersedes: readonly string[];
  /** Id of the record that superseded this one, when one did. */
  readonly supersededBy?: string;
  /**
   * The raw Markdown after the closing frontmatter fence, verbatim — the same string core's
   * parser kept when `openDecisions` read the file, so it costs no second read.
   *
   * **Unrendered and unsanitized.** It is repository text: it may contain raw HTML, scripts,
   * or link schemes a renderer must not trust. Rendering and sanitizing are the consumer's
   * job, and a consumer that inserts it into a page as HTML without sanitizing it has built
   * an injection path from any pull request that can edit a record. Line endings are kept as
   * the file has them.
   */
  readonly body: string;
}

/**
 * Something the corpus could not resolve.
 *
 * `severity` is on the type because a `warn` and an `error` mean genuinely different things
 * here and a consumer must be able to tell them apart: a record that could not be *parsed* is
 * an error, while a record discovery could not *see* — misnamed, or nested below the corpus
 * root — is a warning, because that is a governance gap rather than a broken corpus. Flattening
 * the two would let a `proposed` record vanish from the queue with nothing shown to anyone.
 */
export interface CorpusIssue {
  /**
   * Stable machine-readable code. Its vocabulary follows the CLI JSON that answers the same
   * question, so the SDK and the CLI never spell one problem two ways:
   *
   * - {@link DecisionSet.issues} and {@link PathGovernance.issues} carry the `rule` of
   *   `adr lint --json` / `adr explain --json` findings verbatim, e.g. `corpus-file-skipped`,
   *   `frontmatter-parse`, `dangling-supersedes`, `stale-marker`;
   * - {@link QueueView.issues} carries the `code` of `adr queue --format json`'s
   *   `corpusFindings`, e.g. `corpus.file-skipped`, `corpus.parse-error`;
   * - {@link PathGovernance.issues} adds `marker-scan-absent` (`info`), `marker-scan-unreadable`
   *   and `marker-scan-out-of-tree` (`warn`) when the marker scan could not look at the file —
   *   what `adr explain --json` reports under its separate `markers.state` key.
   */
  readonly code: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
  /** Repo-relative path the issue is about, when it is about one file. */
  readonly path?: string;
}

/** Options for {@link DecisionSet.queue}. */
export interface QueueOptions {
  /**
   * UTC calendar date, `YYYY-MM-DD`, that SLA state is computed against. Defaults to today.
   *
   * A bare calendar date only — no datetime, and no `Date`. Both alternatives carry a timezone
   * question, and this contract answers it once here instead of at every call site. A caller
   * holding a datetime resolves it first with `resolveAsOf` from `@adrkit/core`, which is the
   * same rule the CLI applies to `--as-of` — so a consumer and CI agree on the calendar date for
   * the same input. (That resolver was unexported when this surface was enumerated; ADR-0031
   * action item 7 closed it.) Anything else — a datetime, or an impossible date such as
   * `2026-02-30` — makes {@link DecisionSet.queue} throw a `RangeError`: it is a caller error, not
   * a corpus issue.
   */
  readonly asOf?: string;
}

/**
 * The ARB queue at a point in time.
 *
 * `asOf` is echoed back because an SLA state is meaningless without the date it was computed
 * against, and a consumer that caches this view needs to know what it cached.
 */
export interface QueueView {
  readonly asOf: string;
  readonly entries: readonly QueueEntry[];
  /** Corpus issues that prevented records from reaching {@link entries}. */
  readonly issues: readonly CorpusIssue[];
}

/** One `proposed` decision in the review queue, in `adr queue --format json` order. */
export interface QueueEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  /** Review routing tier, when the record declares one. */
  readonly tier: 'auto' | 'async' | 'arb' | null;
  readonly slaState: SlaState;
  /**
   * The review deadline, `YYYY-MM-DD` — `reviewBy` when the record sets one, otherwise
   * `review.queuedAt` plus `review.slaDays` — or null when neither gives one. The date
   * {@link slaState} was computed *against* is {@link QueueView.asOf}.
   */
  readonly deadline: string | null;

  /*
   * Review state. Each field below is the QueueReport v1 item field of the same name (or, for
   * `itemFindingCount`, the length of `itemFindings`), so a consumer reading this and one
   * reading `adr queue --format json` see the same numbers under the same names.
   *
   * There is deliberately no readiness field. Review state does not decide whether a record
   * can be ratified — `adr accept` also refuses, for instance, a record with no `deciders` —
   * so a "ready" flag derived from these counts would claim something this surface cannot
   * back (ADR-0050). Show the counts; do not combine them into a verdict.
   */

  /**
   * Approvals recorded, counted as **distinct identities** under ASCII casefold — `@bob` and
   * `@Bob` are one approval — exactly as the queue kernel and `adr accept`'s quorum check
   * count them (ADR-0051). Not the length of `review.approvals`.
   */
  readonly approvalCount: number;
  /** `review.quorum`: approvals the record asks for, or null when it does not set one. */
  readonly quorum: number | null;
  /** Objections in `review.objections` not marked `resolved: true`. */
  readonly unresolvedObjectionCount: number;
  /** Objections in `review.objections` marked `resolved: true`. */
  readonly resolvedObjectionCount: number;
  /**
   * Who the record is routed to for review: its `deciders`, in record order. Empty when the
   * record names none.
   */
  readonly routingTargets: readonly string[];
  /**
   * How many queue item findings (`item.tier-absent`, `item.deciders-empty`,
   * `item.review-by-before-queued`, …) the queue kernel attached to this entry. These are
   * advisory `info`/`warn` notes about the review metadata, not corpus issues.
   */
  readonly itemFindingCount: number;
}

/** Options for {@link DecisionSet.graph}. */
export interface GraphOptions {
  /**
   * Which edge kinds to include. Defaults to `['supersedes']`, which is what `graph()` has
   * always returned: entry point 6 was enumerated as *the supersession graph*, so relationship
   * edges are opt-in and a caller that passes nothing gets the same edges it always did.
   *
   * Pass all three for the whole graph, as unfiltered `adr graph --format json` prints it. An
   * empty array or an unknown kind throws a `RangeError` — an empty list could mean "default",
   * "all", or "none", and this contract does not guess which.
   *
   * The kinds filter edges only. {@link DecisionGraph.nodes} is every loaded record whatever
   * is passed here, unlike `adr graph --kind`, which also drops records no kept edge touches.
   */
  readonly kinds?: readonly DecisionEdgeKind[];
}

/**
 * The three relationships a record can declare to another, named after the frontmatter field
 * that declares each: `supersedes` (with its inverse `supersededBy`), `relatesTo`, and
 * `conflictsWith` — `adr graph --kind`'s vocabulary.
 */
export type DecisionEdgeKind = 'supersedes' | 'relatesTo' | 'conflictsWith';

/**
 * The decision graph.
 *
 * Edges are separate from {@link DecisionRecord.supersedes} rather than derived from it by the
 * consumer, because the two disagree in exactly the case that matters: a record may name a
 * supersession target that does not exist. Reading the frontmatter alone silently drops that;
 * a graph built by the SDK reports it in {@link DecisionSet.issues}.
 */
export interface DecisionGraph {
  /**
   * Every loaded record, including those no supersession edge touches, in the order
   * `adr graph --format json` prints its nodes.
   */
  readonly nodes: readonly DecisionRecord[];
  /**
   * The edges of the kinds asked for, in `adr graph --format json` order (by `from`, then
   * `to`, then `kind`). An edge whose target is not a loaded record is dropped and reported
   * in {@link DecisionSet.issues}.
   */
  readonly edges: readonly DecisionEdge[];
}

/**
 * A directed edge between two loaded records, in `adr graph`'s direction convention:
 *
 * - `supersedes` — `from` is the successor, `to` the record it replaced. Declared from either
 *   end (`supersedes` on the successor or `supersededBy` on the replaced record), reported once.
 * - `relatesTo` / `conflictsWith` — `from` is the record that declares the relationship, `to`
 *   the record it names. Not symmetric: a declaration on one side is one edge.
 */
export interface DecisionEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: DecisionEdgeKind;
}

/** Options for {@link DecisionSet.governing}. */
export interface GoverningOptions {
  /**
   * Whether to read the inbound `@adr` marker in the file at the supplied path. Defaults to
   * `true`.
   *
   * Opt-out exists because the marker scan is the only filesystem read in this method, and a
   * consumer resolving governance for a path that does not exist on its disk — a path typed
   * into a search box, say — should be able to skip it rather than absorb a failed read.
   */
  readonly readMarkers?: boolean;
}

/**
 * Which decisions govern one path, grouped by whether they bind.
 *
 * The grouping is the surface rather than a flat list because the question a consumer is really
 * asking is "may I do this," and a flat list of five matched records — two accepted, one
 * proposed, two superseded — answers that wrongly by default. `governing` is the answer;
 * the other two are context.
 */
export interface PathGovernance {
  /** The path this was resolved for, echoed back. */
  readonly path: string;
  /** Decisions that bind this path now. */
  readonly governing: readonly GoverningDecision[];
  /** Proposals that would bind it if accepted. */
  readonly activeProposals: readonly GoverningDecision[];
  /** Superseded, rejected, and deprecated decisions that once governed it. */
  readonly history: readonly GoverningDecision[];
  /**
   * Problems encountered while resolving — an unresolvable marker reference, for instance.
   *
   * When the corpus has any `error`-severity issue, the three groups are empty and this holds
   * the corpus's own issues instead, exactly as `adr explain` answers: a record that failed to
   * load may be the one that governs this path, so "nothing binds" would be a confident false
   * negative.
   */
  readonly issues: readonly CorpusIssue[];
}

/**
 * A decision that governs a path, and the evidence for why.
 *
 * `matchedBy` is not decoration. Governance here is claimed from two independent directions —
 * the record's own `affects:` matchers reaching out to the path, and an `@adr` marker in the
 * file reaching back — and a consumer showing a human "ADR-0031 governs this file" should be
 * able to say which, because the two fail in different ways and are fixed in different files.
 */
export interface GoverningDecision {
  readonly id: string;
  readonly title: string;
  readonly status: DecisionStatus;
  readonly standing: DecisionStanding;
  readonly matchedBy: readonly GovernanceEvidence[];
}

/** How a decision came to govern a path. */
export type GovernanceEvidence =
  | {
      /** The record's `affects:` matcher fired against the path. */
      readonly kind: 'affects';
      /** Matcher type, e.g. `path`. */
      readonly type: string;
      /** The matcher's pattern, verbatim, so a human can see what actually matched. */
      readonly pattern: string;
    }
  | {
      /** The file declared the record with an inbound `@adr` marker. */
      readonly kind: 'marker';
      /** 1-based line the marker was found on. */
      readonly line: number;
    };
