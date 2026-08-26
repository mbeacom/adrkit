# adrkit - agent plugin

Decision memory for the agent that is about to change your code.

This package turns adrkit's workflow into portable agent components: two skills,
one read-only subagent, and five slash commands. An agent can load the decisions
that already govern a change before planning it, check the plan against them,
audit an inherited codebase for decisions that were never recorded, and draft a
new record when the work actually makes one.

Everything here drives the [`adr`](../../cli/README.md) CLI. Nothing in this
plugin reaches the network, and only `/adr-draft` writes anything.
`/adr-backfill` is deliberately read-only: it returns evidence-backed
candidates before any record is created.

> **Status:** installable today from this repository and its marketplace
> metadata. The surface is intentionally small, host-specific, and versioned
> independently from the npm packages. It is not published to npm.

## Install

The plugin is hosted from this repository, which doubles as a marketplace.

```bash
# GitHub Copilot CLI
copilot plugin marketplace add mbeacom/adrkit
copilot plugin install adrkit@adrkit

# Claude Code
/plugin marketplace add mbeacom/adrkit
/plugin install adrkit@adrkit

# Agent Package Manager
apm install mbeacom/adrkit/packages/adapters/agent-plugin --target copilot
```

You also need the CLI itself, because the components shell out to it:

```bash
npm install -g @adrkit/cli
# or add @adrkit/cli to the project instead
```

Components resolve it from `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then
`PATH`. The corpus defaults to `docs/adr` and is overridable with `ADRKIT_DIR`.
In an inherited repository, the backfill workflow asks for explicit trust
confirmation before executing a CLI resolved inside that worktree.

### Updating

Version 0.2.0 adds the second skill and fifth command. Existing installations
must refresh and start a new host session:

```bash
copilot plugin update adrkit@adrkit
claude plugin update adrkit@adrkit
apm update --yes --target claude,copilot,opencode
```

The expected inventory is two skills, one agent, and five commands. Copilot's
install summary reports only the skill count (`Installed 2 skills`); use a fresh
session to verify the commands and agent.

```bash
copilot plugin list
claude plugin details adrkit@adrkit
apm audit --ci
```

In a fresh Copilot session, `/help` should list all five adrkit commands. If an
update remains stale, reinstall:

```bash
copilot plugin uninstall adrkit@adrkit
copilot plugin install adrkit@adrkit

claude plugin uninstall adrkit@adrkit
claude plugin install adrkit@adrkit    # restart afterward

apm deps list                          # identify the locked adrkit package key
apm uninstall <locked-key>
apm install mbeacom/adrkit/packages/adapters/agent-plugin --target claude,copilot,opencode
```

### opencode

opencode has no plugin-manifest concept, so either let APM place the
components:

```bash
apm install mbeacom/adrkit/packages/adapters/agent-plugin --target opencode
```

or copy `agents/`, `commands/`, **and `skills/`** into place yourself. Do not
omit `skills/`: that is the part that works without being asked for, and an
install without it silently degrades to commands-only.

`opencode/opencode.json` in this directory is the MCP fragment to merge into
your project config - see
[MCP](#mcp-is-configured-per-project-not-shipped-here).

## What it ships

| Component | Name | Writes |
| --- | --- | --- |
| Skill | `decision-memory` | no |
| Skill | `decision-backfill` | no |
| Agent | `decision-checker` | no |
| Command | `/adr-context [paths...]` | no |
| Command | `/adr-check [paths-or-plan...]` | no |
| Command | `/adr-draft <title-or-candidate-key>` | one new record |
| Command | `/adr-queue [--as-of ...]` | no |
| Command | `/adr-backfill [files-or-directories...]` | no |

The skill is the part that works without being asked for: it teaches the
context -> check -> draft loop, the exit-code contract, and the rules that keep
the record honest.

## Backfill decisions from an existing repository

Run the explicit command when architecture exists in code or prose but not yet
in a decision corpus:

```text
/adr-backfill docs/architecture src/platform infra
```

With no arguments it performs a bounded repository-wide audit. The command:

1. confines paths and symlinks to the worktree, preflights a 2,000-file /
   16-MiB / 500-commit default budget, and inventories what it reviewed and
   excluded;
2. treats source content as untrusted, non-executable evidence;
3. routes MADR corpora to
   `adr migrate --from madr --dir "$ADR_DIR" --dry-run`;
4. treats code and configuration as evidence of current state, not proof of
   intent or ratification;
5. uses documentation and git history to recover forcing context, alternatives,
   consequences, and immutable citations;
6. reconciles candidates against accepted, proposed, rejected, and superseded
   adrkit records using the detected corpus path or `ADRKIT_DIR`; and
7. returns a coverage ledger, candidate table, detailed evidence cards,
   exclusions, and a prioritized review list.

It writes nothing. A plan artifact preserved as the proposal itself remains
`draft`; statusless code, non-plan prose, and inferred choices may support
future `proposed` records after human selection, never automatically `accepted`
records. Each selectable candidate includes a structured `backfillHandoff`.
After a human selects one, run `/adr-draft <candidateKey>` to create exactly one
evidence-backed record, then review and ratify it through the normal workflow.
The handoff carries concrete paths, schema-shaped `affects` matchers, and the
governing/proposal/history snapshot; `/adr-draft` rechecks that snapshot
immediately before writing and passes the title as literal argv rather than
shell source.

The same workflow is described in the
[backfill guide](https://adrkit.dev/backfill/).

## Things that are load-bearing and easy to break

Each of these was measured against the real hosts, not inferred from their docs.

- **`.claude-plugin/plugin.json` is the one manifest both hosts read.** Copilot
  CLI checks `.plugin/`, the root, `.github/plugin/`, then `.claude-plugin/`;
  Claude Code reads only `.claude-plugin/`. The same logic puts the marketplace
  catalog at the repository root's `.claude-plugin/marketplace.json`.

- **The manifest declares no component paths.** `agents`, `skills`, and
  `commands` are documented Copilot fields that take a string or an array, but
  Claude Code's validator rejects the string form outright
  (`commands: Invalid input`). Both hosts discover `agents/`, `skills/`, and
  `commands/` by convention, so omitting the fields is the only shape that
  loads everywhere. `category` is likewise a marketplace-entry field, not a
  plugin field, and lives in `marketplace.json`.

- **The subagent declares no `tools` list.** The three hosts disagree on both
  the type and the vocabulary: Claude Code takes a comma-separated string of
  capitalized names, Copilot CLI an array of lowercase ones, and opencode
  requires a name-to-boolean mapping and **rejects the agent at load time** when
  handed a list. There is no portable value, so the read-only contract is
  stated in the agent body instead. `apm install --target opencode` reports this
  class of error, which is how it was found.

- **`copilot plugin install` prints only a skill count.** Version 0.2.0 should
  report two skills; that still does not inventory the agent or five commands.
  Verify those in a fresh session, not from the install output.

- **Every version-bearing surface must agree** — `.claude-plugin/plugin.json`,
  `apm.yml`, `package.json`, the workspace entry in `bun.lock`, marketplace
  metadata and entry, and every skill's metadata. Claude Code keys its plugin
  cache on `version`; `test/manifest.test.ts` asserts the complete set.

- **MCP identity must match before backfill uses it.** MCP tools cannot accept a
  corpus directory per call. Backfill uses them only after
  `ADRKIT_MCP_CWD` matches the target worktree and `ADRKIT_MCP_DIR` matches the
  resolved `ADR_DIR`; otherwise it uses the trusted CLI or reports
  reconciliation as unverified.

### MCP is configured per project, not shipped here

This plugin deliberately ships **no `.mcp.json`**, even though
[`@adrkit/mcp`](../../mcp/README.md) exists and the skill uses its tools when
they are present.

GitHub Copilot CLI launches a plugin's MCP servers outside the workspace, so
`@adrkit/mcp` cannot reliably discover the repository root from plugin metadata
alone. A server that cannot start is worse than one that was never configured,
so MCP wiring belongs in your project config instead.

See the [MCP setup guide](https://adrkit.dev/mcp/) and the package
[README](../../mcp/README.md). For opencode, this directory includes the
project-level `opencode/opencode.json` fragment to merge into your config.

## Versioning

This plugin is versioned independently from `@adrkit/core` and the other npm
packages because its compatibility contract is with the host tools, not with the
runtime libraries.

It is installed from git or marketplace metadata, not from npm.

## Status

The original v0.1.0 context, check, draft, and queue workflow landed at **rung
1** of the
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
evidence ladder — unit and contract coverage, each guard observed failing
against a deliberate violation, plus direct maintainer verification against the
installed hosts. The components were not merely confirmed to load: in an
ephemeral consumer repository with a four-record corpus, `/adr-context`
resolved the governing decision and its inbound marker, `/adr-check` returned
`re-proposes-rejected` against a rejected record and stopped without writing,
`/adr-draft` wrote exactly one `proposed` record that then lints and appears in
the queue, and the `decision-checker` agent produced per-decision verdicts from
the CLI. Five defects were found and fixed along the way.

It has had **no** persistent reference-repository run (rung 2) — the consumer
repository was ephemeral, there is no CI attached to it, and the public
marketplace source is unverified until this branch merges — and **no** external
validation (rung 3). The full scope, including what these runs do *not*
establish, is in the
[evidence index](../../../docs/reference-verification-agent-plugin.md).

The v0.2.0 backfill addition has contract coverage, passes Claude Code's plugin
and marketplace validators, loads through Copilot CLI's `--plugin-dir`, and was
deployed by APM into isolated `claude`, `copilot`, and `opencode` targets with
five commands and two skills discovered. A fresh Copilot 1.0.80 synthetic
consumer run resolved one accepted decision, retained one rejected decision as
history, emitted one evidence-backed `backfillHandoff`, and left the worktree
fingerprint and ADR count unchanged. It remains rung 1: there is no persistent
reference repository, no Claude/APM functional run, and no external validation.

Authorized by
[ADR-0028](../../../docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](../../../docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md).

## License

Apache-2.0. See the packaged [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
