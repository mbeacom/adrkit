# Implementation Plan: Deterministic Evaluator (Pass 0) — Phase 4

**Feature directory**: `005-deterministic-evaluator` (scoped in place — **no git branch is
created or switched** by this work) | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-deterministic-evaluator/spec.md` and its
binding Clarifications **C1–C11**.
**Normative sources** (ADRs win on conflict):
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(deterministic-first evaluator; "Pass 0 complete and independently useful before any prompt
is written"),
[`docs/EVALUATOR_RUBRIC.md`](../../docs/EVALUATOR_RUBRIC.md) (the eleven Pass 0 rules and
their fixed severities),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is
truth; no DB/index required),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation; clean-clone build),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (pure resolution;
degradation-not-failure),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun toolchain, Node baseline), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles I–V.

> **✅ UPSTREAM OUTCOME GATE CLEARED 2026-07-19.**
>
> Phase 3 T018 is checked with a public 12-record second repository, a selective
> two-record comment, a same-comment second-run update, and default-token-only logs.
> See [research.md §R0](./research.md) and tasks T001.

## Summary

Build **Pass 0 only** — the deterministic, model-free first pass of the four-pass
evaluator (ADR-0005). Pass 0 applies **exactly the eleven rubric rules** of
`docs/EVALUATOR_RUBRIC.md` at their fixed severities to a proposal candidate selected from
the full corpus lint/load result plus **caller-supplied, immutable input snapshots**, and
returns two artifacts:

1. a runtime **`Pass0Report`** — an ordered, byte-for-byte reproducible record of **exactly
   eleven** rule results and a stream of declarative reason-code events, plus routing
   evidence and any inert / `not-evaluated` status; and
2. a schema-compatible **`evaluationPatch`** (`deterministicFindings[]` *violations only*,
   `escalate`, `escalationReasons[]`) that a **later caller may propose through a git PR**.

Pass 0 is a **pure function of its inputs**: it reads no clock, no network, no filesystem
beyond the supplied snapshots, and it **routes — it never approves, accepts, merges,
persists, or mutates** any record or acceptance state (ADR-0004; Principle IV). Any
`error`-severity finding marks the proposal `returned` and prevents later passes; only a
`schema-valid` failure stops the remaining typed Pass 0 rules, while other errors still allow
every independent deterministic rule to report. The load-bearing property is **independent
usefulness with no model** (ADR-0005 degradation; Principle IV): a genuinely useful linter
with no model available.

The deliverable is a first-party **`@adrkit/evaluator`** package (peer of `@adrkit/cli` /
`@adrkit/ci`, **not** an adapter, **not** core) holding the pure library, and a thin
**`adr evaluate`** subcommand on `@adrkit/cli` as the **impure composition boundary** that
reads disk/git, loads the caller snapshot bundle, and prints the report / patch. This
feature makes **no schema change** (Principle V; Clarification C6) and adds **no** model,
prompt, embedding, retrieval, adapter, or network/clock/filesystem-traversal dependency
(Principle II/III; ADR-0007).

## Technical Context

**Language/Version**: TypeScript (ESNext), developed and tested with **Bun** (CI pins
`1.3.14` — the env default is a canary that writes an unreadable v2 `bun.lock`; do not use
it for `bun install`). Published artifacts target Node **`>=22`** (ADR-0010).

**Primary Dependencies**: `@adrkit/evaluator` depends on **`@adrkit/core` (`workspace:*`)**
and exact **`jsonpath-rfc9535@1.3.0`** only. JSONPath uses the restricted source profile
in research R1. Rego uses a fixed caller-supplied compiled-artifact envelope and typed port,
but adrkit registers no default Rego runtime, does not depend on `@open-policy-agent/opa-wasm`,
does not execute untrusted Wasm, and never shells out to `opa`. The evaluator MUST **not**
import any model client, prompt / embedding /
retrieval library, adapter package, or a network / clock / filesystem-traversal dependency
(Principle III; ADR-0007; FR-001/FR-006). The assertion engines participate only through
**caller-supplied, registered deterministic ports** (FR-015; Clarification C5) so the
concrete library choice is replaceable behind the port.

**Storage**: **None.** Git working tree + caller-supplied immutable snapshots only. No
database, no index, no projection is read or written (ADR-0004; FR-014). Pass 0 persists
nothing; the returned `evaluationPatch` is data the caller may later propose via PR.

**Testing**: `bun test`. An **offline fixture matrix** covering, for every rule, its
**pass / fail / and (where applicable) inert** outcome with **no model configured**;
schema-invalid short-circuit + prerequisite `not-evaluated`; **byte-for-byte** ordering /
canonical-serialization reproduction; `evaluationPatch` validation against the **current
committed schema**; input-immutability / no-mutation assertions; assertion-engine port
behavior (registered vs missing, engine-owned opaque compile payload passed directly to
evaluate); same-id/same-log collision and same-id/different-log pass; ADR-0009 negation and
`repo` matching against an explicit target-resolution log distinct from record source logs;
semantic-array order preservation; routing-trigger, exact
decider/CODEOWNERS/catalog owner order, team-ambiguity barrier, `unresolved`, and non-escalated
`not-required` routing; non-proposal input rejection; CLI exit codes `0 / 1 / 2`;
rubric-rule-id mapping with **no duplicates**; and the
`clean-clone-builds` + dependency-graph gates extended to the evaluator. **No live external
service, model, network, clock, or filesystem read enters any test's evaluator path.**

**Target Platform**: Portable Node `>=22` library + CLI subcommand; runs in a clean clone,
air-gapped, model-free (US3).

**Project Type**: Bun-workspace monorepo — adds a first-party **`packages/evaluator/`**
surface package and an **`adr evaluate`** subcommand to `@adrkit/cli`; reuses `@adrkit/core`
parser / schema validator / corpus invariants / graph builder / `affects` primitives.

**Performance Goals**: Deterministic; linear in `records × matchers × targets` and in the
size of the supplied assertion / identity snapshots. No model call, so cost is effectively
zero and dominated by snapshot size, not token spend (ADR-0005 short-circuit).

**Constraints**: Purity is a CI-asserted contract (extends ADR-0009 `resolution-is-pure` /
Principle IV to the evaluator — no clock, network, or fs traversal in the library);
`clean-clone-builds` stays green with the evaluator present and needs no credential /
service / network (Principle II); the dependency-graph gate (`core-has-no-adapter-deps`,
extended) asserts the evaluator imports **no** adapter / model / toolkit dependency
(Principle III; ADR-0007); the returned `evaluationPatch` validates against the **current**
schema with **no** edit (Principle V; C6); byte-for-byte reproducibility apart from
caller-supplied run metadata (FR-005).

**Bun-version note**: use pinned stable Bun **1.3.14** for every `bun install` so `bun.lock`
stays lockfileVersion 1.

## Constitution Check (pre-design gate)

*GATE: evaluated **before** Phase 1 design below. No violations — Complexity Tracking is
intentionally empty. The T018 outcome gate above is an **outcome-ladder precondition on
implementation**, not a Principle I–V design violation.*

| Principle | Pre-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS (planned) — Pass 0 reads caller-supplied snapshots and **returns** a report + patch; it writes / mutates **no** record, acceptance state, or `review` field and touches **no** database. Any later persistence of the `evaluationPatch` is a separate caller PR (FR-009/FR-014; ADR-0004; C6). |
| **II. Clean clone builds green** | PASS (planned) — the library is pure and model-free; the engine libraries (R1) will be vetted, deterministic, network-free, credential-free public packages, or the engines stay port-injected and inert. `clean-clone-builds` must stay green with the evaluator present, no secret / service / network (FR-006; SC-006/SC-012). |
| **III. Core depends on no adapter** | PASS (planned) — `@adrkit/evaluator` is a first-party **surface** package under `packages/evaluator/` (peer of `@adrkit/cli`), **not** `packages/adapters/*` and **not** core. It imports `@adrkit/core` + vetted deterministic libs only, never an adapter or a model client; the dependency-graph gate is extended to assert this (FR-001/FR-006; ADR-0007; A7). |
| **IV. Deterministic before probabilistic** | PASS (planned) — Pass 0 **is** the deterministic pass; it runs first, uses **no** model / prompt / embedding / retrieval / rubric-scoring / adversarial step, and **routes, never approves** (FR-001/FR-003; Principle IV; ADR-0005; C9). Missing backing ⇒ explicit inert, never a fabricated pass/fail (FR-007; ADR-0009). |
| **V. The schema is the contract** | PASS (planned) — **no** schema change. The returned `evaluationPatch` stays within the committed `Evaluation` shape (violations only) and uses only existing `EscalationReason` enum values; richer runtime detail rides the separate `Pass0Report` channel, and any contract limitation is surfaced, **never** a silent field extension (FR-008/FR-009/FR-012; C1/C6; Principle V). |

**Result**: PASS. Two known schema/contract *limitations* are surfaced as **gated
implementation decisions** ([research.md §R8](./research.md)), **not** schema edits: the
current `DeterministicFinding` cannot carry evidence/ref fields (so that detail stays on the
`Pass0Report`), and the current `Assertion` schema does not enforce exactly one expression
source (so "exactly one source declaration" is enforced by the evaluator at compile time, not
by a schema change). Surfacing them here is the Principle V behavior, not a violation of it.

## Project Structure

### Documentation (this feature)

```text
specs/005-deterministic-evaluator/
├── spec.md                         # Feature spec (binding; incl. Clarifications C1–C11)
├── plan.md                         # This file
├── research.md                     # R0 cleared outcome gate + R1–R12 decisions & rejected alternatives
├── data-model.md                   # Input bundle, ports, RuleResult, Pass0Report, evaluationPatch shapes
├── quickstart.md                   # Offline fixture invocation; what "green" means; gate evidence
├── contracts/
│   └── pass-0-evaluation.md        # Library + CLI I/O, rule semantics, reason codes, ordering, routing, patch, exits
├── checklists/
│   └── requirements.md             # Spec quality checklist (done)
└── tasks.md                        # T001/T002 gates cleared; dependency-ordered implementation
```

### Source Code (repository root — extends merged Phase 0/1/2/3)

```text
packages/evaluator/                 # NEW first-party surface package @adrkit/evaluator (peer of cli/ci)
├── package.json                    # deps: @adrkit/core workspace:* + vetted deterministic engine libs (GATED, R1)
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts                    # public exports: evaluatePass0(), types, engine/target/identity port interfaces
│   ├── pass0.ts                    # PURE orchestrator: Pass0Input → evaluated {report,patch} | typed input-error
│   ├── rules/                      # one module per rubric rule, keyed by rubric rule id (FR-002/FR-010)
│   │   ├── schema-valid.ts         #   reuses core parse/contract findings; short-circuit → 10× not-evaluated (C11)
│   │   ├── id-unique.ts            #   reuses core `unique-id` finding over the corpus snapshot
│   │   ├── supersession-consistent.ts  # NEW reciprocity + cycle detection (buildAdrGraph gives EDGES only — R3)
│   │   ├── no-orphan-refs.ts       #   reuses `dangling-supersedes`/`dangling-relatesTo`; federated ref w/o log = inert (C2)
│   │   ├── affects-resolvable.ts   #   TargetResolutionRegistry (NOT diff resolveAffects) — R4; backing/resolver absent = inert (C3)
│   │   ├── affects-overlap.ts      #   finite canonical target-id intersection vs accepted ADRs, once per pair (R4)
│   │   ├── scope-hierarchy.ts      #   base/proposed contradiction evidence vs accepted org assertion — R5
│   │   ├── assertions-compile.ts   #   one-source-declaration enforcement + engine-registry compile — R6/R7
│   │   ├── assertions-pass.ts      #   engine-registry evaluate; not-evaluated if compile failed (C11)
│   │   ├── decider-resolvable.ts   #   identity snapshot; zero/ambiguous → warn — R9
│   │   └── expiry-sane.ts          #   caller `evaluationDate`, strict future; NO clock read
│   ├── targets/                    # TargetResolutionRegistry, TargetResolverPort, canonical target-id normalization (R4)
│   ├── assertions/                 # generic typed registry/ports; opaque immutable compile payload passed directly to evaluate (R6/R7)
│   ├── identity/                   # identity-directory snapshot model + named-human resolution (R9/C7)
│   ├── routing/                    # escalation-trigger evaluation (C4) + route-target resolution/unresolved (C7) — R10
│   ├── report/                     # Pass0Report assembly, total ordering, canonical serialization, reason-code catalog (R11)
│   └── patch/                      # evaluationPatch projection (violations-only, schema-compatible) (R12)
└── test/
    └── fixtures/                   # offline input bundles: per-rule pass/fail/inert; ordering; overlap; routing; patch

packages/cli/src/
└── index.ts                        # add `evaluate` to dispatch: adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [--json]
                                    #   IMPURE boundary: builds LintCorpusResult + proposal identity from disk/git, loads snapshot bundle,
                                    #   rejects schema-valid non-proposal status, calls @adrkit/evaluator, prints Pass0Report / evaluationPatch;
                                    #   NO --write. Exit 0/1/2 per FR-013.

scripts/check-deps.ts               # extend allow-list: @adrkit/evaluator may depend on @adrkit/core + vetted engine libs (R1) only;
                                    #   assert no adapter/model/toolkit dependency ever reaches it (extends core-has-no-adapter-deps)
.github/workflows/ci.yml            # add evaluator to the clean-clone + dependency-graph + purity gates; no schema change (schema-emit stays clean)
```

**Structure Decision**: the **pure Pass 0 library lives in `@adrkit/evaluator`**
(`packages/evaluator/`, a first-party surface peer of `@adrkit/cli` — the placement
ADR-0005 already anticipates with `affects: packages/evaluator/**`). It takes only
**immutable caller inputs** and performs no I/O. All impurity — reading the proposal file,
building the full `lintCorpus` result, deriving the proposal's identity in that result,
loading the caller's snapshot bundle, resolving `evaluationDate` — lives in the thin
**`adr evaluate`** subcommand on `@adrkit/cli`, the **composition boundary**. The CLI
depends on the evaluator and core; the evaluator depends on core and remains independent of
both CLI and CI. The engine, target, and identity ports are **caller-supplied interfaces** so
the deterministic technology choices (R1) are replaceable without touching the rule logic.
The dependency direction is `@adrkit/cli` → `@adrkit/evaluator` → `@adrkit/core`; no reverse
edge exists. `@adrkit/evaluator` sits inside the Principle III isolation boundary exactly as
`@adrkit/cli` and `@adrkit/ci` do: a consumer surface with its own vetted public deps, never
an adapter and never core.

## Constitution Check (post-design re-check)

*GATE: re-evaluated **after** the Phase 1 design (data-model, contract, research decisions
R1–R12). Still no violations; Complexity Tracking remains empty.*

| Principle | Post-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS — the designed `Pass0Report` + `evaluationPatch` are **returned values**; the contract ([contracts/pass-0-evaluation.md](./contracts/pass-0-evaluation.md)) has **no** write path, no DB, no index, and the CLI has **no `--write`**. Persistence is explicitly a later caller PR (C6; FR-014). Confirmed by the no-mutation / input-immutability test tasks. |
| **II. Clean clone builds green** | PASS — the data-model routes every external need (engines, target inventories, identity, scope evidence, date) through **caller-supplied immutable snapshots/ports**; a missing one is **inert**, never a build/credential/network requirement. The R1 engine decision is explicitly constrained to vetted deterministic offline libraries **or** a caller-supplied compiled-policy snapshot — never a service or shell-out. `clean-clone-builds` stays green (SC-006). |
| **III. Core depends on no adapter** | PASS — the package boundary (`packages/evaluator/`, deps `@adrkit/core` + vetted libs) and the extended `check-deps` allow-list keep any adapter / model / toolkit dependency out of the evaluator, core, schema, and CLI. Ports invert the dependency so no engine/catalog integration is imported (FR-001/FR-006; ADR-0007). |
| **IV. Deterministic before probabilistic** | PASS — every designed rule is a deterministic function of its snapshot inputs with a **total, stable ordering** and **canonical serialization** (R11); escalation is a **declarative OR over proven triggers** (C4/R10) evaluated *after* the eleven rules, not a twelfth rule; no model precedes or enters Pass 0 (FR-011/FR-012). Inert/degraded is explicit (FR-007; C3/C5). |
| **V. The schema is the contract** | PASS — the `evaluationPatch` projection (R12) emits only `{ rule, severity, message?, adr? }` violations + `escalate` + existing `escalationReasons`, validated against the committed schema by a test task; the two contract limitations (finding evidence fields; one-source-declaration) are handled **off-schema** (report channel; evaluator-enforced compile check) and recorded as gated decisions (R8), never as a silent field extension. `schema:emit` stays byte-clean. |

**Result**: PASS (pre- and post-design). The design introduces no new record field,
severity, escalation reason, or evaluation shape, and no persistence or model path.

## Complexity Tracking

*No constitution violations — this table is intentionally empty.* The only precondition on
implementation is the **outcome-ladder T018 gate** (spec SC-013; [research.md
§R0](./research.md)), which is tracked as the hard blocking gate in `tasks.md`, not as a
Principle I–V deviation. The two schema/contract limitations are gated implementation
decisions in [research.md §R8](./research.md), resolved **without** a schema change, so they
require no complexity-tracking justification.
