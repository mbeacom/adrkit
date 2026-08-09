# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until `1.0.0`, minor releases may include breaking changes
([ADR-0002](docs/adr/0002-typed-frontmatter-as-madr-superset.md)).

## [Unreleased]

### Added

- `adr check` and the governing-decisions Action now resolve inbound `@adr`
  markers from changed files. Reads are hoisted outside pure `checkChanges`, bounded
  to 3,000 normalized paths — GitHub's own changed-file ceiling, so every diff the
  Action evaluates is scanned completely — at 16 concurrent reads, and reported through a
  deterministic `markerScan` result so absent and skipped files are never silent.
  Marker-derived edges render as `declared by` and never influence exit status.

### Fixed

- Marker scanning no longer resolves a path through `realpath`, which rewrites a
  backslash *inside* a POSIX filename into a separator: `src/we\ird.ts` opened
  `src/we/ird.ts` and reported that file's markers, as `scanned` rather than
  `absent`. Containment is now derived from the already-verified symlink-free
  components. `adr check` also stays quiet about the marker scan when there was no
  path to scan.

### Security

- Marker scanning now rejects every symlink before resolving its target, closing the
  existence/permission oracle that would otherwise become available to fork PRs.
- The governing-decisions comment bounds the declarations rendered per decision and
  the body as a whole. One 8 KB header window holds ~630 marker lines, which produced
  a 70,585-character body; GitHub rejects anything over 65,536 with a `422`, and that
  is not a permission error, so pull-request-authored marker content could fail the
  job it is documented as never being able to affect.

## [0.4.0] - 2026-08-08

### Added

- **Inbound `@adr <id>` source markers, resolved without a schema change.** A file
  can now declare the decision it lives under by writing `@adr 0012` on a dedicated
  comment line in its first 8192 bytes, and `adr explain <path>` reports that record
  as governing the file alongside the `affects` patterns that already matched it.
  Until now a decision reached a file in exactly one direction — the record declared
  `affects` patterns and `resolveAffects` matched repo-relative paths against them,
  with no way for a file to point back
  ([ADR-0021](docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md)).
  `AdrFrontmatter`, `AffectsType`, and `schema/adr.schema.json` are unchanged, and
  no runtime dependency is added.

  Contributed by [@aballiet](https://github.com/aballiet) in
  [#97](https://github.com/mbeacom/adrkit/pull/97), from
  [#95](https://github.com/mbeacom/adrkit/issues/95) — the first community feature
  this project has shipped.

  **In v0.4.0 the asymmetry was deliberate: markers reached `adr explain` and nothing else.**
  `adr check`, `checkChanges`, the CI Action, and the Spec Kit context script do not
  scan them, so no CI semantics move and `packages/ci/dist` is byte-identical to
  v0.3.0. `declaredBy` lands on an explain-only `ExplainedDecision` rather than the
  shared `GoverningDecision`, so `adr check --json` output is unchanged. Extending
  enforcement to those surfaces is a separate decision, because it changes CI
  semantics and moves the filesystem boundary.

  A marker is a *claim*, so both ways it could lie are closed and tested. The
  scanner requires a **dedicated comment line** — an introducer begins the physical
  line and `@adr` is the comment's first content — because prose that merely
  discusses a decision, a string literal containing one, and a trailing
  `} // @adr 0012` must not make an accepted record binding; across this repository
  that rule finds 4 marker-looking lines where a looser first draft found 51.
  **Truncation uses the byte count the read observed** rather than re-deriving it
  from decoded text: `TextDecoder` may drop a BOM or expand invalid bytes, so a
  re-derived window can sever a reference mid-token, report a record the file never
  named, and still claim `truncated: false`. The read is confined to one regular
  file beneath the working tree, checked lexically before any I/O and again on the
  real path.

  **Landed** on [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  rung 1 — unit, contract, and purity coverage, plus maintainer verification against
  the branch. No reference-repository run yet (rung 2 open); not externally
  validated (rung 3 open).

- The release pipeline now supports **independently versioned, dist-less
  packages**. `scripts/release-pack.ts` previously asserted that every release
  package shared one version and shipped a `dist` — both true of a single
  lockstep Node surface, neither true of an adapter, and forcing them would have
  contradicted ADR-0007's "adapters ... are versioned independently. Their
  semver contract is with their upstream, not with our core." Definitions now
  declare `versioning: 'lockstep' | 'independent'` and `shipsNodeArtifact`, and a
  package that ships no Node artifact is *rejected* for publishing `dist`.
  Workspace dependencies also now resolve against the dependency's own version
  rather than the depender's.

- **Adapter releases.** Independently versioned packages now release on their own
  tag (`spec-kit-v0.1.0`) rather than riding a lockstep release. Without this,
  shipping an adapter fix would mean republishing core, evaluator, CLI, and MCP
  under a new version despite no change to any of them — which would make
  ADR-0007's "versioned independently" true of the number and false of everything
  that matters. `release-pack` gains `--only`, the release manifest carries its
  own `tag`, and the workflow derives scope from the tag: installed-tarball
  smoke and the `packages/ci/queue@v0` Action tag are lockstep-only. An adapter
  release also attaches a catalog `.zip` asset, derived from the packed tarball
  so the npm and catalog artifacts cannot disagree.

### Changed

- ADR-0007's `core-has-no-adapter-deps` assertion is no longer vacuous. It had
  nothing to guard while `packages/adapters/` was empty; with the first adapter
  present it has been observed failing against a deliberately introduced
  `@adrkit/core → @adrkit/spec-kit` dependency.

### Security

- `BOOTSTRAP_PACKAGES` is empty again. `@adrkit/spec-kit` needed a credential for
  its first publish because npm Trusted Publishing cannot be configured for a
  name that does not exist yet; with the name established and Trusted Publishing
  on, it publishes over OIDC and the `NPM_BOOTSTRAP_TOKEN` secret can be deleted.
  A test asserts no package receives the credential, and was observed failing
  against a name left in the set.

### Documentation

- **adrkit.dev documents the Spec Kit extension.** It had shipped, been released
  three times, and existed nowhere on the site — no page, no sidebar entry, and
  absent from the homepage's own list of published packages. A new
  [Spec Kit extension](https://adrkit.dev/spec-kit/) guide joins "Use in CI" and
  "MCP setup", covering the three commands, the optional hook and why `draft` is
  unreachable from it, the environment-variable configuration, the tested
  guarantees, and the honest ADR-0014 rung-2 status.

- Stale versions swept out of the docs. The homepage hero still advertised
  v0.2.1 two releases after v0.3.0 shipped; the roadmap still said "shipped in
  v0.2.0"; the `queue@v0` pinning note explained the tag as of the v0.2.1
  release though it has since moved to the v0.3.0 commit; and the bug-report
  template suggested `0.2.0` as the version to report and offered no
  `@adrkit/spec-kit` surface to file against.

- `MANIFEST.md` is an inventory again rather than a seed-bundle snapshot. It had
  not been touched since ADR-0013 and still claimed "13 records, ids 0001–0013"
  with statuses six records out of date, no `packages/` tree, and a "not
  included — add at repo creation" list of files that have existed for months.

- `CLAUDE.md` documents `packages/adapters/spec-kit`, including the constraints
  that have already been broken once each: the two version fields that must
  agree, the independent release tag, and the no-dependencies/no-`dist` rule.

## [spec-kit-0.1.2] - 2026-08-03

### Fixed

- `@adrkit/spec-kit` **0.1.2** reports its own version correctly. 0.1.1 shipped
  with `extension.yml` still saying `0.1.0`, so `specify extension info` and
  `specify extension list` told every user they had 0.1.0. Two version fields —
  `package.json` for npm, `extension.yml` for Spec Kit — with nothing keeping
  them in sync. A test now asserts they match, and was observed failing against
  the exact 0.1.1 state.

## [spec-kit-0.1.1] - 2026-08-03

### Fixed

- `@adrkit/spec-kit` **0.1.1** ships `LICENSE` and `NOTICE`. 0.1.0 did not: every
  sibling package copies them into `dist` at build time, and this package has no
  build, so nothing carried them. The files are committed rather than generated
  because the extension has three install paths — npm, the catalog zip, and
  `specify extension add --dev` from a checkout — and a generated file would be
  absent from the last one. A test asserts they stay byte-identical to the root
  copies, and that `.extensionignore` never excludes them.

## [spec-kit-0.1.0] - 2026-08-03

### Added

- **`@adrkit/spec-kit` — the Spec Kit extension** (`packages/adapters/spec-kit/`),
  the first package under `packages/adapters/*` and the second distribution
  surface [ADR-0003](docs/adr/0003-ship-as-spec-kit-extension.md) commits to. It
  adds three namespaced commands to a [Spec Kit](https://github.com/github/spec-kit)
  project — `/speckit.adrkit.context` (pull the governing decisions into agent
  context before planning), `/speckit.adrkit.check` (check a produced plan against
  them, routing through the deterministic evaluator when a snapshot bundle is
  configured), and `/speckit.adrkit.draft` (scaffold a draft ADR from the plan
  artifact) — plus one **optional** `after_plan` hook that offers to run the check.
  Pinned to Spec Kit `>=0.13.0,<0.16.0`, verified by installing and rendering
  against 0.13.0, 0.14.4, and 0.15.1. Distributed on **npm** and via the **Spec
  Kit community catalog**; the manifest declares `category: process` and
  `effect: read-write` for `specify extension info` and the catalog.

  Hooks can only reach commands that do not write: `draft` is the sole writing
  command and is unreachable from any hook, because a plan-phase hook creating
  records unprompted would manufacture decision memory rather than record it. That
  boundary, the never-mandatory hook, the honest-failure contract, and `check`'s
  zero-mutation guarantee are enforced by tests, each observed failing under a
  deliberately introduced defect before being trusted
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

  **Landed / reference-verified** on [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  rungs 1–2. Rung 2 is a maintainer-owned isolated reference repository that
  reinstalls the extension from a pinned adrkit commit into a real Spec Kit
  project across all three declared upstream versions, on every push and weekly —
  41 self-verifying, fail-closed assertions each. The gate was observed failing
  on a deliberate divergence run before being trusted. Evidence index:
  [`docs/reference-verification-spec-kit-extension.md`](docs/reference-verification-spec-kit-extension.md).
  Not externally validated (rung 3 open).

  Authorized by [ADR-0019](docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md),
  which records the `no-go` verdict from spike
  [008](specs/008-spec-kit-hook-viability/) as a measurement artifact of that
  spike's own verdict procedure — a byte-identical `git status` bar applied to
  `install` and `remove`, lifecycle actions whose entire purpose is to write files
  — rather than a finding against the mechanism, which the spike verified working
  in every respect. Spike 008's verdict, evidence bundle, and audit history are
  unmodified.

### Fixed

Two packaging defects that only surfaced by installing the extension for real,
against live Spec Kit, rather than reasoning about it:

- `specify extension add --dev` copies the extension directory verbatim and does
  **not** skip `node_modules`. Bun's isolated linker had created one for a single
  `@types/bun` devDependency, and the workspace symlink inside it aborted the
  install partway through with a `shutil.Error`, leaving a half-installed
  extension. `@adrkit/spec-kit` now declares no dependencies at all; types
  resolve from the root tsconfig.
- The install was depositing the extension's own test suite and `tsconfig.json`
  into the consuming project's `.specify/extensions/adrkit/`. Now excluded via
  `.extensionignore`, which upstream supports across the whole pinned range.

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

### Fixed

- The `adrkit-mcp` binary no longer fails silently when its stdio transport
  breaks. `serveStdio` reports transport failures only through its `onerror`
  callback — it consumes the rejected `start()` promise itself — so a client that
  went away mid-session tore the connection down while the process still exited
  `0`, a dead server reporting success. `createAdrkitMcpServer` now takes an
  `onError` option (defaulting to a stderr diagnostic) and the binary wires it to
  a stderr diagnostic plus a non-zero exit. stdout remains protocol-only.

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

[Unreleased]: https://github.com/mbeacom/adrkit/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mbeacom/adrkit/compare/v0.3.0...v0.4.0
[spec-kit-0.1.2]: https://github.com/mbeacom/adrkit/compare/spec-kit-v0.1.1...spec-kit-v0.1.2
[spec-kit-0.1.1]: https://github.com/mbeacom/adrkit/compare/spec-kit-v0.1.0...spec-kit-v0.1.1
[spec-kit-0.1.0]: https://github.com/mbeacom/adrkit/releases/tag/spec-kit-v0.1.0
[0.3.0]: https://github.com/mbeacom/adrkit/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mbeacom/adrkit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mbeacom/adrkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbeacom/adrkit/releases/tag/v0.1.0
