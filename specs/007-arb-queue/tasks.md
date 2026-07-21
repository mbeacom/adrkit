---
description: "Dependency-ordered task list for the ARB Operations Queue"
---

# Tasks: ARB Operations Queue — Phase 6

**Input**: Design documents from `specs/007-arb-queue/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/kernel.md`, `contracts/cli-contract.md`, `contracts/github-action.md`,
`contracts/queue-report.md`, `quickstart.md`

**Normative**: `docs/adr/0001`, `docs/adr/0002`, `docs/adr/0004`, `docs/adr/0005`,
`docs/adr/0007`, `docs/adr/0010`, `.specify/memory/constitution.md` Principles I–V

> **Scope is closed.** Implement exactly: the pure `buildQueueReport` kernel in
> `@adrkit/core`, the `adr queue` CLI subcommand in `@adrkit/cli`, and the
> `packages/ci/queue/action.yml` GitHub Action in private `@adrkit/ci`. Do not add a
> fifth tool, write path into decision records, database, web service, persistent index,
> notification system, lifecycle transitions, model/embedding calls, multi-repository
> federation, or PAT-based auth. No new public package.

**Tests**: REQUIRED and test-first (RED before GREEN). Test-creation tasks precede their
implementation tasks. Each RED task must be run and its expected failure recorded before
the corresponding GREEN task begins. No stub modules that throw `Error("unimplemented")`.

**Toolchain**: Bun 1.3.14; `bun.lock` frozen. Published artifacts target Node ≥22.

## Format: `[ID] [P?] [Story?] Description with exact file path`

- **[P]**: Parallelizable — task writes files with no path overlap and has no
  dependency on another incomplete task in the same phase.
- **[US1]–[US5]**: Used only in user-story phases; maps directly to `spec.md`.
- Setup, foundational, and quality phases intentionally omit story labels.

---

## Phase 1: Setup

**Purpose**: Create fixture directories and write fixture ADR files for the offline test
substrate. Do NOT create production source modules or stub implementations here;
this phase is fixture-only.

- [ ] T001 Create fixture directory tree: `packages/core/test/fixtures/queue/` with
  subdirs `within-sla-corpus/`, `overdue-corpus/`, `due-corpus/`, `escalated-corpus/`,
  `decided-corpus/`, `not-queued-corpus/`, `missing-sla-corpus/`,
  `schema-invalid-corpus/`, `one-way-door-auto-corpus/`, `no-proposed-corpus/`,
  `warn-review-by-before-queued-corpus/`, `comprehensive-corpus/`

- [ ] T002 [P] Write `packages/core/test/fixtures/queue/within-sla-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Within-SLA ADR"`, `status:proposed`,
  `date:2026-01-01`, `deciders:["@alice","@bob"]`, `review.tier:arb`,
  `review.queuedAt:"2026-01-01T00:00:00Z"`, `review.slaDays:14`;
  on `--as-of 2026-01-08` deadline is 2026-01-15, asOf before deadline → `within-sla`

- [ ] T003 [P] Write `packages/core/test/fixtures/queue/overdue-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Overdue ADR"`, `status:proposed`,
  `date:2025-12-01`, `deciders:["@alice"]`, `review.tier:arb`,
  `review.queuedAt:"2025-12-01T00:00:00Z"`, `review.slaDays:14`, no `escalatedAt`;
  on `--as-of 2026-03-01` deadline 2025-12-15 < asOf, no escalatedAt → `overdue`

- [ ] T004 [P] Write `packages/core/test/fixtures/queue/due-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Due ADR"`, `status:proposed`, `date:2026-02-01`,
  `deciders:["@alice"]`, `review.tier:async`, `review.queuedAt:"2026-02-01T00:00:00Z"`,
  `review.slaDays:14`;
  on `--as-of 2026-02-15` deadline 2026-02-15 == asOf → `due`

- [ ] T005 [P] Write `packages/core/test/fixtures/queue/escalated-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Escalated ADR"`, `status:proposed`,
  `date:2025-11-01`, `deciders:["@alice"]`, `review.tier:arb`,
  `review.queuedAt:"2025-11-01T00:00:00Z"`, `review.slaDays:14`,
  `review.escalatedAt:"2025-11-20T00:00:00Z"`;
  on `--as-of 2026-01-08` deadline in past + escalatedAt present → `escalated` (not `overdue`)

- [ ] T006 [P] Write `packages/core/test/fixtures/queue/decided-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Decided ADR"`, `status:proposed`,
  `date:2026-01-01`, `deciders:["@alice"]`, `review.tier:arb`,
  `review.queuedAt:"2026-01-01T00:00:00Z"`, `review.slaDays:14`,
  `review.decidedAt:"2026-01-05T00:00:00Z"`;
  `status:proposed` + `review.decidedAt` present → `decided` regardless of deadline

- [ ] T007 [P] Write `packages/core/test/fixtures/queue/not-queued-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Not-Queued ADR"`, `status:proposed`,
  `date:2026-01-01`; no `review` block at all;
  queuedAt absent → `not-queued` on any asOf

- [ ] T008 [P] Write `packages/core/test/fixtures/queue/missing-sla-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Test Missing-SLA ADR"`, `status:proposed`,
  `date:2026-01-01`, `deciders:["@alice"]`, `review.tier:async`,
  `review.queuedAt:"2026-01-01T00:00:00Z"`; NO `review.slaDays`, NO top-level `reviewBy`;
  queuedAt present, deadline uncomputable → `missing-sla`

- [ ] T009 [P] Write `packages/core/test/fixtures/queue/schema-invalid-corpus/0001.md`:
  valid YAML with frontmatter `id:"0001"`, `title:"Bad Status ADR"`, `date:2026-01-01`,
  `status:"not-a-valid-status"` (fails Zod enum validation); `lintCorpus` emits
  `Finding.rule:"invalid-enum-value"` for this file → maps to `corpus.schema-invalid`

- [ ] T010 [P] Write `packages/core/test/fixtures/queue/one-way-door-auto-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"One-Way-Door Auto ADR"`, `status:proposed`,
  `date:2026-01-01`, `reversibility:one-way-door`, `deciders:["@alice"]`,
  `review.tier:auto`, `review.queuedAt:"2026-01-01T00:00:00Z"`, `review.slaDays:7`;
  cross-field invariant `reversibility:one-way-door` + `review.tier:auto` →
  `corpus.one-way-door-auto-tier` (file excluded from items)

- [ ] T011 [P] Write `packages/core/test/fixtures/queue/no-proposed-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"Accepted ADR"`, `status:accepted`,
  `date:2026-01-01`, `deciders:["@alice"]`;
  only non-proposed records → `items:[]`, `totalItems:0`

- [ ] T012 [P] Write `packages/core/test/fixtures/queue/warn-review-by-before-queued-corpus/0001.md`:
  frontmatter `id:"0001"`, `title:"ReviewBy Before Queued"`, `status:proposed`,
  `date:2026-01-01`, `reviewBy:"2025-12-31"`, `deciders:["@alice"]`,
  `review.tier:async`, `review.queuedAt:"2026-01-01T00:00:00Z"`, `review.slaDays:14`;
  top-level `reviewBy` (2025-12-31) strictly before UTC calendar date of `queuedAt`
  (2026-01-01) → item finding `item.review-by-before-queued` severity warn;
  no corpus.schema-invalid; exit 0 (warn only, not error). Also populate
  `packages/core/test/fixtures/queue/comprehensive-corpus/` with ten schema-valid
  `proposed` records (`0001.md`–`0010.md`) spanning all seven SLA states and all three
  tiers, including one valid two-way-door `auto` item, approvals and resolved/unresolved
  objections, item findings, and deterministic sort ties; add `9999-invalid.md` with
  schema-invalid frontmatter so the complete report also exercises a CorpusFinding.

**Checkpoint**: 12 fixture corpora exist under `packages/core/test/fixtures/queue/`.
`bun test` finds no test files yet; `bun run typecheck` still passes.

---

## Phase 2: Fingerprint and Ordering Promotion

**Purpose**: Promote `canonicalStringify`, `fingerprintOf`, and ordering helpers from
`@adrkit/mcp` to `@adrkit/core` with a permanent byte-compatibility test, then migrate
MCP imports — no observable change to any existing behavior.

**Blocked by**: Phase 1 complete.

### RED: write failing tests first

- [ ] T013 [P] Write failing byte-compatibility test in
  `packages/core/test/fingerprint/fingerprint.test.ts`:
  (a) before migration, compute one fixed 64-character reference vector from the current
  MCP algorithm using a one-off `bun -e` command that copies the exact private
  `fingerprintOf` projection over a small inline fixture (`records: [Adr]`,
  `findings: [Finding]`, `recordCount: 1`, `excludedCount: 0`), then store only the
  resulting literal and fixture in the permanent test (do not import the private MCP
  helper or retain a second implementation);
  (b) import `fingerprintOf`, `canonicalStringify` from `@adrkit/core` (module export does
  not yet exist); assert promoted `fingerprintOf` returns the exact reference hex for the
  same inputs; assert determinism: two calls with identical input → identical hex;
  assert key-order independence: object with same fields in different order → same hex.
  Run `bun test packages/core/test/fingerprint/fingerprint.test.ts`; record
  `Cannot find module '@adrkit/core' export 'fingerprintOf'` or equivalent failure.

- [ ] T014 [P] Write failing ordering-helpers test in
  `packages/core/test/ordering/ordering.test.ts`:
  import `compareCodeUnits`, `sortFindingsCanonical`, `sortByIdThenPath`,
  `compareByIdThenPath` from `@adrkit/core`;
  assert `compareCodeUnits("ä","b") > 0` (ä U+00E4=228, b U+0062=98; ä > b);
  assert `compareCodeUnits("a","b") < 0`;
  assert `compareCodeUnits("a","a") === 0`;
  assert `sortByIdThenPath` is ascending by id then sourcePath (code-unit order, stable);
  assert `sortFindingsCanonical` on a fixture Finding[] produces the same array each call.
  Run `bun test packages/core/test/ordering/ordering.test.ts`; record
  `Cannot find module '@adrkit/core' export 'compareCodeUnits'` or equivalent failure.

### GREEN: implement promotions

- [ ] T015 After T013+T016: Create `packages/core/src/fingerprint/index.ts` by promoting
  `canonicalStringify` and `fingerprintOf` verbatim from
  `packages/mcp/src/corpus/projection.ts` (lines ~170–196);
  exact `fingerprintOf` signature:
  `fingerprintOf(records: readonly Adr[], corpusFindings: readonly Finding[], recordCount: number, excludedCount: number): string`;
  exact projection shape built inside the function:
  `{ records: records.map(r => ({sourcePath:r.path, frontmatter:r.frontmatter, body:r.body})), corpusFindings, corpusHealth:{recordCount,excludedCount} }`;
  imports: `Adr` and `Finding` from their relative core modules (no self-package barrel
  import), `compareCodeUnits` from `../ordering/index.ts`, and `createHash` from
  `node:crypto`.
  Run `bun test packages/core/test/fingerprint/fingerprint.test.ts`; assert all assertions green.

- [ ] T016 [P] After T014: Create `packages/core/src/ordering/index.ts` by promoting
  `compareCodeUnits`, `compareFindings`, `sortFindingsCanonical`, `compareByIdThenPath`,
  `sortByIdThenPath`, and `OrderedSummary` interface verbatim from
  `packages/mcp/src/corpus/ordering.ts`;
  import `Finding` from its relative core module (no self-package barrel import).
  Run `bun test packages/core/test/ordering/ordering.test.ts`; assert all assertions green.

- [ ] T017 Add named re-exports for `canonicalStringify`, `fingerprintOf`,
  `compareCodeUnits`, `compareFindings`, `sortFindingsCanonical`, `compareByIdThenPath`,
  `sortByIdThenPath`, `type OrderedSummary` to `packages/core/src/index.ts`.
  Run `bun run --filter @adrkit/core typecheck`; assert clean.

### MCP migration (no observable change)

- [ ] T018 [P] Update `packages/mcp/src/corpus/projection.ts`: remove the local
  `canonicalStringify` and `fingerprintOf` function bodies; add
  `import { canonicalStringify, fingerprintOf } from '@adrkit/core';` at the top;
  all call sites are unchanged; no other behavioral modification.

- [ ] T019 [P] Convert `packages/mcp/src/corpus/ordering.ts` to a re-export shim:
  replace the implementation bodies with
  `export { compareCodeUnits, compareFindings, sortFindingsCanonical, compareByIdThenPath, sortByIdThenPath, type OrderedSummary } from '@adrkit/core';`;
  all existing MCP import sites (`import ... from '../corpus/ordering'`) need no change.

- [ ] T020 Run `bun run --filter @adrkit/mcp typecheck && bun test packages/mcp`;
  assert all MCP tests pass without modification; assert no change to MCP public API
  or observable tool behavior.

**Checkpoint**: `fingerprintOf` and ordering helpers live in `@adrkit/core` with
permanent byte-compat test. MCP behavior is bit-identical.

---

## Phase 3: Queue Kernel, Sort, Findings, and Formatters (US1, US2, US3, US5)

**Purpose**: Implement the pure queue core — types, corpus/item finding mapping,
deterministic sort, `buildQueueReport` kernel, and canonical JSON/Markdown formatters.
Covers US1 (local queue), US2 (SLA determinism), US3 (corpus vs item finding
distinction), and US5 (auto tier as expedited routing).

**Blocked by**: Phase 2 (`fingerprintOf`, `sortByIdThenPath`, `sortFindingsCanonical`
available from `@adrkit/core`).

**Independent Test (US1/US2/US3/US5)**:
`bun run adr -- queue --dir packages/core/test/fixtures/queue/within-sla-corpus --as-of 2026-01-08 --format json`
exits 0; JSON output has `version:"1"`, `asOf:"2026-01-08"`, exactly 1 item with
`slaState:"within-sla"`, `totalCorpusFindings:0`; running twice with the same
`--as-of` produces byte-identical stdout.

### RED: write failing tests first

- [ ] T021 [P] [US3] Write failing tests in `packages/core/test/queue/findings.test.ts`:
  import `mapFindingToCorpusFinding`, `RULE_TO_CORPUS_CODE` from `@adrkit/core`;
  (a) `rule:"file-read"` → code `corpus.read-error`, message `"Cannot read file: {Finding.message}"`;
  (b) `rule:"frontmatter-parse"` → `corpus.parse-error`, message passed through from Finding;
  (c) `rule:"frontmatter-fence"` → `corpus.parse-error`, message passed through;
  (d) `rule:"one-way-door-disallows-auto"` → `corpus.one-way-door-auto-tier`, exact canonical
  message `"one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)"`;
  (e) `rule:"invalid-enum-value"` → `corpus.schema-invalid`, message passed through;
  (f) `rule:"required-field"` → `corpus.schema-invalid`;
  (g) any unrecognized rule (e.g. `"contract-xyz"`) → `corpus.schema-invalid` (fallback, not undefined);
  Schema-valid-record finding exclusion and item-finding generation are tested through
  `buildQueueReport` in T023, because the corpus mapping helper alone does not know
  which files produced valid records.
  Run test; record `Cannot find module '@adrkit/core' export 'mapFindingToCorpusFinding'` failure.

- [ ] T022 [P] [US2] Write failing tests in `packages/core/test/queue/sort.test.ts`:
  import `sortQueueItems`, `sortCorpusFindings`, `sortItemFindings`, `SLA_STATE_URGENCY_ORDER`
  from `@adrkit/core`;
  (a) urgency order assertion: sort items with all 7 slaStates; assert final order
  `overdue(0)` first, then `escalated(1)`, `due(2)`, `within-sla(3)`, `missing-sla(4)`,
  `not-queued(5)`, `decided(6)` last;
  (b) within-group: two `overdue` items with different deadlineDates sort by deadline
  ascending; item with null deadline sorts AFTER item with non-null deadline in same group;
  (c) id tiebreak: equal urgency + equal deadlineDate + equal queuedAt → ascending `id`;
  (d) `not-queued` group: queuedAt absent by definition → sorts by `id` only;
  (e) `sortCorpusFindings` order: sourcePath → code → severity rank (error=0,warn=1,info=2)
  → message (code-unit);
  (f) `sortItemFindings` order: code → severity rank → message (code-unit);
  (g) determinism: two calls on same input → byte-identical output.
  Run test; record `Cannot find module` failure.

- [ ] T023 [P] [US1] Write failing tests in `packages/core/test/queue/kernel.test.ts`:
  import `buildQueueReport` from `@adrkit/core`; construct each input as
  `LintCorpusResult` with fields `records`, `findings`, `checked` (NOT `recordCount`/`excludedCount`);
  (1) **all 7 SLA states** — one inline corpus per state: `overdue`, `escalated`, `due`,
  `within-sla`, `missing-sla`, `not-queued`, `decided`; assert correct `slaState` for each;
  (2) **timezone normalization** — inline record with
  `review.queuedAt:"2026-03-08T23:59:59-05:00"`, `review.slaDays:1`; kernel normalizes
  to UTC date 2026-03-09; deadline = 2026-03-10; with `asOf:"2026-03-10"` →
  `slaState:"due"` (deadline == asOf); with `asOf:"2026-03-11"` → `slaState:"overdue"`;
  (3) **slaDays:0** — deadline = queuedAt UTC date; `due` on that date; `overdue` next day;
  (4) **reviewBy precedence** — both `reviewBy` and `review.slaDays` present; `reviewBy`
  is the deadline (slaDays ignored for deadline computation, still in output);
  (5) **escalated beats overdue** — `escalatedAt` present + deadline in past →
  `slaState:"escalated"`, not `"overdue"`;
  (6) **decided beats escalated** — `decidedAt` + `escalatedAt` both present →
  `slaState:"decided"`;
  (7) **empty corpus** — `records:[]`, `findings:[]`, `checked:0` →
  `items:[]`, `corpusFindings:[]`, `totalItems:0`;
  (8) **no proposed** — all records `status:accepted` → `items:[]`;
  `corpusFindings` may be non-empty if excluded files exist;
  (9) **item.tier-absent** — proposed record with no `review.tier` → one item finding
  with code `"item.tier-absent"`, severity `"info"`;
  (10) **item.deciders-empty** — proposed record with `queuedAt` present and
  `deciders:[]` → `"item.deciders-empty"` severity `"info"`;
  (11) **item.review-by-before-queued** — `reviewBy` strictly before UTC calendar date
  of `queuedAt` → `"item.review-by-before-queued"` severity `"warn"`;
  equal date → NO finding generated; assert exact frozen messages for all three item
  finding codes from `research.md §R2`;
  (12) **decidedAt + approvalCount < quorum** → no item finding (valid state, numbers exposed);
  (13) **schema-valid proposed with warn lint finding** — Finding with severity warn for
  a record in `corpus.records`: that finding does NOT appear in `report.corpusFindings`
  (schema-valid records excluded) but IS included in fingerprint input (`corpus.findings`);
  (14) **version field** — `report.version === "1"` (string, not number);
  (15) **excluded file one-way-door-disallows-auto** — `Finding.rule:
  "one-way-door-disallows-auto"` for a file not in `records` →
  `corpusFindings[0].code:"corpus.one-way-door-auto-tier"` with exact canonical message;
  (16) **corpusFingerprint** — returned hex is 64 lowercase chars;
  (17) **determinism** — identical `LintCorpusResult` + identical `asOf` → identical
  `corpusFingerprint`; (18) **tier semantics** — `auto`, `async`, and `arb` derive the
  exact `tierLabel` strings from FR-016, absent tier derives `null`, and the auto label
  explicitly requires human acceptance.
  Run test; record `Cannot find module` failure.

- [ ] T024 [P] [US1] Write failing tests in `packages/core/test/queue/format.test.ts`:
  import `formatQueueReportJson`, `formatQueueReportMarkdown` from `@adrkit/core`;
  construct a `QueueReport` with `version:"1"` and all fields populated;
  (a) `formatQueueReportJson`: output is valid JSON; final byte is `\n` (0x0a);
  no trailing whitespace on any line; top-level JSON key insertion order matches
  `version → asOf → corpusFingerprint → totalItems → totalCorpusFindings →
  itemsWithFindings → items → corpusFindings` (construction order);
  QueueItem key insertion order matches `id → title → sourcePath → tier → tierLabel →
  queuedAt → slaDays → reviewBy → slaState → deadlineDate → routingTargets → quorum → approvalCount
  → unresolvedObjectionCount → resolvedObjectionCount → escalatedAt → decidedAt →
  itemFindings`; `version` value is string `"1"` (not number); null fields present as
  JSON `null` (not omitted);
  (b) `formatQueueReportMarkdown`: first line is `# ARB Queue — {asOf}`;
  second non-blank line contains `Corpus fingerprint: \`` + full 64-char hex + `\``;
  empty items table renders exactly `*No proposed records found.*`;
  null field values render as `-` in table cells;
  pipe character `|` in item title is escaped as `\|` in Markdown cell;
  a title containing CRLF/LF/CR is normalized to a single-line detail heading and
  cannot inject a second heading or table;
  `sourcePath` and `code` values are backtick-wrapped in corpus findings section;
  overview Tier renders exactly `{tier} ({tierLabel})` for a non-null tier and
  `(none)` for a null tier; every per-item detail section contains a `Tier Label` row
  with the exact `tierLabel` value (or `-` when null);
  output ends with exactly one `\n`;
  (c) determinism: two calls with identical input → byte-identical output.
  Run test; record `Cannot find module` failure.

### GREEN: implement queue core

- [ ] T025 [US1] Create `packages/core/src/queue/types.ts` with all type and constant
  declarations (no runtime logic beyond `SLA_STATE_URGENCY_ORDER` constant):
  `SlaState` union type, `SLA_STATE_URGENCY_ORDER: Record<SlaState, number>` = `{overdue:0,escalated:1,due:2,"within-sla":3,"missing-sla":4,"not-queued":5,decided:6}`,
  `CorpusFinding` interface, `ItemFinding` interface, `QueueItem` interface (fields in
  exact contract order), `QueueReport` interface (fields in exact contract order),
  `QueueKernelInput` interface (`corpus: LintCorpusResult`, `asOf: string`), including
  `tierLabel`'s exact closed string union from FR-016.
  Import `LintCorpusResult` from its relative core validation module. No self-package
  barrel import and no logic.

- [ ] T026 [P] [US3] Create `packages/core/src/queue/findings.ts`:
  `RULE_TO_CORPUS_CODE` constant map: `"file-read"→"corpus.read-error"`,
  `"frontmatter-parse"→"corpus.parse-error"`, `"frontmatter-fence"→"corpus.parse-error"`,
  `"one-way-door-disallows-auto"→"corpus.one-way-door-auto-tier"`, all others (including
  any unknown future rule) → `"corpus.schema-invalid"` via fallback;
  `mapFindingToCorpusFinding(finding: Finding, sourcePath: string): CorpusFinding`
  with exact messages from R2:
  `corpus.read-error` → `"Cannot read file: " + finding.message`;
  `corpus.parse-error` and `corpus.schema-invalid` → pass-through `finding.message`;
  `corpus.one-way-door-auto-tier` → canonical fixed message
  `"one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)"`.
  Import `Finding` from its relative core validation module; `CorpusFinding` from
  `./types`.
  Run `bun test packages/core/test/queue/findings.test.ts`; assert green.

- [ ] T027 [P] [US2] Create `packages/core/src/queue/sort.ts` with
  `sortQueueItems(items: QueueItem[]): QueueItem[]`,
  `sortCorpusFindings(findings: CorpusFinding[]): CorpusFinding[]`,
  `sortItemFindings(findings: ItemFinding[]): ItemFinding[]`;
  exact comparator from R6 for items: urgency (`SLA_STATE_URGENCY_ORDER`) ascending →
  deadlineDate ascending code-unit (null last within group) → queuedAt ascending
  code-unit → id ascending code-unit; all string comparisons via `compareCodeUnits`
  (never `localeCompare`).
  Import `compareCodeUnits` from `../ordering`; types from `./types`.
  Run `bun test packages/core/test/queue/sort.test.ts`; assert green.

- [ ] T028 [US1] Create `packages/core/src/queue/kernel.ts` implementing
  `buildQueueReport({corpus: LintCorpusResult, asOf: string}): QueueReport`
  per the 8-step algorithm in `contracts/kernel.md`:
  Step 1 — identify excluded file paths (paths in error-severity findings not in
  `corpus.records`);
  Step 2 — map each excluded file's Finding to CorpusFinding via `mapFindingToCorpusFinding`;
  sort via `sortCorpusFindings`;
  Step 3 — `proposedRecords = corpus.records.filter(r => r.frontmatter.status === "proposed")`;
  Step 4 — for each proposedRecord: normalize timing fields
  (`new Date(v).toISOString().slice(0,10)`) to UTC calendar date; compute `deadlineDate`
  (reviewBy takes precedence over slaDays; slaDays:0 deadline = queuedAt date; absent
  queuedAt → null deadline); compute `slaState` via precedence
  (decidedAt→decided, escalatedAt→escalated, then deadline comparisons against asOf:
  <asOf→overdue, ==asOf→due, >asOf→within-sla; no deadline+queuedAt→missing-sla;
  no queuedAt→not-queued); extract `approvalCount`, `unresolvedObjectionCount`,
  `resolvedObjectionCount` from `review.approvals`/`review.objections`; generate item
  findings (check `tier-absent`, `review-by-before-queued`, `deciders-empty` conditions
  per R2); derive `tierLabel` using the exact FR-016 mapping and populate `QueueItem` in
  exact field order from `QueueItem` interface;
  Step 5 — `sortQueueItems(items)`;
  Step 6 — `sortItemFindings` per item;
  Step 7 — `corpusFingerprint = fingerprintOf(sortByIdThenPath(corpus.records),
  sortFindingsCanonical(corpus.findings), corpus.records.length,
  corpus.checked - corpus.records.length)` (uses ALL corpus findings, not just excluded);
  Step 8 — assemble and return `QueueReport` with `version:"1"`, all summary counts.
  Imports: `./types`, `./findings`, `./sort`, `../fingerprint`, `../ordering`, and
  relative core schema/validation modules for core types. Do NOT self-import through
  `@adrkit/core`, and do NOT import `@actions/*`, `@adrkit/ci`,
  `@adrkit/mcp`, `@adrkit/evaluator`, or any adapter.
  Run `bun test packages/core/test/queue/kernel.test.ts`; assert green.

- [ ] T029 [US1] Create `packages/core/src/queue/format.ts` with:
  `formatQueueReportJson(report: QueueReport): string` — returns
  `JSON.stringify(report, null, 2) + "\n"` (2-space indent; insertion-order keys; final
  newline; no additional key sorting on output);
  `formatQueueReportMarkdown(report: QueueReport): string` — produces canonical Markdown
  per `contracts/queue-report.md` §IV: heading `# ARB Queue — {asOf}`, fingerprint line
  `Corpus fingerprint: \`{64-char hex}\``, all three summary counts, concise overview
  table, and one deterministic detail section per item exposing every QueueItem field
  (null fields → `-`; `tier:null` → `(none)`; `sourcePath` backtick-wrapped; pipe,
  backtick, backslash, CR, LF, and CRLF escaped in the contract's exact order), empty
  items text exactly `*No proposed records found.*`, corpus findings section if
  non-empty (sourcePath and code values backtick-wrapped), final `\n`.
  Import `QueueReport`, `QueueItem` from `./types`.
  Run `bun test packages/core/test/queue/format.test.ts`; assert green.

- [ ] T030 Add all queue exports to `packages/core/src/index.ts`: `buildQueueReport`,
  `formatQueueReportJson`, `formatQueueReportMarkdown`, `sortQueueItems`,
  `sortCorpusFindings`, `sortItemFindings`, `mapFindingToCorpusFinding`,
  `RULE_TO_CORPUS_CODE`, `SLA_STATE_URGENCY_ORDER`, and all type exports
  (`QueueReport`, `QueueItem`, `CorpusFinding`, `ItemFinding`, `SlaState`,
  `QueueKernelInput`).
  Run `bun run --filter @adrkit/core typecheck && bun test packages/core`;
  assert all tests pass; confirm no `@adrkit/ci`, `@adrkit/mcp`, or `@actions/*`
  import reachable from the core import graph.

**Checkpoint**: `buildQueueReport` is a pure, offline function producing byte-identical
output for identical inputs. Full test suite passes for core queue.

---

## Phase 4: CLI Subcommand `adr queue` (US1, US2, US3)

**Purpose**: Wire the kernel to the CLI boundary — argument parsing, `--as-of` date
validation and normalization, corpus loading, format selection, stdout/exit-code
assignment.

**Blocked by**: Phase 3 complete.

**Independent Test (US1/US2/US3)**:
`bun run adr -- queue --dir packages/core/test/fixtures/queue/within-sla-corpus --as-of 2026-01-08 --format json`
exits 0, emits valid QueueReport v1 JSON with `version:"1"`, `asOf:"2026-01-08"`, 1
item with `slaState:"within-sla"`, `totalCorpusFindings:0`;
`--format csv` exits 2 with empty stdout;
`--as-of "2026-01-08T10:00:00"` (timezone-less) exits 2 with empty stdout.

### RED: write failing test first

- [ ] T031 [US1] Write failing integration tests in `packages/cli/test/queue.test.ts`
  using `Bun.spawn` against the CLI binary; use Phase 1 fixture corpora:
  (a) within-sla-corpus `--as-of 2026-01-08 --format json` → exit 0, valid JSON,
  `version:"1"`, `asOf:"2026-01-08"`, `items.length:1`, `items[0].slaState:"within-sla"`;
  (b) default format (no flag) on same corpus → exit 0, stdout starts `# ARB Queue — 2026-01-08`;
  (c) `--format markdown` → identical to (b);
  (d) `--format csv` → exit 2, stdout empty, stderr contains `"Invalid --format value: 'csv'"`;
  (e) `--as-of "2026-01-08T10:00:00"` (no TZ) → exit 2, stdout empty,
  stderr matches `"Timezone-less datetimes are ambiguous"`;
  (f) `--as-of "2026-01-08T01:00:00+05:00"` → exit 0, `asOf:"2026-01-07"`
  (UTC normalization: +05:00 offset → UTC 2026-01-07T20:00:00Z → date 2026-01-07);
  (g) `--as-of "2026-13-01"` (invalid month) → exit 2, stderr contains
  `"Invalid --as-of value"` and no unhandled exception; `--as-of "2026-02-30"`
  (normalized impossible date) also exits 2 without throwing;
  (h) schema-invalid-corpus `--format json` → exit 1, stdout is complete JSON report
  (non-empty `corpusFindings`), stdout emitted BEFORE exit;
  (i) one-way-door-auto-corpus → exit 1, `corpusFindings[*].code:
  "corpus.one-way-door-auto-tier"`;
  (j) warn-review-by-before-queued-corpus → exit 0 (`item.review-by-before-queued`
  is warn, no error-severity corpus findings);
  (k) two runs, identical corpus and `--as-of 2026-01-08` → byte-identical stdout (SC-001).
  (l) comprehensive-corpus emits all ten proposed items plus its CorpusFinding before
  exit 1; JSON and Markdown make every overdue/due/escalated item and every item/corpus
  finding identifiable without opening source files (SC-002);
  (m) `--help` → exit 0 with usage on stdout and empty stderr;
  (n) `--unknown-flag` → exit 2, empty stdout, and the exact frozen unknown-flag stderr;
  (o) a missing `--dir` → exit 2, empty stdout, and the exact frozen corpus-not-found
  stderr rather than the top-level CLI's generic exit-1 path;
  Run `bun test packages/cli/test/queue.test.ts`; record `Cannot find module './queue'`
  or equivalent failure.

### GREEN: implement CLI subcommand

- [ ] T032 [US1] Create `packages/cli/src/queue.ts`:
  parse `--dir <path>` (default `docs/adr`), `--as-of <value>` (optional),
  `--format markdown|json` (default `markdown`);
  validate `--format`: if value not `"markdown"` or `"json"`, write
  `"Invalid --format value: '{v}'. Expected markdown or json.\n"` to stderr, exit 2;
  validate `--as-of` per `contracts/cli-contract.md` §As-Of Resolution:
  bare YYYY-MM-DD → regex check, then
  `const parsed = new Date(v+"T00:00:00Z")` and require
  `Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===v`
  so invalid dates never throw;
  offset datetime (contains `T` + `Z` or `±` after time) → `new Date(v).toISOString().slice(0,10)`;
  timezone-less datetime (contains `T` but no TZ designator) → stderr
  `"Invalid --as-of value: '{v}'. Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).\n"`, exit 2;
  any other failure → stderr `"Invalid --as-of value: '{v}'. Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).\n"`, exit 2;
  if `--as-of` absent: `asOf = new Date().toISOString().slice(0,10)`;
  handle `--help` before corpus loading by writing queue usage to stdout and returning
  0; reject unknown flags with the exact contract message and exit 2; verify the corpus
  directory is readable before `lintCorpus`, translating missing/unreachable directory
  errors to the exact corpus-not-found stderr and exit 2 with no stdout;
  call `lintCorpus({dir})` from `@adrkit/core`; call `buildQueueReport({corpus, asOf})`;
  call `formatQueueReportMarkdown(report)` or `formatQueueReportJson(report)`;
  write to `process.stdout` (emit complete report BEFORE deciding exit code);
  if `report.corpusFindings.some(f => f.severity === "error")` → exit 1; else exit 0.
  No `@actions/*`, `@adrkit/ci`, `@adrkit/mcp` imports.
  Run `bun test packages/cli/test/queue.test.ts`; assert green.

- [ ] T033 [US1] Add `queue` subcommand to `packages/cli/src/index.ts`:
  add `"queue"` branch to existing `main()` dispatcher; import and call `runQueue`
  (or equivalent export) from `./queue`.
  Run `bun run --filter @adrkit/cli typecheck && bun test packages/cli`;
  assert all tests pass.

**Checkpoint**: Local MVP — `bun run adr -- queue` is fully operational. Independently
testable with fixture corpora. Exits correctly on error-severity findings. Deterministic.

---

## Phase 5: GitHub Action (US4)

**Purpose**: Implement the managed-issue state machine, Octokit adapter, and Action
entrypoint; write pure and adapter tests with a fake client; build and include the
committed-bundle artifact in the feature change set.

**Blocked by**: Phase 3 (`buildQueueReport`, `formatQueueReportMarkdown` available).

**Independent Test (US4)**: `bun test packages/ci` passes; all fake-client
state machine and pagination tests green; `packages/ci/dist/queue-action.js` exists;
smoke test (`node scripts/smoke-queue-node.mjs`) fails at corpus-load boundary with
a known error, no network call, no module-resolution error.

### RED: write failing Action tests first

- [ ] T034 [P] [US4] Write failing pure managed-issue tests in
  `packages/ci/test/queue-issue.test.ts` using a hand-rolled fake `GitHubQueueClient`
  (no token, no network):
  all 5 state machine branches per `contracts/github-action.md`:
  (A) 0 managed + no title conflict → `createIssue` called once;
  marker `<!-- adrkit-managed-queue-issue -->` is exactly the first line of body;
  (B) 0 managed + 1 open title conflict → fail, no write, error message names `#N`;
  (C) 0 managed + 1 closed title conflict → fail (closed unowned conflicts too), no write;
  (D) 0 managed + 2 conflicts (open+closed) → all numbers named in ascending order, no write;
  (E) 1 managed open → `updateIssue({body})` called once (body only, no `state` field);
  (F) 1 managed closed → single `updateIssue({body, state:'open'})` call; NOT two calls;
  (G) 2+ managed → fail naming both numbers, no write;
  marker detection:
  (H) `body === MARKER` → managed;
  (I) `body.startsWith(MARKER + "\n")` → managed;
  (I2) `MARKER + "\r\n" + report` → managed (CRLF first-line handling);
  (I3) `MARKER + "\r" + report` → managed (bare-CR first-line handling);
  (J) marker at line 2 (newline before marker) → NOT managed;
  (K) leading whitespace before marker → NOT managed;
  (L) `createIssue` throws 403 → no partial write; error propagated to caller;
  (M) `updateIssue` throws 403 → prior issue state remains authoritative and the error
  propagates to the caller;
  (N) a pure `publishQueueReport` helper given an error-bearing QueueReport records
  events in exact order `update issue → set issue-number output → setFailed`, with the
  exact error-count/issue-number message; a clean report omits `setFailed`.
  GraphQL issue-only pagination and report-error translation are adapter/entrypoint
  concerns except for the pure publish-order helper above; `managedQueueIssue` itself
  receives neither raw API nodes nor a QueueReport.
  Run `bun test packages/ci/test/queue-issue.test.ts`; record
  `Cannot find module '../src/queue-issue'` failure.

- [ ] T035 [P] [US4] Write failing Octokit adapter tests in
  `packages/ci/test/queue-adapter.test.ts` using a fake Octokit (no token, no network):
  target a side-effect-free `createOctokitQueueClient` export in the new
  `packages/ci/src/queue-github-client.ts` module (not the executable entrypoint);
  (a) `listAllIssues()` exhausts every cursor page from the GraphQL
  `repository.issues(states:[OPEN,CLOSED])` connection (fake returns 100+ issue nodes
  split across multiple pages; assert all are collected in page order);
  (b) the query requests only issue nodes with `number`, `state`, `title`, and `body`;
  assert the adapter never calls REST `issues.listForRepo` or the Search API;
  (c) GraphQL `OPEN`/`CLOSED` states map exactly to client `open`/`closed`;
  (d) an exported pure `handleGitHubApiError(error, setFailed)` maps both status 401
  and 403 to the exact `issues: write` guidance, invokes `setFailed` once (therefore a
  non-zero Action outcome), and maps other API failures to an explicit generic failure.
  Run test; record `Cannot find module` failure.

### GREEN: implement Action modules

- [ ] T036 [US4] Create `packages/ci/src/queue-issue.ts`:
  export `MARKER = "<!-- adrkit-managed-queue-issue -->"` constant;
  export `GitHubQueueClient` interface with exactly:
  `listAllIssues(): Promise<Array<{number:number; state:"open"|"closed"; title:string; body:string|null}>>`,
  `createIssue(title:string, body:string): Promise<{number:number}>`,
  `updateIssue(issueNumber:number, update:{body:string; state?:'open'}): Promise<void>`;
  export `managedQueueIssue(markdownReport:string, client:GitHubQueueClient,
  issueTitle:string): Promise<{issueNumber:number}>`:
  implement all 5 state machine branches (create/update-open/update-closed/conflict-fail/
  duplicate-fail) per `contracts/github-action.md`; marker ownership is exact first-line
  equality using `(body ?? "").split(/\r\n|\n|\r/, 1)[0] === MARKER`;
  do NOT receive a full `QueueReport`; do NOT return `errorFindingsPresent`;
  also export the pure `publishQueueReport` helper tested in T034, accepting a
  QueueReport, rendered Markdown, GitHubQueueClient, issue title, and injected
  `setOutput`/`setFailed` callbacks; it MUST call `managedQueueIssue`, set
  `issue-number`, then call `setFailed` only when the report contains error-severity
  CorpusFindings;
  no `@actions/core` or `@actions/github` imports in this file.
  Run `bun test packages/ci/test/queue-issue.test.ts`; assert green.

- [ ] T037 [US4] Create `packages/ci/src/queue-action-entrypoint.ts`:
  confine ALL `@actions/core` and `@actions/github` imports to this file only;
  read `dir`, `token`, `issue-title` via `core.getInput`;
  resolve `workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()`;
  call `lintCorpus({dir, cwd:workspace})` — if this throws, call `core.setFailed` and
  return BEFORE constructing Octokit (corpus-load failure before GitHub client);
  resolve `asOf = new Date().toISOString().slice(0,10)` at this boundary;
  call `buildQueueReport({corpus, asOf})`;
  call `formatQueueReportMarkdown(report)`;
  first create `packages/ci/src/queue-github-client.ts` with the side-effect-free
  structural GraphQL Octokit adapter tested in T035 (no `@actions/*` import), then construct
  `createOctokitQueueClient(octokit, owner, repo)` from the entrypoint, where
  `owner` and `repo` are split from `process.env.GITHUB_REPOSITORY`;
  call `publishQueueReport` with callbacks backed by `core.setOutput` and
  `core.setFailed`; the helper owns the write → output → conditional-failure ordering
  and exact `"Queue report contains ${n} corpus error(s). See issue #${issueNumber} for details."`
  message;
  route every GitHub API failure through the tested `handleGitHubApiError` helper; 401
  and 403 call
  `core.setFailed("GitHub API returned ${status}: insufficient permissions. Ensure the workflow grants 'issues: write' to the GITHUB_TOKEN.")`,
  while every other failure becomes an explicit generic `setFailed` outcome rather than
  a success-shaped result.
  Create `packages/ci/queue/action.yml` with EXACT content from contract:
  `name: "ADR ARB Queue"`;
  inputs: `dir` (required:false, default:`docs/adr`), `token` (required:false,
  default:`${{ github.token }}`), `issue-title` (required:false, default:`ADR ARB Queue`);
  outputs: `issue-number` (description as in contract);
  author: `adrkit`; branding: `icon: inbox`, `color: blue`;
  `runs: {using: "node24", main: "../dist/queue-action.js"}`.
  Run `bun test packages/ci/test/queue-adapter.test.ts`; assert green.

- [ ] T038 [US4] Update `packages/ci/package.json` `build` script to:
  `"rm -rf dist && bun build ./src/index.ts --target=node --conditions bun --outfile=dist/index.js && bun build ./src/queue-action-entrypoint.ts --target=node --conditions bun --outfile=dist/queue-action.js"`;
  no new `"exports"` subpath; `@adrkit/ci` remains private/unpublished.
  Validate deterministic rebuild: run `bun run --filter @adrkit/ci build` twice;
  compare SHA-256 of `dist/queue-action.js` across both runs; assert hashes identical.

- [ ] T039 [US4] Build and include `packages/ci/dist/queue-action.js` in the feature
  change set (do not create a commit unless the user explicitly requests it):
  run `bun run --filter @adrkit/ci build`; verify `dist/queue-action.js` exists and
  `dist/index.js` is unchanged; verify `packages/ci/queue/action.yml` `main:
  ../dist/queue-action.js` resolves correctly from `packages/ci/queue/` to
  `packages/ci/dist/queue-action.js`.

- [ ] T040 [US4] Write `scripts/smoke-queue-node.mjs` bundle smoke test per
  `contracts/github-action.md` §Bundle Smoke Tests: spawn the committed
  `packages/ci/dist/queue-action.js` with `node` (do NOT import in-process; do NOT
  use `--help`); set a temporary `GITHUB_WORKSPACE` pointing to a directory whose
  `INPUT_DIR` corpus subdirectory does not exist; set `INPUT_DIR`, `INPUT_TOKEN`,
  `INPUT_ISSUE-TITLE`, `GITHUB_REPOSITORY=owner/repo`, `GITHUB_TOKEN=fake_token`;
  assert: process exits non-zero; stderr/stdout contains corpus-load error message
  (not a module-resolution or import error); NO Octokit is constructed, NO network
  call occurs before the process exits.
  Run `node scripts/smoke-queue-node.mjs`; assert it passes.
  Note: Node 22/24 coverage is validated by the existing CI matrix (`ci.yml`);
  do not require local runtimes beyond what is available.

- [ ] T041 Wire and validate Node smoke boundaries: update `scripts/smoke-node.mjs` to
  invoke the built `packages/cli/dist/index.js queue` against a committed fixture with
  explicit `--as-of` and `--format json`, asserting `version:"1"` and expected items;
  add `node scripts/smoke-queue-node.mjs` to the existing Node 22/24
  `node-smoke-built-artifacts` matrix in `.github/workflows/ci.yml`; update the installed
  tarball smoke generated by `scripts/release-pack.ts` and its existing tests to execute
  the installed `adr queue` command under the same Node matrix. Run
  `bun run --filter @adrkit/ci typecheck && bun test packages/ci`; run both smoke scripts
  on the available local Node runtime and rely on the existing CI matrix for Node 22/24.

**Checkpoint**: Action creates/updates managed issues using fake client; bundle
committed; queue and existing smoke tests pass.

---

## Phase 6: Quality Gates, Dogfood, Documentation, and Release Gate

**Purpose**: Run all quality suites in progression, maintainer dogfood, documentation
milestones, and the rung-6 external exit gate.

**Blocked by**: Phases 1–5 complete.

### Scope and boundary validation

- [ ] T042 Scope/boundary gate — run `bun run check:deps`; assert `core-has-no-adapter-deps`
  gate green: no import path in `@adrkit/core` reaches `@adrkit/ci`, `@adrkit/mcp`,
  `@adrkit/evaluator`, or `@actions/*`; inspect ONLY the files changed in this feature
  for scope-creep markers: no fifth tool, no persistent DB call, no notification
  system, no model/embedding call, no PAT usage in any new source file, no write path
  into decision records, no multi-repository federation, no new public package.

### Full test suite gate

- [ ] T043 Full suite gate — in sequence: `bun run typecheck && bun run build &&
  bun run lint && bun run check:deps && bun run schema:emit`; assert `schema:emit`
  diff is empty (no change to `schema/adr.schema.json`); then `bun test`; assert all
  tests pass with no failures or skips.

- [ ] T044 Dist reproducibility gate — hash both files in `packages/ci/dist`, run
  `bun run --filter @adrkit/ci build` again, and assert both hashes are unchanged;
  inspect `git diff -- packages/ci/dist` to confirm only the expected feature bundle
  changes are present. After the feature change is committed, CI's existing post-build
  `git diff --exit-code packages/ci/dist` enforces committed parity on every push.

- [ ] T045 Release pack validation — run
  `bun run release:pack -- --skip-build` using the existing coordinated pack script;
  inspect the core and CLI public tarballs for presence of new exports
  (`fingerprintOf`, `buildQueueReport`, `formatQueueReportJson`,
  `formatQueueReportMarkdown`, `compareCodeUnits`); run the generated installed-tarball
  smoke and confirm `adr queue` succeeds; verify no tarball is produced for private
  `@adrkit/ci`; verify Action distribution is confirmed via committed bundle path only,
  not npm tarball.

### Maintainer dogfood

- [ ] T046 Maintainer dogfood — run
  `bun run adr -- queue --dir docs/adr --as-of <today> --format json | tee /tmp/mr.json`;
  assert file is valid JSON; assert `JSON.parse(fs.readFileSync("/tmp/mr.json")).version === "1"`;
  state item and corpus-finding counts conditionally from actual corpus state (do NOT
  assert "all accepted" unless you verify no proposed records exist); run a second time
  with the same explicit `--as-of <today>`; `diff /tmp/run1.json /tmp/run2.json` → exit 0
  (SC-001 determinism); assert Markdown default output heading is
  `# ARB Queue — <today>`.

### Documentation milestones (in-progress)

- [ ] T047 Update root `plan.md` Phase 6 status to `in progress` (implementation
  complete, rung-6 external gate not yet cleared); update `CLAUDE.md` to document
  `adr queue` command usage. Do NOT update root plan.md to `landed`; do NOT reference
  a nonexistent release tag.

### External dogfood gate (SC-004 — rung-6 exit gate)

- [ ] T048 (SC-004) External dogfood gate — in a **separate team's repository** (not
  the maintainer's own): configure the queue Action at the implementation commit SHA
  or an available release tag (record the exact ref used); add at least **3 `proposed`
  ADRs spanning ALL THREE tiers** (`auto`, `async`, `arb`); include at least one ADR
  that is overdue or at the SLA-due boundary as of the run date; include at least one
  ADR with both `review.approvals` entries AND `review.objections` entries in its
  frontmatter; trigger the Action → assert exactly one managed issue is created on
  the first run (title `ADR ARB Queue` by default); trigger the Action again → assert
  the SAME managed issue body is updated in place (no new issue created, no duplicate);
  confirm default `GITHUB_TOKEN` with `contents:read` + `issues:write` is the only
  credential used; verify no installation, runtime, or permission blockers encountered;
  document evidence (issue URL, workflow run URLs, ref used) and link in this task.
  **This task gates the `landed` claim for rung 6.**
  Depends on: T043, T044, T045, T046, T047.

### Post-SC-004 documentation (landed)

- [ ] T049 After SC-004 (T048) clears: update root `plan.md` Phase 6 row to `landed`
  with a link to the T048 evidence; update `CLAUDE.md` to reflect final state; update
  `README.md` with `adr queue` and Action usage using the exact validated commit SHA.
  Advertise `mbeacom/adrkit/packages/ci/queue@v0` only after the moving `v0` tag has
  actually been updated to a release containing the queue bundle. Do NOT update to
  `landed` before T048 passes.

---

## Dependency Graph

```
Phase 1: T001 → T002–T012 [P all]

Phase 2: T013 [P]
         T014 [P] → T016 [P]
         T013 + T016 → T015 → T017 → T018 [P] + T019 [P] → T020

Phase 3: T020 → T021 [P] + T022 [P] + T023 [P] + T024 [P]
              → T025 → T026 [P] + T027 [P] → T028 → T029 → T030

Phase 4: T030 → T031 → T032 → T033

Phase 5: T033 (needs core) → T034 [P] + T035 [P] → T036 → T037 → T038 → T039 → T040 → T041

Phase 6: T041 → T042 → T043 → T044 → T045 → T046 → T047 → T048 → T049
```

**Parallel opportunities by phase**:
- Phase 1: T002–T012 simultaneously (11 distinct fixture files, no shared paths)
- Phase 2: T013+T014 simultaneously (different test files); T016 starts after T014,
  then T015 starts after both T013 and T016 because fingerprinting imports the promoted
  comparator; T018+T019 simultaneously after T017 (different MCP files)
- Phase 3: T021–T024 simultaneously (4 different test files); T026+T027 simultaneously
  after T025 (different source files)
- Phase 5: T034+T035 simultaneously (different test files)
- Phases 4 and 6: sequential within each phase

---

## Implementation Strategy

**Local MVP** (independently testable, not yet independently releasable):
Phases 1–4, T001–T033. Delivers `bun run adr -- queue` with correct kernel, all 7 SLA
states, corpus/item finding distinction, deterministic JSON and Markdown output. Can
be dogfooded locally; no Action or external gate required.

**Full Phase 6 delivery**: Phases 1–5, T001–T041, plus quality gates T042–T046. All
functionality complete and smoke-tested.

**Rung-6 landed / release-ready**: Only after T048 (SC-004 external dogfood gate)
completes and T049 updates documentation to `landed`. The external gate requires a
team separate from the maintainer's own. Calling the feature "landed" before T048 is
a protocol violation (Assumption A7, R10).
