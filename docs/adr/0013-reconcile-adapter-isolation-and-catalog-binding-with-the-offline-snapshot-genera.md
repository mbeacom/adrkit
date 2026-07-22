---
schemaVersion: 0.1.0
id: "0013"
title: Reconcile adapter isolation and catalog binding with the offline snapshot generator
status: accepted
date: 2026-07-21
deciders: ["@mbeacom"]
tags: [governance, architecture, packaging, catalog]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0007", "0009", "0012", "0014"]
affects:
  - type: path
    pattern: "packages/adapters/catalog-*/**"
  - type: path
    pattern: "packages/core/src/affects/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Narrows two org-scope, one-way-door clauses (ADR-0007's runtime adapter
    discovery and ADR-0009's freely-cacheable snapshot) and fixes the composition
    boundary every future catalog adapter builds against.
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/mbeacom/adrkit/issues/25"
    label: Decide catalog entity-to-path binding before feature 009
---

# ADR-0013: Reconcile adapter isolation and catalog binding with the offline snapshot generator

## Context

The 2026-07-21 catalog contract-hardening decision (issue #25, ratified by
`@mbeacom`) settled how catalog composition and persistence must work: "Catalog
composition is a standalone offline snapshot generator feeding a validated
interchange file; no dynamic runtime adapter/plugin loader is authorized," and
"any persisted `CatalogSnapshot` requires a versioned interchange contract before
production." ADR-0012 records the entity-to-path binding contract built on that
boundary.

Two earlier records now contain clauses that the hardening decision narrows:

- **ADR-0007** ("Isolate integrations as optional adapters") states, of adapter
  discovery generally: "Discovery is by configuration, **resolved at runtime**."
  The hardening decision forbids a dynamic runtime adapter/plugin loader for the
  catalog surface specifically.
- **ADR-0009** ("Pin affects resolution … and bind entity refs to pluggable
  catalogs") delegates the native-to-normalized entity mapping to each adapter
  and describes the snapshot as "**serializable so it can be committed or
  cached**," with adapters implementing a port that is implicitly resolved at
  run time. The hardening decision pins that mapping (ADR-0012), forbids a runtime
  loader, and gates any persisted snapshot behind a versioned interchange
  envelope.

Both ADR-0007 and ADR-0009 are still `status: proposed`. The hardening decision
also directed that "ADR-0007/0009 must be accepted/amended or explicitly blocked
before implementation." ADR-0012 took the explicitly-documented-blockers path and
deferred the reconciliation itself to "a separate, explicit … decision." This is
that decision. Left unreconciled, ADR-0007's "resolved at runtime" and ADR-0009's
"committed or cached" language stand as latent contradictions of ratified law —
exactly the silent-governance-drift failure this project exists to prevent.

## Decision

**Amend the two narrowed clauses; keep ADR-0007 and ADR-0009 `proposed` with an
explicit acceptance path. Do not fabricate an acceptance that never happened.**

### Clause amendments (by reference; body bytes of the amended records gain only
a reconciliation note)

- **ADR-0007 — runtime discovery.** For the **catalog** surface, adapter
  composition uses **no dynamic runtime adapter/plugin loader**. A catalog adapter
  is a **standalone offline snapshot generator** that emits a validated
  interchange file which the core consumes; the core still never learns an adapter
  exists. This narrows, and does not repeal, ADR-0007's general "discovery is by
  configuration" rule — configuration still selects composition, but for catalogs
  the composition is offline generation, not runtime loading.
- **ADR-0009 — mapping and snapshot.** The native-to-normalized entity mapping
  ADR-0009 delegated to adapters is now **pinned by ADR-0012** (the explicit
  `adrkit.io/owned-paths` contract). ADR-0009's "serializable so it can be
  committed or cached" is narrowed: the in-memory `CatalogSnapshot` shape is an
  internal type, **not** a wire format, and **any persisted snapshot requires a
  versioned interchange envelope before production**. The port ADR-0009 defines is
  realized by offline generation, not a dynamic runtime loader.

Resolution purity, per-ADR union matching, degradation-to-inert, and the
`resolution-is-pure` assertion from ADR-0009 are unchanged and remain in force.

### Status disposition — honest audit, no fabricated history

**ADR-0007 and ADR-0009 remain `proposed`.** This is the honest outcome:

- This corpus has **no accepted-status transition on record**. Every accepted
  record entered git already `accepted` — 0001, 0002, 0004, 0010, 0011, and the
  just-merged 0012 (and this record, 0013) — and no ADR has ever been ratified
  `proposed → accepted` via PR. Both 0007 and 0009 already
  carry `ratifiedBy: "@mbeacom"` and are enforced as de facto project law through
  the constitution and green CI assertions, but no explicit accepted-status
  transition was ever ratified for either. Flipping status now would fabricate
  that specific governance act.
- Their implementation-facing action items remain open and gated (below), so
  acceptance would also outrun the evidence.

This ADR **amends** specific clauses of ADR-0007 and ADR-0009; it does **not**
supersede them. Their core decisions — adapter isolation, the clean-clone build
constraint, pinned affects semantics — remain authoritative and unchanged.

### Acceptance path for ADR-0007 and ADR-0009

> **Amended by [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
> (2026-07-22).** Blocker 3 below ("an independent adopter validates real
> entity/path outcomes") is amended from a **hard gate** to an **optional later
> externally-validated maturity signal**; a maintainer-authored reference oracle per
> ADR-0014 satisfies the corresponding ladder requirement. Blocker 1 (Phase 6
> T048-R/T049) is satisfied: Phase 6 is landed / reference-verified. ADR-0014 amends
> these clauses by reference and does not supersede this record; the project
> constitution is unaffected.

Either record moves to `accepted` only in its own explicit, reviewed decision once
its blockers clear:

1. Phase 6 `specs/007-arb-queue/tasks.md` T048-R/T049 clear. **(Satisfied
   2026-07-22: Phase 6 is landed / reference-verified on rungs 1–2 of
   [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md);
   T048-R/T049 complete.)**
2. Non-shipping spike evidence from `specs/009-catalog-binding-viability/`,
   including a versioned interchange envelope and the security/scale measurements
   named in ADR-0012.
3. A **maintainer-authored reference oracle** (synthetic explicit annotations over
   pinned public corpora under independent adversarial review) validates real
   entity/path outcomes, per
   [ADR-0014](0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md).
   External/community adopter validation is an **optional later maturity signal**
   (ADR-0014 rung 3), not a hard gate.
4. Clean-clone / offline / adapter-boundary / release evidence passes (for
   ADR-0007, its `core-has-no-adapter-deps` and `clean-clone-builds` assertions
   stay green throughout).

## Options considered

### Option A: Amend the narrowed clauses; hold status `proposed` (chosen)

Reconciles the contradictions immediately, keeps the records honest, and defines a
concrete acceptance path. Costs a small edit to two records and a dedicated
governance record.

### Option B: Flip ADR-0007 and ADR-0009 to `accepted` now

**Pros:** removes the "proposed but binding" oddity in one step.
**Cons:** fabricates a ratification event that never occurred (no accepted-status
transition precedent; implementation gates unmet), and folds an ARB-tier,
one-way-door ratification into a reconciliation PR. Explicitly forbidden by the
maintainer directive not to fabricate acceptance history. Rejected.

### Option C: Supersede ADR-0007 and ADR-0009 with new records

**Pros:** a clean single lineage.
**Cons:** their cores (adapter isolation, clean-clone, pinned affects semantics)
remain valid; superseding would discard still-authoritative decisions and
overstate the change. Rejected.

### Option D: Do nothing

Leave "resolved at runtime" and "committed or cached" standing.
**Cons:** ratified law and the records disagree in writing — the silent-drift
failure mode. Rejected.

## Trade-offs

Holding two records `proposed` while a newer `accepted` record amends them is
unusual, but amendment does not require the amended record to be accepted, and
`proposed` is the honest status while the gates are unmet. The alternative —
accepting them to tidy the status — is precisely the fabrication the maintainer
directed against.

Amending by reference (a note in each record plus this decision) keeps the edit to
the audited records minimal, at the cost of a reader needing to follow the link to
see the full narrowing. Accepted: a light, discoverable pointer is safer than
rewriting one-way-door records in a reconciliation PR.

## Consequences

- Easier: reasoning about catalog composition (offline generation, one model);
  building `packages/adapters/catalog-backstage` against a fixed boundary; auditing
  why 0007/0009 are still `proposed`.
- Harder: two records now carry an amendment pointer that a future acceptance
  decision must fold in; the versioned-envelope requirement is a standing
  precondition for any persisted snapshot.
- **How we would know this was wrong:** the spike reports `blocked`, or an adopter
  shows the offline-generator boundary cannot express a real catalog — either
  reopens ADR-0012 and this reconciliation before acceptance.
- Revisit if: a future decision accepts or supersedes ADR-0007 or ADR-0009, at
  which point this amendment is folded into that record.

## Action items

1. [ ] Fold these amendments into ADR-0007 and ADR-0009 when each is taken to an
       explicit accept/supersede decision.
2. [ ] Ensure `specs/009-catalog-binding-viability/` scoping records the
       offline-generator/no-dynamic-loader boundary and the versioned envelope.
3. [ ] Keep `core-has-no-adapter-deps` and `clean-clone-builds` green as the
       standing evidence for ADR-0007's acceptance path.
