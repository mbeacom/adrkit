# Quickstart: Schema and Core (Phase 0)

Prerequisites: Bun `>=1.2`. Clean clone, no credentials, no network needed beyond
the initial dependency install.

```bash
bun install

# Regenerate the published JSON Schema from the Zod source and verify no drift
bun run schema:emit
git diff --exit-code schema/adr.schema.json   # must be clean (schema-emit-matches)

# Validate this repo's own decision corpus (rung 1)
bun run adr lint                 # exits 0 on a clean corpus
bun run adr lint --json          # machine-readable findings

# Scaffold a new record, then prove it validates
bun run adr new "Adopt example decision"
bun run adr lint docs/adr/0011-adopt-example-decision.md   # exits 0

# See the decision graph
bun run adr graph                # Graphviz DOT to stdout
bun run adr graph --format json  # edge list

# Enforcement suite (what CI runs)
bun test                         # per-invariant + drift + adapter-independence
bun run typecheck
bun run check:deps               # core-has-no-adapter-deps
bun run lint
```

## What "green" means

- `adr lint` exits 0 on `docs/adr/0001`–`0010` (SC-001).
- `schema:emit` leaves `schema/adr.schema.json` unchanged (SC-003).
- `bun test` covers each cross-field/cross-record invariant with a pass and a
  fail case (SC-002).
- A clean clone completes install/build/test/lint (SC-005) with the core pulling
  in no adapter (SC-006).
