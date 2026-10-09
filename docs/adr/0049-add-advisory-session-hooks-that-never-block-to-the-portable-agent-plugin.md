---
schemaVersion: 0.2.0
id: "0049"
title: "Add advisory session hooks that never block to the portable agent plugin"
status: proposed
date: 2026-10-08
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - copilot
  - hooks
  - governance
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0014"
  - "0016"
  - "0022"
  - "0028"
  - "0045"
  - "0046"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/**"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
---

# ADR-0049: Add advisory session hooks that never block to the portable agent plugin

> **Status: proposed.** Agent-drafted and not ratified. This record amends the
> component inventory of ADR-0028, ADR-0045, and ADR-0046; it supersedes none
> of them. Their portability, read-only, advisory, and independent-versioning
> constraints remain binding.

## Context

The plugin's Copilot extension registers the `adr-review` workflow
(ADR-0045) and the `decision-review` canvas (ADR-0046) in one `joinSession`.
The same call takes `hooks`, a `SessionHooks` object whose handlers the
runtime calls at fixed points in a session. The SDK typings
(`@github/copilot-sdk`, Copilot CLI 1.0.93, `types.d.ts`) define, among
others:

- `onSessionStart(input)`, which may return `{ additionalContext,
  modifiedConfig }`;
- `onPreToolUse(input)`, with `input.toolName` and `input.toolArgs`, which may
  return `{ permissionDecision: "allow" | "deny" | "ask",
  permissionDecisionReason, modifiedArgs, additionalContext, suppressOutput }`;
- `onPostToolUse(input)`, with `toolResult` too, which may return
  `{ modifiedResult, additionalContext, suppressOutput }`.

So a hook can do much more than inform. It can deny or rewrite a tool call,
rewrite a tool result, and, by returning `permissionDecision: "allow"`, skip a
permission prompt the person would otherwise see. The SDK's own example
returns `"allow"` as the default for every tool call.

Two gaps make hooks worth considering anyway. An agent editing a governed
file learns that a decision governs it only if it thinks to run
`/adr-check` or `adr explain`. And an open decision-review panel shows a
snapshot that goes stale as soon as the agent edits a file, until someone
presses Refresh.

ADR-0022 settles how much authority such a signal may have: markers and
advisories add governance context and never gain exit-code authority. A hook
that can deny an edit is exit-code authority by another name, so the question
is whether hooks can close those gaps while staying inside that stance.

## Decision

We will add three advisory hooks to the existing `adrkit` extension. They
are registered in the same `joinSession`, in their own guarded `try` in
`register.mjs`, and their logic lives in a new SDK-free module, `hooks.mjs`.

**`onSessionStart`: a governing-decisions summary.** One `git diff` (the same
`collectChangedFiles` the workflow and canvas use, with the same
`origin/main...HEAD` default and `HEAD` fallback) and one
`adr check --json -- <files>`. No model call. When the changed files are
governed by accepted decisions or bound by open proposals, it returns
`additionalContext` naming the record ids, and the status for proposals. When
nothing governs them it returns nothing.

**`onPreToolUse`: a note on a governed edit.** When the tool is in the
runtime classifies as an edit (`edit`, `create`, `str_replace`,
`apply_patch`, and `str_replace_editor` only for its `create`, `str_replace`,
and `insert` commands, never `view`), it reads the target path(s), makes each relative to the hook
input's `workingDirectory`, and drops anything outside the worktree. It runs
one `adr check --json -- <path>` per distinct path, cached for the process,
and returns `additionalContext` naming the accepted decision(s) that govern
the target. The note is given once per path per session; a subagent's child
session is a separate session and gets its own note, from the cache. Any other
tool returns before touching git or the CLI.

**`onPostToolUse`: a free canvas refresh.** After an edit-category tool, it
schedules the canvas's `refresh` (Collect and Check: `git diff`, `adr check`,
`adr lint`) for each directory with a panel open in this process. It is
debounced (1.5 s, trailing) and reaches the canvas only through a new
in-process `refreshOpen` on the canvas options, which `createCanvas` does not
copy to the wire. It never starts `run_review`. An edit inside the ADR corpus
directory also drops the cached checks and notes, because a changed record can
change what governs anything.

**The boundary, which is the point of this record:**

- **No hook returns anything but `additionalContext`.** Never
  `permissionDecision`, not even `"allow"` (which would override an `ask` the
  person configured), never `permissionDecisionReason`, `modifiedArgs`,
  `modifiedResult`, `modifiedConfig`, or `suppressOutput`. A test asserts the
  key set, and was observed failing when a mutation added
  `permissionDecision: "allow"`.
- **What reaches the model is ids, not text.** Record ids are validated against
  `^[0-9]{4}$`; statuses against `accepted`, `proposed`, and `draft`; the rest
  is counts and labels the module writes. No title is included, because a
  title is repository text and hook context is read by the model as
  instructions. Paths are not echoed back either. Titles add little here: the
  summary tells the agent which ids to read, and `adr explain` gives the title
  with its context.
- **Failure is silent to the model.** Every handler catches. A failed or
  timed-out `adr` call returns nothing to the model and writes one
  `session.log` warning per process, chosen from fixed messages by explicit
  comparisons of the error's `name` and `code`, never the error's text.
- **Cost is capped.** Each `git` and `adr` call carries
  `AbortSignal.timeout(5000)`. The pre-edit check runs at most once per distinct
  path per process (500 paths at most, 20 per tool call), and a failed check is
  cached as "nothing" so a missing CLI is not retried on every edit.
- **An off switch.** `ADRKIT_HOOKS=0` (also `false`, `off`, or `no`) makes the
  hooks factory return `undefined`, and `register` then joins with no `hooks`
  key at all.
- **The CLI is resolved as everywhere else**: `$ADRKIT_CLI`, then
  `./node_modules/.bin/adr` only with `ADRKIT_ALLOW_REPO_CLI=1`, then `adr` on
  `PATH`, against the hook input's working directory, never `process.cwd()`.

**Registration.** A hooks factory that throws costs the hooks only: the
workflow and the canvas still register, and the failure is logged after the
join, as ADR-0046 already does for the other two. If the canvas failed to
build, the hooks' refresh is a no-op. The existing retry for a runtime that
rejects `canvases` keeps the hooks, because `hooks` is a long-standing
`joinSession` field and no runtime has been seen to refuse it; a hooks-specific
fallback is not added until one is.

### Measured facts

Measured on 2026-10-08 against Copilot CLI 1.0.93 through a headless SDK host
(`CopilotClient` and `createSession` with `pluginDirectories`,
`requestExtensions: true`, and `requestCanvasRenderer: true`), on a two-record
fixture repository: 0001 governs `src/**` and 0002 governs `package.json`,
both `accepted`, with both files changed against `origin/main`.

1. **A plugin extension joins after `session.start`.** With no prompt sent, a
   probe extension registering every hook recorded `load` and `joined` and no
   hook call; resuming that session with no prompt fired none either.
   `onSessionStart` fired with the first prompt, after `onUserPromptSubmitted`
   and before the model ran, with `source: "new"` and `initialPrompt` set.
   Its `additionalContext` reached the model: asked to quote any line it was
   shown that began with a sentinel, the model quoted the session-start,
   prompt, and pre-tool sentinels verbatim.
2. **Tool names and argument shapes.** With `gpt-6-luna`, the edit tool was
   `apply_patch`, and `toolArgs` was the raw patch string
   (`*** Begin Patch\n*** Update File: src/net.ts\n…`), with a relative path.
   The runtime bundle lists the edit category as `edit`, `create`,
   `str_replace_editor`, and `apply_patch`; its argument classifier also
   treats a `str_replace` tool as an edit, and switches `str_replace_editor`
   on `command` (`view`, `create`, `str_replace`, `insert`), so that tool
   reads as well as writes. 2,424 local Copilot session logs showed `edit`
   with `{ path, old_str, new_str }` and `create` with `{ path, file_text }`,
   the paths absolute, and `apply_patch` with relative and absolute paths.
   Neither `str_replace_editor` nor `str_replace` appeared in any of them, so
   their shapes are read from the bundle, not observed.
3. **`onPostToolUse` fired after a successful edit** with `toolResult`
   carrying `resultType: "success"`.
4. **`ADRKIT_*` variables reach the extension without
   `requestedEnvironmentVariables`.** `ADRKIT_HOOKS=0` and a variable named
   `ADRKIT_PROBE_SECRET_TOKEN`, set in the runtime's environment through the
   SDK host's `RuntimeConnection.forStdio({ env })`, both appeared in the
   extension's `process.env`. With `ADRKIT_HOOKS=0` the shipped extension still
   loaded (`status: "running"`) and still listed the `decision-review` canvas.
5. **The shipped hooks, one model turn** (`gpt-6-luna`, asked to make two
   separate edits to `src/net.ts` with the canvas open). Latency is the
   runtime's own `hook.start` to `hook.end` timestamps:
   - `onSessionStart` returned "… 2 changed file(s) in this session (git diff
     origin/main...HEAD). Governed by accepted decision(s): 0001, 0002. …" in
     **111 ms**.
   - `onPreToolUse` on the first `apply_patch` of `src/net.ts` (one uncached
     `adr check`) took **117 ms** and returned the note naming 0001. On the
     second edit of the same path it took **0 ms** and returned nothing. On
     the six other pre-tool calls in the turn (`skill`, `extensions_manage`,
     `view`) it took 0 to 1 ms.
   - `onPostToolUse` took 0 to 1 ms on every call. The open panel's
     `updatedAt` moved from 23:51:27.357 to 23:52:04.607, 1.7 s after the
     last edit's post hook, consistent with the 1.5 s debounce. The two
     edits' post hooks were 2.3 s apart, so coalescing was not exercised
     live; the unit test is the evidence for it. No review was started
     (`review: null`).
   - The model quoted both advisories verbatim and said it read decision 0001
     before editing. The edits landed: the hooks blocked nothing.
6. **Spend.** Two paid turns, both `gpt-6-luna`: the probe turn
   (`totalNanoAiu` 208,739,500) and the shipped-hooks turn (605,392,000), about
   0.81 AI credits together at 10^9 nano-AIU per credit. Every other
   measurement was free.

What this record does not claim: hook firing in the GitHub Copilot app is
**unmeasured in the Copilot app**, and so is hook firing in an interactive
Copilot CLI terminal session, `source: "startup"` or `"resume"`, any model
family other than `gpt-6-luna` live, and a disabled run end to end with a
model turn (the off switch is unit-tested and the variable's arrival is
measured; the two were not observed together in one paid turn).

## Options considered

### Option A: Advisory hooks that return only `additionalContext` (chosen)

| Dimension | Assessment |
|---|---|
| Authority | None, matching ADR-0022: context only, no decision, no rewrite |
| Cost | No model spend; about 0.1 s on session start and on the first edit of each governed path, measured |
| Prompt-injection surface | Ids, a fixed status set, counts, and module-written labels only |
| Failure | Silent to the model; one log line per process |
| Off switch | `ADRKIT_HOOKS=0` |

### Option B: Block or ask on a governed edit

`permissionDecision: "deny"` or `"ask"` on an edit to a governed file would
turn a decision into a gate inside the agent loop. Rejected: it gives a
local, advisory surface the exit-code authority ADR-0022 denies to markers
and advisories, a governing decision is not evidence that an edit conflicts
with it, and the CI Action is where a gate belongs.

### Option C: Include record titles

Titles would make the summary readable without a follow-up command. Rejected
for now: a title is repository text injected into the model's context, and the
id is enough to look it up with `adr explain`. If titles prove necessary, they
need a length cap and a "data, not instructions" label, argued in a new record.

### Option D: Deliver the summary from `onUserPromptSubmitted` instead

That hook fires on every prompt. Measured, `onSessionStart` already fires with
the first prompt for a plugin extension, so the summary arrives once rather
than on every turn. Not needed.

### Option E: Run `adr-review` from a hook

Rejected. It spends model credits, and a hook the person did not invoke must
not spend them. The post-edit hook triggers only the free refresh.

### Option F: Do nothing

The agent can still run `/adr-check`, and the person can still press Refresh.
The gaps in the Context section stay open.

## Trade-offs

Hook context is a prompt in all but name. Restricting it to ids keeps
repository text out, but the fixed sentences this module writes do steer the
model. Whether the person sees them in the CLI or the app is unmeasured; the
SDK host saw them only in the runtime's `hook.end` events.

The pre-edit note is given once per path per session. An agent that forgets it
after compaction is not reminded; the alternative, a note on every edit, is
noise in every long session.

The cache is per process and is dropped only when an edit touches the corpus
directory. A record changed outside the session (a `git pull` in another
terminal) leaves stale answers until the extension reloads.

`onSessionStart` runs before the first model call, so its 0.1 s is added to
the first prompt's latency, and the first edit of each governed path waits for
one `adr check`. Both are capped at 5 s by the timeout.

The `SessionHooks` typings carry no `@experimental` tag, unlike canvases and
workflows, but tool names and argument shapes are the runtime's and can
change; a renamed edit tool silently turns the pre-edit note off rather than
failing.

## Consequences

- Easier: an agent learns which decisions govern its change at the start of a
  session and before it edits a governed file, and an open panel follows the
  agent's edits, all at no model cost.
- Harder: a third registration in the extension with its own tests; the edit
  tool list and shapes to re-measure on each runtime upgrade; another way for
  the plugin to add latency to a turn.
- **How we would know this was wrong:** a hook returns any key other than
  `additionalContext`; an edit or prompt is blocked, rewritten, or auto-approved
  by this plugin; a title, path, or error text reaches hook context; a hook's
  failure shows up in the model's context or throws into the runtime; a hook
  starts `run_review` or spends credits; `ADRKIT_HOOKS=0` leaves any hook
  registered; a hooks failure takes the workflow or canvas down; the added
  latency on session start or a first edit is noticeable in practice; or
  agents read the advisory as a gate.
- Revisit if: the runtime renames or reshapes its edit tools; the app or CLI
  shows hook context to the person; a runtime rejects `hooks` in
  `joinSession`; titles prove necessary (Option C); or a later record gives
  advisories a gating role.

## Evidence rung

**Rung 1** under ADR-0014, and only that: unit and contract coverage, plus the
headless SDK-host measurements above against Copilot CLI 1.0.93. Unmeasured:
hook firing in the Copilot app, in an interactive CLI session, on resume, and
with any other model family live; and any external validation.

## Action items

1. [x] Implement `hooks.mjs`, the canvas's `refreshOpen`, and the guarded hooks
   registration in `register.mjs`, and wire them in `extension.mjs`.
2. [x] Add `test/hooks.test.ts` and observe its tests failing (ADR-0016): 24
   of 32 failed against a stub module; of the eight that passed against the
   stub, the no-authority key set, the unref'd debounce, the off switch, the
   no-hooks join, the zero-cost non-edit path, and the no-changed-files path
   were then observed failing under targeted mutations. The remaining two
   (exactly three hooks registered, and a throwing `session.log` staying
   silent) are property checks that no mutation tried has broken. Two tests
   added after review (the `str_replace_editor` command filter and an
   absolute `ADRKIT_DIR`) and the widened tool-list assertion failed before
   the fix.
3. [x] Measure each hook's added latency per call and the spend, and record them
   (Measured facts 5 and 6).
4. [x] Document the hooks, the off switch, and their limits in the plugin
   README and `docs/reference-verification-agent-plugin.md`.
5. [ ] Measure hook firing in the Copilot app and in an interactive Copilot CLI
   session, including `source: "startup"` and `"resume"`.
6. [ ] Ratify or reject this record before the plugin publishes the hooks.
