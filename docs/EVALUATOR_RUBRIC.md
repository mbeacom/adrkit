# Evaluator Rubric v0.1.0

The evaluator scores a **proposal** — a `draft` or `proposed` ADR, or an agent
plan being converted into one. It never approves anything. Its only outputs are
a scored report and a routing recommendation.

Design constraints, in priority order:

1. **Deterministic before probabilistic.** Anything checkable without a model is
   checked without a model, first, and reported separately.
2. **Per-dimension scores with citations.** No gestalt verdict. A single number
   is unfalsifiable and gets ignored within two sprints.
3. **Separation of grading and attacking.** The adversarial pass is a distinct
   call with a distinct context. A model asked to both defend and critique does
   neither well.
4. **Escalation is declarative.** Every human-in-the-loop trigger is a named,
   auditable condition — not model discretion.
5. **The rubric is itself an ADR.** Changes go through the same review path,
   with calibration numbers attached.

---

## Pass 0 — Deterministic (no model)

Runs first. If it produces `error`-severity findings, the proposal is returned
without spending tokens on the later passes.

| Rule | Severity | Check |
|---|---|---|
| `schema-valid` | error | Frontmatter parses and validates |
| `id-unique` | error | No id collision in the log |
| `supersession-consistent` | error | `supersedes` / `supersededBy` are reciprocal; no cycles |
| `no-orphan-refs` | error | Every `relatesTo` / `supersedes` target exists |
| `affects-resolvable` | warn | Every `affects` matcher resolves to ≥1 real path/entity |
| `affects-overlap` | warn | Overlapping `affects` with an accepted ADR → candidate conflict |
| `scope-hierarchy` | error | A `component` ADR does not contradict an `org` ADR's assertions |
| `assertions-compile` | error | Rego/JSONPath expressions parse |
| `assertions-pass` | warn | Assertions evaluate green against current HEAD |
| `decider-resolvable` | warn | Identities resolve in the org directory |
| `expiry-sane` | info | `reviewBy` is in the future |

Deterministic findings land in `evaluation.deterministicFindings`. In practice
this pass catches a large share of what a reviewer would have caught, at
effectively zero cost — build it fully before writing a single prompt.

---

## Pass 1 — Retrieval

Assemble the context the later passes reason over. Not scored.

- Top-k semantically related decisions, **including `rejected` and
  `superseded`** — the graveyard holds the "we tried that" knowledge that makes
  review valuable.
- All accepted ADRs whose `affects` intersects this proposal's `affects`.
- Any ADR at broader `scope` in the same `domain`.
- The diff or spec artifact the proposal derives from, if present.

Retrieval quality dominates evaluation quality. Instrument recall here before
tuning anything downstream.

---

## Pass 2 — Rubric scoring

Eight dimensions, each scored 0–4 against explicit anchors. Every score above 0
must cite a span of the proposal; every score below 3 must name the specific
missing thing. Uncited scores are dropped by the aggregator.

**Anchors** (apply to every dimension):
`0` absent · `1` gestured at · `2` present but thin · `3` adequate for the blast
radius · `4` unusually good, reusable as an exemplar

### D1 — Problem clarity
Is the forcing function stated? Would a reader six months from now understand
why this came up *now*? Distinguishes a real constraint from a preference.
*Score 2 cap if the problem statement is a restatement of the chosen solution.*

### D2 — Alternatives considered
Are there ≥2 genuine alternatives, including "do nothing"? Straw men are the
dominant failure mode: an alternative that no competent engineer would pick is
worth 0, not 2.
*Score 1 cap if every alternative shares the chosen option's core assumption.*

### D3 — Trade-off honesty
Are the **costs** of the chosen option stated as plainly as its benefits? A
proposal whose chosen option has no listed downsides is not a decision, it's an
advertisement.
*Score 0 if the consequences section contains no negative consequence.*

### D4 — Reversibility & blast radius accuracy
Does the stated `reversibility` / `blastRadius` match the substance? Systematic
under-declaration is the failure that makes the fast path dangerous — this
dimension is the fast path's safety interlock.
*Any downward correction here forces re-routing.*

### D5 — Prior-decision coherence
Does it engage with retrieved related decisions? Contradicting an accepted ADR
is fine — *silently* contradicting it is not. Explicit, argued supersession
scores 4.
*Score 0 if it contradicts an accepted ADR without acknowledgment.*

### D6 — Falsifiability
How would we know this was wrong? Names a metric, a threshold, a review date,
or an exit condition. This is the dimension that most separates ADRs that stay
alive from ADRs that rot.

### D7 — Operational consequences
Who carries this after merge? Runbook impact, on-call surface, migration path,
rollback, cost trajectory. Chronically weakest dimension in practice; weight it
accordingly for infra decisions.

### D8 — Enforcement specificity
Are `affects` and (where appropriate) `assertions` populated well enough that
the decision can be located and checked later? An unenforceable ADR is a wish.

**Weighting** is per-tier, not global. For `blastRadius: org` or
`reversibility: one-way-door`, D2/D4/D7 carry double weight. For component-level
two-way doors, D1/D3/D8 dominate and a thin D7 is acceptable.

---

## Pass 3 — Adversarial

Separate call, separate context. Prompted as a skeptical reviewer whose job is
to find the strongest objection, not to be balanced.

Required outputs:
- **Strongest objection** — the one a competent dissenter would actually raise.
- **Most likely failure mode** — what breaks, and roughly when.
- **Hidden one-way door** — anything irreversible not declared as such.
- **Unstated assumption** — the load-bearing belief nobody wrote down.

Escalates to a human if it surfaces a hidden one-way door or an objection that
Pass 2 scored as already addressed. **Disagreement between passes is signal, not
noise** — treat it as an escalation trigger rather than reconciling it silently.

---

## Escalation — human in the loop

Escalation is a boolean OR over declarative conditions. No condition is
model-discretionary.

| Trigger | Condition |
|---|---|
| `one-way-door` | `reversibility: one-way-door`, declared or corrected by D4 |
| `cost-threshold` | Stated or estimated cost above configured threshold |
| `security-surface` | `affects` intersects paths/entities tagged security-sensitive |
| `data-residency` | Touches data classified above configured level, or crosses a region boundary |
| `regulatory` | Non-empty `complianceControls`, or `affects` intersects a regulated entity |
| `contradicts-accepted-adr` | D5 = 0, or `affects-overlap` with an accepted ADR whose assertions fail |
| `low-confidence` | Aggregate confidence below threshold (default 0.7) |
| `pass-disagreement` | Pass 3 contradicts Pass 2 on any dimension |
| `agent-authored-production` | `provenance.authoredBy` ≠ `human` **and** `affects` reaches production infra |
| `novel-no-precedent` | Retrieval returns nothing above the relevance floor |
| `human-requested` | Anyone asks. Always available, never overridden. |

Escalation routes to a **named human**, resolved from `deciders`, CODEOWNERS of
the affected paths, or the IDP catalog owner — in that order. "Escalated to the
ARB" with no name attached is how proposals die quietly.

### What escalation does *not* mean

A non-escalated proposal is not approved. It is eligible for its routed tier
(`auto` / `async` / `arb`). The evaluator moves proposals through a queue; it
does not empty it.

---

## Calibration

The rubric is worthless uncalibrated, and calibration is what makes this
defensible in a regulated environment.

- Maintain a labeled set of historical proposals with known outcomes (shipped
  clean / shipped and reverted / caused an incident / rejected in review).
- Report **escalation precision and recall** per release. Optimize for recall on
  the incident-causing class; false-positive escalations are cheap, missed
  one-way doors are not.
- Track **score drift** across model versions on a frozen holdout. A model
  upgrade that shifts mean D3 by more than a configured epsilon is a breaking
  change and needs its own ADR.
- Publish inter-pass agreement rates. If Pass 2 and Pass 3 never disagree, one
  of them is not doing its job.
- Track the **override rate**: how often humans reverse the routing
  recommendation, by tier and by dimension. Persistent overrides in one
  direction mean the rubric is miscalibrated, not that the humans are wrong.

Publishing the false-negative rate is uncomfortable and is exactly what stops
this from becoming evaluator theater.
