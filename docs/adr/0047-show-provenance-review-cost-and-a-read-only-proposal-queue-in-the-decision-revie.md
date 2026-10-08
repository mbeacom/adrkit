---
schemaVersion: 0.2.0
id: "0047"
title: "Show provenance, review cost, and a read-only proposal queue in the decision-review canvas"
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
  - "0014"
  - "0022"
  - "0044"
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

# ADR-0047: Show provenance, review cost, and a read-only proposal queue in the decision-review canvas

> **Status: proposed.** Agent-drafted and not ratified. This record amends
> [ADR-0046](./0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md);
> it supersedes nothing. ADR-0046's read-only, advisory, security, and
> process-count boundaries remain binding and are unchanged here.

## Context

ADR-0046 shipped the `decision-review` canvas: a panel in the GitHub Copilot app
that lists the decisions governing the current change and, once `adr-review`
has run, its verdicts. Three gaps showed up once it was in use:

- **The panel said what governs, not why.** Each governing decision had an
  evidence section listing its `firedMatchers`, but a record that governs only
  because a changed file names it in an inbound marker has empty
  `firedMatchers`, so the panel printed "No evidence recorded." for a decision
  whose evidence is the most specific there is. `adr check --json` already
  carries that evidence as `declaredBy`; the canvas's projection dropped it.
- **Run review did not say what it would spend before spending it.** The
  button said "uses AI credits" and nothing more. The cost is not a mystery:
  the workflow's Judge phase is `ctx.pipeline(governing, … ctx.agent(…))` in
  `review.mjs`, one `decision-checker` call per governing decision, and zero
  when there are none. With changed files but no governing decision, the button
  was enabled and a run would judge nothing.
- **Open proposals were invisible unless the change touched them.** The panel's
  "Active proposals" list is change-scoped: it shows `proposed` records whose
  `affects` fire on the changed files. A reviewer in the app had no view of the
  corpus-wide queue that `adr queue` already computes, so a proposal waiting on
  review elsewhere stayed out of sight.

The third gap has a trap in it. `adr queue`'s terminal view prints the
ratifying command for a human when a dry run says it would succeed
(ADR-0044). The plugin's contract is that no component names that command
(ADR-0028, ADR-0034, ADR-0045's wiring test), because a host model reads an
example as an instruction. A queue view in the canvas must not become a route
for that string into a page or into the agent's tool results.

### What was measured

Measured on 2026-10-08 on a four-record fixture repository (two `accepted`
records, one governing through an `affects` pattern and one only through an
inbound marker in a changed file, and two `proposed` records), with the CLI
built from this branch.

1. **`adr check --json` attributes markers to files, and patterns to nothing
   finer than the pattern.** A marker-governed record came back as
   `firedMatchers: []` with `declaredBy: [{ path: "src/net/client.ts", line: 1,
   ref: "0002" }]`. A pattern-governed record came back as
   `firedMatchers: [{ type: "path", pattern: "src/net/**" }]` with no file list,
   although two changed files sat under that pattern. The core type agrees:
   `FiredMatcher` is `{ type, pattern }` and `resolveAffects` records the
   matcher, not the path that fired it.
2. **`adr queue --format json` is QueueReport v1** with `version`, `asOf`,
   `totalItems`, `totalCorpusFindings`, `items[]`, and `corpusFindings[]`. Each
   item carries `id`, `title`, `sourcePath`, tier and SLA fields,
   `routingTargets`, `quorum`, approval and objection counts, and
   `itemFindings`. The JSON carries no ratifying command; the terminal view adds
   it. An unreadable corpus directory exits `2` with a usage message on stderr.
3. **A headless SDK-host smoke of this canvas** (Copilot CLI 1.0.93,
   `pluginDirectories` pointed at this branch, no prompt sent, `run_review` not
   invoked) opened the panel with status `2 governing · incomplete`;
   `get_state` carried `declaredBy` on the marker-governed record,
   `judgeCalls: 2`, and both proposals under `queue`; neither `/api/state` nor
   `/app.js` contained the ratifying command; a `refresh` with only an
   ungoverned file gave `judgeCalls: 0`; a `refresh` against a missing corpus
   directory gave `queue.available: false` with the fixed note "adr queue exited
   2" while the check reported its own `usage-error`; and the 403s, the CSP, and
   the port release on close were unchanged. Details are in the evidence index.
4. **`ADRKIT_CLI` set in the runtime's environment reaches the extension** in
   that headless host: pointing it at a missing file made both the check and
   the queue report that it could not be started. This is the SDK host, not the
   app; ADR-0046's open question about the app is not closed by it.

## Decision

We will make three additions to the `decision-review` canvas in
`packages/adapters/agent-plugin/extensions/adrkit/` (`canvas.mjs` and
`canvas-page.mjs`). No new registration, action, route, or extension directory
is added, and `review.mjs` and `register.mjs` do not change.

**1. Provenance.** The canvas's decision projection keeps `declaredBy` beside
`firedMatchers`, by allowlist: each entry keeps `path` (string), `line`
(integer), and `ref` (string), and anything else is dropped. The same
projection serves `adr check` output and a result handed to `show_review`, so
both carry it. The page's evidence section renders, as text:

- "Matched by affects pattern:" and the pattern, followed by "adr check does not
  report which changed file matched a pattern."
- "Declared by an inbound marker in a changed file:" and each `path:line names
  <ref>`.
- "No evidence recorded." only when there is no verdict, no matcher, and no
  declaration.

The canvas does **not** compute which changed file matched a pattern. Doing so
would mean reimplementing `@adrkit/core`'s matcher semantics (glob dialect,
`negate`, snapshots, scoped matchers) in a dependency-free extension that cannot
import core, or spawning one `adr check` per changed file on the free refresh
path. Either would produce a provenance that could disagree with the CLI's own
answer. The page says what the CLI does not report instead.

**2. Cost before spend.** The panel snapshot gains `judgeCalls`, the number of
governing decisions in the current check. As `review.mjs` is written,
`adr-review` makes at most that many `decision-checker` calls, and exactly that
many when `adr check` and `adr lint` exit `0` or `1`; otherwise it skips the
Judge and makes none. Runtime retries are not counted. The Run review button reads "Run review: N
decision-checker call(s) (uses AI credits)", and is disabled with a stated
reason ("No governing decision, so there is nothing to judge") when N is 0, as
it already was with no changed files. The `run_review` action description says
one call per governing decision, points to `judgeCalls`, says that new input
re-checks first so the count can change, and cites the one measured run (about
0.16 AI credits for two decisions on Copilot CLI 1.0.93) as a measurement, not
a price. The server does not refuse a zero-governing run from the agent: such a
run reaches no Judge call, and the description says so.

**3. Read-only queue.** Each refresh, after the check and independent of it,
runs `adr queue --format json` with the same `--dir` the check used, in the
session directory, with the CLI resolved exactly as the check resolves it. It is
free: one CLI call, no model. The result is a `queue` block on the snapshot:
`{ available, asOf, exitCode, totalItems, corpusFindings, items, note }`, with
each item reduced by allowlist to `id`, `title`, `sourcePath`, `slaState`,
`deadlineDate`, `approvalCount`, `quorum`, `unresolvedObjectionCount`, and
`routingTargets`, and at most 200 items with a note saying how many were left
out. The page shows them in a section headed "Open proposals, corpus-wide",
labelled "Listed, not judged".

- **No ratify control and no ratifying text.** Queue rows have no button, no
  action, and no explain. Their ids are not added to the set explain accepts,
  so the prompt surface is unchanged. The allowlist is the mechanism that keeps
  any ratifying field out: a field the JSON gains later is dropped without
  anyone having to name it. A test plants such fields and asserts that neither
  the snapshot, the served `/api/state`, the rendered page, nor the shipped
  HTML, JavaScript, and CSS contain the command.
- **Failures are notes, never breakage.** Exit `0` and `1` both carry a complete
  report (`1` means corpus findings, counted on the page). Exit `2`, a CLI that
  cannot be resolved or started, unreadable output, and a report version other
  than `1` each become `available: false` with a fixed note chosen by an
  explicit check. The CLI's stderr and an exception's text are never copied into
  the note, following the rule CodeQL's `js/stack-trace-exposure` finding set
  for the first canvas. The queue never changes the panel's status, its
  governing list, or its notes.
- **Titles and paths are untrusted text**, rendered with `textContent` like
  everything else on the page.

## Options considered

### Option A: Three additions inside the existing canvas, by allowlist (chosen)

| Dimension | Assessment |
|---|---|
| Provenance | What the CLI reports, and a stated limit where it reports less |
| Cost | Stated before the click, from the code that spends it |
| Queue | Visible, free, read-only, and unable to carry a ratifying command |
| Surface | No new action, route, registration, process, or dependency |
| Cost to us | One more CLI call per refresh, and two more snapshot fields to keep in step |

### Option B: Compute per-file pattern matches in the extension

**Pros:** The panel could say "src/net/client.ts matched src/net/\*\*".

**Cons:** It reimplements core's matcher semantics without core, so it can
disagree with `adr check` and present that disagreement as provenance. Rejected.
If per-file attribution is wanted, it belongs in `@adrkit/core` and
`adr check --json`, where the panel would then read it.

### Option C: One `adr check` per changed file on refresh

**Pros:** Exact attribution from the CLI itself.

**Cons:** N process spawns on the free path, for a wide change. Rejected for now.

### Option D: A queue with a ratify button, or the ratifying command shown for copying

Rejected, as ADR-0046 rejected a ratifying canvas (its option F). Ratification
is a human act (ADR-0044), and a model-reachable page that names the command is
the instruction the plugin's wiring rule exists to prevent.

### Option E: Quote a credit price

Rejected. Pricing is the host's and changes; the panel states the call count it
can derive from code, and the docs cite the one measurement as a measurement.

### Option F: Do nothing

The panel keeps saying "No evidence recorded." over marker-governed records,
keeps offering a run that would judge nothing, and keeps the queue out of view.

## Trade-offs

A pattern-governed record still does not say which file fired it. The page
says that the CLI does not report it, which is honest and less useful than an
answer.

`judgeCalls` is the count for the panel's current check. A run started with new
input re-checks first, and the repository can change between the check and the
run, so the count is a statement about now, not a quote. Runtime retries are not
counted.

Each refresh runs one more CLI process. On a large corpus `adr queue` reads
every record, so a refresh is slower than before.

The queue is corpus-wide while the rest of the panel is change-scoped. The
heading says so, but a reader can still mistake a listed proposal for one the
change touches; the change-scoped "Active proposals" list remains the one that
does.

## Consequences

- Easier: a reviewer sees why each decision governs when the CLI knows, sees
  what a review will cost before starting one, and sees what is waiting for
  review across the corpus, without leaving the panel and without spending.
- Harder: two more snapshot fields (`judgeCalls`, `queue`) and one more CLI
  output shape (QueueReport v1) to track, and one more test that must keep the
  ratifying command out of a surface that now reads queue data.
- **How we would know this was wrong:** the panel shows a file for a pattern
  match that `adr check` would not attribute to it; a marker-governed record
  reads "No evidence recorded."; `judgeCalls` differs from the number of
  `decision-checker` calls a completed run made (the workflow changed shape, or
  the runtime retries in a way users pay for); the Run review button is enabled
  with nothing to judge; the ratifying command appears in the snapshot, the
  served state, the page, or an action result; a queue row gains a control or an
  explain; a queue failure changes the panel's status, its governing list, or
  its notes, or puts CLI stderr or exception text on the page; refresh starts a
  model call; or a reviewer reads the corpus-wide queue as the change's own
  proposals. Revisit if `adr check --json` gains per-file attribution for
  pattern matches, in which case the panel should read it and drop the stated
  limit.

## Evidence rung

**Rung 1** under ADR-0014: unit and contract tests (each new one observed
failing before it passed), and the headless Copilot CLI 1.0.93 SDK-host smoke
above. **The new UI is unmeasured in the Copilot app**: the provenance lines,
the call-count label, the disabled state at zero governing decisions, and the
queue section have not been rendered in an app session. No reference-repository
run and no external validation.

## Action items

1. [x] Keep `declaredBy` in the canvas projection by allowlist and render it,
   with the stated limit for pattern matches.
2. [x] Add `judgeCalls` to the snapshot; state the count on the button and in
   the `run_review` description; disable the button at zero governing decisions.
3. [x] Compute the queue beside the check on refresh, by allowlist, with fixed
   notes for every failure, and render it without controls.
4. [x] Tests for each, observed failing first, including the planted
   ratifying-field test.
5. [x] Headless SDK-host smoke of open, state, refresh, and the page's headers,
   recorded in `docs/reference-verification-agent-plugin.md`.
6. [ ] Render the new UI in a Copilot app session and record it with the app
   version.
7. [ ] Ratify or reject this record.
