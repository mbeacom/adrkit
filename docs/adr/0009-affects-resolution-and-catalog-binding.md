---
schemaVersion: 0.1.0
id: "0009"
title: Pin affects resolution semantics and bind entity refs to pluggable catalogs
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [schema, core, matching, catalog]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0002", "0004", "0007"]
affects:
  - type: path
    pattern: "packages/core/src/affects/**"
  - type: path
    pattern: "packages/adapters/catalog-*/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Every consumer depends on these semantics; changing them later silently
    changes which decisions govern which code.
assertions:
  - id: resolution-is-pure
    description: >-
      Resolution must be a pure function of (matcher set, file list, catalog
      snapshot). No network calls, no clock, no filesystem reads beyond the
      supplied list.
    engine: custom
    input: source
    severity: error
---

# ADR-0009: Pin affects resolution semantics and bind entity refs to pluggable catalogs

## Context

ADR-0002 introduced `affects` as the field that makes a decision locatable, but
specified only the matcher *types*, not the resolution *semantics*. That gap is
the highest-leverage remaining ambiguity in the schema: every consumer — the CI
comment, the evaluator's overlap detection, the IDP plugin, the MCP retrieval
tools — depends on the answer, and changing it later silently changes which
decisions govern which code. Silent changes to governance mappings are the worst
class of bug this project can ship.

The `entity` matcher type carries a second problem. It presumes a catalog, and
there are at least two plausible ones with different reference grammars — the
open-source IDP catalog that dominates the developer-portal space, and the
Azure design-time API governance catalog, which maintains a structured inventory
with custom metadata and now supports git-based synchronization and registration
of AI assets. Hard-coding either violates ADR-0007. Requiring one violates the
principle that the CLI must be useful with zero infrastructure.

## Decision

### Resolution is pure

Resolution is a pure function of `(matchers, fileList, catalogSnapshot)`. No
network access, no clock, no filesystem traversal beyond the supplied list. This
makes CI results reproducible and makes the resolver trivially testable — and it
is asserted, not assumed.

### Per-ADR match, then union

An ADR governs a changed artifact when **at least one non-negated matcher
matches and no negated matcher matches**. Negations are scoped to the ADR that
declares them; they never suppress another ADR's match.

The result is a **union**, not a winner. Several ADRs may govern the same file,
and that is the normal case. Precedence between conflicting decisions is a
separate concern handled by `scope` hierarchy and explicit supersession — it is
deliberately *not* resolved at match time, because "which decisions apply here"
and "which decision wins" are different questions and conflating them hides
conflicts instead of surfacing them.

### Per-type semantics

| Type | Grammar | Resolved against | Notes |
|---|---|---|---|
| `path` | picomatch glob, POSIX separators, repo-relative, no leading slash | changed-file list | Case-sensitive. `**` crosses directories. Dotfiles matched only when the pattern says so. |
| `entity` | `<kind>:<namespace>/<name>`, wildcards allowed in each segment | catalog snapshot | Requires a catalog adapter. Inert without one. |
| `package` | `name` or `name@<semver range>` | **lockfile**, not manifest | Lockfile because the manifest states intent and the lockfile states reality. |
| `resource` | IaC type string, wildcards allowed | IaC plan JSON | Requires a plan artifact; inert without one. |
| `api` | `operationId` or path template | OpenAPI/AsyncAPI documents in the repo, or a catalog-registered API | Path templates normalized before comparison. |
| `data` | opaque string | adapter-defined | No core semantics; adapters own the meaning. |

### Degradation, not failure

A matcher whose backing source is absent is **inert**: it contributes no match
and emits `affects-unresolvable` at `info` severity. It is never an error.

This is what lets a corpus stay valid offline, in a clean clone, and in a repo
with no catalog, no IaC plan, and no OpenAPI documents — the ADR-0007 clean-clone
requirement applied to matching. An unknown matcher `type` is likewise a warning
and is ignored, so a newer corpus never breaks an older tool.

### Catalog binding is an adapter

`@adrkit/core` defines a minimal catalog port:

```
resolveEntity(ref: string): EntityId[]      // may return several; wildcards
entitiesForPaths(paths: string[]): EntityId[]
snapshot(): CatalogSnapshot                 // serializable, cacheable, diffable
```

Adapters implement it, under `packages/adapters/catalog-*` per ADR-0007. The
open-source IDP catalog adapter is the reference implementation and the only one
committed to; any cloud-catalog adapter is deferred until a concrete adopter
needs it, since building a second normalization target against a catalog nobody
has asked for would be speculative work. The reference grammar is normalized
to `<kind>:<namespace>/<name>` at the port; each adapter owns the mapping from
its native identifiers into that shape and documents anything lossy.

The snapshot is serializable so it can be committed or cached, which is what
keeps resolution pure and CI reproducible even when the live catalog moves.

## Options considered

### Option A: Pinned semantics, union match, pluggable catalog port (chosen)
Reproducible, degrades cleanly, no catalog lock-in. Costs a port abstraction and
a normalization layer that will be imperfect for at least one catalog.

### Option B: Single hard-coded catalog
Simpler, better fidelity to that catalog's model, no normalization loss. But it
picks a winner for every adopter and violates ADR-0007's dependency rule.

### Option C: Path matchers only; drop `entity`, `resource`, `api`, `data`
Much simpler, fully reproducible with no adapters at all, and genuinely
sufficient for single-repo adopters. Rejected because monorepo path globs cannot
express "this decision governs the payments service wherever it lives," which is
the case in the large organizations that need decision governance most. Worth
noting that Option C is what the first release effectively *is*, since the other
matchers are inert until an adapter is configured.

## Trade-offs

Normalizing two catalog grammars into one reference shape will lose fidelity
somewhere. Accepted; adapters document their lossiness rather than the core
growing per-catalog special cases.

Resolving `package` against the lockfile is stricter and occasionally surprising
— a decision about a dependency won't fire on a manifest-only edit. Accepted:
the alternative fires on intent that was never realized.

Union-without-precedence will surface conflicts that organizations were
previously unaware of. That is the intended behavior and it will feel like noise
in month one. The scope hierarchy and `conflicts_with` exist to make that noise
actionable rather than to suppress it.

## Consequences

- Easier: reproducible CI, offline and clean-clone operation, adding a third
  catalog later, testing the resolver exhaustively without fixtures beyond a
  file list.
- Harder: the normalization layer is a permanent maintenance surface; adopters
  with rich catalog models will find the common shape reductive.
- This is a one-way door in practice. Once corpora exist in the wild, changing
  match semantics reclassifies which decisions govern which code, without any
  visible diff to the records themselves. Any future change here requires a
  schema major version and a migration that reports the reclassification.
- Revisit if: a dominant machine-readable catalog reference grammar emerges,
  making normalization unnecessary.

## Action items

1. [ ] Resolver in `packages/core/src/affects/`, pure, exhaustively unit-tested
2. [ ] `resolution-is-pure` assertion wired into CI
3. [ ] Conformance fixture suite — matcher set + file list + expected match, as
       published test data other implementations can run
4. [ ] Catalog port interface, with both adapters stubbed against public docs
5. [ ] `adr explain <file>` — print every governing decision and the matcher
       that fired, because an unexplainable match is as bad as a wrong one
