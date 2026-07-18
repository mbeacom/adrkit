# Implementation Plan: MADR Migration (Phase 2)

**Branch**: `003-migration` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-migration/spec.md`
**Normative source**: [ADR-0008](../../docs/adr/0008-import-and-migration-semantics.md).

## Summary

Let an existing MADR corpus move in without leaving git. Add
`packages/core/src/import/` with a MADR reader, a deterministic frontmatter
merger that writes adrkit fields **in place** while leaving the body bytes
untouched, a stable source **fingerprint**, and a **four-bucket re-import
classifier** (new/updated/diverged/unchanged) that never overwrites a diverged
record. Expose `adr migrate --from madr`, and add the `import-incomplete` lint
rule so imported records with gaps are flagged (info) rather than blocked. Exit
condition: migrate a real public MADR corpus in place, idempotently, and have
`adr lint` accept the result.

## Technical Context

**Language/Version**: TypeScript (ESNext), Bun (see Bun-version note); published
artifacts target Node `>=22` (ADR-0010).

**Primary Dependencies**: reuse `yaml` (frontmatter read/emit) and `zod` (schema).
A stable hash via `node:crypto` (`createHash('sha256')`) — a Node builtin, not a
third-party dep, and deterministic. No new third-party dependency expected; no
adapter, no model (ADR-0008 Option D rejected).

**Storage**: Git working tree only — markdown records under a target dir
(default `docs/adr/`). No database; re-import state is derived from the records'
own `provenance.importedFrom` fingerprints, not an external index (ADR-0004).

**Testing**: `bun test`. Byte-preservation tests (body unchanged), idempotency
tests (second run = no diff), status-mapping tests per status, provenance/
`import-incomplete` tests, and a four-bucket classifier test matrix. Plus a
migration run over a committed real-world MADR sample corpus (SC-007).

**Target Platform**: CLI + library; Linux/macOS CI; Node `>=22` consumers.

**Project Type**: Bun-workspace monorepo — extends `@adrkit/core` and `@adrkit/cli`.

**Performance Goals**: Migrate/classify hundreds of records in well under a second;
hashing is linear in source size.

**Constraints**: Deterministic (FR-006): identical inputs → identical frontmatter
and fingerprints; no clock in the fingerprint (an `importedAt` timestamp, if
written, is separate from the content hash and must not affect idempotency).
In-place and body-preserving (FR-001); diverged is report-only (FR-008);
clean-clone build stays green.

**Bun-version note**: use the pinned stable Bun (`/tmp/bun-stable`, 1.3.14) for all
installs so `bun.lock` stays lockfileVersion 1; the env default `bun` is a canary
that writes an unreadable v2 lockfile and breaks CI.

## Constitution Check

*GATE: passed before design; re-check after design. No violations.*

| Principle | Assessment |
|---|---|
| **I. Git is the source of truth** | PASS — migration writes markdown files the author commits via PR; re-import emits a divergence report, never a silent history mutation (FR-009). No database; re-import state lives in the records' own `provenance.importedFrom`. |
| **II. Clean clone builds green** | PASS — only `yaml`/`zod`/`node:crypto`; no credentials, services, or network. `clean-clone-builds` continues to guard. |
| **III. Core depends on no adapter** | PASS — MADR reader/writer live in `@adrkit/core/src/import/`; no adapter imported. (ADR-0008 anticipates future `packages/adapters/import-*` for non-MADR sources; none is built here.) `core-has-no-adapter-deps` guards the boundary. |
| **IV. Deterministic before probabilistic** | PASS — the parse and fingerprint are pure and model-free (Option D explicitly rejected). Idempotency + stable fingerprints asserted in tests. |
| **V. The schema is the contract** | PASS — migration only *populates* existing schema fields (`provenance.importedFrom` already defined in Phase 0); no record-schema change. `import-incomplete` is a lint rule over the existing contract. |

**Result**: PASS — Complexity Tracking is empty (no deviations to justify).

## Project Structure

### Documentation (this feature)

```text
specs/003-migration/
├── spec.md                        # Feature spec (done)
├── plan.md                        # This file
├── research.md                    # Decisions & rationale
├── data-model.md                  # MADR source / fingerprint / classification model
├── quickstart.md                  # How to run and verify
├── contracts/
│   └── migrate-and-reimport.md    # adr migrate CLI + classifier + lint rule contract
├── checklists/
│   └── requirements.md            # Spec quality checklist (done)
└── tasks.md                       # Produced next
```

### Source Code (repository root — extends merged Phase 0/1)

```text
packages/core/src/
├── import/
│   ├── index.ts             # public surface: migrateMadr(), classifyReimport()
│   ├── madr.ts              # MADR recognition + read (reuse parse/frontmatter)
│   ├── merge.ts             # deterministic frontmatter merge; body bytes preserved
│   ├── fingerprint.ts       # stable content hash (node:crypto sha256) + normalization
│   ├── status.ts            # source-status -> adrkit status mapping (+ finding)
│   └── classify.ts          # four-bucket re-import classifier (pure)
├── validate/
│   ├── findings.ts          # add import-incomplete rule id (info)
│   └── import-incomplete.ts # lint rule: importedFrom present but gaps remain
└── (existing load/ parse/ schema/ validate/ affects/ graph/ scaffold/)

packages/cli/src/
├── index.ts                 # add `migrate` to dispatch (adr migrate --from madr)
└── (migrate rendering: per-file result + findings + re-import buckets; --json)

packages/core/test/
├── migrate-inplace.test.ts     # body-bytes unchanged; frontmatter added; lint clean
├── migrate-idempotent.test.ts  # second run = no diff
├── migrate-status.test.ts      # per-status mapping; unknown -> proposed + finding
├── migrate-provenance.test.ts  # importedFrom + fingerprint; accepted-no-deciders ok
├── reimport-classify.test.ts   # new/updated/diverged/unchanged matrix; diverged untouched
├── import-incomplete.test.ts   # lint rule pass/fail
└── fixtures/madr-corpus/        # small real-world-shaped MADR sample (+ a committed real corpus subset for SC-007)

.github/workflows/ci.yml          # unchanged gate set (migrate covered by bun test + adr lint)
```

**Structure Decision**: All migration logic is a new `import/` module inside the
existing `@adrkit/core`, reusing the Phase 0 frontmatter parser (which already
preserves body bytes) and loader, and the Phase 0 `provenance.importedFrom`
schema. `adr migrate` is a new CLI subcommand added to the existing dispatch. The
classifier is a pure function of `(sourceEntries, existingRecords)` so it is
testable and CI-reproducible without git.

## Complexity Tracking

No constitution violations — table intentionally empty.
