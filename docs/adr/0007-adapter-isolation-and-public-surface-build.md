---
schemaVersion: 0.1.0
id: "0007"
title: Isolate integrations as optional adapters and build only against public surfaces
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [architecture, packaging, governance, ip-hygiene]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0003", "0006"]
affects:
  - type: path
    pattern: "packages/*/package.json"
  - type: path
    pattern: ".github/workflows/**"
  - type: path
    pattern: "packages/adapters/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Sets the dependency boundary for every future integration and the IP
    boundary for the repository. Expensive to reverse once adapters exist.
assertions:
  - id: core-has-no-adapter-deps
    description: >-
      No package outside packages/adapters/** may depend on an adapter package,
      and no package may depend on a source requiring authenticated access.
    engine: custom
    input: source
    severity: error
  - id: clean-clone-builds
    description: >-
      A clean clone with no credentials configured must install, build, test,
      and lint successfully.
    engine: custom
    input: source
    severity: error
---

# ADR-0007: Isolate integrations as optional adapters and build only against public surfaces

## Context

The integration surface is already wider than the core: spec-driven harnesses,
agent team frameworks, agent package managers, IDP catalogs, and cloud API
governance services. Each is a different organization's roadmap moving at a
different speed, and several are explicitly pre-1.0 — one ships alpha software
with CLI commands that may change between releases, another is at v0.25 after
seventy-one releases in five months. Coupling the core to any of them
transfers their churn directly into ours.

There is a second, independent force. The maintainer's personal GitHub identity
cannot reach Microsoft-internal organizations or repositories except from an
approved corporate device. Treating that purely as an inconvenience misses what
it offers: it is a hard, mechanical boundary between an Apache-2.0 open-source
project and an employer's internal IP. A boundary that CI enforces is worth far
more than a boundary maintained by diligence, and it is the answer to give if
anyone internally asks how separation was maintained.

Both forces point to the same structure.

## Decision

**Every integration is an optional, separately published adapter package.**

- `@adrkit/core`, `@adrkit/cli`, and the schema depend on nothing but the filesystem
  and their own workspace packages. No adapter, ever.
- Adapters live under `packages/adapters/*`, are versioned independently, and
  are permitted to break on upstream churn. Their semver contract is with their
  upstream, not with our core.
- Adapters depend on the core; the core never learns an adapter exists.
  Discovery is by configuration, resolved at runtime.

**No package in the default build may depend on an artifact requiring
authenticated or corporate-device access.**

- A clean clone with no credentials must install, build, test, and lint green.
  This is asserted in CI (`clean-clone-builds`), not merely documented.
- Adapters may target only publicly documented, publicly fetchable surfaces:
  public repositories, published packages, public API documentation.
- If an integration requires internal access to develop, it does not belong in
  this repository. It belongs in a separate repository under whatever process
  governs that access.

**Named consequence for the current targets.** The spec-driven harness, agent
package manager, and agent-team framework adapters are all buildable under this
rule — those projects are public and permissively licensed. The Azure API
Management adapter is deferred (see below), and any Azure adapter is limited to
public documentation and public SDK packages.

## Options considered

### Option A: Optional adapters, public-surface build constraint (chosen)

| Dimension | Assessment |
|---|---|
| Upstream churn isolation | High — breakage is confined to one package |
| IP boundary | Mechanically enforced by CI |
| Contributor onboarding | Clean clone works with zero credentials |
| Complexity | Medium — more packages, a release matrix, plugin resolution |

### Option B: Integrations built into the core, feature-flagged

**Pros:** one package to release, simpler resolution, no plugin API to design.
**Cons:** the core's dependency tree inherits every upstream's churn; a
pre-1.0 upstream breaking change becomes a core release; and the IP boundary
becomes a code-review judgment call rather than a build failure.

### Option C: Adapters in separate repositories from the start

**Pros:** the strongest possible isolation; each adapter can have its own
governance.
**Cons:** at this stage it fragments a project with one maintainer and no
users, and makes cross-cutting changes to the plugin API a multi-repo dance.
Reconsider per-adapter once an adapter has independent contributors.

## Trade-offs

Optional adapters mean a plugin resolution mechanism, a release matrix, and
integration tests that must run against pinned upstream versions rather than
latest. That is real cost, accepted because the alternative imports other
projects' release cadences into ours.

The public-surface constraint forecloses some genuinely useful integrations —
anything that would need internal access to build well simply cannot be built
here. Accepted deliberately: an integration that cannot be developed in the open
cannot be maintained by an open-source community either, so the constraint is
mostly selecting for adapters that were viable anyway.

## Consequences

- Easier: contributing (clean clone, no credentials); reasoning about IP
  provenance; letting a fast-moving adapter break without blocking a core
  release; running the whole project on a personal device.
- Harder: cross-cutting refactors that touch the plugin API; integration test
  fidelity, since adapters test against pinned versions rather than live
  upstreams.
- The two assertions are the enforcement. If either is ever disabled to unblock
  a release, this decision has been abandoned in practice and should be
  superseded explicitly rather than left standing as fiction.
- Revisit if: an adapter acquires independent contributors and its own release
  needs, at which point Option C becomes right *for that adapter* without
  disturbing this record.

## Action items

1. [ ] `packages/adapters/` with a documented plugin contract
2. [ ] `core-has-no-adapter-deps` as a dependency-graph check in CI
3. [ ] `clean-clone-builds` job running with no credentials in the environment
4. [ ] Adapter release matrix pinning tested upstream versions
5. [ ] CONTRIBUTING.md states the public-surface rule as a contribution
       requirement, not a preference
