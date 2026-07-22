# Contract: Upstream Target — Manifest v1 Shape, Immutable Compatibility Target, Fail-Closed Mismatch

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-001, A1, A2, and the manifest-v1
schema fields FR-002 requires. Source: `EXTENSION-API-REFERENCE.md` §"Extension Manifest",
fetched at `raw.githubusercontent.com/github/spec-kit/9a30db484b0876cb7e5a391cf735d59bd968e985/extensions/EXTENSION-API-REFERENCE.md`
(research.md R1).

## 1. Immutable Compatibility Target

This spike targets **exactly one** upstream state, never a range and never
"latest":

| Property | Fixed value |
|---|---|
| Release tag | `v0.13.0` |
| Commit SHA (tag's target commit) | `9a30db484b0876cb7e5a391cf735d59bd968e985` |
| Tag object SHA (annotated tag itself, distinct from the commit) | `7c95192e6b1a164f5294cc9f2e3851b28d3ba171` |
| `specify --version` expected output | `0.13.0` |

This target is a re-verification checkpoint, never a reselection point. A
newer stable Spec Kit release shipping between this plan's authoring and a
future execution session does **not** change any value in this table.

## 2. Extension Manifest — Schema Version 1.0

Full shape, verbatim from the upstream reference at the frozen commit:

```yaml
schema_version: "1.0"  # Required

extension:
  id: string           # Required, pattern: ^[a-z0-9-]+$
  name: string         # Required, human-readable name
  version: string      # Required, semantic version (X.Y.Z)
  description: string  # Required, brief description (<200 chars)
  author: string        # Required
  repository: string    # Required, valid URL
  license: string        # Required (e.g., "MIT", "Apache-2.0")
  homepage: string      # Optional, valid URL

requires:
  speckit_version: string  # Required, version specifier (>=X.Y.Z)
  tools:                   # Optional, array of tool requirements
    - name: string
      version: string
      required: boolean    # default: false

provides:
  commands:              # Required, at least one command
    - name: string       # Required, pattern: ^speckit\.[a-z0-9-]+\.[a-z0-9-]+$
      file: string        # Required, relative path to command file
      description: string # Required
      aliases: [string]   # Optional, same pattern; namespace must match extension.id
                            # and must not shadow core or installed extension commands

hooks:                   # Optional, event hooks. Each event accepts either form below.
  event_name:
    command: string
    priority: integer     # >= 1, default 10 (lower runs first)
    optional: boolean     # default: true
    prompt: string
    description: string
    condition: string     # future; not evaluated by this spike (Assumption A7 note in spec.md)
```

**This fixture's populated manifest** (the exact document a future execution
session writes, resolving every field above per `data-model.md` §2's fixed
literals):

```yaml
schema_version: "1.0"

extension:
  id: "adrkit-spike"
  name: "adrkit Spike Fixture"
  version: "0.0.1"
  description: "Disposable Spec Kit hook-compatibility spike fixture for adrkit. Never published."
  author: "adrkit maintainer"
  repository: "https://github.com/mbeacom/adrkit"
  license: "Apache-2.0"

requires:
  speckit_version: ">=0.13.0,<0.14.0"

provides:
  commands:
    - name: "speckit.adrkit-spike.probe"
      file: "commands/probe.md"
      description: "Read-only probe that invokes adrkit's built CLI offline."

hooks:
  after_plan:
    command: "speckit.adrkit-spike.probe"
    optional: true
    prompt: "Run the adrkit-spike probe against this plan?"
    description: "Spike fixture: exercises the after_plan hook with a read-only adrkit CLI subprocess call."
```

**Validation checklist against the upstream pattern rules**
(`EXTENSION-DEVELOPMENT-GUIDE.md` §"Validation Rules"):

| Rule | This manifest |
|---|---|
| `extension.id` matches `^[a-z0-9-]+$` | `adrkit-spike` — matches |
| `extension.version` is semver X.Y.Z | `0.0.1` — matches |
| `provides.commands[].name` matches `^speckit\.[a-z0-9-]+\.[a-z0-9-]+$` | `speckit.adrkit-spike.probe` — matches |
| `requires.speckit_version` is a version specifier, not a bare version | `>=0.13.0,<0.14.0` — matches (bounds the fixture to the frozen minor line, deliberately never floating to a future minor without a re-check) |
| `hooks.after_plan.optional` is `true` | `true` — matches FR-004's mandatory-`false`-forbidden rule |

## 3. Fail-Closed Re-Verification Procedure (FR-001)

Before any other spike step, and only after the governance gates in `spec.md`'s
banner are satisfied (both now are — Phase 6 is landed / reference-validated per
ADR-0014, and maintainer ratification is recorded — so execution is authorized once
this migration merges):

1. Query the upstream repository for what `refs/tags/v0.13.0` currently
   resolves to (e.g. `git ls-remote --tags https://github.com/github/spec-kit v0.13.0`,
   or the equivalent GitHub API call). Compare the resolved commit against
   `9a30db484b0876cb7e5a391cf735d59bd968e985`.
2. Run `specify --version` in the execution environment. Compare against
   `0.13.0`.
3. Populate `FrozenUpstreamReference.reverificationOutcome`
   (`data-model.md` §1) with `"match"` only if **both** checks in steps 1–2
   hold exactly.

**If either check fails**: `reverificationOutcome` is `"mismatch"`. The spike
MUST halt immediately. No fixture is installed, no hook is fired, no
evidence bundle field beyond `frozenReference` is populated. The correct next
action is to return to `spec.md` and require explicit maintainer
re-ratification against whatever the new tag/commit/version state actually
is — never to silently substitute the new state and continue as though this
spec had targeted it all along. This is the literal reading of FR-001's "fail
closed... rather than proceed against a substitute version," encoded here as
a stop condition with no silent-continuation branch.

## 4. Explicitly Not Frozen By This Contract

This contract fixes only the manifest schema and the CLI/hook-system behavior
this fixture depends on. It does not fix, and this spike does not verify:

- The Spec Kit *catalog* system (`catalog.json`/`catalog.community.json`,
  `specify extension search`/`catalog add`) — the fixture is installed
  exclusively via `--dev` (FR-005), never via a catalog.
- Multi-hook `priority`-based ordering across simultaneous hooks on the same
  event (Assumption A7) — only single-hook temporal correctness is in scope.
- The `condition` field on a hook mapping — documented upstream as "future";
  this fixture's hook has no `condition` field, and the plan.md command
  template's own Pre-Execution Checks/Mandatory Post-Execution Hooks logic
  already specifies that a hook with no `condition` (or an empty one) is
  always treated as executable, which is exactly this fixture's case.
