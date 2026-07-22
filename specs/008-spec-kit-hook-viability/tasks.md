---
description: "Dependency-ordered task list for the Spec Kit Hook Compatibility Viability Spike"
---

# Tasks: Spec Kit Hook Compatibility Viability Spike

**Input**: Design documents from `specs/008-spec-kit-hook-viability/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`,
`contracts/upstream-target.md`, `contracts/fixture-surface.md`,
`contracts/isolation-and-offline.md`, `contracts/lifecycle-evidence.md`,
`contracts/agent-verification.md`, `contracts/evidence-bundle-and-verdict.md`

**Normative**: `docs/adr/0003` (extension-plus-CLI distribution; this spike is the
pre-scoping evidence for its action item 1), `docs/adr/0007` (adapter isolation;
clean-clone, credential-free, network-free), `docs/adr/0010` (Bun for development,
Node-targeted published `@adrkit/cli` artifact this spike invokes as a subprocess),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(phase landing on rungs 1–2; external / community validation (ADR-0014 rung 3) as an optional
later maturity signal), `.specify/memory/constitution.md` Principles I–III

**Generated**: 2026-07-21, as a follow-up advance-scoping session to
`specs/008-spec-kit-hook-viability/plan.md` (same date), under root `plan.md`'s
explicit "Advance **scoping** (spec → plan → tasks) of the next phase is explicitly
permitted" exemption — generating this checklist is scoping, not execution. Phase 6 is now
landed / reference-verified under ADR-0014 rungs 1–2, and maintainer ratification is already
satisfied; spike execution is authorized once this migration merges.

> ✅ **Executed 2026-07-22.** T001–T058 below are complete (`- [X]`), **with one explicit
> exception: T005 is left unchecked (`- [ ]`)** — see below and T005's own note. T044,
> T045, and T047 are marked complete as **correctly recognized and honored
> short-circuits** per the `no-go` outcome's own contract-required rules (T043 matched at
> Step 1, so T044/T045 were not evaluated and T047 does not apply — see each task's own
> note). Verdict: **`no-go`** (trigger: `mutation`, driven independently by the `install`
> and `remove` mutation baselines). Independently audited (fresh-context, `gpt-5.6-sol`,
> six cumulative audit rounds converging to a final PASS on evidence-bundle integrity —
> see T057). The tracked, sanitized FR-024 evidence index is
> [`checklists/evidence-index.md`](./checklists/evidence-index.md). Raw transcripts and the
> full evidence bundle remain session-scoped only, per FR-017. This spike did **not**
> change Phase 6's landed/reference-verified status in any direction, and does **not**
> claim external/community validation for either Phase 6 or itself.
>
> **T005 exception (discovered via PR #35 review, after all six audit rounds above):**
> T005's own selection of the network-denial mechanism did not detect this host's
> genuinely-available rank-1 mechanism (`sandbox-exec`), so rank 3 gated the recorded
> `install`/`hook-fire`/probe invocations instead of the strongest available option, per
> `contracts/isolation-and-offline.md` §4's "strongest available mechanism" requirement.
> Per direct reviewer feedback, this is **not** papered over with qualifying prose while
> leaving the box checked: **T005 is marked incomplete (`- [ ]`)**, honestly reflecting
> that its own conformance bar was not met. This is a partial-conformance execution for
> that one task only — it is **not** a claim that the gated invocations themselves didn't
> happen or weren't evidenced (they did, and are fully recorded; see T005's own note and
> `checklists/evidence-index.md`'s Limitations section for the full account). It was
> **not** remediated by re-running the full live-Copilot lifecycle under the stronger
> mechanism: that rerun was judged disproportionate given the `no-go` verdict is driven
> independently by the mutation baseline (an orthogonal axis, unaffected by which
> network-denial rank gated these invocations), and would require a second full isolated
> live-Copilot session. T057's own audit did not independently catch this gap either — see
> T057's own note — but its remaining checks (a)–(f) all still hold and its `[X]` marking
> is unaffected by T005's exception.
>
> **PR review round 6 clarifications (no further checkbox changes):** a later review
> round asked whether T012 (Foundational checkpoint, whose header names T005 among its
> dependencies) and T033 (Tier-2 `specify extension add --dev` invocation, whose
> mutation bracket had a task-decomposition gap found in round 4) should also be
> unchecked, and whether T042 (bundle-completeness checkpoint) needed adjustment. All
> three remain `- [X]`: each task's own literally-described action was fully,
> genuinely performed, and the concerns raised are about a dependency's separate
> substantive defect (T012) or a historical evidence-recording gap (T033) or neither
> (T042 — field existence was and remains true) — not about whether the task's own
> defined check was actually done. See T012's, T033's, and T042's own notes below for
> the full reasoning, and `checklists/evidence-index.md`'s Limitations section for the
> tracked, cross-referenced account. Language in T033's and T057's notes that
> previously described the round-4 corroborating entry as "closing" the original
> bracket gap was corrected: it corroborates only and cannot retroactively supply a
> capture that was never taken.

> ✅ **Governance gates satisfied — spike executed 2026-07-22; tasks below are now checked (see the executed-summary callout above).**
>
> 1. **Phase 6 gate — SATISFIED.** Under
>    [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
>    Phase 6 (`specs/007-arb-queue/`) is **landed / reference-verified** on ADR-0014 rungs
>    1–2, not externally validated. `specs/007-arb-queue/tasks.md` **T048-R** and dependent
>    **T049** now read `- [X]`, and root `plan.md`'s Spec-kit realization table row for
>    `specs/007-arb-queue/` reads `landed / reference-verified`. The evidence is the
>    maintainer-owned isolated reference repository `mbeacom/adrkit-t018-dogfood`, recorded
>    for Phase 6 in `specs/007-arb-queue/checklists/reference-verification-evidence.md`.
>    *Disambiguation:* an unrelated, already-completed `T048`/`T049` pair exists in
>    `specs/005-deterministic-evaluator/tasks.md` — that is not this gate.
> 2. **This spike's own precondition — SATISFIED 2026-07-21.** Maintainer ratification of
>    `spec.md`'s exact scope, per its Ratification Record.
>
> **T001–T003 below remain present to make this mechanical rather than advisory.** No task in
> Phase 2 onward may begin — no scratch directory created, no fixture file written, no
> `specify` command run, no evidence file written — until T003 records a `GATE_PASS`
> result. Once this migration merges, a future execution session re-running T001–T003 should
> compute `GATE_PASS = true`; if the source facts drift and T001 or T002 fails, it MUST stop
> at T003 and perform no further task in this file, full stop.

**Tests**: This spike has no `bun test` suite of its own — it is not a workspace
package. "Tests" here are the fixed exit-code/message contracts in
`contracts/fixture-surface.md` §3–§4 (the two honest-failure probes, US4) and the
acceptance-scenario evidence protocol in `quickstart.md`. Where a task below produces a
probe result, its expected values are stated inline and checked against the contract —
the closest analogue this spike has to a RED/GREEN test cycle, applied to spec-driven
requirements (a probe MUST demonstrably fail in the specific documented way, not merely
"not succeed").

**Toolchain**: `specify-cli` v0.13.0 (Python console script, already installed per
spec.md A2) for every lifecycle command; Bun 1.3.14 / `bun run build` in *this*
repository only, to produce `packages/cli/dist/index.js` (the one build step this spike
depends on — it adds no new build step of its own). The fixture itself is Markdown +
YAML frontmatter + POSIX `sh`, never TypeScript, and is never added to any
`package.json` workspace.

**Model policy** (per this session's policy, reproduced for every task below that
dispatches a review/audit): Claude Sonnet 5 is primary for every routine execution,
capture, and recording task in this file. A heavyweight tier (Opus 4.8 or GPT-5.6 Sol)
is used **only** for the two explicitly-marked heavyweight-review tasks (T004's
mismatch-adjudication escalation and T057's independent evidence audit) — **never**
Opus 4.6, for any task in this file.

## Format: `[ID] [P?] [Story?] Description with exact file path`

- **[P]**: Parallelizable — task touches no file/path/evidence-bundle-field another
  incomplete task in the same phase also touches, and depends on no incomplete task in
  the same phase.
- **[US1]–[US5]**: Maps directly to `spec.md`'s five user stories. Gate and Foundational
  phases intentionally omit story labels, matching this project's own tasks-template
  convention (`specs/007-arb-queue/tasks.md` Phase 1/2).
- Every task's file paths are either (a) inside this session's own scratch/session-state
  artifacts directory (never this repository, never tracked — `research.md` R3), or (b)
  a specific, named path inside *this* repository that the task explicitly reads or
  restores, never mutates as a net effect.

## Path Conventions

- `<SCRATCH_ROOT>` — a disposable directory outside any git-tracked clone of
  `mbeacom/adrkit` (`research.md` R3 §1; `contracts/isolation-and-offline.md` §1),
  created fresh by T006. Contains three independent subtrees, never nested inside this
  repository:
  - `<SCRATCH_ROOT>/adrkit-spike-fixture/` — the fixture's own source (US1/Foundational).
  - `<SCRATCH_ROOT>/adrkit-spike-scratch-project/` — the Tier-1 (Copilot) `specify
    init` scratch project (US1–US4).
  - `<SCRATCH_ROOT>/adrkit-spike-second-agent-scratch/` — the Tier-2 (Claude Code /
    Gemini CLI) scratch project (US3 only).
- `<EVIDENCE_DIR>` — the *executing session's own* session-scoped artifacts directory
  (e.g. this environment's `~/.copilot/session-state/<session-id>/files/spike-008/` or
  whatever the equivalent is for the session that eventually runs this file) — never a
  path under this repository's working tree, tracked or not (`research.md` R3 §2).
- `<THIS_REPO>` — this repository's own root (`mbeacom/adrkit`), used only for: (a) the
  one-time `bun run build` (T011), (b) the User Story 2 live `/speckit.plan` run, which
  by construction happens in *this* repository's own Copilot session (US2), (c) the
  `docs/adr/**` mutation-baseline check that FR-012 Acceptance Scenario 4 requires
  against *this* repository specifically (T021/T025), and (d) the User Story 4 Probe B
  rename/restore of `packages/cli/dist` (T038–T041). No task other than these ever
  writes inside `<THIS_REPO>` as a net effect.

---

## Phase 1: Gate Verification (hard block — no story label)

**Purpose**: Mechanically verify both satisfied governance gates from `spec.md`'s banner before any
scratch artifact, install, or evidence-gathering step exists. This phase produces no
scratch file and touches no path outside direct, read-only inspection of files already
tracked in this repository.

**⚠️ CRITICAL**: If T003 does not record `GATE_PASS`, **stop here**. Do not proceed to
Phase 2 or any later phase. Do not create `<SCRATCH_ROOT>` or `<EVIDENCE_DIR>`. Report
the gate failure (which half failed, and its current state) to the coordinating session
and end.

- [X] T001 Verify gate 1 (Phase 6). Read, in this order: (a)
  `specs/007-arb-queue/tasks.md` — confirm the literal checkbox state of **T048-R** (whose
  title reads "T048-R (SC-004) Rung-2 maintainer isolated reference-verification gate") and
  **T049**
  for the Phase 6 reference-verification gate (not the unrelated, already-completed T048/T049
  pair in `specs/005-deterministic-evaluator/tasks.md`); both MUST read `- [X]`
  (checked/complete) for gate 1 to pass — either being `- [ ]` fails this check. (b) root
  `plan.md`'s Spec-kit realization table — confirm the `specs/007-arb-queue/` row's Status
  column reads `landed / reference-verified` (not "implementation in progress" or any other
  in-progress phrasing, and not externally validated). **Output**: a single boolean
  `gate1Pass` plus the verbatim text of both source lines, recorded to
  `<EVIDENCE_DIR>/gate-check.json` (this one file may be created before `<SCRATCH_ROOT>`
  exists, since it is a pure read of already-tracked repository files — no scratch workspace
  is needed to perform this check). **Snapshot after this governance migration**: this check
  PASSES — T048-R/T049 read `- [X]`, and the `plan.md` row reads `landed /
  reference-verified`. A future execution session MUST re-run this exact check itself at
  whatever date it actually executes — this note is a snapshot, not a substitute for
  re-verification.

- [X] T002 Verify gate 2 (maintainer ratification). Read `spec.md`'s Ratification Record
  (the section immediately following the satisfied-governance-gates banner) and confirm it states an
  explicit maintainer ratification dated 2026-07-21 covering: the fixed v0.13.0/SHA
  target, the one-command/one-hook fixture shape, the two-tier agent-verification split,
  the offline/no-mutation evidence requirements, and the three-way verdict precedence.
  **This is a confirmation read, never a new ratification request** — gate 2 is already
  satisfied; this task only checks that the recorded ratification has not been retracted
  or superseded by a later edit to `spec.md`. Record `gate2Pass` (boolean) to
  `<EVIDENCE_DIR>/gate-check.json` alongside T001's fields.

- [X] T003 Gate decision checkpoint. Depends on: T001, T002. Compute
  `GATE_PASS = gate1Pass AND gate2Pass` and write it as the top-level field in
  `<EVIDENCE_DIR>/gate-check.json`. **If `GATE_PASS` is `false`: STOP.** Perform no
  further task in this file. Report to the coordinating/maintainer session exactly which
  gate failed (citing T001/T002's recorded evidence) and end without creating
  `<SCRATCH_ROOT>`, without running any `specify` command, and without writing any file
  under `<EVIDENCE_DIR>` beyond `gate-check.json` itself. **If `GATE_PASS` is `true`:**
  proceed to Phase 2. Every task in Phase 2 onward states "Depends on: T003 (`GATE_PASS`)"
  as a standing precondition, restated once here rather than repeated on every single
  task line.

**Checkpoint**: Gate verification complete. `GATE_PASS` recorded. **All of Phase 2
onward is conditioned on `GATE_PASS = true`; this is not restated per-task below, but
applies to every task T004–T058 without exception.**

---

## Phase 2: Foundational (Blocking Prerequisites for ALL User Stories)

**Purpose**: Re-verify the frozen upstream target, select the network-denial mechanism,
create the three scratch workspaces, initialize the evidence-capture harness, write the
one disposable fixture, and build adrkit's own CLI artifact — every one of User Stories
1–5 depends on this phase's outputs, and none of it is story-specific.

**⚠️ CRITICAL**: No User Story task (Phase 3 onward) may begin until this phase's
checkpoint (T012) passes. Depends on: T003 (`GATE_PASS`).

- [X] T004 Re-verify the frozen upstream target (FR-001; `contracts/upstream-target.md`
  §3). Run, in order: (1) `git ls-remote --tags https://github.com/github/spec-kit
  v0.13.0` (or the equivalent GitHub API call) — compare the resolved commit against
  `9a30db484b0876cb7e5a391cf735d59bd968e985`. (2) `specify --version` — compare against
  exactly `0.13.0`. **Output**: `data-model.md` §1's `FrozenUpstreamReference` record
  (`releaseTag`, `commitSha`, `tagObjectSha`, `reportedCliVersion`, `reverifiedAt` =
  today's actual date, `reverificationOutcome`), written to
  `<EVIDENCE_DIR>/frozen-reference.json`. **Fail-closed rule**: if either check does not
  match exactly, set `reverificationOutcome = "mismatch"`, populate no other field in
  this data model, and **STOP the entire spike** — do not create `<SCRATCH_ROOT>`, do not
  proceed to T005. The correct next action is to return to `spec.md` and require explicit
  maintainer re-ratification against whatever the new tag/commit/version state actually
  is; **never silently substitute the new state and continue, and never select "whatever
  is latest" even if a newer stable release has shipped** — that is the literal reading
  of FR-001/A1's freeze. **Heavyweight escalation**: if `reverificationOutcome =
  "mismatch"`, the halt decision itself (confirming this is a genuine tag/commit/version
  drift and not a transient network/tooling error) is the one place in this file a
  heavyweight-tier model (Opus 4.8 / GPT-5.6 Sol; never Opus 4.6) reviews before the
  maintainer is asked to re-ratify — routine re-verification (the match case) needs no
  such escalation.

- [ ] T005 [P] Select and record the network-denial mechanism (`research.md` R8;
  `contracts/isolation-and-offline.md` §4). Determine which of the three ranked tiers
  is actually available in the execution environment (1: OS-level network namespace/
  firewall; 2: process-level egress blocking; 3: allowlisted-environment + full
  source-level review of the fixture's only external call) and record
  `NetworkDenialRecord` (`data-model.md` §4) — `mechanismUsed`, `limitationsStatement`,
  `appliedToInvocations` (initially empty; populated incrementally as each later
  invocation task runs under it) — to `<EVIDENCE_DIR>/network-denial.json`. If only tier
  3 is available, `limitationsStatement` MUST use `research.md` R8's exact honest-
  limitation language verbatim, never a stronger claim. No path overlap with T006–T007.
  **Marked incomplete (via PR review, see evidence-index.md's Limitations section):**
  the rank-1 check performed here tested only `unshare(1)` and missed this host's
  genuinely-available macOS equivalent (`sandbox-exec`), so rank 3 was recorded and used
  for every invocation task later listed in `NetworkDenialRecord.appliedToInvocations`
  (`install`, `hook-fire`, `probe-absent-context`, `probe-absent-cli`) even though a
  stronger mechanism existed — this task's own contract requirement to select the
  *strongest available* mechanism (`contracts/isolation-and-offline.md` §4) was not met.
  Per direct reviewer feedback, this is disclosed by unchecking the box rather than by
  qualifying prose alone: the task's core action (determine availability, record a
  `NetworkDenialRecord`) was performed and its output exists and gated real invocations,
  but the *selection itself* did not satisfy the contract, so it is not counted as
  complete. This does **not** retroactively invalidate the invocations it gated — those
  ran, completed, and are fully evidenced under rank 3, exactly as recorded — and it does
  **not** change the `no-go` verdict, which is driven independently by the mutation
  baseline (an orthogonal axis). It was not remediated by re-running the live-Copilot
  lifecycle under the stronger mechanism, which was judged disproportionate: doing so
  would not change the verdict and would require a second full isolated live-Copilot
  session.

- [X] T006 [P] Establish the three scratch workspace roots (`research.md` R3;
  `contracts/isolation-and-offline.md` §1). Create `<SCRATCH_ROOT>/` and its three named
  subdirectories (Path Conventions above) — empty at this point except for
  `adrkit-spike-fixture/`, `adrkit-spike-fixture/commands/`, and
  `adrkit-spike-fixture/scripts/`, which T008–T010 populate. Confirm, and record in
  `<EVIDENCE_DIR>/scratch-workspaces.json`, that `<SCRATCH_ROOT>` resolves to a path with
  no `.git` ancestor pointing at `mbeacom/adrkit` (`ScratchWorkspace.isTrackedByThisRepo
  === false` for every instance — `data-model.md` §3). No path overlap with T005/T007.

- [X] T007 [P] Initialize the evidence-capture harness (`research.md` R5–R7; secret
  scrubbing per R6). Write a single reusable capture helper — e.g.
  `<EVIDENCE_DIR>/capture.sh` — that, given a command line and a working directory: (a)
  runs `git status --porcelain=v1` immediately before, (b) runs the command with the
  allowlisted environment only (`env -i PATH="$PATH"
  ADRKIT_REPO_ROOT="$ADRKIT_REPO_ROOT" ...`, never a denylist; validate the latter as
  a canonical local checkout path, not a credential), (c) captures
  stdout/stderr verbatim to `<EVIDENCE_DIR>/transcripts/<label>.stdout` /
  `<label>.stderr`, records the exit code, and computes a `sha256sum` of each captured
  file, (d) runs `git status --porcelain=v1` immediately after, (e) runs a mechanical
  grep pass over every captured file for the R6 secret-shaped pattern list (`TOKEN`,
  `SECRET`, `KEY`, `PASSWORD`, `_AUTH`) before the transcript is considered final. Every
  later invocation task that runs a `specify`/subprocess command and needs a
  bracketed transcript (T014, T024, T028, T031) invokes this harness rather than
  improvising its own capture. No path overlap with T005/T006.

- [X] T008 [P] Write the fixture manifest `<SCRATCH_ROOT>/adrkit-spike-fixture/extension.yml`
  exactly as `contracts/upstream-target.md` §2's "This fixture's populated manifest"
  block specifies — `schema_version: "1.0"`, `extension.id: "adrkit-spike"`, one command
  `speckit.adrkit-spike.probe`, `requires.speckit_version: ">=0.13.0,<0.14.0"`, one
  `hooks.after_plan` entry with `optional: true`. Depends on: T006 (directory exists). No
  path overlap with T009/T010.

- [X] T009 [P] Write the fixture command file
  `<SCRATCH_ROOT>/adrkit-spike-fixture/commands/probe.md` exactly as
  `contracts/fixture-surface.md` §1 specifies — frontmatter (`description`,
  `scripts.sh: scripts/probe.sh`) and body (the five-step read-only procedure). Depends
  on: T006. No path overlap with T008/T010.

- [X] T010 [P] Write the fixture script `<SCRATCH_ROOT>/adrkit-spike-fixture/scripts/probe.sh`
  exactly per `contracts/fixture-surface.md` §1's illustrative shape (adapted only where
  the actual shell requires; the required *behavior* — locate `$1/plan.md`, exit 1 with
  the exact absent-context message if missing, locate `<repo-root>/packages/cli/dist/index.js`,
  exit 1 with the   exact absent-CLI message if missing, otherwise require the explicit
  `ADRKIT_REPO_ROOT` input to identify `<THIS_REPO>` and run
  `env -i PATH="$PATH" ADRKIT_REPO_ROOT="$ADRKIT_REPO_ROOT" node "$CLI_DIST"
  queue --dir "$ADRKIT_REPO_ROOT/docs/adr" --format json` — never derive the adrkit
  root from the separate scratch project's git root — is fixed, not the literal
  bytes). Run `chmod +x` on it. Depends on: T006. No path overlap with T008/T009.

- [X] T011 Build adrkit's own CLI artifact (prerequisite for FR-011/US2/US4).
  In `<THIS_REPO>`: run `bun run build` (filtered to `@adrkit/cli` per
  `packages/cli/package.json`'s `build` script), then `ls packages/cli/dist/index.js` to
  confirm it now exists. **This is the one task in this file that legitimately produces a
  new file inside `<THIS_REPO>` — `dist/` is gitignored build output, never a tracked
  file, and this task's own net effect on `git status --porcelain=v1` at `<THIS_REPO>`'s
  root MUST still show nothing tracked changing.** Record the build's exit code to
  `<EVIDENCE_DIR>/cli-build.json`. Depends on: T003 only (no scratch-workspace
  dependency); may run any time after the gate passes, including before T005–T010.

- [X] T012 Checkpoint: Foundational complete. Depends on: T004 (`reverificationOutcome
  === "match"` — if `"mismatch"`, this checkpoint is never reached; the spike already
  stopped at T004), T005, T006, T007, T008, T009, T010, T011. Confirm all seven outputs
  exist and are internally consistent (e.g. the fixture's `commandName` in T008's
  manifest matches the `scripts:` reference T009 wrote and the file T010 made
  executable). No User Story task below may begin until this checkpoint is confirmed.
  **Scope clarification (PR review round 6):** a reviewer comment read "Depends on:
  ..., T005, ..." as requiring T005 to fully satisfy T005's *own* separate substantive
  contract (select the strongest available network-denial mechanism) before this
  checkpoint can count as confirmed, and — since T005 does not (see T005's own note) —
  argued this checkpoint and its downstream dependents should be marked incomplete too.
  This checkpoint's own literal action, as written above, is narrower and different:
  *confirm the seven listed outputs exist and are internally consistent* — not
  *re-certify that each dependency's own selection/decision was optimal*. That
  narrower check is true without qualification: T005's `NetworkDenialRecord` does
  exist and is internally consistent in shape (`mechanismUsed`, `limitationsStatement`,
  `appliedToInvocations` all correctly populated) — its documented defect is in the
  *mechanism-selection decision* T005 recorded, not in whether the record exists or
  coheres with the other six outputs. This checkpoint's own gating *function* (block
  User Story work until genuine outputs exist) was also never violated: work only
  began once all seven outputs, including T005's actual — imperfect — recorded output,
  genuinely existed. For this reason this checkpoint remains `- [X]`, and the downstream
  checkpoints that cite "Depends on: T012" (US1/US2/US3/US5) are unaffected and require
  no further change: none of them re-litigates T005's mechanism-selection decision
  either, and their own literal actions (recording transcripts, checking mutation
  baselines, validating bundle-field existence, etc.) are independent of it. This
  reasoning mirrors T057's own note above, applied here explicitly because a reviewer
  named this checkpoint specifically. See `evidence-index.md`'s Limitations section for
  the tracked, cross-referenced version of this clarification.

---

## Phase 3: User Story 1 — Freeze the Upstream Target and Prove a Clean Local Dev Install (Priority: P1) 🎯 MVP

**Goal**: The fixture from Phase 2 installs cleanly via `--dev` into a fresh Tier-1
scratch project, and `specify extension list`, the effective project extension
configuration path discovered under FR-006, the extension registry, and direct file
inspection all agree it is present with exactly one command and one hook.

**Independent Test** (spec.md US1): Install `specify-cli` pinned to the frozen release
(already true per T004/A2), run `specify extension add --dev <path>` against a scratch
project, confirm `specify extension list` reports exactly one command and one hook
registered and enabled, with no network access beyond the pre-existing one-time
`specify-cli` install.

Depends on: T012 (Foundational checkpoint).

- [X] T013 [US1] Initialize the Tier-1 scratch Spec Kit project. In
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/`, run `specify init --here --ai copilot`
  (matching this repository's own `.specify/init-options.json` integration mode). Confirm
  exit code 0 and that a `.specify/` directory now exists in the scratch project — no
  project extension configuration at either upstream-documented path yet (nothing
  installed).

- [X] T014 [US1] Install the fixture via local dev install (FR-005; never the default
  catalog, never a `--from` URL). Using the T007 harness, capture: before-install
  `git status --porcelain=v1` in the scratch project, then run
  `specify extension add --dev <SCRATCH_ROOT>/adrkit-spike-fixture` from
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/`, then after-install
  `git status --porcelain=v1`. Record the full `LifecycleTranscript`
  (`contracts/lifecycle-evidence.md` §1) — `step: "install"`, exact command line, stdout,
  stderr, exit code — to `<EVIDENCE_DIR>/transcripts/install.json`. Depends on: T013.

- [X] T015 [US1] Verify `specify extension list` (FR-006(a)). Run it in the scratch
  project; confirm the human-readable output names `adrkit-spike`, `Commands: 1`,
  `Hooks: 1`, `Status: Enabled` (`EXTENSION-USER-GUIDE.md` §"List Installed Extensions"
  output shape, per `research.md` R9). Append this check's raw output to
  `<EVIDENCE_DIR>/transcripts/install.json`'s `filesInspectedDirectly`-adjacent notes.
  Depends on: T014.

- [X] T016 [US1] Inspect the effective project extension configuration directly
  (FR-006(b); never trusting T015's success message alone). Probe both
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/.specify/extensions.yml` and
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/.specify/extensions/extensions.yml`;
  require exactly one effective path, record the actual path in the lifecycle
  evidence, and confirm an
  `installed` entry for `adrkit-spike` and a `hooks.after_plan` entry with
  `extension: adrkit-spike`, `command: speckit.adrkit-spike.probe`. **Additivity check**
  (Edge Cases note): if this file already had unrelated entries before T014 (unlikely in
  a freshly-`init`ed project, but checked regardless), confirm they are unchanged. Depends
  on: T014.

- [X] T017 [US1] Inspect the extension registry directly (FR-006(c)). Read
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/.specify/extensions/.registry` (JSON);
  confirm an `adrkit-spike` key with `registered_commands` including
  `speckit.adrkit-spike.probe`. Depends on: T014.

- [X] T018 [US1] Direct file-existence and script-resolution check of the rendered
  Copilot command files
  (Edge Cases note on partial-install defects — never trust the CLI's own success message
  alone). Confirm both
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/.github/agents/speckit.adrkit-spike.probe.agent.md`
  and
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/.github/prompts/speckit.adrkit-spike.probe.prompt.md`
  exist on disk (`ls`/`stat`, not merely T015's reported success). Record the two
  absolute paths as `registeredFiles` (`data-model.md` §6) to
  `<EVIDENCE_DIR>/registered-files.json`. Inspect the rendered command's `scripts.sh`
  value, record whether it preserved or rewrote `scripts/probe.sh`, and prove the
  resolved target exists and is executable before any hook run; failure is install
  evidence failure, never an assumption. Depends on: T014.

- [X] T019 [US1] Record the `install` `MutationBaseline` (FR-012/SC-003). From T014's
  before/after `git status --porcelain=v1` captures (scratch project git tree), compute
  `identical` (`data-model.md` §5) and append to
  `<EVIDENCE_DIR>/mutation-baselines.json` with `invocationLabel: "install"`,
  `gitTreeRoot: "scratch-project"`. **If `identical === false`, this is a `no-go`
  trigger** (`contracts/evidence-bundle-and-verdict.md` §2 Step 1) — record it but keep
  going through the remaining User Stories per FR-018's complete-bundle requirement;
  do not silently stop the evidence-gathering pass, only the *eventual production
  recommendation* is foreclosed by this outcome.

**Checkpoint**: User Story 1 complete. `frozenReference`, `fixture` metadata,
`installTranscript`, `registeredFiles`, and the `install` `MutationBaseline` are all
populated in the evidence bundle draft. SC-001 evidence is complete.

---

## Phase 4: User Story 2 — Prove a Real `after_plan` Hook Fires with Genuine Plan Context and Calls adrkit's Built CLI Offline (Priority: P1)

**Goal**: A live `/speckit.plan` run in this repository's own GitHub Copilot session,
against a disposable scratch feature, surfaces the fixture's hook as optional; accepting
it causes the probe to read the just-produced `plan.md` and invoke
`packages/cli/dist/index.js queue --format json` as an offline subprocess with zero
mutation.

**Independent Test** (spec.md US2): Run `/speckit.plan` live in GitHub Copilot against a
scratch feature outside `specs/`; accept the offered optional hook when the Mandatory
Post-Execution Hooks section surfaces it; capture the full transcript including the
`EXECUTE_COMMAND`/invocation line (or, since this hook is `optional`, the equivalent
"To execute" line — never the mandatory rendering), the fixture command's own output, its
exit code, and `git status --porcelain` diffs immediately before/after.

Depends on: T012 (Foundational — specifically T011's built CLI) and T014 (US1's fixture
installed in the same Tier-1 scratch project — this story reuses that installation,
it does not reinstall).

- [X] T020 [US2] Create a throwaway scratch adrkit feature (FR-017/A8) inside
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/`, entirely outside this repository's
  committed `specs/` tree. Run `/speckit.specify <trivial scratch description>` in that
  scratch project. Confirm a scratch feature directory now exists with its own `spec.md`
  — this feature is never intended to become a numbered feature in `mbeacom/adrkit`'s own
  `specs/` tree.

- [X] T021 [US2] Capture the **this-repository** mutation baseline, before half
  (`research.md` R7 — this scenario checks `<THIS_REPO>`, not the scratch project, per
  FR-012 Acceptance Scenario 4). Run, at `<THIS_REPO>`'s root: `git status
  --porcelain=v1` and `git diff --stat -- docs/adr`; save both to
  `<EVIDENCE_DIR>/mutation-baselines/hook-fire-before.txt` and
  `hook-fire-before-adr-diff.txt` respectively.

- [X] T022 [US2] Run `/speckit.plan` live, in this repository's own Copilot session,
  against T020's scratch feature. Capture the rendered Extension Hooks section verbatim.
  **Required outcome** (`contracts/fixture-surface.md` §2): the block matches the exact
  "Optional Hook" shape — `**Optional Hook**: adrkit-spike`, `Command:
  /speckit.adrkit-spike.probe`, its `Description`/`Prompt`/`To execute` lines — character
  for character in structure, **never** the `**Automatic Hook**`/`EXECUTE_COMMAND:`
  mandatory rendering. If the mandatory rendering is ever observed for this hook, that is
  itself a spike defect (the fixture's `optional: true` declaration was not honored) and
  is recorded as a `hookFireTranscript` anomaly feeding the `no-go` check in T045, not
  silently normalized.

- [X] T023 [US2] Accept the offered hook. Confirm the fixture command (`speckit.adrkit-spike.probe`)
  executes in the same session. Capture: exit code, and direct evidence that it read the
  *just-produced* scratch `plan.md` (FR-010) — e.g. the scratch feature's directory path
  and a `plan.md` excerpt the probe's own output or logging actually references, never a
  fixed/fabricated stand-in. Depends on: T022.

- [X] T024 [US2] Capture the nested `SubprocessInvocation` (FR-011;
  `contracts/isolation-and-offline.md` §3). Using the T007 harness's allowlisted-env
  capture, record the exact command line
  (`node $ADRKIT_REPO_ROOT/packages/cli/dist/index.js queue --dir
  $ADRKIT_REPO_ROOT/docs/adr --format json`), the allowlisted environment actually
  present (`PATH` plus validated non-secret `ADRKIT_REPO_ROOT`, per
  `contracts/isolation-and-offline.md` §3.1), stdout
  (the verbatim `adr queue` JSON output), stderr, and exit code (MUST be `0`). Record
  which `NetworkDenialRecord.mechanismUsed` (T005) this specific invocation ran under, and
  append `"hook-fire"` to `NetworkDenialRecord.appliedToInvocations`. Depends on: T023.

- [X] T025 [US2] Capture the **this-repository** mutation baseline, after half.
  Immediately after T023/T024 complete, run the same two commands as T021 at
  `<THIS_REPO>`'s root; save to `hook-fire-after.txt` / `hook-fire-after-adr-diff.txt`.

- [X] T026 [US2] Diff T021's and T025's captures: `diff hook-fire-before.txt
  hook-fire-after.txt` and `diff hook-fire-before-adr-diff.txt
  hook-fire-after-adr-diff.txt` — **both MUST be empty** (SC-003, FR-012 Acceptance
  Scenario 4). Compute `identical` and append the `hook-fire` `MutationBaseline`
  (`gitTreeRoot: "this-repository"`, both `adrDiffStatBefore`/`adrDiffStatAfter`
  populated) to `<EVIDENCE_DIR>/mutation-baselines.json`. **If `identical === false`,
  this is a `no-go` trigger** (mutation occurred) — record and continue gathering the
  remaining evidence per FR-018, but this result alone determines the eventual verdict
  regardless of every later story's outcome.

- [X] T027 [US2] Record `hookFireTranscript` (`contracts/agent-verification.md` §2's
  shape — `planCommandInvoked`, `scratchFeatureDirectory`, `hooksBlockRendered`,
  `renderedAsOptional`, `operatorAcceptedHook`, `hookCommandExitCode`,
  `readGenuinePlanContext`, `genuineContextEvidence`) and `offlineSubprocessProof`
  (T024's shape) to `<EVIDENCE_DIR>/hook-fire.json`.

**Checkpoint**: User Story 2 complete. This is the single riskiest claim ADR-0003's
spike action item exists to settle (spec.md: "this story alone can produce a `no-go`").
If T026 or T022's rendering check failed in an unsafe way, the eventual verdict is
already determined to be `no-go` regardless of how well US3/US4 perform.

---

## Phase 5: User Story 3 — Prove Disable, Remove, and Multi-Agent Rendering Behave as Documented (Priority: P2)

**Goal**: Disabling the fixture stops the hook from being offered without deleting its
files; removing it deletes every registered file/registry/config entry with no orphan;
the fixture separately renders correctly for GitHub Copilot (already proven live in US2)
and structurally for one more upstream-supported agent.

**Independent Test** (spec.md US3): With the fixture installed and its hook previously
proven to fire (US2), run `specify extension disable`, re-run `/speckit.plan`, confirm no
hook offered; run `specify extension remove`, confirm no orphaned file/entry; separately,
in a disposable scratch project for a second upstream-supported agent, install the
fixture and inspect the rendered files structurally.

Depends on: T027 (US2's hook-fire proof — spec.md's own Independent Test names this
precondition explicitly).

- [X] T028 [US3] Disable the fixture (FR-013). In
  `<SCRATCH_ROOT>/adrkit-spike-scratch-project/`, using the T007 harness, run `specify
  extension disable adrkit-spike`. Capture the `LifecycleTranscript` (`step: "disable"`)
  to `<EVIDENCE_DIR>/transcripts/disable.json`.

- [X] T029 [US3] Re-run `/speckit.plan` in the same Tier-1 scratch project (a second
  scratch feature, or the same one from T020 if its plan phase can be safely re-run).
  Confirm the Mandatory Post-Execution Hooks section reports no hook registered for
  `after_plan` — either the Extension Hooks block is omitted entirely, or it explicitly
  states no hooks are registered (`templates/commands/plan.md`'s own documented
  behavior). Depends on: T028.

- [X] T030 [US3] Confirm the fixture's files remain byte-identical on disk after
  disabling (disable is a registry/config flag flip, never a file removal). Compare
  `commands/probe.md`, `scripts/probe.sh` (source, in `<SCRATCH_ROOT>/adrkit-spike-fixture/`)
  and the rendered `.github/agents/speckit.adrkit-spike.probe.agent.md` /
  `.github/prompts/speckit.adrkit-spike.probe.prompt.md` (in the scratch project) against
  their T009/T010/T018 hashes. Depends on: T028.

- [X] T031 [US3] Remove the fixture (FR-014). Using the T007 harness, run `specify
  extension remove adrkit-spike --force` (the `--force` flag skips the interactive
  confirmation, appropriate for this spike's scripted execution — `research.md` R9).
  Capture the `LifecycleTranscript` (`step: "remove"`) to
  `<EVIDENCE_DIR>/transcripts/remove.json`. Depends on: T028 (disable proven first, per
  the Independent Test's own sequencing).

- [X] T032 [US3] Verify no orphaned reference (`contracts/lifecycle-evidence.md` §4's
  six-row table — every row checked by direct inspection, not by trusting T031's success
  message): `.github/agents/speckit.adrkit-spike.probe.agent.md` absent;
  `.github/prompts/speckit.adrkit-spike.probe.prompt.md` absent; the actual project
  extension configuration path recorded by T016 has no `installed`/`hooks.after_plan`
  entry for `adrkit-spike`;
  `.specify/extensions/.registry` has no `adrkit-spike` key; `specify extension list`
  output contains no mention of `adrkit-spike` in any form. **Any single row failing is a
  `no-go` trigger** (`contracts/evidence-bundle-and-verdict.md` §2 Step 1 —
  "could not be safely disabled or fully removed"). Record the full six-row result to
  `<EVIDENCE_DIR>/lifecycle-removal-check.json`. Depends on: T031.

- [X] T033 [P] [US3] Initialize the Tier-2 (second-agent) scratch project. In
  `<SCRATCH_ROOT>/adrkit-spike-second-agent-scratch/` (a **third**, distinct scratch
  directory — never reusing the Tier-1 project, never this repository's own live
  configuration), run `specify init --here --ai claude` (Claude Code, the default
  candidate per Assumption A6). If Claude Code proves impractical to scaffold, fall back
  to `specify init --here --ai gemini` and record the fallback reason. Then run `specify
  extension add --dev <SCRATCH_ROOT>/adrkit-spike-fixture` in this Tier-2 project. **No
  path overlap with T028–T032** (entirely separate scratch project) — may run in
  parallel with the disable/remove sequence. Depends on: T012 (Foundational fixture
  exists) only, not on T028–T032.
  **Post-execution correction (PR round 4, language corrected PR round 6):** unlike
  Tier-1's `install` invocation, which has a dedicated task (T019) requiring its own
  before/after `git status` bracket and `MutationBaseline` record, this Phase 5/US3
  task decomposition never defined an equivalent dedicated task for T033's `specify
  extension add --dev` invocation — only T034's structural rendering check covered it,
  and only for file *shape*, not for the mutation *comparison* FR-012 requires. This is
  a genuine gap in the original **task decomposition** (a missing task, discovered via
  PR review), not a failure to perform T033's own literally-described action (run the
  two `specify` commands), which was fully and correctly done. Because the gap is
  irreversibly historical — the original invocation's own before/after capture was
  never taken and cannot be reconstructed after the fact — a later, freshly bracketed
  invocation of the same command against a recreated fixture instance was recorded
  separately (see `evidence-index.md`'s Verdict section, row 6, and
  `mutation-baselines.json`'s `install-tier2-second-agent` entry under
  `<EVIDENCE_DIR>`). That new entry **corroborates** (same four-new-untracked-path
  signature as Tier-1's `install` finding) but does **not and cannot retroactively
  close** the original invocation's own bracket gap — the two are distinct events.
  T033's checkbox remains `[X]` because its own defined action was fully performed;
  the disclosed limitation is scoped to FR-012 bracket coverage, tracked honestly in
  `evidence-index.md`, not to this task's completion.

- [X] T034 [US3] Structurally inspect the Tier-2 rendered command/hook files
  (`contracts/agent-verification.md` §3 — `AgentRenderingCheck` shape; `liveInvocationPerformed`
  fixed `false` by design, per A6). Confirm, by direct file inspection (no live
  conversational session required): correct directory (e.g.
  `.claude/commands/speckit.adrkit-spike.probe.md` for Claude Code), correct file
  extension, correct frontmatter, correctly-substituted hook block. Record
  `agentUsed` (`"claude-code"` or `"gemini-cli"`, whichever T033 actually used) and
  `fallbackReasonIfNotDefault` (non-null only if Gemini was used). **A partial or failed
  result here (any one `*Correct` field `false`) is a valid, reportable finding that
  resolves toward `manual-command-only`** (`contracts/evidence-bundle-and-verdict.md` §2
  Step 3 case (b)) — never treated as unsafe/`no-go` on its own, and never silently
  dropped from the bundle. Depends on: T033.

- [X] T035 [US3] Record `disableTranscript`, `removeTranscript`, and
  `secondAgentRenderingCheck` to `<EVIDENCE_DIR>/lifecycle-and-second-agent.json`.
  Depends on: T028, T031, T032, T034.

**Checkpoint**: User Story 3 complete. SC-004/SC-005 evidence is fully populated.

---

## Phase 6: User Story 4 — Prove Honest Failure When Plan Context or the Built adrkit CLI Is Absent (Priority: P2)

**Goal**: Direct invocation of the fixture's probe with no reachable feature/plan
context, and separately with `packages/cli/dist` deliberately absent, both fail loudly
and specifically — never a silent success, never an unhandled crash.

**Independent Test** (spec.md US4): Run the probe directly (outside any hook) from a
directory with no adrkit feature context; capture exit code/message. Separately, with a
valid feature context but `packages/cli/dist` temporarily absent, run again; capture exit
code/message.

- [X] T036 [US4] Probe A — absent plan context (FR-015). Depends on: T010 (fixture
  script written) only — no dependency on US2/US3; grouped in this phase for
  evidence-bundle ordering, not because it requires them. Create a wholly empty directory
  (e.g. `<SCRATCH_ROOT>/adrkit-spike-probe-a-empty/`, distinct from every other scratch
  path used elsewhere in this file) with no reachable `specs/NNN-*/` and no
  `.specify/feature.json`. Invoke `<SCRATCH_ROOT>/adrkit-spike-fixture/scripts/probe.sh ""`
  directly from it. **Expected (RED-equivalent — the specific, documented failure, not
  merely "didn't succeed")**: exit code non-zero (contract's illustrative script uses
  `1`); stderr names the missing context specifically (illustrative exact text:
  `"adrkit-spike: no adrkit feature/plan context reachable (expected a plan.md under
  $1)"`); stdout empty or diagnostic only; **no unhandled crash/stack trace** — any of
  those three violated is itself the FR-015 failure this probe exists to catch, not an
  acceptable variant.

- [X] T037 [US4] Record `FailureProbeResult` instance A (`contracts/fixture-surface.md`
  §3's exact JSON shape: `probeName: "absent-context"`, `exitCode`, `stderrMessage`,
  `namesTheMissingDependency`, `isUnhandledCrash`) to
  `<EVIDENCE_DIR>/absent-context-probe.json`. Depends on: T036.

- [X] T038 [US4] Rename `packages/cli/dist` aside (FR-016 precondition; `research.md`
  R10 — **rename, never delete**). In `<THIS_REPO>`: run `mv packages/cli/dist
  packages/cli/dist.spike-backup`. **Depends on: T024/T027 (US2's live subprocess call
  already succeeded against the built CLI)** — FR-016 explicitly forbids "coincidentally
  starting in the absent-artifact state"; this probe must deliberately create it *after*
  proving the built-CLI path works, never before. Confirm `packages/cli/dist` no longer
  exists and `packages/cli/dist.spike-backup` does, before proceeding to T039.

- [X] T039 [US4] Probe B — absent built CLI (FR-016). With a valid scratch feature
  context available (T020's scratch feature and its `plan.md`), invoke
  `<SCRATCH_ROOT>/adrkit-spike-fixture/scripts/probe.sh
  <path-to-T020-scratch-feature-directory>` directly. **Expected**: exit code non-zero;
  stderr names the missing built artifact and, where practical, the command that would
  produce it (illustrative exact text: `"adrkit-spike: adrkit's built CLI is absent at
  packages/cli/dist/index.js — run 'bun run build' first"`); stdout empty or diagnostic
  only; **never a silent no-op (exit 0, no output)**. Depends on: T038.

- [X] T040 [US4] Restore `packages/cli/dist` (`research.md` R10's recovery contract —
  **mandatory, not optional cleanup**). Run `mv packages/cli/dist.spike-backup
  packages/cli/dist` in `<THIS_REPO>`. Confirm `packages/cli/dist/index.js` exists again.
  **Failure recovery**: if the rename-back itself fails for any reason (e.g. the backup
  path was somehow lost), the fallback is `bun run build` from `<THIS_REPO>`'s root —
  always available since `dist/` is reproducible, gitignored build output — followed by
  re-confirming `packages/cli/dist/index.js` exists. **If this task cannot restore the
  built CLI by either path, the spike halts and records that failure explicitly rather
  than continuing with `<THIS_REPO>` in an ambiguous build state** — do not proceed to
  T041 or any later task until this is resolved. Depends on: T039.

- [X] T041 [US4] Confirm `<THIS_REPO>`'s own `git status --porcelain=v1` at repository
  root is identical before T038 and after T040 (the rename/restore round-trip must leave
  zero net effect on tracked files — `dist/` was never tracked to begin with). Record
  `FailureProbeResult` instance B (`contracts/fixture-surface.md` §4's shape:
  `probeName: "absent-built-cli"`, ...) to `<EVIDENCE_DIR>/absent-cli-probe.json`.
  Depends on: T040.

**Checkpoint**: User Story 4 complete. Both honest-failure contracts (FR-015/FR-016) are
evidenced; `packages/cli/dist` is confirmed restored.

---

## Phase 7: User Story 5 — Record One Evidence-Backed Verdict for Later Production Scoping (Priority: P1)

**Goal**: Read the complete evidence bundle from User Stories 1–4 and compute exactly one
of `go` / `manual-command-only` / `no-go`, per `contracts/evidence-bundle-and-verdict.md`
§2's fixed precedence, with every driving field cross-referenced and (if applicable) a
non-binding recommendation attached.

**Independent Test** (spec.md US5): Read the completed evidence bundle and confirm it
maps to exactly one verdict per Success Criteria's definitions, with every piece of
required evidence present and cross-referenced.

Depends on: T012, T019, T027, T035, T041 (every prior phase's checkpoint).

- [X] T042 [US5] Validate evidence bundle completeness (`contracts/evidence-bundle-and-verdict.md`
  §1's checklist). Confirm every required top-level field exists in the working draft
  under `<EVIDENCE_DIR>`: `frozenReference`, `fixture`, `installTranscript`,
  `disableTranscript`, `removeTranscript`, `registeredFiles`, `hookFireTranscript`,
  `offlineSubprocessProof`, `mutationBaselines` (with every entry's `identical` field
  checked), `secondAgentRenderingCheck`, `absentContextProbe`, `absentCliProbe`,
  `networkDenial`. **A bundle missing any of these (when `frozenReference` matched) is
  incomplete and MUST NOT have a verdict recorded against it** — if any field is
  genuinely missing (not merely "recorded as an unsafe/failing result," which is a
  populated field, just an unfavorable one), stop and complete the missing evidence-
  gathering task before proceeding to T043.
  **Scope clarification (PR review round 6):** a reviewer comment asked whether this
  checkpoint should also be adjusted given the T012/T005 and T033 findings noted above.
  This checkpoint's own literal action is confirming *field existence* (and, for
  `mutationBaselines`, that each present entry's `identical` field was checked) — at
  the time this task ran, every listed field, including `mutationBaselines` (six
  Tier-1 entries) and `networkDenial`, genuinely existed and was populated. Neither the
  T033 Tier-2 bracket gap nor T005's mechanism-selection defect is a *missing field* —
  both are populated fields with a disclosed content-level limitation, which is exactly
  the case this task's own text says to let through ("recorded as an unsafe/failing
  result... is a populated field, just an unfavorable one"). This checkpoint remains
  `- [X]` for that reason.

- [X] T043 [US5] Evaluate Step 1 — `no-go` (checked first; dominates). Check, against
  the assembled bundle: any `MutationBaseline.identical === false` (T019, T026); any row
  of T032's removal check failed; `absentContextProbe`/`absentCliProbe` show an unsafe
  result (`exitCode === 0` or `isUnhandledCrash === true` — T037, T041); or
  `hookFireTranscript` shows the hook never firing, crashing the session, or corrupting
  state (T027). **If any trigger fired**: set `outcome = "no-go"`, `noGoTrigger` to the
  specific name (`"mutation"` / `"disable-or-remove-failed"` / `"failure-probe-unsafe"` /
  `"hook-never-fired"`), `recommendation = null`, `drivingEvidence` to the specific
  triggering field(s), then **proceed directly to T046 — do not evaluate T044 or T045.**
  If no trigger fired, proceed to T044.

- [X] T044 [US5] Evaluate Step 2 — `go` (checked second; only if T043 did not match).
  **Correctly skipped (not evaluated) — T043 matched at Step 1 (`no-go`/`mutation`) and
  the contract requires proceeding directly to T046 without evaluating this task**
  (T043's own instruction). Checked here only to record that the short-circuit rule was
  correctly recognized and honored, not that this task's substantive check (every
  acceptance scenario in User Stories 1–4 passing) was performed or its outcome asserted.
  Check that every acceptance scenario in User Stories 1–4 passed exactly as specified:
  US1 all 3 scenarios (T013–T018), US2 all 4 scenarios (T020–T027), zero mutation
  throughout (already implied by T043 not matching), clean disable/remove (T028–T032),
  Copilot live rendering (T022–T023), second-agent structural rendering fully correct —
  all four `*Correct` fields `true` (T034), and both honest-failure probes safe (T037,
  T041). **If every scenario passed**: set `outcome = "go"`, `drivingEvidence` to every
  `EvidenceBundle` field (a `go` verdict is by definition "everything passed").
  `recommendation` is now required — proceed to T046. **Stop — do not evaluate T045.**

- [X] T045 [US5] Evaluate Step 3 — `manual-command-only` (exhaustive fallback; only if
  neither T043 nor T044 matched). **Correctly skipped (not evaluated) — T043 matched at
  Step 1, so this exhaustive-fallback step never applies; recorded here only as
  correctly-recognized-and-honored, not as an evaluated-and-passed check.** By
  construction, no `no-go` trigger fired but the
  result fell short of full `go` in a way that is not itself unsafe. Identify which named
  case applies: (a) US1/US4/Copilot-rendering all passed but `hookFireTranscript` (T027)
  shows the hook itself proved unreliable or context-starved; (b) everything else passed
  but `secondAgentRenderingCheck` (T034) has at least one `*Correct` field `false`; or
  (other) a free-text description of a different non-unsafe shortfall. Set
  `manualCommandOnlyShortfall` accordingly. `recommendation` is now required — proceed to
  T046.

- [X] T046 [US5] Cross-reference `verdict.drivingEvidence` (FR-019). Confirm the array
  populated by whichever of T043/T044/T045 fired lists, by exact field name from
  `EvidenceBundle` (`data-model.md` §6), every field that determined the outcome. **A
  verdict with an empty `drivingEvidence` array is invalid under
  `contracts/evidence-bundle-and-verdict.md` §5 regardless of narrative prose elsewhere**
  — if empty, return to T043–T045 and populate it before proceeding.

- [X] T047 [US5] Draft the `NonBindingRecommendation` (FR-021; required only if `outcome`
  is `"go"` or `"manual-command-only"` — skip this task entirely if `outcome ===
  "no-go"`, where `recommendation` is fixed `null`). **Correctly skipped in its entirety
  — `outcome === "no-go"` (T043), so per this task's own instruction it does not apply;
  `recommendation` is fixed `null` as required, and no `NonBindingRecommendation` object
  was drafted.** Depends on: T046. Populate
  `bindingStatus: "non-binding"` (literal), `minimalScopeDescription` (per
  `contracts/evidence-bundle-and-verdict.md` §3's exact template text for whichever
  outcome applies), and **`releaseVehicleDecision: null` — always, unconditionally, with
  no exception**. If a future execution session finds itself tempted to populate
  `releaseVehicleDecision` with an npm target, repository location, or version/tag, that
  session has exceeded this spike's authorized scope and must stop and re-scope rather
  than proceed.

- [X] T048 [US5] Set `phase6ExternalValidationClaim: false` (fixed literal, SC-008/FR-023)
  on the verdict record, and write the equivalent prose restatement — in whatever words, but
  covering the same fact — into the narrative file (T050) that Phase 6
  (`specs/007-arb-queue/`) is landed / reference-verified (not externally validated), that
  external / community validation (ADR-0014 rung 3) remains absent unless separately evidenced,
  and that this spike did not cause or advance Phase 6's status, **independent of, and never
  contingent on, this spike's own verdict**. Depends on: T046 (runs regardless of whether T047
  was skipped for a `no-go` outcome — this task applies to every outcome, unconditionally,
  unlike T047).

- [X] T049 [US5] Assemble the final `spike-008-evidence.json` (`research.md` R4;
  `contracts/evidence-bundle-and-verdict.md` §1) at
  `<EVIDENCE_DIR>/spike-008-evidence.json` — the complete, field-for-field
  `EvidenceBundle` (`data-model.md` §6) plus `Verdict` (§7) plus `NonBindingRecommendation`
  (§8, or `null`), assembled from every prior task's individual output files in this
  phase and Phases 3–6. This is the machine-checkable manifest half of the bundle.

- [X] T050 [US5] Write the final `spike-008-evidence.md` (`research.md` R4) at
  `<EVIDENCE_DIR>/spike-008-evidence.md` — the human-readable narrative: frozen-reference
  re-verification result, one subsection per User Story 1–4 with transcript excerpts and
  pass/fail per acceptance scenario, the User Story 5 verdict with its cross-referenced
  evidence, T048's Phase-6-maturity restatement, and (if applicable) T047's non-binding
  recommendation. Depends on: T049.

**Checkpoint**: User Story 5 complete. Exactly one verdict is recorded. This is the
spike's actual deliverable (spec.md: "It does not produce that adapter").

---

## Phase 8: Cleanup and Closeout (cross-cutting, no story label)

**Purpose**: Confirm every constraint this spike was required to hold throughout —
zero tracked mutation, no package/schema/version/tag/CI change, no Phase 6 external / community validation claim —
holds at the end, not merely at each individual step, and tear down (or knowingly leave,
since nothing here is tracked) the scratch workspaces.

Depends on: T050 (evidence bundle finalized).

- [X] T051 Re-confirm `packages/cli/dist` in `<THIS_REPO>` is in its expected final state
  (built and present, per T011/T040 — never left renamed). Run
  `ls packages/cli/dist/index.js` one final time.

- [X] T052 Confirm zero tracked mutation in `<THIS_REPO>` across the entire spike. Run
  `git status --porcelain=v1` at `<THIS_REPO>`'s root — MUST show nothing related to this
  spike (and, ideally, nothing at all, modulo any unrelated pre-existing dirty state the
  spike did not itself cause). This is the final, whole-spike version of every
  per-invocation check T019/T026/T041 already performed individually.

- [X] T053 Confirm no package/schema/version/tag/CI change was introduced anywhere in
  `<THIS_REPO>` (FR-020/Out of Scope). Diff (conceptually or literally, against a
  pre-spike reference) `package.json` (root and every workspace), `schema/adr.schema.json`,
  `packages/core/src/schema/adr.schema.ts`, every file under `docs/adr/**`, and every
  file under `.github/workflows/**` — all MUST be byte-identical to their pre-spike
  state.

- [X] T054 Confirm no claim, anywhere in `spike-008-evidence.md`/`.json`, states or
  implies Phase 6 is externally validated, has external / community validation (ADR-0014 rung
  3), or was landed / reference-verified by this spike, regardless of this spike's own
  verdict (Out of Scope; T048's restatement is the required place to state the precise Phase 6
  maturity label). A mechanical grep for "externally validated" and "external / community"
  in the evidence files should surface only T048's controlled maturity statement unless a
  separate, linkable rung-3 source exists.

- [X] T055 [P] Confirm no scratch artifact from this spike was ever staged or committed
  in `<THIS_REPO>` at any point — `git log` and `git status` at `<THIS_REPO>`'s root show
  no scratch feature, no scratch ADR, and no fixture file ever entering this repository's
  tracked history (FR-017). No path overlap with T056.

- [X] T056 [P] Tear down (or knowingly leave, since none of it is tracked by any git
  repository this spike cares about) the three `<SCRATCH_ROOT>` subdirectories
  (`adrkit-spike-fixture/`, `adrkit-spike-scratch-project/`,
  `adrkit-spike-second-agent-scratch/`) and the T036 empty-directory probe location. No
  path overlap with T055.

**Checkpoint**: Cleanup complete. Every constraint this spike was required to hold is
reconfirmed holding at the end, not merely believed to hold from individual steps.

---

## Phase 9: Independent Evidence Audit and Final Result Report (cross-cutting)

**Purpose**: Have a fresh-context, heavyweight-tier reviewer check the finished evidence
bundle before it is reported as final evidence, then deliver the one deliverable this
entire file exists to produce.

Depends on: T054, T055, T056.

- [X] T057 Independent evidence audit. Dispatch a fresh-context review (no authoring
  context from the session that gathered the evidence) using a heavyweight-tier model —
  **Opus 4.8 or GPT-5.6 Sol; never Opus 4.6**, per this session's model policy — to check
  `spike-008-evidence.md`/`.json` against every FR-001–FR-024, SC-001–SC-008, and all six
  `contracts/*.md` files for: (a) internal consistency between the JSON manifest and the
  Markdown narrative, (b) the verdict's precedence was applied in the fixed order (no-go
  → go → manual-command-only) with no skipped or reordered step, (c) `drivingEvidence` is
  non-empty and names real `EvidenceBundle` fields, (d) `releaseVehicleDecision` is `null`
  in every case it appears, (e) T048's Phase-6-maturity restatement is present and
  correctly worded, and (f) no fabricated or assumed evidence (every transcript excerpt
  traces to an actual captured file under `<EVIDENCE_DIR>`, never a paraphrase presented
  as a direct quote). Record findings; remediate any defect found before T058.
  **Post-execution correction:** six cumulative fresh-context audit rounds converged to a
  final PASS on every item (a)–(f) above, but did **not** independently detect T005's
  network-denial mechanism-selection gap (see T005's own note; T005 is now marked
  incomplete, `- [ ]`, as a direct result) — that gap was found only afterward, via PR
  #35's automated review. This is disclosed as a real limitation of this task's own
  audit coverage, not glossed over: T057's "complete" marking means the audit *action*
  (dispatch, check items a–f, converge to PASS) was performed as specified against its
  own defined scope, which did not include verifying T005's mechanism selection — not
  that the audit caught every defect that existed anywhere in the bundle.
  `spike-008-evidence.json` was updated post-audit (PR review round 4) with a
  corroborating, non-verdict-driving `MutationBaseline` entry addressing a separate
  PR-review finding (T033's Tier-2 install invocation lacked its own bracket in the
  original decomposition — see T033's own note; that entry corroborates, it does not
  retroactively close the original invocation's gap); this update happened after, not
  as part of, the six audit rounds recorded here. A further PR review round (6) also
  flagged T012's "Depends on: ..., T005, ..." checkpoint header as potentially implying
  T005 fully satisfies its own contract; T012's own note above explains why that
  checkpoint remains `- [X]` (its own literal action is existence/consistency, not
  re-certification of T005's mechanism-selection decision) — again outside the six
  audit rounds' own defined scope (a)–(f), which never asked "does any dependency's
  header wording risk being misread this way."

- [X] T058 Produce the final result report to the coordinating/maintainer session:
  the recorded verdict and its `drivingEvidence`; the evidence bundle's location
  (`<EVIDENCE_DIR>/spike-008-evidence.{json,md}`); any `no-go` trigger or
  `manual-command-only` shortfall by name; the explicit restatement that Phase 6 is landed / reference-verified (not externally
  validated), that external / community validation (ADR-0014 rung 3) remains absent unless
  separately evidenced, and that this spike did not cause or advance Phase 6's status; and an explicit note that **any resulting change to
  `plan.md`/`tasks.md`/`spec.md` that this spike's findings suggest is itself a separate,
  later, explicitly-scoped follow-up — never something this execution session decides or
  performs unilaterally as part of running this file.** Also state the FR-024 landing rule:
  raw transcripts remain scratch-only, and any later tracked landing requires a sanitized
  evidence index with commit SHAs, workflow-run links if any workflow is used, content hashes,
  tool versions, network/credential limits, negative-test results, and a reviewer verdict.

**Checkpoint**: Spike execution complete. One verdict, independently audited, reported.
No production package scoped, scheduled, or committed to by this file's execution.

---

## Dependency Graph

```
Phase 1 (Gate):        T001 [P w/ T002 read-only] + T002 → T003 (GATE_PASS)
                        If GATE_PASS = false: STOP. No further task runs.

Phase 2 (Foundational): T003 → T004 (frozen-target re-verify; fail-closed halt point)
                              → T005 [P] + T006 [P] + T007 [P] (no path overlap)
                              → T006 → T008 [P] + T009 [P] + T010 [P] (fixture files)
                        T003 → T011 (CLI build; independent of T004–T010)
                        T004 + T005 + T006 + T007 + T008 + T009 + T010 + T011 → T012

Phase 3 (US1):  T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019

Phase 4 (US2):  T012 + T014 (fixture installed) → T020 → T021 → T022 → T023 → T024
                         → T025 → T026 → T027

Phase 5 (US3):  T027 → T028 → T029 + T030 → T031 → T032 → T035
                T012 → T033 [P, independent of T028–T032] → T034 → T035

Phase 6 (US4):  T010 → T036 → T037                      (Probe A — no US2/US3 dependency)
                T024/T027 → T038 → T039 → T040 → T041     (Probe B — sequenced after US2)

Phase 7 (US5):  T012 + T019 + T027 + T035 + T041 → T042
                T042 → T043 [no-go check] → (if matched, outcome set; else ↓)
                       T044 [go check]    → (if matched, outcome set; else ↓)
                       T045 [fallback]    → (outcome set by construction)
                → T046 (cross-reference — runs once, after whichever of T043/T044/T045
                        actually set `outcome`) → T047 (recommendation; forced `null`
                        for no-go, required otherwise) → T048 (Phase 6 restatement —
                        applies to every outcome, unconditionally) → T049 → T050

Phase 8 (Cleanup):  T050 → T051 → T052 → T053 → T054 → T055 [P] + T056 [P]

Phase 9 (Audit):    T055 + T056 → T057 → T058
```

**Parallel opportunities by phase**:

- Phase 1: T001 and T002 read independent source files (no shared path) — parallelizable,
  though both feed the single sequential T003 decision.
- Phase 2: T005 + T006 + T007 (three independent concerns: network-denial selection,
  scratch-directory creation, capture-harness setup); T008 + T009 + T010 (three different
  fixture files, all depending only on T006's directory having been created); T011 is
  independent of the entire T004–T010 chain and may run at any point after T003.
- Phase 5: T033 (Tier-2 second-agent scratch project) has no path overlap with T028–T032
  (Tier-1 disable/remove) — these two sub-sequences are fully parallelizable.
- Phase 6: T036–T037 (Probe A, empty-directory precondition) has no path or evidence
  overlap with T038–T041 (Probe B, this-repository `dist` rename) *except* that both
  ultimately feed the same evidence bundle draft — the probes themselves may run in
  either order or in parallel; T038–T041's *internal* sequence is strictly ordered
  (rename → probe → restore → confirm) and depends on US2 (T024/T027) having already
  succeeded.
- Phase 8: T055 (commit-history check) and T056 (directory teardown) touch disjoint
  concerns (git history vs. filesystem cleanup) — parallelizable.
- All other tasks are strictly sequential: each records evidence into files that later
  tasks in the same story read, or performs a state transition (install → disable →
  remove; rename → restore) that only makes sense in one order.

---

## Implementation Strategy

### This Is Not an MVP-and-Iterate Feature

Unlike a typical spec-kit feature, this spike has no meaningful "MVP subset" of user
stories to ship early — User Story 5's single verdict is the only deliverable, and it
requires evidence from User Stories 1–4 in full (spec.md: "every other story is evidence
feeding this one conclusion"). There is no partial-credit release; either the complete
evidence bundle exists and one verdict is recorded, or the spike has not yet concluded.
"MVP" here means: **Phase 1 + Phase 2 + User Story 1 (T001–T019) is the smallest slice
that produces any falsifiable finding** — if the frozen-target re-verification or the
clean local install itself fails, that alone is enough evidence to inform (though not
yet fully determine, per SC-007's precedence) a `no-go`-leaning result, without needing
to reach User Stories 2–4.

### Execution Order (once this migration merges and T003 records `GATE_PASS = true`)

1. Phase 1 (T001–T003) — gate check. **If it fails, stop; nothing below runs.**
2. Phase 2 (T004–T012) — foundational. **If T004 finds a mismatch, stop; nothing below
   runs, and spec re-ratification is required before any retry.**
3. Phases 3–6 (User Stories 1–4, T013–T041) — strictly in this order per each story's own
   stated dependency on the previous (US2 needs US1's install; US3 needs US2's proven
   hook-fire; US4's Probe B needs US2's proven built-CLI call) — except Phase 6's Probe A
   (T036–T037), which has no such dependency and may run at any point after Phase 2.
4. Phase 7 (User Story 5, T042–T050) — the verdict, computed only once every prior
   phase's evidence exists.
5. Phase 8 (Cleanup, T051–T056) — mandatory, not optional, regardless of verdict.
6. Phase 9 (Audit and Report, T057–T058) — the actual handoff to the maintainer.

### What Happens on a `no-go` or Gate Failure Partway Through

- **Gate failure (T003) or frozen-target mismatch (T004)**: stop immediately; no scratch
  artifact is created (gate failure) or the spike halts with only `frozenReference`
  populated (mismatch); report and end.
- **A `no-go` trigger firing mid-sequence (e.g. at T019's install mutation check, or
  T026's hook-fire mutation check)**: per FR-018, the evidence-gathering pass continues
  through the remaining User Stories so the bundle is complete (T042 requires every
  field populated regardless of how unfavorable any individual result is) — only the
  eventual *verdict's production recommendation* is foreclosed by a `no-go`, never the
  obligation to finish evidencing the rest.
- **Any point where cleanup (Phase 8) cannot be completed** (e.g. T040's rename-back
  fails and `bun run build` also fails): the spike halts and reports this explicitly as
  its own finding — a repository left in an ambiguous build state is never silently
  accepted as a completed spike run.

---

## Notes

- **[P] tasks** = different files/paths/evidence-bundle fields, no dependency on another
  incomplete task in the same phase. Given this spike's evidence-accumulation shape, most
  tasks are intentionally sequential — parallelism here is the exception, not the norm
  (contrast with a typical feature's models/services/endpoints layering).
- **[Story] label** maps each task to its `spec.md` user story for traceability; Gate,
  Foundational, Cleanup, and Audit phases omit it by convention (matching
  `specs/007-arb-queue/tasks.md`'s Phase 1/2/6 style).
- **No task in this file may be marked complete by this planning/scoping session.** Every
  checkbox above is `- [ ]` as generated; only a future, gate-cleared execution session
  may check any of them, and only after actually performing the described step.
- **No evidence file is created by generating this task list.** `<EVIDENCE_DIR>` and
  `<SCRATCH_ROOT>` do not exist yet; this file describes what a future session creates,
  it does not create anything itself.
- **This file adds no production package, build step, release artifact, or CI job.** Out
  of Scope items from `spec.md` apply identically to every task above — no task here may
  be reinterpreted, when eventually executed, as authorizing a
  `packages/adapters/spec-kit` package, a plan parser, a draft-ADR generator, an
  evaluator Pass 1–3, an MCP write tool, a `main` commit/branch/PR, a schema change, a
  catalog submission, an npm publish, or a version/tag change.
- **Any change to `spec.md`, `plan.md`, or this file that a future execution's findings
  suggest is itself a separate, later, explicitly-scoped activity** — not something the
  execution session performs as a side effect of running through Phases 1–9 above.
- **Model policy** (restated from the header): Sonnet 5 for every task above except
  T004's mismatch-escalation branch and T057's independent audit, which use a
  heavyweight tier (Opus 4.8 / GPT-5.6 Sol) — never Opus 4.6, anywhere in this file.
