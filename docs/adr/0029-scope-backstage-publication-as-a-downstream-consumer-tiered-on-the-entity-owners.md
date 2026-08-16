---
schemaVersion: 0.1.0
id: "0029"
title: Scope Backstage publication as a downstream consumer, tiered on the entity-ownership mapping
status: accepted
date: 2026-08-15
deciders: ["@mbeacom"]
tags: [architecture, packaging, catalog, distribution, governance]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0012", "0013", "0014", "0016", "0019", "0020", "0025"]
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
  ratifiedBy: "@mbeacom"
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

# ADR-0029: Scope Backstage publication as a downstream consumer, tiered on the entity-ownership mapping

> **Status: accepted.** Agent-drafted, ratified by `@mbeacom` on 2026-08-15 after two
> independent four-lens reviews. This record scopes work toward
> [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
> **rung 1 only** (clause 10). It does not authorize a release, a publish target, a tag, a
> channel, or a date, and it does not itself authorize the entity-scoped tier it defines.
> **Two accepted costs.** *The headline feature waits* — "which decisions govern this
> component" is Tier 2, deferred behind feature 010's envelope. And, **if clause 5 resolves
> to a separate repository**, cross-repository contract drift unpoliced by any single CI run.
> **Nothing here is enforced by a check, and `affects:` detection is partial** — see
> *Enforcement posture*, which states exactly where it is silent.

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

The clauses below state the decision. No count is given, deliberately: an earlier draft
stated one its own enumeration contradicted. This record follows the corpus convention that
a record's decision text binds; it does **not** introduce a two-class rule dividing numbered
from unnumbered prose, which would be a corpus-wide convention needing its own record.

1. **Tier 1 — needs no ownership mapping; authorized by this record.** Browsing the corpus,
   the ARB queue and its SLA state, the supersession graph, record status, the document
   layer of clause 9, and path-governance for a path that is **explicitly supplied**. A path
   is explicitly supplied only when it originates outside the plugin — typed by a person, or
   set in configuration a person wrote. A path the plugin derives from any catalog entity
   field, `adrkit.io/owned-paths` or otherwise, is **not** explicitly supplied and is Tier 2.

2. **Tier 2 — requires the entity-to-path ownership mapping; NOT authorized by this
   record.** Any capability answering "which decisions govern this component," or otherwise
   needing to learn which paths an entity owns. The test is the ownership mapping, not
   whether a surface happens to render on an entity page. Scoped here so its constraints are
   known in advance; authorizing it is a later record's job. **Where clauses 1 and 2 both
   admit a capability, clause 2 governs.**

3. **The dependency edge is one-way: plugin → adrkit.** adrkit does not discover, resolve,
   import, load, or depend on the plugin, and gains no knowledge that it exists. This
   preserves ADR-0013's invariant rather than carving an exception from it.

4. **The plugin is not a catalog adapter, and does not live under
   `packages/adapters/catalog-*/**`.** It is not a standalone offline snapshot generator,
   so ADR-0013's catalog clause does not describe it, and placing it inside that glob would
   attach a contract it cannot satisfy.

5. **The repository home is deferred to a follow-up record, and until that record no plugin
   code lands in this repository.** Tier 1 work **may** begin outside this repository before
   that record lands; any such placement is provisional and relocation is an accepted
   possible outcome, so nothing may be published from it (clause 10). The criteria to decide
   it are named, not assumed: Constitution Principle III forbids any package depending on
   "external services at build, test, or run time," which plausibly reaches a plugin that
   requires a running Backstage instance; and
   [ADR-0007](0007-adapter-isolation-and-public-surface-build.md) considered separate
   repositories as its Option C, rejected it for "a project with one maintainer and no
   users," and set a revisit condition — "once an adapter has independent contributors" —
   that is not currently met.

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
   from a live catalog read. It consumes the envelope's **already-normalized entity-to-path
   output**; it therefore does not need the `adrkit.io/owned-paths` decode at all, and must
   not transcribe it. That decode is deliberately unreachable from outside this workspace —
   `@adrkit/catalog-backstage` exports only `PACKAGE_NAME` and declares no entry point — and
   it stays that way: the envelope is the interchange surface, not the decoder. Tier 2 is
   therefore blocked until that envelope is published, and this record does not shorten that
   path.

8. **Resolution runs through `@adrkit/core`'s published resolvers, never a
   reimplementation.** Re-deriving `affects:` matching, status bucketing, queue
   construction, or graph building downstream would create exactly the drift the trade-offs
   section names as this option's main cost, in the one place it is avoidable.

9. **The document layer is Tier 1, and extends `@backstage-community/plugin-adr` rather than
   competing with it**, under a bounded, verified version range whose upper edge is a
   verification boundary — the discipline
   [ADR-0019](0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md)
   clause 4 established for `speckit_version`, where widening is a re-verification rather
   than a version bump. **That range is empty until action item 5 fixes its first edge**, so
   no document-layer code may pin a version before then. Any proposal to reimplement ADR
   rendering must first record, **as an ADR in `docs/adr/` accepted by `@mbeacom`**, which
   extension point was tried and what was observed to fail.

10. **No release is authorized by this record** — no publish target, tag, channel, version,
    or date, for either tier and regardless of where clause 5 places the work. Work
    authorized here may accumulate ADR-0014 **rung-1 evidence only**, which that record
    defines as necessary and "never sufficient on its own to land a phase whose value is an
    operational surface." Releasing is a later record's act.

11. **adrkit's reciprocal obligation: the consumed shapes change additively.** The contracts
    clause 6 names — `schema/adr.schema.json`, `@adrkit/core`'s exported API and types, and
    the `queue`/`check`/`explain`/`graph` JSON outputs — may gain fields, but may not remove
    or repurpose them, except through a stated deprecation path in `docs/RELEASING.md`. Every
    other clause here constrains the consumer; without this one the record would create a
    cross-repository contract while leaving the producer free to break it, which is the drift
    the Trade-offs name as its main cost. This follows
    [ADR-0025](0025-ship-badges-as-recipes-over-existing-output.md), which recorded the same
    obligation for `QueueReport` v1 and landed the note at the field itself.

> **Amended by [ADR-0031](0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
> (2026-08-16).** Clauses 6 and 11 are narrowed: the contract a downstream surface binds to,
> and the surface adrkit's additive-only obligation attaches to, are `@adrkit/sdk` and the
> documented CLI JSON — **not** `@adrkit/core`'s exported API. As written above, clause 11
> promised stability across core's **173** exported symbols to protect a consumer surface of
> roughly **three** (`@adrkit/ci` imports that many), which is keepable only by freezing the
> engine or by breaking the promise silently. ADR-0031 amends these clauses by reference and
> does not supersede this record; every other clause here stands unchanged.

**This record does not amend or supersede ADR-0013.** Clause 7 routes the only part of this
surface that touches the ingest direction *through* ADR-0013's mechanism rather than around
it, so the catalog clause remains authoritative and unnarrowed. Clause 4 states where
ADR-0013's contract does not apply, which is a statement about this new surface, not a
change to that record.

**ADR-0007's adapter regime does not reach this surface, and that is a narrowing.** ADR-0007
defines an adapter by the same isolation property clause 3 states, and puts every integration
under `packages/adapters/*`. Read alone, it answers "in this repository, as an adapter" for
this plugin, which clause 5 contradicts. The distinction drawn here is that an adapter is a
thing *adrkit composes* — the core is configured to use it, even offline — whereas this
plugin is composed by **Backstage** and adrkit is merely its data source. That is a real
difference, but it is a narrowing of ADR-0007's placement clause for downstream consumers,
and calling it anything else would be the silent governance drift ADR-0013 exists to prevent.
Action item 7 lands the amendment note in ADR-0007, following the mechanism ADR-0013 used on
ADR-0007 and ADR-0014 used on ADR-0013. This would be the project's **third** distribution
surface after [ADR-0003](0003-ship-as-spec-kit-extension.md)'s CLI and Spec Kit extension.

## Enforcement posture

Stated plainly because silence here would be its own defect: **this record carries no
`assertions:` and nothing mechanically enforces any clause today.**

The corpus is weaker on assertion/check pairing than it first appears, and the accurate
picture matters because action item 4 is modelled on it. Of the three comparable assertion
ids: `clean-clone-builds` is the only one with an identically named CI job;
`core-has-no-adapter-deps` is enforced, but by a differently named step ("Verify dependency
boundaries") inside that job; and ADR-0020's
`catalog-adapter-accept-path-needs-annotated-real-corpus` pairs with nothing at all — that
record's own clause 8 states it is "**currently inert**", returns `status: 'inert'`, "never
fails", and "records the rule; it does not enforce it." So the pattern to follow is
"assertion plus a check that exists," and exactly one record demonstrates it.

This record cannot pair yet, because the surface it governs does not exist and clause 5
forbids in-repo code until placement is decided.

Two things follow, and both are real:

- What *is* detectable today is only that `affects:` surfaces this record on pull requests
  touching the paths it declares. **That coverage is partial, and the gap is on the bound
  contracts themselves:** clause 6 binds `@adrkit/core`'s whole published API, but
  `packages/core/src/status/bucket.ts`, `parse/frontmatter.ts`, `load/corpus.ts` and the
  other re-exports of `index.ts` match no pattern here, so a breaking change in those files
  surfaces nothing against this record. Declaring all of core was rejected as noise that
  would train readers to ignore the signal; the honest statement is that detection reaches
  the exclusion zone, the queue/check/graph/affects subtrees, the schema, and the release
  script, and not the rest. Even where it fires it is a reminder, not a gate: it appears
  identically on compliant and non-compliant changes, and `adr check` exits `0` either way.
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
- **Revisit if:** [ADR-0012](0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
  gates 3 and 4 clear — the maintainer-authored reference oracle over pinned public corpora,
  and the gate ADR-0020 records as unmet — and `@adrkit/catalog-envelope` is published. That
  is what unblocks Tier 2 and the moment clause 6's prohibition is reconsidered.

## Action items

1. [x] **Ratify or reject this record.** Ratified by `@mbeacom` on 2026-08-15, after two
   independent four-lens deep reviews (8 blocking findings across both rounds, all closed or
   explicitly accepted and recorded). Agent-drafted and maintainer-ratified, which
   ADR-0013's precedent requires be stated rather than blurred.
2. [x] Decide the repository home in a follow-up record against clause 5's named criteria —
   Principle III's run-time clause, and ADR-0007 Option C's revisit condition. **Resolved by
   [ADR-0030](0030-keep-extension-surfaces-that-carry-a-dependency-tree-outside-this-repository.md)**:
   **outside this repository**, on measured install cost (1,274 packages and 1.0 GB against
   this repository's 94 and 65 MB). Clause 5's deferral and its in-repo moratorium are
   discharged; the moratorium becomes permanent rather than provisional.
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
7. [ ] Land the amendment-by-reference note in
   [ADR-0007](0007-adapter-isolation-and-public-surface-build.md) recording that its Option C
   disposition on separate repositories is narrowed for an integration whose dependency tree
   would dominate this repository's install. **Carried by
   [ADR-0030](0030-keep-extension-surfaces-that-carry-a-dependency-tree-outside-this-repository.md)
   action item 4**, on that record's measured evidence rather than on the taxonomy argument
   the Decision's closing paragraph above makes — which ADR-0030 supersedes on this point.
8. [ ] Record clause 11's additive-only obligation where the shapes are defined —
   `packages/core/src/queue/types.ts`, `packages/core/src/check/index.ts`, and
   `docs/RELEASING.md` — so it is visible in the diff that would break it, following
   [ADR-0025](0025-ship-badges-as-recipes-over-existing-output.md)'s action item 5.
