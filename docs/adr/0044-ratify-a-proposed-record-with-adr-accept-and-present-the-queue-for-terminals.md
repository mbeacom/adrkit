---
schemaVersion: 0.2.0
id: "0044"
title: "Ratify a proposed record with adr accept and present the queue for terminals"
status: accepted
date: 2026-09-30
deciders: ["@mbeacom"]
tags: [cli, queue, governance, compatibility]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0004", "0008", "0016", "0028", "0031", "0033", "0038", "0040", "0043"]
affects:
  - type: path
    pattern: "packages/core/src/transition/**"
  - type: path
    pattern: "packages/cli/src/accept.ts"
  - type: path
    pattern: "packages/cli/src/queue.ts"
  - type: path
    pattern: "packages/cli/src/queue-terminal.ts"
  - type: path
    pattern: "packages/cli/src/terminal-text.ts"
  - type: path
    pattern: "packages/cli/src/command-registry.ts"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: Grows the public write surface from two commands to three; a semver commitment under ADR-0031.
  decidedAt: 2026-10-01T02:01:16Z
reviewBy: 2027-03-31
---

# ADR-0044: Ratify a proposed record with adr accept and present the queue for terminals

## Context

`adr queue` shows every `proposed` record. It gives no way to act on one.
Accepting a record today means editing its frontmatter by hand. The status goes
from `proposed` to `accepted`. For an agent-drafted record,
`provenance.ratifiedBy` has to be added as well, or the
`agent-accepted-requires-ratifier` invariant fails. The mechanical part is easy
to get wrong, and the part that matters is easy to leave out. #247 accepted
ADR-0043 by hand, and the acceptance of ADR-0040 did the same. Neither wrote
`review.decidedAt`, so the only record of *when* either one was ratified is the
commit date.

Three constraints bind any command that does this:

1. **The public write surface is deliberately small.** Only `new` and `migrate`
   write. ADR-0040 states this constraint. It rejected `adr sync` partly
   because that command would have grown the write surface. The CLI is a semver
   commitment
   ([ADR-0031](./0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)).
2. **Machine writes go through pull requests**
   ([ADR-0008](./0008-import-and-migration-semantics.md) applying
   [ADR-0004](./0004-git-is-source-of-truth-database-is-an-index.md)).
3. **Ratification is a human act.** The schema forbids an agent-originated
   record from reaching `accepted` without a named human ratifier. The agent
   plugin
   ([ADR-0028](./0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md))
   drafts `proposed` records and says plainly that it is "drafting, not
   ratifying".

Separately, the queue's only human format is Markdown. It is two pipe tables,
one of them fifteen rows per item. That serves a GitHub issue, a PR comment, and
an agent reading stdout. In a terminal it prints as raw pipes that wrap
unreadably at ordinary widths. `adr graph` had the same problem, and
[ADR-0033](./0033-select-interactive-graph-presentation-at-the-cli-boundary-while-preserving-piped-dot.md)
solved it: choose the presentation at the CLI boundary from whether stdout is a
TTY, and never change what a pipe receives.

## Decision

**We will add `adr accept <id> --by <identity>` as the third writing command,
and give `adr queue` a terminal presentation chosen at the CLI boundary under
ADR-0033's rule.**

### `adr accept`

- **It accepts only a `proposed` record.** It is the "from the queue" verb. A
  `draft` has not been proposed, and it is refused with that reason. Any other
  status is a transition this command does not own.
- **`--by` is required and names the ratifier.** It must be a schema
  `Identity` (`@handle`, `team:slug`, or an email). It is written to
  `provenance.ratifiedBy` for every record, not only for agent-originated ones,
  so the record names who accepted it no matter who wrote it. The command
  never infers the ratifier from git config or the environment. Naming who
  ratified a decision is the claim the command exists to record, so the
  command does not guess it.
- **It writes `review.decidedAt`** as an RFC 3339 UTC timestamp with seconds
  ([ADR-0043](./0043-publish-schema-v0-2-0-with-rfc-3339-seconds-retain-v0-1-0-and-validate-every-rec.md)).
  It reads the clock at the CLI boundary. The core transition takes the
  timestamp as an argument and stays pure.
- **It refuses rather than overrides review state.** It exits `1` without
  writing when the record has an unresolved objection, when `review.quorum` is
  set and there are fewer approvals than that, when the record is already
  invalid, or when the accepted record would fail validation (for example, an
  empty `deciders`). It does not count `--by` as an approval. Approvals are
  review state the command has no authority to add.
- **It edits in place and changes only three fields.** It changes `status`,
  `provenance.ratifiedBy`, and `review.decidedAt`, and it splices only the lines
  that hold them. A YAML re-serialization would reformat 39 of this corpus's 44
  records. After the splice it parses the new frontmatter again and requires
  every other field to be semantically unchanged. If that check fails, it
  refuses and writes nothing. It never touches `date`, the start of the ADR-0039
  valid-time window, or `schemaVersion`, or the body.
- **It does not commit or push.** The result is an ordinary working-tree change
  that reaches `main` through a pull request, exactly like `adr new`.
- **No agent surface runs it.** The agent plugin's commands, skills, and
  subagent never invoke `adr accept`, and a test enforces this. Spec Kit
  hooks reach only non-writing commands, and that invariant is unchanged. The
  MCP server stays at four read-only tools. An agent can tell a human that
  `adr accept 0044 --by @you` is the next step. It cannot take that step.

### `adr queue` presentation

- `--format` gains `auto` (the new default) and `terminal`. With `auto`, a TTY
  on stdout gets the terminal view. A pipe, a redirect, or a captured stdout
  gets the Markdown report **byte for byte as before**, so SC-001, the queue
  Action, `/adr-queue`, and every script that pipes the command see no change.
  An explicit `--format markdown|json|terminal` always wins.
- The terminal view is a width-aware list, one block per item. It shows the id,
  the SLA state in colour, the deadline and the days left, the title truncated
  by display width, the tier, approvals against quorum, objections, routing,
  the source path, item findings, and one of two next steps: the `adr accept`
  command, or the reason acceptance is blocked. Which of the two is decided by a
  dry run of the same pure transition `adr accept` uses, so the view never
  advertises a command that would refuse. Review state alone cannot see every
  refusal: a `proposed` record with empty `deciders` is valid, but an accepted
  one is not. Corpus findings print before
  the items. It uses the grapheme-safe display-width helper that `adr graph`
  already uses, now shared rather than duplicated.
- TTY detection stays in `packages/cli/src/queue.ts`. `buildQueueReport` and
  both canonical formatters stay pure and unchanged.

## Options considered

### Option A (chosen): a narrow `accept` verb plus a TTY-selected queue view

| Dimension | Assessment |
|---|---|
| Write surface | Grows from two commands to three; one record, three fields |
| Human act preserved | `--by` is mandatory and never inferred; no agent surface runs it |
| Formatting risk | Line splice with a semantic re-check; refuses on any layout it cannot splice safely |
| Pipe compatibility | Markdown and JSON unchanged; only a TTY sees the new view |
| Cost | A new semver-committed verb, and a presentation to keep within its width budget |

### Option B: a general `adr status <id> <status>` transition command

**Pros:** one verb covers accept, reject, deprecate, and supersede.
**Cons:** each transition has different required fields. `superseded` needs
`supersededBy` and a successor, and `rejected` needs a reason. One verb would
either carry every one of those flags or write records that fail lint. It would
also commit the public CLI to a transition model that no adopter has asked for.
Accept is the transition the queue exists to serve. The others can get their
own verbs when someone needs them.

### Option C: an interactive picker inside `adr queue`

**Pros:** the most direct reading of "accept from the queue".
**Cons:** it turns a deterministic read command into a writing one. Worse, it
would make the command that `/adr-queue` and the queue Action both run a
potential writer, which is the exact coupling the Spec Kit hook invariant and
the plugin's one-writer rule exist to prevent. A printed `adr accept …` hint
gets the same ergonomics without a read command that can write.

### Option D: keep editing by hand; improve only the Markdown

**Pros:** no new write surface.
**Cons:** the hand edit already drops `decidedAt` every time, and the Markdown
is also the byte-stable contract for the Action and badges (ADR-0025), so it
cannot be reshaped for terminals without breaking them.

## Trade-offs

- **A third writer is a durable commitment.** Removing or reshaping
  `adr accept` is a breaking change under ADR-0031. The record is
  `two-way-door` only because minor releases may still break before `1.0.0`
  (ADR-0002). From `1.0.0` onward, reversing this needs a major release.
- **`ratifiedBy` on human-authored records is new.** The schema has always
  allowed it; this corpus has used it only on agent-drafted ones. Writing it
  every time trades one extra frontmatter line for a record that always names
  its ratifier.
- **The splice refuses some valid YAML.** A flow-style `provenance: {…}` or
  `review: {…}` is refused with a message saying to edit it by hand, rather
  than reformatted.
- **`--by` is a claim, not an authentication.** Anyone who can write the file
  can type any handle. The pull request remains the control, as it is for a
  hand edit.
- **The terminal view is a second human rendering** of the same report, and
  it is the only one without byte-stability guarantees.

## Consequences

- **Easier:** accepting a record is one command that cannot forget
  `ratifiedBy` or `decidedAt`. The queue is readable in a terminal and tells
  the reader what to run next.
- **Harder:** the write surface is three commands, and every document that says
  "two" must say three. The plugin's decision-checker must still never be
  handed this verb.
- **How we would know this was wrong:**
  - A record accepted with `adr accept` shows a frontmatter diff beyond the
    three fields: the splice has a hole.
  - An agent surface is found running `adr accept`: the boundary this record
    draws was not enforced where it mattered.
  - Adopters keep hand-editing acceptance anyway because the refusals are too
    strict, for example on quorum they do not use.
  - Anything that pipes `adr queue` observes a byte change.
- **Revisit if:** a second transition (reject, deprecate, supersede) is asked
  for twice, which would argue for a shared transition kernel; or an adopter
  needs the terminal view in CI logs, which would argue for `--format terminal`
  being documented as stable.

## Action items

1. [x] Ship `acceptAdrSource` in `@adrkit/core` as a pure transition with
       splice-and-verify semantics, with unit coverage of every refusal and a
       whole-corpus test that the splice never changes a field it does not own.
2. [x] Ship `adr accept` in `@adrkit/cli`, registered for help and all three
       completion shells, Node-compatible, with exit codes `0`/`1`/`2`.
3. [x] Ship the queue terminal view with `--format auto|terminal`, and a test
       that piped output is byte-identical to `--format markdown`.
4. [x] Enforce in the agent plugin's tests that no component runs `adr accept`.
5. [x] Update `AGENTS.md`, `site/src/content/docs/commands.mdx`, and
       `CHANGELOG.md`, including every statement that only two commands write.
6. [x] Ratify this record with `adr accept 0044 --by <maintainer>`. That is
       the first real use and the rung-1 functional evidence for the command.
7. [x] In the pull request that accepts this record, update every public
       proposed-state qualifier that names it. `AGENTS.md` carries three: the
       `adr queue` `--format` bullet, the `adr accept` section, and the
       write-surface sentence. `site/src/content/docs/commands.mdx` carries
       one, in the `adr accept` introduction. `adr accept` flips `status`
       only, and the prose guard does not catch "proposed" said of an
       accepted record, so this item cannot be left to either of them.
