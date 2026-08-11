---
schemaVersion: 0.1.0
id: "0024"
title: Report the measured scan extent, not the window constant
status: accepted
date: 2026-08-11
deciders: ["@mbeacom"]
tags: [core, cli, matching, governance, agents]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016", "0021", "0022", "0023"]
affects:
  - type: path
    pattern: "packages/core/src/markers/**"
  - type: path
    pattern: "packages/cli/src/index.ts"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: >-
    Two additive, optional report fields; no existing field changes meaning and
    `check --json` stays byte-identical. What makes it more than a bug fix is that
    the reporter asked for the intended semantics rather than a patch, and that
    answering means declining two named alternatives — one of which knocks on the
    door ADR-0021 left for a configurable window. It also corrects a place where
    the window constant was being printed as though it were the extent.
reviewBy: 2027-02-11
---

# ADR-0024: Report the measured scan extent, not the window constant

## Context

[Issue #108](https://github.com/mbeacom/adrkit/issues/108) reports that
`adr explain --json` says a marker scan was bounded without saying where it stopped.
`markers.truncated: true` means "bytes were left unscanned"; the only other number in
the block is `windowBytes`, the constant. So a consumer that hits a truncated file
learns that its result is partial and nothing about by how much.

**What the report could not say.** The window is a bound on the extent, not the
extent: the scan is cut back to the last complete line inside it, because half of
`@adr 00123` is `@adr 0012` — a different and perfectly valid reference. So
`min(fileBytes, windowBytes)` is not the answer either. Measured over all 144 tracked
`.ts` files under a package source tree — `packages/<pkg>/src/**` plus
`packages/adapters/<pkg>/src/**`, 113 and 31 files — at their canonical (LF) content
(a literal `packages/**/src/**/*.ts` pathspec is *not* that set; git resolves it to
115 files, which is why the corpus is spelled out here), 29 exceed the window
(20.1%; median file 3962.5 bytes), and for those 29 the extent lands **1 to 77 bytes**
short of it — small, but not derivable, and unbounded in the general case: one line
spanning the boundary puts the extent arbitrarily far below the window, down to `0`
when the window holds no terminator at all.

| file | extent | size | unscanned |
| --- | --- | --- | --- |
| `packages/cli/src/evaluate-snapshot.ts` | 8167 | 26992 | 18825 |
| `packages/adapters/catalog-backstage/src/pipeline.ts` | 8191 | 21530 | 13339 |
| `packages/mcp/src/tools/shared.ts` | 8178 | 20370 | 12192 |
| `packages/evaluator/src/assertions/rego.ts` | 8115 | 11225 | 3110 |
| `packages/cli/src/evaluate.ts` | 8148 | 8289 | 141 |
| `packages/core/src/markers/types.ts` | 1582 | 1582 | 0 |

(Rows are files this change does not touch, so the numbers stay checkable after it
lands. `pipeline.ts` stops 1 byte short of the window and `rego.ts` 77 — the spread
that makes the extent worth reporting rather than deriving.)

`evaluate.ts` and `evaluate-snapshot.ts` are the point. Both report
`state: "scanned"`, `truncated: true` — identical, before this change, in everything a
consumer could see. One of them was 141 bytes from being read whole; the other left
18825 unread. That is the difference between "re-read this one if you care" and "this
answer is mostly guesswork", and it was not reportable.

**What this does not fix, and cannot.** #108's title frames the gap as
distinguishing "the window was hit and markers may lie past it" from "the window was
hit and every marker is in the header". Those two remain indistinguishable, and no
report can separate them without reading further — the second is a claim about bytes
nobody looked at. `truncated: false` already licensed `declared: []` as complete, and
still does; that is not what changes here. What changes is that a truncated result
carries its magnitude, which is what the reporter asked for and accepted as
sufficient: *"with `scannedBytes` and `fileBytes` we can decide our own policy rather
than inheriting one."*

## Decision

**`readSourceMarkers` and `adr explain --json` will report the measured extent of the
read — `scannedBytes` and `fileBytes` — as optional fields present only for a
`scanned` state. Every human surface that names where a scan stopped will state the
measurement rather than the window constant.**

*Ratification note (2026-08-11): as proposed, this record's second sentence read
"Human output will state the measurement where it has one and the bound where it
does not", because `check`'s warning was thought to need a `MarkerScanReport` change
to carry extents. It does not — see action item 3 — so the decision was widened at
ratification rather than shipping an asymmetry the record itself called an open
question. `check --json` is unchanged either way.*

Four properties are why this is a rule and not just two fields:

1. **The extent is measured, never derived.** Not `min(fileBytes, windowBytes)`, for
   the reason above. `fileBytes - scannedBytes` is the unscanned remainder, and it is
   the number a per-file policy is written against.
2. **The extent is measured on the bytes, not on the decoded text.** `TextDecoder`
   may drop a BOM or expand one invalid byte into U+FFFD, so a re-encoded length is
   not the length that was read. The cut is found by scanning the raw window backwards
   for `0x0A` / `0x0D`, which is *equivalent* to the existing string search rather than
   an approximation of it: both terminators are single-byte code points, every UTF-8
   continuation byte is `>= 0x80` so neither can hide inside a multi-byte sequence, and
   the decoder flushes any pending invalid sequence before processing a terminator. The
   reported number and the text handed to the scanner come from that one computation,
   so they cannot drift *for a given implementation* — but the rule now exists in two
   representations, and nothing in the type system holds them together. That equivalence
   is therefore pinned by test ("the byte cut and the text cut cannot drift apart"),
   which asserts the boundary property and the no-op-second-cut property over named
   edge cases and a seeded fuzz corpus rather than re-implementing the search.
3. **A state that never opened the file carries no extent.** `absent`, `unreadable`,
   and `out-of-tree` omit both fields rather than reporting `0`. This matters because
   `0` is itself a real answer here — a window holding no line terminator scanned
   nothing — so it cannot double as "not measured" without collapsing the distinction
   ADR-0021 and ADR-0022 built the scan states to protect. One edge is worth recording: an I/O error raised after a
   partial read also reports `unreadable`, and so reports no extent although bytes were
   read.
4. **No surface prints the constant as if it were the measurement.** `explain`'s note
   now reads "only the first &lt;extent&gt; of &lt;size&gt; bytes" — the two numbers
   it measured, whatever they are for that file on that checkout. `check`'s per-path
   warning said "truncated after 8192 bytes" — a specific number that is wrong for
   every one of the 29 source files above, none of which stops there — and now reads
   "marker scan truncated (bytes scanned of total): &lt;path&gt; &lt;extent&gt;/&lt;size&gt;".
   The distance this closes is not cosmetic: a file whose header is a 12-byte marker
   line followed by 8192 bytes of unbroken content stops at byte 13, and was reported
   as stopping at 8192.

### Relationship to ADR-0021 and ADR-0022

This record does not contradict either. ADR-0021 introduced the bounded read and
`truncated` as its disclosure; ADR-0022 carried that into `check` and CI and recorded
that scan states keep "no markers" apart from "could not look". Both hold. This record
narrows one thing only: that `truncated` is a *sufficient* disclosure of a bounded
read. It answers whether, not how much, and the human surfaces were filling the gap
with the constant.

It is filed as an amendment rather than as a superseding record because there is
nothing to retire — ADR-0022's decision stands in full, and this adds two fields to a
report it does not otherwise touch. Note that ADR-0023's *mechanical* reason for
amending does not apply here: ADR-0022 has an empty `supersededBy`, so superseding it
would be well-formed and lints clean. The reason is substantive, not schema-shaped. If
the maintainer would rather this supersede ADR-0022, that is a one-field change at
ratification.

## Options considered

### Option A: Report the measured extent, additively, `scanned` only — chosen

| Dimension | Assessment |
| --- | --- |
| Answers #108 | In the reporter's own preferred form (direction 1): they own the policy instead of inheriting one |
| Compatibility | Purely additive; no existing field changes meaning, `check --json` and the Action comment stay byte-identical |
| Cost | No new syscall — the size comes from the `fstat` already performed for the `isFile` check on the open handle |
| Honesty | A path that was never opened reports no extent rather than `0` |
| Reversibility | Two-way door: the fields stop being set and every existing consumer is unaffected |

### Option B: A `windowState: "complete" | "truncated"` enum (#108 direction 2)

**Pros:** names the consumer's question in one field.

**Cons:** it reports a judgement where the complaint was a missing measurement — it
would say "partial" without saying "by 141 bytes" or "by 21 KB", which is the
distinction #108 needs. It is also a third name for something already named twice:
`truncated` is `scannedBytes < fileBytes` absent a concurrent write (kept for
compatibility, so this record inherits that redundancy rather than defending it), and
`windowState` would add a second alias to it.

### Option C: Make the window configurable, `--marker-window-bytes` (#108 direction 3)

**Pros:** lets a consumer trade cost for completeness on a corpus it understands, and
ADR-0021's "revisit if" clause explicitly anticipates this door.

**Cons:** it makes the scan cost caller-controlled on a surface CI runs, which is its
own decision with its own threat model — the shape ADR-0022 was written for. It also
does not answer #108 on its own: at any window, a consumer still cannot size what was
missed without the extent. Better reconsidered *after* this record, using the
measurements it makes possible — 20.1% of this repo's sources are over the current
bound, and the 21 KB row is the kind of evidence that argument needs.

### Option D: Do nothing; document that `truncated` means what it says

**Pros:** no surface change at all.

**Cons:** leaves a consumer with a boolean where they asked for a magnitude, and
leaves `check` printing 8192 as the place a scan stopped when it is not that for any
file in this repository. #108 is a consumer report from a real corpus, not a
hypothetical.

## Trade-offs

- **`explain --json` grows two fields.** Additive and optional, but a consumer
  asserting an exact key set will see them. That is the intended signal, which is why
  the tests assert exact key *sequences* — the block is a byte contract.
- **`fileBytes` and `scannedBytes` are two observations, not one.** The size is taken
  by `fstat` before the read loop, so a file appended to in between can report
  `scannedBytes > fileBytes`, and one truncated in between can make a fully read file
  look partial. This is *not* the check/open race ADR-0021 records — that one is path
  substitution before `open` — but content mutation behind an already-open handle, and
  it is newly visible because these are the first numbers to expose it. Left
  unreconciled rather than clamped: agreeing them would hide a file that changed
  underneath the scan.
- **`check` reports the bound while `explain` reports the measurement.** *Closed at
  ratification (action item 3): it does not.* This was recorded as an open scope choice
  on the argument that per-path extents would have to travel through
  `MarkerScanReport`, `check --json`'s contract. That turned out to be the wrong
  constraint — `runCheck` holds the batch scan and hands the renderer a path→extent map
  directly, so the human warning states the measurement and the JSON report is
  unchanged. What survives is the narrower asymmetry that `check --json` carries no
  extent while `explain --json` does, which is a deliberate contract decision rather
  than an unresolved one.
- **The 8192-byte window is unchanged.** This record does not reopen it. It does turn
  ADR-0022's open action item — "reassess the window against real corpora once markers
  are in use" — from rhetorical into measurable, and the numbers above are the first
  data against it.

## Consequences

- **Easier:** a consumer can size the unscanned remainder per file and act on it, and
  the window's real cost across a corpus is now observable rather than argued from a
  constant.
- **Harder:** two fields whose relationship is a contract, so any future change to the
  cut must keep the reported number and the scanned text one computation. The tests pin
  the boundary in both directions — a terminator at the window's last byte, and one at
  the probe byte past it — and assert exact extents rather than `< fileBytes` bounds,
  which are satisfied by any wrong smaller number. The cut itself now exists in two
  representations (`completeLinePrefix` on text, `completeLineByteExtent` on bytes), a
  duplication the type system cannot police, so their equivalence is pinned by a
  dedicated property and fuzz suite; each of dropping `0x0D`, searching forward, an
  off-by-one, and reaching into the probe byte was observed failing it before it passed
  ([ADR-0016](0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
- **How we would know this was wrong:** a consumer reports that the magnitude is not
  what they needed and they wanted the window widened instead (Option C); or the
  `scanned`-only omission forces enough `undefined` handling that a discriminated union
  on `state` is worth the breaking type change; or the two-observation skew above shows
  up in practice rather than in theory. Review by 2027-02-11.
- **Revisit if:** the header window becomes configurable, or a consumer asks for extents
  in `check --json` and can say what shape they need.

## Action items

1. [x] Ratify or reject; if ratified, decide whether this stays an amendment alongside
       ADR-0023 or supersedes ADR-0022 (see above — either is well-formed here).
       **Ratified 2026-08-11 as an amendment.** ADR-0022's decision stands in full and
       there is nothing to retire: this adds two fields to a report ADR-0022 does not
       otherwise touch, and narrows only the claim that `truncated` is a *sufficient*
       disclosure of a bounded read. `supersededBy` on ADR-0022 stays empty.
2. [x] Measure the extent against a real corpus, so ADR-0022's action item 1 has data:
       all 144 tracked `.ts` files under `packages/<pkg>/src/**` and
       `packages/adapters/<pkg>/src/**` at canonical LF content, 29 over
       the window, extents 1–77 bytes short of it. Note this is adrkit's own sources,
       most of which carry no marker; a corpus that uses markers heavily may look
       different, which is what that action item ultimately wants.
3. [x] Decide whether `check`'s truncation warning should carry per-path extents, and
       whether that belongs in `MarkerScanReport` (changing `check --json`) or only in
       the human renderer. **Decided 2026-08-11: the human renderer only.** `runCheck`
       already holds the batch scan, so the warning now reads
       `marker scan truncated (bytes scanned of total): <path> <extent>/<size>` while
       `MarkerScanReport` and `check --json` stay byte-identical. Extending the report
       was considered and declined: `truncatedPaths` is one of five flat code-unit-sorted
       `string[]`s, so extents would need either a breaking shape change, a parallel
       array duplicating the paths (the redundancy Option B was rejected for), or a
       path-keyed map that reopens the ordering surface #117 and #119 just hardened —
       and `check --json` is a contract that cannot be withdrawn once shipped, unlike a
       human string. No consumer has asked for it; the door stays open for one that does,
       at which point the shape would be a requirement rather than a guess.
