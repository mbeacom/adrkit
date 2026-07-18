# Quickstart: Affects Resolution (Phase 1)

Prerequisites: a **published stable Bun** (CI pins `1.3.14`). Do not use the
canary that self-reports 1.4.0 for installs — it rewrites `bun.lock` to a format
no stable Bun can read. Clean clone, no credentials, no network beyond install.

```bash
bun install                      # adds picomatch + semver check (stable Bun only)

# Explain which decisions govern a file
bun run adr explain packages/core/src/affects/index.ts
bun run adr explain packages/core/src/affects/index.ts --json

# Run the resolver's conformance suite + purity assertion
bun test packages/core/test/affects-path.test.ts
bun test packages/core/test/affects-package.test.ts
bun test packages/core/test/affects-purity.test.ts
bun test                         # whole suite incl. conformance cases

# Enforcement (what CI adds this phase)
bun run typecheck
bun run check:deps               # affects/ imports no adapter
```

## What "green" means

- The resolver returns exactly the expected governing set for every `path` case in
  `packages/core/test/conformance/` (SC-001).
- A `package` decision fires on a lockfile change to the matching dependency and
  not on a manifest-only edit (SC-002).
- With no catalog/IaC/OpenAPI, resolution has zero errors; each unbacked matcher
  emits one `affects-unresolvable` info (SC-003).
- `adr explain` names the matcher that fired for every governing record (SC-004).
- `resolution-is-pure` runs green in CI (SC-005).
- The conformance suite is portable JSON runnable by a second implementation
  (SC-006).
