# Contract: A/B/C/D Comparison Evidence — B/C Labeled Heuristic, Never Authoritative

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-002, FR-011,
FR-012, User Story 3 (all 5 acceptance scenarios), User Story 4 (both
acceptance scenarios), SC-005, SC-006. Companion to `data-model.md` §13
(`ComparisonHeuristicMeasurement`), §14 (`LabeledEntityChangedFilePair`), §15
(`IdentityOnlyEntity`). Normative source: ADR-0012 "Heuristics are not
defaults."

## 1. The Four Options, Their Roles, and Their Boundaries

| Option | What it is | Authoritative? | Measured how |
|---|---|---|---|
| **A** (`adrkit.io/owned-paths`) | The sole candidate for default, authoritative entity-to-path binding | The only one measured as such (FR-002) | `contracts/owned-paths-annotation.md`, `contracts/glob-dialect.md`, `contracts/entity-identity.md` |
| **B** (descriptor-parent) | Candidate paths = the descriptor file's own parent-directory glob | **Never** — measured only as a separately labeled, opt-in heuristic | §2 (real-corpus cardinality/collision) + §3 (synthetic precision) |
| **C** (repository-root) | Candidate paths = the entire repository (`**`) | **Never** — same as B | §2 + §3 |
| **D** (identity-only) | Canonical `kind:namespace/name` refs with no path binding at all | **Not applicable** — D makes no path claim to be authoritative or not | §4 |

**FR-002's absolute rule**: Options B and C MUST be implemented, if at all,
only as separately labeled, opt-in measurement heuristics, and **every**
report row either produces MUST carry an explicit `"non-authoritative"`
label — unconditionally, never contingent on the row's own numbers looking
favorable.

## 2. Real-Corpus Measurement — Cardinality/Collision Only, Never Precision (User Story 3, Acceptance Scenarios 1–4)

Neither pinned real corpus carries `adrkit.io/owned-paths` ground truth, so
**no precision figure is ever computed against either real corpus** — only
cardinality, collision, and granularity findings, reproducing the exact
citations `spec.md` already establishes:

| Finding | Corpus | Exact evidence (copied verbatim from `spec.md`; not re-fetched) |
|---|---|---|
| Repository-root (C) collision | `community-plugins` @ `92e9e4e09c76cc57f3475029b73e5ec84498a459` | 156 `catalog-info.yaml`/`.yml` descriptors by exact basename, zero at repository root — C would assign the identical `**` glob to every one of the 156 entities, a single indistinguishable candidate path set across the whole corpus. |
| Descriptor-parent (B) granularity inconsistency | Same corpus | The three sibling descriptors `workspaces/adr/plugins/adr/catalog-info.yaml`, `workspaces/adr/plugins/adr-backend/catalog-info.yaml`, `workspaces/adr/plugins/adr/examples/component/catalog-info.yaml` produce three different granularities for conceptually one workspace. |
| Repository-root (C) collision, root exists | `rhdh-plugins` @ `3b355ddfedb23c6656bd9effc8510f9926b765c1` | Exactly 38 descriptors (by exact basename — not 39; a path-suffix search over-counts by incorrectly matching `workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml`). This corpus **does** have a repository-root `catalog-info.yaml` (`metadata.name: rhdh-plugins`); C would still bind all 37 other descriptor-derived entities to that same root entity's repository-wide path set — a collision named explicitly, not smoothed over because a root descriptor happened to exist. |
| Stale/mismatched `github.com/project-slug` | `rhdh-plugins`, same commit | Three non-identical values for one physical repository: `redhat-developer/rhdh-plugins` (root, matches actual org), `red-hat-developer-hub/rhdh-plugins` (`workspaces/orchestrator/catalog-info.yaml`), `red-hat-developer-hub/backstage-plugins` (two other descriptors) — two of three do not match the actual GitHub organization. Cited as direct evidence *against* repository-identity inference from this field (`contracts/input-manifest.md` §3). |

Every row produced above carries `authoritativeLabel: "non-authoritative"`
(`data-model.md` §13) unconditionally.

## 3. Synthetic Precision Measurement — Spike-Authored Proxy Oracle Only (User Story 3, Acceptance Scenario 5)

Because neither real corpus provides ground truth, a genuine
precision/false-positive comparison requires a **spike-authored** labeled
matrix (`data-model.md` §14):

1. Build at least 10 synthetic entities, each with a spike-authored
   `adrkit.io/owned-paths` value.
2. Build a finite, spike-authored labeled entity × changed-file matrix
   guaranteeing both a labeled-true and a labeled-false example for every
   entity (so `TP + FP + TN + FN` covers every combination the matrix
   needs).
3. Apply B and C to the same matrix, obtaining a predicted boolean per pair.
4. Classify each pair: `TP` (predicted true, labeled true), `FP` (predicted
   true, labeled false), `TN` (predicted false, labeled false), `FN`
   (predicted false, labeled true).
5. Compute `precision = TP / (TP + FP)` and `falsePositiveRate = FP / (FP +
   TN)` **per heuristic**, over the whole matrix.

**Zero-denominator handling**: if either denominator is zero for a given
heuristic (e.g. a heuristic that never predicts a positive has an undefined
`TP + FP`), record that specific metric as the literal string
`"undefined-for-this-heuristic-on-this-matrix"` — never a divide-by-zero,
and never silently omitted. Critically, an undefined metric for **one**
heuristic MUST NOT suppress reporting the **other** heuristic's defined
metric on the same matrix.

**Worked example (zero-denominator case)**: suppose the repository-root
heuristic (C) predicts `true` for every single pair in the matrix (since its
candidate glob is `**`, matching everything under `dot: false`). Then C's
`TN = 0` and `FN = 0` by construction — every negative-labeled pair it
predicts `true` for becomes an `FP`, and every positive-labeled pair it
predicts `true` for becomes a `TP`. C's `falsePositiveRate = FP / (FP + TN) =
FP / (FP + 0)`, which is well-defined (equals `1.0`) as long as at least one
`FP` exists in the matrix — not itself an "undefined" case. Conversely, if a
heuristic's construction happens to predict `false` for every pair (never
occurs for B or C given their own definitions, but illustrative of the
general rule this contract must handle), its `precision = TP / (TP + FP) =
0 / 0`, which **is** undefined, and MUST be recorded as
`"undefined-for-this-heuristic-on-this-matrix"` while the other heuristic's
own defined `precision`/`falsePositiveRate` are still reported normally on
the same row set.

**This is explicitly labeled a proxy, never a substitute for an adopter
oracle**: every row produced under `measurementLevel: "synthetic-precision"`
MUST be explicitly labeled as measured against a spike-authored proxy
oracle, not an adopter-authored one, and therefore insufficient by itself to
satisfy `contracts/evidence-bundle-and-verdict.md`'s Evidence Gate
"authoritative `go`" requirement.

## 4. Option D — Confirmed No-Effect, Using Unmodified Core Code (User Story 4)

Build `CatalogSnapshot` fixtures whose entities carry `refs` (from Option D
normalization) but **no** `paths`. Feed them to the **existing, unmodified**
`resolveAffects`/`matchEntityPattern` functions in
`packages/core/src/affects/` (never a re-implementation). Confirm:

1. The entity matcher returns `{ matched: false }` for every Option-D-only
   entity against a changed-file list that would plausibly correspond to
   that entity's real-world location.
2. **No `affects-unresolvable` finding is attached** to that non-match — that
   finding class is emitted only when the catalog snapshot itself is
   entirely absent, not when it is present with empty per-entity `paths`
   (`data-model.md` §15's exact returned-shape field). The evidence bundle
   MUST state this precisely rather than imply an unresolvable-style finding
   was produced.
3. **In the same run**, an Option A entity with a populated `paths` array
   that does cover the changed-file list **does** match — proving the
   distinction is due to the presence or absence of `paths`, not an
   environment difference between two separate measurements (User Story 4
   Acceptance Scenario 2).

Option D's real (if narrower) value — trivially correct identity
normalization with no ownership claim — is explicitly insufficient on its
own to unlock the current entity matcher, which requires a path set. This
confirms a boundary the maintainer already ratified, using adrkit's real
code, rather than establishing new design.
