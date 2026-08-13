# Implementation Plan: Evaluator Calibration Harness

**Feature directory**: `012-evaluator-calibration` (scoped in place — **no git
branch is created or switched** by this work) | **Date**: 2026-08-12 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-evaluator-calibration/spec.md`
and its seven open `[NEEDS CLARIFICATION]` items, all of which remain open by
decision of the coordinating review rather than by oversight.

**Normative sources** (ADRs win on conflict):
[ADR-0027](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
(the shipping precondition; the dual whole-gate / probabilistic-marginal
reporting requirement and the statement that only the marginal figure satisfies
the obligation; the absence statement; and the corrected emission-vs-retention
table),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(**superseded** — origin of action items 2 and 4; action item 4 carried forward
unmodified by ADR-0027 §4),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) **§ Calibration**
(requirements source for the six metrics; **not edited by this feature**),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md)
(git is truth; no DB/index required),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(binding state vocabulary; rung-2 evidence properties; rung-3 absence shape),
[ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
(observed-failing-first),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun toolchain, Node baseline),
and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–V.

> **⚠️ ORDERING GATE — the load-bearing constraint of this feature.**
>
> The label freeze and its **independent pre-derivation audit** (spec FR-006,
> FR-008) MUST complete with a `PASS` verdict **before** any baseline derivation
> runs. This is the `specs/009-catalog-binding-viability/` T014 → T014a → T016
> shape, imitated deliberately. A holdout frozen after a scorer ran against it is
> not a holdout, and a label authored after seeing which cases the evaluator
> escalated is not a label. Every hash, audit, and ancestry check in this plan
> exists to make that ordering **provable** rather than asserted.

## Summary

Build the four deterministic, model-free artifacts that make ADR-0027 §3's
shipping precondition satisfiable:

1. **A frozen calibration corpus (`H`)** — labeled historical cases with known
   outcomes, content-identified, hash-manifested, frozen in git, with labels
   authored and independently audited before any derivation.
2. **A derived deterministic baseline** — the Pass 0 result for every case,
   *derived* (never hand-authored), byte-for-byte reproducible, re-derived in CI
   with any difference failing the build, and recording trigger evidence in
   **three** states so `evidence-absent` is never counted as a true negative.
3. **A fail-closed precondition gate** — an executable check that fails any
   release shipping a probabilistic pass without a qualifying frozen holdout
   that predates its first score, detecting "a pass shipped" from **two
   independent sources that must agree** (a declared registry and the existing
   dependency-boundary evidence).
4. **The metric contract** — precision, recall, false-negative rate, score drift,
   inter-pass disagreement, and override rate as pure functions with fixtures,
   each able to report `not-computable` with a machine reason code rather than a
   passing-looking value. The **whole-gate / probabilistic-marginal split applies
   to precision, recall, and FNR only** (ADR-0027 §3, FR-016); drift,
   disagreement, and override rate are not split that way, and creating variants
   of them would be an unsupported invention.

Plus the **absence statement** in `docs/RELEASING.md`, mechanically enforced and
**auto-flipping**: forbidden the moment a probabilistic pass is declared, at
which point the marginal figures become required.

**The whole feature needs no model.** That is Constitution Principle IV's
requirement and also the design's central claim: everything above is computable
from committed repository state alone. If any part appears to need a model, it
belongs in `specs/011-probabilistic-evaluator-passes/`, not here.

This feature makes **no schema change** (Principle V), adds **no persistence to
Pass 0** (feature 005 SC-008/SC-012 stand unmodified), **approves nothing**, and
does **not** edit `docs/EVALUATOR_RUBRIC.md`.

### What this plan is not building, and why that matters

Three things a reader might expect are deliberately absent:

- **No escalation log is added to the evaluator.** Feature 005 SC-008 ratifies
  that "Pass 0 persists nothing" and ADR-0027 §1 forbids any evaluator surface to
  persist. The corpus is built by **re-derivation from committed history**.
- **No `ε` value and no `N` value ship.** Both are left open on the coordinating
  review's instruction. What ships instead is the **mechanism** for deriving `ε`
  (FR-019a) and the **behavior** when `|H| < N` (`not-computable` with a reason
  code, FR-017a/FR-023). An unset constant must never become a green figure.
- **No override rate is computed.** Its input does not exist. The metric is
  published in the `not-computable` state carrying a reason code that names the
  missing decision log — visible pressure to build one, rather than a silent
  omission.

## Technical Context

**Language / runtime**: TypeScript on Bun (development) targeting Node
(published artifacts) — ADR-0010. `bun install`, `bun run`, `bunx`, `bun test`
only; never npm/pnpm/yarn/jest/vitest.

**Placement**: the metric functions and corpus reader are pure and belong with
the evaluator surface (`packages/evaluator/`), which already holds the pure
kernel, the reason-code catalog, and the canonical serializer. The gate is a
check invoked from CI, alongside the existing `check:deps` and
`schema-emit-matches` gates. Final placement is a plan-stage decision recorded in
Project Structure below; the binding constraint is that **nothing here may be
imported by `packages/core`** and nothing may live under `packages/adapters/*`
(Principle III; ADR-0007).

**Corpus location**: under this feature's own directory or a sibling data
directory — **not** `docs/adr/`. Calibration cases are not decisions; putting
them in the corpus would make them visible to `adr lint`, `adr queue`, and the
governing-decisions Action, which is wrong on every count.

**Determinism**: byte-for-byte reproducibility is a repository contract
(`adr queue` SC-001; `packages/evaluator/src/report/serialize.ts`). Reuse
`canonicalBytes` / `canonicalStringify` for any serialized artifact and
`compareCodeUnits` (`packages/core/src/ordering/`) or `byCodeUnit`
(`packages/evaluator/src/compare.ts`) for every sort. **`localeCompare` must not
appear on any serialized surface** — issue #115 documents that it varies by ICU
locale and that the affected arrays are contract surfaces, not display order.

**Hashing and freeze verification**: `packages/evaluator/src/crypto/sha256.ts`
already exists. More importantly, feature 010 discharged the freeze/audit
procedure as **landed executable code**, not only as a procedure, and this
feature must build on it rather than beside it:

- `scripts/audit-oracle-freeze.ts` — the audit as a *program*, with frozen reason
  strings and an explicit adequacy check. This is why 010's T020/T021 could
  *observe* the audit FAIL. T012's audit must likewise be executable, or T012a's
  required observation has no mechanism and the audit becomes asserted rather
  than exhibited — the same substitution FR-008 forbids of the auditor.
- `scripts/check-freeze-hashes.ts` — the CI freeze-drift gate, wired as
  `check:freeze-hashes`. It hardcodes 010's directory names in `FREEZE_DIRS`, so
  a second freeze must **either generalize that gate or explicitly add one**; T006
  decides which, and may not leave a competing path implied.
- **The manifest's canonical form must be defined by reference to one existing
  definition**, not left open. The repository already carries two
  (`scripts/audit-oracle-freeze.ts` and
  `packages/evaluator/src/report/serialize.ts`), and `crypto/sha256.ts`
  documents itself as "not a general crypto surface". "Reuses the existing
  hashing path" is a claim about this feature's interior until the canonical form
  is named.

**Reason codes**: follow the existing `packages/evaluator/src/catalog.ts`
convention — exhaustive, stable, namespaced, with a fixed precedence order. The
`not-computable` reason codes (FR-017a) are a new namespaced group, not an
extension of the routing groups.

**What is explicitly excluded from the dependency surface**: any model, prompt,
embedding, retrieval, or scoring library; any adapter package; any network,
clock, or filesystem-traversal dependency inside the pure functions. Asserted by
the existing dependency-graph gate (spec SC-014).

**Unknowns carried into implementation**: the five `[NEEDS CLARIFICATION]` items.
None blocks the build, because each has a specified mechanism or behavior that is
testable without the value (see spec FR-017a, FR-019a, FR-021, FR-023, FR-024a).

## Constitution Check (pre-design gate)

*GATE: evaluated **before** the design below. No violations — Complexity Tracking
is intentionally empty.*

| Principle | Pre-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS (planned) — the calibration corpus, freeze manifest, audit record, baseline, passes registry, and report are **tracked files** (FR-001). No database, index, or service is required to read, verify, or use any of them; any index is rebuildable from the tracked files alone. The gate reads only committed state at the release commit (FR-012). ADR-0004. |
| **II. Clean clone builds green** | PASS (planned) — no new runtime dependency is anticipated; hashing and canonical serialization already exist in `packages/evaluator/`. No secret, service, or network access is introduced. `clean-clone-builds` must stay green (SC-014). |
| **III. Core depends on no adapter** | PASS (planned) — everything lands in `packages/evaluator/` and CI-side check code. Nothing is imported by `packages/core`; nothing lives under `packages/adapters/*`. The existing dependency-graph gate asserts it. ADR-0007. |
| **IV. Deterministic before probabilistic** | PASS (planned) — **the entire feature is deterministic and model-free** (FR-029). It imports no model/prompt/embedding/retrieval library and its pure functions read no clock, network, or filesystem. It **approves nothing** (FR-027): the gate fails or passes a release, and the metrics describe a corpus; neither touches an acceptance or `review` state. This is the principle's strongest form — the artifact that governs the probabilistic layer is itself computable without one. |
| **V. The schema is the contract** | PASS (planned) — **no schema change** (FR-028). The corpus is a separate artifact with its own format; the record schema's unused `Evaluation` affordance is left exactly as it is. `schema:emit` drift stays clean (SC-015). Notably this feature does **not** populate `evaluation:` on any record, which would be the tempting shortcut and would both mutate records (violating FR-027) and quietly change the meaning of a committed schema field. |

**Result**: PASS.

One **contract tension is surfaced rather than resolved**, which is the Principle
V behavior: the record schema's `Evaluation` object affords persistence
(`ranAt`, `scores`, `confidence`, `escalate`, `escalationReasons`,
`deterministicFindings`) that no code writes and no record uses, while feature
005 SC-008 forbids Pass 0 to persist anything. ADR-0027's correction
([#139](https://github.com/mbeacom/adrkit/pull/139)) records that these two commitments were always in tension and that
ADR-0005 never resolved it. **This feature does not resolve it either** — it
routes around it by building a separate corpus, and surfaces the tension here so
a later reader finds an explicit note rather than an unexplained dead field.

## Project Structure

### Documentation (this feature)

```text
specs/012-evaluator-calibration/
├── spec.md                  # authored
├── plan.md                  # this file
├── tasks.md                 # dependency-ordered, observed-failing-first
├── contracts/
│   ├── calibration-case.md      # case + corpus + freeze-manifest format
│   ├── metric-definitions.md    # the six metrics, both split forms, not-computable
│   ├── precondition-gate.md     # detection, ancestry, fail-closed behavior
│   └── absence-statement.md     # required/forbidden vocabulary and the auto-flip
└── checklists/
    ├── requirements.md          # spec quality checklist
    └── evidence-index.md        # tracked, sanitized; hashes + tool versions + verdict
```

### Source code (repository root — extends the merged Phase 0–6 surface)

```text
packages/evaluator/
├── src/
│   ├── calibration/
│   │   ├── case.ts           # CalibrationCase / CalibrationCorpus types + parse
│   │   ├── freeze.ts         # FreezeManifest: hash, verify (reuses crypto/sha256.ts)
│   │   ├── baseline.ts       # pure derivation of the deterministic baseline
│   │   ├── metrics.ts        # the six metrics; whole-gate + probabilistic-marginal
│   │   ├── not-computable.ts # the not-computable states + reason codes
│   │   └── report.ts         # canonical CalibrationReport assembly + serialization
│   └── catalog.ts            # EXTENDED: new namespaced not-computable reason codes
└── test/
    └── calibration/          # fixtures + observed-failing-first tests

<gate location — plan-stage decision>
├── passes-registry.<ext>     # declared probabilistic passes (tracked data file)
└── <gate implementation>     # fail-closed; cross-checks registry vs. check:deps

docs/RELEASING.md             # EXTENDED: the absence statement (ADR-0027 action item 2)
```

**Corpus data location** is a plan-stage decision bounded by the Technical
Context above: not `docs/adr/`, and tracked. Candidates are a
`specs/012-evaluator-calibration/corpus/` directory (co-located with its spec,
matching how spike evidence is organized) or a top-level `calibration/`
directory (more discoverable, and it will outlive this feature's spec).

## Design approach, in dependency order

### 1. Freeze before derive (US1 → US2)

The corpus is authored, hashed, and audited before anything derives from it. The
audit is a **separate task with a separate owner** — a fresh-context reviewer
with no authoring involvement — that recomputes every hash, confirms all four
outcome label classes are present, confirms each label is justified by outcome evidence
**independent of any evaluator output** (FR-009, the anti-circularity rule), and
records an explicit `PASS`/`FAIL`. A `FAIL` blocks derivation.

After the freeze, correction is a **new cycle**, never an in-place edit (FR-007).
This is prospective application of the procedure `specs/010-*` Phase B used to
**discharge** spike 009's carry-forward blocker: a fresh T014 → T014a cycle
rather than a correction of the frozen artifact. That discharge also sharpened
the audit itself, and this feature adopts both refinements — the auditor
**recomputes** hashes rather than copying recorded values, and must reach an
explicit **adequacy** finding, because an audit that confirms every hash and
stops has established that the corpus is unmodified, not that it is fit to
calibrate against.

### 2. Derive, don't author (US2)

The baseline is produced by running the existing deterministic evaluator over the
frozen inputs. Two properties make it trustworthy rather than merely present:
it is **byte-for-byte identical across runs**, and CI **re-derives** it and fails
on any difference. A committed artifact that CI never reproduces is an assertion;
one CI reproduces is evidence (ADR-0014 rung 2: reproducible, self-verifying,
fail-closed).

The three-state trigger evidence (`condition-met` / `condition-unmet` /
`evidence-absent` — FR-005's vocabulary, sharing no token with routing's
`proven` / `not-proven`) is
recorded here, at derivation time, because that is the only point where the
distinction is knowable: it depends on what the authored snapshot could supply,
which is invisible downstream.

### 3. Two sources that must agree (US3)

The gate's hard problem is detecting "a probabilistic pass shipped" without a
model and without trusting a self-report. A single registry is a self-report and
is the obvious thing to forget to update. So the registry is **cross-checked
against the dependency-boundary evidence** the repository already maintains —
feature 005 SC-006 asserts the evaluator imports no model/prompt/embedding/
retrieval library, and `bun run check:deps` enforces it in CI and at release.

Disagreement in **either** direction fails:

- a dependency the registry does not declare ⇒ a pass shipped undeclared;
- a registry entry with no corresponding dependency ⇒ a stale or speculative
  declaration.

Ordering is then proven by **commit ancestry** (FR-015), not by a date field a
committer controls.

Everything about the gate is **fail-closed** (FR-014): unreadable, unhashable,
absent, or hash-mismatched inputs fail. Unknown is never satisfied.

### 4. Enforce the statement, and make it flip (US4)

The absence statement is enforced on the model of
`packages/catalog-envelope/test/no-correctness-claim.test.ts`, which scans
exports, emitted strings, and documents for forbidden vocabulary and asserts a
required framing is present — and which reports what it examined, so an empty
document set cannot satisfy it vacuously.

The addition here is the **flip** — and it is driven by the **report**, not by a
registry boolean. The registry is an *input to report construction*: while no
pass is declared, every probabilistic metric resolves to `not-computable /
nothing-to-measure`, and the absence statement is rendered **from that state**.
Enforcement then consumes the resulting report. While no pass is declared the
statement is required and any precision/recall/FNR figure — including a `1.0` /
`n/a` placeholder — is forbidden; the moment a pass is declared, that inverts.

Describing enforcement as "a function of the registry" would reintroduce exactly
the `if (noProbabilisticPass)` branch FR-026 forbids, and with it the stale
reassuring statement that branch produces. The registry decides the report's
state; the report decides the statement.

ADR-0027 is explicit about why the placeholder is banned: *"`precision 1.0,
recall n/a` reads as a healthy gate and is the more dangerous artifact."*

### 5. Fix the metrics before there is a score to grade (US5)

The metrics are the only part of this feature a later author has an incentive to
reshape, so they are implemented as pure functions with fixtures **now**, before
any probabilistic pass exists to be measured. `specs/011-*` consumes them.

The dual-figure rule (FR-016) is normative in ADR-0027 §3 rather than original
here, and the marginal figure is the one that satisfies the obligation.

- **Two ownership boundaries are drawn deliberately**, because both are places
  where two features could quietly implement the same idea twice:

- **The disagreement metric aggregates; it never recomputes** (FR-020). This
  feature **defines** the contradiction predicate (FR-020c); `specs/011-*`
  evaluates it as the `pass-disagreement` trigger and records the resulting
  three-state evidence; this feature aggregates that record. One definition, one
  evaluation, one recording — so the published rate and the trigger's firings
  reconcile by construction rather than by diligence.
- **This feature owns calibratable thresholds *and*, now that the producing
  shapes are published, the definitions they threshold** (FR-020a/b/c). An
  earlier draft split them, on the reasoning that the confidence and
  contradiction functions depend on shapes this feature must not invent. Once
  `specs/011-*` published `RubricScoreSnapshot` and `AdversarialSnapshot` that
  premise dissolved — and the split was never sound in the other direction, since
  a threshold calibrated against a quantity its owner does not define is
  calibrating something it does not control.

  Both definitions are grounded in the rubric's own text rather than invented:
  citation coverage is the rubric's existing structural mechanic (*"Uncited
  scores are dropped by the aggregator"*), and the contradiction cut point is the
  rubric's own anchor for `3` — *"adequate for the blast radius"*.

## Constitution Check (post-design re-check)

| Principle | Post-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS — every artifact in Project Structure is a tracked file; the gate reads committed state only; no index is required. |
| **II. Clean clone builds green** | PASS — no new runtime dependency; hashing and canonical serialization are existing in-repo code. |
| **III. Core depends on no adapter** | PASS — `packages/evaluator/src/calibration/` and CI-side check code only; `packages/core` imports none of it. |
| **IV. Deterministic before probabilistic** | PASS — the design's every step (freeze, hash, derive, ancestry-check, count) is deterministic. Nothing approves. The `not-computable` states exist specifically so that a missing input degrades to an explicit absence rather than to a fabricated value — the same "degradation, not failure, and never fabrication" posture ADR-0009 requires of the resolver. |
| **V. The schema is the contract** | PASS — no schema change; the `Evaluation` affordance is left untouched and its tension with feature 005's SC-008 is surfaced above rather than silently resolved. |

**Result**: PASS. Complexity Tracking is empty.

## Risks and how the design answers them

| Risk | Answer in the design |
|---|---|
| `H` is too small for a meaningful recall denominator (27 records, a subset labelable) | Not hidden: FR-023 + FR-017a make an undersized `H` report `not-computable` with a reason code. The path is expected to be exercised on day one (spec clarification 5). |
| Labels get fitted to evaluator output | FR-009 forbids it and FR-008's independent audit is scoped to check exactly that; the audit precedes derivation. |
| The freeze is corrected after the fact "just this once" | FR-007 requires a new cycle and retains the superseded artifact — the procedure `specs/010-*` Phase B used to discharge spike 009's blocker. |
| A broken measurement is reported as an honest absence | FR-017b's four disjoint classes: `measurement-failed` can never render as `nothing-to-measure`, and FR-026 derives the absence statement from the class-1 state rather than a boolean branch. This is the `run-network-denied.ts` failure shape, which survived five CI failures because the wrong branch looked like "not available here". |
| "Measured, and clean" is indistinguishable from "could not measure" | FR-017b requires a computed zero to be representable distinctly from every `not-computable` state, and forbids collapsing `undefined-value` into `measurement-failed`. Zero probabilistic escalations is a **finding**, not a harness failure. |
| An audit confirms integrity and is read as confirming adequacy | FR-008 requires an explicit adequacy finding and recomputation rather than confirmation; T012a observes the FAIL for an integrity-only audit. |
| The gate fail-closes on a permanently absent trigger and blocks every release | FR-023a: outcome label classes and triggers are different axes, and a trigger `evidence-absent` for every case is valid. `novel-no-precedent` is expected to be exactly that, permanently. Structurally absent and incidentally absent are still recorded distinctly, so a working primitive that silently stops producing evidence cannot hide behind the expected condition. |
| A reporter branches on a condition it believes permanent, and goes stale without failing | The generalized form of the FR-026 fix: FR-023a requires the `not-computable` class to be derived from observed state, never hardcoded per trigger. `if (trigger === 'novel-no-precedent') return 'nothing-to-measure'` is correct today and silently wrong the day a ranking primitive ships. |
| A probabilistic pass ships and the registry is simply not updated | FR-013's two-source cross-check fails on the dependency the registry does not declare. |
| The absence statement ossifies and becomes false | FR-026's auto-flip makes it fail the moment a pass is declared. |
| `ε` or `N` gets a guessed value that later reads as validated | Neither ships. FR-019a specifies the derivation mechanism; FR-017a makes the unset state explicit and non-passing. |
| The override rate quietly disappears from the report | FR-021 requires it to be **published** in the `not-computable` state; SC-008b observes a report that omits it failing. |
| Locale-dependent ordering breaks byte-reproducibility | `compareCodeUnits` / `byCodeUnit` only; SC-018 asserts identical bytes across ICU locales (issue #115). |
| The published disagreement rate fails to reconcile with the `pass-disagreement` trigger's own firings | FR-020 removes the second computation entirely: the metric **aggregates recorded trigger evidence** and never recomputes the comparison. Two callers of one shared predicate can still diverge; an aggregation over what the trigger recorded cannot. |
| A `0.0` disagreement rate is manufactured by missing data rather than by a real defect | FR-020 excludes `evidence-absent` cases from the denominator, and reports `not-computable` below `N` evaluated cases rather than firing the defect signal. |
| A reader treats the whole-gate figure as equally trustworthy as the marginal one | FR-016a: the landed eight destroy the false/absent distinction at emission and cannot be retrofitted without changing landed behavior, so the whole-gate denominator is **permanently** weaker. Every whole-gate figure is emitted carrying a machine-readable qualifier saying so. |
| The calibration vocabulary is confused with the routing vocabulary, corrupting a denominator | FR-005 freezes three tokens (`condition-met` / `condition-unmet` / `evidence-absent`) that share none with `proven` / `not-proven`, requires exact-equality comparison, and records that neither vocabulary appears in the published schema. |
| A calibratable threshold gets hardcoded downstream where calibration cannot reach it | FR-020a assigns `ε` and the `low-confidence` threshold to this feature as *calibration parameters*, and FR-020b/FR-020c define the quantities they threshold. The relevance floor is **withdrawn**, not owned (FR-020d): there is no ranking function for it to be a floor over. |

## ADR-0014 standing

This feature is **scoped**. Nothing above it may be claimed.

Landing targets **rungs 1–2**: unit, contract, and purity coverage plus
maintainer-owned validation that is **reproducible, self-verifying, fail-closed,
and reviewed**. The self-verifying property is concrete here — CI re-derives the
baseline and recomputes the freeze hashes, so the evidence checks itself rather
than being attested.

**Rung 3 (external validation) is open and is not sought by this work.** The
maintainer's own reference repository is rung-2 evidence and must never be
described as external validation or as a community adopter.

## Complexity Tracking

*Intentionally empty. No Constitution principle is violated, and no complexity
deviation requires justification.*
