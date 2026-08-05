# Phase 1 Data Model: Production Backstage Catalog Adapter

**Feature**: `010-catalog-backstage` | **Companion to**: `plan.md`,
`research.md`, `contracts/`, `quickstart.md`

## Scope and status of this document

This document defines the **types** the two packages exchange and the
**closed value domains** their discriminators range over. It defines no
behaviour that the contracts in `contracts/` do not already fix, and it
contains no executable code — every block below is a type sketch for a
reader, not a file to copy.

Two standing rules apply to every section:

- **Closed types stay closed.** Where a field's domain is a fixed set of
  string literals, that set is exhaustive and an implementation must model it
  as a union of literals, never as an open `string`.
- **Discriminators are carried explicitly.** Where two states produce the same
  observable payload (most importantly `explicit-empty` versus
  `annotation-absent`, which both yield `derivedPaths: []`), the distinction
  is carried as its own field and is **never** re-derived from the payload.

Types are grouped by which side of the boundary owns them:

| Group | Owner | Sections |
|---|---|---|
| Generator inputs | `packages/adapters/catalog-backstage/` | §1–§3 |
| Generator internal | `packages/adapters/catalog-backstage/` | §4–§8 |
| The wire artifact | Neither — it *is* the boundary | §9–§10 |
| Consumer | `packages/catalog-envelope/` | §11–§15 |
| Oracle and gate freezes | Neither package; `specs/` and evidence | §16–§17 |

---

## §1. `InputManifest`

The generator's sole declaration of what it may read. Adopted from
`specs/009-catalog-binding-viability/contracts/input-manifest.md` §1 without
shape change.

```text
InputManifest {
  manifestSchemaVersion:          "1"
  requestedSnapshotSchemaVersion: "1"
  requiredCapabilities:           readonly ["pathOwnership"]
  repository:                     ManifestRepository
  sources:                        readonly ManifestSource[]
}

ManifestRepository {
  id:       string   // normalized `github.com/<owner>/<repo>`, lowercase
  revision: string   // 40 lowercase hex characters
}

ManifestSource {
  path:            string   // repo-relative POSIX, validated per contracts/input-manifest.md §4.1
  digestAlgorithm: "sha256"
  digest:          string   // 64 lowercase hex characters
}
```

**The schema is closed.** An unrecognized top-level field anywhere in the
manifest JSON is itself a rejection — never silently ignored as a
forward-compatible passthrough. This is `input-manifest.md` §1's rule, adopted
unchanged.

**`path` is not validated by its label.** Calling a field "repo-relative
POSIX" is not a check. Every `path` passes **two stages, in order**: a purely
lexical rejection performed before the filesystem is touched, then a confined
`realpath` resolution that must still land beneath the verified checkout root.
Both are specified at `input-manifest.md` §4.1 and adopted unchanged.

---

## §2. `RepositoryIdentityCheck`

```text
RepositoryIdentityCheck {
  manifestRepositoryId:  string
  manifestRevision:      string
  observedRemoteRaw:     string          // from `git remote get-url origin`
  observedRepositoryId:  string | "invalid"   // after normalization
  observedHead:          string          // from `git rev-parse HEAD`
  outcome:               "match" | "repository-mismatch"
}
```

Both observed values are read via **separate git tooling**, never by
re-reading the manifest under test. A partial match — revision agrees but
repository id does not, or the reverse — is `"repository-mismatch"`, not a
partial success.

**Bounded warrant.** This confirms the manifest agrees with the checkout's own
**locally-configured** git state. It is **not** a network-verified provenance
check, and no artifact may describe it as one.

---

## §3. `DescriptorDocument`

One YAML document. A single file may hold several, so a document is addressed
by `(sourcePath, documentIndexInFile)` and never by path alone.

```text
DescriptorDocument {
  sourcePath:          string
  documentIndexInFile: integer   // 0-based
  parseOutcome:        "parsed" | "duplicate-yaml-key" | "yaml-parse-error"
  rawApiVersion:       unknown   // pre-validation; type not assumed
  rawKind:             unknown   // pre-validation; type not assumed
  rawMetadata:         unknown   // pre-validation; type not assumed
  raw:                 unknown   // the whole document node, for annotation access
}
```

**`duplicate-yaml-key` and `yaml-parse-error` are distinct.** A document that
fails to parse for a YAML syntax reason *other than* a duplicate key must not
be reported under the duplicate-key outcome. They map to two distinct trigger
classes in §8.

**`rawApiVersion` is required, not optional.** An earlier revision named only
`rawKind` and `rawMetadata`. A record built to that shape could not be
admissibility-checked at all, because §4 evaluates all four of ADR-0015's
validators and `isValidApiVersion` had no field to read. `raw` is carried for
the same reason at one remove: `adrkit.io/owned-paths` lives under
`metadata.annotations`, and ownership resolution needs the document node rather
than a pre-selected projection of it.

**`rawApiVersion` / `rawKind` / `rawMetadata` are deliberately `unknown`.** They
hold whatever the YAML node contained, before any admissibility or shape check.
Typing them optimistically would defeat §4, whose whole purpose is to decide
whether they are usable at all.

---

## §4. `AdmissibilityResult` — new for this feature

**Normative source**:
[ADR-0015](../../docs/adr/0015-treat-descriptor-admissibility-as-a-precondition-of-canonicalization.md).
This type has **no counterpart in spike 009**.

```text
AdmissibilityResult {
  admissible:     boolean
  failedFields:   readonly AdmissibilityField[]   // empty iff admissible
}

AdmissibilityField = "apiVersion" | "kind" | "metadata.name" | "metadata.namespace"
```

> **This union is exactly ADR-0015's four validator-table rows, and nothing else.**
> An earlier revision omitted `apiVersion` — which ADR-0015 requires and binds
> through `isValidApiVersion` — and added `spec.type`, which no validator in that
> table covers. It was wrong in both directions: a record built to the earlier
> union could not report the field that actually failed when `apiVersion` was
> malformed, and invited an implementation to validate a field the pinned commit
> never validates. FR-016's "exactly the four field validators in ADR-0015's
> table" is the governing wording.

**Ordering rule, and why it is load-bearing.** This check runs **before**
canonicalization (§5). ADR-0015's decision is that admissibility is a
*precondition of* canonicalization, not a sibling check. The concrete
consequence: an inadmissible descriptor never acquires a `canonicalId`, so it
can never participate in a `duplicate-canonical-id` determination and can never
be reported under that trigger instead of its own.

**Warrant, stated precisely.** The four-field validator table is pinned to
Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`. What is warranted
is **what that predicate returns when invoked**. It is **not** warranted, and
must not be written anywhere, that a Backstage deployment installs the policy,
that a catalog backend rejects such a descriptor, or that "Backstage requires"
these fields.

**Failure semantics.** `admissible: false` raises the
`inadmissible-descriptor` trigger (§8) — a **fatal, whole-operation** trigger,
never a per-entity skip. This is ADR-0015's Condition of Acceptance 2, and
carrying it onto the atomic surfaces is the reason this feature exists as
ADR-0015's follow-up.

---

## §5. `CanonicalEntityIdentity`

Adopted from `entity-identity.md` §1 without change.

```text
CanonicalEntityIdentity {
  rawKind:      string
  rawNamespace: string | undefined   // undefined when metadata.namespace omitted
  rawName:      string
  canonicalId:  string               // `${kind}:${namespace}/${name}` lowercased WHOLE
  allRefs:      readonly string[]    // non-empty; canonicalId is always a member
}
```

Two canonicalization steps, in order:

1. If `metadata.namespace` is omitted, `namespace := "default"`.
2. `canonicalId := \`${kind}:${namespace}/${name}\`.toLowerCase()` — the
   **entire** string is lowercased, not merely a prefix.

**`allRefs` minimum, and what it does not decide.** `allRefs` is required to
be present and **non-empty** by the envelope's own validation step (§13, step
2), so the generator emits `[canonicalId]` at minimum. That is a **shape**
consequence of the envelope contract and is **not** an answer to how aliases
are sourced in production.

`[NEEDS CLARIFICATION: How, if at all, is allRefs populated beyond the primary canonicalId in production? Spike 009 sourced alias refs from synthetic fixtures only (entity-identity.md §2); no real-corpus entity carries one; Backstage defines no standard alias field; no ADR decides it. Consequence: it is unknown whether duplicate-canonical-ref is reachable outside synthetic fixtures, so any coverage claim for that trigger must state whether it was exercised synthetically. Carried forward from spec.md unresolved.]`

**Case-sensitivity boundary that must not move.** Canonicalization to
lowercase happens **only** at the generator boundary. It never changes
`packages/core/src/affects/**`'s existing case-sensitive (`nocase: false`)
matcher semantics (`entity-identity.md` §5). This feature changes nothing in
that directory.

---

## §6. `OwnedPathsAnnotation`

Adopted from `owned-paths-annotation.md` §1 without change. Five ordered
steps; each failure carries its **own distinct reason**.

```text
OwnedPathsAnnotation {
  annotationPresent: boolean      // explicit discriminant, never inferred from `undefined`
  rawNodeIsString:   boolean | undefined
  jsonParseOutcome:  "parsed" | "parse-error" | "not-a-string" | undefined
  shapeOutcome:      "array-of-strings" | "wrong-shape" | undefined
  rejectionReason:   AnnotationRejectionReason | undefined
}

AnnotationRejectionReason =
  | "annotation-value-not-a-string"
  | "parse-error"
  | "wrong-shape"
```

**Step 2 is the one that is easy to omit and expensive to omit.** The
annotation node must be checked as a YAML **string scalar on the raw node**,
*before* `JSON.parse` is reached. `JSON.parse` coerces a non-string argument
via `ToString`, so the YAML sequence `["[]"]` would be stringified to `"[]"`,
parse cleanly as an empty array, and be **misclassified as `explicit-empty`**.
The TypeScript signature of `JSON.parse` provides no runtime protection here;
only the explicit `typeof rawNode === "string"` pre-parse check does.

**Empty-string elements are not `explicit-empty`.** `[""]` and
`["", "packages/**"]` are non-empty arrays whose element fails the glob
dialect's rule 1 (`"empty"`), which — per §8 — aborts the whole operation.
`explicit-empty` is the decoded value `[]` exactly.

---

## §7. `RestrictedGlobPattern` and `OwnershipState`

### 7.1 `RestrictedGlobPattern`

Adopted from `glob-dialect.md` §3. The validator applies **fifteen ordered
rules**, stopping at the **first** rule that matches, so a pattern violating
several rules always reports the same one reason.

```text
RestrictedGlobPattern {
  raw:     string
  outcome: GlobOutcome
}

GlobOutcome =
  | "accepted"                      // rule 15, compile succeeded
  | "empty"                         // rule 1
  | "leading-slash"                 // rule 2
  | "absolute-or-drive-or-unc"      // rule 3
  | "backslash"                     // rule 4
  | "nul-or-control-char"           // rule 5
  | "brace"                         // rule 6
  | "bracket"                       // rule 7
  | "parenthesis"                   // rule 8
  | "comma"                         // rule 9
  | "leading-bang"                  // rule 10
  | "traversal-segment"             // rule 11
  | "empty-segment"                 // rule 12
  | "disallowed-character"          // rule 13
  | "malformed-double-star"         // rule 14
  | "invalid-glob-compile-failure"  // rule 15, defensive backstop
```

**Rule 15 is a backstop, and its non-occurrence is conformant.**
`glob-dialect.md` §3 rule 15 describes `"invalid-glob-compile-failure"` as
"expected to never occur in practice, given rules 1–14's exhaustiveness;
present only as a defensive backstop". Spec SC-007 accordingly requires rules
**1–14** each to be exercised and states that a run which never produces rule
15's outcome **is conformant and MUST NOT be reported as a coverage gap**.
Fifteen rules; fourteen required exercises. Do not conflate the two numbers.

**Engine and options are frozen.** `picomatch` with
`{ dot: false, nocase: false, nonegate: true }`. The version recorded in the
envelope is **read from the resolved dependency**, not transcribed — see
`research.md` R3, which verified the current resolution as `picomatch@4.0.5`
at `bun.lock` line 165. Each accepted pattern is compiled **exactly once per
derivation run**, never once per match check.

### 7.2 `OwnershipState`

Exactly three values; there is no fourth.

```text
OwnershipState = "explicit-paths" | "explicit-empty" | "annotation-absent"
```

| State | Condition | `derivedPaths` |
|---|---|---|
| `explicit-paths` | Annotation present, decodes and validates, resulting array **non-empty** after every element passes the glob validator | Sorted by `compareCodeUnits`, deduplicated, non-empty |
| `explicit-empty` | Annotation present, is a string scalar, and **decodes** to an array of length zero. A **decoded-value** check, never a raw-string equality check — `'[]'`, `'[ ]'`, `'[\n]'` all qualify identically | `[]` |
| `annotation-absent` | Annotation key wholly absent, decided by `annotationPresent === false` | `[]` |

**Non-conflation rule.** `explicit-empty` and `annotation-absent` both yield
`[]`. They MUST NOT be treated as equivalent anywhere in the envelope or in
any evidence: each entity carries the discriminator as its own field, and the
distinction is never inferred from `derivedPaths`.

---

## §8. `AtomicFailureRecord` — **fifteen** trigger classes

```text
AtomicFailureRecord {
  triggerClass:  TriggerClass
  detail:        string            // human-readable; never load-bearing
  sourcePath:    string | undefined
  documentIndex: integer | undefined
}
```

```text
TriggerClass =
  | "duplicate-canonical-id"
  | "duplicate-canonical-ref"
  | "duplicate-yaml-key"
  | "invalid-yaml-syntax"
  | "invalid-manifest-shape"
  | "invalid-annotation-shape"
  | "invalid-annotation-parse"
  | "invalid-pattern"
  | "unsupported-manifest-version"
  | "unsupported-snapshot-version"
  | "unsupported-capability"
  | "repository-mismatch"
  | "incomplete-required-source"
  | "inadmissible-descriptor"        // ← added for this feature
  | "other-invalid-input"            // ← deliberate always-present backstop
```

**The count, and the trap.**
`specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §4
states that every trigger class "MUST be one of exactly these **fourteen**
values" and lists them at lines 52–67. `inadmissible-descriptor` appears
**nowhere** under `specs/009-catalog-binding-viability/`; ADR-0015 is its only
source. Spec FR-035 states that fourteen "is correct for spike 009 and **wrong
for this feature**; it MUST NOT be copied across." The production count is
**fifteen**. Any artifact of this feature that says fourteen is wrong.

**The consequence is identical for every trigger.** Whichever one fires — a
named class or the `other-invalid-input` backstop — the entire run aborts with
non-zero status and produces **no usable partial snapshot**, including for
entities that would otherwise have validated cleanly in the same run. The
single most likely implementation mistake this exists to foreclose is *"skip
the bad entity and keep going"*.

**Four of the fifteen are request-level, not entity-level.**
`unsupported-manifest-version`, `unsupported-snapshot-version`,
`unsupported-capability`, and `incomplete-required-source` are properties of
the manifest/generation request as a whole, and abort **before any entity's
paths are derived**. The first three come from `input-manifest.md` §2's table;
the fourth from §4. `atomic-fail-closed.md` §5 groups them as the four
manifest-request-level rejections.

**Overlap is not collision.** Two entities with **distinct** canonical ids
whose `owned-paths` both include the same pattern MUST both derive
successfully; a changed file matching that pattern is owned by **every**
matching entity simultaneously. This is the "no exclusive winner" rule
(`entity-identity.md` §4) and it must be **positively demonstrated**, never
inferred from the absence of a rejection.

---

## §9. `SnapshotEnvelope` — the wire artifact

**Nine top-level fields.** The generator writes this and **nothing else**
(ADR-0020 clause 7: "The generator writes the envelope and nothing else.").

```text
SnapshotEnvelope {
  schemaVersion:    "1"
  repository:       { id: string, revision: string }
  generatorVersion: string
  globDialect:      { engine: "picomatch", version: string, options: GlobOptions }
  capabilities:     readonly ["pathOwnership"]
  completeness:     { wholeCatalog: boolean, identityOnly: boolean }
  sources:          readonly EnvelopeSource[]
  entities:         readonly SnapshotEntityRecord[]
  digest:           string   // 64 lowercase hex
}

GlobOptions    { dot: false, nocase: false, nonegate: true }
EnvelopeSource { path: string, digestAlgorithm: "sha256", digest: string }
```

**This is a new, separate artifact.** It is **never** added as a field on the
existing `CatalogSnapshot` / `CatalogSnapshotEntity` types at
`packages/core/src/affects/catalog.ts`, and it never becomes part of the
published ADR schema. Those core types were read in this worktree and are:

```text
CatalogSnapshotEntity { id: EntityId, refs?: readonly string[], paths?: readonly string[] }
CatalogSnapshot       { entities: readonly CatalogSnapshotEntity[] }
CatalogPort           { resolveEntity(ref), entitiesForPaths(paths), snapshot() }
```

They are **unchanged** by this feature (spec FR-020).

**One envelope per generation pass; never merged.** Single-repository only is
an absolute constraint. Generation never produces a federated or
multi-repository snapshot.

---

## §10. `SnapshotEntityRecord` — **exactly five fields**

```text
SnapshotEntityRecord {
  identity:       { canonicalId: string, allRefs: readonly string[] }
  ownershipState: OwnershipState
  derivedPaths:   readonly string[]
  sourceDocument: { sourcePath: string, documentIndexInFile: integer }
  provenance:     AnnotationProvenance
}

AnnotationProvenance = "upstream-authored" | "maintainer-overlay"
```

**`provenance` describes the ANNOTATION, not the descriptor.** This distinction is the
whole point of the field and is easy to get backwards. Under **ADR-0020 clause 5** the
descriptors are upstream-authored in *both* cases — the clause requires them "authored
upstream and otherwise unmodified" — so a value meaning "the descriptor came from
upstream" would be true always and would distinguish nothing.

| Value | Meaning |
|---|---|
| `upstream-authored` | The `adrkit.io/owned-paths` annotation was already present in the real upstream descriptor as found. |
| `maintainer-overlay` | The annotation was authored by us and overlaid onto an otherwise-unmodified upstream descriptor. |

That is what makes **FR-043** satisfiable: clause 5's "only the corpus data is
third-party, never the validation" boundary becomes legible from the artifact itself.

**It also doubles as a live adoption signal.** Zero third-party descriptors in the pinned
corpora carry the annotation, so every corpus today is `maintainer-overlay`;
`upstream-authored` only becomes reachable if real adoption occurs. The field is not dead
metadata.

*Decided by the maintainer on 2026-08-05. An earlier revision typed this a bare `string`
with no frozen domain, while consumer validation step 2 required "a recognized
`provenance`" — an unsatisfiable pairing. Phase C correctly implemented non-empty-string
and flagged the gap rather than inventing a vocabulary that would have made the consumer
reject conformant generator output.*

This is the **serialized projection** of the generator's internal entity
record, not that record field-for-field. `snapshot-envelope.md` §1 fixes the
shape and its rationale: the identity projection carries `{ canonicalId,
allRefs }` **only**, because the pre-lowercase authoring inputs are already
fully captured by those two fields.

**A flatter shape is forbidden.** Spec FR-039 and `snapshot-envelope.md` §1
both require exactly this nested five-field shape — **never** a flatter
`canonicalId` / `refs` / `paths` triple, and never the full internal objects —
so that the on-disk envelope and the declared type are one identical defined
type rather than two independently-drifting shapes for the same record.

---

## §11. `EnvelopeValidationResult` — consumer side, **five ordered steps**

Owned by `packages/catalog-envelope/`. Adopted from `snapshot-envelope.md` §2
without change.

```text
EnvelopeValidationResult {
  outcome:     "valid" | "rejected"
  failedStep:  1 | 2 | 3 | 4 | 5 | undefined
  reason:      EnvelopeRejectionReason | undefined
}

EnvelopeRejectionReason =
  | "invalid-json"                              // step 1
  | "missing-or-wrong-required-field"           // step 2
  | "unrecognized-schema-or-dialect-or-capability"  // step 3
  | "missing-source-digest"                     // step 4
  | "identity-only-true"                        // step 5
```

The five steps, in **exactly** this order, rejecting non-zero at the first
failure and naming the specific reason:

| Step | Check | Note that is easy to get wrong |
|---|---|---|
| 1 | Parses as JSON at all | — |
| 2 | Complete §9/§10 shape present with every field the correct JSON type at **every** nesting level | A `missing-source-digest` envelope does **not** fail here — its `sources` entry is otherwise well-formed. It is caught at step 4. |
| 3 | Frozen matcher contract validated by **exact value**: `schemaVersion === "1"`; `globDialect` deep-equals the frozen object; `capabilities` deep-equals the exact tuple `["pathOwnership"]` | A `globDialect.version`-only check is **insufficient**. A per-entry-membership-only check on `capabilities` is **insufficient**. |
| 4 | Every `sources[]` entry has a **present**, correctly-typed `digest` that matches its listed path's actual bytes | Omission and mismatch both fail here. |
| 5 | `completeness.identityOnly === false` | Determined **solely** from this boolean — **never** by scanning the entity list's `ownershipState` distribution. |

**The contrast case that must pass.** An envelope whose entities are **all**
`annotation-absent`, with `completeness.identityOnly: false`, is **not**
rejected. Absent annotations are a valid, expected state. Rejecting on the
ownership-state distribution is a bug, and it is the specific bug step 5's
wording exists to prevent.

**Only after steps 1–5 all pass** does the consumer proceed to §12–§14.

---

## §12. `DigestCheckResult`

```text
DigestCheckResult {
  declaredDigest:   string
  recomputedDigest: string
  outcome:          "match" | "digest-mismatch"
}
```

Canonicalization is §9's object **including `schemaVersion` and every other
field, excluding only `digest` itself**: keys recursively sorted at every
nesting level by `compareCodeUnits`, arrays serialized in **declaration order**
(never re-sorted), compact separators, `undefined` fields omitted. SHA-256 over
the UTF-8 bytes; 64 lowercase hex characters.

**Implementation instruction.** Use `canonicalStringify` exported from
`@adrkit/core` (`packages/core/src/fingerprint/index.ts` line 16, re-exported
at `packages/core/src/index.ts` line 24). Do **not** write a second one, and do
**not** import the different same-named function at
`packages/evaluator/src/report/serialize.ts` line 38.

**Guarantee scope that must travel with every mention of this check.** The
digest proves **accidental-corruption and naive-mutation detection only**. It
does **not** resist an adversary who mutates content and recomputes the same
digest. A cryptographically-signed tamper-evidence mechanism is an explicitly
open question this feature does not attempt. Never overclaim adversarial
tamper-resistance.

**And a second scope statement, from ADR-0020 clause 5.** A populated,
digest-verified envelope proves **integrity, not correctness** — "a
semantically wrong envelope can carry a perfectly valid self-digest."
Correctness is established only by §17's expected-vs-observed comparison.

---

## §13. `StalenessAndIdentityCheckResult`

```text
StalenessAndIdentityCheckResult {
  expectedRepositoryId: string | undefined
  expectedRevision:     string | undefined
  outcome: "ok" | "stale-revision" | "repository-identity-mismatch"
}
```

**"Stale" means exact inequality, never a chronological judgement.** Commit
SHAs are opaque identifiers with no ordering available without separate git
ancestry data, which is out of scope. When configured with an expected-current
revision, an envelope declaring **any** other revision for that repository id
is rejected as stale.

**Isolation from the digest check.** A staleness or identity fixture MUST have
its own digest **recomputed over its own actual mutated content**, so it passes
§12 cleanly and the rejection is attributable specifically to staleness or
identity — never to a coincidental digest failure.

---

## §14. `RepositoryIsolationQuery` — acceptance, not rejection

```text
RepositoryIsolationQuery {
  loadedEnvelopes:   readonly SnapshotEnvelope[]   // each independently valid
  scopedRepositoryId: string
  returnedEntities:   readonly SnapshotEntityRecord[]
}
```

A tool legitimately holding two or more independently-generated,
individually-valid single-repository envelopes MUST NOT let a query scoped to
one repository id return any entity originating from another. **Neither
envelope is rejected**; both remain valid. Isolation is a property of the
**query**, not an error condition.

**The line this draws.** §13's `repository-identity-mismatch` is
mismatch-and-reject, for a consumer that expected exactly **one** repository.
§14 is filter-and-isolate, for a consumer deliberately querying across
several, **each individually expected**. Conflating them turns a legitimate
multi-repository index into a rejection, or a mismatch into a silent filter.

---

## §15. `DerivedCatalogSnapshot`

```text
DerivedCatalogSnapshot {
  snapshot:    CatalogSnapshot      // the EXISTING core type, unmodified
  derivedFrom: { repositoryId: string, revision: string, envelopeDigest: string }
}
```

**Derivation is gated.** A `CatalogSnapshot`-shaped artifact is derived from
the envelope **only after** that envelope independently passes every §11
validation step and §12's digest check (ADR-0020 clause 7; ADR-0012's
requirement that any persisted `CatalogSnapshot` require a validated
interchange file first). An adapter's raw output MUST NOT be handed to core
directly and unvalidated, under any composition arrangement.

**The mapping is lossy by design and must be documented as such.**
`CatalogSnapshotEntity` is `{ id, refs?, paths? }` — it has **no**
`ownershipState` field. So `explicit-empty` and `annotation-absent` both map
to an entity with an empty (or absent) `paths`, and the distinction the
envelope preserves is **not** representable in the core type. The deriver
therefore keeps the distinction on the envelope side and does not attempt to
smuggle it into `CatalogSnapshot`. Changing `CatalogSnapshot` to carry it is
**out of scope** (spec FR-020).

---

## §16. `FrozenExpectationSet` — the re-frozen oracle

Not a package type. This is the shape of the artifact Barrier B's first two
steps produce.

```text
FrozenExpectationSet {
  frozenAt:              string           // ISO-8601
  derivedPathPatterns:   readonly string[]  // sorted by compareCodeUnits ← the correction
  expectedByEntity:      readonly { canonicalId: string, expectedPaths: readonly string[] }[]
  contentHash:           string           // over the canonical form of this set
  auditRecord:           IndependentAuditRecord
}

IndependentAuditRecord {
  auditedAt:      string
  auditorIsIndependentOfAuthor: true
  observedHash:   string        // recomputed, not copied
  verdict:        "pass" | "fail"
}
```

**What "fresh" means here, and why a stale copy is the specific hazard.**
ADR-0012 gate 3 is `Unmet`: "The oracle exists but carries a known-wrong
expected result and must be re-frozen." ADR-0020 clause 6 requires a **fresh**
T014 → T014a cycle — correct the `derivedPathPatterns` ordering, re-freeze,
re-hash, obtain a **new** independent pre-output audit — before producing
generator output. ADR-0015's Condition of Acceptance 1 records that the spike's
evidence bundle is **untracked / scratch-only**, so "nothing in the repository
will stop someone reusing a stale copy — this clause is the only control."

**The correction itself.** `derivedPathPatterns` was frozen in **input
order**; it must be frozen in **`compareCodeUnits`-sorted** order, matching
§7.2's `explicit-paths` requirement that derived paths are sorted and
deduplicated.

**`auditRecord.observedHash` is recomputed, never copied.** An audit that
transcribes the author's declared hash has verified nothing.

---

## §17. `AcceptCorpusFreeze` — the clause-5 gate artifact

```text
AcceptCorpusFreeze {
  corpusRef:           { repository: string, commit: string }
  selectionBasis:      string        // recorded BEFORE selection is acted on
  size:                integer       // recorded in the same step, not afterwards
  overlay:             readonly { sourcePath: string, documentIndexInFile: integer,
                                  annotationValue: string }[]
  expectedPaths:       readonly { canonicalId: string, expectedPaths: readonly string[] }[]
  contentHash:         string
  auditRecord:         AdequacyAuditRecord
}

AdequacyAuditRecord extends IndependentAuditRecord {
  adequacyFinding: "adequate-for-the-claim" | "inadequate"   // explicit; required
  adequacyReason:  string
}
```

**Every field above is required by ADR-0020 clause 5, and two are the ones an
implementer is most likely to drop.**

- `selectionBasis` and `size` are "fixed and recorded in that same cycle, **not
  chosen afterwards**". Selecting a corpus and then writing down why is
  precisely the failure mode this forecloses.
- `adequacyFinding` is required explicitly: "that audit must record an explicit
  finding that the corpus is adequate for the claim being made; an audit that
  passes on integrity without reaching adequacy **does not satisfy this
  clause**."

**No minimum entity count is fixed.** ADR-0020 clause 5 declines to name one
deliberately, because ADR-0012 holds that production limits are "**not**
guessed now; they must be ratified from evidence". Adequacy is "a recorded
judgement by an independent reviewer against the frozen corpus, never a number
invented by this record." **This plan does not invent one either.**

**Input provenance, and the honesty rule attached to it.** The descriptors are
real, authored upstream, and otherwise **unmodified**; the annotation overlay
is **maintainer-authored**. Per ADR-0014's honesty rules and ADR-0020 clause 5,
maintainer reference verification is **rung 2** and MUST NOT be described as
external, third-party, or community adoption — **only the corpus data is
third-party, never the validation**.

**What the construction buys and does not buy** (ADR-0020 clause 5, carried so
it is not overstated downstream): it exercises ownership derivation against
real descriptor structure and real field shapes, at whatever scale the audited
corpus fixes. It gates **technical compatibility only**. It does **not**
evidence that the mapping reflects anyone's actual ownership, that anyone else
wants the annotation, or that adoption risk has fallen. An
all-`annotation-absent` corpus satisfies none of it — it yields a populated
envelope while exercising no derivation at all. Wholly synthetic entities
satisfy none of it either — the spike already proved that path.

**Selection is constrained by facts already known.** Clause 5 requires the
accept corpus to be admissible under ADR-0015 and free of duplicate canonical
ids. `research.md` R14 records the invalid-name and placeholder-collision
populations in both pinned corpora, with their counts and their qualifications.
Selecting without regard to them would fail the gate on inputs known in advance
to fail; how they were handled is part of what the audit inspects.

---

## Cross-cutting: which package owns which type

| Type | `catalog-backstage` | `catalog-envelope` | Neither |
|---|---|---|---|
| §1 `InputManifest`, §2 `RepositoryIdentityCheck`, §3 `DescriptorDocument` | ✅ | — | — |
| §4 `AdmissibilityResult`, §5 `CanonicalEntityIdentity`, §6 `OwnedPathsAnnotation`, §7 `RestrictedGlobPattern` / `OwnershipState`, §8 `AtomicFailureRecord` | ✅ | — | — |
| §9 `SnapshotEnvelope`, §10 `SnapshotEntityRecord` | writes | reads | the boundary itself |
| §11–§15 consumer types | — | ✅ | — |
| §16 `FrozenExpectationSet`, §17 `AcceptCorpusFreeze` | — | — | ✅ evidence, not code |

**The boundary rule that this table encodes.** The two packages depend on
neither each other nor anything but the envelope file (spec FR-044). §9/§10
appear in both columns because each package declares its **own** view of the
wire shape; they are validated to agree by the consumer's step-3 exact-value
check and by the digest, not by a shared type import.

**One duplication is therefore deliberate.** Both packages carry a
declaration of the envelope shape. That is not drift to be eliminated — it is
what makes the boundary a boundary. What must **not** diverge is the
serialized bytes, and that is enforced by §12's digest and by §11 step 3, not
by refactoring the two declarations into one shared package.
