---
schemaVersion: 0.1.0
id: "0029"
title: Site the Backstage publication plugin in this repository as a confined surface
status: proposed
date: 2026-08-15
deciders: ["@mbeacom"]
tags: [architecture, packaging, governance, distribution]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0013", "0016", "0019", "0025", "0028"]
affects:
  - type: path
    pattern: "packages/backstage-plugin/**"
  - type: path
    pattern: "scripts/check-deps.ts"
  - type: path
    pattern: "packages/ci/**"
assertions:
  - id: backstage-deps-confined-to-the-backstage-surface
    description: >-
      No workspace package other than @adrkit/backstage-plugin declares a dependency
      whose name begins with @backstage/. Enforced by the @backstage/ prefix rule in
      scripts/check-deps.ts, which fires across every package rather than relying on
      the per-package allowlist, because that allowlist leaves an unrecognized package
      silently unconstrained.
    engine: custom
    expression: backstage-deps-confined-to-the-backstage-surface
    input: source
    severity: error
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Resolves ADR-0028 action item 2, amends an accepted org-scope record by reference,
    and withdraws a narrowing of ADR-0007 that ADR-0028 asserted was necessary. Each of
    those is a statement other records will rely on.
reviewBy: 2027-02-15
---

# ADR-0029: Site the Backstage publication plugin in this repository as a confined surface

> **Status: proposed, agent-drafted, unratified.** Resolves
> [ADR-0028](0028-scope-backstage-publication-as-a-downstream-consumer-tiered-on-the-entity-owners.md)
> action item 2. It decides **where** the plugin lives; it does not authorize a release, and
> it does not touch ADR-0028's Tier 1 / Tier 2 split. It also **withdraws** ADR-0028's
> proposed narrowing of ADR-0007, which the evidence below shows was unnecessary.

## Context

ADR-0028 clause 5 deferred the repository home and named two criteria. Checked against the
tree, the first does not hold and the second argues against separation.

### Criterion 1 — Principle III's run-time clause does not reach this plugin

ADR-0028 asserted that Constitution Principle III, which forbids a package depending on
"external services at build, test, or run time," "plausibly reaches a plugin that requires a
running Backstage instance." The corpus had already answered that, and the answer is no.

`@adrkit/ci` lives at `packages/ci/`, ships at `0.1.0`, declares `@actions/core` and
`@actions/github`, and at run time calls `getOctokit(token)` against the **authenticated**
GitHub REST API (`packages/ci/src/github.ts`). If Principle III's run-time clause reached
what a package talks to when a user runs it, `@adrkit/ci` would violate it outright.

It does not, because that clause is read — and enforced — as **build and test hermeticity
plus dependency confinement**, not as a restriction on a shipped surface's runtime peers.
`scripts/check-deps.ts` implements exactly that reading: `CI_SURFACE_PACKAGE` grants
`@adrkit/ci` a named allowlist for the toolkit, and `TOOLKIT_DEPENDENCY` forbids that same
toolkit everywhere else. A Backstage plugin talking to a Backstage backend is the same shape
as an Action talking to GitHub.

### Criterion 2 — ADR-0007's own revisit condition is not met

[ADR-0007](0007-adapter-isolation-and-public-surface-build.md) considered separate
repositories as Option C and rejected it because "at this stage it fragments a project with
one maintainer and no users," setting the revisit condition: "an adapter acquires independent
contributors and its own release needs." That condition is not met. Separating now is
premature **by ADR-0007's own terms**, which ADR-0028 did not weigh.

### The costs ADR-0028 attributed to staying in-repo are already solved

- **Classifying a non-adapter that lives here.** `isAdapterPackage()` is purely
  location-based — `packages/adapters/`. Six packages already sit outside it, and
  `packages/catalog-envelope/` was deliberately placed there so it classifies as a
  non-adapter "as a matter of its location, not as a matter of an allowlisted exception."
- **Independent release cadence.** `ReleaseVersioning` in `scripts/release-pack.ts` already
  supports `versioning: 'independent'`, which `@adrkit/spec-kit` uses with its own tag.
- **Dependency admission.** `check-deps.ts` is a per-package allowlist. Admitting a package
  constrains one that was otherwise *silently unconstrained*; it weakens nothing elsewhere.

### And separation would have made ADR-0028 permanently unenforceable

Every operator concern raised against ADR-0028 reduces to the same thing: a record whose
subject lives in another repository cannot be checked from this one. Siting the plugin here
converts ADR-0028's clause 4 and this record's clause 2 from prose into a CI check.

## Decision

**The Backstage publication plugin lives in this repository at
`packages/backstage-plugin/`, as a confined surface on the `@adrkit/ci` pattern.**

1. **Home.** `packages/backstage-plugin/`, publishing as `@adrkit/backstage-plugin`. Being
   outside `packages/adapters/`, it classifies as a non-adapter by location — the
   `packages/catalog-envelope/` mechanism — so ADR-0028 clause 4's exclusion from
   `packages/adapters/catalog-*/**` holds trivially and permanently.

2. **Confinement.** `@backstage/*` is admitted to that package and **forbidden in every other
   workspace package**, enforced by a named allowlist in `scripts/check-deps.ts` mirroring
   `CI_SURFACE_PACKAGE`. The package may depend on `@adrkit/core` and `@backstage/*`, and
   must not depend on the schema, the CLI, the evaluator, the MCP server, or any adapter.

3. **Versioning.** Independent (`versioning: 'independent'`), like `@adrkit/spec-kit`, when
   and if a release is authorized. This record authorizes no release; ADR-0028 clause 10
   continues to govern.

4. **Enforcement is wired now, not deferred.** The assertion
   `backstage-deps-confined-to-the-backstage-surface` is paired with a check in
   `scripts/check-deps.ts`, observed failing before being counted as coverage per
   [ADR-0016](0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md).
   This discharges ADR-0028 action item 4 for the placement clauses.

5. **ADR-0028's proposed narrowing of ADR-0007 is withdrawn.** ADR-0028's Decision stated
   that ADR-0007's `packages/adapters/*` placement clause had to be narrowed for downstream
   consumers, and opened action item 7 to land an amendment note. That is unnecessary:
   `@adrkit/ci` already establishes that a first-party integration surface may live outside
   `packages/adapters/` under confinement, so no clause of ADR-0007 is narrowed by siting
   this plugin at `packages/backstage-plugin/`. **This record amends ADR-0028 by reference**
   — clause 5's deferral is resolved, and its action items 2 and 7 are closed, 7 as not
   required. ADR-0007 is untouched.

## Options considered

### Option A: In this repository at `packages/backstage-plugin/`, confined (chosen)

| Dimension | Assessment |
|---|---|
| Principle III | Satisfied — same shape as `@adrkit/ci`, which is shipped |
| ADR-0007 Option C | Revisit condition not met, so no separation |
| ADR-0028 clause 4 | Holds by location, permanently |
| Enforceable | **Yes — a check, today** |
| Contract drift | **Eliminated** — producer and consumer in one CI run |
| Cost | `@backstage/*` enters the graph; a large dependency tree to keep confined |

### Option B: A separate repository

**Pros:** strongest isolation; the plugin's fast-moving upstream cannot affect this
repository's install or CI time; independent governance.

**Cons:** ADR-0007's revisit condition for exactly this is unmet; it makes ADR-0028
unenforceable from here; and it reintroduces cross-repository contract drift as a permanent
accepted cost when Option A removes it. It also fragments a one-maintainer project, which is
the reason ADR-0007 rejected it in the first place.

### Option C: In this repository under `packages/adapters/backstage-plugin/`

**Pros:** matches ADR-0007's literal placement rule with no interpretation.

**Cons:** `isAdapterPackage()` would classify it an adapter, which it is not — adrkit never
composes it. It would also sit one glob away from ADR-0028 clause 4's exclusion zone, making
a mechanical rule depend on a naming accident.

### Option D: Defer, as ADR-0028 clause 5 does

**Pros:** no decision risk.

**Cons:** clause 1 of ADR-0028 authorizes Tier 1 with nowhere to build it, and the deferral
has no natural end. Deferral was reasonable when the Principle III question was open; the
`@adrkit/ci` precedent closes it.

## Trade-offs

- **`@backstage/*` enters this repository's dependency graph.** It is a large tree, and
  `bun install` and CI times will rise. Confinement bounds the blast radius but not the
  install cost. This is the real price of Option A and it is paid by every contributor.
- **Upstream churn now lands here.** A pre-1.0 Backstage minor can break this repository's
  install or typecheck. ADR-0007 accepted this for adapters ("permitted to break on upstream
  churn"); it is newly true for a non-adapter surface.
- **`clean-clone-builds` gets slower and more fragile**, because it installs that tree from
  public npm on every run.
- **Confinement is only as good as the allowlist.** `allowedDependenciesFor` returns
  `undefined` for unknown packages, which the file itself documents as "silently
  unconstrained." Clause 2's check must therefore key on the `@backstage/` prefix across all
  packages, not merely on the new package's allowlist entry.

## Consequences

- **Easier:** ADR-0028 becomes enforceable; producer and consumer share one CI run, removing
  the drift ADR-0028 named as its main accepted cost; Tier 1 has a place to be built today.
- **Harder:** install and CI cost; upstream churn reaches this repository; one more surface
  to keep confined.
- **How we would know this was wrong:** if confining `@backstage/*` proves impossible without
  weakening the allowlist for other packages, or if upstream churn breaks `main` more than
  twice in two minor lines, then Option B was right and this should be superseded rather than
  patched.
- **Revisit if:** the plugin acquires independent contributors and its own release needs —
  ADR-0007 Option C's stated condition, which would then finally be met.

## Action items

1. [ ] Ratify or reject this record. It is `proposed` and agent-drafted with no `ratifiedBy`.
2. [ ] Land the `@backstage/` confinement rule in `scripts/check-deps.ts` with its test,
   observed failing first per ADR-0016.
3. [ ] Record on ADR-0028 that action item 2 is resolved by this record and action item 7 is
   closed as not required.
4. [ ] When `packages/backstage-plugin/` is created, add its allowlist entry and its
   `"//placement"` note, following `packages/catalog-envelope/package.json`.
