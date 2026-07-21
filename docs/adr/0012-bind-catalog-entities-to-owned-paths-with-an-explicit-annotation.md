---
schemaVersion: 0.1.0
id: "0012"
title: Bind catalog entities to owned paths with an explicit annotation
status: accepted
date: 2026-07-21
deciders: ["@mbeacom"]
tags: [schema, core, matching, catalog, governance]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0002", "0007", "0009"]
affects:
  - type: path
    pattern: "packages/core/src/affects/catalog.ts"
  - type: path
    pattern: "packages/core/src/affects/inert.ts"
  - type: path
    pattern: "packages/adapters/catalog-*/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Pins a public, catalog-agnostic ownership contract that every future
    catalog adapter and every adopter's descriptors encode. Reclassifying
    ownership after adoption is silent and expensive, so it takes the ARB tier.
assertions:
  - id: owned-paths-fail-closed-atomic
    description: >-
      Snapshot generation and consumption fail closed atomically. A duplicate
      canonical id or ref, a duplicate YAML key, malformed JSON, an
      annotation that is not exactly array<string>, an invalid glob, an
      unsupported snapshot version or capability, a repository mismatch, or an
      incomplete required source aborts the entire snapshot operation with a
      non-zero status and no usable partial snapshot — never a partial or
      silently-dropped set.
    engine: custom
    expression: owned-paths-fail-closed-atomic
    input: catalog
    severity: error
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/mbeacom/adrkit/issues/25"
    label: Decide catalog entity-to-path binding before feature 009
reviewBy: 2026-10-21
---

# ADR-0012: Bind catalog entities to owned paths with an explicit annotation

## Context

ADR-0009 pinned `affects` resolution and declared that `entity` matchers resolve
against a `CatalogSnapshot`. It delegated the mapping from native catalog
identifiers into the normalized shape to each adapter ("each adapter owns the
mapping from its native identifiers into that shape and documents anything
lossy"), described the snapshot as "serializable so it can be committed or
cached," and located adapters at `packages/adapters/catalog-*` per ADR-0007. It
left unspecified the one thing an `entity` matcher actually needs to fire: how a
catalog entity is bound to the **repo-relative paths it owns**. The
`CatalogSnapshotEntity` shape (`packages/core/src/affects/catalog.ts`) carries an
optional `paths` field, and the matcher only fires when an entity's `paths`
intersect the changed-file set (`packages/core/src/affects/inert.ts`). Nothing
decided where those `paths` come from; identity without a path set is inert by
construction.

Issue #25 established, against a frozen Backstage commit
(`1121a4facd9e321179d0402c3f355e4a649e84d9`) and two public Apache-2.0 corpora
(`backstage/community-plugins@92e9e4e0…`,
`redhat-developer/rhdh-plugins@3b355ddf…`), that **Backstage defines no
authoritative entity-to-path mapping**. Its standard fields describe adjacent
facts, none of which is path ownership: entity refs
(`[<kind>:][<namespace>/]<name>`, canonically lowercased by
`stringifyEntityRef`), `backstage.io/source-location`,
`backstage.io/managed-by-location` / `managed-by-origin-location`,
`github.com/project-slug`, and `ownedBy`. The two corpora show that
descriptor-parent and repository-root guesses have inconsistent granularity and
carry stale or mismatched repository annotations. So the binding cannot be
*inferred* from standard fields without high false-positive rates or silent,
catalog-specific guesses. This is the highest-leverage remaining gap in the
`entity` matcher: without a decided binding, either the matcher stays permanently
inert or a future adapter smuggles in an unreviewed heuristic that silently
reclassifies which decisions govern which code — the worst class of bug this
project can ship (ADR-0009).

## Decision

**An entity owns paths only when it says so, explicitly, through an adrkit
annotation.** The maintainer ratified Option A, then a follow-on contract
hardening, on 2026-07-21 (issue #25). Both decisions are encoded below. This
record fixes the *contract and semantics*; it does **not** authorize production
code (see "Scope and gates").

### The annotation

```yaml
metadata:
  annotations:
    adrkit.io/owned-paths: '["packages/payments/**","apis/payments/**"]'
```

- The value is validated **only after JSON decoding** and must be **exactly
  `array<string>`**. Each string is a repo-relative POSIX glob in the restricted
  dialect below.
- **Empty vs absent are distinct.** `[]` is valid and means *explicit no owned
  paths*. A missing `adrkit.io/owned-paths` means *no inferred ownership*. Both
  yield no path matches, but snapshot/evidence metadata MUST preserve
  `explicit-empty` versus `annotation-absent` for diagnostics.
- **Deterministic output.** An entity's owned-path set is sorted and
  deduplicated; identical inputs produce byte-identical snapshots.

### Restricted glob dialect

This is a **narrower** dialect than the general `path`-matcher grammar, chosen
for the safest reversible defaults:

- **Positive-only union.** Reject a leading `!` and negative extglobs. Semantic
  overlap is permitted and there is **no exclusive winner** — every matching
  entity is returned.
- **Frozen engine for spike evidence:** picomatch `4.0.5`, options
  `dot: false`, `nocase: false`, `nonegate: true`.
- **Allowed:** POSIX segments of literals (`A-Z`, `a-z`, digits, `_`, `-`, `.`)
  plus `*`, whole-segment `**`, and `?`.
- **Rejected (after JSON decode):** braces, brackets, parentheses/extglobs,
  commas, escapes/backslashes, `!`, empty segments, a leading `/`,
  absolute/drive/UNC paths, NUL/control characters, and `.` or `..` segments.
- **Dotfiles** match only when a pattern names a leading-dot segment explicitly;
  bare `**` does not imply dotfile ownership.
- Any future change to the dialect, engine, or options is a **versioned
  reclassification** requiring snapshot regeneration/migration evidence. Each
  accepted glob is compiled once.

### Entity identity and aliases

- Canonical ids and refs are the full, lowercase `kind:namespace/name`, matching
  `stringifyEntityRef` casing.
- Every id and ref is **globally unique within the snapshot**. Multiple raw
  descriptors that collapse to one lowercase id **fail closed**.
- The core `entity` matcher patterns stay **case-sensitive** (as implemented,
  `nocase: false`). Production scope therefore requires snapshots to supply
  canonical lowercase full refs, rather than silently changing core matching
  semantics to achieve a match.

### Repository boundary

- Snapshots are **single-repository only**.
- Every snapshot is bound to one canonical repository identity and immutable
  revision supplied by an **explicit input manifest** — never inferred from
  Backstage annotations. For the pinned GitHub spike, repository ids are
  lowercase `github.com/<owner>/<repo>` and revisions are full commit SHAs.
- A repository mismatch aborts generation/consumption. Multi-repository and
  federated snapshots are a **separate future contract**.

### Atomic fail-closed semantics

Any duplicate canonical id/ref, duplicate YAML key, malformed JSON, invalid
annotation, invalid glob, unsupported snapshot version/capability, repository
mismatch, or incomplete required source aborts the **entire** snapshot operation
with a non-zero status and **no usable partial snapshot**. YAML duplicate keys
and decoded traversal/absolute/control forms are rejected.

### Heuristics are not defaults

Descriptor-parent (`<descriptor-dir>/**`) and repository-root
(source-location / project-slug) mappings are **excluded from default and
authoritative behavior**. A non-shipping spike may *measure* them only to
document false-positive/precision trade-offs; if ever exposed they must be an
explicit, opt-in, warned mode — never ground truth, never on by default.
Identity-only normalization (Option D) may be measured but is **not sufficient**
to activate the current entity matcher, which needs a path set. Remaining blocked
(Option E) is rejected: it leaves `entity` permanently inert with no path to
change that.

### Composition, envelope, and persistence

- **No dynamic runtime adapter/plugin loader is authorized.** Catalog
  composition is a **standalone offline snapshot generator** feeding a validated
  interchange file (ADR-0007, ADR-0009). Generation reads only an explicit
  immutable local input manifest (repository id/revision plus descriptor paths
  and digests); it does **not** follow remote `Location` targets, call
  processors/plugins, or claim whole-catalog completeness.
- **Any persisted `CatalogSnapshot` requires a versioned interchange envelope
  before production.** The in-memory `CatalogSnapshotEntity` is an internal type,
  not a wire format. The spike MUST define a versioned envelope carrying at least
  schema version, repository id/revision, generator version, glob
  dialect/version/options, capability/completeness flags, source paths/digests,
  and deterministic entities. Production consumers reject partial or
  identity-only artifacts for path matching.

### Scope and gates

Accepting this record fixes the semantics above. It does **not** authorize a
production adapter. It authorizes feature 009 advance scoping and this
decision-record work only. Production of
`packages/adapters/catalog-backstage` remains gated on all of:

1. Phase 6 `specs/007-arb-queue/tasks.md` T048/T049 clearing.
2. Non-shipping spike evidence from `specs/009-catalog-binding-viability/`
   (go / explicit-heuristic-only / blocked), including a versioned envelope and
   the security/scale measurements below.
3. An **independent adopter** validating real entity/path outcomes.
4. Clean-clone / offline / adapter-boundary / release evidence passing.

The spike measures annotation bytes, entities, patterns per entity, pattern
length, documents/aliases, and compile/match cost on the pinned corpora.
Production limits are **not** guessed now; they must be ratified from evidence.
An authoritative `go` additionally requires adopter-authored annotations plus a
hand-labeled entity/path oracle, zero false positives/negatives for
authoritative cases, repository-isolation tests, malformed/tampered/stale
snapshot rejection, and deterministic byte output.

## Options considered

### Option A: Explicit `adrkit.io/owned-paths` annotation (chosen)

| Dimension | Assessment |
|---|---|
| Correctness | High — ownership is asserted, never guessed |
| Determinism | High — pure, sorted, deduplicated, atomically fail-closed |
| Catalog lock-in | None — custom annotation, no Backstage schema fork |
| Adopter burden | Real — every governed entity must be annotated |
| Reversibility | Reversible pre-adoption; hardens once corpora rely on it |

### Option B: Descriptor-parent `/**`

Plausible where one descriptor sits at a component's root, incorrect for
centralized, root-level, or multi-entity descriptors. **Cons:** silent
over-claim in exactly the monorepo layouts that need governance most. Retained
only as a possible explicit, warned, opt-in mode — never a default.

### Option C: Repository root from source-location / project-slug

Uses only standard fields. **Cons:** very low precision — many entities match
every file, and the corpora show stale/mismatched slugs. Blocked as a default.

### Option D: Identity-only snapshot

Normalizes entity refs to canonical ids with no path set. **Pros:** trivially
correct, no ownership claim. **Cons:** cannot activate the current entity
matcher, which requires paths. Measurable, but insufficient on its own.

### Option E: Remain blocked

Wait for an adopter-provided convention. **Cons:** leaves `entity` permanently
inert with no mechanism to change that, indefinitely. Rejected.

## Trade-offs

Explicit annotation puts the authoring burden on adopters: an entity governs no
paths until someone writes the globs. Accepted deliberately — a wrong ownership
map is worse than an absent one, because it silently reclassifies governance.

Issue #25 characterizes the annotation as "custom but deterministic and
reversible," and that is true **today**, before any corpus or persisted snapshot
depends on it. This record nonetheless declares `reversibility: one-way-door`: it
extends ADR-0009's affects-matching contract, itself a one-way door, and once
adopters encode `adrkit.io/owned-paths` into descriptors and corpora resolve
against it, changing the key or its semantics reclassifies ownership with no
visible diff to the records. The restricted dialect, frozen engine/options, and
versioned-envelope gate exist precisely to manage that hardening. Over-declaring
the door is the safe error; under-declaring it is the dangerous one.

Atomic fail-closed aborts the entire snapshot operation over one bad pattern,
duplicate id, or repository mismatch, which can feel blunt. Accepted: a
partially-applied ownership set is an unauditable governance map, and "abort the
whole operation and report" is more honest than "keep what parsed."

The restricted glob dialect is narrower than the general `path` grammar, so some
patterns valid elsewhere are rejected here. Accepted: a smaller, positive-only
surface is easier to validate deterministically and safer to freeze for
reproducible evidence.

## Consequences

- Easier: activating `entity` matching without a catalog fork; reasoning about
  where an ownership claim came from (an adopter wrote it); keeping resolution
  pure, single-repository, and reproducible; adding a second catalog later behind
  the same annotation and envelope.
- Harder: adopters must annotate every governed entity; there is no zero-config
  entity matching, by design; the restricted dialect and versioned envelope are
  permanent maintenance surfaces.
- **How we would know this was wrong:** the non-shipping spike
  (`specs/009-catalog-binding-viability/`) reports `blocked`, or an independent
  adopter's real corpus shows the explicit annotation is unusable at scale (e.g.
  it forces per-file annotations that defeat the purpose). Either reopens this
  decision before a production adapter ships.
- Revisit if: a dominant machine-readable catalog emerges that *does* define
  authoritative path ownership, making the adrkit annotation redundant; or the
  versioned-envelope contract forces a change to the entity shape.

### Governance: status of ADR-0007 and ADR-0009

The 2026-07-21 hardening decision states that "ADR-0007/0009 must be
accepted/amended or explicitly blocked before implementation." This record takes
the **explicitly-blocked** branch: both remain `proposed`, with concrete blockers
recorded, rather than being flipped to `accepted` here. That is the
smallest governance-safe change and the one that fabricates no history:

- This corpus has **no accepted-status transition on record**: every accepted
  record (0001, 0002, 0004, 0010, 0011) entered git already `accepted`. No ADR
  has ever been ratified from `proposed` to `accepted` via PR. Both 0007 and
  0009 already carry `ratifiedBy: "@mbeacom"`, and their constraints are enforced
  as de facto project law through the constitution and green CI assertions — but
  no explicit accepted-status transition was ever ratified for either. Flipping
  status in this PR would fabricate that specific governance act and fold an
  ARB-tier, one-way-door ratification into an unrelated decision PR.
- **ADR-0009's now-narrowed clauses.** ADR-0009 delegated the native-to-normalized
  entity mapping to adapters, described the snapshot as freely "serializable so
  it can be committed or cached," and assumed adapter-supplied resolution. The
  two 2026-07-21 decisions narrow both: persisted snapshots now require a
  versioned interchange envelope, and composition is a standalone offline
  generator rather than a dynamic runtime adapter. Accepting 0009 verbatim would
  ratify the looser, now-superseded language.
- **ADR-0007's now-narrowed clause.** ADR-0007's "discovery is by configuration,
  resolved at runtime" is narrowed by "no dynamic runtime adapter/plugin loader
  is authorized." Its enforcement assertions (`core-has-no-adapter-deps`,
  `clean-clone-builds`) are green, but the record itself has an open, now-refined
  clause and an unbuilt `packages/adapters/` action item.

This record therefore **refines** ADR-0009's delegated catalog mapping without
superseding it — the resolution-semantics half of ADR-0009 is already enforced as
a de facto constraint and stays in force — and leaves ADR-0007 and ADR-0009
`proposed`. A separate, explicit status-ratification (or amendment) decision
remains required for each; it is deliberately out of scope here.

## Action items

1. [ ] Record these constraints in `specs/009-catalog-binding-viability/`
       scoping (non-shipping spike) once its gates permit.
2. [ ] Define the versioned persisted-`CatalogSnapshot` interchange envelope
       (schema version, repository id/revision, generator version, glob
       dialect/version/options, capability/completeness flags, source
       paths/digests, deterministic entities) before any snapshot is persisted.
3. [ ] Implement `adrkit.io/owned-paths` parsing, the restricted-dialect glob
       validator, and atomic fail-closed semantics in the offline snapshot
       generator (gated; not authorized here).
4. [ ] Open the separate status-ratification or amendment decision for ADR-0007
       and ADR-0009 once their blockers above clear.
