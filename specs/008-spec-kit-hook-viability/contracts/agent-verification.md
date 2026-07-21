# Contract: Agent Verification — Copilot Live vs. Second-Agent Structural Split

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-007, FR-008, FR-009,
FR-010, Assumption A6, SC-002, SC-005.

## 1. Why Two Tiers, Not One

Verification is two-tier **by necessity, not by choice** (Assumption A6):
GitHub Copilot is the only agent runtime available in this planning/execution
environment, so it alone gets a full, live, conversational verification.
Every other upstream-supported agent (30+, per ADR-0003's Context) gets
structural-only verification — file existence, directory, extension,
frontmatter, and hook-block substitution correctness — never a live
invocation, because no such runtime is available here.

## 2. Tier 1 — GitHub Copilot, Live (FR-007, FR-009, FR-010, SC-002)

**Rendering target** (this repository's already-configured legacy mode, per
`.specify/init-options.json`'s `"integration": "copilot"` with no
`--skills` option set — never the newer `--skills` mode
`.github/skills/speckit-<name>/SKILL.md` that upstream's own
`EXTENSION-USER-GUIDE.md` §"Automatic Agent Skill Registration" describes as
the default for skills-based integrations):

| File | Exact path |
|---|---|
| Command | `.github/agents/speckit.adrkit-spike.probe.agent.md` |
| Companion prompt | `.github/prompts/speckit.adrkit-spike.probe.prompt.md` |

This exactly matches this repository's own existing rendering for the
built-in `speckit.*` commands (compare `.github/agents/speckit.plan.agent.md`
+ `.github/prompts/speckit.plan.prompt.md`, both already present in this
repository) — the fixture is required to render identically in *kind*, not
merely to render at all.

**Live verification procedure** (`HookFireTranscript` shape,
`data-model.md` §9 reference):

```json
{
  "planCommandInvoked": "/speckit.plan",
  "scratchFeatureDirectory": "string, absolute path outside specs/",
  "hooksBlockRendered": "string, verbatim Extension Hooks block text",
  "renderedAsOptional": true,
  "operatorAcceptedHook": true,
  "hookCommandExitCode": 0,
  "readGenuinePlanContext": true,
  "genuineContextEvidence": "string, e.g. the scratch feature directory path and a plan.md excerpt the probe actually read"
}
```

**Required outcome**: the rendered Extension Hooks block matches
`contracts/fixture-surface.md` §2's exact "Optional Hook" shape (never the
mandatory shape); accepting it causes the probe to execute in the same
session; the probe reads the just-produced scratch `plan.md` (not fixed or
fabricated input — FR-010); and it completes with exit code `0` having
invoked adrkit's built CLI per `contracts/isolation-and-offline.md` §3.

## 3. Tier 2 — Second Upstream-Supported Agent, Structural Only (FR-008, SC-005, A6)

**Default candidate**: Claude Code — named in Assumption A6 as "the default
candidate, since it is the most thoroughly documented integration in Spec
Kit's own extension guide." **Fallback**: Gemini CLI, if Claude Code proves
impractical to scaffold in a scratch project during execution. Whichever is
actually used MUST be recorded in the evidence bundle (A6's explicit
requirement) — this contract does not pre-select one over the other, only
fixes the named candidate-then-fallback order.

**Verification environment**: a disposable scratch project separate from
both this repository's live configuration and Tier 1's own scratch project —
never this repository's own `.github/`/`.specify/` configuration, and never
reusing Tier 1's Copilot-configured scratch project for a second agent's
`specify init`.

**`AgentRenderingCheck` shape** (`data-model.md` §9 reference):

```json
{
  "agentUsed": "claude-code | gemini-cli",
  "fallbackReasonIfNotDefault": "string | null",
  "renderedCommandPath": "string, e.g. .claude/commands/speckit.adrkit-spike.probe.md for Claude Code",
  "directoryCorrect": true,
  "fileExtensionCorrect": true,
  "frontmatterCorrect": true,
  "hookBlockSubstitutionCorrect": true,
  "liveInvocationPerformed": false
}
```

`liveInvocationPerformed` is fixed `false` by design (A6: "A live
conversational invocation in that second agent is explicitly not required").
The four `*Correct` fields are independently checked by direct file
inspection, matching upstream's own documented rendering rules for that
agent at the frozen commit — this contract does not restate every agent's
full rendering spec (that lives entirely upstream and varies per agent); it
fixes only that all four properties must be checked and recorded, and that a
partial or failed result here (any one `false`) is itself a valid,
reportable finding that resolves toward `manual-command-only`
(`contracts/evidence-bundle-and-verdict.md` §2 Step 3, case (b)) rather than being
silently dropped from the evidence bundle.

## 4. Cross-Reference to the Verdict

- Tier 1 failing in any acceptance-scenario-breaking way (hook never fires,
  crashes the session, corrupts state) is a `no-go` trigger
  (`contracts/evidence-bundle-and-verdict.md` §2 Step 1).
- Tier 2 rendering only partially or failing (while Tier 1 and everything
  else passed) is the named `manual-command-only` case (b) in SC-007 — never
  a silent exclusion from the bundle, and never treated as unsafe/`no-go` on
  its own, since a structural rendering shortfall for one non-live agent does
  not itself risk mutation, credential exposure, or an unsafe failure mode.
