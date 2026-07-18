# Contract: `adr migrate`, Re-import Classifier, and `import-incomplete` (Phase 2)

## Library: `migrateMadr` (`@adrkit/core`)

```
migrateMadr(input: {
  dir: string;                    // target directory of MADR files (default docs/adr)
  files?: string[];               // explicit files; else discover MADR files in dir
  existingRecords?: Adr[];        // for re-import; supplied by caller
  recordEdited?: (id: string) => boolean;   // edited-since-import signal (A4)
}): {
  results: {
    path: string;
    outcome: 'migrated' | 'updated' | 'unchanged' | 'diverged' | 'skipped';
    frontmatter?: AdrFrontmatter; // computed adrkit frontmatter (for migrated/updated)
  }[];
  divergence: { path: string; sourceRef: string }[];  // report-only entries
  findings: Finding[];            // import-incomplete / import-status-unrecognized / import-not-madr
}
```

**Guarantees**:
- **In place & body-preserving**: writes `<frontmatter>\n<original body bytes>`;
  body bytes are unchanged (FR-001). Remains a valid MADR file.
- **Idempotent**: re-running on a satisfied file yields byte-identical output
  (FR-002); no `importedAt` churn (R2).
- **Deterministic**: identical inputs → identical frontmatter + fingerprints
  (FR-006); no model, no clock in the fingerprint.
- **Diverged never overwritten** (FR-008): a diverged entry appears in
  `divergence` and its file is left byte-identical on disk.
- **Degrades, never crashes**: non-MADR/malformed files → `skipped` +
  `import-not-madr` finding (FR-011).

### Status mapping

`accepted`/`proposed`/`deprecated`/`superseded`/`rejected`/`draft` → same;
anything else → `proposed` + `import-status-unrecognized` finding (R3).

### Fingerprint

`sha256(normalized source body)`; `sourceRef` = source path; stored under
`provenance.importedFrom` with `sourceKind: 'madr'` (R4).

## Library: `classifyReimport` (`@adrkit/core`) — pure

```
classifyReimport(
  sourceEntries: { sourceRef: string; fingerprint: string }[],
  existingRecords: Adr[],
  recordEdited: (id: string) => boolean,
): { sourceRef: string; bucket: 'new'|'updated'|'diverged'|'unchanged'; recordId?: string }[]
```

Pure function of its inputs (no fs/clock/network). Buckets per ADR-0008 (R5).
`diverged` = source changed AND record edited since import.

## CLI: `adr migrate --from madr [--dir docs/adr] [--dry-run] [--json]`

- **`--from madr`**: required; the only supported source in this phase. Any other
  value → usage error (exit 2) noting non-MADR sources are not yet supported.
- **Behavior**: discover MADR files in `--dir`; for each, migrate in place (or, if
  a prior import exists, classify and act per bucket). Print per-file outcomes and
  findings; print the divergence report for any `diverged` entries.
- **`--dry-run`**: compute and print outcomes/divergence/findings WITHOUT writing.
- **Output (human)**: per-file `outcome  path`; a summary
  `migrated M, updated U, unchanged N, diverged D, skipped S`; then a
  "Divergence (report only):" section listing diverged files.
- **Output (`--json`)**: the `migrateMadr` result shape, stably sorted.
- **Exit**: `0` on success (including when diverged entries exist — they are
  reported, not errors); `2` on usage error. A diverged entry does NOT fail the
  command; it is surfaced for human action.
- **Round-trip**: not supported (FR-010) — documented; no flag enables it.

## Lint: `import-incomplete` (added to `adr lint`)

For a record with `provenance.importedFrom` present, emit `import-incomplete`
(info) when it is missing fields a locally-authored record of the same status
would require (e.g. `accepted` with no `deciders`). Never an error; keeps the gap
visible and backfillable (FR-005/FR-012).

## Non-goals (contract-level)

- No non-MADR import source; no round-trip sync; no GitHub PR emission (Phase 3);
  no evaluator pass (Phase 4).
