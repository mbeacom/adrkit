---
description: "Task list for MADR Migration (Phase 2)"
---

# Tasks: MADR Migration (Phase 2)

**Input**: Design docs from `specs/003-migration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/migrate-and-reimport.md
**Normative**: [ADR-0008](../../docs/adr/0008-import-and-migration-semantics.md).

**Tests**: REQUIRED. SC-001..007 and Principle IV/V require byte-preservation,
idempotency, per-status mapping, provenance, and a four-bucket classifier matrix.

**Toolchain**: Bun. **Use stable Bun (`/tmp/bun-stable/bin/bun`, 1.3.14) for
`bun install`** — the env default is a canary that writes an unreadable lockfile.
Keep `bun.lock` at lockfileVersion 1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unbuilt file)
- **[Story]**: US1 (migrate in place), US2 (provenance), US3 (re-import), or
  SETUP/FOUND/POLISH.

---

## Phase 1: Setup

- [x] T001 [P] Create the `packages/core/src/import/` module skeleton
  (`index.ts`, `madr.ts`, `merge.ts`, `fingerprint.ts`, `status.ts`, `classify.ts`)
  with typed signatures per `contracts/migrate-and-reimport.md`, exported from
  `packages/core/src/index.ts`. No new third-party dep (uses `yaml`, `zod`,
  `node:crypto`); confirm `check:deps` stays green.

## Phase 2: Foundational (blocking)

- [x] T002 Implement `import/madr.ts` — MADR recognition (leading `---` fence
  and/or top-level `# title`, per A1) and read via the existing Phase 0
  frontmatter parser, returning `{ frontmatter, body, path }` with body bytes
  preserved. Non-MADR files → a typed "not madr" result (no throw).
- [x] T003 Implement `import/fingerprint.ts` — `sha256(normalize(sourceBody))`
  via `node:crypto` (normalize line endings to `\n`, single trailing newline).
  Deterministic; hashes the source body, NOT adrkit frontmatter (R4).
- [x] T004 Implement `import/status.ts` — map source status per R3
  (recognized→same; unknown→`proposed` + `import-status-unrecognized` finding).
- [x] T005 Extend `packages/core/src/validate/findings.ts` with rule ids
  `import-incomplete` (info), `import-status-unrecognized` (info/warn),
  `import-not-madr` (warn); keep deterministic sort.

**Checkpoint**: core can recognize, read, fingerprint, and status-map a MADR file.

## Phase 3: User Story 1 — Migrate in place (Priority: P1) 🎯 MVP

- [x] T006 [US1] Implement `import/merge.ts` — compute adrkit frontmatter (fill
  only missing required fields; preserve present valid values), emit canonical
  key order + deterministic YAML, and produce the full file text as
  `<frontmatter>\n<original body bytes>` (R1/R2). No `importedAt` written (R2).
- [x] T007 [US1] Implement `import/index.ts` `migrateMadr({dir, files?, ...})`
  first pass (no re-import yet): discover MADR files, migrate each in place,
  collect per-file outcomes + findings; non-MADR → skipped + `import-not-madr`.
  Deterministic id assignment for files lacking an id (A2, reuse scaffold's
  next-id logic).
- [x] T008 [US1] Add `migrate` to `packages/cli/src/index.ts` dispatch:
  `adr migrate --from madr [--dir] [--dry-run] [--json]`; `--from` other than
  `madr` → usage error (exit 2); `--dry-run` computes without writing; human +
  `--json` output per contract; exit 0 even with diverged entries.
- [x] T009 [P] [US1] Tests `packages/core/test/migrate-inplace.test.ts`: body
  bytes byte-identical after migrate; frontmatter added; `adr lint`/contract
  accepts result; a later `---` in the body is preserved; non-MADR file skipped.
- [x] T010 [P] [US1] Tests `packages/core/test/migrate-idempotent.test.ts`: second
  `migrateMadr` run yields byte-identical files (no diff) (SC-002).
- [x] T011 [P] [US1] Tests `packages/core/test/migrate-status.test.ts`: each
  recognized status preserved; an unrecognized status → `proposed` +
  `import-status-unrecognized` finding (SC-003).

**Checkpoint**: `adr migrate --from madr` migrates a corpus in place, idempotently;
`adr lint` accepts it (SC-001).

## Phase 4: User Story 2 — Provenance & import-incomplete (Priority: P1)

- [x] T012 [US2] In `merge.ts`, populate `provenance.importedFrom`
  (`sourceKind:'madr'`, `sourceRef`, `fingerprint`) for every migrated record
  (R4/FR-004).
- [x] T013 [US2] Implement `packages/core/src/validate/import-incomplete.ts` — the
  `import-incomplete` lint rule (info) for records with `importedFrom` present but
  missing same-status required fields (e.g. accepted w/o deciders); wire it into
  `adr lint`'s finding set.
- [x] T014 [P] [US2] Tests `packages/core/test/migrate-provenance.test.ts`:
  `importedFrom` + stable `fingerprint` (same across runs for unchanged source,
  SC-004); an `accepted` record with no deciders validates (no error) and yields
  exactly one `import-incomplete` info (SC-005).
- [x] T015 [P] [US2] Tests `packages/core/test/import-incomplete.test.ts`: rule
  fires on the gap, is silent when the record is complete, and never errors.

**Checkpoint**: imported records are honest about provenance; gaps are visible, not blocking.

## Phase 5: User Story 3 — Re-import classifier (Priority: P2)

- [x] T016 [US3] Implement `import/classify.ts` `classifyReimport(sourceEntries,
  existingRecords, recordEdited)` — pure; returns a bucket per entry per the
  ADR-0008 table (R5); `diverged` = source changed AND record edited since import.
- [x] T017 [US3] Wire re-import into `migrateMadr`: when a record already carries a
  matching `importedFrom`, classify and act — `updated` writes in place,
  `unchanged` no-op, `diverged` is report-only (leave file untouched, add to
  `divergence`), `new` creates (FR-007/FR-008). Surface the divergence report in
  the CLI output.
- [x] T018 [P] [US3] Tests `packages/core/test/reimport-classify.test.ts`: the full
  new/updated/diverged/unchanged matrix; a diverged record is left byte-identical
  on disk; classifier purity (identical inputs → identical output) (SC-006).

**Checkpoint**: re-import is safe and non-destructive; diverged never overwritten.

## Phase 6: Real corpus & Polish

- [ ] T019 [P] Vendor a small real-world MADR sample under
  `packages/core/test/fixtures/madr-corpus/` (respect source license/attribution;
  varied statuses, block scalars) and add a test migrating it in place + asserting
  body-preservation and `adr lint` clean (SC-007). If licensing blocks vendoring,
  use a realistic synthetic corpus and document the external command.
  (Partial — left unchecked: a synthetic, real-world-shaped fixture and
  `packages/core/test/migrate-real-corpus.test.ts` landed and pass, but SC-007's
  "at least one real public MADR corpus, not a fixture" bar (ADR-0008) is not met —
  no external corpus is vendored and no external command is documented. The
  real-corpus round-trip is the rung-2 outcome-ladder gate in `plan.md`
  ("`adr migrate --from madr` round-trips a real third-party corpus") and remains
  open.)
- [x] T020 Document round-trip as explicitly unsupported (FR-010) — a short note in
  the CLI help/`--from` error and in the feature quickstart, citing ADR-0008.
- [x] T021 Run the full gate with **stable Bun 1.3.14**: `bun install`,
  `bun run typecheck`, `bun test` (incl. real-corpus + classifier), `bun run
  build`, `bun run lint`, `bun run check:deps`, `bun run schema:emit && git diff
  --exit-code schema/adr.schema.json` (must be clean — no schema change), and the
  Node smoke. All green.
- [x] T022 [P] Manually run `adr migrate --from madr --dry-run` then a real run and
  a second run per quickstart; confirm idempotency (empty `git diff` on run 2) and
  the divergence report shape; clean up any scratch fixtures.

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T005) block all stories.
- US1 (T006–T011) is the MVP; land first (in-place + idempotent + status).
- US2 (T012–T015) depends on the merge writing provenance; ships with US1 for a
  complete first migration.
- US3 (T016–T018) depends on Foundational + US1's migrate path.
- Real-corpus/polish (T019–T022) last.

## Parallel Opportunities

- `[P]` test tasks run together once their target module exists.
- Fingerprint (T003), status (T004), and findings (T005) are independent and
  parallelizable after the skeleton.

## Implementation Strategy (MVP first)

1. Setup + Foundational.
2. US1 in-place migrate + idempotency + status → verify SC-001/002/003 (MVP).
3. US2 provenance + import-incomplete.
4. US3 four-bucket re-import (diverged report-only).
5. Real-corpus exercise, then full verification with stable Bun.
