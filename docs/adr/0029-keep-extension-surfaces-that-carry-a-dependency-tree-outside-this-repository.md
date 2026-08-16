---
schemaVersion: 0.1.0
id: "0029"
title: Keep extension surfaces that carry a dependency tree outside this repository
status: proposed
date: 2026-08-16
deciders: ["@mbeacom"]
tags: [architecture, packaging, governance, distribution, supply-chain]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0010", "0013", "0016", "0019", "0025", "0028"]
affects:
  - type: path
    pattern: "scripts/check-deps.ts"
  - type: path
    pattern: "packages/adapters/**"
  - type: path
    pattern: "packages/ci/**"
  - type: path
    pattern: "bunfig.toml"
  - type: path
    pattern: "package.json"
assertions:
  - id: no-backstage-sdk-in-this-repository
    description: >-
      No workspace package declares a dependency whose name begins with @backstage/.
      The Backstage publication surface is a downstream consumer in its own repository,
      so its SDK never enters this dependency graph.
    engine: custom
    expression: no-backstage-sdk-in-this-repository
    input: source
    severity: error
provenance:
  authoredBy: agent-drafted
externalRefs:
  - type: doc
    url: "https://github.com/backstage/community-plugins/tree/main/workspaces/adr/plugins/adr"
    label: "@backstage-community/plugin-adr — the document layer the publication surface extends"
review:
  tier: arb
  tierReason: >-
    Sets the rule every future extension surface is placed by, narrows ADR-0007's
    Option C disposition on evidence ADR-0007 did not have, and resolves ADR-0028
    action item 2. It also reverses this record's own first draft, so the reasoning
    that changed needs to be reviewable rather than quietly replaced.
reviewBy: 2027-02-16
---

# ADR-0029: Keep extension surfaces that carry a dependency tree outside this repository

> **Status: proposed, agent-drafted, unratified.** Resolves
> [ADR-0028](0028-scope-backstage-publication-as-a-downstream-consumer-tiered-on-the-entity-owners.md)
> action item 2: the Backstage publication surface lives **outside** this repository. It
> also states the general rule future surfaces are placed by. It authorizes no release, and
> does not change ADR-0028's Tier 1 / Tier 2 split.
> **This record reverses its own first draft**, which decided in-repo. What changed is
> measurement, recorded below.

## Context

ADR-0028 clause 5 deferred the Backstage plugin's repository home. This record's first draft
decided **in-repo**, on two findings that still hold and one argument that did not.

What holds: Constitution Principle III's "external services at build, test, or run time"
does not bar the plugin — `@adrkit/ci` ships at `packages/ci/` and calls `getOctokit(token)`
against the authenticated GitHub API at run time, so that clause is read as build/test
hermeticity plus dependency confinement, not as a rule about a shipped surface's runtime
peers. And ADR-0007's placement costs are already solved here: `isAdapterPackage()` is
location-based, `ReleaseVersioning` supports `'independent'`, and `check-deps.ts` is a
per-package allowlist.

### What changed: the cost was measured rather than estimated

The first draft called the dependency cost real but did not quantify it. Measured on
2026-08-16 with Bun 1.3.14, installing the plugin's plausible dependency set in a scratch
directory:

| | this repository today | + Backstage runtime set | + community ADR plugin and `@backstage/cli` |
|---|---|---|---|
| packages | **94** | 607 | **1,274** |
| `node_modules` | **65 MB** | 480 MB | **1.0 GB** |
| install, warm cache | ~0.06 s | 11 s | **39 s** |
| dependencies requesting lifecycle scripts | **0** | — | **2** (`@swc/core`, `core-js-pure`) |

Even the floor — runtime dependencies only, building with Bun per
[ADR-0010](0010-bun-toolchain.md) instead of `@backstage/cli` — is **7.4× the disk and 6.5×
the packages**. The realistic set is **15× and 13.5×**.

Three things make that worse than the multiples suggest. `clean-clone-builds` runs
`bun install --frozen-lockfile` from cold on **every** pull request, including ones touching
only `docs/adr/`, so 39 s is a lower bound. This repository currently has **zero**
dependencies requesting lifecycle scripts, and Backstage's tree brings two — a new
supply-chain surface in a project whose constitution is built on hermetic, credential-free,
deterministic dependencies. And confinement does not help: an allowlist bounds which package
may *import* the SDK, not what gets *installed*, because Bun installs every workspace
member's dependencies regardless.

### And the argument that justified in-repo was overstated

The first draft's decisive claim was that separation makes ADR-0028 unenforceable. Broken
down, one mechanism is lost, not a category:

| | in-repo | out-of-repo |
|---|---|---|
| ADR-0028 clause 4 — not a catalog adapter | checkable | **stronger**: a blanket SDK prohibition beats an allowlisted exception |
| SDK confinement | allowlist plus prefix rule | blanket prohibition, still checked here |
| ADR-0028 clause 8 — no reimplementation of the resolvers | not mechanically checkable either way; a dependency graph cannot detect re-derived `affects` matching | unchanged |
| ADR-0028 clause 11 — adrkit's additive-only obligation | governs *this* repository | unchanged |
| **contract drift caught in a single CI run** | **yes** | **no — the one real loss** |

That loss is real and is accepted below with named mitigations. It is not worth a 15×
dependency tree.

### The distinguishing property is install cost, not plugin-ness

`@adrkit/spec-kit` is an extension surface that lives here and should. It declares **no
`dependencies`, no `devDependencies`, and no `peerDependencies`** — asserted by
`packages/adapters/spec-kit/test/packaging.test.ts` — ships no `dist`, and is copied verbatim
by `specify extension add`. It costs nothing to install.

So the question was never "is it a plugin." It is whether the surface drags a tree.

## Decision

**An extension surface may live in this repository only if it adds no install cost.
Otherwise it lives in its own repository and consumes adrkit's published contracts.**

1. **The rule.** A surface qualifies to live here only if it declares no third-party
   `dependencies`, `devDependencies`, or `peerDependencies` beyond the vetted set already
   permitted by `scripts/check-deps.ts`. `@adrkit/spec-kit` is the exemplar, and its
   zero-dependency packaging test is the pattern a qualifying surface follows.

2. **The Backstage publication surface lives outside this repository**, in its own
   repository, and is not a workspace package here. It fails clause 1 by 1,274 packages.

3. **`@backstage/*` is prohibited in every workspace package**, enforced by
   `no-backstage-sdk-in-this-repository` in `scripts/check-deps.ts`, observed failing first
   per [ADR-0016](0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md).
   This is simpler and stronger than the confined-allowlist form the first draft proposed:
   there is no exception to get wrong, and it fires on a package the allowlist has never
   heard of, which `allowedDependenciesFor` would otherwise leave *silently unconstrained*.

4. **The consumer contract is unchanged.** ADR-0028 clauses 6, 8, and 11 govern the
   downstream surface exactly as written. Clause 11 — adrkit changes the consumed shapes
   additively or through a stated deprecation path — is the contractual counterpart to
   losing same-run drift detection, and it is enforceable here.

5. **Mitigations for the one accepted loss**, so it is managed rather than merely admitted:
   the downstream repository pins published `@adrkit/*` versions and tests against them in
   its own CI; and adrkit publishes a conformance fixture — a golden `adr queue --format
   json` / `adr check --json` pair over a small fixed corpus — that a consumer can assert
   against, so a breaking change is detectable downstream without reading this repository.

6. **This narrows ADR-0007 Option C, and says so.** ADR-0007 rejected separate repositories
   because they "fragment a project with one maintainer and no users," and set the revisit
   condition "once an adapter acquires independent contributors." That condition is **not**
   met — this record does not claim it is. It narrows the disposition on a different and
   new ground: ADR-0007 weighed fragmentation when no integration carried a dependency tree,
   and did not weigh an integration whose tree would be **15× the repository it joins**.
   Action item 4 lands the amendment note by reference, the mechanism ADR-0013 used on
   ADR-0007 and ADR-0014 used on ADR-0013.

## Options considered

### Option A: Extension surfaces with a dependency tree live outside (chosen)

| Dimension | Assessment |
|---|---|
| Install cost here | **Unchanged — 94 packages, 65 MB, 0 lifecycle scripts** |
| Supply-chain surface | Unchanged |
| `clean-clone-builds` | Unchanged on every PR |
| SDK prohibition | **Stronger** than confinement — no exception to misuse |
| Contract drift | **Not caught in one run** — accepted, mitigated by clause 5 |
| Generality | States the rule the next surface is placed by |

### Option B: In this repository as a confined surface (this record's first draft)

**Pros:** producer and consumer in one CI run, so drift breaks the build immediately;
ADR-0028 clause 4 becomes a mechanical check; nothing to publish before Tier 1 can be built.

**Cons:** the measured cost — 15× packages and disk, 2 new lifecycle scripts, a slower and
more fragile `clean-clone-builds` on every pull request including documentation-only ones.
Confinement bounds imports, not installs. The enforceability it buys is one mechanism, and
three of the four boundary properties are *better* served by prohibition.

### Option C: In-repo, but excluded from the default install

**Pros:** would keep both the single CI run and the small default install.

**Cons:** Bun installs every workspace member's dependencies; there is no supported "optional
workspace member." Achieving it would mean a second lockfile or a filtered install, both of
which make `clean-clone-builds` prove something weaker than it proves today — the one
assertion this repository most relies on. Rejected as a real mechanism, not as an idea.

### Option D: Keep deferring, as ADR-0028 clause 5 does

**Pros:** no decision risk.

**Cons:** ADR-0028 clause 1 authorizes Tier 1 with nowhere to build it, and the deferral had
no end condition. The measurement that closes the question now exists.

## Trade-offs

- **Contract drift is not caught in a single CI run.** The accepted cost. Clause 5's
  mitigations reduce it; they do not remove it. A breaking change to `CheckOutcome` will be
  found by the downstream repository's CI or by a bug report, not by this repository's.
- **Two repositories, two cadences.** Real ongoing overhead, and a real chance the plugin
  lags the ADR schema after a `schemaVersion` bump.
- **The rule is coarse.** "No third-party dependencies" is a blunt qualifier: a surface
  needing one small, vetted, deterministic library is pushed out alongside one needing 1,274.
  Accepted because the alternative — a size or count budget — invites argument at every
  increment, and because the vetted set in `check-deps.ts` is the existing escape valve for a
  genuinely small addition.
- **Dogfooding gets harder.** The plugin cannot be exercised by this repository's suite, so
  adrkit loses the fastest signal that its own JSON outputs are usable.

## Consequences

- **Easier:** the install stays 94 packages and 65 MB with zero lifecycle scripts;
  `clean-clone-builds` keeps proving what it proves today; the SDK prohibition is simpler
  than confinement; and future surfaces have a stated rule rather than a case-by-case
  argument.
- **Harder:** cross-repository drift; two cadences; no dogfooding of the consumer.
- **How we would know this was wrong:** if the conformance fixture in clause 5 does not get
  built, or is built and still lets a breaking change reach a consumer undetected, then the
  mitigation failed and the drift cost is larger than accepted here. A second signal: if
  three or more extension surfaces end up outside, each re-implementing the same consumption
  boilerplate, the missing thing is a published consumer SDK and this record should be
  revisited rather than repeated.
- **Revisit if:** the install cost stops being the binding constraint — a Backstage plugin
  that needs only peer dependencies, or tooling that makes workspace members genuinely
  optional without weakening `clean-clone-builds`.

## Action items

1. [ ] Ratify or reject this record. It is `proposed` and agent-drafted with no `ratifiedBy`.
2. [ ] Land `no-backstage-sdk-in-this-repository` in `scripts/check-deps.ts` with its test,
   observed failing first per ADR-0016.
3. [ ] Record on ADR-0028 that action item 2 is resolved by this record.
4. [ ] Land the amendment-by-reference note in
   [ADR-0007](0007-adapter-isolation-and-public-surface-build.md) recording that its Option C
   disposition is narrowed for an integration whose dependency tree would dominate this
   repository's install, citing the measurement in this record's Context.
5. [ ] Build the conformance fixture named in clause 5, so the accepted drift cost has the
   mitigation this record claims for it. Without it, clause 5 is an intention rather than a
   control.
6. [ ] When the downstream repository is created, record its location here so this record
   names where the surface actually lives.
