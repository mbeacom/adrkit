# Feature Specification: Backstage Catalog Adapter — Offline Owned-Paths Snapshot Generator

**Feature Branch**: `010-catalog-backstage`

**Feature Directory**: `specs/010-catalog-backstage`

**Created**: 2026-08-04

**Status**: Draft — **work authorized, release not authorized.**

**Input**: Author the production feature specification for the Backstage catalog adapter
(`packages/adapters/catalog-backstage/`), under the constraints of
[ADR-0020](../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
action item 1.

---

## Authorization and scope boundary

This feature is authorized by
[**ADR-0020**](../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
— "Rescope SC-010 and authorize work toward the Backstage catalog adapter" — whose frontmatter
records `status: accepted` and `date: 2026-08-03`, and whose own status banner records it
"ratified by `@mbeacom` on 2026-08-04". Its action item 1 is exactly this document: *"Open the
production feature spec for `packages/adapters/catalog-backstage/` under the constraints above,
citing this record for the SC-010 rescope."*

**ADR-0020 authorizes the work. It does not authorize the release.** Its Decision section opens
with the bolded statement "Rescope SC-010, and authorize the implementation work required to
clear ADR-0012's remaining production gates. **This record does not itself authorize releasing
the adapter.**"
Clause 9 defers both the release vehicle (publish target, tag, channel) and the decision to
release at all to "a later record made once clause 5 and ADR-0012 gates 3 and 4 are all
demonstrably met." ADR-0012 gate 3 is recorded `Unmet` in ADR-0020's own gate-status table.

Accordingly, and bindingly on every requirement below:

- This specification **MUST NOT** claim, imply, or schedule release authorization, a publish
  target, a version tag, a distribution channel, or a date for any of them.
- Per ADR-0020's closing paragraph, this work is authorized **toward
  [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  rung 1 only**, which ADR-0014 calls "necessary, never sufficient on its own to land a phase
  whose value is an operational surface." A catalog adapter is such a surface. Nothing
  produced under this specification is reference-verified or externally validated, and neither
  this document nor the package may claim otherwise.
- Per ADR-0014's honesty rules, maintainer-owned reference verification is **rung 2** and
  **MUST NOT** be described as external, third-party, or community adoption. Only corpus
  *data* may be third-party; the validation never is.
- Phase 6's status is unchanged in both directions by this document.

**This feature has produced no evidence.** At this document's writing no
`packages/adapters/catalog-backstage/` package exists, no generator has been run, no envelope
has been emitted, and no check has been observed failing. Every claim below about behavior is
a *requirement to be met*, never a report of something already demonstrated.

---

## Normative sources

The ADRs are normative. Where this specification and an ADR disagree, **the ADR wins**.

| Source | What it binds here |
|---|---|
| [ADR-0020](../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md) | The authorizing record. Clause 3 (rescoped spike-009 SC-010), clause 5 (accept-path release gate, two distinct steps), clause 6 (fresh T014 → T014a oracle cycle before any generator output), clause 7 (inherited requirements), clause 8 (executable gate observed failing first), clause 9 (release deferred). |
| [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md) | The `adrkit.io/owned-paths` contract, the restricted glob dialect, whole-operation atomic fail-closed semantics, the single-repository boundary, the versioned envelope, the four-item production gate list, and "production limits are not guessed now; they must be ratified from evidence." |
| [ADR-0015](../../docs/adr/0015-validate-descriptors-against-backstage-field-formats-before-canonicalizing.md) | Admissibility **before** canonicalization; the four-field validator table pinned to Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`; `inadmissible-descriptor` as a fatal whole-operation trigger. |
| [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md) | Standalone offline generator; **no dynamic runtime adapter/plugin loader**. |
| [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) | The `CatalogPort` / `CatalogSnapshot` contract this generator ultimately produces for (`packages/core/src/affects/catalog.ts`). |
| [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) | Adapter isolation: `packages/core`, `packages/cli` and `schema/` import nothing from `packages/adapters/**`; the adapter is versioned independently, its semver contract being with Backstage rather than with `@adrkit/core`. |
| [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md) | The three-rung evidence ladder, its state vocabulary, and its binding honesty rules. |
| [ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md) | No check counts as coverage until it has been **observed failing**. |
| [ADR-0010](../../docs/adr/0010-bun-toolchain.md) | Bun toolchain for development; Node-targeted published artifacts. |
| [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) | Principles I–V. |

**Design input (mechanism only, not authority).** The contracts under
[`specs/009-catalog-binding-viability/contracts/`](../009-catalog-binding-viability/contracts/)
— `input-manifest.md`, `owned-paths-annotation.md`, `glob-dialect.md`, `entity-identity.md`,
`atomic-fail-closed.md`, `snapshot-envelope.md`, `composition-and-release-boundary.md` — already
designed the mechanism this feature implements, and are cited throughout as the source of
specific enumerations and orderings. They are cited as *design input that itself cites the
ADRs*; they are not independent authority.

**Spike 009 was a non-shipping spike, and parts of it are deliberately excluded.** Its B/C/D
comparison heuristics were measurement instruments labelled `non-authoritative` by their own
contract, and ADR-0020 clause 7 states plainly: "No B/C/D comparison heuristic carries into
production." Its evidence-bundle and three-way-verdict machinery are likewise not part of this
feature. ADR-0020 clause 1 holds spike 009 unmodified as a historical record; **nothing in this
feature may edit `specs/009-catalog-binding-viability/**`.**

---

## Overview

This feature builds the minimal viable production slice of a Backstage catalog adapter: a
**standalone offline snapshot generator** that a human or CI invokes directly by name, reads a
vendored or locally-cloned Backstage catalog checkout through **one explicit local input
manifest**, derives each entity's owned repository-relative paths from the
`adrkit.io/owned-paths` annotation **alone**, and writes **only** a versioned
`SnapshotEnvelope`. A separate consumer-side path validates that envelope in full before
anything is derived from it.

It runs offline: no network, no credentials, and no services at runtime.

The generator is **fail-closed as its primary behavior, not as an error path**. Under
ADR-0012's whole-operation atomicity rule a single defective descriptor anywhere in the input
aborts the entire operation with a non-zero exit status and no usable partial output. Under
ADR-0020 clause 3 that outcome is a *success* of the criterion, not a failure of it — provided
the rejection is deterministic, atomic, and correctly classified.

The scope covers eight things, drawn from ADR-0020 clause 7 and spike 009's Output
Recommendation:

1. read one explicit local input manifest bound to a single repository, with
   repository-identity and revision verification against the actual checkout;
2. decode, then validate each descriptor — **admissibility per ADR-0015 before any canonical
   identity is computed**;
3. resolve the three-state ownership discriminator (`explicit-paths` / `explicit-empty` /
   `annotation-absent`) from `adrkit.io/owned-paths` alone;
4. validate every glob against the restricted dialect;
5. compute canonical lowercase entity identity and fail closed on duplicate canonical ids;
6. enforce whole-operation atomicity over a closed enumeration of fatal trigger classes;
7. write **only** the versioned snapshot envelope — never a `CatalogSnapshot`-shaped artifact
   directly;
8. validate an envelope on the consumer side before deriving anything from it, rejecting
   malformed, tampered, stale, and misidentified-repository envelopes.

---

## User Scenarios & Testing *(mandatory)*

User stories are prioritized. Each is independently testable in the sense that it can be
exercised and judged on its own terms with its own fixtures. Two ordering dependencies are
**mandated by ADR-0020 and are not an artifact of this decomposition**: User Story 1 must
complete before any generator output exists at all (clause 6), and User Story 9 can only be
evaluated after generator output exists (clause 5). Those are stated in each story rather than
hidden.

---

### User Story 1 — Freeze and independently audit the ground truth before any generator output exists (Priority: P1) 🎯 MVP prerequisite

As the maintainer, I want the reference oracle and the clause-5 accept corpus — its
maintainer-authored `adrkit.io/owned-paths` overlay, its expected path matches, and its
recorded selection basis and size — frozen, hashed, and independently audited **before a single
byte of generator output exists**, so that the expectations the generator is later measured
against cannot have been shaped, consciously or otherwise, by what the generator actually
produced.

**Why this priority**: ADR-0020 clause 6 makes this a hard precondition, not a preference:
"any future feature-009 execution, and any implementation work deriving from one, begins with a
fresh T014 → T014a cycle — correct the `derivedPathPatterns` ordering, re-freeze, re-hash,
obtain a new independent pre-output audit — *before* producing generator output." ADR-0012
gate 3 is recorded `Unmet` in ADR-0020's gate-status table because spike 009's oracle carries a
known-wrong `derivedPathPatterns` ordering (recorded in input order rather than
`compareCodeUnits`-sorted order). This specification cannot waive that, and does not.

**Independent Test**: Confirm that the frozen oracle and frozen accept-corpus expectation set
each carry a recorded content hash, that each hash was recorded at a point where no
generator-derived artifact existed, that the independent audit was performed by a reviewer with
no authoring involvement in the artifacts under audit, that the audit recomputed and matched
each hash, that it confirmed `derivedPathPatterns` are recorded in `compareCodeUnits`-sorted
order, and that it recorded an **explicit adequacy finding** about the corpus — not merely an
integrity finding.

**Acceptance Scenarios**:

1. **Given** a maintainer-authored reference oracle whose `derivedPathPatterns` are recorded in
   `compareCodeUnits`-sorted order, **When** it is frozen and hashed, **Then** the hash is
   recorded before any generator-derived artifact exists, and the record states that fact
   explicitly.
2. **Given** the frozen oracle, **When** an independent reviewer with no authoring involvement
   audits it, **Then** the reviewer independently recomputes the hash, confirms it matches, and
   records a PASS or FAIL that is its own — not inherited from the T014 freeze step.
3. **Given** an oracle whose `derivedPathPatterns` are recorded in input order rather than
   `compareCodeUnits`-sorted order, **When** the T014a audit runs, **Then** the audit records
   FAIL and no generator output is produced until a corrected oracle is re-frozen, re-hashed and
   re-audited.
4. **Given** the clause-5 accept corpus, its maintainer-authored `adrkit.io/owned-paths`
   overlay, and its expected path matches, **When** they are frozen in the same T014 → T014a
   cycle, **Then** the corpus's **selection basis and size are fixed and recorded in that same
   cycle**, and the audit records an explicit finding that the corpus is **adequate for the
   claim being made** — an audit that passes on integrity without reaching adequacy records
   FAIL.
5. **Given** a stale copy of a previously frozen oracle from spike 009's untracked scratch
   bundle, **When** any generator run is attempted against it, **Then** the run does not count
   toward any gate, because the fresh T014 → T014a cycle is a precondition of generator output
   rather than a step that may be satisfied retrospectively.
6. **Given** the frozen expectation set, **When** any later step would amend it to fit observed
   generator output, **Then** that amendment is prohibited and the gate fails instead (ADR-0020
   clause 5: "the expectations are never amended to fit the output").

---

### User Story 2 — Generate a populated envelope, or fail closed correctly, from one manifest-bound real checkout (Priority: P1) 🎯 MVP

As a maintainer running the adapter against a vendored or locally-cloned Backstage catalog
checkout, I want to invoke the generator by name with exactly one explicit local input
manifest and get **either** a populated, digest-carrying `SnapshotEnvelope` **or** a
deterministic, atomic, correctly-classified fail-closed rejection with no partial output —
never a partial envelope, never a silent skip, and never an entity synthesized to fill a gap.

**Why this priority**: This is the feature's entire value surface, and it is the shape the
rescoped criterion takes. ADR-0020 clause 3 replaced spike-009 SC-010's demand for a populated
envelope from each named pass with: *"each required pass produces either a populated
`SnapshotEnvelope`, or a deterministic, atomic, correctly-classified fail-closed rejection with
no partial output; and at least one pass over a real corpus meeting clause 5's conditions
produces a populated envelope. A correct rejection of a defective corpus satisfies the
criterion. Fabricating an envelope from one never does."*

**Independent Test**: Point the generator at a real checkout via one manifest; run it three or
more times; confirm each run terminates in exactly one of the two permitted outcomes; confirm
repeated runs over identical inputs are byte-identical; confirm that on the rejection path the
process exit status is non-zero and no envelope file — complete or partial — is left on disk.

**Acceptance Scenarios**:

1. **Given** a valid manifest naming a single repository whose `repository.id` and
   `repository.revision` match the actual checkout, and a set of admissible, collision-free
   descriptors, **When** the generator runs, **Then** it writes exactly one populated
   `SnapshotEnvelope` and exits zero.
2. **Given** the same inputs, **When** the generator is run three or more times, **Then** every
   run's output file is byte-identical to every other run's.
3. **Given** a checkout containing at least one descriptor that triggers any fatal class in the
   closed enumeration, **When** the generator runs, **Then** it exits non-zero, writes no
   envelope, leaves no partial or truncated output file, and reports exactly one correctly
   classified trigger class.
4. **Given** a manifest whose `repository.id` or `repository.revision` does not match the values
   read from the actual checkout, **When** the generator runs, **Then** it aborts with
   `repository-mismatch` **before any entity's paths are derived**, and repository identity is
   never read from a descriptor annotation.
5. **Given** a manifest listing a source whose recorded digest does not match the bytes on disk,
   **When** the generator runs, **Then** it aborts with `incomplete-required-source` and no
   entity is processed.
6. **Given** invocation of the generator, **When** its process runs, **Then** it makes no
   network request, reads no credential or bearer-token environment variable, contacts no
   service, and requires none of the above to be present.

---

### User Story 3 — Refuse an inadmissible descriptor before any canonical identity exists (Priority: P1)

As the maintainer, I want each decoded descriptor checked against the pinned Backstage field
formats **before** canonical identity is computed, so that a descriptor whose fields the pinned
validators reject is reported as exactly that — an inadmissible descriptor — and never as a
downstream duplicate-identity condition produced by canonicalizing something that should never
have been canonicalized.

**Why this priority**: ADR-0015 makes admissibility a **precondition** of canonicalization, not
a step inside it, and ADR-0020 clause 7 inherits that as a requirement. Getting the order wrong
produces the specific misdiagnosis ADR-0015 was written to prevent: several unsubstituted
software-template skeleton descriptors in the pinned corpora share one identical placeholder
string, so canonicalizing first reports a `duplicate-canonical-id` for descriptors that a pure
validator predicate had already excluded.

**Independent Test**: Feed the generator descriptors that fail each of the four validator
predicates in ADR-0015's table, plus a descriptor set that would produce a duplicate canonical
id *only if* inadmissible descriptors were canonicalized; confirm the reported trigger class is
`inadmissible-descriptor` in every case, that it names the offending source path, the failing
field, and the rejecting validator, and that no canonical identity was computed for the
offending descriptor.

**Acceptance Scenarios**:

1. **Given** a descriptor whose `metadata.name` is a string the pinned `isValidObjectName`
   predicate returns `false` for, **When** the generator processes it, **Then** the run aborts
   with `inadmissible-descriptor`, and no canonical identity for that descriptor is computed,
   recorded, or emitted.
2. **Given** two descriptors that both carry the same unsubstituted placeholder as
   `metadata.name` — a value the pinned `isValidObjectName` predicate returns `false` for —
   **When** the generator processes them, **Then** the reported trigger class is
   `inadmissible-descriptor` and **not** `duplicate-canonical-id`, because admissibility is
   evaluated first.
3. **Given** a descriptor whose `apiVersion` contains two or more `/` separators, **When** the
   generator processes it, **Then** the run aborts with `inadmissible-descriptor`, because the
   pinned `isValidPrefixAndOrSuffix` binding returns `false` for such a value.
4. **Given** a descriptor whose `apiVersion` contains no separator at all (for example a bare
   `v1`), **When** the generator processes it, **Then** the value is validated against the
   suffix predicate alone, the DNS-subdomain rule is not consulted, and the descriptor is
   admissible on that field.
5. **Given** a descriptor that omits `metadata.namespace` entirely, **When** the generator
   processes it, **Then** the namespace predicate is not applied (it applies only when the field
   is present), and the descriptor is admissible on that field.
6. **Given** a descriptor whose present `metadata.namespace` is a string the pinned
   `isValidNamespace` binding returns `false` for, **When** the generator processes it, **Then**
   the run aborts with `inadmissible-descriptor`.
7. **Given** any inadmissible descriptor anywhere in the input, **When** the generator runs,
   **Then** it is never filtered out, skipped, downgraded to a warning, or excluded so that the
   remaining descriptors can succeed — the whole operation aborts.
8. **Given** a single descriptor whose `metadata.name` is a value the pinned `isValidObjectName`
   predicate returns `false` for but which **canonicalizes uniquely and collides with nothing**
   — the case ADR-0015 identifies in `rhdh-plugins` as `bulk-import` (`${{ values.name }}`) and
   `orchestrator` (`${{ values.entityName }}`) — **When** the generator processes it, **Then** the
   run still aborts with `inadmissible-descriptor`. This is the scenario that proves the class is
   load-bearing rather than redundant: no duplicate rule would catch it, because, as ADR-0015
   records, "[d]uplicate detection is not a validity check."

---

### User Story 4 — Derive ownership from `adrkit.io/owned-paths` alone, with the three states never conflated (Priority: P1)

As a repository owner who has annotated my catalog entities, I want the adapter to derive an
entity's owned paths from the `adrkit.io/owned-paths` annotation and from nothing else, and to
distinguish "I declared these paths," "I declared that I own no paths," and "I declared
nothing" as three separate, never-merged states, so that an absent annotation is never silently
upgraded into an inferred claim of ownership.

**Why this priority**: ADR-0012 makes the annotation the sole authoritative binding and
explicitly forbids inferring ownership from a descriptor's location or its repository root.
Spike 009 measured descriptor-parent and repository-root as labeled heuristics; ADR-0020
clause 7 states those measurement instruments do not carry into production at all.

**Independent Test**: Run fixtures covering all three annotation states and every ordered
decode/validate step; confirm the three states are labeled distinctly in the envelope and no
two are treated as equivalent; confirm each per-pattern rejection reason is distinct and
rule-specific; confirm sorted, deduplicated `derivedPaths` are byte-identical across repeated
runs.

**Acceptance Scenarios**:

1. **Given** a descriptor carrying `adrkit.io/owned-paths` with a valid non-empty JSON array of
   restricted-dialect globs, **When** the generator derives its paths, **Then** its
   `ownershipState` is `explicit-paths` and its `derivedPaths` are the sorted, deduplicated
   patterns.
2. **Given** a descriptor whose annotation value is exactly `[]`, **When** the generator derives
   its paths, **Then** its `ownershipState` is `explicit-empty` with empty `derivedPaths`, and
   it is never conflated with an absent annotation.
3. **Given** a descriptor with no `adrkit.io/owned-paths` annotation at all, **When** the
   generator derives its paths, **Then** its `ownershipState` is `annotation-absent`, its
   `derivedPaths` are empty, and no path is inferred from the descriptor's own location, its
   directory, or the repository root.
4. **Given** an annotation whose YAML value node is not a string scalar — for example a YAML
   sequence — **When** the generator decodes it, **Then** it is rejected with the
   string-scalar-check reason *before* any JSON parse is attempted, so that a value such as
   `["[]"]` cannot be coerced into the string `[]` and misclassified as `explicit-empty`.
5. **Given** an annotation whose string value is not valid JSON, **When** the generator decodes
   it, **Then** it is rejected with the parse-error reason, distinct from the string-scalar and
   shape reasons.
6. **Given** an annotation that parses to valid JSON but is not an array of strings — an object,
   a number, or an array containing a non-string element — **When** the generator validates its
   shape, **Then** it is rejected with the wrong-shape reason.
7. **Given** two descriptors with **distinct** canonical ids whose annotations both include an
   overlapping pattern, **When** the generator derives paths for both, **Then** the run succeeds,
   both entities retain the overlapping pattern in `derivedPaths`, and a file matching it is
   owned by both simultaneously — there is no exclusive winner.
8. **Given** patterns that individually violate each rule in the restricted glob dialect's
   ordered rule list, **When** the generator validates them in isolation, **Then** each is
   classified with its own rule-specific rejection reason, evaluated in the fixed rule order and
   stopping at the first match.

---

### User Story 5 — Abort the whole operation atomically, with a correctly classified trigger (Priority: P1)

As a consumer of the adapter's output, I want a single defective descriptor anywhere in the
input to abort the entire operation with a non-zero status and no usable partial output, so
that I can never be handed a snapshot that silently omits the entities the generator could not
process.

**Why this priority**: ADR-0012 specifies whole-operation atomic fail-closed semantics rather
than per-entity rejection, and ADR-0020 clause 7 inherits it as a requirement. A per-entity
skip would produce exactly the failure mode the envelope's `completeness` fields exist to
prevent: an artifact that looks complete and is not.

**Independent Test**: For each fatal trigger class in the closed enumeration, construct an input
in which exactly one entity triggers exactly that class inside an otherwise wholly valid batch;
confirm the run aborts, that the abort is recorded with that exact trigger class, that no
partial output exists — not even for the valid entities in the same run — and that the check was
**observed failing before it was made to pass** (ADR-0016).

**Acceptance Scenarios**:

1. **Given** an otherwise-valid batch containing exactly one entity that triggers a fatal class,
   **When** the generator runs, **Then** the entire run aborts non-zero and no snapshot is
   produced for any entity in that run.
2. **Given** two descriptors that both canonicalize to the identical canonical id, **When** the
   generator canonicalizes them, **Then** the run aborts with `duplicate-canonical-id` — never a
   first-wins merge, never a last-wins merge, and never two silently coexisting entities.
3. **Given** descriptors whose canonicalized values collide only after case folding, **When**
   the generator canonicalizes them, **Then** the collision is detected and the run aborts,
   because canonicalization lowercases the entire identity string.
4. **Given** a single source file containing two YAML documents that both canonicalize to the
   same canonical id, **When** the generator processes that file, **Then** the run aborts —
   descriptor **files** and entity **documents** are counted separately and a multi-document file
   is not exempt.
5. **Given** a descriptor file containing a duplicate YAML mapping key, **When** the generator
   decodes it, **Then** the run aborts with `duplicate-yaml-key` rather than silently taking
   either the first or the last value.
6. **Given** each distinct fatal trigger class in turn, **When** each is exercised through the
   full pipeline, **Then** the recorded classification is that exact class and not a neighbouring
   one, and each such check was watched failing before it was watched passing.

---

### User Story 6 — Write only the versioned envelope, never a `CatalogSnapshot`-shaped artifact (Priority: P1)

As the maintainer enforcing ADR-0012's persistence rule, I want the generator's only output to
be the versioned `SnapshotEnvelope`, so that no consumer can ever receive an adapter's raw
output as if it were already validated, and so that the interchange format stays a separate
artifact from the in-memory core types.

**Why this priority**: ADR-0020 clause 7 states it in one sentence — "The generator writes the
envelope and nothing else" — and ties it to FR-023: "a `CatalogSnapshot`-shaped artifact is
derived from the envelope only after that envelope independently passes every validation and
digest check."

**Independent Test**: Run the generator to completion on a valid input and enumerate every file
it created or modified; confirm exactly one envelope file and nothing resembling a
`CatalogSnapshot`; confirm the envelope's frozen matcher-contract fields carry the exact
required values; confirm the digest is a SHA-256 over the canonical form of every field except
itself; confirm the digest changes when any covered field changes and does not change when
irrelevant formatting changes.

**Acceptance Scenarios**:

1. **Given** a successful generator run, **When** its filesystem effects are enumerated, **Then**
   exactly one versioned envelope file was written and no `CatalogSnapshot`- or
   `CatalogSnapshotEntity`-shaped artifact was written at all.
2. **Given** a written envelope, **When** its frozen matcher-contract fields are inspected,
   **Then** `schemaVersion`, `globDialect` and `capabilities` carry exactly the required values,
   and `completeness.wholeCatalog` is `false` because the generator reads only manifest-listed
   sources and never walks or globs the tree.
3. **Given** a written envelope, **When** each entity record is inspected, **Then** it carries
   exactly the five defined fields — a nested `identity` of `canonicalId` and `allRefs`,
   `ownershipState`, `derivedPaths`, a serialized `sourceDocument` of `sourcePath` and
   `documentIndexInFile`, and `provenance` — and never a flatter `canonicalId`/`refs`/`paths`
   triple.
4. **Given** a written envelope, **When** its digest is independently recomputed over the
   canonical form, **Then** the recomputed value matches the recorded `digest`, which is 64
   lowercase hexadecimal characters.
5. **Given** two runs over identical inputs, **When** their envelopes are compared byte for byte,
   **Then** they are identical, including the ordering of every array.
6. **Given** an envelope produced from a corpus carrying a maintainer-authored annotation
   overlay, **When** its entity records are inspected, **Then** `provenance` distinguishes
   upstream-authored descriptor content from the maintainer-authored overlay, so that ADR-0020
   clause 5's "only the corpus data is third-party, never the validation" distinction is legible
   from the artifact itself.

---

### User Story 7 — Diff derived ownership against the frozen expectations at zero false positives and zero false negatives (Priority: P1)

As the maintainer preparing the clause-5 release gate, I want the generator's derived ownership
for **every** annotated entity in the frozen accept corpus diffed against the frozen expected
path matches, with any mismatch failing the gate, so that we never mistake a valid self-digest
for semantic correctness.

**Why this priority**: ADR-0020 clause 5 is emphatic: *"A populated, digest-verified envelope
proves integrity, not correctness — a semantically wrong envelope can carry a perfectly valid
self-digest."* It states the reason plainly: spike 009's own oracle was, on its evidence
index's admission, "not an executed test harness" — expectations were frozen and then never
diffed against anything. This story exists to close exactly that gap.

**Ordering**: this story can only be evaluated **after** User Story 1's freeze and audit have
passed and User Story 2 has produced output. That ordering is ADR-0020 clause 5's, which calls
the pre-output freeze/audit and the post-output comparison "**two distinct steps, each
recording its own hashes and its own PASS/FAIL**."

**Independent Test**: Take the frozen expectation set and the generator's envelope; compute the
diff over every annotated entity; confirm zero false positives and zero false negatives;
confirm the comparison step records its own content hashes and its own PASS/FAIL, separate from
the freeze step's; confirm that a deliberately wrong expectation causes FAIL rather than a
silent amendment.

**Acceptance Scenarios**:

1. **Given** the frozen expected path matches and a populated envelope, **When** derived
   ownership for every annotated entity is diffed against the expectations, **Then** the gate
   passes only on zero false positives **and** zero false negatives.
2. **Given** a single derived path present in the output but absent from the frozen
   expectations, **When** the diff runs, **Then** it is recorded as a false positive and the gate
   fails.
3. **Given** a single expected path absent from the output, **When** the diff runs, **Then** it
   is recorded as a false negative and the gate fails.
4. **Given** a failing diff, **When** any attempt is made to amend the frozen expectations so
   that they match the output, **Then** that amendment is rejected and the gate remains failed.
5. **Given** a completed comparison, **When** its record is inspected, **Then** it carries its
   own content hashes and its own PASS/FAIL verdict, distinct from and not inherited from User
   Story 1's freeze/audit record.
6. **Given** a corpus in which every entity is `annotation-absent`, **When** it is offered as
   the clause-5 accept corpus, **Then** it does not satisfy the gate, because it yields a
   populated envelope while exercising no derivation at all.
7. **Given** a wholly synthetic entity set, **When** it is offered as the clause-5 accept
   corpus, **Then** it does not satisfy the gate, because spike 009 already proved that path.

---

### User Story 8 — Validate an envelope in full before deriving anything from it (Priority: P2)

As the consumer that turns an envelope into a `CatalogSnapshot`, I want every validation and
digest check to pass **before** I read a single `derivedPaths` value, so that a malformed,
tampered, stale, or wrong-repository envelope is rejected at the correct step rather than
partially trusted.

**Why this priority**: ADR-0012 requires that any persisted `CatalogSnapshot` require a
validated interchange file first, and ADR-0020 clause 7 inherits FR-023: derivation happens
"only after that envelope independently passes every validation and digest check." It is P2
rather than P1 only because the generator side must exist before there is anything to consume;
the requirement itself is not optional.

**Independent Test**: For each malformation kind, each tamper, a stale revision, and a
wrong-repository envelope, confirm rejection at the specific step that owns that condition, and
confirm no `derivedPaths` value was read before rejection. Confirm the contrasting acceptance
case: a valid envelope for a *different* repository is accepted as a valid envelope and simply
returns no results for this repository's query.

**Acceptance Scenarios**:

1. **Given** an envelope whose bytes are not valid JSON, **When** the consumer validates it,
   **Then** it is rejected at the first validation step and nothing is derived.
2. **Given** an envelope with a missing or wrongly-typed field at any nesting level, **When** the
   consumer validates it, **Then** it is rejected at the shape-completeness step.
3. **Given** an envelope whose `schemaVersion`, `globDialect`, or `capabilities` do not carry the
   exact required values, **When** the consumer validates it, **Then** it is rejected at the
   frozen-matcher-contract step by exact-value comparison, never by a permissive or
   range-tolerant comparison.
4. **Given** an envelope in which any `sources[]` entry's digest is missing, wrongly typed, or
   does not match the actual bytes, **When** the consumer validates it, **Then** it is rejected
   at the source-digest step.
5. **Given** an envelope whose `completeness.identityOnly` is not `false`, **When** the consumer
   validates it, **Then** it is rejected at the completeness step.
6. **Given** an envelope whose payload has been mutated after generation so that its recorded
   `digest` no longer matches its canonical form, **When** the consumer recomputes the digest,
   **Then** the envelope is rejected — and the rejection is reported as detection of accidental
   corruption or naive mutation, never as proof of adversarial tamper-resistance.
7. **Given** an envelope whose `repository.revision` is not exactly equal to the consuming
   checkout's revision, **When** the consumer evaluates staleness, **Then** the envelope is
   rejected on exact inequality, never on a chronological or "newer than" comparison.
8. **Given** an envelope whose `repository.id` does not match the consuming repository, **When**
   the consumer evaluates repository identity, **Then** the envelope is rejected as
   misidentified.
9. **Given** a wholly valid envelope generated for a *different* repository, **When** this
   repository's paths are queried against it, **Then** the envelope is **accepted** as valid and
   the query simply returns no matches — repository isolation is a property of the query, not a
   rejection.
10. **Given** an envelope that passes every validation, digest, staleness and identity check,
    **When** a `CatalogSnapshot`-shaped artifact is derived, **Then** it is derived only at that
    point, and an adapter's raw output is never handed to core directly and unvalidated under
    any composition arrangement.

---

### User Story 9 — Keep the adapter isolated, and build and run it from a clean clone with no network and no credentials (Priority: P2)

As a contributor cloning this repository fresh, I want the adapter's presence to change nothing
about how `packages/core`, `packages/cli` and `schema/` build, and I want the whole tree to
build, typecheck, lint, test and run the generator with network access denied and no credentials
present, so that adapter isolation and the offline guarantee are enforced mechanically rather
than by discipline.

**Why this priority**: ADR-0007 and Constitution Principles II and III make both properties
structural; ADR-0012's gate 4 names "clean-clone / offline / adapter-boundary" evidence
explicitly. It is P2 because it constrains the package rather than producing its value.

**Independent Test**: Introduce a deliberate violation — a dependency edge from `packages/core`
to `packages/adapters/catalog-backstage` — and confirm the isolation check **fails**; remove it
and confirm the check passes. Separately, from a clean clone, install with the committed
lockfile, then with network access actively denied and no credential environment variables set,
run build, typecheck, lint, test, and one generator invocation, and confirm all succeed.

**Acceptance Scenarios**:

1. **Given** a deliberately introduced dependency edge from `packages/core`, `packages/cli`, or
   the `schema/` surface to `packages/adapters/catalog-backstage`, **When** the isolation check
   runs, **Then** it fails — and this failure is observed and kept as a permanent negative case
   before the check is treated as coverage.
2. **Given** the violation removed, **When** the isolation check runs, **Then** it passes, and
   `packages/core`, `packages/cli` and `schema/` import nothing from `packages/adapters/**`.
3. **Given** a clean clone, **When** dependencies are installed with the committed lockfile and
   the repository is then built, typechecked, linted and tested with network access actively
   denied, **Then** every step succeeds without any post-install network access, credential, or
   running service.
4. **Given** the generator invoked in that same network-denied, credential-free environment,
   **When** it runs against a local checkout, **Then** it completes without attempting any
   network access.
5. **Given** the adapter package, **When** its version is inspected relative to `@adrkit/core`,
   **Then** it is versioned independently, its semver contract being with Backstage rather than
   with `@adrkit/core`.
6. **Given** the adapter package, **When** its composition model is inspected, **Then** it is a
   standalone offline generator invoked directly by name, and there is no dynamic runtime
   adapter/plugin loader — not even one restricted to a single statically-known package name.

---

### Edge Cases

- **A descriptor omitting `metadata.namespace`.** Canonicalization substitutes the `default`
  namespace before lowercasing. The namespace validator predicate is not applied, because it
  applies only when the field is present.
- **A descriptor whose only defect is the length of `metadata.name`.** The pinned
  `isValidObjectName` predicate enforces both a character-class pattern and a length bound;
  a name that satisfies the pattern and exceeds the bound is still inadmissible. Being "over 63
  characters" is not the same population as "invalid," and the two must not be conflated.
- **An `apiVersion` with no separator.** Validated against the suffix predicate alone; the
  DNS-subdomain rule is not consulted.
- **An `apiVersion` with two or more separators.** Rejected by the pinned binding.
- **A single descriptor file containing several entity documents.** Descriptor **file** counts
  and entity **document** counts are different quantities. Every check operates per document.
- **An annotation value that is a YAML sequence rather than a string scalar.** Rejected by the
  string-scalar check before `JSON.parse` is reached, so that `["[]"]` cannot be coerced to the
  string `[]` and misread as `explicit-empty`.
- **An annotation array containing an empty-string element.** Rejected by the empty-pattern rule
  in the glob dialect's ordered rules — not silently dropped.
- **Two distinct entities declaring overlapping owned paths.** Permitted. Not a collision. Both
  own the overlapping file; there is no exclusive winner.
- **An entity alias colliding with a different entity's primary canonical id.** A
  `duplicate-canonical-ref` condition, fatal to the whole operation, not acceptable merely
  because the collision involves an alias.
- **A symlink inside the checkout pointing outside it.** The confined-realpath stage fails
  closed; a source path that lexically passes but resolves outside the verified checkout root is
  rejected.
- **A `Location` entity with `spec.targets`.** The targets are never followed. The generator's
  input boundary is the manifest, the manifest-listed digest-verified sources, and the two
  repository-identity values read from the checkout.
- **A checkout with more descriptors than the manifest lists.** The generator does not walk or
  glob the tree, and the envelope therefore never claims whole-catalog completeness.
- **An entirely `annotation-absent` corpus.** Yields a populated envelope, which is valid output,
  but does **not** satisfy ADR-0020 clause 5, because it exercises no ownership derivation.
- **A run that would produce zero entities.** Distinct from a fail-closed abort; must not be
  reported as, or confused with, a rejection.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Package, composition, and boundary

- **FR-001**: The feature MUST deliver exactly one new package at
  `packages/adapters/catalog-backstage/`. Per **ADR-0007** and **ADR-0020 clause 7**, it MUST be
  versioned independently, its semver contract being with Backstage rather than with
  `@adrkit/core`.
- **FR-002**: Per **ADR-0013** and **ADR-0020 clause 7**, the adapter MUST be a **standalone
  offline snapshot generator** that a human or CI invokes directly by name. There MUST be **no
  dynamic runtime adapter/plugin loader of any kind**, and no separate composition host that
  discovers, resolves, or dynamically imports a catalog adapter at runtime — not even one
  restricted to a single statically-known package name.
- **FR-003**: Per **ADR-0007** and **Constitution Principle III**, `packages/core`,
  `packages/cli` and `schema/` MUST import nothing from `packages/adapters/**`, and MUST NOT
  otherwise learn that this adapter exists.
- **FR-004**: The feature MUST NOT change `packages/core/src/affects/**`'s existing matcher
  semantics, the `CatalogPort` / `CatalogSnapshot` / `CatalogSnapshotEntity` type shapes in
  `packages/core/src/affects/catalog.ts`, `packages/core/src/schema/adr.schema.ts`, or the
  published `schema/adr.schema.json` (**ADR-0009**, **ADR-0012**, **Constitution Principle V**).
- **FR-005**: The `SnapshotEnvelope` MUST remain a new, separate artifact. It MUST NOT be added
  as a field on `CatalogSnapshot` or `CatalogSnapshotEntity`, and MUST NOT become part of any
  published schema (**ADR-0012**;
  [`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §1).

#### Input manifest and repository boundary

- **FR-006**: The generator MUST read exactly **one** explicit local input manifest per
  operation, whose schema is **closed**: an unrecognized top-level field is a rejection, not an
  ignored extra
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §1;
  **ADR-0012**).
- **FR-007**: The manifest MUST bind the operation to a **single repository**. Multi-repository
  and federated snapshots are excluded by **ADR-0012**'s single-repository boundary.
- **FR-008**: The generator MUST reject an unsupported manifest schema version, an unsupported
  requested snapshot schema version, and an unrecognized requested capability — three distinct
  manifest-level version/capability rejections
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §2, which
  names them "The Three Manifest-Level Version/Capability Rejections"). Together with
  `incomplete-required-source` (FR-011) these are the four manifest-request-level rejections
  enumerated by
  [`atomic-fail-closed.md`](../009-catalog-binding-viability/contracts/atomic-fail-closed.md) §5.
- **FR-009**: The generator MUST verify the manifest's declared repository identity and revision
  against the **actual checkout**, reading those two values through separate git tooling, and
  MUST abort on any mismatch in either. Repository identity MUST NOT be read from a descriptor
  annotation
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §3;
  **ADR-0012**).
- **FR-010**: Repository-identity comparison MUST be exact string equality on both the
  normalized identity and the revision. A partial match MUST abort.
- **FR-011**: Every manifest-listed source MUST carry a recorded digest, and the generator MUST
  verify each against the bytes on disk before any entity is processed. A missing, wrongly
  typed, or mismatched digest MUST abort with `incomplete-required-source`
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §4).
- **FR-012**: Every manifest-listed source path MUST pass **two stages**: a lexical rejection
  stage (rejecting empty, `.`, `..`, absolute, leading-separator, drive-prefixed, UNC,
  backslash-bearing, traversal-segment-bearing, and NUL-or-control-character paths), and a
  **confined realpath** stage requiring the resolved path to lie beneath the verified checkout
  root. A symlink that escapes the root MUST fail closed
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §4.1).
- **FR-013**: The generator's input boundary MUST be exactly: the manifest, the manifest-listed
  digest-verified sources, and the two repository-identity values read from the checkout. It MUST
  NOT follow a `Location` entity's `spec.targets`, MUST NOT invoke any Backstage processor,
  plugin, or ingestion pipeline, and MUST NOT walk or glob the tree
  ([`input-manifest.md`](../009-catalog-binding-viability/contracts/input-manifest.md) §5).
- **FR-014**: Because FR-013 forbids tree traversal, the envelope MUST always record
  `completeness.wholeCatalog` as `false`. The generator MUST NOT claim whole-catalog
  completeness under any circumstance.

#### Admissibility before canonicalization

- **FR-015**: Per **ADR-0015**, each decoded descriptor MUST be checked for **admissibility
  before any canonical identity is computed**. Admissibility is a precondition of
  canonicalization, not a step inside it, and no canonical identity may be computed, recorded, or
  emitted for an inadmissible descriptor.
- **FR-016**: The admissibility check MUST apply exactly the four field validators in
  **ADR-0015**'s table, pinned to Backstage commit
  `1121a4facd9e321179d0402c3f355e4a649e84d9`, reproduced here from that table:

  | Field | Validator binding | Predicate | Applied |
  |---|---|---|---|
  | `apiVersion` | `isValidApiVersion` → `CommonValidatorFunctions.isValidPrefixAndOrSuffix` | prefix is a DNS **subdomain** (`CommonValidatorFunctions.isValidDnsSubdomain`, ≤253 total, each dot-separated label ≤63); suffix is `/^[a-z0-9A-Z]+$/`, ≤63 | required |
  | `kind` | `isValidKind` | `/^[a-zA-Z][a-z0-9A-Z]*$/`, ≤63 | required |
  | `metadata.name` | `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName` | `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, ≤63 | required |
  | `metadata.namespace` | `isValidNamespace` → `KubernetesValidatorFunctions.isValidNamespace` → `CommonValidatorFunctions.isValidDnsLabel` | `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, ≤63 | **only when present** |

  The warrant for every admissibility outcome is **what the pinned validator predicate returns
  when invoked at that commit**. No requirement here asserts what Backstage as a running system
  accepts, rejects, or orders.
- **FR-017**: Per **ADR-0015**, `isValidPrefixAndOrSuffix` splits on `/` and MUST reject any
  value containing two or more separators; a value with **no** separator MUST be validated
  against the suffix predicate alone, so that a bare `v1` passes without the DNS-subdomain rule
  being consulted.
- **FR-018**: An inadmissible descriptor MUST trigger the fatal whole-operation class
  `inadmissible-descriptor` (**ADR-0015**; **ADR-0020 clause 7**), with **exactly the same
  consequence as every other fatal trigger**: the entire operation aborts with a non-zero exit
  status and no usable partial output (FR-034). ADR-0015 states this directly — an inadmissible
  descriptor "aborts the entire operation with a non-zero status and no usable partial output,
  under a new, distinct trigger class `inadmissible-descriptor`." It MUST NOT be filtered,
  skipped, excluded from the input set, treated as a non-entity, downgraded to a warning, or set
  aside so the remainder of the batch can succeed; ADR-0015 is explicit that the record "adds a
  failure *class*; it removes no failure. Every condition that aborts a run today still aborts a
  run."
- **FR-019** *(consequence of FR-015 + FR-018)*: Because admissibility precedes canonicalization
  and an inadmissible descriptor is never canonicalized, **no inadmissible descriptor may
  participate in a uniqueness comparison** (**ADR-0015**, "Ordering"). It is neither compared for
  identity nor silently dropped: it aborts the run.
- **FR-020**: The `inadmissible-descriptor` record MUST identify **all three** of the offending
  source path, the failing field, and the validator that rejected it (**ADR-0015**, "Failure
  semantics"), and MUST be distinguishable from `duplicate-canonical-id`. Per ADR-0015,
  `duplicate-canonical-id` retains its exact meaning — "two or more **admissible** descriptors
  canonicalizing to the same identity" — so a descriptor set that would collide only after
  canonicalizing an inadmissible descriptor MUST be reported as `inadmissible-descriptor`, "the
  earlier and more specific defect." This narrows what `duplicate-canonical-id` reports; it makes
  neither condition non-fatal.
- **FR-021** *(why FR-018 is load-bearing, not redundant)*: The implementation MUST NOT treat
  duplicate detection as a proxy for validity. ADR-0015 records that of the sixteen unsubstituted
  placeholder descriptors in the pinned corpora, the two in `rhdh-plugins` carrying
  `${{ values.name }}` (`bulk-import`) and `${{ values.entityName }}` (`orchestrator`)
  "canonicalize distinctly" and, "[b]eing canonically distinct, they collide with nothing. They
  are exactly as invalid as the other fourteen, and the contract has no mechanism of any kind that
  would notice." ADR-0015 concludes: "The duplicate rule catches the fourteen only incidentally,
  as a side effect of their sharing a string; behind it there is nothing. Duplicate detection is
  not a validity check." Accordingly, conformance evidence MUST include at least one descriptor
  that is inadmissible **and** canonically unique, demonstrating that `inadmissible-descriptor`
  fires where no duplicate rule would.

#### Canonical identity

- **FR-022**: Canonicalization MUST proceed in exactly two steps: if `metadata.namespace` is
  omitted, substitute the `default` namespace; then lowercase the **entire** identity string
  ([`entity-identity.md`](../009-catalog-binding-viability/contracts/entity-identity.md) §1;
  **ADR-0012**).
- **FR-023**: Canonical identity MUST be globally unique across the operation, evaluated over
  every ref an entity carries, not only its primary id. Identical canonical ids MUST abort with
  `duplicate-canonical-id`; an alias colliding with a different entity's primary id, and a
  case-only variant of such a collision, MUST abort with `duplicate-canonical-ref`; a duplicate
  YAML mapping key MUST abort with `duplicate-yaml-key`
  ([`entity-identity.md`](../009-catalog-binding-viability/contracts/entity-identity.md) §3).
  First-wins and last-wins merges are forbidden.
- **FR-024**: Overlapping owned paths between **distinct** canonical ids MUST NOT be treated as a
  collision. There is no exclusive winner: every entity whose patterns match a given path MUST be
  returned
  ([`entity-identity.md`](../009-catalog-binding-viability/contracts/entity-identity.md) §4;
  **ADR-0012**).

#### Ownership derivation

- **FR-025**: Owned paths MUST be derived from the `adrkit.io/owned-paths` annotation **alone**
  (**ADR-0012**). The generator MUST NOT infer ownership from a descriptor's own location, its
  parent directory, the repository root, or any other signal.
- **FR-026**: The annotation MUST be decoded and validated in a fixed order, each step producing
  its own distinct rejection reason
  ([`owned-paths-annotation.md`](../009-catalog-binding-viability/contracts/owned-paths-annotation.md)
  §1): (1) presence check; (2) **string-scalar check** on the raw YAML node, performed **before**
  any JSON parse; (3) JSON parse; (4) shape check requiring exactly an array of strings; (5)
  per-pattern glob validation.
- **FR-027**: Step 2 of FR-026 is load-bearing and MUST NOT be reordered or omitted: because
  `JSON.parse` coerces its argument via `ToString`, a non-string YAML node such as a sequence
  containing `[]` would otherwise be silently coerced and misclassified as `explicit-empty`.
- **FR-028**: The generator MUST resolve exactly three ownership states — `explicit-paths`,
  `explicit-empty`, and `annotation-absent` — and MUST record the resolved state in the envelope.
  No two of the three may be conflated, and an absent annotation MUST NOT be treated as
  equivalent to an explicitly empty one
  ([`owned-paths-annotation.md`](../009-catalog-binding-viability/contracts/owned-paths-annotation.md)
  §3; **ADR-0012**).

#### Restricted glob dialect

- **FR-029**: Every derived pattern MUST be validated against the restricted glob dialect, whose
  engine and options are **frozen**: `picomatch`, at the exact version resolved in the
  repository's committed `bun.lock`, with options `{ dot: false, nocase: false, nonegate: true }`
  ([`glob-dialect.md`](../009-catalog-binding-viability/contracts/glob-dialect.md) §1;
  **ADR-0012**). At this document's writing `bun.lock` resolves `picomatch@4.0.5`; the frozen
  value is the lockfile's resolution, which the implementation MUST record in the envelope's
  `globDialect` and MUST verify rather than assume.
- **FR-030**: Pattern validation MUST apply the **fifteen** ordered rules of
  [`glob-dialect.md`](../009-catalog-binding-viability/contracts/glob-dialect.md) §3 in that
  exact order, stopping at the first match, producing the fifteen distinct rejection reasons that
  section defines, or `accepted`. Counted from that section's numbered list. The final rule is
  the engine compile, whose compile failure is a defensive backstop rather than the primary
  gate.
- **FR-031**: A pattern's rejection reason MUST be rule-specific. A batch containing several
  distinct violations MUST classify each individually when each is validated in isolation, while
  a mixed batch in one operation still aborts the whole operation per FR-034.
- **FR-032**: Each accepted pattern MUST be compiled once per run and reused, so that validation
  and matching cannot diverge
  ([`glob-dialect.md`](../009-catalog-binding-viability/contracts/glob-dialect.md) §6).
- **FR-033**: `derivedPaths` MUST be sorted with `compareCodeUnits` and deduplicated, so that the
  envelope's array ordering is a function of content alone.

#### Whole-operation atomic fail-closed

- **FR-034**: Any fatal trigger MUST abort the **entire operation** with a non-zero process exit
  status and **no usable partial output** — not even for the otherwise-valid entities in the same
  run (**ADR-0012**;
  [`atomic-fail-closed.md`](../009-catalog-binding-viability/contracts/atomic-fail-closed.md)).
  Per-entity rejection is forbidden.
- **FR-035**: The enumeration of fatal trigger classes MUST be **closed**. It comprises the
  **fourteen** values enumerated by
  [`atomic-fail-closed.md`](../009-catalog-binding-viability/contracts/atomic-fail-closed.md) §4
  — `duplicate-canonical-id`, `duplicate-canonical-ref`, `duplicate-yaml-key`,
  `invalid-yaml-syntax`, `invalid-manifest-shape`, `invalid-annotation-shape`,
  `invalid-annotation-parse`, `invalid-pattern`, `unsupported-manifest-version`,
  `unsupported-snapshot-version`, `unsupported-capability`, `repository-mismatch`,
  `incomplete-required-source`, `other-invalid-input` (counted from that section's own list,
  which requires the value be "one of exactly these fourteen values") — **plus**
  `inadmissible-descriptor`, which **ADR-0015** adds as a distinct fatal class. **That is
  fifteen classes for this feature.**

  The authority for the fifteenth is **ADR-0015's Condition of Acceptance 2**, whose preamble
  states that its three conditions "were attached at ratification and are binding on any work
  that cites this record." Condition 2 requires that "the follow-up must carry
  `inadmissible-descriptor` onto the atomic surfaces," that "[a]dding the class to the identity
  contract alone is insufficient," and that the atomic-fail-closed and data-model surfaces "must
  both name it as a fatal whole-operation trigger, or the fail-closed guarantee ADR-0012 pins is
  described in one place and not another." **This feature is that follow-up**, so the obligation
  binds here directly rather than by inheritance alone; **ADR-0020 clause 7** independently
  carries the same requirement forward.

  `inadmissible-descriptor` does not appear anywhere under
  `specs/009-catalog-binding-viability/`. ADR-0015 is its only source, and the implementation
  MUST take it from there. The number **fourteen** is correct for spike 009 and **wrong for this
  feature**; it MUST NOT be copied across.
- **FR-036**: `other-invalid-input` MUST remain a deliberate always-present backstop, never a
  substitute for a more specific class that applies.
- **FR-037**: Each abort MUST record exactly one trigger class, and that class MUST be the
  correct one — not a neighbouring class that happens to also be reachable.

#### Envelope output

- **FR-038**: The generator MUST write **only** the versioned `SnapshotEnvelope`. It MUST NOT
  write a `CatalogSnapshot`-shaped artifact directly, under any circumstance (**ADR-0020
  clause 7**: "The generator writes the envelope and nothing else").
- **FR-039**: The envelope MUST carry the fields defined by
  [`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §1 —
  `schemaVersion`, `repository`, `generatorVersion`, `globDialect`, `capabilities`,
  `completeness`, `sources`, `entities`, `digest` — and each `entities[]` record MUST carry
  exactly the five defined fields: a nested `identity` of `{ canonicalId, allRefs }`,
  `ownershipState`, `derivedPaths`, a serialized `sourceDocument` of
  `{ sourcePath, documentIndexInFile }`, and `provenance`. A flatter `canonicalId` / `refs` /
  `paths` triple MUST NOT be emitted.
- **FR-040**: The envelope's `digest` MUST be a SHA-256 over the **canonical form** of every
  field except `digest` itself — recursive key sort by `compareCodeUnits`, arrays preserved in
  declaration order, compact separators, `undefined` omitted — rendered as 64 lowercase
  hexadecimal characters
  ([`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §3).
- **FR-041**: Every claim made about the digest MUST be scoped to **detection of accidental
  corruption and naive mutation only**. Neither the implementation, its documentation, nor any
  evidence produced under this feature may claim adversarial tamper-resistance
  ([`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §3).
- **FR-042**: Identical inputs MUST produce **byte-identical** output across repeated runs,
  including array ordering and serialization details (**ADR-0012**; **Constitution
  Principle IV**).
- **FR-043**: `provenance` MUST distinguish upstream-authored descriptor content from
  maintainer-authored annotation overlay, so that **ADR-0020 clause 5**'s "only the corpus data
  is third-party, never the validation" boundary is legible from the artifact.

#### Consumer-side validation before derivation

**Where the consumer lives.** The envelope validator and `CatalogSnapshot`
deriver live in their **own workspace package**, separate from both the adapter
and `@adrkit/core` — working name `@adrkit/catalog-envelope`. Three constraints
converge on that placement and none of them is satisfied by any other home:

- It is **not** the adapter. **ADR-0020** clause 7 states "the generator writes
  the envelope and nothing else."
- It is **not** `@adrkit/core` or `@adrkit/cli`. **ADR-0007** and Constitution
  Principle III keep them from learning an adapter exists, and
  [`composition-and-release-boundary.md`](../009-catalog-binding-viability/contracts/composition-and-release-boundary.md)
  §2 says they "receive only an already-validated `CatalogSnapshot`-shaped
  artifact" — an artifact they consume, not a format they parse.
- It is **not** `schema/`. **ADR-0012** and FR-005 keep the envelope out of the
  published schema, which is `schema/adr.schema.json`, the canonical ADR JSON
  Schema hosted at its `$id` per **ADR-0011**. That constraint is about the ADR
  schema specifically and is unaffected by a separate package validating
  envelopes.

Constitution Principle III permits this directly: `@adrkit/core` and
`@adrkit/cli` "MUST depend only on the filesystem, **their own workspace
packages**, and a small set of vetted, deterministic, network-free,
credential-free public libraries." A sibling workspace package is an explicitly
permitted dependency, and because it sits outside `packages/adapters/**` the
`core-has-no-adapter-deps` check is satisfied by construction rather than by
exception.

- **FR-044**: The envelope validator and `CatalogSnapshot` deriver MUST live in a
  workspace package that is **not** under `packages/adapters/**`, MUST NOT import
  from any adapter, and MUST NOT add the envelope to `schema/adr.schema.json`.
  The adapter MUST NOT depend on it, and it MUST NOT depend on the adapter — the
  envelope file is the only interface between them, exactly as
  `composition-and-release-boundary.md` §2 requires. Its dependency direction and
  its absence from `packages/adapters/**` MUST both be enforced by the
  dependency-graph check, each observed failing first (**ADR-0016**).

- **FR-045**: Before deriving anything from an envelope, the consumer MUST apply the **five**
  validation steps of
  [`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §2 in
  order, each mapping one-to-one to a malformation kind (counted from that section's numbered
  list): (1) valid JSON; (2) complete shape at every nesting level; (3) frozen matcher contract
  by **exact value** — `schemaVersion`, `globDialect`, `capabilities`; (4) every `sources[]`
  digest present, correctly typed, and matching the actual bytes; (5)
  `completeness.identityOnly === false`.
- **FR-046**: Only after all five validation steps pass may the consumer proceed to digest
  verification, then staleness evaluation, then repository-identity evaluation. No
  `derivedPaths` value may be read before all of those pass.
- **FR-047**: Staleness MUST be evaluated as **exact inequality** of revision, never as a
  chronological or "newer than" comparison
  ([`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §4).
- **FR-048**: An envelope whose `repository.id` does not match the consuming repository MUST be
  rejected as misidentified
  ([`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §5).
  Distinctly, a **valid** envelope for a different repository MUST be **accepted** as valid, with
  repository isolation expressed as the query returning no matches — isolation is a property of
  the query, not a rejection
  ([`snapshot-envelope.md`](../009-catalog-binding-viability/contracts/snapshot-envelope.md) §6).
- **FR-049**: A `CatalogSnapshot`-shaped artifact MUST be derived from the envelope **only after**
  that envelope independently passes every validation and digest check (**ADR-0020 clause 7**,
  inheriting FR-023 of spike 009). An adapter's raw output MUST NOT be handed to core directly
  and unvalidated under any composition arrangement.

#### Environment and toolchain

- **FR-050**: A clean clone MUST build, typecheck, lint, and test green. Network access is
  permitted **only** during dependency installation with the committed lockfile; after install
  there MUST be no network access, no credential, and no running service required by build, test,
  or generator invocation (**Constitution Principle II**; **ADR-0007**).
- **FR-051**: Development MUST use the Bun toolchain, and any published artifact MUST target
  Node and be smoke-tested under Node, not only under Bun (**ADR-0010**). This requirement
  constrains the artifact's shape; it does not authorize publishing it (see Out of Scope).
- **FR-052**: The generator MUST require no network, no credential, and no service at runtime,
  and MUST NOT degrade to a networked path when one is available.

#### Evidence, gates, and honesty

- **FR-053**: Per **ADR-0020 clause 6**, work MUST begin with a fresh T014 → T014a cycle:
  correct the `derivedPathPatterns` ordering to `compareCodeUnits`-sorted order, re-freeze,
  re-hash, and obtain a new independent pre-output audit — **before producing generator output**.
  This specification does not waive it and cannot.
- **FR-054**: Per **ADR-0020 clause 5**, the accept corpus, its maintainer-authored
  `adrkit.io/owned-paths` overlay, its expected path matches, and its **selection basis and size**
  MUST be frozen and independently audited within that same T014 → T014a cycle, before any
  generator output. The audit MUST record an **explicit finding that the corpus is adequate for
  the claim being made**; an audit that passes on integrity without reaching adequacy does not
  satisfy the clause.
- **FR-055**: Per **ADR-0012** — "production limits are **not** guessed now; they must be
  ratified from evidence" — and **ADR-0020 clause 5**, **no minimum entity count may be invented
  by this specification or by the implementation**. Adequacy is the independent auditor's
  recorded judgement against the frozen corpus.
- **FR-056**: Per **ADR-0020 clause 5**, after generator output exists, derived ownership for
  **every** annotated entity MUST be diffed against the frozen expectations and MUST match with
  **zero false positives and zero false negatives**. Any mismatch fails the gate. The
  expectations MUST NOT be amended to fit the output.
- **FR-057**: The pre-output freeze/audit (FR-053, FR-054) and the post-output comparison
  (FR-056) MUST be recorded as **two distinct steps, each recording its own hashes and its own
  PASS/FAIL** (**ADR-0020 clause 5**). Neither may inherit the other's verdict.
- **FR-058**: A populated, digest-verified envelope MUST be reported as evidence of **integrity,
  not correctness**. No document or artifact produced under this feature may present a valid
  self-digest as evidence that the derived ownership is semantically right (**ADR-0020
  clause 5**).
- **FR-059**: Per **ADR-0016**, no check counts as coverage until it has been **observed
  failing**, and the failing input MUST be retained as a permanent negative case. This applies to
  the adapter-isolation check (FR-003), every fatal trigger class (FR-035), every consumer
  validation step (FR-045), and the clause-5 CI gate (FR-060).
- **FR-060**: Per **ADR-0020 clause 8**, clause 5 MUST get an **executable CI gate tied to
  release**, observed failing first. ADR-0020's own frontmatter assertion is **currently inert**:
  its `engine: custom` resolves through an optional registry port, and with no port registered
  the evaluator returns `status: 'inert'`, `reason: 'assertions-compile.engine-absent'`. It
  records the rule; it does not enforce it. This specification MUST NOT treat that assertion as
  enforcement.
- **FR-061**: Per **ADR-0020 clause 7**, **no B/C/D comparison heuristic** from spike 009 carries
  into production. Descriptor-parent, repository-root, and identity-only normalization MUST NOT
  appear in the adapter as inferred, authoritative, default, or opt-in ownership behavior.
- **FR-062**: Per **ADR-0020**'s closing paragraph and **ADR-0014**, this work is authorized
  toward **rung 1 only**. Neither the package, its documentation, its tests, nor any evidence it
  produces may claim reference-verified (rung 2) or externally validated (rung 3) status. Where
  maintainer-owned verification occurs, it MUST NOT be described as external, third-party, or
  community adoption; only corpus **data** may be called third-party.
- **FR-063**: Per **ADR-0012**'s "heuristics are not defaults" rule and **ADR-0020 clause 5**,
  the adapter's documentation MUST state that adoption of `adrkit.io/owned-paths` by anyone other
  than the maintainer is neither established nor gated by this feature.

### Key Entities

- **Input Manifest**: The single, closed-schema, local file that binds one operation to one
  repository, declares the requested snapshot schema version and capabilities, and lists every
  source with its digest. The generator reads nothing outside it except the two repository
  identity values read from the checkout.
- **Descriptor Document**: One entity document decoded from one source file. A source **file**
  may contain several **documents**; these are different quantities and every check operates per
  document.
- **Admissibility Result**: The outcome of applying ADR-0015's four pinned validator predicates
  to a decoded descriptor, computed **before** any canonical identity exists.
- **Canonical Entity Identity**: The fully lowercased `kind:namespace/name` string, with the
  `default` namespace substituted when `metadata.namespace` is absent. Globally unique across the
  operation, evaluated over every ref.
- **Ownership State**: One of exactly three values — `explicit-paths`, `explicit-empty`,
  `annotation-absent` — resolved from `adrkit.io/owned-paths` alone and never conflated.
- **Derived Paths**: The sorted, deduplicated restricted-dialect glob patterns an entity declares
  it owns. Non-empty only in the `explicit-paths` state.
- **Fatal Trigger Class**: One member of the closed enumeration in FR-035. Exactly one is
  recorded per aborted operation.
- **Snapshot Envelope**: The generator's only output. A versioned interchange artifact carrying
  the frozen matcher contract, source digests, entity records, and a self-digest. Separate from
  `CatalogSnapshot` and never part of any published schema.
- **Frozen Expectation Set**: The maintainer-authored accept-corpus overlay, its expected path
  matches, and its recorded selection basis and size — frozen, hashed and independently audited
  before generator output exists, and never amended afterwards.

### Out of Scope

The following are explicitly excluded and MUST NOT be introduced by this feature:

- **Release authorization of any kind**, and any publish target, npm package name, version tag,
  distribution channel, publish trigger, release date, or change to `.github/workflows/**` that
  would effect one. ADR-0020 clause 9 defers both the release vehicle and the decision to release
  at all to a later record.
- Any claim, anywhere in the package or its documentation, of **ADR-0014 rung 2 or rung 3** —
  reference-verified, externally validated, adopted, or sustained adoption.
- Any claim that this feature clears ADR-0012 gate 3, or that the clause-5 gate is met, in
  advance of the two distinct recorded steps (FR-053 through FR-057) actually passing.
- **Spike 009's B/C/D comparison heuristics** (descriptor-parent, repository-root,
  identity-only), in any form — including as an opt-in, labeled, or diagnostic mode.
- Spike 009's **evidence-bundle and three-way-verdict machinery** (`go-explicit` /
  `no-go` / `blocked`), its `NonBindingRecommendation`, and its scale-and-security measurement
  apparatus.
- Any edit to `specs/009-catalog-binding-viability/**`, which ADR-0020 clause 1 holds unmodified
  as a historical record, or to any ADR.
- A dynamic runtime adapter or plugin loader of any kind (**ADR-0013**).
- Any call to a live Backstage API, catalog backend, discovery processor, or ingestion pipeline;
  any bearer token, API key, or credential; any catalog mutation, synchronization, or write-back.
- Following a `Location` entity's `spec.targets` to read a file outside the input manifest.
- Multi-repository or federated snapshots.
- Cryptographic signing, attestation, or any adversarial tamper-resistance mechanism for the
  envelope. The digest's guarantee is scoped to accidental corruption and naive mutation only,
  and strengthening it is a separate, later decision this feature does not make.
- Network-verified repository provenance. Repository identity is verified against the local
  checkout only.
- Any change to `packages/core/src/affects/**` matcher semantics, to the
  `CatalogPort`/`CatalogSnapshot` type shapes, or to the ADR schema.
- Guessing or ratifying a production scale limit, entity-count floor, or performance budget from
  this feature's evidence alone.
- Any assertion about what Backstage as a running system accepts, rejects, orders, or tolerates.
  Warrants are limited to what a pinned validator predicate returns when invoked.

---

## Success Criteria *(mandatory)*

> **Numbering caution.** The `SC-0NN` identifiers below are **local to this document**. Spike
> 009 has its own separately-numbered success criteria, and ADR-0020 clause 3 rescopes *spike
> 009's* SC-010. Every reference to that rescope is written out in full as **spike 009's
> SC-010** to prevent collision with this document's own SC-010.

### Measurable Outcomes

- **SC-001** *(determinism)*: Running the generator three or more times over identical inputs
  produces byte-identical output on every run, including every array's ordering — on the accept
  path and on the reject path alike.

- **SC-002** *(whole-operation atomicity)*: Introducing exactly one entity that triggers a fatal
  class into an otherwise wholly valid batch causes the entire operation to abort with a non-zero
  exit status and no usable partial output — not even for the valid entities in the same run — in
  every tested case.

- **SC-003** *(closed trigger enumeration, each observed failing)*: Every fatal trigger class in
  FR-035's closed enumeration is exercised through the full pipeline, each recorded with its own
  exact classification rather than a neighbouring one, and each check is **observed failing before
  it is observed passing**, with the failing input retained as a permanent negative case
  (**ADR-0016**).

- **SC-004** *(admissibility precedes canonicalization)*: For every descriptor that any of
  ADR-0015's four pinned validator predicates returns `false` for, the recorded trigger class is
  `inadmissible-descriptor`, no canonical identity for that descriptor is computed or emitted,
  and a descriptor set that would collide only after canonicalizing an inadmissible descriptor is
  never reported as `duplicate-canonical-id`. The exercised set includes **at least one
  inadmissible descriptor that canonicalizes uniquely and collides with nothing** (FR-021), so
  the criterion cannot be satisfied by a duplicate rule firing incidentally; and each
  `inadmissible-descriptor` record carries all three of the offending path, the failing field,
  and the rejecting validator (FR-020).

- **SC-005** *(three states never conflated)*: Across a fixture set containing all three
  ownership states, each entity's recorded `ownershipState` is exactly one of `explicit-paths`,
  `explicit-empty`, `annotation-absent`; no two are treated as equivalent; and no path is ever
  derived for an `annotation-absent` entity.

- **SC-006** *(annotation decode order)*: Each of the annotation's ordered decode/validate steps
  produces its own distinct rejection reason when violated in isolation, and a non-string YAML
  node is rejected by the string-scalar check **before** any JSON parse is attempted.

- **SC-007** *(glob dialect)*: Each of rules 1–14 in
  [`glob-dialect.md`](../009-catalog-binding-viability/contracts/glob-dialect.md) §3's fifteen
  ordered rules is exercised by at least one pattern that violates that rule and no earlier one,
  each yielding its own rule-specific rejection reason; rule 15's `accepted` outcome is exercised
  by valid patterns. Rule 15's `invalid-glob-compile-failure` reason is **not** required to be
  exercised: that contract calls it a defensive backstop "expected to never occur in practice,
  given rules 1–14's exhaustiveness," so a run that never produces it is conformant and MUST NOT
  be reported as a coverage gap. The envelope's recorded `globDialect` matches the engine and
  options actually used, verified rather than assumed.

- **SC-008** *(repository boundary)*: A repository-identity or revision mismatch between the
  manifest and the actual checkout aborts before any entity's paths are derived, in every tested
  case; repository identity is never read from a descriptor annotation; and a source path that
  lexically passes but resolves outside the verified checkout root fails closed.

- **SC-009** *(the rescoped criterion — spike 009's SC-010, per **ADR-0020 clause 3**)*: Each
  required pass produces **either** a populated `SnapshotEnvelope` **or** a deterministic, atomic,
  correctly-classified fail-closed rejection with no partial output; **and** at least one pass
  over a real corpus meeting ADR-0020 clause 5's conditions produces a **populated** envelope. A
  correct rejection of a defective corpus satisfies this criterion; fabricating an envelope from
  one never does. This is the criterion **as rescoped by ADR-0020 clause 3** — spike 009's
  original SC-010, which required a populated envelope from each of its three named passes, was
  unsatisfiable under FR-001's frozen inputs, and ADR-0020 clause 2 locates that defect in the
  criterion rather than in the generator, in ADR-0012's fail-closed contract, in ADR-0015's
  admissibility rule, or in the pinned field-format model.

- **SC-010** *(clause 5 step (a) — pre-output freeze and independent audit)*: Before any
  generator output exists, the accept corpus, its maintainer-authored `adrkit.io/owned-paths`
  overlay, its expected path matches, and its recorded selection basis and size are frozen and
  hashed; an independent reviewer with no authoring involvement recomputes and matches those
  hashes, confirms `derivedPathPatterns` are recorded in `compareCodeUnits`-sorted order, and
  records an **explicit adequacy finding**. This step records **its own** hashes and **its own**
  PASS/FAIL. An audit that passes on integrity without reaching adequacy is a FAIL.

- **SC-011** *(clause 5 step (b) — post-output comparison at zero FP / zero FN)*: After generator
  output exists, derived ownership for **every** annotated entity in the frozen accept corpus is
  diffed against the frozen expectations and matches with **zero false positives and zero false
  negatives**. Any mismatch fails the gate. The expectations are never amended to fit the output.
  This step records **its own** hashes and **its own** PASS/FAIL, inherited from nothing.

- **SC-012** *(integrity is not correctness)*: No artifact, report, or document produced under
  this feature presents a populated, digest-verified envelope as evidence of semantic
  correctness. Every such claim is scoped to integrity, and correctness is claimed only on the
  strength of SC-011.

- **SC-013** *(envelope-only output)*: On every successful run, exactly one versioned envelope
  file is written and no `CatalogSnapshot`- or `CatalogSnapshotEntity`-shaped artifact is written
  by the generator; each entity record carries exactly the five defined fields; and the recorded
  digest matches an independent recomputation over the canonical form.

- **SC-014** *(consumer rejection and isolation)*: Each of the five ordered consumer validation
  steps rejects at its own step for its own malformation kind; a mutated envelope is rejected on
  digest recomputation; an envelope whose revision is not exactly equal to the consuming
  checkout's is rejected on exact inequality; an envelope whose repository id does not match is
  rejected as misidentified; and — as the contrasting acceptance case — a **valid** envelope for a
  different repository is accepted, with the query simply returning no matches. In every rejection
  case, no `derivedPaths` value was read before rejection.

- **SC-015** *(adapter isolation, observed failing first)*: A deliberately introduced dependency
  edge from `packages/core`, `packages/cli`, or the `schema/` surface to
  `packages/adapters/catalog-backstage` causes the isolation check to **fail**; that failure is
  observed and retained as a permanent negative case; and with the edge removed the check passes.

- **SC-016** *(clean clone, offline, credential-free)*: From a clean clone, after dependency
  installation with the committed lockfile, the repository builds, typechecks, lints and tests
  green and one generator invocation completes successfully with network access **actively
  denied** — not merely "no network calls happened to occur" — and with no credential or
  bearer-token environment variable set.

- **SC-017** *(rung honesty)*: No file in `packages/adapters/catalog-backstage/`, and no document
  produced by this feature, claims reference-verified, externally validated, adopted, or sustained
  adoption status; and no maintainer-owned verification performed under this feature is described
  as external, third-party, or community adoption.

---

## Assumptions and Risks

- **A1 — This feature has produced no evidence.** At this document's writing there is no
  `packages/adapters/catalog-backstage/` package, no generator run, no envelope, and no observed
  failing check. Every behavioral statement above is a requirement, not a report.

- **A2 — ADR-0012 gate 3 is open, and this feature does not waive it.** ADR-0020's own gate-status
  table records gate 3 as `Unmet`: spike 009's reference oracle carries a known-wrong
  `derivedPathPatterns` ordering, recorded in input order rather than `compareCodeUnits`-sorted
  order. ADR-0020 clause 6 requires a fresh T014 → T014a cycle before any generator output. That
  cycle is carried forward here as FR-053 and User Story 1, not resolved by this document. ADR-0015's
  Condition of Acceptance 1 notes the spike's scratch bundle is untracked, so nothing in the
  repository mechanically prevents reuse of a stale oracle copy; the control is the repeated
  clause, and this document repeats it.

- **A3 — Adoption of `adrkit.io/owned-paths` is not established and is not gated here.** ADR-0020
  records that "Of 156 `community-plugins` descriptor files, 23 carry any `metadata.annotations`
  and **zero** carry `adrkit.io/owned-paths`," and that "no third-party descriptor in the pinned
  corpora uses it." ADR-0020 draws the consequence itself: "against these two corpora a future
  adapter would derive no owned paths at all, because neither corpus carries the annotation;
  whether that generalizes to catalogs beyond the pin is not established here, and this record
  does not assert it." The adapter's real-world value is therefore contingent on adopter uptake,
  which this feature does not and cannot establish. ADR-0014 forbids treating external adoption
  as a blocker, and ADR-0012 gate 3 — as quoted by ADR-0020 — calls it "welcome as an optional
  later production-maturity signal … **not** a hard gate." This is recorded as a standing risk,
  not a solved problem.

- **A4 — Neither pinned corpus qualifies as the clause-5 accept corpus as it stands.** ADR-0020
  clause 5 requires the accept corpus to be admissible under ADR-0015 and free of duplicate
  canonical ids. Spike 009's evidence index records that `community-plugins` at its pinned commit
  contains seven descriptors whose `metadata.name` the pinned `isValidObjectName` predicate
  returns `false` for (five on character class, two on length alone), and `rhdh-plugins` contains
  eleven (all on character class); ADR-0015 records sixteen unsubstituted software-template
  skeleton descriptors across the two corpora — five in `community-plugins` and eleven in
  `rhdh-plugins` — carrying **three** distinct placeholder forms, of which fourteen share one
  identical string and therefore collide. ADR-0020's Context additionally records a fully
  admissible duplicate pair in `community-plugins`. The accept corpus's identity, construction and
  selection basis are therefore **deliberately not fixed by this document**: ADR-0020 clause 5
  assigns them to the T014 → T014a cycle, "fixed and recorded in that same cycle, not chosen
  afterwards." ADR-0020's own Consequences section contemplates that no qualifying corpus may be
  identifiable or constructible, and names that as a revisit trigger.

- **A5 — Descriptor file counts and entity document counts are different quantities.** Spike 009's
  evidence index records 156 files / 167 entity documents for `community-plugins` and 38 files /
  39 entity documents for `rhdh-plugins`, and notes that the 38/39 figure holds only for an exact
  `catalog-info.yaml` basename match — a looser path-suffix match over-counts. Any count this
  feature records MUST state which quantity it is counting and how it was matched.

- **A6 — The frozen glob engine version is the lockfile's resolution, not a declared range.**
  `packages/core/package.json` declares `picomatch` as a range; the frozen value is what
  `bun.lock` resolves, which at this document's writing is `picomatch@4.0.5`. The implementation
  MUST read and record the actual resolved version rather than trust this document's
  transcription of it.

- **A7 — The digest's guarantee is narrow.** It detects accidental corruption and naive mutation.
  It is not an adversarial tamper-resistance mechanism, and strengthening it is explicitly out of
  scope for this feature.

- **A8 — Release remains undecided in both dimensions.** Neither the release vehicle nor the
  decision to release at all is made here; ADR-0020 clause 9 assigns both to a later record made
  once clause 5 and ADR-0012 gates 3 and 4 are all demonstrably met.

### Resolved questions

- **Which package owns the consumer-side envelope validation and `CatalogSnapshot`
  derivation?** **Resolved 2026-08-04 by maintainer decision: its own workspace package,
  separate from both the adapter and `@adrkit/core`** (working name
  `@adrkit/catalog-envelope`). Recorded as FR-044 and in the "Where the consumer lives"
  note above it. ADR-0020 clause 7 places it outside the generator, ADR-0007 and
  Constitution Principle III place it outside core and the CLI, and ADR-0012's
  published-schema constraint is about `schema/adr.schema.json` specifically (ADR-0011),
  which a separate validating package does not touch. Constitution Principle III
  permits it directly — core and the CLI may depend on "their own workspace packages" —
  and because the package sits outside `packages/adapters/**`, `core-has-no-adapter-deps`
  is satisfied by construction rather than by exception.

  Two consequences are deliberately **not** decided here and are out of scope for this
  specification: whether the package is published or remains private to the workspace,
  and if published, whether it versions in lockstep with the core surface or
  independently (ADR-0007 distinguishes the two). Both belong with the release decision
  ADR-0020 clause 9 defers.

### Open questions

- **[NEEDS CLARIFICATION: How, if at all, is `allRefs` populated beyond the primary
  `canonicalId` in production?]** `duplicate-canonical-ref` is a required fatal trigger class
  (FR-023, FR-035) and `allRefs` is a required envelope field (FR-039), so alias refs are
  structurally present. But spike 009's
  [`entity-identity.md`](../009-catalog-binding-viability/contracts/entity-identity.md) §2 sourced
  aliases from synthetic fixtures only, recording that "Backstage itself defines no standard field
  for declaring such an alias, so **no real-corpus entity from `community-plugins` or
  `rhdh-plugins` ever has a non-empty `fixtureAuthoredAliasRefs`**," and that "a future production
  adapter's own mechanism (if any) for sourcing aliases from real descriptors is an explicitly
  separate, later, out-of-scope design decision this contract does not make." No ADR makes it
  either. Until it is
  decided, this specification cannot say whether a real-corpus run may ever produce an `allRefs`
  array longer than one element, nor therefore whether `duplicate-canonical-ref` is reachable
  outside synthetic fixtures.

- **[NEEDS CLARIFICATION: What constitutes the "release evidence" component of ADR-0012 gate 4,
  given that ADR-0020 clause 9 defers the release vehicle?]** ADR-0012's fourth production gate is
  "clean-clone / offline / adapter-boundary / **release** evidence passing," and ADR-0020's
  gate-status table records it as "Unmet, and not yet testable" because no package exists. This
  feature can produce the clean-clone, offline, and adapter-boundary components (FR-050, FR-003,
  SC-015, SC-016). It cannot determine what "release evidence" means in the absence of a decided
  publish target, tag, and channel — which clause 9 explicitly defers. Whether gate 4 is
  therefore partially clearable by this feature, or must wait entirely on the later release
  record, is not resolvable from the ADRs.
