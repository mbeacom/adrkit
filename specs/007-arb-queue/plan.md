# Implementation Plan: ARB Operations Queue — Phase 6

**Feature directory**: `007-arb-queue` | **Implementation branch**:
`feat/phase-6-arb-queue` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-arb-queue/spec.md` (Functional
Requirements FR-001–FR-023, Success Criteria SC-001–SC-008, Assumptions A1–A11).
**Normative sources** (ADRs win on conflict):
[ADR-0001](../../docs/adr/0001-record-architecture-decisions-in-git.md) (git is
truth; the queue is a derived, stateless, read-only projection — never writes
decision content),
[ADR-0002](../../docs/adr/0002-typed-frontmatter-as-madr-superset.md) (typed schema:
`review.tier`, `review.queuedAt`, `review.slaDays`, `review.escalatedAt`,
`review.decidedAt`, `review.quorum`, `review.approvals`, `review.objections`,
`reviewBy`, and the `one-way-door + tier:auto` cross-field invariant),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (queue
is a derived, rebuildable projection; no Postgres, no persistent index),
[ADR-0005](../../docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
(the evaluator routes, never approves; `auto` tier means expedited routing, not
automated acceptance),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation; clean-clone build; queue surface is first-party, not an adapter),
[ADR-0010](../../docs/adr/0010-bun-toolchain.md) (Bun for development; Node-targeted
published artifacts), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–V (v1.0.2).

> ⏳ **Phase 6 scoped; implementation not yet started.** Scoping (spec → plan →
> tasks) is permitted now that Phase 5 / rung 5 is landed (PR #19, v0.2.0).
> Task generation and implementation may proceed on the basis of this plan.
> **Rung 6 may not be claimed as landed** until SC-004 clears: a team that is
> not the maintainer's own completes a separate-repository dogfood with the full
> exit criteria from FR-019 (Assumption A7). SC-004 is the *exit/release gate*,
> not a pre-implementation gate.

## Summary

Build the **deterministic ARB operations queue**: a read-only projection of the local
ADR corpus that makes existing typed `review` frontmatter observable as a
continuously current, actionable workflow artifact. The deliverable has two surfaces:

1. **CLI** (`adr queue`): a local read command that accepts `--format markdown|json`
   (default `markdown`) and an optional `--as-of` date, emits the queue report to
   stdout, and exits non-zero only when the report contains `error`-severity findings.

2. **GitHub Action** (`packages/ci/queue/action.yml`): an operational surface that
   creates or updates exactly one dedicated GitHub issue using `GITHUB_TOKEN` with
   `issues: write`, locating the issue via a stable hidden ownership marker embedded
   in the issue body, updating it in place on every run, and failing after writing
   when the report contains errors.

The **pure queue kernel** (`@adrkit/core`) is a single pure function
`buildQueueReport({corpus: LintCorpusResult, asOf: string})` — it accepts a
caller-loaded corpus snapshot and an explicit `asOf` UTC calendar date, internally
maps excluded-file findings to `CorpusFinding[]`, computes the canonical corpus
fingerprint (via promoted `fingerprintOf`/`canonicalStringify`), and returns the
complete `QueueReport`. No ambient clock, no network, no filesystem traversal inside
the kernel; Node.js `crypto` (SHA-256) is deterministic and acceptable. The CLI
wraps the kernel with corpus loading and formatting; the Action wraps it identically.

The canonical corpus fingerprint helpers (`canonicalStringify`, `fingerprintOf`,
`compareCodeUnits`, and canonical ordering functions) are promoted from `@adrkit/mcp`
to `@adrkit/core`. The fingerprint input uses the original core `Finding[]` from
`lintCorpus` (not queue-mapped `CorpusFinding[]`), matching the MCP fingerprint
exactly for the same corpus projection.

The canonical JSON and Markdown formatters (`formatQueueReportJson`,
`formatQueueReportMarkdown`) live in `@adrkit/core` (`queue/format.ts`), consumed
by both the CLI and the Action. No `@adrkit/ci` → `@adrkit/cli` dependency exists.

## Technical Context

**Language/Version**: TypeScript targeting Node ≥22; Bun 1.3.14 for
development/build/test; `bun.lock` frozen.

**Primary Dependencies**: `zod@^4` (already workspace-level); `@actions/core@^1.11.1`,
`@actions/github@^6.0.1` (already in `@adrkit/ci`). No new runtime dependencies.

**Storage**: None. The queue is a stateless, read-only projection rebuilt from the
local ADR corpus on every invocation. No database, no persistent index, no tracked
report files.

**Testing**: `bun test` (all test files `*.test.ts`). Unit tests for kernel + sorting
+ finding-code mapping; integration tests against fixture corpora; contract tests for
CLI stdout/exit codes; fake `GitHubQueueClient` interface for Action tests (no token,
no network); bundle smoke test (Node 22 + 24 installed-tarball); static import-graph
check (`check:deps`) to assert kernel has no adapter dependencies.

**Target Platform**: Node ≥22, cross-platform (Linux/macOS/Windows). GitHub Actions
runner: `ubuntu-latest` (node24 runtime in `action.yml`).

**Project Type**: Multi-package workspace feature — pure library addition to
`@adrkit/core`, CLI subcommand addition to `@adrkit/cli`, Action entry addition to
private `@adrkit/ci` (new `queue/` subdirectory).

**Constraints**: No ambient clock in kernel (Principle IV, FR-004). No network after
frozen install (Principle II). No GitHub API access except in the Action adapter and
its tests via a fake client. `core-has-no-adapter-deps` gate must remain green.
All queue outputs are byte-for-byte deterministic for identical inputs (SC-001).

**Scale/Scope**: Single-repository operation; 10–100 ADR files is the expected range.
No multi-repository federation.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design below.*

### Pre-Design Check (initial)

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Git Is the Source of Truth** | ✅ PASS | Queue is a read-only derived projection. Managed GitHub issue body is the Action's output — not a decision record. No ADR file is ever written. |
| **II. Clean Clone Builds Green** | ✅ PASS | Kernel and CLI: pure, offline, credential-free. Action: GitHub API via injected fake client in tests; no token or network required in test suite. Production Action uses `GITHUB_TOKEN` at runtime only, not at build/test time. |
| **III. Core Depends on No Adapter** | ✅ PASS | Queue kernel and canonical formatters live in `@adrkit/core`. Both CLI and Action consume `format.ts` from core — no `@adrkit/ci` → `@adrkit/cli` dependency. `@adrkit/ci` queue Action imports `@adrkit/core` (allowed: `@adrkit/ci` is already an adapter-layer consumer). `@adrkit/core` imports nothing from `@adrkit/ci`, `@adrkit/mcp`, or any adapter. The `core-has-no-adapter-deps` CI gate is unaffected. |
| **IV. Deterministic Before Probabilistic** | ✅ PASS | Kernel is a pure function (corpus snapshot + asOf → QueueReport). No model calls, no ambient clock, no probabilistic step. `auto` tier = expedited routing, never automated acceptance (ADR-0005). |
| **V. The Schema Is the Contract** | ✅ PASS | Queue reads the existing `AdrFrontmatter` schema; it does not add new Zod fields. `QueueReport` v1 JSON shape is a new, separately-versioned contract defined in `contracts/queue-report.md`. No change to `schema/adr.schema.json`; `schema:emit` gate unaffected. |

No violations. Complexity Tracking table is empty.

### Post-Design Check (after Phase 1)

Re-evaluated after design artifacts are generated — see end of plan. All checks
remain PASS. See Complexity Tracking (empty — no violations).

## Project Structure

### Documentation (this feature)

```text
specs/007-arb-queue/
├── plan.md              # This file (speckit.plan output)
├── research.md          # Phase 0 output — all decisions resolved
├── data-model.md        # Phase 1 output — entities, types, finding-code mapping
├── quickstart.md        # Phase 1 output — runnable validation scenarios
└── contracts/
    ├── cli-contract.md     # CLI syntax, flags, exit-code matrix, stdout/stderr
    ├── queue-report.md     # QueueReport v1 JSON shape + Markdown canonical layout
    ├── kernel.md           # Pure kernel function signature and types
    └── github-action.md    # action.yml surface, GitHubQueueClient, state machine, error matrix
```

### Source Code (repository root)

```text
packages/
├── core/
│   ├── src/
│   │   ├── queue/
│   │   │   ├── types.ts         # QueueItem, QueueReport, SlaState, *Finding interfaces + SLA_STATE_URGENCY_ORDER
│   │   │   ├── kernel.ts        # buildQueueReport() — pure, zero-clock, zero-network; computes fingerprint internally
│   │   │   ├── sort.ts          # deterministic item/finding orderings
│   │   │   ├── findings.ts      # finding-code mapping from core Finding.rule → CorpusFinding.code (excluded files only)
│   │   │   └── format.ts        # formatQueueReportJson() + formatQueueReportMarkdown() — canonical serializers
│   │   ├── fingerprint/
│   │   │   └── index.ts         # canonicalStringify() + fingerprintOf() — promoted from @adrkit/mcp
│   │   ├── ordering/
│   │   │   └── index.ts         # compareCodeUnits() + compareFindings() + sort helpers — promoted from @adrkit/mcp
│   │   └── index.ts             # +export queue/*, fingerprint/*, ordering/*
│   └── test/
│       └── fixtures/queue/      # canonical ADR fixture corpora for kernel + CLI integration tests
│
├── cli/
│   └── src/
│       ├── queue.ts             # runQueue() — corpus loading, date resolution, calls core formatters, exit code
│       └── index.ts             # +register 'queue' command
│
└── ci/
    ├── src/
    │   ├── queue-issue.ts       # managedQueueIssue() — pure logic; GitHubQueueClient port
    │   ├── queue-github-client.ts # side-effect-free GraphQL issue adapter; cursor pagination
    │   └── queue-action-entrypoint.ts  # createOctokitQueueClient() + entrypoint; @actions/* confined here
    ├── queue/
    │   └── action.yml           # GitHub Action manifest for the queue surface
    ├── dist/
    │   └── queue-action.js      # bundled Node24 entrypoint
    └── package.json             # +new "./queue-action" build target (not a public npm export)

packages/core/test/
├── queue/
│   ├── kernel.test.ts           # Unit: slaState precedence, item orderings, finding generation, fingerprint
│   ├── sort.test.ts             # Unit: deterministic sort stability and all edge cases
│   ├── findings.test.ts         # Unit: Finding.rule → CorpusFinding.code mapping (excluded files only)
│   └── format.test.ts           # Unit: JSON/Markdown serialization byte-for-byte determinism
├── fingerprint/
│   └── fingerprint.test.ts      # Unit + compat: promoted function produces same bytes as old MCP code
└── ordering/
    └── ordering.test.ts         # Unit: compareCodeUnits, compareFindings, sort helpers

packages/cli/test/
└── queue.test.ts                 # Integration: CLI stdout/exit codes against packages/core/test/fixtures/queue/

packages/ci/test/
└── queue-issue.test.ts           # Unit: GitHubQueueClient fake; all state-machine transitions
```

**Structure Decision**: Pure kernel in `@adrkit/core`; CLI wrapper in `@adrkit/cli`;
Action adapter in `@adrkit/ci/queue/`. No new public package. See research.md §R1
for full rationale and alternatives considered.

## Phase 0: Research

Research artifacts are in [research.md](./research.md). All NEEDS CLARIFICATION items
are resolved. Summary of binding decisions:

- **R1 Package placement**: `@adrkit/core` + `@adrkit/cli` + `@adrkit/ci/queue/`
- **R2 Finding codes**: Closed list of 4 CorpusFinding codes + 3 ItemFinding codes; see research.md §R2
- **R3 QueueReport shape**: Fully typed; see contracts/queue-report.md
- **R4 CLI syntax**: `adr queue [--dir] [--as-of] [--format]`; see contracts/cli-contract.md
- **R5 Action surface**: `packages/ci/queue/action.yml`; marker constant `<!-- adrkit-managed-queue-issue -->`; see contracts/github-action.md
- **R6 Sorting**: urgency group → deadline → queuedAt → id; see research.md §R6
- **R7 Test strategy**: unit + integration + fake-client + bundle-smoke + dependency-graph; see research.md §R7
- **R8 Constitution**: All five principles PASS; see Constitution Check above
- **R9 Primitive reuse**: `canonicalStringify`/`fingerprintOf`/`compareCodeUnits`/`compareFindings`/`sortFindingsCanonical`/`sortByIdThenPath` promoted to `@adrkit/core`; MCP migrates imports; fingerprint input uses original core `Finding[]` (not queue-mapped `CorpusFinding[]`)
- **R10 Status drift**: Phase 5 merged, v0.2.0 published; Phase 6 scoped only; rung-6 gate preserved

## Phase 1: Design Artifacts

All Phase 1 artifacts are generated:

- **[data-model.md](./data-model.md)**: Entity definitions for `QueueItem`, `SlaState`,
  `ItemFinding`, `CorpusFinding`, `QueueReport`; SLA deadline computation algorithm;
  finding-code → rule mapping table; timestamp normalization rule.
- **[contracts/queue-report.md](./contracts/queue-report.md)**: `QueueReport` v1 JSON
  shape with full TypeScript types, nullability annotations, summary count semantics,
  canonical serialization (key order, undefined omission, UTF-8, final newline), corpus
  fingerprint definition, and Markdown canonical layout with escaping and empty states.
- **[contracts/cli-contract.md](./contracts/cli-contract.md)**: `adr queue` syntax,
  flag defaults, invalid-input behavior, stdout/stderr assignment, and exit-code matrix.
- **[contracts/kernel.md](./contracts/kernel.md)**: Pure kernel function signature,
  `QueueKernelInput` type, pureness assertions, and caller responsibilities.
- **[contracts/github-action.md](./contracts/github-action.md)**: `action.yml`
  inputs/defaults/outputs, `GitHubQueueClient` interface, marker constant, paginated
  issue discovery algorithm, state-machine transitions, error matrix, no-partial-write
  rule, and permissions documentation.
- **[quickstart.md](./quickstart.md)**: Runnable validation scenarios for CLI and
  Action with fixture corpus setup, expected outputs, and rung-6 exit criteria.

## Constitution Check (Post-Design)

| Principle | Final Status | Notes |
|-----------|-------------|-------|
| **I** | ✅ PASS | Queue read-only; Action writes only the managed issue body and its state; no ADR record or tracked file is ever modified. |
| **II** | ✅ PASS | Kernel is offline by construction. CLI corpus loading uses existing `lintCorpus`. Action's `@actions/github` call is gated behind `GitHubQueueClient` interface — tests use the fake, no token required. |
| **III** | ✅ PASS | `canonicalStringify`/`fingerprintOf` promoted to `@adrkit/core` are pure, network-free functions with no adapter dependency. `@adrkit/ci` depends on `@adrkit/core` (allowed; already true). `@adrkit/core` does not import anything from `@adrkit/ci`, `@adrkit/mcp`, or `@adrkit/evaluator`. |
| **IV** | ✅ PASS | Kernel has no ambient clock. CLI resolves the current UTC date only at its boundary and surfaces it in output; the Action does the same. The kernel may normalize explicit caller-supplied/frontmatter timestamps but never reads current time. `auto` tier: labeled as expedited routing in all outputs; never as acceptance. |
| **V** | ✅ PASS | No change to `AdrFrontmatter` Zod schema or emitted JSON Schema. `QueueReport` v1 is a new, independently-versioned report contract (version field: `"1"`), not part of the ADR frontmatter schema. |

## Complexity Tracking

> No Constitution Check violations. This table is intentionally empty.

## Phase 2: Task Generation

Tasks are ready to be generated with `/speckit.tasks`. All design artifacts are
complete. **Rung 6 may not be claimed as landed** until SC-004 clears: a
separate-team, separate-repository dogfood must pass the full FR-019 exit criteria
(Assumption A7). That is an *exit/release gate* — it does not block task generation
or implementation work.
