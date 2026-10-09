---
schemaVersion: 0.2.0
id: "0048"
title: "Supply read-only adrkit tools to GitHub Copilot through the plugin extension instead of MCP wiring"
status: proposed
date: 2026-10-08
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - copilot
  - mcp
  - governance
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0007"
  - "0014"
  - "0016"
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

# ADR-0048: Supply read-only adrkit tools to GitHub Copilot through the plugin extension instead of MCP wiring

> **Status: proposed.** Agent-drafted and not ratified. This record amends
> ADR-0028's component inventory and the consequence it named ("revisit when a
> host exposes the workspace to a plugin-spawned server"). It does **not**
> reverse ADR-0028's decision to omit the MCP wiring: the plugin still ships no
> `.mcp.json`. It amends the inventory of ADR-0045 and ADR-0046 (one more
> registration in the same extension) and supersedes none of them.

## Context

ADR-0028 omitted the plugin's MCP wiring for a measured reason. Copilot CLI
spawns a plugin's MCP servers with a working directory that is neither the
workspace nor any Git repository, and nothing in their environment names the
repository. The adrkit MCP server requires a Git worktree root, so it exits
during `initialize` and logs `Failed to start MCP client for adrkit` every
session. The plugin's skill and commands therefore reach adrkit through the
`adr` CLI, which runs in the agent's working directory. ADR-0028 called that
"the honest default until a host exposes the workspace to a plugin-spawned
server. Revisit when one does."

A Copilot extension is such a process. ADR-0045 and ADR-0046 already ship one,
`extensions/adrkit/`, and the extension process was measured starting in the
session's directory (Copilot CLI, and an app session for the canvas). The same
`joinSession` call that registers the workflow and the canvas accepts `tools`:
plain objects with a name, a description, a JSON Schema, and a handler that
runs in the extension process (`Tool` in the SDK's `types.d.ts`, Copilot CLI
1.0.93; `@experimental` like the rest of the surface).

So the question ADR-0028 deferred has a concrete form: should the extension
give Copilot first-class adrkit tools, and under what boundary? Three things
make it a decision rather than a convenience:

- **These tools run code on a model's request.** A model that has just read
  untrusted repository text chooses the arguments, and extension code runs
  outside Copilot's per-command shell prompts.
- **A bad registration can take the extension down.** Measured below: an invalid
  tool name makes the runtime refuse the whole join, workflow and canvas
  included.
- **The directory is not where it looks.** Measured below: a tool invocation
  carries no directory, and the extension's `process.cwd()` goes stale when the
  session's directory changes.

## Decision

We will register three read-only tools from the existing `adrkit` extension,
in the same guarded `joinSession` as the workflow and the canvas:

| Tool | Runs | Arguments |
|---|---|---|
| `adr_check` | `adr check --json [--dir d] -- <files>` | `paths` (repository-relative), or `base` (files from `git diff -z --name-only <base>...HEAD`), or neither (`origin/main`, with the workflow's fallback); `dir` |
| `adr_explain` | `adr explain --json [--dir d] -- <path>` | `path` (one, required); `dir` |
| `adr_lint` | `adr lint --json [--dir d]` | `dir` |

The plugin still ships no `.mcp.json`. The tools are not an MCP server and do
not try to be one; they wrap the same read-only CLI commands the skill and
commands already document.

**Boundary.**

- **The executable is chosen by the environment only**, by `resolveCli` from
  `review.mjs`, in the workflow's order: `$ADRKIT_CLI`, then
  `./node_modules/.bin/adr` only when `ADRKIT_ALLOW_REPO_CLI=1`, then `adr` on
  `PATH`. No tool argument can select or influence the executable; an unknown
  key such as `cli` is refused.
- **Arguments are validated in the extension**, because the host hands the
  schema to the model but does not enforce it. A path must be a non-empty
  string, relative (POSIX, Windows, UNC, and Windows drive-relative `C:foo`
  forms are refused), free of any `..` segment and of control characters (C0,
  DEL, C1, the line and paragraph separators, and the bidi embedding, override,
  and isolate controls), must not start with `-`, and is at most 1024
  characters; `paths` holds 1 to 200 entries; `base` is a revision
  of at most 256 characters from a conservative character set that cannot start
  with `-`; `dir` follows the path rules; `paths` and `base` are exclusive. Paths
  reach `adr` after `--`. Before anything is spawned, the corpus
  directory is resolved with `realpath` and refused with the fixed
  `symlink-escape` message if it leaves the session root through a symlink. It
  is computed once (the argument, else a non-empty `$ADRKIT_DIR`, else
  `docs/adr`) and that same value is passed to the CLI as `--dir`. A directory
  from `$ADRKIT_DIR` is the user's own and is trusted, so an absolute or outside
  value works. Paths are not realpath-checked: the CLI's marker reader refuses a
  path with a symlink component, so one escaping file does not fail a whole
  `adr_check`.
- **Results never carry exception text.** A rejected argument, an unresolvable
  `$ADRKIT_CLI`, a process that cannot start, an output larger than the 64 MiB
  buffer, a command line too long for the system, a process killed by a signal,
  and a base git cannot diff (worded differently with and without a `base`) each
  return a fixed message selected by code (`resultType: "failure"`). A
  rejected argument is never echoed back; a CLI failure after validation may
  carry the validated `files` for context, never an exception's message. That follows the CodeQL
  `js/stack-trace-exposure` finding on ADR-0046's canvas.
- **A non-zero `adr` exit with a report is data.** Exit 0 or 1 with JSON on
  stdout is `resultType: "success"` with `{ exitCode, report }`; `adr` uses 1
  for "found something". Exit 2, the CLI's usage-error path, is a failure that
  carries the CLI's own message (for example `Corpus directory not found`),
  capped at 2 KiB with any stack-frame line (`^\s+at `) removed. Every other
  exit without a report, including exit 0 or 1 with non-JSON output and a crash,
  is a failure with a fixed message and the exit code only, because a crashed
  CLI's stderr is a stack with install paths.
- **No result names a writing command.** A record's own text can contain one,
  so every string in a result is scrubbed of the record-creating, ratifying,
  and migrating `adr` subcommands before it is serialized, the same rule the
  plugin's wiring test applies to every component. The separator is matched
  tolerantly: any run of whitespace (newline and tab included) and format
  characters (`\p{Cf}`, which includes U+200B to U+200D, U+2060, and U+FEFF).
  Scrubbing the serialized JSON would miss a newline, which JSON writes as `\n`
  (found in review).
- **No permission prompt per call (`skipPermission: true`).** The workflow and
  the canvas's `refresh` already spawn the same environment-chosen CLI on a
  model-initiated path without one. The trust posture is identical: the
  executable comes from the environment, every path is validated, and every
  subcommand reached is read-only. A prompt on each lookup would teach users to
  approve it blindly.
- **Default deferral (`defer` unset).** In the measured session the three tools
  were offered directly (`deferLoading` absent among 215 tools).

**Working directory.** The tools start from the extension's `process.cwd()`
and then follow the `session.context_changed` event's `cwd`, accepting only an
absolute path. The invocation carries no directory, and `process.cwd()` does
not move when the session's directory does (measured below). The handler is
passed to `joinSession` as `onEvent`, which the SDK registers before it issues
the join RPC (measured: events such as `session.tools_updated` arrived through
it before the join resolved), so a change that arrives while the join is in
flight is kept. A change made before the extension process was forked is
already its `process.cwd()`. What remains is the window between the fork and
the join RPC, while the module loads; a change there is not replayed, and is
unmeasured.

**Registration.** `register.mjs` builds the tools in their own `try`, so a
throwing factory leaves the workflow and the canvas registered and is logged.
Because the runtime can refuse the whole join over a tool definition, a refused
join is retried without the tools, and then with the workflow alone (the
ADR-0046 fallback for a runtime that does not know `canvases`); at most three
joins. The runtime's refusal does not say which piece it objected to, so the
log names what the successful join left out and quotes each refusal, rather
than blaming one piece.

> **Amended by [ADR-0049](./0049-add-advisory-session-hooks-that-never-block-to-the-portable-agent-plugin.md) (proposed).**
> The tools and the advisory hooks share one ladder: without the hooks, without
> the tools, without both, without the canvas alone (keeping the tools), then
> the workflow alone. Without hooks that is at most four joins, not three, a
> runtime that refuses `canvases` now keeps the tools, and a join that never
> succeeds rethrows the first refusal rather than the last.

**Commands, skills, and agents do not mention the tools.** Those files are shared
with Claude Code and opencode, which do not load Copilot extensions, and their
CLI path keeps working unchanged in Copilot. The tools appear in Copilot's tool
list with their own descriptions; the README, this record, and the verification
doc describe them.

### Measured facts

All on Copilot CLI 1.0.93 through a headless SDK host (`CopilotClient` and
`createSession({ pluginDirectories, requestExtensions: true, workingDirectory })`),
with no model calls: `session.rpc.tools.getCurrentMetadata()` lists a session's
tools, and `session.rpc.tools.execute({ name, arguments })` invokes one without
a model turn.

- A throwaway probe extension's tool registered and executed. Its handler's
  invocation had exactly the keys `sessionId`, `toolCallId`, `toolName`,
  `arguments`, `availableTools`, `traceparent`, `tracestate`, and `signal`: no
  directory. `process.cwd()` was the session's working directory.
- After `session.rpc.metadata.setWorkingDirectory` (what `/cd` calls), the
  extension process was not restarted and its `process.cwd()` stayed at the old
  directory, while it received `session.context_changed` with the new `cwd`.
  The tool list was empty until `tools.initializeAndValidate()` ran again.
- An unknown `joinSession` key was accepted. A tool named `bad name!` made the
  runtime refuse the whole join (`session resume failed: … Tool names may only
  contain ASCII letters, digits, underscores, and hyphens`); a second
  `joinSession` from the same process then succeeded. A tool named `bash`
  joined, and then `tools.initializeAndValidate()` failed for the **session**
  (`External tool "bash" conflicts with a built-in tool of the same name`).
  Two tools with the same name in one join were accepted.
- The shipped tools, from the plugin directory of this change, against a
  scratch repository with two accepted ADRs governing `src/**` and
  `ADRKIT_CLI` pointing at the built 0.17.0 CLI: all three appeared in the tool
  list beside the canvas. `adr_check` by `paths` and by `base: "HEAD~1"`, and
  `adr_explain`, each named both records as governing; `adr_lint` checked 2
  records. `adr_lint` on a corpus with a broken record returned `success` with
  `exitCode: 1`; on a missing directory, `failure` with `exitCode: 2` and the
  CLI's message. An absolute path, a `..` path, an unknown `cli` key, and an
  unresolvable base each returned their fixed message. With `ADRKIT_CLI` set to
  a missing path, every tool returned the fixed `cli-unresolved` message, which
  shows the variable reaches the extension. After `setWorkingDirectory` to a
  second repository with one record, `adr_lint` checked 1 record. An
  `adr-review` run with an unknown argument returned `usage-error` from the same
  session, so the workflow still registered beside the tools.
- Session creation raised one `extension-permission-access` permission request
  and no per-tool request.

## Options considered

### Option A: Register read-only tools from the existing extension (chosen)

One more guarded registration in a process that already exists and already
runs in the right directory. No new process, no second extension directory
(ADR-0046 measured one extension process per restored app session), and the
same CLI resolution the workflow uses.

### Option B: Ship the `.mcp.json` now

Rejected, for ADR-0028's measured reason, which has not changed: the MCP server
would start outside any repository and fail every session.

### Option C: Have the extension launch and proxy the MCP server

The extension knows the directory, so it could spawn `@adrkit/mcp` with the
right `cwd` and forward its tools. Rejected for now: a second long-lived process
per session for three calls the CLI already answers, a dependency the plugin
does not ship, and the MCP server's own protocol surface to keep in step. The
tools here return the CLI's JSON, which is what the MCP tools wrap.

### Option D: Teach the skill and commands to prefer the tools

Rejected. Claude Code and opencode load the same files and never see the
tools; a skill that prefers a tool that is not there adds a branch every host
must read. The CLI path is correct everywhere, including in Copilot.

### Option E: Prompt for permission on each call

Rejected as explained under the boundary: the workflow and canvas already run
the same CLI without a prompt, and per-lookup prompts train blind approval.

### Option F: Do nothing

Leaves Copilot users on the CLI path, which works. The cost is that the model
shells out through a generic tool and parses CLI text, and a repository-local
`adr` there is whatever the shell finds rather than the gated resolution order.

## Trade-offs

`skipPermission` means a model can run these commands without a prompt. They
are read-only and the executable is environment-chosen, but they do read the
repository, including the first 8 KiB of each named file for `@adr` markers.
Only a symlinked corpus directory was a
leak: a committed `docs/adr` (or an argument `dir`) pointing outside the
worktree made `adr lint` list the names of the `.md` files there (measured in
review). Corpus discovery keeps regular files only, so symlinked entries inside
the corpus are never read, and the marker reader refuses symlinked paths. The
tools therefore realpath-check the corpus directory alone and refuse an escape
before spawning (`symlink-escape`). The check and the spawn are separate steps,
so a symlink swapped between them is not covered; that needs write access to the
worktree, which the model already has through its own tools.

The directory tracking depends on an event the runtime emits today. If a later
runtime stops emitting `session.context_changed`, or starts restarting the
extension on `/cd`, the tools stay correct in the second case and go stale in
the first, without an error.

The retry chain trades a loud failure for a quieter one: a tool definition the
runtime refuses now costs the tools and leaves one logged line, where it would
have cost the workflow and the canvas too. On a runtime that refuses `canvases`,
the chain also drops the tools, because it keeps the workflow alone rather than
try every combination.

The workflow (ADR-0045) still reviews the extension's `process.cwd()`, which
this record measured going stale after `/cd`. That is unchanged here and noted
as a follow-up.

## Consequences

- Easier: Copilot's model gets typed, structured adrkit answers in the session's
  repository without shelling out, with the gated CLI resolution order, and the
  MCP-wiring failure ADR-0028 avoided stays avoided.
- Harder: three more model-facing contracts (names, descriptions, schemas,
  result shapes) to keep in step with the CLI's `--json` output; a third
  registration in the guarded join; and an experimental API to re-measure on
  each CLI and app upgrade.
- **How we would know this was wrong:** a tool runs any executable other than
  the environment-chosen CLI, or any `adr` subcommand that writes; a path that
  is absolute, escapes with `..`, or starts with `-` reaches argv; a tool result
  contains an exception message, a stack, or a writing command; a non-zero `adr`
  exit with a report is reported as a failure, or a usage exit as a success; a
  tool registration failure takes the workflow or the canvas down; a tool name
  collides with a built-in and breaks the session's tool initialization; the
  tools answer for the old repository after `/cd`; the extension starts a second
  process or opens a socket for the tools; or users read a tool's `exitCode` as
  a merge gate.
- Revisit if: Copilot gives plugin-spawned MCP servers the workspace directory
  (ADR-0028's condition, which would make Option B viable); the SDK's `Tool`
  shape or `ToolInvocation` changes (for example, gains a directory); the
  runtime stops emitting `session.context_changed`; or a fourth tool is
  proposed.

## Evidence rung

**Rung 1** under ADR-0014, and only that: unit and contract tests of the
validation, result shaping, directory tracking, and registration seam, each
observed failing first (ADR-0016), plus the headless Copilot CLI 1.0.93
measurements above. Unmeasured: the tools in the Copilot app (registration,
invocation, and which directory they see there); a model choosing and calling
them in a real turn; Copilot CLI versions other than 1.0.93; an install from
GitHub; and any external validation.

## Action items

1. [x] Add `extensions/adrkit/tools.mjs` with the three tools, argument
   validation, fixed failure messages, result scrubbing, and directory tracking;
   wire it through `register.mjs` and `extension.mjs`.
2. [x] Add `test/extension-tools.test.ts`, observed failing before passing:
   names, schemas, read-only descriptions, validation, CLI resolution, exit
   codes, fixed failure text, scrubbing, the invocation signal, directory
   tracking, and the registration seam (throwing factory, refused join, retry
   order, at most three joins).
3. [x] Extend the packaging test's sibling and required-file lists.
4. [x] Measure registration and invocation headlessly against the worktree's
   plugin directory, with no model calls.
5. [ ] Measure the tools in the Copilot app: registration, one invocation, and
   the directory they report.
6. [ ] Bump the plugin version on every version-bearing surface in
   `docs/RELEASING.md`, and add a reciprocal note to ADR-0028's amendment block,
   when this record is ratified.
7. [ ] Decide separately whether the `adr-review` workflow should follow
   `session.context_changed` too.
