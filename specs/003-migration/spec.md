# Feature Specification: MADR Migration

**Feature Branch**: `003-migration`
**Created**: 2026-07-18
**Status**: Draft
**Phase**: 2 (outcome ladder rung 2)
**Normative source**: [ADR-0008](../../docs/adr/0008-import-and-migration-semantics.md). Where this spec and ADR-0008 disagree, the ADR wins.

## Overview

Phase 0 made records valid; Phase 1 made them locatable. This phase lets an
adopter **bring an existing decision corpus in** without leaving git or losing
history. Because the adrkit schema is a strict MADR superset (ADR-0002), migrating
a MADR file means **adding frontmatter and leaving the body untouched** — the file
stays a valid MADR file, existing MADR tooling keeps rendering it, and there is no
second copy to drift from.

`adr migrate --from madr` performs that in-place, idempotent migration. Re-running
against an upstream source is **one-way** (no round-trip sync): each imported
record carries a source fingerprint, and re-import classifies every entry into
exactly one of four buckets — **new / updated / diverged / unchanged** — where a
**diverged** record (changed on both sides) is *reported, never overwritten*.

## User Scenarios & Testing

### User Story 1 — Migrate a MADR corpus in place (Priority: P1) 🎯 MVP

As a team with an existing MADR corpus, I run `adr migrate --from madr` and my
records gain adrkit frontmatter while their prose is untouched, so the same files
keep rendering in my existing tooling and now also validate with `adr lint`.

**Why this priority**: This is rung 2 ("someone else's existing corpus can move
in") and the primary adoption path. It is independently valuable and is the MVP.

**Independent Test**: Run migration over a directory of real MADR files; assert
every output file's body bytes are unchanged, adrkit frontmatter was added, and
`adr lint` accepts the results.

**Acceptance Scenarios**:

1. **Given** a MADR file with a recognized status and a title, **When** I run
   `adr migrate --from madr`, **Then** the file gains adrkit frontmatter (`id`,
   `title`, `status`, `date`, `schemaVersion`, `provenance.importedFrom`) and its
   markdown body below the frontmatter is byte-for-byte identical.
2. **Given** a MADR file with a status adrkit recognizes
   (`accepted`/`proposed`/`deprecated`/`superseded`), **When** I migrate, **Then**
   that status is preserved, not defaulted.
3. **Given** a MADR file whose status adrkit does not recognize, **When** I
   migrate, **Then** its status becomes `proposed` and an `import-incomplete` (or
   status-specific) finding is emitted — the source value is never silently kept
   nor silently discarded without a finding.
4. **Given** a file that has **already been migrated**, **When** I run
   `adr migrate --from madr` again, **Then** it is a no-op (no diff), i.e.
   migration is idempotent.

### User Story 2 — Imported records are honest about provenance (Priority: P1)

As a reviewer, I can see that a migrated record was imported (not authored here),
including a stable source fingerprint, so its `accepted` status is traceable and
its missing deciders are explained rather than fabricated.

**Why this priority**: ADR-0008/ADR-0002 make provenance the mechanism that lets
an imported record be `accepted` without deciders. Without it, migration either
fabricates deciders (dishonest) or fails validation (blocks adoption). It ships
with US1.

**Independent Test**: Migrate a MADR file with `accepted` status and no deciders;
assert the result validates (no deciders-required error) because
`provenance.importedFrom` is present, and that an `import-incomplete` info finding
flags the gap.

**Acceptance Scenarios**:

1. **Given** an `accepted` MADR record with no deciders, **When** I migrate,
   **Then** `provenance.importedFrom` is populated (`sourceKind: madr`,
   `sourceRef`, `fingerprint`) and `adr lint` does not raise a deciders-required
   error for it.
2. **Given** the same record, **When** I lint it, **Then** an `import-incomplete`
   finding at `info` severity flags the missing deciders so the gap is visible and
   backfillable.
3. **Given** a migrated record, **When** I inspect `provenance.importedFrom`,
   **Then** the `fingerprint` is a deterministic content hash of the source entry
   at import time.

### User Story 3 — Re-import classifies changes without overwriting judgment (Priority: P2)

As an adopter re-running migration after the upstream corpus moved, I want each
entry classified as new / updated / diverged / unchanged, and I never want a
record I edited to be silently overwritten by regenerated upstream text.

**Why this priority**: This is the one-way-with-diff guarantee that makes repeated
migration safe. It is essential for ongoing use but not required for a first
migration (US1).

**Independent Test**: Given a prior migration, run a second pass with a modified
source and a locally-edited record; assert the classifier assigns the correct
bucket to each entry and that a diverged record is left unchanged on disk.

**Acceptance Scenarios**:

1. **Given** a source entry whose fingerprint has never been seen, **When** I
   re-import, **Then** it is classified **new** and a record is created.
2. **Given** a source entry whose content changed while its record was untouched
   since import, **When** I re-import, **Then** it is **updated** in place.
3. **Given** a source entry that changed **and** whose record was also edited
   locally since import, **When** I re-import, **Then** it is **diverged**,
   **reported only**, and the on-disk record is left unchanged.
4. **Given** a source entry and record that are both unchanged, **When** I
   re-import, **Then** it is **unchanged** (no-op).

### Edge Cases

- **A file that is not MADR** (no recognizable frontmatter/title) in the target
  directory: skipped with a finding, not a crash.
- **Body already containing a `---` line** further down: only the leading
  frontmatter fence is treated as frontmatter; body bytes (including later `---`)
  are preserved exactly.
- **A MADR file that already has partial adrkit frontmatter**: migration fills
  only missing required fields and remains idempotent; existing values are not
  overwritten.
- **Duplicate ids across migrated files**: surfaced by `adr lint`'s existing
  unique-id invariant, not silently renumbered.
- **Missing/empty title**: reported as a finding; the file is not migrated to an
  invalid record.
- **Re-import where the source entry was deleted upstream**: the local record is
  retained (one-way; deletion is not propagated) — optionally noted in the report.

## Requirements

### Functional Requirements

- **FR-001**: `adr migrate --from madr [--dir <path>]` MUST add adrkit frontmatter
  to each MADR record **in place**, leaving the markdown body **byte-for-byte
  unchanged**. The result MUST remain a valid MADR file.
- **FR-002**: Migration MUST be **idempotent** — re-running on an already-migrated
  file produces no diff.
- **FR-003**: Source status MUST be **preserved**, not defaulted: `accepted`,
  `proposed`, `deprecated`, and `superseded` map directly. An **unrecognized**
  status becomes `proposed` and MUST emit a finding.
- **FR-004**: Each migrated record MUST carry `provenance.importedFrom` with
  `sourceKind: madr`, a `sourceRef` (source-local identifier), and a deterministic
  `fingerprint` (content hash of the source entry at import time).
- **FR-005**: The presence of `provenance.importedFrom` MUST exempt the record
  from the deciders-required invariant; a resulting gap (e.g. accepted without
  deciders) MUST surface as an `import-incomplete` finding at `info` severity, not
  an error.
- **FR-006**: Migration MUST be **deterministic** — identical inputs produce
  identical output frontmatter and identical fingerprints (Principle IV). No
  model/LLM performs the parse (ADR-0008 Option D rejected).
- **FR-007**: Re-import MUST classify every source entry into exactly one bucket —
  **new**, **updated**, **diverged**, or **unchanged** — per ADR-0008's table,
  using the stored fingerprint and a record-modified signal.
- **FR-008**: A **diverged** entry (source changed AND record edited since import)
  MUST be **report-only**: the on-disk record MUST NOT be overwritten.
- **FR-009**: Any machine write MUST be expressible as a pull request, never a
  silent in-place mutation of history (ADR-0004); the divergence report is the
  artifact a re-import produces for human action.
- **FR-010**: Round-trip sync MUST NOT be implemented; it MUST be documented as
  explicitly unsupported, with ADR-0008 as the reason.
- **FR-011**: Non-MADR or malformed files in the target set MUST be reported as
  findings and skipped, never crash the run (consistent with FR-012 of Phase 0).
- **FR-012**: The `import-incomplete` lint rule MUST be enforced by
  `adr lint` for records whose `provenance.importedFrom` is present but which are
  missing fields a locally-authored record of the same status would require.

### Key Entities

- **MADR source file**: a markdown file with MADR-style frontmatter and/or a
  title heading; the migration input.
- **Source fingerprint**: `{ sourceKind: 'madr', sourceRef, fingerprint }` stored
  under `provenance.importedFrom`; the identity + content hash that drives
  re-import classification. (Schema already defined in Phase 0.)
- **Migration result / Finding**: per-file outcome (migrated / skipped / no-op)
  plus `Finding`s (reusing the Phase 0 type), including `import-incomplete`.
- **Re-import classification**: for each entry, one of `new | updated | diverged |
  unchanged`, plus the divergence report aggregating `diverged` entries.

## Success Criteria

- **SC-001**: After `adr migrate --from madr` on a MADR corpus, every output
  file's body bytes are unchanged and `adr lint` accepts the results (0 errors).
- **SC-002**: Re-running migration on already-migrated files produces zero diff
  (idempotent).
- **SC-003**: Source statuses are preserved for all recognized values;
  unrecognized statuses become `proposed` with a finding — verified per status.
- **SC-004**: Every migrated record has a `provenance.importedFrom.fingerprint`
  that is stable across runs for unchanged source content.
- **SC-005**: An `accepted` imported record with no deciders validates (no error)
  and yields exactly one `import-incomplete` info finding.
- **SC-006**: The four-bucket classifier assigns the correct bucket for each of
  new/updated/diverged/unchanged in a controlled re-import; a diverged record is
  left byte-identical on disk.
- **SC-007**: Migration is exercised against **at least one real public MADR
  corpus** (not only a fixture), and the result validates.

## Assumptions

Documented, ADR-consistent choices (revisit at plan stage):

- **A1 — MADR recognition**: a file is treated as MADR if it has leading
  `---`-fenced frontmatter and/or a top-level `# <title>` heading; recognition
  rules are conservative and emit a finding rather than guessing when ambiguous.
- **A2 — Id assignment on migrate**: when a source file lacks an adrkit `id`, use
  the same sequential scheme as `adr new` (next `NNNN`), deterministic given the
  target directory ordering; a source-provided stable id is preserved if present.
- **A3 — Fingerprint algorithm**: a stable content hash (e.g. SHA-256) over a
  normalized representation of the source entry; the exact normalization is fixed
  at plan stage and versioned so future changes are detectable.
- **A4 — "Record edited since import" signal**: derived by comparing the current
  record's content hash against the fingerprint/known-imported state, so the
  classifier stays a pure function of supplied inputs (no reliance on git history
  at resolve time). Git-based detection, if any, produces that input upstream.

## Out of Scope

- Any import source other than MADR — agent decision logs and plan artifacts are
  later work (ADR-0008); their status rules are explicitly not implemented here.
- **Round-trip / bidirectional sync** (FR-010) — permanently out of scope per
  ADR-0008.
- The N:1 append-only agent-log split problem (blocked on a real upstream sample).
- Emitting the actual GitHub PR — the re-import produces the divergence report and
  the migrated tree; wiring it into a PR/Action surface is Phase 3.
- Running the evaluator over imported records (Phase 4, opt-in).
