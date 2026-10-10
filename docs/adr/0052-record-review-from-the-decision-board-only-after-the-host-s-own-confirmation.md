---
schemaVersion: 0.2.0
id: "0052"
title: "Record review from the decision board only after the host's own confirmation"
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
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/panel-http.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/register.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/extensions/adrkit/extension.mjs"
  - type: path
    pattern: "packages/adapters/agent-plugin/test/wiring.test.ts"
provenance:
  authoredBy: agent-drafted
---

# ADR-0052: Record review from the decision board only after the host's own confirmation

> **Status: proposed.** Agent-drafted and not ratified. This record amends
> [ADR-0050](./0050-ship-a-read-only-decision-board-canvas-that-maps-the-corpus-from-adr-graph-and-a.md)
> (the board is no longer write-free: its page can record review) and
> implements the plugin half that
> [ADR-0051](./0051-record-review-state-with-adr-approve-adr-object-and-adr-resolve.md)
> planned under "Agent boundary". It supersedes neither. ADR-0050's read-only
> actions, allowlists, budgets, and the absent readiness verdict stay binding.
>
> **Revised after review (round 1).** The first version treated the page's two
> clicks and a nonce as the boundary. Review measured that the model receives
> the panel's URL and token and can do everything the page does over HTTP. The
> boundary is now the host's confirmation dialog, which the model cannot
> answer. The nonce and the two clicks remain as defence in depth only.
>
> **Revised again (round 2).** The dialog now leads with the record and the
> action, a write that arrives while another is pending is told which one,
> the board may ask at most once per 10 seconds and five times per 10 minutes
> across all its panels,
> and an unreadable agent mode is refused. The record was retitled from "…
> with a confirmed, single-use nonce", which named a control that is not the
> boundary.

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

Facts that shape the design, each measured on 2026-10-09:

1. **The model holds the panel's URL and token.** The runtime's built-in
   `open_canvas` tool returns the provider's `OpenCanvasInstance`, `url`
   included, as the model-visible tool result, and the model can open its own
   board instance at any time. With its shell tool it can then call any route
   the page calls, with any headers. Measured by review on the `copilot`
   1.0.94-3 runtime through `rpc.tools.execute('open_canvas')` and `bash` with
   `curl`: an approval was recorded with no page and no click.
2. **An extension's `session.ui.confirm` goes to the host, not the model.** It
   is an elicitation: the runtime routes it to the host's elicitation handler
   (the person's UI) and returns its answer. The model only ever sees the
   enclosing result. With no handler, `session.capabilities.ui.elicitation` is
   `false` and `confirm` throws `Elicitation is not supported by the host`.
3. **No permission or agent mode answers an elicitation on its own** at the
   runtime layer. Measured through an SDK host with a handler that records
   each call: in permission modes `manual`, `assisted`, and `allow-all`, after
   `setApproveAll(true)`, and in agent mode `autopilot` (with `allow-all` and
   with `manual`), each `confirm` reached the handler exactly once and
   returned its answer (`false` for a decline, `true` for an accept).
4. **The CLI's terminal UI declines elicitations in autopilot.** Read from the
   1.0.93 bundle (`cli-main.js`): on `elicitation.requested`, when the agent
   mode is `autopilot`, it answers `{ action: "decline" }` without showing a
   dialog; in every other mode it queues a dialog. Not exercised
   interactively.
5. **A refusal has no machine-readable reason.** `@adrkit/cli` 0.18.0 with
   `--json` prints `{ id, path, by, changed, … }` on exit 0. On a refusal
   (exit 1) it prints nothing on stdout; the reason goes to stderr.
6. **An older CLI is indistinguishable by exit code.** 0.17.0 exits 2 on the
   unknown subcommand, as 0.18.0 does on a usage error; `adr --version` tells
   them apart.
7. **`--summary` and `--by` take the next argument as their value** unless
   written as `--flag=value`, so a value that starts with `-` must be passed
   as one element.

## Decision

We will add approve, object, and resolve controls to each open-proposal row of
the decision board, behind this boundary:

1. **The person confirms every write in the host's own dialog.** Before it
   spawns anything, the write route calls `session.ui.confirm(...)`, and only
   a literal `true` within two minutes proceeds. A throw, a timeout, a decline,
   or any other answer writes nothing and returns a fixed "not confirmed"
   result. If the host does not offer elicitation
   (`capabilities.ui.elicitation` is not `true`), the controls render
   disabled with a fixed note ("this host cannot ask you to confirm a review
   write") and both routes refuse. If the session's agent mode reads
   `autopilot`, the route refuses before asking, whatever the host would do.
   If reading the mode throws, it refuses too; a session with no mode method
   at all is still asked, because the confirmation still guards. The dialog
   text is built only from fixed strings, the kind, the validated record id,
   the identity from `ADRKIT_REVIEWER`, and numbers (the objection index, or
   the summary's length). It never contains the summary or a title, which are
   untrusted and which a forged request controls. **Its first line is the
   record and the action**, such as `ADR-0042 · approve as @x`, and the fixed
   explanation follows, so the record is what the person reads first.
   - **A pending confirmation is named.** While one write waits for the host,
     another gets a 409 that names the pending kind and record ("GitHub
     Copilot is already asking you to confirm an approval of ADR-0042. Decline
     it unless you started it, then try again."), and the page shows it as a
     warning.
   - **Dialogs are rate-limited across the whole extension**: at most one per
     10 seconds and five per sliding 10 minutes, counted over every board panel
     in the extension process, so opening, closing, or reopening a panel does
     not reset the budget. A Copilot session belongs to one person, so a
     shared budget throttles nobody else. Over either limit the route answers
     429 with a fixed message, asks nothing, spawns nothing, and logs the
     refusal.
2. **The identity is the environment's.** The extension reads
   `ADRKIT_REVIEWER` on every request. It must pass core's
   `isWritableIdentity` rule, mirrored in the extension (an extension cannot
   import core) and compared with core by a test, plus a 320-character cap.
   Unset or invalid, the controls are disabled with a fixed note and both
   routes refuse. A request body with any key beyond the documented ones (`by`
   among them) is refused. Canvas action results carry whether the controls
   are on and the fixed reason, never the identity; the page's own HTTP state
   carries it for its labels.
3. **One module may name the verbs.** `board-review-write.mjs` holds the POST
   handler and is the only plugin module the wiring guard exempts, for the
   three review verbs only and never for ratification. Only `board.mjs` names
   it, once, as a static import it does not re-export, and only its HTTP route
   handler calls it. No canvas action, tool, hook, or workflow imports it. This
   is a code-structure rule. It does **not** keep the model away from the
   write: the model reaches the routes over HTTP (fact 1). Decision 1 is what
   does.
4. **The page's two clicks and the nonce are defence in depth.** The first
   click asks `POST /api/review/nonce` for a 32-byte nonce bound to that kind
   and record, and the second, an in-page "Confirm … as <reviewer>" button
   placed after a Cancel button so a double click cannot land on it, spends
   it on `POST /api/review`. The nonce is single use, even for a refused
   attempt. A newer nonce on the same panel replaces it, closing the panel
   drops it, and it expires after two minutes. It is never part of a canvas
   action result. **It does not stop the model**: anything holding the token,
   which the model does, can mint and spend one exactly as the page does. It
   stops a replay of a captured request, and it makes each write an explicit,
   bound request.
5. **Origin hardening on the review routes.** On top of the URL token and the
   `X-Adrkit-Token` header every board POST needs, the two review routes
   require an `Origin` that is exactly the panel's own (a request with none is
   refused) and, when `Sec-Fetch-Site` is sent, `same-origin`. This stops
   naive scripts and other pages. **curl can send both headers**, so it is not
   the boundary either.
6. **argv only, validated first.** The CLI runs as
   `[subcommand, id, '--by=<reviewer>', '--json', ('--dir', dir)?, …]`, with
   the summary as one `--summary=<text>` element and the index as
   `'--objection', n`. Nothing goes through a shell. The id, the summary
   (core's `objectionSummaryProblem` rules, mirrored and compared by a test),
   and the index are checked before the confirmation is asked. The corpus
   directory is the one the board shows, re-confined before the spawn. One
   write, including its confirmation, runs at a time per board; a second gets
   409.
7. **Fixed results only.** Exit 0 with `changed` is "recorded" or "nothing
   changed"; exit 1 is one fixed refusal message (fact 5); exit 2 asks
   `adr --version` afresh, and below 0.18.0 gets "this adr CLI does not
   support review commands; upgrade @adrkit/cli to 0.18.0 or later",
   otherwise a fixed usage-error message. The nonce route asks for the version
   first too. Any other exit, a spawn failure, and a 30-second timeout each
   have a fixed message. stderr and exception text never reach the page, the
   agent, or the log, and a refusal's reply text is looked up by code.
8. **After a write, re-read.** The board re-reads its graph and the shared
   queue and returns the new snapshot with the result.
9. **Still no readiness verdict**, and neither the page nor the write module
   names the ratifying command.
10. **Logged, not narrated.** Every write attempt that reaches the
    confirmation is logged through `session.log`, fire-and-forget, as
    `adrkit: decision board review <kind> on ADR-<id> as <identity>: <outcome>`
    (`not-confirmed` included), never with the summary. The board's factory
    now takes a session getter for the confirmation, the agent mode, and the
    log, which amends ADR-0050's "its factory takes no session at all".
11. **The required CLI is `@adrkit/cli` 0.18.0 or later.**

## Options considered

### Option A: page controls, host confirmation as the boundary (chosen)

Meets ADR-0051's intent where the host shows its elicitation dialog to a
person. Costs one exempt module and one dialog per write.

### Option B: page controls with the nonce and two clicks as the boundary (first draft, rejected by review)

Measured broken: the model holds the token and can drive the routes itself.

### Option C: a canvas action the model can call to record review

Rejected by ADR-0051: canvas actions are model-callable.

### Option D: let the page supply the identity

Rejected: any holder of the token could claim any identity.

### Option E: keep the token out of the URL (a cookie or a page-held secret)

`open()` must return a URL the app frames, and that URL reaches the model. A
one-shot bootstrap token exchanged for a cookie depends on cookie behavior in
a cross-site loopback iframe in the app, which is unmeasured and likely blocked;
a "first claimer wins" page secret is a race the model can win. Either would
make a forged write detectable, not impossible.

### Option F: parse the CLI's stderr to show the refusal reason

Rejected: stderr is unstructured, can carry repository text and stack frames,
and only fixed messages reach a page (CodeQL `js/stack-trace-exposure` on #267).

## Trade-offs

- **The boundary is the host's dialog, and the app is only partly measured.**
  Facts 2–4 hold for the runtime (measured) and for the CLI's terminal UI (read
  from its bundle). In the Copilot app (runtime 1.0.94-3, 2026-10-10), the
  maintainer saw the board's controls enabled, the host's dialog shown for an
  approval, a decline write nothing, and an accept write the approval. Whether
  the app ever answers the dialog without a person (for example in an
  autonomous mode) is still not known. If the app answered `true` on its own, the model could record review
  as `ADRKIT_REVIEWER` with no person involved. The extension's own autopilot
  refusal covers the one mode it can see; it cannot see a host that
  auto-accepts in some other way. **This residual risk is the maintainer's to
  accept or to close by measuring the app before the controls are relied on.**
- **A dialog the person did not start can look like one they did.** A
  prompt-injected model can open its own panel and POST an approval of
  ADR-0042, so the host's dialog for it is pending. The person then confirms
  an approval of 0002 on the board, their write is turned away because one is
  pending, and the one dialog on screen is the model's, just when they expect
  one. Three things narrow this. The dialog's first line names the record and
  the action. The person's 409 says which confirmation is pending and to
  decline it unless they started it. And the board cannot keep a dialog up
  continuously: one per 10 s and five per 10 minutes, across every board
  panel, so a model that opens fresh panels gets no fresh budget. Within the
  budget a model can still stage a dialog now and then, and a person who
  answers yes without reading the first line can still approve the wrong
  record.
- **A person can still be talked into "yes".** A prompt-injected model can
  start a write and the dialog will appear; a person who accepts without
  reading has approved it. The dialog names the record, the kind, and the
  identity, and says to decline unless the person just asked for it on the
  board. It cannot say whether the request came from the page.
- **The model can start writes, so it can also make dialogs appear.** That is
  a nuisance, not a write, and the log names every attempt and its outcome,
  rate-limited ones included.
- **The dialog guards the board's write path, not review state in general.**
  A model with shell access can still run `adr approve <id> --by=<anyone>`
  directly, edit a record's frontmatter, or edit the installed extension and
  reload it. ADR-0051's agent boundary is about which plugin surfaces exist,
  and reviewing the pull request diff is the backstop for review state
  however it was written.
- **A token holder can cancel a person's armed confirmation.** Any POST to the
  write route spends the panel's live nonce first, and a "busy" refusal spends
  it too, so another client holding the token can make the page's Confirm fail
  with "expired or already used". The person re-arms. This is denial of
  service only.
- **A refusal says less than the terminal does**, and resolve takes an index
  the page cannot verify (the queue reports counts, not objections).
- **An older CLI shows enabled controls until a person arms one**, because the
  version check runs at the first click.

## Consequences

- Easier: a reviewer records an approval, an objection, or a resolution from
  the board, confirms it in the host's dialog, and sees the counts change.
- Harder: one exempt module, one dialog per write, and a host requirement
  (elicitation) without which the controls stay off.
- **How we would know this was wrong:** a review is written without a `true`
  from the host's confirmation; a person approves a record they did not
  choose because a staged dialog looked like their own; a host answers that confirmation without a
  person (in the app, in any mode); the dialog shows the summary or a title; a
  write runs with an identity from anywhere but `ADRKIT_REVIEWER`; stderr,
  exception text, or a summary appears in a reply or the log; the board shows
  a readiness verdict or the ratifying command; or a second module names the
  verbs.
- **Revisit if:** the app is measured (either way); the runtime stops handing
  canvas URLs to the model; the CLI gains a machine-readable refusal code
  under `--json`; or the queue starts reporting objections themselves.

## Evidence rung

**Rung 1** under ADR-0014. Unit and contract tests, each observed failing
before it passed: before the code existed, or under a mutation of the code it
covers. The first round ran 24 mutations; the review round ran 15 more and
the second review round 11 more, all killed. An end-to-end test drives the routes against the repository's built
CLI on a fixture corpus.

Headless SDK-host measurements on 2026-10-09 (SDK client from the Copilot CLI
1.0.93 package, `copilot` 1.0.94-3 runtime, no prompt, no workflow, so no
model calls). They are recorded in
`docs/reference-verification-agent-plugin.md`:

- the elicitation routing and mode matrix behind facts 2 and 3;
- the review's attack, re-run after the fix. It used only what the model sees
  (`open_canvas`'s result) and its `bash` tool. With no elicitation handler,
  the controls were off and every request was refused. With a handler that
  declines, the forged request ended `not-confirmed` and the fixture was
  unchanged. Only a handler that accepts let it write. A request with no
  `Origin` got 403 in all three.

**In the Copilot app** (maintainer, 2026-10-10, runtime 1.0.94-3, published
`@adrkit/cli` 0.18.0), the controls were enabled under `ADRKIT_REVIEWER`, and
the host's dialog appeared for an approval. A decline wrote nothing, an accept
wrote exactly the approval, and a second click within 10 seconds was
rate-limited. Object and Resolve, the dialog's lead-line wording, an `Origin`
refusal, and the app's behavior in autonomous modes were not measured. No
reference-repository run and no external validation.

## Action items

1. [x] Add `board-review-write.mjs`, route `/api/review/nonce` and
   `/api/review` to it from `board.mjs`, and add the controls to the page.
2. [x] Require the host's confirmation for every write, failing closed, and
   refuse in autopilot.
3. [x] Narrow the wiring guard to exactly one exempt module for the review
   verbs, and test the module's reachability and the action boundary.
4. [x] Headless SDK-host measurements, recorded in
   `docs/reference-verification-agent-plugin.md`.
5. [x] Measure in a Copilot app session that the app offers elicitation to the
   board and shows the dialog to the person, that a decline writes nothing,
   and that an accept writes (runtime 1.0.94-3, 2026-10-10).
6. [ ] Measure in the app that it never answers the dialog on its own,
   autopilot included; exercise Object and Resolve there; and record the app
   version.
7. [ ] Ratify or reject this record.
