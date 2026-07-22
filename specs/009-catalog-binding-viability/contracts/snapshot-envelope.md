# Contract: Versioned Snapshot Envelope — Shape, Validation-Before-Derivation, Canonicalization/Digest, and Stale/Tamper/Mismatch Rejection

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-022, FR-034,
FR-035, FR-036, FR-037, FR-038, User Story 6 (all 3 acceptance scenarios),
User Story 7 (all 6 acceptance scenarios), SC-010, SC-014. Companion to
`data-model.md` §9 (`SnapshotEnvelope`), §10 (`TamperCheckResult`), §11
(`StalenessAndIdentityCheckResult`), §12 (`RepositoryIsolationCheck`).
Normative source: ADR-0012 "Composition, envelope, and persistence" and the
Ratification Record's Evidence Gate.

## 1. Envelope Shape (One Per FR-009 Pass — Never Merged)

```json
{
  "schemaVersion": "1",
  "repository": { "id": "github.com/mbeacom/adrkit-spike-fixture", "revision": "<40-hex-sha>" },
  "generatorVersion": "009-spike-0.1.0",
  "globDialect": { "engine": "picomatch", "version": "4.0.5", "options": { "dot": false, "nocase": false, "nonegate": true } },
  "capabilities": ["pathOwnership"],
  "completeness": { "wholeCatalog": false, "identityOnly": false },
  "sources": [ { "path": "catalog-info.yaml", "digestAlgorithm": "sha256", "digest": "<64-hex>" } ],
  "entities": [
    {
      "identity": {
        "canonicalId": "component:default/payments",
        "allRefs": ["component:default/payments"]
      },
      "ownershipState": "explicit-paths",
      "derivedPaths": ["apis/payments/**", "packages/payments/**"],
      "provenance": "synthetic"
    }
  ],
  "digest": "<64-hex, SHA-256 over the canonical form of every field above except this one>"
}
```

**This `entities[]` shape is exactly `data-model.md` §8's `CatalogEntityRecord`
type, field for field** — `identity.canonicalId`/`identity.allRefs` (§7
`CanonicalEntityIdentity`), `ownershipState`, `derivedPaths`, and
`provenance` — never a separate, flatter `canonicalId`/`refs`/`paths` shape.
A future execution session's actual serialization MUST use this nested
`identity` object, not a flattened one, so `SnapshotEnvelope.entities` and
`EvidenceBundle`'s other `CatalogEntityRecord`-typed fields
(`data-model.md` §22) share one identical type rather than two
independently-drifting shapes for the same underlying record.

**Exactly three envelopes are a required spike deliverable** (SC-010): one
each for the community-plugins-derived pass, the rhdh-plugins-derived pass,
and the primary synthetic pass (FR-009/User Story 6). Beyond those three,
User Story 7 requires **five more** envelope-shaped JSON artifacts, all
derived from (never replacing) the three required envelopes above: four
rejection-case derivatives of the synthetic pass's envelope (malformed,
tampered, stale, wrong-repository — `research.md` R3's
`envelope-fixtures/malformed.json`/`tampered.json`/`stale.json`/
`wrong-repository.json`) and one independently-generated second-repository
envelope for the repository-isolation check (`data-model.md` §12;
`research.md` R3's `envelope-fixtures/second-repository.json`) — **eight
envelope-shaped JSON artifacts in total** across the whole evidence bundle,
never more than one repository per envelope file, and never fewer than the
three SC-010 requires as freestanding, independently-generated artifacts in
their own right (the five derivative/second-repository files exist
*in addition to*, not *instead of*, those three).

**This is a new, separate artifact** (FR-020): it is never added as a field
on the existing `CatalogSnapshot`/`CatalogSnapshotEntity` types
(`packages/core/src/affects/catalog.ts`), and it never becomes part of any
published schema.

## 2. Consumer-Side Validation-Before-Derivation Order (FR-034)

A consumer loading an envelope for path-ownership matching MUST check, in
**exactly** this order, rejecting non-zero and naming the specific reason at
the first failure — never attempting any digest, revision, or
repository-identity check before every one of these passes:

1. Valid JSON (parses at all).
2. Every field in §1's shape present with the correct JSON type (e.g.
   `entities` is an array, not present with the wrong type).
3. `schemaVersion`, `globDialect.version`, and every `capabilities` entry are
   recognized by this consumer.
4. Every `sources[]` entry has a corresponding digest for its listed path
   (a missing digest for one of the envelope's own listed sources is an
   incomplete-envelope rejection).
5. `completeness.identityOnly === false`. If `true`, reject outright as
   partial/identity-only for path-ownership matching purposes — **this is
   the one, precisely-defined signal**; whether an envelope is
   partial/identity-only is determined **solely** from this boolean field,
   **never** by scanning the entity list's `ownershipState` distribution. An
   envelope whose entities all happen to be `annotation-absent`, with
   `completeness.identityOnly: false`, is **not** rejected on that basis —
   absent annotations are a valid, expected state (no descriptor in either
   real corpus has adopted `adrkit.io/owned-paths` yet, but Option A
   derivation was genuinely attempted for every entity).

**Only after steps 1–5 all pass** does the consumer proceed to §3 (digest),
§4 (staleness), and §5 (repository identity) below.

## 3. Canonicalization and Digest Scope (FR-035)

**Algorithm** (`research.md` R4 — reusing `packages/core/src/fingerprint/index.ts`'s
`canonicalStringify` pattern, never a new general RFC 8785 library dependency):

1. Take the complete envelope object, **including `schemaVersion`** and
   **every** other field, **excluding only the `digest` field itself**.
2. Canonicalize: recursively sort object keys at every nesting level by
   code-unit order (`compareCodeUnits`); serialize arrays in their existing
   declaration order (never re-sorted); use compact separators (no
   insignificant whitespace); omit any `undefined` field.
3. Compute SHA-256 over the UTF-8 bytes of that canonical string; encode as
   64 lowercase hex characters. This is the `digest` field's value.

For the envelope's closed scalar value domain (strings, booleans, null, and bounded
non-negative integers), these bytes are equivalent to RFC 8785/JCS output. The operative
contract remains the three steps above; no claim is made that `canonicalStringify` is a
general-purpose RFC 8785 implementation for arbitrary JSON values.

**Worked example** (illustrative, not the literal production values):

```text
Envelope (before canonicalization, informal):
{ "capabilities": ["pathOwnership"], "schemaVersion": "1", "repository": {"revision": "abc...", "id": "github.com/x/y"} }

Canonical form (keys sorted at every level; digest field itself excluded):
{"capabilities":["pathOwnership"],"repository":{"id":"github.com/x/y","revision":"abc..."},"schemaVersion":"1"}

digest = sha256_hex(utf8_bytes(canonical_form_above))
```

A consumer MUST **independently recompute** this digest and compare it
against the envelope's declared `digest` value **before trusting any
entity's `paths`** — never trusting the declared value unconditionally.

**Guarantee scope, precisely stated (FR-035)**: this digest proves
**accidental-corruption and naive-mutation detection only**. It does
**not** resist an adversary who mutates content and also recomputes the same
digest algorithm — a stronger, cryptographically-signed tamper-evidence
mechanism (with its own key-management, trust-anchor, and
deterministic-output design questions) is an **explicitly open question**
this spike does not attempt, left to a separate, later production-scoping
decision. Every reference to this digest check in the evidence bundle MUST
carry this scope statement — never overclaim adversarial tamper-resistance.

## 4. Staleness — Exact Inequality, Not Chronological Comparison (FR-036)

A consumer MAY be configured with an expected-current revision for a given
repository ID. Because commit SHAs are opaque identifiers with no ordering
available to this spike without separate git-ancestry data (explicitly out
of scope), **"stale" means exact inequality**: when so configured, an
envelope declaring **any** revision other than the exact configured
expected-current revision for that same repository ID MUST be rejected as
stale, non-zero, naming the revision mismatch. This is never a "this
revision is older than expected" chronological judgment.

**Isolation from the digest check**: the stale-envelope test fixture's own
digest MUST be recomputed over its own actual (mutated-revision) content, so
it passes §3's digest check cleanly — the subsequent rejection is then
attributable specifically to staleness, never to a coincidental digest
failure (User Story 7, Acceptance Scenario 3).

## 5. Repository Identity Mismatch — Outright Rejection (FR-037)

A consumer configured with one specific expected repository ID MUST reject,
non-zero, naming the mismatch, any envelope declaring a **different**
repository ID — again with that fixture's digest independently recomputed
over its own actual content first, so the digest check passes and the
rejection is attributable specifically to identity mismatch (User Story 7,
Acceptance Scenario 4). This is a **rejection** by a consumer that expected
exactly one repository — never to be confused with §6's repository-isolation
case, which is never a rejection.

## 6. Repository Isolation — Acceptance, Not Rejection (FR-038)

A tool legitimately holding two or more independently-generated,
individually-valid single-repository envelopes at once (an index across
several repositories' already-generated snapshots, for example) MUST NOT let
a query scoped to one repository ID return any entity that actually
originated from another repository's envelope. **Neither envelope is
rejected in this case; both remain independently valid.** Isolation is a
property of the **query**, not an error condition — this is the precise line
separating §5 (mismatch-and-reject, for a consumer that expected exactly one
repository) from this section (filter-and-isolate, for a consumer
deliberately querying across multiple, each-individually-expected
repositories at once). Generation itself never produces a
federated/multi-repository snapshot — single-repository-only remains an
absolute constraint (`contracts/input-manifest.md`); this section describes
only a downstream **consumer** behavior across separately-generated files.

## 7. The Five User Story 7 Checks, Consolidated (SC-014)

| # | Check | Fixture construction | Rejects/accepts |
|---|---|---|---|
| 1 | Malformed/unsupported envelope | Omit a required field, produce invalid JSON, declare an unrecognized `schemaVersion`/dialect/capability, omit a declared source's digest, or set `completeness.identityOnly: true` | Rejects, before any digest/revision/identity check |
| 1b | Otherwise-valid envelope, entities all `annotation-absent`, `identityOnly: false` | (contrast case) | **Accepts** — never rejected on ownership-state distribution alone |
| 2 | Tampered envelope | Mutate one entity's `paths` after generation, without updating the digest | Rejects, digest mismatch named |
| 3 | Stale envelope | Different revision than consumer's configured expected-current, digest recomputed over actual (mutated) content | Rejects, staleness named, not a digest failure |
| 4 | Wrong-repository envelope | Different repository ID than consumer's configured expected, digest recomputed over actual content | Rejects, identity mismatch named, not a digest failure |
| 5 | Repository isolation | Two fully valid envelopes, two distinct repository IDs, queried together scoped to one | **Accepts both**; query returns only the scoped repository's entities |

Every check above MUST be demonstrated using **only synthetic fixtures, with
no adopter oracle involved** — these are mechanical, offline
generator/consumer-boundary properties this spike genuinely can prove,
explicitly distinct from, and insufficient by itself to satisfy, the
adopter-oracle-dependent portion of the Evidence Gate's "authoritative `go`"
requirement (see `contracts/evidence-bundle-and-verdict.md`).
