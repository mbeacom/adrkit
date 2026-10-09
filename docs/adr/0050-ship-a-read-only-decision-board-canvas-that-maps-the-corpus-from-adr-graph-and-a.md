---
schemaVersion: 0.2.0
id: "0050"
title: "Ship a read-only decision-board canvas that maps the corpus from adr graph and adr queue"
status: proposed
date: 2026-10-09
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
  - "0014"
  - "0033"
  - "0044"
  - "0046"
  - "0047"
  - "0049"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/board*.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/panel-http.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/register.mjs"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
---

# ADR-0050: Ship a read-only decision-board canvas that maps the corpus from adr graph and adr queue

> **Status: proposed.** Agent-drafted and not ratified. This record amends
> [ADR-0046](./0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md)
> and
> [ADR-0047](./0047-show-provenance-review-cost-and-a-read-only-proposal-queue-in-the-decision-revie.md);
> it supersedes neither. Their read-only, advisory, security, and
> process-count boundaries remain binding and apply to the new canvas as well.

## Context

The `decision-review` canvas (ADR-0046, ADR-0047) is scoped to one session's
change: it lists the decisions that govern the changed files. An architecture
review board (ARB) asks two questions the change-scoped view cannot answer:

- **How do the decisions relate?** Which record supersedes which, which relate,
  and which conflict, across the whole corpus.
- **What is waiting for review, and why is it not moving?** Approvals against
  quorum, unresolved objections, SLA state, the deadline, and who a proposal is
  routed to.

The CLI already computes both. `adr graph --format json` prints
`{ nodes: [{ id, title, status }], edges: [{ from, to, kind }] }`, with `kind`
one of `supersedes`, `relatesTo`, `conflictsWith`, and it accepts `--focus <id>`
and a repeatable `--kind`. Its exit codes are 0, 1 (a complete graph, with
another record invalid), and 2 (usage, including a focus id the corpus lacks).
`adr queue --format json` prints QueueReport v1 (ADR-0047). An app user has
neither view without leaving the app.

Two traps come with the queue data. First, `adr queue`'s terminal view prints
the ratifying command for a human (ADR-0044), and no plugin component may carry
that command (ADR-0028's wiring test). Second, a board that labels a proposal
"ready" would be making a claim it cannot back: AGENTS.md records that review
state alone misses refusals such as an empty `deciders`, which is why the
queue's terminal view runs `acceptAdrSource` as a dry run rather than checking
fields.

### What was measured

Measured on 2026-10-09 with Copilot CLI 1.0.93's SDK host (`pluginDirectories`
pointed at this branch, `ADRKIT_CLI` at the branch's built CLI, no prompt sent,
no workflow run, so no model calls):

1. **Against this repository (49 records):** the board opened with status
   `49 records · 238 relationships`; the snapshot carried 49 nodes and 238 edges
   (236 `relatesTo`, 2 `supersedes`) and 3 queue rows at 19.6 KB serialized. A
   focus on 0046 re-ran `adr graph --focus 0046` and returned 10 records and 9
   relationships. A kind filter of `supersedes` returned 4 records and 2
   relationships. A focus on 9999 returned the fixed exit-2 note.
2. **Against a four-record fixture:** 4 records, no relationships, 2 queue rows;
   a focus on 0004 returned 1 record.
3. **Input validation happens twice for kinds, once for ids.** The runtime
   checked the action's JSON Schema before the handler ran: an unknown kind was
   refused with the runtime's own schema message. A malformed id has no schema
   pattern, so it reached the handler and was refused there with the board's
   fixed message.
4. **The 403s, the CSP, and the port release behaved as decision-review's:**
   no token or a wrong token gave 403 on every route tried; a POST without the
   header token or with a foreign `Origin` gave 403; both panels' ports refused
   connections after close.
5. **The ratifying command reaches the snapshot only as repository text.** It
   appeared in `/api/state` exactly once, inside ADR-0044's own title; with
   titles blanked, the snapshot did not contain it. `/app.js` did not contain
   it.

A local render in Chromium (Playwright, not the Copilot app) applied the
status classes to the SVG nodes, the dash pattern to `relatesTo` edges, and
moved keyboard focus back to a record after Enter selected it.

## Decision

We will add a second canvas, `decision-board`, to the plugin's single extension,
in `board.mjs` (server and actions), `board-page.mjs` (page), and
`board-layout.mjs` (layout). The HTTP hardening both canvases use moves from
`canvas.mjs` into `panel-http.mjs`, so there is one copy.

1. **Read-only and free.** The board writes nothing, starts no workflow, sends
   no prompt, and spends no credits. Its factory takes no session at all. There
   is no approve, object, or ratify control; review state lives in record
   frontmatter, and ratifying stays a human-only CLI step (ADR-0044).
2. **No readiness verdict.** A queue row shows its raw facts only:
   approvals against quorum, unresolved and resolved objection counts, SLA
   state, deadline, routing targets, and how many findings it carries. The board
   never says a record is ready, eligible, or ratifiable. A field check would
   miss refusals the dry run catches, so a verdict would be a claim the board
   cannot back.
3. **CLI semantics, not homemade ones.** A focus or kind filter re-runs
   `adr graph --format json --focus <id> --kind <kind>`; the board does no graph
   filtering of its own, so it cannot disagree with `adr graph`. The id must
   match a record's own grammar (four or more digits, or a ULID) and each kind
   must be one of the three, checked in the extension before anything is
   spawned; refusals are fixed messages chosen by which check failed.
4. **Allowlists and budgets, as in ADR-0047.** A node keeps `id`, `title`,
   `status`; an edge keeps `from`, `to`, `kind`; a queue row keeps the nine
   fields `decision-review` keeps plus `resolvedObjectionCount` and an
   `itemFindingCount`. Anything else is dropped unnamed. Titles are clipped to
   200 characters. The board draws at most 300 records and 1000 relationships
   and lists at most 200 queue rows; past 300 records it shows counts by status
   and asks for a focus, as ADR-0033's terminal view does. One snapshot is held
   to 512 KiB by `Buffer.byteLength`: the graph becomes a summary first, then
   the queue rows go. Each CLI call has a 30 s timeout. Every failure is a fixed
   note, never stderr or exception text.
5. **Layout on the server, in a pure module.** `board-layout.mjs` is
   deterministic: columns come from supersession only (the replaced record sits
   left of its successor), each supersession component gets its own band of
   rows, records outside any chain fill a grid, and every tie breaks by id. A
   cycle terminates. The page draws the coordinates it is sent.
6. **Rendering.** SVG built with `createElementNS`, text through `textContent`
   only, classes through `setAttribute('class', …)`; no library, no HTML sink,
   no inline script or style, and the same CSP as decision-review. Status is
   shown by color and by a text label; a relationship kind by line style and a
   legend. The theme reuses decision-review's app tokens. Records are focusable,
   and Enter selects one; the detail pane shows its fields, its neighbors, and
   its queue row if it has one.
7. **Agent surface.** `get_state`, `refresh`, and `focus({ id?, kinds? })`, all
   described as read-only with no model calls. Invalid input throws
   `invalid_input`. Open, refresh, and focus accept `null` input, as the app's
   agent was measured sending it.
8. **Packaging.** The board registers as a second entry in `canvases`, built in
   its own guarded `try` in `register.mjs`, so a throwing board costs neither
   the workflow, decision-review, the tools, nor the hooks. Its server starts
   lazily inside `open()`. It takes its directory from
   `ctx.session.workingDirectory`.

The post-edit hook (ADR-0049) does **not** refresh open boards. Adding a graph
and a queue read under the hooks' 15 s single-flight signal would complicate
caps that were tuned for one canvas, for a view whose subject (the corpus)
rarely changes in an edit. The page's Refresh and the agent's `refresh` remain.

## Options considered

### Option A: A separate read-only canvas that renders the CLI's graph and queue (chosen)

Keeps decision-review change-scoped and the board corpus-scoped, with both
answers coming from the CLI.

### Option B: Add the graph to decision-review

One panel would mix a change-scoped status with a corpus-wide map, and the
status line, the refresh cost, and the hooks' refresh would all grow.

### Option C: Filter and lay out in the page

Smaller server, but a focus in JS could disagree with `adr graph --focus`, and
a browser-side layout cannot be tested under Node.

### Option D: Show a "ready" badge from approvals and objections

Rejected: it would be wrong exactly where the dry run refuses (an empty
`deciders`, an invalid record), and the board cannot run that dry run without
naming the ratifying transition.

### Option E: A graph library

Rejected: the plugin ships no dependencies, and an extension cannot import one.

## Trade-offs

- The board runs two CLI calls per refresh and one per focus, all free and
  bounded by 30 s each.
- The layout is simple: it does not minimize edge crossings, so a dense
  `relatesTo` web is busy. A focus or a kind filter is the intended remedy, and
  past 300 records the board stops drawing.
- One extension process now serves two canvases. A board server starts only
  when a board is opened.

## Consequences

- Easier: an ARB member sees the corpus's relationships and the review queue's
  raw facts in the app, and can focus on a record, without spending.
- Harder: one more canvas, three more modules, and one shared hardening module
  that both canvases' tests now cover.
- **How we would know this was wrong:** the board and `adr graph --focus`
  disagree about a neighborhood; the board shows a readiness verdict, or a
  control that writes, ratifies, or starts a workflow; a planted field (a
  ratifying command among them) reaches the snapshot, the served state, the page,
  or an action result (a record whose own title reads like the command is data,
  not a failure); CLI stderr or exception text reaches the page or the agent; a
  throwing board takes down decision-review, the workflow, the tools, or the
  hooks; opening the extension binds a port without a board being opened; or
  the snapshot exceeds its budget.

## Evidence rung

**Rung 1** under ADR-0014: unit and contract tests (each new one observed
failing before it passed: before its code existed, or under a mutation of the code it covers), and the
headless Copilot CLI 1.0.93 SDK-host smoke above. **The board is unmeasured in
the Copilot app**: it has not been rendered in an app session, and its theme,
keyboard behavior, and layout there are unverified. No reference-repository run
and no external validation.

## Action items

1. [x] Add `board.mjs`, `board-page.mjs`, and `board-layout.mjs`, and move the
   shared HTTP hardening into `panel-http.mjs`.
2. [x] Register the board in its own guarded `try`.
3. [x] Tests for layout, allowlists, the absent verdict, filters, hardening,
   the lazy server, and registration isolation, each observed failing first.
4. [x] Headless SDK-host smoke against this repository and a fixture,
   recorded in `docs/reference-verification-agent-plugin.md`.
5. [ ] Render the board in a Copilot app session and record it with the app
   version.
6. [ ] Ratify or reject this record.
