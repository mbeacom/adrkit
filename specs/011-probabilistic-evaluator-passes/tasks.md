---
description: "Dependency-ordered task list for Probabilistic Evaluator Passes (Passes 1–3) and the three deferred triggers"
---

# Tasks: Probabilistic Evaluator Passes (Passes 1–3)

**Input**: Design documents from `specs/011-probabilistic-evaluator-passes/`

**Prerequisites**: [`spec.md`](./spec.md) (FR-001–FR-028, SC-001–SC-016, Q1–Q6) and
[`plan.md`](./plan.md)

**Normative**: `docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md`,
`docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md`,
`docs/EVALUATOR_RUBRIC.md`, `docs/adr/0003-ship-as-spec-kit-extension.md`,
`docs/adr/0004-git-is-source-of-truth-database-is-an-index.md`,
`docs/adr/0009-affects-resolution-and-catalog-binding.md`,
`docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md`,
`docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md`,
`docs/adr/0010-bun-toolchain.md`, `.specify/memory/constitution.md`

> # ⛔ T001–T004 ARE HARD GATES AND NONE ARE CLEARED
>
> **No task numbered T005 or higher may begin, and no file under `packages/` may be created or
> modified, until T001–T004 are all checked.** Two independent preconditions are unsatisfiable
> today:
>
> - **Feature 012 has not landed.** Its frozen holdout set does not exist, and its precondition
>   gate has not been observed failing. ADR-0027 §3: *"No probabilistic pass may ship without a
>   frozen holdout set that existed before the pass produced its first score."* A holdout frozen
>   after the scorer ran against it is not a holdout, and this **cannot be repaired by
>   backfilling** — the same ordering rule spike 009 enforced for its reference oracle.
> - **The architecture ADR does not exist.** The harness-driven design is decided (see
>   [`plan.md`](./plan.md) Summary) but unratified.
>
> This feature is **scoped** ([ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)),
> and nothing above it. Every task below is unchecked and must stay unchecked until it is done
> with evidence.

**Tests**: REQUIRED and test-first. Per
[ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
**a check counts as coverage only once it has been observed failing.** Each test task below
must be written, run, and **observed failing for the stated reason** before its implementation
task begins; a test that passes on first run has proven nothing and must be corrected, not
accepted. All fixtures are offline, model-free, and network-free.

**Toolchain**: Bun (ADR-0010). `bun install`, `bun run`, `bunx`, `bun test`. Never
npm/pnpm/yarn/jest/vitest. Any install must use stable Bun **1.3.14** and preserve `bun.lock`
lockfileVersion 1.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Parallelizable only when the task touches different files and has no dependency on
  another incomplete task in the same phase.
- **[US1]…[US5]**: Maps user-story-phase tasks to the five stories in `spec.md`.
- Gate, foundational, and polish tasks intentionally have no story label.
- Dependencies are written as narrative English (`After T00X`), matching feature 005.
- Tasks are checked **only** with implementation evidence.

---

## Execution Phase 0: Hard Gates

**Purpose**: enforce ADR-0027's shipping precondition and ratify the architecture before any
code exists. These gates are the entire reason this feature is scoped rather than started.

- [ ] T001 Verify that `specs/012-evaluator-calibration/` has **landed** and that its frozen
      holdout set exists as a tracked artifact. 012's gate enforces ordering by **commit
      ancestry, not by a date field**: the holdout's **freeze commit MUST be an ancestor of the
      first commit that produces a score**. Record the artifact path and the freeze commit SHA,
      and confirm the ancestry relation holds (`git merge-base --is-ancestor <freeze> <HEAD>`).
      Keep T001 open and stop all T002+ work while any item is missing. **Nothing on this side
      can satisfy this after the fact** — a holdout frozen after the scorer ran is not a
      holdout (ADR-0027 §3).
- [ ] T002 After T001, verify that 012's holdout-precondition gate has been **observed failing**
      — that is, observed *rejecting* a probabilistic pass that lacks a frozen holdout — and
      link that observation. ADR-0027 §4 states the requirement directly: the gate *"must be
      observed rejecting a probabilistic pass that lacks a frozen holdout before it may be
      trusted"* (ADR-0016). A gate that has only ever passed is not yet coverage.
- [ ] T003 Author and land an ADR ratifying the **harness-driven architecture**: adrkit emits a
      prompt bundle and consumes a structured response; the harness performs the model call; no
      adrkit package opens a socket or holds a credential (spec FR-004). The record must state
      that it **ratifies** the architecture and does **not** amend the constitution, must cite
      Principle II's offline-use and IP-boundary rationale, ADR-0003, and ADR-0010, and must
      document the rejected in-adrkit-model-client alternative together with the constitutional
      amendment it would require. Resolve or explicitly defer [Q6](./spec.md#q6) (the
      prompt-bundle / structured-response wire contract) in that record.
- [ ] T004 After T003, obtain and record 012's answers for [Q1](./spec.md#q1) (the aggregate-
      confidence definition, constrained to something the **pure kernel** can compute from
      harness-returned evidence) and [Q2](./spec.md#q2) (the contradiction predicate for
      `pass-disagreement`). Adopt feature 012's frozen calibration tokens verbatim —
      `condition-met` / `condition-unmet` / `evidence-absent` (012 FR-005; recorded here under
      [Q7](./spec.md#q7)) — and confirm they are still the tokens 012 ships. Record the
      maintainer's rulings on [Q4](./spec.md#q4) (are citations auditable in-record?)
      and [Q5](./spec.md#q5) (exact per-tier weights — an ADR, **not** an edit to
      `docs/EVALUATOR_RUBRIC.md`). `low-confidence` is blocked by Q1; `pass-disagreement` is
      blocked by Q2; Pass 2 weighting is blocked by Q5.

**Gate checkpoint**: T001–T004 block **every** later task. `novel-no-precedent` remains blocked
independently by [Q3](./spec.md#q3) — no relevance primitive exists in the repository — and is
implemented in Phase 6 as permanently `evidence-absent` rather than being made to fire.

---

## Execution Phase 1: Foundational Contracts

**Purpose**: freeze the snapshot types, the additive reason-code vocabulary, and the evidence
shape before any pass is written.

**Blocked by**: T001–T004.

- [ ] T005 [P] After Phase 0, define the immutable snapshot and evidence types in
      `packages/evaluator/src/types.ts` — `PromptBundle`, `RetrievalSnapshot`,
      `RubricScoreSnapshot`, `AdversarialSnapshot`, `ProbabilisticTriggerEvidence`, and
      `PassAbsence` — all deeply `readonly`, reusing `@adrkit/core` contract shapes rather than
      redefining them. `ProbabilisticTriggerEvidence` must carry a **three-state** status
      distinguishing `condition-met`, `condition-unmet`, and `evidence-absent` (FR-021), typed as
      an exhaustive union compared by exact equality — never prefix or substring matching, since
      `met` is a substring of `unmet` — without
      altering the existing eight-trigger `TriggerEvidenceStatus` shape (FR-002).
- [ ] T006 [P] After Phase 0, add reason codes for the three new triggers to
      `packages/evaluator/src/catalog.ts` as an **additive** vocabulary, leaving every Pass 0
      rule code, the eight routing-trigger codes, and their fixed order byte-identical (FR-002).
- [ ] T007 After T005 and T006, write a **failing** regression test in
      `packages/evaluator/test/pass0-bytes.test.ts` asserting that Pass 0's serialized report is
      byte-identical to a committed golden fixture with the new types present. **Observe it
      failing** by deliberately perturbing one Pass 0 code, confirm the perturbation is caught,
      then revert (ADR-0016). This is SC-001's guard and must exist before any pass is written.

**Checkpoint**: the contract vocabulary is fixed and Pass 0's byte-identity is guarded by a test
that has been proven to detect a change.

---

## Execution Phase 2: User Story 1 — Retrieval Assembles Context, Including the Graveyard (Priority: P1) 🎯 MVP

**Goal**: assemble the four required context categories deterministically, with `rejected` and
`superseded` records present, and rule-admitted records immune to ranking defects.

**Independent Test**: retrieve over an offline corpus containing an `affects`-intersecting
accepted ADR, a `rejected` ADR, a `superseded` ADR, and an unrelated ADR; assert the first three
are present with statuses preserved, the fourth absent, and the result byte-identical across two
runs.

**Blocked by**: Phase 1.

### Tests for User Story 1 — write and observe failing first

- [ ] T008 [P] [US1] After Phase 1, write failing retrieval tests and offline fixtures in
      `packages/evaluator/test/retrieval.test.ts` and `test/fixtures/retrieval/` covering: a
      `rejected` record admitted and labeled; a `superseded` record admitted and labeled; every
      `affects`-intersecting accepted ADR admitted **even when it would rank below the floor**
      (SC-006); a broader-`scope` ADR in the same domain admitted; an unrelated ADR excluded;
      and byte-identical output across two runs. **Observe each failing** before T010.
- [ ] T009 [P] [US1] After Phase 1, write a failing degradation test asserting that with **no
      ranking strategy configured** retrieval returns the rule-admitted set, records an
      informational finding, reports the strategy used, and does **not** return a bare empty set
      (FR-009, ADR-0009). **Observe it failing** before T010.

### Implementation for User Story 1

- [ ] T010 [US1] After T008 and T009, implement the pure rule-based admission kernel in
      `packages/evaluator/src/passes/retrieval.ts`: `affects` intersection, broader-`scope`
      inclusion, graveyard inclusion, and originating-artifact inclusion, over a caller-supplied
      snapshot. Categories (b) and (c) are unconditional and MUST NOT be filtered by any score
      (FR-006). No I/O, no ranking, no model.
- [ ] T011 [US1] After T010, implement per-item provenance and strategy reporting sufficient to
      compute recall against a labeled set (FR-008). Emit the evidence; **do not** compute the
      metric — that is 012's.
- [ ] T012 [US1] After T010, wire index loading and snapshot assembly at the **impure** boundary
      in `packages/cli/src/evaluate.ts`, keeping the index derived, disposable, rebuildable from
      git, never authoritative, and inert when absent (FR-009, ADR-0004).

**Checkpoint**: retrieval is deterministic, graveyard-inclusive, and useful with no ranking
strategy configured at all.

---

## Execution Phase 3: User Story 5 — Model-Free Degradation (Priority: P1)

**Purpose**: prove the probabilistic layer never becomes a dependency of the deterministic one.
Sequenced **before** Passes 2–3 deliberately: the degradation guarantee must exist before the
surfaces that could break it.

**Goal**: with no harness, no model, and no index, Pass 0 is byte-identical, Passes 1–3 report
absent, and the exit code is unchanged.

**Independent Test**: run the full evaluator with nothing configured; assert byte-identical
Pass 0 output, `PassAbsence` for each pass, `evidence-absent` for all three new triggers, and an
unchanged exit code.

**Blocked by**: Phase 2.

### Tests for User Story 5 — write and observe failing first

- [ ] T013 [P] [US5] After Phase 2, write a failing end-to-end degradation test in
      `packages/cli/test/evaluate-no-model.test.ts` asserting byte-identical Pass 0 output
      (SC-001), `PassAbsence` for Passes 1–3, `evidence-absent` for all three new triggers, and
      an unchanged exit code. **Observe it failing** before T015.
- [ ] T014 [P] [US5] After Phase 2, write a failing short-circuit test asserting that a proposal
      with any `error`-severity Pass 0 finding performs **zero** retrieval, constructs **no**
      prompt bundle, and emits **no** model request (FR-001, SC-002) — instrumented at the
      boundary, not inferred from logs. **Observe it failing** before T015.

### Implementation for User Story 5

- [ ] T015 [US5] After T013 and T014, implement `PassAbsence` propagation and the Pass 0
      short-circuit ordering in `packages/cli/src/evaluate.ts`, ensuring absence is reported
      **explicitly as absent** — never as success, never as a score of zero.

**Checkpoint**: the deterministic layer is provably independent of the probabilistic one.

---

## Execution Phase 4: User Story 2 — Rubric Scoring with Citation-Dropping and Hard Caps (Priority: P2)

**Goal**: aggregate D1–D8 deterministically from a frozen snapshot — dropping uncited scores,
applying the three hard caps, and applying per-tier weights.

**Independent Test**: given a frozen `RubricScoreSnapshot`, assert drops, caps, weights, and
byte-identical aggregates across two runs, with no live model.

**Blocked by**: Phase 3. Weighting additionally blocked by [Q5](./spec.md#q5) (T004).

### Tests for User Story 2 — write and observe failing first

- [ ] T016 [P] [US2] After Phase 3, write failing aggregator tests and fixtures in
      `packages/evaluator/test/rubric.test.ts` and `test/fixtures/rubric/` covering: an uncited
      D3 score of `4` **dropped** with a stable reason code and no effect on the aggregate
      (SC-008); D2 capped at 1; D3 forced to 0 on no negative consequence; D5 forced to 0 on
      unacknowledged contradiction — each fixture supplying a **higher raw model score** that the
      aggregator must override (SC-009). **Observe each failing** before T018.
- [ ] T017 [P] [US2] After Phase 3, write a failing D4 test asserting that a downward
      `reversibility`/`blastRadius` correction re-routes **and escalates to a named human**, and
      that no code path applies it as a silent tier change (FR-012, SC-010). **Observe it
      failing** before T019.

### Implementation for User Story 2

- [ ] T018 [US2] After T016, implement the pure aggregator in
      `packages/evaluator/src/passes/rubric.ts`: citation-drop, the three hard caps, and
      per-tier weighting. Caps are applied **by the aggregator**, never requested from the model
      (FR-011), so a fluent model cannot score around them.
- [ ] T019 [US2] After T017 and T018, implement the D4 correction path: recompute routing over
      the corrected value and **escalate to a named human** (FR-012). Silent re-routing is
      forbidden — a model changing a review tier is model discretion over escalation.
- [ ] T020 [US2] After T018, add the Pass 2 prompt-bundle template as pure data in
      `packages/evaluator/src/prompts/`, and implement bundle emission plus structured-response
      ingestion at the impure boundary in `packages/cli/src/evaluate.ts`. No socket, no
      credential, no model SDK (FR-004).

**Checkpoint**: scoring is deterministic given a snapshot, and the caps cannot be evaded.

---

## Execution Phase 5: User Story 3 — Adversarial Pass in Its Own Context (Priority: P2)

**Goal**: four required outputs, dimension-attributed, produced in a context that provably
excludes Pass 2's scores.

**Independent Test**: given a frozen `AdversarialSnapshot`, assert the four outputs validate,
that a missing output is `absent` rather than fabricated, and that the emitted Pass 3 bundle
contains no Pass 2 scores.

**Blocked by**: Phase 4.

### Tests for User Story 3 — write and observe failing first

- [ ] T021 [P] [US3] After Phase 4, write failing tests and fixtures in
      `packages/evaluator/test/adversarial.test.ts` and `test/fixtures/adversarial/` asserting
      all four outputs present-or-explicitly-absent, that no slot is filled with invented
      content, and that each output carries a `bearsOn: D1…D8` attribution (FR-017).
      **Observe each failing** before T023.
- [ ] T022 [P] [US3] After Phase 4, write a failing **structural** test asserting the emitted
      Pass 3 prompt bundle contains no Pass 2 scores (FR-014) — asserted on the bundle bytes,
      never by inspecting a model. **Observe it failing** before T023.

### Implementation for User Story 3

- [ ] T023 [US3] After T021 and T022, implement the pure validation kernel in
      `packages/evaluator/src/passes/adversarial.ts` (four-output validation, absence handling,
      `bearsOn` attribution) and the Pass 3 bundle template in
      `packages/evaluator/src/prompts/`, constructed so that Pass 2 scores are structurally
      unable to enter it.

**Checkpoint**: grading and attacking are separated by construction, not by instruction.

---

## Execution Phase 6: User Story 4 — The Three Deferred Triggers (Priority: P1)

**Goal**: close ADR-0027 §2's named 8-of-11 gap with declarative, evidence-backed triggers that
distinguish absence from falsity and never consult a model to decide.

**Independent Test**: given frozen snapshots, assert each trigger fires exactly on its
declarative condition, that `evidence-absent` and `condition-unmet` are distinguishable, and
that escalation resolves to a named human.

**Blocked by**: Phase 5. `low-confidence` additionally blocked by [Q1](./spec.md#q1);
`pass-disagreement` by [Q2](./spec.md#q2); both resolved in T004.

### Tests for User Story 4 — write and observe failing first

- [ ] T024 [P] [US4] After Phase 5, write failing trigger tests and fixtures in
      `packages/evaluator/test/probabilistic-triggers.test.ts` and
      `test/fixtures/triggers/` covering, for **each** of the three triggers, all three states:
      `condition-met`, `condition-unmet`, and `evidence-absent` (SC-005), with the latter two
      **distinguishable in the output** (FR-021). **Observe each failing** before T026.
- [ ] T025 [P] [US4] After Phase 5, write a failing test asserting that `low-confidence`
      thresholds a value **computed by the pure kernel** and that a model-supplied
      self-confidence field, if present in a snapshot, is **ignored** (FR-016). **Observe it
      failing** before T026.
- [ ] T026 [P] [US4] After Phase 5, write a failing test asserting the probabilistic-marginal
      subset is mechanically determinable — that a consumer can tell whether **any deterministic
      trigger fired**, in the **default** output shape as well as under `--json` (FR-020,
      SC-014). ADR-0027 names the existing hazard: `routing.evidenceStatus` is reachable only
      under `--json` while default output prints proven reasons only, which is exactly the half
      from which recall cannot be computed. **Observe it failing** before T028.

### Implementation for User Story 4

- [ ] T027 [US4] After T024–T026, implement the pure sibling kernel
      `packages/evaluator/src/routing/probabilistic.ts` computing the three triggers as a
      declarative OR over `ProbabilisticTriggerEvidence`, **after** the pass results and never
      as an additional rule (FR-015). Leave `routing/route.ts` and the eight existing triggers
      untouched (FR-002).
- [ ] T028 [US4] After T027, implement `novel-no-precedent` as permanently **`evidence-absent`**
      with an inert finding, because no relevance primitive exists ([Q3](./spec.md#q3), FR-018).
      Do **not** build a ranker in this feature, and do **not** derive `proven` from an empty
      result set — that would make a broken retrieval indistinguishable from a novel decision.
- [ ] T029 [US4] After T027, wire named-human resolution by reusing
      `packages/evaluator/src/routing/target.ts` **unchanged** (FR-019), and assert every
      escalation resolves to a named human or reports `unresolved` — never an unnamed "the ARB"
      (SC-015).

**Checkpoint**: the three triggers exist, are honest about what they do not know, and cannot
escalate on model discretion.

---

## Execution Phase 7: Cross-Cutting Verification and Polish

**Purpose**: prove the boundaries the feature promised not to cross.

**Blocked by**: Phase 6.

- [ ] T030 [P] Extend `packages/evaluator/test/purity.test.ts` to cover every new kernel with the
      existing `fetch` / `Date.now` / `Math.random` traps, and **observe each new kernel failing**
      the trap when a deliberate violation is introduced, then revert (ADR-0016, SC-004). The
      banned-import list in `contracts.test.ts` stays **unchanged**.
- [ ] T031 [P] Add a structural test asserting no code path from any pass reaches an approval,
      acceptance, `review`-state change, or in-place record write, and that `--write` remains
      rejected (SC-012, FR-022, FR-023). **Observe it failing** against a deliberately
      introduced write, then revert.
- [ ] T032 [P] Add a dependency-graph assertion that no adrkit package depends on a model SDK,
      embedding library, or HTTP client, and confirm `clean-clone-builds`,
      `core-has-no-adapter-deps`, and `schema-emit-matches` stay green (SC-004).
- [ ] T033 [P] Add a documentation check asserting no repository artifact describes the
      evaluator as four-pass, rubric-scoring, or adversarial in the **present tense** while the
      corresponding pass is unshipped (FR-026, SC-016, ADR-0027 §2).
- [ ] T034 Update `plan.md`'s Spec-kit realization table and the outcome ladder to reflect this
      feature's true state using ADR-0014 vocabulary **exactly**. Do not describe the
      maintainer's own reference repository as external validation or as a community adopter.
- [ ] T035 After T034, execute ADR-0027 action item 5 **only to the extent that record
      authorizes**: mark the three triggers' status in `docs/EVALUATOR_RUBRIC.md` and re-attach
      its calibration section to the shipping trigger. Any **further** rubric change is a new
      ADR, not an edit (FR-025; ADR-0005 action item 4 as carried forward by ADR-0027 §4).
- [ ] T036 Before any pass ships, declare this feature's shipped passes in feature 012's
      `passes` registry, and add a check asserting the registry and the dependency graph agree
      (FR-027). 012's precondition gate is fail-closed and cross-checks the declared registry
      against `bun run check:deps` and feature 005's SC-006; **a silent disagreement between the
      graph and the registry fails the release**, by design. **Observe the disagreement check
      failing** — declare a pass the graph does not support, and separately add a
      graph dependency the registry does not declare — before trusting it (ADR-0016). A
      registry that has only ever agreed has proven nothing.
- [ ] T037 After Phase 6, produce the **ε-derivation observation set** feature 012's FR-019a
      requires: per-dimension D1–D8 scores from this feature's **first two model versions** over
      the **same frozen holdout**, so 012 can derive the per-dimension observed spread. **No `ε`
      value ships from this feature**, and none may be hardcoded — 012 owns the derivation, and
      the resulting value needs its own record before it governs breaking-change status. Report
      the observations per dimension, **never averaged across dimensions**: an average hides a
      compensating pair.
- [ ] T038 [P] After T037, assert that every uncomputable value this feature emits renders as
      `not-computable` with a machine reason code, and is never coerced, defaulted, or omitted
      into something a consumer could read as success (FR-028; 012 FR-017a). **Observe it
      failing** against a deliberately defaulted value, then revert (ADR-0016).

**Checkpoint**: every promised boundary is enforced by a check that has been observed failing.

---

## Dependency Graph

```text
T001 ─▶ T002 ─┐
T003 ─────────┼─▶ T004 ─▶ Phase 1 (T005, T006 ─▶ T007)
              │
              └── all Phase 0 gates must be checked before any packages/ file is touched

Phase 1 ─▶ Phase 2 (US1: T008,T009 ─▶ T010 ─▶ T011,T012)
        ─▶ Phase 3 (US5: T013,T014 ─▶ T015)          [after Phase 2]
        ─▶ Phase 4 (US2: T016,T017 ─▶ T018 ─▶ T019,T020)
        ─▶ Phase 5 (US3: T021,T022 ─▶ T023)
        ─▶ Phase 6 (US4: T024,T025,T026 ─▶ T027 ─▶ T028,T029)
        ─▶ Phase 7 (T030–T033 [P] ─▶ T034 ─▶ T035, T036, T037 ─▶ T038)
```

**Blocking rules**

- T001–T004 block everything. They are not satisfiable today.
- Every `Tests for User Story N` task must be **observed failing** before the implementation
  task it precedes (ADR-0016). A test that passes on first run has proven nothing.
- T007's Pass 0 byte-identity guard must exist before any pass is implemented.
- Phase 3 (degradation) precedes Passes 2–3 deliberately.
- T028 is a deliberate non-implementation: `novel-no-precedent` stays `evidence-absent` until a
  relevance primitive exists, and building one is out of scope.
- T001's ancestry check is unsatisfiable retroactively: the holdout's freeze commit must be an
  ancestor of the first commit that produces a score, enforced by ancestry rather than by a date
  field, so no later artifact can be made to qualify.
- T036 must be observed failing in **both** directions; a one-directional check passes while the
  registry silently under-reports.

## Status

**Scoped.** Zero of 38 tasks are checked, and none may be checked until T001–T004 clear. Per
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
this feature is *scoped* and **nothing above it** — not implemented, not reference-verified, not
landed, not released, not externally validated, not adopted.
