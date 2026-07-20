# Quickstart: MCP Server (Read-Only Retrieval) — Phase 5

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**:
[contracts/tools.md](./contracts/tools.md),
[contracts/pagination-and-cursors.md](./contracts/pagination-and-cursors.md),
[contracts/core-projection.md](./contracts/core-projection.md) | **Date**: 2026-07-20

> **⏳ NOT RUNNABLE YET.** No `packages/mcp/` directory, package manifest, or
> source file exists yet. The Phase 4 real-user gate and **SC-016** are both
> satisfied (`spec.md`'s header callouts), and the 43-task graph is generated.
> Current critical/high artifact remediation and a clean analysis pass precede
> implementation. Every command below describes the
> validation flow once implementation lands. Nothing in this document is
> evidence that anything below has actually been run.

---

## What `@adrkit/mcp` is

A local, stdio-transport, read-only Model Context Protocol server exposing **exactly
four tools** — `search_decisions`, `get_decision`, `get_decision_context`,
`list_superseded` — over the same corpus `@adrkit/core` already parses, validates, and
resolves `affects` matchers against for the CLI and CI surface. It reads git-tracked
decision records already on disk; it never fetches, indexes, caches, mutates, or writes
anything (ADR-0001, ADR-0004). Every call reloads the corpus fresh (FR-010).

---

## The offline flow, once implementation lands

The frozen install may contact only the unauthenticated public package registry.
Everything after that step runs with networking disabled, no credentials or services,
and no model configured.

```bash
# 0) Pinned stable Bun, matching every other package in this workspace.
bun --version            # expect 1.3.14
bun install --frozen-lockfile
# Disable networking here for every remaining command and server process.
bun run build

# 1) Public programmatic launch — still stdio-only, with no caller-supplied transport.
#    Illustrative shape, not implementation code:
#
#      import { createAdrkitMcpServer } from '@adrkit/mcp';
#
#      const handle = createAdrkitMcpServer({ cwd: process.cwd(), dir: 'docs/adr' });
#      await handle.start(); // validates roots, creates the private StdioServerTransport
#      // await handle.close() during controlled shutdown
#
#    The SDK server, registration methods, and transport are intentionally private.
#    Repository tests use a package-internal builder with InMemoryTransport; that
#    builder is absent from package exports.

# 2) Real stdio subprocess (proves no non-protocol stdout — research §R8, FR-007),
#    against this repository's own real docs/adr/ corpus:
adrkit-mcp --cwd "$PWD" --dir docs/adr
# (blocks on stdin; a harness or the SDK's own StdioClientTransport speaks JSON-RPC to it)
```

### Example call and response — `search_decisions`

```jsonc
// tools/call { name: "search_decisions", arguments: { query: "bun", limit: 20 } }
{
  "content": [{ "type": "text", "text": "Returned 2 decision results; 0 findings on this page." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…64 hex chars…", "recordCount": 11, "excludedCount": 0 },
    "result": {
      "outcome": "results",
      "items": [
        { "id": "0006", "title": "License Apache-2 and single monorepo",
          "status": "accepted", "sourcePath": "docs/adr/0006-license-apache-2-and-single-monorepo.md",
          "matchedFields": ["body"] },
        { "id": "0010",
          "title": "Use Bun as the package manager and test runner while publishing Node-targeted artifacts",
          "status": "accepted", "sourcePath": "docs/adr/0010-bun-toolchain.md",
          "matchedFields": ["body", "title"] }
      ],
      "cursor": null,
      "findings": { "items": [], "cursor": null }
    }
  }
}
```

Note: **exactly one** of the two `content`/`structuredContent` channels is
human-readable prose (FR-013); every field a caller would branch on programmatically
lives only in `structuredContent`, and `result.outcome` is present on every response
regardless of which of FR-015's three cases applies (contracts/tools.md §3). There is no
`log`/`ref` field anywhere in this response — this phase's identity is the bare `id`
alone (FR-021).

### An `ambiguous-local-id` `get_decision` lookup

```jsonc
// tools/call { name: "get_decision", arguments: { ref: "0012" } }
// — an already-invalid fixture corpus where two DIFFERENT files both declare id 0012
// (already flagged elsewhere by a `unique-id` error finding).
{
  "content": [{ "type": "text", "text": "Returned 2 candidates for ambiguous local ref \"0012\"; 1 finding on this page." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…", "recordCount": 13, "excludedCount": 0 },
    "result": {
      "outcome": "ambiguous-local-id",
      "requestedRef": "0012",
      "candidates": [
        { "id": "0012", "title": "…", "status": "accepted", "sourcePath": "docs/adr/0012-original.md" },
        { "id": "0012", "title": "…", "status": "proposed", "sourcePath": "docs/adr/0012-duplicate.md" }
      ],
      "cursor": null,
      "findings": {
        "items": [
          { "rule": "unique-id", "severity": "error", "id": "0012", "field": "id",
            "message": "ADR id \"0012\" is used by multiple records: docs/adr/0012-duplicate.md, docs/adr/0012-original.md" }
        ],
        "cursor": null
      }
    }
  }
}
```

Candidates are distinguished only by `sourcePath` — there is no log qualifier to
distinguish them by, and this phase supplies no way to disambiguate further; the
caller's actionable next step is fixing the corpus, not retrying with a different input
(US1 AC4).

### A `federated-log-unavailable` `get_decision` lookup

```jsonc
// tools/call { name: "get_decision", arguments: { ref: "payments:0012" } }
{
  "content": [{ "type": "text", "text": "Named-log federation is unavailable for \"payments:0012\"; 0 findings on this page." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…", "recordCount": 13, "excludedCount": 0 },
    "result": {
      "outcome": "federated-log-unavailable",
      "requestedRef": "payments:0012",
      "log": "payments",
      "id": "0012",
      "findings": { "items": [], "cursor": null }
    }
  }
}
```

The qualifier is recognized only far enough to produce this outcome — it is never
stripped to retry as a bare `0012` lookup, and a local record with id `0012` (if one
exists) is never substituted for it (FR-021, FR-022, US1 AC5).

### A `list_superseded` entry with an ambiguous target — `candidateCount`, not a nested candidate list

```jsonc
// tools/call { name: "list_superseded", arguments: {} }
{
  "content": [{ "type": "text", "text": "Returned 1 superseded decision entry; 2 findings on this page." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…", "recordCount": 13, "excludedCount": 0 },
    "result": {
      "outcome": "entries",
      "items": [
        { "id": "0003", "title": "Use YAML for config", "status": "superseded",
          "sourcePath": "docs/adr/0003-use-yaml-for-config.md",
          "supersededBy": { "resolved": false, "targetRef": "0012", "reason": "ambiguous", "candidateCount": 2 } }
      ],
      "cursor": null,
      "findings": {
        "items": [
          { "rule": "unique-id", "severity": "error", "id": "0012", "field": "id",
            "message": "ADR id \"0012\" is used by multiple records: docs/adr/0012-duplicate.md, docs/adr/0012-original.md" },
          { "rule": "superseded-target-ambiguous", "severity": "warn", "id": "0003", "field": "supersededBy",
            "message": "supersededBy target \"0012\" resolves to 2 local records; see get_decision(\"0012\") for the full candidate list" }
        ],
        "cursor": null
      }
    }
  }
}
```

Note two things this response demonstrates together: (1) `findings.items` mixes a
**corpus** finding (`unique-id`, from `corpusFindings` — the same finding the earlier
`get_decision` example surfaced) with a **derived** finding
(`superseded-target-ambiguous`, minted by this tool call itself), merged and re-sorted
into one list — neither channel is the other; and (2) the ambiguous entry itself carries
only `candidateCount: 2`, never an embedded list of the two candidates — a caller who
needs their id/title/`sourcePath` calls `get_decision({ ref: "0012" })`, which returns
exactly the `ambiguous-local-id` shape shown earlier in this document, already paginated
and already bounded.

### An inert (degraded, still useful) `get_decision_context` match — a finding-channel excerpt, not a full response

The following is one item from a `findings.items` array inside an otherwise-ordinary
`'matches'` response — not a standalone example in its own right (a full response always
has the complete envelope shown throughout this document):

```jsonc
{ "rule": "affects-unresolvable", "severity": "info",
  "message": "Package matcher \"react@>=19\" requires a changed-dependency snapshot and is inert." }
```

This is a **derived** finding — `resolveAffects` produced it for this specific call's
`files[]`, so it rides this call's `findings` channel alongside `corpusFindings`, never
inside `corpusHealth.fingerprint` (data-model.md §3.5) — never a fabricated match and
never a fatal error for the rest of the call (FR-032; ADR-0009).

### Invalid-cursor responses — same envelope, and no `findings` field at all

Every `invalid-cursor` response uses the identical envelope every other response uses —
`content` **and** `structuredContent`, and `corpusHealth` present, because computing it
only requires a successfully-loaded corpus, which a cursor mismatch does not prevent.
Neither `invalid-cursor` nor `corpus-unavailable` carries a `findings` field at all: both
are non-substantive branches — one about a cursor, one about the corpus failing to load
at all — never a claim about which records or findings this call found, so there is
nothing to report on that channel (contracts/pagination-and-cursors.md §2).

```jsonc
// tools/call { name: "search_decisions", arguments: { query: "bun", cursor: "<a cursor minted before a record was added>" } }
// corpusHealth.fingerprint below is freshly computed for THIS call and differs from the
// fingerprint embedded inside the supplied cursor — that mismatch is what "corpus-changed" reports.
{
  "content": [{ "type": "text", "text": "Corpus changed after this cursor was issued." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…", "recordCount": 12, "excludedCount": 0 },
    "result": { "outcome": "invalid-cursor", "reason": "corpus-changed",
                 "message": "Corpus changed after this cursor was issued." }
  }
}
```

```jsonc
// tools/call { name: "get_decision", arguments: { ref: "0012", cursor: "<a candidates-page cursor minted the last time \"0012\" was ambiguous>" } }
// — the same corpus, but "0012" now resolves to exactly one record (the duplicate was
// fixed since the cursor was minted), so this call's outcome is `found`, which has no
// `candidates` channel for the supplied cursor to apply to.
{
  "content": [{ "type": "text", "text": "Cursor does not apply to this outcome." }],
  "structuredContent": {
    "corpusHealth": { "fingerprint": "…", "recordCount": 12, "excludedCount": 0 },
    "result": { "outcome": "invalid-cursor", "reason": "cursor-not-applicable",
                 "message": "Cursor does not apply to this outcome." }
  }
}
```

---

## What "green" means

- **Exactly four tools**, every response's `tools/list` entry declaring `readOnlyHint:
  true, destructiveHint: false, idempotentHint: true, openWorldHint: false` and a
  root-`object` `outputSchema` (contracts/tools.md §2) — no fifth tool, no resource, no
  prompt registered (verified via `client.listTools()` in the in-process fixture).
- **The graveyard is searched and fetchable by default** — a fixture query matching
  only a `rejected` record's body, and a direct `get_decision` on a `superseded` record,
  both succeed with no status filter supplied (SC-002, SC-001).
- **The three-way local-id outcome holds, and a log-qualified ref is a distinct fourth
  outcome** — zero/one/many fixtures for `get_decision` each produce exactly
  `not-found`/`found`/`ambiguous-local-id`, never a silent first match, distinguished
  only by `sourcePath`; a separate fixture proves a log-qualified ref always produces
  `federated-log-unavailable`, never a local substitute and never the qualifier silently
  stripped (SC-003).
- **`get_decision_context` never merges or drops a status bucket** — a fixture with one
  record per `Status` value places each in exactly one of `governing`/
  `activeProposals`/`history` (SC-004).
- **No adversarial input escapes its input schema** — path traversal, absolute paths,
  backslash-containing paths, unknown extra fields, oversized `query`/`files[]`/`tags[]`,
  and a whitespace-only `query` all produce `isError: true` before any corpus access,
  with zero reads outside the configured `--cwd`, zero outbound network calls, and zero
  absolute paths in any successful response (SC-005).
- **Observed root, ADR-directory, and candidate-file swaps are rejected** — startup
  rejects an escaping directory symlink; deterministic swaps injected at every
  pre/post validation checkpoint return `corpus-unavailable` and no changed-path data.
  These portable checks do not claim an atomic guarantee against a hostile swap that
  occurs and reverts entirely between checkpoints (SC-005; research §R7;
  data-model.md §8).
- **`stdout` carries only protocol frames** — the real stdio-subprocess capture test
  (research §R8) reports zero non-protocol bytes across a full exercise of all four
  tools (SC-006).
- **Every response has both channels** — `content` (the exact deterministic template
  from `contracts/tools.md` §2.1, at most 512 UTF-16 code units) and
  `structuredContent` (schema-valid) on every one of the four tools' successful calls,
  **and** on every `invalid-cursor`/`corpus-unavailable` response too — neither of those
  two branches carries a `findings` field, because neither is a substantive answer about
  corpus content (SC-007).
- **Pagination is lossless, deterministic, and every supplied cursor is checked** —
  walking any cursor (results or findings, any tool) to completion against a multi-page
  fixture returns every item exactly once with no gap or duplicate, in canonical order,
  byte-identically on repeat runs against an unchanged corpus (SC-008, SC-014); a cursor
  is never silently accepted or silently ignored — a mutated payload, an unsupported
  version, a wrong-tool/wrong-field scope, a stale corpus or query-shape, a primary
  cursor presented against a call whose outcome has no primary channel
  (`cursor-not-applicable`), and an in-range-looking `offset` that no longer indexes
  inside the freshly recomputed channel (`offset-out-of-range`) each independently
  produce their own named `invalid-cursor` reason, never a silent fallback to page 1.
- **One bad record never blocks the rest, and a corpus invariant never removes a valid
  record** — a fixture with exactly one schema-invalid file still answers correctly for
  every other record via `search_decisions`/`get_decision_context`, with the invalid one
  surfaced only as a finding (SC-009); a separate fixture proves a record flagged by a
  corpus invariant (`unique-id`, a dangling reference) remains fully present and
  retrievable everywhere — the invariant adds a finding, never an exclusion.
- **Missing backing sources are inert, never fabricated or fatal** — a `package`
  matcher with no lockfile snapshot resolves inert with an informational finding
  (SC-010).
- **`list_superseded` resolves direct, local edges only, and never picks a target
  silently — and never inlines an unbounded candidate list either** — a dangling target
  surfaces via the corpus's own existing finding; a duplicate-local-id target surfaces a
  deterministic, fixed-template `superseded-target-ambiguous` finding naming the target
  id and a `candidateCount` (never every candidate's path/title inline), with the
  complete candidate list separately obtainable via a follow-up `get_decision` call; and
  a log-qualified target surfaces an informational federated-unavailable finding — none
  dropped, none fabricated, none silently chosen (SC-011).
- **A tool's `findings` channel is corpus findings plus that call's own derived
  findings, composed fresh every call, never a mutation of a shared projection** — a
  fixture proves `get_decision_context`'s per-record `resolveAffects` findings and
  `list_superseded`'s minted findings change with that call's own inputs while
  `corpusHealth.fingerprint` stays anchored to the corpus alone, and a fixture proves
  `search_decisions`/`get_decision` never derive any findings of their own.
- **Search filters compose exactly as specified — any-of within `status`/`scope`,
  all-of within `tags`, ANDed across categories** — a fixture with two supplied tags
  proves a record carrying only one of them does not match, while a fixture with two
  supplied `status` values proves a record matching either one does.
- **Clean-clone, frozen-install, then offline and correct** — the only network use is
  `bun install --frozen-lockfile` against the unauthenticated public registry; build,
  typecheck, test, lint, package, smoke, and all four tool calls then pass with
  networking disabled, no credential, and no service (SC-012).
- **The dependency-graph gate holds, and no-network is separately proven, as
  defense-in-depth executed-path evidence, at runtime** — `@adrkit/mcp`'s declared,
  direct dependencies are exactly `@adrkit/core`, the pinned SDK, and `zod` (extending
  `core-has-no-adapter-deps` exactly as it already extends to `@adrkit/evaluator`), and a
  side-effect-denial preloads plus independent complete-sandbox/parent-sentinel/
  `HOME`/`TMPDIR` snapshots prove that the exercised real-server paths invoke none of
  the enumerated network, filesystem-mutation, subprocess, worker, native-addon, or
  Bun-shell APIs — complementary bounded evidence, not a formal proof against every
  conceivable channel (SC-005, SC-013).
- **Declared relation refs are surfaced, never expanded** — a `conflictsWith` fixture on
  both `get_decision` and `get_decision_context` shows the ref unresolved, and a
  follow-up `get_decision` call using it returns the full referenced record (SC-015).

Green does **not** mean "implementation may begin." That is SC-016 alone, and it is a
maintainer decision, not a test result.

---

## What is explicitly NOT here

- **No fifth tool, no write/mutation/PR-creation capability of any kind** (FR-001,
  FR-002) — when write capability lands, per `plan.md` (root), it opens PRs like every
  other machine write in this project.
- **No MCP prompts, resources, subscriptions, or sampling** (FR-003).
- **No model call, embedding, or ranking** — search is deterministic normalized literal
  matching only (FR-004, FR-025/FR-026, research §R5).
- **No HTTP/SSE transport, no authentication** — local stdio subprocess only, launched
  by the harness that trusts it (FR-005, FR-006).
- **No persistent cache, index, or database** — every call rereads the corpus (FR-010).
- **No transitive supersession walk** — `list_superseded` reports direct edges only
  (FR-034).
- **No named-log or multi-repository federation** — a log-qualified `ref` or
  `supersededBy` target is recognized only far enough to answer
  `federated-log-unavailable` or an unresolved, informational entry, never resolved,
  stripped, or substituted (FR-021, FR-022, FR-034).
- **No expansion of declared relation refs** — surfaced, never fetched or inlined by
  `get_decision`/`get_decision_context` (FR-024, FR-033).
- **No implementation yet** — `tasks.md` exists after SC-016 ratification, but the
  current cross-artifact findings must be cleared before production work begins.

---

## Gate evidence

**Phase 4 real-user gate**: recorded in `spec.md`'s header callout — the maintainer's
`adr evaluate` run against the genuine, then-`proposed` ADR-0007, with a real first-run
failure, a one-line fix, and a clean, fully-deterministic rerun. This plan treats it as
satisfied and does not re-run or re-litigate it.

**This phase's own gate — SC-016**: satisfied on 2026-07-20. The maintainer
explicitly ratified the four-tool boundary and its exclusions. Search ranking,
transitive-supersession scope, `conflictsWith` visibility, and log-identity
semantics were already fixed to conservative defaults in the Functional
Requirements. No maintainer-facing product decision remains open.
