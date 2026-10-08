---
schemaVersion: 0.2.0
id: "0045"
title: "Ship an advisory adr-review dynamic workflow in the portable agent plugin"
status: accepted
date: 2026-10-08
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - copilot
  - dynamic-workflows
  - governance
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0007"
  - "0014"
  - "0022"
  - "0028"
  - "0034"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/**"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  decidedAt: 2026-10-08T16:10:07Z
---

# ADR-0045: Ship an advisory adr-review dynamic workflow in the portable agent plugin

> **Status: accepted.** Agent-drafted, ratified by `@mbeacom` on 2026-10-08. This record amends the
> component inventory of ADR-0028 and ADR-0034; it does not supersede either.
> Their portability, read-only, and independent-versioning constraints remain
> binding.

> **Amended by [ADR-0046](./0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md).**
> The extension at `extensions/adrkit/` also registers one read-only GitHub
> Copilot app canvas (`decision-review`) in the same `joinSession` call, with each
> registration guarded so a failing one cannot take the other down. It amends only
> the component inventory; this record's advisory, read-only, CLI-trust, and
> exit-status contracts are unchanged.

## Context

GitHub Copilot CLI can load a *dynamic workflow*: a plain ESM module that
registers a named, multi-phase program. A workflow runs deterministic steps in
code and calls `ctx.agent(prompt, { agent, schema })` only where judgment is
needed. That is a better fit for "check this change against the decisions that
govern it" than a prompt alone. The governing set is a pure function of the
corpus and the changed paths, and only the per-decision verdict needs a model.

ADR-0028 declined to ship MCP wiring in the plugin because Copilot CLI spawns a
plugin's MCP servers with a working directory that is neither the workspace nor
a Git repository, so the adrkit server exits during `initialize`. A workflow
extension is a different mechanism, and the question is whether it shares that
failure. It does not: the extension's working directory is the workspace
repository (measured below), so it can run `adr` and `git` against the repo
without any extra wiring.

The mechanism also comes with a property that shapes the whole design. The
`copilot workflow run` command never reports failure through its exit status.
A workflow therefore cannot gate CI. If it is shipped at all, it must be
advisory, and it must put the signal a caller needs in the result payload, not
in the process exit code. ADR-0022 already took the same stance for `@adr`
marker findings: governance context without exit-code authority.

ADR-0028's component list does not authorize a new component type. This record
makes that expansion, and fixes its safety boundary, before the
marketplace-catalogued plugin publishes it from `main`.

## Decision

We will extend the existing `adrkit` agent plugin with one Copilot dynamic
workflow, `adr-review`, located at
`packages/adapters/agent-plugin/extensions/adrkit/` (`extension.mjs` for the
host registration, `review.mjs` for pure logic).

**Shape.** Three phases:

1. **Collect.** Changed files come from the `files` argument, else from
   `git diff -z --name-only <base>...HEAD` (NUL-separated, so unusual paths
   survive), deletions included: removing a governed file can break its
   decision, and `adr check` still matches an absent path. An explicit `base` that does not resolve yields `usage-error`
   naming the ref, with no fallback. Only the default `origin/main` falls back,
   to the working tree against `HEAD` with a note, and the run is then
   `incomplete` at best, because those edits may not be the change. That fallback finding no
   changes yields `usage-error` rather than an empty, clean-looking review.
2. **Check.** Run `adr check --json <files>` and `adr lint`. Both exit codes
   are captured as data. Exit `1` is data. A spawn failure, or any exit outside
   `{0, 1}` from either command, yields `status: "usage-error"` in the result
   rather than a thrown error: a thrown error would settle the run with no
   result and still exit `0`, and the case worth surfacing would disappear.
   Zero model spend through this phase.
3. **Judge.** For each decision in the `governing` bucket, call
   `ctx.agent(..., { agent: "adrkit:decision-checker", schema })` for a
   verdict of `consistent`, `conflicts`, or `unclear` with evidence. History
   hits are returned, not judged. Judge is also skipped when `adr lint` exits
   outside `{0, 1}`: the result is `usage-error` with `governing` and `history`
   populated and no verdicts. Records in other buckets, such as
   `activeProposals`, are logged with `ctx.log` and not returned. Model spend
   scales with the number of governing decisions, not with the number of files.

The result has exactly these keys, always present: `status`, `checkExitCode`,
`lintExitCode`, `files`, `filesSource`, `notes`, `governing`, `history`,
`verdicts`, `unverified`, and `findings`. `status` is one of:

- `usage-error`: the review could not run as asked (invalid arguments, an
  unresolvable `base`, an empty fallback, a missing CLI, or an `adr` exit
  outside `{0, 1}`);
- `findings`: an `adr` exit `1`, or a `conflicts` verdict;
- `incomplete`: `unverified` is non-empty, so some governing decision has no
  usable verdict, or the default base did not resolve and only uncommitted
  edits were reviewed;
- `ok`: none of the above.

Precedence is in that order: usage-error > findings > incomplete > ok. The one
gating rule is that **the run's status is `completed` and `result.status` is
`"ok"`**. The other keys are detail for a reader, not the gate.

**Contracts.**

- **Advisory only.** The workflow has no exit-code authority. The
  governing-decisions Action remains the CI authority. A script that gates on
  the workflow anyway applies one rule: the run's status is `completed` and
  `result.status` is `"ok"`. With `--output-format json`, stdout is JSONL, and
  both values are in the final `workflow.result` event, at `.data.run.status`
  and `.data.run.result` (or in the `--result-file`). `status` alone is
  sufficient; `checkExitCode`, `lintExitCode`, `verdicts`, and `unverified` are
  detail. File existence is not a gate.
- **Read-only.** The workflow itself runs only `adr check`, `adr lint`, and
  read-only git (`git diff`). The Judge agent may also run `adr explain`,
  `adr graph`, and `adr queue`, and read files. The workflow never mentions or
  invokes `adr accept`, `adr new`, or `adr migrate`, and it writes no file. The
  plugin wiring test's rule against `adr accept` is extended to cover the
  extension.
- **Namespaced agent, null-guarded.** The agent is `adrkit:decision-checker`.
  Every `ctx.agent` result may be `null`; a null is reported under `unverified`
  and never dropped, because a silently missing judgment looks like a clean one.
- **CLI trust order, chosen by the environment only.** The workflow accepts
  three arguments: `files`, `base`, and `dir`. `cli` and `allowRepoCli` are
  deliberately **not** arguments, and any unknown key yields
  `status: "usage-error"`. Arguments can be chosen by a model that has just read
  untrusted repository content, and extension code runs outside Copilot's
  permission prompts, so an argument that selects an executable would be a
  code-execution path with no human in it. The CLI is resolved from the
  environment: `$ADRKIT_CLI` (made absolute; a `.js`, `.mjs`, or `.cjs` value
  runs under `node`), then `./node_modules/.bin/adr` only when
  `ADRKIT_ALLOW_REPO_CLI=1` exactly, then `adr` on `PATH`. This matches the skill
  and agent order with the repo-local step gated, because a non-interactive run
  cannot ask for confirmation, in line with ADR-0034's rule for repository-local
  executables. Processes are started with `execFile`, never a shell, and honor
  `ctx.signal`.
- **Root `extensions/` layout.** For adrkit's `.claude-plugin` manifest the
  workflow lives at the plugin root under `extensions/<dir>/extension.mjs`.
  There is exactly one copy.
- **Node-only, dependency-free.** Plain `.mjs`, Node built-ins only, no `Bun`
  global, no npm dependencies. `@github/copilot-sdk/extension` is imported only
  in `extension.mjs`, so `review.mjs` is testable under Bun without the SDK.
- **No guessed limits and no `ctx.pause`.** `meta` declares no `limits`; a
  guessed ceiling only stops a healthy run after it has spent credits.
  Per-invocation `limits` and `workflows.defaultLimits.*` are documented
  instead. Nothing depends on pausing, because CI cannot resume interactively.
- **Version.** The plugin moves 0.3.1 to 0.4.0 on every version-bearing surface
  enumerated in the agent-plugin section of `docs/RELEASING.md`.

### Measured facts

All measured against GitHub Copilot CLI 1.0.92 on 2026-10-08, using throwaway
probe plugins loaded via `--plugin-dir` and via a local marketplace install.
Nothing was written to this repository by the probes.

1. **Exit status is not authority.** `copilot workflow run` exited `0` for a
   successful run, a thrown error, arguments failing `argsSchema`, and an
   unknown workflow name. With `--result-file`, a thrown error writes no file,
   and the exit status is still `0`.
2. **Layout is manifest-coupled.** A `.claude-plugin/plugin.json` plugin loads
   workflows from `<plugin-root>/extensions/<dir>/extension.mjs`. The same
   extension under `com.github.copilot/extensions/` was not found; that path is
   read only for Agent Plugins 1.0 manifests.
3. **The extension's working directory is the workspace.** `process.cwd()` and
   `git rev-parse --show-toplevel` both resolved to the workspace repository,
   under `--plugin-dir` and under local-marketplace install. This is the
   contrast with ADR-0028's MCP servers.
4. **Plugin extensions run outside the trust prompt.** In an untrusted folder,
   project extensions were excluded and plugin extensions still ran. Installing
   the plugin is a code-execution grant.
5. **Agent names are namespaced, and a miss is silent.**
   `ctx.agent(prompt, { agent: "adrkit:decision-checker" })` resolved to the
   plugin agent. With the plugin installed through a local marketplace
   (`copilot plugin marketplace add <worktree>`, then
   `copilot plugin install adrkit@adrkit`), the call ran with the
   decision-checker's own instructions: it correctly listed its forbidden
   `adr new` from its system prompt. A control call with no `agent` answered
   `NONE`. The bare name `"decision-checker"` resolved to `null` without
   throwing.
6. **`adr check --json` is complete on exit 1.** For changed paths it prints a
   full CheckOutcome (`changedFiles`, `governedBy`, `governing`,
   `activeProposals`, `history`, `changedRecords`, `findings`, `markerScan`,
   `ok`) on both exit `0` and exit `1`. Exit `2` is a usage error. This is what
   makes treating a non-zero exit as data safe.

A seventh observation is not a design input: `claude plugin validate` passes on
a plugin containing `extensions/`. Agent Package Manager 0.33.0
(`apm install --target claude|copilot|opencode`) leaves `extensions/` in
`apm_modules` without deploying it to any target. Its one warning,
`Unrecognized plugin manifest $schema`, comes from the manifest's existing
`$schema` field, not from `extensions/`. A native
opencode load is unmeasured.

## Options considered

### Option A: Ship the workflow inside the existing plugin (chosen)

| Dimension | Assessment |
|---|---|
| User model | One adrkit plugin; the workflow sits beside the check command and agent it reuses |
| Write boundary | Preserved: read-only, and `/adr-draft` remains the only writer |
| Distribution | Reuses the marketplace channel and version surfaces; one copy at the plugin root |
| Authority | None, by platform behavior; the Action stays the CI gate |
| Cost | A new component type, an executable (not prompt) surface, and a layout coupled to the manifest form |

### Option B: Ship it as a project extension in `.github/extensions`

**Pros:** No change to the plugin's component inventory.

**Cons:** Every consuming repository would carry its own copy, so versions
drift per repository. Project extensions are also excluded in untrusted folders
(measured), so the workflow would vanish exactly where a reviewer is most
cautious.

### Option C: Publish a separate plugin for the workflow

**Pros:** Independent release cadence and a smaller trigger surface.

**Cons:** Duplicates CLI resolution and agent wiring, and the workflow depends
on the `decision-checker` agent in the main plugin. Two plugins must agree on a
name and a version, and a user can install one without the other. ADR-0034
rejected the same split for backfill.

### Option D: Wire the check through MCP

**Cons:** Rejected under ADR-0028. Plugin MCP servers start outside a Git
worktree. The extension mechanism does not have that failure.

### Option E: Give the workflow exit-code authority

Not possible. The host exits `0` in every case measured. Any design that
depends on the exit status reports green on failure, so the signal has to live
in the payload.

### Option F: Do nothing

`/adr-check` and the `decision-checker` agent already cover interactive use.
That leaves no deterministic, scriptable phase and no per-decision structured
verdict a caller can read as data.

## Trade-offs

The extension is executable code that runs outside Copilot's permission prompts.
Installing the plugin was already a trust decision for skills and agents; it now
also grants code execution. The environment-only CLI selection and the
`ADRKIT_ALLOW_REPO_CLI=1` gate limit that to the one step where an inherited
repository could substitute a binary, and keep a model-written argument from
ever choosing what runs.

The Judge subagent's read-only boundary is enforced by the agent's instructions,
not by a tool allowlist: `decision-checker` declares no `tools` by design, and
whether workflow-owned subagents get permission prompts under
`copilot workflow run` is unmeasured. The live smoke left the tree clean, which
is evidence, not a guarantee.

The layout is manifest-coupled. Moving to an Agent Plugins 1.0 manifest would
relocate the directory, and this record does not pre-authorize that move.

Verdicts are model judgment. A `consistent` verdict is evidence, not proof, and
the structured schema narrows the output without making it deterministic. The
workflow therefore reports `unverified` entries instead of claiming exhaustive
coverage.

Because the host exit status carries no meaning, a naive script that checks only
the exit code will read every failure as success. The documentation has to state
the content-based recipe prominently, and it is a recurring cost.

## Consequences

- Easier: a scripted or interactive "review this change against its governing
  decisions" with deterministic collection and checks, no credits until Judge,
  and a payload a caller can gate on by content.
- Harder: another component with its own contract to keep in step with the
  version surfaces, the wiring test, and the packaging test (which must assert
  one copy, root layout, no dependencies, and that the SDK is imported only in
  `extension.mjs`).
- **How we would know this was wrong:** Copilot starts honoring workflow exit
  codes, which would make an advisory-only stance needlessly weak; a
  `workflow run` is observed gating a merge by itself; the extension writes to
  the worktree, invokes `adr accept`, `adr new`, or `adr migrate`, runs a
  repo-local CLI without `ADRKIT_ALLOW_REPO_CLI=1`, or accepts a `cli`
  argument; a run with a missing judgment, an unresolvable explicit base, or
  a fallback to uncommitted edits reports `ok`; agent-name resolution changes so `adrkit:decision-checker` no longer
  resolves and judgments arrive `unverified` unnoticed; adrkit moves to an
  Agent Plugins 1.0 manifest and `extensions/` stops loading; or a user on a
  Copilot CLI earlier than 1.0.92 (the only version measured) reports that the
  extension fails to load because their CLI loads plugin extensions but
  predates dynamic workflows.
- Revisit if: the plugin adopts the Agent Plugins 1.0 layout, the host defines
  a gating mechanism for workflows, the backfill sweep (a sharded
  `decision-backfill` triage, the documented sweet spot for workflows) is
  proposed as a second workflow, or users need the workflow outside the Copilot
  CLI.

## Evidence rung

**Rung 1** under ADR-0014: unit and contract coverage of the pure logic, plus
maintainer live smokes against the installed host. The live end-to-end run
(Copilot CLI 1.0.92, 2026-10-08) used two subagents and about 0.16 AI credits,
found both planted conflicts, exited `0`, and left the worktree clean. There is
no persistent reference-repository run and no external validation. Unmeasured:
GitHub-source (copied) plugin installs, the Copilot app canvas and SDK host,
`/every` scheduling, Copilot CLI versions before 1.0.92, a native opencode load
of `extensions/`, and the Copilot cloud agent in Actions. The evidence is
recorded in `docs/reference-verification-agent-plugin.md`.

## Action items

1. [x] Implement `review.mjs` and `extension.mjs` under
   `packages/adapters/agent-plugin/extensions/adrkit/`, Node built-ins only.
2. [x] Add unit tests for the pure logic, including exit `1` captured as data,
   spawn failure and exit `2` returned as `usage-error` (never thrown), null
   agent results reported as `unverified` with `status: "incomplete"`, an
   unresolvable `base` reported as `usage-error`, and the CLI trust order.
3. [x] Extend the wiring test so no `adr accept`, `adr new`, or `adr migrate`
   appears in the extension, and add a packaging test for the root layout, one
   copy, no dependencies, and the SDK import confined to `extension.mjs`.
4. [x] Bump the plugin 0.3.1 to 0.4.0 on every version-bearing surface.
5. [x] Document the content-based gating recipe, the environment-only CLI
   selection (`ADRKIT_CLI`, `ADRKIT_ALLOW_REPO_CLI`), and per-invocation
   `limits`.
6. [x] Record the measured facts and rung-1 status in
   `docs/reference-verification-agent-plugin.md`.
