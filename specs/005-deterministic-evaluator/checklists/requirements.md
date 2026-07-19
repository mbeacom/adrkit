# Specification Quality Checklist: Deterministic Evaluator (Pass 0) — Phase 4

**Purpose**: Validate specification completeness and quality before planning
**Created**: 2026-07-19
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

- **Phase 3 outcome gate is the headline.** Feature 004's code merged in **PR #12**, but
  `specs/004-ci-surface/tasks.md` **T018 is unchecked** — the second-repo / >10-record /
  selective-comment / same-comment-update / default-token-only verification. Per the
  outcome ladder, **scoping (spec/plan/tasks) proceeds now, but ANY feature-005
  implementation task is hard-blocked until T018 is checked off with evidence** (SC-013).
  A merged PR is not a satisfied rung.
- **Scope is Pass 0 only.** This feature builds only the **deterministic** pass of the
  four-pass evaluator (ADR-0005 action item 1: "Pass 0 complete and independently useful
  before any prompt is written"). **No** model call, prompt, retrieval, embedding, rubric
  scoring, or adversarial pass is in scope — and Pass 0 must be independently useful with
  **no model configured** (Principle IV, ADR-0005 degradation).
- **Exactly eleven rules at fixed severities.** `schema-valid`/error, `id-unique`/error,
  `supersession-consistent`/error, `no-orphan-refs`/error, `affects-resolvable`/warn,
  `affects-overlap`/warn, `scope-hierarchy`/error, `assertions-compile`/error,
  `assertions-pass`/warn, `decider-resolvable`/warn, `expiry-sane`/info. The spec binds
  each rule's deterministic meaning per `docs/EVALUATOR_RUBRIC.md`; no rule may be added,
  renamed, or re-severitied.
- **Routes, never approves.** The evaluator returns proposals (on error) or completes
  (warn/info), computes a deterministic disposition, sets an escalate flag on
  deterministically proven triggers, deterministically routes a proven escalation to a
  named human (or an explicit `unresolved` state), and **mutates nothing** — no ADR file,
  no acceptance state, no `review` field, no database/index (ADR-0004, ADR-0005, Principle
  I/IV). It **never decides acceptance**. Git is truth; clean-clone/offline is mandatory
  (Principle II).
- **Deterministic ordering + byte reproducibility.** Rubric-rule order first, then stable
  per-rule keys; identical inputs → byte-for-byte identical output apart from
  caller-supplied run metadata. Only set-like collections are canonical-sorted; fixed
  rubric/trigger and declaration-ordered decider/CODEOWNERS/catalog/matcher/assertion arrays
  retain semantic order. No clock/network/fs read, no internal timestamp/duration in the
  deterministic payload.
- **Contract tensions resolved (Clarifications C1–C11, Session 2026-07-19).** The tensions
  previously surfaced as Gated Contract Decisions GC-1…GC-6 are now **resolved** decisions
  in the spec's `## Clarifications` section; none adds/renames/re-severities a rubric rule
  or changes the schema:
  - **C1** — `inert`/degraded status and reason-code events ride the runtime `Pass0Report`
    (`ruleResults` with status `pass | fail | inert | not-evaluated`); the returned
    `evaluationPatch.deterministicFindings` carries **violations only** in the existing
    schema shape. Inert/degraded results never become fixed-severity violations.
  - **C2** — `dangling-supersededBy` maps **only** to `supersession-consistent`;
    `dangling-supersedes`/`dangling-relatesTo` map **only** to `no-orphan-refs`; a missing
    reference is reported **once**, by one rubric rule (no reciprocity/cycle double-report).
  - **C3** — `affects-resolvable` (**warn**) fires on **zero real targets with backing
    present**; **backing absent** yields operational inert reason
    `affects-resolvable.backing-absent`, and a missing port yields
    `affects-resolvable.resolver-absent`. The lower-level ADR-0009
    `affects-unresolvable` finding maps to the former; neither emits a deterministic finding.
  - **C4** — the Pass-0-provable escalation subset is fixed as **routing conditions after
    the eleven rules** (not a twelfth rule): `one-way-door`, `cost-threshold`,
    `security-surface`, `data-residency`, `regulatory`, `contradicts-accepted-adr`,
    `agent-authored-production`, `human-requested`. Only existing `EscalationReason` enum
    values; **no** new reason code. `low-confidence`, `pass-disagreement`, and
    `novel-no-precedent` remain absent. Missing evidence ⇒ not proven / no reason.
  - **C5** — all four engines (`rego`, `jsonpath`, `grep`, `custom`) participate **only**
    via registered deterministic ports; missing engine/input is **inert**; no
    shell/network/service/command/model. `rego`/`jsonpath` are required conformance engines;
    `grep`/`custom` are inert unless registered. T002 chooses a source or fixed
    compiled-artifact profile per required engine. Each typed port carries its engine-owned
    opaque immutable payload directly from compile/artifact validation into evaluate, with
    no hidden mutable registry, recompile, or unsafe cast.
  - **C6** — **no schema change**; Pass 0 **never persists or mutates** — it **returns** a
    schema-compatible `evaluationPatch` that a later caller may propose through a git PR.
  - **C7** — routing an escalation to a **named human is in scope**: resolve in ADR-0005
    order (`deciders` → CODEOWNERS of resolved paths → catalog owners of resolved entities)
    using declaration-ordered deciders, canonical path/entity ordering, CODEOWNERS
    last-matching-rule semantics, and declared owner order. The first team candidate with
    zero/multiple active humans is an immediate `unresolved` barrier; it is not skipped for a
    later owner. `decider-resolvable` stays the fixed **warn** rule; fallback routing is
    operational behavior, not a twelfth rule.
  - **C8** — project **Phase 4 = outcome ladder rung 5 (partial)**, not rung 4 (rung 4 is
    the MCP server / project Phase 5).
  - **C11** — on schema-invalid return, `schema-valid` is `fail` and the other ten rules are
    `not-evaluated`, so the `Pass0Report` always carries **exactly eleven** rule results in
    rubric order. Routing remains complete with eight `not-proven` statuses, no escalation,
    and target `not-required`. `not-evaluated` is operational state, not a rubric
    finding/severity.
- **No schema change.** The returned `evaluationPatch` stays within the current committed
  schema (`deterministicFindings[] { rule, severity, message?, adr? }`, `escalate`,
  `escalationReasons[]`). Richer runtime detail lives on the `Pass0Report` operational
  channel and is never persisted by Pass 0 (FR-008/FR-009, Clarifications C1/C6).
- **Rubric-rule public contract; explicit mapping.** Findings are keyed by rubric rule id;
  reused lower-level `Finding`s (`unique-id`, `dangling-*`, `strict-unknown-key`,
  `affects-unresolvable`, parse/contract findings) are mapped explicitly, with no
  duplicate/conflicting finding for the same underlying issue (FR-010, SC-009).
- **Exit semantics.** `1` = returned (error); `0` = completed on warn/info **even when
  escalation is recommended**; `2` = usage/input-contract error, including a schema-valid
  selected ADR whose status is not `draft`/`proposed`. Exit `0` never means "approved."
- **Log and matcher scope are explicit.** `id-unique` compares `[record.log ?? "", id]`, so
  equal ids in different named source logs pass. Target resolution preserves ADR-0009
  positive, negation-after-positive, negation-only-empty, and `repo` qualification against
  the caller's explicit current target-resolution log, never inferred from record source logs.
- **Overlap pass reasons are distinct.** No accepted ADRs selects
  `affects-overlap.no-accepted-corpus`; accepted ADRs with fully evaluated no-intersection
  selects `affects-overlap.none`, after failure/inert precedence.
- **Caller owns all I/O.** Every input (proposal path + corpus lint/load result including
  malformed-file findings, optional target-resolution log, target inventories, federated-log
  snapshots, assertion ports + input snapshots, optional identity snapshot, optional
  scope/routing evidence, and `evaluationDate`) is supplied to the pure library; run metadata
  stays in the outer caller
  envelope. Pass 0 does no filesystem traversal, clock read, or network access
  (FR-001/FR-016; ADR-0009 purity).
- **Wire/runtime separation is fixed.** `adrkit.pass0.snapshot/v1` is the strict JSON DTO;
  assertion keys are byte-exact compact
  `JSON.stringify([record.log ?? "", record.path, assertion.id])` strings so duplicate ADR
  ids cannot alias inputs; noncanonical whitespace variants and malformed present data exit
  2, optional omission is inert, and ports are injected separately by trusted composition
  code.
- **Runtime findings are projection-safe.** `RuleFinding` has explicit report-only
  candidate/related ADR, matcher/assertion key, target, record-path, field, source, and
  lower-level evidence fields; its `adr` field is strictly `AdrRef`, so patch projection
  cannot emit a filesystem path.
- **Assumptions A1–A8** capture ADR-consistent choices (caller-owned I/O, Phase 0/1 reuse,
  rubric-id public contract, resolvable-vs-inert distinction, assertion ports,
  schema-compatible returned patch, first-party non-adapter placement, Bun/Node-22
  toolchain) — none a one-way door.
