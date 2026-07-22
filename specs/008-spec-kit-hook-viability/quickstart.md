# Quickstart Validation Guide: Spec Kit Hook Compatibility Viability Spike

**Feature**: `008-spec-kit-hook-viability` | **Companion to**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

> ✅ **Governance gates satisfied — spike execution authorized once this migration merges; tasks remain unchecked until executed.**
> This guide describes the steps a future execution session runs after it records
> `GATE_PASS = true` in `tasks.md` T003:
>
> 1. **Phase 6 gate — satisfied.** Phase 6 (`specs/007-arb-queue/`) is landed /
>    reference-verified under
>    [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
>    not externally validated; `specs/007-arb-queue/tasks.md` **T048-R**/**T049** read `- [X]`.
> 2. **This spike's own maintainer-ratification gate — satisfied 2026-07-21** per
>    `spec.md`'s Ratification Record.
>
> The guide's existence is advance scoping; actually running these steps remains work for a
> future execution session, and every 008 task checkbox remains unchecked until that session
> runs it.

> ✅ **Status update — Executed 2026-07-22.** The banner above describes this guide's
> state *before* execution and is retained as the historical scoping record; it no longer
> describes the current state. Execution has since completed end-to-end with a recorded
> verdict **`no-go`** (mutation trigger). See [`tasks.md`](./tasks.md)'s executed-summary
> banner and [`checklists/evidence-index.md`](./checklists/evidence-index.md) for the
> authoritative, current status, including two explicit task exceptions (T005, T012) left
> unchecked per PR review.

## Prerequisites (once this migration merges and T003 records `GATE_PASS = true`)

- `specify-cli` v0.13.0 already installed (per spec.md A2 — no reinstall
  expected; only re-verify, per Step 0).
- This repository cloned, on a disposable scratch branch/worktree — never
  `main` (FR-017).
- A separate scratch directory **outside** any git-tracked clone of
  `mbeacom/adrkit`, for the fixture source and the `specify init` scratch
  project (`research.md` R3; `contracts/isolation-and-offline.md` §1).
- Node ≥22 and the ability to run `bun run build` in this repository, to
  produce `packages/cli/dist/index.js` (does not exist as of this plan's
  authoring — confirm with `ls packages/cli/dist` before Step 3).

## Step 0 — Re-Verify the Frozen Target (FR-001)

Follow `contracts/upstream-target.md` §3 exactly:

```bash
# 1. Confirm the tag still resolves to the fixed commit
git ls-remote --tags https://github.com/github/spec-kit v0.13.0
# Expect: 9a30db484b0876cb7e5a391cf735d59bd968e985 refs/tags/v0.13.0^{}

# 2. Confirm the installed CLI reports exactly 0.13.0
specify --version
```

**If either check does not match exactly**: STOP. Do not proceed. Return to
`spec.md` for re-ratification (`contracts/upstream-target.md` §3's fail-closed
procedure). Do not substitute whatever version is actually installed.

## Step 1 — Build adrkit's CLI (Prerequisite for FR-011)

```bash
cd <this-repository-root>
bun run build   # produces packages/cli/dist/index.js, per packages/cli/package.json's build script
ls packages/cli/dist/index.js   # confirm it now exists
```

## Step 2 — Create the Fixture (per `contracts/fixture-surface.md`, `contracts/upstream-target.md` §2)

In the scratch directory (outside this repository):

```bash
mkdir -p adrkit-spike-fixture/commands adrkit-spike-fixture/scripts
cd adrkit-spike-fixture
# Write extension.yml exactly as contracts/upstream-target.md §2 specifies.
# Write commands/probe.md exactly as contracts/fixture-surface.md §1 specifies.
# Write scripts/probe.sh exactly as contracts/fixture-surface.md §1 specifies.
chmod +x scripts/probe.sh
```

## Step 3 — Install (User Story 1; FR-005, FR-006; SC-001)

```bash
mkdir -p ../adrkit-spike-scratch-project && cd ../adrkit-spike-scratch-project
specify init --here --ai copilot   # or whatever init form this environment's specify-cli exposes
specify extension add --dev ../adrkit-spike-fixture

specify extension list
if [ -f .specify/extensions.yml ]; then
  cat .specify/extensions.yml
elif [ -f .specify/extensions/extensions.yml ]; then
  cat .specify/extensions/extensions.yml
else
  echo "No project extension configuration was written" >&2
  exit 1
fi
cat .specify/extensions/.registry
```

**Expected**: `specify extension list` shows `adrkit-spike` installed and
enabled, `Commands: 1 | Hooks: 1`. Exactly one of the two upstream-documented project
extension configuration paths gained an
`installed` entry and a `hooks.after_plan` entry. The registry recorded
`speckit.adrkit-spike.probe`. Capture all three outputs into the evidence
bundle per `contracts/lifecycle-evidence.md` §2.

**Acceptance check**: matches `spec.md` US1 Acceptance Scenarios 1–3
exactly, and `contracts/evidence-bundle-and-verdict.md`'s bundle checklist
item for `installTranscript`/`registeredFiles`.

## Step 4 — Fire the Hook Live (User Story 2; FR-009–FR-012; SC-002, SC-003)

Inside the same scratch project, with GitHub Copilot as the active agent
(matching this repository's own configured integration):

```bash
# Capture a git status baseline in THIS repository's own worktree too,
# since FR-012 Scenario 4 checks docs/adr/** in the adrkit repo, not the
# scratch project — see contracts/isolation-and-offline.md §2.
git -C <this-repository-root> status --porcelain=v1 > before.txt
git -C <this-repository-root> diff --stat -- docs/adr > before-adr-diff.txt

# In the scratch project, create a throwaway scratch feature and run:
#   /speckit.specify <some trivial scratch description>
#   /speckit.plan
# When the Mandatory Post-Execution Hooks section offers the optional
# adrkit-spike hook (contracts/fixture-surface.md §2's exact rendering),
# accept it.

git -C <this-repository-root> status --porcelain=v1 > after.txt
git -C <this-repository-root> diff --stat -- docs/adr > after-adr-diff.txt
diff before.txt after.txt   # MUST be empty
diff before-adr-diff.txt after-adr-diff.txt   # MUST be empty
```

**Expected**: the Extension Hooks block matches
`contracts/fixture-surface.md` §2 exactly (optional, never mandatory); the
probe reads the just-produced scratch `plan.md`; it invokes
`node "$ADRKIT_REPO_ROOT/packages/cli/dist/index.js" queue --dir
"$ADRKIT_REPO_ROOT/docs/adr" --format json` as a subprocess with the allowlisted
`PATH` and validated non-secret `ADRKIT_REPO_ROOT` environment from
`contracts/isolation-and-offline.md` §3.1;
it exits `0`; both diffs above are empty.

**Acceptance check**: matches `spec.md` US2 Acceptance Scenarios 1–4;
populates `hookFireTranscript`, `offlineSubprocessProof`, and the `hook-fire`
`MutationBaseline` in the evidence bundle.

## Step 5 — Disable, Remove, and the Second Agent (User Story 3; FR-007, FR-008, FR-013, FR-014; SC-004, SC-005)

```bash
specify extension disable adrkit-spike
# Re-run /speckit.plan in the same scratch project — confirm no hook offered.
ls .github/agents/speckit.adrkit-spike.probe.agent.md   # still present

specify extension remove adrkit-spike --force
specify extension list   # confirm adrkit-spike gone in every form
ls .github/agents/ 2>/dev/null | grep adrkit-spike   # expect no match
```

Separately, in a **third**, distinct scratch project configured for the
second upstream-supported agent (Claude Code by default; Gemini CLI as
fallback — `contracts/agent-verification.md` §3):

```bash
mkdir ../adrkit-spike-second-agent-scratch && cd ../adrkit-spike-second-agent-scratch
specify init --here --ai claude   # or --ai gemini if Claude Code proves impractical
specify extension add --dev ../adrkit-spike-fixture
ls .claude/commands/speckit.adrkit-spike.*   # inspect structurally — no live invocation required
```

**Acceptance check**: matches `spec.md` US3 Acceptance Scenarios 1–4;
populates `disableTranscript`, `removeTranscript`, and
`secondAgentRenderingCheck` per `contracts/lifecycle-evidence.md` §3–§4 and
`contracts/agent-verification.md` §3.

## Step 6 — Honest Failure Probes (User Story 4; FR-015, FR-016; SC-006)

```bash
# Probe A: no feature/plan context (run from an empty directory under <SCRATCH_ROOT>)
mkdir <SCRATCH_ROOT>/adrkit-spike-empty && cd <SCRATCH_ROOT>/adrkit-spike-empty
../adrkit-spike-fixture/scripts/probe.sh ""; echo "exit=$?"
# Expected: non-zero exit, specific stderr message naming the missing context.

# Probe B: valid context, absent built CLI (run AFTER Step 4, per research.md R10)
mv <this-repository-root>/packages/cli/dist <this-repository-root>/packages/cli/dist.spike-backup
../adrkit-spike-fixture/scripts/probe.sh "<path-to-a-scratch-feature-with-plan.md>"; echo "exit=$?"
# Expected: non-zero exit, specific stderr message naming the missing built artifact.
mv <this-repository-root>/packages/cli/dist.spike-backup <this-repository-root>/packages/cli/dist   # restore
```

**Acceptance check**: matches `spec.md` US4 Acceptance Scenarios 1–2;
populates `absentContextProbe` and `absentCliProbe` per
`contracts/fixture-surface.md` §3–§4.

## Step 7 — Compute the Verdict (User Story 5; FR-018–FR-024; SC-007, SC-008)

Follow `contracts/evidence-bundle-and-verdict.md` §2's fixed precedence
procedure exactly: check `no-go` triggers first; if none fired, check `go`;
otherwise `manual-command-only`. Write `spike-008-evidence.json` and
`spike-008-evidence.md` to the executing session's own scratch artifacts
directory (never this repository — `research.md` R3/R4). If the verdict is
`go` or `manual-command-only`, append the non-binding recommendation per
`contracts/evidence-bundle-and-verdict.md` §3, with
`releaseVehicleDecision` fixed `null`. State explicitly, per §4 of that same
contract, that Phase 6 is landed / reference-verified (not externally validated), and that
this spike did not cause or advance that status.

Raw transcripts and scratch artifacts stay in the session-scoped scratch area.
If the executed spike is later landed in tracked history, FR-024 requires a
tracked, sanitized evidence index with commit SHAs, workflow-run links if any
workflow is used, content hashes, tool versions, network/credential limits,
negative-test results, and a reviewer verdict; do not copy raw transcripts into
the repository.

## Step 8 — Cleanup

- Delete (or leave, since nothing here is tracked) the three scratch
  directories from Steps 2–5.
- Confirm `packages/cli/dist` in this repository was restored in Step 6
  Probe B (never left renamed).
- Confirm no scratch artifact was ever staged or committed in this
  repository (`git status --porcelain=v1` at the repository root should show
  nothing related to this spike).
- Report the evidence bundle and verdict per this plan's Completion Report
  and this task's instruction to message the coordinating session — never
  open a PR, never commit the fixture, never claim Phase 6 external / community validation
  (ADR-0014 rung 3).

## What This Guide Deliberately Does Not Do

- It does not scaffold `packages/adapters/spec-kit` — that is out of scope
  for this entire feature (spec.md Out of Scope).
- It does not generate `tasks.md` — that was Phase 2 advance scoping; the existing tasks
  remain unchecked until actually executed.
- It does not decide where a future production adapter would publish or
  ship — `contracts/evidence-bundle-and-verdict.md` §3 fixes
  `releaseVehicleDecision` as permanently `null`.
