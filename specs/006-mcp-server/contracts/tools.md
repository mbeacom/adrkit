# Contract: the four tools (`@adrkit/mcp`)

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md) |
**Research**: [../research.md](../research.md) | **Data model**:
[../data-model.md](../data-model.md) | **Pagination**:
[pagination-and-cursors.md](./pagination-and-cursors.md) | **Date**: 2026-07-20

This contract defines the behavioral surface of `search_decisions`, `get_decision`,
`get_decision_context`, and `list_superseded`: the library/bin split, the shared
envelope and annotations every tool uses identically, the canonical ordering rule, the
error/output-schema reconciliation this design relies on, each tool's precise semantics,
the fixed limits, and startup behavior. Shapes are the conceptual types from
[data-model.md](../data-model.md); FR-numbers refer to [../spec.md](../spec.md).

---

## 1. Library surface (`@adrkit/mcp`)

```ts
interface AdrkitMcpServerHandle {
  start(): Promise<void>;
  close(): Promise<void>;
}

// packages/mcp/src/index.ts — the public stdio lifecycle factory. No side effects
// at import time; no filesystem access at construction time (data-model.md §8).
function createAdrkitMcpServer(
  options?: Partial<AdrkitMcpServerOptions>,
): Readonly<AdrkitMcpServerHandle>;

// packages/mcp/src/bin.ts — the dedicated stdio entrypoint. Only file with a
// process.argv/process.env read, the FR-036 startup check, and a top-level
// isMainModule() guard (mirroring packages/cli/src/main-module.ts's own pattern —
// not imported from there; a five-line, local, non-domain helper, not a core export).
// Never imported by anything except the compiled `bin` entry itself.
async function main(argv: string[], env: Record<string, string | undefined>): Promise<0 | 1 | 2>;
```

The returned handle is a frozen, null-prototype object with exactly the own string
properties `start` and `close` and no symbol properties. The concrete SDK `McpServer`,
its low-level `.server`, registration APIs, and its transport remain closure-private.
`start()` accepts no argument, performs the startup validation in §9, creates exactly
one `StdioServerTransport`, and connects it; it cannot be redirected to an HTTP,
in-memory, or caller-supplied transport. `close()` closes that private server.

The closure-private server registers **exactly** `search_decisions`,
`get_decision`, `get_decision_context`, and `list_superseded` (FR-001), and
**nothing else** — no `registerResource`, no `registerPrompt`, no sampling call,
no subscription handler (FR-003). A package-internal builder returns the concrete
server only for in-memory conformance tests. It is absent from `package.json#exports`
and every public subpath. Every handler calls `loadCorpusProjection`
(data-model.md §3) itself, fresh, on every invocation (FR-010).

## 2. Shared envelope, annotations, and canonical ordering

Every tool's `outputSchema` raw shape is:

```ts
{ corpusHealth: CorpusHealth.optional(), result: <Tool>Result }   // registerTool raw shape — never a bare union at the schema root (research §R1.1)
```

Every tool's annotations are identical and fixed:

```ts
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
```

— `readOnlyHint`/`destructiveHint`/`idempotentHint` together are the accurate,
literal statement that no call ever creates, edits, deletes, or has any side effect
(FR-002); `openWorldHint: false` is the accurate statement that this server's domain of
interaction is exactly the one configured corpus, never anything beyond it (FR-008,
FR-014) — the "closed-world" property the spec's checklist calls out by name.

### 2.1 Deterministic text channel

Every server-authored response contains exactly one text-content item. The renderer
uses `plural(n, one, many)`, defined as `n === 1 ? one : many`, and the following
exact templates; `{findings}` is the current findings page's `items.length`, not a
corpus-wide total:

| Outcome | Exact text |
|---|---|
| `results` | `Returned {items.length} decision {plural(items.length, "result", "results")}; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `found` | `Found decision "{decision.id}"; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `not-found` | `No local decision matches "{requestedRef}"; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `ambiguous-local-id` | `Returned {candidates.length} {plural(candidates.length, "candidate", "candidates")} for ambiguous local ref "{requestedRef}"; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `federated-log-unavailable` | `Named-log federation is unavailable for "{requestedRef}"; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `matches` | `Returned {pageMatchCount} context {plural(pageMatchCount, "match", "matches")}: {governing.length} governing, {activeProposals.length} active {plural(activeProposals.length, "proposal", "proposals")}, {history.length} historical; {findings} {plural(findings, "finding", "findings")} on this page.` |
| `entries` | `Returned {items.length} superseded decision {plural(items.length, "entry", "entries")}; {findings} {plural(findings, "finding", "findings")} on this page.` |

`pageMatchCount` is exactly `governing.length + activeProposals.length +
history.length`. Invalid-cursor messages are fixed:

| Reason | Exact message and text |
|---|---|
| `decode-failed` | `Cursor could not be decoded.` |
| `version-unsupported` | `Cursor version is not supported.` |
| `wrong-channel` | `Cursor does not belong to this tool channel.` |
| `corpus-changed` | `Corpus changed after this cursor was issued.` |
| `query-mismatch` | `Cursor was issued for different request parameters.` |
| `cursor-not-applicable` | `Cursor does not apply to this outcome.` |
| `offset-out-of-range` | `Cursor offset is outside the current result set.` |

Corpus-unavailable messages are likewise fixed and interpolate no path:

| Reason | Exact message and text |
|---|---|
| `root-not-found` | `Configured repository root was not found.` |
| `root-not-directory` | `Configured repository root is not a directory.` |
| `root-not-readable` | `Configured repository root is not readable.` |
| `root-not-git` | `Configured repository root is not a Git worktree.` |
| `dir-not-found` | `Configured ADR directory was not found.` |
| `dir-not-directory` | `Configured ADR directory is not a directory.` |
| `dir-not-readable` | `Configured ADR directory is not readable.` |
| `dir-outside-root` | `Configured ADR directory resolves outside the repository root.` |
| `corpus-changed-during-load` | `Corpus changed while it was being loaded; retry the call.` |

Every rendered string is capped at 512 UTF-16 code units. The only interpolated
strings are schema-bounded ids/refs; corpus paths and messages are never interpolated.

**Canonical order, used identically everywhere a list of `DecisionSummary`-shaped items
is produced** (FR-018, FR-027): ascending by `(id, sourcePath)` — `id` compared as a
plain string with `@adrkit/mcp`'s own fixed, locale-independent code-unit comparator
(`a < b ? -1 : a > b ? 1 : 0` over UTF-16 code units — never
`String.prototype.localeCompare`, whose result can vary by runtime locale; matching the
schema's own id grammar, zero-padded numeric ids and ULIDs both sort correctly under
plain string ordering), then `sourcePath` as a final, always-unique tiebreak. Never a
relevance score, a weight, or any other heuristic (FR-004, FR-026). This is the *one*
comparator `@adrkit/mcp` implements; every tool's primary channel is ordered by it. Every
tool's `findings` channel is **also** ordered by this same comparator, using the same
field-priority tuple `@adrkit/core`'s own `sortFindings` already uses (`rule`, `id`,
`pattern`, `path`, `field`, `message`).

**What a tool's `findings` channel actually contains — corpus findings plus this call's
own derived findings, never the other way around (data-model.md §3.5).**
`CorpusProjection.corpusFindings` is `lintCorpus()`'s own findings plus the pre-read
guard's own findings, re-sorted by `@adrkit/mcp`'s comparator — and nothing else.
`@adrkit/mcp` re-sorts with its own comparator rather than reusing `sortFindings()`
directly, because that function compares with `localeCompare`, which is locale-sensitive
and therefore not the deterministic, environment-independent order this design's cursor
and fingerprint guarantees depend on (research §R6); `lintCorpus()`'s own
`localeCompare`-ordered findings array is accepted as **input** and then re-sorted,
never returned in its original order. Each tool handler builds its own
`responseFindings` by concatenating `corpusFindings` with whatever findings that
*specific call* deterministically derives on top of it (§6 for `get_decision_context`,
§7 for `list_superseded`; `search_decisions` and `get_decision` derive none), then
re-sorts the combined array with the same comparator before the findings-channel cursor
paginates it. `CorpusProjection` is a `readonly` value read by every tool in the same
call — it is **never mutated** to accumulate a tool's own derived findings; each handler
computes its own `responseFindings` locally and returns it, leaving the shared
projection untouched for any other code that reads it during the same call.

## 3. Error / output-schema reconciliation — the practical rule (research §R1.2)

1. A call whose arguments fail the declared `inputSchema` — including every
   `.refine()`-encoded semantic check (`files[]` path-traversal/absolute/drive-letter/
   empty, `query`/`ref`/cursor length bounds, array-count bounds) — never reaches this
   server's own handler code at all. The SDK returns `{ isError: true, content: [{
   type: 'text', text: '...' }] }` itself, before any corpus access (FR-012, FR-030).
   This satisfies FR-015 case (a) for every violation expressible as an input-shape
   constraint.
2. Every other anticipated, name-able condition — an ambiguous or log-qualified id, an
   empty result, zero context matches, an invalid/mismatched/stale cursor, an
   unavailable corpus at call time — is a **non-error** branch of the tool's own
   `outcome` discriminated union, fully validated by the SDK's output-schema check
   (never `isError`). This is FR-015 cases (a)-as-a-substantive-answer and (b), always
   structured, always distinguishable by `result.outcome` alone.
3. Corpus findings (FR-016) ride the `findings` field of whichever substantive branch
   fired — never a separate error, never text-only. This is FR-015 case (c).
4. `isError: true` is otherwise reserved for a genuinely unanticipated internal
   exception. Even then, the SDK's own catch-all guarantees a well-formed
   `CallToolResult` reaches the caller — never a raw, unhandled exception (SC-005).

## 4. `get_decision`

**Input**: `GetDecisionInput` (data-model.md §7) — `ref` (required, always, even on a
continuation call; 1–128 chars; validated by ADR-0002's `AdrRef` grammar so a caller can
pass a ref copied verbatim from another response's relation fields), optional
`cursor`/`limit` (`ambiguous-local-id` candidates page, only meaningful when this call's
outcome resolves to `ambiguous-local-id` — see step 7 below for what happens when it is
supplied but this call resolves to anything else), optional
`findingsCursor`/`findingsLimit` (always meaningful — every outcome carries a
`findings` page).

**Resolution** (FR-021, FR-022, US1 AC1–AC7):

1. `loadCorpusProjection` (data-model.md §3, §8). If it reports the corpus itself is
   unavailable, return `CorpusUnavailableOutcome` immediately.
2. `parseAdrRef(ref)` (contracts/core-projection.md §1).
3. If `parsed.log` is **defined** — the ref is log-qualified — return
   `federated-log-unavailable` (`requestedRef: ref`, `log: parsed.log`, `id:
   parsed.id`) immediately, **without** consulting `byId` at all. This phase serves
   exactly one local corpus and never attempts a local lookup with a qualified ref,
   never strips the qualifier and retries unqualified, and never substitutes a same-id
   local record for it (FR-021, US1 AC5) — regardless of whether `byId.get(parsed.id)`
   would otherwise have resolved unambiguously.
4. If `parsed.log` is **undefined** — a bare local id — look up `byId.get(parsed.id)`:
   - Bucket absent/empty → `not-found` (`requestedRef: ref`).
   - Bucket length 1 → `found`, using that one record.
   - Bucket length \>1 → `ambiguous-local-id`, with `requestedRef: ref` and `candidates`
     built from every record in the bucket as a `DecisionSummary` (distinguished by
     `sourcePath`, since no log qualifier exists to distinguish them by), canonically
     ordered and paginated (§2, pagination contract). This bucket length can only exceed
     1 when the corpus already has a `unique-id` error finding for that id (§3 of
     data-model.md); this phase offers no way to disambiguate further — the caller's
     actionable next step is fixing the corpus, not retrying with a different input.
5. On `found`, build `FullDecision` (data-model.md §4) directly from the resolved
   `Adr`: `requestedRef` is the raw input `ref` (identical to `id` here, since only an
   unqualified ref reaches this branch); `frontmatter` is that record's own
   `AdrFrontmatter` object, reused verbatim (no field picked or omitted) — this is the
   mechanism for FR-023/FR-024: every declared `supersedes`/`supersededBy`/`relatesTo`/
   `conflictsWith` ref is present because it is simply part of `frontmatter`, and none of
   them is resolved, fetched, or inlined, because nothing in this step touches any
   *other* record.
6. `findings`: the full `responseFindings` — here, exactly `CorpusProjection
   .corpusFindings`, since `get_decision` derives no findings of its own (§2) — paginated
   independently (pagination contract §5). This tool does not filter findings to only the
   resolved record; a caller fetching one decision still learns the corpus has, say, one
   schema-invalid file elsewhere.
7. **If a `cursor` was supplied and this call's outcome is *not* `ambiguous-local-id`**
   (i.e. it resolved to `found`, `not-found`, or `federated-log-unavailable`): the
   supplied `cursor` is still decoded and verified through every step that does not
   require a `candidates` array to exist (contracts/pagination-and-cursors.md §2, steps
   1–6) — if it fails any of those on its own merits (bad encoding, wrong version, wrong
   scope, stale fingerprint, mismatched `requestedRef`/`limit`), that specific reason is
   reported. If it passes all of those, the response is `invalid-cursor` /
   `cursor-not-applicable`, because there is no `candidates` channel for this outcome to
   apply it to — the cursor is never silently ignored in favor of returning `found`/
   `not-found`/`federated-log-unavailable` as if no `cursor` had been supplied.

**Oversized source (US1 AC8, SC-001)**: if `ref` resolves to a record the pre-read size
guard (data-model.md §3.3) already excluded before `lintCorpus` ever ran, the lookup
behaves exactly as if that record did not exist — `not-found` — and the
`record-too-large` finding for that path is present in `findings`, so the caller can
distinguish "genuinely absent" from "present but excluded" by reading the findings
channel, never by a fabricated partial `found`.

If a candidate changes between the pre-load metadata check and the post-load verification,
the call instead returns `corpus-unavailable` / `corpus-changed-during-load`; no
provisional decision or finding page from that inconsistent read is returned.

## 5. `search_decisions`

**Input**: `SearchDecisionsInput` (data-model.md §7).

**Query validation, before matching runs (FR-026, research §R5)**: `query` must be
`1`–`256` raw UTF-16 code units, **and** non-empty after `query.trim()` — a
whitespace-only `query` is rejected as an input-contract error (FR-015 case (a)) before
any corpus access, never silently normalized to an empty-string query that would
otherwise match every record via `''.includes('')`-style substring containment.

**Filter semantics — any-of within `status`/`scope`, all-of within `tags`, ANDed across
categories (contracts/tools.md §8 for the size limits)**:

- `status` (1–6 unique values when present, omitted entirely = all six, FR-020): **any-of** — a record matches
  this filter if its own `status` is any one of the listed values.
- `scope` (1–3 unique values when present): **any-of** — a record matches this filter if its own
  `scope` is any one of the listed values.
- `tags` (1–32 unique slugs when present, each 1–64 chars): **all-of** — a record matches this filter
  only if its own `tags` array contains *every* listed value, not merely one of them.
- Across categories, the three filters are **ANDed**: a record must satisfy every
  supplied category's own condition to remain a candidate at all; omitting a category
  entirely means "no constraint from that category," never "match nothing." A record
  failing any one supplied category is excluded before the query is ever tested against
  it (never partially matched).

**Matching** (FR-025–FR-028, US3):

1. `loadCorpusProjection`.
2. Normalize the query: `normalize(query)` (research §R5, already validated non-empty
   after `trim()` above). If `status`/`tags`/`scope` filters are present, apply them
   first per the semantics above.
3. For each remaining record, in canonical order, test whether
   `normalize(candidateField)` contains `normalize(query)` as a substring, independently
   for each of: the record's `id`, `title`, each `tag` (any one matching is sufficient),
   and `body`. A record matches iff **at least one** field matches; `matchedFields`
   lists **every** field that independently matched (FR-028), sorted
   `['body','id','tag','title']` (alphabetical, using `@adrkit/mcp`'s own code-unit
   comparator — a fixed, arbitrary but deterministic order, since no field is
   privileged over another).
4. Matching records become `SearchMatch` (data-model.md §6), canonically ordered,
   paginated (§2, pagination contract).

**Default graveyard inclusion** (FR-020, US3 AC1): omitting `status` matches all six
values; a caller must explicitly narrow with `status` to exclude any of them — there is
no way to *opt out* of seeing `rejected`/`superseded`/`deprecated` records other than
naming the statuses to include.

**No match** (US3 AC7): the same `'results'` branch, `items: []`, `cursor: null` — not a
distinct outcome and not an error.

## 6. `get_decision_context`

**Input**: `GetDecisionContextInput` (data-model.md §7) — `files[]` (1–256 entries,
each a validated repo-relative logical path: 1–1024 chars, no leading `/`, no `..`
segment, no drive letter, and **no backslash anywhere in the string** — the contract is
POSIX separators only (FR-030), so a path using `\` as a separator, or containing one as
any other character, is rejected identically to an absolute or traversal path, before
any matcher evaluation).

**Resolution** (FR-029–FR-033, US2):

1. `loadCorpusProjection`. (`files[]` entries are never opened, read, or `stat`'d —
   FR-009 — they are compared only against `affects` patterns already loaded from the
   corpus, by `resolveAffects`.)
2. For each record in `CorpusProjection.records`, in canonical order, call
   `resolveAffects({ records: [record], changedFiles: files })` **once per record**
   (research §R4) — never one batched call across the whole corpus.
3. A record with at least one fired matcher becomes a `ContextEntry` (data-model.md §6)
   and is assigned to exactly one of three buckets by its own `status`: `accepted` →
   `governing`; `draft`/`proposed` → `activeProposals`; `rejected`/`superseded`/
   `deprecated` → `history` (FR-031). Every one of the six `Status` values is reachable
   through exactly one bucket; none is structurally excluded.
4. Findings from every per-record `resolveAffects` call (e.g. `affects-unresolvable` for
   a `package` matcher with no lockfile snapshot — FR-032, ADR-0009) are this tool's
   **derived** findings (§2, data-model.md §3.5): concatenated across all per-record
   calls, then merged with `CorpusProjection.corpusFindings` into this call's own
   `responseFindings`, re-sorted canonically, and only then does the findings-channel
   cursor apply — `CorpusProjection` itself is read, never mutated, by this step.
5. **One canonical walk, partitioned per page**: all matching records across all three
   buckets are combined into one canonically-ordered flat list *before* pagination; the
   primary-channel cursor's `offset` indexes into that flat list; only the page sliced
   from it is partitioned into `governing`/`activeProposals`/`history` for the response
   (FR-019, data-model.md §6). There is no independent per-bucket cursor.

**Zero matches** (US2 AC7): the same `'matches'` branch, all three arrays empty — not an
error.

## 7. `list_superseded`

**Input**: `ListSupersededInput` (data-model.md §7) — pagination only, no filters
(FR-034's scope is unconditional).

**Resolution** (FR-034, US4):

1. `loadCorpusProjection`.
2. Every record with `status === 'superseded'` becomes a `SupersededEntry`
   (data-model.md §6), in canonical order. The schema's own invariant
   (`superseded-requires-supersededBy`) guarantees `frontmatter.supersededBy` is always
   present on such a record; resolve it with `parseAdrRef` (the same primitive
   `get_decision` uses) followed by a **local-only** lookup:
   - `parsed.log` is **defined** (the target is a log-qualified ref) → unresolved:
     `{ resolved: false, targetRef, reason: 'federated-unavailable', log: parsed.log,
     id: parsed.id }`. One additional, fixed-template `superseded-target-federated
     -unavailable` finding (severity `info`) is minted for this entry — `{ rule:
     'superseded-target-federated-unavailable', severity: 'info', id: <this record's own
     id>, message: 'supersededBy target "<targetRef>" is a log-qualified ref; named-log
     federation is not available in this phase' }`, with `<targetRef>` the only
     interpolated value (itself bounded — an `AdrRef`-shaped string transitively bounded
     by the 64 KiB per-record source cap, data-model.md §3.5) — this phase serves exactly
     one local corpus and never resolves, strips, or substitutes a qualified target
     (FR-021, FR-034). This is a **derived** finding (§2, data-model.md §3.5): it is
     merged into this call's own `responseFindings` alongside `CorpusProjection
     .corpusFindings`, never written back into the shared projection. Note it coexists
     with, and does not replace or suppress, `@adrkit/core`'s own unmodified
     `dangling-supersededBy` finding for the same field, already present in
     `corpusFindings` — that check has no concept of a `log:` qualifier either
     (contracts/core-projection.md §2) and will already have flagged the same raw string
     as a plain dangling reference; both findings are legitimate and both remain present.
   - `parsed.log` is **undefined** → look up `byId.get(parsed.id)`:
     - Bucket length 1 → `{ resolved: true, target: DecisionSummary }` of the resolved
       record (id, title, **current** status — not assumed to still be `accepted`; a
       target can itself have moved on, e.g. to `deprecated`, and this tool reports its
       live status).
     - Bucket absent/empty → unresolved: `{ resolved: false, targetRef, reason:
       'dangling' }` — a target that should have failed corpus validation upstream;
       `@adrkit/core`'s own existing `dangling-supersededBy` finding is already present
       in `CorpusProjection.corpusFindings` (no duplicate finding is minted here), never
       fabricated, never silently dropped from the listing (US4 AC3).
     - Bucket length \>1 → unresolved: `{ resolved: false, targetRef, reason:
       'ambiguous', candidateCount: number }` — **not** an embedded `candidates[]` array
       (FR-034). One additional, fixed-template, compact `superseded-target-ambiguous`
       finding (severity `warn`) is minted for this entry — `{ rule:
       'superseded-target-ambiguous', severity: 'warn', id: <this record's own id>,
       message: 'supersededBy target "<targetRef>" resolves to <candidateCount> local
       records; see get_decision("<targetRef>") for the full candidate list' }`, naming
       the target id and the count, never enumerating every candidate's path/title
       inline — a candidate is never picked silently, this bucket length can only exceed
       1 when the corpus already has a `unique-id` error finding for that id, and the
       **complete** candidate list remains obtainable, already paginated, via a separate
       `get_decision(targetRef)` call, which resolves that same bucket as its own
       `ambiguous-local-id` outcome (§4) — this design deliberately reuses that existing,
       already-bounded channel rather than nesting a second, unbounded list inside one
       page item of this tool's own response. This finding, too, is a **derived** finding
       merged into `responseFindings`, never written back into `CorpusProjection`.
3. This tool reports **direct edges only** — it never walks `target.supersedes` further
   to build a transitive chain (FR-034, explicitly Out of Scope).

**No superseded records** (US4 AC2): the same `'entries'` branch, `items: []` — not an
error.

## 8. Fixed limits

| Limit | Value | Enforced by |
|---|---|---|
| `query` length | 1–256 raw UTF-16 code units; non-empty after `trim()` | `search_decisions` input schema |
| `status[]` count | 1–6 unique entries when present, omitted entirely = all six | `search_decisions` input schema; any-of semantics (§5) |
| `scope[]` count | 1–3 unique entries when present | `search_decisions` input schema; any-of semantics (§5) |
| `tags[]` count | 1–32 unique entries when present | `search_decisions` input schema; all-of semantics (§5) |
| `tags[i]` length | 1–64 chars | `search_decisions` input schema |
| path length (`files[i]`) | 1–1024 chars | `get_decision_context` input schema (`.refine()`); rejects a leading `/`, a `..` segment, a drive letter, and **any backslash**, not only a Windows-style absolute path — the contract is POSIX separators only (§6) |
| `files[]` count | 1–256 | `get_decision_context` input schema |
| `ref` length | 1–128 chars | `get_decision` input schema |
| result page size | default 20, max 100 | every tool's `limit` input field |
| findings page size | default 20, max 100 | every tool's `findingsLimit` input field |
| cursor `offset` | positive safe integer (`>= 1`); rejected if `>= channel.length` on recomputation | contracts/pagination-and-cursors.md §2 |
| ADR source max | 64 KiB | the pre-read guard (data-model.md §3.3); excluded records surface `record-too-large` (severity `error`), never truncated. This one cap bounds a record's entire source-derived footprint — frontmatter and body together — so it transitively bounds every summary field, full-document field, and finding-message field derived from that record (data-model.md §3.5); it is not a second, separate byte budget from pagination, which bounds item counts only. |
| cursor max | 4 KiB | every `cursor`/`findingsCursor` input field |

Every input object is a **strict** Zod object — an unknown or extra field is rejected
before any corpus access, for every tool, with no exception. Rationale for each value is
in [../research.md](../research.md) §R11; none was adjusted from the binding design
direction's own starting point for the limits it specified (the `tags[]` count/length
limits are new in this pass, closing a gap an earlier draft left unbounded).

## 9. Startup behavior (FR-035, FR-036)

`src/bin.ts`'s `main()`, before ever constructing a server or connecting a transport:

1. Resolves `cwd`/`dir` from `--cwd`/`--dir` flags, falling back to
   `ADRKIT_MCP_CWD`/`ADRKIT_MCP_DIR` env vars, falling back to `process.cwd()`/
   `'docs/adr'` (research §R7).
2. Canonicalizes `cwd` with `fs.realpath` and checks the **canonical** path is a
   readable directory that contains a readable `.git` entry directly beneath it — a
   directory (an ordinary clone) or a file (a linked worktree's `.git` pointer file; its
   contents are never parsed, only its existence and readability checked) — via
   `fs.access`/`fs.stat`, with **no `git` executable invocation of any kind** (research
   §R7). Any failure here means `cwd` is not the configured repository root this server
   requires; the resulting `canonicalCwd` is held for the remaining lifetime of this
   process (data-model.md §8).
3. Resolves `dir` against `canonicalCwd`, canonicalizes it with `fs.realpath`, and
   checks the **canonical** `dir` is a readable directory that is path-segment-safely
   contained within `canonicalCwd` (`path.relative(canonicalCwd, canonicalDir)` is empty
   or does not begin with a `..` segment — never a plain string-prefix test). An absolute
   `--dir` that does not fall under `cwd`, a `--dir` that escapes `cwd` via a `..`
   traversal segment, and a `--dir` that is or resolves through a **symlink** landing
   outside `cwd` all fail this check identically to a missing directory — realpath-based
   containment closes the symlink case a purely lexical check cannot (research §R7).
4. Any failure in steps 2–3 prints an actionable, specific message to **`stderr`**
   (never `stdout` — FR-007), naming the precise `CorpusUnavailableOutcome`-shaped reason
   (data-model.md §5) that failed, and exits **`1`**. An unparseable/unknown flag exits
   **`2`**, mirroring `@adrkit/cli`'s own `usage()` exit-code convention.
5. Only on success does it call `createAdrkitMcpServer({ cwd: canonicalCwd, dir })` and
   invoke the handle's zero-argument `start()`. Neither the bin nor any public caller can
   supply a transport.

This eager, once-only check is a fail-fast **startup UX nicety**, not the only line of
defense: it is distinct from, and does not replace, the per-call
`CorpusUnavailableOutcome` (data-model.md §5) branch every tool can still return if an
observable root, ADR-directory, or candidate condition changes after startup. That later
failure is a normal tool-call outcome, not a process exit, because the server is already
connected and mid-session. `loadCorpusProjection` re-realpaths the configured root fresh
on **every** call, verifies it still equals the startup `canonicalCwd`, and rechecks its
readable `.git`; it then re-realpaths the configured `dir`, validates segment-safe
containment/readability, and repeats both root and directory checks after the core load.
Each discovered candidate is also `lstat`-checked as a non-symlink regular file,
realpath-contained, and bigint-`stat` checked before the core load; candidate
type/realpath and `dev`/`ino`/`size`/nanosecond-`mtime` are checked again afterward. Any
observed change discards the complete provisional projection as
`corpus-changed-during-load` without returning changed-path data.

These portable Node `>=22` checks are consistency checkpoints, not an atomic
open-beneath/no-follow guarantee. They do not claim to detect a hostile swap that occurs
and reverts entirely between checkpoints while the path-based core read is in progress.

## 10. Non-goals (contract boundaries)

- No fifth tool, no write/mutation/PR-creation tool (FR-001, FR-002).
- No `registerResource`, `registerPrompt`, subscription, or sampling call (FR-003).
- No model call, embedding, or ranking of any kind (FR-004).
- No HTTP/SSE transport, no authentication (FR-005, FR-006).
- No named-log or multi-repository federation. A log-qualified `ref`/`supersededBy`
  target is recognized only far enough to answer `federated-log-unavailable`
  (`get_decision`) or an unresolved, informational entry (`list_superseded`) — never
  resolved, stripped, or substituted (FR-021, FR-022, FR-034).
- No persistent cache, index, or database across calls (FR-010).
- No transitive supersession walk (`list_superseded` is direct edges only — §7).
- No expansion of `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith` refs into
  fetched records by `get_decision_context` (FR-033) — they are surfaced, never walked.

### 10.1 Exact side-effect-denial inventory

The conformance harness MUST deny the following JavaScript-level entry points. For Node
filesystem methods, callback, sync, and `node:fs/promises` forms are included where the
runtime provides them:

- filesystem content/mutation: `write`, `writev`, `writeFile`, `appendFile`,
  `createWriteStream`, `truncate`, `ftruncate`, `rename`, `copyFile`, `cp`, `unlink`,
  `rm`, `rmdir`, `mkdir`, `mkdtemp`, `link`, `symlink`, `chmod`, `fchmod`, `lchmod`,
  `chown`, `fchown`, `lchown`, `utimes`, `futimes`, and `lutimes`;
- write-capable open: `open`, `openSync`, and `promises.open` whenever numeric or string
  flags permit write, append, create, truncate, or update;
- returned `FileHandle`: `write`, `writev`, `writeFile`, `appendFile`, `truncate`,
  `createWriteStream`, `chmod`, `chown`, `utimes`, `sync`, and `datasync`;
- process/runtime escape: all sync and async `node:child_process`
  spawn/exec/execFile/fork forms, `cluster.fork`, `new worker_threads.Worker`, and
  `process.dlopen`;
- network/listen: global `fetch` plus net/http/https/dgram
  connect/request/get/socket/listen entry points;
- Bun: `Bun.write`, `Bun.file(...).writer()`, `Bun.file(...).delete()`, `Bun.spawn`,
  `Bun.spawnSync`, and Bun shell imports/member use (statically rejected where no reliable
  runtime patch point exists).

Coverage fixtures MUST exercise static and dynamic imports, destructured aliases,
pre-captured references, numeric/string open flags, and returned FileHandles before the
real startup/four-tool run. Passing is bounded executed-path evidence only; it does not
prove the absence of raw native syscalls or future unenumerated runtime APIs. Complete
disposable-sandbox, parent-sentinel, `HOME`, and `TMPDIR` snapshots remain a separate
required line of evidence.

## 11. Conformance tests this contract implies (offline only; no model, no network)

- Every one of US1–US5's acceptance scenarios, as fixture cases against the
  package-internal registered-server builder driven through
  `InMemoryTransport.createLinkedPair()` (research §R1.4). The builder is never
  publicly exported.
- A real stdio-subprocess byte-capture test proving zero non-protocol `stdout` bytes
  (research §R8), against both `src/bin.ts` (Bun) and the built `dist/bin.js` (Node
  22/24 smoke — research §R10).
- A side-effect-denial preload harness test (research §R10) proving, as executed-path,
  defense-in-depth evidence — not a formal proof against every conceivable channel —
  that the enumerated network, filesystem-mutation, subprocess, worker, native-addon,
  and Bun-shell entry points are never invoked while the stdio server starts and all
  four tools are each called at least once. The test retains an independent full-sandbox,
  parent-sentinel, `HOME`, and `TMPDIR` snapshot.
- The five adversarial-input fixtures from US5 AC1–AC4 (path traversal, absolute path,
  unknown extra field, oversized `query`/`files[]`), each asserted to produce
  `isError: true` with no filesystem read outside the configured root and no attempted
  network call.
- A duplicate-local-id fixture (two records sharing one `id`, spanning more than one
  page) proving `get_decision`'s `ambiguous-local-id` candidate cursor returns every true
  candidate exactly once, distinguished by `sourcePath`, and never a silently chosen
  record (SC-003).
- A log-qualified-ref fixture proving `get_decision` returns `federated-log-unavailable`
  naming the requested log and id — for both a colliding and a non-colliding id — never a
  local substitute and never the qualifier silently stripped (SC-003).
- A `superseded` record whose `supersededBy` targets an id used by more than one local
  record, proving `list_superseded` reports that entry unresolved with a deterministic,
  fixed-template `superseded-target-ambiguous` finding naming the target id and
  `candidateCount` (never every candidate's path/title inline, and never one picked
  silently), and proving a follow-up `get_decision(targetRef)` call independently returns
  that same bucket as its own paginated `ambiguous-local-id` outcome.
- A `superseded` record whose `supersededBy` is a log-qualified ref, proving
  `list_superseded` reports that entry unresolved as federated-unavailable with an
  informational, fixed-template finding, alongside (not replacing) `@adrkit/core`'s own
  unmodified `dangling-supersededBy` finding for the same field.
- A fixture proving a tool's `findings` channel is `corpusFindings` plus that call's own
  derived findings, never the reverse: two `get_decision_context` calls against the same
  corpus with different `files[]` (one triggering an inert `affects-unresolvable` match,
  one not) produce different `findings` pages while `corpusHealth.fingerprint` stays
  identical across both calls — proving the derived finding is not, and does not need to
  be, part of the hashed corpus projection (data-model.md §3.5).
- A startup fixture with a `--cwd` that is a readable directory but contains no `.git`
  entry, proving the bin exits `1` with an actionable stderr message and never starts a
  transport; a companion fixture with a linked-worktree-style `.git` **file** (not a
  directory) proving startup succeeds; a fixture with an absolute or `..`-escaping
  `--dir` outside the validated `--cwd`, proving the same `1`-exit rejection. A **symlink**
  fixture proving the same rejection when `--dir` is (or resolves through) a symlink that
  lands outside the canonical `--cwd`, even though the raw, uncanonicalized string
  contains no literal `..` — proving containment is checked on the `fs.realpath`'d paths,
  not the lexical input strings (research §R7).
- Deterministic root, directory, and candidate-file swap fixtures injected at every
  explicit validation checkpoint, proving the call returns `corpus-unavailable` and no
  response includes data from an observed changed path. The test explicitly does not
  claim universal atomic protection against an unscheduled transient swap between
  checkpoints.
- A fixture where the pre-read size guard (data-model.md §3.3) excludes **every**
  discovered candidate file (e.g. a one-file corpus whose only file is oversized),
  proving the implementation does not call `lintCorpus({ paths: [] })` — which would
  silently re-discover and re-include the excluded file — and instead returns zero
  records with only the guard's own, `error`-severity finding present.
- A fixture proving both `record-stat-error` and `record-too-large` are severity
  `error` (not `warn`), and that the call carrying either still succeeds with every
  other, valid record usable — severity communicates "the corpus has a real gap," not
  "this call failed."
- Cursor round-trip fixtures: mint → decode on the next call → identical page; each of
  the seven `InvalidCursorOutcome` reasons independently triggered — `decode-failed`
  (tampered payload), `version-unsupported` (future `v`), `wrong-channel` (wrong-field/
  wrong-tool scope), `corpus-changed` (mutated corpus), `query-mismatch` (changed query
  parameter), `cursor-not-applicable` (a primary `cursor` supplied against a
  `get_decision` call that resolves to `found`/`not-found`/`federated-log-unavailable`
  this time), and `offset-out-of-range` (a hand-constructed or truncated-then-replayed
  cursor whose `offset` is at or past the freshly recomputed channel's length).
- A whitespace-only `query` fixture (e.g. `"   "`) proving `search_decisions` rejects it
  as an input-contract error before any corpus access, rather than normalizing it to an
  empty-string query that would otherwise match every record (research §R5).
- A `tags[]` fixture at the 32-entry/64-char boundary proving the limit is enforced by
  the input schema, and a fixture proving `tags` filtering is all-of (a record with only
  some of the listed tags does not match) while `status`/`scope` filtering is any-of (a
  record matches if its own single value is any one of the listed values), and that all
  three categories are ANDed together.
- A `files[]` entry containing a backslash (e.g. `docs\adr\0001.md`, with no leading `/`
  and no `..` segment) proving it is rejected identically to an absolute or
  drive-qualified path — the contract is POSIX separators only, not merely "no Windows
  drive letter."
- A fixture proving two repeated calls with an unchanged corpus produce a byte-identical
  fingerprint, and a fixture proving a frontmatter re-serialization that changes only
  YAML byte layout (key order, quoting) without changing the parsed result leaves the
  fingerprint unchanged, while any change to a record's `body` changes it (research §R6).
- A schema-invalid record fixture proving `search_decisions`/`get_decision_context`
  still answer correctly for every other record, with the invalid one surfaced only as a
  finding (SC-009); a companion fixture proving a corpus-invariant finding (`unique-id`,
  a dangling reference) never removes the flagged record from any tool's results — only
  the finding is added, the record itself remains fully present and retrievable
  (data-model.md §3.3).
- An oversized-source fixture proving `record-too-large` exclusion end to end
  (SC-001), including that `get_decision` on that exact id reports `not-found` with the
  finding present, not a partial body.
