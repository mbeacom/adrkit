---
schemaVersion: 0.1.0
id: "0027"
title: Ratify the deterministic evaluator and bind calibration reporting to the first probabilistic pass
status: accepted
date: 2026-08-12
deciders: ["@mbeacom"]
tags: [evaluator, governance, ai, calibration]
scope: org
reversibility: two-way-door
blastRadius: org
supersedes: ["0005"]
relatesTo: ["0002", "0003", "0014", "0016"]
affects:
  - type: path
    pattern: "packages/evaluator/**"
  - type: path
    pattern: "docs/EVALUATOR_RUBRIC.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Inherits ADR-0005's subject — the gate that decides where human judgment is
    required — and its non-empty `complianceControls`, either of which routes to
    `arb` on its own. The rescope below moves a published reporting obligation,
    which is exactly the class of change that should not be able to happen
    quietly, so the tier is kept rather than relaxed even though the deterministic
    surface it ratifies is unchanged and already reference-verified.
  decidedAt: 2026-08-12T00:00:00Z
  approvals: ["@mbeacom"]
complianceControls: ["SOC2 CC8.1"]
reviewBy: 2027-08-12
---

# ADR-0027: Ratify the deterministic evaluator and bind calibration reporting to the first probabilistic pass

## Context

[ADR-0005](./0005-deterministic-first-evaluator-with-declarative-escalation.md)
specified a four-pass evaluator and has sat at `proposed` since 2026-07-18. It is
the only record in the corpus that never reached `accepted`, and for eleven months
it has been the sole item in `adr queue` — tier `arb`, routed to `@mbeacom`,
`within-sla` against a 2027-01-18 deadline that has never been the binding
constraint.

The reason it stalled is not disagreement. Pass 0 shipped, and shipped well:

| ADR-0005 commitment | State |
|---|---|
| Pass 0 — deterministic, eleven rules | **landed / reference-verified** (Phase 4, `specs/005-deterministic-evaluator/`, PR #14) |
| Action item 1 — Pass 0 complete before any prompt is written | Met |
| Action item 3 — log every escalation with reason codes from day one | **Emitted, never retained.** `route.escalate.*` and `route.evidence.*.not-proven` are computed on every run and persisted by none |
| Pass 1 retrieval · Pass 2 rubric · Pass 3 adversarial | Not built; deferred to Phase 7+ |
| 3 of 11 escalation triggers (`low-confidence`, `pass-disagreement`, `novel-no-precedent`) | Not evaluable — each is defined as a function of Pass 2/Pass 3 output |
| Action item 2 — freeze a holdout set | Not done |
| Action item 4 — rubric changes as ADRs with calibration deltas attached | Not done |

Eight of the eleven triggers are implemented in `packages/evaluator/src/routing/route.ts`
as a declarative OR over deterministically **proven** evidence, computed after the
eleven rule results and never as a twelfth rule. Missing optional evidence yields
`not-proven`, never a fabricated escalation. That is the substance of ADR-0005 working
as designed.

One row of that table deserves its own paragraph, because an earlier draft of this
record got it wrong. ADR-0005's action item 3 and Phase 4's exit criterion both ask
for escalation reason codes *"logged from the first run — this is the calibration
set, and it cannot be backfilled."* The codes are **emitted** on every run and
**retained** on none. No historical Pass 0 evaluation exists anywhere in the
repository: no record in `docs/adr/` carries an `evaluation:` block, `adr evaluate`
has no `--write`, and `RunMetadata.ranAt` is declared but never populated by any
production path. Nor is that an oversight to be corrected by adding persistence —
`specs/005-deterministic-evaluator/` SC-008 ratifies that **"Pass 0 persists
nothing"**, and §1 of this record forbids any evaluator surface to persist. The two
commitments were always in tension and the tension was never resolved; the exit
criterion's own warning is what came true. The calibration set that was supposed to
accumulate from day one does not exist, and the window in which it could have been
captured cheaply is closed.

Two consequences follow, and both are load-bearing below. The calibration corpus
must be built by **re-derivation from committed history** rather than harvested from
a log, which makes it a separate tracked artifact under ADR-0004 and leaves SC-008
untouched. And re-derivation is only ever partial: `adr evaluate` requires a
`--snapshot` that historical evaluations never had, so a `not-proven` produced by an
*absent* snapshot is byte-identical to one produced by *evaluated-and-false*
evidence. Counting the first as a true negative would inflate deterministic
precision and corrupt the recall denominator — the same absence-versus-evidence
confusion this project polices everywhere else.

What blocked acceptance is one sentence in ADR-0005's Consequences, stated as an
**explicit commitment**:

> publish escalation precision and recall each release, including the false-negative rate.

That obligation cannot be honored today, and not because of neglect. Precision and
recall are measured against a class of judgment the shipped evaluator does not
attempt. Every implemented trigger fires only on proven evidence, so its precision
is 1.0 by construction and its recall is undefined — there is no probabilistic
estimate to be wrong about. Publishing `1.0 / undefined` every release would be a
compliance ritual that measures nothing, which is precisely the "evaluator theater"
ADR-0005 was written to prevent. Accepting the record unchanged would make that
ritual project law; leaving it `proposed` indefinitely leaves the deterministic
layer — landed, reference-verified, and in daily use by `adr evaluate` — formally
ungoverned.

That is a defect in the record's staging, not in its decision. ADR-0014 already
solved the general form of this problem for phase landing: it separated *is the
work correct and reproducible* from *has an outside party adopted it*, and stopped
binding the first to the second. The same separation applies here, one level down.

## Decision

**Supersede ADR-0005. Ratify the deterministic layer as it stands, carry the
four-pass architecture forward unchanged as intent, and re-time the calibration
reporting obligation from *every release* to *before the first probabilistic pass
ships*.**

### 1. What is ratified now

Accepted as project law, effective immediately:

- **Deterministic before probabilistic.** Anything checkable without a model is
  checked without a model, first, and reported separately. Pass 0 runs first and
  short-circuits on `error`-severity findings before any tokens are spent.
- **The evaluator never approves. It routes.** No evaluator surface — Pass 0,
  `adr evaluate`, `adr queue`, or any later pass — may approve, accept, merge,
  persist, or change an acceptance or `review` state.
- **Escalation is a boolean OR over declarative conditions, never model
  discretion.** Every trigger is a named, auditable condition emitting an ordered
  proven / not-proven evidence status.
- **Escalation routes to a named human**, resolved in the fixed order `deciders`
  → CODEOWNERS of the affected paths → IDP catalog owner.
- **Pass 0 must remain independently useful with no model configured at all.**

### 2. What is carried forward as intent, not as a shipped claim

The four-pass architecture, the eight rubric dimensions, the per-tier weighting,
and the separation of grading from attacking remain the intended design and remain
specified in `docs/EVALUATOR_RUBRIC.md`. They are **not** ratified as built. No
artifact may describe the evaluator as four-pass, rubric-scoring, or adversarial in
the present tense until the corresponding pass ships. Per ADR-0014's binding state
vocabulary the probabilistic layer is **scoped**, and nothing above it.

The three unevaluable triggers — `low-confidence`, `pass-disagreement`,
`novel-no-precedent` — stay named in the rubric and stay absent from the router.
They are recorded here as deliberately deferred so that a future reader finds an
explicit gap rather than an unexplained discrepancy between eleven documented
triggers and eight implemented ones.

### 3. The rescoped obligation

ADR-0005's per-release reporting commitment is replaced by a **shipping
precondition**:

> **No probabilistic pass may ship without a frozen holdout set that existed
> before the pass produced its first score.** From the release that first includes
> any probabilistic pass, and every release thereafter, escalation precision and
> recall — including the false-negative rate — are published for the probabilistic
> triggers.

Those figures MUST be published **twice**: once whole-gate, and once
**probabilistic-marginal** — restricted to the cases where no deterministic trigger
fired. Escalation is a boolean OR, so eight deterministic triggers whose precision
is 1.0 by construction will carry a whole-gate figure regardless of whether the
probabilistic passes contribute anything at all. A worthless Pass 2 hides perfectly
behind deterministic perfection, and a whole-gate-only report would show a healthy
gate while measuring none of the judgment the probabilistic layer was added to
supply. **The obligation above is satisfied by the probabilistic-marginal figure;
the whole-gate figure alone does not satisfy it.** This is the same theater failure
this record was written to prevent, displaced one level down, and it is the reason
the requirement is stated here rather than left to the calibration spec.

Three properties are load-bearing and are the reason this is a rescope rather than
a retreat:

- **It cannot be satisfied by backfilling.** A holdout frozen after the scorer has
  run against it is not a holdout. This is the same ordering rule spike 009 enforced
  for its reference oracle, and the same reason that spike's carry-forward blocker
  refused to correct an already-frozen artifact after generator work had run.
- **It is strictly harder to evade than the original.** A per-release report is
  discharged by publishing a number; a precondition blocks the ship. The obligation
  now binds at the moment it becomes meaningful and cannot be quietly skipped by a
  release that had nothing to report.
- **While the evaluator is deterministic-only, the honest report is the absence of
  one.** Releases MUST state that no probabilistic pass has shipped and therefore
  no precision/recall figures exist — reported as explicitly **absent**, never
  assumed, never fabricated, in the same shape ADR-0014 requires for rung 3.

The remaining calibration commitments in `docs/EVALUATOR_RUBRIC.md` — score drift on
a frozen holdout, inter-pass agreement rates, override rate by tier and dimension —
attach to the same trigger. Each is a function of probabilistic output and is due
when that output first exists.

### 4. What does not change

ADR-0005's action item 4 stands unmodified and now applies to this record: **rubric
changes are ADRs**, with calibration deltas attached once deltas exist. A model
upgrade that shifts a dimension's mean beyond a configured epsilon is a breaking
change and needs its own record.

Per ADR-0016, none of the above counts as coverage until observed failing. The
holdout-precondition gate must be observed rejecting a probabilistic pass that
lacks a frozen holdout before it may be trusted.

## Options considered

### Option A: Build passes 1–3 first, then accept (rejected)

**Pros:** maximally honest; the record and the code agree on the day it is signed.
**Cons:** Phase 7+ is unscheduled. This leaves a landed, reference-verified,
in-use deterministic surface formally ungoverned for an unbounded period, and
leaves the corpus permanently unable to reach a clean state — the tool's own
headline output, `adr queue`, would keep surfacing its own foundational record as
unresolved backlog. Rejected as governance-by-stall.

### Option B: Rescope, then accept (chosen)

| Dimension | Assessment |
|---|---|
| Honesty | High — ratifies exactly what is built, names the gap explicitly |
| Enforceability | Higher than the original; a precondition blocks, a report does not |
| Precedent | Direct — ADR-0019 (spike `no-go` as measurement artifact), ADR-0020 (rescope SC-010), ADR-0014 (separating correctness from adoption) |
| Cost | One record; no code change |

### Option C: Accept as-is with an amendment note (rejected)

ADR-0014 amends ADR-0012 and ADR-0013 **by reference** without superseding them,
so the mechanism exists and is cheap. Rejected here because the thing being changed
is a published commitment in the Consequences section rather than a gate on a
ladder. An amendment would leave the record's own text asserting a per-release
obligation that no release has met or can meet, and the discrepancy would have to
be reconstructed from a second document. ADR-0005's own closing instruction
anticipates this case and asks for the opposite: *"this record should be superseded
explicitly rather than quietly ignored."*

## Trade-offs

Superseding a record that is 70% correct costs a reader one extra hop. Accepted:
the alternative is a live record whose Consequences section is known to be
unmeetable, which is more expensive to trust.

Re-timing the obligation weakens the forcing function in the interval before any
probabilistic pass exists. This is the real cost and it is deliberate. The
mitigation is that the interval is now visible — a release that says "no
probabilistic pass has shipped; no precision/recall figures exist" is a statement
someone can notice repeating, whereas `precision 1.0, recall n/a` reads as a
healthy gate and is the more dangerous artifact.

Ratifying an architecture that is one-quarter built risks the remaining three
quarters reading as settled and escaping scrutiny when they are specified. Section
2 exists to counter that, and the holdout precondition means the first probabilistic
pass must clear a gate the deterministic layer never had to.

## Consequences

- Easier: the corpus reaches a fully-governed state; `adr queue` empties honestly;
  the deterministic evaluator can be cited as accepted project law by
  `specs/`, `plan.md`, and the constitution without a `proposed`-status caveat.
- Harder: whoever ships the first probabilistic pass inherits a precondition they
  cannot satisfy late. That is the intent.
- **Permanently harder**: the calibration set ADR-0005 asked to accumulate from day
  one was never retained, and that window is closed. The corpus must now be
  re-derived from committed history with maintainer-authored snapshots, and its
  evidence index MUST disclose that its snapshots are **reconstructed, not
  harvested**, and MUST distinguish a trigger that was evaluated-and-false from one
  whose evidence was absent. A calibration set that silently conflates those two
  reports a precision it did not measure.
- Explicit commitment: **while no probabilistic pass has shipped, each release
  states that fact and states that no precision/recall figures exist.** Absence
  reported as absence, never as success.
- Revisit if: a probabilistic pass ships without a frozen holdout, a release omits
  the absence statement, or a release satisfies the obligation with a whole-gate
  figure alone. Each is evidence this rescope became the quiet drop it was written
  to prevent, and this record should be superseded explicitly rather than
  reinterpreted.

## Action items

1. [x] Supersede ADR-0005; set its `status` and `supersededBy` reciprocally
2. [ ] Record the absence statement in the release process (`docs/RELEASING.md`)
3. [ ] Freeze the holdout set **before** any probabilistic pass produces a score
4. [ ] Build the holdout-precondition gate and observe it failing (ADR-0016)
5. [ ] Update `docs/EVALUATOR_RUBRIC.md` to mark the three unevaluable triggers as
       deferred, and to attach its calibration section to the same trigger
