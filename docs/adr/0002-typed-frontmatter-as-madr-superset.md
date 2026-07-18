---
schemaVersion: 0.1.0
id: "0002"
title: Type the frontmatter as a MADR superset with an affects matcher
status: accepted
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [schema, core, interop]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0001", "0004"]
affects:
  - type: path
    pattern: "packages/core/src/schema/**"
  - type: path
    pattern: "schema/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: One-way door; every downstream package depends on this shape.
assertions:
  - id: schema-emit-matches
    description: The published JSON Schema is regenerated from the Zod source.
    engine: custom
    input: source
    severity: error
---

# ADR-0002: Type the frontmatter as a MADR superset with an `affects` matcher

## Context

The existing ADR ecosystem is a large set of templates and static-site
generators with no shared machine-readable contract. Tools interoperate at the
level of "it's markdown," which is why nothing downstream — CI, IDP catalogs,
agents — can act on a decision.

Two forces pull against each other. Adopting an established template (MADR is
the de facto standard) buys migrations and credibility. But MADR carries nothing
that lets a tool locate what a decision governs, route it for review, or record
whether a model wrote it.

The most consequential field is the one that maps a decision to the artifacts it
constrains. Without it, an ADR is a document. With it, CI can answer *"which
accepted decisions govern the code in this PR?"* — and deliver the answer as a
review comment, at the moment the next decision is being made.

## Decision

Define the frontmatter as a **strict superset of MADR**: every MADR field is
present or mechanically derivable, plus governance metadata (`scope`,
`reversibility`, `blastRadius`), routing state (`review`), authorship and origin
(`provenance`), enforcement (`affects`, `assertions`), and evaluator output
(`evaluation`).

`provenance` covers imported records as well as authored ones. An imported MADR
record is frequently `accepted` with no named decider, and inferring one from
git blame would attribute the decision to whoever committed the file — often
wrong, always unfalsifiable. So `provenance.importedFrom` records the source
kind, source reference, and content fingerprint, and **its presence exempts the
record from the deciders-required invariant**. The decision was made elsewhere;
an empty field is more honest than a fabricated one.

Author the schema once in Zod; emit JSON Schema from it. Version it
independently of the tooling, semver'd, published under a stable `$id`.

`affects` is a list of typed matchers — `path` (glob), `entity` (Backstage-
compatible catalog ref), `package`, `resource` (IaC type), `api`, `data` — with
optional `repo` qualifier and `negate`.

## Options considered

### Option A: Superset of MADR (chosen)
Migrations from the largest existing corpus are mechanical. Existing MADR
tooling continues to render our files. Extension fields degrade gracefully to
"unknown frontmatter" in tools that ignore them.

### Option B: Clean-sheet schema
Better internal coherence, no legacy fields. But it makes every existing corpus
a manual migration and gives incumbents a reason to dismiss it as
not-invented-here. For a project whose value increases with adoption, this is
the wrong trade.

### Option C: Frontmatter-light, infer from prose
Let a model extract structure from freeform ADRs. Zero authoring burden, but
non-deterministic, unauditable, and unusable as a CI gate. Viable as an *import
path*, not as the storage format.

## Trade-offs

Carrying MADR's field names means inheriting some awkward ones. Accepted: the
interop is worth more than the elegance.

Authoring burden rises versus plain MADR. Mitigated by making nearly everything
optional with sensible defaults, and by `adr new` inferring `affects` from the
changed paths in the current branch.

## Consequences

- Easier: CI enforcement, IDP integration, agent retrieval with structured
  filters, migration in from MADR, audit evidence mapping.
- Harder: schema evolution — this is a one-way door. Consumers will pin.
- Revisit if: the ecosystem converges on a competing machine-readable ADR
  standard. Then we adapt to it rather than defend ours.

## Action items

1. [ ] Publish `schema/adr.schema.json` under a versioned `$id`
2. [ ] `adr migrate --from madr`
3. [ ] Infer `affects` from branch diff in `adr new`
4. [ ] Contribute the schema back to the `adr.github.io` tooling list
