# Data Model: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Feature**: `009-catalog-binding-viability` | **Companion to**: [plan.md](./plan.md), [research.md](./research.md)

> **This is not production data and not a schema change.** Every entity below
> describes this spike's own disposable fixtures, its required evidence
> artifacts, and its verdict — never a change to `AdrFrontmatter`,
> `schema/adr.schema.json`, `CatalogSnapshot`/`CatalogSnapshotEntity`
> (`packages/core/src/affects/catalog.ts`), or any other part of the ADR
> schema or the existing core matcher types (Principle V; FR-020). Nothing
> here is written to `docs/adr/**` or to any `packages/` source file. These
> shapes exist solely to make the evidence bundle mechanically checkable
> rather than free prose, mirroring `specs/008-spec-kit-hook-viability/data-model.md`'s
> own non-production framing for this project's other advance-scoping spike.

## 1. OwnedPathsAnnotation — Entity

The as-authored `adrkit.io/owned-paths` annotation value on one descriptor,
before validation (ADR-0012 "The annotation"; FR-003; spec.md Key Entities).

| Field | Type | Notes |
|---|---|---|
| `annotationPresent` | `boolean` | Explicit annotation-presence discriminant: `true` iff the key `metadata.annotations['adrkit.io/owned-paths']` exists on the descriptor at all (regardless of its node type or value), `false` iff the key is wholly absent. `annotation-absent` (the ownership state) is derived **solely** from `annotationPresent === false` (see the validation rule below), never inferred from `rawValue` being `undefined` — because `rawValue` is also `undefined` for a present-but-non-string node, the two states are only unambiguously separable via this dedicated boolean. |
| `rawYamlValueIsString` | `boolean` | Meaningful only when `annotationPresent === true`; whether the surrounding YAML document's `metadata.annotations['adrkit.io/owned-paths']` node is itself a YAML string scalar. `false` (a YAML sequence, mapping, or other non-string node deliberately authored by a synthetic fixture) is rejected as `"annotation-value-not-a-string"` **before** JSON decoding is attempted. This rejection is required because `JSON.parse` does **not** guard against a non-string argument: ECMA-262 defines `JSON.parse(text)` as first coercing `text` to a string via `ToString`, so a non-string node is silently stringified rather than raising a type error (e.g. the one-element sequence `["[]"]` coerces to `"[]"` and would parse as an empty array). The `JSON.parse` TypeScript signature provides no runtime protection; only an explicit `typeof rawNode === "string"` pre-parse check does. `false` when `annotationPresent === false` (no node to type-check). |
| `rawValue` | `string` \| `undefined` | The literal annotation string value exactly as it appears in `metadata.annotations['adrkit.io/owned-paths']`, present only when `annotationPresent === true` **and** `rawYamlValueIsString === true`; `undefined` both when the key is wholly absent (`annotationPresent === false`) and when a present node is non-string (`rawYamlValueIsString === false`). Its `undefined` value is therefore **not** a reliable absence signal — use `annotationPresent` for that. |
| `jsonParseOutcome` | `"parsed"` \| `"parse-error"` \| `"annotation-value-not-a-string"` | Evaluated only when `annotationPresent === true`. `"annotation-value-not-a-string"` if `rawYamlValueIsString === false`. `"parse-error"` if `rawValue` is a defined string but fails to parse as JSON at all (FR-003). An absent annotation (`annotationPresent === false`) never reaches this field (see `ownershipState` below). |
| `decodedValue` | `unknown` \| `undefined` | The `JSON.parse` result, only when `jsonParseOutcome === "parsed"`. |
| `shapeOutcome` | `"array-of-strings"` \| `"wrong-shape"` | `"wrong-shape"` if `decodedValue` is not exactly `array<string>` (an object, bare string, number, or an array containing a non-string element) — FR-003's distinct shape-specific reason, never conflated with `jsonParseOutcome === "parse-error"`. |

**Validation rule**: `ownershipState` (see `CatalogEntityRecord` §7) is
derived from this entity, never the reverse, and the discriminant is evaluated
in this order: first, `annotationPresent === false` → `annotation-absent`
(decided before any value-type or decoded-value check, so a present-but-non-
string node is never misclassified as absent); then, for a present node,
`rawYamlValueIsString === false` → `"annotation-value-not-a-string"` (an
invalid-input condition, not an ownership state); then `decodedValue` is an
array of length **zero** (a **decoded-value** check — never a raw-string
equality check against the literal text `"[]"`; `'[]'`, `'[ ]'`, and any
other JSON text decoding to an empty array all qualify identically, since
classification happens strictly after JSON decoding per §1's decode-then-
validate order) → `explicit-empty`; then `decodedValue` is a non-empty
`array<string>` where every element passes `RestrictedGlobPattern`
validation (§2) → `explicit-paths`; any other outcome
(`"parse-error"`, `"wrong-shape"`, or an array containing at least one string
that fails §2 validation) is an invalid-input condition under the
whole-operation atomicity rule (`AtomicFailureRecord`, §6) — never a fourth
ownership state.

## 2. RestrictedGlobPattern — Entity

One decoded pattern string's validation outcome against the hardened
restricted dialect (ADR-0012 "Restricted glob dialect"; FR-004; `research.md`
R9's fixed validation order).

| Field | Type | Notes |
|---|---|---|
| `rawPattern` | `string` | The decoded string element, before validation. |
| `outcome` | `"accepted"` \| one of the rejection reasons below | Computed by `research.md` R9's fixed order; exactly one reason, even if the pattern would violate more than one rule. |
| Rejection reasons | `"empty"` \| `"leading-slash"` \| `"absolute-or-drive-or-unc"` \| `"backslash"` \| `"nul-or-control-char"` \| `"brace"` \| `"bracket"` \| `"parenthesis"` \| `"comma"` \| `"leading-bang"` \| `"traversal-segment"` \| `"empty-segment"` \| `"disallowed-character"` \| `"malformed-double-star"` \| `"invalid-glob-compile-failure"` | `"disallowed-character"` is the positive-allowlist check (any character outside `A-Z`/`a-z`/`0-9`/`_`/`-`/`.`/`/`/`*`/`?`) that closes the gap a pure blacklist cannot: it rejects characters ADR-0012's own enumerated blacklist does not separately name (e.g. `@`, `#`, `~`, `+`, `:`) but that its positive grammar still excludes. `"malformed-double-star"` rejects any `**` that does not occupy a whole path segment by itself (`a**b`, `**b`, `a**`). The last reason (`"invalid-glob-compile-failure"`) exists only for a pattern that passes every character-class check but still fails `picomatch@4.0.5` compilation for a reason this restricted dialect's own enumerated rules do not name — expected to be empty in practice given the dialect's exhaustiveness, but present so the validator never silently swallows an unanticipated compile-time exception. |
| `compiledMatcher` | opaque (not serialized) | Present only when `outcome === "accepted"`; the `picomatch(rawPattern, { dot: false, nocase: false, nonegate: true })` matcher function, compiled exactly once (`research.md` R9 item 3). Never included in the JSON evidence bundle — only `outcome` and `rawPattern` are recorded there. |

## 3. InputManifest — Entity

The explicit, immutable, local description of exactly one repository and the
exact descriptor files a generation run may read (ADR-0012 "Repository
boundary"; FR-009; FR-033; `research.md` R5/R7).

| Field | Type | Notes |
|---|---|---|
| `manifestSchemaVersion` | `string` (literal) | Only `"1"` is accepted; any other value is an "unsupported manifest version" rejection (FR-033), checked before any entity's paths are derived. |
| `requestedSnapshotSchemaVersion` | `string` (literal) | Only `"1"` is accepted, matching `SnapshotEnvelope.schemaVersion` (§9); any other value is an "unsupported snapshot version" rejection (FR-033). |
| `requiredCapabilities` | `string[]` | Every element MUST equal exactly `"pathOwnership"`; any other string is an "unsupported capability" rejection (FR-033). |
| `repository` | `{ id: string; revision: string }` | `id` MUST already be in the normalized `github.com/<owner>/<repo>` lowercase form (`research.md` R6) — the manifest author is responsible for pre-normalizing it; the generator does not "fix" a malformed manifest value, it rejects it. `revision` MUST be a full 40-character lowercase-hex commit SHA. |
| `sources` | `{ path: string; digestAlgorithm: "sha256"; digest: string }[]` | The exact, exhaustive list of descriptor files this generation run is permitted to read (`research.md` R7). Every `path` MUST pass source-path validation (`contracts/input-manifest.md` §4.1) **before** the file is opened: (a) a lexical rejection pass that rejects an empty string, an absolute path or leading `/`, a leading-drive (`^[A-Za-z]:`) or UNC (`^\\\\` / leading `\`) prefix, any backslash, any `.` or `..` path segment, and any NUL/control character; and (b) a filesystem check that the path resolved (`realpath`, symlinks followed) beneath the verified checkout root still lies inside that root — a path whose real target escapes the checkout (including via a symlink) fails closed as an "incomplete required source" rejection (FR-009), never opened. Only a path surviving both passes is read. `digest` is the expected SHA-256 hex digest of that file's raw bytes; a mismatch at read time is likewise an "incomplete required source" rejection (FR-009). |

**Validation rule**: An unrecognized top-level field anywhere in the manifest
JSON is itself an "unsupported manifest version"-class rejection
(`research.md` R5) — the manifest schema is closed, never an open passthrough
bag. All rejections above are properties of the manifest/generation request
as a whole (User Story 2, Acceptance Scenario 4), never of an individual
entity within a batch.

## 4. RepositoryIdentityCheck — Entity

The result of comparing an `InputManifest.repository` value against a
checkout's actual, separately-read git identity (ADR-0012 "Repository
boundary"; FR-009; `research.md` R6).

| Field | Type | Notes |
|---|---|---|
| `declaredId` | `string` | From `InputManifest.repository.id`. |
| `declaredRevision` | `string` | From `InputManifest.repository.revision`. |
| `actualRemoteUrlRaw` | `string` | The raw, unparsed `git remote get-url origin` output, read via separate git tooling — never re-read from the manifest file under test (FR-009). |
| `actualIdNormalized` | `string` \| `"invalid"` | `actualRemoteUrlRaw` run through `research.md` R6's normalization algorithm; `"invalid"` if it matches none of R6's recognized forms. |
| `actualRevision` | `string` | The raw `git rev-parse HEAD` output for the same checkout. |
| `outcome` | `"match"` \| `"repository-mismatch"` \| `"revision-mismatch"` \| `"repository-and-revision-mismatch"` | `"match"` requires both `declaredId === actualIdNormalized` and `declaredRevision === actualRevision`, exact string equality on both. Any other combination is a mismatch and MUST abort generation before any entity's paths are derived (FR-009/FR-007), never a partial "revision matched but repository didn't, so proceed anyway" outcome. |

## 5. DescriptorDocument — Entity

One parsed catalog descriptor document (possibly one of several sharing a
file, per User Story 5's multi-document case) and the entity, if any, it
declares (FR-005, FR-006, FR-013).

| Field | Type | Notes |
|---|---|---|
| `sourcePath` | `string` | The manifest-listed file this document came from. |
| `documentIndexInFile` | `number` | `0` for a single-document file; `0`, `1`, … for successive `---`-separated documents in a multi-document file (User Story 5, Acceptance Scenario 1). |
| `parseOutcome` | `"parsed"` \| `"duplicate-yaml-key"` \| `"yaml-parse-error"` | `"duplicate-yaml-key"` is produced by the `yaml@2.9.0` default `uniqueKeys: true` behavior (`research.md` R8), distinct from `OwnedPathsAnnotation.jsonParseOutcome === "parse-error"`, which applies only to the *annotation's own value*, not the surrounding YAML document. |
| `kind` | `string` \| `undefined` | The descriptor's `kind` field (e.g. `"Component"`, `"Location"`), only when `parseOutcome === "parsed"`. |
| `rawMetadataNamespace` | `string` \| `undefined` | `metadata.namespace` exactly as authored, or `undefined` if omitted (triggering the default-namespace substitution rule, FR-005, User Story 1 Acceptance Scenario 4). |
| `rawMetadataName` | `string` \| `undefined` | `metadata.name` exactly as authored. |
| `locationTargets` | `string[]` \| `undefined` | Present only when `kind === "Location"`; the raw `spec.targets` array. **Never dereferenced or read** by generation (FR-010; User Story 5 Acceptance Scenario 3) — recorded here purely as evidence that the generator observed but did not follow it. |
| `ownedPathsAnnotation` | `OwnedPathsAnnotation` (§1) \| `undefined` | Present for **any** parsed entity, including a `kind: "Location"` entity — ADR-0012's explicit annotation contract applies to entities generally and names no `kind`-based restriction. The required `Location`-not-followed fixture (`contracts/structural-fixtures-and-corpora.md` §4) simply happens to omit this field on its own `Location` entity, since that fixture's point is proving `spec.targets` is never followed, not testing Option A's applicability to `Location` specifically; a future execution session MAY additionally author a `Location` entity that itself carries a valid `adrkit.io/owned-paths` value to confirm Option A parses identically regardless of `kind`, though this is not itself a required scenario. The separate edge case in `spec.md` about the descriptor-parent **heuristic** (B) applied to a `Location` fixture (`contracts/comparison-heuristics.md` §2) is a distinct, B/C-only concern and does not restrict Option A's own applicability. |

## 6. AtomicFailureRecord — Entity

One triggering condition for the whole-operation fail-closed rule (ADR-0012
"Atomic fail-closed semantics"; FR-007; SC-002).

| Field | Type | Notes |
|---|---|---|
| `triggerClass` | `"duplicate-canonical-id"` \| `"duplicate-canonical-ref"` \| `"duplicate-yaml-key"` \| `"invalid-yaml-syntax"` \| `"invalid-manifest-shape"` \| `"invalid-annotation-shape"` \| `"invalid-annotation-parse"` \| `"invalid-pattern"` \| `"unsupported-manifest-version"` \| `"unsupported-snapshot-version"` \| `"unsupported-capability"` \| `"repository-mismatch"` \| `"incomplete-required-source"` \| `"other-invalid-input"` | Fourteen-value closed enumeration (`contracts/atomic-fail-closed.md` §4); every class maps to exactly one of `OwnedPathsAnnotation`, `RestrictedGlobPattern`, `CanonicalIdentity` (§7's uniqueness rule), `DescriptorDocument` (§5, for `"invalid-yaml-syntax"`), `InputManifest` (for `"invalid-manifest-shape"` and `"unsupported-*"`), or `RepositoryIdentityCheck` above — except `"other-invalid-input"`, a deliberate always-present backstop for FR-007's own "including but not limited to" hedge, never mapped to a specific entity. |
| `triggeringEntityOrSource` | `string` | The specific entity ref, source path, or manifest field that triggered the class — never a vague "somewhere in the batch" description. |
| `runAborted` | `true` (fixed literal) | Always `true` — this entity exists only to describe an abort; a validation failure that did *not* abort the whole run is a data-model defect, not a valid `AtomicFailureRecord`. |
| `partialSnapshotProduced` | `false` (fixed literal) | Always `false`, structurally encoding FR-007's "no usable partial snapshot" — including for entities that validated cleanly in the same run. |

## 7. CanonicalEntityIdentity — Entity

The canonicalized identity of one entity descriptor (ADR-0012 "Entity
identity and aliases"; FR-005, FR-006).

| Field | Type | Notes |
|---|---|---|
| `rawKind` | `string` | As authored. |
| `rawNamespace` | `string` \| `"default"` | `"default"` substituted per FR-005 when `metadata.namespace` is omitted, matching Backstage's own `stringifyEntityRef` default-namespace constant. |
| `rawName` | `string` | As authored. |
| `canonicalId` | `string` | `` `${rawKind}:${rawNamespace}/${rawName}`.toLowerCase() ``, matching `stringifyEntityRef`'s own lowercasing (FR-005). |
| `fixtureAuthoredAliasRefs` | `string[]` | For synthetic fixtures only (FR-006): additional ref strings supplied directly by the fixture's own construction, mirroring `CatalogSnapshotEntity.refs`. Never derived from a real Backstage annotation — Backstage itself defines no alias field this spike could read. Empty for every real-corpus entity. **Each element MUST already be a well-formed full `kind:namespace/name` ref** (matching the same shape `canonicalId` itself takes, before the lowercasing in `allRefs` below) — ADR-0012's "[e]very id and ref is globally unique within the snapshot" rule applies to every ref uniformly, so a fixture-authored alias that is not itself a full `kind:namespace/name` string (e.g. a bare name with no `kind:namespace/` prefix) is itself an `"invalid-annotation-shape"`-class rejection at fixture-authoring time, never silently accepted as a partial ref. |
| `allRefs` | `string[]` | `[canonicalId, ...fixtureAuthoredAliasRefs]`, each independently lowercased (`compareCodeUnits`-sorted per `research.md` R4's array-ordering rule, canonical ID first). |

**Uniqueness rule (FR-006)**: Across one snapshot-generation run, every string
appearing in any entity's `allRefs` MUST be globally unique. A second
entity's `canonicalId` or any of its `fixtureAuthoredAliasRefs` colliding with
any string already present in a prior entity's `allRefs` — including a
case-only collision produced by the lowercasing above, and including a ref
colliding with a different entity's *alias* rather than its *ID* — is a
`triggerClass: "duplicate-canonical-ref"` (or `"duplicate-canonical-id"` if
both colliding values are each entity's own primary `canonicalId`)
`AtomicFailureRecord` (§6). None may be silently merged, first-wins, or
last-wins.

## 8. CatalogEntityRecord — Entity

One entity's complete derived record within a single-repository generation
pass (spec.md Key Entities "Owned-Paths Annotation"; FR-008; FR-022).

| Field | Type | Notes |
|---|---|---|
| `identity` | `CanonicalEntityIdentity` (§7) | |
| `ownershipState` | `"explicit-paths"` \| `"explicit-empty"` \| `"annotation-absent"` | Exactly one of the three states (§1's derivation rule; this spec's own added `explicit-paths` label per the Editorial Note in `spec.md`'s Overview, distinct from the two states the maintainer's decision named explicitly). |
| `derivedPaths` | `string[]` | The entity's accepted `RestrictedGlobPattern.rawPattern` values (§2), lexicographically sorted by `compareCodeUnits` (`research.md` R4) and deduplicated. Empty for both `explicit-empty` and `annotation-absent` — the two are still distinguished only via `ownershipState`, never inferred from `derivedPaths` alone. |
| `sourceDocument` | `DescriptorDocument` (§5) reference | Which document this entity's identity/annotation came from, by `sourcePath` + `documentIndexInFile`. |
| `provenance` | `"community-plugins-real"` \| `"rhdh-plugins-real"` \| `"synthetic"` | Which pass/corpus this entity belongs to — never mixed across passes within one envelope (FR-022; User Story 6). |

## 9. SnapshotEnvelope — Entity

The required, versioned interchange artifact produced from one actual
single-repository generation pass (ADR-0012 "Composition, envelope, and
persistence"; FR-022; FR-034; FR-035; SC-010). **One instance per FR-009
pass — never one instance spanning more than one repository.**

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `string` (literal) | Fixed `"1"`, matching `InputManifest.requestedSnapshotSchemaVersion`. |
| `repository` | `{ id: string; revision: string }` | Copied from this pass's own `InputManifest.repository` after its `RepositoryIdentityCheck.outcome === "match"`. |
| `generatorVersion` | `string` | A throwaway, spike-scoped version string identifying the design/contract version this envelope was produced against (e.g. `"009-spike-0.1.0"`) — never an `@adrkit/*` package version, since this envelope is not a published package artifact (FR-020/FR-026). |
| `globDialect` | `{ engine: "picomatch"; version: "4.0.5"; options: { dot: false; nocase: false; nonegate: true } }` | Fixed literal, matching ADR-0012's frozen engine/options exactly. |
| `capabilities` | `["pathOwnership"]` (fixed literal array) | The envelope's own declaration of what it provides, checked by a consumer against `InputManifest.requiredCapabilities` (FR-022, FR-033). |
| `completeness` | `{ wholeCatalog: false; identityOnly: boolean }` | `wholeCatalog` is always `false` for this spike (never claims whole-catalog coverage). `identityOnly` is `true` **only** for an envelope produced by Option D alone (no owned-paths derivation attempted for any entity); it is `false` whenever Option A derivation was attempted for every entity, **regardless of the resulting `ownershipState` distribution** — an envelope where every entity happens to be `annotation-absent` is still `identityOnly: false` (FR-022, FR-034). |
| `sources` | `{ path: string; digestAlgorithm: "sha256"; digest: string }[]` | Copied from this pass's `InputManifest.sources`, restated in the envelope so a consumer can verify the envelope's provenance without needing the original manifest. |
| `entities` | `SnapshotEntityRecord[]` (defined below) | This pass's complete, deterministic entity list; every record's `provenance` matches this envelope's own single pass. `SnapshotEntityRecord` is the explicit **serialized** projection of §8's `CatalogEntityRecord` (see below) — not the full in-memory `CatalogEntityRecord`, and not `CanonicalEntityIdentity` field-for-field. |
| `digest` | `string` (64 lowercase hex chars) | SHA-256 over the UTF-8 bytes of this envelope's own canonical serialization (`research.md` R4), computed over every field above **including `schemaVersion`** and **excluding only this `digest` field itself** (FR-035). |

**`SnapshotEntityRecord` — the serialized entity shape (the exact JSON in
`entities[]`).** To avoid the field-for-field mismatch between the wire form
and the in-memory §7/§8 types, the envelope serializes **exactly** these
fields per entity, and a consumer validates **exactly** this shape:

| Field | Type | Notes |
|---|---|---|
| `identity` | `{ canonicalId: string; allRefs: string[] }` | A deliberately reduced **`SerializedEntityIdentity`** projection of §7's `CanonicalEntityIdentity`: only the lowercased `canonicalId` and the lowercased `allRefs` array are serialized. §7's `rawKind`/`rawNamespace`/`rawName`/`fixtureAuthoredAliasRefs` are **not** serialized — they are pre-lowercase authoring inputs already fully captured by `canonicalId` (which is `${rawKind}:${rawNamespace}/${rawName}` lowercased) and `allRefs` (which is `[canonicalId, ...aliases]` each lowercased), and a path-ownership consumer never needs them. `allRefs` MUST be non-empty and MUST contain `canonicalId` as its first element. |
| `ownershipState` | `"explicit-paths"` \| `"explicit-empty"` \| `"annotation-absent"` | Exactly §8's discriminator. |
| `derivedPaths` | `string[]` | Exactly §8's `derivedPaths`: the entity's accepted patterns, `compareCodeUnits`-sorted and deduplicated; `[]` for both `explicit-empty` and `annotation-absent` (distinguished only via `ownershipState`). |
| `sourceDocument` | `{ sourcePath: string; documentIndexInFile: number }` | The serialized form of §8's `sourceDocument` reference — the manifest-listed `sourcePath` plus the `documentIndexInFile` (§5), not the whole `DescriptorDocument`. |
| `provenance` | `"community-plugins-real"` \| `"rhdh-plugins-real"` \| `"synthetic"` | Exactly §8's `provenance`; matches this envelope's single pass. |

A future execution session's serializer MUST emit exactly these five fields
per entity (nested `identity` object, never a flattened
`canonicalId`/`refs`/`paths` triple), and a consumer MUST validate exactly
this shape — so `SnapshotEnvelope.entities` and the on-disk envelope share one
identical, defined type rather than two independently-drifting shapes.

**Validation-before-derivation rule (consumer side, FR-034)**: A consumer
loading an envelope for path-ownership matching MUST check, in this order,
stopping at the first failure: (1) valid JSON; (2) the **complete** §1 shape
is present with every field the correct JSON type at **every** nesting level —
not only the top level: each `SnapshotEntityRecord` has `identity`
(an object with a string `canonicalId` and a non-empty `allRefs` string
array), a recognized `ownershipState`, a `derivedPaths` string array, a
`sourceDocument` object (string `sourcePath`, integer `documentIndexInFile`),
and a recognized `provenance`; `sources` is an array of objects each with a
string `path` and `digestAlgorithm` (per-source digest completeness/match is
step (4), not here); `completeness` is
`{ wholeCatalog, identityOnly }`; (3) the value-level contract is exact, not
merely "recognized": `schemaVersion === "1"`; `globDialect` deep-equals
`{ engine: "picomatch", version: "4.0.5", options: { dot: false, nocase: false, nonegate: true } }`
(an `engine` of `"minimatch"`, a `version` other than `"4.0.5"`, or an
`options` object with `dot: true`/`nocase: true`/`nonegate: false` all fail
here — a `version`-only check is insufficient); and `capabilities` deep-equals
the exact tuple `["pathOwnership"]` (an empty array `[]`, an extra element, or
any other string all fail — a per-entry membership check is insufficient); (4)
every `sources` entry has a **present**, correctly-typed `digest` that matches
its listed path (a structurally well-formed entry that **omits** its digest is
the `missing-source-digest` malformation, caught only here); (5)
`completeness.identityOnly === false` (a `true` value is an outright
rejection for path-ownership matching purposes, per FR-034's "one, precisely
defined signal"). Whether a given envelope is partial/identity-only for
path-ownership matching is determined **solely** from this one boolean field
— never inferred from scanning the entity list's ownership-state
distribution. **Only after (1)–(5) all pass** does the consumer proceed to
(6) digest verification (`TamperCheckResult`, §10), (7) staleness check
(`StalenessAndIdentityCheckResult`, §11), and (8) repository-identity check
(`StalenessAndIdentityCheckResult`, §11). Steps (1)–(5) never depend on, and
always precede, steps (6)–(8) — a malformed envelope is rejected before its
digest, revision, or repository identity is ever inspected (User Story 7
Acceptance Scenario 1).

## 10. TamperCheckResult — Entity

One consumer-side digest verification outcome (ADR-0012's atomicity
philosophy extended by FR-035; User Story 7 Acceptance Scenario 2).

| Field | Type | Notes |
|---|---|---|
| `declaredDigest` | `string` | `SnapshotEnvelope.digest` as read from the file. |
| `recomputedDigest` | `string` | Independently recomputed by the consumer over the same canonicalization (`research.md` R4), never trusted from the file. |
| `outcome` | `"match"` \| `"tampered"` | `"tampered"` on any inequality; this MUST be rejected non-zero, naming the mismatch — never silently trusted. |
| `guaranteeScope` | `"accidental-corruption-and-naive-mutation-only"` (fixed literal) | Present so no reader of the evidence bundle mistakes this check for adversarial cryptographic tamper-resistance, which FR-035 explicitly leaves as a separate, later, open question this spike does not attempt. |

## 11. StalenessAndIdentityCheckResult — Entity

The three consumer-configuration checks User Story 7 requires beyond the
digest (FR-036, FR-037, FR-038).

| Field | Type | Notes |
|---|---|---|
| `consumerExpectedRevision` | `string` \| `undefined` | The consumer's separately-configured expected-current revision for a given repository ID, if configured at all (FR-036 is conditional on this being set). |
| `envelopeRevision` | `string` | `SnapshotEnvelope.repository.revision`. |
| `stalenessOutcome` | `"current"` \| `"stale"` \| `"not-configured"` | `"stale"` on **exact inequality** with `consumerExpectedRevision` — never a chronological "older/newer" comparison, since opaque commit SHAs carry no ordering this spike can determine (FR-036). `"not-configured"` when the consumer has no expected revision set for that repository ID. |
| `consumerExpectedRepositoryId` | `string` | The one specific repository ID a single-repository-scoped consumer is configured to expect (FR-037). |
| `envelopeRepositoryId` | `string` | `SnapshotEnvelope.repository.id`. |
| `identityOutcome` | `"expected"` \| `"unexpected-repository"` | `"unexpected-repository"` triggers an outright rejection, non-zero, naming the mismatch (FR-037) — distinct from the multi-envelope query-isolation case (§12), which never rejects either envelope. |

## 12. RepositoryIsolationCheck — Entity

The multi-envelope query-isolation property (FR-038; User Story 7 Acceptance
Scenario 5) — an *acceptance-and-correct-filtering* property, never a
rejection.

| Field | Type | Notes |
|---|---|---|
| `envelopeA` | `SnapshotEnvelope` reference (§9) | One independently-generated, individually-valid single-repository envelope. |
| `envelopeB` | `SnapshotEnvelope` reference (§9) | A second, distinct-repository, independently-generated, individually-valid single-repository envelope. Neither is a merged or federated snapshot of the other (FR-009/FR-038 both remain unaffected). |
| `queryScopedToRepositoryId` | `string` | Equal to `envelopeA.repository.id` for this spike's one required test direction. |
| `returnedEntityProvenanceIds` | `string[]` | The repository IDs the query's returned entities actually originated from. |
| `outcome` | `"isolated"` \| `"leaked"` | `"isolated"` iff every value in `returnedEntityProvenanceIds` equals `queryScopedToRepositoryId`; any `envelopeB`-originated entity in the result is `"leaked"`, an `SC-014`/`no-go`-triggering failure. Both `envelopeA` and `envelopeB` remain accepted regardless of `outcome` — this check never rejects an envelope; it only checks query correctness. |

## 13. ComparisonHeuristicMeasurement — Entity

One Option B or Option C measurement row, at either the real-corpus
(cardinality/collision) or synthetic (precision) level (ADR-0012 "Heuristics
are not defaults"; FR-002, FR-011; User Story 3).

| Field | Type | Notes |
|---|---|---|
| `heuristic` | `"descriptor-parent"` \| `"repository-root"` | Options B and C, respectively. |
| `authoritativeLabel` | `"non-authoritative"` (fixed literal) | Present on every row, unconditionally — FR-002's "every report row produced by either MUST carry an explicit non-authoritative label." |
| `measurementLevel` | `"real-corpus-cardinality"` \| `"synthetic-precision"` | The two distinct evidence classes User Story 3 requires — never conflated. |
| `corpusOrFixtureSet` | `"community-plugins"` \| `"rhdh-plugins"` \| `"synthetic-labeled-matrix"` | Which input this row measures. |
| `candidatePathGlob` | `string` \| `undefined` | Present at `measurementLevel === "real-corpus-cardinality"` only: the derived candidate glob (a descriptor's parent-directory glob for B, or `**` for C). |
| `collisionCount` | `number` \| `undefined` | Present at `"real-corpus-cardinality"` only: how many other entities in the same corpus received an identical candidate glob (User Story 3 Acceptance Scenarios 1–3). |
| `precision` | `number` \| `"undefined-for-this-heuristic-on-this-matrix"` \| `undefined` | Present at `"synthetic-precision"` only: `TP / (TP + FP)`, or the literal string when `TP + FP === 0` (never a divide-by-zero, never silently omitted). |
| `falsePositiveRate` | `number` \| `"undefined-for-this-heuristic-on-this-matrix"` \| `undefined` | Present at `"synthetic-precision"` only: `FP / (FP + TN)`, same zero-denominator handling. |

## 14. LabeledEntityChangedFilePair — Entity

One row of User Story 3's spike-authored ground-truth matrix (FR-011).

| Field | Type | Notes |
|---|---|---|
| `entityCanonicalId` | `string` | |
| `changedFilePath` | `string` | |
| `groundTruthLabel` | `boolean` | Assigned by the fixture's own construction, never derived from any heuristic — "this entity truly owns this file." |
| `heuristicPrediction` | `Record<"descriptor-parent" \| "repository-root", boolean>` | What each heuristic predicts for this exact pair. |
| `classification` | `Record<"descriptor-parent" \| "repository-root", "TP" \| "FP" \| "TN" \| "FN">` | Derived: `groundTruthLabel === true && prediction === true` → `TP`; `false && true` → `FP`; `false && false` → `TN`; `true && false` → `FN`. |

## 15. IdentityOnlyEntity — Entity

An Option D entity — canonical identity with no path binding attached
(ADR-0012 "Heuristics are not defaults"; FR-012; User Story 4).

| Field | Type | Notes |
|---|---|---|
| `identity` | `CanonicalEntityIdentity` (§7) | |
| `rawCoreReturnValue` | `{ matched: false }` (fixed literal shape) | **The literal, unmodified return value** of `matchEntityPattern` (`packages/core/src/affects/inert.ts`)'s `EntityMatcherResult` (`{ matched: boolean; unresolvable?: boolean }`) when this entity's `paths` is empty or omitted: `{ matched: false }`, with the `unresolvable` key **absent** (`undefined`), not explicitly present as `false` — core's own code only ever sets `unresolvable: true` when the catalog snapshot itself is undefined (`packages/core/src/affects/inert.ts`'s `matchEntityPattern`, the `if (!catalog)` branch); it never sets `unresolvable: false` explicitly. This is the exact object shape a future execution session must observe from calling the real, unmodified function — never a claim this spike invents beyond what the code actually returns. |
| `unresolvableFindingAttached` | `false` (fixed literal) | **This spike's own derived evidence-bundle diagnostic**, not part of `rawCoreReturnValue` itself: since `rawCoreReturnValue.unresolvable` is `undefined` (absent) rather than `true`, no `affects-unresolvable`-class finding was attached to this non-match. This field exists so the evidence bundle can state that fact explicitly in a machine-checkable way; it is evidence-bundle metadata layered on top of the raw return value, never a field the core function itself returns. |

## 16. StructuralEdgeCaseFixture — Entity

The three required synthetic structural fixtures (FR-013; User Story 5).

| Field | Type | Notes |
|---|---|---|
| `fixtureKind` | `"multi-document"` \| `"duplicate-yaml-key"` \| `"location-not-followed"` | |
| `isSynthetic` | `true` (fixed literal) | Always `true`. For `fixtureKind` `"multi-document"` and `"location-not-followed"`: A3 confirms neither pinned corpus, as sampled, was found to contain the shape. For `fixtureKind` `"duplicate-yaml-key"`: A3 is more precise than "confirmed absent" — duplicate-YAML-key descriptors were **not separately searched for at all** (A3's own wording: "a well-formed public corpus is unlikely to contain one," an assumption, not a confirmed-absent finding), so this spike must not assume the assumption remains true without checking at execution time. All three fixtures are required regardless of what execution-time re-checking finds; if a real example of either the multi-document or `Location` shape is later discovered, it is recorded as an *additional*, separate `DescriptorDocument` with `isSynthetic: false` context in the evidence narrative, never substituted for this required synthetic fixture (A3). |
| `outcome` | `"both-entities-parsed-independently"` \| `"rejected-duplicate-key"` \| `"zero-derived-paths-never-read"` | The one unambiguous outcome each fixture kind must produce (SC-009) — never a silent skip. |

## 17. DotfilePolicyConfirmation — Entity

The direct-execution confirmation of the hardened dotfile policy (FR-017;
User Story 5 Acceptance Scenario 4).

| Field | Type | Notes |
|---|---|---|
| `pattern` | `string` | e.g. `".github/**"` or a bare `"**"`/`"packages/**"`. |
| `changedFilePath` | `string` | e.g. `".github/workflows/ci.yml"`. |
| `picomatchResult` | `boolean` | Direct `picomatch(pattern, { dot: false, nocase: false, nonegate: true })(changedFilePath)` result. |
| `isExistingBehaviorNotNewCode` | `true` (fixed literal) | Always `true` — this confirms `picomatch`'s own native `dot:false` behavior, not a design choice either existing core matcher had to make (FR-017). |
| `sourceLevelParityClaim` | `"behavioral-parity-for-tested-cases-only"` (fixed literal) | Present so no reader mistakes this for a claim that `path.ts` and `inert.ts` are identical at the source-code level — `path.ts` carries its own additional, redundant `hasDotSegment`/`patternAllowsDotSegment` guard `inert.ts` lacks (FR-017). |

## 18. ScaleEvidenceRecord — Entity

Per-pass and aggregated measurement data (FR-023; `research.md` R10; SC-010).

| Field | Type | Notes |
|---|---|---|
| `pass` | `"community-plugins"` \| `"rhdh-plugins"` \| `"synthetic"` | |
| `annotationBytesTotal` | `number` | `0` for both real-corpus passes (neither carries the annotation). |
| `entityCount` | `number` | |
| `patternsPerEntity` | `{ min: number; max: number; mean: number }` | |
| `maxPatternLength` | `number` | |
| `multiDocumentFileCount` | `number` | |
| `aliasRefCount` | `number` | Always `0` for real-corpus passes (aliases are fixture-authored only, per `CanonicalEntityIdentity` §7). |
| `compileMatchCostMs` | `{ retainedIterations: number[]; medianMs: number; environment: string }` | `retainedIterations` excludes the discarded warm-up (`research.md` R10); `environment` names host OS/CPU/runtime version. |
| `productionLimitProposed` | `false` (fixed literal) | Always `false` — FR-023 forbids proposing a specific production scale limit from this evidence alone. |

## 19. StandaloneScratchRepository — Entity

The disposable, independently-configurable git repository User Story 2's
repository-mismatch tests require (`research.md` R2 item 2; A4; A7).

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | Absolute path, outside any git-tracked clone of `mbeacom/adrkit`. |
| `isLinkedWorktreeOfThisRepo` | `false` (fixed literal) | MUST be `false` for every instance — a `true` value here is itself a spike defect, since a linked worktree cannot be independently varied (A7). |
| `configuredOriginUrl` | `string` | The `git remote add origin <url>` value this instance was deliberately configured with for its specific test case. |
| `headCommitSha` | `string` | This instance's actual `git rev-parse HEAD` at test time. |
| `purpose` | `"repository-match-case"` \| `"repository-mismatch-case"` \| `"second-repository-for-isolation-check"` | Which User Story 2 or User Story 7 test case this instance serves (A4). |

## 20. NetworkDenialRecord — Entity

Which of the two genuinely-blocking mechanisms `contracts/scale-and-security-measurement.md`
§5 requires was actually used (FR-018; SC-011) — narrowed from
`specs/008-spec-kit-hook-viability/data-model.md` §4's own three-tier shape
for this project's sibling spike, per the reader-test finding that a
"static-review-only" tier cannot itself satisfy FR-018's "actively denied"
requirement (`research.md` R10).

| Field | Type | Notes |
|---|---|---|
| `mechanismUsed` | `"os-namespace-or-firewall"` \| `"process-level-syscall-sandbox"` | Exactly one of the two mechanisms that actually block a network syscall from succeeding — never `"allowlisted-env-plus-static-review"` as the sole recorded mechanism (that check, if performed at all, is recorded only as a supplementary corroboration, not as this field's value). |
| `supplementaryStaticReview` | `boolean` | Whether an allowlisted-environment-plus-static-source-review corroboration was **additionally** performed alongside `mechanismUsed`. Never a substitute for it. |
| `configurationStatement` | `string` | Required, non-empty; the actual configuration used (e.g. the specific namespace/firewall rule or sandbox profile), not a generic description. |
| `appliedToInvocations` | `string[]` | Which derivation runs/passes this mechanism covered; empty array is invalid. |


## 21. MutationBaseline — Entity

One before/after `git status --porcelain` pair for a single derivation run
(FR-018; SC-011) — reusing the same shape
`specs/008-spec-kit-hook-viability/data-model.md` §5 already defined.

| Field | Type | Notes |
|---|---|---|
| `invocationLabel` | `string` | e.g. `"community-plugins-pass"`, `"rhdh-plugins-pass"`, `"synthetic-pass"`, `"repository-mismatch-test"`, `"malformed-envelope-probe"`. |
| `statusBefore` | `string` | Raw `git status --porcelain=v1`, captured immediately before. |
| `statusAfter` | `string` | Same, immediately after. |
| `identical` | `boolean` | Computed: `statusBefore === statusAfter`. A `false` value here is an FR-019 violation and an `SC-012`/`no-go`-triggering finding. |

## 21.5. FrozenMaintainerReferenceOracle — Pre-Bundle Prerequisite

The oracle is not a tracked runtime schema and is not embedded as a seventeenth
`EvidenceBundle` field. It is a scratch evidence artifact that MUST be created
and independently audited before any generator output is produced, so later
outputs cannot fit the labels. It is built from FR-001's pinned public corpora
plus maintainer-authored synthetic explicit `adrkit.io/owned-paths` annotations.

| Field | Type | Notes |
|---|---|---|
| `createdBeforeGeneratorOutput` | `true` | Fixed literal; a false value invalidates `go-explicit`. |
| `independentlyAuditedBeforeGeneratorOutput` | `true` | Fixed literal; records the adversarial review of labels before any generator result exists. |
| `sourceCorpora` | `ArtifactFileReference[]` | References the FR-001 pinned corpora inputs and their content hashes. |
| `syntheticAnnotations` | `ArtifactFileReference[]` | Maintainer-authored explicit `adrkit.io/owned-paths` annotations used to label cases. |
| `caseClasses` | `["positive", "negative", "overlap", "absent-empty", "collision-duplicate-canonical-id", "repository-mismatch"]` | Exact bounded case classes required by FR-025. |
| `expectedFalsePositiveCount` | `0` | Required over the bounded labeled oracle cases. |
| `expectedFalseNegativeCount` | `0` | Required over the bounded labeled oracle cases. |

## 22. EvidenceBundle — Entity

The complete, cross-referenced record this spike produces (spec.md Key
Entities "Evidence Bundle"; FR-019 through FR-038 collectively). This is the
spike's actual deliverable.

**One representation, chosen explicitly (never "embedded *or* referenced").**
`spike-009-evidence.json` is a top-level **manifest**. Every component artifact
an earlier task writes to its own standalone file (`research.md` R3) is
**referenced** here — never re-embedded — via an
**`ArtifactFileReference` = `{ relativePath: string; sha256: string }`** (or an
object/array of them): the relative path of the on-disk artifact plus the
SHA-256 of its bytes, so each artifact stays independently diffable and the
manifest stays legible. The only fields embedded **inline** are (a) the
`verdict`, which is computed into this file itself, and (b) the two User Story 7
result records (`envelopeRejectionResults`, `repositoryIsolationCheck`) that
have no standalone file of their own — and even those reference their fixture
files rather than embedding them. No field is ever both embedded and referenced
for the same artifact; no large typed artifact is restated field-for-field
inside the bundle.

| Field | Kind | Type | Notes |
|---|---|---|---|
| `parsingValidationResults` | reference | `ArtifactFileReference` | `parsing-validation-results.json` (`research.md` R3): User Story 1's complete fixture-by-fixture `{ pattern: RestrictedGlobPattern; annotation: OwnedPathsAnnotation }[]` (§1, §2). |
| `identityCanonicalizationResults` | reference | `ArtifactFileReference` | `identity-canonicalization-results.json`: `CanonicalEntityIdentity[]` (§7), incl. the case-only-duplicate and default-namespace scenarios. |
| `atomicFailureRecords` | reference | `ArtifactFileReference` | `atomic-failure-records.json`: `AtomicFailureRecord[]` (§6), User Story 2's whole-operation failure proofs. |
| `repositoryIdentityChecks` | reference | `ArtifactFileReference` | `repository-identity-checks.json`: `RepositoryIdentityCheck[]` (§4) — the repository/revision **match and mismatch** cases (FR-009). The FR-033 manifest-version/capability rejections are **not** `RepositoryIdentityCheck`s; they are recorded in `atomicFailureRecords` above. |
| `identityOnlyResults` | reference | `ArtifactFileReference` | `identity-only-results.json`: `IdentityOnlyEntity[]` (§15), User Story 4. |
| `structuralEdgeCaseFixtures` | reference | `ArtifactFileReference` | `structural-edge-case-fixtures.json`: `StructuralEdgeCaseFixture[]` (§16), User Story 5, all three kinds. |
| `dotfilePolicyConfirmation` | reference | `ArtifactFileReference` | `dotfile-policy-confirmation.json`: `DotfilePolicyConfirmation` (§17), User Story 5 Acceptance Scenario 4. |
| `inputManifests` | reference | `{ communityPlugins: ArtifactFileReference; rhdhPlugins: ArtifactFileReference; synthetic: ArtifactFileReference }` | The three FR-009/FR-033 input manifests (`input-manifest.{community-plugins,rhdh-plugins,synthetic}.json`, `research.md` R3), by relative path + digest — never embedded. |
| `envelopes` | reference | `{ communityPlugins: ArtifactFileReference; rhdhPlugins: ArtifactFileReference; synthetic: ArtifactFileReference }` | The three required FR-022 envelopes (`snapshot-envelope.*.json`), by relative path + digest — never merged, never embedded. |
| `comparisonMatrix` | reference | `ArtifactFileReference` | `comparison-matrix.json` (`research.md` R3): User Story 3's labeled entity × changed-file matrix (`LabeledEntityChangedFilePair[]`, §14) **and** the B/C measurements (`ComparisonHeuristicMeasurement[]`, §13) at both levels. Both live in that one file; the bundle references it rather than restating either array inline. |
| `scaleEvidence` | reference | `ArtifactFileReference` | `scale-evidence.json` (`research.md` R3): FR-023's per-pass `ScaleEvidenceRecord`s (§18) for all three passes. |
| `envelopeRejectionResults` | inline (each result referencing its fixture file) | `{ malformed: MalformedEnvelopeRejectionResult[]; tampered: TamperCheckResult & { fixtureRef: ArtifactFileReference }; stale: StalenessAndIdentityCheckResult & { fixtureRef: ArtifactFileReference }; wrongRepository: StalenessAndIdentityCheckResult & { fixtureRef: ArtifactFileReference } }` | User Story 7's rejection cases (FR-034–FR-037); no standalone results file, so the small result records are inline while each references its own fixture file. **`malformed` is an array with one instance per malformation kind** (five kinds), because the kinds are mutually exclusive (one is syntactically invalid JSON) and cannot share a single envelope file. `MalformedEnvelopeRejectionResult` (mechanically checkable, never `unknown`) is `{ malformationKind: "invalid-json" \| "missing-or-wrong-required-field" \| "unrecognized-schema-or-dialect-or-capability" \| "missing-source-digest" \| "identity-only-true"; exitCodeNonZero: true; rejectedBeforeDigestCheck: true; rejectedBeforeRevisionCheck: true; rejectedBeforeRepositoryIdentityCheck: true; fixtureRef: ArtifactFileReference }` — the five kinds map 1:1 to `contracts/snapshot-envelope.md` §2's five validation steps (1 invalid JSON, 2 missing/wrong field, 3 unrecognized dialect/capability, 4 missing source digest, 5 `identityOnly: true`), each `fixtureRef` pointing at its own separate `envelope-fixtures/malformed-*.json` file, each proving the exact validation-before-derivation order via its three `rejectedBefore*` fields, all fixed `true`. |
| `repositoryIsolationCheck` | inline (referencing its fixture file) | `RepositoryIsolationCheck` (§12) `& { secondRepositoryEnvelopeRef: ArtifactFileReference }` | FR-038; the inline check result (no standalone file) plus a reference to `envelope-fixtures/second-repository.json`. |
| `networkDenial` | reference | `ArtifactFileReference` | `network-denial.json` (`research.md` R3): `NetworkDenialRecord` (§20). |
| `mutationBaselines` | reference | `ArtifactFileReference` | `mutation-baselines.json` (`research.md` R3): the `MutationBaseline[]` (§21) records — each with `invocationLabel`, `statusBefore`, `statusAfter`, and the computed `identical` boolean the verdict's no-go check reads (`contracts/evidence-bundle-and-verdict.md` §2) — which in turn reference the raw `git-status-captures/*.txt` pairs. |
| `verdict` | inline | `Verdict` (§23) | Computed last, from every field above; embedded directly in this file. |

**Cross-referencing rule (mirroring `specs/008-...`'s FR-019 pattern)**:
`Verdict.drivingEvidence` MUST list, by field name from this table, every
`EvidenceBundle` field that determined the verdict. A bundle missing any
required field above is **incomplete** and MUST NOT have a `verdict` recorded
against it. There are **16** required top-level fields (the count
`contracts/evidence-bundle-and-verdict.md` §1 states).

## 23. Verdict — Entity

Exactly one of three enumerated outcomes (spec.md Key Entities "Verdict";
SC-012; `research.md` R12's structural encoding of that precedence).

| Field | Type | Notes |
|---|---|---|
| `outcome` | `"no-go"` \| `"go-explicit"` \| `"blocked"` | Exhaustive and mutually exclusive by SC-012's own fixed-precedence rule. |
| `precedenceEvaluationOrder` | `["no-go", "go-explicit", "blocked"]` (fixed literal array) | Documents the checked order structurally: `no-go` checked first and dominates; `go-explicit` checked second; `blocked` is the exhaustive fallback. |
| `drivingEvidence` | `string[]` | Non-empty. `EvidenceBundle` (§22) field names that determined `outcome`. |
| `noGoTrigger` | `string` \| `null` | If `outcome === "no-go"`: one of `"tracked-file-mutation"`, `"network-or-credentialed-access"`, `"atomicity-failed"`, `"repository-mismatch-not-enforced"`, `"invalid-pattern-silently-accepted"`, `"envelope-rejection-check-failed"`, `"repository-isolation-failed"`, `"non-deterministic-output"`. `null` otherwise. |
| `blockedShortfall` | `string` \| `null` | If `outcome === "blocked"`: one of `"synthetic-precision-comparison-incomplete"`, `"structural-fixture-ambiguous"`, `"envelope-or-scale-evidence-incomplete"`, `"default-namespace-canonicalization-unverified"`, or a free-text description of another non-unsafe shortfall. `null` otherwise. |
| `externalMaturityDistinctionStatement` | `string` (fixed template) | Present on **every** verdict regardless of `outcome`: states that none of the three outcomes is, or substitutes for, the optional externally-validated maturity or external / community validation (ADR-0014 rung 3) (SC-012/FR-025). |
| `gateDisclaimers` | `{ phase6NotCausedByThisSpike: true; externalCommunityValidationNotClaimed: true; governancePreconditionsAlreadySatisfiedIndependently: true; independentAdopterEvidenceOptionalLaterMaturity: true }` (fixed literal shape) | SC-013's required disclaimers, present unconditionally regardless of `outcome` — never omitted, never contingent on which verdict was reached. |
| `recommendation` | `NonBindingRecommendation` (§24) \| `null` | Required (non-null) only when `outcome === "go-explicit"` (FR-026); `null` for `"no-go"` and `"blocked"`. |

**Validation rules** (structural encoding of SC-012's precedence):

1. If any of: a tracked-file mutation occurred, network/credentialed/live-API
   access occurred during a derivation run, whole-operation atomicity failed
   in any tested case, repository-mismatch abort did not hold, any
   invalid-pattern/invalid-shape class was silently accepted, any
   malformed/tampered/stale/misidentified-repository envelope check failed to
   reject an envelope that should have been rejected, the repository-isolation
   check itself failed, or Option A's output was not byte-identical across
   repeated runs within a single-repository pass — THEN `outcome` MUST be
   `"no-go"`, regardless of every other field.
2. Else, if every acceptance scenario in User Stories 1–7 passed exactly as
   specified — THEN `outcome` MUST be `"go-explicit"`.
3. Else — THEN `outcome` MUST be `"blocked"`. This branch is exhaustive: a
   well-formed `EvidenceBundle` cannot reach this point and fail all three
   rules.

## 24. NonBindingRecommendation — Entity

The "smallest later production slice" note (spec.md Output Recommendation
section; FR-026).

| Field | Type | Notes |
|---|---|---|
| `bindingStatus` | `"non-binding"` (fixed literal) | Present so this can never be read as an authorized task list. |
| `minimalScopeDescription` | `string` | Free text, e.g. "an offline `packages/adapters/catalog-backstage` generator limited to Option A alone, reading only a local input manifest, writing only the versioned envelope." |
| `releaseVehicleDecision` | `null` (fixed literal) | **MUST always be `null`.** Mirrors `specs/008-...` `data-model.md` §8's identical field: this recommendation never decides the eventual production package's publish target, npm name, or ship timeline (FR-026). |
| `externalMaturityDisclaimer` | `string` (fixed template) | States explicitly that this recommendation, even if `outcome === "go-explicit"`, does not itself satisfy external / community validation (ADR-0014 rung 3), optional later external-adopter maturity evidence, or the optional externally-validated maturity (FR-025/FR-026). |
| `productionAuthorizationClaimed` | `false` (fixed literal) | Always `false` — a positively-named flag whose literal `false` reads plainly as "this recommendation does not claim production authorization." (Renamed from the earlier double-negative `noProductionAuthorizationClaim: false`, which inverted its own meaning — "it is false that there is no authorization claim" — and could be machine-misread as *asserting* a claim.) This recommendation MUST NOT authorize or schedule a `packages/adapters/catalog-backstage` implementation (FR-026). |

## 25. Entity Relationship Summary

```text
OwnedPathsAnnotation ──┐
RestrictedGlobPattern ──┤
CanonicalEntityIdentity ┼──▶ CatalogEntityRecord ──┐
DescriptorDocument ─────┘                          │
                                                    ▼
InputManifest ──▶ RepositoryIdentityCheck ──▶ SnapshotEnvelope ──┐
                                                                  │
ComparisonHeuristicMeasurement ◀── LabeledEntityChangedFilePair  │
IdentityOnlyEntity                                               │
StructuralEdgeCaseFixture                                        │
DotfilePolicyConfirmation                                        │
ScaleEvidenceRecord                                              │
StandaloneScratchRepository                                      │
                                                                  ▼
SnapshotEnvelope ──▶ TamperCheckResult ──┐
                 ──▶ StalenessAndIdentityCheckResult ─┤
                 ──▶ RepositoryIsolationCheck ─────────┤
                                                        ▼
NetworkDenialRecord ──┐                          EvidenceBundle ──▶ Verdict ──▶ NonBindingRecommendation
MutationBaseline[] ───┘                                                    (or null, if outcome !== "go-explicit")
```

Every arrow is a "feeds into, never mutates" relationship, mirroring
`specs/008-spec-kit-hook-viability/data-model.md` §10's own convention:
`Verdict` is computed once, at the end, from a fully-populated
`EvidenceBundle`; no field is ever partially written back to after the
verdict is recorded.
