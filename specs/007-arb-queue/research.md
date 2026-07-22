# Research: ARB Operations Queue — Phase 6

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-20

This document resolves all planning decisions that must be settled before
implementation. Every decision is verified against the existing repository
source (`packages/core`, `packages/cli`, `packages/ci`, `packages/mcp`),
the accepted ADRs, and the constitution. No item below carries a
NEEDS CLARIFICATION marker; all are resolved and binding.

---

## R1 — Package Placement

**Decision**: Pure kernel → `@adrkit/core` (`packages/core/src/queue/`); CLI
subcommand `adr queue` → `@adrkit/cli` (`packages/cli/src/queue.ts`); GitHub
Action entry → `packages/ci/queue/action.yml` with Node24 entrypoint
`packages/ci/src/queue-action-entrypoint.ts`. **No new public package.**

**Rationale**:

The existing architecture splits cleanly: neutral pure computations live in
`@adrkit/core`; CLI wrappers in `@adrkit/cli`; GitHub-API-coupled adapters in
the private `@adrkit/ci`. The queue kernel is a pure function of
`(corpus_snapshot, asOf)` → `QueueReport` — no clock, no network, no FS — which
fits `@adrkit/core` exactly. The only adapters are: (a) the CLI boundary that
reads the filesystem and clock before calling the kernel, and (b) the Action
boundary that calls the GitHub Issues API. Both belong in their existing
packages.

Principle III explicitly names `@adrkit/core`, `@adrkit/cli`, and the schema as
packages that MUST depend on no adapter. The queue kernel's placement in
`@adrkit/core` satisfies this: `@adrkit/ci` depends on `@adrkit/core` (already
true, not a new dependency), and `@adrkit/core` learns of no adapter.

**Alternatives considered**:

- *New `@adrkit/queue-kernel` package* — rejected. No justification: the kernel
  is a pure addition to the existing `@adrkit/core` surface. The evaluator
  (`@adrkit/evaluator`) was extracted to its own package because its rule engine
  and Pass0 input/output shapes were large and independently re-usable. The queue
  kernel is smaller and has no independent downstream consumers beyond the CLI and
  Action. A new public package would add publishing overhead and a new versioning
  surface for minimal isolation benefit.

- *`@adrkit/mcp` placement* — rejected. The MCP package is purpose-built for the
  local MCP stdio server. Mixing queue logic into it would couple two unrelated
  features and force MCP consumers to depend on queue types. Out of scope per
  spec Assumption A10.

- *Two GitHub Actions in one `action.yml`* — rejected. The existing
  `packages/ci/action.yml` is the PR governing-decisions action. The queue action
  has a different trigger model (push/cron/PR), different required permissions
  (`issues: write` vs `pull-requests: write`), and a different logical purpose.
  A second `action.yml` at `packages/ci/queue/action.yml` is the correct
  separation. Users reference it as
  `mbeacom/adrkit/packages/ci/queue@v0`.

**Installability impact**: `@adrkit/core` and `@adrkit/cli` gain new exports
(additive, non-breaking for existing consumers). `@adrkit/ci` gains a new
subdirectory and build target. No existing public export changes. Principle I
(public export changes) is satisfied.

**Format module placement**: Canonical JSON and Markdown formatters
(`formatQueueReportJson`, `formatQueueReportMarkdown`) live in
`packages/core/src/queue/format.ts` and are exported from `@adrkit/core`. Both
the CLI (`packages/cli/src/queue.ts`) and the Action entrypoint
(`packages/ci/src/queue-action-entrypoint.ts`) import format functions from
`@adrkit/core`. This eliminates any `@adrkit/ci` → `@adrkit/cli` dependency and
ensures both surfaces produce byte-identical output for the same report.

---

## R2 — Finding Codes: Closed List

**Decision**: The following finding codes, generation conditions, severities,
and messages are frozen. Implementation MUST NOT invent additional codes or
reclassify severity (FR-022).

### CorpusFinding Codes

These codes apply to files that **cannot enter the `QueueItem` collection**: they
have blocking errors that make it impossible to safely project a record from the
file. Files with these findings appear only in `corpusFindings`; they are never
`QueueItem`s. All four are severity **error**.

| Code | Severity | Core `Finding.rule` it maps from | Generation Condition |
|------|----------|----------------------------------|----------------------|
| `corpus.read-error` | error | `file-read` | I/O failure reading or stat-ing the file |
| `corpus.parse-error` | error | `frontmatter-parse`, `frontmatter-fence` | YAML is malformed or frontmatter delimiters are absent/malformed |
| `corpus.schema-invalid` | error | Any Zod-validation rule EXCEPT `one-way-door-disallows-auto` (e.g., `required-field`, `invalid-type`, `invalid-enum-value`, `invalid-format`, `invalid-size`, `strict-unknown-key`, `unique-items`, `contract-refinement`, `superseded-requires-supersededBy`, `supersededBy-requires-superseded-status`, `accepted-requires-decider-unless-imported`, `agent-accepted-requires-ratifier`) | File parses but fails Zod `AdrFrontmatter.safeParse()` — field-level or other cross-field refinement failure |
| `corpus.one-way-door-auto-tier` | error | `one-way-door-disallows-auto` | Schema cross-field invariant: `reversibility: one-way-door` + `review.tier: auto` in the same record (ADR-0002, FR-017) |

**Identification algorithm**: After `lintCorpus()` returns, the set of files
that have `error`-severity findings but whose `displayPath` does NOT appear in
any `record.path` in `records` are the "excluded" files (i.e., `validateParsedAdr`
returned `record: undefined` for them). For each such file, collect all its
`Finding` entries (any severity), and map each `Finding.rule` to the appropriate
`CorpusFinding.code` per the table above. Group all findings for the same
`sourcePath` into a single `CorpusFinding` per finding (not per file) so each
individual finding is visible. Sort by `sourcePath` → `code` → `severity rank` →
`message` (code-unit order; severity rank: `error=0, warn=1, info=2`).

**Important scope constraint**: Only findings for **excluded** files are mapped to
`CorpusFinding[]`. Schema-valid records that remain in `lintCorpus().records` may
also have findings in `lintCorpus().findings` (e.g., corpus-level duplicate IDs,
dangling references, or `warn`/`info` issues from cross-record checks) — these
findings appear in the fingerprint input (as part of the full canonical `Finding[]`
from lintCorpus) but are intentionally ignored by `CorpusFinding` mapping. The
`CorpusFinding` type represents only files that could not be projected into
`QueueItem`s, not every warning or info finding in the corpus. The finding code
list above is therefore the complete and exhaustive list for `CorpusFinding.code`
values; it does not cover all possible `Finding.rule` values.

**Exact messages**:

```text
corpus.read-error:   "Cannot read file: {Finding.message}"
corpus.parse-error:  "{Finding.message}"   (pass through from FrontmatterError)
corpus.schema-invalid:  "{Finding.message}"  (pass through from Zod issue message)
corpus.one-way-door-auto-tier:
  "one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)"
```

Note: For `corpus.one-way-door-auto-tier`, the message is the canonical human-
readable description, NOT the raw Zod issue message (which is `"one-way-door
decisions may not take the auto-approve fast path"`). The canonical message is
slightly expanded to name both conflicting fields.

### ItemFinding Codes

These codes apply to schema-valid `proposed` records that ARE `QueueItem`s but
have queue-specific incompleteness or data inconsistencies.

| Code | Severity | Generation Condition |
|------|----------|----------------------|
| `item.tier-absent` | info | `review.tier` is absent (not set in frontmatter); routing tier cannot be determined |
| `item.review-by-before-queued` | warn | `reviewBy` is present AND `review.queuedAt` is present AND the UTC calendar date of `reviewBy` is strictly before the UTC calendar date of `review.queuedAt` |
| `item.deciders-empty` | info | `deciders` array is empty AND `review.queuedAt` is present (record is in the queue with no routing targets) |

**Exact messages**:

```text
item.tier-absent:
  "review.tier is absent; routing tier cannot be determined — add review.tier: auto|async|arb to this record"

item.review-by-before-queued:
  "reviewBy ({reviewBy}) is before queuedAt ({queuedAtDate}); SLA deadline may be inconsistent"

item.deciders-empty:
  "deciders is empty; routing targets cannot be determined — add at least one decider identity to this record"
```

Where `{reviewBy}` is the `reviewBy` field value as-is, and `{queuedAtDate}`
is the UTC calendar date derived from `review.queuedAt`.

**Severity rationale**: `item.tier-absent` and `item.deciders-empty` are `info`
because the record is still a valid proposed record and the queue report is still
useful without them. `item.review-by-before-queued` is `warn` because it is a
data inconsistency (logically incoherent chronological ordering) that an operator
should actively fix, not merely observe. No item finding is severity `error` —
error findings come only from `corpusFindings`.

**Non-findings for edge cases**:

- `not-queued` state: no item finding is generated for the absence of `review`
  or `queuedAt` alone (spec edge case: "No item finding is generated for absence
  of review alone").
- `missing-sla` state: no item finding is generated; `slaState: missing-sla` is
  itself the signal; the operator can read the `queuedAt` present / deadline absent
  from the report.
- `decidedAt` + `approvalCount < quorum`: the report surfaces both `quorum` and
  `approvalCount` so the reviewer can see the discrepancy, but no item finding is
  generated — this is a valid state (a decision can be committed while quorum is
  below threshold; the queue exposes the numbers and does not editorialize).

---

## R3 — QueueReport v1 JSON Shape

See [contracts/queue-report.md](./contracts/queue-report.md) for the complete
specification. Summary of binding decisions:

- **`version`**: string literal `"1"` — not a number, not semver.
- **`asOf`**: `"YYYY-MM-DD"` UTC calendar date (the resolved value used for all SLA comparisons).
- **`corpusFingerprint`**: lower-case hexadecimal SHA-256, 64 characters, computed
  **inside the kernel** using the canonical projection: sorted `Adr[]` records
  (by `(id, sourcePath)`, each serialized as `{ sourcePath, frontmatter, body }`),
  canonically sorted original core `Finding[]` from `lintCorpus()` (NOT the
  queue-mapped `CorpusFinding[]` — the raw core findings including all error, warn,
  and info findings for all files), and corpus health counts
  `{ recordCount: lintResult.records.length, excludedCount: lintResult.checked - lintResult.records.length }`.
  Object keys sorted by code-unit order; `undefined` fields omitted; UTF-8 input.
  This definition is identical to `@adrkit/mcp`'s existing fingerprint function
  (`fingerprintOf` in `packages/mcp/src/corpus/projection.ts` — the second argument
  is `readonly Finding[]`, not queue-mapped findings), and the promoted
  `fingerprintOf()` function in `@adrkit/core` will produce the same bytes for the
  same projection inputs.
  
  **Fingerprint scope caveat**: The MCP loader (`loadCorpusProjection`) includes
  additional pre-read guards (symlink checks, size limits, post-load re-validation)
  that the plain `lintCorpus()` call used by the CLI/Action does not replicate. Two
  calls for the same on-disk ADR corpus will therefore produce identical fingerprints
  only if the projection inputs (records, findings, counts) are identical — and they
  will be identical when the same `lintCorpus()` result is used. Do not claim that
  the MCP server and queue CLI fingerprints for the same physical directory will be
  identical in all edge cases, because the MCP loader may exclude files that
  `lintCorpus` accepts (e.g., symlinks or files over the MCP size limit).
- **`totalItems`**: `items.length`.
- **`totalCorpusFindings`**: `corpusFindings.length`.
- **`itemsWithFindings`**: count of items where `itemFindings.length > 0`.
- **Datetime serialization**: `queuedAt`, `escalatedAt`, `decidedAt` are the
  UTC-normalized ISO string (`new Date(storedValue).toISOString()`, e.g.
  `"2026-01-01T00:00:00.000Z"`). The original offset is lost; UTC is canonical.
- **Tier labels**: `tierLabel` is a closed deterministic projection of `tier`:
  `auto` → `expedited routing; human acceptance required`; `async` →
  `asynchronous human review`; `arb` → `ARB human review`; absent → `null`.
- **`deadlineDate`**: `"YYYY-MM-DD"` string or `null` — the computed UTC calendar
  deadline date, exposed for informational use (not needed for SLA computation, but
  useful for debugging and display).
- **Final newline**: JSON output ends with exactly one `\n` after the closing `}`.
- **Indentation**: `JSON.stringify(report, null, 2)` — two-space indent; no trailing
  whitespace on any line.

---

## R4 — CLI Syntax and Exit Code Matrix

See [contracts/cli-contract.md](./contracts/cli-contract.md) for the complete
specification. Summary of binding decisions:

- **Command**: `adr queue` (new subcommand of the existing `adr` CLI).
- **Flags**:
  - `--dir <path>` (optional, default `docs/adr`) — ADR corpus directory.
  - `--as-of <date>` (optional) — ISO date `YYYY-MM-DD` or ISO datetime with
    timezone offset. If absent, CLI uses `new Date().toISOString().slice(0,10)` at
    the call site (current UTC date) and includes the resolved date in output.
  - `--format markdown|json` (optional, default `markdown`) — output format.
- **Exit codes**:
  - `0` — report emitted with zero `error`-severity findings.
  - `1` — report emitted with one or more `error`-severity findings (complete
    report is emitted to stdout BEFORE exiting non-zero).
  - `2` — usage error (invalid flag, invalid `--as-of` value, invalid `--format`
    value, unrecognized argument). No report emitted. Error message to stderr.
- **stdout**: exactly the selected format (Markdown or JSON), nothing else.
- **stderr**: nothing on success or exit-1; usage message on exit-2.

---

## R5 — Action Surface

See [contracts/github-action.md](./contracts/github-action.md) for the complete
specification. Summary of binding decisions:

- **Location**: `packages/ci/queue/action.yml` — a separate YAML from the existing
  `packages/ci/action.yml`. Users reference it as
  `mbeacom/adrkit/packages/ci/queue@v0`.
- **Runs**: `using: node24`. Entrypoint: `../dist/queue-action.js`.
- **Bundle**: `packages/ci/src/queue-action-entrypoint.ts` → `packages/ci/dist/queue-action.js`
  (separate `bun build` target from the existing `dist/index.js`).
- **Marker constant**: `<!-- adrkit-managed-queue-issue -->` — an HTML comment
  invisible in rendered Markdown, globally unique to adrkit-managed queue issues,
  corpus-independent, stable across all reruns.
- **Required permissions**: `issues: write` on the Action's own GitHub API calls.
  The *calling workflow* must declare `contents: read` (for `actions/checkout`)
  **plus** `issues: write`. Both must appear in the `permissions:` block — no PAT.
- **Paginated issue discovery**: use the GitHub GraphQL repository `issues`
  connection with `states: [OPEN, CLOSED]`, `first: 100`, and cursor pagination until
  `hasNextPage` is false. This connection returns issues only, so pull requests never
  enter marker/title logic. Do not use the Search API: its index is eventually
  consistent and cannot safely prove that exactly zero, one, or multiple marker-owned
  issues exist for a mutation decision.
- **State machine**: 0 managed → title-conflict check → create; 1 open → update;
  1 closed → single atomic update (body + state: 'open' together); 2+ → fail
  (names all conflicting numbers, no write).
- **Marker detection**: an issue is "managed" if and only if the marker
  `<!-- adrkit-managed-queue-issue -->` is **exactly the first line** of the issue
  body, determined by splitting on LF, CRLF, or CR and comparing the first line to
  `MARKER`. Leading whitespace or any other content before the marker disqualifies the
  issue. Do NOT use `body.includes(MARKER)` for ownership detection.
- **Title conflict scope**: when no managed issue is found, the title conflict check
  examines both **open AND closed** unowned issues. If one or more unowned issues
  (not managed, not the managed issue being managed) have the configured title, the
  Action fails without writing. Multiple conflicts are listed by issue number
  ascending; the Action names all of them.
- **Atomic write rule**: the Action makes at most **one GitHub write call** per run.
  For a closed managed issue: a single `issues.update` REST call sets `body` AND
  `state: 'open'` together. For an open managed issue: a single `issues.update`
  call sets `body` only. For a new issue: a single `issues.create` call. There is no
  two-call reopen + update sequence; this guarantees no prior queue mutation before
  the write completes. If `issues.update` fails, the issue body and state are
  unchanged (to the extent GitHub's atomic REST update guarantees atomicity).
- **Error findings behavior**: write managed issue body (complete report), then exit
  non-zero. Warning/info-only → write, exit zero.

---

## R6 — Deterministic Sorting

**Decision**: The following sort order is frozen (FR-006).

### QueueItem sort order (primary → secondary → tertiary → quaternary):

1. **Urgency group** (ascending rank, highest urgency first):
   ```
   overdue=0, escalated=1, due=2, within-sla=3, missing-sla=4, not-queued=5, decided=6
   ```
2. **Deadline date** (ascending `"YYYY-MM-DD"` string comparison, code-unit order)
   — only applies when `deadlineDate` is non-null; items without a deadline sort
   after items within the same urgency group that have a deadline.
3. **`queuedAt` UTC instant** (ascending ISO string comparison, code-unit order)
   — secondary tiebreak for items within the same urgency group that have `queuedAt`
   but no `deadlineDate` (i.e., `missing-sla` group with `queuedAt` present).
4. **`id`** (ascending lexicographic / code-unit order) — mandatory final tiebreak.

**Within-group deadline tie**: within the same urgency group, items WITH a deadline
date sort before items WITHOUT one (within the group), then by deadline ascending,
then by `queuedAt` ascending, then by `id` ascending.

**`not-queued` group**: `queuedAt` is absent by definition, so step 3 uses empty
string for the comparison → effectively sorts by `id` alone within the group.

### `corpusFindings` sort order:
`sourcePath` (code-unit) → `code` (code-unit) → severity rank (`error=0, warn=1, info=2`) → `message` (code-unit).

### `itemFindings` sort order (per QueueItem):
`code` (code-unit) → severity rank → `message` (code-unit).

**Comparator**: All string comparisons use code-unit order (the same
`compareCodeUnits` already defined in `@adrkit/mcp/src/corpus/ordering.ts` and
promoted to `@adrkit/core` as part of the fingerprint utilities). Never
`String.prototype.localeCompare`.

---

## R7 — Test Strategy

**Decision**: Test-first (RED/GREEN). Tasks must be ordered: write failing tests
first, then implement until green. The following coverage is required before
implementation can claim completion:

### Unit tests (`packages/core/test/queue/`)

- **`kernel.test.ts`**:
  - All 7 SLA states, correct precedence (each state independently and in precedence
    pairs: `decided` overrides `escalated`, `escalated` overrides `overdue`, etc.).
  - `reviewBy` takes precedence over `slaDays` when both present.
  - `reviewBy` without `review` block: computes deadline correctly.
  - Timezone edge case: `--as-of 2026-01-08T01:00:00+05:00` → `asOfDate 2026-01-07`.
  - `slaDays: 0`: deadline equals `queuedAt` date; `due` on that day, `overdue` next.
  - Empty corpus: empty `items`, empty `corpusFindings`.
  - No `proposed` records: empty `items`; `corpusFindings` may still be non-empty.
  - All three item findings generated under their exact conditions.
  - `item.review-by-before-queued` exact boundary (equal date → no finding; day
    before → finding).
  - `decidedAt` present + `approvalCount < quorum` → no item finding.
  - CorpusFinding code mapping: only for excluded-file findings; schema-valid records
    with warn/info findings are NOT in `corpusFindings` but their `Finding[]` IS
    included in the fingerprint input.
  - Fingerprint computed internally by kernel; identical calls with identical input
    produce identical fingerprints (no external caller pre-computation required).

- **`sort.test.ts`**:
  - Stable sort: two runs over same input → byte-for-byte identical output.
  - All seven urgency groups in correct order.
  - Within-group deadline ascending; deadline-absent items after deadline-present.
  - `id` tiebreak: records with identical deadline sort by `id` ascending.
  - `not-queued` group: sorts by `id` only.
  - `corpusFindings` sort: `sourcePath` → `code` → severity rank → `message`.
  - `itemFindings` sort: `code` → severity rank → `message`.

- **`findings.test.ts`**:
  - Excluded-file `Finding.rule` values (`frontmatter-parse`, `frontmatter-fence`,
    `file-read`, `one-way-door-disallows-auto`, and each Zod-validation rule that
    applies to excluded records) map to exactly one `CorpusFinding.code`.
  - Schema-valid records' warn/info findings do NOT generate `CorpusFinding` entries.
  - Exact message format for `corpus.one-way-door-auto-tier`.
  - `item.*` messages include the interpolated values verbatim.

- **`format.test.ts`**:
  - `formatQueueReportJson` → valid JSON; all fields present; final newline; no
    trailing whitespace.
  - `formatQueueReportMarkdown` → all QueueItem fields represented; full 64-char
    fingerprint; no emoji; correct escaping for pipe/backtick/CR/LF in cell values.
  - Two calls with identical input → byte-for-byte identical output (determinism).

### Fingerprint compatibility test (`packages/core/test/fingerprint/fingerprint.test.ts`)

- Promoted `fingerprintOf` produces bit-identical output to the reference
  implementation in `@adrkit/mcp` for the same input projection.
- Determinism: same input → same bytes across multiple calls.
- Key-order independence: object with keys in different orders → same bytes.

### CLI integration tests (`packages/cli/test/queue.test.ts`)

- `bun run --cwd packages/cli adr -- queue --format json` on a fixture corpus →
  valid JSON; all QueueItem fields present.
- `bun run --cwd packages/cli adr -- queue` (no flags) → Markdown output; contains
  expected headings; full 64-char fingerprint present.
- `--format markdown` → identical to default.
- `--format invalid` → exit 2, no stdout, error message to stderr.
- `--as-of 2026-01-07` → `asOf: "2026-01-07"` in JSON output.
- `--as-of 2026-01-08T01:00:00+05:00` → `asOf: "2026-01-07"`.
- `--as-of 2026-01-08T10:00:00` (no timezone) → exit 2 (timezone-less datetime rejected).
- `--as-of 2026-13-01` (invalid month) → exit 2 (fails UTC round-trip).
- `--as-of invalid` → exit 2.
- Corpus with 1 error finding → complete report emitted, exit 1.
- Corpus with 0 error findings → exit 0.
- Two runs with identical corpus and `--as-of` → byte-for-byte identical stdout (SC-001).
- Fixtures live in `packages/core/test/fixtures/queue/`.

### Action unit tests (`packages/ci/test/queue-issue.test.ts`)

- **Fake `GitHubQueueClient`**: in-memory stub; no token, no network.
- State machine: all 5 branches (0 managed + no title conflict, 0 managed + title
  conflict, 1 open, 1 closed, 2+ managed).
- GraphQL adapter exhausts multiple cursors and returns open and closed issue nodes;
  pull requests cannot appear in the repository `issues` connection.
- First run creates issue with marker as **first line** of body.
- Second run on same corpus updates same issue; issue count unchanged.
- Closed managed issue: single `updateIssue({body, state:'open'})` call — one write,
  no separate reopen call; no replacement created.
- Two open marked issues: exits non-zero; names both issue numbers; neither modified.
- Permission error (403/401): exits non-zero; message names `issues: write`.
- Error findings in report: issue updated first, then exits non-zero.
- Warning-only findings: issue updated, exits zero.
- Title conflict: unmanaged open issue with configured title → fail, no write.
- Title conflict with unmanaged **closed** issue → also fail, no write.
- Multiple unmanaged title conflicts: all named (ascending issue number), no write.
- Body detection: marker at line 1 with LF or CRLF → managed; marker at line 2 →
  NOT managed; body with leading whitespace then marker → NOT managed.
- Marker in quoted text mid-body → NOT managed (first-line check only).

### Bundle + static boundary tests

- **Bundle smoke test**: build `packages/ci/dist/queue-action.js` with
  `bun build --target=node`. Follow the pattern of `scripts/smoke-node.mjs`: spawn
  the executable bundle with a controlled GitHub Actions environment and a temporary
  workspace whose configured corpus is absent. Assert the known corpus-load failure
  occurs before GitHub client construction, with no network request and no
  module-resolution failure. Do NOT import the executable entrypoint in-process or use
  `--help`. Run under Node 22 AND Node 24 in CI. The Action's `action.yml` declares
  `node24`; the smoke test validates the bundle separately.
- **`check:deps` static scan**: `@adrkit/core` import graph must not include any
  path reaching `@adrkit/ci`, `@adrkit/mcp`, `@adrkit/evaluator`, or
  `@actions/*`. This is the `core-has-no-adapter-deps` gate (Principle III).

### Clean-clone build gate (`clean-clone-builds`)

Run `bun install --frozen-lockfile` followed by
`bun run build && bun test && bun run typecheck` in a fresh clone; assert
all pass with no network access beyond the initial install step.

### Rung-2 reference-verification gate (SC-004 — ADR-0014 rung 2)

Not a CI test — a landing gate met by a maintainer-owned isolated reference repository.
Evidence must be reproducible (pinned adrkit commit), self-verifying (the reference repo
asserts its own outcomes in CI), reviewed, and must include:
- A separate, maintainer-owned isolated reference repository (not this monorepo; not an external team).
- At least three `proposed` records spanning `auto`, `async`, `arb` tiers.
- At least one SLA-boundary or overdue case.
- Approvals and objections present.
- The same managed GitHub issue body updated in place on a second run.
- Default-token-only `issues: write` operation confirmed.

Met by [`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood); see
[checklists/reference-verification-evidence.md](./checklists/reference-verification-evidence.md).
External/community validation (ADR-0014 rung 3) is a later optional maturity signal, not
this gate.

---

## R8 — Constitution Checks Before and After Design

See Constitution Check section in [plan.md](./plan.md). All five principles pass
both before and after design. No violations.

Specifically addressing each sub-question from the planning brief:

- **I (installability/public export changes)**: `@adrkit/core` and `@adrkit/cli`
  add new exports (queue kernel, `adr queue` subcommand, fingerprint helpers).
  All additions. No existing export removed. `@adrkit/ci` adds a new subdirectory
  and a new action — no change to existing `action.yml` or `dist/index.js`.
- **II (offline clean-clone operation)**: Kernel is offline by construction.
  CLI corpus loading uses `lintCorpus` (existing, offline). Action test suite uses
  fake client (no network). Only runtime Action calls need network (GitHub API).
- **III (dependency direction / Action adapter placement)**: The Action adapter
  lives in `@adrkit/ci` (existing adapter package). Canonical formatters live in
  `@adrkit/core` (`queue/format.ts`) — consumed by both CLI and Action, eliminating
  any `@adrkit/ci` → `@adrkit/cli` coupling. `@adrkit/core` does not learn
  of `@adrkit/ci`. Dependency direction: `@adrkit/ci` → `@adrkit/core` (allowed
  and existing). The `core-has-no-adapter-deps` gate remains green.
- **IV (determinism / no approval semantics)**: Kernel is pure. `auto` tier is
  labeled as expedited routing in all output text; no output field states or implies
  acceptance. `QueueReport.items[].tier: "auto"` is a value read from frontmatter,
  not an approval decision.
- **V (versioned schema / report contract)**: `AdrFrontmatter` schema and emitted
  JSON Schema are unchanged. `QueueReport` version field `"1"` is the new contract
  version. No `schema:emit` gate impact.
- **VI (breaking changes / migrations)**: No breaking changes to any published
  package. `@adrkit/core` adds exports (additive). `@adrkit/mcp` migrates two
  private helper imports from its own file to `@adrkit/core` — internal change,
  not a public API break (MCP already re-exports nothing from these helpers).
- **VII (ADR / docs updates)**: A new ADR is NOT required for the queue surface
  itself; the queue is a first-party consumer of ADR-0004's Option A (derived
  projection, no persistent index) and ADR-0005 (routing, never approving). The
  relevant ADRs already govern this feature. However, after Phase 6 is fully
  implemented and the rung-6 gate clears, the root `plan.md` Phase 6 row must be
  updated to `landed` and the CLAUDE.md updated to reflect the new `adr queue`
  command.

---

## R9 — Primitive Reuse: Fingerprint Helpers

**Decision**: Promote `canonicalStringify`, `fingerprintOf`, `compareCodeUnits`,
`compareFindings`, `sortFindingsCanonical`, `compareByIdThenPath`, and
`sortByIdThenPath` from `packages/mcp/src/corpus/` to new modules in
`packages/core/src/`:

- `canonicalStringify` + `fingerprintOf` → `packages/core/src/fingerprint/index.ts`
- `compareCodeUnits`, `compareFindings`, `sortFindingsCanonical`,
  `compareByIdThenPath`, `sortByIdThenPath` → `packages/core/src/ordering/index.ts`

Export all from `@adrkit/core`'s `index.ts`. Update `@adrkit/mcp` to import from
`@adrkit/core` instead of defining locally. The `fingerprintOf` function in core
uses `compareCodeUnits` from the same package.

**Rationale**: The queue CLI and kernel need to produce the same fingerprint as the
MCP server for the same corpus projection (FR-009). Duplicating the implementation
risks silent drift. The functions are pure, have no side effects, and carry no
MCP-specific coupling — they operate on the generic `Adr[]` + `Finding[]` types
already in `@adrkit/core`. `compareCodeUnits` and the sort helpers are also needed
by the queue's `sort.ts`, avoiding a cross-package MCP dependency.

**Fingerprint input clarification**: The `fingerprintOf` function signature is:
```typescript
fingerprintOf(
  records: readonly Adr[],
  corpusFindings: readonly Finding[], // raw core Finding[], NOT queue CorpusFinding[]
  recordCount: number,
  excludedCount: number
): string
```
The second argument is the **original core `Finding[]`** from `lintCorpus()`
(sorted by `sortFindingsCanonical`), not the queue-mapped `CorpusFinding[]`.
This matches the existing MCP `fingerprintOf` at
`packages/mcp/src/corpus/projection.ts` lines 188–195, where `corpusFindings` is
typed as `readonly Finding[]`. The kernel calls:
```typescript
fingerprintOf(
  sortByIdThenPath(lintResult.records),
  sortFindingsCanonical(lintResult.findings),  // all findings, not just excluded-file ones
  lintResult.records.length,
  lintResult.checked - lintResult.records.length
)
```

**Compatibility guarantee**: The promoted `fingerprintOf` must produce bit-identical
output to the function it replaces in `@adrkit/mcp` for any valid input. A
compatibility test (`fingerprint.test.ts`) runs both implementations on the same
fixture and asserts byte equality. The test is then kept permanently to protect
against regression.

**Migration**: `@adrkit/mcp/corpus/projection.ts` removes its local
`canonicalStringify` and `fingerprintOf` definitions and imports them from
`@adrkit/core`. `@adrkit/mcp/corpus/ordering.ts` is kept as a re-export shim (or
removed and import sites updated) — an implementation detail for task generation.
No change to `@adrkit/mcp`'s public interface or observable behavior.

**Fingerprint scope caveat**: The MCP loader includes pre-read guards that plain
`lintCorpus()` does not replicate. Identical fingerprints are guaranteed only when
the same `LintCorpusResult` is used; do not claim the MCP and CLI fingerprints
for the same physical directory will always match if the MCP loader excludes files
that `lintCorpus` does not (e.g., symlinks or files over the MCP size limit).

---

## R10 — Correct Root Status Drift

**Decision**: The correct current state is:

| Phase | Feature | Status |
|-------|---------|--------|
| 0–5 | `specs/001-006-*` | All landed; PRs #5, #6, #7, #12, #14, #19 merged |
| 5 specifically | MCP server | `v0.2.0` published on npm; maintainer dogfood gate met (via MCP Inspector; reference-verified) |
| 6 | `specs/007-arb-queue` | **Landed / reference-verified** (PR #22); ADR-0014 rung-2 gate met, rung-3 external validation open |

The root `plan.md` records Phase 6 as landed / reference-verified: implementation is
complete (PR #22), and the ADR-0014 rung-2 maintainer isolated reference-verification
gate is met by [`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood).

**Rung-2 reference-verification gate**: The queue surfaces were exercised in a
maintainer-owned isolated reference repository with reproducible, self-verifying,
reviewed evidence (FR-019, SC-004). That is an ADR-0014 rung-2 *landing* gate, not a
pre-implementation gate and not an external-team gate.

**v0.2.0 context**: v0.2.0 corresponds to Phase 5 (MCP server). Phase 6 is implemented
and merged (PR #22); its landing rests on rungs 1–2. External/community validation
(ADR-0014 rung 3) remains an optional later maturity signal, tracked honestly as open,
and never gated implementation or landing.
