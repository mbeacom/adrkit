---
schemaVersion: 0.2.0
id: "0046"
title: "Ship a read-only decision-review canvas for the GitHub Copilot app in the portable agent plugin"
status: proposed
date: 2026-10-08
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - copilot
  - canvas
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
  - "0045"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/**"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
---

# ADR-0046: Ship a read-only decision-review canvas for the GitHub Copilot app in the portable agent plugin

> **Status: proposed.** Agent-drafted; not yet ratified. This record amends the
> component inventory of ADR-0028, ADR-0034, and ADR-0045; it supersedes none of
> them. Their portability, read-only, advisory, and independent-versioning
> constraints remain binding.

## Context

The GitHub Copilot app can render a *canvas*: a panel beside the conversation
that an extension fills with a web page. An extension declares it with
`createCanvas` and registers it through the same `joinSession` call that carries
dynamic workflows. The SDK typings (`@github/copilot-sdk/extension`, Copilot CLI
1.0.93) mark every part of this API `@experimental`. A canvas gives an `open`
hook that returns a URL, named actions the agent or the page can invoke, and an
`onClose` hook. The agent receives canvas tools only when a renderer opts in,
which in practice means the app and not a terminal session.

ADR-0045 shipped `adr-review`, an advisory workflow: it collects changed files,
runs `adr check` and `adr lint`, and spends model credits only to judge each
governing decision. Its result is a JSON payload. That is right for a script and
poor for a person. Someone reviewing a change in the app has to read a payload
or ask the agent to summarize it, and nothing shows at a glance which decisions
govern the change, which are history, and which verdicts conflict. The question
is whether the app's canvas surface is a worthwhile second view of the same
data, and whether it can be added without weakening the boundaries ADR-0028,
ADR-0034, and ADR-0045 fixed.

Three things make this a decision rather than a UI preference:

- **A canvas is a local web server.** The measured pattern (below, and in the
  public Copilot extension samples) is that `open()` starts an HTTP server on
  loopback and returns its URL for the app to frame. That is a listening socket
  in a process that renders text taken from a repository, so its security
  boundary has to be stated before it ships.
- **Process count matters in the app.** The maintainer's app session started one
  extension process per restored session, and the count the maintainer saw was
  181 loads. Anything that opens a socket at load time, or adds a second
  extension directory, multiplies by that number. That count is a maintainer
  observation from the app session; this record cites it and does not
  reproduce it.
- **ADR-0045's registration is fragile.** An invalid workflow definition
  (missing `meta.phases`) throws at import and takes the whole extension down,
  canvas included (measured). Once two registrations share one extension, one
  must not be able to disable the other.

ADR-0028 and ADR-0034 predate canvases, and ADR-0045's inventory names one
workflow. A canvas is a new component type, so this record makes the expansion
and fixes its safety boundary before the marketplace-catalogued plugin publishes
it from `main`.

## Decision

We will add one canvas, `decision-review` (display name "Decision review"), to
the existing `adrkit` extension at
`packages/adapters/agent-plugin/extensions/adrkit/`, and ship it in plugin
version 0.5.0. It shows which architecture decisions govern the current change
and, once a review has run, the `adr-review` verdicts. It is a view plus
explicit, user- or agent-triggered actions. It does not replace the
governing-decisions Action, has no exit-code authority, and is advisory in the
same sense as ADR-0045.

**Files.**

- `extension.mjs` stays SDK wiring only. It registers the existing `adr-review`
  workflow and the new canvas in **one** `joinSession({ workflows, canvases })`.
  Each registration is built in its own `try`, so a failing definition of one
  does not stop the other from loading; the failure is reported through
  `session.log` after joining. The registration logic lives in a module other
  than `extension.mjs`, behind injected seams, so the wiring is testable without
  the SDK.
- `canvas.mjs` holds the canvas logic and imports only `node:*` built-ins and
  `./review.mjs`. The page's HTML, JavaScript, and CSS are string exports from a
  module (for example `canvas-page.mjs`), so there is no file-path lookup at
  runtime.
- `review.mjs` may gain small, backwards-compatible exports. Its behavior and
  tests do not change. The canvas reuses `validateArgs`, `resolveCli`,
  `runCommand`, and `collectChangedFiles` from it.
- There is **no second extension directory**, because of the process count above.

**Declaration.** `id: "decision-review"`. The open input schema is
`{ base?, files?, dir? }`, with the workflow's meaning and the workflow's
validation. Actions, none of which starts with `canvas.` (the runtime rejects
that prefix as reserved, measured):

- `get_state` returns the current snapshot.
- `refresh` re-runs Collect and Check only. **Zero model spend.**
- `show_review` takes an `adr-review` result object the agent already holds,
  validates its shape defensively, keeps only the known keys, and displays it.
- `run_review` starts the `adr-review` workflow through
  `session.rpc.workflow.run({ name: "adr-review", args })`, returns
  `{ runId, status }`, and polls the run until it is terminal. **This is the
  only action that spends AI credits**, and its description says so.

**Open and close.** `open(ctx)` resolves the working directory from
`ctx.session?.workingDirectory` and throws `CanvasError("workspace_unavailable")`
when there is none. It is idempotent per `instanceId` (a re-open returns the same
URL), computes the snapshot by running Collect and Check in that directory, and
returns `{ url, title, status }` with a short status such as "3 governing · ok".
`onClose(ctx)` closes that instance's server.

**Working directory and CLI.** Every subprocess runs with `cwd` set to the
session working directory from `ctx`, never `process.cwd()`. The CLI is resolved
exactly as the workflow resolves it: `$ADRKIT_CLI`, then `./node_modules/.bin/adr`
only when `ADRKIT_ALLOW_REPO_CLI=1`, then `adr` on `PATH`, against that
directory. `cli` is not an argument of any action. A spawn failure or a usage
error appears in the panel as `usage-error` with its message. It is never a
crash and never `ok`.

**State.** `instanceId` names the panel, not the data. The per-instance server
and token live in memory keyed by `instanceId`; the snapshot is derived data,
recomputed on open and refresh and held in memory keyed by working directory.
**Nothing is persisted and the canvas writes no file anywhere.** The snapshot is
`{ workingDirectory, base, files, filesSource, status, checkExitCode,
lintExitCode, governing, history, activeProposals, findings, notes,
review: null | { runId?, runStatus, result }, updatedAt }`. Its status
vocabulary is the workflow's (`ok`, `findings`, `incomplete`, `usage-error`)
plus `pending` while a run is in flight.

**Server and page.** The security properties are load-bearing, and each has a
test:

- **Lazy, per-instance, loopback.** One `node:http` server per open instance,
  bound to `127.0.0.1` on port `0`, started inside `open()` and never at module
  load. Headless `copilot workflow run` and the many app session processes open
  no socket. It is closed in `onClose`.
- **Token, header, and Origin.** Each instance gets a 32-byte
  `crypto.randomBytes` hex token in the URL query. Every route checks it with a
  constant-time comparison and answers 403 on a mismatch. State-changing POSTs
  also require an `X-Adrkit-Token` header, so a hostile local page cannot forge
  one, and a POST whose `Origin` is present and is not the server's own origin is
  refused.
- **Fixed routes.** `GET /`, `/app.js`, `/app.css`, `/api/state`, and `/events`
  (SSE); `POST /api/refresh`, `/api/run-review`, and `/api/explain`. Everything
  else is 404. Request bodies are capped at 64 KB.
- **Headers on every response.** `Content-Security-Policy: default-src 'none';
  script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:;
  base-uri 'none'; form-action 'none'; frame-ancestors *`, plus
  `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. The host
  embeds the page in a frame, so no `X-Frame-Options: DENY`.
- **`textContent` only.** ADR titles, evidence, paths, notes, and messages are
  untrusted repository content. The page builds its DOM with
  `createElement` and `textContent`; it uses no `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, or `eval(`, and a test asserts the
  shipped script contains none.
- **Documented theme tokens only**, each with a fallback, so the panel follows
  the app's light and dark themes without depending on undocumented variables.

**Explain.** `POST /api/explain` accepts a `recordId` only when it matches
`^[0-9]{4}$` **and** is in the current snapshot, then calls
`session.send({ prompt })` with a fixed read-only prompt that names only that id
and asks the agent to explain the decision and how it applies to the change,
using read-only commands and file reads, without creating, editing, or
ratifying any record. No title or other repository text is ever interpolated
into a prompt, and the prompt does not name the writing commands.

**Contracts that carry over unchanged.** The canvas is advisory and read-only.
The wiring test's rule against the writing commands is already extended to
`extensions/` by ADR-0045, so it covers the page's HTML and script strings too.
The plugin stays dependency-free and Node-only: `@github/copilot-sdk/extension`
is imported only in `extension.mjs`, and no component uses the `Bun` global.
Extension code never writes to stdout, which carries JSON-RPC; anything
user-visible goes through `session.log`. The plugin moves 0.4.0 to 0.5.0 on
every version-bearing surface.

### Measured facts

Measured on 2026-10-08. Two environments, and the difference matters.

**Headless SDK host, Copilot CLI 1.0.93, no model calls.** A probe host
(`CopilotClient` and `createSession` with `requestCanvasRenderer: true`,
`requestExtensions: true`, and the plugin directory) drove
`session.rpc.canvas.{list,open,action.invoke,close}`.

1. A `.claude-plugin` manifest plugin delivers a canvas from the root
   `extensions/<dir>/extension.mjs`. The extension id is
   `plugin:<plugin>:<dir>`.
2. One `joinSession({ canvases, workflows })` registers both a canvas and a
   workflow.
3. An invalid workflow definition (missing `meta.phases`) throws at import and
   takes the whole extension down, canvas included.
4. `open()` and action contexts carry `session.workingDirectory`, equal to the
   session's directory, and no `host` field in a headless session. The
   extension process's `process.cwd()` equals the session directory.
5. An `open()` that returns a loopback URL works, and the page is fetchable.
   Action results round-trip. A `canvas.`-prefixed action name is rejected as
   reserved.
6. A canvas action can start a workflow in-process:
   `session.rpc.workflow.run({ name, args })` returned
   `{ runId, attempt, status: "running" }`.

**One maintainer session in GitHub Copilot app 1.1.14**, which runs its own
runtime (`1.0.93-1`, observed through `ps`) rather than the terminal CLI. The
runtime's environment carries the login-shell `PATH` (Homebrew, `~/.bun/bin`,
nvm, `/usr/local/bin`) and not launchd's minimal one, so a bare `adr` on `PATH`
can resolve there; `ADRKIT_CLI` is unset unless the user exports it in a shell
profile. The runtime's own working directory is `/` or `~/.copilot`, so a
per-session directory has to come from the session. The environment also lists
`COPILOT_MCP_APPS`. That session rendered one canvas from a probe extension, **not the shipped
canvas**.

What this record does not claim: the shipped canvas has not run in the app,
`ADRKIT_CLI` forwarding to the extension was not measured (the CLI strips
variables it considers sensitive unless an extension requests them, and whether
`ADRKIT_CLI` counts is unmeasured), and no model-spending `run_review` has run.

## Options considered

### Option A: Add the canvas to the existing extension, with guarded registrations (chosen)

| Dimension | Assessment |
|---|---|
| User model | One adrkit plugin, one extension; the canvas sits beside the workflow whose data it shows |
| Write boundary | Preserved: read-only, nothing persisted, `/adr-draft` remains the only writer |
| Process count | No added process per session; no socket until a canvas is opened |
| Authority | None; the Action stays the CI gate |
| Cost | A new component type, a local HTTP surface, and an experimental SDK API to track |

### Option B: A second extension directory for the canvas

**Pros:** Isolation: a canvas failure cannot touch the workflow, and the reverse.

**Cons:** The app starts one extension process per restored session (181 loads
observed), so a second directory doubles the process count for a convenience
that guarded registrations already provide. Rejected.

### Option C: A project-scope `.github/extensions` canvas

**Pros:** No change to the plugin inventory.

**Cons:** Every consuming repository would carry its own copy, and versions
would drift per repository. ADR-0045 rejected the same shape for the workflow,
and project extensions were excluded in an untrusted folder when measured then.
Rejected.

### Option D: Migrate the manifest to Agent Plugins 1.0 first

The public canvas samples ship through an Agent Plugins 1.0 manifest
(`extensions["com.github.copilot"]`). That would move `extensions/` and is
unmeasured against `claude plugin validate`, which settled the current
manifest's shape under ADR-0028. Deferred, not decided; ADR-0045 does not
pre-authorize it and neither does this record.

### Option E: Present the data through MCP Apps

`COPILOT_MCP_APPS` appears in the app's environment. MCP is already rejected
for plugins by ADR-0028, because a plugin's MCP server starts outside a Git
worktree. Nothing measured here reopens that, and a separate MCP surface would
not reuse the workflow's collection. Rejected.

### Option F: A canvas that can ratify or write records

Rejected. The plugin's contract is read-only, with `/adr-draft` the only writer
and a human ratifying through the ratifying command (ADR-0044). A panel button
would put a ratification one click from a model-written page and take it out of
the human's hands.

### Option G: Do nothing

The workflow's JSON payload and `/adr-check` cover scripts and interactive use.
The app user keeps reading a payload, and the data most worth seeing (which
decisions govern, which verdicts conflict) stays text.

## Trade-offs

A canvas is a listening socket. It binds only to loopback, only while a panel is
open, and every route needs a per-instance token; but any process on the same
machine can attempt connections to it, and the token travels in a URL the host
holds. The token, header, and Origin checks make a forged request fail rather
than make a connection impossible. Anything that can read the framed URL can use
the page, so the page is read-only and its only spending action is labelled.

The SDK API is `@experimental` throughout. A rename or a changed `ctx` shape is
a breaking change this plugin cannot see coming, and the failure mode is a
canvas that does not register, not an error the user is shown.

`run_review` spends credits and can be triggered by a model as well as by a
click. The label and the action description say so; neither prevents it. The
explain action sends a prompt into the user's conversation, which is a model
call too, and is bounded only by its fixed text and by an id taken from the
current snapshot.

Guarded registration trades a loud failure for a quiet one. A canvas that fails
to build now leaves the workflow working and logs one line, where before the
whole extension failed visibly.

## Consequences

- Easier: a person in the app sees what governs a change, what is history, what
  is unverified, and which verdicts conflict, without reading JSON; a refresh
  costs no credits.
- Harder: another component with its own contract to keep in step with the
  version surfaces, the wiring test, and the packaging test; a local server whose
  security properties must stay tested; and an experimental API to re-measure on
  each app and CLI upgrade.
- **How we would know this was wrong:** the canvas writes any file or invokes
  any writing command; a route answers without a valid token, or a POST succeeds
  without the header or with a foreign `Origin`; page script gains an
  `innerHTML`-family sink or a repository string reaches a prompt; a socket is
  opened at import or load; a second extension directory or process appears for
  the canvas; one registration failing again takes the other down; the app does
  not render the shipped canvas from a plugin install, or shows a different
  working directory than the session's; a panel reports `ok` after a spawn
  failure or a usage error; the experimental API changes and the canvas
  silently stops registering without the logged line; or users read the panel's
  status as a merge gate.
- Revisit if: the SDK's canvas API stabilizes or changes shape; the plugin
  adopts the Agent Plugins 1.0 layout; the app defines a gating mechanism for
  canvases; MCP plugin wiring becomes viable (ADR-0028's condition); or a second
  canvas is proposed.

## Evidence rung

**Rung 1** under ADR-0014, and only that: unit and contract coverage of the
pure logic, plus maintainer measurements against the installed hosts. The
headless measurements above are against the CLI SDK host, not the app. The single
app session covered one canvas render of a probe, not the shipped canvas; the
shipped canvas's app run will be added to
`docs/reference-verification-agent-plugin.md` when it happens. Unmeasured: the
shipped canvas in the app, `run_review` end to end through a canvas, `ADRKIT_CLI`
reaching the extension in the app, Copilot CLI and app versions other than those
named, GitHub-source (copied) plugin installs, and any external validation.

## Action items

1. [ ] Implement `canvas.mjs`, the page module, and the registration seam, and
   rewire `extension.mjs` to register the workflow and the canvas in one
   `joinSession` with each registration guarded.
2. [ ] Add `test/canvas.test.ts`, each test observed failing before it passes
   (ADR-0016): token and header and Origin checks, response headers, 404 and
   body cap, explain validation, snapshot across exit 0/1/2 and spawn failure,
   `show_review` and `run_review`, no server at import, open idempotence and
   close, `workspace_unavailable`, no `innerHTML`-family sink, and the
   registration seam in both failure directions.
3. [ ] Extend, without weakening, the wiring and packaging tests where they
   enumerate extension files.
4. [ ] Document the canvas, its actions, which one spends credits, and its
   security boundary in `docs/reference-verification-agent-plugin.md` and the
   plugin README.
5. [ ] Bump the plugin 0.4.0 to 0.5.0 on every version-bearing surface in the
   agent-plugin section of `docs/RELEASING.md`.
6. [ ] Live smoke, headless: open the shipped canvas through the SDK host, call
   `get_state` and `refresh`, and confirm the response headers and the 403 paths
   against the running server.
7. [ ] App smoke: install the plugin in the Copilot app, open the shipped
   canvas, confirm the working directory and CLI resolution, and record the
   result as a rung-1 measurement.
8. [ ] Add reciprocal notes to ADR-0028, ADR-0034, and ADR-0045 (drafted with this
   record), and ratify this record before the plugin publishes the canvas.
