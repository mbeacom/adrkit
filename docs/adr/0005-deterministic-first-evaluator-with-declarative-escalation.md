---
schemaVersion: 0.1.0
id: "0005"
title: Gate proposals with a deterministic-first evaluator and declarative escalation
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [evaluator, governance, ai]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0003"]
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
  tierReason: Defines where human judgment is required; governs the AI surface.
complianceControls: ["SOC2 CC8.1"]
reviewBy: 2027-01-18
---

# ADR-0005: Gate proposals with a deterministic-first evaluator and declarative escalation

## Context

The project's distinguishing claim is that agent-generated plans can be reviewed
efficiently without abandoning human accountability. Two failure modes threaten
it from opposite directions.

**Evaluator theater**: a model that scores everything "looks good." Reviewers
stop reading it within weeks and the gate becomes a rubber stamp with a
compliance story attached — worse than no gate, because it manufactures false
assurance.

**Over-gating**: everything escalates, review becomes a bottleneck, and teams
route around the tool.

Regulated adopters add a third constraint: the gate must be *explainable*. "The
model decided" is not an acceptable answer to an examiner. Escalation logic has
to be inspectable and reproducible.

## Decision

A four-pass evaluator, specified in `docs/EVALUATOR_RUBRIC.md`:

0. **Deterministic** — schema, supersession, `affects` overlap, assertions. No
   model. Errors short-circuit before any tokens are spent.
1. **Retrieval** — related decisions, including `rejected` and `superseded`.
2. **Rubric** — eight dimensions, 0–4, citation-required, per-tier weighting.
3. **Adversarial** — separate call, separate context, tasked with finding the
   strongest objection rather than being balanced.

**Escalation to a human is a boolean OR over declarative conditions** — never
model discretion. The full trigger list lives in the rubric. Each escalation
routes to a *named* human, resolved from `deciders`, then CODEOWNERS of the
affected paths, then the IDP catalog owner.

The evaluator never approves. It routes.

## Options considered

### Option A: Deterministic-first, four passes, declarative escalation (chosen)

| Dimension | Assessment |
|---|---|
| Explainability | High — every escalation has a reason code |
| Cost | Low in the common case; short-circuits before model calls |
| Degradation | Falls back to a useful linter with no model available |
| Complexity | Medium-high — four passes to maintain |

### Option B: Single LLM judge call

**Pros:** trivial to build, one prompt to maintain.
**Cons:** unexplainable, uncalibratable in practice, and precisely the shape that
becomes theater. Fails the regulated-adopter constraint outright.

### Option C: Deterministic checks only

**Pros:** fully explainable and reproducible; no model spend; no drift.
**Cons:** cannot assess whether alternatives are straw men or whether
reversibility is under-declared — the judgment questions that make review worth
doing at all.

## Trade-offs

Four passes cost more per proposal than one. Mitigated by the deterministic
short-circuit, which handles a large fraction of proposals at zero model cost.

Declarative escalation will over-trigger initially. That is the correct
direction of error: false-positive escalations cost reviewer minutes, missed
one-way doors cost incidents. Thresholds tighten only with calibration data,
never on intuition.

Separating grading from attacking doubles the prompt surface. Accepted — a model
asked to both defend and critique does neither well, and inter-pass disagreement
is one of the more useful escalation signals available.

## Consequences

- Easier: defending the gate to a risk function; running the deterministic layer
  in air-gapped or model-free environments; auditing why something escalated.
- Harder: prompt maintenance across model versions; the calibration set is
  ongoing work, not a one-time task.
- Explicit commitment: **publish escalation precision and recall each release,
  including the false-negative rate.** Uncomfortable by design — it is what
  prevents decay into theater.
- Revisit if: calibration shows the rubric passes add nothing over the
  deterministic layer plus retrieval. That would be a real finding, and this
  record should be superseded explicitly rather than quietly ignored.

## Action items

1. [ ] Pass 0 complete and independently useful before any prompt is written
2. [ ] Freeze a holdout set of historical proposals for drift detection
3. [ ] Log every escalation decision with reason codes from day one
4. [ ] Treat rubric changes as ADRs, with calibration deltas attached
