# adrkit - agent plugin

Decision memory for the agent that is about to change your code.

This package turns adrkit's workflow into portable agent components: two skills,
one read-only subagent, and five slash commands, plus two host-specific
extensions: an advisory dynamic workflow for GitHub Copilot CLI and a read-only
review canvas for the GitHub Copilot app. An agent can load the decisions
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

In the GitHub Copilot app, open these two links in order. Each one opens a
form in **Customize → Plugins** that is already filled in, and nothing changes
until you confirm it:

1. [Add the adrkit marketplace in the Copilot app](https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fplugins%2Fmarketplace%2Fadd%3Fsource%3Dmbeacom%252Fadrkit)
   (`ghapp://plugins/marketplace/add?source=mbeacom%2Fadrkit`)
2. [Install adrkit in the Copilot app](https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fplugins%2Finstall%3Fsource%3Dadrkit%2540adrkit)
   (`ghapp://plugins/install?source=adrkit%40adrkit`)

Both links go through GitHub's hosted launcher
(`https://github.com/copilot/app/launch?open=…`). GitHub does not render
`ghapp://` links as clickable, and the launcher shows a fallback page when the
app is not installed. The link format follows
[GitHub's deep-link documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/open-with-deep-links).
Their encoding round-trips exactly and the launcher answers HTTP 200 (measured
2026-10-08), and I followed both links in Copilot app 1.1.27 on 2026-10-08: each
opened its onboarding (marketplace add, then plugin install), and after
installing, the app showed the extension and recognized the decision-review
canvas. The app
reads the same `~/.copilot/installed-plugins` as the CLI, so installing with the
CLI commands above also makes the plugin available in the app. That is measured.

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

Version 0.5.0 adds the `decision-review` canvas; 0.4.0 added the `adr-review`
workflow; 0.3.0 added the bootstrap-record offer to backfill; 0.2.0 added the
second skill and fifth command. Existing installations must refresh and start a
new host session:

```bash
copilot plugin update adrkit@adrkit
claude plugin update adrkit@adrkit
apm update --yes --target claude,copilot,opencode
```

The expected inventory is two skills, one agent, five commands, and (Copilot
CLI only) one dynamic workflow, and (Copilot app only) one canvas. Copilot's
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
| Canvas (Copilot app only) | `decision-review` | no |

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

## Canvas: `decision-review` (GitHub Copilot app)

`decision-review` is a read-only panel in the GitHub Copilot app that shows the
architecture decisions governing the current change. It ships in the same
`extensions/adrkit/` extension as the workflow, and is authorized by
[ADR-0046](../../../docs/adr/0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md)
(**accepted**).

**What it shows.** The status, the working directory, and the changed files;
the governing decisions; active proposals; history (listed, not judged); the
`adr check` and `adr lint` findings; notes; and, once a review exists, the
`adr-review` verdicts and anything left `unverified`. Each decision has a
collapsed evidence section, and clicking a decision asks the agent to explain
it (see Explain, below). Before a review runs, the panel shows what `adr check`
found.

**Open it.** In an app session, ask the agent to "open the decision-review
canvas". It takes the same optional `files`, `base`, and `dir` as the workflow.

**Actions the agent can invoke:**

| Action | Spends AI credits | What it does |
| --- | --- | --- |
| `get_state` | no | Returns the panel snapshot. |
| `refresh` | no | Re-runs Collect and Check (`git diff`, `adr check`, `adr lint`) and `adr queue --format json`, and updates the panel. Input replaces the remembered `files`, `base`, and `dir`. |
| `show_review` | no | Displays an `adr-review` result you already have, passed as `{ result }`. The shape is validated and unknown keys are dropped. A result whose status is cleaner than its own payload, or that describes other files or governing records than the panel's, is refused. It never replaces a run the panel started. |
| `run_review` | **yes** | Starts the `adr-review` workflow and returns `{ runId, status }` at once; the panel follows the run and shows its verdicts. Spend is the workflow's: one `decision-checker` call per governing decision. Invalid arguments throw `invalid_input` before anything is spent, and while a run is in flight a second request starts nothing. |

Explain is not an agent action. It is an HTTP route the page uses when you
click a decision, and it sends the agent one fixed prompt naming only the
four-digit id.

**It is read-only.** The canvas writes nothing to the repository. The agent
that runs a review may run `adr explain`, `adr check`, and read files, as the
workflow's Judge does. Nothing in the extension mentions a command that writes
a record.

**Security model.** The panel is served from a loopback-only HTTP server that
the extension starts when the canvas opens, not when the extension loads. Every
request needs a per-panel random token, and a POST needs the token as a header
and a same-origin `Origin`. The page carries a strict Content-Security-Policy
and builds its DOM with `textContent` only, so ADR titles and findings, which
come from the repository and are untrusted, render as text and never as markup.

**Working directory and CLI.** The canvas takes its directory from the session
(`ctx.session.workingDirectory`), because the app's runtime itself runs from
`/`. The CLI is chosen by the environment alone, in the same order as the
workflow: `$ADRKIT_CLI`, then `./node_modules/.bin/adr` only when
`ADRKIT_ALLOW_REPO_CLI=1`, then `PATH`. The app passes extensions the login
shell's `PATH` (measured in one maintainer app session), so a globally
installed `adr` is found; `ADRKIT_CLI` is only set if your shell profile
exports it.

**Where it is unavailable.** Canvases render only in the Copilot app. Copilot
CLI terminal sessions have no canvas renderer, so the agent has no canvas tools
there; use the `adr-review` workflow instead. APM deploys `extensions/` to no
target (measured), and neither Claude Code nor a native opencode load of it is
measured.

**Evidence.** Rung 1 of ADR-0014. Unit and contract tests; a headless Copilot
CLI 1.0.93 SDK-host open, state, refresh, and `run_review` smoke; and the
shipped panel in maintainer sessions in Copilot app 1.1.27, where it rendered in
the app's theme and a `Run review` started from the panel came back as
`findings`. Details and the "not verified" list are in the
[evidence index](../../../docs/reference-verification-agent-plugin.md).

### Provenance, review cost, and the open-proposal queue

Proposed in
[ADR-0047](../../../docs/adr/0047-show-provenance-review-cost-and-a-read-only-proposal-queue-in-the-decision-revie.md)
(**proposed**, amends ADR-0046). Three additions, with no new action or route:

- **Why each decision governs.** A decision's evidence section names what tied
  it to the change. An inbound marker shows the changed file and line that
  named the record. An `affects` match shows the pattern, and says that
  `adr check` does not report which changed file matched it; the panel does not
  guess. `get_state` carries the same data as `declaredBy` and `firedMatchers`.
- **What a review costs before you start it.** `adr-review` makes one
  `decision-checker` call per governing decision, so the button reads
  "Run review: N decision-checker call(s) (uses AI credits)", and `get_state`
  carries the count as `judgeCalls`. With no governing decision the button is
  disabled and says there is nothing to judge. Runtime retries are not counted.
  One measured run judged two decisions for about 0.16 AI credits (Copilot CLI
  1.0.93); that is one measurement, not a price.
- **Open proposals, corpus-wide.** `refresh` also runs
  `adr queue --format json`, which costs no AI credits, and the panel lists
  every open `proposed` record with its SLA state, deadline, approvals, and
  routing. It is a list only: no buttons, no explain, and nothing that ratifies.
  If the queue cannot be read, the section shows a note and the rest of the
  panel is unaffected.

Measured in a headless Copilot CLI 1.0.93 SDK host; the new UI is unmeasured in
the Copilot app.

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
marketplace source was unverified for these runs (Copilot CLI's GitHub install
has since been exercised for the v0.4.0 `adr-review` workflow; see below) — and
**no** external
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
install, 1.0.93, all recorded in the evidence index. The v0.5.0 `decision-review`
canvas is also rung 1: unit and contract tests, plus a headless SDK-host smoke on
Copilot CLI 1.0.93, and maintainer sessions in Copilot app 1.1.27 that opened
the panel, ran a review from it, and recorded two defects fixed before release.
Other app versions, Copilot CLI versions before 1.0.92, and a native opencode
load of `extensions/` are unverified.

Authorized by
[ADR-0028](../../../docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](../../../docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md);
the workflow by ADR-0045 and the canvas by ADR-0046 (both above).

## License

Apache-2.0. See the packaged [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
