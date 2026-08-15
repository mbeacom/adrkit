---
schemaVersion: 0.1.0
id: "0028"
title: Scope Backstage publication as a downstream consumer, tiered on the entity-ownership mapping
status: proposed
date: 2026-08-15
deciders: ["@mbeacom"]
tags: [architecture, packaging, catalog, distribution, governance]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0003", "0007", "0009", "0012", "0013", "0014", "0019", "0020"]
affects:
  - type: path
    pattern: "packages/adapters/catalog-*/**"
  - type: path
    pattern: "packages/catalog-envelope/**"
  - type: path
    pattern: "schema/adr.schema.json"
  - type: path
    pattern: "packages/core/src/index.ts"
  - type: path
    pattern: "packages/core/src/check/**"
  - type: path
    pattern: "packages/core/src/graph/**"
  - type: path
    pattern: "packages/core/src/queue/**"
  - type: path
    pattern: "packages/core/src/affects/**"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/cli/src/queue.ts"
  - type: path
    pattern: "scripts/release-pack.ts"
provenance:
  authoredBy: agent-drafted
externalRefs:
  - type: doc
    url: "https://github.com/backstage/community-plugins/tree/main/workspaces/adr/plugins/adr"
    label: "@backstage-community/plugin-adr — prior art for the document layer (clause 7)"
  - type: pr
    id: "98"
    url: "https://github.com/mbeacom/adrkit/pull/98"
    label: "Feature 010 Phase G — the ingest-direction work that surfaced this gap"
review:
  tier: arb
  tierReason: >-
    Creates a public consumer surface for adrkit's published output, states how
    ADR-0013's catalog clause applies to a direction it did not contemplate, and
    routes the entity-ownership mapping through ADR-0013's mechanism rather than
    around it. All three are readings others will build on, and the third is the
    one an earlier draft of this record got wrong.
reviewBy: 2027-02-15
---

# ADR-0028: Scope Backstage publication as a downstream consumer, tiered on the entity-ownership mapping

> **Status: proposed, agent-drafted, unratified.** This record scopes work toward
> [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
> **rung 1 only**. It does not authorize a release, a publish target, a tag, a channel,
> or a date, and it does not itself authorize the entity-scoped tier it defines.
> The largest accepted cost is that cross-repository contract drift is unpoliced by any
> single CI run. **Nothing here is enforced by a check** — see *Enforcement posture*.
> Action item 1 asks `@mbeacom` to ratify or reject.

## Context

[ADR-0013](0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
settled how catalog composition works, for one direction of data flow: **Backstage →
adrkit**. A catalog adapter is "a standalone offline snapshot generator that emits a
validated interchange file **which the core consumes**," the in-memory `CatalogSnapshot`
is "an internal type, **not** a wire format," any persisted snapshot "requires a versioned
interchange envelope before production," and the binding invariant is that "the core still
never learns an adapter exists." Feature 010 implements that direction:
`@adrkit/catalog-backstage` reads the `adrkit.io/owned-paths` annotation off catalog
descriptors so `affects:` patterns can resolve to owners.

The demand now on the table is to make adrkit-originated ADRs **visible inside Backstage**,
where engineers already work. No record in this corpus addresses that.

### The ownership mapping is the hinge, and it splits the surface in two

It is tempting to describe the new demand as simply "the other direction" and stop there.
That is where an earlier draft of this record went wrong, and the error is worth stating
because the correction is the whole structure below.

Publishing a *corpus* into Backstage — the ADR list, the ARB queue, the supersession graph,
a record's status — flows adrkit → Backstage and needs nothing from the catalog. But the
feature people actually ask for, *"which decisions govern **this component**,"* needs an
entity-to-path mapping first: it must know which repository paths the component owns before
`affects:` can be resolved against them. That mapping is ADR-0012's `adrkit.io/owned-paths`
annotation, and obtaining it means **reading Backstage catalog entities** — which is
ingest, flowing Backstage → adrkit, squarely inside what ADR-0013 governs.

So "the publication surface" is not one thing. It divides on whether a capability needs the
ownership mapping, and only the half that does touches ADR-0013 at all.

Left unsplit, the gap is exploitable rather than merely untidy. A plugin could call
`catalogApi.getEntities()`, read `metadata.annotations['adrkit.io/owned-paths']` off live
entities, build the `CatalogSnapshot` that `@adrkit/core` exports, and pass it to
`resolveAffects` — while claiming conformance with a record that said ADR-0013 governs only
the other direction. That is a dynamic runtime catalog resolver with no offline generator
and no versioned envelope, transporting across a process boundary the very type ADR-0013
declares is not a wire format. It is the shape ADR-0013 refused, reachable by relabeling.

### Prior art: the document half already exists

`@backstage-community/plugin-adr` contributes an entity ADR tab, a backend that fetches
markdown through Backstage's URL readers, search indexing, New Frontend System support, and
extension points named `filePathFilterFn`, `contentDecorators`, and `statusComponent`.

Two details suggest it is close to adrkit already: adrkit's `NNNN-title-with-dashes.md`
filenames match the plugin's own documented custom-filter example, and its sample status
component switches on the six statuses in `schema/adr.schema.json`. **Both observations come
from reading its public documentation, not from running it**, and whether its MADR-oriented
parser reads adrkit frontmatter acceptably is unverified — action item 5.

What it does not model is the machine-readable layer that is adrkit's contribution:
path-to-decision governance, the ARB queue and its SLA state, assertion status, the
supersession graph, and inbound `@adr` markers.

### Why now

The cost of leaving this unscoped is not hypothetical: an 8,554-line, 97-file effort
(PR #98) advanced the ingest direction under the shared belief that "Backstage support" was
being built. That work is not wasted and it is not this — but as the tier split above shows,
it is also not unrelated. The envelope it produces is what the entity-scoped tier needs.

## Decision

**We will scope adrkit → Backstage publication as a downstream consumer of adrkit's
published output, split into two tiers by whether a capability needs the entity-ownership
mapping.**

The numbered clauses below bind. Unnumbered prose in this record is commentary and binds
nothing — a deliberate choice, because an earlier draft stated a clause count that its own
enumeration contradicted, and a miscount is the cheapest way to make a governing record
argue against itself.

1. **Tier 1 — corpus-scoped, authorized by this record.** Capabilities that need no
   entity-to-path mapping: browsing the corpus, the ARB queue and its SLA state, the
   supersession graph, record status, and path-governance for a path the caller supplies
   explicitly. This tier is authorized to be built.

2. **Tier 2 — entity-scoped, NOT authorized by this record.** Any capability answering
   "which decisions govern this component," or otherwise requiring the entity-to-path
   mapping. Scoped here so its constraints are known in advance; authorizing it is a later
   record's job.

3. **The dependency edge is one-way: plugin → adrkit.** adrkit does not discover, resolve,
   import, load, or depend on the plugin, and gains no knowledge that it exists. This
   preserves ADR-0013's invariant rather than carving an exception from it.

4. **The plugin is not a catalog adapter, and does not live under
   `packages/adapters/catalog-*/**`.** It is not a standalone offline snapshot generator,
   so ADR-0013's catalog clause does not describe it, and placing it inside that glob would
   attach a contract it cannot satisfy.

5. **The repository home is deferred to a follow-up record, and until that record no plugin
   code lands in this repository.** The criteria to decide it are named, not assumed:
   Constitution Principle III forbids any package depending on "external services at build,
   test, or run time," which plausibly reaches a plugin that requires a running Backstage
   instance; and [ADR-0007](0007-adapter-isolation-and-public-surface-build.md) considered
   separate repositories as its Option C, rejected it for "a project with one maintainer and
   no users," and set a revisit condition — "once an adapter has independent contributors"
   — that is not currently met.

6. **Tier 1 binds only to contracts published at `0.7.0`**: `schema/adr.schema.json`,
   `@adrkit/core`'s published **runtime API and types**, and the CLI's machine-readable
   outputs (`adr queue --format json`, `adr check --json`, `adr explain`, `adr graph`). It
   **MUST NOT** depend on `@adrkit/catalog-envelope` or `@adrkit/catalog-backstage` while
   [ADR-0020](0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
   clause 9's release decision remains unmade. The condition is that undecided release, not
   a version string — a `0.0.0` in a manifest is an editable token, and conditioning on it
   would let a two-line commit lift the prohibition while clearing no gate.

7. **Tier 2, when authorized, obtains the entity-ownership mapping only through ADR-0013's
   mechanism** — the offline generator and its versioned interchange envelope — and never
   from a live catalog read. It does not reimplement the `adrkit.io/owned-paths` decode; the
   annotation's ordered decode steps, restricted glob dialect, and ownership states live in
   feature 010's packages and are consumed, not copied. Tier 2 is therefore blocked until
   that envelope is published, and this record does not shorten that path.

8. **Resolution runs through `@adrkit/core`'s published resolvers, never a
   reimplementation.** Re-deriving `affects:` matching, status bucketing, queue
   construction, or graph building downstream would create exactly the drift the trade-offs
   section names as this option's main cost, in the one place it is avoidable.

9. **The document layer extends `@backstage-community/plugin-adr` rather than competing with
   it**, under a bounded, verified version range whose upper edge is a verification
   boundary — the discipline
   [ADR-0019](0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md)
   clause 4 established for `speckit_version`, where widening is a re-verification rather
   than a version bump. Any proposal to reimplement ADR rendering must first record, **as an
   ADR in `docs/adr/` accepted by `@mbeacom`**, which extension point was tried and what was
   observed to fail.

**This record does not amend or supersede ADR-0013.** Clause 7 routes the only part of this
surface that touches the ingest direction *through* ADR-0013's mechanism rather than around
it, so the catalog clause remains authoritative and unnarrowed. Clause 4 states where
ADR-0013's contract does not apply, which is a statement about this new surface, not a
change to that record.

## Enforcement posture

Stated plainly because silence here would be its own defect: **this record carries no
`assertions:` and nothing mechanically enforces any clause today.** Comparable boundary
records — ADR-0007's `core-has-no-adapter-deps` and `clean-clone-builds`, ADR-0020's
accept-path assertion — each pair an assertion id with an identically named CI job. This one
cannot yet, because the surface it governs does not exist and clause 5 forbids in-repo code
until placement is decided.

Two things follow, and both are real:

- What *is* detectable today is only that `affects:` surfaces this record on pull requests
  touching the exclusion zone or the bound contracts. That is a reminder, not a gate: it
  appears identically on compliant and non-compliant changes, and `adr check` exits `0`
  either way.
- The one real control is `CODEOWNERS`, which requires `@mbeacom` on `/docs/adr/` and on
  `*`. Every clause here ultimately rests on maintainer review — the same human process that,
  by this record's own Context, already let an 8,554-line effort go the wrong direction.

Action item 4 wires a check when clause 5 resolves. Until then these clauses are advisory,
and this section is what keeps that legible.

## Options considered

### Option A: A tiered downstream consumer (chosen)

| Dimension | Assessment |
|---|---|
| ADR-0013 invariant | Preserved; Tier 2 routed through its mechanism, not around it |
| ADR-0007 assertions | Untouched — no claim is made that they constrain `@backstage/*` |
| Contract available today | Tier 1 yes, at `0.7.0`; Tier 2 blocked on the envelope |
| Release coupling | Tier 1 none; Tier 2 inherits ADR-0020 clause 9 by design |
| Enforcement | **None today — advisory, see Enforcement posture** |
| Contract drift | **Unpoliced across the boundary — the real cost** |

### Option B: Build it in-repo as another `packages/adapters/catalog-*` package

**Pros:** one repository and one toolchain; producer and consumer of the JSON contracts sit
in a single CI run, so drift is caught at compile time rather than by a downstream bug
report; dogfooding is trivial.

**Cons:** inherits ADR-0013's offline-generator constraint by path, which the plugin cannot
satisfy. Two costs often assumed here are **not** real and are recorded as such: the
repository's dependency enforcement is a *per-package allowlist*
(`scripts/check-deps.ts`), so admitting a new package weakens nothing for any other, and
independent release cadence already exists as `versioning: 'independent'` in
`scripts/release-pack.ts`, which `@adrkit/spec-kit` uses. The genuine obstacle is
Constitution Principle III's run-time clause, which clause 5 defers rather than decides.

### Option C: Extend `@adrkit/catalog-backstage` to be bidirectional

**Pros:** one package named for the system it integrates with.

**Cons:** conflates two directions in one unit and inherits the ingest half's release gate
for a surface that does not need it. A bidirectional runtime unit is close to the dynamic
adapter shape ADR-0013 refused.

### Option D: Do nothing — no record, treat ADR-0013 as governing

**Pros:** no governance cost; a plugin could still be written.

**Cons:** the ambiguity is the risk being managed, and it has already misdirected
substantial work. It also leaves the live-catalog-read evasion described in Context
available to anyone who reads ADR-0013 as silent about this direction.

### Option E: Adopt `@backstage-community/plugin-adr` alone and build nothing

**Pros:** zero engineering. For teams who want "show me the ADR markdown for this
component," it is sufficient today and adrkit adds nothing.

**Cons:** it models ADRs as documents belonging to an entity, and cannot answer which
decision governs a path, what is in the ARB queue, or what superseded what — the half that
differentiates the tool.

**Partially chosen.** Clause 9 adopts it for the document layer; listing it as rejected
would misrepresent the decision.

## Trade-offs

- **Contract drift is unpoliced.** A separate repository — if clause 5 resolves that way —
  means no single CI run proves producer and consumer still agree. The mitigation is
  versioning discipline and additive-only change to consumed shapes, not a green check here.
  This is the genuine advantage Option B holds and Option A forgoes.
- **Nothing is enforced today.** See *Enforcement posture*. A contributor can breach clauses
  4, 6, and 8 with a green CI run; only maintainer review catches it.
- **The headline feature waits.** Clause 2 puts "which decisions govern this component" —
  the capability most people mean by this integration — behind feature 010's envelope. That
  is a real cost of doing this honestly rather than a technicality, and it should be weighed
  when ratifying.
- **A third party's extension points become load-bearing.** Clause 9 makes
  `filePathFilterFn`, `contentDecorators`, and `statusComponent` matter to us. If upstream
  reshapes them the document layer degrades and it is not ours to fix. Bounded by the
  clause-9 pin; degradation is confined to the document layer while the governance layer
  keeps working.
- **Two tiers are more structure than one.** The split has to be re-explained every time
  someone asks why the obvious feature is not in Tier 1.

## Consequences

- **Easier:** Tier 1 can be built against contracts that ship today with no dependence on
  release-gated packages; ADR-0013's invariant is preserved rather than excepted; the
  live-catalog-read evasion is closed by name; the document layer is inherited rather than
  built.
- **Harder:** cross-repository contract drift; no compile-time edge between producer and
  consumer; Tier 2 blocked on work whose release is not yet authorized.
- **How we would know this was wrong:** if Tier 1 needs anything from adrkit that is not
  expressible as an additive change to an already-published output — a new core API, or a
  CLI subcommand whose only consumer is this plugin — then "downstream consumer" is the
  wrong shape and this record should be revisited rather than worked around. Two concrete
  triggers: more than one breaking change to a consumed JSON shape within two minor
  releases, or the first request for a plugin-only CLI surface. A third, specific to the
  split: if Tier 1 turns out to be unusable without entity scoping, the tiering is wrong and
  the honest response is to say so, not to quietly widen Tier 1.
- **Revisit if:** ADR-0012 gates 3 and 4 clear and `@adrkit/catalog-envelope` is published,
  which is what unblocks Tier 2 and is the moment clause 6's prohibition is reconsidered.

## Action items

1. [ ] **Ratify or reject this record.** It is `proposed` and agent-drafted with no
   `ratifiedBy`; per ADR-0013's precedent against fabricating an acceptance that never
   happened, it does not govern until `@mbeacom` accepts it.
2. [ ] Decide the repository home in a follow-up record against clause 5's named criteria —
   Principle III's run-time clause, and ADR-0007 Option C's revisit condition — and record
   the outcome as a new ADR, not as an edit to this one.
3. [ ] Inventory precisely what Tier 1 needs from adrkit and confirm each item is published
   at `0.7.0`. Anything not on that list is the "how we would know this was wrong" signal
   firing before a line is written.
4. [ ] When clause 5 resolves, give this record an assertion id and wire an identically
   named check, observed failing first per
   [ADR-0016](0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md).
   Until then, the Enforcement posture section is the honest statement of its absence.
5. [ ] **Run the document-layer spike before building anything.** Point
   `@backstage-community/plugin-adr` at an adrkit corpus with
   `backstage.io/adr-location: docs/adr` and record what its MADR-oriented parser does with
   adrkit frontmatter — title, status, and date in particular. Cheap, and it decides how much
   of clause 9 is configuration versus code. Record the observed outcome as a completed
   action item on this record, including if it fails, and fix clause 9's first verified
   version edge from what it finds.
6. [ ] Correct `packages/adapters/catalog-backstage/README.md` on `main`. It states that the
   manifest reader, admissibility, canonical identity, glob dialect, fail-closed pipeline,
   and snapshot envelope are "not implemented here" and that "no generator has run" — all
   six modules exist. Unrelated to this decision, but it actively misleads anyone
   approaching the Backstage surface, which is part of how this ambiguity persisted.
