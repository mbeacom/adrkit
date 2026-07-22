# Contract: Standalone Offline Generator, No Dynamic Loader, No Shipping Artifact / Release Vehicle Decision

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-019, FR-020,
FR-021, FR-026, Out of Scope section, Output Recommendation section.
Companion to `data-model.md` §9 (`SnapshotEnvelope`), §24
(`NonBindingRecommendation`). Normative source: ADR-0013 (`status: accepted`,
PR #27); ADR-0007's amendment blockquote; ADR-0012's "Composition, envelope,
and persistence" section.

## 1. Composition Model — Standalone Offline Generator (FR-021)

Per ADR-0013, which narrows ADR-0007's general "discovery is by
configuration, resolved at runtime" language **specifically for the catalog
surface**: **no dynamic runtime adapter/plugin loader of any kind.** There is
no separate composition host that discovers, resolves, or dynamically
imports a catalog adapter at runtime — not even one restricted to a single
statically-known package name.

Any later composition path this spike's evidence recommends MUST instead be
a **standalone offline snapshot generator**: an executable that a human or
CI **directly invokes by name** (e.g. running its own CLI entry point),
reads only its explicit local input manifest
(`contracts/input-manifest.md`), and emits the versioned envelope
(`contracts/snapshot-envelope.md`) — never something a separate host process
discovers or imports on the caller's behalf.

## 2. Core/CLI Isolation Is Unaffected (FR-021, FR-020)

`@adrkit/core` and `@adrkit/cli` never import or otherwise learn that
`packages/adapters/catalog-backstage` (or any adapter) exists — ADR-0007's
core dependency-isolation rule is unchanged. They receive only an
already-validated `CatalogSnapshot`-shaped artifact, which — per ADR-0012's
requirement that any persisted `CatalogSnapshot` require a validated
interchange file first — is derived from the `SnapshotEnvelope` **only
after** that envelope independently passes every
`contracts/snapshot-envelope.md` §2 (validation) and §3 (digest) check. An
adapter's raw output MUST NOT be handed to core directly and unvalidated,
under any composition arrangement.

This spike itself changes **nothing** in `packages/core/src/affects/**`'s
existing matcher semantics, and does not change the
`CatalogPort`/`CatalogSnapshot` type shapes in
`packages/core/src/affects/catalog.ts` (FR-020). The
`SnapshotEnvelope` this spike's design produces is a **new, separate
artifact** — it is never added as a field on the existing
`CatalogSnapshot`/`CatalogSnapshotEntity` types.

## 3. ADR-0007/ADR-0009 Status Is Unaffected by This Spike (Governance Framing)

ADR-0013 amended ADR-0007's and ADR-0009's own clauses, and each of ADR-0007
and ADR-0009 now carries this amendment directly in its own body (a short
blockquote added by the same PR — see `spec.md`'s Normative Sources section
for the exact quoted text) — while both records remain `status: proposed`
pending their own separate future acceptance decision. **This plan is not
read as asserting that ADR-0007/ADR-0009 have themselves reached
`accepted`** — both ADR-0013 and ADR-0007/ADR-0009's own frontmatter
explicitly say they have not. This spike's design does not perform, and does
not gate its own scoping activity on, that future acceptance decision.

## 4. No Shipping Artifact — Absolute Scope Boundary (Out of Scope Section)

This planning session, and any future gate-cleared execution session
following it, produces **none** of the following:

- A production `packages/adapters/catalog-backstage` package of any kind.
- Any call to a live Backstage API, catalog backend, or discovery/ingestion
  processor.
- Any bearer token, API key, or other credential of any kind.
- Any catalog mutation, catalog/adrkit synchronization, or write-back of any
  kind.
- Any change to `packages/core/src/affects/**`'s existing matcher semantics
  or to the `CatalogPort`/`CatalogSnapshot` type shapes.
- Any change to the ADR schema (`packages/core/src/schema/adr.schema.ts` or
  the published `schema/adr.schema.json`).
- A general runtime plugin loader of any kind.
- Any npm publication, package version bump, or git release tag change for
  any `@adrkit/*` package, and any change to `.github/workflows/**`.
- Multi-repository or federated snapshots of any kind.

## 5. Release Vehicle Is Explicitly, Permanently Undecided (FR-026; Output Recommendation Section)

Any "smallest later production slice" recommendation this spike's eventual
output records (`contracts/evidence-bundle-and-verdict.md` §4) MUST
explicitly leave the eventual production package's **publish/release
vehicle** — npm package name, publish trigger, which existing `@adrkit/*`
release process (if any) it would join — **undecided**.
`NonBindingRecommendation.releaseVehicleDecision` (`data-model.md` §24) is a
fixed literal `null`, present in the schema specifically so this field's
permanently-null type makes this explicit by construction, not merely by
discipline: any future code or document that would populate this field with
a non-null value has exceeded this spike's authorized scope and must stop
and re-scope rather than proceed. This mirrors
`specs/008-spec-kit-hook-viability/data-model.md` §8's identical
`releaseVehicleDecision: null` field for this project's sibling spike.

## 6. What This Plan Itself Adds to the Repository (None)

This planning session adds **zero** files under `packages/`, **zero**
changes to root `package.json` `workspaces`, and **zero** CI workflow
changes. Every artifact this planning session produces
(`plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and every
`contracts/*.md` file) lives entirely under
`specs/009-catalog-binding-viability/` and describes a **future**,
gate-cleared execution session's design — it does not itself execute
anything, commit any fixture, or open any implementation branch.
