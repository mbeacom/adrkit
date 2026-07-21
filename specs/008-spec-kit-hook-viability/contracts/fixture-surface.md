# Contract: Fixture Surface — One Command, One Optional Hook, Two Honest-Failure Contracts

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-003, FR-004, FR-009,
FR-010, FR-011, FR-015, FR-016. Companion to `contracts/upstream-target.md`
(manifest shape) and `data-model.md` §2 (`CompatibilityFixture` entity),
§9 (`FailureProbeResult` shape, defined here).

## 1. The One Command: `speckit.adrkit-spike.probe`

**Command file**: `commands/probe.md` (relative to the fixture's extension
root), whose *source* frontmatter/body shape follows
`EXTENSION-API-REFERENCE.md` §"Command File Format" (upstream does not
itself document a Copilot rendering *output* path — only the source format
and, for Claude Code specifically, `.claude/commands/{name}.md`). For this
repository's own already-configured legacy Copilot integration
(`.specify/init-options.json`'s `"integration": "copilot"`, no `--skills`),
that source renders to
`.github/agents/speckit.adrkit-spike.probe.agent.md` +
`.github/prompts/speckit.adrkit-spike.probe.prompt.md` — a repository-local
rendering convention, not an upstream-mandated path (matching
`contracts/agent-verification.md` §2 and `research.md` R9's identical
attribution; `contracts/agent-verification.md` covers the second agent's
rendering separately).

**Frontmatter**:

```yaml
---
description: "Read-only probe: reads plan context, invokes adrkit's built CLI offline, never mutates anything."
scripts:
  sh: scripts/probe.sh
---
```

**Body** (documentation the rendered command file carries; the actual logic
lives in `scripts/probe.sh`, referenced via the `scripts:` frontmatter key
that `EXTENSION-DEVELOPMENT-GUIDE.md` documents as valid command-file
frontmatter. Upstream documents rewriting for `../../scripts/...` core references but
does not state whether a fixture-local `scripts/probe.sh` reference is preserved.
Preservation is therefore an execution-time hypothesis, not a frozen upstream fact:
the lifecycle evidence MUST inspect the rendered command and directly prove that its
script reference resolves to an existing fixture-local script before any hook run.

```markdown
# adrkit Spike Probe

Disposable spike fixture command. Read-only. Never writes to `docs/adr/**`,
the ADR schema, or any tracked repository file.

## User Input

$ARGUMENTS

## Steps

1. Locate the current adrkit feature/plan context (the scratch feature
   directory and its `plan.md`, per FR-010).
2. If no such context is reachable, exit non-zero with the exact message in
   §3 below — never exit 0, never crash unhandled.
3. Read the explicit non-secret `ADRKIT_REPO_ROOT` execution input, canonicalize it,
   and require both `$ADRKIT_REPO_ROOT/packages/cli/dist/index.js` and
   `$ADRKIT_REPO_ROOT/docs/adr` to exist. Never infer this root from the separate
   scratch project's git root.
4. If that artifact is absent, exit non-zero with the exact message in §4
   below — never a silent no-op.
5. Otherwise, invoke it as a subprocess: `node
   "$ADRKIT_REPO_ROOT/packages/cli/dist/index.js" queue --dir
   "$ADRKIT_REPO_ROOT/docs/adr" --format json`, with outbound network disabled and only
   the allowlisted environment from `contracts/isolation-and-offline.md` §3.1
   present. Print its stdout verbatim. Exit with its exit code.
```

```bash
# scripts/probe.sh (illustrative shape — the exact shell is an execution-time
# detail; this contract fixes its required behavior, not its literal bytes)
set -euo pipefail

FEATURE_DIR="${1:-}"
if [ -z "$FEATURE_DIR" ] || [ ! -f "$FEATURE_DIR/plan.md" ]; then
  echo "adrkit-spike: no adrkit feature/plan context reachable (expected a plan.md under \$1)" >&2
  exit 1
fi

REPO_ROOT="${ADRKIT_REPO_ROOT:-}"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/docs/adr" ]; then
  echo "adrkit-spike: ADRKIT_REPO_ROOT is absent or does not identify an adrkit corpus" >&2
  exit 1
fi
CLI_DIST="$REPO_ROOT/packages/cli/dist/index.js"
if [ ! -f "$CLI_DIST" ]; then
  echo "adrkit-spike: adrkit's built CLI is absent at packages/cli/dist/index.js — run 'bun run build' first" >&2
  exit 1
fi

env -i PATH="$PATH" ADRKIT_REPO_ROOT="$REPO_ROOT" \
  node "$CLI_DIST" queue --dir "$REPO_ROOT/docs/adr" --format json
```

## 2. The One Hook: `after_plan`, Optional

```yaml
hooks:
  after_plan:
    command: "speckit.adrkit-spike.probe"
    optional: true
    prompt: "Run the adrkit-spike probe against this plan?"
    description: "Spike fixture: exercises the after_plan hook with a read-only adrkit CLI subprocess call."
```

**Rendered surfacing** (verbatim from `templates/commands/plan.md`'s
Mandatory Post-Execution Hooks section at the frozen commit — this is what
the live `/speckit.plan` run in User Story 2 must actually show, character
for character in structure, not merely in spirit):

```text
## Extension Hooks

**Optional Hook**: adrkit-spike
Command: `/speckit.adrkit-spike.probe`
Description: Spike fixture: exercises the after_plan hook with a read-only adrkit CLI subprocess call.

Prompt: Run the adrkit-spike probe against this plan?
To execute: `/speckit.adrkit-spike.probe`
```

**Never** the mandatory-hook rendering (`**Automatic Hook**` /
`EXECUTE_COMMAND:`) — `optional: true` in the manifest is what this contract
fixes as non-negotiable (FR-004). If a future execution session ever observes
the mandatory rendering for this hook, that is itself a spike defect to
record, not a variant to accept.

## 3. Failure Contract A — Absent Plan Context (FR-015)

**Precondition**: the probe command is invoked directly (not via the hook)
from a location with no reachable `specs/NNN-*/` and no valid
`.specify/feature.json` — e.g. the scratch project's own root before any
scratch feature exists.

**Required behavior**:

| Property | Required value |
|---|---|
| Exit code | Non-zero (the illustrative script above uses `1`; any non-zero value satisfies FR-015) |
| stderr | A specific, human-readable message naming the missing context — the illustrative script's exact text is `"adrkit-spike: no adrkit feature/plan context reachable (expected a plan.md under $1)"`; a future execution session's actual message must be similarly specific, never generic (e.g. never merely `"error"`) |
| stdout | Empty or diagnostic only — never a fabricated success payload |
| Unhandled crash / stack trace | Forbidden |

This is `data-model.md` §9's `FailureProbeResult` shape, instance A:

```json
{
  "probeName": "absent-context",
  "exitCode": 1,
  "stderrMessage": "adrkit-spike: no adrkit feature/plan context reachable (expected a plan.md under $1)",
  "namesTheMissingDependency": true,
  "isUnhandledCrash": false
}
```

## 4. Failure Contract B — Absent Built CLI (FR-016)

**Precondition**: a valid feature context exists (a real scratch `plan.md`),
but `packages/cli/dist` is absent — per research.md R10, reached by
deliberately renaming it aside *after* User Story 2/FR-011 has already
proven the built-CLI subprocess call succeeds, never by coincidentally
starting in this state.

**Required behavior**:

| Property | Required value |
|---|---|
| Exit code | Non-zero |
| stderr | A specific, human-readable message naming the missing built artifact and, where practical, the command that would produce it — the illustrative script's exact text is `"adrkit-spike: adrkit's built CLI is absent at packages/cli/dist/index.js — run 'bun run build' first"` |
| stdout | Empty or diagnostic only |
| Silent no-op (exit 0 with no output) | Forbidden |

`FailureProbeResult` instance B:

```json
{
  "probeName": "absent-built-cli",
  "exitCode": 1,
  "stderrMessage": "adrkit-spike: adrkit's built CLI is absent at packages/cli/dist/index.js — run 'bun run build' first",
  "namesTheMissingDependency": true,
  "isUnhandledCrash": false
}
```

## 5. Read-Only Boundary (FR-003) — Restated as a Contract, Not Only a Manifest Field

The command's own logic (§1, step 5) MUST NOT contain any file-write
operation targeting anything outside its own scratch working area. The only
process it spawns is the read-only `adr queue` subcommand
(`packages/cli/src/queue.ts`, which per `specs/007-arb-queue/contracts/cli-contract.md`
performs no write) — never `adr new`, `adr migrate` (without `--dry-run`), or
any other mutating adrkit command. This is independently checkable by
`contracts/isolation-and-offline.md`'s `MutationBaseline` evidence
(`data-model.md` §5): if a mutation baseline for the `hook-fire` invocation
category is ever non-identical, this contract has been violated regardless of
what the command's source claims to do.
