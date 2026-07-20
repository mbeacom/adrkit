# Feature Specification: MCP Server (Read-Only Retrieval)

**Feature Directory**: `006-mcp-server`
**Implementation Branch**: `feat/phase-5-mcp-server`
**Created**: 2026-07-20
**Status**: Implemented — PR #19
**Phase**: 5 (outcome ladder **rung 4**) — read tools only
(project **Phase 5** ≠ outcome-ladder rung 5. Per `plan.md`, Phase 5 is the MCP server
and delivers rung 4, "an agent can read the corpus." Rung 5, "a proposal gets routed
without a meeting," is project **Phase 4**, the deterministic evaluator, which already
landed. Internal references to "Phase 5" in this document mean the project phase, not
the rung.)
**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the
ADR wins):
[ADR-0001](../../docs/adr/0001-record-architecture-decisions-in-git.md) (git holds the
record; every consumer, including this server, is a reader),
[ADR-0002](../../docs/adr/0002-typed-frontmatter-as-madr-superset.md) (the typed schema —
`status` enum including `rejected`/`superseded`/`deprecated`, the `log`-qualified `id`
grammar, `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith`),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is
truth, the database is a derived, optional, rebuildable index; explicitly names "the MCP
retrieval tools" as a *reader* of that index or, absent one, the filesystem — never a
second writer),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation and the clean-clone build gate — this server is a first-party, non-adapter
consumer of `@adrkit/core`),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (pure
`affects` resolution semantics — the affects matcher grammar this server reuses,
including degrade-to-inert-not-fail for matcher types with no backing snapshot),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun for development; Node-targeted
published artifacts — ADR-0010 names the MCP server explicitly as launched by
third-party agent harnesses, typically under Node, not Bun), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles
I–V. [ADR-0003](../../docs/adr/0003-ship-as-spec-kit-extension.md) (ship as a Spec Kit
extension plus a standalone CLI, not a competing harness) is cited for the project's
general distribution posture: the MCP server is another **standalone, embeddable**
surface, not a hosted service the project operates.

> **✅ Phase 4 real-user gate evidence recorded 2026-07-20.** The maintainer ran
> `adr evaluate` on the genuine, then-`proposed` ADR-0007, using the repository's
> complete tracked-file inventory and an identity snapshot naming an active human
> (`@mbeacom`) on the evaluation date. The first run surfaced a **real**
> `assertions-compile.no-source` error — ADR-0007's two `engine: custom` assertions
> (`core-has-no-adapter-deps`, `clean-clone-builds`) had no declared `expression` — while
> still deterministically proving the `one-way-door` escalation trigger and routing it to
> `@mbeacom` via `deciders`. ADR-0007 was corrected in place to declare the symbolic
> custom-expression sources; the rerun exited `0` with `outcome: ok`, exactly eleven
> ordered rules, two honest `warn`-severity findings (`packages/adapters/**` currently
> resolves to zero real targets; an `affects` overlap with the accepted ADR-0010), the
> `custom`-engine rules reported **inert** because no trusted custom engine is registered,
> `one-way-door` proven, and the escalation target resolved to `@mbeacom` via `deciders`.
> No model call, network access, clock read, or write occurred. This is genuine
> maintainer-dogfood evidence that Phase 4's evaluator works against real corpus content,
> not only fixtures — the "real user" this outcome ladder rung requires (`plan.md`).
>
> **✅ Phase 5 scope ratified 2026-07-20.** The maintainer explicitly ratified the
> exact four-tool, local-only, read-only boundary in this specification: no fifth
> tool, write path, prompts/resources, HTTP/auth, models, network access,
> persistent index/database, or named-log federation. Together with the Phase 4
> evidence above, this cleared SC-016. Fresh analysis passed after artifact
> remediation with no critical, high, or medium finding; all 43 tasks are
> complete in PR #19.

## Overview

Phases 0–4 made records valid (schema, `@adrkit/core`), locatable (`affects`
resolution), importable (MADR migration), visible on the pull requests that touch them
(`@adrkit/ci`), and — as of Phase 4, landed and now dogfooded on real content per the
gate evidence above — routable without a meeting (the deterministic Pass 0 evaluator).
All of that lives in git, read by a CLI a human runs.

Phase 5 opens the corpus to a **different caller**: an autonomous agent, mid-session,
that needs to check "has this already been decided, tried, or rejected" **before**
drafting a plan or a proposal ADR — the capability rung 4 names ("an agent can read the
corpus"). The deliverable is `@adrkit/mcp`: a **local, stdio-transport, read-only** Model
Context Protocol server exposing **exactly four tools** —
`search_decisions`, `get_decision`, `get_decision_context(files[])`, and
`list_superseded` — over the same `@adrkit/core` parsing, validation, graph, and
`affects`-resolution machinery the CLI already uses. It reads a git-backed corpus already
on disk; it never fetches, indexes, or caches it elsewhere, and it never proposes,
mutates, or writes anything (ADR-0001, ADR-0004).

The load-bearing property is the same one that makes the rest of this project credible:
**git is truth, and this server is a reader.** There is no database, no hosted endpoint,
no authentication (there is no network listener to authenticate against), no model call,
and no write path. A clean clone may use only the unauthenticated public registry for its
frozen dependency install; build, test, package, smoke, and runtime must then complete
with networking disabled, no credentials, and no running service while returning correct
answers from a sample corpus (Principle II). If retrieval ever needs a model, an index,
or a runtime network call to be useful, that is a later, explicitly-scoped feature.

## User Scenarios & Testing

> **Gate cleared 2026-07-20; implementation complete.** The maintainer ratified
> the exact scope below, the Phase 4 real-user evidence is recorded above, fresh
> analysis passed after remediation, and all 43 implementation tasks are
> complete in PR #19.

### User Story 1 — An agent looks up one decision it already suspects exists (Priority: P1) 🎯 MVP

As an agent (or a human operator testing the server), I want to fetch exactly one
decision record by its id — including a rejected or superseded one — so I can confirm
what was actually decided instead of acting on a guess or a stale summary.

**Why this priority**: `get_decision` is the simplest possible reader and the
foundation every other tool's record shape reuses. It is independently useful the moment
a caller already has an id (from a search result, a commit message, or a prior
conversation) and needs the authoritative record, and it is the tool that first proves
the graveyard (`rejected`/`superseded`/`deprecated`) is retrievable at all, not filtered
out as noise.

**Independent Test**: Start the server against a fixture corpus containing at least one
record of each status (`draft`, `proposed`, `accepted`, `rejected`, `superseded`,
`deprecated`), call `get_decision` with each record's id, and confirm every status comes
back verbatim as a full document — canonical identity, typed frontmatter, repo-relative
source path, and complete Markdown body — including the two records related by
`supersedes`/`supersededBy`.

**Acceptance Scenarios**:

1. **Given** a fixture corpus containing an `accepted` record and a `rejected` record,
   **When** `get_decision` is called with each record's id in turn, **Then** both come
   back as the full document — local identity `id`, typed frontmatter, repo-relative
   source path, and the complete Markdown body — never frontmatter alone, with their true
   status; the rejected record is returned, not hidden or errored.
2. **Given** a record that is `superseded`, **When** `get_decision` is called with its
   id, **Then** the response includes its declared `supersededBy` ref so the caller can
   resolve the replacement with a second `get_decision` call.
3. **Given** an id that does not exist in the corpus, **When** `get_decision` is called
   with it, **Then** the tool returns an explicit, unambiguous "not found" result — never
   a thrown exception, an empty object, or a fabricated placeholder record.
4. **Given** the same id is used by two different records in this one local corpus (an
   invalid-corpus condition already flagged elsewhere by the `unique-id` finding —
   [Assumption A1](#assumptions)), **When** `get_decision` is called with that id,
   **Then** the response is an explicit **`ambiguous-local-id`** result listing every
   candidate (id, title, status, and the repo-relative `sourcePath` that distinguishes
   them, since this phase has no log qualifier to distinguish them by) rather than
   silently returning one of them or picking one arbitrarily, with cursor pagination if
   all candidates do not fit in one bounded response. This phase supplies no way to
   disambiguate further by a second `get_decision` call; the caller's actionable next
   step is fixing the underlying duplicate-id defect in the corpus, not retrying the tool.
5. **Given** a log-qualified ref (`payments:0012`) — a well-formed `AdrRef` per
   ADR-0002's grammar — **When** `get_decision` is called with it, **Then** the response
   is an explicit, non-error **`federated-log-unavailable`** result naming the requested
   log and id, because this phase serves exactly one local corpus and no named-log
   federation ([Assumption A1](#assumptions)); the qualifier is never silently stripped
   and never substituted with a same-id local record.
6. **Given** any record returned by `get_decision`, **When** the response's source path is
   inspected, **Then** it is repo-relative (e.g. `docs/adr/0042-....md`) — the tool never
   emits an absolute filesystem path, regardless of the server's actual on-disk root.
7. **Given** a record whose frontmatter declares `supersedes`, `supersededBy`, `relatesTo`,
   or `conflictsWith` refs, **When** `get_decision` returns it, **Then** those refs remain
   present in the returned typed frontmatter but no referenced document or resolved
   summary is inlined; the caller follows a ref with a second `get_decision` call.
8. **Given** an ADR source larger than the fixed maximum source size, **When** the corpus
   is loaded for `get_decision`, **Then** the source is excluded with a structured
   `record-too-large` finding — never read into an unbounded response and never silently
   truncated. The exact maximum is fixed in the plan and contract fixtures.

---

### User Story 2 — An agent checks what governs the files it is about to change (Priority: P1)

As an agent about to propose a change to a specific set of files, I want to ask which
decisions currently govern those files, which proposals are already in flight over the
same area, and which decisions were tried there and rejected or superseded, so I don't
re-litigate settled questions, collide with in-flight work, or repeat a documented
mistake.

**Why this priority**: this is the rung's central claim — "an agent can read the corpus"
**before acting**, not after being told no. `get_decision_context(files[])` is the tool
that turns retrieval into a genuine pre-flight check rather than a keyword search the
agent has to interpret itself, and it is the tool most directly built on ADR-0009's
resolution semantics, so it also proves that reuse rather than a second resolver.

**Independent Test**: Feed `get_decision_context` a fixture file list that matches one
`accepted` record's `affects` pattern, one `proposed` record's pattern, and one `rejected`
record's pattern (same path prefix, different specific matchers); confirm the accepted
record appears only in `governing`, the proposed record appears only in
`activeProposals`, and the rejected record appears only in `history` — never merged into
one undifferentiated list — and that the fired matcher is reported for each.

**Acceptance Scenarios**:

1. **Given** a file that matches an `accepted` record's `path` matcher, **When**
   `get_decision_context` is called with that file, **Then** the record appears in the
   response's **`governing`** collection together with the matcher that fired.
2. **Given** a file that matches a `draft` or `proposed` record's `affects` matcher,
   **When** `get_decision_context` is called with that file, **Then** the record appears
   in the **`activeProposals`** collection — never merged into `governing` and never
   dropped because it isn't `accepted` yet.
3. **Given** a file that matches a `rejected`, `superseded`, or `deprecated` record's
   `affects` matcher but no `accepted` record's matcher, **When** `get_decision_context`
   is called with that file, **Then** the record appears in the **`history`** collection,
   never in `governing` or `activeProposals`, and is not silently dropped for having a
   graveyard status.
4. **Given** a file that matches records across more than one status bucket (e.g. an
   `accepted` record and a `superseded` record's matchers), **When**
   `get_decision_context` is called, **Then** the response includes the `accepted` record
   under `governing` **and** the `superseded` record under `history` — both, not a single
   winner — and, more generally, all six statuses (`draft`, `proposed`, `accepted`,
   `rejected`, `superseded`, `deprecated`) are visible through one of the three
   collections whenever a record of that status matches the supplied files; none is
   structurally unreachable.
5. **Given** a `package` matcher with no lockfile snapshot supplied to the server, or an
   `entity`/`resource`/`api`/`data` matcher with no backing catalog/artifact, **When**
   `get_decision_context` resolves affected records, **Then** that matcher resolves to
   **inert** with an explicit, informational finding — never a fabricated match and never
   a fatal error for the rest of the request (ADR-0009).
6. **Given** an input entry that is not a well-formed repo-relative logical path (an
   absolute path, a path containing a `..` traversal segment, a Windows drive-qualified
   path, a path containing a backslash anywhere, or an empty string), **When**
   `get_decision_context` is called with `files` containing that entry, **Then** the call
   is rejected as an actionable input-contract error **before** any matcher evaluation or
   filesystem access — the string is never used to open, read, or stat a file; it is
   compared only against declared `affects` patterns already loaded from the corpus.
7. **Given** no file in the supplied list matches any record's `affects` pattern, **When**
   `get_decision_context` is called, **Then** the response reports all three collections
   (`governing`, `activeProposals`, `history`) empty — not an error — so a caller can
   distinguish "nothing governs this yet" from a failure.
8. **Given** a matched record whose frontmatter declares `supersedes`, `supersededBy`,
   `relatesTo`, or `conflictsWith` refs, **When** `get_decision_context` returns that
   record's summary, **Then** the summary includes those declared relation refs (including
   `conflictsWith`) so the caller can follow any of them with a separate `get_decision`
   call; `get_decision_context` itself does not expand or fetch the referenced records.
9. **Given** more matching records than fit in one response, **When** the caller follows
   the returned cursor, **Then** one canonical pagination walk returns every matched record
   exactly once across the three status collections, with each page partitioning its
   records into `governing`, `activeProposals`, and `history`.

---

### User Story 3 — An agent searches the corpus, including the graveyard, before proposing something new (Priority: P1)

As an agent drafting a plan, I want to search prior decisions by topic before writing a
new proposal, and I want that search to include decisions that were rejected or
superseded, so I don't propose something the organization already tried and explicitly
walked away from.

**Why this priority**: this is the entry point for the "has this already been decided"
question when the agent does not yet know a specific id or a specific changed file — the
scenario ADR-0009's context explicitly calls out ("the MCP retrieval tools" depending on
the same resolution semantics) and the one README already promises ("let agents retrieve
prior decisions, including the rejected ones, before proposing something already
tried").

**Independent Test**: Search a fixture corpus for a term that appears only in the
Markdown body of one `accepted` record (not in its id, title, or tags) and only in the
title of one `rejected` record; confirm both are returned with the correct matched-field
indicator, that omitting a `status` filter returns both, that a `status: rejected` filter
returns only the rejected one, and that re-running the identical query twice returns
results in the identical order.

**Acceptance Scenarios**:

1. **Given** a query term present in an `accepted` record and a `rejected` record's
   searchable text, **When** `search_decisions` is called with no status filter,
   **Then** both records are returned — the graveyard is not excluded by default.
2. **Given** a query term that appears only in a record's Markdown body (not in its
   id, title, or tags), **When** `search_decisions` is called, **Then** that record is
   still returned, with its matched-field indicator identifying `body` as the field that
   matched — the searchable surface is id, title, tags, **and** body, not
   title/tags/id alone.
3. **Given** the same query and an explicit `status` filter, **When**
   `search_decisions` is called, **Then** only records matching the filter are
   returned, and the filter can select `rejected`/`superseded`/`deprecated` explicitly,
   not only `accepted`.
4. **Given** a query containing mixed case or leading/trailing whitespace, **When**
   `search_decisions` is called, **Then** the query is trimmed and case-folded before
   matching, using the same normalization applied to each searchable field, so a match
   depends only on normalized literal substring containment — never on the caller
   guessing exact case or trimming their own input.
5. **Given** a corpus larger than one page, **When** `search_decisions` is called
   repeatedly with the returned pagination cursor, **Then** every matching record is
   returned exactly once across all pages, in the canonical `(id, sourcePath)` order,
   with no record skipped or duplicated.
6. **Given** the identical query, filters, and page parameters, **When**
   `search_decisions` is run twice with no corpus change between runs, **Then** both
   runs return the identical ordered result set — ordering is canonical identity order,
   never a relevance score, so there is no ranking heuristic to be non-deterministic
   about.
7. **Given** a query that matches nothing, **When** `search_decisions` is called,
   **Then** the response is an explicit empty result set with the same shape as a
   non-empty response — never an error.
8. **Given** a corpus containing a record that fails schema validation, **When**
   `search_decisions` is called, **Then** the invalid record is excluded from matches,
   the corpus-load finding for it is surfaced on the response's findings channel, and
   every other, valid record is still searchable — a single bad record never blocks the
   whole corpus.
9. **Given** a matching record, **When** `search_decisions` returns it, **Then** the
   result is a bounded summary (id, title, status, source path, matched-field
   indicators) — never the full Markdown body; a caller that needs the full document
   follows up with `get_decision`.

---

### User Story 4 - An agent orients itself in the graveyard directly (Priority: P2)

As an agent (or a human onboarding to a corpus it doesn't know), I want to list every
decision that has been superseded and what replaced it, so I can understand the
project's decision history and current state without having to search by guesswork.

**Why this priority**: `list_superseded` is explicitly named in the Phase 5 exit
criteria (`plan.md`) as a distinct capability from search — a direct, complete listing
rather than a query — useful for building an agent's mental map of "what used to be true
but no longer is" without needing to already know a search term. It ships after the three
P1 tools because it is additive orientation, not a blocking dependency for either lookup
story.

**Independent Test**: Populate a fixture corpus with three `superseded` records, each
`supersededBy` a different `accepted` record, plus one unrelated `accepted` record with
no supersession involvement; call `list_superseded` and confirm exactly the three
superseded records are returned, each paired with its resolved `supersededBy` target's
id, title, and current status, and that the unrelated `accepted` record does not appear.

**Acceptance Scenarios**:

1. **Given** a corpus with several `superseded` records, **When** `list_superseded` is
   called, **Then** every `superseded` record is returned, each with its `supersededBy`
   target's id, title, and status resolved — not merely the raw target id string.
2. **Given** a corpus with no `superseded` records, **When** `list_superseded` is
   called, **Then** the response is an explicit empty result — never an error.
3. **Given** a `superseded` record whose `supersededBy` target id does not resolve to any
   local record (a dangling reference that should have failed corpus validation
   upstream), **When** `list_superseded` is called, **Then** that record's target is
   reported unresolved (`resolved: false`) rather than fabricated or silently omitted
   from the listing, and the corpus's own dangling-reference finding for it is present on
   the findings channel.
4. **Given** a `superseded` record whose `supersededBy` target id is used by more than one
   local record, **When** `list_superseded` is called, **Then** that record's target is
   reported unresolved with a deterministic `superseded-target-ambiguous` finding naming
   the target id and the number of candidates — a candidate is never silently picked, and
   the finding never enumerates every candidate's path/title inline; the complete
   candidate list is separately obtainable via a follow-up `get_decision` call on the
   same target id.
5. **Given** a `superseded` record whose `supersededBy` is a log-qualified ref, **When**
   `list_superseded` is called, **Then** that record's target is reported unresolved as
   federated-unavailable with an informational finding, consistent with this phase's
   single-local-corpus scope ([Assumption A1](#assumptions)) — the qualifier is never
   silently stripped and a same-id local record is never substituted.
6. **Given** a corpus larger than one page, **When** `list_superseded` is called with
   pagination, **Then** the same no-loss, no-duplication, stable-order guarantee as
   `search_decisions` applies.

---

### User Story 5 — A harness operator trusts the boundary holds (Priority: P2)

As the operator embedding this server inside an agent harness, I want an enforceable
read-only contract with bounded defense-in-depth evidence that the four tools do not
write, read caller-selected files outside the configured corpus, reach the network, or
invoke a model, so adding retrieval does not introduce a silent write path.

**Why this priority**: this is not a feature the agent asks for; it is the property that
makes it safe to grant an agent this tool at all. Every other story is worthless if this
one is false, but it is P2 because it is a cross-cutting invariant proven by the same
fixtures the P1 stories already exercise, not a separate user-facing capability.

**Independent Test**: With the server running against a fixture corpus and networking
disabled, exercise every outcome branch of every tool with adversarial inputs. Trap the
enumerated filesystem-mutation/write-capable-open/FileHandle, process, worker,
native-addon, network/listen, and Bun side-effect APIs; independently compare complete
sandbox, parent-sentinel, `HOME`, and `TMPDIR` snapshots; and confirm each call returns a
well-formed result or input-contract error with no out-of-root read and no non-protocol
stdout. This proves only the enumerated JavaScript-level APIs were not invoked on the
exercised paths, not that raw native syscalls or future unenumerated APIs are impossible.

**Acceptance Scenarios**:

1. **Given** the server configured with a specific corpus root, **When** any tool is
   called with an input that could plausibly reference a path outside that root, **Then**
   no file outside the configured root is read, and the response is an explicit rejection
   rather than a partial or best-effort read.
2. **Given** the server running with no network access in its environment, **When** any
   tool is called, **Then** the call still completes deterministically because no tool
   ever attempts an outbound connection.
3. **Given** the server process, **When** it is running and idle or actively answering a
   call, **Then** nothing but MCP protocol frames is ever written to its stdout stream —
   any diagnostic or log output goes to stderr or a configured log destination, never
   stdout, because stdout is protocol traffic.
4. **Given** a tool call with an extra, undeclared field or a field of the wrong type,
   **When** the server validates the call, **Then** the call is rejected with an
   actionable schema error before any corpus access — strict input validation, not
   best-effort coercion.
5. **Given** repeated identical calls to any of the four tools with no corpus change
   between them, **When** the calls are made, **Then** each is safe to repeat any number
   of times with no side effect and no accumulating state (read-only, non-destructive,
   idempotent).

### Edge Cases

- **Unqualified id resolution is a three-way outcome, not a boolean.** `get_decision`
  (and any other tool accepting an id) compares an unqualified id against every loaded
  record's own local id: zero matches is "not found," exactly one match returns that
  record, and more than one match returns an explicit, complete candidate list (id,
  title, status, and the distinguishing repo-relative `sourcePath`) as an
  **`ambiguous-local-id`** result — never a silent first-match, and never an error that
  hides the candidates from the caller (US1 AC3, AC4).
- **A log-qualified ref**: `payments:0012` is well-formed per ADR-0002's `AdrRef`
  grammar but is never resolved against this phase's single local corpus — Phase 5 has no
  named-log federation ([Assumption A1](#assumptions)), so `get_decision` returns an
  explicit **`federated-log-unavailable`** result naming the requested log and id. The
  qualifier is never silently stripped and a same-id local record is never substituted
  for it (US1 AC5).
- **Corpus-wide load failure**: if the corpus fails to load at all (e.g. the configured
  root is not readable, or is not a git-tracked directory), every tool returns an
  explicit, actionable startup/availability error rather than a partial or fabricated
  empty result — this is distinct from a single invalid record, which degrades gracefully
  (see next).
- **One invalid record among many valid ones**: a record whose frontmatter fails schema
  validation (or whose source is unreadable or oversized, see below) is excluded from
  results and reported as a finding; it never blocks retrieval of the rest of the corpus
  (US3 AC8). A schema-**valid** record that nonetheless trips a corpus invariant (a
  duplicate `id`, a dangling `supersedes`/`relatesTo`/`conflictsWith` reference) is
  **not** excluded by that invariant — it remains fully present and retrievable; only a
  finding about it is added, never a removal from the corpus this server answers from.
- **Missing `affects` backing source**: this phase accepts no backing-snapshot startup
  inputs, so a `package`, `entity`, `resource`, `api`, or `data` matcher resolves to
  **inert** with an informational finding — never a fabricated match, never a fatal error,
  and never silently treated as "no match" without saying why (ADR-0009; US2 AC5).
- **`files[]` path-traversal or non-logical-path input**: any entry that is not a
  well-formed repo-relative logical path (absolute, containing `..`, drive-qualified,
  containing a backslash anywhere, or empty) is rejected as an input-contract error
  before any matcher evaluation; the offending string is never used to open, read, or
  `stat` a filesystem path (US2 AC6).
- **`files[]` with zero matches**: an empty result for all three of `governing`,
  `activeProposals`, and `history` is a valid, non-error outcome (US2 AC7).
- **`files[]` matching records across more than one status bucket**: every matching
  record is returned in its own collection (`governing`, `activeProposals`, or `history`)
  — none of the three is allowed to suppress or absorb another for the same file (US2
  AC4).
- **`draft`/`proposed` records matching `files[]`**: surfaced in `activeProposals`, never
  silently dropped for not yet being `accepted` and never merged into `governing` (US2
  AC2).
- **`get_decision_context` never expands relation refs into full records**: a matched
  record's `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith` refs are listed on its
  summary so the caller can follow them, but `get_decision_context` itself never fetches
  or inlines the referenced records' bodies — that always requires a separate
  `get_decision` call (US2 AC8).
- **Search with no filters and a term matching every status**: default behavior includes
  the graveyard; a caller must opt in to narrowing, never opt in to seeing rejected
  decisions at all (US3 AC1).
- **Search term present only in a record's Markdown body**: still matches, with the
  matched-field indicator identifying `body` — the searchable surface is id, title,
  tags, and body, not a subset of them (US3 AC2).
- **Search matching nothing**: an explicit empty result, not an error (US3 AC7).
- **Large result set**: `search_decisions` and `list_superseded` paginate; a caller that
  walks every page exactly once retrieves the complete result set with no gaps and no
  duplicates, in the canonical `(id, sourcePath)` order across pages run against an
  unchanged corpus (US3 AC5, US4 AC4).
- **Large decision-context result**: `get_decision_context` paginates one canonical
  ordered walk over all matches, then partitions each page into its three status
  collections; pagination does not maintain a separate cursor per collection (US2 AC9).
- **Large findings set**: findings are independently bounded and cursor-paginated so every
  finding remains retrievable without making any one response unbounded.
- **Oversized ADR source**: a source above the fixed maximum is excluded with a
  `record-too-large` corpus finding and is never silently truncated or returned in full.
- **ADR source changed during a tool call**: if a candidate's file identity, size, or
  modification time differs between the pre-load guard and the post-load verification,
  the provisional projection is discarded and the call returns
  `corpus-changed-during-load`; the caller retries against a fresh corpus state rather
  than receiving a result assembled from an inconsistent read.
- **`superseded` record with a dangling `supersededBy` target**: an unqualified target id
  with zero local matches is reported unresolved via the corpus's own pre-existing
  `dangling-supersededBy` finding on `list_superseded`'s findings channel, never
  fabricated, never silently dropped from the listing (US4 AC3).
- **`superseded` record whose `supersededBy` target id is used by more than one local
  record**: unresolved with a deterministic `superseded-target-ambiguous` finding naming
  the target id and the candidate count — never every candidate's path/title inline; a
  candidate is never silently picked, and the complete candidate list remains available
  via a follow-up `get_decision` call on that same target id (US4 AC3, US4 AC4).
- **`superseded` record whose `supersededBy` target is a log-qualified ref**: unresolved
  as federated-unavailable, with an informational finding, consistent with this phase
  serving exactly one local corpus ([Assumption A1](#assumptions); US4 AC3).
- **No `superseded` records at all**: `list_superseded` returns an explicit empty result
  (US4 AC2).
- **Unknown/extra field on any tool call**: rejected by strict schema validation before
  any corpus access (US5 AC4).
- **Adversarial or malformed input generally**: every tool distinguishes a usage/
  input-contract problem (bad shape, unknown field, invalid path syntax) from a corpus
  finding (a record that failed validation) from "not found"/"empty" (a well-formed query
  that matched nothing) — three distinct, never-conflated response shapes.
- **Concurrent tool calls**: because every tool is a pure read against the same
  in-process view of the corpus with no shared mutable state, concurrent calls never
  interfere with each other's in-memory results and never require shared locking.
  External filesystem mutation during one call is not treated as an atomic snapshot.
  The stable-load checks reject any containment, type, identity, size, or timestamp
  change observed at their validation checkpoints. A hostile swap that occurs and
  reverts entirely between portable Node validation checkpoints is outside this
  phase's guarantee.
- **Server started with missing or invalid startup configuration** (no configured corpus
  root, a root that is not a readable directory, a root with no readable `.git` entry —
  so not a git working tree, including a linked worktree — or a configured ADR directory
  that is unreadable, absolute-outside-root, escapes the root via `..`, or escapes the
  root because it is, or resolves through, a symlink — checked after following every
  symlink on its path, not merely by inspecting the literal configured string): the
  server fails to start with an actionable error rather than starting and returning
  empty or fabricated   results for every call. The configured root, readable `.git`, and ADR directory are
  re-realpathed/re-verified before and after every later corpus load, not only once at
  startup. Candidate files are also `lstat`-checked as non-symlink regular files,
  realpath-contained, and identity-checked before and after core reads. Any observed
  swap invalidates the whole call and no data from the changed path is returned.

## Requirements

### Functional Requirements

**Tool surface & exclusivity**

- **FR-001 — Exactly four tools, no more.** The server MUST expose exactly the four read
  tools named in `plan.md`'s Phase 5 exit criteria: `search_decisions`, `get_decision`,
  `get_decision_context(files[])`, and `list_superseded`. It MUST NOT expose any
  additional tool, including any write, mutation, PR-creation, or administrative tool, in
  this phase.
- **FR-002 — No write, mutation, or proposal capability of any kind.** No tool call may
  create, edit, delete, or propose a change to any decision record, any other repository
  file, any git ref, or any external system. Every tool is read-only, non-destructive, and
  idempotent (Principle I; ADR-0001, ADR-0004).
- **FR-003 — No MCP prompts, resources, subscriptions, or sampling.** The server MUST NOT
  register MCP prompts or resources, MUST NOT support subscriptions/notifications for
  corpus changes, and MUST NOT use MCP sampling (asking the connected client's model to
  generate content) in this phase. The four tools are the entire public surface. The
  public package MUST NOT expose the SDK's concrete `McpServer`, low-level server,
  registration methods, caller-supplied transport connection, or any public subpath
  that permits a consumer to extend the registered capability set. At runtime the root
  factory MUST return a frozen object whose prototype is `null`, whose complete own-key
  set is exactly the two string keys `start` and `close`, whose symbol-key set is empty,
  and whose two methods each take no argument and return `Promise<void>`. Public TypeScript
  declarations MAY additionally expose only the corresponding options/handle/factory
  types. The package export map MUST expose no internal test builder or server subpath.
- **FR-004 — No model, embedding, or probabilistic step of any kind.** No tool
  implementation may call a language model, compute or compare embeddings, or perform any
  non-deterministic or weighted ranking. Retrieval in this phase is deterministic and
  lexical — literal normalized substring matching only (FR-026) — never semantic
  (Principle IV, extended to this phase by the same "deterministic before probabilistic"
  posture).

**Transport, security posture, and boundary**

- **FR-005 — Local stdio transport only.** The server MUST communicate over a local
  stdio-based Model Context Protocol transport, launched as a subprocess by an
  MCP-compatible client/harness. It MUST NOT open a network listener, and MUST NOT
  support an HTTP, SSE, or other remote transport in this phase. The public library
  handle accepts no transport; its zero-argument `start()` creates and connects the
  stdio transport internally.
- **FR-006 — No authentication.** The server MUST NOT implement or require any
  authentication or credential exchange, because it has no network listener to
  authenticate against; trust is delegated entirely to whatever process launches it as a
  local subprocess.
- **FR-007 — No stdout logging.** The server MUST NOT write log, diagnostic, or debug
  output to stdout at any point during startup, operation, or shutdown, because stdout
  carries MCP protocol frames exclusively. Any log output MUST go to stderr or an
  explicitly configured log destination, never stdout.
- **FR-008 — Reads are confined to a stable configured corpus boundary.** Every tool call
  MUST read only from the corpus root and ADR directory supplied at server startup. No
  tool input may expand, redirect, or escape that boundary — not via a path parameter,
  not via a log qualifier, not via any other field. Fresh portable containment and
  identity checks run before and after the path-based core load; any observed change
  invalidates the complete call and no result derived from the changed path is returned.
  These checks are best-effort consistency and containment checks, not a filesystem lock
  or atomic snapshot: adversarial mutation that occurs and reverts entirely between
  validation checkpoints is outside this phase's guarantee.
- **FR-009 — No arbitrary file-content reads.** No tool may use a caller-supplied string
  (in particular, no entry of `get_decision_context`'s `files[]`) to open, read, or `stat`
  an arbitrary filesystem path. `files[]` entries are compared, as strings, only against
  `affects` patterns already loaded from the corpus; they are never used to perform a
  filesystem read themselves (see FR-030).
- **FR-010 — No hidden index, cache, or database.** The server MUST NOT maintain a
  persistent database, a hidden on-disk cache, or any index that could drift from the
  git-tracked corpus and be treated as authoritative. Each tool call reads the current
  state of the configured corpus for that call — no call may be answered from a stale,
  previously-computed snapshot (ADR-0004: git is truth; any index is derived and
  optional, never required).
- **FR-011 — No network access of any kind.** No tool implementation may perform an
  outbound network call (no telemetry, no license check, no remote catalog lookup) as
  part of answering a tool call.

**Schema, output contract, and annotations**

- **FR-012 — Strict, bounded input and output schemas per tool.** Every tool MUST declare
  a strict input schema (rejecting unknown/extra fields and out-of-range values) and a
  strict, bounded output schema. This includes fixed maxima for query length, status/
  scope/tag filter counts and tag length, `files[]` count and path length, page size,
  cursor length, summary arrays, findings arrays, and ADR source bytes. Exact values
  MUST be fixed in the plan and contract fixtures, not selected at runtime. A source above
  the ADR-size maximum MUST be excluded with a structured `record-too-large` finding and
  MUST NOT be silently truncated. Malformed input — including a query that is empty after
  trimming leading/trailing whitespace — is rejected before any corpus access.
- **FR-013 — Structured content plus deterministic bounded text content on every
  response.** Every
  successful tool response MUST include machine-readable structured content conforming to
  the tool's declared output schema, and MUST also include a human-readable text summary
  suitable for display without parsing the structured payload. Every tool-authored
  summary and domain-error message MUST use the exact templates in
  `contracts/tools.md` §2.1 and MUST be no more than 512 UTF-16 code units. Paths and
  other unbounded corpus content MUST NOT be interpolated into these messages.
- **FR-014 — Fixed, accurate tool annotations.** Every tool MUST be annotated read-only,
  non-destructive, idempotent, and closed-world (the tool does not claim to search
  anything beyond the configured corpus) — annotations MUST be accurate declarations of
  the exclusivity and boundary properties in FR-001–FR-011, not aspirational metadata.
- **FR-015 — Actionable, distinguished tool-result errors.** Every error response MUST be
  a structured, actionable tool result — not a raw, unhandled exception — and MUST
  distinguish at least three cases: (a) a usage/input-contract problem (malformed shape,
  unknown field, invalid path syntax), (b) a well-formed query or lookup that found
  nothing ("not found" / empty result, not an error), and (c) a corpus finding
  encountered while otherwise answering the call (see FR-016). These three cases MUST
  never be conflated into a single generic failure shape.
- **FR-016 — Corpus findings are surfaced, never silently dropped, and are part of
  structured content.** Any finding produced while loading or resolving the corpus in
  service of a tool call (a schema-invalid record, a dangling reference, an inert matcher
  with no backing source, an unresolved supersession target) MUST be included on the
  response's findings channel, which MUST be part of the machine-readable structured
  content required by FR-013 — never text-only. A finding about one record MUST NOT
  suppress or corrupt results for the rest of the corpus, and a caller MUST be able to
  detect an incomplete corpus (one or more excluded records) from structured content
  alone, without parsing the text summary.
- **FR-017 — Every output path is repo-relative; no tool ever emits an absolute
  filesystem path.** Every source-path field in any tool's output (including
  `get_decision`'s source path and any path echoed back from `get_decision_context`'s
  `files[]`) MUST be a repo-relative, POSIX-separator path, matching the same logical-path
  contract FR-030 enforces on input. The server's actual on-disk root MUST NOT be
  observable in any response.

**Determinism and ordering**

- **FR-018 — Deterministic ordering everywhere a result set can contain more than one
  item, and never by relevance ranking.** Search matches, superseded listings, and each
  of `get_decision_context`'s three collections (FR-031) MUST be returned in the
  canonical `(id, sourcePath)` ascending order (FR-027), compared with a fixed,
  locale-independent code-unit comparator, such that repeated, identical calls against an
  unchanged corpus return results in the identical order every time. No result set in
  this phase is ordered by a relevance score or other weighted heuristic.
- **FR-019 — Pagination for every response channel that can grow.** `search_decisions`,
  `get_decision_context`, `list_superseded`, and `get_decision`'s ambiguous candidate set
  MUST support cursor-based pagination.
  `get_decision_context` MUST paginate one canonical ordered union of all matches and then
  partition each page into `governing`, `activeProposals`, and `history`; it MUST NOT use
  independent per-collection walks. Findings MUST be independently bounded and
  cursor-paginated. Walking each result or findings cursor exactly once MUST return every
  item exactly once, with no omission or duplicate, in the stable order required by
  FR-018.

**Corpus and graveyard semantics**

- **FR-020 — The graveyard is included by default.** `search_decisions` and
  `get_decision` MUST include `rejected` and `superseded` (and, where present,
  `deprecated`) records by default. A caller MAY narrow results with an explicit status
  filter, but MUST NOT be required to opt in to seeing the graveyard at all.
- **FR-021 — Local identity is `id`; named-log federation is deferred completely in this
  phase.** This phase serves exactly one local corpus and no other. `@adrkit/core`'s
  loader never populates a record's optional `log` field today, and `@adrkit/mcp`'s own
  discovery is non-recursive over the one configured ADR directory, so this server has no
  way to observe more than one named log from what it actually loads. A record's local
  identity is therefore its bare `id` alone, and the server maintains one multi-valued
  index (`id` → every local record sharing that id) rather than any per-log or
  canonical-log-qualified index. True named-log/multi-repository federation — resolving a
  `log:id`-qualified ref against a different log's corpus — is explicitly **out of
  scope** for this phase (see [Out of Scope](#out-of-scope)) and remains governed by the
  root `plan.md`'s own open question on federated-id representation; this server MUST
  NOT fabricate, guess at, or partially implement it.
- **FR-022 — Unqualified-id resolution is a three-way, deterministic comparison, never a
  silent choice; a log-qualified ref is a distinct, fourth, non-error outcome.** When
  `get_decision` (or any other id-accepting input) is given an **unqualified** id, the
  server MUST compare that id against every loaded local record's own `id` and return
  exactly one of three outcomes: **zero matches** → an explicit "not found" result
  (FR-015, case (b)); **exactly one match** → that record, unambiguously; **more than one
  match** → an explicit, complete `ambiguous-local-id` candidate list (at minimum: id,
  title, status, and the repo-relative `sourcePath` that distinguishes the candidates,
  since this phase has no log qualifier to distinguish them by) covering every match,
  never a partial list and never a silently chosen one — this many-match case reflects an
  already-invalid local corpus (the same duplication `@adrkit/core`'s own `unique-id`
  finding already flags) and this phase provides no way for the caller to disambiguate
  further by log or to have the server pick one arbitrarily. When the input is instead a
  well-formed **log-qualified** ref (matching ADR-0002's `AdrRef` grammar), the server
  MUST NOT attempt any local lookup with it, MUST NOT strip the qualifier and retry as
  unqualified, and MUST NOT substitute a same-id local record; it MUST instead return an
  explicit, non-error `federated-log-unavailable` result naming the requested log and id
  (FR-021).

**`get_decision` specifics**

- **FR-023 — `get_decision` returns the complete document, never frontmatter alone.** A
  successful `get_decision` response MUST include: the record's local `id`; its full
  typed frontmatter; its repo-relative source path (FR-017); and its complete Markdown
  body. A response containing frontmatter with no body, or a truncated/summarized body,
  is non-conforming — the whole point of this tool is that an agent can act on the
  authoritative record without a second fetch. This guarantee applies to records within
  the fixed source-size maximum in FR-012; an oversized source is excluded and surfaced
  as a finding rather than truncated.
- **FR-024 — Declared relation refs remain explicit and unexpanded.** For a record whose
  frontmatter declares `supersedes`, `supersededBy`, `relatesTo`, or `conflictsWith` refs,
  `get_decision` MUST return those refs as part of the complete typed frontmatter required
  by FR-023. It MUST NOT resolve, summarize, fetch, or inline any referenced record. The
  caller follows a ref with a separate `get_decision` call, keeping one tool response
  bounded to one authoritative document.

**`search_decisions` specifics**

- **FR-025 — The searchable surface is local id, title, tags, and the Markdown body — no
  more, no fewer.** `search_decisions` MUST match a query against a record's local id,
  title, tags, and full Markdown body. It MUST NOT search any other field, and MUST NOT
  omit the body from the searchable surface in favor of frontmatter metadata alone.
  There is no log filter or canonical-log-qualified-ref search in this phase (FR-021).
- **FR-026 — Matching is a deterministic, locale-independent normalized literal-match
  contract, not a weighted heuristic.** The query and every searchable field (FR-025) MUST
  be trimmed and case-folded using the same documented, locale-independent normalization
  before comparison. A record matches if and only if the normalized query is a substring
  of at least one normalized searchable field. A query that is empty after trimming
  leading/trailing whitespace MUST be rejected as an input-contract error before any
  corpus access, never silently normalized into an empty-string query that would
  otherwise match every record. Where a caller supplies a `status`, `scope`, or `tags`
  filter, each is a **unique** list (`status`: at most six entries; `scope`: at most
  three entries; `tags`: at most 32 entries, each at most 64 characters); `status` and
  `scope` use **any-of** semantics (a record matches the filter if its own single value
  is any one of the listed values), `tags` uses **all-of** semantics (a record matches
  only if it carries every listed tag, not merely one), and the three filter categories
  are **ANDed** together — a record must satisfy every supplied category's own condition
  to remain a candidate at all, and omitting a category means no constraint from that
  category, never "match nothing." The server MUST NOT apply stemming, fuzzy
  matching, locale-sensitive collation, embeddings, or any per-field or per-record weight
  when deciding whether a record matches. The exact normalization primitives (e.g. which
  Unicode case-folding routine) MAY be pinned at the plan/research stage, provided the
  choice is portable and fixture-pinned — there is no unresolved ranking decision left to
  make at that stage.
- **FR-027 — Canonical result order, never relevance order.** `search_decisions` results
  MUST be ordered by canonical identity — `(id, sourcePath)` ascending, compared with a
  fixed, locale-independent code-unit comparator (never `localeCompare` or any other
  locale-sensitive collation, so ordering cannot vary by the server process's runtime
  locale) — the same order required generally by FR-018. There is no relevance score,
  tie-break weight, or field-priority ranking in this phase.
- **FR-028 — Search results are bounded summaries with matched-field indicators; the full
  body is retrieved only through `get_decision`.** Each `search_decisions` result MUST be
  a bounded summary (at minimum: id, title, status, repo-relative source path, and an
  indicator of which searchable field(s) matched) and MUST NOT include the record's full
  Markdown body. A caller that needs the full document follows up with `get_decision`.

**`get_decision_context(files[])` specifics**

- **FR-029 — Reuse core `affects`-resolution semantics unchanged.** `get_decision_context`
  MUST determine matches using `@adrkit/core`'s existing, pure `affects`-resolution
  implementation (ADR-0009) — the same matcher grammar, per-ADR union-not-winner
  semantics, and negation-after-include ordering the CLI and CI surface already use. This
  tool MUST NOT implement a second, parallel resolver.
- **FR-030 — `files[]` entries are validated repo-relative logical paths only.** Every
  entry MUST be validated as a well-formed, repo-relative, POSIX-separator logical path
  before being compared against any `affects` pattern: no leading `/`, no `..` traversal
  segment, no drive-qualified path, no backslash character anywhere in the string, and no
  empty string. The backslash rejection is not limited to drive-qualified paths — the
  contract is POSIX separators only, so any entry containing a `\` character, in any
  position, is out of contract. An entry failing this validation MUST be rejected as an
  input-contract error (FR-015, case (a)) for the whole call, before any matcher
  evaluation — never partially processed.
- **FR-031 — Three structurally separate collections; no status is structurally
  unreachable.** The response MUST distinguish, as three separate collections: (a)
  `governing` — records with status `accepted` whose `affects` matches the supplied
  files; (b) `activeProposals` — records with status `draft` or `proposed` whose
  `affects` matches the same files; and (c) `history` — records with status `rejected`,
  `superseded`, or `deprecated` whose `affects` matches the same files. Every one of the
  six statuses in `Status` (ADR-0002) MUST be visible through exactly one of these three
  collections whenever a matching record of that status exists. A single record MUST NOT
  appear in more than one collection, and the three collections MUST NOT be merged into
  one undifferentiated list.
- **FR-032 — Missing backing source remains inert, never fabricated.** Consistent with
  ADR-0009, this phase accepts no adapter or backing-snapshot startup inputs beyond the
  corpus root and ADR directory in FR-035. A matcher that requires a lockfile, catalog,
  IaC plan, OpenAPI document, or other absent backing source therefore MUST resolve to an
  explicit inert result with an informational finding — never a fabricated match and
  never a fatal error for the rest of the call.
- **FR-033 — Each returned summary lists its record's declared relation refs; the tool
  never expands them.** Every record summary in any of the three collections MUST include
  that record's declared `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith` refs
  (when present), so the caller can choose to follow one with a separate `get_decision`
  call. `get_decision_context` MUST NOT itself fetch, inline, or expand a referenced
  record's frontmatter or body — it reports refs, it does not walk the graph.

**`list_superseded` specifics**

- **FR-034 — Complete superseded listing (across the full paginated walk) of direct,
  local edges only.** `list_superseded` MUST return every valid record with status
  `superseded` in the configured corpus (schema invariant: a `superseded` record always
  declares `supersededBy`; ADR-0002), across as many pages as the walk requires — no
  single page is "the complete listing" on its own; walking the primary cursor to
  completion is. This phase reports only the direct edge; it MUST NOT compute or expose a
  transitive supersession chain (A superseded by B superseded by C) — that lineage walk
  is explicitly out of scope for this phase (see [Out of Scope](#out-of-scope)). Target
  resolution is local-only and MUST distinguish three unresolved cases, never picking a
  candidate silently and never fabricating a target: (a) an **unqualified** target id
  used by exactly one local record resolves to that record's id, resolved title, and
  resolved current status; (b) an unqualified target id used by **more than one** local
  record is unresolved with a deterministic `superseded-target-ambiguous` finding naming
  the target id and the number of candidates (`candidateCount`) — never the full
  candidate list inline; that complete, already-bounded candidate list remains
  separately obtainable via a follow-up, paginated `get_decision` call on the same target
  id, which resolves to `ambiguous-local-id` (FR-022); (c) a **log-qualified** target ref
  is unresolved as federated-unavailable, with an informational finding, consistent with
  this phase's single-local-corpus scope (FR-021) — the qualifier is never stripped and a
  same-id local record is never substituted. A target with zero local matches at all (a
  dangling reference that should have failed corpus validation upstream) remains
  unresolved, surfaced via the corpus's own existing dangling-reference finding rather
  than fabricated or silently omitted.

**Configuration**

- **FR-035 — Configuration is corpus root and ADR directory only, explicit and
  startup-only.** A server instance serves exactly one configured corpus root (one git
  working tree, including a linked worktree) and one ADR directory within it, supplied
  only at process startup (environment variables, CLI flags, or equivalent launch
  configuration); user-friendly, documented defaults MAY be provided for either (e.g. a
  conventional ADR directory name) as long as they remain overridable at startup. No tool
  input parameter may set, override, or expand either value for a single call. There is
  no log-identity, backing-snapshot, or named-log startup setting of any kind — this phase
  has no per-server or per-record log configuration at all (FR-021).
- **FR-036 — Startup fails loudly on an unusable configuration, including a non-git
  root or a directory that escapes the root by any means, including a symlink.** The
  server MUST fail to start with an actionable error, printed to stderr (FR-007), rather
  than starting and returning empty or fabricated results for every subsequent call, when
  any of the following holds: the configured corpus root does not exist, is not a
  readable directory, or does not contain a readable `.git` entry (a directory for an
  ordinary clone, or a file for a linked worktree) identifying it as a git working tree;
  or the configured ADR directory, resolved against that root, is not a readable
  directory, or does not resolve — after following every symlink on its path, not merely
  by inspecting the literal configured string — to a location equal to or contained
  within the root. An absolute path outside the root, a `..` traversal segment, and a
  symlink (of the directory itself, or of an intermediate path segment) that resolves
  outside the root are all "escapes the root," checked identically and rejected
  identically — a directory whose literal, unresolved string contains no `..` MUST NOT be
  treated as safe merely on that basis if it resolves outside the root once symlinks are
  followed. The corpus root and ADR-directory checks MUST both be re-run before and after
  every corpus load while the server is running, not only once at startup. Every
  discovered candidate MUST be rejected if `lstat` identifies a symlink or non-regular
  file; its fresh realpath MUST remain segment-safely contained in the fresh ADR-directory
  realpath, and its bigint `dev`, `ino`, `size`, and nanosecond `mtime` identity MUST
  match at the post-load check. Any observed containment, type, or identity change
  returns `corpus-changed-during-load` and discards the complete provisional projection.
  This is distinct from a single schema-invalid record within an otherwise-loadable
  corpus, which degrades gracefully per FR-016 rather than failing startup.

**Toolchain and dependency boundary**

- **FR-037 — `@adrkit/mcp` depends only on `@adrkit/core` and vetted deterministic
  libraries.** The package MUST NOT depend on any package under `packages/adapters/**`
  and MUST NOT depend on any source requiring authenticated, network, or service access at
  build, test, or run time (Principle III, ADR-0007's `core-has-no-adapter-deps`
  boundary, applied identically to this new package).
- **FR-038 — `@adrkit/core` never depends on `@adrkit/mcp`.** Dependency direction is
  one-way: this server consumes core parsing, validation, graph, and `affects` machinery;
  core MUST NOT import from, reference, or otherwise depend on the MCP package.
- **FR-039 — Clean-clone build.** A fresh clone with Bun 1.3.14, no credentials, and no
  running services MUST be able to run `bun install --frozen-lockfile` using only the
  unauthenticated public package registry, the committed `bun.lock`, and the repository's
  `bunfig.toml`. After that single install step, build, typecheck, test, lint, packaging,
  smoke tests, and all four tool calls against a sample corpus MUST succeed with network
  access disabled (Constitution Principle II; ADR-0007's `clean-clone-builds` gate,
  extended to this package).
- **FR-040 — Node-targeted published artifact; Bun for development only.** The published
  package MUST run under Node `>=22` (matching the project's existing engines
  constraint) without requiring Bun to be installed by the consumer, consistent with
  ADR-0010's explicit statement that the MCP server is launched by third-party agent
  harnesses under Node.

### Key Entities

- **Decision record**: the full typed ADR — local identity `id`, `status` (including
  `rejected`/`superseded`/`deprecated`), title, `affects` matchers,
  `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith`, and the rest of the schema
  (ADR-0002) — plus its repo-relative source path and complete Markdown body. This server
  never constructs a new shape for it; it surfaces the same record the CLI and CI surface
  already parse, in full, via `get_decision` (FR-023).
- **Decision-record summary**: a bounded, partial projection of a decision record (at
  minimum: id, title, status, repo-relative source path) used everywhere a full document
  would be unbounded or unnecessary — search results (FR-028), candidate sets (FR-022),
  and the entries of `get_decision_context`'s three collections (FR-031). Never includes
  the full Markdown body; a caller that needs the body follows up with `get_decision`.
- **Log-qualified ref (recognized, never resolved, this phase)**: ADR-0002's `AdrRef`
  grammar permits an optional `log:` prefix disambiguating records across named logs.
  This phase serves exactly one local corpus, and `@adrkit/core`'s own loader never
  populates a record's `log` field, so a log-qualified ref is never looked up against
  local records, never silently stripped to its bare id, and never satisfied by a same-id
  local substitute — `get_decision` recognizes one and returns
  `federated-log-unavailable`; `list_superseded` recognizes one on a `supersededBy` target
  and reports that entry unresolved with an informational finding (FR-021, FR-022,
  FR-034). True named-log federation remains out of scope (see
  [Out of Scope](#out-of-scope)).
- **Search query**: a caller-supplied term plus optional structured filters (status,
  tags, scope) and pagination parameters. Matching is a deterministic, normalized literal
  substring match over id, title, tags, and Markdown body (FR-025, FR-026) — never
  semantic, fuzzy, or model-scored (FR-004). There is no log filter in this phase.
- **Search result set**: a paginated list of matched decision-record summaries, in
  canonical `(id, sourcePath)` order (FR-027), each with a matched-field indication
  (FR-028), plus any corpus findings encountered while searching.
- **Decision-context result**: the paginated output of `get_decision_context(files[])` —
  one canonical ordered result walk partitioned on each page into three structurally
  separate collections, `governing` (`accepted`), `activeProposals`
  (`draft`/`proposed`), and `history` (`rejected`/`superseded`/`deprecated`) — each entry
  of which pairs a decision-record summary with the specific fired `affects` matcher(s)
  and that record's declared relation refs, plus any corpus/resolution findings
  (including inert-matcher findings) (FR-031, FR-033).
- **Candidate set (`ambiguous-local-id`)**: the paginated list of record summaries,
  distinguished by repo-relative `sourcePath`, returned when an unqualified id resolves to
  more than one local record — an already-invalid-corpus condition (the same duplication
  `@adrkit/core`'s own `unique-id` finding flags), never a silent first-match and never
  something this phase resolves further by log (FR-022). `get_decision` is the only place
  this full candidate set itself appears; `list_superseded` reports an ambiguous
  `supersededBy` target as a count only (see Supersession edge, next), pointing the
  caller back to this same channel via a follow-up `get_decision` call rather than
  re-embedding the set a second time.
- **Supersession edge**: a directed `supersedes`/`supersededBy` relationship between two
  records, reused from the existing graph model (`supersedes`, `relatesTo`,
  `conflictsWith` edge kinds already built by `@adrkit/core`'s graph builder).
  `list_superseded` reports the direct `supersededBy` edge for every `superseded` record,
  resolved only against unqualified local targets — not a transitive chain, and not a
  federated lookup (FR-034). When a target is ambiguous, the entry reports only the
  target id and a candidate count, never the candidates themselves — the full candidate
  set is the Candidate set entity above, obtained with a separate `get_decision` call.
- **Tool-result error**: a structured, actionable error distinguishing usage/
  input-contract problems from empty-but-valid results from corpus findings (FR-015).
  Never a raw, unhandled exception surfaced to the caller.
- **Server configuration**: the startup-only, tool-input-immutable settings — corpus
  root and ADR directory only — that bound every subsequent tool call for the life of the
  process (FR-035), where the corpus root must be a readable git working tree (FR-036).
  There is no log-identity, named-log, or backing-snapshot configuration of any kind in
  this phase.

## Success Criteria

- **SC-001**: A caller can retrieve any within-limit decision record in a fixture corpus by id,
  including `rejected`, `superseded`, and `deprecated` records, using only `get_decision`
  — no record status is ever unreachable through the public tool surface — and every such
  response includes the record's local id, full typed frontmatter, repo-relative source
  path, and complete Markdown body; **never** frontmatter with the body omitted or
  truncated. An over-limit source is instead excluded, before it is ever parsed, with a
  structured `record-too-large` finding.
- **SC-002**: A caller can discover, via `search_decisions` with no status filter, at
  least one `rejected` or `superseded` record relevant to a query term, demonstrating the
  graveyard is searched by default rather than opt-in; a further fixture case proves a
  query matching only body text (not id, title, or tags) still returns that record with a
  `body` matched-field indicator.
- **SC-003**: Given a fixture corpus where enough local records share one duplicate id to
  span more than one page (an already-invalid corpus, flagged by `unique-id`), walking
  `get_decision`'s `ambiguous-local-id` candidate cursor returns **100%** of the true
  candidates exactly once, distinguished by `sourcePath`, and **never** a silently chosen
  record; a further fixture case proves a log-qualified ref for any id (colliding or not)
  returns `federated-log-unavailable` naming the requested log and id, never a local
  substitute and never the qualifier silently stripped.
- **SC-004**: Given a fixture corpus with at least one record in each of the six
  `Status` values, `get_decision_context` places the `accepted` record(s) only in
  `governing`, the `draft`/`proposed` record(s) only in `activeProposals`, and the
  `rejected`/`superseded`/`deprecated` record(s) only in `history`, in **100%** of such
  fixture cases — no merged list, no cross-listing, and no status structurally excluded
  from all three collections.
- **SC-005**: The public factory returns a frozen null-prototype handle with exactly own
  `start`/`close`, no symbols or transport parameter, and no exported SDK server,
  registration API, or test builder. No tool call, across every outcome branch and the
  full adversarial-input fixture set (path traversal
  attempts, absolute paths, backslash-containing paths, unknown extra fields, oversized
  inputs), causes a read outside the configured corpus root, a write to any file, an
  outbound network call, or an unhandled exception surfaced to the caller — every one of
  them instead yields a well-formed input-contract error or well-formed empty result; a
  further fixture case proves that no successful response, from any of the four tools,
  ever contains an absolute filesystem path in any field, and a further fixture case
  proves the server refuses to start when the configured ADR directory is a symlink
  resolving outside the configured corpus root. Deterministically injected root,
  directory, and candidate-file swaps at every explicit pre/post validation checkpoint
  are rejected, and no response contains data derived from the observed changed path.
  Side-effect denial covers the exact JavaScript-level API inventory in
  `contracts/tools.md` §10.1 and is paired with complete sandbox, parent-sentinel, `HOME`,
  and `TMPDIR` snapshots.
  Tests MUST NOT claim universal atomic no-read behavior for an unscheduled hostile swap
  that occurs and reverts entirely between portable validation checkpoints, raw native
  syscalls, or future unenumerated APIs.
- **SC-006**: Across a full test run exercising every tool at least once, the server's
  stdout stream contains only well-formed MCP protocol frames — zero non-protocol bytes
  observed on stdout, verified by capturing the raw stream.
- **SC-007**: Every one of the four tools' successful responses includes both structured
  content that validates against its declared output schema and text that equals the
  applicable deterministic template in `contracts/tools.md` §2.1 and is at most 512
  UTF-16 code units. Every invalid-cursor and corpus-unavailable reason likewise maps to
  the exact fixed message in that contract.
- **SC-008**: Walking any paginated result set (search, decision context, or superseded
  listing) to completion against a fixture corpus larger than one page returns every
  matching record exactly once, with no gap and no duplicate; the decision-context walk
  partitions every page into the three status collections without losing canonical
  ordering. Walking an independently paginated findings channel likewise returns every
  finding exactly once. Repeating either walk against an unchanged corpus returns items in
  the identical canonical order both times.
- **SC-009**: A fixture corpus containing exactly one schema-invalid record still yields
  correct, complete results for every other, valid record via `search_decisions` and
  `get_decision_context`, with the invalid record surfaced as a finding — visible in
  structured content, not just text — rather than crashing the call or silently vanishing
  without explanation.
- **SC-010**: Because Phase 5 accepts no adapter/backing-snapshot startup inputs, every
  matcher type that requires such a source (for example, a package matcher requiring a
  lockfile snapshot) is proven, in a fixture case, to resolve inert with an informational
  finding — never a fabricated `get_decision_context` match and never a fatal error for
  the rest of the call.
- **SC-011**: `list_superseded` against a fixture corpus returns every `superseded`
  record with its direct, unqualified-local `supersededBy` target's id, title, and status
  resolved (never a transitive lineage walk); a fixture case with a target id used by more
  than one local record is proven to surface a deterministic `superseded-target-ambiguous`
  finding naming the target id and the candidate count — never the full candidate list
  inline — rather than picking one, with a further fixture case proving a follow-up
  `get_decision` call on that same target id independently returns the complete candidate
  list via its own paginated `ambiguous-local-id` outcome; a fixture case with a
  log-qualified target is proven to surface an informational federated-unavailable
  finding rather than a local substitute; and a fixture case with a wholly dangling
  target is proven to surface via the corpus's own existing finding rather than being
  fabricated or dropped from the listing.
- **SC-012**: A clean clone with Bun 1.3.14, no credentials, and no running service can
  install only from the unauthenticated public registry using the committed lockfile and
  repository settings; after installation, an OS-enforced network-disabled environment
  can build, typecheck, test, lint, package, start the server against a sample corpus, and
  receive correct answers from all four tools.
- **SC-013**: The published `@adrkit/mcp` package's declared, direct dependencies are
  exactly `@adrkit/core`, the pinned `@modelcontextprotocol/sdk`, and `zod` — no package
  under `packages/adapters/**` and no other declared dependency — asserted by the same
  class of direct-declaration allow-list check the project already uses for
  `core-has-no-adapter-deps` (ADR-0007), extended to this package. This check verifies
  declared manifests only; it does **not** by itself prove that no network, service, or
  authenticated access occurs at build, test, or run time, because the SDK's own
  transitive dependency tree includes an HTTP/OAuth surface installed on disk regardless
  of which subpath is imported. That runtime property is separately proven, as
  defense-in-depth **executed-path** evidence rather than a formal proof against every
  conceivable channel (a native addon, a worker thread with its own scope, or a raw
  syscall bypassing the JavaScript-level APIs observed here are outside what this
  evidence covers, and are separately closed by this package importing no native addon
  and spawning no worker thread), by (a) side-effect-denial preloads that fail the process
  if any enumerated Node/Bun filesystem mutation, write-capable open/returned FileHandle,
  subprocess, cluster, worker, `process.dlopen`, network/listen, Bun
  write/delete/writer/spawn, or Bun-shell escape path is invoked while startup and every
  outcome branch of all four tools are exercised; (b) an import-discipline check that this
  package's own source imports only the SDK's stdio/in-memory subpaths, never its
  HTTP/OAuth subpaths; and (c) independent complete disposable-sandbox,
  parent-sentinel, `HOME`, and `TMPDIR` snapshots. The exact trapped API inventory is
  normative in `contracts/tools.md` §10. Passing proves only that these enumerated
  JavaScript-level APIs were not invoked on exercised paths; it is not proof against raw
  native syscalls or future unenumerated runtime APIs.
- **SC-014**: Two consecutive `search_decisions` calls with identical query, filters, and
  pagination parameters, against an unchanged corpus, return byte-for-byte identical
  ordered result sets — proving determinism independent of caller-perceived randomness or
  clock/state drift, and proving the ordering is the fixed canonical identity order, not a
  computed relevance score.
- **SC-015**: Given a fixture corpus where an `accepted` record's frontmatter declares
  `conflictsWith` another record, both `get_decision` and `get_decision_context` surface
  that declared ref without inlining or resolving the referenced record, and a follow-up
  `get_decision` call using the ref returns the full referenced record — proving the
  two-step "surface the ref, let the caller follow it" contract end to end.
- **SC-016 (gate, satisfied 2026-07-20)**: **Phase 5 implementation does not begin
  until this specification is reviewed and its scope ratified by the maintainer**,
  in addition to the Phase 4 real-user gate evidence already recorded above. The
  maintainer explicitly ratified the exact boundary in the header callout; both
  preconditions are satisfied.

## Assumptions

Documented, ADR-consistent defaults chosen so this spec stays testable without
prescribing implementation; none is presented as a one-way door, and no
maintainer-facing product decision remains open after the 2026-07-20 scope
ratification:

- **A1 — Single local corpus per server instance; named-log federation is deferred
  completely, not partially built.** This phase serves one configured corpus root (one
  git working tree) and one ADR directory within it (FR-035). ADR-0002's `AdrRef` grammar
  permits an optional `log:` prefix, but `@adrkit/core`'s own loader never populates a
  record's `log` field today, and this server's discovery is non-recursive over the one
  configured directory — so this phase has no way to load, index, or search by log at
  all. A record's identity is therefore its bare `id`, held in one multi-valued local
  index (`id` → every local record sharing that id, never a single arbitrary
  representative) rather than any canonical-log-qualified index (FR-021). A log-qualified
  ref is recognized by its grammar only far enough to answer `federated-log-unavailable`
  (`get_decision`) or an unresolved, informational finding
  (`list_superseded`) — never resolved, never stripped, never substituted. True
  multi-repository federation — one server instance aggregating several separate
  corpora/repos, or genuinely resolving a `log:id` ref — is **not** built in this phase
  and remains out of scope (see [Out of Scope](#out-of-scope)); `plan.md`'s own separate
  open question ("whether federated multi-repo aggregation uses ULIDs or log-prefixed
  ordinals in practice") is about that future, out-of-scope capability and is not a gap in
  this spec.
- **A2 — Search is deterministic normalized literal matching, not semantic, and there is
  no open ranking question.** Consistent with FR-004, FR-025, and FR-026, `search_decisions`
  matches by normalized (trimmed, case-folded) substring comparison over id, title,
  tags, and body text, ordered by canonical `(id, sourcePath)` identity — compared with a
  fixed, locale-independent code-unit comparator, never a relevance score, weight, or
  tie-break heuristic. This is a fixed decision, not an open item. Only the specific
  Unicode normalization/case-folding primitive used to implement FR-026 is left to the
  plan/research stage, and only on the condition that it is portable and pinned by test
  fixtures — there is no remaining ranking or weighting decision at that stage.
- **A3 — `list_superseded` reports direct supersession edges, not full transitive
  chains, by deliberate scope choice.** Each `superseded` record is paired with its
  immediate `supersededBy` target (FR-034). Walking a multi-hop supersession chain (A
  superseded by B superseded by C) is left to the caller composing repeated
  `get_decision`/`list_superseded` calls, or to a later phase — a fixed scope decision for
  this phase, not an open question (see [Out of Scope](#out-of-scope)).
- **A4 — Package placement is a first-party, non-adapter surface.** `@adrkit/mcp` is a
  peer of `@adrkit/core`, `@adrkit/cli`, and `@adrkit/evaluator` — not a package under
  `packages/adapters/**` — because it introduces no new external integration surface of
  its own; it only reads the corpus `@adrkit/core` already parses (Principle III,
  ADR-0007). Exact directory layout is a plan-stage decision.
- **A5 — MCP SDK and transport primitives.** The stable, current
  `@modelcontextprotocol/sdk` (1.29.0 as of 2026-07-20) supports the primitives this spec
  assumes exist — an `McpServer`-style registration API, a `StdioServerTransport`, strict
  per-tool input/output schemas (Zod 3.25+ or 4 compatible), `outputSchema` +
  `structuredContent`, and tool annotations. The SDK's v2 is a **beta**, split-package
  line and explicitly out of scope for this phase. Exact dependency pinning and API usage
  belong to the plan/research stage, not this spec.
- **A6 — Launch model.** The server is launched as a local subprocess by an
  MCP-compatible client/harness (commonly via `npx`-style invocation under Node, per
  ADR-0010), not run as a long-lived, independently-started service. It reads its
  configuration once at startup (FR-035) and serves calls for the life of that process.
- **A7 — No log output required, but if present, never on stdout.** This phase does not
  require the server to produce any log output at all; FR-007 only constrains where
  output goes **if** any diagnostic/log output exists, because stdout is exclusively
  protocol traffic for a stdio MCP server.
- **A8 — Bun for development; Node for the published artifact.** Built, tested, and
  bundled with Bun in this repository; the published package targets Node `>=22` and is
  smoke-tested under Node, matching the project's existing toolchain posture (ADR-0010)
  rather than introducing a Bun runtime dependency for consumers.
- **A9 — Distribution wiring is a Phase 5 non-behavioral deliverable.** Phase 5 includes
  adding `@adrkit/mcp` to the existing package, release-pack, installed-smoke,
  dependency-order, and release-documentation paths. This does not expand the four-tool
  behavioral surface. Selecting a release version, publishing to npm, creating a tag,
  and changing `scripts/release-publish.ts` remain out of scope.

## Traceability

| This spec | Constitution principle | Governing ADR(s) | Outcome ladder |
|---|---|---|---|
| FR-002, FR-010, FR-011, US5 | I — Git is the source of truth | ADR-0001, ADR-0004 | Rung 4 read-only posture |
| FR-005, FR-006, FR-039 | II — Clean clone builds green | ADR-0007 | Rung 4 frozen-install/offline-runtime requirement |
| FR-037, FR-038, FR-040 | III — Core depends on no adapter | ADR-0007, ADR-0010 | Rung 4 packaging boundary |
| FR-004, FR-018, FR-029 | IV — Deterministic before probabilistic | ADR-0009 | Rung 4 (no model in retrieval) |
| FR-012–FR-016, FR-021, FR-022 | V — The schema is the contract | ADR-0002 | Rung 4 (typed, contract-bound responses) |
| FR-017, FR-023, FR-024 | V — The schema is the contract | ADR-0002 | Rung 4 — full-document contract via `get_decision`; no partial/frontmatter-only read, no absolute path |
| FR-025–FR-028 | IV — Deterministic before probabilistic | ADR-0002, ADR-0009 | Rung 4 — literal normalized match, canonical order, no relevance ranking |
| FR-029–FR-032 | III, IV | ADR-0009 | Rung 4 core deliverable — "an agent can read the corpus" before proposing |
| FR-033 | I, V | ADR-0002 | Rung 4 — declared relation refs surfaced as bounded summaries, never expanded |
| FR-019, FR-034 | I | ADR-0002, ADR-0004 | Rung 4 — the graveyard is decision memory, not noise |
| Gate callout, SC-016 | Governance (Amendments/Compliance) | ADR-0005 (Phase 4 evidence) | Rung 5 (Phase 4) real-user evidence gating rung 4 (Phase 5) implementation |

## Open Questions for Maintainer Review

None. Search ranking, transitive-supersession scope, `conflictsWith` visibility,
and log-identity semantics are fixed to conservative defaults (FR-021, FR-022,
FR-026, FR-027, FR-033, FR-034, FR-035; A1, A2, A3). On 2026-07-20 the
maintainer also explicitly ratified the exact four **local, read-only** tools and
the exclusion of a fifth tool, write capability, named-log federation, and any
relaxation of the stdio-only/no-auth posture. An implementer does not need to
make a silent product decision on any of these points.

## Out of Scope

- **Any write, mutation, or PR-creation tool.** When write capability lands, per
  `plan.md`, it opens PRs like every other machine write in this project (ADR-0001,
  ADR-0004); no such tool exists in this phase (FR-001, FR-002).
- **Hosted, HTTP, or SSE transport; any remote deployment of the server.** Local stdio
  subprocess only (FR-005).
- **Authentication or authorization of any kind.** There is no network listener to
  protect (FR-006).
- **Any model call, embedding, semantic ranking, or retrieval-augmented generation.**
  Retrieval in this phase is deterministic, normalized literal matching only, ordered by
  canonical identity — never a relevance score (FR-004, FR-026, FR-027, A2).
- **MCP prompts, resources, subscriptions/notifications, or sampling.** Not part of the
  four-tool surface (FR-003).
- **A database, persistent cache, or rebuildable index specific to this server.** Every
  call reads the corpus directly; if a shared, optional index exists elsewhere in the
  project per ADR-0004, this server does not require it (FR-010).
- **Named-log and multi-repository federation of any kind.** A deliberate scope boundary
  for this phase, not an unresolved question: this server serves exactly one configured
  corpus root and never loads, indexes, or resolves by log (FR-021, FR-035, A1). A
  log-qualified ref is recognized only far enough to answer `federated-log-unavailable`
  (`get_decision`) or an unresolved, informational finding on a `supersededBy` target
  (`list_superseded`, FR-034) — never resolved, stripped, or substituted. `plan.md`'s
  separate open question on federated id representation concerns this later,
  out-of-scope capability.
- **Transitive supersession-lineage walks.** `list_superseded` reports only the direct
  `supersededBy` edge; walking a multi-hop chain to a lineage's current record is a
  deliberate scope boundary for this phase, not an unresolved question (FR-034, A3).
- **`get_decision_context` expanding or inlining any referenced record.** Declared
  relation refs (`supersedes`/`supersededBy`/`relatesTo`/`conflictsWith`) are surfaced on
  each summary for the caller to follow with `get_decision`; this tool never fetches or
  inlines a referenced record itself (FR-033).
- **Catalog, IaC, OpenAPI, or other adapter-backed matcher resolution beyond what
  `@adrkit/core` already resolves.** This server supplies no new adapter; matchers with no
  backing snapshot remain inert exactly as they already do in the CLI (FR-032).
- **Actual publication or release-event execution.** Package/release-pack/smoke wiring is
  in scope as Phase 5 verification; npm publication, tag creation, version selection,
  and changes to `scripts/release-publish.ts` are not (A9).
- **Any implementation outside the ratified boundary.** SC-016 cleared on
  2026-07-20 for exactly the four local read-only tools defined here; expanding
  that boundary requires a new explicit scope decision.
