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

Version 0.3.0 adds the bootstrap-record offer to backfill; 0.2.0 added the
second skill and fifth command. Existing installations must refresh and start a
new host session:

```bash
copilot plugin update adrkit@adrkit
claude plugin update adrkit@adrkit
apm update --yes --target claude,copilot,opencode
```

The expected inventory is two skills, one agent, five commands, and (Copilot
CLI only) one dynamic workflow. Copilot's
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
| Dynamic workflow (Copilot CLI only) | `adr-review` | no |

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

## Dynamic workflow: `adr-review` (GitHub Copilot CLI)

`adr-review` checks a change against the decisions that govern it and asks the
`decision-checker` agent for a verdict per governing decision. It is a Copilot
CLI dynamic workflow (`extensions/adrkit/`), authorized by
[ADR-0045](../../../docs/adr/0045-ship-an-advisory-adr-review-dynamic-workflow-in-the-portable-agent-plugin.md).
Outside Copilot CLI: `claude plugin validate` passes with the directory present,
and Agent Package Manager 0.33.0 (`apm install --target claude|copilot|opencode`)
leaves `extensions/` in `apm_modules` without deploying it to any target
(measured 2026-10-08). APM prints one warning, `Unrecognized plugin manifest
$schema`, and classifies the plugin by structure; it comes from the manifest's
`$schema` field, which predates this release, and not from `extensions/`. A native opencode load is unmeasured.

The workflow was measured on Copilot CLI 1.0.92, and run again through the
published GitHub install on 1.0.93. Earlier versions are unmeasured, and a CLI that loads plugin extensions but predates dynamic
workflows may fail to load the extension.

It runs three phases:

1. **Collect.** The changed files come from the `files` argument, else from
   `git diff -z` against `<base>...HEAD`, deletions included: removing a
   governed file can break its decision, and `adr check` still matches an
   absent path. An explicit `base` that does not
   resolve is a `usage-error` naming the ref, with no fallback. When the default
   `origin/main` does not resolve, it falls back to uncommitted changes against
   `HEAD` and says so in `notes`. Those edits may not be the change, so such a
   run is `incomplete` at best. If the working tree has no changes either, the
   result is a `usage-error` telling you to pass `files` or `base`, or to fetch
   history (for example `actions/checkout` with `fetch-depth: 0`).
2. **Check.** `adr check --json` and `adr lint`. No model spend.
3. **Judge.** One `adrkit:decision-checker` call per `accepted` governing
   decision, returning `consistent`, `conflicts`, or `unclear` with evidence.
   Spend scales with the number of governing decisions, not files. History
   hits are reported, not judged. A call that returns nothing is listed under
   `unverified`, never dropped, and makes the run `incomplete`.

It is read-only. The workflow itself runs only `adr check`, `adr lint`, and
read-only git, and writes no file. The Judge agent may also run `adr explain`,
`adr graph`, and `adr queue`, and read files.

### Arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `files` | none | Repo-relative paths to review. Overrides the git diff. |
| `base` | `origin/main` | Ref to diff `<base>...HEAD` against. |
| `dir` | `$ADRKIT_DIR`, else `docs/adr` | ADR corpus directory. |

Any other key, including `cli` or `allowRepoCli`, returns `status:
"usage-error"`. Which CLI runs is chosen by the environment alone, because
workflow arguments can be written by a model that has just read untrusted
repository content, and extension code runs outside Copilot's permission
prompts.

### Run it

Interactively, start `copilot` in the repository and run the `adr-review`
workflow from there. From a script:

```bash
copilot workflow run adr-review --args '{"base":"origin/main"}' --output-format json
```

### Which `adr` it runs

In order: `$ADRKIT_CLI` (resolved to an absolute path; a `.js`, `.mjs`, or
`.cjs` value runs under `node`), then `./node_modules/.bin/adr` **only when
`ADRKIT_ALLOW_REPO_CLI=1` is set exactly**, then `adr` on `PATH`. A missing
`ADRKIT_CLI` target is an error rather than a fall-through to `PATH`. The
repo-local step is gated because a non-interactive run cannot ask whether to
trust a binary an inherited repository supplied.

On Windows, `ADRKIT_ALLOW_REPO_CLI=1` cannot run the repo-local CLI:
`node_modules/.bin/adr` is `adr.cmd` there, and `execFile` cannot start a `.cmd`
without a shell, which the workflow deliberately never uses. Set
`ADRKIT_CLI=<repo>/node_modules/@adrkit/cli/dist/index.js` instead; a `.js`
value runs under `node`.

### It is advisory: gate on `result.status`, never on the exit code

The one gating rule: **the run's status is `completed` and `result.status` is
`"ok"`**. Nothing else is needed, and nothing less is enough.

`copilot workflow run` exits `0` on success, on a thrown error, on invalid
arguments, and on an unknown workflow name (measured on Copilot CLI 1.0.92).
The workflow therefore has no exit-code authority, and a script that checks
`$?` reads every failure as success. The governing-decisions Action remains the
CI gate. To gate a script on the workflow anyway, check that the run completed
and then read the result:

```bash
copilot workflow run adr-review --args '{"base":"origin/main"}' --output-format json 2>/dev/null > out.jsonl
jq -se 'map(select(.type=="workflow.result"))[-1].data.run | .status == "completed" and .result.status == "ok"' out.jsonl
```

With `--output-format json`, stdout is JSONL, one event per line, so use `jq -s`.
Warnings such as "Project extensions are excluded because the working folder is
not trusted" go to stderr, which the recipe discards. The last event, of type
`workflow.result`, carries the run: `.data.run` has `status` and the workflow's
return value at `.data.run.result`. This shape was measured on Copilot CLI
1.0.92. With `--result-file`, `.data.run` carries no inline result:
`.data.resultFile` holds the path, and that file contains the bare result
object.

`.result.status` is one of:

- `ok`: nothing below fired.
- `findings`: an `adr` exit `1`, or a `conflicts` verdict.
- `incomplete`: a governing decision has no usable verdict (`unverified` is
  non-empty), or `origin/main` did not resolve and only uncommitted edits were
  reviewed, and nothing above fired.
- `usage-error`: the review could not run as asked: invalid arguments, an
  unresolvable `base`, no files to review because `origin/main` did not resolve,
  a missing CLI, or an `adr` exit outside `{0, 1}`. It takes precedence over
  everything else.

Precedence is `usage-error` > `findings` > `incomplete` > `ok`. The result also
carries `checkExitCode`, `lintExitCode`, `files`, `filesSource`, `notes`,
`governing`, `history`, `verdicts`, `unverified`, and `findings`; those are
detail for a human or a report, not the gate. File existence is not a gate.

### Limits are yours to set

The workflow declares no `limits`, because a guessed ceiling only stops a
healthy run after it has spent credits. Set them per invocation or with
`workflows.defaultLimits.*` in your Copilot settings. The first live run (two
governing decisions) used two subagent calls and about 0.16 AI credits.

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

- **`copilot plugin install` prints only a skill count.** Version 0.3.0 should
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

The v0.3.0 bootstrap-record offer is contract- and static-host-validated.
Detection is measured against synthetic corpora (missing, empty, source-only,
process-record-present, and unmigrated MADR); host surfacing behavior is
unverified — no functional run in any host. The v0.2.0 backfill addition has
contract coverage, passes Claude Code's plugin and marketplace validators, loads
through Copilot CLI's `--plugin-dir`, and was deployed by APM into isolated
`claude`, `copilot`, and `opencode` targets with five commands and two skills
discovered. A fresh Copilot 1.0.80 synthetic consumer run resolved one accepted
decision, retained one rejected decision as history, emitted one evidence-backed
`backfillHandoff`, and left the worktree fingerprint and ADR count unchanged. It
remains rung 1: there is no persistent reference repository, no Claude/APM
functional run, and no external validation.

The v0.4.0 `adr-review` workflow is at rung 1: unit and contract tests plus
maintainer live smokes on Copilot CLI 1.0.92 and, through the published GitHub
install, 1.0.93, all recorded in the evidence index. The Copilot app canvas,
Copilot CLI versions before 1.0.92, and a native opencode load of `extensions/`
are unverified.

Authorized by
[ADR-0028](../../../docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](../../../docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md);
the workflow by ADR-0045 (above).

## License

Apache-2.0. See the packaged [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
