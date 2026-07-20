# Feature Specification: Deterministic Evaluator (Pass 0)

**Feature Directory**: `005-deterministic-evaluator` (not a git branch — this feature
is scoped in place; no branch is created or switched by this work)
**Created**: 2026-07-19
**Status**: Draft
**Phase**: 4 (outcome ladder rung 5, partial) — **Pass 0 only**
(project **Phase 4** ≠ outcome-ladder rung 4; per `plan.md`, Phase 4 is the
deterministic evaluator and delivers rung 5 partially. Rung 4 is the MCP server,
project Phase 5. Internal task/phase headings inside this feature are distinct from
the project phase.)
**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the
ADR wins):
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(deterministic-first evaluator, declarative escalation, "Pass 0 complete and
independently useful before any prompt is written"),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) (the eleven Pass 0 rules and
their severities — the rule contract),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is
truth; the CLI/core never require the index),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation, clean-clone build),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (pure
resolution, degradation-not-failure),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun toolchain, Node baseline), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles
I–V.

> **✅ Upstream gate cleared 2026-07-19.**
>
> Feature 004 T018 is checked with public second-repository evidence for 12 ADRs,
> selective two-ADR comment behavior, same-comment update, and default-token-only runs.
> Feature 005 T001/T002 record the evidence and engine decisions.

## Overview

Phase 0 made records valid, Phase 1 made them locatable, Phase 2 let a corpus move in,
and Phase 3 made the mapping visible on a pull request. This phase begins the **gate**:
the evaluator that **deterministically dispositions** an agent-generated (or human)
proposal — **returning** it on hard errors or **routing** it toward a review tier —
**without becoming theater and without over-gating** (ADR-0005). It never decides
acceptance; it computes a disposition and routes.

The deliverable of *this* feature is **Pass 0 only**: the **deterministic** layer of the
four-pass evaluator. Pass 0 runs first, uses **no model**, and short-circuits a proposal
before a single token is spent on the later (retrieval / rubric / adversarial) passes.
ADR-0005's first action item is explicit: **"Pass 0 complete and independently useful
before any prompt is written."** That sentence is the whole scope of this feature.

Pass 0 applies **exactly eleven rules** — the catalog fixed by `docs/EVALUATOR_RUBRIC.md`
— to a proposal plus a set of **caller-supplied, immutable input snapshots**. It emits a
runtime **`Pass0Report`** — an ordered, byte-for-byte reproducible record of all eleven
rule results and an ordered stream of declarative reason-code events — and returns a
schema-compatible **`evaluationPatch`** a later caller may propose through a git PR. It
**routes**; it never approves, accepts, merges, persists, or mutates any record or
acceptance state. Git is truth (ADR-0004): the evaluator reads snapshots and returns a
report plus a patch, and writes nothing itself.

The load-bearing property is **independent usefulness with no model**. Pass 0 must be a
genuinely useful deterministic gate on its own — a "useful linter with no model
available" (ADR-0005 Option A degradation row; Principle IV). If Pass 0 needs a model,
prompt, embedding, retrieval, or network to be useful, it is wrong.

## User Scenarios & Testing

> **User Story gating.** Every story below is **scoping only**. None may be *implemented*
> until the Phase 3 outcome gate (T018) clears. This mirrors feature 004's
> gate-then-build posture: the spec is written now; the code waits for the rung.

### User Story 1 — A structurally broken proposal is returned before any model runs (Priority: P1) 🎯 MVP

As a maintainer (or the agent pipeline) submitting a proposal, I want the deterministic
pass to catch schema, identity, supersession, and reference errors and **return** the
proposal immediately — before any model, prompt, or token spend — so the expensive passes
never run on a proposal that a linter would have rejected.

**Why this priority**: This is the rung — "Pass 0 complete and independently useful
before any prompt is written" (ADR-0005). Catching `error`-severity findings and
short-circuiting is the core value and the MVP. It is independently valuable with **no
model configured at all**.

**Independent Test**: Feed Pass 0 an offline fixture proposal that fails `schema-valid`
(malformed frontmatter) with no model configured; assert the `Pass0Report` marks the
proposal `returned`, lists the `schema-valid` error finding, records the remaining ten
rules as `not-evaluated` (so the report still carries exactly eleven rule results in
rubric order), emits eight `not-proven` routing statuses with `escalate=false` and a
`not-required` target, that later passes are **not** invoked, and that the CLI wrapper exits
`1`.

**Acceptance Scenarios**:

1. **Given** a proposal whose frontmatter does not parse/validate, **When** Pass 0 runs,
   **Then** it reports a `schema-valid` **error** finding, marks the proposal `returned`,
   records the other ten rules as `not-evaluated` in rubric order (a well-formed
   eleven-result event stream, not a bare early-exit payload), emits no escalation and a
   `not-required` target, does **not** run any later pass, and the CLI exits `1`.
2. **Given** a proposal whose `id` collides with another record in the **same normalized
   log** (`record.log ?? ""`), **When** Pass 0 runs, **Then** it reports an `id-unique`
   **error** and the proposal is `returned`; the same id in a different named log is not a
   collision.
3. **Given** a proposal with a non-reciprocal `supersedes`/`supersededBy` pair or a
   supersession cycle, **When** Pass 0 runs, **Then** it reports a
   `supersession-consistent` **error**.
4. **Given** a proposal with a `relatesTo`/`supersedes` target absent from the supplied
   corpus, **When** Pass 0 runs, **Then** it reports a `no-orphan-refs` **error** — and
   the same missing reference is **not** double-reported by another rule.
5. **Given** a proposal with **only** `warn`/`info` findings, **When** Pass 0 runs,
   **Then** the proposal is **not** `returned`, Pass 0 completes, and the CLI exits `0`.

### User Story 2 — The report is byte-for-byte reproducible and deterministically ordered (Priority: P1)

As an auditor (or a diff-based test), I want two runs of Pass 0 over identical inputs to
produce **byte-for-byte identical** reports and reason-code streams — apart from
caller-supplied run metadata — so the gate is reproducible and defensible to an examiner
(ADR-0005: "auditing why something escalated").

**Why this priority**: Reproducibility is what separates an auditable deterministic gate
from a flaky one. Without it, the report cannot be trusted, diffed, or frozen for drift
detection. Ships with US1.

**Independent Test**: Run Pass 0 twice over the same fixture bundle; assert the serialized
report and reason-code event stream are identical byte-for-byte after excluding any
caller-supplied metadata (e.g. a run id or timestamp the caller passed in).

**Acceptance Scenarios**:

1. **Given** identical input snapshots, **When** Pass 0 runs twice, **Then** the two
   serialized reports are byte-for-byte identical except for caller-supplied run metadata.
2. **Given** findings from several rules, **When** the report is serialized, **Then**
   findings are ordered **rubric-rule order first**, then by stable per-rule keys
   (candidate ADR, related ADR, assertion/matcher, path/message).
3. **Given** a proposal that fails `schema-valid` (returns immediately), **When** the
   report is produced, **Then** the `Pass0Report` is still **ordered** and well-formed —
   carrying `schema-valid` as `fail` and the remaining ten rules as `not-evaluated` in
   rubric order — not a bare early-exit payload.
4. **Given** no clock, network, or filesystem access inside the pure library, **When**
   Pass 0 runs, **Then** it produces its report without reading any of them — any time
   value comes from a caller-supplied `evaluationDate` / run metadata only.
5. **Given** the same set-like inputs in different orders, **When** Pass 0 serializes both
   runs, **Then** those set-like collections use their documented canonical comparator;
   fixed rubric/trigger arrays and declaration-ordered decider, CODEOWNERS, catalog-owner,
   matcher, and assertion arrays preserve their contract order rather than being globally
   sorted.

### User Story 3 — Pass 0 is independently useful with no model, offline, in a clean clone (Priority: P1)

As an adopter in an air-gapped or model-free environment, I want Pass 0 to be fully useful
with **no model configured, no network, no credentials, and no services** — so the gate
runs in a clean clone and never imports a model dependency (Principle II, Principle IV,
ADR-0005 degradation).

**Why this priority**: This is the ADR-0005 promise that the evaluator "falls back to a
useful linter with no model available," and the Principle II clean-clone gate applied to
the evaluator. It is exit criterion for the whole feature.

**Independent Test**: In a clean clone with no model/API key present, run every Pass 0
rule over offline fixtures; assert all eleven rules execute (pass/fail/inert as
appropriate), no model/prompt/embedding/network/service is invoked, and no model client
is even imported by the pure library.

**Acceptance Scenarios**:

1. **Given** no model, API key, network, or service, **When** Pass 0 runs the full rule
   set over fixtures, **Then** it completes and produces its report and reason-code
   stream.
2. **Given** the pure Pass 0 library, **When** its dependency graph is inspected, **Then**
   it imports **no** model client, prompt library, embedding library, retrieval store,
   adapter package, or network/clock/filesystem-traversal dependency (Principle III,
   ADR-0007).
3. **Given** a required backing input or engine is **absent** (e.g. no dependency/lock
   snapshot for a `package` matcher, no assertion engine registered), **When** Pass 0
   runs, **Then** that rule is reported **inert/degraded** — explicitly, never as a
   fabricated pass or fail (ADR-0009).
4. **Given** a clean clone, **When** the project's `clean-clone-builds` gate runs with the
   evaluator package present, **Then** it stays green with no credential, service, or
   network.

### User Story 4 — Every run logs ordered declarative reason-code events, and routes rather than approves (Priority: P2)

As a compliance owner, I want every Pass 0 run to emit — from day one — an ordered stream
of declarative reason-code events (rule id, status, fixed violation severity when failed,
machine reason code, involved refs), and I want the evaluator to **route** a proposal, not
approve it — so escalation is auditable and the gate never manufactures acceptance
(ADR-0005 action item 3; Principle I & IV; ADR-0004).

**Why this priority**: "Log every escalation decision with reason codes from day one" is
an explicit ADR-0005 action item, and "the evaluator never approves — it routes" is the
central safety property. Essential, but it rides on the rules (US1) producing results.

**Independent Test**: Run Pass 0 over a fixture that fails one rule; assert the event
stream contains an ordered event with the rule id, `fail` status, the rule's fixed
rubric severity, a machine reason code, and the involved ADR/assertion/matcher refs — and
assert that **no** record file, acceptance field, or `review` state was mutated by the
run.

**Acceptance Scenarios**:

1. **Given** any Pass 0 run, **When** it completes, **Then** it has emitted an **ordered**
   reason-code event per rule — with `pass` / `fail` / `inert` / `not-evaluated` status,
   the fixed rubric severity when `fail`, a machine reason code, and involved refs — with
   no internal timestamp or duration in the deterministic payload.
2. **Given** a run that produces `error` findings, **When** it completes, **Then** the
   proposal is marked `returned` and **no** ADR file, acceptance state, or `review` field
   is written or mutated.
3. **Given** a run whose evidence deterministically proves an ADR-0005/rubric escalation
   trigger, **When** it completes, **Then** the returned `evaluationPatch.escalate` is set
   and only the **existing** escalation reason code(s) for that proven trigger are emitted
   — no new reason code is invented, and later-pass-only reasons remain absent.
4. **Given** a run with only `warn`/`info` findings that still *recommends* escalation,
   **When** the CLI wrapper exits, **Then** it exits `0` (escalation is a routing
   recommendation, not a failure).
5. **Given** an escalated proposal, **When** Pass 0 resolves the routing target from
   caller-supplied immutable data (proposal `deciders`, then normalized CODEOWNERS
   candidates for resolved affected paths, then catalog owners for resolved affected
   entities, in that order), **Then** it emits the first named active human as the route
   target using the exact source/declaration order in FR-013a; encountering a team candidate
   with zero or multiple active human members is an **ambiguity barrier** that immediately
   returns `unresolved` without falling through to a later candidate or source. If no
   candidate resolves, it likewise emits `unresolved`; the escalation stays true, the absent
   target is **not** approval, and the exit code is unchanged.

### User Story 5 — The returned evaluation patch stays schema-compatible (Priority: P2)

As a schema owner, I want the `evaluationPatch` Pass 0 **returns** for a record's
`evaluation` field to match the **existing** schema (`deterministicFindings[]` of
`{ rule, severity, message?, adr? }`, `escalate`, and the existing `escalationReasons`
enum) — with any richer runtime detail kept **outside** the patch, on the `Pass0Report`
operational channel — so this feature changes no schema and surfaces any contract
limitation instead of silently extending fields (Principle V; ADR-0004). Pass 0 never
persists the patch itself; a later caller may propose it through a git PR.

**Why this priority**: The schema is a one-way-door contract (Principle V). A silent field
extension here is the exact failure Principle V exists to prevent. Important, but
downstream of the rules producing results.

**Independent Test**: Serialize the `evaluationPatch` Pass 0 returns and validate it
against the current committed schema; assert it validates with **no** schema change, that
`deterministicFindings` carries **violations only**, and that any richer runtime detail
(per-rule `inert`/`not-evaluated` status, machine reason codes, involved refs) lives on
the separate `Pass0Report` channel.

**Acceptance Scenarios**:

1. **Given** a Pass 0 result, **When** its returned `evaluationPatch` is produced,
   **Then** it validates against the current schema
   (`deterministicFindings[] { rule, severity, message?, adr? }`, `escalate`,
   `escalationReasons[]`) with no schema edit, and `deterministicFindings` contains
   **only** `error`/`warn`/`info` violations.
2. **Given** a runtime `Pass0Report` richer than the schema (e.g. per-rule `inert` or
   `not-evaluated` status, machine reason codes, involved matcher refs), **When** the
   `evaluationPatch` is produced, **Then** the richer detail stays on the **separate
   operational channel** and never becomes a fixed-severity violation in
   `deterministicFindings`.
3. **Given** a Pass 0 finding derived from a reused lower-level `Finding` (richer shape),
   **When** it is projected into `deterministicFindings`, **Then** it is mapped to a
   **rubric rule id** and reduced to the schema's four fields, with no duplicate or
   conflicting finding for the same underlying issue.

### Edge Cases

- **Proposal malformed (`schema-valid` fails)**: Pass 0 returns immediately for that
  proposal, but the emitted `Pass0Report` is still ordered and well-formed — `schema-valid`
  as `fail`, the other ten rules as `not-evaluated` in rubric order, all eight routing
  triggers as `not-proven`, `escalate=false`, and the target `not-required` (US1 AC1, US2
  AC3).
- **Reference missing**: a missing `relatesTo`/`supersedes` target is a `no-orphan-refs`
  finding; a missing `supersededBy` target is handled under `supersession-consistent` —
  **never double-reported** by both. Missing targets are not also reciprocity/cycle or
  orphan failures on the other rule (US1 AC4; Clarification C2).
- **Backing source absent**: a `package` matcher with no lock snapshot, an `entity`/
  `resource`/`api`/`data` matcher with no caller snapshot, an assertion engine not
  registered, a federated-ref log snapshot not supplied, or scope-contradiction evidence
  not supplied — each is **inert/degraded**, surfaced explicitly on the operational
  channel, never a fabricated pass/fail and never a declared orphan (ADR-0009).
- **`affects-resolvable` vs backing absent**: backing source **present** with **zero real
  resolved targets** → `affects-resolvable` **warn**; backing source **absent** → an
  operational **inert** result using `affects-resolvable.backing-absent`; a missing resolver
  port uses `affects-resolvable.resolver-absent`. The lower-level ADR-0009
  `affects-unresolvable` finding maps to this inert status, and neither path emits an
  `affects-resolvable` deterministic finding (Clarification C3).
- **`affects-overlap` pass reasons**: with no accepted ADRs, no pair exists and the pass
  reason is `affects-overlap.no-accepted-corpus`; when accepted ADRs exist and every
  applicable pair is fully evaluated with no intersection, the pass reason is
  `affects-overlap.none`. Neither path makes a probabilistic or prose guess.
- **`assertions-compile` vs `assertions-pass`**: a compile failure is an **error**; a
  compiled assertion that evaluates non-green is a **warn**. A missing engine/input is
  inert, not either.
- **`expiry-sane`**: `reviewBy` strictly after the caller-supplied `evaluationDate` →
  no violation; absent optional `reviewBy` → no violation; `reviewBy` equal to or before
  `evaluationDate` → **info**. No system clock is read.
- **`decider-resolvable`**: zero or ambiguous active matches in the supplied identity
  snapshot → **warn**. No live directory lookup.
- **Escalation with no resolvable named human**: after a proven escalation, if no named
  active human resolves from `deciders` → CODEOWNERS candidates → catalog owners, Pass 0
  emits an explicit `unresolved` route state and reason event. The escalation stays true;
  the missing target is **not** approval and does not change the exit code (Clarification
  C7).
- **Ambiguous team routing candidate**: when the next candidate in exact routing order is a
  team with zero or multiple active human members, resolution stops as `unresolved`; it does
  not skip the higher-priority team and route to a later owner.
- **Usage / input-contract error** (a required snapshot is malformed, or arguments are
  invalid, or the selected schema-valid ADR has status `accepted`, `rejected`, `superseded`,
  or `deprecated`): the CLI wrapper exits `2` without a `Pass0Report`/patch — distinct from a
  structurally invalid proposal that is `returned` by `schema-valid` (exit `1`).
- **Run with no failing rule**: Pass 0 completes, emits `pass`/`inert` events, exits `0`.
- **Escalation recommended on warn/info only**: Pass 0 completes and exits `0` even though
  it recommends escalation (routing ≠ failing).

## Requirements

### Functional Requirements

- **FR-001 — Pass 0 is a pure, model-free deterministic function.** The evaluator's Pass 0
  MUST be a pure function of its caller-supplied inputs (the full corpus lint/load result
  plus proposal path, resolution snapshots, assertion engine ports + immutable assertion
  input snapshots, identity directory snapshot, optional scope-contradiction evidence
  snapshot, and `evaluationDate`; caller run metadata is carried outside the pure evaluator
  payload). It MUST NOT read the system clock, the
  network, or the filesystem beyond its supplied inputs; MUST NOT perform any model call,
  prompt, retrieval, embedding, rubric scoring, or adversarial pass; and MUST NOT depend
  on or import any model/prompt/embedding/retrieval library or any adapter package
  (Principle III & IV, ADR-0007, ADR-0009). The library performs **no** filesystem
  traversal, network access, or clock read of its own.

- **FR-002 — Exactly the eleven rubric rules, at their fixed severities.** Pass 0 MUST
  implement **exactly** the eleven rules of `docs/EVALUATOR_RUBRIC.md` at their fixed
  severities and MUST NOT add, remove, rename, or re-severity any rule:

  | Rule | Severity | Deterministic check (this spec's binding of the rubric) |
  |---|---|---|
  | `schema-valid` | error | Proposal frontmatter parses and validates. Reuses parse/schema findings. If the proposal is malformed, Pass 0 returns immediately for it, but the report stays ordered. |
  | `id-unique` | error | Proposal `id` is unique within its normalized log (`record.log ?? ""`). The same id in a different named log is valid; only same-log duplicates collide. |
  | `supersession-consistent` | error | `supersedes`/`supersededBy` are reciprocal and acyclic. A missing `supersededBy` target is reported here once; missing `supersedes` targets belong to `no-orphan-refs`. |
  | `no-orphan-refs` | error | Every `relatesTo` / `supersedes` target exists in the supplied corpus. A missing `supersededBy` target is handled by `supersession-consistent`, not here. Federated refs require supplied log snapshots; a missing external log snapshot is **inert/degraded**, not a declared orphan. |
  | `affects-resolvable` | warn | Each matcher resolves to ≥1 real target in the supplied snapshots. `path` uses the complete tracked-path inventory; `package` uses the dependency/lock snapshot; `entity`/`resource`/`api`/`data` use caller snapshots. A **missing backing source** is **inert/degraded** (ADR-0009), not a warn. |
  | `affects-overlap` | warn | Compare **finite resolved target identities** against **accepted** ADRs only. Warn **once per proposal/accepted pair** with stable evidence. With no accepted ADRs, pass as `no-accepted-corpus`; with accepted ADRs but no intersection, pass as `none`. No probabilistic overlap, no prose analysis. |
  | `scope-hierarchy` | error | A `component` proposal errors **only** on **deterministic contradiction evidence** against an accepted `org` ADR assertion in the same applicable domain/overlap, drawn from supplied pure assertion/scope evidence ports/snapshots. No semantic prose inference. Missing evidence is **inert/degraded** and surfaced. |
  | `assertions-compile` | error | Each assertion must declare exactly one source, and that source parses via the caller-supplied deterministic engine registry. A declared `expressionFile` whose supplied content is absent is inert. |
  | `assertions-pass` | warn | Compiled assertions evaluate green against the supplied immutable input snapshot; missing input is inert. |
  | `decider-resolvable` | warn | Every declared decider resolves unambiguously to one active principal in the supplied directory snapshot; none declared, zero match, or ambiguous match → warn. |
  | `expiry-sane` | info | `reviewBy` is strictly after the caller-supplied `evaluationDate`. Absent `reviewBy` → no violation; equal/past → info. |

- **FR-003 — Short-circuit and routing semantics.** If Pass 0 produces any
  **`error`-severity** finding, the proposal MUST be marked `returned` and the later
  passes MUST NOT run. A malformed proposal that fails `schema-valid` cannot be evaluated
  by the ten typed rules, so those results MUST be `not-evaluated`; otherwise Pass 0 MUST
  continue through every still-evaluable deterministic rule even after an error so the
  caller receives complete Pass 0 feedback. A rule whose prerequisite failed (for example,
  `assertions-pass` after `assertions-compile` failed) MUST be `not-evaluated`. The
  `Pass0Report` for an evaluated candidate always carries **exactly eleven** rule results in
  rubric order (FR-011). A schema-valid non-proposal status is rejected by the input
  contract before rule evaluation and produces no report/patch (FR-013). A
  proposal with only `warn`/`info` findings MUST NOT be `returned`; Pass 0 completes. For
  every evaluated candidate, the evaluator **routes** and computes a disposition: it MUST
  NOT approve, accept, merge, persist, or change any acceptance/`review` state (ADR-0005;
  Principle IV). On
  `schema-valid` failure, no trigger can be proven from a typed proposal: the routing block
  therefore contains eight ordered `not-proven` statuses, `escalate=false`, no escalation
  reasons, and target `not-required`; the patch carries only the schema violation.

- **FR-004 — Deterministic ordering.** All findings and reason-code events MUST be ordered
  **rubric-rule order first**, then by stable per-rule secondary keys (candidate ADR,
  related ADR, assertion/matcher id, path/message). Ordering MUST be total and stable so
  output is diffable. Canonicalization MUST sort only **set-like** collections by their
  documented comparator. Contract-ordered arrays — including rubric results, routing
  evidence/reasons, proposal deciders, CODEOWNERS rules and owners, catalog owners, matchers,
  and assertions — MUST preserve fixed or declaration order.

- **FR-005 — Byte-for-byte reproducibility.** Two runs over identical inputs MUST produce
  byte-for-byte identical serialized reports and reason-code streams, apart from
  caller-supplied run metadata. No internal timestamp, duration, random value, iteration
  order, or environment read may enter the deterministic payload.

- **FR-006 — No model/network/clock/fs dependency, provable in CI.** The pure Pass 0
  library MUST NOT import a model client, prompt/embedding/retrieval library, adapter
  package, or a network/clock/filesystem-traversal dependency, and this MUST be
  verifiable by the project's dependency-graph gate (the `core-has-no-adapter-deps`
  posture extended to the evaluator) and by the `clean-clone-builds` gate staying green
  (Principle II & III, ADR-0007).

- **FR-007 — Inert/degraded is explicit, never fabricated.** When a required external
  backing input or engine is missing, the affected rule MUST report an **inert/degraded**
  result that is surfaced explicitly; it MUST NOT be reported as a pass or a fail
  (ADR-0009). Rubric violation severities MUST remain exactly as FR-002 — inert status
  MUST NOT be expressed as a new severity on a fixed-severity rule.

- **FR-008 — Inert/degraded lives on the `Pass0Report`, never as a violation.** Because
  the schema's `deterministicFindings` carries only `{ rule, severity, message?, adr? }`
  under fixed per-rule severities, an `inert` (or `not-evaluated`) result cannot be
  expressed there without inventing a violation on a rule whose rubric severity is fixed
  (which would change the rubric). Pass 0 MUST therefore carry `inert`/`not-evaluated`
  status (and per-run reason-code events, FR-011) on the **`Pass0Report` operational
  rule-result/event channel**, NOT in `evaluationPatch.deterministicFindings`. Inert or
  degraded results MUST NEVER be promoted into a fixed-severity violation. **Resolved:
  Clarification C1.**

- **FR-009 — Schema-compatible returned patch; Pass 0 never persists.** The
  `evaluationPatch` Pass 0 **returns** MUST validate against the current committed schema —
  `deterministicFindings[]` of `{ rule, severity, message?, adr? }` (**violations only**),
  `escalate`, `escalationReasons[]` — with **no** schema change in this feature. The runtime
  `Pass0Report` MUST be richer, but the returned patch MUST be schema-compatible, and any
  detail that does not fit MUST be surfaced as a contract limitation on the operational
  channel, never silently written into an extended field (Principle V). Pass 0 itself
  **persists nothing and mutates nothing**; a later caller may propose the returned patch
  through a git PR (ADR-0004). **Resolved: Clarification C6.**

- **FR-010 — Rubric-rule public contract; explicit mapping of reused findings.** The Pass 0
  public contract MUST key findings by **rubric rule id** (the eleven ids of FR-002). Where
  Pass 0 reuses existing lower-level `Finding`s (whose rule names differ, e.g.
  `unique-id`, `dangling-supersedes`, `strict-unknown-key`, `affects-unresolvable`), each
  reused finding MUST be **explicitly mapped** to its rubric rule id, with **no duplicate
  or conflicting** finding emitted for the same underlying issue. The mapping is spelled
  out in Clarifications C2 and C3.

- **FR-011 — Eleven-result reason-code event log from day one.** Every evaluated
  `draft`/`proposed` Pass 0 run MUST emit
  an **ordered** stream of declarative reason-code events — **exactly one per rubric rule,
  eleven total, in rubric order** — each carrying: the rule id, a status of `pass` /
  `fail` / `inert` / `not-evaluated`, the rule's **fixed** violation severity when `fail`,
  a **machine reason code**, and the involved ADR/assertion/matcher refs. `not-evaluated`
  is an operational state for rules not reached (e.g. after a `schema-valid` short-circuit),
  **not** a rubric finding or severity. The deterministic event payload MUST contain **no**
  internal timestamp or duration; any caller-supplied run metadata MAY be attached
  **outside** the deterministic payload (ADR-0005 action item 3). **Resolved:
  Clarification C11.** When a rule aggregates multiple sub-checks, status precedence is
  **`fail` > `inert` > `pass`**; `not-evaluated` is reserved for explicit prerequisite
  failure. The primary reason code is selected by a fixed per-rule reason-code order, while
  all underlying findings remain available, so mixed outcomes never depend on discovery
  order.

- **FR-012 — Escalation only on deterministically proven triggers; no new reason codes.**
  The returned `evaluationPatch.escalate` MUST be set and an escalation reason emitted
  **only** when an ADR-0005/rubric escalation trigger is **deterministically proven** from
  Pass 0 evidence. Only the **existing** `EscalationReason` enum values may be emitted;
  Pass 0 MUST NOT invent a new reason code (in particular, **no** `pass-zero-error`
  reason). These triggers are **routing conditions evaluated after the eleven rules, not a
  twelfth rubric rule.** The exact Pass-0-provable subset is fixed in Clarification C4:
  `one-way-door`, `cost-threshold`, `security-surface`, `data-residency`, `regulatory`,
  `contradicts-accepted-adr`, `agent-authored-production`, and `human-requested`. The
  later-pass-only reasons `low-confidence`, `pass-disagreement`, and `novel-no-precedent`
  MUST remain **absent / not evaluated**. Missing evidence for an optional trigger means
  **not proven / no reason** — reflected in the operational routing-evidence status, never
  fabricated as proof. **Resolved: Clarification C4.**

- **FR-013 — Exit-code contract.** The CLI wrapper MUST exit: **`1`** when Pass 0 returns a
  proposal (any `error` finding); **`0`** when Pass 0 completes with only `warn`/`info`
  findings — **even if escalation is recommended**; and **`2`** on a usage / input-contract
  error (invalid arguments, a malformed required snapshot, or a schema-valid selected ADR
  whose status is not `draft`/`proposed`). `accepted`, `rejected`, `superseded`, and
  `deprecated` candidates produce the typed `candidate-status-not-proposal` input error,
  no report/patch, and exit `2`; this is not a twelfth rule. An `unresolved` routing target
  after escalation does **not** silently approve and does **not** change these exit codes
  absent a rubric `error`. Exit `0` never means "approved."

- **FR-013a — Escalation routes to a named human (in scope).** After a proven escalation
  (FR-012), Pass 0 MUST deterministically resolve the routing target from caller-supplied
  immutable data, in ADR-0005 order: proposal `deciders`, then normalized CODEOWNERS
  candidates for the **resolved affected paths**, then catalog owners for the **resolved
  affected entities**. Within those sources: deciders preserve proposal declaration order;
  unique resolved paths are sorted by canonical path key, each path uses the **last matching
  CODEOWNERS rule** in declaration order, and that rule's owners preserve declaration order;
  unique resolved entity ids are sorted by canonical target key and each entity's catalog
  owners preserve snapshot declaration order. Candidate principals are stable-deduplicated by
  first occurrence — they are never globally identity-sorted. A direct inactive/missing human
  is skipped. A team candidate resolves only when it has exactly one active human member;
  zero or multiple active human members are an **ambiguity barrier** that immediately returns
  `unresolved` without considering later candidates or sources. If the ordered candidates are
  exhausted, Pass 0 likewise emits `unresolved`. The escalation remains true; lack of a target
  is **not** approval and does **not** invent an escalation reason. `decider-resolvable`
  remains the fixed **warn** rule for zero/ambiguous decider identity resolution; this
  fallback routing is **operational routing behavior, not a twelfth rule** (ADR-0005).
  **Resolved: Clarification C7.** When escalation is not proven, named-human resolution does
  not run and the target state is explicitly `not-required`.

- **FR-014 — No mutation, no database, no index, no network.** Pass 0 MUST NOT write,
  mutate, or delete any ADR file, acceptance state, or `review` field; MUST NOT require or
  write a database/index; and MUST NOT require credentials, services, or network (ADR-0004;
  Principle I). It reads caller-supplied snapshots and produces a report + event stream
  only.

- **FR-015 — Assertion engines are caller-supplied, deterministic ports.** All four schema
  engines — `rego`, `jsonpath`, `grep`, and `custom` — participate **only** through the
  **registered, caller-supplied deterministic engine ports**. Pass 0 MUST NOT shell out,
  start a service, reach the network, execute an arbitrary command, or call a model to
  compile or evaluate an assertion. `rego` and `jsonpath` are **required conformance
  engines** for feature completion; `grep` and `custom` are supported **only when
  registered** and are otherwise **inert** — Pass 0 MUST NOT invent semantics for them. A
  missing engine or input is inert; a compile failure is an `assertions-compile` **error**;
  a green-failing evaluation is an `assertions-pass` **warn**. **Resolved: Clarification
  C5.** Each engine port MUST own a generic, opaque compiled-payload type. A successful
  compile/artifact-validation result carries that immutable payload directly into the same
  port's `evaluate` call; the evaluator MUST NOT inspect it, recompile it, or recover it from
  hidden mutable registry state, and the public type design MUST require no `any`/`unknown`
  cast to pair compile with evaluate.

- **FR-016 — Concrete input contract.** Pass 0 MUST accept, as caller-supplied inputs: one
  proposal path identifying a candidate within the full corpus lint/load result
  **including** malformed-file findings (the typed `draft`/`proposed` exists only after
  `schema-valid`; a schema-valid non-`draft`/`proposed` record is the
  `candidate-status-not-proposal` input-contract error from FR-013; plan→ADR conversion is
  out of scope); the
  optional immutable federated-log snapshots needed to resolve cross-log references; the
  complete caller-supplied snapshots for repo tracked-path / package-lock / catalog /
  resource / API / data target inventories **as applicable**, plus the optional current
  target-resolution log identity used by ADR-0009 `repo` qualification (distinct from each
  corpus record's source `log`); the assertion engine ports
  plus immutable assertion input snapshots; the identity directory snapshot; the optional
  scope-contradiction evidence snapshot; and the caller-supplied `evaluationDate`. Any run
  timestamp/metadata belongs to the outer caller envelope, not `Pass0Input`. Pass 0 MUST NOT
  discover any of these by traversing the
  filesystem, reading a clock, or hitting the network. The CLI wire bundle MUST be a strict,
  versioned `adrkit.pass0.snapshot/v1` JSON DTO containing data only; it MUST reject malformed
  or unknown present data with exit `2`, normalize omitted optional backing to inert runtime
  containers, and inject executable resolver/assertion ports separately. Assertion snapshot
  keys MUST be the compact standard
  `JSON.stringify([record.log ?? "", record.path, assertion.id])` result with no added
  whitespace, not ADR id. A supplied key that parses to the same tuple but is not byte-equal
  to that canonical string is malformed input (exit `2`), so duplicate ADR ids cannot alias
  inputs while independent rules continue.

### Key Entities

- **Proposal candidate**: one path selected from the full corpus lint/load result. It becomes
  a typed `draft`/`proposed` ADR only after `schema-valid`; Pass 0 can therefore report a
  malformed candidate without pretending it parsed. A schema-valid `accepted`, `rejected`,
  `superseded`, or `deprecated` selection is rejected as an input-contract error (exit `2`),
  not evaluated as a proposal. It is never mutated.
- **Pass 0 rule catalog**: the eleven fixed rules and severities of FR-002 — the rule
  contract, keyed by rubric rule id.
- **Input snapshot bundle**: the caller-supplied, immutable **data** inputs of FR-016
  (target inventories, federated logs, assertion inputs, identity snapshot, optional
  scope/routing evidence). Executable ports are injected separately by the composition
  boundary; `evaluationDate` is a required argument; run metadata remains outside
  `Pass0Input`.
- **Deterministic finding (rubric-keyed)**: `{ rule (rubric id), severity (fixed),
  message?, adr? }` — the public finding shape, schema-compatible with
  `deterministicFindings`. Carries **violations only**.
- **Rule-result / reason-code event**: the per-rule operational record — rule id, status
  (`pass`/`fail`/`inert`/`not-evaluated`), fixed severity when `fail`, machine reason code,
  involved refs — carried on the `Pass0Report` operational channel distinct from
  `deterministicFindings` (FR-008, FR-011).
- **`Pass0Report` (runtime)**: the full, non-persisted report — exactly eleven ordered
  rule results/events, plus routing evidence and any inert/degraded/`not-evaluated`
  status. Byte-for-byte reproducible apart from caller-supplied run metadata; carries the
  richer detail that does not fit the schema.
- **`evaluationPatch` (returned)**: the schema-compatible `evaluation` object Pass 0
  **returns** (`deterministicFindings[]` violations-only, `escalate`,
  `escalationReasons[]`) — never persisted or mutated by Pass 0; a later caller may propose
  it through a git PR, never authoritative decision content (ADR-0004).
- **Routing target**: the escalation route resolved from caller-supplied immutable data
  (`deciders` → CODEOWNERS candidates for resolved affected paths → catalog owners for
  resolved affected entities), yielding a **named active human** or an explicit
  `unresolved` route state; when no escalation is proven, the target is `not-required`
  (FR-013a).
- **Pass 0 outcome**: `returned` (any error) | `ok` (no error), plus the
  routing recommendation and the human/`--json` payload the CLI consumes. Never
  `approved`.

## Success Criteria

- **SC-001**: A proposal that fails any `error` rule (`schema-valid`, `id-unique`,
  `supersession-consistent`, `no-orphan-refs`, `scope-hierarchy`, `assertions-compile`) is
  marked `returned`, later passes do not run, and the CLI exits `1`; unless
  `schema-valid` failed, every still-evaluable Pass 0 rule still reports so the caller gets
  complete deterministic feedback. (rung 5 core)
- **SC-002**: A proposal with only `warn`/`info` findings completes Pass 0 and the CLI
  exits `0`, even when escalation is recommended.
- **SC-003**: Each of the eleven rules has offline fixtures exercising **pass**, **fail**,
  and — where applicable — **inert** outcomes, all runnable with **no model configured**.
  The matrix includes same-id/same-log collision and same-id/different-log pass cases, plus
  `affects` include+negation, negation-only, same-`repo`, and different-`repo` cases against
  an explicitly supplied target-resolution log using ADR-0009 semantics.
- **SC-004**: Two runs over identical inputs produce byte-for-byte identical serialized
  reports and reason-code streams (excluding caller-supplied run metadata), with only
  set-like arrays canonical-sorted and every fixed/declaration-ordered array preserved.
- **SC-005**: Findings and events are ordered rubric-rule-first then by stable per-rule
  keys, verified against a fixed expected ordering fixture.
- **SC-006**: The pure Pass 0 library imports **no** model/prompt/embedding/retrieval
  library, adapter package, or network/clock/filesystem-traversal dependency — asserted by
  the dependency-graph gate; `clean-clone-builds` stays green with the evaluator present.
- **SC-007**: Every rule with an external backing input has an **inert/degraded** fixture
  proving it reports inert (not pass, not fail) when the input/engine is absent.
- **SC-008**: The returned `evaluationPatch` validates against the current committed
  schema with **no** schema change and carries **violations only** in `deterministicFindings`;
  richer runtime detail (inert/`not-evaluated` status, reason codes, routing evidence) lives
  on the separate `Pass0Report` channel; Pass 0 persists nothing.
- **SC-009**: Every reused lower-level `Finding` is mapped to exactly one rubric rule id
  with no duplicate/conflicting finding for the same underlying issue (verified for at
  least `id-unique`←`unique-id`, `no-orphan-refs`←`dangling-supersedes`/`dangling-relatesTo`,
  `supersession-consistent`←`dangling-supersededBy`, `schema-valid`←parse/contract). The
  `affects-unresolvable` (info) finding maps to an **operational inert status only** — it
  is **never** an `affects-resolvable` deterministic violation (Clarification C3).
- **SC-010**: A run emits an ordered reason-code event for **each of the eleven rules
  (eleven total, in rubric order)** with rule id, status (`pass`/`fail`/`inert`/
  `not-evaluated`), fixed severity when `fail`, machine reason code, and involved refs —
  with no internal timestamp/duration in the deterministic payload.
- **SC-011**: `evaluationPatch.escalate` and escalation reasons are emitted **only** on
  deterministically proven triggers, drawn only from the fixed Pass-0 subset (`one-way-door`,
  `cost-threshold`, `security-surface`, `data-residency`, `regulatory`,
  `contradicts-accepted-adr`, `agent-authored-production`, `human-requested`), use only
  existing enum values, invent no new reason code, and leave the later-pass-only reasons
  (`low-confidence`, `pass-disagreement`, `novel-no-precedent`) absent (Clarification C4).
- **SC-012**: No Pass 0 run writes or mutates any ADR file, acceptance state, or `review`
  field; the pure library reads no clock/network/filesystem; no database/index is required.
- **SC-013 (gate)**: **Feature 005 implementation does not begin until
  `specs/004-ci-surface/tasks.md` T018 is checked off with evidence** (second repo,
  >10 records, selective comment, same-comment update, default token only). This is the
  Phase 3 outcome gate; scoping proceeds now, building does not.
- **SC-014**: On a proven escalation, Pass 0 resolves the routing target from
  caller-supplied immutable data in ADR-0005 order (`deciders` → CODEOWNERS candidates for
  resolved affected paths → catalog owners for resolved affected entities), emitting either
  a named active human or an explicit `unresolved` route state/reason event — with exact
  decider/CODEOWNERS/catalog ordering, last-matching-rule CODEOWNERS semantics, and an
  immediate `unresolved` ambiguity barrier for a team with zero or multiple active humans;
  no change to the exit code (Clarification C7).
- **SC-015**: A malformed proposal (`schema-valid` fails) still yields a well-formed
  `Pass0Report` of **exactly eleven** rule results in rubric order — `schema-valid` `fail`
  and the other ten `not-evaluated` — plus eight `not-proven` routing statuses,
  `escalate=false`, and target `not-required`, never a bare early-exit payload
  (Clarification C11).

## Assumptions

Documented, ADR-consistent choices (revisit at plan stage; none is a one-way door — the
ADRs and rubric fix the semantics they implement):

- **A1 — Caller owns all I/O.** Every input (corpus load, target inventories, assertion
  input snapshots, identity snapshot, scope evidence, `evaluationDate`) is produced by the
  caller (CLI/CI surface) and handed to Pass 0 as immutable data. Pass 0 does no traversal,
  no clock read, no network (FR-001, FR-016; ADR-0009 purity).
- **A2 — Reuse Phase 0/1 machinery.** Pass 0 reuses the existing parser, schema validator,
  corpus-invariant checks, graph builder (for supersession reciprocity/cycles), and pure
  `affects` resolver, mapping their lower-level `Finding`s to rubric rule ids (FR-010).
  It adds no second parser or resolver. Target-set resolution preserves ADR-0009's per-ADR
  semantics: at least one positive matcher is required, matching negations subtract/suppress
  after positive matching, and `repo` qualifiers are evaluated only against the caller's
  target-resolution log context, not the ADR record's source-log identity.
- **A3 — Rubric rule ids are the public contract.** Consumers see the eleven rubric ids,
  not internal lint rule names; the mapping layer is an implementation seam, made explicit
  in Clarifications C2 and C3.
- **A4 — `affects-resolvable` vs ADR-0009 inertness are two concepts.** A matcher that
  resolves to **zero** targets **when its backing source is present** is an
  `affects-resolvable` **warn**; a matcher whose backing source is **absent** is
  **inert/info** per ADR-0009. The existing `affects-unresolvable` (info) finding maps to
  the evaluator's `affects-resolvable.backing-absent` operational reason, while a registry
  miss uses `affects-resolvable.resolver-absent`; neither becomes an
  `affects-resolvable` warn. This distinction is load-bearing and resolved in C3.
- **A5 — Assertion engines are ports.** All four schema engines (`rego`, `jsonpath`,
  `grep`, `custom`) participate only through registered deterministic caller-supplied
  ports; `rego`/`jsonpath` are required conformance engines, `grep`/`custom` are inert
  unless registered (FR-015, Clarification C5). No shelling out, service, or model.
- **A6 — Returned patch is minimal; `Pass0Report` is richer.** The returned
  `evaluationPatch` stays within the current schema (violations only); the reason-code
  events, inert/`not-evaluated` statuses, and routing evidence ride the `Pass0Report`
  operational channel (FR-008, FR-009). Pass 0 persists nothing (Clarification C1, C6).
- **A7 — Placement is a first-party non-adapter surface.** The evaluator is a first-party
  package (peer of the CLI/CI surfaces, e.g. `packages/evaluator/**` as ADR-0005's
  `affects` pattern already anticipates), depending only on `@adrkit/core` and vetted
  deterministic libraries, never on an adapter or a model client (Principle III, ADR-0007).
  Exact package layout is a plan-stage decision.
- **A8 — Bun toolchain.** Built, tested, and bundled with Bun; published artifacts target
  Node `>=22` (ADR-0010).

## Clarifications

### Session 2026-07-19

The following contract tensions — previously surfaced as Gated Contract Decisions
GC-1…GC-6 plus scoping questions — are now **resolved** as maintainer-compatible
decisions grounded in ADR-0005, `docs/EVALUATOR_RUBRIC.md`, ADR-0009, and the
constitution. They are recorded here as binding for plan/implementation; none adds,
renames, or re-severities a rubric rule, and none changes the schema.

- **C1 — Operational channel: `Pass0Report` vs `evaluationPatch` (was GC-1).** The runtime
  `Pass0Report` carries the ordered `ruleResults` / reason-code events with status
  `pass | fail | inert | not-evaluated` and machine reason codes. The returned
  `evaluationPatch.deterministicFindings` includes **violations only** and uses the
  **existing** schema shape (`{ rule, severity, message?, adr? }`). Inert or degraded
  results **never** become fixed-severity violations. Caller-supplied run metadata sits
  **outside** the deterministic payload (FR-008, FR-011).
- **C2 — Missing-target ownership, reported once (was GC-2).** `dangling-supersededBy` maps
  **only** to `supersession-consistent`; `dangling-supersedes` and `dangling-relatesTo` map
  **only** to `no-orphan-refs`. No double report: a missing target is **not** also a
  reciprocity/cycle failure, and a reciprocity/cycle failure is **not** also an orphan
  finding (FR-010, US1 AC4).
- **C3 — `affects-resolvable` warn vs inert backing/port (was GC-3).** Backing source
  **present** with **zero real resolved targets** ⇒ `affects-resolvable` **warn**. Backing
  source **absent** ⇒ operational reason `affects-resolvable.backing-absent`; resolver port
  absent ⇒ operational reason `affects-resolvable.resolver-absent`. Both are **inert** and
  emit no deterministic finding. The lower-level ADR-0009 `affects-unresolvable` finding
  maps to `backing-absent`; it is not itself the evaluator reason code and never becomes an
  `affects-resolvable` violation (FR-008, SC-009, A4).
- **C4 — Exact Pass-0 escalation subset, as routing conditions (was GC-4).** Escalation
  triggers are evaluated as **routing conditions after the eleven rules — not extra rubric
  rules**. The Pass-0-provable subset, using only existing `EscalationReason` enum values,
  with its exact deterministic evidence:
  - `one-way-door` — from `proposal.reversibility`.
  - `cost-threshold` — **only** from caller-supplied normalized cost/threshold evidence.
  - `security-surface` — **only** when resolved targets intersect the caller-supplied
    security-sensitive target snapshot.
  - `data-residency` — **only** from caller-supplied classified-target / region-boundary
    evidence.
  - `regulatory` — from non-empty `complianceControls` **or** resolved targets intersecting
    the caller-supplied regulated-target snapshot.
  - `contradicts-accepted-adr` — **only** when `affects-overlap` identifies an accepted ADR
    **and** that accepted ADR's assertion deterministically fails on the supplied assertion
    input.
  - `agent-authored-production` — **only** when `provenance.authoredBy` ≠ `human` **and**
    resolved targets intersect the caller-supplied production-target snapshot.
  - `human-requested` — **only** from an explicit caller input identifying the requester.

  The later-pass-only reasons `low-confidence`, `pass-disagreement`, and
  `novel-no-precedent` remain **absent / not evaluated**. These are exactly existing enum
  values; **no** new escalation reason (no `pass-zero-error`). Missing evidence for an
  optional trigger means **not proven / no reason**, reflected in operational routing
  evidence status rather than fabricated proof (FR-012, SC-011).
- **C5 — Assertion engine participation (was GC-5).** All schema engines (`rego`,
  `jsonpath`, `grep`, `custom`) participate **only** through registered deterministic
  engine ports; a missing engine/input is **inert**; no shell, network, service, arbitrary
  command, or model. `rego` and `jsonpath` are **required conformance engines** for
  completion; `grep` and `custom` are supported **only when registered** and are otherwise
  inert. Compile/artifact validation returns the engine's generic opaque immutable payload
  and evaluation receives that exact value through the same typed port — no recompile,
  hidden mutable registry cache, or unsafe cast (FR-015, A5).
- **C6 — No schema change; Pass 0 never persists (was GC-6).** This feature makes **no**
  schema change. The evaluator **never persists or mutates** records; it **returns** a
  schema-compatible `evaluationPatch` that a **later caller may propose through a git PR**.
  Any richer detail remains on the runtime `Pass0Report` / operational events (FR-009,
  Principle V, ADR-0004).
- **C7 — Escalation routes to a named human (IN SCOPE).** Routing to a named human is **in
  scope**. After escalation, Pass 0 deterministically resolves the target in ADR-0005 order
  from caller-supplied immutable data: proposal `deciders`, then normalized CODEOWNERS
  candidates for the resolved affected paths, then catalog owners for the resolved affected
  entities. Deciders preserve declaration order. CODEOWNERS paths are canonical-sorted,
  each path uses its last matching declared rule, and owners preserve that rule's declaration
  order. Catalog entities are canonical-sorted and their owner arrays preserve declaration
  order; both source lists stable-deduplicate on first occurrence. A team with anything other
  than exactly one active human is an ambiguity barrier: return `unresolved` immediately and
  do not continue fallback. If ordered candidates exhaust, Pass 0 also emits `unresolved`.
  The escalation remains true; a missing target is **not** approval and does **not** invent an
  escalation reason. `decider-resolvable` stays the fixed **warn** rule for zero/ambiguous
  decider identity resolution; fallback routing is **operational routing behavior, not a
  twelfth rule** (FR-013a, SC-014).
- **C8 — Phase metadata: rung 5 (partial).** Project **Phase 4** corresponds to outcome
  ladder **rung 5 (partial)**, not rung 4 (per `plan.md`). Rung 4 is the MCP server
  (project Phase 5). Internal task/phase headings within this feature are distinct from the
  project phase.
- **C9 — Disposition/routing, never acceptance.** The evaluator computes a deterministic
  **disposition** and **routes**; it **never decides acceptance**. Wording that the
  evaluator "decides whether ready" is replaced throughout.
- **C10 — Exit semantics preserved.** An `error` finding ⇒ `returned` / exit `1`;
  `warn`/`info`-only ⇒ `ok` / exit `0` **even when escalation is recommended**; a
  malformed invocation, snapshot-contract violation, or schema-valid non-proposal candidate
  (`accepted`/`rejected`/`superseded`/`deprecated`) ⇒ input-contract exit `2` with no
  report/patch. An `unresolved` routing target does **not** silently approve and does **not**
  change these exit codes absent a rubric `error` (FR-013).
- **C11 — Well-formed event stream on schema-invalid return.** Pass 0 evaluates
  `schema-valid` first; on failure it records the remaining ten rules as `not-evaluated`,
  so the `Pass0Report` always carries **exactly eleven** rule results in rubric order. The
  status enum is `pass | fail | inert | not-evaluated`. `not-evaluated` is an **operational
  state, not a rubric finding or severity**. The routing block remains structurally complete:
  all eight triggers are `not-proven`, escalation is false, reasons are empty, and the target
  is `not-required`. For a schema-valid proposal, an error does not
  suppress independent Pass 0 rules; only rules whose own prerequisites failed are
  `not-evaluated` (FR-003, FR-011, SC-015).

## Out of Scope

- **Passes 1–3** (retrieval, rubric scoring, adversarial). This feature is **Pass 0 only**
  (ADR-0005). No model call, prompt, embedding, retrieval, or adversarial logic is built.
- **Plan → ADR conversion.** The proposal candidate is already an ADR file selected by path;
  converting an agent plan into that candidate is out of scope (FR-016).
- **Any schema change.** No new field, severity, escalation reason, or evaluation shape.
  The returned `evaluationPatch` stays within the current committed schema (FR-009,
  Principle V, Clarification C6).
- **Persistence of the evaluation.** Pass 0 **returns** the `evaluationPatch` but never
  writes or proposes it; a later caller may propose it through a git PR (Clarification C6,
  ADR-0004).
- **Database / index / projection** (ADR-0004): Pass 0 targets caller-supplied snapshots
  only; `adr index rebuild` and any DB projection are not used.
- **Catalog / IaC / OpenAPI adapters.** `entity`/`resource`/`api`/`data` resolution is used
  only where the caller supplies a snapshot; no adapter is built or required (ADR-0007,
  ADR-0009). Missing snapshots are inert.
- **Later-pass escalation reasons.** `low-confidence`, `pass-disagreement`, and
  `novel-no-precedent` require model-bearing passes and remain absent / not evaluated in
  Pass 0 (Clarification C4). (Routing an escalation to a named human **is** in scope — see
  Clarification C7 and FR-013a.)
- **Calibration, holdout sets, precision/recall publishing.** Those ADR-0005 action items
  attach to the model-bearing passes, not to Pass 0.
- **Any implementation before the Phase 3 gate (T018) clears** (SC-013).
