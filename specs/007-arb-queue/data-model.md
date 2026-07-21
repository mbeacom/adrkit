# Data Model: ARB Operations Queue — Phase 6

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-20

This document defines all entities, fields, types, relationships, and
algorithms that the queue kernel and its consumers depend on. It is the
normative reference for `packages/core/src/queue/types.ts`.

---

## 1. SlaState — Enumeration

The `SlaState` enumeration is a closed set of seven values. Each `QueueItem`
carries exactly one `slaState`.

| Value | Urgency Rank | When Applied |
|-------|-------------|--------------|
| `decided` | 6 (lowest urgency) | `review.decidedAt` is present |
| `escalated` | 1 | `review.escalatedAt` is present AND `decidedAt` is absent |
| `overdue` | 0 (highest urgency) | `deadlineDate` is computable AND `asOfDate > deadlineDate` AND `decidedAt` absent AND `escalatedAt` absent |
| `due` | 2 | `deadlineDate` is computable AND `asOfDate === deadlineDate` AND `decidedAt` absent AND `escalatedAt` absent |
| `within-sla` | 3 | `deadlineDate` is computable AND `asOfDate < deadlineDate` AND `decidedAt` absent AND `escalatedAt` absent |
| `missing-sla` | 4 | `queuedAt` is present AND `deadlineDate` is NOT computable AND `decidedAt` absent AND `escalatedAt` absent |
| `not-queued` | 5 | `review.queuedAt` is absent (or `review` block entirely absent) |

**Precedence rule** (FR-005): Checked in strict priority order. The first
matching condition is applied:

```
IF decidedAt present → decided
ELSE IF escalatedAt present → escalated
ELSE IF deadlineDate computable:
    IF asOf > deadlineDate → overdue
    ELSE IF asOf = deadlineDate → due
    ELSE → within-sla
ELSE IF queuedAt present → missing-sla
ELSE → not-queued
```

All date comparisons are UTC calendar date comparisons (`"YYYY-MM-DD"` string
comparison, code-unit order). `asOf` is the caller-supplied UTC calendar date.

---

## 2. Deadline Computation Algorithm

The `deadlineDate` for a QueueItem is computed as follows:

```
function computeDeadlineDate(record: Adr, asOf: string): string | null {
  // Priority 1: explicit reviewBy field (from top-level frontmatter)
  if record.frontmatter.reviewBy is present:
    return record.frontmatter.reviewBy
    // reviewBy is schema-valid IsoDate (YYYY-MM-DD), never a datetime

  // Priority 2: queuedAt + slaDays
  if record.frontmatter.review?.queuedAt is present
  AND record.frontmatter.review?.slaDays is present:
    queuedDate = toUTCCalendarDate(record.frontmatter.review.queuedAt)
    return addCalendarDays(queuedDate, record.frontmatter.review.slaDays)
    // addCalendarDays: add slaDays calendar days to queuedDate in UTC

  // No deadline computable
  return null
}
```

**`reviewBy` takes precedence over `slaDays`**: When both `reviewBy` and
`review.slaDays` are present, `reviewBy` wins for the deadline date.
`slaDays` is still included in the `QueueItem.slaDays` output field for
informational purposes.

**`slaDays: 0`**: deadline equals `queuedAt` UTC calendar date. On that day
the item is `due`; on the following UTC calendar day it is `overdue`.

**`reviewBy` date extraction**: `reviewBy` is always a bare `YYYY-MM-DD`
(IsoDate format). The schema validates it as `IsoDate`; it is NOT a datetime
field and never contains a timezone offset. Use the value directly as the
UTC calendar date without any conversion.

---

## 3. Timestamp Normalization Rule

All datetime fields stored in ADR frontmatter (`review.queuedAt`,
`review.escalatedAt`, `review.decidedAt`) may use any valid ISO 8601 datetime
string (the Zod schema accepts any valid ISO string). For queue purposes, ALL
datetime values are normalized to UTC instants before comparison.

**Normalization**: `new Date(storedValue).toISOString()` — produces
`"YYYY-MM-DDTHH:mm:ss.sssZ"`.

**Calendar date extraction**: `normalizedInstant.slice(0, 10)` — produces
`"YYYY-MM-DD"` in UTC.

**`--as-of` CLI flag**: If the caller passes a bare `YYYY-MM-DD`, it is used
as the UTC calendar date directly. If the caller passes a full ISO datetime
string (e.g. `2026-01-08T01:00:00+05:00`), it is normalized to UTC and the
date portion extracted (`2026-01-07`).

---

## 4. QueueItem — Entity

One `QueueItem` per `proposed`-status ADR record that passes schema validation
(i.e., appears in `lintCorpus().records`).

```typescript
interface QueueItem {
  // Identity
  id: string;          // from Adr.frontmatter.id; e.g. "0007"
  title: string;       // from Adr.frontmatter.title
  sourcePath: string;  // repo-relative path, forward slashes, from Adr.path

  // Tier
  tier: "auto" | "async" | "arb" | null;
  // from Adr.frontmatter.review?.tier; null if absent

  tierLabel:
    | "expedited routing; human acceptance required"
    | "asynchronous human review"
    | "ARB human review"
    | null;
  // deterministic label derived from tier; null when tier is absent

  // Queue timing
  queuedAt: string | null;
  // UTC ISO string (normalized from review.queuedAt) or null

  // SLA
  slaDays: number | null;
  // from Adr.frontmatter.review?.slaDays; null if absent

  reviewBy: string | null;
  // UTC calendar date "YYYY-MM-DD" (normalized from top-level reviewBy) or null

  // Computed SLA state and deadline
  slaState: SlaState;
  deadlineDate: string | null;
  // Computed per algorithm in §2; "YYYY-MM-DD" or null

  // Routing
  routingTargets: string[];
  // from Adr.frontmatter.deciders; empty array if absent or empty

  quorum: number | null;
  // from Adr.frontmatter.review?.quorum; null if absent

  // Decision tracking
  approvalCount: number;
  // from Adr.frontmatter.review?.approvals?.length ?? 0
  // (approvals array length; normalized to 0 if absent)

  unresolvedObjectionCount: number;
  // count of Adr.frontmatter.review?.objections entries where resolved !== true

  resolvedObjectionCount: number;
  // count of Adr.frontmatter.review?.objections entries where resolved === true

  escalatedAt: string | null;
  // UTC ISO string (normalized from review.escalatedAt) or null

  decidedAt: string | null;
  // UTC ISO string (normalized from review.decidedAt) or null

  // Per-item findings (queue incompleteness/inconsistency codes)
  itemFindings: ItemFinding[];
}
```

**Field notes**:
- `sourcePath` uses forward slashes on all platforms (normalize with
  `path.posix` or `.replace(/\\/g, '/')`).
- `tier` is `null` (not `undefined`) when absent — JSON serialization must
  include the field as `null`.
- `tierLabel` is derived only from `tier` using FR-016's closed mapping and is `null`
  when `tier` is absent. In particular, `auto` always renders as
  `expedited routing; human acceptance required`.
- `queuedAt`, `reviewBy`, `escalatedAt`, `decidedAt`, `deadlineDate` all use
  `null` (not `undefined`) when absent.
- `approvalCount`, `unresolvedObjectionCount`, `resolvedObjectionCount` default
  to `0` when the corresponding field is absent from frontmatter.
- `routingTargets` is an empty array (not null) when `deciders` is absent.

---

## 5. ItemFinding — Entity

One or more `ItemFinding`s may be attached to a `QueueItem` that has
incompleteness or inconsistency.

```typescript
interface ItemFinding {
  code: string;        // from closed list: item.tier-absent, item.review-by-before-queued, item.deciders-empty
  severity: "info" | "warn";  // never "error" for ItemFindings
  message: string;     // human-readable; exact templates in research.md §R2
}
```

**Closed codes**: see [research.md §R2](./research.md) for generation conditions,
exact message templates, and severity rationale.

**Sorting**: within a QueueItem, `itemFindings` are sorted by:
`code` (code-unit) → severity rank (`error=0, warn=1, info=2`) → `message` (code-unit).

---

## 6. CorpusFinding — Entity

One `CorpusFinding` per error-severity finding from `lintCorpus()` for any file
that could not be parsed into a valid, queue-processable `Adr` record (or any
file that failed cross-field invariant validation).

```typescript
interface CorpusFinding {
  sourcePath: string;  // repo-relative, forward slashes
  code: string;        // from closed list: corpus.read-error, corpus.parse-error,
                       //   corpus.schema-invalid, corpus.one-way-door-auto-tier
  severity: "error";   // always "error"; corpus findings are always blocking
  message: string;     // human-readable; see research.md §R2
}
```

**Mapping from core `Finding.rule` to `CorpusFinding.code`**:

| Core `Finding.rule` | `CorpusFinding.code` |
|---------------------|----------------------|
| `file-read` | `corpus.read-error` |
| `frontmatter-parse` | `corpus.parse-error` |
| `frontmatter-fence` | `corpus.parse-error` |
| `one-way-door-disallows-auto` | `corpus.one-way-door-auto-tier` |
| `required-field` | `corpus.schema-invalid` |
| `invalid-type` | `corpus.schema-invalid` |
| `invalid-enum-value` | `corpus.schema-invalid` |
| `invalid-format` | `corpus.schema-invalid` |
| `invalid-size` | `corpus.schema-invalid` |
| `strict-unknown-key` | `corpus.schema-invalid` |
| `unique-items` | `corpus.schema-invalid` |
| `contract-refinement` | `corpus.schema-invalid` |
| `superseded-requires-supersededBy` | `corpus.schema-invalid` |
| `supersededBy-requires-superseded-status` | `corpus.schema-invalid` |
| `accepted-requires-decider-unless-imported` | `corpus.schema-invalid` |
| `agent-accepted-requires-ratifier` | `corpus.schema-invalid` |
| *(any unknown future rule)* | `corpus.schema-invalid` (fallback) |

**Scope**: only files that are excluded from `lintCorpus().records` (i.e., files
whose `Adr.path` does NOT appear in `records`) are projected into CorpusFindings.
Schema-valid `records` that have lint findings (warn/info severity) are NOT added
to `corpusFindings` — their lint findings are ignored by the queue (the queue
focuses on queue-specific item findings, not general lint).

**Sorting**: `sourcePath` (code-unit) → `code` (code-unit) → severity rank → `message` (code-unit).

---

## 7. QueueReport — Entity

The top-level output of the queue kernel. One QueueReport per invocation.

```typescript
interface QueueReport {
  version: "1";                 // literal string "1"; never a number
  asOf: string;                 // "YYYY-MM-DD" UTC calendar date (caller-supplied)
  corpusFingerprint: string;    // lowercase hex SHA-256, 64 chars; see §8
  totalItems: number;           // items.length
  totalCorpusFindings: number;  // corpusFindings.length
  itemsWithFindings: number;    // count of items where itemFindings.length > 0
  items: QueueItem[];           // ordered per research.md §R6
  corpusFindings: CorpusFinding[];  // ordered per research.md §R6
}
```

**`version`**: `"1"` is the first and current report version. The integer will
increment (as a string literal) if the shape changes incompatibly in a future
version. Consumers should check `version === "1"` before parsing.

---

## 8. Corpus Fingerprint Algorithm

The `corpusFingerprint` is a lowercase hex-encoded SHA-256 of a canonical JSON
projection of the corpus state. It enables detection of corpus changes between
runs.

**Projection**:

```typescript
const projection = {
  records: sortedRecords.map(r => ({
    sourcePath: r.path,
    frontmatter: r.frontmatter,  // full AdrFrontmatter object
    body: r.body                 // markdown body string
  })),
  corpusFindings: sortedRawFindings, // canonical ordering of original core Finding[] from lintCorpus()
                                     // NOTE: this is Finding[], NOT the queue-mapped CorpusFinding[]
                                    // It includes ALL findings (error, warn, info) for ALL files —
                                    // both excluded files and schema-valid records with lint findings.
  corpusHealth: {
    recordCount: lintResult.records.length,
    excludedCount: lintResult.checked - lintResult.records.length
  }
}
```

**Finding ordering for fingerprint**: `sortFindingsCanonical(lintResult.findings)` —
canonical sort by `(rule, id, pattern, path, field, message)` using code-unit order.
This sorts ALL findings from lintCorpus, including both excluded-file error findings
AND schema-valid record warn/info findings. The fingerprint therefore reflects any
corpus-level lint issues even for records that remain in `items`.

**Record ordering for fingerprint**: by `(id, sourcePath)` ascending (code-unit)
via `sortByIdThenPath`. This ordering is independent of the QueueReport `items`
sort order; it is used only for fingerprint stability.

**Canonical serialization**: `canonicalStringify(projection)` — a locale-
independent JSON serializer that:
1. Sorts all object keys at every level alphabetically by code-unit order.
2. Serializes arrays in their given order (no sorting of array elements).
3. Produces a compact (no whitespace) JSON string.
4. Encodes to UTF-8.

**SHA-256**: `crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex')`.
Lowercase hex output (Node.js `digest('hex')` default).

**Source**: `fingerprintOf()` function in
`packages/core/src/fingerprint/index.ts` (promoted from `@adrkit/mcp`). Identical
algorithm and output to the existing MCP implementation.

---

## 9. QueueKernelInput — Entry Point Type

The kernel exposes a single pure function:

```typescript
function buildQueueReport(input: QueueKernelInput): QueueReport
```

```typescript
interface QueueKernelInput {
  corpus: LintCorpusResult;  // direct result from lintCorpus(); no pre-processing by caller
  asOf: string;              // "YYYY-MM-DD" UTC calendar date; no ambient clock
}

// LintCorpusResult (from @adrkit/core lintCorpus return type):
// { records: Adr[]; findings: Finding[]; checked: number }
```

**Caller responsibilities**:
- Invoke `lintCorpus()` with the caller-supplied corpus directory and pass the
  result as `corpus`. No pre-mapping, no pre-fingerprinting required.
- Resolve the UTC calendar date for `asOf` (from CLI flag, from Action input, or
  from `new Date().toISOString().slice(0,10)` at the CLI boundary). Do NOT pass
  in a clock function — compute the date before calling the kernel.

**Kernel responsibilities** (all internal — no caller pre-computation required):
- Filter `corpus.records` to only `proposed`-status records.
- Map `corpus.findings` for **excluded files only** to `CorpusFinding[]`.
  (Schema-valid records with warn/info lint findings are NOT in CorpusFindings.)
- Compute `slaState`, `deadlineDate`, all counts, and `itemFindings` for each item.
- Sort items and corpusFindings deterministically.
- Compute `corpusFingerprint` internally:
  `fingerprintOf(sortByIdThenPath(corpus.records), sortFindingsCanonical(corpus.findings), corpus.records.length, corpus.checked - corpus.records.length)`
  — using the **full** `corpus.findings` (all findings, not just excluded-file ones).
- Return the complete `QueueReport`.

**Purity**: The kernel has no access to filesystem, network, or ambient clock.
Node.js `crypto.createHash('sha256')` is deterministic and has no observable
side effects; it is acceptable in the pure kernel.

---

## 10. Entity Relationship Summary

```
QueueReport 1 ─── * QueueItem
QueueReport 1 ─── * CorpusFinding
QueueItem   1 ─── * ItemFinding

QueueReport.asOf             (caller-supplied, UTC calendar date)
QueueReport.corpusFingerprint (computed by kernel from lintCorpus Finding[])
QueueItem ← derived from Adr (proposed status, schema-valid)
CorpusFinding ← derived from Finding (excluded files only; NOT schema-valid record lint findings)
```

An ADR file is one of:
- **Excluded** (unreadable, parse-fail, or schema-invalid) → appears in
  `corpusFindings`, never in `items`; findings included in fingerprint input.
- **Schema-valid non-proposed** → ignored by the queue (not in `items`, not in
  `corpusFindings`); but any lint findings ARE included in fingerprint input.
- **Schema-valid proposed** → appears in `items` as a `QueueItem`; any lint
  findings from core lint are omitted from report findings but included in fingerprint
  input. Only the closed three queue-specific conditions generate `itemFindings`.
