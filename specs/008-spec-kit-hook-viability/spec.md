# Feature Specification: Spec Kit Hook Compatibility Viability Spike

**Feature Directory**: `008-spec-kit-hook-viability`

**Implementation Branch**: Not yet assigned. Governance gates are satisfied; a future
execution session may open the spike's scratch/implementation branch once this migration merges.

**Created**: 2026-07-21

**Status**: scoped (spec → plan → tasks) — **execution authorized once this migration
merges; tasks remain unchecked until executed**. This document specifies a **non-shipping
compatibility spike**, not the production
Spec Kit adapter. Writing and refining this spec has always been permitted as advance scoping;
executing the spike (installing the fixture, firing the hook, gathering evidence) is now
authorized by governance once this migration merges. **Maintainer ratification of this spec's
exact scope was recorded 2026-07-21** (see the Ratification Record immediately after the gating
banner); Phase 6 is now **landed / reference-verified** under
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
not externally validated.

> ✅ **Status update — Executed 2026-07-22.** The scoping language above describes this
> spec's state *before* execution and is retained as the historical scoping record; it no
> longer describes the current state. The spike has since executed end-to-end with a
> recorded verdict **`no-go`** (mutation trigger). See
> [`tasks.md`](./tasks.md)'s executed-summary banner and
> [`checklists/evidence-index.md`](./checklists/evidence-index.md) for the authoritative,
> current status, including two explicit task exceptions (T005, T012) left unchecked per
> PR review.

**Kind**: Compatibility spike / advance scoping. This is not a `packages/adapters/spec-kit`
feature and does not deliver a production package. It maps to ADR-0003's action item 1
("Spike the extension hooks against current Spec Kit") and to the "Spec Kit extension" line
item under `plan.md`'s "Phase 6+ — Deferred" list. It precedes and is independent of Phase 6
(`specs/007-arb-queue/`); it does not depend on Phase 6's own feature content, only on its
landing.

**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the ADR
wins): [ADR-0003](../../docs/adr/0003-ship-as-spec-kit-extension.md) (extension-plus-CLI
distribution strategy; this spike is the pre-scoping evidence for that decision's still-open
action items), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md)
(adapter isolation; clean-clone, credential-free, network-free build and runtime
constraint), [ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun for development,
Node-targeted published `@adrkit/cli` artifact — the binary this spike must invoke),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(phase landing on rungs 1–2; external / community validation (ADR-0014 rung 3) as an optional
later maturity signal), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles
I–III (git is truth; clean clone builds green with no post-install network/credentials/
services; core and CLI depend on no adapter).

> ✅ **Governance gates satisfied — spike execution authorized once this migration merges; tasks below remain unchecked until executed.**
>
> 1. **Phase 6 gate — SATISFIED.** Under
>    [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
>    Phase 6 (`specs/007-arb-queue/`) is **landed / reference-verified** on ADR-0014 rungs
>    1–2, not externally validated. The reference evidence is the maintainer-owned isolated
>    reference repository `mbeacom/adrkit-t018-dogfood`, recorded for Phase 6 in
>    `specs/007-arb-queue/checklists/reference-verification-evidence.md`. `specs/007-arb-queue/tasks.md`
>    **T048-R** and dependent **T049** now read `- [X]`, and root `plan.md`'s Spec-kit
>    realization table row for `specs/007-arb-queue/` reads `landed / reference-verified`.
>    *Note for disambiguation: `T048`/`T049` also exist, already completed, in
>    `specs/005-deterministic-evaluator/tasks.md` — those are unrelated evaluator-routing
>    tasks and are not this gate; this gate is specifically `specs/007-arb-queue/tasks.md`
>    T048-R/T049.*
> 2. **This spike's own precondition — SATISFIED 2026-07-21.** Mirroring the explicit scope
>    ratification the maintainer recorded for Phase 5 (`specs/006-mcp-server/`, ratified
>    2026-07-20 per `plan.md`), the maintainer explicitly ratified this spec's exact scope on
>    **2026-07-21** — fixture design, frozen upstream reference, the two-tier agent-
>    verification split in Assumption A6, and the three-way verdict definition in Success
>    Criteria — per the Ratification Record immediately below. Advance **scoping** (this
>    document and its `plan.md`/`tasks.md`) remains exempt from execution gating, per
>    `plan.md`'s "Advance scoping ... is explicitly permitted" note.
>
> This spec may be read, reviewed, and refined at any time. With both governance gates now
> satisfied, a future execution session recomputing `tasks.md` T001–T003 after this migration
> merges should obtain `GATE_PASS = true`. Those tasks remain unchecked until that session
> actually executes them.
>
> **Execution prerequisites and sequence (technical, not removed by governance).** Governance
> authorizes this spike's execution but does not remove its technical prerequisites: Spec Kit
> `v0.13.0` at the fixed commit must be available and is **re-verified at execution, failing
> closed** (FR-001); the adrkit CLI must be **built** (`packages/cli/dist`, which does not exist
> on disk as of this writing — building it is part of execution); the live-agent probe requires
> an **isolated live Copilot session** and a **clean mutation baseline**. Per root `plan.md`,
> this spike (feature 008) is executed **before** feature 009 — the two are not run in parallel
> overall. This spike's `plan.md` row may claim `landed`/complete only **after** its own final
> report and independent evidence audit (its tracked, sanitized evidence index) exist, not
> merely because execution was authorized.

### Ratification Record

> **Maintainer ratification — 2026-07-21.** The maintainer explicitly ratified this spec's
> exact scope as written at the time of ratification: the fixed Spec Kit v0.13.0 /
> `9a30db484b0876cb7e5a391cf735d59bd968e985` target (FR-001, A1); exactly one namespaced,
> read-only fixture command and exactly one optional `after_plan` hook (FR-003, FR-004); the
> two-tier agent-verification split — live invocation for GitHub Copilot, structural-only
> verification for one second upstream-supported agent (FR-007, FR-008, Assumption A6); the
> offline, no-credential, no-mutation evidence requirements (FR-011, FR-012); and the exact
> three-way `go` / `manual-command-only` / `no-go` verdict with its precedence rule
> (Success Criteria SC-007). This ratification satisfies gate 2 of the governance gates above
> (FR-022(b), Assumption A10) as of 2026-07-21. Gate 1 is now also satisfied because Phase 6
> is landed / reference-verified under ADR-0014 rungs 1–2. This ratification record remains
> satisfied; it did not itself cause Phase 6 landing, and it does not claim external /
> community validation (ADR-0014 rung 3).

## Overview

Phases 0–6 (through Phase 6's landed / reference-verified status) made ADRs valid, locatable, importable, visible on the
PRs that govern them, routable without a meeting, readable by MCP-speaking agents, and
operationally queueable. ADR-0003 additionally commits this project to distribution as
*both* a standalone CLI (already shipping) *and* a Spec Kit extension — the surface where an
agent's own spec-driven workflow gets governance context injected automatically. That second
surface has never been built, and ADR-0003's own action item 1 says to spike it first rather
than commit to a production package sight-unseen.

Spec Kit's extension system is real, versioned infrastructure (manifest schema v1.0, a
catalog/install/enable/disable/remove lifecycle, and eighteen standard lifecycle hook
events including `after_plan`) maintained by a separate, fast-moving upstream project. Per
ADR-0007, any integration with it is an optional adapter that depends on `@adrkit/core`/
`@adrkit/cli`, never the reverse, and any production package must build and run without
credentials, network, or services after install. Before committing engineering time to that
production package, this spike answers a narrower, falsifiable question: **for one pinned,
immutable version of Spec Kit, does a minimal, read-only, namespaced extension command with
one optional `after_plan` hook actually install, register, fire with genuine plan context,
render for more than one supported agent, disable, and remove cleanly — while invoking
adrkit's own built, offline CLI without ever mutating a decision record?**

The spike produces exactly one artifact of consequence: an evidence-backed verdict —
`go`, `manual-command-only`, or `no-go` — that a later, separately-scoped feature can use to
decide whether (and how small) a production `packages/adapters/spec-kit` adapter should be.
It does not produce that adapter. It does not decide where that adapter's release artifacts
will live, how it will be published, or when it will ship — those remain open, later,
separately-scoped maintainer decisions that this spike's recommendation may inform but must
not make.

## User Scenarios & Testing

> **Execution authorization reminder.** Every scenario below describes what the spike
> execution must demonstrate once this governance migration merges. The tasks remain
> unchecked until an execution session actually runs them.

### User Story 1 — Freeze the upstream target and prove a clean local dev install (Priority: P1) 🎯 MVP

As the maintainer running this spike, I want to pin Spec Kit to one immutable, stable
(non-`.dev0`) release and commit SHA, then install a minimal manifest-v1 fixture extension
from a local directory using the documented development install path, so that every later
observation in this spike is reproducible against a fixed target rather than a moving
upstream `main`.

**Why this priority**: Nothing else in this spike is meaningful without a pinned,
reproducible target. Upstream `main` ships multiple releases a week (twenty released in the
eleven days preceding this spec) and its unreleased HEAD is already a `.dev0` prerelease at
the time of writing — freezing is not optional caution, it is the only way this spike's
findings stay true after the spike is done.

**Independent Test**: With no code changes to adrkit, install `specify-cli` pinned to the
frozen release, run `specify extension add --dev <path-to-fixture>` against a
scratch project, and confirm `specify extension list` reports it installed and enabled with
exactly one registered command and one registered hook — without any network access beyond
the one-time tool install itself.

**Acceptance Scenarios**:

1. **Given** the upstream Spec Kit repository, **When** the spike re-verifies its frozen
   target, **Then** it confirms that git tag `v0.13.0` still resolves to commit
   `9a30db484b0876cb7e5a391cf735d59bd968e985` and states the date this was re-verified — it
   does **not** select whatever release happens to be latest at that time, and a newer stable
   release having shipped in the interim does not change the target or require a substitute.
2. **Given** the frozen release and SHA, **When** the spike installs `specify-cli` at that
   exact version, **Then** `specify --version` reports exactly `0.13.0` and no later version
   is silently substituted.
3. **Given** a scratch project already initialized with `specify init`, **When** the spike
   runs `specify extension add --dev <path-to-fixture>`, **Then** the command
   succeeds, `specify extension list` shows the fixture installed and enabled with exactly
   one command and one hook, and the effective project extension configuration (FR-006)
   gains an `installed` entry and an `after_plan` hook entry for the fixture — with no other project file touched outside
   `.specify/` and the target agent's command-registration directory.

---

### User Story 2 — Prove a real `after_plan` hook fires with genuine plan context and calls adrkit's built CLI offline (Priority: P1)

As the maintainer, I want to run an actual `/speckit.plan` command in a live agent session
against a disposable scratch adrkit feature, accept the fixture's optional `after_plan`
hook when it is offered, and confirm the invoked command reads real just-generated plan
artifacts and shells out to adrkit's own built, offline Node CLI without any network access,
credentials, or ADR mutation — so that the riskiest, most load-bearing claim (that hooks are
real and safe, not theoretical) is settled with a transcript instead of an assumption.

**Why this priority**: This is the single fact ADR-0003's spike action item exists to
establish. If the hook does not fire, does not see real context, requires network access,
or risks mutating a decision record, no production adapter is worth scoping — this story
alone can produce a `no-go`.

**Independent Test**: Run `/speckit.plan` in a live GitHub Copilot session against a scratch
feature outside the committed `specs/` tree; when the plan command's "Mandatory
Post-Execution Hooks" section surfaces the fixture's optional hook with its prompt, accept
it; capture the full transcript including the `EXECUTE_COMMAND`/invocation line, the
fixture command's own output, its exit code, and a `git status --porcelain` diff taken
immediately before and immediately after the run.

**Acceptance Scenarios**:

1. **Given** the fixture is installed and enabled, **When** `/speckit.plan` completes Phase
   1 design for a scratch feature, **Then** the rendered plan command's Mandatory
   Post-Execution Hooks section names the fixture's extension, its command, and its prompt
   text, and offers it as an **optional** hook (never as an automatically-executed
   mandatory one) exactly as the fixture's manifest declares.
2. **Given** the operator accepts the offered hook, **When** the agent invokes it, **Then**
   the fixture command executes in the same session, reads the just-produced plan context
   (at minimum the scratch feature's directory and its just-written `plan.md`), and
   completes with exit code 0.
3. **Given** the fixture command executes, **When** it needs ADR governance data, **Then**
   it does so exclusively by spawning adrkit's built Node CLI (`packages/cli/dist/...`) as
   a subprocess — never by re-implementing corpus reading — with outbound network access
   disabled and no credential environment variables present, and the subprocess call and
   its output are captured verbatim in the evidence transcript.
4. **Given** the complete run (install through hook completion), **When** the spike diffs
   `docs/adr/**` and the repository's tracked files before and after, **Then** the diff is
   empty — no ADR content, no schema file, and no other tracked file changed.

---

### User Story 3 — Prove disable, remove, and multi-agent rendering behave as documented (Priority: P2)

As the maintainer, I want to disable the fixture and confirm its hook stops firing without
deleting it, then remove it and confirm no file, registry entry, or hook reference survives,
and separately confirm the fixture renders correctly for GitHub Copilot (this project's live
agent) and structurally validates for at least one second upstream-supported agent — so that
the eventual production adapter's lifecycle and cross-agent portability are known quantities
rather than untested assumptions.

**Why this priority**: A hook that cannot be safely turned off or fully uninstalled is not
production-viable regardless of how well it works while enabled, and ADR-0003 explicitly
targets agent-neutral distribution — an extension that only renders for one agent out of
thirty-plus supported ones is a materially different (and much smaller) proposition than one
that renders broadly.

**Independent Test**: With the fixture installed and its hook previously proven to fire
(User Story 2), run `specify extension disable <fixture-id>`, re-run `/speckit.plan`, and
confirm no hook is offered; then run `specify extension remove <fixture-id>` and confirm its
command/prompt files, its effective project extension configuration entries, and its extension registry
entry are all gone. Separately, in a disposable scratch project configured for a second
upstream-supported agent, install the fixture and inspect the rendered command/hook files
for structural correctness.

**Acceptance Scenarios**:

1. **Given** the fixture is installed and enabled, **When** the spike runs `specify
   extension disable <fixture-id>` and then re-runs `/speckit.plan`, **Then** the Mandatory
   Post-Execution Hooks section reports no hooks registered for `after_plan` (or explicitly
   skips), and the fixture's files remain on disk unchanged.
2. **Given** the fixture is disabled, **When** the spike runs `specify extension remove
   <fixture-id>`, **Then** its registered command file(s), its companion prompt file (for
   Copilot's legacy rendering mode), its `installed` and `hooks.after_plan` entries in
   effective project extension configuration, and its entry in the extension registry are all removed, and
   re-running `specify extension list` no longer shows it in any form.
3. **Given** GitHub Copilot is this repository's already-configured integration (legacy
   `.agent.md` + companion `.prompt.md` mode, not `--skills` mode), **When** the fixture is
   installed, **Then** its command renders as `.github/agents/speckit.<fixture-id>.<command>
   .agent.md` with a companion `.github/prompts/speckit.<fixture-id>.<command>.prompt.md`.
4. **Given** a disposable scratch project configured for one additional upstream-supported
   agent (Assumption A6 names the default candidate), **When** the fixture is installed
   there, **Then** its command and hook render into that agent's documented directory and
   file format with correct frontmatter and a correctly-substituted hook block — verified by
   inspection, without requiring a live conversational session in that second agent.

---

### User Story 4 — Prove honest failure when plan context or the built adrkit CLI is absent (Priority: P2)

As the maintainer, I want to invoke the fixture's command directly (outside any hook) once
with no adrkit feature/plan context present, and once with adrkit's built Node CLI artifact
missing from disk, so that the eventual production adapter's failure modes are proven safe —
never a silent success, never an unhandled crash — before any code that depends on those
assumptions gets written.

**Why this priority**: A governance-adjacent tool that fails silently is worse than one that
does not exist; this is a small, cheap probe that forecloses an entire class of later defect
reports.

**Independent Test**: Run the fixture's command directly from a directory with no adrkit
feature context (no reachable `specs/NNN-*/` and no valid `.specify/feature.json`) and
capture its exit code and message; separately, with a valid feature context but with
`packages/cli/dist` temporarily absent (the state this repository is actually in as of this
writing — the built CLI artifact does not yet exist on disk), run the command again and
capture its exit code and message.

**Acceptance Scenarios**:

1. **Given** no adrkit feature/plan context is reachable, **When** the fixture command is
   invoked directly, **Then** it exits non-zero with a specific, human-readable message
   naming the missing context — never exiting 0 and never emitting an unhandled stack trace.
2. **Given** a valid feature context but no built `packages/cli/dist` artifact on disk,
   **When** the fixture command is invoked directly, **Then** it exits non-zero with a
   specific, human-readable message naming the missing built artifact and, where
   practical, the command that would produce it — never a silent no-op.

---

### User Story 5 — Record one evidence-backed verdict for later production scoping (Priority: P1)

As the maintainer, I want the spike to conclude with exactly one of three defined verdicts —
`go`, `manual-command-only`, or `no-go` — each backed by the specific evidence gathered in
User Stories 1–4, plus (if the verdict is `go` or `manual-command-only`) a clearly
non-binding recommendation for the smallest later production slice, so that a future,
separately-scoped feature can decide whether to build `packages/adapters/spec-kit` without
re-litigating whether hooks work at all.

**Why this priority**: This is the deliverable the spike exists to produce; every other
story is evidence feeding this one conclusion.

**Independent Test**: Read the completed evidence bundle from User Stories 1–4 and confirm
it maps to exactly one verdict per the definitions in Success Criteria, with every piece of
required evidence present and cross-referenced.

**Acceptance Scenarios**:

1. **Given** all of User Stories 1–4 have produced their required evidence, **When** the
   spike concludes, **Then** exactly one of `go`, `manual-command-only`, `no-go` is recorded,
   matching the precise definition of that verdict in Success Criteria, with no ambiguity
   about which evidence drove the choice.
2. **Given** the verdict is `go` or `manual-command-only`, **When** the spike records its
   output, **Then** a "smallest later production slice" recommendation is included as an
   explicitly informational, non-binding note — never as an authorized task list, and never
   deciding the production package's eventual publish/release vehicle.
3. **Given** any verdict, **When** the spike records its output, **Then** it explicitly
   states that Phase 6 is landed / reference-verified (not externally validated), that this
   spike did not cause or advance that Phase 6 status, and that external / community
   validation (ADR-0014 rung 3) remains absent unless separately evidenced.

---

### Edge Cases

- What happens if `.specify/extensions.yml` already contains unrelated hook registrations
  (e.g., from a future, unrelated extension) when the fixture is installed? Installation
  must be additive — the fixture's `after_plan` entry must be appended, and pre-existing
  entries for other events or extensions must be left untouched.
- What happens if the fixture command is invoked manually (outside any hook) with full,
  valid plan context available? It must still run entirely offline, still exercise the
  built adrkit CLI as a subprocess, and still leave zero mutation — the read-only,
  network-free, credential-free behavior is a property of the command, not of how it is
  invoked.
- What happens on Windows path/line-ending conventions for the rendered command files? Out
  of scope for this spike (Assumption A9) — verification runs on the platforms available in
  this environment; a cross-platform rendering check is deferred to any later production
  feature.
- What happens if the pinned Spec Kit release is superseded by a newer stable release
  between this spec's approval and the spike's eventual execution (once this migration
  merges)? Nothing changes: the target remains exactly `v0.13.0` at the fixed commit — a
  newer stable release does not replace it and does not make this evidence run stale.
  FR-001 requires re-verifying that the `v0.13.0` tag still resolves to the fixed commit and
  that the installed CLI reports exactly `0.13.0`, failing closed rather than substituting a
  newer release if either check does not hold. Evaluating whether to run this spike again
  against a newer release, or building a compatibility matrix across releases, is a separate,
  later, explicitly-scoped decision for production adapter scoping — not something this
  spike's execution may decide on its own.
- What happens if `specify extension add --dev` reports success but no command file is
  actually written (a partial-install defect in the upstream tool itself)? The spike's
  evidence must include a direct file-existence check of the expected rendered path(s), not
  merely trust the CLI's own success message.
- What happens if the frozen upstream CLI follows the API Reference layout
  (`.specify/extensions/extensions.yml`) rather than the User Guide's documented
  `.specify/extensions.yml` path? The spike probes both locations, records which path the
  CLI actually wrote, and treats neither file existing (or conflicting files in both
  locations) as an install-evidence failure rather than silently treating either document
  as definitive.
- What happens if the second upstream-supported agent's rendering format changes in a way
  that breaks structural verification (e.g., a documented directory move)? That is itself a
  valid, reportable spike finding and — per SC-007's precedence rule — resolves to a
  `manual-command-only` verdict (or a `go` scoped to only the agent(s) that rendered
  cleanly) rather than being silently excluded from the evidence bundle or left unresolved.
- What happens if network access cannot be fully disabled in the execution environment
  (e.g., a shared sandbox with no per-process network isolation available)? The spike must
  use the strongest network-denial mechanism available (OS-level firewall rule, network
  namespace, or equivalent) and explicitly record which mechanism was used and its
  limitations, rather than silently skipping the offline requirement.

## Requirements

### Functional Requirements

- **FR-001**: This feature's immutable target is exactly Spec Kit release `v0.13.0`,
  resolving to commit `9a30db484b0876cb7e5a391cf735d59bd968e985` (the annotated tag's
  underlying commit, distinct from the tag object SHA, which is noted separately in
  Assumption A1). Immediately before spike execution begins, the spike MUST re-verify that
  tag `v0.13.0` still resolves to exactly that commit and that the installed `specify-cli`
  reports exactly version `0.13.0`. This is a re-verification of the fixed target, not a
  reselection: a newer stable upstream release having shipped in the interim does NOT
  replace the target, does NOT make this spec's target stale, and MUST NOT be silently
  substituted. If the tag no longer resolves to that commit, or the installed CLI reports a
  different version, the spike MUST fail closed — halt and require spec re-ratification —
  rather than proceed against a substitute version.
- **FR-002**: The compatibility fixture MUST be a valid Extension Manifest Schema Version
  1.0 document (`schema_version`, `extension.id`/`name`/`version`/`description`/`author`/
  `repository`/`license`, `requires.speckit_version`, `provides.commands`).
- **FR-003**: The fixture MUST declare exactly one command, namespaced as
  `speckit.<fixture-id>.<command-name>` per the upstream naming pattern, and that command
  MUST be read-only: it MUST NOT write to `docs/adr/**`, the ADR schema, any other tracked
  repository file, or any file outside its own scratch working area.
- **FR-004**: The fixture MUST declare exactly one hook, registered on the `after_plan`
  event, with `optional: true`. It MUST NOT be registered as a mandatory (`optional: false`)
  hook.
- **FR-005**: Local development install MUST use `specify extension add --dev <path>`
  against a local fixture directory — never the default catalog, never a remote
  `--from` URL.
- **FR-006**: Installation MUST be verified by (a) `specify extension list` reporting the
  fixture installed and enabled with exactly one command and one hook, (b) a corresponding
  `installed` entry and `hooks.after_plan` entry appearing in the project extension
  configuration path actually written by the frozen CLI (probe the User Guide path
  `.specify/extensions.yml` and the API Reference layout
  `.specify/extensions/extensions.yml`, record exactly one effective path), and
  (c) the extension registry recording the fixture with its registered command name(s).
- **FR-007**: For GitHub Copilot — this repository's already-configured integration, using
  its legacy `.agent.md` + companion `.prompt.md` rendering mode, not `--skills` mode —
  installation MUST render the fixture's command as `.github/agents/speckit.<fixture-id>.
  <command>.agent.md` with a companion `.github/prompts/speckit.<fixture-id>.<command>
  .prompt.md`, matching this project's existing rendering for the built-in `speckit.*`
  commands.
- **FR-008**: For at least one second upstream-supported agent (Assumption A6 names the
  default candidate), installation MUST be exercised in a disposable scratch project — never
  in this repository's live agent configuration — and the rendered command/hook file(s) MUST
  be inspected for structural correctness (correct directory, correct file extension,
  correct frontmatter, correctly-substituted hook block). A live conversational invocation
  in that second agent is explicitly not required (Assumption A6).
- **FR-009**: The `after_plan` hook MUST be proven to fire during a real, live `/speckit.plan`
  execution against a disposable scratch adrkit feature (Assumption A9) — not a simulated or
  hand-authored transcript — with the operator accepting the hook when it is offered as
  optional.
- **FR-010**: When invoked (via the hook or directly), the fixture command MUST read genuine,
  just-produced plan context (at minimum the scratch feature's directory path and its
  `plan.md` content) rather than operating on fixed or fabricated input.
- **FR-011**: When invoked (via the hook or directly), the fixture command MUST obtain any
  ADR governance data exclusively by spawning adrkit's built Node CLI artifact
  (`packages/cli/dist/...`, per ADR-0010) as a subprocess — never by re-implementing corpus
  parsing or reading `docs/adr/**` directly — and that subprocess call MUST run with outbound
  network access disabled and no credential environment variables set.
- **FR-012**: Every fixture invocation performed during this spike (install, hook fire,
  disable, remove, and both failure-mode probes) MUST be bracketed by a `git status
  --porcelain` capture (and, for the hook-fire scenario, a diff of `docs/adr/**`) taken
  immediately before and immediately after, and the evidence bundle MUST show these are
  identical in every case.
- **FR-013**: `specify extension disable <fixture-id>` MUST stop the `after_plan` hook from
  being surfaced on a subsequent `/speckit.plan` run while leaving the fixture's installed
  files unchanged on disk.
- **FR-014**: `specify extension remove <fixture-id>` MUST delete the fixture's registered
  command file(s) and companion prompt file(s), its `installed` and `hooks.after_plan`
  entries in the effective project extension configuration path recorded by FR-006, and its entry in the extension registry, leaving no
  orphaned command or hook reference.
- **FR-015**: Direct invocation of the fixture command with no adrkit feature/plan context
  reachable MUST exit non-zero with a specific, human-readable error naming the missing
  context — never exit 0, and never surface an unhandled stack trace.
- **FR-016**: Direct invocation of the fixture command with a valid feature context but with
  `packages/cli/dist` absent MUST exit non-zero with a specific, human-readable error naming
  the missing built artifact — never a silent no-op. Since FR-011/User Story 2 require
  `packages/cli/dist` to exist and be invoked successfully, this probe MUST be sequenced
  after that scenario, with `packages/cli/dist` deliberately removed or renamed for this
  probe only and restored (or rebuilt) afterward — the spike MUST NOT rely on coincidentally
  starting in the absent-artifact state.
- **FR-017**: All spike execution (installs, hook fires, disable/remove, failure-mode
  probes) MUST occur against a disposable scratch git branch/worktree and/or a scratch
  feature directory kept outside the committed `specs/` tree. No scratch ADR, no scratch
  spec feature, and no fixture artifact produced by this spike may be committed to `main` or
  merged into this repository's tracked history.
- **FR-018**: The spike MUST produce a single evidence bundle containing: the frozen
  version/SHA (FR-001), install/remove transcripts (FR-005/FR-006/FR-014), the registered
  file listing (FR-007/FR-008), the real `after_plan` invocation transcript (FR-009/FR-010),
  the offline built-CLI subprocess proof (FR-011), the no-mutation diff evidence (FR-012),
  and both absent-context/absent-binary failure transcripts (FR-015/FR-016).
- **FR-019**: The spike MUST conclude with exactly one of the three verdicts defined in
  Success Criteria (`go`, `manual-command-only`, `no-go`), with the evidence that drove the
  choice explicitly cross-referenced — never left implicit.
- **FR-020**: The spike MUST NOT introduce, modify, or propose a change to `docs/adr/**`,
  the ADR schema, the Pass 0 evaluator, the MCP server's tool surface, or any published
  package's version or git tag.
- **FR-021**: Any "smallest later production slice" recommendation the spike records MUST be
  presented as informational and non-binding, explicitly distinct from any authorized task
  list, and MUST NOT itself decide the eventual production package's publish/release
  vehicle, location, or timeline.
- **FR-022**: Spike execution is authorized once this migration merges because both
  governance gates are satisfied: (a) Phase 6 (`specs/007-arb-queue/`) is landed /
  reference-verified under [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
  with `specs/007-arb-queue/tasks.md` T048-R and dependent T049 checked and root `plan.md`'s
  Spec-kit realization row reading `landed / reference-verified`; and (b) the maintainer
  has explicitly ratified this spec's exact scope, mirroring the explicit scope ratification
  recorded in `plan.md` for Phase 5. (`plan.md` itself carries no task IDs; do not confuse
  the gate with the unrelated, already-completed T048/T049 pair in
  `specs/005-deterministic-evaluator/tasks.md`.)
- **FR-023**: The spike's output MUST NOT claim, imply, or record that Phase 6 has external /
  community validation (ADR-0014 rung 3), and MUST NOT imply this spike caused or advanced
  Phase 6's landed / reference-verified status.
- **FR-024**: If this non-shipping spike is later executed and landed in tracked repository
  history, raw transcripts and scratch artifacts MUST remain scratch-only, but landing MUST
  include a tracked, sanitized evidence index mirroring ADR-0014's rung-2 discipline. That
  index MUST carry the relevant commit SHAs, workflow-run links if any workflow is used,
  content hashes for the scratch evidence bundle, tool versions, network and credential
  limits, negative-test results (including the fail-closed probes), and a reviewer verdict.
  This requirement records the landing bar only; it does not fabricate or claim any such
  evidence before the spike is actually executed.

### Out of Scope

The following are explicitly excluded from this spike and MUST NOT be introduced during its
future planning or execution:

- A production `packages/adapters/spec-kit` package of any kind.
- A plan parser, a plan-to-ADR conversion pipeline, or draft-ADR generation from a plan
  artifact.
- Any evaluator Pass 1–3 (rubric/model-assisted) behavior; any model or provider API call of
  any kind.
- Any MCP write tool, or any change to the existing four read-only MCP tools' scope.
- Any GitHub pull request creation, branch creation on `main`, or commit to `main`.
- Any change to the ADR schema (`packages/core/src/schema/adr.schema.ts` or the published
  `schema/adr.schema.json`).
- Submission of the fixture (or any future production extension) to the Spec Kit community
  or default catalog.
- Any npm publication, package version bump, or git release tag change for any `@adrkit/*`
  package.
- Any claim, in this spec or its eventual evidence bundle, that Phase 6 (`specs/007-arb-queue/`)
  is externally validated, has external / community validation (ADR-0014 rung 3), or was
  landed / reference-verified by this spike.
- Any implementation task that silently decides the later production adapter's release
  vehicle, publish target, or ship timeline — those are separate, later, explicitly-scoped
  maintainer decisions this spike's recommendation may inform but must not make.
- Verification of hook `priority`-based ordering across multiple simultaneous hooks on the
  same event — this spike registers exactly one hook per Assumption A7, so only single-hook
  temporal correctness is in scope, not multi-hook priority resolution.
- Cross-platform (Windows path/line-ending) rendering verification (Assumption A9).

### Key Entities

- **Frozen Upstream Reference**: The single, immutable identification of the Spec Kit
  version this spike targets — exactly `v0.13.0` at commit
  `9a30db484b0876cb7e5a391cf735d59bd968e985` (FR-001). Re-verified against the upstream
  repository immediately before spike execution — confirming the fixed tag/commit/version
  still match, never reselecting a newer "latest" — and never silently substituted.

- **Compatibility Fixture**: A minimal, disposable, manifest-v1 Spec Kit extension created
  solely for this spike. Contains exactly one namespaced, read-only command and exactly one
  optional `after_plan` hook. Never published, never installed in this repository's live
  configuration beyond the spike's own scratch verification, and never a stand-in for a
  future production extension's actual id or scope (Assumption A5).

- **Evidence Bundle**: The complete, cross-referenced record the spike produces — frozen
  reference, install/remove transcripts, registered-file listings, the real hook-invocation
  transcript, the offline subprocess proof, the no-mutation diff evidence, and the two
  failure-mode transcripts (FR-018). This is the spike's actual deliverable; the fixture
  itself is disposable.

- **Verdict**: Exactly one of three enumerated outcomes recorded at the spike's conclusion —
  `go`, `manual-command-only`, `no-go` — each precisely defined in Success Criteria and each
  driven by specific evidence-bundle contents, never asserted without that evidence.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Given the frozen release and SHA, a local development install of the fixture
  (`specify extension add --dev <path>`) completes, and `specify extension
  list` reports it installed and enabled with exactly one registered command and one
  registered `after_plan` hook, using no network access beyond the one-time `specify-cli`
  tool installation that already exists in the verification environment.

- **SC-002**: A real, live `/speckit.plan` run against a disposable scratch adrkit feature
  surfaces the fixture's hook as optional, the operator's acceptance causes it to execute in
  the same session, the executed command reads genuine just-produced plan context, and it
  completes with exit code 0 having invoked adrkit's built Node CLI as an offline subprocess
  with no network access and no credentials.

- **SC-003**: `git status --porcelain` output and a diff of `docs/adr/**` are identical
  immediately before and immediately after every fixture invocation performed in the spike
  (install, hook fire, disable, remove, and both failure-mode probes) — zero mutation in
  every case.

- **SC-004**: Disabling the fixture stops its hook from being offered on a subsequent
  `/speckit.plan` run without deleting its files; removing it deletes every registered
  command file, companion prompt file, effective project extension configuration entry, and extension
  registry entry, leaving no orphaned reference.

- **SC-005**: GitHub Copilot rendering is verified via a real, live hook invocation
  (SC-002); at least one second upstream-supported agent's rendering is verified
  structurally (correct directory, file extension, frontmatter, and hook-block
  substitution) in a disposable scratch project, without requiring a live conversational
  session in that second agent (Assumption A6).

- **SC-006**: Direct invocation of the fixture command with no adrkit feature/plan context
  present, and separately with `packages/cli/dist` absent, both exit non-zero with a
  specific, human-readable error naming the missing dependency — never a silent success and
  never an unhandled stack trace, in either case.

- **SC-007**: The spike concludes with exactly one of the following three verdicts, applied
  in the fixed precedence order below (evaluate `no-go` first; if it does not trigger,
  evaluate `go`; if that does not trigger either, the result is `manual-command-only` by
  exhaustive fallback — every possible evidence outcome resolves to exactly one verdict, and
  no evidence pattern can satisfy more than one). The report states which evidence-bundle
  contents (FR-018) drove the choice.
  - **`no-go` (checked first; dominates all other results)** — any of the following was
    observed: a mutation (SC-003 failed), the fixture could not be safely disabled or fully
    removed (SC-004 failed), a required failure-mode probe was unsafe (SC-006 failed), or the
    live `after_plan` hook could not be fired at all (e.g., it crashed the agent session,
    corrupted repository state, or never surfaced). If any of these occurred, the verdict is
    `no-go` regardless of how well any other scenario performed. No production Spec Kit
    integration is recommended at this time; the underlying finding is recorded so a future
    re-attempt does not repeat the same failure blind.
  - **`go` (checked second)** — no `no-go` trigger fired, **and** every acceptance scenario
    in User Stories 1–4 passed exactly as specified: install, real hook-fire with genuine
    context, offline subprocess invocation, zero mutation, clean disable/remove, Copilot live
    rendering, second-agent structural rendering, and both honest-failure probes. A
    production `packages/adapters/spec-kit` adapter (hooks and namespaced commands both) is
    recommended for later, separate scoping.
  - **`manual-command-only` (exhaustive fallback)** — no `no-go` trigger fired, but the
    result falls short of full `go` in any way that is not itself unsafe. This covers, at
    minimum, two named cases and any other non-unsafe shortfall: (a) the namespaced read-only
    command verified cleanly (User Stories 1, 4, and Copilot rendering in User Story 3) but
    the `after_plan` hook mechanism itself (User Story 2) proved unreliable or
    context-starved in a way a manually-invoked command would not inherit; and (b) everything
    else passed but the second upstream-supported agent's structural rendering (User Story 3,
    SC-005) was only partial or failed (the Edge Cases case explicitly noted above). A
    production extension limited to manual namespaced commands (no lifecycle hooks, and/or
    scoped to only the agent(s) that rendered cleanly) is recommended for later, separate
    scoping, and the specific shortfall that prevented `go` is named explicitly.

- **SC-008**: Regardless of verdict, the spike's output explicitly states that Phase 6
  is landed / reference-verified (not externally validated), that this spike did not cause
  or advance that status, and that external / community validation (ADR-0014 rung 3) remains
  absent unless separately evidenced.

## Output Recommendation (Informational, Non-Binding)

*This section exists so the spike's eventual output has a place to record a
recommendation — it is deliberately unwritten until the spike executes. If the verdict is
`go` or `manual-command-only`, the evidence bundle's report MUST append, here or in a linked
follow-up document, a short "smallest later production slice" recommendation identifying the
minimal viable production scope (e.g., manual command only vs. command-plus-hook, which
existing `@adrkit/cli` read command to wrap, which single agent to render for first). That
recommendation MUST be clearly labeled non-binding per FR-021 and MUST NOT itself schedule,
authorize, or scope a `packages/adapters/spec-kit` implementation — that remains a separate,
later, explicitly-scoped feature.*

## Assumptions

- **A1**: This feature's immutable target is exactly Spec Kit release **v0.13.0**, resolving
  to commit **`9a30db484b0876cb7e5a391cf735d59bd968e985`** in `github/spec-kit` (the
  annotated tag `v0.13.0` itself resolves to tag object
  `7c95192e6b1a164f5294cc9f2e3851b28d3ba171`, whose target commit is the SHA above). At this
  spec's writing (2026-07-21), v0.13.0 was the latest stable, non-`.dev0` release —
  upstream `main` was already past it, at prerelease version `0.13.1.dev0` — but that
  historical fact is not what pins the target: the target is this exact tag/commit/version,
  fixed by this spec, regardless of what upstream releases next. Immediately before spike
  execution begins, FR-001 requires re-verifying that tag `v0.13.0` still resolves to this
  exact commit and that the installed CLI reports exactly `0.13.0` — a re-verification of
  this fixed target, never a reselection of "whatever is latest now." A newer stable release
  having shipped in the interim does not replace this target and does not make this spec
  stale; it is out of scope for this evidence run (see the corresponding Edge Case). If the
  tag/commit/version no longer match at execution time, the spike MUST fail closed and
  require spec re-ratification rather than substitute a different version.

- **A2**: The `specify-cli` Python package (console script `specify`) is the reference
  implementation of the Spec Kit CLI. At spec-writing time, this verification environment
  already has `specify-cli` v0.13.0 installed via `uv tool install`, matching A1 exactly and
  matching this repository's own `.specify/init-options.json` (`"speckit_version":
  "0.13.0"`) — no reinstall of the base Spec Kit tooling is required to begin the spike once
  this migration merges, only the FR-001 re-verification that the installed CLI still reports
  exactly `0.13.0` and that tag `v0.13.0` still resolves to the fixed commit in A1. This
  re-verification is not a check for whether a newer stable release exists.

- **A3**: The compatibility fixture uses a throwaway extension id (e.g. `adrkit-spike`),
  deliberately distinct from whatever id a future production extension chooses. The fixture
  is never installed as a stand-in for that future extension's real scope and is discarded
  after the spike, not evolved in place into a production package.

- **A4**: The fixture's single command wraps an existing, already-shipped, read-only
  `@adrkit/cli` command (for example `adr explain <path>` against the scratch feature's own
  directory, or `adr queue --format json`) rather than inventing new adrkit behavior. The
  exact command wrapped is an implementation detail left to spike execution; the property
  this spec requires is that it is an *existing* read-only command invoked via subprocess
  (FR-011), not a new code path.

- **A5**: GitHub Copilot verification in this spike uses this repository's already-installed
  legacy rendering mode (`.github/agents/*.agent.md` + companion `.github/prompts/*.prompt.md`
  files, per `.specify/init-options.json`), not the newer `--skills` mode
  (`.github/skills/speckit-<name>/SKILL.md`) that upstream Spec Kit is transitioning Copilot
  toward by default. If upstream removes legacy-mode support entirely before this spike
  executes, FR-007 and this assumption MUST be re-verified and, if necessary, revised before
  proceeding.

- **A6**: Verification is two-tier by necessity, not by choice: GitHub Copilot gets full,
  live, conversational verification because it is the only agent runtime available in this
  environment (User Story 2, SC-002); the second upstream-supported agent gets structural
  rendering verification only (correct file, directory, frontmatter, and hook-block
  substitution), without a live invocation in that agent's own runtime (User Story 3, SC-005).
  **Claude Code** is the default candidate for the second agent, since it is the most
  thoroughly documented integration in Spec Kit's own extension guide; if Claude Code proves
  impractical to scaffold in a scratch project during execution, Gemini CLI is an acceptable
  substitute, and the choice actually used MUST be recorded in the evidence bundle.

- **A7**: The fixture registers exactly one hook, on `after_plan`, with `optional: true`.
  Multi-hook priority-ordering behavior (documented upstream as ascending `priority`, lower
  runs first, stable sort on ties) is explicitly not exercised or verified by this spike —
  only single-hook temporal correctness (the hook fires between Phase 1 design output and
  the plan command's Completion Report) is in scope, consistent with the Out of Scope
  section.

- **A8**: This spike's execution (installs, hook fires, disable/remove, failure probes, and
  the one live `/speckit.plan` run) occurs entirely against a disposable scratch git
  branch/worktree and a scratch feature directory kept outside the committed `specs/` tree —
  never against `main`, and never producing a committed scratch ADR or scratch spec feature.
  The scratch feature used to exercise `/speckit.plan` in User Story 2 is created solely for
  this purpose and is not intended to become a real numbered feature in this repository's
  `specs/` tree.

- **A9**: Cross-platform (Windows path separator and line-ending) rendering behavior is out
  of scope for this spike. Verification runs on the platform(s) available in this
  environment; a cross-platform check, if warranted, belongs to any later production
  feature, not this spike.

- **A10**: Implementation of this spike (the actual execution described in User Stories 1–4)
  requires both governance gates in this spec's banner to be satisfied: Phase 6 must be
  landed / reference-verified under
  [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  (`specs/007-arb-queue/tasks.md` T048-R with dependent T049 checked, not the unrelated,
  already-completed T048/T049 pair in `specs/005-deterministic-evaluator/tasks.md`) and the
  maintainer must explicitly ratify this spec's exact scope. Both gates are now satisfied:
  maintainer ratification was recorded 2026-07-21, and Phase 6 is landed /
  reference-verified (not externally validated). Spike execution is authorized once this
  governance migration merges; the tasks remain unchecked until actually executed. This
  spec's own creation and refinement — the advance-scoping activity itself — is, and always
  was, exempt from execution gating, per `plan.md`'s advance-scoping-vs-implementation split.

- **A11**: This spike does not add, and its fixture must not be mistaken for, a fifth MCP
  tool, a write MCP tool, an evaluator rubric pass, or any HTTP service. It is a Spec Kit
  extension fixture and nothing else; any future integration between adrkit's MCP server or
  evaluator and Spec Kit is a separate, later, explicitly-scoped feature.
