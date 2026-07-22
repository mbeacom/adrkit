# Feature Specification: ARB Operations Queue

**Feature Directory**: `007-arb-queue`
**Implementation Branch**: `feat/phase-6-arb-queue`
**Created**: 2026-07-20
**Status**: Landed / reference-verified (ADR-0014 rungs 1–2)
**Phase**: 6 (outcome ladder **rung 6**) — single-repository ARB queue surface only
(Project Phase 6 delivers rung 6, "an org runs its ARB on it." Prior phases 0–5 are
landed and dogfooded (PRs #5, #6, #7, #12, #14, #19). Phase 6 is implemented and merged
(PR #22, `efef89b`). Per
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
Phase 6 **lands on rungs 1–2** — unit/contract/conformance plus maintainer-owned
isolated reference-repository validation — which is met; see SC-004 and Assumption A7.
It is **not** externally validated (rung 3, open).)
**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the
ADR wins):
[ADR-0001](../../docs/adr/0001-record-architecture-decisions-in-git.md) (git is the
source of truth; the queue is a derived, stateless, read-only projection — it never
writes decision content),
[ADR-0002](../../docs/adr/0002-typed-frontmatter-as-madr-superset.md) (the typed schema:
`review.tier` enum `auto`/`async`/`arb`, `review.queuedAt`, `review.slaDays`,
`review.escalatedAt`, `review.decidedAt`, `review.quorum`, `review.approvals`,
`review.objections`, `reviewBy`, and the cross-field invariant barring
`reversibility: one-way-door` + `tier: auto` in the same record),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (the
queue is a derived, rebuildable projection from the corpus — never an authoritative
store; no Postgres, no persistent index; the CLI and GitHub Actions surface never
require a database),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(the evaluator routes, never approves; tier semantics; escalation trigger set and
reason codes that may be reflected in committed `evaluation.escalate` and
`evaluation.escalationReasons`; "the evaluator routes; it never approves"),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation; clean-clone build constraint; the queue surface is a first-party, non-adapter
consumer of `@adrkit/core`),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun for development; Node-targeted
published artifacts), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles I–V.

> ✅ **Rung-2 reference-verification gate cleared; Phase 6 landed / reference-verified.**
> Scoping, task generation, and implementation are complete (PR #22, `efef89b`).
> Per [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
> Phase 6 lands on rungs 1–2 (unit/contract/conformance plus maintainer-owned
> isolated reference-repository validation). Rung 2 is met by the reference
> repository [`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)
> (SC-004, Assumption A7; evidence in
> [checklists/reference-verification-evidence.md](./checklists/reference-verification-evidence.md)).
> Phase 6 is **not** externally validated — the ADR-0014 rung-3 external/community
> signal is open and tracked honestly as absent, and it never gates landing.

## Overview

Phases 0–5 made records valid (`@adrkit/core`, schema), locatable (`affects`
resolution), importable (MADR migration), visible on the pull requests that govern them
(`@adrkit/ci`), routable deterministically without a meeting (Pass 0 evaluator), and
readable by agents (MCP server). Each surface answers "what was decided" or "what should
be decided." None of them operationalize the *process* of deciding: who is waiting for
what, how long they have been waiting, whether a quorum has formed, and whether anything
is overdue.

Phase 6 closes that gap. The deliverable is a **deterministic, single-repository ARB
operations queue**: a read-only projection of the local ADR corpus that makes the
existing typed `review` metadata in committed frontmatter observable as a continuously
current, actionable workflow artifact.

The queue does not replace the review process. It does not approve, route, notify,
schedule, or manage lifecycle transitions — those remain ADR pull requests. Its function
is narrower and more durable: given a committed corpus and an explicit as-of instant,
produce an ordered, byte-for-byte reproducible queue report — strict versioned JSON for
machines, deterministic Markdown for humans — that surfaces exactly what the committed
metadata says and nothing more.

Two surfaces:

- **CLI** (`adr queue` or equivalent command): a local read command that emits one selected
  representation of the same queue report to stdout, using
  `--format markdown|json` (default `markdown`), and accepts a caller-supplied `--as-of`
  option.

- **GitHub Actions**: an operational surface that creates or updates exactly one dedicated
  GitHub issue whose body contains the deterministic Markdown report and a stable hidden
  ownership marker — on push, PR, or cron events — using only the repository default token
  (`GITHUB_TOKEN` with `issues: write`) — with honest permission failure reporting.

The load-bearing property inherited from all prior phases: **git is truth, and the queue
is a reader.** No database, no service, no model, no ambient clock in the queue kernel,
and no write path into decision records. A clean clone must build, test, and run the
queue kernel and CLI with no credentials, services, or network after the frozen
dependency install. The GitHub Actions wrapper may access only the GitHub API using the
repository default token (Principles I–II, ADR-0007).

The rung-2 reference-verification gate is a separate-repository dogfood in a
maintainer-owned isolated reference repository, with at least three active
`proposed` records spanning all three tiers (`auto`, `async`, `arb`), at least one
SLA-boundary or overdue case, approvals and objections present, and the same managed
GitHub issue body updated in place on a second run with default-token-only
`issues: write` operation. It is reproducible (pinned adrkit commit), self-verifying
(the reference repo asserts its own outcomes in CI), fail-closed (an invalid-input run
fails before any GitHub write and mutates zero issues), and reviewed as a tracked,
sanitized evidence index — which is what ADR-0014 rung 2 requires. This is **not**
external/community validation (rung 3).

## User Scenarios & Testing

> **User Story gating.** The stories below are implemented (PR #22). Phase 6 is
> **landed / reference-verified** on ADR-0014 rungs 1–2; the rung-2 gate (SC-004,
> Assumption A7) is met by the maintainer-owned isolated reference repository. Phase 6
> is **not** externally validated (rung 3, open) — but external validation never gated
> these stories, landing, or the next phase.

### User Story 1 — A maintainer reads the full queue for a local corpus (Priority: P1) 🎯 MVP

As a maintainer or team lead with the corpus cloned locally, I want to run a single
command that reads every `proposed` record, computes each one's tier, SLA state, routing
targets, approvals, and objections from committed metadata alone, and produces a
human-readable Markdown table and a machine-readable JSON report — so I can see at a
glance which proposals need immediate attention, who is responsible for routing each,
and whether any are overdue or missing SLA data.

**Why this priority**: This is the rung — "an org runs its ARB on it." The queue report
is the primary deliverable. Every other user story depends on it being useful. It is
independently valuable the moment it surfaces the first overdue or missing-SLA proposal.

**Independent Test**: Point the CLI at a fixture corpus containing at least one schema-valid
`proposed` record in each of the seven SLA states (`not-queued`, `missing-sla`, `within-sla`,
`due`, `overdue`, `escalated`, `decided`), at least one schema-invalid file that appears in
`corpusFindings` rather than as a `QueueItem`, and at least one record of each tier
(`auto`, `async`, `arb`); supply an explicit `--as-of` date; assert that the JSON output
lists exactly the schema-valid `proposed` records as `QueueItem`s (no `accepted`, `draft`,
`rejected`, `superseded`, or `deprecated` records appear, and no schema-invalid files appear
as queue items), each with the correct computed SLA state, tier, routing targets derived from
`deciders`, approval count, unresolved objection count, and resolved objection count — all
derived from committed frontmatter, none fabricated.

**Acceptance Scenarios**:

1. **Given** a corpus with records of `proposed`, `accepted`, `rejected`, `superseded`,
   `deprecated`, and `draft` status, **When** the queue command runs, **Then** only
   `proposed` records appear in the output; no other status is included.

2. **Given** a `proposed` record with `review.tier: arb`, `review.queuedAt` set,
   `review.slaDays: 10`, two entries in `review.approvals`, one unresolved entry in
   `review.objections`, and two entries in `deciders`, **When** the queue command runs
   with `--as-of` set to a date 12 calendar days after `queuedAt` (with no
   `review.escalatedAt` or `review.decidedAt`), **Then** the record appears with
   `slaState: overdue`, `tier: arb`, both routing targets listed, `approvalCount: 2`,
   `unresolvedObjectionCount: 1` — all values read from committed frontmatter, none
   fabricated.

3. **Given** a `proposed` record with no `review.queuedAt`, **When** the queue command
   runs, **Then** the record appears with `slaState: not-queued` and its source identity
   (`id`, `title`, `sourcePath`); the queue does not omit it, does not fabricate a
   timestamp, and does not assign any SLA state other than `not-queued`.

4. **Given** a `proposed` record with `review.queuedAt` present but neither
   `review.slaDays` nor `reviewBy` set, **When** the queue command runs, **Then** the
   record appears with `slaState: missing-sla`; the queue does not invent a default SLA
   deadline, does not treat the record as `within-sla`, and surfaces `missing-sla`
   explicitly.

5. **Given** a `proposed` record with `review.decidedAt` present, **When** the queue
   command runs, **Then** the record appears with `slaState: decided` — signaling that a
   decision has been committed to the frontmatter but the lifecycle PR has not yet merged
   to advance the status.

6. **Given** a `proposed` record with `review.escalatedAt` present and a computed SLA
   deadline in the past, **When** the queue command runs, **Then** the record appears
   with `slaState: escalated`, not `overdue`; `escalated` takes precedence.

7. **Given** any `QueueItem` in the output, **When** the output is inspected, **Then**
   it includes at minimum: `id`, `title`, repo-relative `sourcePath`, `tier` (or `null`
   if absent), `tierLabel` (the deterministic human-review meaning of `tier`, or `null`),
   `queuedAt` (or `null`), `slaDays` (or `null`), `reviewBy` (or `null`), `slaState`,
   `routingTargets` (from `deciders`), `quorum` (or `null`),
   `approvalCount`, `unresolvedObjectionCount`, `resolvedObjectionCount`,
   `escalatedAt` (or `null`), `decidedAt` (or `null`), and `itemFindings` (ordered
   list, possibly empty).

8. **Given** the CLI, **When** it runs without `--format`, **Then** it emits only the
   Markdown representation to stdout; with `--format json`, it emits only strict JSON;
   with `--format markdown`, it emits only Markdown; any other value exits non-zero with
   usage guidance and no partial report.

---

### User Story 2 — SLA state is deterministic from committed metadata and an explicit as-of instant (Priority: P1)

As an auditor or automated system, I want the queue's SLA states to be computed purely
from committed frontmatter fields and an explicit, caller-supplied as-of instant — with
no ambient clock, no inferred defaults, and no probabilistic guessing — so the same
corpus and the same as-of instant always produce the same result and the computation is
fully explainable.

**Why this priority**: Determinism is the core property that makes the queue trustworthy
and auditable. An ambient clock makes the queue non-reproducible; invented SLA defaults
fabricate governance state. Both violate Principle IV and ADR-0004. Ships with US1.

**Independent Test**: Run the queue command twice over the same fixture corpus with the
same explicit `--as-of` value; assert both JSON outputs are byte-for-byte identical and
both Markdown outputs are byte-for-byte identical. Then run with a different `--as-of`
that crosses an SLA boundary; assert exactly the records that cross that boundary change
SLA state, and no other field changes.

**Acceptance Scenarios**:

1. **Given** identical corpus, configuration, and `--as-of` value, **When** the queue
   command runs twice, **Then** both JSON outputs are byte-for-byte identical and both
   Markdown outputs are byte-for-byte identical.

2. **Given** a record with `review.queuedAt: 2026-01-01T00:00:00Z` and
   `review.slaDays: 7`, **When** the queue runs with `--as-of 2026-01-07`, **Then**
   `slaState` is `within-sla` (`deadlineDate` is `2026-01-08` = `queuedAt` + 7 calendar
   days; as-of is before the deadline); with `--as-of 2026-01-08`, it is `due`
   (`deadlineDate` equals as-of date, UTC); with `--as-of 2026-01-09`, it is `overdue`
   (as-of is after the deadline; no `review.escalatedAt` present). With `slaDays: 0`,
   `deadlineDate` equals `queuedAt` itself; the record is `due` on `queuedAt` and
   `overdue` the following calendar day.

3. **Given** `--as-of 2026-01-08T01:00:00+05:00`, **When** the queue resolves its as-of
   date, **Then** it uses `2026-01-07`, the UTC calendar date of that instant, rather than
   the wall-clock date written in the offset timestamp.

4. **Given** both `review.slaDays` and `reviewBy` are present on the same record,
   **When** the queue computes the SLA deadline, **Then** `reviewBy` takes precedence as
   the explicit deadline; `review.slaDays` is still exposed in the output for
   informational purposes but does not participate in deadline computation when `reviewBy`
   is set (Assumption A3).

5. **Given** a record with `review.escalatedAt` present and a computed SLA deadline
   strictly before the as-of instant, **When** the queue runs, **Then** `slaState` is
   `escalated`, not `overdue`; `escalated` takes precedence (FR-005 precedence table).

6. **Given** the queue kernel as a pure library function, **When** its dependency graph
   is inspected, **Then** it reads no ambient clock, makes no network call, and performs
   no filesystem traversal beyond the caller-supplied corpus snapshot (FR-004, Principle IV).

---

### User Story 3 — Schema-invalid files appear as corpus findings; schema-valid proposed records with incompleteness appear as QueueItems with item findings (Priority: P1)

As a corpus owner, I want a clear, honest distinction between files that cannot enter the
queue at all (schema-invalid or unparseable frontmatter, cross-field invariant violations)
and schema-valid `proposed` records that are simply incomplete (absent `review.tier`, absent
SLA data, inconsistent dates) — so that the former appear in a top-level `corpusFindings`
collection with enough detail to locate and fix the problem, and the latter appear as
`QueueItem`s with item findings — and neither category is silently omitted, fabricated, or
misrepresented.

**Why this priority**: Silent omission or data fabrication is the failure mode that makes
governance tooling dangerous. A queue that hides invalid files gives false confidence; a
queue that invents approval state, tier, or SLA for files it could not parse is worse than no
queue. The two-path model ("corpus finding" vs "item finding") ensures every file in the
corpus is accounted for without polluting the QueueItem collection with untrustworthy data.
Ships with US1.

**Independent Test**: Feed the queue command a corpus containing: (1) a file with
schema-invalid frontmatter (e.g., an unrecognized `status` value that fails schema
validation), (2) a `proposed` record with `reversibility: one-way-door` and
`review.tier: auto` (schema cross-field invariant violation), and (3) a schema-valid
`proposed` record with no `review.tier` field (queue-specific incompleteness). Assert that
files (1) and (2) appear in the top-level `corpusFindings` collection (NOT as `QueueItem`s)
with `sourcePath` and parser/validator details, no fabricated `id`, `title`, `tier`,
`slaState`, or decision state; and that file (3) appears as a `QueueItem` with `tier: null`
and an item finding that names the absent routing tier — with no fabricated tier value.

**Acceptance Scenarios**:

1. **Given** a file with schema-invalid frontmatter (fails schema validation or cannot be
   parsed at all), **When** the queue command runs, **Then** that file appears in the
   top-level `corpusFindings` collection — not as a `QueueItem`; its entry includes
   `sourcePath` and parser/validator details; no `id`, `title`, `tier`, `slaState`,
   `queuedAt`, or decision state is fabricated; the queue does not crash and does not skip
   the file silently.

2. **Given** a `proposed` record with `reversibility: one-way-door` and
   `review.tier: auto` (schema cross-field invariant violation), **When** the queue command
   runs, **Then** that record appears in the top-level `corpusFindings` collection — not
   as a `QueueItem` — with `sourcePath` and an actionable description citing the
   `one-way-door` + `auto` invariant violation; the queue does not silently reassign the
   tier to `arb` or any other value, and does not omit the file.

3. **Given** a schema-valid `proposed` record with no `review.tier` field
   (queue-specific incompleteness, not a schema error), **When** the queue command runs,
   **Then** that record appears as a `QueueItem` with `tier: null` and an explicit item
   finding that the routing tier is absent; the queue does not assign a default tier or
   infer one from other fields.

4. **Given** `QueueItem`s with item findings alongside top-level `corpusFindings`,
   **When** the output is produced, **Then** item findings are co-located with their
   `QueueItem` in the `items` list; corpus findings are in the separate top-level
   `corpusFindings` collection; the two collections are structurally distinct in both
   JSON and Markdown output; a record that qualifies as a corpus finding MUST NOT also
   appear as a `QueueItem`.

5. **Given** any corpus finding in `corpusFindings`, **When** it is inspected, **Then**
   it includes the repo-relative `sourcePath`, specific parser/validator error or invariant
   violation detail, a severity, and no fabricated `id`, `title`, `tier`, `slaState`,
   timestamp, or decision state.

6. **Given** a report containing one or more error-severity findings, **When** the CLI
   runs, **Then** it still emits the complete JSON or Markdown report and exits non-zero
   afterward; warning- and info-only findings do not make the command fail.

---

### User Story 4 — The GitHub Actions surface creates or updates a dedicated managed GitHub issue with the queue report (Priority: P2)

As a team using GitHub Actions to automate their ARB workflow, I want the queue action
to create or update exactly one dedicated GitHub issue whose body contains the
deterministic Markdown report and a stable hidden ownership marker — using only the
repository default token (`GITHUB_TOKEN` with `issues: write`), with no PAT or
additional secrets — so the queue report is always current after a push or merge, the
issue is updated in place rather than creating new issues on each run, and permission
failures are reported honestly with the specific required permission named.

**Why this priority**: The GitHub Actions surface is the operational face of the queue
for most teams. It makes the queue continuously visible without manual CLI runs. It
depends on the queue kernel (US1–US3) being correct, so it ships second.

**Independent Test**: Run the queue action twice against the same fixture corpus in a
test repository; on the first run, assert exactly one GitHub issue is created with the
Markdown queue report in its body and a hidden ownership marker; on the second run,
assert the same issue body is updated in place (no new issue created, no duplicate), the
content reflects the current corpus state, and no repository file is committed or
modified; confirm both runs use only `GITHUB_TOKEN` with `issues: write` and no secrets
or PATs.

**Acceptance Scenarios**:

1. **Given** no managed queue issue exists in the repository, **When** the queue action
   runs, **Then** it creates exactly one GitHub issue with the Markdown queue report as
   its body and a stable hidden ownership marker; no repository file is written or
   committed.

2. **Given** a managed queue issue already exists (identified by the hidden ownership
   marker), **When** the queue action runs again with the same corpus and as-of instant,
   **Then** the issue body is updated in place; no new issue is created; the result is
   identical to the first run; no repository file is written or committed.

3. **Given** the repository `GITHUB_TOKEN` lacks `issues: write` permission, **When** the
   queue action runs, **Then** it exits non-zero with an explicit, human-readable
   permission error naming `issues: write` as the required permission; it does not
   silently succeed, does not partially update the issue, and does not crash with an
   unhandled exception (FR-013).

4. **Given** the managed queue issue body is inspected, **When** checked across multiple
   runs on the same corpus, **Then** the hidden ownership marker is present, stable, and
   unchanged across all runs; the action uses it to locate the correct issue on subsequent
   runs without scanning all open issues by title alone.

5. **Given** the queue action runs successfully, **When** the repository file tree is
   inspected, **Then** no ADR record file, no queue report file, and no other repository
   file has been written or modified; the only GitHub mutations are creation or body
   update of the managed queue issue and reopening that same issue when required; the
   action does not create commits or modify tracked files.

6. **Given** a GitHub issue already exists with the configured title but without the
   hidden ownership marker (i.e., not managed by adrkit), **When** the queue action runs,
   **Then** the action does not overwrite that issue; it exits non-zero with a human-readable
   explanation of the title conflict and a corrective action (choose a different
   configured title or add the ownership marker to the existing issue manually).

7. **Given** exactly one managed queue issue exists and is closed, **When** the queue
   action runs, **Then** it reopens that same issue and updates its body; no replacement
   issue is created.

8. **Given** more than one open or closed issue contains the ownership marker, **When**
   the queue action runs, **Then** it exits non-zero, names every conflicting issue number,
   and modifies none of those issues.

9. **Given** exactly one managed queue issue exists and a separate unowned issue has the
   configured title, **When** the queue action runs, **Then** the marker-owned issue remains
   authoritative and its body is updated without renaming either issue.

---

### User Story 5 — The `auto` tier is visible as expedited routing, never as automated acceptance (Priority: P2)

As a reviewer or compliance owner, I want `auto`-tier proposals in the queue to be
clearly labeled as "expedited routing — human acceptance required," never as
"automatically accepted" or "approved," so the queue cannot be misread as having approved
anything, and a `one-way-door` record with `tier: auto` is surfaced as an explicit error
rather than silently passed through or tier-corrected.

**Why this priority**: Misrepresenting `auto` as automated acceptance is the most
dangerous possible queue output. This is a compliance and safety constraint. ADR-0005
is explicit: "The evaluator routes; it never approves." The one-way-door + `auto`
cross-field invariant is enforced at the schema level; the queue surface must surface
violations consistently, not paper over them.

**Independent Test**: Add a schema-valid `proposed` `two-way-door` record with
`review.tier: auto` and a `proposed` `one-way-door` record with `review.tier: auto` to
a fixture corpus; assert the `two-way-door` record appears as a `QueueItem` labeled
`tier: auto` with no acceptance implied in any output field; assert the `one-way-door`
record appears in top-level `corpusFindings` with an actionable description of the
`one-way-door` + `auto` invariant violation — not with `tier: arb` substituted silently,
and not as a `QueueItem`.

**Acceptance Scenarios**:

1. **Given** a `proposed` `two-way-door` record with `review.tier: auto`, **When** the
   queue output is inspected, **Then** `tier` is `auto`, `tierLabel` is
   `expedited routing; human acceptance required`, and neither the JSON nor the Markdown
   output states or implies that the record is approved or will be accepted without a
   human decision.

2. **Given** a `proposed` `one-way-door` record with `review.tier: auto`, **When** the
   queue command runs, **Then** the record appears in the top-level `corpusFindings`
   collection — not as a `QueueItem` — with an actionable description of the
   `one-way-door` + `auto` schema cross-field invariant violation; the queue does not
   silently reassign the tier to `arb` or any other value, and does not omit the file.

3. **Given** any `auto`-tier record in the queue, **When** the output is inspected,
   **Then** routing targets are present (from `deciders`); the queue does not treat `auto`
   as an absence of routing and does not omit routing targets for `auto`-tier items.

---

### Edge Cases

- **`reviewBy` before `queuedAt`**: a `reviewBy` date earlier than `queuedAt` is a data
  inconsistency. The queue surfaces it as an actionable finding alongside the normally
  computed SLA state; it does not fabricate a corrected deadline and does not crash.

- **Both `reviewBy` and `review.slaDays` present**: `reviewBy` is the deadline.
  `review.slaDays` is still exposed in the output. If `reviewBy` is in the past relative
  to `queuedAt`, the queue surfaces an actionable finding; it does not suppress the
  inconsistency.

- **`escalatedAt` and computed deadline both past**: `slaState` is `escalated`. The
  ordering rationale: `escalatedAt` is an explicit, committed signal that a human action
  has been taken; `overdue` is a derived state. A record transitions from `overdue` to
  `escalated` by committing `escalatedAt`.

- **`decidedAt` present with `approvalCount` below `quorum`**: the record appears as
  `decided` (because `decidedAt` is explicitly committed), but the output surfaces both
  `quorum` and `approvalCount` so a reviewer can see the discrepancy. The queue does not
  fabricate a quorum-met signal.

- **Schema-invalid frontmatter (cannot parse at all)**: the file appears in the top-level
  `corpusFindings` collection — not as a `QueueItem`. The corpus finding includes
  `sourcePath` and the specific parse error or validation failure detail. `id`, `title`,
  `tier`, `slaState`, and decision state are never fabricated from untrustworthy partial
  parses. The queue does not crash and does not skip the file silently.

- **`review` block and top-level `reviewBy` both absent on a `proposed` record**:
  treated as `not-queued`. This is a valid, expected state for records that have been
  proposed but not yet entered into the review workflow. No item finding is generated
  for absence of `review` alone. If `reviewBy` is present without a `review` block, its
  explicit deadline still produces `within-sla`, `due`, or `overdue` under FR-005.

- **Corpus with no `proposed` records**: the queue produces an empty ordered `QueueItem`
  list with no item findings; the `corpusFindings` list may still be non-empty if
  schema-invalid files are present. The JSON output is still well-formed and
  version-stamped; the Markdown output explicitly states the queue is empty. This is not
  an error condition.

- **`--as-of` not supplied to CLI**: if not supplied, the CLI uses the current UTC date
  as the as-of value and includes the resolved as-of in every output so the run is
  reproducible when replayed with the same value. The queue kernel itself never reads
  any clock (FR-004). The CLI documents this defaulting behavior.

- **`approvals` entries not in `deciders`**: this is a data condition, not a validation
  error. All entries in `review.approvals` count toward the approval count. The queue
  does not filter approvals to the decider list; approver-vs-decider validation, if
  desired, is a future concern (Assumption A4).

- **GitHub issue title conflict — issue not managed by adrkit**: if a GitHub issue exists
  with the configured title but does not contain the hidden ownership marker, the GitHub
  Actions surface MUST NOT overwrite or update it. It exits non-zero with an explicit
  human-readable error identifying the title conflict and the corrective action (choose a
  different configured title, or manually add the ownership marker to the existing issue).

- **Managed queue issue was closed**: the Action locates managed issues in both open and
  closed state. If the marker identifies one closed managed issue, the Action reopens that
  same issue and updates its body; it does not create a replacement issue.

- **Multiple issues carry the ownership marker**: the Action treats ownership as
  ambiguous, exits non-zero with the conflicting issue numbers, and changes none of them.

- **Queue report contains error findings**: the Action creates or updates the managed
  issue first so the findings remain visible, then reports a failed Action outcome. A
  report with only warning or informational findings updates the issue and succeeds.

- **`review.tier` present but not one of `auto`/`async`/`arb`**: this is a schema
  validation failure; the file appears in the top-level `corpusFindings` collection —
  not as a `QueueItem` — with the specific unrecognized-tier-value detail. The queue
  does not fabricate a tier and does not assign an `slaState`.

- **Empty `deciders` on a queued record**: `routingTargets` is an empty list; no routing
  target is fabricated. An empty decider list may also generate an informational item
  finding depending on the record's tier and SLA state, but it is not a corpus-level
  finding on its own.

## Requirements

### Functional Requirements

- **FR-001**: The queue MUST include as `QueueItem`s every schema-valid record with
  `status: proposed` in the local corpus. It MUST NOT include records with any other
  status (`accepted`, `draft`, `rejected`, `superseded`, `deprecated`). Files with
  schema-invalid or unparseable frontmatter MUST NOT become `QueueItem`s regardless of
  what status might be inferred from a partial parse; they appear only in the top-level
  `corpusFindings` collection (FR-015).

- **FR-002**: For each `QueueItem`, the queue MUST expose: `id`, `title`, repo-relative
  `sourcePath`, `tier` (or `null`), `tierLabel` (or `null`), `queuedAt` (or `null`),
  `slaDays` (or `null`), `reviewBy` (or `null`), `slaState` (one of seven defined in
  FR-005), `routingTargets` (from `deciders`), `quorum` (or `null`), `approvalCount` (derived from
  `review.approvals.length`), `unresolvedObjectionCount` (derived from the count of
  `review.objections` entries with `resolved: false`), `resolvedObjectionCount` (derived
  from the count with `resolved: true`), `escalatedAt` (or `null`), `decidedAt`
  (or `null`), and `itemFindings` (ordered list of `ItemFinding`s, possibly empty).

- **FR-003**: The queue MUST NOT include any field value not derivable from committed
  frontmatter or the caller-supplied as-of instant. It MUST NOT fabricate tier,
  timestamp, SLA deadline, approver identity, quorum, or decision state.

- **FR-004**: SLA state MUST be a pure function of committed frontmatter fields and the
  caller-supplied as-of instant. The queue kernel MUST NOT read any ambient clock, make
  any network call, or perform any filesystem traversal beyond the caller-supplied corpus
  snapshot.

- **FR-005**: The queue MUST compute `slaState` as exactly one of the following seven
  enumerated values, applied in this precedence order (first match wins). This precedence
  applies only to schema-valid `proposed` records that have become `QueueItem`s; files in
  `corpusFindings` do not receive an `slaState`.

  | Precedence | `slaState`    | Condition                                                                                                       |
  |:----------:|:--------------|:----------------------------------------------------------------------------------------------------------------|
  | 1          | `decided`     | `review.decidedAt` is present (record still `proposed` in git; lifecycle PR pending)                           |
  | 2          | `escalated`   | `review.escalatedAt` is present (and not `decided`)                                                             |
  | 3          | `overdue`     | `deadlineDate` exists and is strictly before `asOfDate` (no `escalatedAt`, no `decidedAt`)                     |
  | 4          | `due`         | `deadlineDate` exists and equals `asOfDate` (UTC calendar day comparison)                                       |
  | 5          | `within-sla`  | `deadlineDate` exists and is strictly after `asOfDate`                                                          |
  | 6          | `missing-sla` | `review.queuedAt` is present but no `deadlineDate` is computable                                                |
  | 7          | `not-queued`  | `review.queuedAt` is absent after the `decided` and `escalated` precedence checks have failed                  |

  **Deadline computation**: all comparisons are UTC calendar-date comparisons
  (`YYYY-MM-DD`). `deadlineDate` is derived as follows: if `reviewBy` is present, its
  UTC calendar date is the `deadlineDate`. Otherwise, if both `review.queuedAt` and
  `review.slaDays` are present, `deadlineDate` is the UTC calendar date of `queuedAt`
  plus `slaDays` calendar days. Examples: `queuedAt 2026-01-01` + `slaDays 7` →
  `deadlineDate 2026-01-08`; `queuedAt 2026-01-01` + `slaDays 0` →
  `deadlineDate 2026-01-01` (due on queue date, overdue the next calendar day). If
  neither condition applies, `deadlineDate` is absent and `missing-sla` or `not-queued`
  applies. A timezone-aware datetime supplied to `--as-of` is first converted to its UTC
  instant and then to that instant's UTC calendar date; for example,
  `2026-01-08T01:00:00+05:00` resolves to `asOfDate 2026-01-07`.

- **FR-006**: Queue items MUST be ordered deterministically. For identical corpus,
  configuration, and as-of input, the ordering MUST be byte-for-byte stable. Items are
  sorted by SLA urgency group (primary), then by deadline ascending (secondary, for items
  with a computable deadline), then by `review.queuedAt` ascending (tertiary, for items
  without a computable deadline but with a `queuedAt`), then by record `id` ascending
  (lexicographic, as mandatory final tiebreak).

  **Urgency group order** (highest urgency first):
  `overdue` → `escalated` → `due` → `within-sla` → `missing-sla` →
  `not-queued` → `decided`. Deadline ordering compares UTC calendar dates.
  `review.queuedAt` ordering compares normalized UTC instants. Top-level
  `corpusFindings` are sorted by repo-relative `sourcePath`, then finding code, severity,
  and human-readable description. Source paths, codes, and descriptions use ascending
  UTF-16 code-unit order; severity uses the explicit rank `error` → `warn` → `info`.
  `itemFindings` use the same code, severity-rank, and description ordering.

- **FR-007**: The CLI surface MUST accept a corpus directory path and a caller-supplied
  as-of value (`--as-of`, ISO date `YYYY-MM-DD` or ISO datetime with timezone). If
  `--as-of` is not supplied, the CLI uses the current UTC date and MUST include the
  resolved UTC calendar date (`YYYY-MM-DD`) in every output so the run is fully
  reproducible when replayed. The CLI MUST accept `--format markdown|json`, default to
  `markdown`, and emit exactly the selected representation to stdout. The queue kernel
  MUST NOT read any clock.

- **FR-008**: The CLI surface MUST produce a strict versioned JSON output and a
  deterministic Markdown output for the same run from the same internal queue report.
  Both outputs MUST be derivable from the same queue report data; neither may add
  information the other lacks. Planning MUST define the canonical Markdown headings,
  table columns, finding sections, escaping, blank lines, empty-state text, and final
  newline so byte-for-byte determinism is testable.

- **FR-009**: The JSON output MUST carry a `version` field identifying the queue report
  schema version, an `asOf` field containing the resolved UTC calendar date as
  `YYYY-MM-DD`, and a `corpusFingerprint` field for drift detection, enabling consumers
  to detect breaking changes and reproduce runs. It MUST also carry summary counts named
  `totalItems` (`items.length`), `totalCorpusFindings` (`corpusFindings.length`), and
  `itemsWithFindings` (number of items whose `itemFindings` list is non-empty). The
  fingerprint MUST be the lower-case hexadecimal SHA-256 of the
  same canonical corpus projection used by the MCP surface: ordered schema-valid records
  represented by repo-relative `sourcePath`, parsed frontmatter, and body; ordered corpus
  findings; and record/exclusion counts. Object keys are sorted canonically, `undefined`
  fields are omitted, UTF-8 is used, and caller-specific `asOf` and derived queue fields
  are excluded so all first-party readers report the same corpus identity.

- **FR-010**: The GitHub Actions operational surface MUST create or update exactly one
  dedicated GitHub issue per run. The issue body MUST contain the deterministic Markdown
  queue report. The first run creates the issue; subsequent runs locate it by the hidden
  ownership marker in the body and update the same issue body in place. It MUST NOT
  create multiple issues for the same repository.

- **FR-011**: The managed GitHub issue body MUST contain a stable, machine-readable
  hidden ownership marker that the action uses to locate and update it on subsequent runs.
  The marker MUST be a corpus-independent constant and remain unchanged across every
  rerun. The marker format is a planning decision; the spec requires only that it be
  hidden from rendered Markdown (e.g., an HTML comment) and globally unique to
  adrkit-managed queue issues.

- **FR-012**: The GitHub Actions surface MUST use only the repository default token
  (`GITHUB_TOKEN`) and MUST explicitly document `issues: write` as the required
  permission for its GitHub API calls. A calling workflow that checks out the corpus
  MUST also retain `contents: read` for `actions/checkout`, especially for private
  repositories. It MUST NOT require any PAT, secret, or credential beyond the default
  token.

- **FR-013**: If the GitHub Actions surface cannot create or update the managed issue
  due to insufficient permissions, it MUST exit non-zero and emit a human-readable error
  explicitly naming `issues: write` as the required permission. It MUST NOT silently
  succeed, does not partially write, and does not crash with an unhandled exception.

- **FR-014**: The queue surface MUST NOT write or modify any ADR record file or any
  tracked repository file; it MUST NOT create any commits. The only GitHub mutations
  produced by the GitHub Actions surface are creation or body update of the managed queue
  issue and reopening that same issue when required by FR-021. The CLI surface produces
  only stdout output. ADR lifecycle changes MUST continue to happen through ADR pull
  requests (ADR-0001, ADR-0004).

- **FR-015**: Files with schema-invalid or unparseable frontmatter, or records with
  unsatisfied schema cross-field invariants (e.g., `one-way-door` + `tier: auto`), MUST
  appear in the `QueueReport`'s top-level `corpusFindings` collection — not as
  `QueueItem`s and not with any `slaState` assigned. Each `CorpusFinding` MUST include
  `sourcePath` and parser/validator details. `id`, `title`, `tier`, `slaState`, `queuedAt`,
  and decision state MUST NOT be fabricated from untrustworthy or absent parse data.
  These files MUST NOT be silently omitted.

- **FR-016**: The `auto` tier MUST be labeled in all outputs as an expedited review tier,
  not as automated acceptance. The queue surface MUST NOT state or imply that any record
  has been approved or accepted without a human decision (ADR-0005, Principle IV).
  `tierLabel` is derived exactly as follows: `auto` →
  `expedited routing; human acceptance required`; `async` →
  `asynchronous human review`; `arb` → `ARB human review`; absent tier → `null`.

- **FR-017**: A record with `reversibility: one-way-door` and `review.tier: auto`
  violates the schema cross-field invariant (ADR-0002) and MUST appear in the top-level
  `corpusFindings` collection — not as a `QueueItem`. No `slaState` is assigned. The
  queue surface MUST NOT silently reassign the tier to any other value, and MUST NOT
  omit the file.

- **FR-018**: The queue kernel and CLI MUST be buildable, testable, and runnable in a
  clean clone with no credentials, services, or network access after the frozen
  dependency install. The GitHub Actions wrapper MUST access no network other than the
  GitHub API and MUST be tested through an injected fake client with no token or network.
  This boundary is asserted by the existing `clean-clone-builds` gate in CI (Principle
  II, ADR-0007).

- **FR-019**: To land Phase 6 on ADR-0014 rung 2, the CLI and GitHub Actions surfaces
  MUST be exercised in a **separate, maintainer-owned isolated reference repository**,
  with at least three active `proposed` records spanning all three tiers (`auto`,
  `async`, `arb`), at least one SLA-boundary or overdue case, approvals and objections
  present, the same managed GitHub issue body updated in place on a second run, and
  default-token-only `issues: write` operation. The evidence MUST be reproducible
  (pinned adrkit commit), self-verifying (the reference repo asserts its own outcomes in
  CI), **fail-closed** (at least one consumer-facing failure scenario — e.g. an invalid
  corpus input — in which the Action fails **before** any GitHub write, emits no
  issue-number output, and mutates zero issues), and reviewed as a tracked, sanitized
  evidence index (SC-004, Assumption A7). External/community validation (ADR-0014
  rung 3) is a later optional maturity signal and is not required to land.

- **FR-020**: If no managed issue marker exists and a GitHub issue already exists in the
  repository with the configured issue title but does not contain the hidden ownership
  marker, the GitHub Actions surface MUST NOT overwrite or update that issue. It MUST exit
  non-zero with a human-readable error explaining the title conflict and a corrective
  action (select a different configured title, or manually add the hidden ownership marker
  to the existing issue).

- **FR-021**: The Action MUST search both open and closed issues for its ownership marker.
  If exactly one managed issue is closed, it MUST reopen and update that same issue. If
  multiple issues contain the marker, it MUST exit non-zero, identify every conflicting
  issue number, and modify none of them. The marker search is authoritative: when exactly
  one managed issue exists, the Action updates that issue body regardless of other issue
  titles and does not rename it. Only when no marker exists does it apply the configured
  title conflict check in FR-020 before creating a new issue.

- **FR-022**: Every `ItemFinding` and `CorpusFinding` MUST carry a severity of `error`,
  `warn`, or `info`. The CLI MUST emit the complete requested report before exiting
  non-zero when the report contains any error-severity finding. Warning- and info-only
  reports MUST exit zero. Before implementation tasks may begin, planning MUST freeze a
  closed list of queue finding codes, generation conditions, severities, and exact
  messages; implementation MUST NOT invent additional codes or reclassify severity.

- **FR-023**: When a queue report contains error-severity findings, the GitHub Actions
  surface MUST create or update the managed issue body with the complete report before
  reporting a failed Action outcome. Warning- and info-only reports MUST update the issue
  and succeed. Ownership, permission, or title-conflict failures that prevent a safe issue
  update MUST fail without modifying any issue.

### Out of Scope

The following are explicitly excluded from this feature and MUST NOT be introduced in
planning or implementation:

- Postgres, Prisma, or any persistent index; any database required for queue operation
- Any web UI, HTTP endpoint, or background daemon
- Multi-repository federation, named log federation, or cross-repo queue aggregation
- Model calls, rubric scoring (Passes 1–3), semantic ranking, embeddings, or any
  probabilistic computation in the queue surface
- Notification delivery (email, Slack, Teams, webhook, calendar integration)
- Any form of ADR acceptance, rejection, or approval automation by the queue surface
- Direct edit of ADR content, branch creation, or PR creation by the queue surface
- Any MCP write tool or fifth MCP tool
- Any hosted authentication, tenant management, or RBAC system
- GitHub Actions upload artifacts as the queue report surface
- Tracked repository files or committed files for queue report output (the queue surface
  does not create commits or modify any repository file)
- PR comments or issue comments as the queue report surface (the surface is a dedicated
  managed issue body, not a comment on an existing PR or issue)
- Personal access tokens (PATs) or secrets beyond the repository default token

### Key Entities

- **`QueueItem`**: A projected, read-only view of one schema-valid `proposed` record,
  derived from committed frontmatter and the caller-supplied as-of instant. Contains all
  fields specified in FR-002. Never stored; computed on demand from the corpus snapshot.
  Includes an ordered list of `itemFindings` (`ItemFinding`s, zero or more). Files with
  schema-invalid frontmatter or cross-field invariant violations are never `QueueItem`s.

- **`SlaState`**: One of exactly seven enumerated values (`decided`, `escalated`,
  `overdue`, `due`, `within-sla`, `missing-sla`, `not-queued`), computed by the
  precedence rules in FR-005. Applies only to `QueueItem`s; corpus findings do not
  receive an `SlaState`.

- **`ItemFinding`**: An actionable finding attached to a specific `QueueItem` for
  queue-specific incompleteness or inconsistency in an otherwise schema-valid `proposed`
  record (absent `tier`, `reviewBy` before `queuedAt`, or empty `deciders` on a queued
  record). Contains a machine-readable finding code, severity (`warn` or `info`), and a
  human-readable description; identity comes from the parent `QueueItem`. Missing SLA
  data is represented by `slaState: missing-sla`, not a separate finding.
  Structurally distinct from `CorpusFinding`.

- **`CorpusFinding`**: A top-level finding for a file that cannot enter the `QueueItem`
  collection: schema-invalid or unparseable frontmatter, or an unsatisfied schema
  cross-field invariant (e.g., `one-way-door` + `tier: auto`). Contains `sourcePath`
  parser/validator details, a machine-readable code, severity `error`, and a
  human-readable description. Does not include `id`, `title`, `tier`,
  `slaState`, or any fabricated field. Appears in the `QueueReport`'s ordered top-level
  `corpusFindings` collection, structurally distinct from `ItemFinding`.

- **`QueueReport`**: The complete output of the queue kernel for one run. Contains: the
  resolved `asOf` UTC calendar date, a `corpusFingerprint` (for drift detection), a `version`
  field, an ordered list of `QueueItem`s (per FR-006), an ordered top-level
  `corpusFindings` list (zero or more `CorpusFinding`s), and summary counts (total
  queue items, total corpus findings, total items with item findings). Never stored;
  produced fresh on each run.

- **`ManagedQueueIssue`**: The dedicated GitHub issue created or updated by the GitHub
  Actions surface. Its body contains the deterministic Markdown queue report and a
  stable hidden ownership marker (e.g., an HTML comment). Created on first run; located
  by the ownership marker on subsequent runs and updated in place. Requires `GITHUB_TOKEN`
  with `issues: write`. Does not commit or modify any repository file. If an issue with
  the configured title exists without the ownership marker, the action fails rather than
  overwriting it (FR-020).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Given identical corpus, configuration, and as-of instant, two independent
  runs of the queue command produce byte-for-byte identical JSON output and byte-for-byte
  identical Markdown output.

- **SC-002**: A maintainer operating on a corpus with ten or more `proposed` records can
  identify all `overdue`, `due`, and `escalated` items — and all records with item
  findings — and all files with corpus findings — without opening any individual ADR
  file, using only the queue output.

- **SC-003**: The GitHub Actions surface updates the same managed GitHub issue body in
  place on every rerun, creating no duplicate issues, for a corpus that has not changed
  between runs.

- **SC-004**: The ADR-0014 rung-2 reference-verification gate is met: a maintainer-owned
  isolated reference repository runs the queue surface against a corpus with at least
  three `proposed` records spanning all three tiers (`auto`, `async`, `arb`), at least
  one SLA-boundary or overdue case, approvals and objections present, and the same
  managed GitHub issue body updated in place on a second run with default-token-only
  `issues: write` operation — reproducibly, self-verifyingly, with at least one
  **fail-closed** consumer-facing scenario (invalid input → fail before any GitHub
  write, zero issue mutation), and reviewed. Met by
  [`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood) (evidence:
  [checklists/reference-verification-evidence.md](./checklists/reference-verification-evidence.md)).
  This is reference verification, **not** external/community validation (ADR-0014 rung 3).

- **SC-005**: Files with schema-invalid frontmatter appear in the `QueueReport`'s
  `corpusFindings` collection with `sourcePath` and parser/validator details; no `id`,
  `title`, `tier`, `slaState`, or other fabricated field is emitted for them; the queue
  does not crash, does not silently omit them, and does not add them to the `QueueItem`
  collection.

- **SC-006**: Every field exposed in a `QueueItem` is traceable to a committed frontmatter
  field or the caller-supplied as-of instant. No queue item contains a fabricated tier,
  timestamp, SLA deadline, approver identity, quorum, or decision state.

- **SC-007**: The `clean-clone-builds` CI gate remains green after the queue surface
  packages are added; no credential, service, or network is required for post-install
  build, test, or local queue execution, and the Action's GitHub API client is exercised
  in tests without a token or network (Principle II, ADR-0007).

- **SC-008**: Error-severity findings are visible in the complete CLI output and managed
  issue body before their respective runs report failure; warning- and info-only reports
  complete successfully.

## Assumptions

- **A1**: The queue operates on a single, local, already-cloned ADR corpus.
  Multi-repository federation, named logs across repositories, and hosted index
  federation are explicitly out of scope for this feature (ADR-0004 Option A rationale;
  Phase 6 scope boundary; see Out of Scope above).

- **A2**: `review.queuedAt` in the ADR frontmatter is the canonical queue-entry
  timestamp. The queue surface reads it but never writes it. Writing `queuedAt` is a
  lifecycle action performed through a PR; it is not the queue surface's responsibility.

- **A3**: When both `reviewBy` and `review.slaDays` are present on the same record,
  `reviewBy` takes precedence as the explicit SLA deadline. `review.slaDays` is
  informational when `reviewBy` is set.

- **A4**: All entries in `review.approvals` count toward the approval count, regardless
  of whether they appear in `deciders`. Approver-vs-decider validation, if desired, is a
  future concern outside this scope.

- **A5**: The GitHub Actions managed queue surface is a dedicated GitHub issue — not a
  tracked repository file, not a GitHub Actions upload artifact, not a PR comment, and
  not an issue comment. The issue body contains the deterministic Markdown report and a
  stable hidden ownership marker. The action creates the issue on first run and updates
  the body in place on subsequent runs using only `GITHUB_TOKEN` with `issues: write`.
  The issue title is configurable. The action does not commit files or modify any
  tracked repository content.

- **A6**: The queue surface is a first-party, non-adapter consumer of `@adrkit/core`. It
  is not an adapter package and does not live under `packages/adapters/`. It depends on
  `@adrkit/core` for record parsing, schema validation, and graph traversal (Principle III,
  ADR-0007).

- **A7**: Phase 6 lands on ADR-0014 rungs 1–2. Rung 2 requires reproducible,
  self-verifying, fail-closed (at least one consumer-facing invalid-input → fail-before-write,
  zero-mutation scenario), reviewed evidence from a **maintainer-owned isolated reference
  repository** (SC-004) — which is met. External/community validation (ADR-0014 rung 3)
  is an optional later maturity signal, tracked honestly as open, and never a
  precondition for landing Phase 6 or for opening the next phase. The maintainer's own
  monorepo dogfood cleared rungs 1–5; the separate isolated reference repository
  (`adrkit-t018-dogfood`) clears rung 6's reference-verification requirement without
  requiring an external team.

- **A8**: The `auto` review tier means "expedited routing to a human reviewer" — not
  automated acceptance. A human still approves or rejects. No action taken by any queue
  surface constitutes acceptance of any record. (ADR-0005: "The evaluator routes; it never
  approves.")

- **A9**: The GitHub Actions surface uses `GITHUB_TOKEN` (the repository default token)
  and does not attempt to create PATs, rotate credentials, or escalate permissions. The
  required permission is `issues: write`; permission failures name this permission
  explicitly (FR-013). If the default token lacks `issues: write`, the failure is
  surfaced honestly and not silently suppressed.

- **A10**: This feature does not add a fifth MCP tool, a write MCP tool, or any HTTP
  service. The queue surface is a CLI command and a GitHub Actions workflow step. Any
  future MCP integration that exposes queue data is a separate, explicitly-scoped feature.

- **A11**: The `review.objections` array entries carry a `resolved` boolean field (per
  the committed schema). `unresolvedObjectionCount` is the count of entries with
  `resolved: false` (or defaulted false); `resolvedObjectionCount` is the count with
  `resolved: true`. The queue surface reads these values and does not infer resolution
  state from other fields.
