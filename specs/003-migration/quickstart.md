# Quickstart: MADR Migration (Phase 2)

Prerequisites: a **published stable Bun** (CI pins `1.3.14`) — not the canary that
self-reports 1.4.0 (it writes an unreadable lockfile). Clean clone, no network.

```bash
bun install

# Migrate a MADR corpus in place (adds frontmatter, body untouched)
bun run adr migrate --from madr --dir path/to/madr
bun run adr migrate --from madr --dir path/to/madr --dry-run   # preview, no writes
bun run adr migrate --from madr --dir path/to/madr --json

# Re-run to prove idempotency (no diff on already-migrated files)
bun run adr migrate --from madr --dir path/to/madr
git diff --stat path/to/madr        # empty on a second run

# Validate migrated records (imported gaps show as info, not errors)
bun run adr lint --dir path/to/madr

# Tests
bun test packages/core/test/migrate-inplace.test.ts
bun test packages/core/test/reimport-classify.test.ts
bun test                            # whole suite incl. the real-corpus fixture
```

## What "green" means

- Body bytes of every migrated file are unchanged; `adr lint` accepts the results
  (SC-001).
- A second migration run produces zero diff (SC-002, idempotent).
- Recognized statuses preserved; unknown → `proposed` + finding (SC-003).
- Every migrated record has a stable `provenance.importedFrom.fingerprint`
  (SC-004); an `accepted` import with no deciders validates + one
  `import-incomplete` info (SC-005).
- The four-bucket classifier is correct and leaves diverged records untouched
  (SC-006).
- Migration succeeds on a real MADR corpus sample (SC-007).
