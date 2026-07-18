---
schemaVersion: 0.1.0
id: "0006"
title: License Apache-2.0 with a DCO and develop in a single monorepo
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [licensing, governance, repo]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0002", "0003", "0010"]
affects:
  - type: path
    pattern: "LICENSE"
  - type: path
    pattern: "CONTRIBUTING.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: Licensing is effectively irreversible once external contributions land.
---

# ADR-0006: License Apache-2.0 with a DCO and develop in a single monorepo

## Context

Licensing is the most irreversible decision in the project. Once third-party
contributions land under a license, relicensing means tracking down every
contributor.

Two of the stated goals — use on client engagements in a large-enterprise
context, and the long-shot possibility of a major vendor adopting or upstreaming
the work — push in the same direction. Enterprise legal review clears Apache-2.0
and MIT without friction. Copyleft triggers review cycles that end evaluations
before they start. Anything source-available or non-OSI forecloses the upstream
path entirely.

Apache-2.0 over MIT specifically for the express patent grant. For a schema
intended to become a shared contract, an explicit patent grant is what lets a
legal department sign off without a bespoke analysis.

## Decision

- **Apache-2.0** across all packages.
- **DCO** sign-off rather than a CLA. A CLA enabling future relicensing signals
  commercial intent and depresses contribution; the DCO is the lower-friction
  norm and forecloses a rug-pull.
- **Single monorepo** with independently versioned packages. The workspace
  toolchain is decided separately in ADR-0010.
  `@adrkit/core` and the schema follow strict semver and are treated as public API;
  everything else may move faster.
- The schema directory additionally offered under **CC0**, so competing
  implementations can adopt the contract with no license consideration at all.
- **Published under the maintainer's personal GitHub namespace**
  (`github.com/mbeacom/adrkit`), not a dedicated organization. Employer open-source
  stipulations and seat arrangements govern where personal open-source work may
  live, and a personal namespace is what they permit.

## Options considered

### Option A: Apache-2.0 + DCO, monorepo (chosen)

| Dimension | Assessment |
|---|---|
| Enterprise adoptability | High — clears standard legal review |
| Patent protection | Express grant |
| Contribution friction | Low (DCO) |
| Retained commercial leverage | None — deliberately |

### Option B: MIT

**Pros:** shorter, marginally more familiar, equally permissive.
**Cons:** no patent grant. For a schema meant to function as a standard, that
omission matters more than the brevity.

### Option C: Apache-2.0 core with a commercial license on the ARB/hosted layer

**Pros:** preserves a monetization path from day one.
**Cons:** an open-core boundary drawn before anyone is using the project
reliably suppresses the contribution that would make it worth monetizing. The
boundary can be drawn later around *new* hosted code without relicensing
anything.

### Option D: AGPL

**Pros:** strongest protection against a vendor absorbing the work without
contributing back.
**Cons:** disqualifies the project from most enterprise evaluations and from any
upstream path. Directly contradicts the primary goals.

### Consequences of the personal namespace

A dedicated organization would have bought identity separation and a tidier
donation story. Two of the three concerns turn out not to bind:

- **Transfer stays available.** GitHub supports transferring a repository from a
  personal account to an organization later, preserving redirects. This is not a
  one-way door, so the namespace can be revisited once there is something worth
  donating.
- **Collaborator access is already scoped.** Outside collaborators on a personal
  repository receive repository-level permissions only; they gain nothing
  against other repositories in the namespace.
- **Identity separation is genuinely lost**, and no setting recovers it. The
  compensating control is that the IP boundary in ADR-0007 is *mechanical* — a
  CI job asserting a clean clone builds with no credentials — rather than
  namespace-based. A boundary CI enforces does not weaken because the URL
  changed.

One consequence does bind, and it changes an earlier assumption. Because the
namespace may move, **the schema `$id` must not encode it.** A `$id` is a
published contract that consumers pin; hosting it under
`mbeacom.github.io/adrkit/...` would break every pinned reference on transfer.
Register a namespace-independent domain before first publish, or accept that the
schema cannot be moved later without a major version. The personal-namespace
constraint makes owning a neutral domain *more* important, not less.

## Trade-offs

Apache-2.0 lets a large vendor fork and productize without contributing back.
Accepted deliberately: given the goals, being absorbed is closer to success than
to failure, and the realistic risk here is obscurity, not appropriation.

The CC0 schema carve-out weakens control over the contract in exchange for a
materially better chance it becomes shared infrastructure. That trade only makes
sense if standardization is genuinely the goal — which ADR-0002 asserts it is.

## Consequences

- Easier: enterprise evaluation, client engagements, external contribution,
  upstreaming.
- Harder: no leverage against commercial forks; no relicensing path; open-core
  monetization must be built on new code rather than carved out of existing code.
- Note: the author's employment context may impose separate obligations
  regarding outside open-source work and its use with clients. That constrains
  *participation*, not the license choice, and is tracked outside this
  repository.
- Revisit if: a hosted component is later built. Draw the boundary around new
  code; do not relicense what exists.

## Action items

1. [ ] LICENSE, NOTICE, per-package `license` fields
2. [ ] DCO bot enabled on the repository
3. [ ] `schema/LICENSE` (CC0) with the carve-out stated plainly in the README
4. [ ] SECURITY.md and CODE_OF_CONDUCT.md before the repository goes public
5. [ ] Resolve external participation obligations before first public push
6. [ ] Register a namespace-independent domain for the schema `$id`, or accept
       that the schema hostname is fixed for the life of the major version
