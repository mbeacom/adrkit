# Data Model: MCP Server (Read-Only Retrieval) — Phase 5

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Research**: [research.md](./research.md) | **Contracts**:
[contracts/core-projection.md](./contracts/core-projection.md),
[contracts/pagination-and-cursors.md](./contracts/pagination-and-cursors.md),
[contracts/tools.md](./contracts/tools.md) | **Date**: 2026-07-20

These are **conceptual, TypeScript-like shapes** to fix vocabulary and boundaries for
the plan — not implementation code, and not authoritative over whatever the committed
Zod schemas ultimately are. Where a shape already exists in `@adrkit/core`, it is
**reused by reference**, never redefined. Where research.md §R3 proposes a small,
additive `@adrkit/core` export, it is marked *(new — additive core export)*. Everything
else lives only in `@adrkit/mcp` and is marked *(new — `@adrkit/mcp`, runtime only)*;
none of it is persisted, cached, or added to the committed schema (`schema/
adr.schema.json` is untouched by this feature — Principle V).

---

## 1. Reused core types (unchanged)

```ts
// packages/core/src/schema/adr.schema.ts — reused verbatim, zero changes.
type Adr = { frontmatter: AdrFrontmatter; body: string; path: string; log?: string };
type AdrFrontmatter; // the full typed frontmatter: id, title, status, date, deciders[],
                      // tags[], scope, domain?, reversibility, blastRadius,
                      // supersedes[], supersededBy?, relatesTo[], conflictsWith[],
                      // affects[], assertions[], provenance?, review?, evaluation?,
                      // externalRefs[], complianceControls[], reviewBy?
type Status;          // 'draft'|'proposed'|'accepted'|'rejected'|'superseded'|'deprecated'
type Scope;            // 'component'|'domain'|'org'
type AffectsType;      // 'path'|'entity'|'package'|'resource'|'api'|'data'
type AffectsMatcher;   // { type: AffectsType; pattern: string; repo?: string; negate?: boolean }
type AdrRef;           // Zod validator for `0042` or `payments:0012` (regex only — no parser)

// packages/core/src/validate/findings.ts — reused verbatim.
type FindingSeverity = 'error' | 'warn' | 'info';
type Finding = { rule: string; severity: FindingSeverity; message: string;
                  path?: string; id?: string; field?: string; pattern?: string };

// packages/core/src/validate/index.ts — reused verbatim; the ONLY loader @adrkit/mcp calls.
interface LintCorpusResult { checked: number; findings: Finding[]; records: Adr[] }
function lintCorpus(options: { dir?: string; paths?: string[]; cwd?: string }): Promise<LintCorpusResult>;

// packages/core/src/affects/index.ts — reused verbatim; called once per record (research §R4).
interface ResolveAffectsInput { records: readonly Adr[]; changedFiles: readonly string[];
                                 snapshots?: ResolutionSnapshots; log?: string }
interface FiredMatcher { type: string; pattern: string }
interface AffectsMatch { recordId: string; firedMatchers: FiredMatcher[] }
interface ResolveAffectsResult { matches: AffectsMatch[]; findings: Finding[] }
function resolveAffects(input: ResolveAffectsInput): ResolveAffectsResult;
```

`@adrkit/mcp` never imports from `packages/core/src/load/corpus.ts`'s `loadCorpus`/
`Corpus`/`byId` — those remain exported, unmodified, and unused by this feature
(research §R3).

---

## 2. New additive core export, plus one migrated caller (research §R3)

```ts
// packages/core/src/schema/ref.ts — NEW FILE. One export.

interface ParsedAdrRef {
  readonly id: string;
  readonly log?: string;   // absent when the ref carries no "log:" prefix
}

/** Splits on the first ':'. A leading ':' or no ':' at all is unqualified — returns
 *  { id: ref } with `id` the untouched original string (never split in that case).
 *  Identical observable behavior and object shape to the private `parseRef` formerly
 *  duplicated in packages/evaluator/src/rules/no-orphan-refs.ts, promoted to one shared
 *  location. @adrkit/mcp uses this to detect WHETHER a caller-supplied ref is
 *  log-qualified — never to build or consult a log-aware index, since this phase has
 *  none (§3). There is no inverse `formatAdrRef`: no planned call site ever
 *  re-serializes a `(log, id)` pair — every ref this design echoes back to a caller
 *  (`requestedRef`, a `targetRef`) is the caller's or the frontmatter's own original
 *  string, reused verbatim, never reconstructed from parsed parts (contracts/
 *  core-projection.md §1). */
function parseAdrRef(ref: string): ParsedAdrRef;
```

Re-exported from `packages/core/src/index.ts` via one additional `export * from
'./schema/ref.ts';` line. **`packages/evaluator/src/rules/no-orphan-refs.ts` is migrated,
behavior- and object-shape-preservingly, to import `parseAdrRef` in place of its own
private copy** (contracts/core-projection.md §1) — this is the entire change outside
`@adrkit/mcp`: one new core file, one new core export line, one migrated evaluator
import. No behavior changes anywhere, and no dependency changes.

---

## 3. `@adrkit/mcp`'s corpus projection *(new — runtime only, `packages/mcp/src/corpus/`)*

This is the layer that turns core's exported discovery primitive plus one fresh
`lintCorpus()` result into everything the four tools need: the pre-read size guard, a
local index, and the corpus fingerprint/health summary. It is rebuilt from scratch on
**every** tool call (FR-010) — there is no cross-call cache of any kind, not even an
in-memory one, because "every call reloads the current configured corpus" is
load-bearing, not an optimization detail to relax later. Every field of
`CorpusProjection` below is `readonly`, and nothing in this design ever mutates one after
it is built (§3.5) — a fresh, independent `CorpusProjection` value is what "every call
reloads" produces, never a shared object two calls both hold a reference to.

```ts
/** The complete, per-call, in-memory projection every tool reads from. Built once per
 *  tool call by `loadCorpusProjection()`; never retained across calls, never mutated
 *  after it is returned (§3.5). */
interface CorpusProjection {
  /** Every within-limit, schema-valid record `lintCorpus()` returned for the
   *  within-limit paths this call fed it (§3.3) — never a record whose source exceeded
   *  the size guard, because that source was never handed to `lintCorpus` at all.
   *  Sorted canonically by `(id, sourcePath)` (§3.1). A duplicate-id or dangling-ref
   *  record is still schema-valid and therefore still present here — corpus invariants
   *  (§3.3) never remove a record from this array, only add a finding about it. */
  readonly records: readonly Adr[];

  /** LOCAL id → every record in `records` sharing that id, sorted `(id, sourcePath)`.
   *  Bucket length is exactly what FR-022's three-way outcome reads: absent/empty is
   *  "not found," length 1 is unambiguous, length >1 is `ambiguous-local-id` — the full
   *  bucket becomes the candidate list, never a single arbitrary representative (§3.2).
   *  There is no per-log or canonical-log-qualified key anywhere: this phase has no
   *  `log` dimension to index by (research §R3; spec.md Assumption A1). */
  readonly byId: ReadonlyMap<string, readonly Adr[]>;

  /** **Corpus** findings only: `lintCorpus()`'s own findings for the within-limit paths,
   *  PLUS one finding per pre-read guard exclusion (§3.3) — re-sorted by `@adrkit/mcp`'s
   *  own locale-independent code-unit comparator (research §R6), never left in
   *  `lintCorpus`'s own `localeCompare`-based order. This is deliberately **not** "the
   *  complete findings set for this call": it excludes any finding a specific tool
   *  handler derives on top of the projection (an inert `affects` matcher, an ambiguous
   *  or federated-unavailable `supersededBy` target) — those are computed per tool call,
   *  from this projection plus that call's own substantive inputs, and merged in by the
   *  handler itself, never added here (§3.5). */
  readonly corpusFindings: readonly Finding[];

  /** SHA-256 over the canonical-JSON wire projection (research §R6) — exactly `records`,
   *  `corpusFindings`, and `corpusHealth` (recordCount + excludedCount) below. Never a
   *  hash of any raw file's bytes, and never a hash of any tool-derived finding — a
   *  tool's per-call `responseFindings` (§3.5) is deliberately outside the hashed value,
   *  because it is a pure, deterministic function of this projection plus that call's own
   *  inputs, which the cursor's `qh` (contracts/pagination-and-cursors.md §4) already
   *  covers separately; see §3.5 for why the pair `(fingerprint, qh)` together, not the
   *  fingerprint alone, is what makes a derived-findings cursor safe. */
  readonly fingerprint: string;

  /** `records.length` — valid, in-limit, loaded. */
  readonly recordCount: number;

  /** `discoveredCandidateCount - records.length` — every discovered candidate path
   *  (`discoverAdrFiles`'s own filtered universe) that contributed zero records to
   *  `records`, because it was excluded by the pre-read stat/size guard (§3.3), because
   *  reading or parsing it failed, or because its frontmatter failed schema/contract
   *  validation. This is exact **only** over those three causes: a corpus-invariant
   *  finding (`unique-id`, a dangling `supersedes`/`relatesTo`/`conflictsWith` reference)
   *  never removes a record from `records` (see the `records` field above), so it is
   *  never counted here, and this subtraction does not need to enumerate which finding
   *  rule caused which exclusion among the three causes that do count. */
  readonly excludedCount: number;
}

/** The one entry point every tool handler calls, exactly once, at the start of its
 *  own execution. Pure with respect to its OWN inputs (cwd, dir, maxSourceBytes) in
 *  the sense of ADR-0009's "no hidden state" posture, but not pure end-to-end — it
 *  performs the filesystem read `discoverAdrFiles()`/`lintCorpus()` themselves perform,
 *  plus its own canonical-root re-check (§8) ahead of that; "every call reloads"
 *  requires exactly this, not a cached snapshot. Rejects (throws a typed,
 *  caught-by-the-caller error, carrying one of the `CorpusUnavailableOutcome` reasons —
 *  §5) when the canonical-root re-check or the ADR directory itself cannot be discovered
 *  — the tool-level `CorpusUnavailableOutcome` branch is built from that rejection,
 *  never fabricated as an empty-but-successful projection. */
function loadCorpusProjection(options: {
  readonly configuredCwd: string;      // immutable startup input; re-realpath'd and revalidated on THIS call (§8)
  readonly configuredDir: string;      // immutable startup input; re-realpath'd and revalidated on THIS call (§8)
  readonly expectedCanonicalCwd: string; // canonical root established by start(); a changed resolution invalidates the call
  readonly maxSourceBytes: number;     // fixed at 64 KiB by contracts/tools.md §8; a parameter here so the cap is never silently pushed into @adrkit/core (research §R3)
}): Promise<CorpusProjection>;
```

### 3.1 Local identity and ordering

A record's identity in this phase is its bare `id` alone (FR-021) — there is no `log`
dimension anywhere in this index, because `@adrkit/core` never populates `Adr.log` and
this server's own discovery is non-recursive over one directory (research §R3). Every
ordered channel — `records`, each `byId` bucket, `corpusFindings`, every tool's
`responseFindings` (§3.5), `matchedFields` arrays, and the canonical-JSON key sort
feeding the fingerprint — uses the **one** comparator `@adrkit/mcp` defines: a fixed,
locale-independent code-unit comparison (`a < b ? -1 : a > b ? 1 : 0`), never
`String.prototype.localeCompare` (contracts/tools.md §2; research §R6). The canonical
record order is `(id, sourcePath)` ascending, `sourcePath` acting as the always-unique
tiebreak within one `id` bucket.

### 3.2 The three-way unqualified-id outcome (FR-022)

Given a bare id, `byId.get(id)`:

| `byId.get(id)` | Outcome |
|---|---|
| `undefined` (or an empty bucket — never actually constructed) | not found |
| exactly one entry | that record, unambiguously |
| more than one entry | `ambiguous-local-id` — the full bucket, sorted `(id, sourcePath)`, becomes the candidate list (contracts/tools.md §2), paginated like any other growing channel; this always coincides with a pre-existing `unique-id` error finding already present in `corpusFindings` (§3), because that is the only way this bucket can exceed length 1 |

A **log-qualified** ref (`parseAdrRef` returns a defined `log`) is never looked up
against `byId` at all — there is no canonical-log-qualified map to consult. It is instead
a distinct, non-error `federated-log-unavailable` outcome naming the requested log and
id (FR-021, FR-022, US1 AC5) — the qualifier is recognized only far enough to answer that
outcome, never stripped, and never satisfied by a same-id entry from `byId`.

### 3.3 The pre-read size guard (research §R3; not a core change)

Ordering matters: this guard runs **before** `lintCorpus`, so a source that is already
oversized when inspected is never handed to core's unbounded `readFile` path. It also
runs strictly **after** fresh root and ADR-directory realpath, readability, git-root,
and containment checks (§8). Candidate type, canonical containment, and bigint identity
are checked before and after the path-based core load. A candidate involved in any
observed change is never included in a response from that call.

1. Call `resolveCanonicalRoots` (§8) from the immutable configured `cwd`/`dir`, require
   the fresh `canonicalCwd` to equal `expectedCanonicalCwd`, and retain the fresh
   `canonicalDir`. Any root/directory failure or changed canonical-root resolution makes
   the whole projection unavailable.
2. Call core's already-exported `discoverAdrFiles(canonicalDir, canonicalCwd)`. If it
   rejects, the whole projection is unavailable — this becomes the tool-level
   `CorpusUnavailableOutcome` (§5), never a per-file finding.
3. For each discovered candidate absolute path, call `lstat()` and reject a symlink or
   non-regular file; call `realpath()` and require path-segment-safe containment within
   `canonicalDir`; then call `stat(path, { bigint: true })` and retain the identity tuple
   (`dev`, `ino`, `size`, and nanosecond-resolution `mtimeNs`) for step 5:
   - The `stat()` call itself fails (e.g. a permission error, or a file deleted in a
     race between discovery and this step) → one finding, `path` set to
     `normalizeDisplayPath(candidate, canonicalCwd)` (core's own exported helper — the
     identical value `lintCorpus` would have produced), **no `id`** (the file was never
     parsed): `{ rule: 'record-stat-error', severity: 'error', path, message: 'ADR
     candidate could not be read to validate its size and was excluded from this
     response' }` — a fixed-string message with no interpolated, unbounded content.
     `error`, not `warn`: the corpus this call answers from is
     now genuinely incomplete (a candidate that should have been checked could not be),
     even though the call itself still proceeds and every other, valid record remains
     usable — severity communicates "the corpus has a real gap," not "this call failed."
     The candidate is excluded from the next step.
   - The file's byte size exceeds `maxSourceBytes` (64 KiB) → one finding, same `path`
     convention, **no `id`**: `{ rule: 'record-too-large', severity: 'error', path,
     message: 'ADR source exceeds the 64 KiB maximum and was excluded from this
     response' }` — likewise `error`, for the identical reason: the corpus is missing a
     record it should contain, not merely advisory. Excluded from the next step — never
     truncated, never included as a partial body (FR-012, US1 AC8, SC-001).
   - Otherwise, the candidate's absolute path and identity tuple are kept.
4. If at least one candidate was kept, call `lintCorpus({ paths: keptPaths, cwd:
   canonicalCwd })` — **never** with an empty array. `lintCorpus`'s own
   `expandRecordInputs` treats an empty `paths` array identically to "no `paths`
   supplied" and falls back to re-discovering the **entire** ADR directory via
   `discoverAdrFiles(dir, cwd)` again — which would silently reintroduce every file step
   2 just excluded, defeating the guard for the specific edge case where every discovered
   candidate is excluded. `@adrkit/mcp` therefore special-cases `keptPaths.length === 0`:
   it skips calling `lintCorpus` entirely and treats the projection as zero records with
   only the pre-read guard's own findings from step 2 — this is the one place the "call
   `lintCorpus` unchanged" rule (research §R3) is deliberately not "just call it with
   whatever paths remain," because doing so would reopen exactly the hole this guard
   exists to close.
5. After `lintCorpus` returns, repeat step 1 and require the same fresh
   `canonicalCwd`/`canonicalDir`; then repeat each candidate's `lstat`, `realpath`
   containment, and bigint `stat`. If any root, directory, or candidate is unavailable,
   changes type or canonical path, exceeds `maxSourceBytes`, or no longer has the same
   (`dev`, `ino`, `size`, `mtimeNs`) tuple captured in step 3, discard the entire
   provisional projection and return `corpus-unavailable` /
   `corpus-changed-during-load`. The caller can retry from a fresh call. This does not
   claim that a transient hostile swap was never read; it guarantees that no record from
   an **observed** changed, escaping, non-regular, or now-oversized candidate is returned
   or fingerprinted as a stable result.
6. Only after step 5 succeeds are `lintCorpus`'s returned `records[]` accepted as
   `CorpusProjection.records` (stable and within-limit at both checks — this includes any record
   `lintCorpus`'s own corpus-invariant checks flagged with a `unique-id` or
   dangling-reference finding, since those checks never remove a record from
   `records[]`, only add a finding about it; see §3 above). Its `findings[]` — corpus
   findings only, never a tool-derived finding, which does not exist yet at this point in
   the call — are concatenated with step 2's pre-read findings, then re-sorted by
   `@adrkit/mcp`'s own comparator (§3.1) to produce `CorpusProjection.corpusFindings`.

This is a consistency and containment check, not a lock, atomic snapshot, or uniform
cross-platform open-beneath/no-follow guarantee. It detects changes visible at the
explicit validation checkpoints. Portable Node `>=22` path APIs cannot prove that a
transient hostile swap did not occur and revert entirely between checks while core's
path-based read was in progress; that unscheduled case is explicitly outside this
phase's guarantee.

### 3.4 Corpus fingerprint and health

`CorpusHealth` — surfaced on every tool response as the sibling of `result` (contracts/
tools.md §1), present on every branch except `corpus-unavailable` (where it cannot be
computed at all) — is exactly `{ fingerprint, recordCount, excludedCount }`, the last
three fields of `CorpusProjection` above, computed as described there (research §R6 for
the fingerprint algorithm itself).

### 3.5 Corpus findings vs. a tool's per-call response findings

`CorpusProjection.corpusFindings` (§3) is **not** what any tool returns on its own
`findings` channel. Each of the four tool handlers builds its own, call-specific
`responseFindings` by concatenating `corpusFindings` with whatever findings **that
handler itself** deterministically derives for **this** call, then re-sorting the
combined array with `@adrkit/mcp`'s own comparator (§3.1) before the findings-channel
cursor (contracts/pagination-and-cursors.md) paginates it. `CorpusProjection` itself is
never mutated to hold a tool's derived findings — it is a plain, `readonly` value shared
by reference within one call, not an accumulator:

| Tool | Derived findings it adds on top of `corpusFindings` |
|---|---|
| `search_decisions` | none |
| `get_decision` | none |
| `get_decision_context` | the findings returned by each per-record `resolveAffects` call (e.g. `affects-unresolvable` — FR-032, research §R4) |
| `list_superseded` | one `superseded-target-ambiguous` finding per ambiguous entry, one `superseded-target-federated-unavailable` finding per federated-unavailable entry (§6) |

`affects`-resolution findings are intentionally context-tool findings: the other three
tools do not run `resolveAffects`, so their findings channels do not claim to diagnose
matcher execution. A caller that needs matcher health uses `get_decision_context`;
searching or fetching a document reports corpus parse/validation health only.

**Why `(fingerprint, qh)` together, not the fingerprint alone, make a derived-findings
cursor safe.** `CorpusProjection.fingerprint` pins down `records`/`corpusFindings`/
`corpusHealth` exactly (§3.4) — it says nothing about a specific tool call's own
substantive inputs. The cursor's `qh` (contracts/pagination-and-cursors.md §4) covers
exactly those inputs for the channel being paginated — `files[]` for
`get_decision_context`, nothing beyond page size for `list_superseded`, which takes no
filter input. Because each tool's derived findings are a **pure, deterministic**
function of `(CorpusProjection, that call's own substantive inputs)` — `resolveAffects`
is pure given `records` and `files`; `list_superseded`'s ambiguity/federation
findings are pure given `records`/`byId` alone — an unchanged `fingerprint` **and** an
unchanged `qh` together already guarantee the derived findings are the same array they
were the last time both matched, with no need to fold them into the hashed
`CorpusProjection` itself. Folding them in anyway would be redundant, and would also be
wrong for `list_superseded`'s findings-channel `qh` specifically, which intentionally
hashes nothing but `findingsLimit` (page size) — if derived findings were part of the
hashed projection, this document's claim that only the corpus's own fingerprint (never a
separate parameter) governs that channel's staleness would no longer hold.

This replaces an earlier draft's imprecise framing that the fingerprint (or
`CorpusProjection.findings`, since renamed `corpusFindings`) was "the complete findings
set for this call" or that it changed for "every" tool-derived finding — neither claim
was ever true for `get_decision_context`'s per-record `resolveAffects` findings or
`list_superseded`'s minted findings, both of which depend on that call's own inputs, not
on the corpus alone, and neither of which the fingerprint has ever hashed.

**Source-derived content stays bounded, transitively, without a second budget.** The
64 KiB pre-read cap (§3.3) bounds a loaded record's entire source-derived footprint —
frontmatter *and* body together, since both come from the one capped file — and
therefore transitively bounds every artifact derived from that record: its
`DecisionSummary` (§4, a handful of already-schema-bounded fields — e.g. `title` is
`AdrFrontmatter`'s own `min(3).max(120)`), its `FullDecision` (§4, the same frontmatter
and body verbatim, never truncated further), and any finding message that quotes one of
its fields (§6, §7 of contracts/tools.md). This is one cap doing its one job, not two
overlapping budgets. **Pagination is a separate, item-count bound, not a byte-size
one**: `limit`/`findingsLimit` (§7) bound how many summaries or findings a page contains,
never an exact serialized-byte ceiling for the page as a whole — a page's total size is
therefore the product of a bounded item count and a per-item size that is itself bounded
(directly by a field's own schema limit, or transitively by the 64 KiB source cap), not a
number this design promises to keep under some single fixed byte figure.

---

## 4. Decision summaries and the full document

```ts
/** The bounded, partial projection used everywhere a full document would be unbounded
 *  or unnecessary — search results, candidate sets, decision-context entries, and
 *  superseded listings all embed this as their common base (FR-028, FR-031, FR-022,
 *  Key Entities: "Decision-record summary"). No `log` or `ref` field: this phase's
 *  identity is the bare local `id` alone (§3.1), and a "canonical ref" would just
 *  duplicate `id` with no qualifier ever attached to it. */
interface DecisionSummary {
  readonly id: string;           // record.frontmatter.id, bare, local
  readonly title: string;
  readonly status: Status;
  readonly sourcePath: string;   // repo-relative, POSIX-separator (FR-017) — never absolute; the field that distinguishes candidates sharing one id (§3.2)
}

/** Declared relation refs, verbatim and UNEXPANDED (FR-024, FR-033). Every array is the
 *  record's own frontmatter array, unmodified; `supersededBy` mirrors the schema's own
 *  optionality (present only when status is 'superseded'). These ref strings may
 *  themselves be log-qualified (ADR-0002's grammar); this shape never resolves them —
 *  that is `get_decision`'s/`list_superseded`'s job on a follow-up call, not this one's. */
interface RelationRefs {
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
  readonly relatesTo: readonly string[];
  readonly conflictsWith: readonly string[];
}

/** The full document `get_decision` returns on success (FR-023). `frontmatter` reuses
 *  @adrkit/core's own `AdrFrontmatter` Zod value directly as a nested schema (verified
 *  safe to nest under a discriminated-union variant despite its `.refine()` cross-field
 *  checks — research §R1.1) — never a hand-redefined subset of its fields. Echoes
 *  `requestedRef` (the caller's raw input, always unqualified here — a qualified ref
 *  never reaches this variant, see §6) alongside the resolved local `id`; no `log`
 *  field, because none exists to report. */
interface FullDecision {
  readonly requestedRef: string;
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly sourcePath: string;
  readonly frontmatter: AdrFrontmatter;  // reused core schema, nested verbatim — full typed frontmatter, incl. RelationRefs' fields in their original shape
  readonly body: string;                 // complete Markdown body, never truncated (FR-023)
}
```

`FullDecision` does not separately repeat `RelationRefs` — the caller already has every
relation field inside `frontmatter` verbatim (FR-024: "return those refs as part of the
complete typed frontmatter"). `RelationRefs` as its own named shape exists only for
`ContextEntry` (§6), where a **summary** — not the full frontmatter — needs to carry the
relation fields explicitly (FR-033).

---

## 5. Findings and pagination *(new — runtime only; full wire format in
contracts/pagination-and-cursors.md)*

```ts
/** Identical shape wherever a growing channel appears — result pages, findings pages,
 *  candidate pages — parameterized only by item type. */
interface Page<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;   // null ⇔ this is the last page
}

type FindingsPage = Page<Finding>;   // Finding reused verbatim from @adrkit/core (§1)

/** The opaque cursor payload before base64url-encoding (contracts/pagination-and-
 *  cursors.md §1-§2). Never exposed to a caller in this decoded form. */
interface CursorPayloadV1 {
  readonly v: 1;
  readonly scope: CursorScope;        // e.g. 'search.results' | 'search.findings' — which channel/field this cursor is valid in
  readonly fp: string;                 // CorpusHealth.fingerprint at mint time
  readonly qh: string;                 // hash of this call's normalized query-shape parameters
  readonly offset: number;             // positive safe integer (>= 1) index into that call's deterministic sorted array — 0 is never minted (contracts/pagination-and-cursors.md §2)
}

type CursorScope =
  | 'search.results' | 'search.findings'
  | 'get_decision.candidates' | 'get_decision.findings'
  | 'context.results' | 'context.findings'
  | 'superseded.results' | 'superseded.findings';

/** The shared, non-error, fully schema-validated branch every tool's output union
 *  includes for a cursor that fails to decode, fails its version check, arrives in the
 *  wrong input field, no longer matches the live corpus/query, does not apply to this
 *  call's actual resolved outcome, or indexes past the end of its freshly recomputed
 *  channel (contracts/pagination-and-cursors.md §2). Every supplied cursor is always
 *  decoded and checked through this full sequence — there is no outcome for which a
 *  supplied cursor is silently accepted without being validated (contracts/
 *  pagination-and-cursors.md §1, §5). This is a correctness/staleness signal, never an
 *  authentication or security failure. */
interface InvalidCursorOutcome {
  readonly outcome: 'invalid-cursor';
  readonly reason: 'decode-failed' | 'version-unsupported' | 'wrong-channel'
                  | 'query-mismatch' | 'corpus-changed' | 'cursor-not-applicable'
                  | 'offset-out-of-range';
  readonly message: string;
}

/** The shared, non-error branch for a corpus that cannot be loaded AT CALL TIME
 *  (distinct from the bin's own startup-time check, contracts/tools.md §9; Edge Cases:
 *  "corpus-wide load failure"). The `root-*` reasons describe the configured `cwd` — in
 *  practice already ruled out when the public handle's `start()` succeeds, but still
 *  reachable if the root disappears or changes afterward. The `dir-*` reasons describe
 *  the configured ADR directory, re-validated fresh on **every** call (§3.3, §8). */
interface CorpusUnavailableOutcome {
  readonly outcome: 'corpus-unavailable';
  readonly reason: 'root-not-found' | 'root-not-directory' | 'root-not-readable'
                  | 'root-not-git'
                  | 'dir-not-found' | 'dir-not-directory' | 'dir-not-readable'
                  | 'dir-outside-root' | 'corpus-changed-during-load';
  readonly message: string;
}
```

---

## 6. Per-tool outcome shapes

Every tool's `outputSchema` raw shape is `{ corpusHealth: CorpusHealth.optional(),
result: <Tool>Result }`, where `<Tool>Result` is a Zod discriminated union nested under
`result` (never at the schema root — research §R1.1). `corpusHealth` is present on every
branch except `corpus-unavailable`, where it cannot be computed at all.

Every **substantive** branch below (`results`, `found`/`not-found`/`ambiguous-local-id`/
`federated-log-unavailable`, `matches`, `entries`) carries its own `findings:
FindingsPage` field — the wire name callers see. Its contents are that call's
`responseFindings` (§3.5): `CorpusProjection.corpusFindings` plus whatever this specific
tool call deterministically derived on top of it (none, for `search_decisions`/
`get_decision`), re-sorted canonically, then paginated. `InvalidCursorOutcome` and
`CorpusUnavailableOutcome` deliberately carry **no** `findings` field at all — neither is
a substantive answer about the corpus's content; one reports a cursor problem, the other
reports the corpus could not be loaded well enough to compute anything, including
findings, for this call.

```ts
// search_decisions
type SearchDecisionsResult =
  | { outcome: 'results'; items: readonly SearchMatch[]; cursor: string | null; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;

interface SearchMatch extends DecisionSummary {
  readonly matchedFields: readonly ('id' | 'title' | 'tag' | 'body')[]; // non-empty, sorted, every field that independently matched (FR-028); no 'ref' — the searchable surface is local id, title, tags, body only (FR-025)
}
// Empty result set is the SAME 'results' branch with items: [] (US3 AC7) — not a
// separate discriminant; "explicit empty result... same shape as a non-empty response."

// get_decision
type GetDecisionResult =
  | { outcome: 'found'; decision: FullDecision; findings: FindingsPage }
  | { outcome: 'not-found'; requestedRef: string; findings: FindingsPage }
  | { outcome: 'ambiguous-local-id'; requestedRef: string; candidates: readonly DecisionSummary[]; cursor: string | null; findings: FindingsPage }
  | { outcome: 'federated-log-unavailable'; requestedRef: string; log: string; id: string; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;
// `federated-log-unavailable` fires whenever `parseAdrRef(ref).log` is defined — this
// phase never attempts a local lookup with a qualified ref, never strips the qualifier,
// and never substitutes a same-id local record (FR-021, FR-022, US1 AC5). `id` here is
// `parseAdrRef(ref).id` — the unqualified part of the requested ref, for the caller's
// convenience — not a claim that a local record with that id exists.
// Only `ambiguous-local-id` carries a primary `candidates`/`cursor` pair; a `cursor`
// supplied against a call resolving to any of the other three outcomes is not silently
// ignored — it is decoded and, having no channel to apply to, rejected as
// `invalid-cursor` / `cursor-not-applicable` (contracts/pagination-and-cursors.md §2, §5).


// get_decision_context
type GetDecisionContextResult =
  | { outcome: 'matches'; governing: readonly ContextEntry[]; activeProposals: readonly ContextEntry[];
      history: readonly ContextEntry[]; cursor: string | null; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;
// `findings` here is `responseFindings` (§3.5): `corpusFindings` plus every per-record
// `resolveAffects` call's own findings for this call's `files[]` (e.g.
// `affects-unresolvable` — FR-032, research §R4), concatenated and re-sorted — never a
// mutation of `CorpusProjection.corpusFindings` itself.

interface ContextEntry extends DecisionSummary {
  readonly firedMatchers: readonly FiredMatcher[];   // reused core shape (§1) — which matcher(s) fired, verbatim
  readonly relations: RelationRefs;                   // declared refs, unexpanded (FR-033)
}
// "Zero matches" is the SAME 'matches' branch with all three arrays empty (US2 AC7) —
// not an error and not a fourth discriminant.

// list_superseded
type ListSupersededResult =
  | { outcome: 'entries'; items: readonly SupersededEntry[]; cursor: string | null; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;
// `findings` here is `responseFindings` (§3.5): `corpusFindings` plus one
// `superseded-target-ambiguous`/`superseded-target-federated-unavailable` finding per
// entry that needs one (below), concatenated and re-sorted.

interface SupersededEntry extends DecisionSummary {
  readonly supersededBy:
    // Resolves only against an UNQUALIFIED local target with exactly one match (FR-034).
    | { readonly resolved: true; readonly target: DecisionSummary }
    // Unqualified target, zero local matches — a dangling reference that should have
    // failed corpus validation upstream; the corpus's own existing `dangling-supersededBy`
    // finding is already present in `corpusFindings` (§3), so no duplicate finding is
    // minted here.
    | { readonly resolved: false; readonly targetRef: string; readonly reason: 'dangling' }
    // Unqualified target, MORE THAN ONE local match — never picked silently, but the
    // full candidate list is NOT embedded here: an entry carries only `candidateCount`
    // (a small integer), never an unbounded, per-entry `candidates[]` array (FR-034,
    // contracts/tools.md §7). One compact `superseded-target-ambiguous` finding
    // (severity 'warn'), naming `targetRef` and `candidateCount`, is minted for this
    // entry (§3.5) — never one finding per candidate. The complete candidate list
    // remains obtainable, already paginated, via a separate `get_decision(targetRef)`
    // call, which returns that same bucket as its own `ambiguous-local-id` outcome (§6
    // above) — this design deliberately reuses that existing, already-bounded channel
    // instead of inventing a second, nested pagination scheme for a list nested inside
    // a list.
    | { readonly resolved: false; readonly targetRef: string; readonly reason: 'ambiguous'; readonly candidateCount: number }
    // Target is a log-qualified ref — never resolved, stripped, or substituted; a
    // `superseded-target-federated-unavailable` finding (severity 'info') is minted for
    // this entry (§3.5), alongside (not replacing) whatever `dangling-supersededBy`
    // finding @adrkit/core's own unmodified, log-unaware invariant check already
    // produced for the same field, since that check has no concept of a qualifier either
    // (research §R3).
    | { readonly resolved: false; readonly targetRef: string; readonly reason: 'federated-unavailable'; readonly log: string; readonly id: string };
}
```

**Every `SupersededEntry` is a small, fixed-shape object.** None of its four
`supersededBy` variants embeds an array whose length depends on corpus content — the
`'ambiguous'` variant's `candidateCount` is a bounded integer, not the candidates
themselves. Combined with the per-record 64 KiB source cap that already bounds every
other field on this shape (transitively — §3.5), a `list_superseded` page's total size is
therefore the product of a bounded item count (`limit`, §7) and a genuinely bounded
per-item size, never a page that could balloon because one entry happened to be
ambiguous among many candidates.

**One canonical result walk, partitioned per page (`get_decision_context`, FR-019,
FR-031)**: the flat, canonically-sorted list of every matching record (governing +
activeProposals + history combined) is paginated as **one** sequence — the cursor's
`offset` indexes into that single flat list — and only *after* slicing one page from it
does the handler partition that page's entries into the three named arrays by status.
There is one `cursor` for the whole union, never one per bucket (contracts/tools.md §6).

---

## 7. Input shapes (summary; exact Zod shapes in contracts/tools.md)

Every input object is a **strict** Zod object (`z.strictObject`/`.strict()`) — an unknown
or extra field is rejected before any corpus access, for every tool, with no exception
(FR-012). Every tool shares two pagination-input fields beyond its own substantive
arguments: `cursor?: string` (max 4 KiB, primary channel) and `findingsCursor?: string`
(max 4 KiB, findings channel), each paired with its own `limit?`/`findingsLimit?` (int,
1–100, default 20). **A supplied cursor is always decoded and validated**, never silently
skipped because this call's outcome turns out to be a non-paginated singleton — a primary
`cursor` presented against an outcome with no primary channel to resume (e.g.
`get_decision` resolving to `found`) is decoded, then rejected as `invalid-cursor` /
`cursor-not-applicable` (contracts/pagination-and-cursors.md §2, §5); it is never merely
ignored.

```ts
interface SearchDecisionsInput {
  readonly query: string;            // 1–256 raw UTF-16 code units; MUST be non-empty after trim() — a whitespace-only query is rejected as an input-contract error before any corpus access (US3, FR-026), not silently normalized to an empty-string match-everything query; trim/NFKC/lowercase-normalized (research §R5) before matching
  readonly status?: readonly Status[];   // 1–6 unique entries; omitted = all six (FR-020); ANY-OF — a record matches if its own status is any one of the listed values
  readonly tags?: readonly string[];     // 1–32 unique slugs when present, each 1–64 chars; ALL-OF — a record matches only if it carries every listed tag (contracts/tools.md §8)
  readonly scope?: readonly Scope[];     // 1–3 unique entries; ANY-OF, same reasoning as `status`
  readonly cursor?: string; readonly limit?: number;
  readonly findingsCursor?: string; readonly findingsLimit?: number;
  // No `log` filter — this phase has no log dimension to filter by (FR-021, FR-025).
  // `status`/`tags`/`scope` are ANDed across categories — a record must satisfy every
  // supplied category's own condition (any-of within status/scope; all-of within tags);
  // omitting a category always means "no constraint from that category," never "match
  // nothing" (contracts/tools.md §5).
}

interface GetDecisionInput {
  readonly ref: string;              // bare id or log:id (ADR-0002's AdrRef grammar), 1–128 chars; always required, even on a continuation call (contracts/tools.md §4). A qualified ref never resolves locally — see GetDecisionResult's federated-log-unavailable branch (§6).
  readonly cursor?: string; readonly limit?: number;         // ambiguous-local-id candidates page, only meaningful when ambiguous
  readonly findingsCursor?: string; readonly findingsLimit?: number;
}

interface GetDecisionContextInput {
  readonly files: readonly string[];   // 1–256 entries, each a validated repo-relative logical path (1–1024 chars; no leading '/', no '..' segment, no drive letter, no backslash, non-empty) — enforced by input-schema .refine(), never read/opened/stat'd (FR-009, FR-030). The backslash rejection is not merely "no Windows drive letter": ANY backslash anywhere in the string is rejected, because the contract is POSIX separators only (contracts/tools.md §6) — a path using `\` as a separator, or containing one as a literal (escaped) character, is equally out of contract for a logical path this design only ever compares against forward-slash `affects` patterns.
  readonly cursor?: string; readonly limit?: number;
  readonly findingsCursor?: string; readonly findingsLimit?: number;
}

interface ListSupersededInput {
  readonly cursor?: string; readonly limit?: number;
  readonly findingsCursor?: string; readonly findingsLimit?: number;
  // No status/log/tags/scope filter — FR-034's scope is unconditional over every
  // superseded record; adding filters here would be unrequested surface area.
}
```

---

## 8. Server configuration *(new — runtime only)*

```ts
/** Startup-only; immutable for the process lifetime; no tool input can override any
 *  field of it (FR-035). No log-identity, named-log, or backing-snapshot field exists —
 *  this phase has none of those. */
interface AdrkitMcpServerOptions {
  readonly cwd: string;    // default process.cwd(); --cwd / ADRKIT_MCP_CWD (research §R7); MUST canonicalize (realpath) to a readable directory containing a readable direct .git entry (directory, or file for a linked worktree)
  readonly dir: string;    // default 'docs/adr'; --dir / ADRKIT_MCP_DIR, resolved against cwd; MUST canonicalize (realpath) to a readable directory whose canonical path equals or is contained within the canonical cwd
}

/** The one canonicalization/containment routine both the public handle's `start()`
 *  (fail-fast) and `loadCorpusProjection` (before and after every core load — §3.3)
 *  call. Never shells out to `git`; every check uses portable filesystem APIs. */
function resolveCanonicalRoots(options: {
  readonly cwd: string;
  readonly dir: string;
}): Promise<{ readonly canonicalCwd: string; readonly canonicalDir: string }>;   // rejects with a typed CorpusUnavailableOutcome-shaped reason on any failure
```

**Realpath, not lexical, containment — this is the actual gap being closed.** A `..`-free,
non-absolute `--dir` string can still resolve, once symlinks are followed, to a location
outside the repository — e.g. `docs/adr` is a symlink into `/etc`, or an intermediate
path segment is. Checking the raw, uncanonicalized strings (as an earlier draft did) only
catches a **lexical** escape (a literal `..` segment or a leading `/`); it does nothing
against a **symlinked** escape, where every character of the string looks perfectly
contained. This design therefore canonicalizes both `cwd` and `dir` with `fs.realpath`
(which resolves every symlink in the path, including in intermediate segments) before
checking anything else, and it checks containment on the two **canonical** paths, never
the two original ones.

**The containment check itself is path-segment-safe, not a string prefix.** Given
`canonicalCwd` and `canonicalDir`, compute `rel = path.relative(canonicalCwd,
canonicalDir)` and reject unless `rel` is empty, or is a relative path whose first
segment is not `..` (equivalently: `rel !== '..' && !rel.startsWith('..' + path.sep) &&
!path.isAbsolute(rel)`). A naive `canonicalDir.startsWith(canonicalCwd)` check is
deliberately **not** used: it would wrongly accept a sibling directory that merely shares
a string prefix (`/repo` vs. `/repo-secrets`), which `path.relative` + a segment-aware
check does not.

**Startup establishes an expected root; every call revalidates it.**
`createAdrkitMcpServer` performs no filesystem access at construction. Its
zero-argument `start()` realpaths and validates the configured `cwd` and `dir` before
constructing the private SDK server or connecting stdio, retaining the immutable
configured strings and the resulting `expectedCanonicalCwd`. Every tool call then
realpaths and validates both configured paths before and after core loading and requires
the fresh canonical root to equal that expected value. The root's direct readable `.git`
entry is rechecked each time; `dir` is rechecked for readability and segment-safe
containment in the fresh root. This is per-instance state only, never a process-wide
cache, and it does not retain corpus records or findings.

**Failure produces `corpus-unavailable` with a precise reason** (§5) — `root-not-found`/
`root-not-directory`/`root-not-readable`/`root-not-git` for a `cwd` problem, `dir-
not-found`/`dir-not-directory`/`dir-not-readable`/`dir-outside-root` for a `dir` problem
The per-candidate checks in §3.3 are additional and mandatory even though
`discoverAdrFiles` currently filters by `Dirent.isFile()`: discovery and later reads are
separate path operations. Each candidate is therefore `lstat`-checked as a regular
non-symlink, realpath-contained in the fresh canonical ADR directory, and bigint-identity
checked before and after the core load. Every reported `sourcePath` or finding path is
still normalized relative to the fresh canonical `cwd` (FR-017).

`createAdrkitMcpServer(options?: Partial<AdrkitMcpServerOptions>):
Readonly<AdrkitMcpServerHandle>` (contracts/tools.md §1) applies the same defaults as the
bin and returns a frozen null-prototype object with exactly zero-argument `start` and
`close` methods. The concrete SDK server, registration APIs, low-level server, and
transport are closure-private; `start()` performs validation and creates exactly one
`StdioServerTransport`. A package-internal builder exposes the concrete registered server
only to in-memory tests and is absent from every public export map.

---

## 9. Entity relationships (summary)

```
AdrkitMcpServerOptions (startup input: cwd, dir)
        │
        ▼
resolveCanonicalRoots (§8)
        ├─ cwd  → realpath'd + validated ONCE per server instance, then held  →  canonicalCwd (or: corpus-unavailable, root-*)
        └─ dir  → realpath'd + containment-checked AGAINST canonicalCwd, FRESH on every call below  →  canonicalDir (or: corpus-unavailable, dir-*)
        │
        ▼
loadCorpusProjection(canonicalCwd, dir, maxSourceBytes)   — called fresh, every tool call; re-runs the dir half of resolveCanonicalRoots first, every time (§3.3, §8)
        │
        ├─ discoverAdrFiles(canonicalDir, canonicalCwd)  (@adrkit/core, unmodified)  →  candidate paths, already isFile()-filtered (or: corpus-unavailable, dir-*)
        │        │
        │        └─ pre-read size guard (§3.3, @adrkit/mcp-only)  →  stat() each candidate; excludes oversized/unstattable paths BEFORE parsing; adds record-too-large / record-stat-error findings, severity error (no id — never parsed)
        │
        ├─ lintCorpus({ paths: keptPaths, cwd: canonicalCwd })  (@adrkit/core, unmodified; skipped entirely if keptPaths is empty — §3.3)  →  Adr[] + Finding[]  (a duplicate-id/dangling-ref record is still schema-valid and stays in Adr[]; only its finding is added)
        │
        ├─ byId  (§3.1–§3.2)   — LOCAL id → readonly Adr[], built from Adr.frontmatter.id alone; never a single arbitrary representative
        ├─ corpusFindings      (lintCorpus findings + pre-read guard findings ONLY, re-sorted by @adrkit/mcp's own code-unit comparator — never core's localeCompare-based order; never a tool-derived finding — §3.5)
        └─ fingerprint         (§3.4, research §R6 — canonical JSON over records+corpusFindings+corpusHealth counts, never raw file bytes, never a tool-derived finding)

CorpusProjection (readonly; never mutated — §3.5)
        │
        ├─ search_decisions     → SearchMatch[]         (normalized literal match over id/title/tags/body, §R5; canonical (id, sourcePath) order; responseFindings = corpusFindings, no derived findings)
        ├─ get_decision          → FullDecision | not-found | ambiguous-local-id candidates | federated-log-unavailable   (parseAdrRef detects qualification first; byId only for the unqualified case, §3.2; responseFindings = corpusFindings, no derived findings)
        ├─ get_decision_context  → resolveAffects() per record, no `log` (research §R4) → ContextEntry[] partitioned into governing/activeProposals/history; responseFindings = corpusFindings + this call's own resolveAffects findings (§3.5)
        └─ list_superseded       → SupersededEntry[]     (every 'superseded' record; supersededBy resolved via byId when unqualified — resolved / dangling / ambiguous [candidateCount, not candidates[]] / federated-unavailable; responseFindings = corpusFindings + one compact finding per ambiguous/federated-unavailable entry — §3.5)

Every growing channel above is sliced into a Page<T> by an independent CursorPayloadV1
(§5) bound to CorpusProjection.fingerprint and a per-call query-shape hash — every
supplied cursor is decoded and verified (never silently skipped), and a primary cursor
that names a channel this call's actual outcome does not have fails as
`cursor-not-applicable` rather than being ignored (contracts/pagination-and-cursors.md
§2, §5).
```
