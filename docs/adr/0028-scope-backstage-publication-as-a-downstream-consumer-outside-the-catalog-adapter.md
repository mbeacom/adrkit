---
schemaVersion: 0.1.0
id: "0028"
title: Scope Backstage publication as a downstream consumer outside the catalog adapter boundary
status: proposed
date: 2026-08-15
deciders: ["@mbeacom"]
tags: [architecture, packaging, catalog, distribution, governance]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0007", "0009", "0012", "0013", "0014", "0020"]
affects:
  - type: path
    pattern: "packages/adapters/catalog-*/**"
  - type: path
    pattern: "schema/adr.schema.json"
  - type: path
    pattern: "packages/core/src/queue/types.ts"
  - type: path
    pattern: "packages/cli/src/queue.ts"
provenance:
  authoredBy: agent-drafted
externalRefs:
  - type: doc
    url: "https://github.com/backstage/community-plugins/tree/main/workspaces/adr/plugins/adr"
    label: "@backstage-community/plugin-adr — prior art for the document layer (clause 5)"
  - type: pr
    id: "98"
    url: "https://github.com/mbeacom/adrkit/pull/98"
    label: "Feature 010 Phase G — the ingest-direction work that surfaced this gap"
review:
  tier: arb
  tierReason: >-
    Creates a public consumer surface for adrkit's published output and fixes the
    boundary every future publication-direction integration builds against. It also
    states, for the first time, that ADR-0013's catalog clause governs one direction
    only — a reading others will rely on. Neither the surface nor the reading should
    be settled asynchronously.
reviewBy: 2027-02-15
---

# ADR-0028: Scope Backstage publication as a downstream consumer outside the catalog adapter boundary

## Context

[ADR-0013](0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
settled how catalog composition works, and it settled it for exactly one direction of
data flow: **Backstage → adrkit**. A catalog adapter is "a standalone offline snapshot
generator that emits a validated interchange file which the core consumes," and the
binding invariant is that "the core still never learns an adapter exists." Feature 010
implements that direction — `@adrkit/catalog-backstage` reads the
`adrkit.io/owned-paths` annotation off catalog descriptors so `affects:` patterns can
resolve to owners.

The demand now on the table runs the other way: engineers want adrkit-originated ADRs
**visible inside Backstage**, where they already work. That is **adrkit → Backstage**,
and no record in this corpus addresses it. ADR-0013 does not, ADR-0020 does not, and
feature 010 is not a partial build of it.

Why this needs a record rather than a preference: in the absence of one, the default
reading is that ADR-0013 already covers anything with "Backstage" in the name. That is a
category error. ADR-0013 constrains **what adrkit may load**; it says nothing about what
a downstream consumer may do with adrkit's published output. Two concrete failure modes
follow directly from the misreading:

1. **The path glob attaches.** ADR-0013's `affects` pattern is
   `packages/adapters/catalog-*/**`. A Backstage plugin landed there inherits "must be a
   standalone offline snapshot generator" — a constraint it cannot satisfy and was never
   meant to, being neither standalone, nor offline, nor a generator.
2. **`@backstage/*` enters this repository's dependency graph.** ADR-0007's
   `core-has-no-adapter-deps` and `clean-clone-builds` assertions exist precisely to
   prevent that, and they are currently green.

A third force is worth stating plainly, because it changes which contract the plugin
should bind to. The ingest half is **not published**: `@adrkit/catalog-backstage` and
`@adrkit/catalog-envelope` are both at `0.0.0` and absent from `RELEASE_PACKAGES`, and
[ADR-0020](0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
clause 9 defers the release decision to a later record once
[ADR-0012](0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
gates 3 and 4 are met. Gate 3 is recorded `Unmet`. A publication surface that bound
itself to those packages would inherit a release gate it has no need of, while adrkit's
`0.7.0` contracts — the ADR schema, `@adrkit/core` types, and the CLI's machine-readable
outputs — are published and usable today.

Finally, the cost of leaving this ambiguous is not hypothetical. It has already produced
a 97-file, 8,554-line pull request advancing the ingest direction under the shared belief
that "Backstage support" was being built. The packages that work produced are not what
this direction needs — but one artifact of it is. **ADR-0012's `adrkit.io/owned-paths`
annotation is shared by both directions.** Ingest consumes it to resolve `affects:` to
owners; publication needs the same mapping in reverse, to answer "which decisions govern
this component" for an entity whose owned paths it must first know. The contract is
common ground even though the packages are not.

### Prior art: this is not a greenfield surface

`@backstage-community/plugin-adr` already exists and already solves the **document** half.
It contributes an entity ADR tab, a backend that fetches markdown through Backstage's URL
readers (so host integrations and auth are handled), search indexing via
`search-backend-module-adr`, and New Frontend System support. It exposes real extension
points — `filePathFilterFn`, `contentDecorators`, and a replaceable `statusComponent`.

Two details make it unusually close to adrkit already: adrkit's `NNNN-title-with-dashes.md`
filenames match the plugin's own documented custom-filter example, and its sample status
component switches on `draft`, `proposed`, `accepted`, `rejected`, `deprecated`, and
`superseded` — every status in `schema/adr.schema.json`.

What it does **not** model is the machine-readable layer that is adrkit's actual
contribution: path-to-decision governance via `affects:`, the ARB queue and its SLA state,
assertion enforcement status, the supersession graph, and inbound `@adr` markers. It reads
ADRs as documents belonging to an entity; it has no concept of a decision governing a path
across entities.

Any record scoping this surface has to say which of those halves it is building, or it
invites rebuilding work that already exists.

## Decision

**We will scope adrkit → Backstage publication as a downstream consumer of adrkit's
published output, outside the catalog adapter boundary.** Four clauses, all binding:

1. **The dependency edge is one-way: plugin → adrkit.** The plugin depends on adrkit's
   published artifacts. adrkit does not discover, resolve, import, load, or depend on the
   plugin, and gains no knowledge that it exists. This *preserves* ADR-0013's invariant
   rather than carving an exception out of it.

2. **It lives outside `packages/adapters/catalog-*/**`, and a separate repository is
   preferred.** Two reasons; the second is the load-bearing one. ADR-0013's constraint
   attaches by path, so placement alone would impose the wrong contract. And
   `@backstage/*` must not enter this repository's dependency graph while
   `core-has-no-adapter-deps` and `clean-clone-builds` are in force.

3. **It binds only to already-published contracts.** Specifically `schema/adr.schema.json`,
   `@adrkit/core` types, and the CLI's machine-readable outputs — `adr queue --format json`
   (QueueReport v1), `adr check --json`, `adr explain`, `adr graph` — at `0.7.0`. It **MUST
   NOT** depend on `@adrkit/catalog-envelope` or `@adrkit/catalog-backstage` while either
   is `0.0.0` and absent from `RELEASE_PACKAGES`.

4. **This record authorizes scoping and work. It does not authorize a release.** Following
   ADR-0020's pattern. Nothing scoped here is
   [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
   rung 2 or rung 3, and no publish target, tag, channel, or date is authorized or implied.

5. **The scope is the governance layer, not ADR document rendering.** Where
   `@backstage-community/plugin-adr` already serves — browsing, rendering, and searching
   ADR markdown on an entity page — we configure and extend it rather than compete with
   it. What we build is what it does not model: path-to-decision governance from
   `affects:`, the ARB queue, assertion enforcement status, the supersession graph, and
   inbound `@adr` markers. Any proposal to reimplement ADR rendering must first record why
   the existing plugin's `filePathFilterFn`, `contentDecorators`, and `statusComponent`
   extension points were insufficient.

6. **Resolution runs through `@adrkit/core`, never a reimplementation.** The consumer reads
   the corpus and calls the published resolvers. Re-deriving `affects:` matching, status
   bucketing, or queue construction downstream would create exactly the drift this record's
   trade-offs section identifies as its main cost, and would do so in the one place where
   it is avoidable.

**Entity-to-path mapping reuses ADR-0012's `adrkit.io/owned-paths` annotation** rather than
inventing a second ownership contract. This is the one place the two directions genuinely
share ground, and duplicating it would be the worst of both.

**This record does not amend or supersede ADR-0013.** ADR-0013's catalog clause remains
authoritative and unchanged for the ingest direction. This record states what that clause
was always silent about — the publication direction — and does not narrow it.

## Options considered

### Option A: A downstream consumer outside the catalog adapter boundary (chosen)

| Dimension | Assessment |
|---|---|
| ADR-0013 invariant | Preserved — core never learns the plugin exists |
| ADR-0007 assertions | Untouched; no `@backstage/*` in this graph |
| Contract available today | Yes — `0.7.0`, published |
| Release coupling | None; independent of ADR-0012 gates 3–4 |
| Contract drift | **Unpoliced across the boundary — the real cost** |

### Option B: Build it in-repo as another `packages/adapters/catalog-*` package

**Pros:** one repository and one toolchain; producer and consumer of the JSON contracts
sit in a single CI run, so drift is caught at compile time rather than by a downstream bug
report; dogfooding is trivial.

**Cons:** inherits ADR-0013's offline-generator constraint by path; forces `@backstage/*`
into this repository's dependency graph, against two currently-green ADR-0007 assertions,
or else demands an exemption mechanism that would weaken them for everything else; couples
a UI plugin's release cadence to the lockstep semver surface.

### Option C: Extend `@adrkit/catalog-backstage` to be bidirectional

**Pros:** one package named for the system it integrates with; one place to look.

**Cons:** conflates two opposite data directions in a single unit, which is the confusion
this record exists to end. It also inherits the ingest half's release gate — ADR-0020
clause 9 and ADR-0012 gates 3–4 — for a surface that has no need of it. A bidirectional
runtime unit is close to the "dynamic adapter" shape ADR-0013 refused.

### Option D: Do nothing — no record, treat ADR-0013 as governing

**Pros:** no governance cost; a plugin could still be written.

**Cons:** the ambiguity *is* the risk being managed, and it has already misdirected
substantial work. Without a record, the next contributor re-derives the direction
distinction by reading feature 010's evidence tree, or does not derive it at all and lands
the plugin inside the glob.

### Option E: Adopt `@backstage-community/plugin-adr` alone and build nothing

**Pros:** zero engineering. It already renders ADRs on entity pages, indexes them for
search, and handles host integrations and auth. For teams who want *"show me the ADR
markdown for this component,"* it is sufficient today and adrkit adds nothing.

**Cons:** it models ADRs as documents belonging to an entity. It cannot answer the
questions adrkit exists to answer — which decision governs this path, what is in the ARB
queue and how close to SLA, whether an assertion is enforced or inert, what superseded
what. Adopting it alone would mean shipping adrkit's decision *records* to Backstage while
leaving its decision *enforcement* behind, which is the half that differentiates the tool.

**This option is partially chosen.** Clause 5 adopts it for the document layer and builds
only the governance layer on top. Listing it as rejected outright would misrepresent the
decision.

## Trade-offs

What the chosen option costs, stated as plainly as what it buys:

- **Contract drift is unpoliced.** A separate repository means no single CI run proves the
  producer and the consumer still agree. adrkit can change `adr queue --format json` and
  find out from a downstream bug report. The mitigation is versioning discipline and
  additive-only change to consumed shapes — not a green check in this repository. This is
  the genuine advantage Option B had, and choosing A forgoes it.
- **Dogfooding gets harder.** The plugin cannot be exercised by this repository's suite,
  so adrkit loses the fastest signal that its own JSON outputs are usable in practice.
- **Two repositories, two cadences.** Real ongoing overhead, and a real chance the plugin
  lags the ADR schema after a `schemaVersion` bump.
- **Some duplication is accepted.** Types consumed from published packages may be
  re-declared downstream rather than shared through an internal package.
- **A dependency on a third-party plugin's extension points.** Clause 5 reuses
  `@backstage-community/plugin-adr` for the document layer, which means its
  `filePathFilterFn`, `contentDecorators`, and `statusComponent` contracts become load-
  bearing for us. If it drops or reshapes them, or its MADR-oriented parser diverges from
  adrkit's frontmatter, the document layer degrades and is not ours to fix. Accepted
  because the alternative — reimplementing ADR rendering, search indexing, and URL-reader
  integration — is strictly more work for strictly less function, and because degradation
  is confined to the document layer while the governance layer keeps working.

## Consequences

- **Easier:** the plugin can be built against contracts that ship today, with no
  dependence on the release-gated feature-010 packages; `core-has-no-adapter-deps` and
  `clean-clone-builds` stay green with no exemption; ADR-0013's invariant is preserved
  rather than excepted; the two Backstage directions stop being mistaken for one another;
  and the document layer is largely inherited rather than built, so the work is scoped to
  what only adrkit can supply.
- **Harder:** cross-repository contract drift, as above; no compile-time edge between
  producer and consumer.
- **How we would know this was wrong:** if the plugin needs anything from adrkit that is
  **not** expressible as an additive change to an already-published JSON output — a new
  core API, a new CLI subcommand existing only for the plugin, or the catalog envelope —
  then "downstream consumer" is the wrong shape, and this record should be revisited
  rather than worked around. Two concrete triggers: more than one breaking change to a
  consumed JSON shape within two minor releases, or the first request for a CLI surface
  whose only consumer is this plugin.
- **Revisit if:** ADR-0012 gates 3 and 4 clear and `@adrkit/catalog-envelope` is published.
  That would make binding to the envelope viable and could justify reconsidering the
  separation — though not, on its own, merging the two directions.

## Action items

1. [ ] **Ratify or reject this record.** It is `proposed` and agent-drafted, with no
   `ratifiedBy`. Per ADR-0013's precedent on fabricated acceptance, it does not govern
   until `@mbeacom` explicitly accepts it.
2. [ ] Decide the repository home — separate repository, or this repository outside
   `packages/adapters/catalog-*/**` — and record the outcome here.
3. [ ] Inventory precisely what the plugin needs from adrkit and confirm each item is
   already published at `0.7.0`. Anything that is not on that list is the
   "how we would know this was wrong" signal firing before a line is written.
4. [ ] **Run the document-layer spike before building anything.** Point
   `@backstage-community/plugin-adr` at an adrkit corpus with
   `backstage.io/adr-location: docs/adr` and record what its MADR-oriented parser does with
   adrkit frontmatter — title, status, and date in particular. This is cheap and it decides
   how much of clause 5 is configuration versus code. Record the observed outcome here,
   including if it fails.
5. [ ] Correct `packages/adapters/catalog-backstage/README.md` on `main`. It states that
   the manifest reader, admissibility, canonical identity, glob dialect, fail-closed
   pipeline, and snapshot envelope are "not implemented here" and that "no generator has
   run" — all six modules exist. Unrelated to this decision, but it actively misleads
   anyone approaching the Backstage surface, which is how this ambiguity persisted.
