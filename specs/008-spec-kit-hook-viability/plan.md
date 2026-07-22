# Implementation Plan: Spec Kit Hook Compatibility Viability Spike

**Feature directory**: `008-spec-kit-hook-viability` | **Implementation branch**:
Not yet assigned — governance gates are satisfied, and spike execution is authorized once
this migration merges. This plan was authored on
`mbeacom-plan-spec-008-hook-viability`, itself a scoping-only worktree; the
plan's existence does not open an implementation branch. | **Date**:
2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-spec-kit-hook-viability/spec.md`
(banner + Ratification Record, User Stories 1–5, Functional Requirements
FR-001–FR-024, Success Criteria SC-001–SC-008, Assumptions A1–A11, Output
Recommendation section).

**Normative sources** (ADRs win on conflict):
[ADR-0003](../../docs/adr/0003-ship-as-spec-kit-extension.md) (extension-plus-CLI
distribution strategy; this spike is the pre-scoping evidence for action item 1,
"Spike the extension hooks against current Spec Kit"),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md)
(adapter isolation; clean-clone, credential-free, network-free build and
runtime — the properties this spike's own evidence-gathering must itself
satisfy, not only the future adapter),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun for development,
Node-targeted published `@adrkit/cli` artifact — the binary this spike invokes
as a subprocess),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(phase landing on rungs 1–2; external / community validation (ADR-0014 rung 3) as an optional
later maturity signal), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–III (v1.0.2; git is truth, clean clone builds green with no
post-install network/credentials/services, core and CLI depend on no
adapter).

**Upstream target** (frozen, re-verify before execution, never reselect):
Spec Kit release `v0.13.0`, commit
[`9a30db484b0876cb7e5a391cf735d59bd968e985`](https://github.com/github/spec-kit/tree/9a30db484b0876cb7e5a391cf735d59bd968e985)
in `github/spec-kit` (annotated tag object `7c95192e6b1a164f5294cc9f2e3851b28d3ba171`).
This plan's own research and contracts were written against upstream source
at that exact commit — cited inline by immutable
`raw.githubusercontent.com/github/spec-kit/9a30db4.../...` and
`github.com/github/spec-kit/tree/9a30db4.../...` URLs, never `main` — per
[research.md](./research.md) R1.

> ✅ **Governance gates satisfied — spike execution authorized once this migration merges; tasks below remain unchecked until executed.**
> Reconciled with `spec.md`'s banner under
> [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md).
>
> 1. **Phase 6 gate — SATISFIED.** Phase 6 (`specs/007-arb-queue/`) is **landed /
>    reference-verified** on ADR-0014 rungs 1–2, not externally validated. The evidence is
>    the maintainer-owned isolated reference repository `mbeacom/adrkit-t018-dogfood`, recorded
>    for Phase 6 in `specs/007-arb-queue/checklists/reference-verification-evidence.md`.
>    `specs/007-arb-queue/tasks.md` **T048-R** and dependent **T049** now read `- [X]`, and
>    root `plan.md`'s Spec-kit realization table row for `specs/007-arb-queue/` reads
>    `landed / reference-verified`. *Disambiguation:* an unrelated, already-completed
>    `T048`/`T049` pair exists in `specs/005-deterministic-evaluator/tasks.md` — not this gate.
> 2. **This spike's own precondition — SATISFIED 2026-07-21.** Maintainer ratification of this
>    spec's exact scope, per the Ratification Record in `spec.md`.
>
> **This plan still describes design/scoping only.** Per the `/speckit.plan` command contract
> itself ("Command ends after Phase 1 design... Report branch, IMPL_PLAN path, and generated
> artifacts"), this planning session performed no implementation, commit, push, or PR. Phase 2
> task generation later produced `specs/008-spec-kit-hook-viability/tasks.md` under root
> `plan.md`'s "Advance **scoping** (spec → plan → tasks) of the next phase is explicitly
> permitted" note. That tasks file remains a dependency-ordered checklist for a future
> execution session; its first phase still mechanically verifies T001–T003 before scratch work
> begins. After this migration merges, a future execution session rerunning those checks should
> obtain `GATE_PASS = true`, but every 008 task remains unchecked until it is actually executed.

> ✅ **Status update — Executed 2026-07-22, out-of-contract on one blocking gate.** The
> banner above accurately describes this planning session's own scope (design/scoping
> only, no execution performed by it) and is retained as the historical record. A later
> execution session has since run the tasks file and recorded verdict **`no-go`**
> (mutation trigger) — but per PR review round 12, T012's own blocking-checkpoint rule
> could not be genuinely satisfied (T005's gap), so this is disclosed as an
> **out-of-contract execution**, not an unqualified "end-to-end" one. See
> [`tasks.md`](./tasks.md)'s executed-summary banner and
> [`checklists/evidence-index.md`](./checklists/evidence-index.md) for the authoritative,
> current status, including two explicit task exceptions (T005, T012) left unchecked per
> PR review.

## Summary

Design, on paper only, the disposable compatibility fixture and its evidence
protocol that ADR-0003's action item 1 requires before any production
`packages/adapters/spec-kit` package is scoped. The fixture is a minimal,
manifest-v1 Spec Kit extension — exactly one namespaced, read-only command and
exactly one optional `after_plan` hook — that, when it does eventually run,
proves or disproves five falsifiable claims: (1) a frozen-version local `--dev`
install registers cleanly; (2) a real, live `/speckit.plan` run fires the
`after_plan` hook with genuine plan context and the hook's command invokes
adrkit's own built, offline Node CLI as a subprocess with zero mutation; (3)
disable/remove behave exactly as documented and rendering is provably correct
for GitHub Copilot (live) and structurally correct for one more upstream agent;
(4) both a missing-plan-context probe and a missing-built-CLI probe fail
loudly and specifically, never silently; (5) the collected evidence maps to
exactly one of three exhaustive, mutually exclusive verdicts.

This plan produces the design artifacts a future, authorized execution
session will follow verbatim: the fixture's exact manifest and command file
content (`data-model.md`, `contracts/fixture-surface.md`), the scratch
workspace and evidence-capture procedure (`research.md`,
`contracts/isolation-and-offline.md`), the transcript/evidence-bundle schema
and verdict decision procedure (`contracts/evidence-bundle-and-verdict.md`),
and a step-by-step validation walkthrough (`quickstart.md`) that is explicitly
marked **authorized once this migration merges**. It produces zero code, zero fixture files on
disk outside this planning session's design docs, and zero adapter package.

## Technical Context

**Language/Version**: The fixture's one command file is Markdown with YAML
frontmatter (upstream's command file format); its one shell helper (if any) is
POSIX `sh`, matching this repository's own `.specify/init-options.json`
(`"script": "sh"`). The fixture never contains TypeScript, is never built by
`bun run build`, and is never added to any workspace in `package.json`.

**Primary Dependencies**: `specify-cli` v0.13.0 (already installed in the
verification environment per spec.md A2 — this planning session does not
install it, only designs the re-verification and install steps a future
execution session runs). adrkit's own already-shipped, already-built
`packages/cli/dist/index.js` (does not yet exist on disk as of this planning
session — see FR-016/A2; `bun run build` from the repository root, filtered to
`@adrkit/cli`, is the documented way to produce it, per `packages/cli/package.json`
`build` script). No new runtime or dev dependency is added to any `@adrkit/*`
package by this plan — the fixture is not a workspace package (Assumption A3;
research.md R8).

**Storage**: None. The fixture is read-only by FR-003/FR-011. The evidence
bundle (once gathered) is scratch-only files under a session-scoped scratch
location — never a database, never a tracked repository file (research.md R4).
If a later execution result is landed in tracked history, FR-024 requires a
tracked, sanitized evidence index with commit SHAs, workflow-run links if any
workflow is used, content hashes, tool versions, network/credential limits,
negative-test results, and a reviewer verdict; raw transcripts stay scratch-only.

**Testing**: This spike has no `bun test` suite of its own — it is not a
package. "Testing" here means the acceptance-scenario evidence protocol in
`quickstart.md` and the fixed exit-code/message contracts in
`contracts/fixture-surface.md`. Verification of *this planning artifact set*
itself is a fresh-context adversarial reader test (per the doc-coauthoring
reader-test pattern), documented in this plan's Constitution Check notes and
reported to the coordinating session — not a CI job, since nothing here is
merged to `main`.

**Target Platform**: The execution environment available for this spike is
whatever platform this planning session's own host is (macOS/Darwin, per this
session's `<environment_context>`) — cross-platform (Windows path/line-ending)
rendering is explicitly out of scope (Assumption A9).

**Project Type**: Not a workspace feature. The fixture lives entirely outside
`packages/`, on a disposable scratch worktree/directory (FR-017; research.md
R3) — it is never a `packages/adapters/spec-kit` package, never registered in
root `package.json` `workspaces`, and never subject to `core-has-no-adapter-deps`
or `clean-clone-builds` because it never enters the tracked tree those gates
inspect.

**Constraints**: No network access beyond the one-time `specify-cli` tool
install that already predates this spike (FR-001/A2). No credentials at any
step (Principle II). Zero mutation of `docs/adr/**`, the schema, or any other
tracked file at any point in fixture execution (FR-012/FR-020). The fixture's
one command MUST invoke adrkit's built CLI only as a subprocess, never by
re-implementing corpus reading (FR-011). Every invocation is bracketed by a
`git status --porcelain` capture (FR-012). All spike execution stays on a
scratch branch/worktree outside the committed `specs/` tree (FR-017/A8).

**Scale/Scope**: Single fixture, single command, single hook, single
verification environment, one live agent (GitHub Copilot) plus one
structurally-verified agent (Claude Code by default, Gemini CLI as the named
fallback — Assumption A6). No catalog submission, no multi-repo scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design
below. Both checks additionally verify the two properties specific to this
feature: (a) this plan produces no shipping artifact, and (b) the satisfied governance gates
from `spec.md`'s banner are recorded without overstating external / community validation.*

### Pre-Design Check (initial)

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Git Is the Source of Truth** | ✅ PASS | This plan and its companion artifacts are the only things committed by this planning session, and only to this scoping branch. The fixture itself, once it exists in a future execution session, is explicitly barred from `main` and from the committed `specs/` tree (FR-017). No decision content (`docs/adr/**`) is read, written, or proposed for change by this plan (FR-020). |
| **II. Clean Clone Builds Green** | ✅ PASS | This plan adds no dependency, no workspace package, no build step, and no CI job. The fixture's future execution is designed to need only the network access already spent on the one-time `specify-cli` install (FR-001); every other step — install `--dev`, hook fire, disable, remove, both failure probes — is designed to run fully offline with no credentials (FR-011; `contracts/isolation-and-offline.md`). |
| **III. Core Depends on No Adapter** | ✅ PASS | The fixture is not a package under `packages/adapters/*` and is never installed into this repository's workspace. `@adrkit/core`, `@adrkit/cli`, and the schema are untouched by this plan — the fixture calls the *built* `@adrkit/cli` artifact only as an external subprocess, the same way any third-party shell script could, which is precisely the arm's-length relationship ADR-0007 requires of an adapter. |
| **IV. Deterministic Before Probabilistic** | ✅ PASS | The fixture's command is designed to be a deterministic subprocess wrapper (`contracts/fixture-surface.md`); it makes no model call. The evidence-to-verdict mapping in `contracts/evidence-bundle-and-verdict.md` is a fixed, exhaustive, mutually-exclusive decision table (SC-007) — not a probabilistic judgment. |
| **V. The Schema Is the Contract** | ✅ PASS | This plan proposes no change to `AdrFrontmatter`, `schema/adr.schema.json`, or `bun run schema:emit` (FR-020). The fixture's manifest is a *different*, upstream-owned schema (Spec Kit's manifest v1.0) that this plan documents but does not extend or fork (`contracts/upstream-target.md`). |

No violations. Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-spec-kit-hook-viability/
├── spec.md                          # Ratified; satisfied governance-gates banner + Ratification Record
├── checklists/
│   └── requirements.md              # Passed; reader-tested
├── plan.md                          # This file — Phase 0/1 only, stops before tasks.md
├── research.md                      # Phase 0 output — R1–R13, all decisions resolved
├── data-model.md                    # Phase 1 output — evidence/verdict entities (not production data)
├── quickstart.md                    # Phase 1 output — authorized-on-merge execution/validation guide
├── contracts/
│   ├── upstream-target.md           # Manifest-v1 fixture shape; immutable v0.13.0 target; fail-closed mismatch
│   ├── fixture-surface.md           # The one command + one optional after_plan hook; absent-context/absent-binary contracts
│   ├── isolation-and-offline.md     # Scratch-worktree isolation, no-mutation boundary, offline subprocess + network-denial hierarchy
│   ├── lifecycle-evidence.md        # install/list/disable/remove transcript + file-registration evidence contract
│   ├── agent-verification.md        # Copilot live vs. second-agent structural verification split
│   └── evidence-bundle-and-verdict.md  # Evidence bundle schema; go/manual-command-only/no-go decision procedure; non-binding recommendation
└── tasks.md                         # Phase 2 output, generated 2026-07-21 by a follow-up advance-scoping
                                      # session (root plan.md's "spec → plan → tasks" scoping exemption) — a
                                      # dependency-ordered checklist for a FUTURE execution session. Does
                                      # not itself execute anything; its first-phase gate-check tasks now
                                      # should compute GATE_PASS=true once this migration merges.
```

**`tasks.md` exists as of 2026-07-21**, generated in a follow-up
advance-scoping session per root `plan.md`'s explicit "spec → plan → tasks"
scoping exemption — task *generation* is scoping, not execution, so it did not
need execution authorization. Every task in it is transitively gated by that file's
own Phase 1 gate-check tasks, which re-verify `specs/007-arb-queue/tasks.md`
T048-R/T049 and root `plan.md`'s Phase 6 row before authorizing any later task.
Those checks should now pass once this migration merges; this plan's own Completion Report
below is updated accordingly.

### Source Code (repository root)

**None.** This feature adds no file under `packages/`, no change to root
`package.json` `workspaces`, and no CI workflow. The fixture's eventual
existence (a future execution session's concern, not this plan's) is
explicitly designed to live outside the tracked tree entirely — see
`research.md` R3 for the exact scratch location and `contracts/isolation-and-offline.md`
for the boundary it may never cross. This absence is itself Constitution
Check evidence for Principles II and III above: there is nothing here for
`clean-clone-builds` or `core-has-no-adapter-deps` to even inspect.

**Structure Decision**: Design-only artifacts under `specs/008-spec-kit-hook-viability/`;
zero source tree changes. See `research.md` R1–R3 for full rationale.

## Phase 0: Research

Research artifacts are in [research.md](./research.md). All open
implementation-planning decisions this task required are resolved without
broadening scope. Summary of binding decisions:

- **R1 Upstream citation discipline**: every upstream claim in this plan and
  its contracts cites an immutable `raw.githubusercontent.com/github/spec-kit/9a30db4.../...`
  or `github.com/github/spec-kit/tree/9a30db4.../...` URL fetched during this
  planning session, never `main`, never a paraphrase from general knowledge.
- **R2 Fixture identity and wrapped command**: throwaway id `adrkit-spike`
  (Assumption A3); the fixture's one command wraps existing, already-shipped
  `adr queue --format json` (Assumption A4) — chosen over `adr explain` because
  it needs no positional record path argument and targets this repository's explicit
  `--dir docs/adr`; it exits 0 when that corpus is reachable and free of error findings,
  and its JSON output is a clean, bounded artifact to embed in evidence.
- **R3 Scratch artifact locations**: session-scoped scratch only, enumerated exactly;
  never committed; never inside the tracked `specs/` tree (FR-017/A8).
- **R4 Evidence bundle filenames and format**: one Markdown report plus one
  JSON manifest, both scratch-only; exact filenames and a canonical structure.
- **R5 Command/environment capture method**: `script`/shell transcript
  capture plus explicit `env -i` allowlisting for the subprocess call.
- **R6 Secret scrubbing**: allowlist-based environment capture (never a
  denylist) plus a mechanical grep pass over the transcript before it is
  reported.
- **R7 Mutation baselines**: `git status --porcelain=v1` plus a scoped
  `git diff --stat -- docs/adr` taken immediately before/after every
  invocation (FR-012).
- **R8 Network denial mechanism hierarchy**: ranked, honest-limitations list
  from OS-level block down to allowlisted-env + static-call-site review, per
  the Edge Cases note in spec.md.
- **R9 Upstream install/list/disable/remove lifecycle commands**: verbatim
  from `EXTENSION-API-REFERENCE.md`/`EXTENSION-USER-GUIDE.md`/
  `EXTENSION-DEVELOPMENT-GUIDE.md` at the frozen commit; no invention.
- **R10 Cleanup and recovery after failure**: idempotent teardown order and
  what "recovery" means for each of the two failure-mode probes (FR-015/FR-016).
- **R11 Constitution alignment**: all five principles PASS; see Constitution
  Check above and after Phase 1 below.
- **R12 Status drift check**: originally captured the planning-session starting state; this
  migration updates the governance state so Phase 6 (`specs/007-arb-queue/`) is now landed /
  reference-verified (not externally validated) per root `plan.md` and ADR-0014, while
  leaving the `packages/cli/dist` starting-condition note unchanged.

## Phase 1: Design Artifacts

All Phase 1 artifacts are generated:

- **[data-model.md](./data-model.md)**: Entity definitions for
  `FrozenUpstreamReference`, `CompatibilityFixture`, `EvidenceBundle` (with its
  seven required contents from FR-018), `Verdict` (the three-way enum and its
  precedence rule), plus the supporting `ScratchWorkspace`,
  `NetworkDenialRecord`, and `MutationBaseline` entities the evidence protocol
  needs. Explicitly evidence/verdict schema — never production ADR data, never
  a schema change to `AdrFrontmatter`.
- **[contracts/upstream-target.md](./contracts/upstream-target.md)**: The
  manifest-v1 fixture shape (fields, patterns, required/optional) exactly as
  documented upstream at the frozen commit, the immutable `v0.13.0` /
  `9a30db4...` compatibility target, and the fail-closed re-verification
  procedure if the tag/commit/version triple ever mismatches.
- **[contracts/fixture-surface.md](./contracts/fixture-surface.md)**: The
  exact one namespaced read-only command and exact one optional `after_plan`
  hook declaration, the command file's frontmatter and body shape, and the two
  honest-failure contracts (absent context, absent built CLI).
- **[contracts/isolation-and-offline.md](./contracts/isolation-and-offline.md)**:
  The scratch-worktree/project isolation boundary, the no-mutation boundary
  and its evidence capture, the offline/no-credential built-`adr`-subprocess
  boundary, and the network-denial mechanism hierarchy with honest
  limitations.
- **[contracts/lifecycle-evidence.md](./contracts/lifecycle-evidence.md)**:
  The install/list/disable/remove transcript and file-registration evidence
  contract — exactly what must be captured and what "clean" means at each
  lifecycle step.
- **[contracts/agent-verification.md](./contracts/agent-verification.md)**:
  The two-tier Copilot-live vs. second-agent-structural verification split,
  naming the exact rendered paths for each.
- **[contracts/evidence-bundle-and-verdict.md](./contracts/evidence-bundle-and-verdict.md)**:
  The complete evidence bundle schema, the exact `go` /
  `manual-command-only` / `no-go` decision procedure with its fixed
  precedence order, and the non-binding "smallest later production slice"
  recommendation template with the explicitly unresolved release-vehicle
  decision it must never make.
- **[quickstart.md](./quickstart.md)**: A future-gated, step-by-step
  validation walkthrough mapping directly to User Stories 1–5 and Success
  Criteria SC-001–SC-008, marked **authorized once this migration merges**, for whichever session eventually executes
  this spike.

## Constitution Check (Post-Design)

| Principle | Final Status | Notes |
|-----------|-------------|-------|
| **I** | ✅ PASS | The complete design artifact set adds zero tracked files under `docs/adr/**`, proposes zero schema change, and opens zero implementation branch. The satisfied governance gates from `spec.md`'s banner are restated in this plan's own banner without claiming external / community validation. |
| **II** | ✅ PASS | No dependency, build step, or CI job was added anywhere in the repository by this planning session. The designed execution protocol (`contracts/isolation-and-offline.md`) requires no network beyond the pre-existing `specify-cli` install and no credentials at any step. |
| **III** | ✅ PASS | No file was added under `packages/adapters/*` or any other package. The fixture design in `contracts/fixture-surface.md` treats adrkit's built CLI strictly as an external subprocess boundary — the arm's-length relationship ADR-0007 requires — never as an in-process import. |
| **IV** | ✅ PASS | `contracts/evidence-bundle-and-verdict.md`'s verdict procedure is a fixed decision table, checked in a stated order, with no probabilistic or model-assisted step. The fixture's designed command is a deterministic subprocess wrapper. |
| **V** | ✅ PASS | No change to `AdrFrontmatter`, `schema/adr.schema.json`, or the `schema-emit-matches` gate. `data-model.md`'s entities are this spike's own evidence/verdict shapes, versioned and scoped only to this feature directory — not a superset, extension, or fork of the ADR schema. |

## Complexity Tracking

> No Constitution Check violations. This table is intentionally empty.

## Reader Test

A fresh-context, adversarial reader test of this complete planning set
(`plan.md`, `research.md`, `data-model.md`, `quickstart.md`, all six
`contracts/*.md` files) against `spec.md`, ADR-0003, ADR-0007, ADR-0010, and
the constitution was performed per the doc-coauthoring reader-test pattern,
using a high-capability model (Opus 4.8 / GPT-5.6 Sol tier, per this session's
model policy) reading cold with no authoring context. Findings and remediation
are recorded at the end of [research.md](./research.md) (§R13 Reader Test).

## Completion Report

**Branch**: `mbeacom-plan-spec-008-hook-viability` (scoping-only; no
implementation branch opened; no commit/push/PR performed by this session).
**IMPL_PLAN path**: `specs/008-spec-kit-hook-viability/plan.md` (this file).
**Generated artifacts**: `research.md`, `data-model.md`, `quickstart.md`,
`contracts/upstream-target.md`, `contracts/fixture-surface.md`,
`contracts/isolation-and-offline.md`, `contracts/lifecycle-evidence.md`,
`contracts/agent-verification.md`, `contracts/evidence-bundle-and-verdict.md`.
**Not generated in this session**: `tasks.md` (this session stopped after
Phase 1, per its own task instruction). **Generated in a follow-up
advance-scoping session, same date (2026-07-21)**:
`specs/008-spec-kit-hook-viability/tasks.md` — a dependency-ordered checklist
for a future execution session, produced under root
`plan.md`'s "spec → plan → tasks" scoping exemption (task generation is
scoping, not execution). That file's own Phase 1 is a mechanical pair of
gate-check tasks (re-verifying `specs/007-arb-queue/tasks.md` T048-R/T049 and
root `plan.md`'s Phase 6 row) that every later task in it is made to depend
on; after this migration merges, those checks should compute `GATE_PASS = true`, but the
tasks remain unchecked until executed. **Constitution status**: all five principles PASS,
before and after design; Complexity Tracking empty. **Governance gate status**: gate 2
(maintainer ratification) satisfied 2026-07-21 per `spec.md`'s Ratification Record; gate 1
(Phase 6 `specs/007-arb-queue/tasks.md` T048-R/T049 and root `plan.md` row) is satisfied with
Phase 6 landed / reference-verified, not externally validated. **This plan did not execute
the spike; execution is authorized once this migration merges.**
