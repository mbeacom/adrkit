---
schemaVersion: 0.1.0
id: "0028"
title: "Ship decision memory as a portable agent plugin, and omit the MCP wiring hosts cannot honor"
status: proposed
date: 2026-08-15
deciders: ["@mbeacom"]
tags: [distribution, adapters, agents, mcp, docs]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0014", "0016", "0019"]
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/**"
  - type: path
    pattern: ".claude-plugin/**"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Adds a fourth distribution surface and a repository-root marketplace catalog,
    which is a new public contract with three external hosts rather than a change
    inside an existing one. It also records a measured negative result — that a
    plugin-shipped MCP configuration cannot work for this server on GitHub
    Copilot CLI — which is the kind of finding a future contributor will
    otherwise "fix" by adding the file back.
reviewBy: 2027-02-15
---

# ADR-0028: Ship decision memory as a portable agent plugin, and omit the MCP wiring hosts cannot honor

## Context

adrkit has three distribution surfaces: the npm packages, the CI Action, and the
Spec Kit extension ([ADR-0003](./0003-ship-as-spec-kit-extension.md),
[ADR-0019](./0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md)).
All three assume the user comes to adrkit. None of them reach the place where
plans are now actually written, which is inside a coding agent that has no idea
the corpus exists.

The Spec Kit extension closes that loop for one workflow. It is pinned to Spec
Kit and only helps people already doing spec-driven development. The agent hosts
themselves — GitHub Copilot CLI, Claude Code, and opencode — have since
converged on a broadly shared plugin shape: a manifest plus `skills/`,
`agents/`, and `commands/` directories, with Microsoft's Agent Package Manager
able to deploy the same components into any of them.

That convergence is real but not complete, and the incomplete parts are not
documented as differences. They are documented, per host, as though each host
were the only one.

## Decision

Ship a fourth surface: `packages/adapters/agent-plugin`, a plugin named `adrkit`
providing one skill (`decision-memory`), one read-only subagent
(`decision-checker`), and four commands (`/adr-context`, `/adr-check`,
`/adr-draft`, `/adr-queue`). Publish it from a hand-authored
`.claude-plugin/marketplace.json` at the repository root, so this repository is
also its own marketplace.

It is independently versioned under
[ADR-0007](./0007-adapter-isolation-and-public-surface-build.md) — its semver
contract is with the hosts, not with `@adrkit/core` — and it is **not** published
to npm, because every host installs it from git.

Four constraints are load-bearing, and each was measured against the installed
hosts rather than read off their documentation:

1. **The manifest lives at `.claude-plugin/plugin.json` and declares no
   component paths.** Copilot CLI resolves four manifest locations and Claude
   Code resolves one; `.claude-plugin/` is their intersection. The documented
   Copilot fields `agents`, `skills`, and `commands` accept a string, but
   `claude plugin validate` rejects the string form outright
   (`commands: Invalid input`). Both hosts discover the conventional directories
   without them, so declaring nothing is the only shape that loads everywhere.
   `category` is a marketplace-entry field and lives there.

2. **No component declares a `tools` list.** Claude Code takes a
   comma-separated string of capitalized names, Copilot CLI an array of
   lowercase ones, and opencode requires a name-to-boolean mapping and *rejects
   the agent at load time* when handed a list. There is no portable value. The
   read-only contract is therefore stated in the agent's own body, where every
   host can read it, and asserted by test.

3. **The plugin ships no `.mcp.json`.** See below.

4. **JSON carries no `"//"` comment keys.** They survive Copilot's loader and
   are reported as unknown fields by Claude Code's validator, so the reasoning
   belongs in prose.

### Why the MCP wiring is omitted

`@adrkit/mcp` exists, is published, and is exactly what an agent should be using
for retrieval. Bundling it in the plugin is the obvious move, and it does not
work.

GitHub Copilot CLI spawns a plugin's MCP servers with a working directory that
is neither the workspace nor any Git repository. This was measured directly, by
configuring the plugin's server command to be a script that records its own
`pwd` and environment: the spawn environment carries `PLUGIN_ROOT` and
`COPILOT_PLUGIN_ROOT`, `git rev-parse --show-toplevel` fails with
`not a git repository`, and nothing in the environment names the repository the
session is working in.

The adrkit MCP server requires its root to be a Git worktree — deliberately, so
that it never silently reports an empty corpus. So it exits during `initialize`,
and the user's only signal is one line per session in a log they will not read:

```text
Failed to start MCP client for adrkit: failed to initialize MCP client:
connection closed: initialize response
```

A server that cannot start is worse than one that was never configured: it
produces a recurring error, and it teaches the user that adrkit is broken. The
wiring therefore lives where the working directory is correct — the user's own
project configuration — and `opencode/opencode.json` ships as the opencode
fragment, whose schema has an explicit `cwd` that resolves from the workspace.

The skill already degrades correctly: it prefers the MCP tools when they are
connected and falls back to the CLI, which runs in the agent's working
directory, when they are not.

## Consequences

- A fourth surface to keep in agreement. Three version fields must now match —
  `plugin.json`, `apm.yml`, and `package.json` — rather than the Spec Kit
  adapter's two. Asserted by test, because 0.1.1 of that adapter shipped with
  its two diverged.
- Retrieval through the plugin goes via the CLI by default. That is slower and
  coarser than the MCP tools, and it is the honest default until a host exposes
  the workspace to a plugin-spawned server. Revisit when one does.
- The repository root gains `.claude-plugin/marketplace.json`. Root clutter is
  the price of Claude Code compatibility; it reads no other location.
- This is at **rung 1** of
  [ADR-0014](./0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md):
  unit and contract coverage, each guard observed failing against a deliberate
  violation per
  [ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
  plus maintainer verification against installed hosts. The components were
  exercised functionally in an ephemeral consumer repository, not merely
  confirmed to load, and that exercise found a fifth defect: the subagent
  reported "no CLI available" when `@adrkit/cli` was installed as a dev
  dependency, because it tried only a bare `adr` and then fell back to reading
  frontmatter by hand — an answer that looks complete and is not. The skill and
  the agent now both state the resolution order. There has been no persistent
  reference-repository run and no external validation; rungs 2 and 3 are open.
  Full scope and limitations:
  [`docs/reference-verification-agent-plugin.md`](../reference-verification-agent-plugin.md).

## Alternatives considered

**Contribute the components to an existing marketplace instead of self-hosting.**
Rejected for the same reason ADR-0007 isolates adapters: the components version
against adrkit's CLI contract, and a catalog owned elsewhere would couple our
release cadence to someone else's. Nothing prevents listing there later; a
marketplace entry is a pointer, not a fork.

**Ship the `.mcp.json` anyway and document the limitation.** Rejected. The
failure is invisible at install time and recurring at runtime, so the
documentation would be read by nobody who needed it.

**Pin the MCP wiring with an `ADRKIT_MCP_CWD` the user sets per project.** This
works, but it moves a required setup step into an environment variable no
install flow mentions, and it still leaves a broken server for everyone who
skips it. The per-project MCP configuration path already exists and is where a
user would look.

**Duplicate the command bodies into an `opencode/` directory.** Rejected as a
drift hazard: the same prose in two places diverges. APM already places the
canonical files into `.opencode/`, and copying them by hand is one documented
command.
