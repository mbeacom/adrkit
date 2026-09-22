---
schemaVersion: 0.1.0
id: "0039"
title: "Derive a valid-time window from date and supersession, and resolve a git ref at the CLI boundary"
status: proposed
date: 2026-09-21
deciders: []
tags:
  - cli
  - core
  - markers
  - temporal
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0009"
  - "0021"
  - "0022"
  - "0031"
  - "0033"
affects:
  - type: path
    pattern: "packages/core/src/temporal/**"
  - type: path
    pattern: "packages/core/src/markers/resolve.ts"
  - type: path
    pattern: "packages/cli/src/as-of.ts"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "site/src/content/docs/commands.mdx"
provenance:
  authoredBy: agent-drafted
review:
  tier: async
  tierReason: Adds a temporal contract and the first subprocess in @adrkit/cli.
reviewBy: 2027-09-21
---

# ADR-0039: Derive a valid-time window from date and supersession, and resolve a git ref at the CLI boundary

> **Status: proposed.** Agent-drafted. Implements part B of
> [#116](https://github.com/mbeacom/adrkit/issues/116), whose part A shipped in
> [#187](https://github.com/mbeacom/adrkit/pull/187) under ADR-0022's advisory
> rule. Not ratified.

## Context

"Which decisions governed this file when this code was written?" is the question
every archaeology session asks, and no surface answers it. `adr explain` answers
the present tense only: `decisionBucketFor` sends `superseded` to `history`
unconditionally, which is exactly right for "what binds my change today" and
exactly wrong for "what bound this line in March".

The corpus already contains the answer. Every record carries a `date`, and a
`superseded` record names the successor that replaced it, so a valid-time window
is derivable with **no schema change**: a window opens at a record's own `date`
and closes at its immediate successor's `date`. The bi-temporal shape is well
established, and #116 cites Zep/Graphiti (arXiv:2501.13956) and Hunch as prior
art over the same data.

Two things make this a decision rather than a feature.

First, **the window is derivable only along the `accepted → superseded`
lineage**, and that is not a simplification we chose — it is what
`adr.schema.ts` permits. The schema refuses `supersededBy` unless `status` is
`superseded`, so a `deprecated` record carries no close date anywhere in
frontmatter. There is nothing to read. A tool whose whole purpose is answering
archaeology questions, answering one confidently and wrongly, is worse than a
tool that does not answer it — which is the argument #116 itself opens with
about stale markers.

Second, `--as-of a1b2c3d` needs a **git ref resolved to a date**, and
`@adrkit/core` has no subprocess, no clock, and no filesystem traversal
(ADR-0009). This repository has settled that boundary twice already — marker I/O
stays outside `checkChanges` (ADR-0022), TTY detection stays outside the graph
renderers (ADR-0033) — and this is the same shape a third time.

## Decision

We will add `adr explain <path> --as-of <date|ref>`, built on three commitments.

1. **A pure temporal kernel in `@adrkit/core`.** `packages/core/src/temporal/`
   derives windows and places records on a supplied UTC calendar date. No
   filesystem, no subprocess, and no clock: the date is always an argument,
   because a temporal answer that depended on when it was computed would not be
   reproducible, and reproducibility is the entire point of asking about a past
   date.

2. **A separate temporal bucketing, not a re-use of `bucketDecisions`.** The
   as-of view has its own five-way standing — `governing`, `activeProposals`,
   `history`, `notYetRecorded`, `undetermined` — with a half-open window
   `[opensOn, closesOn)` so the successor owns its own start day and exactly one
   record along a chain is in force on any date. A `deprecated` record that
   existed on the asked-for date is reported as `undetermined` with a `warn`
   finding, never as governing and never as history. A `rejected` record is
   history on every date, because it was in force on none.

3. **Git at the CLI boundary, with a stated precedence.** `packages/cli/src/as-of.ts`
   is the only subprocess in `@adrkit/cli`. The **date grammar is tried first**
   and a git ref only when the value is not a date, so a tag named `2026-03-01`
   reads as a date. The date half is `resolveAsOf` from `@adrkit/core`,
   unwrapped, so `adr queue --as-of` and `adr explain --as-of` cannot phrase the
   same rejection two ways. A ref is peeled with `rev-parse --verify --quiet
   <ref>^{commit}` — annotated tags are tag objects, and this repository's
   release tooling already turns on that distinction — and dated with
   `git show -s --format=%cI`, the **committer** date.

Three scope boundaries are part of the decision, not omissions from it.

- **`--as-of` re-dates the corpus, never the working tree.** `affects` patterns
  are read from today's records and `@adr` markers from today's file. Reading
  file *contents* at a past ref is a strictly larger contract — it needs a path
  that may have been renamed, a corpus that may not have existed, and a
  blob-level read — and is deliberately not attempted here. This is the boundary
  #116's author named when deferring part B.
- **A marker is judged against the date being asked about.** Under `--as-of`,
  `@adr 0007` naming a record that was in force on that date is not stale. The
  present-tense diagnostic is unchanged; telling a reader to "update the marker"
  while the same output reports the record as governing on that date is two
  answers to one question.
- **`--as-of` is `explain` only, and has no default.** `adr check` and the CI
  Action stay present-tense. Absent the flag, stdout and `--json` are unchanged,
  and the `asOf` block is additive — the present-tense `governing`,
  `activeProposals`, and `history` keys keep their meaning underneath it.

## Options considered

### Option A: Derive the window from `date` + supersession, git at the boundary (chosen)

| Dimension | Assessment |
|---|---|
| Schema change | None. `date` and `supersededBy` already exist and are already validated. |
| Purity | Kernel stays pure; the one subprocess is at the CLI edge, matching ADR-0022 and ADR-0033. |
| Honesty | `deprecated` is reported as undetermined rather than guessed; `rejected` never governs. |
| Blast radius | Additive. Every existing invocation and every existing JSON key is untouched. |
| Cost | A five-way standing to learn, and a documented gap for `deprecated`. |

### Option B: Add an explicit `validFrom` / `validUntil` to the schema

**Pros:** answers `deprecated` exactly; no derivation rules to explain; the
window becomes a fact rather than an inference.

**Cons:** a schema change on the one type every published surface and the hosted
JSON Schema depend on, for data that is already recoverable for the common case.
It creates a second source of truth that can disagree with `supersededBy`, and
every existing corpus would answer `null` until backfilled by hand — so the
feature would ship broken for every current user and become correct only as
people edited records. Rejected on the strength of "no schema change" being
available.

### Option C: Resolve the ref inside `@adrkit/core`

**Pros:** one call site; the CLI stays thin.

**Cons:** puts a subprocess inside the package whose contract is that it has
none (ADR-0009), and makes `buildDecisionWindows` untestable without a git
fixture. Rejected for the same reason marker I/O is not inside `checkChanges`.

### Option D: Do nothing

`#116` part B stays open. The question remains unanswerable by any ADR tool,
and the data to answer it stays in the corpus unused. The cost of doing nothing
is not neutral: agents and humans doing archaeology infer the past from
present-tense output, which reports a record that governed in March as history.

## Trade-offs

- **`deprecated` has a hole, and the hole is visible.** A user asking about a
  deprecated record gets "cannot be determined" rather than an answer. That is
  the honest report of what the corpus holds, and it will read as a gap.
- **Two temporal vocabularies now exist.** `bucket` (present) and `standing`
  (as-of) sit side by side in `--json`, and a record can legitimately be
  `bucket: "history"` and `standing: "governing"` at once. Both are true; a
  reader has to hold both.
- **`%cI` is a choice, not a derivation.** The committer date moves with a
  rebase or cherry-pick while the author date stays with the original keystroke.
  `--as-of <ref>` asks where a branch's timeline stood, so the committer date is
  the better fit — but a user reasoning about when code was *written* will
  occasionally want `%aI` and will not get it.
- **`date` is not a file's history.** A record's `date` is the decision date,
  not when the file was committed. A record back-dated or edited later carries
  the date its author wrote down, and the window inherits that.

## Consequences

- **Easier:** archaeology. "What governed this path in March" is one command,
  reproducible, with no network and no model call (ADR-0009). A stale-marker
  warning stops firing on markers that were accurate at the time being asked
  about, which is what made the combination of part A and part B confusing.
- **Harder:** the `explain` surface is larger — five standings, a window line,
  and an `asOf` JSON block. The CLI now has a subprocess, so its test harness
  has to isolate git config (`GIT_CONFIG_GLOBAL=/dev/null`): a developer with
  `tag.gpgSign = true` set globally otherwise hangs the suite on a passphrase
  prompt, which was observed during implementation rather than predicted.
- **How we would know this was wrong:**
  1. A user reports that `--as-of` named a record as governing that demonstrably
     was not, because `date` was back-dated or edited after the fact. That would
     mean `date` is too weak a proxy and the window needs git history rather
     than frontmatter.
  2. `undetermined` is the common answer rather than the rare one — i.e. real
     corpora deprecate more than they supersede. Measure: the share of records
     in the `undetermined` bucket across the reference repository and the
     repository's own corpus. Above roughly a quarter, option B's schema change
     becomes the better trade.
  3. Anyone reads the as-of output as a claim about the file's past *contents*.
     That would mean the "re-dates the corpus, never the working tree" boundary
     is not legible from the output itself and needs to be said in it.
- **Revisit if:** a second surface needs as-of (`check`, the Action, or the MCP
  server), which would make the CLI-boundary git resolution a shared concern
  rather than one command's; or `@adrkit/sdk` moves past a types-only sketch,
  at which point `DecisionWindow` needs a place in that surface.

## Action items

1. [x] Pure `temporal/window.ts` and `temporal/decisions.ts` in `@adrkit/core`,
   exported and covered by the public-surface test.
2. [x] `--as-of` on `adr explain`, registered in the command registry so shell
   completion and the unknown-option suggester agree with the parser.
3. [x] Marker staleness judged against `asOf` when supplied, unchanged otherwise.
4. [x] Every load-bearing rule observed failing under mutation before counting
   as coverage (ADR-0016): half-open boundary, present-tense bucketing,
   `deprecated` handling, marker suppression, and immediate-vs-terminal
   successor.
5. [ ] Reference-repository run against a corpus with a real supersession chain
   (ADR-0014 rung 2). This record ships at **rung 1** only.
6. [ ] Decide whether `adr check` and the governing-decisions Action should
   accept `--as-of`, or stay present-tense permanently.
7. [ ] Revisit `%cI` versus `%aI` if anyone asks for the author date.
