# Feature Specification: Probabilistic Evaluator Passes (Passes 1–3) and the Three Deferred Triggers

**Feature Directory**: `011-probabilistic-evaluator-passes` (not a git branch — this feature
is scoped in place; no branch is created or switched by this work)
**Created**: 2026-08-12
**Status**: **Scoped** ([ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary — *scoped*, and **nothing above it**. Not implemented, not reference-verified, not
landed, not released, not externally validated, not adopted. No code exists under `packages/`
for this feature, and none may be written until the Phase 0 gates in
[`tasks.md`](./tasks.md) clear.)
**Phase**: 9 (outcome ladder rung 5, remainder) — **Passes 1–3 plus the three deferred
escalation triggers only**
(project **Phase 9** ≠ outcome-ladder rung 9; per [`plan.md`](../../plan.md), outcome rung 5
was delivered *partially* by Phase 4's Pass 0. This feature completes it. Internal
task/phase headings inside this feature are distinct from the project phase.)

**Blocked by**: [`specs/012-evaluator-calibration/`](../012-evaluator-calibration/), and by an
accepted ADR ratifying the harness-driven architecture ([§ Architecture](#architecture-the-model-produces-evidence-deterministic-code-does-the-deciding)).
Both are **hard preconditions**, not sequencing preferences. See
[Authorization and dependency boundary](#authorization-and-dependency-boundary).

**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the
ADR wins):
[ADR-0027](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
(ratifies the deterministic layer; carries the four-pass architecture forward as **intent,
not as a shipped claim**; binds the holdout precondition and the twice-published
precision/recall obligation — **read this first**),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(**superseded by ADR-0027**, but still the architecture of record for the four passes and
the eleven triggers; its action item 4 — *rubric changes are ADRs* — stands unmodified),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) (Passes 1–3, the eight
dimensions D1–D8 with their anchors and caps, the per-tier weighting, and the eleven
escalation triggers — the rubric contract),
[ADR-0003](../../docs/adr/0003-ship-as-spec-kit-extension.md) (adrkit ships as an extension
of an agent harness — the precedent for [§ Architecture](#architecture-the-model-produces-evidence-deterministic-code-does-the-deciding)),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is
truth; any index is a derived, disposable projection and never an authority),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (pure resolution;
**degradation, not failure** — a missing backing source is inert, never fatal),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(the binding state vocabulary and the evidence ladder),
[ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
(**a check counts as coverage only once observed failing**),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation, clean-clone build),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun toolchain, Node baseline), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles I–V —
**Principle IV** (*Deterministic Before Probabilistic*) and **Principle II** (*Clean Clone
Builds Green*, whose rationale names offline use and the IP boundary) in particular.

> ### ⚠️ This feature is scoped, not authorized to ship
>
> [ADR-0027](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md) §3
> states the precondition in binding terms:
>
> > **No probabilistic pass may ship without a frozen holdout set that existed before the
> > pass produced its first score.**
>
> A holdout frozen *after* the scorer ran against it is not a holdout. That artifact and its
> gate are built by feature 012. Until they exist, and until the gate has been **observed
> failing** (ADR-0016), no task in this feature's implementation phases may begin.
>
> Advance **scoping** is explicitly permitted and encouraged by [`plan.md`](../../plan.md);
> **implementation** is not. This document is the permitted half.

## Overview

Phase 4 landed **Pass 0** — eleven deterministic rules, no model, `error`-severity findings
short-circuiting before a single token is spent — and it is `landed / reference-verified`.
`docs/EVALUATOR_RUBRIC.md` specifies **four** passes. Three are unbuilt:

| Pass | What it does | State |
|---|---|---|
| 0 — Deterministic | Eleven rules, no model, short-circuits on `error` | **landed / reference-verified** ([`specs/005-deterministic-evaluator/`](../005-deterministic-evaluator/)) |
| 1 — Retrieval | Assembles the context Passes 2–3 reason over. **Not scored.** | Not built — **this feature scopes it** |
| 2 — Rubric scoring | Eight dimensions D1–D8, 0–4, citation-required, per-tier weighting | Not built — **this feature scopes it** |
| 3 — Adversarial | Separate call, separate context; strongest objection, not balance | Not built — **this feature scopes it** |

The escalation trigger table has the same shape of gap. Eight of eleven triggers are
implemented in `packages/evaluator/src/routing/route.ts` as a declarative OR over
deterministically **proven** evidence. Three are absent because each is a function of Pass 2
or Pass 3 output, and ADR-0027 §2 records them as *deliberately deferred* so a future reader
finds an explicit gap rather than an unexplained discrepancy:

| Trigger | Rubric condition | Why it is absent today |
|---|---|---|
| `low-confidence` | Aggregate confidence below threshold (default `0.7`) | No Pass 2 ⇒ no confidence value to threshold; and the rubric never defines the aggregate ([Q1](#q1)) |
| `pass-disagreement` | Pass 3 contradicts Pass 2 on any dimension | No Pass 2 and no Pass 3 ⇒ nothing to compare; and "contradicts" has no mechanical referent ([Q2](#q2)) |
| `novel-no-precedent` | Retrieval returns nothing above the relevance floor | No Pass 1 ⇒ no retrieval result — **and no relevance scoring exists anywhere in the repository** ([Q3](#q3)) |

**Closing that three-trigger gap is in scope for this feature.** Completing the four-pass
architecture is what moves outcome-ladder rung 5 from *partial* to whole.

> **A finding worth stating loudly.** The third column above is not three instances of the
> same "not built yet". `low-confidence` and `pass-disagreement` are blocked on *definitions*
> that can be written down. `novel-no-precedent` is blocked on a **primitive that does not
> exist**: `packages/mcp/src/search/normalize.ts` is nine lines and documents itself as
> *"No stemming, fuzzy, weighting, or ranking."* There is no relevance score in this
> repository for a floor to be a floor over. Building one is **out of scope for this
> feature** ([Q3](#q3), and see [Non-goals](#non-goals)).

### What this feature must not let happen

ADR-0027 ratified a set of properties as project law, effective immediately. Every one
constrains this feature, and each is easy to violate while appearing to succeed:

- **The evaluator never approves. It routes.** No pass — 0, 1, 2, or 3 — may approve, accept,
  merge, persist, or change an acceptance or `review` state.
- **Escalation is a boolean OR over declarative conditions, never model discretion.** This
  applies to the three new triggers *especially*, because they are the first triggers whose
  inputs originate from a model.
- **Pass 0 must remain independently useful with no model configured at all.** The
  probabilistic layer degrades to a useful linter; it never becomes a dependency of the
  deterministic one.
- **No artifact may describe the evaluator as four-pass, rubric-scoring, or adversarial in
  the present tense until the corresponding pass ships** (ADR-0027 §2). That includes this
  spec, which is written throughout in the conditional.

One hazard cuts across all of the above and is worth naming plainly, because it is the specific
way this feature could fail while appearing to succeed: **absence reported as evidence.** A
missing snapshot counted as a true negative, an empty retrieval set read as novelty, an
unretained reason code read as a calibration corpus — the same mistake in three costumes, and
each is cheap to make because the fabricated value always looks healthier than the honest one.

This is not a new observation; it is **established project law**, which is why this feature
inherits the rule rather than inventing it. ADR-0014 requires status be *"reported as explicitly
absent or present"* with evidence, never assumed and never fabricated.
[ADR-0026](../../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)
applies the same
distinction in a different domain — *"a permission-shaped refusal … is not an absence of"* the
thing being sought. Principle IV requires a matcher whose backing source is missing to resolve
*"to inert with an informational finding — never a fatal error."* ADR-0027's own Consequences
states the cost in the calibration case: *"A calibration set that silently conflates those two
reports a precision it did not measure."*

FR-018, FR-021, and FR-028 exist to make that mistake **unrepresentable here** rather than
merely discouraged.

## Architecture: the model produces evidence, deterministic code does the deciding

This is the load-bearing idea of the feature. It is stated here, before the requirements,
because every requirement below depends on it.

**A model never decides anything. A model produces *evidence*. Deterministic, pure code
performs every comparison, every cap, every threshold, and every routing decision.**

That converts *"escalation is never model discretion"* from a promise into a **structural
property**: there is no code path along which a model's output reaches a routing decision
without passing through a pure kernel that compares it against a declared condition. The
project already runs this pattern — `RoutingTriggerEvidence` is computed impurely at the CLI
boundary and handed to a pure router that performs only the comparison. Passes 1–3 extend the
same boundary; they do not invent a new one.

### The model call happens in the harness, not in adrkit

**adrkit does not become a model client.** The evaluator emits a *prompt bundle* and consumes
a *structured response*; the agent harness that invoked adrkit performs the model call. No
package opens a socket.

This is the architecture of record for this feature. It is not a preference, and it is not
undecided:

- **ADR-0003** already ships adrkit as a Spec Kit extension — the harness is already the
  component holding model access.
- The MCP server is the same shape inverted: the agent calls adrkit. adrkit has never been a
  model client in any package.
- **Principle II**'s own rationale names *"offline use"* and *"the mechanical boundary between
  this Apache-2.0 project and any employer-internal IP."* A socket in `@adrkit/evaluator`
  punctures both.
- **ADR-0010**: published artifacts run on Node with no network.
- Three landed gates already enforce exactly this (FR-003).

Because adrkit never opens a socket, **Principle II is satisfied without amendment**, and so
is Principle IV. That is decisive: the alternative buys a convenience Principle IV already
tells us not to want, at the cost of amending a constitutional principle.

**Rejected — unless the constitution is amended first:** an injected model-client port inside
adrkit, calling the model directly. It would let `adr evaluate` complete Passes 2–3 unaided.
It requires amending Principle II (*"Network-dependent tests and runtime behavior are
forbidden"*), which per the constitution's own Governance section requires **an ADR first**,
and it would breach the offline-use and IP-boundary rationales above. The cost is stated
plainly so that a future reader who wants this can see exactly what it would take.

> **This choice still needs its own record.** Selecting the harness-driven architecture is a
> consequential architectural decision and MUST be ratified by an accepted ADR **before**
> implementation begins. That ADR *ratifies* the architecture; it does **not** amend the
> constitution. It is a Phase 0 gate in [`tasks.md`](./tasks.md), alongside the 012 gate. The
> wire contract between adrkit and the harness is not yet settled — see [Q6](#q6).

## Authorization and dependency boundary

**ADR-0027 authorizes this scoping. It explicitly does not authorize the release.**

Its §3 replaces ADR-0005's per-release reporting commitment with a shipping precondition, and
records three properties as load-bearing — the first is why this feature is blocked rather
than merely sequenced:

- It **cannot be satisfied by backfilling.** This is the same ordering rule spike 009 enforced
  for its reference oracle. That spike's carry-forward blocker has since been **discharged** —
  feature 010 Phase B ran a fresh freeze-then-audit cycle and T020 retained an observed-FAIL
  negative case — so the precedent available here is stronger than a warning: a retained negative
  case proves the audit catches the defect, rather than merely showing one is possible.
- It is **strictly harder to evade than the original**: *"a per-release report is discharged
  by publishing a number; a precondition blocks the ship."*
- While the evaluator is deterministic-only, **the honest report is the absence of one** —
  reported as explicitly absent, never assumed, never fabricated.

### The precondition is satisfied by the marginal figure, not the whole-gate figure

ADR-0027 §3 requires precision, recall, and the false-negative rate to be published **twice**:
once whole-gate, and once **probabilistic-marginal** — restricted to the cases where **no
deterministic trigger fired**. Its ruling is unambiguous:

> **The obligation above is satisfied by the probabilistic-marginal figure; the whole-gate
> figure alone does not satisfy it.**

The reasoning binds this feature directly. Escalation is a boolean OR, and the eight
deterministic triggers have precision `1.0` by construction. A worthless Pass 2 would hide
perfectly behind deterministic perfection, and a whole-gate-only report would show a healthy
gate while measuring none of the judgment the probabilistic layer exists to supply.

This imposes a concrete output obligation on **this** feature, not merely on 012: the
evaluator's output MUST make the marginal subset mechanically determinable (FR-020), and the
three new triggers MUST record three-state evidence, so `evidence-absent` is distinguishable
from `condition-unmet` (FR-021).

### The dependency on feature 012, stated explicitly

**012 gates 011.** The direction is one-way and is not a matter of convenience:

1. **012 owns every metric definition.** Escalation precision, recall, false-negative rate,
   score-drift epsilon, inter-pass agreement rate, and override rate by tier and dimension are
   defined in `specs/012-evaluator-calibration/`. This feature **consumes** them and defines
   none of its own. This is deliberate: ADR-0027 fixes those metrics *before* any probabilistic
   pass exists, precisely so the first pass cannot define them favorably to itself. Any
   requirement here that appears to define a metric is a defect in this document.
2. **012 builds and freezes the holdout set**, and builds the precondition gate that blocks a
   probabilistic pass lacking one.
3. **012's gate must be observed failing** (ADR-0016; ADR-0027 §4 restates it for this exact
   gate: *"The holdout-precondition gate must be observed rejecting a probabilistic pass that
   lacks a frozen holdout before it may be trusted"*) before any Pass 2 or Pass 3
   implementation task in this feature may begin.

Where this feature legitimately **does** have standing is the *interface*: the holdout's shape
and the escalation-evidence record format must be able to express what these passes emit —
per-dimension scores with citations, the four adversarial outputs, and the inter-pass
disagreement signal. That is an interface negotiation, not a definitional one.

### The metric definitions this feature consumes

Frozen by feature 012 (`specs/012-evaluator-calibration/`, PR #141; the metric definitions at
commit `e7c2fb7`, with the vocabulary and class additions landing in later commits on that PR)
and reproduced
here **only so that this spec cites rather than restates them**. If any wording below diverges
from that spec, **it wins and this section is the defect**. 012's FR-022 requires this
consumption relationship, and their T044 verifies it.

- **Positive class** (012 FR-018), derived from the rubric's four outcome labels and frozen in
  spec rather than chosen per release: `caused-incident` (the class recall is optimized on),
  `shipped-reverted`, and `rejected-in-review` are **positive**; `shipped-clean` is **negative**.
- **Escalation precision** `TP/(TP+FP)`, **recall** `TP/(TP+FN)`, and the **false-negative
  rate** `FN/(TP+FN)` — the last published as its own number, never left to be inferred from
  recall. A metric whose denominator is zero is reported **absent** — never `1.0`, never `0`.
- **The dual figure** (012 FR-016), whose normative source is ADR-0027 §3: every one of those
  three is published **twice**, whole-gate and probabilistic-marginal, and **only the marginal
  figure discharges the obligation**. See FR-020, and [Q7](#q7) for why the marginal
  denominator is the only one that can be clean.
- **Uncomputable values** (012 FR-017a) return `not-computable` with a machine reason code and
  are never rendered, coerced, or defaulted to a passing-looking value. This binds this
  feature's own outputs — see FR-028.
- **Score drift** (012 FR-019) per dimension `d ∈ {D1…D8}` over the same frozen holdout,
  **never averaged across dimensions**, because an average hides a compensating pair. **No `ε`
  value ships** (012 FR-019a): only the derivation mechanism — per-dimension observed spread
  across this feature's first two model versions over the same frozen holdout — and the
  resulting value requires its own record before it governs breaking-change status. Producing
  that observation set is this feature's obligation ([`tasks.md`](./tasks.md) T037).
- **Inter-pass disagreement rate** (012 FR-020) — stated as *disagreement*, not agreement,
  because the rubric's named failure mode is **zero** disagreement: *"If Pass 2 and Pass 3 never
  disagree, one of them is not doing its job."* A rate of exactly `0.0` over a sufficient
  holdout is a **defect signal**, not a green number. This is the metric FR-017's trigger must
  reconcile with by construction.
- **Override rate by tier and dimension** — defined, and **not computable**: its input does not
  exist (see [§ no historical calibration data](#there-is-no-historical-calibration-data-and-that-is-permanent)).
- All figures publish **absolute counts and denominators**, never a bare percentage, so a
  one-case holdout cannot report "100% precision".

Feature 012 additionally records that only `one-way-door` and `contradicts-accepted-adr` are
faithfully re-derivable from git alone; `regulatory` is partial; the remaining five require a
`routingEvidence` snapshot that never existed historically. That is the empirical basis for
FR-021.

### There is no historical calibration data, and that is permanent

ADR-0027's own evidence table was corrected on this point: action item 3 is **"Emitted, never
retained."** Reason codes are computed on every run and persisted by none. No record in
`docs/adr/` carries an `evaluation:` block, `adr evaluate` has no `--write`, and
`RunMetadata.ranAt` is declared but populated by no production path.

This is **not** a defect for this feature to fix by adding persistence — feature 005's SC-008
ratifies that *"Pass 0 persists nothing"*, and ADR-0027 §1 forbids any evaluator surface to
persist. Two consequences bind here: the calibration corpus must be **re-derived from
committed history** rather than harvested (012's work, tracked under ADR-0004), and
re-derivation is only ever partial, because a `not-proven` produced by an *absent* snapshot is
byte-identical to one produced by *evaluated-and-false* evidence. **Override rate by tier and
dimension is consequently not computable**, and 012 publishes that as explicitly absent.

FR-021 exists so that this feature does not reproduce that same absence-versus-evidence
confusion in the three triggers it adds.

## User Scenarios & Testing

### User Story 1 — Retrieval assembles the context later passes reason over, including the graveyard (Priority: P1) 🎯 MVP

**Why this priority**: the rubric states plainly that *"retrieval quality dominates evaluation
quality"* and instructs that recall be instrumented **before tuning anything downstream**.
Passes 2 and 3 reason over whatever Pass 1 hands them; a rubric score computed over a bad
context set is confidently wrong. Pass 1 is also the only pass of the three that requires **no
model call at all** under the deterministic baseline strategy, so it is independently testable
and independently valuable.

**Independent Test**: run retrieval over an offline fixture corpus containing an accepted ADR
whose `affects` intersects the proposal's, a `rejected` ADR on the same subject, a
`superseded` ADR on the same subject, and an unrelated ADR. Assert all three related records
are returned, that the `rejected` and `superseded` records are **present and labeled**, that
the unrelated one is absent, and that the result is byte-identical across two runs.

**Acceptance Scenarios**:

1. **Given** a proposal and a corpus containing a `rejected` ADR on the same subject, **When**
   Pass 1 runs, **Then** the `rejected` record appears in the retrieval set with its status
   preserved — *the graveyard holds the "we tried that" knowledge that makes review valuable*,
   and excluding it is a defect, not an optimization.
2. **Given** a proposal whose `affects` intersects an accepted ADR's `affects`, **When** Pass 1
   runs, **Then** that accepted ADR is included **regardless of any relevance score** — it is
   admitted by the `affects` rule, not by ranking.
3. **Given** a proposal with `scope: component` in a domain that has an `org`-scope ADR,
   **When** Pass 1 runs, **Then** the broader-scope ADR is included.
4. **Given** no retrieval index or ranking strategy is configured, **When** Pass 1 runs,
   **Then** it degrades to the deterministic rule-based strategy, records an informational
   finding, and reports which strategy it used — it does **not** fail, and it does **not**
   return a bare empty set that a downstream trigger could misread as novelty (FR-018).
5. **Given** identical inputs, **When** Pass 1 runs twice, **Then** the retrieval set and its
   ordering are byte-identical.

---

### User Story 2 — A proposal is scored on eight dimensions with citations, and uncited scores are dropped (Priority: P2)

**Why this priority**: this is the pass that produces the judgment Pass 0 cannot — whether
alternatives are straw men, whether reversibility is under-declared. It depends on US1 for its
context and is gated on 012's holdout before it may ship.

**Independent Test**: given a frozen `RubricScoreSnapshot` fixture (no live model), assert the
aggregator drops every uncited score, applies the three hard caps, applies the per-tier
weights, and produces a byte-identical aggregate across two runs.

**Acceptance Scenarios**:

1. **Given** a Pass 2 output in which D3 carries a score of `4` but **no citation**, **When**
   the aggregator runs, **Then** that score is **dropped** — not down-weighted, not defaulted —
   and the drop is recorded as evidence with a stable reason code.
2. **Given** a proposal whose every listed alternative shares the chosen option's core
   assumption, **When** D2 is aggregated, **Then** D2 is **capped at 1** regardless of the raw
   score.
3. **Given** a proposal whose consequences section contains no negative consequence, **When**
   D3 is aggregated, **Then** D3 is **0** — *"a proposal whose chosen option has no listed
   downsides is not a decision, it's an advertisement."*
4. **Given** a proposal that contradicts an accepted ADR without acknowledging it, **When** D5
   is aggregated, **Then** D5 is **0**, which independently satisfies the existing
   `contradicts-accepted-adr` trigger condition (rubric: *"D5 = 0, or `affects-overlap` …"*).
5. **Given** a proposal with `blastRadius: org`, **When** weights are applied, **Then**
   D2/D4/D7 carry double weight (see [Q5](#q5) — the component-level "dominate" case is not yet
   a number).
6. **Given** any Pass 2 output, **When** it is consumed, **Then** it enters the pure kernel as
   **data already obtained**; no kernel performs or awaits a model call (FR-003).

---

### User Story 3 — An adversarial pass looks for the strongest objection, in its own context (Priority: P2)

**Why this priority**: the rubric's third design constraint is the *separation of grading and
attacking* — *"a model asked to both defend and critique does neither well."* This pass is
also the source of the `pass-disagreement` signal, and the rubric is explicit that
**disagreement between passes is signal, not noise**.

**Independent Test**: given a frozen `AdversarialSnapshot` fixture, assert all four required
outputs are present and structurally valid, that a missing output is reported as **absent**
rather than fabricated, and that the emitted Pass 3 prompt bundle contains no Pass 2 scores —
asserted structurally on the bundle, never by inspecting a model.

**Acceptance Scenarios**:

1. **Given** a proposal, **When** Pass 3 runs, **Then** it emits exactly four required outputs
   — **strongest objection**, **most likely failure mode**, **hidden one-way door**,
   **unstated assumption** — each present or explicitly absent, never invented to fill a slot.
2. **Given** Pass 2 has already produced scores, **When** the Pass 3 prompt bundle is
   constructed, **Then** it **does not** contain those scores — a separate call with a
   separate context, asserted on the emitted bundle.
3. **Given** Pass 3 surfaces a hidden one-way door on a proposal declared
   `reversibility: two-way-door`, **When** routing is computed, **Then** the correction is
   surfaced as *evidence* and escalates to a **named human** rather than silently re-routing
   (FR-012).

---

### User Story 4 — The three deferred triggers close the 8-of-11 gap, without model discretion (Priority: P1)

**Why this priority**: this is the gap ADR-0027 §2 names explicitly. It is P1 alongside US1
because it is the reason the feature exists, but it is **structurally dependent** on US1–US3
producing evidence, and on 012 for two thresholds and one predicate.

**Independent Test**: given frozen snapshots, assert each of the three triggers fires exactly
when its declarative condition holds, that each emits an ordered evidence status, that
`evidence-absent` is distinguishable from `condition-unmet`, and that no code path
consults a model to decide whether to escalate.

**Acceptance Scenarios**:

1. **Given** a computed aggregate confidence below the configured threshold, **When** routing
   runs, **Then** `low-confidence` is `condition-met` — and the compared value is a **computed
   aggregate**, never a model's self-reported confidence (FR-016).
2. **Given** no Pass 2 snapshot at all, **When** routing runs, **Then** `low-confidence` is not
   `condition-met` **and is recorded as `evidence-absent`, not `condition-unmet`** (FR-021) —
   absent evidence never fabricates an escalation, and never silently counts as a true
   negative.
3. **Given** a Pass 3 finding that contradicts a Pass 2 dimension score, **When** routing runs,
   **Then** `pass-disagreement` is `condition-met` using **012's contradiction predicate**, so that
   trigger firings and 012's published inter-pass agreement rate reconcile by construction
   (FR-017).
4. **Given** retrieval ran successfully and returned nothing above the relevance floor,
   **When** routing runs, **Then** `novel-no-precedent` is `condition-met` — unreachable until a
   relevance primitive exists (FR-018), and asserted as unreachable rather than fixtured.
5. **Given** retrieval **did not run**, or no ranking strategy was configured, **When** routing
   runs, **Then** `novel-no-precedent` is `evidence-absent` and an inert finding is recorded —
   a broken or unconfigured retrieval MUST NOT be indistinguishable from a genuinely novel
   decision (FR-018).
6. **Given** any of the three triggers is `condition-met`, **When** the target is resolved, **Then**
   it resolves to a **named human** via the landed `deciders` → CODEOWNERS → catalog-owner
   resolver, reusing `packages/evaluator/src/routing/target.ts` unchanged (FR-019).
7. **Given** any evaluation, **When** its output is consumed by calibration, **Then** whether
   **any deterministic trigger fired** is mechanically determinable, so the
   probabilistic-marginal figure can be computed (FR-020).

---

### User Story 5 — With no model configured, everything still works and says so (Priority: P1)

**Why this priority**: ADR-0027 ratified *"Pass 0 must remain independently useful with no
model configured at all"* as project law, and Principle II makes the model-free path the only
one guaranteed to exist. This story is what stops the probabilistic layer from becoming a
dependency of the deterministic one.

**Independent Test**: run the full evaluator with no harness, no model, and no retrieval index.
Assert Pass 0's report is **byte-identical** to the report the landed evaluator produces today
for the same input, that Passes 1–3 report as absent rather than failed, that the three new
triggers are `evidence-absent`, and that the exit code is unchanged.

**Acceptance Scenarios**:

1. **Given** no model is configured, **When** the evaluator runs, **Then** Pass 0 completes
   exactly as it does today and its serialized report is byte-identical to the pre-feature
   output for the same input (SC-001) — a **regression assertion**, not a courtesy.
2. **Given** Pass 0 produces an `error`-severity finding, **When** the evaluator runs, **Then**
   it short-circuits: no retrieval, no prompt bundle, no model call, no tokens (FR-001).
3. **Given** no model is configured, **When** the evaluator runs, **Then** the absence of the
   probabilistic passes is **reported explicitly as absent**, never as success and never as a
   score of zero — the same shape ADR-0014 requires for rung 3 and ADR-0027 §3 requires of
   releases.

## Requirements

### Functional Requirements

#### Ordering, purity, and the model boundary

- **FR-001 — Pass 0 runs first and short-circuits before any token is spent.** The evaluator
  MUST run Pass 0 to completion before any Pass 1, 2, or 3 work begins. If Pass 0 produces any
  `error`-severity finding, the proposal MUST be returned with **no** retrieval, **no** prompt
  bundle constructed, and **no** model call. This is Constitution Principle IV and ADR-0027 §1;
  it is not an optimization and MUST NOT be relaxed for latency.

- **FR-002 — The probabilistic layer is strictly additive to Pass 0.** No change to Pass 0's
  eleven rules, their fixed order, their severities, its reason-code catalog, or its serialized
  report bytes is in scope. Pass 0's existing contract, purity, and ordering tests MUST remain
  green **unmodified**.

- **FR-003 — The model produces evidence; deterministic code does the deciding.** All retrieval
  I/O and all model interaction MUST occur outside `packages/evaluator/src/`. The pure kernels
  MUST receive immutable, already-obtained snapshots and MUST NOT perform, trigger, or await
  any model call, network request, clock read, or filesystem traversal. There MUST be no code
  path along which a model output reaches a routing decision without passing through a pure
  kernel that compares it against a declared condition.

  *This is not a stylistic preference.* Three landed gates enforce it and MUST stay green
  **unmodified**: `packages/evaluator/test/purity.test.ts` (traps `globalThis.fetch`,
  `Date.now`, `Math.random`), `packages/evaluator/test/contracts.test.ts` (bans importing
  `node:fs`, `node:net`, `node:http`, `node:child_process`, `@adrkit/cli`, `@adrkit/ci`,
  `@adrkit/adapter*` anywhere under `packages/evaluator/src/`), and feature 005's **SC-006**
  (*"the pure Pass 0 library imports no model/prompt/embedding/retrieval library"*).

- **FR-004 — adrkit emits prompt bundles and consumes structured responses; it never calls a
  model.** No adrkit package may **call a model or hold model credentials**, and no
  network-capable dependency may be added to `@adrkit/evaluator` or `@adrkit/cli`. The harness
  performs the model call. Consequently no probabilistic pass may be a precondition for any
  adrkit command completing successfully (US5, SC-001).

  **Scoped deliberately, because a blanket claim would be false today.** `@adrkit/ci` already
  declares `@actions/github` and constructs an Octokit client (`packages/ci/src/github.ts`) to
  post PR comments with the workflow token. That is a pre-existing, separately-governed surface
  with nothing to do with model access, so a requirement phrased as *"no adrkit package opens a
  network connection"* would be unsatisfiable before this feature starts and would make its own
  acceptance criteria untestable. The prohibition this feature adds is about the **model
  interaction path**, not about sockets in general.

- **FR-005 — Every kernel is deterministic given fixed snapshots.** Given identical input
  snapshots, aggregation, weighting, trigger computation, and serialization MUST produce
  byte-identical output across runs. Model *sampling* is inherently non-deterministic and is
  outside this boundary by construction: **the snapshot is the determinism boundary** (A2).
  Determinism claims MUST NOT be stated more broadly than that.

#### Pass 1 — Retrieval

- **FR-006 — Retrieval assembles four categories, and the graveyard is mandatory.** Pass 1 MUST
  assemble: (a) top-*k* related decisions **including `rejected` and `superseded` records**;
  (b) **all** accepted ADRs whose `affects` intersects the proposal's; (c) any ADR at broader
  `scope` in the same domain; and (d) the originating diff or spec artifact, when present.
  Categories (b) and (c) are **rule-based and unconditional** — they MUST NOT be filtered by
  any relevance score, so a ranking defect cannot silently drop a governing decision.

- **FR-007 — Retrieval is not scored.** Pass 1 contributes context and evidence only. It MUST
  NOT emit a dimension score, and it MUST NOT be a **direct** input to any escalation trigger
  except the declarative `novel-no-precedent` condition. Retrieval does influence routing
  *indirectly and by design* — it assembles the context Passes 2 and 3 reason over, and D5
  (prior-decision coherence) is unscoreable without it. The requirement is that retrieval never
  becomes an escalation input in its own right, not the stronger and false claim that it has no
  effect on the outcome.

- **FR-008 — Recall is instrumented, not asserted.** Retrieval MUST emit machine-readable
  evidence sufficient to compute recall against a labeled set — at minimum, per-item provenance
  (which rule or score admitted it) and the strategy used. The rubric requires recall be
  instrumented **before** anything downstream is tuned; the *metric itself* is 012's.

- **FR-009 — Any index is derived, disposable, and never an authority.** Retrieval MAY build an
  index. Per ADR-0004 and Principle I it MUST be fully reconstructible from git alone, MUST NOT
  be required for correctness, and MUST NOT be consulted as a source of decision content. An
  absent or stale index MUST **degrade to inert with an informational finding** — matching
  Principle IV's existing rule for a matcher whose backing source is missing — never fail.

#### Pass 2 — Rubric scoring

- **FR-010 — Eight dimensions, explicit anchors, citation-required.** Pass 2 MUST score exactly
  D1–D8 on the 0–4 anchors in `docs/EVALUATOR_RUBRIC.md`. Every score above 0 MUST cite a span
  of the proposal; every score below 3 MUST name the specific missing thing. **Uncited scores
  MUST be dropped by the aggregator** — dropped, not down-weighted, not defaulted — and each
  drop MUST be recorded as evidence with a stable reason code.

  **A citation MUST be validated, not merely present.** The aggregator MUST verify that each
  cited span actually resolves to a region of the proposal it claims to cite, and MUST drop a
  score whose citation does not resolve, exactly as it drops an uncited one. Presence-only
  enforcement is trivially satisfiable by a model emitting a plausible-looking span that quotes
  nothing, which would convert the citation requirement — the rubric's structural quality
  signal, and the input to FR-016's confidence aggregate — into a formatting convention.

- **FR-011 — The three hard caps are enforced deterministically.** D2 MUST cap at 1 when every
  alternative shares the chosen option's core assumption; D3 MUST be 0 when the consequences
  section contains no negative consequence; D5 MUST be 0 on unacknowledged contradiction of an
  accepted ADR. The **cap application** MUST be performed by the aggregator, deterministically,
  so that a fluent model cannot score around a cap by simply returning a higher number.

  **Be honest about what the model still supplies.** Two of the three antecedents — whether every
  alternative shares the chosen option's core assumption, and whether a consequences section
  contains a genuine negative consequence — are themselves judgments no deterministic check can
  make today; the model supplies them **as evidence**, and the aggregator applies the cap over
  that evidence. Only D5's antecedent has a deterministic counterpart (`affects-overlap` plus the
  accepted-ADR assertion check already landed in Pass 0). This is the same evidence-not-discretion
  split as FR-003 and it is sound, but the spec MUST NOT claim the caps are model-independent when
  their antecedents are not. Each cap application MUST record which antecedent evidence produced
  it, so a cap fired on model evidence is distinguishable from one fired on deterministic
  evidence.

- **FR-012 — A downward D4 correction escalates to a named human and MUST NOT silently
  re-route.** D4 is *"the fast path's safety interlock"*, and the rubric requires that any
  downward correction force re-routing. When Pass 2 corrects `reversibility` or `blastRadius`
  downward relative to the declaration, routing MUST be recomputed over the corrected value
  **and the proposal MUST escalate to a named human.** Silent re-routing is forbidden: a model
  changing a proposal's review tier is model discretion over escalation, which ADR-0027 §1 and
  Principle IV (*"the evaluator routes; it never approves"*) both forbid. An interlock that
  quietly reassigns its own tier is not an interlock. The corrected value is a **suggested
  field value**, which Principle IV permits only *"for human confirmation."*

- **FR-013 — Weighting is per-tier.** `blastRadius: org` or `reversibility: one-way-door` MUST
  double-weight D2/D4/D7. Component-level two-way doors MUST let D1/D3/D8 dominate and MUST
  tolerate a thin D7. The exact numeric weights are **not yet specified** — see [Q5](#q5),
  which is an ADR rather than a decision this spec may make.

#### Pass 3 — Adversarial

- **FR-014 — Separate call, separate context, four required outputs.** Pass 3's prompt bundle
  MUST NOT contain Pass 2's scores, and MUST prompt for the strongest objection rather than for
  balance. Pass 3 MUST emit exactly four outputs — strongest objection, most likely failure
  mode, hidden one-way door, unstated assumption — each either present or **explicitly
  absent**. A slot MUST NOT be filled with invented content to satisfy the shape.

  **The limit of what adrkit can enforce.** adrkit controls the bundle it emits, not the
  harness's own conversation state. Asserting that the Pass 3 bundle contains no Pass 2 scores
  guarantees adrkit did not supply them; it does not guarantee the harness executed the call in
  a fresh context. The architecture ADR (T003) MUST state this boundary explicitly and place the
  fresh-context obligation on the harness contract, so that *"separate call, separate context"*
  is a stated requirement on the integrator rather than an unverifiable claim by this feature.

#### The three triggers

- **FR-015 — The new triggers are declarative, ordered, and never model-discretionary.** Each
  of `low-confidence`, `pass-disagreement`, and `novel-no-precedent` MUST be a named condition
  emitting an ordered evidence status with a stable reason code, computed **after** the pass
  results and never as an additional rule. Escalation MUST remain a boolean OR. No model output
  may itself decide to escalate; a model may only supply a value that deterministic code then
  compares.

- **FR-016 — `low-confidence` thresholds a computed value, computable by the pure kernel.** The
  compared value MUST be **citation coverage over a fixed denominator of 8** (feature 012 FR-021):

  ```
  confidence = |{ d in D1..D8 : Pass 2 produced a surviving, cited score for d }| / 8
  ```

  A model's self-reported confidence MUST NOT be used, alone or as a term — a model asked how sure
  it is will answer fluently and meaninglessly. The aggregate is computable by the pure kernel from
  `RubricScoreSnapshot` alone, with no call-out (FR-003).

  **The denominator is the constant 8, never "dimensions attempted."** A pass that attempted two
  dimensions and cited both would otherwise score `1.0` — the least confident possible run scoring
  as the most. Absent, uncited, and dropped dimensions all lower confidence. Note the coherence
  check this definition passes: `0.7 x 8 = 5.6`, so the rubric's own documented default fires when
  fewer than six of eight survive with citations. Since a surviving score requires a **validated**
  citation (FR-010), an unresolvable citation lowers confidence rather than inflating it.

  The threshold (default `0.7`) is calibrated by 012.

- **FR-017 — `pass-disagreement` records evidence for 012's predicate; it does not recompute
  it.** Pass 3 MUST attribute each of its four outputs to the dimension(s) it bears on
  (`bearsOn: D1…D8`), because "contradicts Pass 2 on any dimension" has no mechanical referent
  otherwise — Pass 3 is prompted adversarially and does not score D1–D8. The **predicate** that
  decides whether a Pass 3 finding contradicts a Pass 2 dimension MUST have exactly **one**
  owner, feature 012, so that this trigger's firings and 012's published inter-pass disagreement
  rate are computed from the same comparison and reconcile by construction.

  The predicate is frozen by 012 and exported by them as a pure function over
  `RubricScoreSnapshot` + `AdversarialSnapshot`. For dimension `d`, Pass 3 contradicts Pass 2 when
  **either**: (1) a **present** `hidden-one-way-door` output carries `d` in `bearsOn`,
  **unconditionally**, whatever Pass 2 scored; or (2) any **present** adversarial output carries
  `d` in `bearsOn` **and** Pass 2's **post-drop surviving** score for `d` is **>= 3**. Both
  disjuncts are the rubric's own — it escalates when Pass 3 *"surfaces a hidden one-way door or an
  objection that Pass 2 scored as already addressed"* — and the `>= 3` cut point is the rubric's
  anchor for *"adequate for the blast radius"*, not a number either spec invented. An
  **explicitly absent** output contributes nothing: neither contradiction nor evidence of
  agreement.

  This feature's obligation is therefore to **record** the evidence (FR-021) in a form 012 can
  aggregate directly: they aggregate and **never recompute the comparison**, so a disagreement this
  feature fails to record is one their published rate cannot recover. The recording MUST
  distinguish all three FR-005 states **and** the case where the comparison could not be run at
  all — four distinguishable outcomes, not three — because 012 excludes `evidence-absent` from the
  denominator precisely so a `0.0` cannot be manufactured from missing data (FR-028).

- **FR-018 — `novel-no-precedent` distinguishes novelty from breakage, and is blocked on a
  primitive that does not exist.** The trigger MUST be `condition-met` **only** when retrieval ran
  successfully with a configured ranking strategy and returned nothing a ranking function admitted.
  When retrieval did not run, no ranking strategy was configured, or it errored, the trigger MUST
  be **`evidence-absent`** with an inert finding (ADR-0009). A broken or unconfigured retrieval
  MUST NOT be representable as a novel decision.

  **The relevance floor is withdrawn, not deferred.** **No relevance scoring exists in this
  repository** — `packages/mcp/src/search/normalize.ts` documents itself as *"No stemming, fuzzy,
  weighting, or ranking"* — so a floor calibrated over a ranking function that does not exist is a
  parameter whose tuning changes nothing. Feature 012 has withdrawn it accordingly. Until a
  ranking primitive exists ([Q3](#q3)), this trigger is expected to remain permanently
  `evidence-absent`, which is the honest state and MUST be reported as such rather than worked
  around.

  **A permanently absent trigger MUST NOT fail the gate, and its absence has a class.** Trigger
  evidence states (FR-021) and metric `not-computable` classes (FR-028) are **different axes**: a
  trigger recorded `evidence-absent` for every case is not a missing outcome label class, and
  feature 012's fail-closed gate must not reject it (012 FR-023a). When this trigger's absence is
  surfaced as a metric state, its class is **`nothing-to-measure`** — *structurally* absent,
  because the primitive does not exist at all and no case could ever supply it — **not**
  `input-unavailable`, which means the primitive exists and this case's inputs could not supply
  it. That distinction MUST be preserved: collapsing them would hide a regression in which a
  **working** primitive silently stops producing evidence, by making it look like the permanent
  expected condition. If a relevance primitive ever ships, this trigger moves from
  `nothing-to-measure` to `input-unavailable`, and **that transition MUST be visible.**

- **FR-029 — One module MUST compose the eleven triggers into the canonical ordered output.**
  The landed pipeline emits a single ordered escalation stream: `packages/evaluator/src/patch/project.ts`
  is the sole producer of `EvaluationPatch.escalationReasons`, and feature 007's ARB queue routes
  on that field. The canonical eleven-trigger order **interleaves** the three new triggers among
  the eight landed ones (`docs/EVALUATOR_RUBRIC.md`; `EscalationReason` in
  `packages/core/src/schema/adr.schema.ts`), so a sibling kernel's output **cannot** simply be
  appended.

  This feature MUST therefore name a composition module, its merged ordering rule (the canonical
  eleven-trigger order), and its placement — a pure kernel inside `@adrkit/evaluator`, matching
  where `computeRouting` and `projectPatch` already live — and MUST export it from
  `packages/evaluator/src/index.ts` so the CLI has a reachable entry point. Without it, FR-024's
  argument that no schema change is needed *because the eleven values already exist* is
  unrealized: nothing this feature produces would ever carry `low-confidence` in
  `escalationReasons`, the ARB queue would never see a probabilistic escalation, and 012 would
  receive records whose reason ordering is undefined across evaluations.

  Composition MUST NOT alter the eight landed triggers' own evidence stream or Pass 0's
  serialized bytes (FR-002), and the pre-probabilistic routing decision FR-020 requires MUST
  remain recoverable from the composed output.

- **FR-019 — Escalation routes to a named human.** Resolution MUST reuse the landed `deciders`
  → CODEOWNERS-of-affected-paths → IDP-catalog-owner resolver unchanged. *"Escalated to the
  ARB" with no name attached is how proposals die quietly.*

#### Calibration interface obligations (ADR-0027 §3)

- **FR-020 — The probabilistic-marginal subset MUST be computed from the pre-probabilistic
  routing decision.** The evaluator's machine-readable output MUST allow a consumer to
  determine, per evaluation, whether any deterministic trigger fired **evaluated over declared
  frontmatter and Pass 0 evidence only** — before any Pass 2 or Pass 3 output is applied. The
  output MUST carry **both** routing decisions: the **pre-probabilistic** decision, which
  defines the marginal partition, and the **post-probabilistic** decision, which is what
  actually routes. ADR-0027 §3 is explicit that the whole-gate figure alone does not satisfy
  the precondition.

  **Why the partition must be pre-probabilistic.** Two landed "deterministic" triggers can fire
  from model-supplied values once this feature exists: FR-012 recomputes routing over a Pass 2
  correction to `reversibility`, and a Pass 2 `D5 = 0` satisfies `contradicts-accepted-adr`
  (US2 acceptance scenario 4). If the marginal partition were computed from the routing decision
  *after* those corrections, **Pass 2 would choose its own denominator**: every case it corrected
  into a deterministic escalation would leave the marginal subset, and a badly-behaved Pass 2
  would be measured only over the cases it declined to touch. That reconstitutes, one level down,
  exactly the masking ADR-0027 §3 was written to close.

  The three new triggers MUST NOT inherit the `--json`-only asymmetry described below.

  **Rationale, stronger than the record states.** ADR-0027 requires the marginal figure because
  escalation is an OR and eight triggers at precision `1.0` by construction would mask a
  worthless Pass 2. There is a second and sharper reason: for the eight landed triggers the
  false-versus-absent distinction is **destroyed at emission** and cannot be retrofitted without
  changing landed behavior (FR-002), so the whole-gate denominator contains an irreducible
  population whose membership cannot be verified. The whole-gate recall denominator is therefore
  **structurally weaker than the marginal one, permanently**, and the marginal figure is the only
  one whose denominator can be clean. That makes this requirement a **measurement necessity**,
  not a policy choice. See [Q7](#q7).

  **A known output asymmetry to avoid inheriting.** In the landed surface, `routing.evidenceStatus`
  — the full eight-trigger proven/not-proven stream — is reachable only under `--json`, while the
  default human output renders `routing.reasons`, the proven half alone. Recall cannot be computed
  from the proven half. This is an observation about the current implementation, **not** a
  statement made by ADR-0027; the record's Consequences addresses the conflation of
  evaluated-and-false with evidence-absent, not the rendering asymmetry.

  **Inherited qualifier.** Feature 012 emits every whole-gate figure carrying a machine-readable
  qualifier naming that conflation as a denominator limitation — from the report itself, not
  prose a consumer can forget to copy. If any output of this feature surfaces a whole-gate
  number, it MUST carry that qualifier too.

- **FR-021 — The three new triggers carry a three-state evidence status, compared by exact
  equality.** Each of the three MUST record one of feature 012's frozen tokens (012 FR-005):
  `condition-met` (evidence was available and the condition held), `condition-unmet` (evidence
  was available and the condition did not hold), or `evidence-absent` (no evidence was available
  to evaluate). These superseded an earlier `proven`/`not-proven`/`evidence-absent` draft in 012;
  cite the tokens, not the draft. **`evidence-absent` never enters a confusion-matrix cell.**

  ADR-0027 records the cost of conflating the last two — *"a `not-proven` produced by an absent
  snapshot is byte-identical to one produced by evaluated-and-false evidence. Counting the first
  as a true negative would inflate deterministic precision and corrupt the recall denominator."*

  Two mechanical constraints:

  - **Exact equality only.** These tokens MUST be compared against an exhaustive union, never by
    substring or prefix matching, because `met` is a substring of `unmet` — a prefix or
    `includes` test would silently classify `condition-unmet` as `condition-met` and invert the
    finding. A type-level union plus an exhaustiveness check is the intended guard.
  - **Pass 0's serialization is untouched.** This distinction MUST be achieved **without**
    altering the existing eight-trigger `TriggerEvidenceStatus` shape (FR-002); the new triggers
    carry their own evidence shape in a sibling kernel.

  Note that `scope-hierarchy.evidence-absent` already exists as a namespaced **rule-level**
  `ReasonCode` in `catalog.ts`. That is the same idea at a different scope and in a different
  field — a deliberate echo, not a collision.

#### Boundaries the feature must not cross

- **FR-022 — No approval, ever.** No pass may approve, accept, merge, or change any acceptance
  or `review` state. There is no `--write`, no auto-merge, and no state transition. The
  evaluator moves proposals through a queue; it does not empty it.

- **FR-023 — The evaluator persists nothing.** Feature 005's SC-008 (*"Pass 0 persists
  nothing"*) and ADR-0027 §1 both bind. Any `evaluation` block ever written to a record is
  delivered as a **pull request by the caller** (Principle I, ADR-0004); the evaluator returns
  a patch and never applies one. This feature MUST NOT add persistence to close the calibration
  gap — that gap is closed by re-derivation from committed history, which is 012's work.

- **FR-024 — No schema change.** The committed schema already declares all eleven
  `EscalationReason` values — including the three deferred ones — and `Evaluation` already
  carries `scores` (per-dimension 0–4) and `confidence` (0–1). This feature MUST NOT add,
  rename, or repurpose a schema field. Principle V treats the schema as a one-way door;
  citations are the one thing the current shape cannot express, which is [Q4](#q4).

- **FR-025 — Rubric changes are ADRs.** ADR-0005 action item 4, carried forward unmodified by
  ADR-0027 §4. If implementing this feature concludes the rubric must change, that is a **new
  ADR**, not an edit to `docs/EVALUATOR_RUBRIC.md`. One precise exception already exists:
  ADR-0027's **own action item 5** authorizes marking the three triggers deferred and
  re-attaching the calibration section in that file. Any *further* edit needs its own record.

- **FR-026 — No present-tense claims.** No artifact produced by this feature may describe the
  evaluator as four-pass, rubric-scoring, or adversarial in the present tense until the
  corresponding pass ships (ADR-0027 §2). ADR-0014's vocabulary MUST be used exactly, and the
  maintainer's own reference repository MUST NOT be described as external validation or as a
  community adopter.

- **FR-027 — This feature MUST declare itself in feature 012's `passes` registry, and the
  registry's cross-check MUST key on a signal this architecture actually emits.** 012's
  precondition gate detects *"a probabilistic pass shipped"* so that a pass cannot reach a
  release without the holdout that governs it. Any pass this feature ships MUST be declared in
  that registry **in the same change that ships it**.

  **The dependency graph cannot serve as that signal, and must not be used as one.** Under the
  harness-driven architecture this same spec ratifies, shipping Passes 1–3 adds **no** model,
  prompt, embedding, retrieval, or HTTP dependency to any package — FR-004 forbids it, and
  `scripts/check-deps.ts` inspects declared `package.json` dependencies only. The dependency
  side of such a cross-check is therefore permanently empty **by construction**, which inverts
  the gate in both directions: an honestly declared pass is *"a registry entry with no matching
  dependency"* and would fail every release forever, while an **undeclared** shipped pass leaves
  registry and graph both empty, they agree, and the gate stays silent — reducing ADR-0027 §3's
  precondition to a voluntary self-declaration, which is precisely the evasion the record claims
  it is *"strictly harder to evade"* than.

  The cross-check MUST therefore key on a signal the harness architecture does emit. Candidate
  signals, to be settled with 012 before either spec's registry semantics are frozen: the
  presence of the pass kernels or the prompt-bundle surface in `packages/evaluator/src/index.ts`'s
  published exports; or the presence of a pass result / `PassAbsence` field in the emitted
  evaluation output. Both specs MUST name the **same** detector. If no mechanical detector is
  agreed, the specs MUST state plainly that the registry is **self-declared** and that the
  cross-check is not evidence of pass-shipping, rather than implying a mechanical guarantee that
  does not exist. See [Q8](#q8).

- **FR-028 — An uncomputable value is reported as `not-computable` in exactly one of four
  classes.** Any value this feature emits that cannot be computed MUST be rendered as an explicit
  `not-computable` carrying a machine-readable reason code **and exactly one class** (feature 012
  FR-017b). It MUST NOT be rendered as a passing-looking value, coerced, defaulted, or omitted in
  a way a consumer could read as success — no `0`, no `1.0`, no empty set standing in for "we did
  not measure this".

  | Class | Meaning | Disposition |
  |---|---|---|
  | `nothing-to-measure` | the subject does not exist yet — no probabilistic pass has shipped | the **only** class that may render ADR-0027's absence statement |
  | `input-unavailable` | the measurement is well-defined but a required input does not exist in the project | honest; a named gap |
  | `undefined-value` | the measurement ran over real data and the quantity is mathematically undefined | **a finding, not a failure** |
  | `measurement-failed` | the input should exist and could not be used | **a defect; fails the gate** |

  Three rules are load-bearing:

  - **`undefined-value` MUST NOT collapse into `measurement-failed`, or the reverse.** If these
    passes produce **zero escalations** across the holdout, that is `undefined-value` — and it is
    arguably the single most valuable output this apparatus can produce, because it would mean the
    probabilistic layer contributes nothing over the deterministic eight. Reporting it as a harness
    failure would bury exactly the signal ADR-0027 exists to surface; reporting a genuine harness
    failure as `undefined-value` would fabricate that signal.
  - **A computed zero MUST be representable distinctly from every `not-computable` state.**
    *Measured, and clean* and *could not measure* are different facts and may not share a
    representation. This binds the inter-pass disagreement output directly: a genuine `0.0` is
    012's defect signal, an unmeasurable one is not, and the two MUST NOT arrive at their
    aggregation looking alike.
  - **Only `nothing-to-measure` may render ADR-0027's absence statement.** Any renderer MUST derive
    that statement from the reported state, never from a separate "has a pass shipped?" branch — a
    branch and a state can disagree, and the branch is what silently drifts.

## Key Entities

- **`PromptBundle`** — the immutable artifact adrkit emits for the harness to execute. Carries
  the proposal, the retrieval context, and the pass-specific instruction. Pass 3's bundle
  provably excludes Pass 2's scores (FR-014).
- **`RetrievalSnapshot`** — the immutable output of Pass 1. Per item: record reference, status
  (`accepted` / `rejected` / `superseded` / …), the admitting rule or score, and provenance.
  Carries the strategy used and whether a ranking strategy was configured at all.
- **`RubricScoreSnapshot`** — the immutable output of Pass 2. Per dimension: raw score,
  citation (or its absence), applied cap, and post-drop surviving score. Carries the tier used
  for weighting, and any downward D4 correction (FR-012).
- **`AdversarialSnapshot`** — the immutable output of Pass 3. The four required outputs, each
  present or explicitly absent, each with `bearsOn: D1…D8` attribution (FR-017).
- **`ProbabilisticTriggerEvidence`** — the evidence bundle the pure router consumes to compute
  the three new triggers. Structurally analogous to the landed `RoutingTriggerEvidence`, but
  with 012's three-state status (`condition-met` / `condition-unmet` / `evidence-absent`)
  (FR-021).
- **`PassAbsence`** — the explicit "this pass did not run, and here is why" record. Required so
  absence is representable as absence rather than as a zero score or an empty set.

## Success Criteria

- **SC-001**: With **no model configured**, the full evaluator produces a Pass 0 report
  **byte-identical** to the landed evaluator's output for the same input, and the CLI exit code
  is unchanged. (regression assertion)
- **SC-002**: A proposal with any `error`-severity Pass 0 finding performs **zero** retrieval
  work, constructs **no** prompt bundle, and emits **no** model request — asserted by
  instrumenting the boundary, not by inspecting logs.
- **SC-003**: Given fixed input snapshots, two runs produce byte-for-byte identical aggregates,
  trigger-evidence streams, and serialized reports.
- **SC-004**: No adrkit package calls a model or holds model credentials, and neither
  `@adrkit/evaluator` nor `@adrkit/cli` gains a network-capable dependency (`@adrkit/ci`'s
  pre-existing `@actions/github` client is out of scope, FR-004); `purity.test.ts` and
  `contracts.test.ts` pass **unmodified**, and `clean-clone-builds` stays green with the
  probabilistic surface present.
- **SC-005**: `low-confidence` and `pass-disagreement` each have offline fixtures exercising
  **`condition-met`**, **`condition-unmet`**, and **`evidence-absent`**, all runnable with no
  model configured, and `condition-unmet` is distinguishable from `evidence-absent` in the output
  (FR-021). A fixture asserts the tokens are matched by exact equality, not by prefix (`met` is a
  substring of `unmet`). **`novel-no-precedent` is explicitly exempt from the all-three-states
  requirement** while no relevance primitive exists (FR-018, [Q3](#q3)): it has an
  `evidence-absent` fixture only, and a fixture asserting it can **never** reach `condition-met`
  from an empty retrieval result. Requiring three states of a trigger that cannot be evaluated
  would force either a fabricated fixture or a permanently red suite.
- **SC-006**: Retrieval returns every accepted ADR whose `affects` intersects the proposal's,
  and every broader-`scope` ADR in the same domain, **independent of relevance ranking** —
  demonstrated by a fixture in which the correct record would rank below the floor.
- **SC-007**: `rejected` and `superseded` records are present in the retrieval set with their
  status preserved, demonstrated by a fixture in which the only relevant precedent is a
  `rejected` record.
- **SC-008**: An uncited Pass 2 score is dropped and the drop is recorded with a stable reason
  code; a fixture demonstrates a high uncited score having **no** effect on the aggregate.
- **SC-009**: Each of the three hard caps (D2→1, D3→0, D5→0) is demonstrated by a fixture in
  which the model supplied a higher raw score and the aggregator overrode it.
- **SC-010**: A downward D4 correction escalates to a named human and is **never** applied as a
  silent tier change — demonstrated by a fixture asserting both the re-route and the escalation
  (FR-012).
- **SC-011**: An unconfigured or broken retrieval is reported as `evidence-absent` plus an inert
  finding, and is never representable as novelty. Once a relevance primitive exists, a genuinely
  novel proposal is `condition-met` and the two are **distinguishable**; until then the
  `condition-met` half is unreachable by construction and is asserted as such rather than
  fixtured (FR-018, [Q3](#q3)).
- **SC-012**: No code path from any pass reaches an approval, acceptance, `review`-state
  change, or in-place record write — asserted structurally.
- **SC-013**: The holdout-precondition gate is **observed rejecting** a probabilistic pass that
  lacks a frozen holdout, before that gate is relied upon (ADR-0016; ADR-0027 §4).
- **SC-014**: Given any evaluation output, a consumer can mechanically determine whether any
  deterministic trigger fired **evaluated over declared frontmatter and Pass 0 evidence only**,
  in the **default** output shape as well as under `--json`, and both the pre-probabilistic and
  post-probabilistic routing decisions are present (FR-020). A fixture demonstrates a Pass 2 D4
  correction that changes the post-probabilistic routing **without** changing marginal-subset
  membership.
- **SC-015**: Escalation from each new trigger resolves to a **named human** through the landed
  resolver, or reports `unresolved` — never an unnamed "the ARB".
- **SC-017**: A proposal with both a landed and a probabilistic trigger proven emits
  `escalationReasons` in the canonical eleven-trigger order — e.g. `['one-way-door',
  'low-confidence']` — reaching the ARB queue through the existing field, with Pass 0's own
  serialized bytes unchanged (FR-029, FR-002).
- **SC-016**: No artifact **this feature adds or modifies** describes the evaluator as
  four-pass, rubric-scoring, or adversarial in the present tense while the corresponding pass is
  unshipped, and the check T033 adds reports any pre-existing occurrence elsewhere in the
  repository as a finding rather than failing on it. ADR-0027 §2 binds the whole repository, but
  a success criterion this feature can be held to must be bounded by what it controls; an
  unbounded assertion would either fail on artifacts outside this change or silently pass by
  never being run.

## Non-goals

Named explicitly so an implementer does not helpfully build them:

- **No relevance ranker.** Adding ranking to search is its own feature with its own determinism
  obligations (`compareCodeUnits` ordering, byte-reproducibility) and its own record. This
  feature **names** the missing primitive and reports `novel-no-precedent` as `evidence-absent`
  until it exists ([Q3](#q3)).
- **No metric definitions.** Escalation precision, recall, false-negative rate, score-drift
  epsilon, inter-pass agreement rate, and override rate belong to feature 012.
- **No holdout set and no precondition gate.** Also 012's. This feature is *blocked on* them.
- **No persistence.** Not even to close the calibration gap. (FR-023)
- **No model client in adrkit.** No sockets, no credentials. (FR-004)
- **No approval, auto-merge, or state transition.** Ever. (FR-022)
- **No schema change.** (FR-024)
- **No rubric edit.** Rubric changes are ADRs. (FR-025)
- **No change to Pass 0's rules, order, severities, or report bytes.** (FR-002)
- **No hosted service, database, web UI, or telemetry upload.**
- **No fine-tuning, no model training, no prompt-optimization loop.**
- **No multi-repository or federated retrieval.** Single-corpus only.
- **No replacement of the MCP search tool.** Its deliberate no-ranking contract stays as is.

## Assumptions

- **A1 — The caller owns all I/O.** Consistent with feature 005: corpus loading, index access,
  prompt dispatch, and response parsing happen at the caller's boundary. The kernels receive
  immutable snapshots.
- **A2 — The snapshot is the determinism boundary.** Model sampling is not reproducible;
  everything downstream of the snapshot is. Determinism claims are scoped to that boundary.
- **A3 — Passes 1–3 may be unavailable at any time.** Absence is a first-class, explicitly
  represented state (`PassAbsence`, and `evidence-absent` for triggers), not an error and not a
  zero.
- **A4 — The eight landed triggers are unchanged.** This feature adds three; it does not revisit
  the eight, their order, or their evidence semantics.
- **A5 — Feature 012 lands first**, and the architecture ADR is accepted first. Every
  implementation phase here is gated on both.
- **A6 — There is no historical calibration data and there never will be.** Re-derivation from
  committed history is partial by construction (ADR-0027 Context). This feature does not attempt
  to reconstruct it.

## Open questions

Six questions remain open, carried as `[NEEDS CLARIFICATION]` rather than answered by
invention. A spec that reads as settled when it is not is the failure mode this project exists
to prevent. Q7 was resolved during scoping and is recorded under
[Decisions recorded during scoping](#decisions-recorded-during-scoping).

<a id="q1"></a>

- **Q1 — RESOLVED.** *What is "aggregate confidence"?* Feature 012 froze it as **citation coverage
  over a fixed denominator of 8** — see FR-016, which carries the definition, the constant-8
  denominator rule, and the `0.7 x 8 = 5.6` coherence check. Rejected alternatives are recorded in
  012's spec: *score dispersion* measures disagreement between dimensions rather than confidence,
  and *self-consistency across k samples* measures consistency (a model can be consistently wrong)
  while multiplying model cost by `k` and changing the harness contract. The latter is not excluded
  forever but would change what the threshold means, so it needs its own record.

<a id="q2"></a>

- **Q2 — RESOLVED.** *What is the contradiction predicate?* Frozen by feature 012 and exported by
  them as a pure function over `RubricScoreSnapshot` + `AdversarialSnapshot`; the two disjuncts and
  the `>= 3` cut point are recorded in FR-017. Both come from the rubric's own text — its
  escalation clause and its shared anchor defining `3` as *"adequate for the blast radius"* — so
  neither spec invented a number. 011 emits the `bearsOn` tag and records the evidence; 012 owns
  the predicate and the aggregation.

<a id="q3"></a>

- **Q3 — `[NEEDS CLARIFICATION]` Who owns a relevance primitive, if anyone?** There is **no
  relevance scoring anywhere in the repository**: `packages/mcp/src/search/normalize.ts` documents
  itself as *"No stemming, fuzzy, weighting, or ranking."* Feature 012 has **withdrawn** its
  relevance-floor parameter rather than deferring it (see FR-018), on the grounds that calibrating
  a floor over a non-existent ranking function is a measurement that measures nothing. This feature
  does not design a ranker either (see [Non-goals](#non-goals)); building one is a separate feature
  with its own determinism obligations (`compareCodeUnits` ordering, byte-reproducibility) and its
  own record. Both specs therefore carry this as an open question with **no owner**, which is the
  accurate state. **Owner: unassigned — needs a decision on whether it is scoped at all.**

<a id="q4"></a>

- **Q4 — `[NEEDS CLARIFICATION]` Must citations be auditable in-record?** The schema's
  `Evaluation.scores` is `record(string, number 0–4)` — there is **no citation field**. Since
  the evaluator persists nothing (FR-023), citations are **ephemeral by default today**: they
  exist in the report and are discarded with it. So the question is narrower than a schema
  change. If citations must be auditable inside the record, that is a schema change ⇒ Principle
  V one-way door ⇒ a new ADR. If they remain ephemeral, that MUST be stated explicitly so that
  nobody assumes an audit trail that was never built — a dropped score whose justification is
  unrecoverable is hard to defend to a reviewer. **Owner: maintainer, via ADR if the answer is
  "yes".**

<a id="q5"></a>

- **Q5 — `[NEEDS CLARIFICATION]` What are the exact per-tier weights?** The rubric says D2/D4/D7
  carry *"double weight"* for `org` / `one-way-door` — that is a number. It also says D1/D3/D8
  *"dominate"* for component-level two-way doors, and that a thin D7 is *"acceptable"* — those
  are not numbers. Pinning them down is itself a **rubric change**, which ADR-0005 action item 4
  (carried forward by ADR-0027 §4) makes an ADR rather than an edit. `docs/EVALUATOR_RUBRIC.md`
  MUST NOT be edited to resolve this. **Owner: maintainer, via ADR.**

<a id="q6"></a>

- **Q6 — `[NEEDS CLARIFICATION]` What is the prompt-bundle / structured-response contract with
  the harness?** The harness-driven architecture is settled (see
  [§ Architecture](#architecture-the-model-produces-evidence-deterministic-code-does-the-deciding)),
  but its wire contract is not: the bundle format, the response schema, how a malformed or
  refused response degrades (presumably to `PassAbsence` per A3), and whether the contract is
  versioned independently like the schema. This is the main design surface the architecture ADR
  should settle or explicitly defer. **Owner: 011, pending the architecture ADR.**

<a id="q8"></a>

- **Q8 — `[NEEDS CLARIFICATION]` What signal does the shipped-pass detector key on?** FR-027
  requires that a probabilistic pass be declared in feature 012's `passes` registry, and that the
  registry be cross-checked against a signal that a pass shipped. The dependency graph **cannot**
  be that signal: under the harness-driven architecture no model/prompt/embedding/retrieval
  dependency is ever added, so that side of the check is permanently empty by construction, which
  inverts the gate in both directions (see FR-027). Candidate replacements — published-surface
  exports, or a pass-result/`PassAbsence` field in the emitted output — are listed in FR-027 and
  are not yet chosen. **Both specs must name the same detector**, or must jointly state that the
  registry is self-declared and the cross-check is not evidence of pass-shipping. **Owner: the
  011/012 interface; blocks freezing the registry semantics in either spec.**

## Decisions recorded during scoping

Resolved while scoping, recorded here rather than dropped so the reasoning survives.

<a id="q7"></a>

### Q7 — RESOLVED: the calibration vocabulary is a separate namespace with three frozen tokens

**Decision.** The three new triggers record one of feature 012's frozen tokens (012 FR-005):

| Token | Meaning |
|---|---|
| `condition-met` | evidence was available and the trigger condition **held** |
| `condition-unmet` | evidence was available and the condition did **not** hold |
| `evidence-absent` | **no evidence was available to evaluate** |

`evidence-absent` never enters a confusion-matrix cell. Compared by **exact equality against an
exhaustive union only** — never substring or prefix matching, because `met` is a substring of
`unmet` (FR-021). Feature 012 owns these tokens; this feature consumes them.

**The landed routing vocabulary does not change, and is not a defect.**
`packages/evaluator/src/types.ts` declares `status: 'proven' | 'not-proven'`, and
`routing/route.ts` emits `not-proven` both when a condition is evaluated false and when optional
evidence is missing. For the eight landed triggers that token therefore means *"false **or**
absent"*. That is **correct for routing** — escalation fires only on proven evidence, so false
and absent route identically and must. It is merely insufficient for a calibration use case that
did not exist when it was written. Widening it would change landed behavior for eight triggers to
serve calibration, which FR-002 forbids.

**No schema change, no Principle V question.** `not-proven` appears **0 times** in
`schema/adr.schema.json` and **0 times** in `packages/core/src/schema/adr.schema.ts` — both
vocabularies are internal to `@adrkit/evaluator`, neither is published contract. Recorded so this
is not reopened out of a fear of a breaking change that does not exist.

**The consequence that outlives the naming.** A distinct vocabulary prevents *new* loss; it does
not repair the existing one. For the eight landed triggers the false-versus-absent distinction is
**destroyed at emission** — it never enters the report, so no consumer can recover it from the
report alone, and feature 012's reconstructed snapshots recover it only partially and by
construction. The three new triggers can carry all three states from day one; the landed eight
cannot be retrofitted without changing landed behavior, which both specs forbid.

The asymmetry is therefore **permanent**: the whole-gate recall denominator contains an
irreducible population whose membership cannot be verified, while the probabilistic-marginal
denominator **can** be clean. This gives ADR-0027 §3's dual-figure rule a second and stronger
justification than the record's own argument from masking — **the marginal figure is the only one
whose denominator can be clean** — which makes the dual requirement a measurement necessity
rather than a policy choice, and correspondingly harder to erode later. Cited in FR-020.
