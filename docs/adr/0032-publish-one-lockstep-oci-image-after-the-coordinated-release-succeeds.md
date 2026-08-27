---
schemaVersion: 0.1.0
id: "0032"
title: Publish one lockstep OCI image after the coordinated release succeeds
status: accepted
date: 2026-08-26
deciders: ["@mbeacom"]
tags: [architecture, packaging, distribution, container, supply-chain]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0006", "0007", "0010", "0014", "0016", "0017", "0018", "0028"]
affects:
  - type: path
    pattern: "Containerfile"
  - type: path
    pattern: ".dockerignore"
  - type: path
    pattern: ".github/workflows/container-release.yml"
  - type: path
    pattern: ".github/workflows/ci.yml"
  - type: path
    pattern: "scripts/container-*"
  - type: path
    pattern: "README.md"
  - type: path
    pattern: "docs/RELEASING.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Adds a public distribution channel and its release, rollback, provenance,
    and compatibility obligations.
reviewBy: 2027-02-26
---

# ADR-0032: Publish one lockstep OCI image after the coordinated release succeeds

> **Status: accepted.** Agent-drafted and ratified by `@mbeacom` through the
> explicit request to add GitHub Container Registry publication.
>
> **Publication-order amendment:** ADR-0036 changes clause 2's trigger from
> successful Release-workflow completion to publication of the stable GitHub
> release, after that workflow has published npm and created the draft.

## Context

The CLI and MCP server are published Node packages, while the two CI entry
points are committed GitHub Action bundles. A local container can make all four
executables available without installing a runtime into the consuming
repository, and gives MCP clients a uniform stdio command.

Building a Containerfile is not the consequential decision. Publishing it is:
the registry name, tags, architecture set, provenance, update order, and
rollback behavior become a fifth distribution contract. Publishing directly
on a tag push would race the existing Release workflow and could advertise a
container version whose coordinated npm publication failed.

Dedicated images for every executable would narrow SBOMs, but would also create
five registry packages with separate visibility, retention, provenance, and
rollback operations. The behavior is already selectable inside one image.

## Decision

**Publish one all-in-one OCI image at `ghcr.io/mbeacom/adrkit` as part of the
lockstep release, only after the coordinated Release workflow succeeds.**

1. The image version is the lockstep package version. It does not have an
   independent manifest or release tag.
2. A successful stable `vX.Y.Z` Release workflow creates a draft after npm
   publication. Publishing that stable GitHub release triggers container
   publication. Adapter releases and failed Release runs publish no container.
3. Registry tags are immutable `vX.Y.Z`, moving `vX`, and `latest`. Promotions
   are serialized. A release moves `vX` only when it is newest in that major and
   moves `latest` only when it is newest overall; historical recovery cannot
   roll either tag backward. Automation should pin the immutable tag or digest.
4. The published artifact is the all-in-one `adrkit` target. `cli`, `mcp`, `ci`,
   and `queue-action` remain isolated local build targets and CI subjects, not
   separate registry packages.
5. Bun 1.3.14 installs and bundles the CLI and MCP sources for Node. The final
   image runs Node 24 as a non-root user and contains the committed Action
   bundles. Both base image indexes are pinned by digest.
6. The image is published for `linux/amd64` and `linux/arm64`. Buildx pushes
   the content-addressed digest first, GitHub attests it, and only then are the
   public release tags promoted to that digest.
7. MCP examples and CI run it with no network, a read-only root filesystem, and
   a read-only repository mount. Writing CLI commands opt into a writable mount.
8. A manual recovery dispatch accepts only an existing stable GitHub release
   with a successful `Release` workflow for the exact tag/SHA, whose tag commit
   is on `main`, and whose version matches the repository. It refuses to change
   an existing immutable tag to a different digest.

## Options considered

### Option A: One lockstep all-in-one image after Release (chosen)

**Pros:** one discoverable package; no version drift; coordinated ordering;
multi-architecture; one attestation and rollback surface.

**Cons:** the all-in-one image carries more executable code than a consumer
using only one selector. Dedicated local targets mitigate policy inspection but
are not published.

### Option B: Publish one package per executable

**Pros:** smallest runtime and narrowest SBOM for each consumer.

**Cons:** five registry packages and five moving-tag/provenance/visibility
surfaces for four entry points that already share one repository and release.

### Option C: Publish on every tag push

**Pros:** simpler workflow trigger and fastest availability.

**Cons:** races the coordinated npm release, so the same version can exist in
GHCR while its package release is failing.

### Option D: Keep the Containerfile local only

**Pros:** no registry or release obligation.

**Cons:** every consumer rebuilds the same image, MCP configuration cannot pin a
maintainer-built digest, and local builds lack registry provenance.

## Trade-offs

- Container publication is downstream of already-public npm packages and the
  newly published GitHub release. If it fails, those artifacts cannot be rolled
  back; the image is recovered by rerunning publication for the existing tag.
- Digest-pinned bases are reproducible but require reviewed maintenance updates
  for Node, Alpine, and Bun patches.
- The all-in-one image is larger than a dedicated target and exposes selectors
  a given consumer may not use.
- The first GHCR package requires a one-time human visibility decision before
  unauthenticated users can pull it.

## Consequences

- **Easier:** users can run CLI and MCP without installing Node or Bun; MCP
  clients can pin one stable stdio command; releases carry verifiable registry
  provenance.
- **Harder:** release operations now include a downstream workflow, GHCR
  package settings, base digest maintenance, multi-architecture builds, and a
  second recovery path.
- **How we would know this was wrong:** if users consistently require dedicated
  published images for policy/SBOM acceptance, or if the downstream publish
  fails on more than one of the next three lockstep releases.
- **Revisit if:** a registry consumer requires a different cadence from the npm
  surface, or GHCR provenance/retention cannot satisfy the supported workflow.

## Action items

1. [x] Add isolated CLI, MCP, governing-decisions, queue, and all-in-one targets.
2. [x] Pin build/runtime base indexes and run final images as non-root.
3. [x] Exercise CLI, both MCP protocol eras, and both Action failure boundaries
   without runtime network access.
4. [x] Publish multi-architecture lockstep images to GHCR after Release success.
5. [x] Attach registry provenance and document first-publish visibility,
   immutable tags, and recovery.
