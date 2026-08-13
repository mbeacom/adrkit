# Specification Quality Checklist: Evaluator Calibration Harness

**Purpose**: Validate specification completeness and quality before proceeding to
implementation
**Created**: 2026-08-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) beyond citing the
      exact existing code paths this feature must not break or must reuse
      (`packages/evaluator/src/routing/route.ts`, `catalog.ts`, `report/serialize.ts`,
      `crypto/sha256.ts`, `packages/cli/src/evaluate.ts`,
      `packages/core/src/schema/adr.schema.ts`, `packages/core/src/ordering/`) —
      cited as fixed grounding for the investigation findings, not as new
      implementation choices. Placement decisions are deferred to
      [plan.md](../plan.md).
- [x] Focused on user value: making ADR-0027 §3's shipping precondition
      satisfiable, so the first probabilistic pass can ship at all, and so the
      absence of figures is reported as absence rather than fabricated.
- [x] Written for non-technical stakeholders where possible; technical citations
      are necessarily precise (exact file paths, the eight trigger names, the
      three-state evidence vocabulary) because the feature's entire value is a
      falsifiable ordering claim.
- [x] All mandatory sections completed (Overview, User Scenarios & Testing,
      Requirements, Key Entities, Success Criteria, Assumptions, Clarifications,
      Out of Scope).

## Requirement Completeness

- [ ] **No [NEEDS CLARIFICATION] markers remain** — **deliberately not met.**
      Six markers remain **by decision of the coordinating review**, not by
      oversight. Each is a value a maintainer must set (`ε`, `N`, the
      override-rate source, label-class exhaustiveness, external-case
      admissibility). In every case the spec fixes the **mechanism or behavior**
      instead of guessing the value — FR-017a (`not-computable` with a machine
      reason code), FR-019a (ε derivation mechanism, no value shipped), FR-021
      (override rate published as `not-computable`), FR-023 (`|H| < N` behavior),
      FR-024a (label-class gap recorded; resolution requires an ADR). Guessing
      any of them would create a threshold a later reader assumes was validated.
- [x] Requirements are testable and unambiguous — each FR maps to at least one
      acceptance scenario or Success Criterion (see the traceability table in
      [tasks.md](../tasks.md)).
- [x] Success criteria are measurable — SC-001 … SC-031 each name a specific,
      checkable outcome, and the gate/enforcement criteria each name an
      **observed failure** rather than only a passing state (ADR-0016).
- [x] Success criteria are technology-agnostic in outcome even where citations
      are specific: the outcome measured (e.g. "a holdout frozen after the first
      score is rejected") is agnostic; the evidence citing it is deliberately
      concrete.
- [x] All acceptance scenarios are defined — 6 user stories, each with
      Given/When/Then scenarios and an Independent Test.
- [x] Edge cases identified — 8, covering zero-positive and zero-negative
      holdouts, all-`evidence-absent` cases and the asymmetry they create, the
      unclassifiable "superseded without incident" case, compensating
      cross-dimension drift, a stale registry entry, a release missing the
      absence statement, and ICU-locale-dependent ordering.
- [x] Scope is clearly bounded — Out of Scope names 9 explicit exclusions,
      including two that a reader would plausibly expect to be in scope and are
      deliberately not (fixing the default render's dropped not-proven half;
      populating `ranAt`), plus the human-decision log recorded as a pointer
      rather than as work.
- [x] Dependencies and assumptions identified — 6 assumptions, plus the three
      numbered investigation findings that constrain the design.

## Evidence and honesty

- [x] Every factual claim about current behavior is cited to a file and was
      verified against the tree, not inferred: 0 of 27 records carry an
      `evaluation:` block; `adr evaluate` has no `--write`; `ranAt` is declared
      and populated by no production path; `renderHuman` prints proven reasons
      only. All four were independently re-verified by the coordinating session.
- [x] The spec corrects rather than repeats the dispatch's premise that an
      emitted escalation stream exists to seed from. ADR-0027 was corrected
      upstream ([#139](https://github.com/mbeacom/adrkit/pull/139)) on the strength of that finding; the spec cites the
      corrected text.
- [x] Absence is reported as absence throughout: no fabricated `ε`, no
      fabricated `N`, no invented override-rate source, no claimed precision or
      recall figure, and no rung claimed above **scoped** (ADR-0014).
- [x] The maintainer's own reference repository is never described as external
      validation or as a community adopter (ADR-0014 rung 3 stays open).

## Constitution alignment

- [x] **I. Git is the source of truth** — every artifact is a tracked file; no
      database or service is required (FR-001; ADR-0004).
- [x] **II. Clean clone builds green** — no new runtime dependency; no secret,
      service, or network access (SC-014).
- [x] **III. Core depends on no adapter** — nothing lands under
      `packages/adapters/*`; `packages/core` imports none of it.
- [x] **IV. Deterministic before probabilistic** — the whole feature is
      model-free (FR-029) and approves nothing (FR-027). If any part needed a
      model it would belong in `specs/011-*`.
- [x] **V. The schema is the contract** — no schema change (FR-028). The unused
      `Evaluation` affordance is left untouched, and its standing tension with
      feature 005's SC-008 is **surfaced** in [plan.md](../plan.md) rather than
      silently resolved.

## Feature readiness

- [x] Ordering gate is explicit and blocking: the label freeze and its
      independent pre-derivation audit precede all derivation
      (tasks.md T012), imitating `specs/009-*`'s T014 → T014a → T016 as
      discharged and strengthened by `specs/010-*` Phase B — the auditor
      recomputes rather than confirms, and must reach an explicit adequacy
      finding (T012a observes the FAIL for an integrity-only audit).
- [x] Every gate and enforcement carries an observed-failing-first task
      (ADR-0016): tasks.md T013, T015, T016, T020–T024, T028–T030, T033–T038,
      T046.
- [x] Downstream consumer identified and notified:
      `specs/011-probabilistic-evaluator-passes/` consumes the metric
      definitions rather than redefining them (FR-022; tasks.md T044).
- [x] ADR-0014 standing recorded honestly: **scoped**, landing targets rungs 1–2,
      rung 3 open.

## Notes

The single unchecked item above is intentional and is the honest state of this
specification. A checklist that reported "no clarifications remain" by inventing
six values would be exactly the manufactured assurance ADR-0027 exists to
prevent.
