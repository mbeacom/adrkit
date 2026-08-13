---
description: "Dependency-ordered task list for the Evaluator Calibration Harness"
---

# Tasks: Evaluator Calibration Harness

**Input**: Design documents from `specs/012-evaluator-calibration/`

**Prerequisites**: [`spec.md`](./spec.md) and [`plan.md`](./plan.md). The four
`contracts/` documents do **not** exist yet — they are authored by T004 and
T007–T009 in this list, and are prerequisites for the *implementation* phases,
not for starting it.

**Normative**:
[`docs/adr/0027-*`](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md),
[`docs/adr/0005-*`](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(superseded; origin of action items 2 and 4),
[`docs/adr/0004-*`](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md),
[`docs/adr/0014-*`](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
[`docs/adr/0016-*`](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
[`docs/adr/0010-*`](../../docs/adr/0010-bun-toolchain.md),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) § Calibration
(**read-only for this feature**), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

> # ⛔ T012 IS A HARD ORDERING GATE
>
> **No task in Execution Phase 4 or later may begin until T012 records a `PASS`
> verdict.** T012 is the independent pre-derivation audit of the frozen labels.
> A holdout frozen after a scorer ran against it is not a holdout; a label
> authored after seeing which cases the evaluator escalated is not a label. This
> is the `specs/009-catalog-binding-viability/` T014 → T014a → T016 shape, as
> **discharged and strengthened** by `specs/010-*` Phase B: T019's auditor
> recomputes hashes rather than copying them and must reach an explicit adequacy
> finding, and T020/T021 **observed the audit FAIL** against deliberate variants,
> retained as negative cases. A retained negative case is stronger evidence than
> an open blocker — it proves the audit catches the defect rather than warning
> that one is possible.
>
> If T012 returns `FAIL`, the required response is a **new freeze cycle**
> (T010b → T012 re-run), never an in-place correction of the frozen artifact.

**Tests**: REQUIRED and test-first. Every gate and enforcement must be **written
and observed failing against a deliberate violation** before its implementation
is trusted as coverage (ADR-0016). Tasks marked **[OBSERVE-FAIL]** are not
complete until the failure has been observed and recorded.

**Toolchain**: Bun only — `bun install`, `bun run`, `bunx`, `bun test`. Never
npm/pnpm/yarn/jest/vitest. Any lockfile update preserves `bun.lock`
lockfileVersion 1.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: parallelizable — touches different files and depends on no incomplete
  task in the same phase.
- **[US1]…[US6]**: maps user-story-phase tasks to the six stories in `spec.md`.
- **[OBSERVE-FAIL]**: per ADR-0016, must be observed rejecting a deliberate
  violation before it counts as coverage.
- Gate, setup, foundational, and polish tasks intentionally carry no story label.

## Fixed contract these tasks must preserve

1. **No model, anywhere** (FR-029). No task may add a model, prompt, embedding,
   retrieval, or scoring dependency.
2. **Pass 0 persists nothing** (FR-002). No task may add a write, log, or
   persistence side-effect to any evaluator surface. Feature 005 SC-008 and
   SC-012 stand.
3. **No schema change** (FR-028). `packages/core/src/schema/adr.schema.ts` and
   `schema/adr.schema.json` are untouched.
4. **Nothing approves** (FR-027). No acceptance state or `review` field is read
   for authority or written at all.
5. **`docs/EVALUATOR_RUBRIC.md`'s label-class vocabulary is not edited**
   (FR-024a). Changing it is an ADR. (ADR-0027 action item 5's separately
   authorized rubric edit is out of scope for this feature, not forbidden by
   it.)
6. **Three-state trigger evidence** (FR-005): `condition-met` / `condition-unmet`
   / `evidence-absent`. `evidence-absent` never enters a confusion-matrix cell.
   These tokens are frozen and share none with routing's `proven` / `not-proven`,
   which is **unchanged** by this feature.
7. **No `ε` value and no `N` value ship.** Only the mechanism (FR-019a) and the
   `not-computable` behavior (FR-017a, FR-023).
8. **`compareCodeUnits` / `byCodeUnit` only.** No `localeCompare` on any
   serialized surface (issue #115).

---

## Execution Phase 0: Hard Gates

- [ ] T001 Confirm ADR-0027 is `accepted` and read its **corrected** text (as corrected in [#139](https://github.com/mbeacom/adrkit/pull/139)): §3's dual whole-gate / probabilistic-marginal requirement and the sentence *"the whole-gate figure alone does not satisfy it"*, plus the corrected emission-vs-retention table row. Record the ADR's content hash in `checklists/evidence-index.md` so a later drift is detectable
- [ ] T002 Confirm the four fixed-contract invariants above are true of the tree at start: `adr lint` clean; no record carries an `evaluation:` block; `bun run check:deps` green; `schema:emit` drift clean. Record the baseline in `checklists/evidence-index.md`
- [ ] T002a [OBSERVE-FAIL] Make the no-`evaluation:`-block invariant a **standing** check rather than a one-time confirmation (FR-009a, SC-043) — the schema permits the block and nothing forbids writing it, so a later feature can break the corpus premise silently. Observe it **failing** against a record that carries one, in the shape of `packages/catalog-envelope/test/no-correctness-claim.test.ts`
- [ ] T003 Confirm with the maintainer that the five `[NEEDS CLARIFICATION]` items remain open by decision, and that this feature therefore ships **no** `ε` value, **no** `N` value, **no** override-rate source, **no** rubric edit, and draws cases from this repository only unless told otherwise

## Execution Phase 1: Setup

- [ ] T004 [P] Create `specs/012-evaluator-calibration/contracts/{calibration-case,metric-definitions,precondition-gate,absence-statement}.md` as authored contracts (not stubs), each stating its own invariants and its `[NEEDS CLARIFICATION]` dependencies
- [ ] T005 [P] Create `specs/012-evaluator-calibration/checklists/evidence-index.md` whose **head section** carries the verdict, the "reconstructed, not harvested" disclosure, and the evaluated-and-false vs. `evidence-absent` disclosure (FR-024, SC-017a). (`checklists/requirements.md` is authored at scoping time and already exists.)
- [ ] T006 Decide and record: the corpus data location (not `docs/adr/`; tracked); the gate implementation location; **whether the calibration freeze extends `check:freeze-hashes` or adds a separate gate** (that script hardcodes 010's `FREEZE_DIRS`); **the manifest's canonical hash form, by reference to one existing definition**; and **which surface performs corpus I/O**, since FR-022 keeps the pure functions filesystem-free. Weigh the `scripts/` precedent for repo-governance checks against placing calibration modules on `@adrkit/evaluator`'s published surface. Record each decision and its rationale in `plan.md`

## Execution Phase 2: Foundational Contracts (frozen before any data is authored)

**These land before any case is written.** Authoring the format after the data
exists is how a format gets fitted to the data it was supposed to constrain.

- [ ] T007 [P] Author `contracts/calibration-case.md`: `CalibrationCase` (content-hash + commit identity per FR-003, one label from the closed four-class set per FR-004, three-state trigger evidence per FR-005), `CalibrationCorpus`, and `FreezeManifest` (per-input sha256 + manifest sha256, FR-006). State the FR-007 no-in-place-correction rule and the FR-024a exclusion rule (a case fitting no class is excluded with its reason recorded, never relabeled)
- [ ] T008 [P] Author `contracts/metric-definitions.md`, **including the field-level shape of `RubricScoreSnapshot` and `AdversarialSnapshot` as the frozen input contract this feature owns** (FR-020a) — `specs/011-*` has not landed and an out-of-tree spec is not a citable contract, so the shapes are defined here and conformed to there. Also: the FR-018 positive-class mapping; precision, recall, and FNR; the FR-016 whole-gate **and** probabilistic-marginal split with ADR-0027 §3 cited as its normative source; FR-019/FR-019a drift (per dimension, never averaged; mechanism not value); FR-020 disagreement with `0.0` as a defect signal; FR-021 override rate as published-`not-computable`; and the FR-017/FR-017a absence and `not-computable` reason-code rules
- [ ] T009 [P] Author `contracts/precondition-gate.md` — **including the enumeration of locations that constitute a pass surface — by committed type name, one per pass role, never by module reachability (FR-013, FR-013c) — and an explicit statement that the detector's coverage is bounded by that enumeration** — (two-source detection per FR-013, commit-ancestry ordering per FR-015, fail-closed behavior per FR-014, validity preconditions per FR-023) and `contracts/absence-statement.md` (required statement, forbidden figures including the `1.0` / `n/a` placeholder, and the FR-026 auto-flip)

**Checkpoint**: the format cannot be reshaped by the data, because the data does
not exist yet.

---

## Execution Phase 3: User Story 1 — Frozen, Independently Audited Corpus (Priority: P1) 🎯 MVP

**Goal**: a labeled, content-hashed, frozen corpus whose labels were authored and
independently audited before anything derived from it.

**Independent Test**: recompute every hash and match the tracked index; confirm
the audit names an independent reviewer, carries an explicit verdict, and its
commit is an ancestor of the first derivation commit.

**Blocked by**: Phase 2.

### Authoring and freezing

- [ ] T010a [US1] Identify candidate historical cases from this repository's committed history. For each, record outcome evidence **independent of any evaluator output** (revert commits, incident records, review rejections) — per FR-009 a label justified by which triggers fired is circular and must be rejected. Raw material stays scratch-only (FR-024)
- [ ] T010b [US1] Label each case with exactly one of the four classes (FR-004). **Exclude** any case fitting none — notably "shipped, later superseded without incident" — recording the exclusion and its reason (FR-024a). Do **not** relabel to fit, and do **not** edit `docs/EVALUATOR_RUBRIC.md`
- [ ] T010c [US1] Author the per-case snapshot supplying `routingEvidence` where it can be justified from committed evidence, and mark every trigger it cannot supply as **`evidence-absent`** (FR-005). Record in `checklists/evidence-index.md` — in its head section — that these snapshots are **reconstructed, not harvested**
- [ ] T010d [US1] [OBSERVE-FAIL] **Sanitization review — gates T011; nothing is committed before it passes.** Confirm scratch material lives **outside the repository clone**; confirm no candidate case, snapshot, exclusion reason, or audit note carries a raw proposal body, incident detail, real principal id, team roster, or `humanRequested.requester` (FR-024, FR-024b). Observe the check **failing** against a deliberately seeded violation of each channel (SC-038, SC-039). Depends on: T010a–T010c. **Blocks: T011**
- [ ] T011 [US1] Freeze: compute a sha256 per case input and a sha256 over the manifest using `packages/evaluator/src/crypto/sha256.ts` (never a second hashing path); commit the manifest; mirror every hash into `checklists/evidence-index.md` (FR-006)

### The ordering gate

- [ ] T012 [US1] **⛔ ORDERING GATE — independent pre-derivation audit.** A reviewer with **no authoring involvement** in T010a–T011 must, in this separate task and **before Phase 4 begins**: **recompute** every recorded hash from the artifacts themselves (never copy or merely confirm the recorded values); confirm all four outcome label classes are present and `|H|` is recorded; confirm each label is justified by evidence independent of evaluator output (FR-009); confirm every `evidence-absent` marking is justified; record an explicit **adequacy** finding on the corpus — integrity alone does not satisfy; and record the auditor's **own** `PASS` / `FAIL` verdict in `checklists/evidence-index.md`. A `FAIL` blocks Phase 4 and requires a fresh T010b → T012 cycle. Depends on: T011
- [ ] T012a [US1] [OBSERVE-FAIL] **The audit must be executable for this observation to exist** — model it on `scripts/audit-oracle-freeze.ts`, which is why feature 010's T020/T021 could observe a FAIL at all. Observe the audit **FAIL** against a deliberately altered case, and separately against an audit run that confirms hash integrity but never reaches an adequacy finding (SC-025). Retain both negative cases, matching `specs/010-*` T020/T021 — a retained negative case is what makes the audit's PASS mean something
- [ ] T013 [US1] [OBSERVE-FAIL] Write `packages/evaluator/test/calibration/freeze.test.ts` and **observe it failing** against a deliberately altered case before implementing verification: assert a recomputed manifest hash mismatch is a **failure** and never a silent re-freeze (SC-001); assert a corpus missing a outcome label class is rejected (SC-002); assert the audit record exists, names an independent reviewer, and carries an explicit verdict — and that derivation is **rejected** when the audit is absent, non-`PASS`, lacks an adequacy finding, or is **not committed before the first derivation commit** (SC-003, FR-023). Accepting any explicit verdict, including `FAIL`, would let T014 go green with the ordering gate unsatisfied
- [ ] T014 [US1] Implement `packages/evaluator/src/calibration/case.ts` (parse/validate a case and corpus) and `calibration/freeze.ts` (compute and verify the manifest), making T013 pass. Pure: no clock, network, or filesystem inside the functions; ordering via `byCodeUnit`

**Checkpoint**: `H` is frozen, hash-verified, and independently audited `PASS`.
Only now may anything derive from it.

---

## Execution Phase 4: User Story 2 — Derived, Reproducible, Honest Baseline (Priority: P1)

**Goal**: the deterministic Pass 0 result for every case, derived rather than
authored, byte-reproducible, re-derived by CI, and distinguishing
`evidence-absent` from `condition-unmet`.

**Blocked by**: **T012 `PASS`.**

### Tests for User Story 2 — write and observe failing first

- [ ] T015 [P] [US2] [OBSERVE-FAIL] Write `packages/evaluator/test/calibration/baseline-determinism.test.ts`: two derivations over identical frozen inputs produce **byte-for-byte identical** output (SC-004); observe it failing before the implementation is trusted — the negative case MUST be **discriminating**: two runs of a `localeCompare` sort under the *same* locale are identical, so the fixture must either execute under two known-different ICU locales (as T047 does) or inject two comparators with deliberately different orders. A non-discriminating negative case is an ADR-0016 observation that observes nothing
- [ ] T016 [P] [US2] [OBSERVE-FAIL] Write `packages/evaluator/test/calibration/evidence-absent.test.ts`: a trigger marked `evidence-absent` contributes to **no** confusion-matrix cell — not TN, not FN (SC-005); observe it failing against an implementation that folds `evidence-absent` into `condition-unmet`. Also assert the calibration vocabulary shares no token with routing's `proven` / `not-proven` and that comparison is exact equality, never substring/prefix matching (`met` is a substring of `unmet`) — SC-005a
- [ ] T017 [P] [US2] Write `packages/evaluator/test/calibration/purity.test.ts`: the derivation performs no model call and imports no model/prompt/embedding/retrieval library, and its pure functions read no clock, network, or filesystem (SC-014); and `packages/evaluator/test/calibration/no-mutation.test.ts`: no ADR file, acceptance state, or `review` field is written (SC-016)

### Implementation for User Story 2

- [ ] T018 [US2] Implement `packages/evaluator/src/calibration/baseline.ts`: derive the Pass 0 result per case from the frozen inputs by invoking the existing deterministic evaluator; never hand-author a result. Serialize via the existing `canonicalBytes` (`packages/evaluator/src/report/serialize.ts`) so the artifact inherits the repository's byte-reproducibility contract
- [ ] T019 [US2] Commit the derived baseline and wire **CI re-derivation**: CI re-derives and fails on any difference, making the artifact self-verifying rather than merely committed (SC-004; ADR-0014 rung 2). Model the check on the existing `git diff --exit-code schema/adr.schema.json packages/ci/dist` step in `.github/workflows/release.yml`

**Checkpoint**: the baseline is evidence CI reproduces, not an assertion.

---

## Execution Phase 5: User Story 3 — The Precondition Gate (Priority: P1)

**Goal**: a fail-closed check that fails any release shipping a probabilistic
pass without a qualifying frozen holdout that predates its first score.

**Blocked by**: Phase 4 (the gate verifies the artifacts those phases produce).

### Violation fixtures and observed failure — before implementation

- [ ] T020 [P] [US3] [OBSERVE-FAIL] Fixture + test: a release declaring a probabilistic pass with **no** frozen holdout. Observe the gate **failing** (SC-006)
- [ ] T021 [P] [US3] [OBSERVE-FAIL] Fixture + test: a holdout whose freeze commit is **not** an ancestor of the anchor. Observe failure; assert a prose or **declared-date** anchor does **not** satisfy the check, that the anchor is **derived** from the earliest commit at which source 2 observes the pass surface, and that an underivable anchor **fails closed** (FR-015, SC-035)
- [ ] T022 [P] [US3] [OBSERVE-FAIL] Fixture + test: registry/**pass-surface** disagreement in **both** directions — a pass surface observed with no registry entry, and a registry entry with no observable pass surface. Observe failure on each. Also observe the gate **failing** when source 2 is structurally unable to observe (FR-013, FR-013a, SC-034)
- [ ] T023 [P] [US3] [OBSERVE-FAIL] Fixture + test: a holdout failing a validity precondition — below `N`, or missing an **outcome label class** (FR-023). Observe failure (SC-006)
- [ ] T023a [P] [US3] [OBSERVE-FAIL] Fixture + test: a holdout in which one trigger (e.g. `novel-no-precedent`) is `evidence-absent` for **every** case **passes** the gate — outcome label classes and triggers are different axes (FR-023a, SC-030). Observe the gate **wrongly rejecting** it before the distinction is implemented, then observe it passing. Also assert **structurally absent** (`nothing-to-measure`) is recorded distinctly from **incidentally absent** (`input-unavailable`)
- [ ] T023b [P] [US3] [OBSERVE-FAIL] Fixture + test: the `not-computable` class is **derived from observed state**, never hardcoded per trigger (FR-023a, SC-031). A fixture in which a relevance primitive is present but produces nothing must yield `input-unavailable`, not `nothing-to-measure`. Observe failing against an implementation containing `if (trigger === 'novel-no-precedent') return 'nothing-to-measure'` — correct today, silently wrong the day a primitive ships
- [ ] T023c [P] [US3] [OBSERVE-FAIL] Fixture + test: **the gate's two branches** (FR-011a, FR-011b). With no pass declared and `N` unratified, a release is **green** — the holdout branch reports `nothing-to-measure`, the detector branch still runs (SC-032). With a pass declared and `N` unratified, the gate **fails** with a reason code naming the unratified `N` (SC-033). Observe the wrong behavior — every release failing — before the branch condition is implemented
- [ ] T023d [P] [US3] [OBSERVE-FAIL] Fixture + test: **per-population validity** (FR-023b). A holdout passing every FR-023 precondition whose probabilistic-marginal subpopulation is empty or single-class produces a `not-computable` marginal figure that **fails the gate once a pass is declared**, and does **not** fail before one is (SC-036). Observe failing against an implementation where a `not-computable` marginal figure discharges ADR-0027 §3
- [ ] T024 [P] [US3] [OBSERVE-FAIL] Fixture + test: **fail-closed** behavior — an unreadable, unhashable, absent, and hash-mismatched manifest each fail; unknown is never treated as satisfied (FR-014, SC-007)

### Implementation for User Story 3

- [ ] T025 [US3] Create the declared **passes registry** as a small tracked data file (a legible diff, checkable ancestry), per `plan.md` Project Structure and the T006 location decision
- [ ] T026 [US3] Implement the gate: two-source detection cross-checking the registry against **the evaluator's committed pass surface** (FR-013) — **not** the dependency graph, which is empty by construction under the harness architecture and toothless besides, since `check-deps.ts` silently passes any package with no allowlist entry; commit-ancestry ordering (FR-015); the FR-023 validity preconditions; and fail-closed handling throughout (FR-014). Deterministic, model-free, reading only committed state at the release commit (FR-012)
- [ ] T027 [US3] Wire the gate into CI and the release workflow alongside the existing `check:deps` and `schema-emit-matches` gates, and **re-observe** T020–T024 failing against the wired gate, then observe it passing on the conforming case (SC-006, SC-007)

**Checkpoint**: the precondition blocks a ship, and has been observed doing so.

---

## Execution Phase 6: User Story 4 — Absence Statement, Enforced and Auto-Flipping (Priority: P2)

**Goal**: every release states the absence while no probabilistic pass has
shipped, and the statement becomes forbidden the moment one does.

**Blocked by**: T025 (the registry is an input to report construction) **and
T040–T042** (the `not-computable` classes and report assembly). FR-026 requires
the absence statement to be rendered **from the report's `nothing-to-measure`
state**, not from a registry boolean — so the state must exist before T030a/T031
can be satisfied. Sequencing Phase 6 on T025 alone would leave the required
state-driven renderer unimplemented and invite exactly the boolean branch FR-026
forbids.

### Tests — write and observe failing first

- [ ] T028 [US4] [OBSERVE-FAIL] Write the enforcement test on the model of `packages/catalog-envelope/test/no-correctness-claim.test.ts`: while no pass is declared, the absence statement is **required** in `docs/RELEASING.md` and consistent with README's Dogfooding section. **Observe it failing** with the statement deleted (SC-012). It must report what it examined, so an empty document set cannot satisfy it vacuously (FR-025; ADR-0016 clause 3)
- [ ] T029 [US4] [OBSERVE-FAIL] Extend the test: while no pass is declared, any published precision, recall, or false-negative-rate figure is **forbidden** — including a `1.0` / `n/a` placeholder, which ADR-0027 names as *"the more dangerous artifact"*. Observe it failing against a fabricated figure and against the placeholder (SC-013)
- [ ] T030 [US4] [OBSERVE-FAIL] Extend the test for the **auto-flip** (FR-026): with a pass declared in the registry, the absence statement becomes **forbidden** and the FR-016 probabilistic-marginal figures become **required**. Observe it failing for that opposite reason with a declared pass and a retained absence statement (SC-012)
- [ ] T030a [US4] [OBSERVE-FAIL] Assert the absence statement is **rendered from the report's `nothing-to-measure` state** (FR-017b class 1), not from a bare `if (noProbabilisticPass)` branch (SC-024). Observe failing against a renderer driven by a registry boolean, and against one that emits the statement from a `measurement-failed` state — the sentence would be false and reassuring at once

### Implementation for User Story 4

- [ ] T031 [US4] Add the absence statement to `docs/RELEASING.md` (ADR-0027 action item 2), worded consistently with README's Dogfooding section, making T028–T030 pass
- [ ] T032 [US4] Verify README and `docs/RELEASING.md` remain mutually consistent, and that neither claims a rung above **scoped** for this feature or above the recorded standing for any other surface (ADR-0014)

**Checkpoint**: the statement is mechanical rather than remembered, and cannot
outlive its truth.

---

## Execution Phase 7: User Story 5 — The Metric Contract (Priority: P2)

**Goal**: the six metrics as pure functions with fixtures, fixed before any score
exists to grade.

**Blocked by**: Phase 4 (metrics consume the baseline) and T008.

### Tests — write and observe failing first

- [ ] T033 [P] [US5] [OBSERVE-FAIL] Empty-denominator fixtures: precision with `TP+FP = 0` and recall/FNR with `TP+FN = 0` are each reported **absent** — never `1.0`, never `0`, never `n/a` as a value (SC-008). **The single representation is `not-computable` carrying the `undefined-value` class (FR-017b)**; "absent" is how that state is *rendered*, never a second return contract. Observe failing against an implementation that returns `1.0`, and against one that returns a bare `absent` sentinel with no class or reason code
- [ ] T034 [P] [US5] [OBSERVE-FAIL] `not-computable` fixtures: every uncomputable metric returns `not-computable` with a machine reason code naming why — empty denominator, `|H| < N`, missing outcome label class, absent input source (FR-017a, SC-008a). Observe failing against any rendering that coerces the state to a passing-looking value
- [ ] T034c [P] [US5] [OBSERVE-FAIL] Sub-class fixtures: every `measurement-failed` state carries exactly one of `environmental` / `artifact-defect` / `corpus-inadequate` plus the underlying error detail (SC-042). Observe failing against a state carrying none or more than one — the diagnosis differs even though the gate's behavior does not, and a retry against `artifact-defect` destroys the evidence
- [ ] T034a [P] [US5] [OBSERVE-FAIL] **Four-class fixtures (FR-017b).** Assert every `not-computable` state carries exactly one of `nothing-to-measure` / `input-unavailable` / `undefined-value` / `measurement-failed` (SC-021); observe failing against a state carrying none, more than one, or collapsing `undefined-value` into `measurement-failed`. Assert a **computed zero** is distinct from every `not-computable` state (SC-022) — this is the "measured, and clean" vs "could not measure" boundary
- [ ] T034b [P] [US5] [OBSERVE-FAIL] `measurement-failed` fixtures: an unreadable holdout, a hash mismatch, `|H| < N`, a missing outcome label class, and a model version absent from the drift baseline each **fail the gate** and each **do not** produce ADR-0027's absence statement (SC-023). Observe failing against an implementation that reports any of them as an environmental absence — the `run-network-denied.ts` failure shape
- [ ] T035 [P] [US5] [OBSERVE-FAIL] Split fixtures: a case with **any** deterministic trigger proven is excluded from the probabilistic-marginal population, and precision/recall/FNR are each produced in **both** forms (FR-016, SC-009). Observe failing against a whole-gate-only implementation
- [ ] T035a [P] [US5] [OBSERVE-FAIL] Whole-gate qualifier fixture: every whole-gate figure carries the machine-readable denominator-limitation qualifier naming the landed-eight false/absent conflation, emitted **from the report** rather than from prose (FR-016a, SC-005b). Observe failing against a report that emits a whole-gate figure without it
- [ ] T036 [P] [US5] [OBSERVE-FAIL] Drift fixtures: reported per dimension, with a compensating-pair fixture producing **no** single averaged figure (FR-019, SC-010); and with no `ε` observed, drift reports `not-computable` rather than a passing comparison
- [ ] T037b [P] [US5] [OBSERVE-FAIL] Agreement/disagreement fixtures: **both** rates are published over the same denominator (SC-041); a report publishing only one fails; an agreement rate of `1.0` over `≥ N` evaluated cases produces the same defect signal as a disagreement rate of `0.0`
- [ ] T037 [P] [US5] [OBSERVE-FAIL] Disagreement fixtures: (a) the metric **aggregates recorded `pass-disagreement` evidence** and never recomputes the Pass 2 / Pass 3 comparison — observe failing against a second implementation that re-derives it (SC-011a); (b) `evidence-absent` cases are excluded from the denominator, not counted as agreement (SC-011b); (c) a rate of exactly `0.0` over ≥ `N` **evaluated** cases produces a **defect signal**, while the same rate below `N` produces `not-computable` (FR-020, SC-011)
- [ ] T037a [P] [US5] [OBSERVE-FAIL] Case-shape fixtures: a case storing `positive(c)`, an expected-escalation boolean, or a per-dimension reference score is **rejected** (FR-005a, FR-005b, SC-020). Observe failing against a case format that permits any of them
- [ ] T038 [P] [US5] [OBSERVE-FAIL] Override-rate fixture: the metric is **present** in the report in the `not-computable` state with a reason code naming the missing decision log; a report omitting it entirely **fails** (FR-021, SC-008b)
- [ ] T039 [P] [US5] Reporting-form fixture: every figure carries its absolute counts and denominator; a bare percentage fails (FR-017, SC-008)

### Implementation for User Story 5

- [ ] T040 [US5] [OBSERVE-FAIL] Declare the `not-computable` reason codes as their **own disjoint union** (`CalibrationReasonCode`, in `calibration/not-computable.ts`) with its own exhaustiveness test — **never appended to `REASON_CODES`**, which is the frozen Pass 0 contract vocabulary (SC-037). Observe failing against an implementation that appends to it, and assert no calibration code is reachable from `evaluatePass0`. Follows the catalog's convention — exhaustive, stable, with fixed precedence, matching the existing convention. Each code carries exactly one FR-017b class (`nothing-to-measure` / `input-unavailable` / `undefined-value` / `measurement-failed`). It is a new group, not an extension of the routing groups
- [ ] T041 [US5] Implement `packages/evaluator/src/calibration/not-computable.ts` and `calibration/metrics.ts`: the FR-018 positive-class mapping; precision, recall, FNR in both split forms; per-dimension drift; disagreement with the zero-defect signal; and override rate as published-`not-computable`. Pure and model-free (FR-022)
- [ ] T042 [US5] Implement `calibration/report.ts`: canonical `CalibrationReport` assembly and serialization via `canonicalBytes`, with every sort using `byCodeUnit`
- [ ] T043 [US5] Specify the **`ε` derivation mechanism** (FR-019a) in `contracts/metric-definitions.md` and implement it as a testable function over two model versions' scores on the same frozen `H` — **shipping no `ε` value** (SC-010a). Record that the resulting value requires ratification in a record before it governs breaking-change status
- [ ] T043a [US5] Specify the derivation mechanism for the `low-confidence` threshold (FR-020a, rubric default `0.7`) — **shipping no new value**; record that the documented default stands until calibration justifies moving it, and that moving it is an ADR with calibration deltas attached
- [ ] T043b [P] [US5] [OBSERVE-FAIL] Implement **aggregate confidence** (FR-020b) as a pure function over `RubricScoreSnapshot` **as defined in `contracts/metric-definitions.md` (T008)**, not over an out-of-tree type: surviving-and-cited dimensions ÷ **8**. Observe failing against an implementation using "dimensions attempted" as the denominator — a two-dimension run with both cited must yield `0.25`, not `1.0` (SC-026)
- [ ] T043c [P] [US5] [OBSERVE-FAIL] Implement the **contradiction predicate** (FR-020c) as a pure function over `RubricScoreSnapshot` + `AdversarialSnapshot`. Fixtures: present `hidden-one-way-door` fires regardless of Pass 2's score; a present output bearing on a dimension scored **≥ 3** fires; the same output against a dimension scored `< 3` does **not**; an explicitly-absent output contributes nothing (SC-027). Export it for `specs/011-*` to evaluate as the trigger — this feature never re-derives the comparison (FR-020)
- [ ] T043d [P] [US5] [OBSERVE-FAIL] Drift-input fixtures (FR-019): drift computed on the **post-drop surviving** score with the raw score retained; a citation-behavior-only change is distinguishable from a judgment change (SC-028); a model version absent from the baseline yields `measurement-failed`, never a quiet skip
- [ ] T044 [US5] Confirm `specs/011-probabilistic-evaluator-passes/` consumes these functions rather than redefining them, and that the `pass-disagreement` trigger records three-state evidence this feature can aggregate (FR-020). Message that session with the published surface

**Checkpoint**: the metrics are binding code, not prose a later author can
reinterpret.

---

## Execution Phase 8: User Story 6 — Privacy, and Polish

- [ ] T045 [US6] Verify no tracked file contains raw historical proposal bodies or incident detail (SC-017); confirm every scratch artifact referenced by `checklists/evidence-index.md` has a recorded, **recomputable** sha256 and a recorded tool version
- [ ] T046 [US6] [OBSERVE-FAIL] Assert the evidence index's "reconstructed, not harvested" and evaluated-and-false vs. `evidence-absent` disclosures appear in the **same section as its verdict, at the head of the document**; observe the check failing with either moved to a limitations appendix (SC-017a)
- [ ] T047 [P] Determinism sweep: no `localeCompare` on any serialized surface introduced by this feature; assert identical bytes across two ICU locales (SC-018; issue #115)
- [ ] T048 [P] Confirm `schema:emit` drift stays clean and no file under `packages/core/src/schema/` or `schema/` changed (SC-015), and that `docs/EVALUATOR_RUBRIC.md`'s **label-class vocabulary** is unchanged (SC-019). ADR-0027 action item 5's separately-authorized rubric edit, if performed elsewhere, does not violate this
- [ ] T048a [P] Record which ADR-0027 action items this feature discharges — **2** (T031, absence statement), **3** (T011/T012, freeze before any score), **4** (T026/T027, gate built and observed failing) — and note that **5** (rubric deferral markers) is authorized by that record but out of scope here, so it is not silently dropped
- [ ] T049 [P] Confirm `bun run check:deps` and `clean-clone-builds` stay green with the calibration surface present (SC-014)
- [ ] T050 Record the ADR-0014 standing honestly: this feature is **scoped**; landing targets rungs 1–2 with reproducible, self-verifying, fail-closed, reviewed evidence; **rung 3 is open** and the maintainer's own reference repository is never described as external validation or a community adopter
- [ ] T051 Final pass: confirm all **six** `[NEEDS CLARIFICATION]` items are still present and unresolved-by-invention in `spec.md`, and that no `ε` value, `N` value, override-rate source, or relevance floor, and no label-class rubric edit, was introduced anywhere
- [ ] T051a **Assertion-vs-property check.** Where a requirement or success criterion asserts a *relationship* — "FR-A cites FR-B", "both specs name the same detector", "the enumeration covers X" — verify the relationship **holds in the text**, not merely that both IDs resolve. This is a distinct check from cross-reference resolution and catches what that one cannot: during scoping, SC-044 asserted "FR-024a cites the same test (FR-018a)" while FR-024a did not cite it, and every ID in the sentence resolved. A spec that asserts a property of itself which it does not have is the defect this feature exists to prevent, turned inward
- [ ] T051b **Withdrawn-design scan.** When a design is withdrawn or replaced, scan for the **mechanism's own vocabulary** — and for descriptions of its *behavior*, which contain none of its words — never for the requirement's ID. Reference integrity passes cleanly on this class while the prose disagrees. Two rules travel with it: state the withdrawal **where the old design was argued**, because rationale sections outlive requirement edits; and keep the superseded reasoning attached as its own counterexample, so a reader who wonders why the obvious approach is unused finds the answer instead of proposing it again. **This check exists because this feature was bitten by it twice** — first leaving `plan.md`'s design-rationale section still arguing for the withdrawn dependency-graph detector, then leaving four more references that described the mechanism by what it *did* rather than by its name, including SC-006, which enumerated a deliberate violation that could no longer occur

---

## Dependencies & Execution Order

### Hard-gate dependencies

- T001–T003 (Phase 0) block everything.
- **T012 `PASS` blocks Phase 4 and everything downstream of it.** This is the
  ordering gate; a `FAIL` requires a fresh T010b → T012 cycle, never an in-place
  correction (FR-007).
- T025 (passes registry) blocks Phase 6, because the absence-statement
  enforcement is a function of the registry.

### Phase dependencies

```text
Phase 0 (T001–T003)
   └─> Phase 1 (T004–T006)
          └─> Phase 2 (T007–T009)   contracts frozen before data exists
                 └─> Phase 3 (T010a–T014)  author -> freeze -> AUDIT
                        └─ ⛔ T012 PASS ⛔
                              └─> Phase 4 (T015–T019)  derive baseline
                                     ├─> Phase 5 (T020–T027)  the gate
                                     └─> Phase 7 (T033–T044)  metrics
                                            └─> Phase 6 (T028–T032)  absence stmt
                                                (needs T025 AND T040–T042)
                                            └─> Phase 8 (T045–T051)  polish
```

Phases 5 and 7 are independent of each other and may run in parallel once
Phase 4 completes. **Phase 6 depends on both** — T025 from Phase 5 (the registry)
and T040–T042 from Phase 7 (the `not-computable` classes and report assembly),
because FR-026 renders the absence statement from report state rather than from
a registry boolean.

### User-story completion order

US1 (P1) → US2 (P1) → US3 (P1) → US4 (P2) ‖ US5 (P2) → US6 (P3).

US1–US3 are the minimum that makes ADR-0027 §3's precondition satisfiable. US4
discharges ADR-0027 action item 2. US5 fixes the definitions before there is a
score to grade. US6 constrains how the rest lands.

### Success-criteria traceability

| SC | Tasks |
|---|---|
| SC-001, SC-002, SC-003 | T011, T012, T013, T014 |
| SC-004 | T015, T018, T019 |
| SC-005, SC-005a, SC-005b | T010c, T016, T018, T035a |
| SC-006 | T020, T021, T022, T023, T026, T027 |
| SC-007 | T024, T026, T027 |
| SC-008, SC-008a, SC-008b | T033, T034, T038, T039, T041 |
| SC-009 | T035, T041 |
| SC-010, SC-010a | T036, T041, T043, T043a |
| SC-011, SC-011a, SC-011b | T037, T041 |
| SC-020 | T037a, T014 |
| SC-021, SC-022 | T034a, T041 |
| SC-023 | T034b, T026, T041 |
| SC-024 | T030a, T031 |
| SC-025 | T012, T012a |
| SC-026 | T043b |
| SC-027 | T043c |
| SC-028 | T043d, T041 |
| SC-029 | T043a, T041, T026 |
| SC-030 | T023a, T026 |
| SC-031 | T023b, T026 |
| SC-032, SC-033 | T023c, T026, T027 |
| SC-034 | T022, T026 |
| SC-034a | T009, T022, T026 |
| SC-035 | T021, T026 |
| SC-036 | T023d, T026, T041 |
| SC-037 | T040 |
| SC-038, SC-039 | T010d, T045, T046 |
| SC-040 | T010b, T023a, T026 |
| SC-041 | T037b, T041 |
| SC-042 | T034c, T040, T041 |
| SC-043 | T002a |
| SC-044 | T008, T043b, T043c |
| SC-012, SC-013 | T028, T029, T030, T031 |
| SC-014 | T017, T049 |
| SC-015 | T048 |
| SC-016 | T017 |
| SC-017, SC-017a | T045, T046 |
| SC-018 | T047 |
| SC-019 | T010b, T048 |

### ADR-0027 action-item traceability

| ADR-0027 action item | Disposition |
|---|---|
| 1 — supersede ADR-0005 | Already `[x]` in the record; not this feature's work |
| 2 — record the absence statement in `docs/RELEASING.md` | **Discharged** by T031 (enforced by T028–T030) |
| 3 — freeze the holdout **before** any probabilistic pass produces a score | **Discharged** by T011 (freeze) + T012 (audit) + T021 (ancestry enforcement) |
| 4 — build the holdout-precondition gate and observe it failing | **Discharged** by T020–T027 |
| 5 — mark the three unevaluable triggers deferred in `docs/EVALUATOR_RUBRIC.md` | **Out of scope** for this feature; authorized by ADR-0027 itself. Named in T048a so it is not silently dropped |

## Parallel Execution Examples

- **Phase 2**: T007, T008, T009 — three separate contract documents.
- **Phase 5**: T020–T024 — five independent violation fixtures, each in its own
  file, all written and observed failing before T026 exists.
- **Phase 7**: T033–T039 — seven independent metric fixtures.
- **Phase 8**: T047, T048, T049 — three independent verification sweeps.

## Implementation Strategy

### Freeze first

Nothing derives from `H` until T012 records `PASS`. This ordering is the feature;
inverting it produces an artifact that looks like a holdout and is not one.

### Observe failing, then build

Every gate in Phases 5 and 6 has its violation fixtures written and **observed
failing** before the implementation exists (ADR-0016). A check that has only ever
been seen passing has not been shown to check anything.

### Never let an unset constant read as green

`ε` and `N` are deliberately unset. The `not-computable` state with a machine
reason code (FR-017a) is what keeps that honest, and it is expected to be
exercised from the first run — with 27 records in the corpus, an undersized `H`
is the likely day-one condition, not a hypothetical edge case.

### Non-negotiable boundaries

No model. No persistence added to Pass 0. No schema change. No approval. No
rubric edit. No `localeCompare` on a serialized surface. No claim above **scoped**
on the ADR-0014 ladder, and never "external" for the maintainer's own repository.
