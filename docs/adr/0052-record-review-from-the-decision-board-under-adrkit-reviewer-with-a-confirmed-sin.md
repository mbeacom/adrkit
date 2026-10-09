---
schemaVersion: 0.2.0
id: "0052"
title: "Record review from the decision board under ADRKIT_REVIEWER with a confirmed, single-use nonce"
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
  - "0016"
  - "0044"
  - "0046"
  - "0050"
  - "0051"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/board-review-write.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/board*.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/register.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/extension.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/test/wiring.test.ts"
provenance:
  authoredBy: agent-drafted
---

# ADR-0052: Record review from the decision board under ADRKIT_REVIEWER with a confirmed, single-use nonce

> **Status: proposed.** Agent-drafted and not ratified. This record amends
> [ADR-0050](./0050-ship-a-read-only-decision-board-canvas-that-maps-the-corpus-from-adr-graph-and-a.md)
> (the board is no longer write-free: its page can record review) and
> implements the plugin half that
> [ADR-0051](./0051-record-review-state-with-adr-approve-adr-object-and-adr-resolve.md)
> planned under "Agent boundary". It supersedes neither. ADR-0050's read-only
> actions, allowlists, budgets, and the absent readiness verdict stay binding.

## Context

ADR-0051 added `adr approve`, `adr object`, and `adr resolve`, and kept every
agent surface away from them with a wiring guard over every plugin component,
the canvases included. It named one future path: a person pressing a button on
the Copilot app's canvas, with the identity taken from `ADRKIT_REVIEWER`, never
from the model or a tool argument, under one narrow, tested exception for a
single module that handles the page's POST.

The decision board (ADR-0050) already lists every open proposal with its
approvals against quorum and its objection counts. A reviewer reading it has to
leave the app to change those counts.

Three facts about the CLI shape what the board can promise. Each was measured on
2026-10-09:

1. **A refusal has no machine-readable reason.** `@adrkit/cli` 0.18.0 with
   `--json` prints `{ id, path, by, changed, … }` on exit 0. On a refusal
   (exit 1) it prints nothing on stdout; the reason and any findings go to
   stderr. So the board can say "refused" and nothing more specific without
   reading stderr, which it never shows.
2. **An older CLI is indistinguishable by exit code.** `@adrkit/cli` 0.17.0 on
   `approve`, `object`, or `resolve` exits 2 with `Error: Unknown command` and
   its help on stderr, and nothing on stdout. 0.18.0 also exits 2 on a usage
   error, for example an id the corpus lacks or an unreachable `--dir`.
   `adr --version` tells them apart: `0.17.0` and `0.18.0`.
3. **`--summary` takes its value as the next argument unless written as
   `--summary=<text>`**, so a summary that starts with `-` must be passed as one
   `--summary=` element (the CLI's own help says so).

## Decision

We will add approve, object, and resolve controls to each open-proposal row of
the decision board, behind this boundary:

1. **The identity is the environment's.** The extension reads
   `ADRKIT_REVIEWER` on every request. It must pass core's
   `isWritableIdentity` rule (the schema's `Identity` plus no control or
   invisible format characters, ZWNJ and ZWJ allowed in an email), mirrored in
   the extension because an extension cannot import core, and a test compares
   the two over a table, with a 320-character cap on top. Unset or invalid, the
   controls render disabled with a fixed note, and both routes refuse. The page
   sends no identity; a request body with any key beyond the documented ones
   (`by` among them) is refused before anything runs.
2. **One module may name the verbs.** `board-review-write.mjs` holds the POST
   handler and is the only plugin module the wiring guard exempts, for the
   three review verbs only and never for ratification. Only `board.mjs` imports
   it, and only its HTTP route handler calls it. No canvas action, tool, hook,
   or workflow can reach it. Tests check the import graph, check that the
   actions' source never references the writer, and drive every action with
   write-shaped input while asserting that no review subcommand was spawned.
   Plants of the verbs in `board.mjs`'s actions, `board-page.mjs`, `tools.mjs`,
   `hooks.mjs`, and `canvas.mjs` still fail the guard, and a second exempt entry
   fails its own test.
3. **Two clicks and a fresh nonce per write.** The first click asks
   `POST /api/review/nonce` for a 32-byte nonce bound to that kind and record.
   The second click is a "Confirm … as <reviewer>" button in the page's own DOM,
   and it posts `POST /api/review` with the nonce. No browser dialog is used,
   because one can block the app. A nonce is single use, even for a refused
   attempt. A newer nonce on the same panel replaces it, and closing the panel
   drops it. It expires after two minutes. Both routes also need the per-panel
   URL token, the token in a header, and no foreign `Origin`, as every board
   POST does. The nonce is never part of a snapshot, so no canvas action result
   or event-stream frame carries it.
4. **argv only, validated first.** The CLI runs as
   `[subcommand, id, '--by', reviewer, '--json', ('--dir', dir)?, …]`, with the
   summary as one `--summary=<text>` element and the index as
   `'--objection', n`. Nothing goes through a shell. The id must match the
   record grammar, the summary must pass core's `objectionSummaryProblem` rules
   (mirrored and compared by a test), and the index must be a whole number from
   1. Each is checked before the spawn. The corpus directory is the one the
   board is showing, re-confined right before the spawn, as every graph and
   queue read is. One write runs at a time per board; a second gets 409.
5. **Fixed results only.** Exit 0 with `changed: true` is "recorded", and with
   `changed: false` it is "nothing changed". Exit 1 is one fixed refusal
   message, because of fact 1. On exit 2 the extension asks `adr --version`: a
   version below 0.18.0 gets "this adr CLI does not support review commands;
   upgrade @adrkit/cli to 0.18.0 or later", and anything else gets a fixed
   usage-error message. The nonce route also asks `adr --version` first, so an
   older CLI is refused before a write is ever spawned against it; a CLI seen
   new enough is not asked again at the nonce, but an exit 2 always asks
   afresh. Any other exit, a spawn failure, and a 30-second timeout each have
   their own fixed message. stderr and exception text never reach the page,
   the agent, or the log.
6. **After a write, re-read.** The board re-reads its graph and the shared
   queue, waits for the queue, and returns the new snapshot with the result,
   so the counts change in the same response. Other boards on the same corpus
   get the queue broadcast.
7. **Still no readiness verdict.** An approval that meets quorum is shown as
   its counts. The board never says a record is ready, and neither the page nor
   the write module names the ratifying command.
8. **Logged, not narrated.** Every spawned write is logged through
   `session.log`, fire-and-forget, as
   `adrkit: decision board review <kind> on ADR-<id> as <identity>: <outcome>`.
   It never includes the summary or any repository text. A log that hangs,
   rejects, or throws does not hold or break the write. This is the board's
   only use of the session, so its factory now takes a session getter, which
   amends ADR-0050's "its factory takes no session at all".
9. **The required CLI is `@adrkit/cli` 0.18.0 or later.**

## Options considered

### Option A: page-only controls with an environment identity and a nonce (chosen)

Meets ADR-0051's boundary as written, and costs one exempt module.

### Option B: a canvas action the model can call to record review

Rejected by ADR-0051: canvas actions are model-callable, so the model could
record a person's review on its own initiative.

### Option C: let the page supply the identity

Rejected: any script that can reach the page could claim any identity. The
environment is set by the person who started Copilot.

### Option D: `window.confirm` for the confirmation

Rejected: a browser dialog can block the app's renderer, and an in-DOM button
is testable.

### Option E: parse the CLI's stderr to show the refusal reason

Rejected: stderr is unstructured, can carry repository text and stack frames,
and the CodeQL `js/stack-trace-exposure` finding on #267 set the rule that only
fixed messages reach a page. A machine-readable refusal code from the CLI is
the right fix (see "Revisit if").

## Trade-offs

- **The nonce does not stop a local process that already has the panel's
  token.** Any process that can read the panel URL can request a nonce and
  spend it, as the page does. The nonce stops a replayed or scripted POST that
  lacks a fresh nonce, and a request from a foreign page. The token and the
  `Origin` check are what stop other origins.
- **A refusal says less than the terminal does.** "Refused (exit 1)" with the
  likely causes, not which one. Running the CLI in a terminal shows the reason.
- **Resolve takes an index the page cannot verify.** The queue reports objection
  counts, not objections, so the page cannot show which objection is the
  reviewer's. A wrong index, or someone else's objection, is refused by the CLI
  with the same fixed message.
- **The page re-renders on every event-stream frame**, so a typed summary is
  kept in page state across renders, but keyboard focus in the input can be lost
  when a queue refresh lands.
- **An older CLI shows enabled controls until a person arms one.** The version
  check runs at the first click, not at open, so opening a board costs no extra
  spawn.

## Consequences

- Easier: a reviewer records an approval, an objection, or a resolution from
  the board, and sees the counts change.
- Harder: one module is exempt from the verb guard, and the guard test now pins
  exactly which one.
- **How we would know this was wrong:** a canvas action, tool, hook, or
  workflow reaches the write module; a write runs without a fresh nonce or with
  an identity from anywhere but `ADRKIT_REVIEWER`; stderr, exception text, or
  a summary appears in a page reply or the log; the board shows a readiness
  verdict or the ratifying command; or a second module names the verbs.
- **Revisit if:** the CLI gains a machine-readable refusal code under `--json`
  (core already has `ReviewRefusalCode`), which would let the page say which
  refusal it was; or the queue starts reporting objections themselves, which
  would let the page offer only the reviewer's own.

## Evidence rung

**Rung 1** under ADR-0014. Unit and contract tests, each observed failing
before it passed: before the module existed, or under one of 24 mutations of
the code it covers (three survived, two of them equivalent; the third exposed a
weak test, which was fixed and then observed failing). An end-to-end test
drives the routes against the repository's built CLI on a fixture corpus.

A headless SDK-host smoke was run on 2026-10-09 with the SDK client from the
Copilot CLI 1.0.93 package and the `copilot` 1.0.94-3 runtime. It used
`ADRKIT_REVIEWER=@fixture-reviewer`, a two-record fixture, and the branch's
built CLI, sent no prompt, and ran no workflow, so it made no model calls. It
recorded an approval, an objection, and a resolution through the page routes;
the fixture's frontmatter and the queue counts changed as expected. A replayed
nonce, a missing header token, and a foreign `Origin` got 403, and a body
identity got 400. With the reviewer unset the controls were off. With
`@adrkit/cli` 0.17.0 the nonce route answered with the upgrade message.

**The controls are unmeasured in the Copilot app**: the click flow, the
confirmation step, and the rendering there have not been seen. No
reference-repository run and no external validation.

## Action items

1. [x] Add `board-review-write.mjs`, route `/api/review/nonce` and
   `/api/review` to it from `board.mjs`, and add the controls to the page.
2. [x] Narrow the wiring guard to exactly one exempt module for the review
   verbs, and test the import graph and the action boundary.
3. [x] Headless SDK-host smoke on a fixture, recorded in
   `docs/reference-verification-agent-plugin.md`.
4. [ ] Exercise the controls in a Copilot app session and record the app
   version.
5. [ ] Ratify or reject this record.
