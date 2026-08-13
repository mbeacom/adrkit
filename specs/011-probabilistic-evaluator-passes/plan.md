# Implementation Plan: Probabilistic Evaluator Passes (Passes 1–3) — Phase 9

**Feature directory**: `011-probabilistic-evaluator-passes` (scoped in place — **no git branch
is created or switched** by this work) | **Date**: 2026-08-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-probabilistic-evaluator-passes/spec.md` and
its binding open questions **Q3–Q6** and **Q8** (Q1, Q2 and Q7 resolved during scoping).

**Status**: **Scoped** ([ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary — *scoped*, and nothing above it). This plan describes design intent for work that
is **not authorized to begin**. Two hard preconditions gate implementation, both tracked in
[`tasks.md`](./tasks.md) Execution Phase 0.

**Normative sources** (ADRs win on conflict):
[ADR-0027](../../docs/adr/0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
(the holdout precondition; the twice-published precision/recall obligation; the four-pass
architecture as **intent, not a shipped claim**),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(superseded, still the architecture of record; *rubric changes are ADRs*),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) (Passes 1–3, D1–D8, the eleven
triggers),
[ADR-0003](../../docs/adr/0003-ship-as-spec-kit-extension.md) (harness-hosted distribution),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (purity;
degradation-not-failure),
[ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles I–V.

> ### ⛔ Implementation is blocked on two gates
>
> 1. **Feature 012 has landed**: the frozen holdout set exists, and its precondition gate has
>    been **observed failing** (ADR-0016; ADR-0027 §4).
> 2. **An accepted ADR ratifies the harness-driven architecture** (spec § Architecture). That
>    record ratifies the architecture; it does **not** amend the constitution.
>
> Neither gate is satisfiable today. This plan exists so the design is review-ready when they
> are, per [`plan.md`](../../plan.md)'s explicit permission to scope ahead of implementation.

## Summary

Complete the four-pass evaluator by adding **Pass 1 (retrieval)**, **Pass 2 (rubric scoring)**,
and **Pass 3 (adversarial)**, and by closing the three deferred escalation triggers
(`low-confidence`, `pass-disagreement`, `novel-no-precedent`) that ADR-0027 §2 records as
deliberately absent.

The design rests on one idea, and everything else follows from it:

> **The model produces evidence. Deterministic, pure code does the deciding.**

adrkit emits a **prompt bundle** and consumes a **structured response**; the agent harness
performs the model call. No adrkit package opens a socket or holds a credential. The pure
kernels receive immutable snapshots and perform every comparison, cap, threshold, and routing
decision themselves. This makes *"escalation is never model discretion"* a **structural
property** rather than a promise — there is no code path from a model output to a routing
decision that does not pass through a pure kernel comparing it against a declared condition.

That choice is not a preference. It is the only option that satisfies **both** Principle II
(*network-dependent runtime behavior is forbidden*, whose rationale names offline use and the
Apache-2.0/employer-IP boundary) and Principle IV, **with nothing amended** — and it extends a
boundary the codebase already runs (`RoutingTriggerEvidence`), rather than inventing one.

Three findings from scoping shape the work and are recorded here because they are easy to
lose:

1. **No schema change is required.** The committed schema already declares all eleven
   `EscalationReason` values — including the three deferred ones — and `Evaluation` already
   carries `scores` and `confidence`. Principle V's one-way door is **not** tripped (FR-024).
2. **`novel-no-precedent` is blocked on a primitive that does not exist.** There is no
   relevance scoring anywhere in the repository; `packages/mcp/src/search/normalize.ts`
   documents itself as *"No stemming, fuzzy, weighting, or ranking."* This feature does not
   build a ranker; the trigger reports `evidence-absent` until one exists (FR-018, Q3).
3. **The precondition is satisfied only by the probabilistic-marginal figure.** ADR-0027 §3
   requires precision/recall/FNR published twice, and states that the whole-gate figure alone
   does not discharge the obligation. That imposes two output obligations on *this* feature:
   the marginal subset must be mechanically determinable (FR-020), and *evidence-absent* must
   be distinguishable from `condition-unmet` (FR-021).

## Technical Context

**Language/Version**: TypeScript (ESNext), developed and tested with **Bun** (CI pins
`1.3.14`). Published artifacts target Node **`>=22`** (ADR-0010). No npm/pnpm/yarn/jest/vitest.

**Primary Dependencies**: unchanged for `@adrkit/evaluator` — `@adrkit/core` (`workspace:*`)
plus the existing vetted deterministic engine libraries. **No model SDK, no embedding library,
no HTTP client may be added to any package**, because the harness performs the model call
(FR-004). Any dependency proposed for this feature that opens a socket is out of contract.

**Storage**: **None.** Git working tree plus caller-supplied immutable snapshots. The evaluator
persists nothing (FR-023; feature 005 SC-008; ADR-0027 §1). Any retrieval index is a derived,
disposable projection reconstructible from git alone and is never an authority (FR-009,
ADR-0004).

**Testing**: `bun test`. An **offline fixture matrix** of frozen `RetrievalSnapshot`,
`RubricScoreSnapshot`, and `AdversarialSnapshot` inputs — no live model, no network, no
credentials. Every test is runnable with **no model configured at all**. Model sampling is
outside the determinism boundary by construction (A2); everything downstream of the snapshot is
byte-reproducible.

**Target Platform**: Portable Node `>=22` library plus CLI subcommand surface, invoked by an
agent harness (Spec Kit extension, MCP client, or CI job) that supplies model responses.

**Project Type**: Bun-workspace monorepo. Extends the existing first-party
**`packages/evaluator/`** with pure kernels only; all impurity lives at the existing
`@adrkit/cli` composition boundary.

**Performance Goals**: Deterministic. Pass 0's short-circuit is the cost control — an
`error`-severity finding spends **zero** tokens (FR-001, SC-002). Retrieval is linear in
`records × matchers`.

**Constraints**: Purity is a CI-asserted contract, not a convention. Three landed gates must
stay green **unmodified**: `packages/evaluator/test/purity.test.ts` (traps `globalThis.fetch`,
`Date.now`, `Math.random`), `packages/evaluator/test/contracts.test.ts` (bans `node:fs`,
`node:net`, `node:http`, `node:child_process`, `@adrkit/cli`, `@adrkit/ci`, `@adrkit/adapter*`
under `packages/evaluator/src/`), and feature 005 **SC-006** (*"the pure Pass 0 library imports
no model/prompt/embedding/retrieval library"*). Pass 0's serialized report bytes must not change
(FR-002).

**Scale/Scope**: Single-corpus, single-repository. No federated or multi-repo retrieval.

**Bun-version note**: use pinned stable Bun **1.3.14** for any install; preserve `bun.lock`
lockfileVersion 1.

## Constitution Check (pre-design gate)

*GATE: evaluated **before** the design below. Complexity Tracking is **not** empty — two
genuine items are recorded, and Principle II carries an honest conditional rather than an
unqualified PASS.*

| Principle | Pre-design assessment |
|---|---|
| **I. Git is the source of truth** | **PASS (planned)** — every pass **returns** evidence and a patch; none writes a record, an acceptance state, or a `review` field, and none touches a database (FR-022/FR-023). Any retrieval index is a derived, disposable projection, rebuildable from git, never authoritative, and inert when absent (FR-009; ADR-0004). Any `evaluation` block ever persisted is delivered as a caller PR. |
| **II. Clean clone builds green** | **PASS (planned), conditional on the architecture ADR.** The harness-driven design (FR-004) means **no adrkit package opens a socket or holds a credential**, so post-install build, typecheck, test, lint, packaging, and runtime remain credential-free, service-free, and network-free. Every test in this feature runs against frozen offline snapshots with no model configured. This satisfies Principle II **with nothing amended** — which is precisely why the rejected alternative (an in-adrkit model client) is rejected: it would require amending this principle, contradicting its own stated rationale of *"offline use"* and *"the mechanical boundary between this Apache-2.0 project and any employer-internal IP."* **The condition**: this reading must be ratified by the architecture ADR before implementation, not assumed by an implementer. Tracked in Complexity Tracking and as a Phase 0 gate. |
| **III. Core depends on no adapter** | **PASS (planned)** — no new dependency on `packages/adapters/*` from `core`, `cli`, `evaluator`, or `schema`. No model SDK, embedding library, or HTTP client is added anywhere (Technical Context). `core-has-no-adapter-deps` stays green. |
| **IV. Deterministic before probabilistic** | **PASS (planned)** — Pass 0 runs first and short-circuits on `error` before any retrieval, prompt construction, or model call (FR-001, SC-002). Pass 0 stays independently useful with no model configured (US5, SC-001, byte-identical regression assertion). Escalation remains a boolean OR over declarative conditions; the three new triggers threshold **computed** values, never a model's self-report (FR-015/FR-016). A downward D4 correction is a *suggested field value* that escalates to a named human and never silently re-routes (FR-012) — the principle's own *"for human confirmation"* wording, honored literally. The evaluator routes; it never approves (FR-022). |
| **V. The schema is the contract** | **PASS (planned)** — **no schema change.** All eleven `EscalationReason` values and the `scores`/`confidence` fields already exist in `packages/core/src/schema/adr.schema.ts`; this feature adds none, renames none, repurposes none (FR-024). `schema-emit-matches` is unaffected. The one thing the current shape cannot express is a per-score **citation**; that is surfaced as an open question ([Q4](./spec.md#q4)) whose "yes" branch is explicitly routed through an ADR rather than an edit. |

**Result**: **PASS (planned), with two tracked items and six open questions.** No principle is
violated by the design as scoped. Principle II passes *because* the harness-driven architecture
was chosen; that dependency is recorded rather than hidden, and is the reason the architecture
needs a ratifying record before code exists.

## Project Structure

### Documentation (this feature)

```text
specs/011-probabilistic-evaluator-passes/
├── spec.md                         # Feature spec (binding; FR-001–FR-029, SC-001–SC-017, Q3–Q6 + Q8 open)
├── plan.md                         # This file
└── tasks.md                        # Phase 0 hard gates + dependency-ordered task list (all unchecked)
```

*Deliberately absent*: `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`. Feature
005 carried all four because it was cleared to implement. This feature is **scoped only**, and
several shapes those documents would fix — the aggregate-confidence definition (Q1), the
contradiction predicate (Q2), the relevance primitive (Q3), the prompt-bundle wire contract
(Q6) — are open by design. Writing them now would manufacture the appearance of settled design
over six unanswered questions, which is the failure mode ADR-0027 exists to prevent. They are
tasks in `tasks.md`, gated behind Phase 0.

### Source Code (repository root — extends merged Phase 0–6 surfaces)

```text
packages/evaluator/                 # EXISTING @adrkit/evaluator — pure kernels only, purity contract unchanged
├── src/
│   ├── pass0.ts                    # UNCHANGED (FR-002): eleven rules, fixed order, byte-identical report
│   ├── catalog.ts                  # + reason codes for the three new triggers (additive; Pass 0 codes untouched)
│   ├── routing/
│   │   ├── route.ts                # UNCHANGED for the eight; new triggers computed in a sibling kernel
│   │   ├── probabilistic.ts        # NEW pure kernel: three triggers over ProbabilisticTriggerEvidence
│   │   └── target.ts               # UNCHANGED — reused verbatim for named-human resolution (FR-019)
│   ├── passes/                     # NEW pure kernels — no I/O, no model, no network
│   │   ├── retrieval.ts            #   rule-based admission (affects ∩, broader scope, graveyard) over a snapshot
│   │   ├── rubric.ts               #   aggregator: citation-drop, three hard caps, per-tier weights
│   │   └── adversarial.ts          #   four-output validation + bearsOn attribution
│   └── prompts/                    # NEW pure DATA: prompt-bundle templates (strings), no dispatch
└── test/
    ├── purity.test.ts              # UNCHANGED and MUST stay green — extended to cover the new kernels
    ├── contracts.test.ts           # UNCHANGED and MUST stay green (banned-import list unchanged)
    └── fixtures/                   # NEW frozen offline snapshots: retrieval / rubric / adversarial / trigger matrix

packages/cli/src/                   # EXISTING composition boundary — the ONLY place impurity may live
└── evaluate.ts                     # + emit prompt bundles, ingest structured responses, build snapshots
                                    #   still NO --write, still no socket (the harness calls the model)
```

**Structure Decision**: the probabilistic passes are **pure kernels inside the existing
`@adrkit/evaluator`**, not a new package. The kernels consume immutable snapshots and therefore
need none of the banned imports, so `contracts.test.ts` and `purity.test.ts` apply to them
unchanged — which is the point: the strongest available guarantee that no model call can occur
inside a kernel is the gate that already exists. Prompt templates are **data** (strings), not
I/O, so they sit in the pure package legitimately.

All impurity — emitting the prompt bundle, receiving the harness's structured response, reading
any index, assembling snapshots — lives in `@adrkit/cli`, the composition boundary feature 005
already established. **No new package is created**, and no model SDK enters the dependency graph
at any point.

The three new triggers are computed in a **sibling kernel** (`routing/probabilistic.ts`) rather
than inside `route.ts`, so that Pass 0's eight-trigger evidence stream and serialized bytes are
provably untouched (FR-002) while the new triggers carry the richer three-state evidence shape
that FR-021 requires.

## Constitution Check (post-design re-check)

*GATE: re-evaluated **after** the structure decision above.*

| Principle | Post-design assessment |
|---|---|
| **I. Git is the source of truth** | **PASS** — the structure adds no write path. `evaluate.ts` still has no `--write`; the new kernels return values only. |
| **II. Clean clone builds green** | **PASS, conditional (unchanged)** — the structure decision *strengthens* this: because kernels live inside the package already guarded by `contracts.test.ts`, adding a model SDK would fail an existing test rather than pass silently. The condition remains the architecture ADR. |
| **III. Core depends on no adapter** | **PASS** — no adapter import, no new external dependency. |
| **IV. Deterministic before probabilistic** | **PASS** — reinforced by placement: the sibling-kernel split keeps Pass 0's path byte-identical, and the three triggers are computed after the pass results, never as additional rules. |
| **V. The schema is the contract** | **PASS** — no schema edit; new reason codes are evaluator-internal catalog entries, the same class of runtime-only vocabulary feature 005 already established. |

**Result**: **PASS.** The design introduces no constitutional violation. The two tracked items
below are a *conditional* and a *known gap*, not deviations to be justified away.

## Complexity Tracking

Unlike feature 005, this table is **not** empty. Both entries are recorded because hiding
either would make the plan read as more settled than it is.

| Item | Why it exists | Simpler alternative rejected because |
|---|---|---|
| **Principle II passes only under the harness-driven architecture**, which itself needs a ratifying ADR before implementation | Principle II forbids network-dependent runtime behavior with one carve-out (`bun install --frozen-lockfile`), while Principle IV contemplates model calls. The constitution does not resolve this, so the resolution must be recorded rather than assumed by whoever implements. | The simpler alternative — an injected model client inside adrkit, letting `adr evaluate` complete Passes 2–3 unaided — requires **amending a constitutional principle** to buy a convenience Principle IV already tells us not to want, and breaches Principle II's own stated rationale (offline use; the Apache-2.0/employer-IP boundary). Rejected unless amended, with the cost stated plainly in the spec so a future reader can see exactly what it would take. |
| **`novel-no-precedent` ships permanently `evidence-absent`** until a relevance primitive exists | There is no relevance scoring in the repository at all. Reporting the trigger honestly as *evidence-absent* is the only truthful state available (FR-018, FR-021). | Building a ranker inside this feature was rejected: it carries its own determinism obligations (`compareCodeUnits` ordering, byte-reproducibility), its own calibration story, and its own record. Folding it in here would smuggle a substantial unreviewed design into a feature about passes. Fabricating `condition-met` from an empty result set was rejected outright — it would make a broken retrieval indistinguishable from a novel decision, the exact absence-versus-evidence confusion ADR-0027 was corrected to prevent. |

## Open questions carried into implementation

Five questions are unresolved by design and are reproduced from [spec.md](./spec.md) so this plan
cannot be read as settled. **Q3 blocks `novel-no-precedent`; Q4–Q6 block their surfaces; Q8 blocks freezing the registry semantics in either spec.** Q1, Q2 and Q7 are resolved — 012 froze the confidence aggregate, the contradiction predicate, and the calibration vocabulary.

| # | Question | Owner | Blocks |
|---|---|---|---|
| [Q3](./spec.md#q3) | The relevance primitive does not exist; 012 withdrew its floor rather than deferring it. Which feature builds one, if any? | unassigned | `novel-no-precedent` |
| [Q8](./spec.md#q8) | The shipped-pass detector cannot key on the dependency graph — it is empty by construction under this architecture. What signal replaces it? | 011/012 interface | freezing registry semantics |
| [Q4](./spec.md#q4) | Must citations be auditable in-record? Ephemeral by default today; "yes" ⇒ schema change ⇒ ADR. | maintainer | Pass 2 auditability |
| [Q5](./spec.md#q5) | Exact per-tier weights. "Dominate" is not a number; pinning it is a rubric change ⇒ ADR. | maintainer | Pass 2 weighting |
| [Q6](./spec.md#q6) | The prompt-bundle / structured-response wire contract with the harness. | 011, via the architecture ADR | Passes 2–3 |
