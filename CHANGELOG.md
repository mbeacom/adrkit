# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until `1.0.0`, minor releases may include breaking changes
([ADR-0002](docs/adr/0002-typed-frontmatter-as-madr-superset.md)).

## [Unreleased]

## [0.3.0] - 2026-07-31

### Added

- `@adrkit/mcp` now serves **MCP protocol revision `2026-07-28`** alongside the
  2025-era revision on the same stdio connection. The opening exchange selects the
  era and pins it for the connection's lifetime: a `server/discover` call (or any
  request carrying a 2026 `_meta` envelope) gets the stateless 2026 revision, while
  an `initialize` handshake is served exactly as before. Tool names, schemas,
  annotations, and structured results are identical on both eras, and 2025-era
  responses are unchanged from 0.2.1 apart from `tools/list` ordering (see below).
- `tools/list` and `server/discover` are served with SEP-2549 cache fields
  (`ttlMs: 300000`, `cacheScope: "public"`) on the 2026 revision. The four-tool
  surface is immutable for the life of the process and carries no corpus content or
  caller identity, so a client can reuse it instead of re-listing. Corpus reads stay
  uncacheable — every `tools/call` still loads a fresh projection.

### Changed

- Migrated `@adrkit/mcp` from `@modelcontextprotocol/sdk@1.29.0` to the MCP
  TypeScript SDK v2 package split: `@modelcontextprotocol/server@2.0.0` in
  production and `@modelcontextprotocol/client@2.0.0` as a development-only test
  driver. `zod` tightened to `^4.2.0` — v2 converts schemas through the authoring
  instance's `~standard.jsonSchema`, which zod added in 4.2.0. On zod 4.0–4.1 the
  SDK falls back to its own bundled converter with a one-time stderr warning and
  silently drops `.describe()` field descriptions from the advertised JSON Schema,
  so the declared range excludes those versions rather than relying on the resolved
  version happening to be new enough.
- Tool `outputSchema`s are now explicit `z.object(...)` schemas rather than raw Zod
  shapes (v2 deprecates the raw-shape overloads). The advertised JSON Schema is
  unchanged: still a root object of `corpusHealth` + `result`.
- `tools/list` advertises the four tools in lexicographic order, so the catalog is
  deterministic across restarts (`2026-07-28` minor change 3). This is the one
  2025-era wire change in this release: the SDK serves registration order on both
  eras, so legacy clients see the new order too. MCP treats `tools` as an unordered
  set, so no client behavior depends on it; the order is asserted unsorted on both
  eras so it cannot drift unobserved.

### Removed

- The root `@hono/node-server` and `fast-uri` `overrides`, and the recorded
  `@adrkit/mcp` consumer-advisory acceptance for
  [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9). All
  three are now dead: `@modelcontextprotocol/server@2.0.0` depends only on
  `@modelcontextprotocol/core` and `zod`, so the SDK no longer drags Hono, Express,
  Ajv, `cors`, or `zod-to-json-schema` into the tree, and neither `@hono/node-server`
  nor `fast-uri` resolves anywhere in it. The advisory retired by its own recorded
  `resolvesWhen` clause ("...or adrkit removes that transitive path"), ahead of its
  `2026-10-31` expiry. `bun audit` is clean with no overrides in effect.

## [0.2.1] - 2026-07-27

### Added

- `adr queue` — emit the ARB operations queue, a read-only, deterministic
  projection of the corpus's `review` metadata (tiers, SLA state, approvals,
  objections) as Markdown or `QueueReport` v1 JSON. The pure `buildQueueReport`
  kernel and formatters live in `@adrkit/core` (Phase 6).
- Managed-issue queue GitHub Action (`packages/ci/queue`) that creates or updates
  a single dedicated issue carrying the deterministic queue report, using only the
  default `GITHUB_TOKEN` with `issues: write`. Landed and maintainer
  reference-verified; external validation is tracked as open
  ([ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)).
- MCP registry distribution metadata: `@adrkit/mcp` declares
  `mcpName: dev.adrkit/mcp`, `packages/mcp/server.json` points at the 0.2.1 npm
  package, and the repository includes Smithery and Glama manifests plus a
  distribution playbook.

### Changed

- Hardened CI and release posture: every GitHub Action reference is pinned to a
  full commit SHA, checkout credentials are not persisted into the worktree, and
  the release job injects its push credential only for the moving major Action tag
  update.
- Added a fail-closed `bun audit` gate that treats malformed audit output,
  unexpected schema shapes, unknown arguments, and any advisory as CI failures.
  The gate states its scope in its own output — it examines this workspace's
  resolved tree after root overrides, not consumer installs of the published
  `@adrkit/*` manifests — and records known out-of-scope consumer exposures with
  an expiry instead of hiding them
  ([ADR-0017](docs/adr/0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)).
- Refreshed public README/site/package docs so Node-targeted `npx`/`npm` install
  paths are first-class while Bun remains the repository development toolchain.

### Fixed

- `adr --help`, `adr help`, and `adr --version` now work and exit successfully.
- `adr check`, `adr explain`, and the governing-decisions CI Action no longer
  report `rejected`, `superseded`, or `deprecated` ADRs as governing active code;
  their output now includes status where it affects interpretation.
- `adr migrate --from madr` preserves more legacy MADR/Nygard status and decider
  forms, including MADR 2.x `* Deciders:` header bullets, and avoids creating
  records that adrkit discovery cannot see.
- `adr queue` reports skipped or undiscoverable ADR files instead of silently
  omitting them from the operations queue.
- `adr lint`, `adr graph`, `adr explain`, `adr check`, `adr migrate`, and
  `adr evaluate` now classify an unreachable `--dir` as a usage error — exit `2`
  with `Corpus directory not found: '<dir>'` — instead of leaking a raw `ENOENT`
  at exit `1`. This matches `adr queue` and the documented exit-code contract.
- `adr lint` now rejects an `accepted` record whose `provenance.authoredBy` is
  `agent-drafted` and that names no `provenance.ratifiedBy`. The ratification
  gate previously checked only `agent`, so a machine-drafted decision could reach
  `accepted` with no named human ratifier.
- The MCP server reports a runtime `SERVER_INFO.version` matching the published
  package version.

### Security

- Bumped `sharp` to `^0.35.0` in the docs site to patch
  [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj).
- Added root overrides for vulnerable transitive releases of `fast-uri` and
  `@hono/node-server`, yielding a clean root `bun audit` before release.
- Known, unfixed in this release: a consumer installing `@adrkit/mcp` still
  resolves a vulnerable `@hono/node-server`
  ([GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9)).
  The root override is not published in the package manifest, and
  `@modelcontextprotocol/sdk@1.29.0` pins `@hono/node-server` to `^1.19.9`,
  which cannot resolve the patched `>=2.0.5`. Impact is limited — the advisory is
  a Windows `serve-static` path traversal, and the stdio server neither uses Hono
  `serve-static` nor serves HTTP static files — and it resolves when the SDK
  widens that range. Recorded with a `2026-10-31` expiry after which CI fails
  closed
  ([ADR-0017](docs/adr/0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)).

## [0.2.0] - 2026-07-20

### Added

- `@adrkit/mcp` — a local, read-only Model Context Protocol server exposing
  decision retrieval over stdio with exactly four tools (`search_decisions`,
  `get_decision`, `get_decision_context`, `list_superseded`). No writes, no
  network, no model calls; the graveyard is included by default. Passed
  real-session validation through the official MCP Inspector (Phase 5).

## [0.1.0] - 2026-07-20

### Added

- Typed ADR schema as a strict MADR superset, and the `@adrkit/core` library
  (Phase 0).
- `affects` resolution as a pure function, and `adr explain <path>` to report
  which decisions govern a file (Phase 1).
- `adr migrate --from madr` — in-place, additive, non-destructive MADR migration,
  reading status/date/deciders from MADR 3.x frontmatter, MADR 2.x `* Status:`
  bullets, and Nygard `## Status` sections (Phase 2).
- `adr lint`, `adr new`, and `adr graph` in the `@adrkit/cli` binary.
- Astro Starlight documentation site on GitHub Pages, hosting the canonical JSON
  Schema at its `$id`
  ([ADR-0011](docs/adr/0011-host-the-canonical-json-schema-at-its-id-on-adrkit-dev.md)).
- `adr check` and the governing-decisions CI Action (`packages/ci`) that comments
  the decisions governing a PR's changed files (Phase 3).
- The deterministic, model-free Pass 0 evaluator (`@adrkit/evaluator`) and
  `adr evaluate`, applying the eleven-rule rubric over an offline snapshot bundle
  and routing without ever approving.
- Node-targeted published distribution of all packages, smoke-tested under Node
  22 and 24.

[Unreleased]: https://github.com/mbeacom/adrkit/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mbeacom/adrkit/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mbeacom/adrkit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mbeacom/adrkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbeacom/adrkit/releases/tag/v0.1.0
