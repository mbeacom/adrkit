# Specification Quality Checklist: MCP Server (Read-Only Retrieval) — Phase 5

**Purpose**: Validate specification completeness and quality before planning
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Phase 4 real-user gate evidence recorded 2026-07-20**, immediately before this
  specification. The maintainer ran `adr evaluate` on genuine, then-`proposed` ADR-0007
  with the full tracked-file inventory and an identity snapshot naming an active human
  (`@mbeacom`) on the evaluation date. First run: real `assertions-compile.no-source`
  error on the two `engine: custom` assertions, while still proving `one-way-door` and
  routing to `@mbeacom` via `deciders`. Fix: declared the two symbolic custom-expression
  sources (`core-has-no-adapter-deps`, `clean-clone-builds`). Rerun: exit `0`,
  `outcome: ok`, exactly eleven ordered rules, two honest `warn` findings
  (`packages/adapters/**` zero targets; overlap with accepted ADR-0010), custom-engine
  rules inert (no trusted custom engine registered), `one-way-door` proven, target
  resolved to `@mbeacom`. No model/network/clock/write occurred. This is the real-user
  evidence the outcome ladder requires and, together with maintainer scope ratification
  of this spec, clears Phase 5 implementation — this document performs the scoping step
  only.
- **Scope is the four named read tools only.** `search_decisions`, `get_decision`,
  `get_decision_context(files[])`, `list_superseded` — no fifth tool, no write/mutation/
  PR-creation tool, no MCP prompts/resources/subscriptions/sampling, no model call or
  embedding, matching `plan.md`'s Phase 5 exit criteria exactly (FR-001–FR-004).
- **Local stdio transport, no auth, no stdout logging.** No network listener, no
  HTTP/SSE/remote transport, no authentication (nothing to authenticate against), and
  stdout is reserved exclusively for MCP protocol frames — any log output, if present,
  goes elsewhere (FR-005–FR-007).
- **The public package surface is sealed.** The root factory returns a frozen
  null-prototype handle with exactly `start()` and `close()`, no symbols, and no
  caller-supplied transport. The SDK server, registrations, transport, and in-memory test
  builder remain package-internal and absent from package exports (FR-003, FR-005).
- **Human-readable content is exact and bounded rather than merely "concise."** Every
  substantive outcome and every cursor/corpus-unavailable reason uses the literal template
  in `contracts/tools.md` §2.1, including fixed singular/plural rules, never interpolates
  paths or unbounded corpus text, and is at most 512 UTF-16 code units (FR-005, SC-007).
- **`get_decision` returns the complete document, never frontmatter alone, and never an
  absolute path.** Canonical identity, full typed frontmatter, repo-relative source path,
  and complete Markdown body on every successful response. Declared relation refs remain
  in the typed frontmatter but are never resolved or inlined; the caller follows them
  with a further `get_decision` call. ADR sources above the fixed maximum are excluded
  with a structured `record-too-large` finding rather than truncated (FR-012, FR-017,
  FR-023, FR-024).
- **`search_decisions` matches the Markdown body, not only id/title/tags, with a fixed,
  documented normalization contract and no ranking heuristic.** Query and searchable
  fields are trimmed and case-folded by the same locale-independent rule; a query that is
  empty after trimming is rejected as an input-contract error before any corpus access,
  never silently treated as an empty-string query that would otherwise match every
  record; a match is a normalized literal substring; results are bounded summaries with
  matched-field indicators, ordered by canonical `(id, sourcePath)` identity using a
  fixed, locale-independent code-unit comparator — never a relevance score, embedding,
  fuzzy match, or locale-sensitive collation (FR-025–FR-028). `status`/`scope` filters
  are any-of (a record matches if its own value is any one listed); `tags` is all-of (a
  record matches only if it carries every listed tag, up to 32 tags of at most 64
  characters each); the three filter categories are ANDed together. There is no `log`
  filter: this phase has no log dimension to filter by.
- **The graveyard is included by default; named-log federation is deferred completely,
  not partially designed.** `rejected` and `superseded` (and `deprecated`) records are
  searchable and fetchable by default. This phase serves exactly one local corpus —
  `@adrkit/core` never populates a record's `log` field and this server's discovery is
  non-recursive — so identity is a record's bare `id` alone, held in one multi-valued
  local index that never keeps a single arbitrary representative. An unqualified id
  resolving to more than one local record returns an explicit `ambiguous-local-id`
  candidate list (distinguished by `sourcePath`) rather than a silent first match; a
  log-qualified ref is recognized only far enough to return an explicit
  `federated-log-unavailable` result — never resolved, stripped, or substituted with a
  same-id local record (FR-020–FR-022, FR-034, FR-035, ADR-0002).
- **`get_decision_context(files[])` reuses core `affects` resolution unchanged, never
  reads file content, and never omits in-flight work.** `files[]` entries are validated
  as repo-relative logical paths (rejecting absolute paths, `..` traversal, drive
  letters, any backslash character, and empty strings — the contract is POSIX separators
  only) and compared only against already-loaded `affects` patterns — never used to
  open, read, or `stat` a filesystem path. Results are three structurally
  separate collections — `governing` (`accepted`), `activeProposals`
  (`draft`/`proposed`), and `history` (`rejected`/`superseded`/`deprecated`) — covering
  all six statuses, never merged; each summary lists the record's declared relation refs
  (including `conflictsWith`) without expanding them (FR-029–FR-033, ADR-0009).
- **`list_superseded` reports direct `supersededBy` edges only, resolved locally,
  never picking a target silently, and never inlining an unbounded candidate list;
  transitive lineage is explicitly out of scope for this phase.** An unqualified target
  used by exactly one local record resolves; one used by more than one local record
  surfaces a deterministic `superseded-target-ambiguous` finding naming the target id and
  a `candidateCount` — never every candidate's path/title inline, with the complete
  candidate list separately obtainable via a follow-up `get_decision` call on the same
  target id; a log-qualified target surfaces an informational federated-unavailable
  finding; a wholly dangling target surfaces via the corpus's own existing finding — none
  fabricated, none silently dropped (FR-034).
- **A tool's `findings` channel is corpus findings plus that call's own derived
  findings — two distinct sources, composed fresh per call, never a mutated shared
  value.** The corpus projection's own findings (a schema-invalid record, a
  pre-read-guard exclusion — both severity `error`, since the corpus is genuinely
  incomplete even though the call proceeds) are what the corpus fingerprint hashes; a
  tool-derived finding (`get_decision_context`'s per-record `affects` findings,
  `list_superseded`'s minted ambiguity/federation findings) is deterministic from the
  corpus plus that call's own inputs and is merged in afterward, outside the hash — the
  fingerprint together with the per-channel query-shape hash is what a derived-findings
  cursor is actually bound to, not the fingerprint alone. A corpus invariant
  (`unique-id`, a dangling reference) never removes a schema-valid record from the
  corpus this server answers from; it only adds a finding about it.
- **Deterministic ordering and lossless pagination, with every supplied cursor always
  checked.** Any result set that can grow
  (search matches, decision-context matches, superseded listing, or findings) is ordered
  canonically, bounded, and cursor-paginated with no gap/duplicate across a full walk,
  using one fixed, locale-independent code-unit comparator `@adrkit/mcp` defines itself —
  never `@adrkit/core`'s own `localeCompare`-based finding order, reused only as an input
  to be re-sorted. Decision context uses one canonical walk partitioned per page into its
  three status collections rather than separate collection cursors. A cursor is a plain,
  reversible, base64url-encoded value — opaque by MCP protocol convention, never by
  confidentiality or tamper-proofing — and is always decoded and strictly verified,
  whether or not this call's own outcome turns out to need pagination at all: a primary
  cursor presented against a call whose resolved outcome has no primary channel to apply
  it to is reported as `invalid-cursor`/`cursor-not-applicable`, not silently ignored,
  and an in-range-looking offset that no longer indexes inside the freshly recomputed
  channel is `offset-out-of-range` — this is a correctness/staleness binding, not an
  authentication or security mechanism. Repeated identical calls against an unchanged
  corpus return byte-identical ordered results (FR-012, FR-018, FR-019, FR-027).
- **Three never-conflated response shapes.** Every tool distinguishes a usage/
  input-contract error, a well-formed empty/not-found result, and a corpus finding
  encountered while otherwise answering the call — a single bad record or missing
  `affects` backing source never blocks the rest of the corpus and is always surfaced in
  structured content, never silently dropped and never text-only (FR-015, FR-016,
  FR-032).
- **No hidden index, cache, database, or runtime network access; configuration is
  startup-only and every corpus load revalidates observable filesystem state.** Startup
  stores configured root/dir strings plus the expected canonical root. Before and after
  each core load, the server re-realpaths the root, confirms it still equals that expected
  root and has readable `.git`, and re-realpaths/validates the ADR directory with
  path-segment-safe containment. Each candidate is `lstat`-checked as a non-symlink regular
  file, realpath-checked for containment, then compared before/after by bigint
  `dev`/`ino`/`size`/`mtimeNs`; any observed change discards the whole provisional
  projection as `corpus-unavailable` without returning changed-path data. Deterministic
  tests inject root, directory, type, size, symlink, containment, and identity swaps at
  every checkpoint. Portable Node path calls do not provide an atomic hostile-filesystem
  snapshot, so the requirements do not claim detection of a transient swap that occurs and
  reverts entirely between checkpoints (FR-002, FR-008–FR-011, FR-032, FR-035–FR-036,
  SC-005, ADR-0001, ADR-0004, ADR-0009).
- **Toolchain boundary matches the existing adapter-isolation gate, and its proof is
  honestly scoped.** `@adrkit/mcp` depends only on `@adrkit/core`; core never depends on
  `@adrkit/mcp`; a clean clone may contact only the unauthenticated public registry for
  `bun install --frozen-lockfile`, after which build/typecheck/test/lint/package/smoke and
  runtime execute with networking disabled and no credentials/services; the published
  artifact targets Node `>=22`, Bun for development only (FR-037–FR-040, ADR-0007,
  ADR-0010). The allow-list proves declared direct dependencies only. Import discipline,
  exact Node/Bun denial hooks for filesystem mutation/write-capable opens/FileHandles,
  subprocesses, cluster, workers, `process.dlopen`, network/listen paths, and Bun
  write/delete/writer/spawn/shell paths, plus complete sandbox/parent-sentinel/`HOME`/
  `TMPDIR` snapshots provide separate bounded evidence. Passing proves only that enumerated
  JavaScript-level APIs were not invoked on exercised paths, not that raw native syscalls
  or future unenumerated APIs are impossible (SC-005, SC-012, SC-013).
- **Assumptions A1–A9** capture ADR-consistent, non-one-way-door defaults: exactly one
  local corpus per server instance, with named-log and multi-repository federation
  deferred completely — not partially designed with a vestigial log field kept "ready"
  — because `@adrkit/core` never populates a record's `log` and this server's discovery
  is non-recursive (A1); search as fixed, deterministic normalized literal matching with
  no open ranking question — only the specific case-folding primitive is left, portably,
  to the plan stage (A2); `list_superseded` scoped to direct, locally-resolved edges by
  deliberate choice, not left open (A3); plus first-party non-adapter package placement,
  current-stable (beta v2, not alpha) MCP SDK context, subprocess launch model,
  stdout-reserved logging and the Bun-dev/Node-publish toolchain split (A4–A8).
  Distribution/package/smoke/docs wiring is a Phase 5 deliverable; actual publication,
  tag creation, release-number choice, and `scripts/release-publish.ts` changes are deferred
  (A9).
- **Open Questions for Maintainer Review now holds no unresolved item.** Search
  ranking, transitive-supersession scope, `conflictsWith` visibility, and
  log-identity semantics are fixed to conservative defaults directly in the
  Functional Requirements and Assumptions (FR-021, FR-022, FR-026, FR-027,
  FR-033, FR-034, FR-035; A1–A3). The maintainer explicitly ratified the exact
  four-tool boundary and exclusions on 2026-07-20, satisfying SC-016.
- **"No implementation details" means no implementation choices invented by this spec,
  not zero technical constraint.** This spec correctly cites ADR- and MCP-protocol-
  mandated constraints already governing the project — Bun for development / Node for
  the published artifact (ADR-0010), the Model Context Protocol's own stdio transport and
  `@modelcontextprotocol/sdk` shape, and Zod-compatible strict schemas (ADR-0002's
  "schema is the contract") — as boundary conditions (FR-037–FR-040, A5, A8), because
  those constraints were ratified before this document and are load-bearing for its
  acceptance criteria. It does not select a specific data structure, algorithm, file
  layout, or library beyond what those ADRs already require, which is the property this
  checklist item is actually protecting.
- **This spec changes no implementation code and commits nothing.** It is the
  completed scoping step. The 43-task implementation graph is generated; current artifact
  remediation and a clean cross-artifact analysis pass precede implementation.
