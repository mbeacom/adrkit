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
  - "0047"
  - "0048"
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
> component inventory of ADR-0028, ADR-0045, and ADR-0046, and the join retry
> ladder of ADR-0048; it supersedes none of them. Their portability, read-only, advisory, and independent-versioning
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

A hook can also gate a tool call without returning anything, simply by not
answering. The Copilot CLI changelog records that `preToolUse` hook errors
deny the tool call (1.0.57), and that hooks once denied every tool call after
an extension restart (fixed in 1.0.85). A pre-tool hook therefore makes the
extension's liveness a dependency of every tool call in the session.

Two gaps make hooks worth considering anyway. An agent editing a governed
file learns that a decision governs it only if it thinks to run
`/adr-check` or `adr explain`. And an open decision-review panel shows a
snapshot that goes stale as soon as the agent edits a file, until someone
presses Refresh.

ADR-0022 settles how much authority such a signal may have: markers and
advisories add governance context and never gain exit-code authority. A hook
that can deny or hold an edit is exit-code authority by another name, so the
question is whether hooks can close those gaps while staying inside that
stance.

## Decision

We will add two advisory hooks to the existing `adrkit` extension. They are
registered in the same `joinSession`, in their own guarded `try` in
`register.mjs`, and their logic lives in a new SDK-free module, `hooks.mjs`.
**There is no `onPreToolUse`.**

**`onSessionStart`: a governing-decisions summary.** One `git diff` (the same
`collectChangedFiles` the workflow and canvas use, with the same
`origin/main...HEAD` default and `HEAD` fallback) and one
`adr check --json -- <files>`. No model call. When the changed files are
governed by accepted decisions, or open proposals would also govern them, it
returns `additionalContext` naming the record ids, and the status for
proposals. When nothing does, it returns nothing.

**`onPostToolUse`: a note on a governed edit, and a free canvas refresh.**
After a tool the runtime classifies as an edit (`edit`, `create`,
`str_replace`, `apply_patch`, and `str_replace_editor` only for its `create`,
`str_replace`, and `insert` commands, never `view`), it:

1. reads the target path(s), makes each relative to the hook input's
   `workingDirectory`, and drops anything outside the worktree;
2. runs one `adr check --json -- <path>` per distinct path, cached for the
   process, and returns `additionalContext` saying the file just edited is
   governed by the named accepted decision(s), once per path per session;
3. schedules the canvas's `refresh` (Collect and Check: `git diff`,
   `adr check`, `adr lint`; and, since ADR-0047, the free
   `adr queue --format json` read) for each directory with a panel open in this
   process. It is debounced (1.5 s, trailing) and single-flight: while one
   refresh is in flight, later requests fold into one queued refresh. It
   reaches the canvas only through a new in-process `refreshOpen` on the
   canvas options, which `createCanvas` does not copy to the wire, and it
   never starts `run_review`.

An edit inside the ADR corpus directory (`ADRKIT_DIR` or `docs/adr`, resolved
against the hook input's directory) also drops the cached checks and notes,
because a changed record can change what governs anything. Any tool that is
not an edit returns before touching git, the CLI, or a timer.

**Why the note moved from before the edit to after it.** A note before an edit
could change the edit, which is its appeal. But the measurements below show
that on 1.0.93 a pre-tool hook that hangs holds the tool call unexecuted, for
at least 90 s with no runtime timeout observed. The changelog also records
versions that deny the call when a pre-tool hook errors. Either way, an
extension that is slow, wedged, or restarting would gate the agent, which is
exactly what ADR-0022 denies an advisory. A post-tool hook runs after the edit
has landed. It can delay the result reaching the model, and this one bounds
that delay itself, but it cannot stop or undo the edit. The note says so ("it
blocked nothing"), and tells the agent to check the change it just made.

**The boundary, which is the point of this record:**

- **No hook returns anything but `additionalContext`.** Never
  `permissionDecision`, not even `"allow"` (which would override an `ask` the
  person configured), never `permissionDecisionReason`, `modifiedArgs`,
  `modifiedResult`, `modifiedConfig`, or `suppressOutput`. A test asserts the
  key set, and was observed failing when a mutation added
  `permissionDecision: "allow"`.
- **What reaches the model is ids, not text.** Record ids are validated against
  a record's own id grammar (`adr.schema.ts`, the `id` field: four or more
  digits or a 26-character ULID), a closed character class. The wider
  cross-reference grammar, with a `namespace:` prefix, is deliberately not
  accepted: the namespace is free text a corpus could spell words in, and
  `adr check` never emits it as a `recordId`. An id outside the grammar (for
  example `payments:0001`, `001`, or anything with whitespace) is dropped, not
  echoed. Statuses are
  checked against `accepted`, `proposed`, and `draft`; the rest is counts and
  labels the module writes. No title is included, because a title is
  repository text and hook context is read by the model as instructions.
  Paths are not echoed back either. Titles add little here: the summary tells
  the agent which ids to read, and `adr explain` gives the title with its
  context.
- **Failure is silent to the model, and reporting it never holds a hook.**
  Every handler catches. A failed or timed-out call returns nothing to the
  model and writes one `session.log` warning per process, fire-and-forget:
  `session.log` is an RPC with no deadline, so no hook awaits it, on any path.
  Review showed that awaiting it let a never-answering log hold
  `onSessionStart` past its deadline indefinitely; a test now covers a log
  that never resolves with git hung. The warnings are chosen from fixed messages by explicit comparisons of
  the error's `name` and `code`, never the error's text. An argument list too
  long for the OS (`E2BIG`) gets its own message rather than "install the
  CLI".
- **Time and process count are capped, and here is the real worst case:**
  - Every `git` and `adr` call the hooks make themselves carries
    `AbortSignal.timeout(5000)`.
  - At most two hook-spawned processes run at once; the timeout starts when a
    process starts, not while it waits for a slot.
  - `onSessionStart` races its whole job against a 5 s deadline. It makes up
    to three sequential calls (`git diff origin/main...HEAD`, the `git diff HEAD`
    fallback, `adr check`), so without the deadline the first prompt could wait
    15 s. With it, the first prompt waits at most about 5 s. Work past the
    deadline continues in the background, each call still bounded by its own
    5 s timeout, so it ends within about 15 s.
  - The post-edit note races its checks against a 2 s deadline. Past it the
    note is skipped for that edit, and the checks keep running and fill the
    cache, so the next edit of the file is told. A tool result is held at most
    about 2 s.
  - The hook-triggered refresh runs its calls (the queue read included)
    under one 15 s abort signal, and never more than one at a time. The
    queue keeps its own timeout as well; the two signals are combined, not
    replaced. If that signal fires, the panel keeps its previous result
    and queue, each with a fixed timeout note ("Automatic refresh timed out;
    showing the previous result."), rather than committing a snapshot whose
    note is the abort's exception text.
  - The check runs at most once per distinct path per process (20 paths per
    tool call, cut while the patch is parsed). A process starts at most 500
    checks in all, and re-checks after a corpus edit count against that
    budget, so dropping the cache never re-arms it. Concurrent
    edits of one path share one check and one note. A failed check is cached
    as "nothing", so a missing CLI is not retried on every edit.
- **An off switch.** `ADRKIT_HOOKS=0` (also `false`, `off`, or `no`) makes the
  hooks factory return `undefined`, and `register` then joins with no `hooks`
  key at all.
- **The CLI is resolved as everywhere else**: `$ADRKIT_CLI`, then
  `./node_modules/.bin/adr` only with `ADRKIT_ALLOW_REPO_CLI=1`, then `adr` on
  `PATH`, against the hook input's working directory, never `process.cwd()`.

**Registration.** A hooks factory that throws costs the hooks only: the
workflow and the canvas still register, and the failure is logged after the
join, as ADR-0046 already does for the other two. If the canvas failed to
build, the hooks' refresh is a no-op. If the runtime refuses the join itself,
`register` keeps one retry ladder for every optional field, shared with
ADR-0048's tools: without `hooks`, then without `tools`, then without both,
then without `canvases` alone (keeping the hooks and the tools), then with the
workflow alone. `onEvent` is never dropped, and a rung naming an absent field
is skipped, so with all three present that is at most six joins (four with
hooks and no tools). It logs the fields the successful join dropped and quotes
each refusal. If every rung fails, it rethrows the original error, the one
about the full configuration. So a runtime that refuses `hooks` keeps the
workflow, the canvas, and the tools; one that refuses the tools keeps the
hooks; and one that refuses `canvases` keeps the hooks and the tools and
blames only the canvas.

Dropping `hooks` first has a side effect we accept: a one-off join failure
unrelated to any field (an RPC hiccup) is cured by the first retry, which
leaves the hooks off for the rest of the session. The log line says so
explicitly ("off for this session … they may not have caused it", with the
original error) rather than blaming the hooks. Tests cover each rung,
including the fourth join that drops both, the rethrow, and the case where the
canvas already failed to build.

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
   `str_replace_editor`, and `apply_patch`. Its argument classifier also
   treats a `str_replace` tool as an edit, and switches `str_replace_editor`
   on `command` (`view`, `create`, `str_replace`, `insert`), so that tool reads
   as well as writes. 2,424 local Copilot session logs showed `edit` with
   `{ path, old_str, new_str }` and `create` with `{ path, file_text }`, the
   paths absolute, and `apply_patch` with relative and absolute paths. Neither
   `str_replace_editor` nor `str_replace` appeared in any of them, so their
   shapes are read from the bundle, not observed.
3. **`onPostToolUse` fired after a successful edit** with `toolResult`
   carrying `resultType: "success"`.
4. **`ADRKIT_*` variables reach the extension without
   `requestedEnvironmentVariables`.** `ADRKIT_HOOKS=0` and a variable named
   `ADRKIT_PROBE_SECRET_TOKEN`, set in the runtime's environment through the
   SDK host's `RuntimeConnection.forStdio({ env })`, both appeared in the
   extension's `process.env`. With `ADRKIT_HOOKS=0` the shipped extension still
   loaded (`status: "running"`) and still listed the `decision-review` canvas.
5. **What a failing hook does to the tool call (free).** These ran through
   `session.rpc.tools.execute`, which runs a tool through the session's native
   invocation pipeline with no model call; pre- and post-tool hooks fire for it.
   A probe extension failed on purpose, and each row is one `create` call:

   | Failure | Tool call | Later tool calls |
   |---|---|---|
   | pre-tool hook throws | ran (file written, `success`) | — |
   | post-tool hook throws | ran | — |
   | process exits inside the pre-tool hook | ran; the runtime reported the hook `success: true` | ran; the extension showed `failed` |
   | process exits inside the post-tool hook | ran | ran; the extension showed `failed` |
   | pre-tool hook never answers | **not run**: no file written, still pending when the host gave up at 90 s | — |
   | post-tool hook never answers | **ran** (file written); the result was still held at 90 s | — |

   So on 1.0.93, through this path, a crash fails open in both hooks, but a
   hang in a pre-tool hook gates the tool and a hang in a post-tool hook
   delays only the result. That decided the move from pre-tool to post-tool.
   Whether the model's own tool loop treats a hook *error* the same way is not
   measured here; the changelog says 1.0.57 made pre-tool errors deny.
6. **The first design's hooks, one model turn** (`gpt-6-luna`, the canvas
   open, two separate edits to `src/net.ts`). Latency is the runtime's own
   `hook.start` to `hook.end` timestamps:
   - `onSessionStart` returned "… 2 changed file(s) in this session (git diff
     origin/main...HEAD). Governed by accepted decision(s): 0001, 0002. …" in
     **111 ms**.
   - The then pre-tool note on the first `apply_patch` of `src/net.ts` (one
     uncached `adr check`) took **117 ms**; the second edit of the same path
     took **0 ms**; six other tool calls took 0 to 1 ms.
   - `onPostToolUse` took 0 to 1 ms. The open panel's `updatedAt` moved
     1.7 s after the last edit's post hook, consistent with the 1.5 s
     debounce. The two edits' post hooks were 2.3 s apart, so coalescing was
     not exercised live; the unit test is the evidence for it. No review was
     started.
   - The model quoted both advisories verbatim and said it read decision 0001
     before editing. The edits landed.
7. **The shipped post-edit note, free** (`tools.execute`, the canvas open):
   `onPostToolUse` after `create` of `src/hooks-probe.ts` took **104 ms** and
   returned "adrkit (advisory; it blocked nothing): the file(s) you just
   edited are governed by accepted decision(s) 0001. …"; a second governed
   file took 109 ms; an ungoverned file 110 ms (one check, no note); `view`
   0 ms. The panel's `updatedAt` moved, and no review started.
8. **Spend.** Two paid turns, both `gpt-6-luna`: the probe turn
   (`totalNanoAiu` 208,739,500) and the first-design turn (605,392,000), about
   0.81 AI credits together at 10^9 nano-AIU per credit. Rows 5 and 7, and
   everything else, were free.

What this record does not claim:

- Hook firing in the GitHub Copilot app is **unmeasured in the Copilot app**.
- So is hook firing in an interactive Copilot CLI terminal session, with
  `source: "startup"` or `"resume"`.
- So is any model family other than `gpt-6-luna` live.
- So is hook behavior in subagent child sessions: whether a child's
  post-tool hook reaches this extension, and whether `onSessionStart` fires
  per child (which would add a check per `decision-checker` and give a
  single-record judge the full id list). The once-per-session note for a
  second session id is unit-tested only.
- So is the shipped post-edit note in a model turn: row 7 used
  `tools.execute`, not the model's tool loop.
- So is a disabled run end to end with a model turn. The off switch is
  unit-tested, and the variable's arrival is measured, but the two were not
  observed together.
- So is the off switch's arrival in the app: row 4 set the variable through
  the SDK host, and the app builds its extensions' environment from its own
  launch.

## Options considered

### Option A: Advisory session-start and post-edit hooks that return only `additionalContext` (chosen)

| Dimension | Assessment |
|---|---|
| Authority | None, matching ADR-0022: context only, after the edit, no decision, no rewrite |
| Liveness | A crashed extension fails open (measured); a hung one delays a result by at most about 2 s, and the first prompt by about 5 s |
| Cost | No model spend; about 0.1 s on session start and after the first edit of each path, measured |
| Prompt-injection surface | Ids in the record-id grammar, a fixed status set, counts, and module-written labels only |
| Failure | Silent to the model; one log line per process |
| Off switch | `ADRKIT_HOOKS=0` |

### Option B: A pre-tool note (the first draft of this record)

It tells the agent before the edit, so the edit itself can follow the
decision. Rejected after measurement: a hung pre-tool hook holds the tool call
unexecuted (Measured fact 5), and the changelog records versions where a
pre-tool hook error denies the call. An advisory plugin would gate the agent
whenever its extension is slow or restarting. Bounding the hook with an
internal race narrows that window but does not remove it, because a process
that is wedged or gone cannot run its own race.

### Option C: Block or ask on a governed edit

`permissionDecision: "deny"` or `"ask"` on an edit to a governed file would
turn a decision into a gate inside the agent loop. Rejected: it gives a
local, advisory surface the exit-code authority ADR-0022 denies to markers
and advisories, a governing decision is not evidence that an edit conflicts
with it, and the CI Action is where a gate belongs.

### Option D: Include record titles

Titles would make the summary readable without a follow-up command. Rejected
for now: a title is repository text injected into the model's context, and the
id is enough to look it up with `adr explain`. If titles prove necessary, they
need a length cap and a "data, not instructions" label, argued in a new record.

### Option E: Deliver the summary from `onUserPromptSubmitted` instead

That hook fires on every prompt. Measured, `onSessionStart` already fires with
the first prompt for a plugin extension, so the summary arrives once rather
than on every turn. Not needed.

### Option F: Run `adr-review` from a hook

Rejected. It spends model credits, and a hook the person did not invoke must
not spend them. The post-edit hook triggers only the free refresh.

### Option G: Do nothing

The agent can still run `/adr-check`, and the person can still press Refresh.
The gaps in the Context section stay open.

## Trade-offs

Hook context is a prompt in all but name. Restricting it to ids keeps
repository text out, but the fixed sentences this module writes do steer the
model. Whether the person sees them in the CLI or the app is unmeasured; the
SDK host saw them only in the runtime's `hook.end` events.

A note after the edit cannot shape the edit. It asks the agent to check what
it just did; an agent that does not is not stopped, which is the point.

The note is given once per path per session. An agent that forgets it after
compaction is not reminded; the alternative, a note on every edit, is noise in
every long session. The per-session memory keeps 64 sessions and evicts the
oldest first, not the least recently used, so a session that spawns many
children can be re-told about paths it already knew.

The cache is per process and is dropped only when an edit tool touches the
corpus directory. It goes stale when a record changes outside the session (a
`git pull` in another terminal), when an edit adds or removes an `@adr`
marker in a source file (ADR-0022's inbound governance), and when files are
changed through the shell (`sed`, `git checkout`), which neither clears the
cache nor triggers a refresh.

The single log line is spent by the first failure for the life of the
process. A transient first timeout therefore hides a later, different
failure, a failed check stays cached as "nothing" until the corpus is edited,
and the 500-check budget is reached silently.

A timeout kills the direct child process only. The shared `runCommand` (used
by the workflow and the canvas too) passes the signal to `execFile`, which
signals that child; an `adr` behind a version-manager shim that spawns the
real `node` as a grandchild can keep running after the hook has given up.
That is a known limit of the shared runner, tracked as a follow-up rather than
fixed here, so the time bounds above are on the hook's wait, not on every
descendant process.

`onSessionStart` runs before the first model call, so its 0.1 s is added to
the first prompt's latency, and each first edit of a path waits for one
`adr check` before its result reaches the model. The deadlines above cap both.

The `SessionHooks` typings carry no `@experimental` tag, unlike canvases and
workflows, but tool names and argument shapes are the runtime's and can
change; a renamed edit tool silently turns the post-edit note and refresh off
rather than failing.

## Consequences

- Easier: an agent learns which decisions govern its change at the start of a
  session and right after it edits a governed file, and an open panel follows
  the agent's edits, all at no model cost.
- Harder: a third registration in the extension with its own tests; the edit
  tool list and shapes to re-measure on each runtime upgrade; another way for
  the plugin to add latency to a turn.
- **How we would know this was wrong:** a hook returns any key other than
  `additionalContext`; an edit or prompt is blocked, held, rewritten, or
  auto-approved by this plugin; a pre-tool hook is registered; a title, path,
  or error text reaches hook context; a hook's failure shows up in the
  model's context or throws into the runtime; a hook starts `run_review` or
  spends credits; `ADRKIT_HOOKS=0` leaves any hook registered; a hooks
  failure, or a runtime refusing `hooks`, takes the workflow or canvas down;
  hook-triggered refreshes pile up; the added latency on session start or
  after a first edit is noticeable in practice; or agents read the advisory as
  a gate.
- Revisit if: the runtime renames or reshapes its edit tools; the runtime
  gains a hook timeout that fails open, which would make a pre-tool note safe
  to reconsider; the app or CLI shows hook context to the person; titles prove
  necessary (Option D); or a later record gives advisories a gating role.

## Evidence rung

**Rung 1** under ADR-0014, and only that: unit and contract coverage, plus the
headless SDK-host measurements above against Copilot CLI 1.0.93. Unmeasured:
hook firing in the Copilot app, in an interactive CLI session, on resume, in
subagent child sessions, and with any other model family live; and any
external validation.

## Action items

1. [x] Implement `hooks.mjs`, the canvas's `refreshOpen` (with an abort
   signal), and the guarded hooks registration and retry ladder in
   `register.mjs`, and wire them in `extension.mjs`.
2. [x] Add `test/hooks.test.ts` and observe its tests failing (ADR-0016). The
   first round: 24 of 32 failed against a stub module, and six of the eight
   that passed against the stub failed under targeted mutations (the
   no-authority key set, the unref'd debounce, the off switch, the no-hooks
   join, the zero-cost non-edit path, and the no-changed-files path). After
   review, 24 of 44 failed before the redesign. The tests that passed against
   the old code were observed failing under mutation: the debounce path with
   a throwing `session.log` (fails without `fail`'s inner `try`), the
   single-flight refresh, the two-process cap, and the hooks-first retry
   ladder. "Exactly two hooks" is a tripwire. After the re-review, 5 new
   tests failed first (a never-resolving log on three paths, the narrower id
   grammar, the explicit hooks-off log line); the drop-both rung and the
   rethrow tests passed against existing code and failed under mutation.
3. [x] Measure each hook's added latency per call and the spend, and record
   them (Measured facts 6 to 8).
4. [x] Measure what a failing pre- and post-tool hook does to the tool call,
   and record the decision it drove (Measured fact 5, Option B).
5. [x] Document the hooks, the off switch, and their limits in the plugin
   README and `docs/reference-verification-agent-plugin.md`.
6. [ ] Measure hook firing in the Copilot app, in an interactive Copilot CLI
   session (`startup` and `resume`), in subagent child sessions, and the
   post-edit note in a model turn.
7. [ ] Kill the process group, not only the direct child, on a timeout in the
   shared `runCommand` (follow-up; it affects the workflow and canvas too).
8. [x] Add reciprocal "Amended by ADR-0049 (proposed)" notes to ADR-0028,
   ADR-0045, ADR-0046, ADR-0047, and ADR-0048, drafted with this record.
9. [ ] Ratify or reject this record before the plugin publishes the hooks.
