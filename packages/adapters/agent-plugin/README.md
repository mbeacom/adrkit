# adrkit - agent plugin

Decision memory for the agent that is about to change your code.

This package turns adrkit's workflow into portable agent components: two skills,
one read-only subagent, and five slash commands, plus two host-specific
extensions: an advisory dynamic workflow for GitHub Copilot CLI and two read-only
canvases (decision review and a corpus-wide decision board) for the GitHub
Copilot app. An agent can load the decisions
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

Version 0.9.0 adds the read-only `decision-board` canvas; 0.8.1 hardens the extension (fixed error messages, `/cd` for the
workflow, batched checks for wide changes, and process-tree cleanup); 0.8.0
added the advisory session hooks; 0.7.0 added the read-only
`adr_check`, `adr_explain`, and `adr_lint` extension tools; 0.6.0 added
provenance, review cost, and the open-proposal queue to the `decision-review`
canvas; 0.5.0 added the canvas; 0.4.0 added the `adr-review` workflow; 0.3.0
added the bootstrap-record offer to backfill; 0.2.0 added the second skill and
fifth command. Existing installations must refresh and start a new host session:

```bash
copilot plugin update adrkit@adrkit
claude plugin update adrkit@adrkit
apm update --yes --target claude,copilot,opencode
```

The expected inventory is two skills, one agent, five commands, and (Copilot
CLI only) one dynamic workflow, and (Copilot app only) two canvases. Copilot's
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
| Canvas (Copilot app only) | `decision-board` | no |
| Tools (Copilot only) | `adr_check`, `adr_explain`, `adr_lint` | no |

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
   the union of the committed changes `<base>...HEAD`, your staged and
   unstaged edits against `HEAD`, and untracked files that are not ignored
   (since 0.9.1; before it, uncommitted edits were missed whenever the range
   resolved). Deletions are included: removing a
   governed file can break its decision, and `adr check` still matches an
   absent path. An explicit `base` that does not
   resolve is a `usage-error` naming the ref, with no fallback. When the default
   `origin/main` does not resolve, it falls back to the uncommitted and
   untracked changes alone and says so in `notes`. A directory git does not
   treat as a work tree is a `usage-error` saying so (or naming
   `safe.directory`, when git refused it for its owner). Those edits may not be the change, so such a
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
| `files` | none | Repo-relative paths to review. Overrides the git listings. |
| `base` | `origin/main` | Ref to diff `<base>...HEAD` against. Letters, digits, and `. _ / @ { } ~ ^ -` only, no leading `-`, and `..` only inside a `...` range. |
| `dir` | `$ADRKIT_DIR`, else `docs/adr` | ADR corpus directory. |

Any other key, including `cli` or `allowRepoCli`, returns `status:
"usage-error"`. Which CLI runs is chosen by the environment alone, because
workflow arguments can be written by a model that has just read untrusted
repository content, and extension code runs outside Copilot's permission
prompts.

The workflow reviews the session's current directory, and follows it after
`/cd`. A wide change is checked in batches of about 24 KiB of arguments per
`adr check` call, because the CLI takes paths only as arguments and Windows
caps a command line at about 32 KiB. The result lists at most 200 changed
paths, counts the rest in `filesOmitted`, and carries `filesDigest`, a SHA-256
of the full sorted list, when it caps. Each Judge is shown the paths that
declared its decision first, and told the git listings whose union
reproduces the rest. An explicit `files` list longer than 200 paths makes the review
`incomplete` at best, because the Judge cannot see or list the rest. Its
`notes` are fixed messages that never repeat the CLI's
stderr or an exception's text: when one says `adr lint` or `adr check` failed,
run that command to see why. Any single `git` or `adr` call it makes is ended
after 120 seconds.

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
`node_modules/.bin/adr` is `adr.cmd` there, and `spawn` cannot start a `.cmd`
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
found. A wide change lists its first 200 paths and counts the rest; the
panel's notes are fixed messages and never show the CLI's stderr, an
exception's text, or a run's own error.

**Open it.** In an app session, ask the agent to "open the decision-review
canvas". It takes the same optional `files`, `base`, and `dir` as the workflow.

**Actions the agent can invoke:**

| Action | Spends AI credits | What it does |
| --- | --- | --- |
| `get_state` | no | Returns the panel snapshot. |
| `refresh` | no | Re-runs Collect and Check (git, `adr check`, `adr lint`) and `adr queue --format json`, and updates the panel. Input replaces the remembered `files`, `base`, and `dir`. |
| `show_review` | no | Displays an `adr-review` result you already have, passed as `{ result }`. The shape is validated and unknown keys are dropped. A result whose status is cleaner than its own payload, or that describes other files or governing records than the panel's, is refused. It never replaces a run the panel started. |
| `run_review` | **yes** | Starts the `adr-review` workflow and returns `{ runId, status }` at once; the panel follows the run and shows its verdicts. Spend is the workflow's: at most one `decision-checker` call per governing decision. Invalid arguments throw `invalid_input` before anything is spent, and while a run is in flight a second request starts nothing. |

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
- **What a review costs before you start it.** `adr-review` makes at most one
  `decision-checker` call per governing decision, so the button reads
  "Run review: N decision-checker call(s) (uses AI credits)", and `get_state`
  carries the count as `judgeCalls`. With no governing decision the button is
  disabled and says there is nothing to judge. When `adr check` or `adr lint`
  exits 2 or more, the workflow skips its Judge, so `judgeCalls` is 0 and the
  button says no checker calls will be made. Runtime retries are not counted.
  One measured run judged two decisions for about 0.16 AI credits (Copilot CLI
  1.0.93); that is one measurement, not a price.
- **Open proposals, corpus-wide.** `refresh` also runs
  `adr queue --format json`, which costs no AI credits, and the panel lists
  up to 200 open `proposed` records (fewer if their text exceeds a 256 KiB
  budget; a note says how many of the total are shown) with their SLA state,
  deadline, approvals, and routing. It is a list only: no buttons, no explain, and nothing that ratifies.
  It runs alongside the check with its own 30-second limit, and the governing
  view appears without waiting for it. If the queue cannot
  be read, is too large, or does not finish in time, the section shows a note
  and the rest of the panel is unaffected.

Measured in a headless Copilot CLI 1.0.93 SDK host; the new UI is unmeasured in
the Copilot app.

## Tools: `adr_check`, `adr_explain`, `adr_lint` (GitHub Copilot)

The same `extensions/adrkit/` extension registers three read-only tools that
Copilot's model can call directly. They are proposed in
[ADR-0048](../../../docs/adr/0048-supply-read-only-adrkit-tools-to-github-copilot-through-the-plugin-extension-ins.md)
(**proposed**, not yet ratified).

| Tool | Runs | Arguments |
| --- | --- | --- |
| `adr_check` | `adr check --json` | `paths` (repository-relative), or `base` (files from `git diff <base>...HEAD` plus uncommitted and untracked edits), or neither (the same against `origin/main`); optional `dir` |
| `adr_explain` | `adr explain --json` | `path` (one, required); optional `dir` |
| `adr_lint` | `adr lint --json` | optional `dir` |

**Why tools and not MCP.** This plugin ships no `.mcp.json` (see below): Copilot
starts a plugin's MCP servers outside your repository. The extension process
starts in the session's directory, so it can answer the same questions in the
right place. The tools wrap the CLI's JSON; they are not an MCP server.

**What they return.** `{ tool, exitCode, report }`, where `report` is the CLI's
JSON. An exit of `1` with a report is a finding, not a failure. A usage exit
(`2`) is a failure carrying the CLI's own message. Invalid arguments, a CLI that
cannot be found or started, and a `base` git cannot diff return a fixed message
and run nothing further.

**Boundary.** The executable is chosen by the environment alone, in the
workflow's order: `$ADRKIT_CLI`, then `./node_modules/.bin/adr` only when
`ADRKIT_ALLOW_REPO_CLI=1`, then `PATH`. Paths must be relative, stay inside the
repository (no `..`), not start with `-`, and are capped at 200 entries of 1024
characters each. The tools run without a per-call permission prompt, like the
workflow and the canvas's `refresh`, because every subcommand they reach is
read-only.

**Working directory.** A tool call carries no directory, so the tools start in
the extension's directory and follow the session when it moves (`/cd`), which
the extension's own `process.cwd()` does not. The `adr-review` workflow follows
the same tracker. `adr_check` checks a wide change in batches, from `paths` or
from `base`, and lists at most 200 changed paths, counting the rest in
`filesOmitted` (and in `report.changedFilesOmitted`). A report merged from
several batches carries `batches` and no `markerScan`. A call is ended after
120 seconds.

**Where they exist.** Copilot only: Claude Code and opencode do not load Copilot
extensions, and the skill and commands keep using the CLI on every host. The
tools were measured registering and running in a headless Copilot CLI 1.0.93
session; they are **unmeasured in the Copilot app**. Details are in the
[evidence index](../../../docs/reference-verification-agent-plugin.md).

## Advisory session hooks (GitHub Copilot)

The same extension registers two session hooks, proposed in
[ADR-0049](../../../docs/adr/0049-add-advisory-session-hooks-that-never-block-to-the-portable-agent-plugin.md)
(**proposed**). They add context for the agent and never block anything.

| Hook | When | What it adds | Cost |
| --- | --- | --- | --- |
| `onSessionStart` | With the session's first prompt (measured) | A short summary: how many files changed, and the ids of the accepted decisions that govern them and of open proposals that would also govern them | Four git calls (a work-tree probe and three listings) and one `adr check`; no model call |
| `onPostToolUse` | After an edit tool (`edit`, `create`, `str_replace`, `apply_patch`, or a writing `str_replace_editor` command) | A note that the file just edited is governed by the named accepted decision(s), once per file per session; and a debounced refresh of any open `decision-review` panel | One `adr check` per distinct file, cached; the panel's free refresh, never a review; nothing for any other tool |

**There is no pre-tool hook, on purpose.** Measured on Copilot CLI 1.0.93: a
pre-tool hook that hangs holds the tool call unexecuted, so a slow or wedged
extension would gate the agent. The note comes after the edit instead, and
says that it blocked nothing.

**They cannot block.** Every hook returns at most `additionalContext`. None
returns a permission decision (not even "allow", which would skip a prompt you
configured), rewrites a tool's arguments or result, or hides output. A failure
is silent to the agent and logs one warning line for you.

**They pass ids, not text.** The context names record ids and a status
(`accepted`, `proposed`, `draft`), never an ADR title or a file path, because
those are repository content and the agent reads hook context as
instructions. Ids are accepted in a record's own id grammar (`0001`, `10000`,
or a ULID); anything else, including a namespaced reference such as
`payments:0001`, is skipped silently. `adr explain
<path>` gives the agent the rest.

**Limits.**

- Each `git` and `adr` call a hook makes itself has a 5-second limit, and at
  most two run at once.
- The session summary adds at most about 5 seconds to the first prompt, and
  the post-edit note holds a tool result at most about 2 seconds. Past those
  deadlines the hook says nothing for that turn.
- The panel refresh a hook triggers runs one at a time, under a 15-second
  limit that covers the open-proposal queue read as well. If it runs out, the
  panel keeps showing its previous result, noting that the automatic refresh
  timed out.
- On macOS and Linux, a timeout stops the whole process group the hook
  started, including a grandchild that a version-manager shim may start for
  `adr`, and the session-start summary stops starting work once its deadline
  passes. On Windows a timeout stops only the process the hook started.

**Turn them off** with `ADRKIT_HOOKS=0` (or `false`, `off`, `no`) in the
environment Copilot starts from. In the headless SDK host on Copilot CLI
1.0.93, the variable reached the extension without being requested. Whether it
reaches the extension in the Copilot app, which builds its own environment, is
unmeasured. The CLI is resolved as everywhere else in this plugin.

**Evidence.** Rung 1 of ADR-0014: unit and contract tests, plus headless
Copilot CLI 1.0.93 SDK-host runs.

- One model turn on `gpt-6-luna` measured the session summary at 111 ms.
- Free runs through the session's tool pipeline measured the post-edit note
  at 104 to 110 ms after the first edit of a file, and 0 ms for a non-edit
  tool.
- The open panel refreshed after an edit.

Hook firing is unmeasured in the Copilot app, in an interactive CLI session,
and in subagent child sessions. Details are in the
[evidence index](../../../docs/reference-verification-agent-plugin.md).

## Canvas: `decision-board` (GitHub Copilot app)

A second canvas in the same extension shows the **whole corpus** rather than
one change: how the decisions relate and what is waiting for review. Proposed
in [ADR-0050](../../../docs/adr/0050-ship-a-read-only-decision-board-canvas-that-maps-the-corpus-from-adr-graph-and-a.md) (**proposed**, amends ADR-0046 and
ADR-0047). It renders what the CLI computed and derives nothing of its own:

- **The graph** comes from `adr graph --format json`: each record with its id,
  title, and status, and each `supersedes`, `relatesTo`, or `conflictsWith`
  relationship. A supersession chain reads left to right, oldest first. Status
  is shown by color and by a text label, and a relationship kind by line style
  and a legend. Records are focusable; Enter selects one, and the detail pane
  shows its fields, its neighbors, and its queue row if it has one.
- **Focus and kind filters re-run the CLI.** Focusing on a record runs
  `adr graph --focus <id>`, and the kind checkboxes add `--kind`, so the board
  and `adr graph` cannot disagree. The id must be a record id (four or more
  digits, or a ULID) and each kind one of the three; anything else is refused
  before the CLI runs. Each open board keeps its own focus: focusing one does
  not move another. A corpus directory chosen through the board must be inside
  the repository.
- **The queue** comes from `adr queue --format json` and shows each open
  proposal's raw review facts: approvals against quorum, unresolved and
  resolved objections, SLA state, deadline, routing, and how many findings it
  carries. **The board never says a proposal is ready.** Review state alone
  misses refusals such as an empty `deciders`, so a verdict would be a claim the
  board cannot back. There is no approve, object, or ratify control.

It is read-only and free: it writes nothing, starts no workflow, sends no
prompt, and spends no AI credits. Its actions are `get_state`, `refresh`, and
`focus({ id?, kinds? })`. It draws at most 300 records (past that it shows
counts by status and asks for a focus), 1000 relationships, and 200 queue rows,
and one snapshot is held to 512 KiB. Each CLI call has a 30-second limit, and a
failure is a fixed note. The post-edit hook does not refresh it; use Refresh.

Measured in a headless Copilot CLI 1.0.93 SDK host against this repository (49
records, 238 relationships) and a four-record fixture, with no model calls. The
board is **unmeasured in the Copilot app**. Details are in the
[evidence index](../../../docs/reference-verification-agent-plugin.md).

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

The `decision-board` canvas (ADR-0050, **proposed**) is rung 1: unit and
contract tests plus a headless Copilot CLI 1.0.93 SDK-host smoke with no model
calls. It is unmeasured in the Copilot app.

The extension tools (`adr_check`, `adr_explain`, `adr_lint`; ADR-0048,
**proposed**) are rung 1: unit and contract tests plus a headless Copilot CLI
1.0.93 measurement with no model calls. They are unmeasured in the Copilot app.

Authorized by
[ADR-0028](../../../docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](../../../docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md);
the workflow by ADR-0045 and the canvas by ADR-0046 (both above).

## License

Apache-2.0. See the packaged [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
