# Feature Specification: Evaluator Calibration Harness — Frozen Holdout, Precondition Gate, and Metric Contract

**Feature Directory**: `specs/012-evaluator-calibration` (not a git branch — this
feature is scoped in place; no branch is created or switched by this work)

**Created**: 2026-08-12

**Status**: Draft — **scoping only.** Per
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
this feature is **scoped** and nothing above it.

**Phase**: not assigned by this feature. Root `plan.md`'s phase table is the
coordinating maintainer's single edit covering both this feature and
`specs/011-probabilistic-evaluator-passes/`.

**Reciprocal dependency — legible from both directions.**
`specs/011-probabilistic-evaluator-passes/` (Passes 1–3 plus the deferred
`low-confidence`, `pass-disagreement`, and `novel-no-precedent` triggers) is the
**first consumer** of the frozen holdout, the precondition gate, and the metric
contract defined here. **012 gates 011**: no probabilistic pass may ship until
this feature's holdout is frozen and its gate exists (ADR-0027 §3). 011 consumes
the metric definitions in FR-016 … FR-023 rather than restating them, and this
feature does not define, implement, or evaluate any probabilistic pass.

**Normative sources** (the ADRs are normative; where this spec and an ADR
disagree, the ADR wins):
[ADR-0027](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
(supersedes ADR-0005; converts per-release reporting into a shipping
precondition; requires precision/recall/FNR to be published **twice** —
whole-gate and probabilistic-marginal — and states that only the marginal figure
satisfies the obligation; commits the absence statement; and, as corrected in
[#139](https://github.com/mbeacom/adrkit/pull/139), separates *emission* of reason codes from their *retention*),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(**superseded** — its Consequences and action items 2 and 4 are the origin of
this work; action item 4 is carried forward unmodified by ADR-0027 §4),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) **§ Calibration**
(the requirements source for the six metrics),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md)
(git is truth; a database is an index — the calibration set is data in the
repository, not a service),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(the binding state vocabulary and the rung-3 absence shape),
[ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
(no check counts as coverage until observed failing),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun toolchain), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–V.

**Precedent imitated, not invented**:
[`specs/009-catalog-binding-viability/`](../009-catalog-binding-viability/) —
its T014 → T014a → T016 freeze-then-independently-audit-then-gate procedure and
its `checklists/evidence-index.md` sanitized-evidence pattern; and
[`specs/010-catalog-backstage/`](../010-catalog-backstage/) Phase B, which
**discharged** spike 009's carry-forward blocker by running a fresh
T014 → T014a cycle rather than reusing the defective oracle (010 T017 re-froze
`derivedPathPatterns` in `compareCodeUnits` order; T019's independent auditor
**recomputes** both hashes rather than copying recorded values and records an
explicit **adequacy** finding, since integrity alone does not satisfy; T020
**observed the audit FAIL** against a deliberate input-order variant, retained at
`evidence/negative-cases/oracle-input-order/`).

That discharge is a **stronger** precedent than the open blocker it replaced. An
open blocker is a warning that a freeze can go wrong; a retained negative case is
proof that the audit **catches** it when it does — which is precisely the
ADR-0016 standard this feature holds its own gates to.

---

## Overview

[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
sat at `proposed` for eleven months because of one sentence in its Consequences:
*"publish escalation precision and recall each release, including the
false-negative rate."* That is unmeetable while the evaluator is
deterministic-only — every implemented trigger fires on **proven** evidence, so
precision is `1.0` by construction and recall is undefined. ADR-0027 resolved it
by superseding ADR-0005 and re-timing the obligation into a **shipping
precondition**:

> **No probabilistic pass may ship without a frozen holdout set that existed
> before the pass produced its first score.**

**This feature builds the thing that makes that precondition satisfiable.** It
delivers four artifacts, all deterministic and all model-free:

1. **A frozen calibration corpus** (`H`) — labeled historical cases with known
   outcomes, content-hashed and frozen in git, with labels authored and
   **independently audited before** any baseline derivation runs.
2. **A derived deterministic baseline** over `H` — byte-reproducible,
   re-derivable in CI, never hand-authored.
3. **A precondition gate** — a fail-closed, executable check that fails a release
   shipping a probabilistic pass without a qualifying holdout that predates it.
4. **The metric contract** — precision, recall, false-negative rate, score
   drift, inter-pass disagreement, and override rate, defined **now**, as
   executable pure functions, so the first probabilistic pass cannot define them
   favorably to itself.

The load-bearing property is the **ordering**. A holdout frozen after a scorer
has run against it is not a holdout; a label authored after someone has seen
which cases the evaluator escalated is not a label. Everything in this feature
that looks like bureaucracy — the hashing, the independent pre-derivation audit,
the commit-ancestry check — exists to make that ordering provable rather than
asserted.

### What the investigation found, and why it changes the design

Three findings from the pre-scoping investigation are load-bearing. They are
recorded here because each one rules out an approach that would otherwise look
obvious.

**Finding 1 — there is no accumulated escalation log to seed from.** ADR-0027's
table originally recorded ADR-0005 action item 3 ("log every escalation decision
with reason codes from day one") as **Met**, citing `route.escalate.*` and
`route.evidence.*.not-proven`. That was accurate about **emission** and silent
about **retention**. The codes are emitted on every run and retained on none:
**zero historical Pass 0 evaluations exist anywhere in the repository, in any
form.**

Retention — not emission — is what was asked for. Root `plan.md`'s Phase 4 exit
criterion is unambiguous:

> Escalation reason codes logged from the first run — **this is the calibration
> set, and it cannot be backfilled.**

The criterion's own warning came true. ADR-0027 was corrected before it was
pushed ([#139](https://github.com/mbeacom/adrkit/pull/139)): its table now separates emission from retention, its Context
states that the corpus must be **re-derived from committed history rather than
harvested**, and its Consequences records the loss as permanent. This feature
starts from that corrected position.

**Finding 2 — persisting nothing is a ratified contract, not an oversight.**

| Source | Statement |
|---|---|
| `specs/005-deterministic-evaluator/spec.md` SC-008 | "**Pass 0 persists nothing.**" |
| `specs/005-deterministic-evaluator/spec.md` SC-012 | no run writes or mutates any ADR file, acceptance state, or `review` field |
| `packages/cli/src/evaluate.ts` header | "never writes the report/patch back to any record or store — there is **NO `--write`** (FR-014)" |
| ADR-0027 §1 | forbids any evaluator surface to "approve, accept, merge, **persist**, or change an acceptance or `review` state" |

No workflow invokes `adr evaluate` except an artifact smoke test
(`.github/workflows/ci.yml`); neither `packages/ci/action.yml` nor
`packages/ci/queue/action.yml` runs it. The schema *affords* persistence — the
`Evaluation` object in `packages/core/src/schema/adr.schema.ts` carries `ranAt`,
`evaluatorVersion`, `rubricVersion`, `scores`, `confidence`, `escalate`,
`escalationReasons`, and `deterministicFindings` — but **no record in
`docs/adr/` carries an `evaluation:` block**. The affordance is entirely unused.

⇒ The calibration corpus is a **separate tracked artifact in git** (ADR-0004),
built by **re-derivation from committed history**. This feature adds **no**
persistence to Pass 0 and does not weaken feature 005's SC-008.

**Finding 3 — re-derivation is only partial, and the gap is invisible in the
output.** `adr evaluate` **requires** `--snapshot <bundle.json>`; historical
evaluations never had one. Of the eight implemented triggers:

| Trigger | Faithfully re-derivable from git alone? |
|---|---|
| `one-way-door` | **Yes** — pure frontmatter (`reversibility`) |
| `contradicts-accepted-adr` | **Yes** — from corpus rule results at the commit |
| `regulatory` | **Partly** — `complianceControls` yes; `regulatedTargets` needs a snapshot |
| `cost-threshold` | No — needs `routingEvidence.costEvidence` |
| `security-surface` | No — needs `securitySurfaceTargets` |
| `data-residency` | No — needs `dataResidency` |
| `agent-authored-production` | No — frontmatter half yes, `productionTargets` no |
| `human-requested` | No — needs `humanRequested` |

A `not-proven` caused by an **absent snapshot** is byte-identical in the output
to one caused by **evaluated-and-false** evidence. Counting the former as a true
negative would inflate deterministic precision and corrupt the recall denominator
for the probabilistic triggers later. ⇒ The case format records a **third state,
`evidence-absent`** (FR-005), and the evidence index discloses that snapshots are
**reconstructed, not harvested** (FR-024).

### Three further absences, recorded so they are not rediscovered

- **The default human render drops the not-proven half.** `renderHuman` in
  `packages/cli/src/evaluate.ts` prints `routing.reasons` — proven triggers only
  — plus the target. The eight-element `routing.evidenceStatus` array exists
  **only** under `--json`. Anyone capturing default output keeps exactly the half
  from which recall cannot be computed.
- **No run identity.** `RunMetadata.ranAt` is declared in
  `packages/evaluator/src/types.ts` and **never populated by any production
  path**; its only other occurrence, in
  `packages/evaluator/test/canonical-bytes.test.ts`, asserts `ranAt` is *banned*
  from the canonical bytes. This is correct under feature 005's FR-005
  byte-reproducibility contract, but it means captured output cannot be ordered
  into a time series.
- **No outcome label exists anywhere.** The rubric's four classes have no
  representation in the schema, the corpus, or any emitted artifact. That is the
  *label* half of the calibration set, and 100% of it is missing.

---

## User Scenarios & Testing

> **Ordering gate.** US1's freeze and independent audit (FR-006, FR-008) MUST
> complete with a `PASS` verdict before US2's derivation begins. This is the
> `specs/009-*` T014 → T014a → T016 shape and it is not a formality: US2 derives
> from the artifact US1 freezes, so an unfrozen or unaudited `H` makes every
> figure downstream of it uncheckable.

### User Story 1 — A frozen, independently audited calibration corpus exists in git (Priority: P1) 🎯 MVP

As a compliance owner, I want a labeled set of historical cases with known
outcomes — content-hashed, frozen, and versioned in the repository — with labels
authored and independently audited **before** any baseline derivation runs, so
that the corpus cannot be fitted to any result it will later be used to judge
(ADR-0005 action item 2; ADR-0027 §3; ADR-0004).

**Why this priority**: every other story reads this artifact. Without it, the
precondition in ADR-0027 §3 is unsatisfiable and no probabilistic pass can ship
at all.

**Independent Test**: Recompute the sha256 of every case input and of the frozen
corpus manifest; confirm each matches the value recorded in the tracked evidence
index. Confirm the audit record exists, names a reviewer independent of the
author, and carries an explicit `PASS`/`FAIL` verdict. Confirm the audit's commit
is an ancestor of the first derivation commit.

**Acceptance Scenarios**:

1. **Given** the frozen corpus, **When** its manifest hash is recomputed from the
   case files on disk, **Then** it equals the hash recorded in the tracked
   evidence index, and any mismatch is a **failure**, never a silent
   re-freeze.
2. **Given** the corpus, **When** its label distribution is inspected, **Then**
   every one of the four outcome classes (`shipped-clean`, `shipped-reverted`,
   `caused-incident`, `rejected-in-review`) is present with at least one case,
   and `|H| ≥ N` (FR-023, `[NEEDS CLARIFICATION: N]`).
3. **Given** a case, **When** its inputs are read, **Then** they identify the
   record **by content hash** and by commit, never by display path alone
   (Finding 3; the `proposalPath` in a `Pass0Report` is a display path).
4. **Given** the frozen corpus, **When** anyone proposes editing a case after the
   freeze, **Then** the required procedure is a **new freeze cycle** (re-author,
   re-hash, re-audit) — never an in-place correction, matching the fresh
   T014 → T014a cycle `specs/010-*` Phase B ran to discharge spike 009's
   carry-forward blocker.
5. **Given** the independent audit, **When** its verdict is `FAIL`, **Then** US2
   does not begin and the checkpoint does not clear.

### User Story 2 — The deterministic baseline over the holdout is derived, reproducible, and honest about absent evidence (Priority: P1)

As a maintainer, I want the deterministic Pass 0 result for every case in `H` to
be **derived** (never hand-authored), byte-for-byte reproducible, re-derivable in
CI, and to distinguish `evidence-absent` from `condition-unmet`, so the whole-gate and
probabilistic-marginal splits (FR-016) rest on a sound baseline rather than on a
count that silently conflates "false" with "unknowable" (Finding 3; Principle IV).

**Why this priority**: the probabilistic-marginal figure — the one ADR-0027 §3's
obligation actually binds to — is *defined* by which cases the deterministic
layer already escalated. If the baseline is wrong or unreproducible, that figure
is unfalsifiable.

**Independent Test**: Derive the baseline twice from the frozen inputs and assert
the two serializations are byte-identical. Assert that for at least one case, at
least one trigger is recorded `evidence-absent` and that it is counted as neither
a true negative nor a false negative.

**Acceptance Scenarios**:

1. **Given** the frozen inputs, **When** the baseline is derived twice, **Then**
   the two outputs are **byte-for-byte identical** (Principle: determinism
   contract; `adr queue` SC-001 precedent).
2. **Given** a case whose historical snapshot could not supply a trigger's
   evidence, **When** the baseline is derived, **Then** that trigger is recorded
   `evidence-absent`, **not** `condition-unmet`, and is excluded from every
   confusion-matrix cell.
3. **Given** the baseline, **When** it is checked into git, **Then** CI
   re-derives it and fails on any difference — the artifact is **self-verifying**
   (ADR-0014 rung 2), not merely committed.
4. **Given** the derivation, **When** it runs, **Then** it performs **no** model
   call, prompt, embedding, or retrieval, and imports no such library
   (Principle IV).
5. **Given** the derivation, **When** it runs, **Then** it writes **no** ADR
   file, acceptance state, or `review` field, and does not alter Pass 0's
   persistence contract (feature 005 SC-008, SC-012).

### User Story 3 — A release shipping a probabilistic pass without a qualifying frozen holdout fails, and the gate has been observed failing (Priority: P1)

As a release manager, I want an executable, fail-closed CI check that fails any
release containing a probabilistic pass when no qualifying frozen holdout
predates that pass's first score — and I want that check to have been **observed
rejecting** deliberate violations before it is trusted (ADR-0027 §3 and action
item 4; ADR-0016).

**Why this priority**: ADR-0027's whole rescope rests on this. *"A per-release
report is discharged by publishing a number; a precondition blocks the ship."* An
unenforced precondition is exactly the quiet drop the record was written to
prevent.

**Independent Test**: Construct each of the four violation fixtures (FR-014) and
observe the gate **fail** on each before the implementation is trusted; then
observe it pass on the conforming case.

**Acceptance Scenarios**:

1. **Given** a release that declares a probabilistic pass and no frozen holdout
   exists, **When** the gate runs, **Then** it **fails** the release.
2. **Given** a holdout whose freeze commit is **not** an ancestor of the first
   commit that produced a score, **When** the gate runs, **Then** it **fails** —
   ordering is proven by commit ancestry, not asserted in prose.
3. **Given** a dependency graph showing a model/prompt/embedding/retrieval
   dependency that the declared passes registry does not list — **or** a registry
   entry with no corresponding dependency — **When** the gate runs, **Then** it
   **fails**. Neither source may quietly disagree with the other.
4. **Given** a holdout missing one of the four outcome label classes, or smaller than
   `N`, **When** the gate runs, **Then** it **fails** (FR-023).
5. **Given** a holdout manifest that is unreadable, unhashable, or whose
   recomputed hash differs from the recorded one, **When** the gate runs, **Then**
   it **fails** — unknown is never treated as satisfied (**fail-closed**).
6. **Given** the gate, **When** it runs, **Then** it uses **no model** and reads
   only committed repository state (Principle IV).

### User Story 4 — Every release states the absence, and the statement cannot go stale (Priority: P2)

As a reader of a release, I want each release — while no probabilistic pass has
shipped — to state that fact and to state that no precision/recall figures exist,
reported as explicitly **absent**, never assumed, never fabricated; and I want
that statement to become **forbidden automatically** the moment a probabilistic
pass is declared, so it cannot survive as a stale ritual (ADR-0027 Consequences,
explicit commitment; ADR-0014's rung-3 absence shape).

**Why this priority**: ADR-0027's own "revisit if" clause names *"a release omits
the absence statement"* as evidence the rescope became the quiet drop it was
written to prevent. But a statement that is merely *remembered* decays; and a
statement that is enforced but never flips becomes a lie the day the first pass
ships.

**Independent Test**: Delete the absence statement from `docs/RELEASING.md` and
observe the enforcing test fail. Then declare a probabilistic pass in the
registry and observe the same test fail *for the opposite reason* — the absence
statement is now present and must not be.

**Acceptance Scenarios**:

1. **Given** no probabilistic pass is declared, **When** the enforcement runs,
   **Then** it requires the absence statement in `docs/RELEASING.md` and requires
   it to be consistent with README's Dogfooding section.
2. **Given** no probabilistic pass is declared, **When** the enforcement runs,
   **Then** it **forbids** any published escalation precision, recall, or
   false-negative-rate figure — a fabricated number fails, and so does a
   `1.0`/`n/a` placeholder (ADR-0027: *"`precision 1.0, recall n/a` reads as a
   healthy gate and is the more dangerous artifact"*).
3. **Given** a probabilistic pass **is** declared, **When** the enforcement runs,
   **Then** the absence statement becomes **forbidden** and the
   probabilistic-marginal figures (FR-016) become **required**.
4. **Given** either state, **When** the enforcement runs, **Then** it reports
   what it examined — an empty document set must not satisfy it vacuously
   (ADR-0016 clause 3; `no-correctness-claim.test.ts` precedent).

### User Story 5 — The metrics are an executable contract, fixed before the first pass exists (Priority: P2)

As the owner of the calibration definitions, I want precision, recall,
false-negative rate, score drift, inter-pass disagreement, and override rate
implemented as **pure, model-free functions with fixtures**, so
`specs/011-probabilistic-evaluator-passes/` consumes them rather than redefining
them, and so no pass can define its own grading favorably to itself.

**Why this priority**: the metrics are the only part of this feature a later
author has an incentive to reshape. Fixing them in code, before any score exists,
is what makes them binding.

**Independent Test**: Feed each metric a fixture with an empty denominator and
assert it returns **absent** — never `1.0`, never `0`. Feed the split functions a
fixture where a deterministic trigger fired and assert the case is excluded from
the probabilistic-marginal population.

**Acceptance Scenarios**:

1. **Given** `TP + FP = 0`, **When** precision is computed, **Then** it is
   reported **absent**, never `1.0` and never `0`.
2. **Given** `TP + FN = 0`, **When** recall is computed, **Then** it is reported
   **absent**, and the holdout is flagged as failing its own validity
   precondition (FR-023).
3. **Given** any figure, **When** it is rendered, **Then** it carries its
   absolute counts and denominator — never a bare percentage (FR-017).
4. **Given** a case where any deterministic trigger fired, **When** the
   probabilistic-marginal population is computed, **Then** that case is
   **excluded** (FR-016).
5. **Given** an inter-pass disagreement rate of exactly `0.0` over `|H| ≥ N`,
   **When** the report is produced, **Then** it asserts a **defect signal**, not
   a passing figure (rubric: *"If Pass 2 and Pass 3 never disagree, one of them
   is not doing its job."*).
6. **Given** score drift, **When** it is reported, **Then** it is per dimension
   and **never averaged across dimensions** (FR-019).
7. **Given** the metric functions, **When** their dependency graph is inspected,
   **Then** they import no model/prompt/embedding/retrieval library and read no
   clock, network, or filesystem (Principle IV).

### User Story 6 — Sensitive historical material never enters the repository (Priority: P3)

As a maintainer, I want raw historical proposals and any incident material to
stay **scratch-only**, with a tracked, sanitized evidence index carrying content
hashes, tool versions, and a reviewer verdict, so the calibration corpus is
auditable without the repository becoming a disclosure surface.

**Why this priority**: real, and the established pattern here
(`specs/008-*/checklists/evidence-index.md`,
`docs/reference-verification-spec-kit-extension.md`), but it constrains *how*
US1 lands rather than blocking it.

**Independent Test**: Confirm no tracked file contains raw historical proposal
bodies or incident detail; confirm the tracked index records a sha256 for every
scratch artifact it references, plus tool versions and an explicit reviewer
verdict.

**Acceptance Scenarios**:

1. **Given** a case drawn from sensitive material, **When** it is added to `H`,
   **Then** the tracked case carries hashes and labels but not the raw body.
2. **Given** the evidence index, **When** it is reviewed, **Then** every
   referenced scratch artifact has a recorded sha256, and every tool used has a
   recorded version.
3. **Given** the index, **When** a hash is recomputed, **Then** it matches — the
   index is verifiable, not decorative.

### Edge Cases

- **A holdout with zero positive cases.** Recall is undefined. This is a
  **validity failure of `H`** (FR-023), reported as such, not a recall of `0`.
- **A holdout with zero negative cases.** Precision is `1.0` trivially. Same
  disposition: a validity failure, not a figure.
- **Every trigger `evidence-absent` for a case.** The case contributes to no
  confusion-matrix cell for the deterministic baseline and is flagged; it may
  still be a valid probabilistic-marginal case (nothing deterministic fired), and
  that asymmetry must be stated rather than smoothed.
- **A case whose record was later superseded without incident.** Fits none of the
  four rubric classes cleanly — see `[NEEDS CLARIFICATION: label exhaustiveness]`.
- **A model upgrade with `|drift(d)| > ε` for one dimension and compensating
  drift in another.** Per-dimension reporting (FR-019) catches it; a cross-
  dimension average would hide it. This is why averaging is forbidden.
- **The registry declares a pass that was later removed.** The registry/graph
  cross-check (FR-013) fails in the "registry entry with no dependency"
  direction, which is deliberate: the registry must be corrected explicitly.
- **A release with no probabilistic pass and no absence statement.** Fails US4 —
  this is ADR-0027's own named "revisit if" trigger.
- **Two runs of the derivation in different ICU locales.** Must produce identical
  bytes; `compareCodeUnits` / `byCodeUnit` only, never `localeCompare`
  (issue #115).

---

## Requirements

### Functional Requirements

#### The calibration corpus

- **FR-001 — The corpus is data in git, not a service.** `H` MUST be a set of
  tracked files in the repository. No database, index, or network service may be
  required to read, verify, or use it (ADR-0004; Principle I). Any index built
  over it MUST be rebuildable from the tracked files alone.

- **FR-002 — Pass 0's persistence contract is unchanged.** This feature MUST NOT
  add any write, log, or persistence side-effect to Pass 0, `adr evaluate`, or
  any evaluator surface. Feature 005 SC-008 ("Pass 0 persists nothing") and
  SC-012 stand unmodified, as does ADR-0027 §1's prohibition on persisting. The
  corpus is built by **re-derivation from committed history**, never by
  instrumenting the evaluator.

- **FR-003 — Each case identifies its inputs by content, not by path.** A case
  MUST record: the evaluated record's **content hash** and originating commit;
  the corpus state (commit) it was evaluated against; the authored snapshot's
  content hash; and the `evaluationDate` used. A display path MAY be recorded for
  legibility but MUST NOT be the identity.

- **FR-004 — Each case carries exactly one outcome label** drawn from the closed
  set fixed by `docs/EVALUATOR_RUBRIC.md` § Calibration: `shipped-clean`,
  `shipped-reverted`, `caused-incident`, `rejected-in-review`.

- **FR-005 — Trigger evidence is three-state, in a vocabulary that shares no
  token with routing.** For each trigger, a case MUST record exactly one of:

  | Token | Meaning |
  |---|---|
  | `condition-met` | evidence was available and the trigger condition held |
  | `condition-unmet` | evidence was available and the condition did **not** hold — ADR-0027's *"evaluated-and-false"* |
  | `evidence-absent` | no evidence was available to evaluate — ADR-0027's *"whose evidence was absent"* |

  A case recorded `evidence-absent` for a trigger MUST NOT be counted as a true
  negative, a false negative, or any other confusion-matrix cell for that
  trigger.

  **Why these tokens and not the routing ones.** `packages/evaluator/src/types.ts`
  declares `TriggerEvidenceStatus.status` as `'proven' | 'not-proven'`, and
  `routing/route.ts` emits `not-proven` both when a condition is evaluated false
  **and** when optional evidence is missing. For routing that conflation is
  correct — escalation fires only on proven evidence, so the two cases route
  identically — and widening it would change landed behavior for eight triggers
  to serve calibration, which FR-002 forbids. **The landed routing vocabulary
  does not change.** This calibration vocabulary is a separate namespace and
  deliberately reuses neither `proven` nor `not-proven`, because one string
  carrying two meanings is how a recall denominator goes silently wrong.

  **No schema change and no Principle V question.** Verified: `not-proven`
  appears **0 times** in `schema/adr.schema.json` and **0 times** in
  `packages/core/src/schema/adr.schema.ts`. Both vocabularies are internal to the
  evaluator package and neither is part of the published contract. Recorded here
  so the question is not reopened later out of a fear of breaking change.

  **Related but distinct**: `scope-hierarchy.evidence-absent` already exists as a
  namespaced **rule-level `ReasonCode`** in `packages/evaluator/src/catalog.ts`.
  It expresses the same underlying idea — backing evidence was unavailable — at a
  different scope (a rule, not a calibration case) and in a different field. It
  is a deliberate echo, not a collision.

  **Comparison is exact equality against an exhaustive union.** Substring or
  prefix matching MUST NOT be used, because `met` is a substring of `unmet`.

  These three tokens are **frozen here** and are consumed, not redefined, by
  `specs/011-probabilistic-evaluator-passes/`. The same three states extend to
  any probabilistic trigger once one ships: a case for which a pass produced no
  comparable output is `evidence-absent`, never `condition-unmet`.

- **FR-005a — A case stores the label, never the derived ground truth.** A case
  MUST NOT store `positive(c)`, an expected-escalation boolean, or any other
  field duplicating what FR-018's mapping derives from the label. Ground truth is
  **computed** from the label at report time, so that the mapping is the single
  point of change and the two cannot drift apart. A stored boolean alongside a
  stored label is two sources of truth for one fact.

- **FR-005b — A case carries no reference D1–D8 scores.** Holdout items MUST NOT
  carry human-authored per-dimension reference scores. Score drift (FR-019) is
  the difference between **two model versions'** score sets over the same frozen
  `H` and needs no ground-truth score to be computed. Adding one would introduce
  a second labeling task with its own circularity risk (FR-009) and its own
  inter-rater reliability problem, to support a metric that does not require it.
  If a later feature needs graded reference scores, that is a new freeze cycle
  (FR-007) and its own scope — not an unused field added speculatively now.

- **FR-006 — The corpus is frozen and content-hashed before any scorer runs.**
  A manifest MUST record a sha256 for every case input and a sha256 over the
  manifest itself, and those values MUST be recorded in the tracked evidence
  index. A recomputed hash that differs from the recorded one is a **failure**,
  never an occasion to re-freeze silently.

- **FR-007 — Correction requires a new freeze cycle.** After the freeze, a case
  MUST NOT be edited in place. Any correction requires re-authoring, re-hashing,
  and re-auditing (a fresh FR-006 → FR-008 cycle), and the superseded artifact
  MUST be retained rather than deleted. This is the procedure `specs/010-*`
  Phase B used to discharge spike 009's carry-forward blocker — a fresh cycle,
  not a correction of the frozen artifact — applied here prospectively.

- **FR-008 — Labels are independently audited before any derivation; the audit
  recomputes rather than confirms, and must reach an adequacy finding.** A
  reviewer with **no authoring involvement** in the labels MUST, in a separate
  task and before US2 begins: **recompute** every recorded hash from the
  artifacts themselves — never copy or merely confirm the recorded values;
  confirm all four outcome label classes are present; confirm each label is justified by
  evidence independent of any evaluator output; record an explicit **adequacy**
  finding on the corpus; and record the auditor's **own** `PASS`/`FAIL` verdict.
  A `FAIL` blocks US2.

  **Integrity alone does not satisfy this requirement.** An audit that confirms
  every hash matches and stops there has established that the corpus is
  unmodified, not that it is fit to calibrate against — an `H` can be perfectly
  intact and still lack a outcome label class, or be too small, or carry labels derived
  from evaluator output. Reporting integrity as if it were adequacy is the same
  substitution FR-017b forbids of the metrics: a narrower measurement presented
  as a broader assurance. `specs/010-*` T019 and T021 establish this shape, T021
  by **observing a FAIL** for an audit that confirmed integrity but never reached
  an adequacy finding.

- **FR-009 — Labels MUST NOT be derived from evaluator output.** A label
  justified by which triggers fired is circular and MUST be rejected by FR-008's
  audit. Labels derive from outcome evidence (revert commits, incident records,
  review rejections), never from the gate being measured.

#### The derived baseline

- **FR-010 — The baseline is derived, reproducible, and self-verifying.** The
  deterministic Pass 0 result for every case MUST be **derived** from the frozen
  inputs, never hand-authored; MUST be byte-for-byte identical across runs on
  identical inputs; and MUST be re-derived in CI with any difference failing the
  build (ADR-0014 rung 2: reproducible, self-verifying, fail-closed). Ordering
  uses `compareCodeUnits` / `byCodeUnit`; `localeCompare` MUST NOT appear on any
  serialized surface (issue #115).

#### The precondition gate

- **FR-011 — The gate blocks the ship.** An executable check MUST fail any
  release that includes a probabilistic pass when no qualifying frozen holdout
  existed before that pass produced its first score (ADR-0027 §3).

- **FR-012 — The gate is deterministic, model-free, and reads only committed
  state.** It MUST NOT call a model, read the network, or depend on anything
  outside the repository at the release commit (Principle IV).

- **FR-013 — Detection of "a probabilistic pass shipped" is cross-checked from
  two independent sources.** A declared **passes registry** (data in git) MUST be
  cross-checked against the dependency-boundary evidence already asserted by
  feature 005 SC-006 and enforced by `bun run check:deps` (the evaluator imports
  no model/prompt/embedding/retrieval library). A dependency the registry does
  not declare — **or** a registry entry with no corresponding dependency — MUST
  fail the gate. Neither source may quietly disagree with the other.

- **FR-014 — The gate is fail-closed.** An unreadable, unhashable, absent, or
  hash-mismatched holdout manifest MUST fail. Unknown MUST NEVER be treated as
  satisfied.

- **FR-015 — Ordering is proven by commit ancestry.** The gate MUST verify that
  the holdout's freeze commit is an ancestor of the first commit that produced a
  score. A prose assertion of ordering MUST NOT satisfy it.

#### The metrics

- **FR-016 — Every escalation figure is published twice: whole-gate and
  probabilistic-marginal.** This requirement is **normative in ADR-0027 §3**, not
  original to this spec; it is restated here because this feature implements it.
  Escalation is a boolean OR, so a case escalated by any of the eight
  deterministic triggers is escalated regardless of what a probabilistic pass
  concluded. Precision, recall, and false-negative rate MUST each be published
  for:
  - **whole-gate** — the full OR over all triggers; and
  - **probabilistic-marginal** — restricted to cases where **no deterministic
    trigger fired**, so a probabilistic pass is the only thing that could have
    escalated.

  ADR-0027 §3 states the disposition directly: *"The obligation above is
  satisfied by the probabilistic-marginal figure; the whole-gate figure alone
  does not satisfy it."* A whole-gate-only report MUST NOT satisfy the
  precondition. Rationale, in the record's own words: eight deterministic
  triggers whose precision is `1.0` by construction *"will carry a whole-gate
  figure regardless of whether the probabilistic passes contribute anything at
  all"* — the ADR-0005 "evaluator theater" hazard, displaced one level down.

- **FR-016a — The whole-gate denominator is permanently weaker than the marginal
  one, and the report must say so itself.**

  For the eight landed triggers the false/absent distinction is **destroyed at
  emission**: `routing/route.ts` emits `not-proven` for both, so it never enters
  the report and **no consumer can recover it from the report alone.**
  Reconstructed snapshots (FR-024) recover it only partially, by construction.

  The three probabilistic triggers can carry FR-005's three states from day one.
  The landed eight cannot be retrofitted without changing landed behavior, which
  FR-002 forbids. **This asymmetry is therefore permanent, and it is not a defect
  to fix — it is a measurement limitation to state plainly, once, where a reader
  computing a metric will see it.**

  It follows that whole-gate recall's denominator contains an irreducible
  population whose membership cannot be verified, while the
  probabilistic-marginal denominator — restricted to cases where no deterministic
  trigger fired — **can** be clean.

  **This is the stronger justification for FR-016's dual-figure rule.** ADR-0027
  §3 argues from masking: eight triggers at precision `1.0` by construction would
  hide a worthless probabilistic pass. The sharper reason is that **the marginal
  figure is the only one whose denominator can be clean.** That turns the dual
  requirement from a policy choice into a measurement necessity, which is far
  harder to erode later.

  Mechanically: every whole-gate figure MUST be emitted carrying a
  machine-readable qualifier naming the landed-eight conflation as a denominator
  limitation. The qualifier MUST come from the report itself and MUST NOT live
  only in prose that a consumer can forget to copy forward. A whole-gate figure
  emitted without it is a defect.

- **FR-017 — Absence is reported as absence; figures carry their denominators.**
  A metric with an empty denominator MUST be reported **absent** — never `1.0`,
  never `0`, never `n/a` presented as a value. Every figure MUST be published
  with its absolute counts and denominator, never as a bare percentage, so a
  one-case holdout cannot report "100% precision".

- **FR-017a — Every uncomputable metric reports `not-computable` with a machine
  reason code.** A metric that cannot be computed MUST emit an explicit
  `not-computable` state carrying a stable, namespaced machine reason code naming
  *why* — at minimum: an empty denominator (FR-017), a holdout below `N`
  (FR-023), a missing outcome label class (FR-023), and an absent input source (FR-021).
  A `not-computable` state MUST NEVER be rendered as, coerced to, or defaulted to
  a value that reads as passing. This rule is binding **independently of** the
  values eventually chosen for `ε` and `N`: it is what prevents an unset constant
  from silently becoming a green figure. Reason codes follow the existing
  `packages/evaluator/src/catalog.ts` convention (exhaustive, stable,
  namespaced).

- **FR-017b — Not-computable is four disjoint classes, and they may never be
  collapsed.** Every `not-computable` state MUST carry exactly one of the
  following classes alongside its specific reason code:

  | Class | Meaning | Disposition |
  |---|---|---|
  | `nothing-to-measure` | The subject does not exist yet, by construction — e.g. no probabilistic pass has shipped. | Honest and expected. **The only class that may render ADR-0027's absence statement.** |
  | `input-unavailable` | The measurement is well-defined, but a required input does not exist in the project at all — e.g. the override rate's decision log (FR-021). | Honest; a named gap. **Not** ADR-0027's absence statement. |
  | `undefined-value` | The measurement ran over real data and the quantity is mathematically undefined — e.g. zero probabilistic escalations, so `TP + FP = 0`. | **A finding, not a failure.** |
  | `measurement-failed` | The input should exist and could not be used — holdout unreadable, hash mismatch, `\|H\| < N`, a missing outcome label class, a model version absent from the drift baseline. | **A defect. MUST fail the gate (FR-011).** |

  **`measurement-failed` is about outcome label classes, never about trigger
  coverage.** A trigger that is `evidence-absent` — including for **every** case
  in `H` — is **not** a `measurement-failed` and does not fail the gate; see
  FR-023a, which governs. This table is the normative statement of what fails a
  release, so the qualifier is repeated here rather than left to a reader who
  arrives at this table first.

  Two collapses are specifically forbidden, because each destroys the signal the
  report exists to carry:
  - **`undefined-value` MUST NOT be represented as `measurement-failed`, or the
    reverse.** "We measured, and the quantity is undefined" is a finding about
    the passes — zero probabilistic escalations may mean the passes contribute
    nothing, which is exactly what this feature exists to surface. "We failed to
    measure" is a defect in the harness. Collapsing them hides whichever is real.
  - **A computed value of zero MUST be representable distinctly from every
    `not-computable` state.** *Measured, and clean* and *could not measure* are
    different facts and MUST NOT share a representation.

  **Why this is a requirement and not a style note.** PR #98's
  `run-network-denied.ts` treated empty stdout plus a non-zero exit as *"this
  environment cannot deny network access"*, when in fact the sandbox had been
  created successfully and only the payload inside it failed to resolve. A
  `measurement-failed` was reported as an environmental absence — in a file whose
  entire purpose was to **prove** denial rather than infer it from absent
  traffic. It survived five consecutive CI failures because the wrong branch
  looked like an honest "not available here". This feature computes metrics with
  exactly that failure surface, and a calibration report that collapses "could
  not measure" into "measured, and clean" is indistinguishable from a healthy
  gate right up until it matters.

- **FR-018 — The positive class is fixed here, not per release.** Ground truth
  `positive(c)` is derived from the FR-004 label by this frozen mapping:

  | Label | `positive(c)` | Rationale |
  |---|---|---|
  | `caused-incident` | **true** | the class the rubric says to optimize recall on |
  | `shipped-reverted` | **true** | human review would have changed the outcome |
  | `rejected-in-review` | **true** | a human did escalate, and correctly |
  | `shipped-clean` | **false** | escalating costs reviewer minutes only |

  With `TP/FP/FN/TN` counted over `H` under this mapping:
  **precision** = `TP/(TP+FP)`; **recall** = `TP/(TP+FN)`;
  **false-negative rate** = `FN/(TP+FN)`, published as its **own number** and
  never left for a reader to infer from recall (ADR-0005 and ADR-0027 both name
  it separately).

- **FR-019 — Score drift is per dimension, measured on the surviving score, and
  never averaged.** For dimension `d ∈ {D1..D8}` and model versions `m₁, m₂` over
  the **same** frozen `H`:
  `drift(d) = mean_c score_d(c, m₂) − mean_c score_d(c, m₁)`. `|drift(d)| > ε`
  makes the model upgrade a **breaking change requiring its own ADR** (ADR-0005
  action item 4, carried forward unmodified by ADR-0027 §4). Drift MUST be
  reported per dimension; a cross-dimension average MUST NOT be published,
  because it hides a compensating pair.

  `score_d` is the **post-drop surviving score** from `RubricScoreSnapshot` — the
  score that actually feeds weighting and routing — not the raw score. The raw
  score MUST also be retained, because the difference between raw drift and
  surviving drift distinguishes a **judgment** shift from a **citation-behavior**
  shift: a model upgrade that cites less diligently moves surviving scores
  without changing what it thinks, and the two demand different responses.
  Reporting only one of them would make a citation regression look like a
  judgment regression, or hide it entirely.

  A model version absent from the drift baseline is `measurement-failed`
  (FR-017b), never a quiet skip.

- **FR-019a — `ε` is set by a specified mechanism, not by a number chosen now.**
  This feature MUST specify **how `ε` is derived**, and MUST NOT ship a value.
  An epsilon chosen before any drift has been observed becomes a threshold a
  later reader assumes was validated, when it was guessed. The mechanism MUST:
  derive a candidate `ε` per dimension from the **observed spread across the
  first two model versions** scored over the same frozen `H`; record the
  observation set and its date; and require the resulting value to be ratified in
  a record, since it governs when a model upgrade becomes a breaking change.
  Until that observation exists, drift reports `not-computable` with reason code
  per FR-017a — it MUST NOT default to a passing comparison.
  `[NEEDS CLARIFICATION: ε mechanism ratification]`

- **FR-020 — Inter-pass **disagreement** is the reported figure, it is an
  aggregation and never a recomputation, and zero is a defect signal.**

  The metric MUST be computed **solely by aggregating the recorded
  `pass-disagreement` trigger evidence** for each case (FR-005's three-state
  record). It MUST NOT re-derive the Pass 2 / Pass 3 comparison by any second
  code path or second definition.

  This is stricter than sharing a predicate between the trigger and the metric,
  and deliberately so: two callers of one shared predicate can still pass it
  different arguments and diverge, whereas an aggregation over evidence the
  trigger already recorded **cannot** disagree with the trigger. A published
  agreement rate that fails to reconcile with the trigger's own firings is
  precisely the incoherence ADR-0027 exists to prevent, so the design removes the
  second computation rather than trying to keep two in step.

  Denominator: cases whose `pass-disagreement` evidence is `condition-met` or
  `condition-unmet`. Cases recorded `evidence-absent` — Pass 2 or Pass 3 did not
  produce comparable output — MUST be **excluded from the denominator**, not
  counted as agreement. Including them would dilute the rate toward zero and so
  **manufacture** the defect signal below out of missing data, which is the same
  conflation FR-005 exists to prevent.

  `disagreement = |{c : pass-disagreement condition-met}| / |{c :
  pass-disagreement condition-met or condition-unmet}|`

  It MUST be reported as *disagreement*, not agreement. A rate of exactly `0.0`
  over a denominator of at least `N` **evaluated** cases MUST be asserted as a
  **defect signal**, not rendered as a passing figure (rubric: *"If Pass 2 and
  Pass 3 never disagree, one of them is not doing its job."*). Below that
  denominator it reports `not-computable` (FR-017a) rather than a defect signal —
  a zero drawn from too few cases is not evidence of the defect.

- **FR-020a — Calibratable thresholds are owned here, and so are the definitions
  they threshold once the producing shape is published.** Two tuning parameters
  have a calibration story and belong to this feature: `ε` for score drift
  (FR-019a) and the `low-confidence` **threshold** (rubric default `0.7`). For
  each, this feature owns the derivation mechanism from the frozen holdout and
  the rule that changing a default is an ADR with calibration deltas attached
  (ADR-0005 action item 4, carried forward by ADR-0027 §4). **No new value
  ships**; the rubric's documented default stands until calibration justifies
  moving it, and until a calibrating observation exists the affected figure
  reports `not-computable` (FR-017a).

  This feature **also owns the definitions** of the quantities those thresholds
  apply to — see FR-020b and FR-020c. An earlier draft placed them with
  `specs/011-*` on the grounds that they are functions of output shapes this
  feature must not invent. **That premise no longer holds**: `specs/011-*` has
  published `RubricScoreSnapshot` and `AdversarialSnapshot`, so these are now
  functions over a *published* shape rather than an invented one. And the
  original reason for splitting them was never sound in the other direction — a
  threshold calibrated against a quantity its owner does not define is
  calibrating something it does not control.

  One constraint remains, and it is load-bearing: every such quantity MUST be
  derived from the **structure** of a pass's output, never from a model's
  self-reported certainty. A self-reported confidence is model discretion wearing
  a threshold, which Constitution Principle IV and ADR-0027 §1 both forbid, and
  it is not calibratable — a holdout cannot correct a number the model is free to
  restate.

- **FR-020b — Aggregate confidence is citation coverage over a fixed denominator
  of eight.**

  `confidence = |{d ∈ D1..D8 : Pass 2 produced a surviving, cited score for d}| / 8`

  The `low-confidence` trigger fires when `confidence` is below its threshold
  (rubric default `0.7`).

  **The denominator is the constant 8, never "dimensions attempted."** A
  gameable denominator is the same defect FR-017 guards in the metrics: a pass
  that attempted two dimensions and cited both would otherwise score `1.0`, which
  is exactly backwards — that is the *least* confident possible run, not the
  most. Dimensions that are absent, uncited, or dropped all lower confidence,
  which is the intended direction.

  This is grounded in the rubric's own mechanics rather than invented: *"every
  score above 0 must cite a span of the proposal"*, *"every score below 3 must
  name the specific missing thing"*, and *"Uncited scores are dropped by the
  aggregator."* Citation coverage is what the rubric already treats as the
  structural quality signal. It is computable by the pure kernel from
  `RubricScoreSnapshot` alone, requires no call-out, and is model-free.

  It also keeps the documented default coherent: `0.7 × 8 = 5.6`, so the trigger
  fires when fewer than six of eight dimensions survive with citations — i.e.
  three or more are uncited or absent. A definition that made the rubric's own
  default absurd would be evidence against the definition.

  **Rejected alternatives**, recorded so the choice is auditable:
  *score dispersion* measures disagreement **between dimensions**, not
  confidence — a proposal genuinely excellent on D1 and poor on D7 has high
  dispersion and may be scored with complete confidence, so it would
  systematically flag heterogeneous-but-well-understood proposals.
  *Self-consistency across k samples* is the most informative in principle but
  requires the harness to return `k` samples, multiplying model cost by `k` and
  changing 011's harness contract; it also measures consistency, and a model can
  be consistently wrong. It is not excluded forever — it could become a *second*
  signal — but adding it would change what the threshold means and therefore
  needs its own record.

- **FR-020c — The contradiction predicate, owned here and evaluated once.**

  For a dimension `d ∈ D1..D8`, Pass 3 **contradicts** Pass 2 on `d` when either
  holds:

  1. a **present** `hidden-one-way-door` adversarial output carries `d` in its
     `bearsOn` set — unconditionally, whatever Pass 2 scored; or
  2. any **present** adversarial output carries `d` in its `bearsOn` set **and**
     Pass 2's post-drop surviving score for `d` is **≥ 3**.

  Both disjuncts come straight from the rubric, which escalates when Pass 3
  *"surfaces a hidden one-way door **or** an objection that Pass 2 scored as
  already addressed."* The cut point is **not invented**: the rubric's shared
  anchors define `3` as *"adequate for the blast radius"*, and require that
  *"every score below 3 must name the specific missing thing"*. A score of `≥ 3`
  **is** the rubric's own statement that the dimension was adequately handled, so
  an objection against it is a contradiction by the rubric's own vocabulary.

  An adversarial output that is **explicitly absent** contributes nothing; it is
  neither a contradiction nor evidence of agreement. If Pass 2 or Pass 3 produced
  no comparable output for `d` at all, the trigger's evidence for that case is
  `evidence-absent` (FR-005), which FR-020 excludes from the denominator.

  **This predicate is defined once and evaluated once.** `specs/011-*` evaluates
  it as the `pass-disagreement` trigger and **records** the resulting three-state
  evidence; this feature **aggregates that record** and never re-derives the
  comparison (FR-020). One definition, one evaluation, one recording — so the
  published disagreement rate and the trigger's firings reconcile by
  construction rather than by diligence.

- **FR-020d — No relevance floor is scoped, because there is nothing for it to be
  a floor over.** The rubric defines `novel-no-precedent` as firing when
  *"retrieval returns nothing above the relevance floor"*, and an earlier draft
  of this spec claimed that floor as a calibratable parameter. **It is
  withdrawn.** Verified: the repository has no relevance scoring of any kind —
  `packages/mcp/src/search/normalize.ts` documents the search primitive as *"No
  stemming, fuzzy, weighting, or ranking"*, and `search-decisions.ts` returns
  *"bounded summaries only — no ranking, no model, no body."* `specs/011-*`
  deliberately does not build a ranker.

  A floor calibrated over a ranking function that does not exist would be a
  parameter whose tuning changes nothing — a measurement that measures nothing,
  which is the precise failure ADR-0027 rescoped ADR-0005 to prevent, and which
  FR-017b forbids elsewhere in this same document. Applying this feature's own
  rule to itself: the relevance floor is **`nothing-to-measure`** (FR-017b class
  1), not a parameter awaiting a value.

  Consequently `novel-no-precedent` is expected to be permanently
  `evidence-absent` in the holdout until a ranking primitive exists. That is
  recorded, not worked around. Who owns such a primitive is unassigned and is
  **not** claimed here.
  `[NEEDS CLARIFICATION: relevance primitive ownership]`

- **FR-021 — Override rate is defined now, and `not-computable` is its correct
  published answer.** Override rate = `|{c : a human reversed the routing
  recommendation}| / |{c : routed at that tier}|`, reported by tier and by
  dimension. **Its input does not exist**: there is no human-decision log
  anywhere in the repository (Finding 2). The definition is fixed here so a later
  pass cannot reshape it, and the metric MUST be **published** in the
  `not-computable` state (FR-017a) with a reason code naming the missing decision
  log. It MUST NOT be quietly dropped from the report, and a source MUST NOT be
  invented to make it computable. A defined metric that reports "not computable —
  no decision log exists" is the honest answer and creates visible pressure to
  build one; a metric silently absent from the report creates none.
  `[NEEDS CLARIFICATION: override-rate source]`

- **FR-022 — The metrics are pure, model-free functions with fixtures.** They
  MUST be implemented as pure functions over the frozen corpus and a supplied
  score set, importing no model/prompt/embedding/retrieval library and reading no
  clock, network, or filesystem (Principle IV). `specs/011-*` MUST consume them
  rather than redefining them.

- **FR-023 — Validity preconditions on `H`, enforced not assumed.** `H` is
  qualifying only if: it is frozen and hash-verified (FR-006); its freeze
  predates the first score (FR-015); `|H| ≥ N`; at least one case of each of the
  four **outcome label classes** is present; and every trigger's evidence state is
  recorded three-state (FR-005). Failure of any precondition MUST fail the gate
  (FR-011), not merely annotate the report. **When `|H| < N`, or an outcome label
  class is missing, every affected metric MUST report `not-computable` with its
  reason code (FR-017a) — never a passing-looking value.** That rule is binding
  regardless of which number `N` takes, and is expected to be exercised from the
  first run rather than in theory (see clarification 5).
  `[NEEDS CLARIFICATION: N]`

- **FR-023a — Outcome label classes and triggers are different axes, and a
  permanently `evidence-absent` trigger is valid.** The four classes in FR-004
  and FR-023 are **outcome labels** on a case (`shipped-clean`,
  `shipped-reverted`, `caused-incident`, `rejected-in-review`). They are **not**
  triggers. A trigger recorded `evidence-absent` — even for **every** case in `H`
  — MUST NOT be treated as a missing outcome label class and MUST NOT fail the gate.

  This is not hypothetical: `novel-no-precedent` is expected to be
  `evidence-absent` for 100% of cases permanently, because no relevance primitive
  exists for it to threshold (FR-020d). A gate that read that as a coverage
  failure would fail-closed on a condition that is structurally permanent and
  fully expected — turning a correct fail-closed posture into a false alarm that
  blocks every release.

  Two absence reasons MUST nonetheless be recorded distinctly, because they carry
  different information and invite different responses:

  - **Structurally absent** — the primitive the trigger depends on does not exist
    at all, so no case could ever supply it (`novel-no-precedent`). FR-017b class
    `nothing-to-measure`.
  - **Incidentally absent** — the primitive exists, but this case's inputs could
    not supply it (a reconstructed snapshot that could not justify
    `cost-threshold`). FR-017b class `input-unavailable`.

  Collapsing the two would hide a regression in which a working primitive
  silently stops producing evidence, by making it look like the permanent,
  expected condition — the same substitution FR-017b forbids of the metrics.

  **The class MUST be derived from whether the primitive exists, never hardcoded
  per trigger.** An implementation that writes
  `if (trigger === 'novel-no-precedent') return 'nothing-to-measure'` is correct
  today and becomes wrong silently the day a ranking primitive ships: the trigger
  would keep reporting `nothing-to-measure` while a real primitive sat behind it
  producing nothing, and the transition to `input-unavailable` — the one that
  says *this used to be impossible and now it is merely failing* — would never
  appear.

  This is the same defect as deriving the absence statement from
  `if (noProbabilisticPass)` rather than from the report state (FR-026), one
  level down. Both are a **branch on a condition the reporter believes is
  permanent**, and both go stale without failing. Wherever this feature reports a
  `not-computable` class, the class is a function of observed state, not of an
  identifier.

#### Absence statement and privacy

- **FR-024 — Raw material stays scratch-only; a sanitized index is tracked.**
  Raw historical proposals and incident material MUST NOT be tracked. A tracked
  `checklists/evidence-index.md` MUST record a sha256 for every referenced
  scratch artifact, the versions of every tool used, and an explicit reviewer
  verdict — matching `specs/008-*` and `specs/009-*`. Per ADR-0027's corrected
  Consequences, the index MUST disclose that per-case snapshots are
  **reconstructed, not harvested**, and MUST distinguish *evaluated-and-false*
  from *evidence-absent* (FR-005). **Both disclosures MUST appear prominently —
  at the head of the index, in the same section as its verdict — not in a
  limitations appendix.** A reader who stops after the verdict must still have
  seen them.

- **FR-024a — The four outcome label classes are treated as closed, and the known gap is
  recorded rather than papered over.** A case fitting none of the four classes
  MUST be **excluded** from `H` with the exclusion and its reason recorded — it
  MUST NOT be relabeled to fit. The known gap is real: "shipped, later superseded
  without incident" describes several records in `docs/adr/` and fits none of the
  four cleanly; forcing it into `shipped-clean` would understate the positive
  class and inflate recall. Resolving the gap means **changing the rubric's
  calibration semantics, which is an ADR** (ADR-0005 action item 4, carried
  forward unmodified by ADR-0027 §4). This feature therefore MUST NOT resolve the
  gap by editing `docs/EVALUATOR_RUBRIC.md`; it records the gap and leaves the
  record to be written.

  **Scope boundary — one rubric edit is already authorized and is not forbidden
  here.** ADR-0027 action item 5 directs that
  `docs/EVALUATOR_RUBRIC.md` be updated to mark the three unevaluable triggers
  (`low-confidence`, `pass-disagreement`, `novel-no-precedent`) as deferred and
  to attach its calibration section to the shipping trigger. That edit is
  authorized **by that record**, is a different edit from closing the label-class
  gap, and is **out of scope for this feature** rather than prohibited by it. The
  prohibition in this FR is specifically on changing the **label-class
  vocabulary** without a record.
  `[NEEDS CLARIFICATION: label exhaustiveness]`

- **FR-025 — The absence statement is recorded and mechanically enforced.**
  While no probabilistic pass is declared, `docs/RELEASING.md` MUST state that no
  probabilistic pass has shipped and that no precision/recall figures exist,
  consistent with README's Dogfooding section. An automated check MUST enforce
  its presence and MUST forbid any published precision, recall, or
  false-negative-rate figure — including a `1.0` / `n/a` placeholder. The check
  MUST report what it examined, so an empty document set cannot satisfy it
  vacuously (ADR-0016 clause 3).

- **FR-026 — The absence statement flips automatically, and is rendered from the
  report's own state.** When the FR-013 registry declares a probabilistic pass,
  the absence statement MUST become **forbidden** and the FR-016
  probabilistic-marginal figures MUST become **required**. The enforcement MUST
  NOT be satisfiable by a stale statement.

  **The statement MUST be rendered from the report's `nothing-to-measure` state
  (FR-017b class 1), never from a bare `if (noProbabilisticPass)` branch.** The
  metric layer is the single source: when no pass has shipped, every
  probabilistic metric is `not-computable / nothing-to-measure`, and the absence
  statement is a rendering of that state carrying its reason code.

  A state in any other class MUST NOT render the absence statement. In
  particular, a `measurement-failed` state MUST NOT produce ADR-0027's *"no
  probabilistic pass has shipped; no precision/recall figures exist"* — that
  sentence would be **false and reassuring at the same time**, which is the exact
  shape of the `run-network-denied.ts` defect described in FR-017b. A separate
  boolean branch is what makes that substitution possible; deriving the statement
  from the state is what makes it impossible.

#### Safety

- **FR-027 — Nothing here approves.** No artifact, check, or function in this
  feature may approve, accept, merge, or change a `review` state, or mutate any
  ADR record (ADR-0027 §1; Principle IV; feature 005 SC-012).

- **FR-028 — No schema change.** This feature MUST NOT add, remove, or alter any
  field in `packages/core/src/schema/adr.schema.ts` or `schema/adr.schema.json`
  (Principle V). The corpus is a separate artifact with its own format.

- **FR-029 — No model, anywhere in this feature.** No part of this feature may
  require, import, or invoke a model, prompt, embedding, or retrieval library. If
  any part appears to need one, it belongs in `specs/011-*`, not here
  (Constitution Principle IV).

- **FR-030 — Every check is observed failing before it counts.** Each gate and
  enforcement in FR-011, FR-013, FR-014, FR-015, FR-025, and FR-026 MUST be
  observed **rejecting a deliberate violation** before it is trusted as coverage
  (ADR-0016).

### Key Entities

- **CalibrationCase** — one labeled historical case: content-identified inputs
  (FR-003), one outcome label (FR-004), and three-state trigger evidence
  (FR-005).
- **CalibrationCorpus (`H`)** — the frozen, hash-manifested set of cases
  (FR-001, FR-006).
- **FreezeManifest** — per-input sha256s plus a sha256 over the manifest, mirrored
  into the tracked evidence index (FR-006).
- **LabelAudit** — the independent pre-derivation audit record: reviewer
  identity, recomputed hashes, class-coverage confirmation, explicit verdict
  (FR-008).
- **DeterministicBaseline** — the derived, byte-reproducible Pass 0 result per
  case (FR-010).
- **PassesRegistry** — the declared list of shipped probabilistic passes,
  cross-checked against dependency evidence (FR-013).
- **CalibrationReport** — whole-gate and probabilistic-marginal figures with
  counts and denominators, plus drift, disagreement, and explicit absences
  (FR-016, FR-017).
- **EvidenceIndex** — the tracked sanitized index (FR-024).

---

## Success Criteria

- **SC-001**: The frozen corpus's manifest hash recomputes to the value recorded
  in the tracked evidence index, and a deliberately altered case is **observed**
  causing that recomputation to fail.
- **SC-002**: The corpus contains at least one case of each of the four outcome
  classes and `|H| ≥ N`; a corpus missing a class is **observed** failing the
  gate.
- **SC-003**: The label audit exists, names a reviewer with no authoring
  involvement, recomputes every hash, and records an explicit verdict; its commit
  is an ancestor of the first derivation commit.
- **SC-004**: Two derivations of the deterministic baseline over identical frozen
  inputs produce **byte-for-byte identical** output, and CI re-derivation fails on
  any committed difference.
- **SC-005**: At least one case records at least one trigger as `evidence-absent`,
  and that trigger is **observed** contributing to no confusion-matrix cell.
- **SC-005a**: The calibration vocabulary (`condition-met` / `condition-unmet` /
  `evidence-absent`) shares **no token** with routing's `proven` / `not-proven`,
  and routing's own vocabulary is **byte-unchanged** by this feature — both
  observed. Comparison is exact equality against an exhaustive union; a fixture
  using substring or prefix matching is **observed** failing.
- **SC-005b**: Every **whole-gate** figure is emitted carrying a machine-readable
  qualifier naming the landed-eight false/absent conflation as a denominator
  limitation; a report emitting a whole-gate figure **without** the qualifier is
  **observed** failing, and the qualifier is **observed** originating in the
  report rather than in prose (FR-016a).
- **SC-006**: The precondition gate is **observed failing** on each of the four
  deliberate violations — declared pass with no holdout; holdout frozen after the
  first score; registry/dependency-graph disagreement (both directions); holdout
  failing a validity precondition — before it is trusted (ADR-0016).
- **SC-007**: The gate is **observed failing** on an unreadable and on a
  hash-mismatched manifest (fail-closed), and passing only on the conforming case.
- **SC-008**: Every metric with an empty denominator returns **absent** — proven
  by fixture for precision, recall, and false-negative rate; none returns `1.0`
  or `0` in that condition.
- **SC-008a**: Every uncomputable metric returns `not-computable` carrying a
  machine reason code — proven by fixture for an empty denominator, a holdout
  below `N`, a missing outcome label class, and the override rate's absent decision log.
  A fixture attempting to render any `not-computable` state as a passing value is
  **observed** failing.
- **SC-008b**: The override rate appears in the report in the `not-computable`
  state with its reason code; a report that omits the metric entirely is
  **observed** failing.
- **SC-009**: Precision, recall, and false-negative rate are each produced in
  **both** the whole-gate and probabilistic-marginal forms, and a case with any
  deterministic trigger proven is **observed** excluded from the
  probabilistic-marginal population.
- **SC-010**: Score drift is reported per dimension; a fixture with compensating
  per-dimension drift is **observed** producing no single averaged figure. With
  no `ε` observed yet, drift is **observed** reporting `not-computable` rather
  than a passing comparison.
- **SC-010a**: The `ε` derivation mechanism (FR-019a) is specified and testable
  against a fixture of two model versions' scores over the same frozen `H`; no
  `ε` **value** ships.
- **SC-011**: An inter-pass disagreement rate of exactly `0.0` over a denominator
  of at least `N` **evaluated** cases is **observed** producing a defect signal
  rather than a passing figure; and the same rate over a denominator below `N` is
  **observed** producing `not-computable` instead of a defect signal.
- **SC-011a**: The disagreement metric is **observed** reading recorded
  `pass-disagreement` evidence rather than recomputing the Pass 2 / Pass 3
  comparison — a fixture in which the recorded evidence and a hypothetical
  recomputation would differ is **observed** yielding the recorded value
  (FR-020).
- **SC-011b**: Cases whose `pass-disagreement` evidence is `evidence-absent` are
  **observed** excluded from the disagreement denominator, not counted as
  agreement (FR-020).
- **SC-020**: No holdout case stores `positive(c)`, an expected-escalation
  boolean, or any per-dimension reference score — **observed** failing if such a
  field is added (FR-005a, FR-005b).
- **SC-021**: Every `not-computable` state carries exactly one of the four
  FR-017b classes; a state carrying none or more than one is **observed**
  failing, and a fixture collapsing `undefined-value` into `measurement-failed`
  (or the reverse) is **observed** failing.
- **SC-022**: A computed value of **zero** is **observed** representable
  distinctly from every `not-computable` state — *measured, and clean* never
  shares a representation with *could not measure*.
- **SC-023**: A `measurement-failed` state — an unreadable holdout, a hash
  mismatch, `|H| < N`, a missing outcome label class, or a model version absent from the
  drift baseline — is **observed** failing the gate, and **observed** not
  producing ADR-0027's absence statement.
- **SC-024**: The absence statement is **observed** originating in the report's
  `nothing-to-measure` state; a renderer that emits it from a bare
  `if (noProbabilisticPass)` branch is **observed** failing (FR-026).
- **SC-025**: The label audit records an explicit **adequacy** finding; an audit
  that confirms hash integrity but never reaches an adequacy finding is
  **observed** recorded as `FAIL` (FR-008, matching `specs/010-*` T021).
- **SC-026**: Aggregate confidence is computed over a **fixed denominator of 8**;
  a fixture in which only two dimensions were attempted and both cited is
  **observed** yielding `0.25`, not `1.0` (FR-020b).
- **SC-027**: The contradiction predicate is **observed** firing on (a) a present
  `hidden-one-way-door` output regardless of Pass 2's score, and (b) any present
  adversarial output bearing on a dimension Pass 2 scored **≥ 3**; and
  **observed** not firing when Pass 2 scored `< 3` on that dimension, or when the
  adversarial output is explicitly absent (FR-020c).
- **SC-028**: Drift is **observed** computed on the post-drop surviving score,
  with the raw score retained; a fixture in which citation behavior changed but
  judgment did not is **observed** distinguishable from one in which judgment
  changed (FR-019).
- **SC-029**: No relevance-floor parameter is shipped or calibrated;
  `novel-no-precedent` is **observed** reported as `evidence-absent` with the
  `nothing-to-measure` class rather than as a tunable awaiting a value
  (FR-020d).
- **SC-030**: A holdout in which one trigger is `evidence-absent` for **every**
  case is **observed** passing the gate — not rejected as a missing outcome label class
  (FR-023a); and a fixture conflating **structurally absent** with
  **incidentally absent** is **observed** failing.
- **SC-031**: The `not-computable` class is **observed** derived from observed
  state rather than from a trigger identifier — a fixture in which a relevance
  primitive is present but produces nothing is **observed** yielding
  `input-unavailable`, not `nothing-to-measure`, and an implementation that
  hardcodes the class per trigger is **observed** failing (FR-023a).
- **SC-012**: Removing the absence statement from `docs/RELEASING.md` is
  **observed** failing the enforcement; declaring a probabilistic pass while the
  absence statement remains is **observed** failing it for the opposite reason.
- **SC-013**: A fabricated or placeholder precision/recall figure (including
  `1.0` / `n/a`) published while no pass is declared is **observed** failing the
  enforcement.
- **SC-014**: The dependency-graph gate confirms this feature's code imports no
  model/prompt/embedding/retrieval library and reads no clock, network, or
  filesystem in its pure functions; `clean-clone-builds` stays green.
- **SC-015**: No file in `packages/core/src/schema/` or `schema/` differs as a
  result of this feature, and `schema:emit` drift stays clean (Principle V).
- **SC-016**: No run of anything in this feature writes or mutates an ADR file,
  acceptance state, or `review` field; feature 005 SC-008 and SC-012 remain true.
- **SC-017**: No tracked file contains raw historical proposal bodies or incident
  detail; every scratch artifact referenced by the evidence index has a recorded,
  recomputable sha256 and a recorded tool version.
- **SC-017a**: The evidence index's "reconstructed, not harvested" and
  evaluated-and-false vs. `evidence-absent` disclosures appear in the same
  section as its verdict, at the head of the document — **observed** failing if
  either is moved to a limitations appendix.
- **SC-019**: The **label-class vocabulary** in `docs/EVALUATOR_RUBRIC.md` is
  unmodified by this feature's tasks; the gap is recorded in this spec and left
  to an ADR (FR-024a). This criterion does **not** constrain ADR-0027 action
  item 5's separately-authorized edit (marking the three unevaluable triggers
  deferred and attaching the calibration section to the shipping trigger), which
  is out of scope here rather than forbidden.
- **SC-018**: No serialized surface introduced by this feature calls
  `localeCompare`; ordering is `compareCodeUnits` / `byCodeUnit` throughout, and
  two runs under different ICU locales produce identical bytes (issue #115).

---

## Assumptions

Documented, ADR-consistent choices; each is revisitable at plan stage. None is a
one-way door.

1. **The corpus lives under this feature's own directory or a sibling data
   directory, not in `docs/adr/`.** Calibration cases are not decisions and must
   not appear in `adr lint`, `adr queue`, or the governing-decisions Action.
2. **The passes registry is a small tracked data file**, not a code constant, so
   its diff is legible in review and its ancestry is checkable.
3. **`specs/011-*` is the only consumer** of the metric functions in the
   foreseeable term; the contract is written for that consumer specifically.
4. **The four rubric outcome label classes are treated as closed** for this feature. A
   case fitting none is **excluded with its reason recorded**, never relabeled to
   fit (FR-024a). The gap is real and its resolution is an ADR, not an edit.
5. **Cases are drawn from this repository's own history** unless clarification 5
   resolves otherwise. With 27 records, `H` will be small — which is exactly why
   `N` and the class-coverage precondition (FR-023) are enforced through the
   `not-computable` path rather than assumed away.
   `[NEEDS CLARIFICATION: external-case admissibility]`
6. **The independent auditor is a fresh-context reviewer with no authoring
   involvement**, matching `specs/009-*` T014a. Model-identity requirements for
   that role, if any, are the maintainer's to set.

---

## Clarifications

### Outstanding — `[NEEDS CLARIFICATION]`

All six remain open by decision of the coordinating review, not by oversight. In
each case a mechanism is specified so the unknown cannot silently become a
passing value (FR-017a).

1. **`ε` for score drift (FR-019, FR-019a).** The rubric says "a configured
   epsilon" and names D3 as its example. No value is configured anywhere in the
   repository. **Deliberately left unset.** An epsilon chosen before any drift is
   observed becomes a threshold a later reader assumes was validated. FR-019a
   specifies the derivation mechanism — per-dimension observed spread across the
   first two model versions over the same frozen `H` — and requires the resulting
   value to be ratified in a record. Until then, drift reports `not-computable`.
2. **`N`, the minimum `|H|` (FR-023).** No value is set anywhere, and none is
   set here. The **binding requirement is the behavior, not the number**: when
   `|H| < N`, every affected metric reports `not-computable` with a reason code
   (FR-017a) and never a passing-looking value. That rule matters more than `N`
   itself and is enforceable before `N` is chosen.
3. **Source of truth for the override rate (FR-021).** No human-decision log
   exists (Finding 2). **"Not computable" is the correct published answer**, and
   the metric stays in the report carrying that state and its reason code —
   neither invented a source nor quietly dropped. A sketch of what such a log
   would need to record is listed under Out of Scope as a pointer, deliberately
   not as scope.
4. **Whether the four rubric outcome label classes are exhaustive (FR-024a).** They are
   not, for this corpus: "shipped, later superseded without incident" describes
   several records in `docs/adr/` and fits none of the four. Recorded as a gap;
   **resolving it requires an ADR**, since rubric changes are ADRs (ADR-0005
   action item 4, carried forward by ADR-0027 §4). This feature does not edit
   `docs/EVALUATOR_RUBRIC.md`.
5. **Whether cases may be drawn from outside this repository.** Maintainer's
   call; open. The tension is concrete rather than theoretical: the corpus is
   **27 records**, self-governed, and only a subset will carry a usable outcome
   label — almost certainly too few for a meaningful recall denominator. That is
   precisely why `N` matters (clarification 2) and why the `not-computable` path
   is expected to be exercised **on day one rather than in theory**. Admitting
   external cases would raise `N`'s reachability but introduces provenance and
   privacy questions (FR-024) this spec does not resolve.
6. **Who owns a relevance/ranking primitive (FR-020d).** Verified: none exists —
   `packages/mcp/src/search/normalize.ts` documents *"No stemming, fuzzy,
   weighting, or ranking"*. So `novel-no-precedent` has no function to threshold
   and this feature scopes **no** relevance floor: calibrating a floor over a
   nonexistent ranking function would be a parameter whose tuning changes
   nothing. The trigger is expected to stay permanently `evidence-absent` until a
   primitive exists. `specs/011-*` explicitly declines to build one; ownership is
   unassigned and is **not** claimed here.

---

## Out of Scope

- **Passes 1–3 themselves** — retrieval, rubric scoring, adversarial. Those are
  `specs/011-probabilistic-evaluator-passes/`. Nothing here scores anything.
- **The three later-pass-only triggers** — `low-confidence`,
  `pass-disagreement`, `novel-no-precedent`. They stay named in the rubric and
  absent from the router (ADR-0027 §2).
- **Any model, prompt, embedding, or retrieval dependency** (FR-029).
- **Building a relevance/ranking primitive** (FR-020d). None exists, and this
  feature does not claim one — nor does it scope a floor over a function that
  does not exist.
- **Any change to Pass 0's behavior, output, or persistence contract** (FR-002).
  Notably: this feature does **not** fix the default human render dropping the
  not-proven half, and does **not** populate `ranAt`. Both are recorded as
  findings; changing either is a separate, explicitly-scoped decision.
- **Any schema change** (FR-028).
- **Computing the override rate** (FR-021) — defined and **published as
  `not-computable`**, not computed.
- **Building a human-decision log.** Out of scope, and recorded here as a pointer
  rather than as work: computing FR-021 would require a durable record of, per
  routed proposal, the tier it was routed to, the human it was routed to, the
  decision that human reached, and whether that decision **reversed** the routing
  recommendation — plus the dimension at issue, for the by-dimension split.
  Nothing in the repository records any of this today, and adding it touches the
  routing surface, so it needs its own scope and very likely its own record. The
  `not-computable` state (FR-021) is what keeps the need visible until then.
- **Editing `docs/EVALUATOR_RUBRIC.md` to close the label-class gap** (FR-024a).
  Changing the label-class vocabulary is an ADR.
- **ADR-0027 action item 5** — updating the rubric to mark the three unevaluable
  triggers as deferred and attach its calibration section to the shipping
  trigger. That edit is **authorized by ADR-0027 itself** and is simply not this
  feature's work; it is named here so its absence reads as scope rather than as
  an oversight, and so a reader does not mistake FR-024a for a blanket
  prohibition on the record's own action item.
- **Publishing actual precision/recall figures.** While no probabilistic pass has
  shipped, the honest report is the absence of one (ADR-0027 §3). This feature
  makes the figures *computable* and their absence *enforceable*; it does not
  manufacture numbers.
- **Rung 3 (external validation).** Not claimed, not sought here. The
  maintainer's own reference repository is rung 2 and is never described as
  external (ADR-0014).
