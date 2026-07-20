# Contract: pagination, cursors, and the corpus fingerprint

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md) |
**Research**: [../research.md](../research.md) §R6 | **Data model**:
[../data-model.md](../data-model.md) §5 | **Date**: 2026-07-20

This contract is the single, shared specification every one of the four tools' growing
channels implements identically. It exists as its own file because the binding design
direction requires it to be precise and uniform across tools, and repeating it four
times in contracts/tools.md would risk the four copies drifting from each other.

---

## 1. Why an opaque, versioned, query-bound cursor (not a raw offset)

FR-018/FR-019 require: every growing response channel paginates; walking a cursor to
completion returns every item exactly once, in stable canonical order, with no gap or
duplicate; and — per the binding design direction — a corpus change between pages must
**fail explicitly**, never silently gap or duplicate. A bare integer offset satisfies
none of "opaque" (nothing marks it as a token the caller should not interpret or
construct by hand — MCP's own pagination convention, research §R6), "query-bound"
(nothing stops reusing page 3 of query A as page 3 of query B), or "corpus-change-safe"
(an offset into a corpus that has since gained or lost records points at the wrong item,
silently). This contract's cursor is the minimal structure that closes all three gaps at
once.

**What "opaque" does and does not mean here, stated precisely.** Base64url is a plain,
public, reversible encoding, not a cryptographic one — it carries **zero** confidentiality
or integrity guarantee. "Opaque" is used in the same sense MCP's own list-pagination
convention uses it (research §R6): a caller is not *meant* to construct, parse, or
persist a cursor across sessions, and this design never asks a caller to. It is not a
claim that a caller *cannot* — anyone who reads this document can compute a `qh` (§4) and
hand-assemble a plausible-looking cursor with no help from this server at all. Nothing in
this design relies on that being hard. What actually makes a hand-constructed, edited, or
replayed cursor safe is the strict decode/verify sequence in §2: every check runs whether
the cursor arrived from this server's own last response or from anywhere else, and any
mismatch — at any step — is rejected as `invalid-cursor`, never silently accepted or
silently reinterpreted. This is a **correctness/staleness** binding (does this cursor
still describe *this* call, against *this* corpus, at *this* offset), not an
authentication or security boundary: there is no secret to protect, and a cursor that
passes every check can, at most, hand the caller an in-range offset into their own
already-authorized, read-only view of the same corpus they could otherwise page through
one item at a time — it can never widen access, skip validation, or reach a different
corpus.

## 2. Wire format

A cursor is a **string**, always: base64url (`RFC 4648 §5`, no padding) of the UTF-8
JSON encoding of exactly this shape, with fields in this literal, fixed order (so two
calls that mint "the same" cursor produce byte-identical strings — required for
determinism tests, e.g. SC-014's spirit extended to cursor minting):

```ts
interface CursorPayloadV1 {
  readonly v: 1;
  readonly scope: CursorScope;   // see §3 — which tool+channel+field this cursor belongs to
  readonly fp: string;            // 64-char lowercase hex SHA-256 — CorpusHealth.fingerprint at mint time
  readonly qh: string;            // 64-char lowercase hex SHA-256 — hash of this call's binding parameters (§4)
  readonly offset: number;        // positive safe integer; index into that call's deterministic sorted array
}
```

`offset` is a **positive** (never zero, never negative) safe integer
(`Number.isSafeInteger(offset) && offset >= 1`). Zero is never minted: the first page of
any channel is always fetched with **no** cursor supplied for that channel at all (there
is nothing to resume yet), and every cursor this server mints for a *next* page carries
`offset = <previous offset (or 0 for an implicit first page)> + <that page's item
count>`, which is at least `limit`'s own minimum of `1` — so a genuine, server-minted
cursor's `offset` is always `>= 1`. A decoded `offset` of `0`, or a negative or non-safe
value, therefore fails decoding outright (`reason: 'decode-failed'`) as a value this
build never produces and never accepts.

Encoded size is on the order of 150–250 bytes — comfortably inside the 4 KiB input-
schema cap (research §R11), which exists purely as defensive headroom against a
caller-supplied garbage string, not because a legitimate cursor is ever close to it.

**Every supplied cursor is validated — never silently skipped.** A caller that supplies a
`cursor` or `findingsCursor` value always has it decoded and verified through the full
sequence below, regardless of what this call's own substantive outcome turns out to be.
This phase never reasons "the outcome this call resolved to has no pagination, so the
cursor the caller happened to send doesn't matter" — a cursor that cannot apply to this
call's actual outcome is itself a distinct, reported failure (`reason:
'cursor-not-applicable'`, step 7 below), not a silently ignored input. See §5 for exactly
when a primary cursor is applicable and when it is not.

**Decode/verify order** (every step's failure produces the shared, non-error
`InvalidCursorOutcome` — data-model.md §5 — with the named `reason`, never a silent
fallback and never a thrown exception):

1. Base64url-decode. Failure → `reason: 'decode-failed'`.
2. `JSON.parse` the decoded bytes as `CursorPayloadV1`, strictly (unknown keys,
   wrong types, a missing required key, or an `offset` that is not a positive safe
   integer are all decode failures, not partial acceptance). Failure →
   `reason: 'decode-failed'`.
3. Check `v === 1` (the only version this build understands). Mismatch →
   `reason: 'version-unsupported'`.
4. Check `scope` equals the scope expected for **the specific input field this cursor
   value arrived in**, for **this specific tool** (§3) — a `search.findings`-scoped
   cursor supplied in `search_decisions`'s `cursor` field (not `findingsCursor`), or any
   cursor scoped to a different tool's channel entirely, is rejected here, even though it
   decoded fine. Mismatch → `reason: 'wrong-channel'`.
5. Check `fp` equals this call's freshly computed `CorpusHealth.fingerprint`. Mismatch →
   `reason: 'corpus-changed'`.
6. Check `qh` equals this call's freshly computed query-shape hash (§4). Mismatch →
   `reason: 'query-mismatch'`.
7. **(Primary cursor only.)** Check that this call's freshly recomputed, resolved
   substantive outcome actually has a paginated primary channel for this cursor's scope
   to apply to. Every tool's *findings* channel exists on every substantive outcome, so
   this step never rejects a `findingsCursor` (§5). A tool's *primary* channel does not
   always exist — concretely, `get_decision`'s `found`, `not-found`, and
   `federated-log-unavailable` outcomes carry no `candidates` array at all. A `cursor`
   presented against a call that resolves to one of those has passed every check above
   (it may even be a genuine echo of a cursor this server minted for a *different*,
   currently-ambiguous ref against the same corpus) yet still names a channel that, for
   *this* ref, does not exist. Mismatch → `reason: 'cursor-not-applicable'`.
8. Recompute the channel's deterministic sorted array fresh for this call, and check
   `offset < array.length`. A corpus that matches `fp` and a query-shape that matches
   `qh` together pin down that array's contents exactly (§6), so this can only fail when
   the offset itself was never validly issued against this exact array — e.g. a
   hand-constructed or truncated-then-replayed value. Mismatch →
   `reason: 'offset-out-of-range'`.
9. Only now is `offset` used, as a plain array index into that recomputed array.

Steps 5 and 6 are independent and both checked (in that order, so a corpus change is
reported as `corpus-changed` even if the query-shape also happens to differ) — a cursor
can be simultaneously stale *and* bound to a different query, and the more actionable
diagnosis (the corpus moved) is reported first. Steps 7 and 8 are checked only after 3–6
all pass, because both require already knowing this call's resolved, concrete outcome and
its freshly recomputed channel array — there is nothing to check "channel exists" or
"offset in range" against until the corpus and query are confirmed unchanged.

## 3. `CursorScope`, and which input field each scope is valid in

```ts
type CursorScope =
  | 'search.results'        // search_decisions.cursor
  | 'search.findings'        // search_decisions.findingsCursor
  | 'get_decision.candidates' // get_decision.cursor
  | 'get_decision.findings'   // get_decision.findingsCursor
  | 'context.results'         // get_decision_context.cursor
  | 'context.findings'        // get_decision_context.findingsCursor
  | 'superseded.results'      // list_superseded.cursor
  | 'superseded.findings';    // list_superseded.findingsCursor
```

Each tool mints cursors with exactly the two scopes named in its own row above and
rejects (`wrong-channel`) any other scope value presented in either of its two cursor
input fields — including a scope that belongs to a **different tool's** channel
(e.g. a `superseded.results` cursor presented to `search_decisions`). This closes the
"presented in the wrong field" gap precisely, not just "the wrong tool."

## 4. The query-shape hash (`qh`)

SHA-256, hex-encoded, over a fixed-order canonical JSON array of exactly the parameters
that determine **membership and order** of the channel being paginated — deliberately
excluding the cursor/offset itself (which is what the hash exists to protect, not
something it can include) and, for the primary-result hash, excluding the
findings-channel's own parameters (and vice versa), because the two channels page
independently (§5) and must not invalidate each other's cursor on an unrelated change.

| Tool / channel | Hashed parameters, in this order |
|---|---|
| `search_decisions` results | normalized `query` (already validated non-empty after `trim()`, §4 below refers to the same normalization research §R5 defines), sorted unique `status[]` (or `[]` for "all six" — any-of semantics: a record matches if its own `status` is any listed value), sorted unique `tags[]` (all-of semantics: a record matches only if it carries every listed tag — hashed anyway, because a caller changing *which* tags are required between pages, even without changing the count, must invalidate the cursor exactly like any other filter change), sorted unique `scope[]` (any-of semantics, same reasoning as `status`), `limit` |
| `search_decisions` findings | `findingsLimit` only — findings are never filtered by the search's own `query`/`status`/`tags`/`scope`, so only the page size can invalidate a findings cursor for this tool |
| `get_decision` candidates | `requestedRef` (the raw ref that resolved `ambiguous-local-id` — always unqualified, since a qualified ref never reaches this branch), `limit` |
| `get_decision` findings | `findingsLimit` only — `get_decision` derives no findings from `ref`; its findings channel is exactly the corpus findings already bound by `fp`, so binding this cursor to `ref` would reject otherwise-valid continuation calls without protecting membership or order |
| `get_decision_context` results | canonical-sorted, de-duplicated `files[]`, `limit` |
| `get_decision_context` findings | canonical-sorted, de-duplicated `files[]`, `findingsLimit` — this channel's derived findings (e.g. `affects-unresolvable`) are a deterministic function of the corpus (covered by `fp`) and `files[]` (covered here), so no separate hash input is needed to bind them (data-model.md §3.5) |
| `list_superseded` results | `limit` only (no filters exist for this tool) |
| `list_superseded` findings | `findingsLimit` only — this channel's derived findings (`superseded-target-ambiguous`, `superseded-target-federated-unavailable`) are a deterministic function of the corpus alone (covered by `fp`), since this tool takes no filter input to hash |

Every string compared or sorted while computing `qh` — and while building the canonical
JSON that `qh` itself is hashed over — uses `@adrkit/mcp`'s own fixed, locale-independent
code-unit comparator (research §R6), never `String.prototype.localeCompare`, so this
hash cannot vary between two otherwise-identical processes purely because of a runtime
locale difference. There is no `log` parameter anywhere in this table: this phase has no
log dimension to filter or hash by (spec.md FR-021).

Changing any hashed parameter between calls (including simply passing a different
`limit`) is, by design, a `query-mismatch` on the next page — resuming a walk started
with `limit: 20` using `limit: 50` is exactly the kind of silent-reinterpretation this
contract exists to prevent, per the binding design direction's "query-bound" requirement.

## 5. How the primary-result cursor and the findings cursor coexist

Every tool's input carries **two** independent cursor/limit pairs — `cursor`/`limit` for
its primary substantive channel, and `findingsCursor`/`findingsLimit` for the findings
channel (data-model.md §7) — both minted against the **same** `fp` (corpus fingerprint)
but **different** `scope` values and **different** `qh` hashes (§4), and each tracking
its **own** `offset` into its **own** independently-sorted array. Concretely:

- A caller walking only the results channel to completion (repeatedly supplying the
  returned `result.cursor` until it is `null`) never needs to look at `findings` or
  supply `findingsCursor` at all — the findings channel simply always returns its first
  page (or, if `findings.items` is short enough to fit in one page, its only page)
  on every one of those calls, independent of how far into the results the caller has
  walked.
- A caller walking only the findings channel to completion behaves symmetrically.
- A caller walking both simultaneously supplies both cursors on each call; each is
  decoded/verified/applied completely independently (§2) — a `wrong-channel`,
  `query-mismatch`, `cursor-not-applicable`, or `offset-out-of-range` failure on one does
  not affect the other, and the response's `outcome` becomes `invalid-cursor` for
  whichever one first failed verification. **If both are supplied and both are invalid in
  the same call, the primary-result cursor's failure is reported** (the response's
  `outcome` can only be one discriminant per call) — deterministically, always the
  primary cursor's specific failure `reason`, never the findings cursor's, and never a
  coin-flip between them; a caller correcting the primary cursor and retrying will then
  see the findings cursor's own specific failure reason on the next call, never both
  silently discarded.
- **Every supplied cursor is validated — never silently ignored because the outcome
  turned out to be non-paginated.** A `findingsCursor` is always decoded and verified
  (§2 steps 1–6, 8–9), because every substantive outcome from every tool carries a
  findings page — step 7 (channel-exists) never rejects a findings cursor. A primary
  `cursor` is likewise always decoded and verified through steps 1–6; step 7 then asks
  specifically whether *this call's* resolved outcome has a primary channel for that
  cursor's scope to apply to. For `search_decisions`/`get_decision_context`/
  `list_superseded`, every substantive outcome (`results`/`matches`/`entries`, even when
  empty) has one, so step 7 never rejects their primary cursor either. `get_decision` is
  the one tool whose primary channel is outcome-dependent: only its `ambiguous-local-id`
  outcome has a `candidates` array. A `cursor` supplied on a `get_decision` call that
  resolves to `found`, `not-found`, or `federated-log-unavailable` therefore fails step 7
  with `reason: 'cursor-not-applicable'` — reported, not swallowed — even though the
  cursor may otherwise be perfectly well-formed and even correctly scoped/fingerprinted
  (e.g. a genuine cursor from a *different*, still-ambiguous ref queried earlier against
  the same, unchanged corpus).

## 6. Determinism this contract guarantees (ties to SC-008, SC-014)

Given an unchanged corpus and identical call parameters: minting a cursor, decoding it
on the next call, and slicing its channel's freshly recomputed sorted array at `offset`
reproduces byte-identical results to a single, unpaginated walk of the same array —
because the fingerprint check (§2 step 5) guarantees the array is byte-identical to the
one the offset was issued against, not merely "probably the same," and the
range check (§2 step 8) guarantees that offset still indexes inside it. Walking every
page of every channel to completion therefore returns every item exactly once, with no
gap and no duplicate, in the same canonical order a non-paginated call would produce.
