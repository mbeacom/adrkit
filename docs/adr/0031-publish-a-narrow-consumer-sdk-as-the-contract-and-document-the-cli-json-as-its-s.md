---
schemaVersion: 0.1.0
id: "0031"
title: Publish a narrow consumer SDK as the contract, and document the CLI JSON as its sibling
status: proposed
date: 2026-08-16
deciders: ["@mbeacom"]
tags: [architecture, packaging, distribution, governance, api]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0010", "0013", "0019", "0025", "0029", "0030"]
affects:
  - type: path
    pattern: "packages/sdk/**"
  - type: path
    pattern: "packages/core/src/index.ts"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/cli/src/queue.ts"
  - type: path
    pattern: "scripts/release-pack.ts"
  - type: path
    pattern: "docs/RELEASING.md"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Creates a published package carrying a semver promise to consumers outside this
    repository, declares that `@adrkit/core` is not that promise, and amends two clauses
    of the accepted ADR-0029. A published surface is a one-way door: the commitment
    cannot be withdrawn once someone depends on it.
reviewBy: 2027-02-16
---

# ADR-0031: Publish a narrow consumer SDK as the contract, and document the CLI JSON as its sibling

> **Status: proposed, agent-drafted, unratified.** Creates the conduit
> [ADR-0030](0030-keep-extension-surfaces-that-carry-a-dependency-tree-outside-this-repository.md)
> foresaw. It authorizes the SDK's **design and construction**, not its release; publishing is
> a later record's act, as ADR-0029 clause 10 requires. It **amends ADR-0029 clauses 6 and 11
> by reference** — clause 11's current promise is measurably unkeepable.

## Context

ADR-0030 pushed extension surfaces that carry a dependency tree out of this repository, and
recorded that the consumption surface each of them must rebuild is why a consumer SDK was
intended. This record decides it.

### The promise that is currently false

[ADR-0029](0029-scope-backstage-publication-as-a-downstream-consumer-tiered-on-the-entity-owners.md)
clause 11 binds adrkit to additive-only change on "the consumed shapes," defining them as
`@adrkit/core`'s exported API and types. Measured at this revision:

| | count |
|---|---|
| symbols exported from `@adrkit/core` | **173** |
| re-export lines in its `index.ts` | 23 |
| symbols its in-repo library consumers import | **17** (`@adrkit/ci` 14, `@adrkit/catalog-envelope` 3) |

> **Corrected 2026-08-16**, under action item 3. This table originally read "symbols the only
> existing consumer (`@adrkit/ci`) imports — **3**." Both halves were wrong: `@adrkit/ci`
> imports **14** unique symbols (7 values, 7 types), and it is not the only consumer —
> `@adrkit/catalog-envelope` imports 3 more. The conclusion is unaffected (17 « 173) but the
> ratio is 5.7×, not 58×, and a record arguing for a narrower surface is the last place an
> unverified count belongs. Method: `docs/sdk-surface.md` §Measurements.

Clause 11 therefore promises stability across a 173-symbol internal engine to protect a
consumer surface of roughly seventeen. There are only two ways that resolves: freeze the engine
against ordinary refactoring, or break the promise quietly. The second is what happens in
practice, and a governing clause that is routinely and invisibly violated is worse than no
clause — it is the failure ADR-0016 and ADR-0014 exist to prevent, expressed as an API.

A narrow published facade is what makes the promise keepable. That is the SDK's primary
purpose; reducing consumer boilerplate is secondary.

### Two consumption modes already exist, and they do not agree

Both are in production in this repository today: `@adrkit/ci` consumes the **library**
(fourteen imports from `@adrkit/core`), and `@adrkit/spec-kit` consumes the **CLI**
(`scripts/context.sh` shells out to `adr check`). But the CLI's JSON is only sometimes a
core shape:

| command | `--json` source | matches the library? |
|---|---|---|
| `adr queue --format json` | `formatQueueReportJson(report)` — a core formatter | yes |
| `adr check --json` | the `CheckOutcome` core type, serialized | yes |
| `adr explain --json` | assembled inline in `packages/cli/src/index.ts` | **no** |
| `adr lint --json` | assembled inline: `{ checked, findings }` | **no** |
| `adr new --json` | `{ id, path }`, CLI-specific | **no** |

So "one interface, two adapters" is not available at this revision. It would additionally
require a normalization layer for three commands whose CLI shape exists nowhere in core, and
a cross-mode equivalence property tested on every release.

### And the isolation argument does not apply in reverse

`@adrkit/core` depends on `picomatch`, `semver`, `yaml`, and `zod` — four deterministic,
credential-free packages. A library consumer inherits almost nothing. The dependency-tree
asymmetry that justified pushing Backstage out (1,274 packages) does not exist in the other
direction, so process isolation buys a Node consumer very little here.

## Decision

**Publish a narrow, independently versioned consumer SDK as the contract adrkit commits to,
and document the CLI JSON as a separate sibling contract rather than as an SDK adapter.**

1. **`@adrkit/sdk` is the consumer contract.** A deliberately small typed facade over
   `@adrkit/core`, living at `packages/sdk/`. It satisfies ADR-0030 clause 1 — its only
   dependency is the workspace core, so it adds no install cost and belongs in this
   repository.

2. **`@adrkit/core` is explicitly not a consumer contract.** Its 173 exported symbols are the
   internal engine, free to change with the engine. This is stated so the status quo stops
   being ambiguous by default, and so a core refactor stops being a governance question.

3. **ADR-0029 clause 11 is amended by reference**: adrkit's additive-only obligation attaches
   to `@adrkit/sdk`'s surface and to the CLI JSON contract of clause 5, **not** to
   `@adrkit/core`. That is the narrowing which makes the obligation keepable rather than
   nominal. **ADR-0029 clause 6 is amended likewise**: a downstream surface binds to
   `@adrkit/sdk` and the documented CLI JSON, not to core's runtime API.

4. **The SDK declares its own types rather than re-exporting core's.** A facade that
   re-exports is an alias and insulates nothing — the first core rename would reach every
   consumer. The mapping layer is the insulation, and the duplication is deliberate. This
   follows `packages/catalog-envelope/`, whose own `//boundary` note records the identical
   choice: both packages "declare the envelope's shape independently, which is the single
   deliberate duplication in this design… a shared type module would be an import edge, and
   it is exactly that independence that makes this package's structural validation a check
   rather than a tautology."

5. **The CLI JSON is a documented, versioned contract in its own right** — not an SDK
   adapter. Its consumers are language-agnostic (`spec-kit` shells out; the badges read
   `queue.json`), and what they need is a stable schema, not a JavaScript package. It is
   documented in `docs/RELEASING.md` alongside the SDK's surface and carries the same
   additive-only obligation.

6. **Library-first, and the door to a CLI adapter stays open.** The SDK commits to the
   library mode only. The three commands whose `--json` is assembled in the CLI —
   `explain`, `lint`, `new` — are converged onto core formatters as hygiene, the way `queue`
   already is. That is independently worth doing, and once done a CLI adapter becomes nearly
   free. **The direction matters: adding an adapter later is additive; withdrawing one is a
   break.**

7. **Independently versioned**, `versioning: 'independent'` in `scripts/release-pack.ts`,
   following `@adrkit/spec-kit`. A stability facade on the lockstep engine's cadence would
   inherit the churn it exists to absorb.

8. **No release is authorized here.** ADR-0029 clause 10 continues to govern; publishing
   `@adrkit/sdk` is a later record's act, taken when its surface has been exercised by a real
   consumer rather than designed against a hypothetical one.

## Options considered

### Option A: Library-first SDK, CLI JSON documented separately (chosen)

| Dimension | Assessment |
|---|---|
| Makes ADR-0029 clause 11 keepable | **Yes — the point** |
| Serves the one known consumer (Backstage, Node) | Yes, typed, no subprocess |
| Serves language-agnostic consumers | Yes, via the documented CLI contract |
| Commitment surface | One facade plus one JSON schema |
| Path to both modes | Open, additively |

### Option B: CLI-first SDK — spawn `adr`, parse JSON

**Pros:** process isolation; no library coupling; the same mechanism for every language.

**Cons:** the isolation buys little, since core drags four deterministic packages; it imposes
a subprocess and JSON parsing on a Node consumer that could just call a function; and it
would make the typed surface a wrapper over stringly output. It also does not remove the need
to document the JSON, so it is Option A's second half without its first.

### Option C: Both modes behind one interface

**Pros:** genuinely serves both consumer classes from one package; both modes already exist
in production here.

**Cons:** not available at this revision without inventing a normalization layer for
`explain`, `lint`, and `new`, plus a cross-mode equivalence property maintained forever. It
also **widens the very surface the SDK exists to narrow** — the commitment becomes the
facade, the JSON, *and* their agreement. Rejected now, not forever: clause 6 makes it cheap
later, and A → C is additive while C → A is a break.

### Option D: Do nothing — let each consumer import `@adrkit/core`

**Pros:** no new package, no new semver commitment.

**Cons:** leaves clause 11 false, leaves every core refactor a governance question, and
makes each out-of-repo surface rebuild the same consumption layer — the duplication ADR-0030
recorded as its own wrongness signal.

## Trade-offs

- **A second surface to maintain, and a mapping layer with it.** Clause 4's deliberate
  duplication means a core change that should reach consumers now requires a deliberate act
  in the SDK. That is the cost of insulation, and it is paid on every intended change, not
  only on breaking ones.
- **A published SDK is a one-way door.** Once a consumer depends on it the surface cannot be
  withdrawn, only deprecated. This is why clause 8 withholds the release until a real
  consumer has exercised it.
- **Designing against a hypothetical consumer.** The only out-of-repo surface does not exist
  yet, so the SDK's first shape is a guess. Clause 8 is the mitigation; the risk is that the
  guess hardens before the Backstage plugin tests it.
- **Two contracts can drift from each other.** The SDK and the CLI JSON both carry the
  additive-only obligation, and nothing yet asserts they describe the same decisions. Clause
  6's convergence work reduces this; it does not eliminate it.

## Consequences

- **Easier:** ADR-0029 clause 11 becomes a promise that can actually be kept; core refactors
  stop being governance events; out-of-repo surfaces get one documented way in; ADR-0030's
  conformance fixture and the SDK's test fixture are the same artifact.
- **Harder:** one more package, a mapping layer, and two contracts to keep honest.
- **How we would know this was wrong:** if the SDK's surface has to grow past roughly a dozen
  entry points to serve its first real consumer, then it is not a facade but a re-export of
  core under another name, and the insulation is fictional. A second signal: if the first
  real consumer needs something the SDK lacks and reaches into `@adrkit/core` directly, the
  facade failed at its only job.
- **Revisit if:** a non-JavaScript consumer appears, which would make clause 6's CLI adapter
  worth building rather than merely worth keeping cheap.

## Action items

1. [ ] Ratify or reject this record. It is `proposed` and agent-drafted with no `ratifiedBy`.
2. [ ] Land the amendment note on ADR-0029 recording that clauses 6 and 11 are narrowed by
   this record's clause 3, per the mechanism ADR-0013 used on ADR-0007.
3. [x] Enumerate the SDK's first surface from what a real consumer needs — the Tier 1
   capabilities of ADR-0029 clause 1 — rather than from what core exports. Record the count;
   if it exceeds a dozen entry points, the wrongness signal above has already fired.
   **Done 2026-08-16: [`docs/sdk-surface.md`](../sdk-surface.md), sketched at `packages/sdk/`.
   7 callable entry points; 17 exported symbols. The signal fires on the second count and not
   the first, and the record does not say which it meant — see that document's verdict, which
   recommends restating this criterion before ratification.**
4. [ ] Converge `explain`, `lint`, and `new` `--json` onto core formatters, as `queue` is,
   so the two modes describe the same shapes.
5. [ ] Document the CLI JSON contract and the SDK surface in `docs/RELEASING.md`, with the
   additive-only obligation stated at both.
6. [ ] Build the conformance fixture ADR-0030 action item 5 names, as the SDK's own test
   fixture, so one artifact discharges both records.
