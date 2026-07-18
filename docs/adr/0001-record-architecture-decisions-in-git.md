---
schemaVersion: 0.1.0
id: "0001"
title: Record architecture decisions as versioned markdown in git
status: accepted
date: 2026-07-18
created: 2026-07-18
deciders: ["@mbeacom"]
tags: [meta, process]
scope: org
reversibility: two-way-door
blastRadius: org
affects:
  - type: path
    pattern: "docs/adr/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: auto
  tierReason: Project bootstrap; sole decider.
reviewBy: 2027-07-18
---

# ADR-0001: Record architecture decisions as versioned markdown in git

## Context

This project builds tooling for decision records. If we manage our own decisions
anywhere else, we forfeit the right to recommend the practice, and we lose the
only realistic source of a dogfooded example corpus for testing the evaluator.

Beyond dogfooding, three forces:

- The corpus must be directly legible to language models with no export step.
  Markdown in git is the substrate agents already read well.
- Review must ride existing engineering workflow. Engineers will not adopt a
  second review system alongside pull requests.
- The record must be diffable and attributable. "Who changed this decision and
  when" has to be answerable with `git log`, not a vendor audit UI.

## Decision

One file per decision under `docs/adr/NNNN-kebab-title.md`, containing YAML
frontmatter (typed, machine-consumed) and a markdown body (prose, human-consumed).
Git is the system of record. All lifecycle transitions happen through pull
requests.

## Options considered

### Option A: Markdown files in git (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Low — no infrastructure to adopt |
| Agent legibility | High — no export layer |
| Review workflow | Reuses PRs, CODEOWNERS, branch protection |
| Query / reporting | Weak without an index layer (see ADR-0004) |

### Option B: Database-backed application (Decision Records, ReflectRally, Confluence)

**Pros:** rich workflow, permissions, reporting out of the box.
**Cons:** decisions live outside the repo they govern, so CI cannot cheaply map a
diff to the decisions constraining it — which is the capability this project
exists to provide. Adoption requires procurement. Corpus is not agent-native.

### Option C: Issue tracker (GitHub Issues, Jira)

**Pros:** zero new tooling, native discussion threads.
**Cons:** no diff semantics on the decision text; supersession has to be
simulated with links; export for retrieval is lossy.

## Trade-offs

We accept weak native querying in exchange for zero adoption cost, agent-native
storage, and colocation with the governed code. ADR-0004 addresses querying by
deriving an index rather than moving the source of truth.

We also accept that git offers no workflow engine. The ARB layer must be built
on top rather than inherited.

## Consequences

- Easier: PR-based review, CI integration, offline use, agent retrieval, forking.
- Harder: cross-repo aggregation, cross-cutting reporting, non-engineer authoring.
- Revisit if: non-engineering stakeholders (risk, compliance, architecture review
  boards without repo access) become primary authors rather than readers.

## Action items

1. [ ] `docs/adr/` with `0000-template.md`
2. [ ] `adr lint` in CI on every PR touching `docs/adr/**`
3. [ ] CODEOWNERS entry for `docs/adr/**`
