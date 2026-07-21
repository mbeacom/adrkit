# Specification Quality Checklist: ARB Operations Queue

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-20
**Revised**: 2026-07-20 (maintainer resolutions 1–7 applied)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders (and technical leads)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (Out of Scope section enumerates thirteen explicit exclusions
      including GitHub Actions upload artifacts, tracked repository files for queue output,
      PR comments, issue comments, and PATs as explicit additions from revision)
- [x] Dependencies and assumptions identified (eleven assumptions; normative ADRs listed)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User stories cover primary flows (CLI queue read, SLA determinism, corpus findings vs
      item findings distinction, GitHub Actions managed issue lifecycle, `auto`-tier safety)
- [x] Feature meets measurable outcomes defined in Success Criteria (SC-001 through SC-008)
- [x] No implementation details leak into specification

## Notes

- All checklist items pass. Zero [NEEDS CLARIFICATION] markers. The feature description
  was sufficiently detailed to make informed decisions on all critical items (SLA state
  precedence, `auto`-tier semantics, `reviewBy`-vs-`slaDays` precedence, `not-queued`
  vs `missing-sla` distinction, GitHub Actions default-token-only operation, corpus-vs-item
  finding split, GitHub issue surface specifics). These decisions are recorded explicitly
  in the FR-005 precedence table and Assumptions A3, A5, A8, A9.
- **Seven-state `slaState` model** (`decided`, `escalated`, `overdue`, `due`, `within-sla`,
  `missing-sla`, `not-queued`). The former `invalid` state has been removed: files with
  schema-invalid frontmatter or unsatisfied cross-field invariants (including `one-way-door`
  + `tier: auto`) do not become `QueueItem`s at all and receive no `slaState`. They appear
  exclusively in the `QueueReport`'s top-level `corpusFindings` collection as
  `CorpusFinding`s with `sourcePath` and parser/validator details but no fabricated fields.
  This two-path model — `CorpusFinding` (corpus level) vs `ItemFinding` (item level) — is
  recorded in FR-001, FR-015, FR-017, and the Key Entities section.
- **UTC calendar-date deadline arithmetic**: `deadlineDate` = `queuedAt` + `slaDays`
  calendar days. With `queuedAt 2026-01-01` and `slaDays 7`, `deadlineDate` is
  `2026-01-08`; Jan 7 is `within-sla`, Jan 8 is `due`, Jan 9 is `overdue`. All
  boundary examples in US2 scenario 2 and FR-005 reflect this arithmetic. `slaDays 0`
  means `deadlineDate` = `queuedAt` (due on queue date, overdue the next calendar day).
- **GitHub Actions surface** is exactly one dedicated GitHub issue (body = deterministic
  Markdown report + stable hidden ownership marker). Not a tracked file, not a GitHub
  Actions upload artifact, not a PR comment, not an issue comment. First run creates it;
  subsequent runs locate it by the hidden marker and update the body in place.
  Uses `GITHUB_TOKEN` with `issues: write` only; no PAT. Permission failures name
  `issues: write` explicitly. Title conflict (existing issue without ownership marker)
  causes a non-zero exit rather than an overwrite (FR-020, A5, A9).
- **FR-006 urgency group order** updated to seven states (removed `invalid`):
  `overdue` → `escalated` → `due` → `within-sla` → `missing-sla` → `not-queued` → `decided`.
- The "Out of Scope" section enumerates the full explicit exclusion list from the feature
  brief, supplemented by the four GitHub surface non-forms (upload artifact, tracked file,
  PR comment, issue comment) and PATs, co-located with requirements for planning reference.
- Task generation and implementation may proceed after this scoping passes. SC-004
  (separate-repository/team dogfood) gates only the `landed`/release-ready claim.
