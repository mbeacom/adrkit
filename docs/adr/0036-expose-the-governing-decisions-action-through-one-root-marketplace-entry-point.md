---
schemaVersion: 0.1.0
id: "0036"
title: Expose the governing-decisions Action through one root Marketplace entry point
status: accepted
date: 2026-08-27
deciders: ["@mbeacom"]
tags: [ci, distribution, github-actions, marketplace]
scope: component
reversibility: two-way-door
blastRadius: cross-team
relatesTo: ["0007", "0014", "0016", "0032", "0035"]
affects:
  - type: path
    pattern: "action.yml"
  - type: path
    pattern: "packages/ci/action.yml"
  - type: path
    pattern: "packages/ci/dist/index.js"
  - type: path
    pattern: ".github/workflows/release.yml"
  - type: path
    pattern: ".github/workflows/action-tag-recovery.yml"
  - type: path
    pattern: ".github/workflows/container-release.yml"
  - type: path
    pattern: "scripts/marketplace-action-contract.test.ts"
  - type: path
    pattern: "docs/RELEASING.md"
assertions:
  - id: marketplace-root-alias
    description: >-
      The repository-root action.yml remains metadata-compatible with
      packages/ci/action.yml except for the bundle path required by its
      different location.
    engine: custom
    expression: marketplace-action-contract
    input: source
    severity: error
  - id: nested-recovery-preserved
    description: >-
      Moving-major-tag recovery keeps releases from before the root Marketplace
      entry point eligible for established nested Action consumers.
    engine: custom
    expression: action-tag-recovery-contract
    input: source
    severity: error
  - id: marketplace-publication-order
    description: >-
      Lockstep publication leaves a draft GitHub release after npm succeeds;
      publishing that draft with the Marketplace selection finalizes the moving
      Action tag and container release.
    engine: custom
    expression: action-tag-recovery-contract
    input: source
    severity: error
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
---

# ADR-0036: Expose the governing-decisions Action through one root Marketplace entry point

> **Status: accepted.** Agent-drafted and explicitly ratified by `@mbeacom` on
> 2026-08-27.

## Context

adrkit ships two repository-backed GitHub Actions. The governing-decisions
Action comments the decisions that apply to a pull request, while the ARB queue
Action maintains one operations issue. Both are currently consumed through
subpaths under `packages/ci/`.

GitHub Marketplace automatically lists only the Action whose metadata is at the
repository root. Nested Action metadata remains executable but does not receive
its own listing. Listing both Actions separately would therefore require
another repository or another independently released distribution path.

Public GitHub code search found current Action consumers only in
maintainer-controlled repositories. Marketplace publication is consequently a
discoverability experiment, not evidence of established external demand. The
governing-decisions Action is the broader entry point because it participates
directly in pull-request review; the scheduled queue is useful only after a team
has adopted the review metadata.

## Decision

We will publish one Marketplace entry for the governing-decisions Action by
adding a repository-root `action.yml` that runs the existing committed
`packages/ci/dist/index.js` bundle.

The root and nested metadata will expose the same name, description, branding,
inputs, and runtime. A contract test will permit only the bundle path to differ.
The established `mbeacom/adrkit/packages/ci@<ref>` reference remains supported.
The queue Action remains nested and unlisted.

The first Marketplace release must contain the root entry point before
publication. After npm publication succeeds, the Release workflow will create a
draft GitHub release for a lockstep tag. A human publishes that draft with the
Marketplace selection and categories. The resulting `release: published` event
will run the container-release workflow, whose narrow finalization job validates
the successful Release run and withdrawal marker before moving the major Action
tag. Its separate container job retains only read access to repository contents.
Adapter releases remain immediately published and do not enter this
finalization path.

This ordering amends ADR-0032 clause 2: public stable release publication, not
Release-workflow completion alone, now triggers the container and moving Action
tag finalization. npm still has to succeed first.

Moving-major-tag recovery will continue to accept older releases that carry
both nested Actions, because those established `@v0` consumers need a known-good
rollback target if the first compatible release is bad.

Marketplace documentation will use immutable root release tags and will not
advertise `mbeacom/adrkit@v0`. Withdrawing a bad Marketplace release and
publishing a higher hotfix are separate from moving-tag recovery.

Marketplace publication remains a deliberate release step after the automated
lockstep release succeeds and before the lockstep release is considered public
and distribution-complete. Adapter-only releases do not publish the Action.

## Options considered

### Option A: Add one root alias in this repository

**Chosen.** It reuses the existing bundle, release tags, provenance, and rollback
path without creating a second source of truth. Only the broader Action receives
a listing.

### Option B: Split both Actions into dedicated repositories

Each Action would receive an independent listing and release cadence, but source,
bundles, tags, rollback procedures, and security controls would need
cross-repository synchronization before external demand justifies that cost.

### Option C: Keep both Actions nested

This preserves the smallest repository surface but leaves discovery dependent on
adrkit's documentation and direct links.

## Trade-offs

The chosen option duplicates Action metadata at two paths and makes public
lockstep release completion wait on a manual Marketplace step. The parity test
limits drift, but GitHub still presents only one of the two Actions in
Marketplace.

The root and nested forms therefore have different containment paths. Moving
`v0` can restore established nested consumers to a pre-alias release, while an
immutable Marketplace pin must be withdrawn from the listing and replaced by a
higher release. The root moving-tag form is intentionally unsupported.

## Consequences

- Easier: users can discover and install governing-decisions from GitHub's
  Actions catalog without knowing the monorepo subpath.
- Easier: existing consumers, bundles, permissions, and runtime behavior remain
  unchanged.
- Harder: every lockstep release must update the Marketplace listing after the
  automated npm release succeeds; an unattended release remains a draft.
- Harder: Marketplace incidents require listing withdrawal, consumer
  notification, and a higher hotfix; moving `v0` is not sufficient.
- **How we would know this was wrong:** the listing produces no independent
  consumers or actionable interest after 90 days while continuing to add release
  or support overhead.
- Revisit if: independent demand develops for a separate ARB queue listing, or
  Marketplace publication requires a dedicated single-purpose repository.

## Action items

1. [x] Add the root Action metadata and parity contract.
2. [x] Protect the root entry point as a gate-defining surface.
3. [x] Require the root entry point during forward release while preserving
   pre-Marketplace recovery for nested consumers.
4. [x] Finalize the moving Action tag and container only after the Marketplace
   draft is published.
5. [ ] Publish the first compatible lockstep release to GitHub Marketplace.
6. [ ] Review independent usage and support cost after 90 days.
