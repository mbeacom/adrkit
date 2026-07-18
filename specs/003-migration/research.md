# Research & Decisions: MADR Migration (Phase 2)

Decisions resolving the Technical Context, each constrained by ADR-0008/ADR-0002
or the constitution. None reopens a settled ADR.

## R1 — In-place, additive migration (body bytes preserved)

**Decision**: Migration reads the existing file, computes the adrkit frontmatter
to add/merge, and rewrites the file as `<new frontmatter>\n<original body bytes>`.
The body (everything after the leading `---` fence, or the whole file if there is
no fence) is preserved byte-for-byte via the Phase 0 frontmatter parser, which
already returns the raw body.

**Rationale**: ADR-0002 makes the schema a strict MADR superset, so adding
frontmatter keeps the file a valid MADR file (ADR-0008: "additive and in place").
Preserving body bytes is what makes existing MADR renderers keep working and
avoids a second copy to drift from.

**Alternatives rejected**: writing a new file alongside (creates drift — the exact
thing ADR-0008 avoids); re-serializing the body through a markdown AST (would
perturb bytes and break idempotency).

## R2 — Deterministic frontmatter emission + idempotency

**Decision**: Emit frontmatter keys in a fixed canonical order with deterministic
YAML formatting. A field already present with a valid value is preserved (not
overwritten); only missing required fields are filled. Idempotency is defined as:
re-migrating a file whose frontmatter already satisfies the contract yields
byte-identical output.

**Rationale**: FR-002/FR-006. Determinism + "fill only what's missing" is what
makes the second run a no-op. Canonical key order avoids spurious diffs.

**Note**: `provenance.importedFrom.importedAt` (a timestamp) is optional and, if
written, MUST NOT participate in idempotency or the fingerprint — otherwise a
re-run would always diff. Decision: **do not write `importedAt` by default** in
v1 (keep migration clock-free); if added later it is written once and preserved,
never refreshed on re-run.

## R3 — Status mapping

**Decision**: Map source status case-insensitively: `accepted`, `proposed`,
`deprecated`, `superseded` → same adrkit status; `rejected` and `draft` also pass
through (both are in the adrkit enum). Any other/unrecognized value →
`proposed` plus a finding naming the original value.

**Rationale**: ADR-0008's table ("preserve the source status … unrecognized values
become `proposed` with a lint finding"). The adrkit `Status` enum
(draft/proposed/accepted/rejected/superseded/deprecated) already covers the common
MADR statuses, so most corpora map directly.

## R4 — Fingerprint

**Decision**: `fingerprint = sha256(normalize(sourceEntry))` via `node:crypto`.
Normalization: the **original source body** (the MADR content adrkit did not
author) with line endings normalized to `\n` and a single trailing newline — i.e.
hash the human-authored content, not the adrkit frontmatter adrkit itself writes.
`sourceRef` = the source-local file path. Store both under
`provenance.importedFrom` (`sourceKind: 'madr'`).

**Rationale**: FR-004. Hashing the source body (excluding adrkit's own
frontmatter) is what lets re-import detect upstream content changes without adrkit
frontmatter churn falsely signaling a change. `node:crypto` is a deterministic
Node builtin — no dependency, satisfies clean-clone.

**Alternatives rejected**: hashing the whole file including adrkit frontmatter
(adrkit's own edits would look like source changes); a non-crypto hash (fine for
speed but sha256 is standard, collision-safe, and already available).

## R5 — Four-bucket re-import classifier (pure)

**Decision**: `classifyReimport(sourceEntries, existingRecords)` is a pure
function returning, per entry, one of `new | updated | diverged | unchanged`,
using: the stored `provenance.importedFrom.fingerprint` (what the source looked
like at last import), the **current** source fingerprint, and a **record-edited**
signal (whether the record's adrkit-authored content changed since import).

| Bucket | Condition |
|---|---|
| new | no existing record carries this `sourceRef` fingerprint lineage |
| updated | current source hash ≠ stored fingerprint, record NOT edited since import |
| diverged | current source hash ≠ stored fingerprint AND record edited since import |
| unchanged | current source hash == stored fingerprint |

**Record-edited signal (Assumption A4)**: supplied to the classifier as input
(e.g. from a git comparison or a stored record hash), so the classifier itself
stays pure and CI-reproducible. v1 derives it by comparing a stored record-content
hash; git-based detection, if used, produces that input upstream, not inside the
pure function.

**Rationale**: ADR-0008's bucket table, and FR-007/FR-008. Purity mirrors the
Phase 1 resolver decision and keeps the classifier exhaustively testable.

## R6 — Diverged is report-only

**Decision**: On `diverged`, the classifier marks the entry and the migration
command leaves the on-disk record untouched, aggregating diverged entries into a
**divergence report** (human-readable + `--json`). No overwrite, ever.

**Rationale**: FR-008 and ADR-0008: "the reviewed record is the more authoritative
artifact; silently replacing it … would discard exactly the human judgment this
project exists to preserve." The report is the artifact a re-import produces for
human action; wiring it to an actual PR is Phase 3.

## R7 — `import-incomplete` lint rule

**Decision**: Add an `import-incomplete` lint rule (info) that fires when
`provenance.importedFrom` is present but the record is missing fields a
locally-authored record of the same status would require (e.g. `accepted` with no
deciders). It never errors.

**Rationale**: ADR-0008 action item 1 + FR-005/FR-012. `provenance.importedFrom`
already exempts imported records from the deciders-required *error*; this rule
keeps the gap *visible and backfillable* rather than silently permanent.

## R8 — Real-corpus exercise (SC-007)

**Decision**: Commit a small, real-world MADR sample (a subset of a public MADR
corpus, with attribution/license respected) as a fixture, and run migration over
it in a test asserting body-preservation + `adr lint` clean. Keep it small enough
to vendor but genuinely real (block scalars, varied statuses).

**Rationale**: ADR-0008 exit criterion: "exercised against at least one real
public MADR corpus, not a fixture." Vendoring a small real subset satisfies this
while staying offline (clean-clone). If licensing prevents vendoring, the test
documents the external corpus + command instead and a synthetic-but-realistic
corpus covers CI.

## Deferred (not decided here)

Non-MADR import sources (agent logs, plan artifacts) and their status rules;
emitting the divergence report as an actual GitHub PR (Phase 3); running the
evaluator over imported records (Phase 4).
