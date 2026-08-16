# adrkit — agent plugin

Decision memory for the agent that is about to change your code.

This is adrkit's third distribution surface, after the npm packages and the
[Spec Kit extension](../spec-kit/README.md). It packages adrkit's workflow as
portable agent components — one skill, one read-only subagent, and four slash
commands — so an agent loads the decisions that already govern a change *before*
planning it, reconciles the plan against them, and records a new decision when
the work actually makes one.

Everything here drives the [`adr`](../../cli/README.md) CLI. Nothing in this
plugin reaches the network, and only `/adr-draft` writes anything.

## Install

The plugin is hosted from this repository, which doubles as a marketplace.

```bash
# GitHub Copilot CLI
copilot plugin marketplace add mbeacom/adrkit
copilot plugin install adrkit@adrkit

# Claude Code
/plugin marketplace add mbeacom/adrkit
/plugin install adrkit@adrkit

# Agent Package Manager — deploys the same components into whichever
# harness you name (claude, copilot, opencode, and others `apm targets` lists)
apm install mbeacom/adrkit/packages/adapters/agent-plugin --target copilot
```

You also need the CLI itself, which the components shell out to:

```bash
npm install -g @adrkit/cli     # or add @adrkit/cli to the project
```

Components resolve it from `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then
`PATH`. The corpus defaults to `docs/adr` and is overridable with `ADRKIT_DIR`.

### opencode

opencode has no plugin-manifest concept, so either let APM place the components
(`apm install ... --target opencode`, which writes `.opencode/agents/` and
`.opencode/commands/`), or copy `agents/` and `commands/` into `.opencode/`
yourself. `opencode/opencode.json` in this directory is the MCP fragment to
merge into your project config — see [MCP](#mcp-is-configured-per-project-not-shipped-here).

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
context → check → draft loop, the exit-code contract, and the rules that keep
the record honest — a new record is `proposed` rather than `accepted`, a
superseded decision stays in place, and a record with no `affects` matcher
governs nothing.

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

- **`copilot plugin install` prints only a skill count.** "Installed 1 skill"
  does not mean the agent and commands were dropped; they are loaded at session
  start. Verify with a fresh session, not with the install output.

- **Every version field must agree** — `.claude-plugin/plugin.json`, `apm.yml`,
  and `package.json`. Claude Code keys its plugin cache on `version`, so a
  shipped change carrying a stale one is a change users never receive. The
  sibling Spec Kit adapter shipped 0.1.1 with two of these diverged and told
  every user the wrong number; `test/manifest.test.ts` asserts all three.

### MCP is configured per project, not shipped here

This plugin deliberately ships **no `.mcp.json`**, even though
[`@adrkit/mcp`](../../mcp/README.md) exists and the skill uses its tools when
they are present.

GitHub Copilot CLI spawns a plugin's MCP servers with a working directory that
is not the workspace and not a Git repository at all — measured directly, by
having the configured command record its own `pwd` and environment. The spawn
environment carries `PLUGIN_ROOT` and `COPILOT_PLUGIN_ROOT` but nothing naming
the repository. The adrkit MCP server requires its root to be a Git worktree, so
it exits during `initialize`, and the only user-visible result is a
`Failed to start MCP client for adrkit` line in the session log, every session.

A server that cannot start is worse than one that was never configured, so the
wiring lives where the working directory is correct — your own project config.
See the [MCP setup guide](https://adrkit.dev/mcp/), and `opencode/opencode.json`
here for the opencode form, whose schema has an explicit `cwd` that resolves
from the workspace.

Two smaller findings from the same measurements, worth keeping if that wiring is
ever revisited:

- `npx -y @adrkit/mcp@^0.8.0` resolves correctly in an ordinary repository, but
  inside this monorepo `npx` prefers the unbuilt workspace copy and fails with
  `sh: adrkit-mcp: command not found`. Use `npx -y -p @adrkit/mcp@<range>
  adrkit-mcp` — the package's bin name differs from its package name.
- JSON has no comments. `"//"` keys survive Copilot's loader but Claude Code's
  validator reports them as unknown fields, so the reasoning belongs in prose
  like this rather than in the manifests.

## Versioning

Independently versioned, per
[ADR-0007](../../../docs/adr/0007-adapter-isolation-and-public-surface-build.md):
an adapter's semver contract is with its hosts, not with `@adrkit/core`, so this
does not move with the repository release tag.

Not published to npm. Every host installs it from git, so an npm copy would only
add a second, staler path to the same bytes.

## Status

Landed at **rung 1** of the
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
evidence ladder — unit and contract coverage plus direct maintainer verification
against the real hosts: `copilot plugin install` from a local marketplace with
components confirmed in a fresh session, `claude plugin validate` passing for
both the plugin and the marketplace manifest, and `apm install` clean across the
`claude`, `copilot`, and `opencode` targets. It has had **no** isolated
reference-repository run (rung 2) and **no** external validation (rung 3); both
are open.

Authorized by
[ADR-0028](../../../docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
