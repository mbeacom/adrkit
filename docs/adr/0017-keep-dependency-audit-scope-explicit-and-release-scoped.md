---
schemaVersion: 0.1.0
id: "0017"
title: Keep dependency audit scope explicit and release-scoped
status: accepted
date: 2026-07-25
deciders: ["@mbeacom"]
tags: [security, ci, dependencies, release, evidence]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0007", "0014", "0016", "0018"]
affects:
  - type: path
    pattern: "scripts/audit-gate.ts"
  - type: path
    pattern: "scripts/audit-gate.test.ts"
  - type: path
    pattern: ".github/workflows/ci.yml"
  - type: path
    pattern: "packages/*/package.json"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: >-
    Changes how dependency-audit evidence is described and where published-package
    consumer resolution should be verified. It does not change a public API, but
    it does affect the meaning of a CI security gate across every published
    package.
externalRefs:
  - type: other
    id: GHSA-frvp-7c67-39w9
    url: "https://github.com/advisories/GHSA-frvp-7c67-39w9"
    label: Node.js Adapter for Hono serve-static path traversal on Windows
reviewBy: 2026-10-31
---

# ADR-0017: Keep dependency audit scope explicit and release-scoped

## Context

The `audit` CI job runs `bun audit --json` through `scripts/audit-gate.ts` and
blocks only high- or critical-severity advisories. That gate was observed
failing against a real pre-fix workspace tree under ADR-0016, and it now fails
closed on blind states such as no output, unparseable output, and unexpected
JSON shape.

The gate's scope was still ambiguous. It audited the repository's resolved
workspace tree after root `package.json` overrides:

```json
"overrides": { "@hono/node-server": "^2.0.5", "fast-uri": "^3.1.4" }
```

Those overrides are not published in package manifests. A consumer installing
`@adrkit/mcp@0.2.0` resolves a different tree:

```text
bun audit v1.3.14
@hono/node-server  <2.0.5
  @adrkit/mcp › @modelcontextprotocol/sdk › @hono/node-server
  moderate: Node.js Adapter for Hono: Path traversal in `serve-static` on Windows via encoded backslash (`%5C`) - https://github.com/advisories/GHSA-frvp-7c67-39w9

1 vulnerabilities (1 moderate)
```

The high-severity `fast-uri` advisory is genuinely closed for consumers because
the SDK already resolves `fast-uri@3.1.4`. The remaining exposure is moderate,
upstream-blocked, and low-consequence for adrkit: `@modelcontextprotocol/sdk`
`1.29.0` is the latest release and still ranges `@hono/node-server` as
`^1.19.9`, while adrkit's MCP server is a local stdio server that does not use
Hono `serve-static` or expose HTTP static files.

## Decision

We will keep the PR CI audit as a **workspace resolved dependency tree** gate,
and the gate must state that scope in its output. A reader must see that it
examines this checkout after root overrides and does **not** audit consumer
installs of published `@adrkit/*` package manifests.

We will record the known `@adrkit/mcp@0.2.0` consumer exposure in the gate
output rather than hiding it behind the workspace override. The record is narrow:
it names `@hono/node-server`, `GHSA-frvp-7c67-39w9`, the observed published
package and version, the upstream dependency path, why adrkit cannot currently
fix the transitive range, why the consequence is low for a stdio server, and the
condition that resolves it: an `@modelcontextprotocol/sdk` release whose
`@hono/node-server` range lets consumers resolve `@hono/node-server >=2.0.5`.

The acceptance expires on 2026-10-31. After that date the gate fails closed until
the exposure is removed, the evidence is refreshed, or a human deliberately
renews the narrow acceptance.

Published-artifact consumer audits belong in release evidence, not every PR CI
run. They require network, a real install of already-published package versions,
and currently audit `@adrkit/mcp@0.2.0` while the repository is ahead of npm.
That shape is valuable before or immediately after publishing, but it is a poor
merge gate for ordinary source changes because it is slower, flakier, and can
report on an artifact the PR did not produce.

## Options considered

### Option A: State workspace scope, record known consumer exposure, and move published audits to release evidence (chosen)

| Dimension | Assessment |
|---|---|
| Honesty | The CI output says exactly what tree it examined and names the known tree it did not examine. |
| Fail-closed behavior | Blind `bun audit` states still fail, and the known consumer acceptance fails after a fixed date. |
| Cost | PR CI stays close to its current cost; release evidence absorbs the network-heavy published install. |
| Gap | The PR gate does not discover new consumer-only advisories by itself. |

### Option B: Audit published package consumer installs on every PR

**Pros:** The PR check would continuously exercise the consumer resolution path.

**Cons:** The check needs network and fresh installs of all four published
packages (`@adrkit/core`, `@adrkit/cli`, `@adrkit/evaluator`, `@adrkit/mcp`).
It also audits the package versions currently on npm, not necessarily the source
tree under review. While the repo is ahead of the latest publication, this makes
the PR gate noisy evidence about a different artifact.

### Option C: Treat the root override audit as sufficient

**Pros:** No code or process change.

**Cons:** This is the false-assurance failure ADR-0016 describes: "clean" would
mean "the workspace tree is clean after unpublished overrides" while readers
could reasonably infer "published consumers are clean."

### Option D: Fail every PR on the known moderate consumer advisory

**Pros:** Conservative.

**Cons:** There is no adrkit-side dependency bump available today: the latest
SDK still ranges `@hono/node-server` below the patched major. Failing every PR
would block unrelated work on an upstream moderate advisory that the stdio MCP
server does not exercise.

## Trade-offs

This decision makes the CI output longer and leaves consumer-only discovery to
release evidence rather than continuous PR evidence. It buys a more precise
claim: the workspace gate is still a real gate, and the known published-consumer
gap is visible instead of implied away.

## Consequences

- **Easier:** Reading the audit job output without over-interpreting it.
- **Harder:** Maintaining the known-exposure record until the upstream SDK range
  changes or the exposure is otherwise removed.
- **How we would know this was wrong:** a consumer-only high or critical
  advisory ships because release evidence did not run, or the acceptance expires
  without prompting a real review.
- **Revisit if:** published-artifact audits become cheap and deterministic
  enough to run on every PR, or adrkit adds a release workflow that can make them
  mandatory at the correct artifact boundary.

## Action items

1. [x] Ratify or reject this proposed record. **Ratified by @mbeacom, 2026-08-01.**
2. [x] Add a release-time published-package consumer audit covering
       `@adrkit/core`, `@adrkit/cli`, `@adrkit/evaluator`, and `@adrkit/mcp`.
       **Done 2026-08-01.** `docs/RELEASING.md` had the audit but ran it over
       `@adrkit/core` + `@adrkit/mcp` only, which never reaches
       `jsonpath-rfc9535` — the evaluator's sole third-party dependency, and the
       only package in the tree not already pulled in by core or mcp. The
       procedure now audits `.release/smoke/`, which `release:pack` builds from
       the release manifest with every artifact wired as a `file:` dependency, so
       the audited set is derived from what was packed rather than hand-listed
       and cannot drift when a fifth package is published.
3. [x] Remove or renew the `GHSA-frvp-7c67-39w9` acceptance by 2026-10-31, or
       earlier if `@modelcontextprotocol/sdk` releases a range that reaches
       `@hono/node-server >=2.0.5`.
       **Removed 2026-07-29**, ahead of expiry, by the second limb of the
       recorded resolution condition — adrkit removed the transitive path rather
       than waiting for upstream to widen its range. See the update below.

## Update: 2026-07-29 — the recorded consumer exposure is resolved

The `GHSA-frvp-7c67-39w9` acceptance recorded above has been removed from
`scripts/audit-gate.ts`, along with the root `@hono/node-server` and `fast-uri`
`overrides` this record's Context quotes.

Neither the Context nor the Decision above is amended: both describe the situation
that held while `@adrkit/mcp` depended on `@modelcontextprotocol/sdk@1.29.0`, and
the scope discipline they establish still stands. What changed is the underlying
fact. `@adrkit/mcp` migrated to `@modelcontextprotocol/server@2.0.0`
([ADR-0018](0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)),
whose only runtime dependencies are `@modelcontextprotocol/core` and `zod`. The
SDK no longer pulls Hono, Express, or Ajv into the graph, so neither
`@hono/node-server` nor `fast-uri` resolves anywhere in the tree and a published
consumer can no longer reach either. `bun audit` is clean with no overrides in
effect.

The acceptance list is now empty rather than deleted, and the expiry machinery
that would fail CI closed remains under test through an injected synthetic
acceptance — so the next real acceptance is recorded and expires exactly as this
record requires.
