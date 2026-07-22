# Contract: Pinned Public Corpora, Synthetic Explicit Annotations, and Structural Edge-Case Fixtures

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-001, FR-013,
FR-014, FR-015, FR-016, User Story 5 (all 4 acceptance scenarios), SC-007,
SC-008, SC-009. Companion to `data-model.md` §5 (`DescriptorDocument`), §16
(`StructuralEdgeCaseFixture`), §17 (`DotfilePolicyConfirmation`),
`research.md` R1, R8. Normative source: `spec.md` FR-001/FR-013–FR-017 and
the Ratification Record.

## 1. Frozen Research Inputs — Exact, Non-Reselectable (FR-001)

Three commits, cited verbatim from `spec.md` and re-verified (never
re-fetched fresh by this planning session, per `research.md` R1) only at a
future execution session's own FR-001 step:

| Source | Pinned commit |
|---|---|
| Backstage | `1121a4facd9e321179d0402c3f355e4a649e84d9` |
| `backstage/community-plugins` | `92e9e4e09c76cc57f3475029b73e5ec84498a459` |
| `redhat-developer/rhdh-plugins` | `3b355ddfedb23c6656bd9effc8510f9926b765c1` |

**Immediately before spike execution**, each MUST be re-verified still
reachable at that exact SHA (never a branch `HEAD`, never a newer commit). If
any no longer resolves as expected, the spike MUST fail closed and require
spec re-ratification, never silently substitute a different commit's
contents.

## 2. Duplicate-YAML-Key Fixture (FR-013; User Story 5 Acceptance Scenario 2)

Author one synthetic descriptor whose YAML source contains a duplicate
mapping key at the top level (e.g. two `metadata:` blocks in one document).
Parse it using the `yaml@2.9.0` default (`uniqueKeys: true`, `research.md`
R8) — the parse MUST throw/reject, and this rejection contributes to (rather
than being exempt from) the whole-operation atomicity
(`contracts/atomic-fail-closed.md`) proven in User Story 2.
`data-model.md` §16's `outcome: "rejected-duplicate-key"` is the recorded
result.

## 3. Multi-Document Fixture (FR-013; User Story 5 Acceptance Scenario 1)

Author one synthetic fixture containing two or more `---`-separated YAML
documents in a single file (e.g. a `System` and a `Component` sharing a
file), each with its own distinct `adrkit.io/owned-paths` value. Parse both
documents (`data-model.md` §5's `documentIndexInFile` distinguishes them).
Confirm **no cross-document leakage**: each entity's derived paths come only
from its own document's annotation. Record `outcome:
"both-entities-parsed-independently"`, and record explicitly that this
fixture is synthetic (A3 already establishes neither pinned corpus was found
to contain a multi-document descriptor).

## 4. `Location`-Not-Followed Fixture (FR-010, FR-013; User Story 5 Acceptance Scenario 3)

Author one synthetic `Location` entity (`kind: Location`, `spec.targets`
pointing at a second fixture file carrying an actual `Component` and its own
`adrkit.io/owned-paths` annotation) — but where **only the `Location` file
itself** is named in the input manifest's `sources` array; the second,
targeted file is deliberately excluded. Run generation using only the
manifest-listed files. Confirm the target `Component` entity contributes
**zero** derived paths, and that this is recorded as
`"zero-derived-paths-never-read"` (`data-model.md` §16) — never
`"invalid-input"` — because the generator never opened the target file to
find it, not because its annotation was invalid. See
`contracts/input-manifest.md` §6 for the input-boundary framing of this same
fixture.

**Related edge case (descriptor-parent heuristic applied to `Location`)**:
if Option B (descriptor-parent) is separately applied to this same
`Location` fixture (as a B/C measurement, not as Option A derivation), its
"parent directory" is not meaningfully a path a `Location` entity itself
owns. Record both facts as independent data points for B's unreliability
(`contracts/comparison-heuristics.md` §2), never silently skipping either.

## 5. Dotfile Policy Confirmation (FR-017; User Story 5 Acceptance Scenario 4)

See `contracts/glob-dialect.md` §4 for the full contract — this fixture is
listed here for completeness since it is one of User Story 5's four required
structural/behavioral proofs, but its normative content lives in the
glob-dialect contract to avoid duplication.

## 6. Real-Corpus "Absent Annotation Is the Overwhelmingly Common Case" (FR-015; SC-007)

Reproduce, as real-corpus evidence, the full-scan finding already cited in
`spec.md`: across all 156 `backstage/community-plugins` `catalog-info.yaml`
descriptors at the pinned commit, **23** carry any `metadata.annotations`
block at all, and **0** carry `adrkit.io/owned-paths`. Record these exact
counts (never an estimate, never a materially different rate without
resampling); every one of the 156 entities is recorded `annotation-absent`
(`contracts/owned-paths-annotation.md` §3) — never inferred from its
descriptor's location.

## 7. Real-Corpus Descriptor-Parent Granularity Inconsistency (FR-016; SC-007)

Reproduce, as real-corpus evidence, the three sibling `community-plugins`
descriptors named in `contracts/comparison-heuristics.md` §2's table, and
cite the `redhat-developer/rhdh-plugins` descriptor count as **exactly 38**
(by exact basename match) — never 39, noting explicitly that a naive
path-suffix search over-counts by incorrectly matching
`workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml`,
whose filename ends in the string "catalog-info.yaml" without being one.

## 8. Real-Corpus Stale Project-Slug Evidence (FR-014)

Reproduce the three non-identical `github.com/project-slug` values for one
physical `rhdh-plugins` repository, already fully detailed in
`contracts/comparison-heuristics.md` §2's table. Report this as evidence
against relying on `github.com/project-slug` for **any** authoritative
inference — including repository-identity inference specifically
(`contracts/input-manifest.md` §3), which is the narrower framing the
hardening decision adopted over this spec's own earlier, broader "evidence
against path-ownership inference only" framing.

## 9. Overlap Between Distinct Entities Is Not a Structural Edge Case Failure

For completeness: the "two entities, distinct canonical IDs, overlapping
`owned-paths`" case (`spec.md` Edge Cases; FR-031) is **not** a structural
edge-case *fixture* in the sense of §2–§4 above — it is a positive
demonstration of the "no exclusive winner" rule, fully specified in
`contracts/entity-identity.md` §4, not a rejection or ambiguity this section
covers.

## 10. SC-009's "Never a Silent Skip" Requirement

Each of the three required synthetic structural fixtures (§2–§4) MUST
produce a recorded, unambiguous outcome — `"both-entities-parsed-
independently"`, `"rejected-duplicate-key"`, or `"zero-derived-paths-never-
read"` — never a silent skip, and the evidence bundle states plainly that
all three are synthetic, not real-corpus finds (A3).
