/**
 * `@adrkit/sdk` — the proposed consumer contract for adrkit's decision corpus.
 *
 * **This module is types only. Nothing here is implemented.** It exists to answer
 * [ADR-0031](../../../docs/adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
 * action item 3 — *"enumerate the SDK's first surface from what a real consumer needs, and
 * record the count"* — with a number that can be **measured from real TypeScript** rather than
 * asserted in prose. That distinction is not pedantry: ADR-0031's own asserted count of the
 * existing consumer's core imports was wrong by 11 (it says 3; the measured figure is 14), and
 * an argument for a narrower surface is exactly the kind of argument that should not rest on an
 * unverified count.
 *
 * ADR-0031 is `proposed`, agent-drafted, and **unratified**. If it is rejected, this directory
 * is deleted and nothing else in the repository changes.
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
 * and the ARB queue additionally needs a 25-line `--as-of` resolver that lives in
 * `packages/cli/src/queue.ts` and **is not exported from core at all**. A consumer that imports
 * core does not receive these capabilities; it receives the parts, plus the obligation to
 * assemble them correctly and to keep assembling them correctly as core changes. The mapping
 * layer is the product. ADR-0031 clause 4 says as much, and this file is what that claim looks
 * like when it is written down.
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
 * Note what this file therefore does **not** contain: an `import` from `@adrkit/core`. The edge
 * is one-way and would exist only in an implementation; the *contract* has no edge at all.
 *
 * @see `docs/sdk-surface.md` — the enumeration, the counts, and the wrongness-signal verdict.
 */

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
export declare function openDecisions(options?: OpenDecisionsOptions): Promise<DecisionSet>;

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
   */
  get(id: string): DecisionRecord | undefined;

  /** **Entry point 5 — the ARB queue and its SLA state.** */
  queue(options?: QueueOptions): QueueView;

  /** **Entry point 6 — the supersession graph.** */
  graph(): DecisionGraph;

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
 * The body is deliberately absent: rendering ADR prose is the document layer (ADR-0029
 * clause 9), which extends `@backstage-community/plugin-adr` and reads the markdown itself.
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
  /** Stable machine-readable code, e.g. `corpus.file-skipped`. */
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
   * question, and this contract answers it once here instead of at every call site. The CLI
   * already resolves the equivalent flag this way; that resolver lives in the CLI and is not
   * exported from core, so a library consumer building the queue today either reimplements it
   * or gets a different answer than CI does for the same corpus on the same day.
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

/** One decision awaiting review. */
export interface QueueEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  /** Review routing tier, when the record declares one. */
  readonly tier: 'auto' | 'async' | 'arb' | null;
  readonly slaState: SlaState;
  /** The date {@link slaState} was computed against, `YYYY-MM-DD`; null when no SLA applies. */
  readonly deadline: string | null;
}

/**
 * The supersession graph.
 *
 * Edges are separate from {@link DecisionRecord.supersedes} rather than derived from it by the
 * consumer, because the two disagree in exactly the case that matters: a record may name a
 * supersession target that does not exist. Reading the frontmatter alone silently drops that;
 * a graph built by the SDK reports it in {@link DecisionSet.issues}.
 */
export interface DecisionGraph {
  readonly nodes: readonly DecisionRecord[];
  readonly edges: readonly SupersessionEdge[];
}

/** A directed supersession edge: `from` supersedes `to`. */
export interface SupersessionEdge {
  readonly from: string;
  readonly to: string;
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
  /** Problems encountered while resolving — an unresolvable marker reference, for instance. */
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
