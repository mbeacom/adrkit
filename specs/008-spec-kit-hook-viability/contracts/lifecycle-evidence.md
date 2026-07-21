# Contract: Lifecycle Evidence — Install / List / Disable / Remove Transcript and File-Registration Evidence

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-005, FR-006, FR-013,
FR-014. Source for exact commands and file shapes: `EXTENSION-API-REFERENCE.md`
and `EXTENSION-USER-GUIDE.md` at the frozen commit (research.md R9).

> This is a design-time contract for a future, gate-cleared execution session
> only — the double gate in `spec.md`'s banner (Phase 6 open;
> maintainer ratification satisfied 2026-07-21) governs when any command in
> this file may actually run.

## 1. `LifecycleTranscript` Shape (`data-model.md` §9 reference)

```json
{
  "step": "install | disable | enable | remove",
  "commandLine": "string, exact command run",
  "stdout": "string, verbatim",
  "stderr": "string, verbatim",
  "exitCode": "number",
  "filesInspectedDirectly": ["string, paths checked on disk — never trusting only the CLI's own success message"]
}
```

## 2. Install (FR-005, FR-006)

**Exact command**: `specify extension add --dev <path-to-fixture>` — never
the default catalog, never a `--from` URL (FR-005).

**Verification — three independent checks, all required, per FR-006**:

| # | Check | How |
|---|---|---|
| (a) | `specify extension list` reports the fixture installed and enabled with exactly one command and one hook | Run the command; parse/read its human-readable output for `adrkit-spike`, `Commands: 1`, `Hooks: 1`, `Status: Enabled` (matching the upstream output shape in `EXTENSION-USER-GUIDE.md` §"List Installed Extensions") |
| (b) | The effective project extension configuration gains an `installed` entry and an `after_plan` hook entry for the fixture | Probe both `.specify/extensions.yml` (User Guide) and `.specify/extensions/extensions.yml` (API Reference layout), record which single path the frozen CLI actually wrote, and confirm `installed` includes `adrkit-spike` and `hooks.after_plan` includes an entry with `extension: adrkit-spike`, `command: speckit.adrkit-spike.probe`. If neither path exists, or both exist with conflicting content, installation evidence fails. |
| (c) | The extension registry records the fixture | Read `.specify/extensions/.registry` directly (JSON; shape per `EXTENSION-API-REFERENCE.md` §"Registry Format") and confirm an `adrkit-spike` key with `registered_commands` including `speckit.adrkit-spike.probe` |

**Additivity check** (Edge Cases note on pre-existing unrelated hooks): if
the effective project extension configuration already contains hook registrations for other
events or extensions before this install, the evidence bundle MUST show those
entries unchanged after install — the fixture's `after_plan` entry is
appended, never replacing or reordering pre-existing content.

**File-existence and script-resolution check** (Edge Cases note on partial-install defects):
inspect the rendered command's `scripts.sh` value, record whether the frozen CLI rewrote
or preserved `scripts/probe.sh`, and prove the resulting reference resolves to an
existing executable fixture script. Also, the
evidence bundle records a direct `ls`/`stat`-equivalent check of the expected
rendered command file paths (§4 of `contracts/agent-verification.md` for
Copilot's exact paths) — a `specify extension add` success message alone is
never sufficient evidence.

## 3. Disable (FR-013)

**Exact command**: `specify extension disable adrkit-spike`.

**Required evidence, two parts**:

1. Re-running `/speckit.plan` after disabling MUST show no hook offered for
   `after_plan` — the Mandatory Post-Execution Hooks section either omits the
   Extension Hooks block entirely or explicitly reports no hooks registered
   (per `templates/commands/plan.md`'s own "If it does not exist, or no hooks
   are registered under `hooks.after_plan`, skip to the Completion Report").
2. The fixture's files on disk (`commands/probe.md`, its rendered
   `.agent.md`/`.prompt.md` pair, `scripts/probe.sh`) remain byte-identical
   before and after disabling — disabling is a registry/config flag flip,
   never a file removal.

## 4. Remove (FR-014)

**Exact command**: `specify extension remove adrkit-spike --force` (the
`--force` flag skips the interactive confirmation `EXTENSION-USER-GUIDE.md`
documents, appropriate for this spike's scripted, non-interactive execution —
research.md R9).

**Required evidence — everything below MUST be gone, checked by direct
inspection, not by trusting the removal command's own success message**:

| Artifact | Must be absent after remove |
|---|---|
| `.github/agents/speckit.adrkit-spike.probe.agent.md` | Yes |
| `.github/prompts/speckit.adrkit-spike.probe.prompt.md` | Yes |
| Effective project extension configuration → `installed` entry for `adrkit-spike` | Yes |
| Effective project extension configuration → `hooks.after_plan` entry for `adrkit-spike` | Yes |
| `.specify/extensions/.registry` → `adrkit-spike` key | Yes |
| `specify extension list` output mentioning `adrkit-spike` in any form | Yes (no partial/orphaned listing) |

Any single row failing this table is itself sufficient to trigger the
`no-go` verdict path under `contracts/evidence-bundle-and-verdict.md` §2
Step 1 ("the fixture could not be safely disabled or fully removed").

## 5. What Lifecycle Evidence Does Not Cover

- `specify extension update` — never exercised; this spike installs one fixed
  version once and never updates it.
- Catalog-related commands (`search`, `info`, `catalog add/remove/list`) —
  out of scope; the fixture is never catalog-listed (§4 of
  `contracts/upstream-target.md`).
- `--keep-config` on remove — not used; this fixture declares no
  `provides.config` entries, so there is no config to keep or discard.
