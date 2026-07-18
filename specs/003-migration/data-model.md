# Data Model: MADR Migration (Phase 2)

Entities the migration operates on. No record-schema change — `provenance.
importedFrom` already exists in the Phase 0 schema.

## Input: MADR source file

A markdown file recognized as MADR (Assumption A1): leading `---` frontmatter
and/or a top-level `# <title>`. Decomposed (via the Phase 0 parser) into:

- `frontmatter: unknown` — source YAML (may be MADR-native fields or empty).
- `body: string` — raw markdown after the fence, **preserved byte-for-byte**.
- `path: string` — repo-relative source path (becomes `sourceRef`).

## Derived: adrkit frontmatter (merge result)

The frontmatter migration writes/merges, populated deterministically:

| Field | Source |
|---|---|
| `id` | existing adrkit/source id if present, else next sequential `NNNN` (A2) |
| `title` | source title (frontmatter `title` or first `# ` heading) |
| `status` | source status mapped per R3; unknown → `proposed` + finding |
| `date` | source date if present and valid, else omitted/derived deterministically |
| `schemaVersion` | current `SCHEMA_VERSION` |
| `provenance.importedFrom` | `{ sourceKind: 'madr', sourceRef, fingerprint }` (R4) |

Only missing required fields are filled; present valid values are preserved (R2).

## Entity: Source fingerprint

`provenance.importedFrom` (existing schema):
`{ sourceKind: 'madr', sourceRef: string, fingerprint: string, importedAt?: iso }`.
`fingerprint = sha256(normalized source body)` (R4). `importedAt` is not written by
default in v1 (R2) to keep migration clock-free and idempotent.

## Entity: Re-import classification

Per source entry, one of:

| Bucket | Meaning | On-disk effect |
|---|---|---|
| `new` | fingerprint lineage unseen | create record |
| `updated` | source changed, record untouched since import | update record in place |
| `diverged` | source changed AND record edited since import | **report only, no write** |
| `unchanged` | source == stored fingerprint | no-op |

Inputs to the pure classifier: current source entries (with freshly computed
fingerprints), existing records (with their stored `importedFrom.fingerprint`),
and a per-record **edited-since-import** boolean (A4). Output: bucket per entry +
the aggregated **divergence report** (list of diverged entries with both sides'
identifying info).

## Entity: Migration result / Finding

Per-file outcome: `migrated | skipped | unchanged` plus reused Phase 0 `Finding`s.
New/used rule ids:

| rule | severity | when |
|---|---|---|
| `import-incomplete` | info | `importedFrom` present but a same-status locally-authored record would require more (e.g. accepted w/o deciders) |
| `import-status-unrecognized` | info/warn | source status not in the adrkit enum → coerced to `proposed` |
| `import-not-madr` | warn | a targeted file is not recognizable as MADR → skipped |
