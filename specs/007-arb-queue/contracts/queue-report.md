# Contract: QueueReport v1 — JSON and Markdown Canonical Formats

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md) | **Date**: 2026-07-20

This contract defines the canonical serialization of the `QueueReport` v1 type in
both JSON and Markdown formats. It is the normative reference for all serialization
logic in `packages/core/src/queue/format.ts`, shared byte-for-byte by the CLI and
Action, and for consumers of the `QueueReport` JSON.

---

## Part I — TypeScript Type Definitions

The following types constitute the complete `QueueReport` v1 type surface.
They are normative; the data-model document provides derivation context.

```typescript
/** The seven SLA states. See data-model.md §1 for precedence rule. */
type SlaState =
  | "decided"
  | "escalated"
  | "overdue"
  | "due"
  | "within-sla"
  | "missing-sla"
  | "not-queued";

/** A finding attached to a specific QueueItem. Always info or warn severity. */
interface ItemFinding {
  code: string;
  severity: "info" | "warn";
  message: string;
}

/** A finding for a file that could not be projected into a QueueItem. Always error severity. */
interface CorpusFinding {
  sourcePath: string;
  code: string;
  severity: "error";
  message: string;
}

/** A single ADR record projected into the queue. */
interface QueueItem {
  id: string;
  title: string;
  sourcePath: string;

  tier: "auto" | "async" | "arb" | null;
  tierLabel:
    | "expedited routing; human acceptance required"
    | "asynchronous human review"
    | "ARB human review"
    | null;

  queuedAt: string | null;      // UTC ISO datetime string, e.g. "2026-01-01T00:00:00.000Z"
  slaDays: number | null;
  reviewBy: string | null;      // "YYYY-MM-DD" or null (IsoDate only; never a datetime)

  slaState: SlaState;
  deadlineDate: string | null;  // "YYYY-MM-DD" computed, or null

  routingTargets: string[];
  quorum: number | null;

  approvalCount: number;
  unresolvedObjectionCount: number;
  resolvedObjectionCount: number;

  escalatedAt: string | null;   // UTC ISO datetime string or null
  decidedAt: string | null;     // UTC ISO datetime string or null

  itemFindings: ItemFinding[];
}

/** The top-level queue report. version is always the string "1". */
interface QueueReport {
  version: "1";
  asOf: string;                 // "YYYY-MM-DD" UTC calendar date
  corpusFingerprint: string;    // lowercase hex SHA-256, 64 chars
  totalItems: number;
  totalCorpusFindings: number;
  itemsWithFindings: number;
  items: QueueItem[];
  corpusFindings: CorpusFinding[];
}
```

---

## Part II — JSON Serialization

### Method

```typescript
const output: string = JSON.stringify(report, null, 2) + "\n";
```

- **Indentation**: 2 spaces per level.
- **Final newline**: exactly one `\n` after the closing `}`.
- **No trailing whitespace** on any line.
- **`undefined` fields**: omitted by `JSON.stringify` semantics. However, all
  fields declared in the TypeScript interfaces above are always present
  (either with their value or with `null`). No field is intentionally `undefined`.
- **`null` fields**: included verbatim as `null` in the JSON output.
- **Number fields**: plain JSON numbers (not quoted). `slaDays`, `quorum`,
  `approvalCount`, `unresolvedObjectionCount`, `resolvedObjectionCount`,
  `totalItems`, `totalCorpusFindings`, `itemsWithFindings` are integers.
- **String fields**: standard JSON string encoding; no manual escaping needed
  beyond `JSON.stringify`.
- **`version` field value**: the string `"1"` — NOT the number `1`.

### Key ordering

The report object MUST be constructed with keys in the order declared in the interfaces
above. Supported JavaScript runtimes serialize these non-integer string keys in insertion
order, so the construction order is part of the v1 contract. No additional key sorting is
applied to the JSON output itself (only to the fingerprint canonical projection — see
data-model.md §8).

### Example (minimal valid)

```json
{
  "version": "1",
  "asOf": "2026-01-08",
  "corpusFingerprint": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "totalItems": 1,
  "totalCorpusFindings": 0,
  "itemsWithFindings": 0,
  "items": [
    {
      "id": "0007",
      "title": "Introduce ARB operations queue",
      "sourcePath": "docs/adr/0007-arb-queue.md",
      "tier": "arb",
      "tierLabel": "ARB human review",
      "queuedAt": "2026-01-01T00:00:00.000Z",
      "slaDays": 14,
      "reviewBy": null,
      "slaState": "within-sla",
      "deadlineDate": "2026-01-15",
      "routingTargets": ["alice", "bob"],
      "quorum": 2,
      "approvalCount": 0,
      "unresolvedObjectionCount": 0,
      "resolvedObjectionCount": 0,
      "escalatedAt": null,
      "decidedAt": null,
      "itemFindings": []
    }
  ],
  "corpusFindings": []
}
```

---

## Part III — Corpus Fingerprint

The `corpusFingerprint` is a lowercase hex-encoded SHA-256 string (64 characters).
Defined fully in [data-model.md §8](../data-model.md); summarized here:

**Projection** (input to SHA-256):
```
canonicalStringify({
  records: sortByIdThenPath(lintResult.records).map(r => ({ sourcePath: r.path, frontmatter: r.frontmatter, body: r.body })),
  corpusFindings: sortedRawFindings,  // sortFindingsCanonical(lintResult.findings);
                                       // original core Finding[], NOT queue CorpusFinding[]
  corpusHealth: { recordCount: lintResult.records.length, excludedCount: lintResult.checked - lintResult.records.length }
})
```
where the second field is the **original core `Finding[]`** from `lintCorpus()` — all
findings including both excluded-file error findings AND schema-valid record warn/info
findings. It is NOT the queue-mapped `CorpusFinding[]`. This matches the signature of
`fingerprintOf` in `packages/mcp/src/corpus/projection.ts` (line 188) exactly.

**`canonicalStringify`**: keys sorted at every nesting level by code-unit order;
no whitespace; UTF-8 encoded. Identical to the implementation in
`packages/core/src/fingerprint/index.ts` (promoted from `@adrkit/mcp`).

---

## Part IV — Markdown Canonical Layout

The Markdown format is the default output of `adr queue`. It must be stable
(deterministic for identical inputs), readable in plain text and rendered Markdown,
and **complete** — every field of `QueueReport`, `QueueItem`, `ItemFinding`, and
`CorpusFinding` has a visual representation.

The implementation lives in `packages/core/src/queue/format.ts`
(`formatQueueReportMarkdown`), consumed by both the CLI and the Action.

### Structure

```markdown
# ARB Queue — {asOf}

Corpus fingerprint: `{full 64-char hex fingerprint}`
{totalItems} item(s) | {totalCorpusFindings} corpus finding(s) | {itemsWithFindings} item(s) with findings

## Corpus Findings

{corpus findings table, or omitted if empty}

## Queue Items

{queue items overview table, or empty state text}

{per-item detail sections, only for items with findings or non-null optional fields}
```

### Title and Metadata Block

```markdown
# ARB Queue — 2026-01-08

Corpus fingerprint: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
3 item(s) | 0 corpus finding(s) | 1 item(s) with findings
```

- `asOf` is the UTC calendar date from `QueueReport.asOf`.
- Fingerprint is the full 64-character lowercase hex string — never truncated.
- All three counts are on the second line.

### Corpus Findings Section

If `corpusFindings.length > 0`, include:

```markdown
## Corpus Findings

| Source Path | Code | Severity | Message |
|-------------|------|----------|---------|
| `docs/adr/0005-bad.md` | `corpus.schema-invalid` | error | Missing required field: id |
```

- One row per `CorpusFinding`, in the sort order from data-model.md §6.
- `sourcePath` wrapped in backticks.
- `code` wrapped in backticks.
- `severity` verbatim (always `error` for CorpusFindings).
- Cell values escaped per §Escaping Rules below.

If `corpusFindings.length === 0`, the `## Corpus Findings` section is omitted entirely.

### Queue Items Overview Table

Always included, even if empty.

```markdown
## Queue Items

| # | ID | Title | Tier | SLA State | Deadline | Approvals | Objections |
|---|----|-------|------|-----------|----------|-----------|------------|
| 1 | `0007` | Introduce ARB queue | arb (ARB human review) | overdue | 2026-01-01 | 0/2 | 0 |
| 2 | `0006` | Integrate MCP server | async (asynchronous human review) | within-sla | 2026-02-01 | 1/1 | 0 |
```

**Column definitions**:

| Column | Value |
|--------|-------|
| `#` | 1-based integer rank (row number in the output table) |
| ID | `id` wrapped in backticks |
| Title | `title`; pipe-escaped |
| Tier | `tier` plus `tierLabel` as `{tier} ({tierLabel})`, or `(none)` if `tier` is null |
| SLA State | `slaState` as plain ASCII (no emoji) |
| Deadline | `deadlineDate` value or `-` if `null` |
| Approvals | `approvalCount`/`quorum` or `approvalCount/-` if `quorum` is null |
| Objections | `unresolvedObjectionCount` unresolved (plus `resolvedObjectionCount` resolved in parens if `resolvedObjectionCount > 0`, e.g. `0` or `2 (1 resolved)`) |

**If `items` is empty**:

```markdown
## Queue Items

*No proposed records found.*
```

### Per-Item Detail Sections

After the overview table, one detail section per `QueueItem`. Each section exposes
all fields not visible in the overview table. Sections are ordered to match the
overview table row order (urgency-sorted).

The heading title is normalized to one line before interpolation: normalize CRLF to
LF, replace every remaining CR or LF with one space, and leave all other characters
unchanged. This prevents a schema-valid multiline title from injecting headings or
tables into the canonical report structure.

```markdown
### 0007 — Introduce ARB queue

| Field | Value |
|-------|-------|
| Source | `docs/adr/0007-arb-queue.md` |
| Tier | arb |
| Tier Label | ARB human review |
| SLA State | overdue |
| Queued At | 2026-01-01T00:00:00.000Z |
| SLA Days | 14 |
| Review By | - |
| Deadline | 2026-01-15 |
| Routing Targets | alice, bob |
| Quorum | 2 |
| Approvals | 0 |
| Unresolved Objections | 0 |
| Resolved Objections | 0 |
| Escalated At | - |
| Decided At | - |

#### Findings

- `item.tier-absent` (info): review.tier is absent; routing tier cannot be determined — add review.tier: auto\|async\|arb to this record
```

**Field rendering**:

| QueueItem field | Rendered as |
|----------------|-------------|
| `sourcePath` | backtick-wrapped |
| `tier` | value or `(none)` if null |
| `tierLabel` | derived label from FR-016, or `-` if null |
| `slaState` | plain ASCII value |
| `queuedAt` | full ISO datetime string, or `-` if null |
| `slaDays` | integer, or `-` if null |
| `reviewBy` | value (YYYY-MM-DD), or `-` if null |
| `deadlineDate` | value, or `-` if null |
| `routingTargets` | joined with `, `, or `-` if empty |
| `quorum` | integer, or `-` if null |
| `approvalCount` | integer |
| `unresolvedObjectionCount` | integer |
| `resolvedObjectionCount` | integer |
| `escalatedAt` | full ISO datetime string, or `-` if null |
| `decidedAt` | full ISO datetime string, or `-` if null |

The `#### Findings` subsection is included only if `itemFindings.length > 0`.
Each finding is one bullet: `` `{code}` ({severity}): {message} ``.

If an item has no findings, the detail section still appears (to expose all field
values) but the `#### Findings` subsection is omitted.

### Final Newline

The Markdown output must end with exactly one `\n` after the last non-empty line.

### Escaping Rules

| Character | Context | Escaped as |
|-----------|---------|-----------|
| `\|` | Table cell value | `\|` |
| `` ` `` | Table cell value | `` \` `` |
| `\` | Table cell value | `\\` |
| CR (`\r`) | Table cell value | ` ` (replaced with a single space) |
| LF (`\n`) | Table cell value | `<br>` |
| CRLF (`\r\n`) | Table cell value | `<br>` (normalize to single `<br>`) |
| All other characters | Table cell value | as-is |
| `\|` | Bullet list text (item findings message) | `\|` |
| All other characters | Bullet list text | as-is |

Escaping is applied in this order: normalize CRLF to LF, replace remaining CR with one
space, replace LF with `<br>`, escape backslashes, then escape pipe and backtick
characters. This order prevents newly introduced escape backslashes from being escaped
again.

No HTML encoding is applied beyond the `<br>` substitution above. The output is
standard CommonMark-compatible Markdown.

### Empty State Summary

| Condition | Behavior |
|-----------|----------|
| `corpusFindings.length === 0` | `## Corpus Findings` section omitted entirely |
| `items.length === 0` | Overview table replaced with `*No proposed records found.*`; no detail sections |
| Item has `itemFindings.length === 0` | Detail section appears (all field values), `#### Findings` omitted |
| All items have `itemFindings.length === 0` | No `#### Findings` subsections anywhere; detail sections still present |
