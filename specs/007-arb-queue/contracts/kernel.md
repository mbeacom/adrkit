# Contract: Pure Queue Kernel

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md) | **Date**: 2026-07-20

This contract defines the signature, input/output types, purity constraints, and
caller responsibilities for `buildQueueReport()` — the pure queue kernel function
in `packages/core/src/queue/kernel.ts`. This function is the single computational
entry point for the ARB queue feature.

---

## Function Signature

```typescript
/**
 * Build a deterministic QueueReport from a corpus snapshot and explicit asOf date.
 *
 * Pure function: no ambient clock, no network, no filesystem access.
 * All inputs are caller-supplied. Identical inputs produce identical outputs.
 */
export function buildQueueReport(input: QueueKernelInput): QueueReport;
```

---

## Input Type

```typescript
/**
 * All inputs required by the queue kernel. No defaults; every value is explicit.
 */
export interface QueueKernelInput {
  /**
   * Direct result of lintCorpus() — the full corpus projection.
   * The kernel filters to proposed-status records, maps excluded-file findings
   * to CorpusFinding[], and computes the corpusFingerprint — all internally.
   * No pre-processing by caller is required.
   */
  corpus: LintCorpusResult; // { records: Adr[]; findings: Finding[]; checked: number }

  /**
   * UTC calendar date for SLA state computation.
   * Format: "YYYY-MM-DD". Must be a valid date string. No time component.
   * Caller resolves from CLI flag or current UTC date before calling kernel.
   */
  asOf: string;
}
```

---

## Output Type

`QueueReport` — see [contracts/queue-report.md](./queue-report.md) for the full
TypeScript interface and serialization contracts.

---

## Caller Responsibilities

Before calling `buildQueueReport()`, the caller MUST:

1. **Load corpus**: Call `lintCorpus({ dir })` from `@adrkit/core` to obtain
   the `LintCorpusResult`. Do NOT pass raw filesystem paths to the kernel;
   pass the complete result of `lintCorpus`. No pre-mapping or pre-fingerprinting
   is required.

2. **Resolve `asOf` date**: Compute the UTC calendar date string `"YYYY-MM-DD"`.
   - If a `--as-of` flag is provided: validate and normalize it (see
     [cli-contract.md §As-Of Resolution](./cli-contract.md)).
   - If absent: `new Date().toISOString().slice(0, 10)` at the CLI boundary.
   - Pass the resolved string to the kernel. Do NOT pass `new Date()` or any
     Date object; the kernel accepts only the pre-resolved string.

3. **Validate inputs**: Reject invalid `asOf` strings at the CLI boundary,
   NOT inside the kernel. The kernel assumes `asOf` is a valid `"YYYY-MM-DD"` string.

---

## Kernel Invariants (Purity Assertions)

The kernel:

- ❌ Does NOT call `Date.now()`, zero-argument `new Date()`, or any ambient clock
  function. It MAY use `new Date(callerSuppliedTimestamp)` solely to normalize explicit
  frontmatter timestamp inputs; that operation is deterministic.
- ❌ Does NOT call any filesystem API (`fs.readFile`, `Bun.file`, etc.).
- ❌ Does NOT make any network request.
- ❌ Does NOT import `@actions/core`, `@actions/github`, or any adapter module.
- ❌ Does NOT import `@adrkit/ci`, `@adrkit/mcp`, or `@adrkit/evaluator`.
- ✅ Imports only from `@adrkit/core` internal modules (schema types, Finding types,
  `fingerprintOf`, `canonicalStringify`, `sortByIdThenPath`, `sortFindingsCanonical`).
- ✅ Uses `Node.js crypto` (SHA-256) internally for fingerprint computation.
  `crypto.createHash('sha256')` is deterministic and has no observable side effects;
  it is acceptable in the pure kernel.
- ✅ Is referentially transparent: same `QueueKernelInput` → same `QueueReport`.

These constraints are enforced by the `check:deps` static import-graph scan
(`core-has-no-adapter-deps` gate) and by the unit test fixture strategy (no
test setup required beyond object construction).

---

## Kernel Algorithm

### Step 1: Identify excluded files

An "excluded" file is one whose path (`Adr.path`) does NOT appear in
`corpus.records`. These are files that `lintCorpus()` found but could not
parse into valid records (they produced error-severity findings).

```
excludedPaths = Set of paths in findings with severity:error
                MINUS paths present in corpus.records
```

### Step 2: Project CorpusFindings

For each excluded file, map its `Finding` entries to `CorpusFinding` using the
rule-to-code mapping table in [data-model.md §6](../data-model.md).

Sort `corpusFindings` by: `sourcePath` → `code` → severity rank → `message`.

### Step 3: Filter to proposed records

```
proposedRecords = corpus.records.filter(r => r.frontmatter.status === "proposed")
```

### Step 4: Build QueueItems

For each `proposedRecord`:

1. Extract and normalize all timing fields (see data-model.md §3).
2. Derive `tierLabel` from `tier` using the closed FR-016 mapping.
3. Compute `deadlineDate` via the algorithm in data-model.md §2.
4. Compute `slaState` via the precedence rule in data-model.md §1.
5. Compute `approvalCount`, `unresolvedObjectionCount`, `resolvedObjectionCount`.
6. Generate `itemFindings` (see §ItemFinding Generation below).

### Step 5: Sort QueueItems

Sort by: urgency group → deadline date → `queuedAt` → `id`. See
[research.md §R6](../research.md) for the full comparator definition.

### Step 6: Sort ItemFindings per item

Sort each item's `itemFindings` by: `code` → severity rank → `message`.

### Step 7: Compute fingerprint

```typescript
const corpusFingerprint = fingerprintOf(
  sortByIdThenPath(corpus.records),          // ordered Adr[] (all schema-valid records)
  sortFindingsCanonical(corpus.findings),    // ordered Finding[] (all findings, not just excluded)
  corpus.records.length,                     // recordCount
  corpus.checked - corpus.records.length     // excludedCount
);
```

This matches the `fingerprintOf` signature from `packages/mcp/src/corpus/projection.ts`
(lines 188–195) exactly. The `Finding[]` input is the **original core findings array**
from `lintCorpus`, not the queue-mapped `CorpusFinding[]`.

### Step 8: Assemble QueueReport

```typescript
return {
  version: "1",
  asOf: input.asOf,
  corpusFingerprint,               // computed internally in Step 7
  totalItems: items.length,
  totalCorpusFindings: corpusFindings.length,
  itemsWithFindings: items.filter(i => i.itemFindings.length > 0).length,
  items,
  corpusFindings,
};
```

---

## ItemFinding Generation

Three findings are generated in Step 4, checked independently for each item:

### `item.tier-absent`

**Condition**: `record.frontmatter.review?.tier` is absent (undefined or null).

```typescript
{
  code: "item.tier-absent",
  severity: "info",
  message: "review.tier is absent; routing tier cannot be determined — add review.tier: auto|async|arb to this record",
}
```

### `item.review-by-before-queued`

**Condition**:
- `record.frontmatter.reviewBy` is present, AND
- `record.frontmatter.review?.queuedAt` is present, AND
- `toUTCCalendarDate(reviewBy) < toUTCCalendarDate(queuedAt)` (strictly before; equal dates do NOT trigger)

```typescript
{
  code: "item.review-by-before-queued",
  severity: "warn",
  message: `reviewBy (${reviewBy}) is before queuedAt (${queuedAtDate}); SLA deadline may be inconsistent`,
  // where reviewBy is the raw field value and queuedAtDate is the UTC calendar date of queuedAt
}
```

### `item.deciders-empty`

**Condition**:
- `record.frontmatter.deciders` is absent, empty, or `[]`, AND
- `record.frontmatter.review?.queuedAt` is present (record is actively in the queue)

```typescript
{
  code: "item.deciders-empty",
  severity: "info",
  message: "deciders is empty; routing targets cannot be determined — add at least one decider identity to this record",
}
```

---

## Module Structure

| File | Exports |
|------|---------|
| `packages/core/src/queue/types.ts` | `QueueItem`, `QueueReport`, `SlaState`, `ItemFinding`, `CorpusFinding`, `QueueKernelInput`, `SLA_STATE_URGENCY_ORDER` |
| `packages/core/src/queue/kernel.ts` | `buildQueueReport()` |
| `packages/core/src/queue/sort.ts` | `sortQueueItems()`, `sortCorpusFindings()`, `sortItemFindings()` |
| `packages/core/src/queue/findings.ts` | `mapFindingToCorpusFinding()`, `RULE_TO_CORPUS_CODE` mapping (excluded files only) |
| `packages/core/src/queue/format.ts` | `formatQueueReportJson()`, `formatQueueReportMarkdown()` — consumed by both CLI and Action |
| `packages/core/src/fingerprint/index.ts` | `canonicalStringify()`, `fingerprintOf()` — promoted from `@adrkit/mcp` |
| `packages/core/src/ordering/index.ts` | `compareCodeUnits()`, `compareFindings()`, `sortFindingsCanonical()`, `compareByIdThenPath()`, `sortByIdThenPath()` — promoted from `@adrkit/mcp` |

All modules are exported from `packages/core/src/index.ts` under their natural names.

---

## What the Kernel Does NOT Do

- Does NOT call `lintCorpus()` — that is the CLI/Action boundary's job.
- Does NOT format output (Markdown or JSON) — that is `queue/format.ts`'s job
  (in `@adrkit/core`, consumed by CLI and Action).
- Does NOT interact with GitHub — that is the Action adapter's job.
- Does NOT validate the `asOf` string for parse errors — caller validates.
- Does NOT decide whether to exit non-zero — caller decides based on the returned report.
