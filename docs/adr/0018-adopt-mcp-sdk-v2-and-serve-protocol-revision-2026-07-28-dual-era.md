---
schemaVersion: 0.1.0
id: "0018"
title: Adopt MCP SDK v2 and serve protocol revision 2026-07-28 dual-era
status: accepted
date: 2026-07-29
deciders: ["@mbeacom"]
tags: [mcp, dependencies, protocol, compatibility, security]
scope: component
reversibility: two-way-door
blastRadius: team
relatesTo: ["0007", "0010", "0014", "0017"]
affects:
  - type: path
    pattern: "packages/mcp/**"
  - type: path
    pattern: "scripts/audit-gate.ts"
  - type: path
    pattern: "scripts/check-deps.ts"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: >-
    Replaces the MCP server's only third-party runtime dependency with a new
    upstream major line and changes what `@adrkit/mcp` puts on the wire for
    clients that ask for the new revision. The tool surface, schemas, and 2025-era
    bytes are unchanged, so no published API contract moves, but the dependency
    and protocol commitments affect every consumer of the published package.
externalRefs:
  - type: other
    id: mcp-2026-07-28
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
    label: MCP specification revision 2026-07-28 changelog
  - type: other
    id: GHSA-frvp-7c67-39w9
    url: "https://github.com/advisories/GHSA-frvp-7c67-39w9"
    label: Node.js Adapter for Hono serve-static path traversal on Windows
reviewBy: 2027-07-28
---

# ADR-0018: Adopt MCP SDK v2 and serve protocol revision 2026-07-28 dual-era

## Context

On 2026-07-28 the Model Context Protocol published specification revision
`2026-07-28`. Its headline change is a **stateless protocol core**: the
`initialize` / `notifications/initialized` handshake and the `Mcp-Session-Id`
header are gone, every request carries its own protocol version and client
capabilities in `_meta`, a new `server/discover` RPC advertises capabilities up
front, and every result carries a `resultType`. Server-initiated requests are
replaced by the Multi Round-Trip Request pattern; `ping`, `logging/setLevel`, and
`resources/subscribe` are removed; Roots, Sampling, and Logging are deprecated
under a new twelve-month deprecation policy.

The day before, the TypeScript SDK shipped v2 as a **package split**. The single
`@modelcontextprotocol/sdk@1.x` became `@modelcontextprotocol/core`, `/client`,
`/server`, and framework adapters. `@modelcontextprotocol/sdk@1.29.0` — the exact
pin research §R0 chose in Phase 5, when v2 was still beta — is now the end of the
v1 line.

Three forces make this a decision rather than a routine bump.

**The dependency surface is not equivalent.** `@modelcontextprotocol/sdk@1.29.0`
declares thirteen runtime dependencies, including Express, Hono,
`@hono/node-server`, Ajv, `cors`, `jose`, and `zod-to-json-schema` — an HTTP and
auth stack that a local stdio server never executes but always installs.
`@modelcontextprotocol/server@2.0.0` declares two: `@modelcontextprotocol/core`
and `zod`. That difference is the direct cause of the consumer exposure
[ADR-0017](0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)
recorded and accepted until 2026-10-31: a consumer installing `@adrkit/mcp@0.2.1`
resolved a vulnerable `@hono/node-server` through the SDK, which adrkit could not
fix because the SDK ranged it below the patched major.

**Upgrading the SDK does not, by itself, change the wire.** v2 keeps speaking the
2025-era protocol unless a server opts in. A hand-wired
`server.connect(new StdioServerTransport())` — what `@adrkit/mcp` does today —
serves only the 2025 era no matter which SDK version is installed. Serving
`2026-07-28` on stdio requires the connection-pinned `serveStdio(factory)` entry.
So "update the dependency" and "support the new revision" are two decisions, and
only the second is visible to agents.

**Most deployed clients are still 2025-era.** The revision is one day old.
Choosing modern-only would strand every client that has not migrated.

adrkit's exposure to the spec's breaking changes is unusually small: the server is
local, read-only, stdio-only, and uses none of what changed — no sessions, no
roots, sampling, logging, prompts, resources, subscriptions, tasks, HTTP, or auth.
Its entire surface is four read-only tools.

## Decision

We will migrate `@adrkit/mcp` to `@modelcontextprotocol/server@2.0.0` and serve
**both protocol eras on the same stdio connection**, with the client choosing.

- `start()` hands a closure-private server factory to `serveStdio(...)` with the
  default `legacy: 'serve'`. The opening exchange selects the era and pins one
  factory instance for the connection's lifetime: `server/discover` (or any
  request carrying a 2026 `_meta` envelope) gets `2026-07-28`; an `initialize`
  handshake is served exactly as before.
- The four tools are registered once and served identically to both eras. Names,
  input and output schemas, annotations, structured results, cursor semantics, and
  rendered text do not vary by era. **The 2025-era wire is unchanged from 0.2.1
  except for `tools/list` ordering** (next bullet) — asserted directly against a
  real spawned subprocess, unsorted.
- `@modelcontextprotocol/client@2.0.0` is a **development-only** dependency. It
  drives the in-process and real-stdio conformance harnesses and is never imported
  by shipped code; `scripts/check-deps.ts` enforces that split.
- `zod` tightens from `^4` to `^4.2.0`. v2 converts schemas through the authoring
  instance's `~standard.jsonSchema`, added in zod 4.2.0. A `^4` range still
  satisfies v2's peer and installs, and zod 4.0–4.1 does not fail outright — the
  SDK falls back to its own bundled `z.toJSONSchema()` with a one-time `[mcp-sdk]`
  stderr warning. But `.describe()` field descriptions live in the *authoring*
  zod's registry, so the fallback silently drops them from the advertised JSON
  Schema. A degraded tool catalog that still returns `0` is exactly the fail-quiet
  shape ADR-0016 rejects, so the declared range excludes the versions that take
  that path rather than relying on the resolved version happening to be new enough.
- We adopt SEP-2549 cache fields deliberately rather than accepting the SDK's
  conservative `ttlMs: 0` default: `tools/list` and `server/discover` are served
  with `ttlMs: 300000, cacheScope: "public"`. Both are immutable for the life of
  the process and carry no corpus content or caller identity. Corpus reads are
  never cacheable — every `tools/call` still loads a fresh projection.
- `tools/list` advertises the four tools in lexicographic order, satisfying the
  revision's deterministic-order SHOULD without relying on registration accident.
  The SDK serves registration order on **both** eras, so this is the one 2025-era
  wire change in this migration. MCP models `tools` as an unordered set, so no
  client behavior depends on it — but the previous order was an artifact of the
  order the four `registerX` calls happened to be written in, and nothing observed
  it. It is now asserted unsorted on both eras.

We will also **retire the ADR-0017 consumer-advisory acceptance and the root
overrides it stood behind**, because this migration satisfies that acceptance's
own recorded `resolvesWhen` clause ("...or adrkit removes that transitive path").
Neither `@hono/node-server` nor `fast-uri` resolves anywhere in the tree after the
swap, so the `overrides` block and the acceptance entry both describe an exposure
that no longer exists. Leaving them in place would be the inverse of ADR-0016's
concern: a gate reporting a finding it can no longer observe.

## Options considered

### Option A: SDK v2 + `serveStdio` serving both eras (chosen)

| Dimension | Assessment |
|---|---|
| Client compatibility | Widest. 2025-era clients are unaffected; 2026-era clients get the stateless revision. The client decides, per connection. |
| Consumer security | Removes the Express/Hono/Ajv/auth stack from the published dependency graph, closing GHSA-frvp-7c67-39w9 for consumers ahead of its accepted expiry. |
| Migration cost | Contained. Import paths, `outputSchema` wrapping, one lifecycle rewrite, and a test-client strictness flag. The tool logic is untouched. |
| Cost | Carries two wire eras in one binary for as long as the SDK supports both, and the era-selection logic is upstream code we do not own. |

### Option B: SDK v2, stay on the 2025 era

**Pros:** Strictly smaller change; captures the entire dependency-surface and
security win, which is the more urgent half. No new wire behavior to validate.

**Cons:** Silently misleading. The package would ship the SDK that speaks
`2026-07-28` while answering `server/discover` with a method-not-found, so a
2026-era agent harness sees a server that looks migrated and is not. It also
defers, rather than avoids, the `serveStdio` work — the 2025 era is on a
twelve-month deprecation clock.

### Option C: SDK v2, `legacy: 'reject'` (2026-07-28 only)

**Pros:** One wire era to reason about and test; no legacy surface to carry.

**Cons:** Breaks every currently deployed client on a one-day-old revision, for a
package whose maturity section openly states it has no external adopters yet. The
compatibility cost is real and immediate; the simplification is speculative.

### Option D: Do nothing — stay on `@modelcontextprotocol/sdk@1.29.0`

**Pros:** No work, no risk of regression.

**Cons:** Pins the package to a frozen v1 line that will not receive the new
revision, and keeps shipping consumers a thirteen-dependency HTTP/auth stack the
server never runs — including the advisory ADR-0017 could only accept, not fix.
The accepted exposure expires 2026-10-31 and would then fail CI closed with no
upstream remedy available.

## Trade-offs

We take on an upstream major-version migration one day after it shipped, against a
specification one day old. That is early. The mitigations are that adrkit's MCP
surface is four read-only tools that touch none of the changed features, that the
2025-era wire is asserted unchanged apart from `tools/list` ordering — so the blast
radius of a v2 regression is bounded to clients that explicitly opt into the new era
— and that the migration strictly shrinks the third-party attack surface rather than
growing it.

That ordering caveat is deliberate and worth naming rather than rounding off, since
it is the single exception to an otherwise unchanged legacy wire. MCP models `tools`
as an unordered set, so it is not a compatibility surface; the risk is not that a
client breaks but that "unchanged" gets read as absolute. Both eras now assert the
order unsorted, so the exception is enforced rather than asserted.

We also carry two wire eras. The era-selection logic lives in `serveStdio`, not in
adrkit, so a defect there is upstream and not directly fixable by us — which is
why both eras are exercised against a real spawned subprocess rather than only
in-process.

Finally, the `cacheScope: "public"` hint asserts that the tool catalog is safe for
shared caches. That is true today because the catalog is static package metadata,
and it stops being true if a future tool surface ever varies by caller or corpus.
Any such change must revisit the hint.

## Consequences

- **Easier:** Consumers install two transitive packages instead of a web framework
  stack. `bun audit` is clean with no `overrides` in effect, and the audit gate
  reports no known consumer exposure because there is none.
- **Easier:** 2026-era agent harnesses reach the corpus with no handshake, and can
  cache the tool catalog instead of re-listing it.
- **Harder:** Two wire eras must stay covered. Era coverage cannot be asserted
  in-process — `InMemoryTransport.createLinkedPair()` links 2025-era instances
  only — so the 2026-era evidence requires spawning the real bin.
- **How we would know this was wrong:** a 2025-era client that worked against
  `@adrkit/mcp@0.2.1` fails or observes a changed response against this build; a
  `tools/call` returns stale corpus data because something cacheable leaked a
  corpus read; or `@modelcontextprotocol/server@2.x` proves less stable than the
  frozen v1 line it replaced, measured by regressions traced to SDK behavior
  rather than adrkit code.
- **Revisit if:** the SDK removes 2025-era serving (at which point
  `legacy: 'serve'` becomes moot and Option C becomes the only option), a fifth
  tool or any caller-varying tool metadata is introduced (which invalidates
  `cacheScope: "public"`), or the MCP registry begins advertising a server's
  supported revisions, which `packages/mcp/server.json` should then declare.

## The `minimumReleaseAge` window

`bunfig.toml` sets `minimumReleaseAge = 259200` (three days). The v2 packages
published 2026-07-27T23:55Z, so they cannot be freshly **resolved** until
2026-07-30T23:55Z. `bun.lock` was therefore generated with a one-off
`bun install --minimum-release-age=0`.

Measured, not assumed — with the lockfile committed and `node_modules` deleted:

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` (CI) | succeeds |
| `bun install` (contributor, no flag) | succeeds; leaves `bun.lock` byte-identical |
| `bun update @modelcontextprotocol/*`, or resolving without a lockfile | blocked until 2026-07-30T23:55Z |

The gate applies at **resolution**, not to entries a lockfile already pins. So the
committed lockfile is exactly what a normal-policy resolution produces, nothing in
the documented clean-clone flow is blocked, and the lockfile does not need
regenerating.

We considered adding a standing
`minimumReleaseAgeExcludes = ["@modelcontextprotocol/server", ...]` to
`bunfig.toml` (verified working on Bun 1.3.14) and rejected it. The key is a
permanent waiver, not a one-time one: it would exempt every future
`@modelcontextprotocol/*` release from the soak, including releases nobody has
reviewed yet. A compromised MCP SDK executes inside every agent harness that
installs `@adrkit/mcp`, which makes these the packages the soak is most worth
keeping on — a poor thing to trade away permanently to save one day on one
migration. The constraint expires on its own and blocks nothing in the meantime.

## Action items

1. [x] Ratify or reject this proposed record. **Ratified by @mbeacom, 2026-07-31.**
2. [ ] Re-run MCP Inspector dogfood against both eras before release, as Phase 5
       did for the 2025 era.
3. [ ] Decide whether `packages/mcp/server.json` should advertise the supported
       protocol revisions once the registry schema supports it.
