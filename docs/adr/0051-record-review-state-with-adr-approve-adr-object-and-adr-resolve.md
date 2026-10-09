---
schemaVersion: 0.2.0
id: "0051"
title: "Record review state with adr approve, adr object, and adr resolve"
status: proposed
date: 2026-10-09
deciders:
  - "@mbeacom"
tags:
  - cli
  - queue
  - governance
  - compatibility
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0016"
  - "0028"
  - "0031"
  - "0044"
  - "0046"
  - "0048"
affects:
  - type: path
    pattern: "packages/core/src/transition/**"
  - type: path
    pattern: "packages/core/src/schema/identity.ts"
  - type: path
    pattern: "packages/core/src/queue/kernel.ts"
  - type: path
    pattern: "packages/cli/src/review-commands.ts"
  - type: path
    pattern: "packages/cli/src/accept.ts"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/cli/src/record-target.ts"
  - type: path
    pattern: "packages/cli/src/command-registry.ts"
provenance:
  authoredBy: agent-drafted
---

# ADR-0051: Record review state with adr approve, adr object, and adr resolve

> **Status: proposed.** Agent-drafted and not ratified. This record grows the
> public write surface that ADR-0044 set at three commands. It supersedes
> nothing; ADR-0044's design for `adr accept` stays binding and is reused here.
> It amends one ADR-0044 semantic: approvals toward `review.quorum` now count
> distinct identities (see "Shared rules").

## Context

`adr accept` (ADR-0044) refuses a `proposed` record that has an unresolved
objection, or fewer approvals than its `review.quorum`. `adr queue` shows both
counts. Nothing records them. Approving, objecting, and withdrawing an
objection all mean editing `review.approvals` and `review.objections` by hand,
so the command that enforces review state has no counterpart that writes it.

The hand edit is where mistakes happen. `review.objections` is a list of
mappings, and its `resolved` flag defaults to `false` when absent. A reviewer
who adds `resolved: true` at the wrong indent ends up with either a YAML error
or a new key on a different objection, and neither is obvious in a diff.

ADR-0044 named this case under "Revisit if": a second transition asked for
would argue for a shared transition kernel. The splice-and-verify machinery
behind `acceptAdrSource` is that kernel; this record reuses it.

The same constraints bind these commands as bound `adr accept`: the write
surface is a semver commitment (ADR-0031), machine writes go through pull
requests, and review is a human act.

## Decision

**We will add three writing commands that record review state on a `proposed`
record under a named identity, built on the same pure splice-and-verify
transition kernel as `adr accept`.**

- `adr approve <id> --by <identity>` adds the identity to `review.approvals`.
  Approving twice is a no-op: exit `0`, a message, and no write.
- `adr object <id> --by <identity> --summary <text>` appends
  `{ by, summary, resolved: false }` to `review.objections`. Raising the same
  open objection twice (same `by`, same summary, still unresolved) is a no-op.
- `adr resolve <id> --objection <n> --by <identity>` sets `resolved: true` on
  objection `n`, counted from 1 in file order. Resolving a resolved objection
  is a no-op.

### Shared rules

- **The record must be `proposed`.** Review state changes only while a record
  is under review. Any other status, and any record with lint errors, is
  refused with exit `1` and the file left untouched.
- **`--by` is required, is never inferred, and must be a schema `Identity`
  with no control or invisible characters.** It names the person whose review
  this is. Like `adr accept`, the command does not read git config or the
  environment for it, and given twice it is a usage error. `--by` is a claim,
  not an authentication; the pull request remains the control. The schema's
  email branch admits control and format characters (`\p{Cc}`, `\p{Cf}`: an
  escape, a bidi override, a zero-width space); no writing command records
  one, `adr accept` included. Tightening `Identity` itself is a schema change
  this record does not make.
- **Identities compare case-insensitively.** Two identities are the same person
  when they are equal after an ASCII casefold of the whole identity, so `@bob`
  and `@Bob`, and `Eve@Example.com` and `eve@example.com`, are one person.
  GitHub handles and team slugs are case-insensitive, and so in practice is an
  email address. This applies to the approve and object no-ops and to the
  objector check. Non-ASCII letters are not folded.
- **Quorum counts people, not entries.** One reviewer approving as `@bob` and
  again as `@Bob` must not meet a quorum of two. So `adr approve` writes
  nothing for a case variant, and `acceptAdrSource`'s quorum check and
  `adr queue`'s `approvalCount` now count distinct identities under the same
  fold. That is a behavior fix to ADR-0044's semantics, which counted entries:
  a record that hand-listed two spellings of one person met quorum before and
  does not now.
- **Only the objector may resolve an objection.** `--by` must be the same
  identity as that objection's `by`, under the fold above. The schema has no `resolvedBy`
  field, so the record of *who* resolved it is that it was the objector. A
  chair override, and a `resolvedBy` field that would make one auditable, are
  future work and need a schema change this record does not make.
- **A summary is one safely quoted line.** It is trimmed, must be non-empty, is
  at most 500 code points after trimming, and may contain no control character
  (C0, DEL, C1), no invisible format character (`\p{Cf}`: bidi overrides and
  isolates, zero-width spaces and joiners, the BOM), and no U+2028 or U+2029
  line separator. A summary is shown in the queue, in diffs, and on the canvas,
  where a bidi override would render reversed text. Refusing every format
  character also refuses an emoji ZWJ sequence; that is accepted. It is always written as a YAML
  double-quoted scalar, so `#`, `:`, quotes, and leading indicators survive.
- **The transitions are pure.** `approveAdrSource`, `objectAdrSource`, and
  `resolveObjectionAdrSource` live in `packages/core/src/transition/` with no
  clock and no filesystem. The CLI owns the I/O.
- **They splice lines, never round-trip YAML,** for ADR-0044's reason. They
  handle `review:` absent, `review:` present without the list, a block list,
  and a flow list, empty or not. A flow list stays a flow list and a block list
  stays a block list; an `objections: []` therefore grows as a flow list of flow
  mappings rather than being rewritten as a block. An insertion never backs up
  into the value above it, so a literal block whose content has a `# …` line and
  a keep-chomped (`|+`) scalar with trailing blank lines are spliced around, and
  `resolve` finds an item whose `-` stands alone on its line. A layout they
  cannot splice safely (for example `review: {…}`, or a `review` that is not a
  block mapping) is refused with a message to edit by hand.
- **The re-parse guard is shared, not copied.** The splice helpers and the
  "parse again, compare to the intended data, validate" tail moved from
  `accept.ts` into an internal `transition/splice.ts`, so every transition goes
  through the same check. A splice that would change any other field is a
  refusal, never a write.
- **Exit codes match `adr accept`**: `0` written or a no-op, `1` refused with
  the record unchanged, `2` usage error. A malformed `--by`, a missing, empty,
  multi-line, or overlong `--summary`, and an `--objection` that is not a
  positive whole number are usage errors, checked before the corpus is read;
  the core transitions refuse the same inputs independently. All three take
  `--json`, because `adr accept` does.
- **`adr accept` changes in three ways only.** It shares the CLI's record
  lookup (`record-target.ts`), with its messages kept byte for byte; its quorum
  check counts distinct identities; and it refuses a ratifier with control or
  invisible characters.

### Agent boundary

These commands write review state under a person's identity, so **no agent
surface runs them on the model's initiative**: no skill, subagent, command,
MCP tool, or extension tool. Three tests enforce it, each observed failing
against planted mentions (ADR-0016):

- The agent plugin's wiring test fails if any command, skill, agent, or
  extension module, the canvas included, names `adr approve`, `adr object`, or
  `adr resolve`. The same test now guards `adr accept` the same way. Its
  patterns catch the forms an extension would really use, not only prose: an
  argument array (`['approve', id, …]`, but not a JSON-schema type list), a
  tool name (`adr_approve`), and a call through `adr`, `$ADRKIT_CLI`, or
  `@adrkit/cli`, in any case and across invisible characters.
- The Spec Kit extension's test applies the same patterns, plus its
  `adrkit_cli` wrapper, to its commands, scripts, and manifest.
- The MCP server's test applies them to its source and also refuses an import
  of any writing transition. The server stays at four read-only tools.

The **only** planned plugin path is a later track: a person pressing a button
in the Copilot app's canvas, with the identity taken from the environment
(`ADRKIT_REVIEWER`), never from the model and never from a tool argument. The
canvas's `actions` are model-callable, so the canvas stays under the guard. The
track that builds the button will add one narrowly scoped, tested exception for
a single module that handles the page's POST, under its own record, and a test
that no canvas action can reach the verbs.

## Options considered

### Option A (chosen): three narrow verbs on a shared transition kernel

| Dimension | Assessment |
|---|---|
| Write surface | Grows from three commands to six; each edits one list on one record |
| Human act preserved | `--by` is mandatory and never inferred; no agent surface runs them |
| Formatting risk | The same splice and semantic re-check as `adr accept`; refuses what it cannot splice |
| Authority | Only the objector resolves; nobody can approve on another's behalf except by typing their handle, which the PR shows |
| Cost | Three semver-committed verbs |

### Option B: one `adr review <id> approve|object|resolve` verb

**Pros:** one entry in the command list. **Cons:** each sub-action takes
different required flags, and the help, completion, and refusal messages all
branch on the sub-action. Three flat verbs read better in `adr queue`'s
next-step hint and in a shell history.

### Option C: let `adr accept` take `--approve` and `--resolve` flags

**Pros:** no new verbs. **Cons:** it collapses review into ratification. The
ratifier would be recording other people's approvals, which is exactly the
authority ADR-0044 denied `adr accept` ("it does not count `--by` as an
approval").

### Option D: keep editing review state by hand

**Pros:** no new write surface. **Cons:** the hand edit is error-prone in
the nested list, and `adr accept` then refuses on state nobody can write
safely.

## Trade-offs

- **The write surface doubles.** Removing or reshaping any of the three verbs
  is a breaking change under ADR-0031. The record is `two-way-door` only while
  minor releases may break before `1.0.0` (ADR-0002).
- **No chair override.** A departed objector's objection can only be resolved
  by hand-editing the record. That is deliberate until `resolvedBy` exists.
- **Flow lists stay flow.** An objection appended to `objections: []` is a
  one-line flow mapping, which is valid and minimal but less readable than the
  block layout the corpus otherwise uses.
- **A BOM-prefixed record is refused.** `parseFrontmatter` requires the file to
  begin with `---`, so `adr lint` already reports such a record as invalid, and
  these commands, like `adr accept`, refuse it rather than strip the BOM.
- **The extension tools' writing-command scrub does not yet name these verbs.**
  `redactWritingCommands` in the plugin's `tools.mjs` redacts `adr accept`,
  `adr new`, and `adr migrate` from tool results. Repository text naming
  `adr approve` passes through as data. That module belongs to the extension
  track; extending the scrub is a follow-up.

## Consequences

- **Easier:** review state is recorded by command, and `adr queue`'s approval
  and objection counts change with it. A record can go from objection to
  acceptance without a hand edit.
- **Harder:** six writing commands to keep agent-proof, and every document that
  lists the write surface must name them.
- **How we would know this was wrong:**
  - A review command's diff touches a line beyond its list: the splice has a
    hole the re-parse guard missed.
  - An agent surface is found running one of them.
  - Adopters keep hand-editing objections because "only the objector" blocks
    real workflows; that would argue for `resolvedBy` and a chair override.
- **Revisit if:** a chair or quorum-owner override is asked for twice, or the
  canvas button track lands and needs the boundary above restated.

## Evidence rung

Rung 1 of ADR-0014: unit coverage of every splice shape for every command
(review absent, review with other keys, block list, empty flow list, flow list
with items, CRLF, comments near the block, a lone `-`, a literal block with a
`#` line, a keep-chomped scalar), case-variant identities, every refusal leaving the source
untouched, idempotence, the re-parse guard against a deliberately broken
splice, a whole-corpus test over this repository's records comparing the whole
file, and CLI tests including an end-to-end approve, object, resolve, queue,
and accept sequence and a `@bob`/`@Bob` quorum pin.
No reference-repository or external run.

## Action items

1. [x] Ship `approveAdrSource`, `objectAdrSource`, and
       `resolveObjectionAdrSource` in `@adrkit/core` on the shared splice
       kernel, with unit coverage of every shape and refusal.
2. [x] Ship `adr approve`, `adr object`, and `adr resolve` in `@adrkit/cli`,
       registered for help and all three completion shells, Node-compatible,
       with exit codes `0`/`1`/`2` and `--json`.
3. [x] Enforce in the agent plugin's, Spec Kit extension's, and MCP server's
       tests that no component mentions the three verbs, the canvas included.
4. [x] Count distinct identities, case-insensitively, in `adr accept`'s quorum
       check and `adr queue`'s `approvalCount`.
5. [x] Update `AGENTS.md`, the CLI README, `site/src/content/docs/commands.mdx`,
       and `CHANGELOG.md`, including every statement of the write surface.
6. [ ] Extend the extension tools' writing-command scrub to the three verbs.
7. [ ] Ratify this record with `adr accept 0051 --by <maintainer>`.
