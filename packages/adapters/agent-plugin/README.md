# adrkit - agent plugin

Decision memory for the agent that is about to change your code.

This package turns adrkit's workflow into portable agent components: one skill,
one read-only subagent, and four slash commands. An agent can load the
decisions that already govern a change before planning it, check the plan
against them, and draft a new record when the work actually makes one.

Everything here drives the [`adr`](../../cli/README.md) CLI. Nothing in this
plugin reaches the network, and only `/adr-draft` writes anything.

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

Components resolve the CLI from `$ADRKIT_CLI`, then `./node_modules/.bin/adr`,
then `PATH`. The corpus defaults to `docs/adr` and is overridable with
`ADRKIT_DIR`.

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
| Agent | `decision-checker` | no |
| Command | `/adr-context [paths...]` | no |
| Command | `/adr-check [paths-or-plan...]` | no |
| Command | `/adr-draft <title>` | one new record |
| Command | `/adr-queue [--as-of ...]` | no |

The skill is the part that works without being asked for: it teaches the
context -> check -> draft loop, the exit-code contract, and the rules that keep
the record honest.

## Host compatibility notes

- **`.claude-plugin/plugin.json` is the shared manifest.** GitHub Copilot CLI
  searches several conventional locations; Claude Code reads
  `.claude-plugin/` only. The marketplace catalog lives at the repository root's
  `.claude-plugin/marketplace.json`.
- **The manifest declares no component paths.** Copilot CLI and Claude Code do
  not accept the same manifest shape for `agents`, `skills`, and `commands`, so
  the portable form is to rely on conventional directories instead.
- **The subagent declares no `tools` list.** Claude Code, Copilot CLI, and
  opencode disagree on both the data type and the vocabulary for that field. The
  read-only contract therefore lives in the agent body, not in host-specific
  metadata.
- **`copilot plugin install` prints only a skill count.** "Installed 1 skill"
  does not mean the agent and commands were dropped; start a fresh session to
  verify the full install.
- **Version fields must agree.** `.claude-plugin/plugin.json`, `apm.yml`, and
  `package.json` must stay in sync because host caches key off that version.

## MCP is configured per project, not shipped here

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

For deeper maintainer test notes and current limitations, see
[docs/reference-verification-agent-plugin.md](../../../docs/reference-verification-agent-plugin.md).

## License

Apache-2.0. See the repository [LICENSE](../../../LICENSE) and
[NOTICE](../../../NOTICE).
