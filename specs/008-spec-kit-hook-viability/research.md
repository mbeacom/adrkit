# Research: Spec Kit Hook Compatibility Viability Spike

**Feature**: `008-spec-kit-hook-viability` | **Companion to**: [plan.md](./plan.md)

All items below are implementation-planning decisions this task required
resolving, without broadening the spec's ratified scope. Where a decision
touches upstream behavior, the citation is an immutable
`raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/...`
or `github.com/github/spec-kit/tree/9a30db484b0876cb7e5a391cf735d59bd968e985/...`
URL fetched live during this planning session — never `main`, never
paraphrased from general model knowledge. Every fetch happened on 2026-07-21.

## R1 — Upstream Citation Discipline

**Decision**: Every factual claim about Spec Kit's manifest schema, hook
system, or CLI lifecycle commands in this plan and its contracts is sourced
from one of these three documents, fetched at the frozen commit:

| Document | Immutable URL |
|---|---|
| Extension API Reference (manifest v1.0 schema, hook system, CLI commands, registry JSON shape, file-system layout) | `raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/extensions/EXTENSION-API-REFERENCE.md` |
| `plan.md` command template (the "Mandatory Post-Execution Hooks" rendering rules for `after_plan`) | `raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/templates/commands/plan.md` |
| Extension User Guide (install/list/disable/remove/update transcripts, `.specify/extensions.yml` shape, best practices for what to commit vs. gitignore) | `raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/extensions/EXTENSION-USER-GUIDE.md` |
| Extension Development Guide (manifest quick-start, command file format, `.extensionignore`, manual testing/removal flow, validation rules) | `raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/extensions/EXTENSION-DEVELOPMENT-GUIDE.md` |

**Rationale**: FR-001 requires re-verification, not reselection, and this
spec's entire evidentiary value depends on every downstream design decision
tracing to the pinned commit. Fetching `main` or relying on trained-in
knowledge of Spec Kit (which predates or postdates this exact commit) would
silently reintroduce the moving-target problem the freeze exists to prevent.

**Alternatives considered**: Trusting general model knowledge of "Spec Kit
extensions" — rejected outright; the spec's own Verification note in
`checklists/requirements.md` already establishes the precedent that this
project verifies against the frozen commit's actual rendered content, not
general knowledge, and this plan holds itself to the same standard. Fetching
upstream `main` for "the latest docs" — rejected; `main` was already at
prerelease `0.13.1.dev0` when the spec was written (spec.md Overview) and the
extension system is explicitly called out as fast-moving.

**Corroboration**: `templates/commands/plan.md` at the frozen commit is
byte-identical in its "Pre-Execution Checks" and "Mandatory Post-Execution
Hooks" sections to the `<agent_instructions>` this planning session itself
operated under — an independent, structural confirmation that the commit
pinned in `spec.md` A1 is in fact the one whose behavior this repository's own
`.specify/` tooling exercises today.

## R2 — Fixture Identity and Wrapped Command

**Decision**: The fixture's throwaway extension id is `adrkit-spike`
(Assumption A3 already names this as the example; this plan fixes it as the
actual value, not merely an example). Its one command,
`speckit.adrkit-spike.probe`, wraps the existing, already-shipped
`adr queue --format json` command (`packages/cli/src/queue.ts`, registered in
`packages/cli/src/index.ts`) as its adrkit-CLI subprocess call.

**Rationale**: Assumption A4 requires "an existing read-only command invoked
via subprocess... not a new code path," naming `adr explain <path>` or
`adr queue --format json` as the two candidates and leaving the exact choice
to spike execution. This plan resolves that choice at design time because
`data-model.md` and `contracts/fixture-surface.md` need one concrete example
to fully specify: `adr queue` takes no positional record path argument, so it needs
no knowledge of which file inside the scratch feature directory to target. The probe
pins `--dir` to this repository's `docs/adr` corpus and expects exit `0` only when that
directory is reachable and has no error-severity corpus findings, per
`specs/007-arb-queue/contracts/cli-contract.md`; any non-zero result is captured honestly,
never described as an unconditional command guarantee. Its JSON output is a single
bounded object, cheap to embed verbatim in an evidence transcript.
`adr explain <path>` remains available as a documented alternative if a future
execution session finds a reason to prefer it — this decision does not forbid
substituting it, it only fixes what this plan's own artifacts illustrate.

**Alternatives considered**: `adr explain <path>` — rejected as the
*documented example* only because it requires picking a plausible in-corpus
path from the scratch feature, adding a design-time judgment call this plan
does not need to make; `adr lint` — rejected because its exit code is
`exitCodeForFindings`-driven and can be non-zero on a healthy corpus with only
warnings, which would make the fixture's own exit-code contract
(`contracts/fixture-surface.md`) needlessly conflate "adrkit found lint
warnings" with "the fixture failed," muddying FR-015/FR-016's honest-failure
requirement.

## R3 — Scratch Artifact Locations

**Decision**: All spike execution artifacts — the fixture's extension
directory, the scratch adrkit feature used for the live `/speckit.plan` run,
and the evidence bundle itself — live in exactly one of two places, both
outside this repository's tracked tree and both excluded from every git index
that could ever commit them:

1. **Fixture source and scratch project**: a disposable directory outside any
   git-tracked clone of `mbeacom/adrkit` entirely (e.g. a fresh `git init`
   scratch worktree or an unrelated temp directory) — never a branch of
   *this* repository, because FR-017 requires "a disposable scratch git
   branch/worktree **and/or** a scratch feature directory kept outside the
   committed `specs/` tree," and the stronger reading (a wholly separate
   scratch project) is chosen because it makes "no fixture artifact... may be
   committed to `main`" true by construction rather than by discipline: there
   is no `main` to accidentally commit to.
2. **Evidence bundle**: the executing session's own session-state artifacts
   directory (this planning session's equivalent is
   `~/.copilot/session-state/<session-id>/files/`; a future execution
   session uses whatever the equivalent is for that session) — never a path
   under this repository's working tree, tracked or not, so that even an
   accidental `git add -A` in this repository cannot pick it up.

**Rationale**: FR-017/A8 require that the scratch work never becomes a
committed spec feature or ADR. Using a session-scoped artifacts directory for
the evidence bundle (rather than, say, a `.gitignore`d directory inside this
repository) removes the failure mode entirely rather than mitigating it —
matching this repository's own convention (`.gitignore`'s "Test scratch data"
section already documents that pattern for other tooling) while going one
step further for an artifact that must never even risk being staged.

The scratch fixture receives the adrkit checkout as an explicit, non-secret execution
input named `ADRKIT_REPO_ROOT`. It MUST resolve to this repository's canonical root and
contain both `packages/cli/dist/index.js` and `docs/adr/`; the fixture MUST NOT infer it
with `git rev-parse` from the separate scratch project. `ADRKIT_REPO_ROOT` is admitted by
the environment allowlist solely as a local path, never as a credential.

**Alternatives considered**: A `.gitignore`d directory inside this repository
(e.g. `.spike/`) — rejected; it is still inside the repository's working
directory, so a future contributor's `git add .` or a misconfigured CI
checkout step could surface it, and it adds a new top-level ignored directory
for a single disposable spike. A separate throwaway GitHub repository —
rejected as unnecessary ceremony for a spike whose entire premise is "cheap
and reversible" (root `plan.md`'s framing of advance work).

## R4 — Evidence Bundle Filenames and Format

**Decision**: The evidence bundle is exactly two scratch files, both written
to the executing session's own artifacts directory (R3), never to this
repository:

- `spike-008-evidence.md` — the human-readable report: frozen-reference
  re-verification result, one subsection per User Story 1–4 with its
  transcript excerpts and pass/fail per acceptance scenario, the User Story 5
  verdict with cross-referenced evidence, and (if `go` or
  `manual-command-only`) the non-binding recommendation.
- `spike-008-evidence.json` — the machine-checkable manifest: the exact shape
  defined in `contracts/evidence-bundle-and-verdict.md`, so that "the
  evidence that drove the choice explicitly cross-referenced — never left
  implicit" (FR-019) is enforceable by structure, not only by prose
  discipline.

**Rationale**: Two files, not one, because FR-018's bundle mixes prose
transcripts (naturally Markdown) with the fixed, checkable
`Verdict`/`EvidenceBundle` shape from `data-model.md` (naturally JSON); merging
them into one file would force one format to compromise the other. Both files
share one basename stem (`spike-008-evidence.*`) so they are trivially
associated without a third index file.

**Alternatives considered**: A single JSON file with an embedded Markdown
prose field — rejected as harder for a human reviewer (the maintainer, per
User Story 5) to read directly. Per-user-story files (four or five small
files) — rejected as unnecessary fragmentation for a bundle whose entire
purpose is to be read once, end to end, to produce one verdict.

## R5 — Command/Environment Capture Method

**Decision**: Every fixture invocation (install, hook fire, disable, remove,
both failure probes, and the direct manual invocation from the Edge Cases
section) is captured as a plain-text transcript containing, in order: (a) the
exact command line invoked, (b) the resolved, allowlisted environment (R6)
the subprocess actually ran under, (c) stdout, (d) stderr, (e) the exit code,
and (f) the immediately-preceding and immediately-following
`git status --porcelain` output (R7). The subprocess call from the fixture's
own command to adrkit's built CLI is captured the same way, nested one level
under the fixture invocation that triggered it.

**Rationale**: FR-012 requires the before/after `git status` bracketing for
every invocation, and FR-011 requires the offline subprocess proof to be
"captured verbatim in the evidence transcript." A single, uniform
capture shape for every invocation (rather than a bespoke format per user
story) makes the evidence bundle's JSON manifest (R4) mechanically derivable
from the transcripts rather than hand-summarized, which is itself part of
what makes the bundle trustworthy.

**Alternatives considered**: Relying on the coding agent's own conversational
transcript as the evidence — rejected; FR-012's bracketing requirement is
specific and mechanical, and a conversational transcript is not guaranteed to
capture a `git status --porcelain` immediately before *and* immediately after
every single invocation unless that capture is an explicit, designed step.

## R6 — Secret Scrubbing

**Decision**: Environment capture (R5) is **allowlist-based, never
denylist-based**: the transcript records only the specific environment
variables the fixture's command and the nested `adr` subprocess call actually
need to function (at minimum: `PATH`, and whatever POSIX-mandated variables
the shell itself requires), and every other ambient variable is omitted from
the captured transcript entirely — not redacted, omitted. Before the evidence
bundle is written to its final files (R4), a mechanical grep pass checks the
transcript text against a short list of high-signal secret-shaped patterns
(`TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `_AUTH`, and any environment variable
name containing them) as a second, independent check that nothing sensitive
slipped in despite the allowlist.

The fixture subprocess allowlist contains exactly `PATH` and
`ADRKIT_REPO_ROOT`. The latter is a canonical local filesystem path validated against
the expected built CLI and corpus before invocation; it is evidence input, not a secret
or endpoint.

**Rationale**: An allowlist is strictly stronger than a denylist for this use
case, because a denylist can only ever redact patterns someone thought to
list, while an allowlist bounds the captured surface to exactly what is
needed regardless of what else happens to be set in the executing shell.
FR-011 already requires "no credential environment variables present" for the
nested subprocess call specifically; this decision extends the same discipline
to every captured invocation in the bundle, not only that one.

**Alternatives considered**: Capturing the full environment and redacting
known-sensitive variable names after the fact — rejected as the weaker,
denylist-shaped approach the allowlist strictly dominates. Not capturing
environment at all — rejected; FR-011's "no credential environment variables
present" claim needs to be *evidenced*, not merely asserted, and an
allowlisted capture is what makes that verifiable rather than trust-based.

## R7 — Mutation Baselines

**Decision**: The exact commands run immediately before and immediately after
every fixture invocation are `git status --porcelain=v1` (run from the
repository root of whichever git tree is under test — the scratch project for
install/disable/remove/failure-probes, and this repository's own worktree
specifically for the live `/speckit.plan` hook-fire scenario in User Story 2,
since that scenario's "docs/adr/** and the repository's tracked files" diff
(FR-012 Acceptance Scenario 4) is necessarily checked against *this*
repository, not the scratch one) plus, for that same hook-fire scenario only,
`git diff --stat -- docs/adr` scoped specifically to the ADR corpus path
FR-012 names. `--porcelain=v1` (not the default, which is itself `v1`, but
pinned explicitly) guarantees the machine-parseable two-column status format
is stable across git versions, which matters because the evidence bundle's
JSON manifest (R4) records these captures as structured, comparable values,
not free text.

**Rationale**: SC-003 requires the porcelain-status and the `docs/adr/**`
diff to be "identical immediately before and immediately after every fixture
invocation." Pinning the porcelain format version removes one axis of
non-determinism from that identity check. Scoping the `docs/adr` diff to only
the User Story 2 hook-fire scenario (rather than running it for every single
invocation) matches FR-012's own scenario 4 language exactly — the other
scenarios' mutation check is the porcelain status alone, since they act on
the scratch project, which has no `docs/adr/**` to diff in the first place.

**Alternatives considered**: `git diff --stat` unscoped (the whole repository)
for every invocation — rejected as needlessly broad for the install/
disable/remove/failure-probe scenarios, which never touch this repository's
working tree at all (they act on the scratch project); the unscoped diff
would just be noise there. Hashing the entire `docs/adr/` tree instead of
`git diff --stat` — rejected as strictly more work for the same guarantee
`git diff --stat -- docs/adr` already gives against a tracked git tree.

## R8 — Network Denial Mechanism Hierarchy

**Decision**: A future execution session applies the strongest mechanism
available in its actual environment, in this ranked order, and records
exactly which one it used (per the Edge Cases note in spec.md, "explicitly
record which mechanism was used and its limitations, rather than silently
skipping the offline requirement"):

1. **OS-level network namespace or firewall isolation** (e.g. Linux
   `unshare --net`, a container run with `--network none`, or an equivalent
   sandboxing primitive that makes an attempted outbound connection fail at
   the kernel). Strongest: failure is enforced, not merely observed.
2. **Process-level egress blocking** (e.g. an OS firewall rule scoped to the
   specific process/user, such as `pfctl` on macOS or `iptables`/`nftables`
   on Linux, applied for the duration of the invocation only). Strong, but
   requires privileges the execution environment may not grant.
3. **Allowlisted-environment plus static call-site review** (R6's allowlist
   ensures no credential or endpoint configuration is present for the
   subprocess to use even if it tried to reach the network, *and* the
   fixture's command source is short enough to read in full and confirm its
   only external process invocation is the adrkit CLI subprocess call —
   which is itself independently known to be offline by construction, since
   `@adrkit/cli`'s own commands read only the local filesystem). Weakest of
   the three, and the one most likely to be what a shared, unprivileged
   sandbox (such as this planning session's own execution environment)
   actually has available.

**Honest limitation, recorded now rather than discovered at execution time**:
mechanism 3 alone does not *prove* the absence of a network call the way
mechanisms 1–2 do; it establishes that no credential or endpoint is configured
for one to succeed against, corroborated by a source-level review of a command
short enough to review completely. If a future execution session's
environment supports only mechanism 3, the evidence bundle MUST say so
explicitly, in exactly the words this research item uses, rather than
implying an OS-level guarantee that was not actually available.

**Rationale**: This directly resolves the Edge Cases bullet on network
denial. Presenting the honest, ranked hierarchy at design time — rather than
promising a specific mechanism that may not exist in whatever environment
eventually executes this spike — keeps the spec's own "never silently
skipping the offline requirement" instruction true regardless of that
environment's privileges.

**Alternatives considered**: Mandating mechanism 1 or 2 unconditionally —
rejected; this planning session's own host has no evidence of the root/
container privileges either would require, and mandating an unavailable
mechanism would either block a future execution session outright or invite
quietly skipping the requirement, which is exactly what the Edge Case warns
against.

## R9 — Upstream Install/List/Disable/Remove Lifecycle Commands

**Decision**: Fixed, verbatim from `EXTENSION-API-REFERENCE.md` and
`EXTENSION-USER-GUIDE.md` at the frozen commit (R1) — no invention, no
paraphrase drift:

| Step | Exact command |
|---|---|
| Local dev install | `specify extension add --dev <path-to-fixture>` (per `EXTENSION-DEVELOPMENT-GUIDE.md` §"Test Locally"; note the User Guide's positional-form example `specify extension add --dev /path/to/extension` and the API Reference's `--dev PATH` option under `extension add` are the same flag) |
| Verify install | `specify extension list` |
| Disable | `specify extension disable adrkit-spike` |
| Re-enable (cleanup path only — not exercised as an acceptance scenario) | `specify extension enable adrkit-spike` |
| Remove | `specify extension remove adrkit-spike` (add `--force` to skip the interactive confirmation `EXTENSION-USER-GUIDE.md` documents, since this spike's execution is scripted, not interactive) |

Registry/config file locations the evidence bundle inspects directly (not
only trusting the CLI's own success messages, per the Edge Cases note on
partial-install defects):

- `.specify/extensions.yml` (project-level `installed` list and `hooks.<event>`
  entries — the exact YAML shape is in `EXTENSION-USER-GUIDE.md`
  §"Project-Wide Extension Settings")
- `.specify/extensions/.registry` (JSON registry; shape documented in
  `EXTENSION-API-REFERENCE.md` §"Registry Format")
- `.github/agents/speckit.adrkit-spike.probe.agent.md` +
  `.github/prompts/speckit.adrkit-spike.probe.prompt.md` (this repository's
  own legacy Copilot rendering mode — the render target is fixed by FR-007,
  not by upstream default, since upstream's own current default for newer
  Copilot setups is `--skills` mode, per `EXTENSION-USER-GUIDE.md`'s
  "Automatic Agent Skill Registration" section, which this repository does not
  use, per `.specify/init-options.json`)

**Rationale**: FR-005/FR-006/FR-013/FR-014 all name specific upstream CLI
behavior; resolving the exact command-line forms and file paths at design
time (rather than leaving them for an execution session to look up again)
means `contracts/lifecycle-evidence.md` can state a precise, checkable
contract instead of a description.

**Alternatives considered**: None — this is a transcription task, not a
design choice; the only decision made here is to add `--force` to the remove
step for scripted, non-interactive execution, which the User Guide documents
as a supported option.

## R10 — Cleanup and Recovery After Failure

**Decision**: Each of the two failure-mode probes (FR-015 absent-context,
FR-016 absent-built-CLI) has an explicit, idempotent recovery step recorded
before it runs, not improvised after:

- **FR-015 probe (absent context)**: no recovery needed — the probe is run
  from a directory with no adrkit feature/plan context by construction (e.g.
  the scratch project's own root, before any scratch feature is created, or a
  wholly unrelated empty directory); nothing needs to be restored afterward
  because nothing was removed to create the precondition.
- **FR-016 probe (absent built CLI)**: FR-016 itself requires this to be
  sequenced *after* User Story 2/FR-011 (which needs `packages/cli/dist` to
  exist and succeed), so the recovery contract is: rename
  `packages/cli/dist` to `packages/cli/dist.spike-backup` (never delete it),
  run the probe, then rename it back before any later scenario that needs the
  built CLI runs again. If the rename-back step fails for any reason, the
  evidence bundle records that failure explicitly and the spike halts rather
  than continuing with a repository in an ambiguous build state — this
  recovery step touches only a `dist/` build output (never tracked by git;
  rebuilding it with `bun run build` is always available as a fallback
  recovery path if the rename-back itself is somehow lost).

**Rationale**: FR-016's own text already sequences this probe after FR-011
and says the spike "MUST NOT rely on coincidentally starting in the
absent-artifact state" for this specific probe — but it is silent on how the
artifact is restored afterward. Naming rename-not-delete as the mechanism, and
a full rebuild as the always-available fallback, closes that gap without
introducing any new risk to a tracked file (build output is gitignored and
reproducible by construction).

**Alternatives considered**: Deleting `dist/` for the probe and rebuilding it
afterward — rejected as strictly more expensive and riskier (a failed rebuild
leaves the repository in the absent-artifact state for every subsequent
scenario) than a rename that can be undone with a single filesystem
operation.

## R11 — Constitution Alignment

All five principles PASS both before and after design. See `plan.md`'s two
Constitution Check tables for the full per-principle notes. No entry in this
research file introduces a dependency, a workspace package, a schema change,
or a probabilistic step — the strongest single-sentence summary of why this
plan clears every gate is that it produces no artifact any gate is designed
to inspect.

## R12 — Status Drift Check

Re-confirmed during this planning session (2026-07-21), independent of what
`spec.md` already states:

- Root `plan.md`'s Spec-kit realization table still records Phase 6
  (`specs/007-arb-queue/`) as "implementation in progress (kernel + `adr queue`
  CLI + queue Action complete, all gates green); external-team rung 6 exit
  gate (SC-004) outstanding" — unchanged from `spec.md`'s own banner claim.
  Gate 1 of this spec's double gate remains open.
- `packages/cli/dist` still does not exist on disk in this working tree
  (confirmed by direct directory listing during this planning session) —
  unchanged from spec.md A2's stated starting condition. FR-016's probe
  therefore still has a real starting condition to exercise once execution is
  authorized, exactly as A2 anticipated.
- `packages/cli/src/index.ts` still exposes exactly the eight commands `lint`,
  `migrate`, `new`, `graph`, `explain`, `check`, `evaluate`, `queue` — `adr
  queue --format json` (R2's chosen wrapped command) is confirmed present and
  unchanged.

No drift found. This plan's decisions above remain valid against the
repository's actual current state.

## R13 — Reader Test

A fresh-context, adversarial reader test of the complete planning artifact
set — `plan.md`, this file, `data-model.md`, `quickstart.md`, and all six
`contracts/*.md` files — was performed by dispatching a background review
agent running a high-capability model (per this session's model policy:
Opus 4.8 / GPT-5.6 Sol tier, never Opus 4.6), with no authoring context, asked
to check the set cold against `spec.md`, ADR-0003, ADR-0007, ADR-0010, and the
constitution for: (a) any place execution is implied to be authorized when it
is not, (b) any drift from the frozen upstream commit's actual documented
behavior, (c) any place the double gate is stated inconsistently across
files, (d) any contradiction between contracts, and (e) any place a
production-adapter decision is made prematurely. The agent independently
re-fetched the frozen-commit upstream sources itself (not merely trusting
this plan's citations) and independently re-checked repository starting
conditions (`packages/cli/dist` absence, `.specify/init-options.json`
Copilot legacy mode, the `queue` command's signature).

### Findings

**Verdict**: FAIL on first pass — no class-(a) false-authorization defects
(the double gate was independently confirmed consistent and blocking across
every file that touches it), but three High and two Medium defects were
found, all now remediated below.

- **H1 (remediated)** — `contracts/fixture-surface.md` §1 originally
  attributed the `.github/agents/*.agent.md` + `.github/prompts/*.prompt.md`
  rendering paths to upstream Spec Kit itself. Independently verified against
  `EXTENSION-API-REFERENCE.md` §"Command File Format" at the frozen commit:
  upstream documents only the command-file *source* format and, for Claude
  Code specifically, `.claude/commands/{name}.md` — it never mentions
  `.github/agents/` or `.github/prompts/` anywhere. Those two paths are this
  repository's own legacy-mode rendering convention
  (`.specify/init-options.json`), exactly as `contracts/agent-verification.md`
  §2 and this file's own R9 already stated correctly. Fixed: §1's attribution
  now points to this repository's legacy Copilot integration, not upstream.
  The adjacent script-path-rewriting citation was also corrected: upstream's
  rewriting convention specifically retargets `../../scripts/...` references
  to *core* spec-kit scripts, which does not describe this fixture's
  fixture-local `scripts/probe.sh` — only the `scripts:` frontmatter key
  itself (which is valid upstream) is what this fixture actually uses.
- **H2 (remediated)** — Four cross-references (`contracts/agent-verification.md`
  lines referencing "§3, case (b)" and "§3 rule 1";
  `contracts/isolation-and-offline.md` and `contracts/lifecycle-evidence.md`
  each referencing "§3 rule 1") pointed at
  `contracts/evidence-bundle-and-verdict.md` §3 ("Non-Binding
  Recommendation"), when the verdict precedence rules they meant to cite live
  in that contract's §2 ("Verdict Decision Procedure," Step 1 = `no-go`,
  Step 3 = `manual-command-only` cases (a)/(b)). `quickstart.md` already used
  the correct §2/§3 split, which is what exposed the drift. All four
  references corrected to point at §2's exact step.
- **H3 (remediated by this section)** — This file's own R13 and `plan.md`'s
  Reader Test section originally stated the reader test "was performed" and
  findings "are recorded," while the addendum below was still an empty
  placeholder. That was a false completeness claim at the time it was
  written — corrected now that this section actually contains the completed
  findings and remediation.
- **M1 (remediated)** — `plan.md`'s Phase 0 summary said "R1–R12, all
  decisions resolved" while also citing "§R13 Reader Test" in its own Reader
  Test section two paragraphs later — a self-contradiction on the research
  file's own item count. Corrected to "R1–R13" in `plan.md`.
- **M2 (remediated)** — `data-model.md` §9 said "these **four** shapes are
  referenced" immediately above a five-item list
  (`LifecycleTranscript`, `HookFireTranscript`, `SubprocessInvocation`,
  `AgentRenderingCheck`, `FailureProbeResult`). Corrected to "five."
- **L1 (remediated)** — Typo in this file's own R10: "somehon" → "somehow."
- **L3 (remediated)** — `contracts/lifecycle-evidence.md` was the one
  contract with no explicit gate pointer, unlike its five siblings. A
  one-line pointer was added to its header for consistency (it was already
  correctly non-authorizing in substance — this is a consistency fix, not a
  safety fix).
- **L2, L4** — no action needed; the reviewing agent classified L2 as a minor
  citation-precision nit (resolved as part of H1's fix above) and L4 as a
  confirmation that the set's `specify extension add --dev <path>` form
  (id-less, matching upstream's actual USER-GUIDE/DEV-GUIDE usage) is
  internally consistent and upstream-correct, not a defect.

**Independently corroborated as already correct, not re-litigated**: the
manifest v1.0 schema fields/patterns; the exact optional-vs-mandatory hook
rendering block text; the CLI lifecycle command forms; the
`.specify/extensions.yml`/`.specify/extensions/.registry` shapes; the
wrapped-command consistency of `adr queue --format json` across every file;
the verdict precedence order and `NonBindingRecommendation.releaseVehicleDecision`
permanently-`null` guarantee; the fixture's isolation from
`packages/adapters/*`, root `package.json` workspaces, `bun run build`, and
the `core-has-no-adapter-deps`/`clean-clone-builds` CI gates; and every
double-gate statement across `spec.md`, `plan.md`, `quickstart.md`, and
`contracts/evidence-bundle-and-verdict.md` §4.

No further findings remain open. This planning set is complete.
