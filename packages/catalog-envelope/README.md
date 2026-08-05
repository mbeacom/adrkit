# @adrkit/catalog-envelope

Reads a catalog snapshot envelope, validates its **integrity**, and — only after
every check passes — derives a `CatalogSnapshot`-shaped artifact from it.

This package reads envelopes. It never generates them.

---

## An integrity validator, not a correctness oracle

This distinction is the reason this package exists as a separate thing, so it is
stated before anything else.

Everything this package can establish is that an envelope is **intact,
well-formed, self-consistent, current, and about the repository that is asking.**
None of that establishes that the envelope's contents are **right**.

A populated, digest-verified envelope proves integrity, not correctness: a
semantically wrong envelope can carry a perfectly valid self-digest
([ADR-0020](../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
clause 5). A green result from this package means "nothing was corrupted, dropped,
or stale." It does not mean "the ownership recorded here is the ownership that
should have been recorded." Nothing in this package is able to determine the
latter, and no output of it may be read as having done so.

Two consequences worth naming, because they are easy to invert:

- **A rejection is a statement about the envelope, not about the repository.** An
  envelope that fails validation tells you the artifact is unusable, not that the
  catalog it describes is wrong.
- **Isolation is a property of the query, not a rejection.** A *valid* envelope
  describing a different repository is accepted as valid; the repository boundary
  shows up as the query returning no matches, not as an error.

---

## What it does, in the order it does it

The order is the contract, not an implementation detail
([`snapshot-envelope.md`](../../specs/009-catalog-binding-viability/contracts/snapshot-envelope.md)
§2; `spec.md` FR-045, FR-046). Each stage runs only after every stage above it
has passed, and each rejects with its own named reason.

| # | Stage | Rejects as |
|---|---|---|
| 1 | Parses as JSON at all | `invalid-json` |
| 2 | The complete envelope shape, every field the correct JSON type, **at every nesting level** | `missing-or-wrong-required-field` |
| 3 | The frozen matcher contract by **exact value** — `schemaVersion`, the whole `globDialect` object, the exact `capabilities` tuple | `unrecognized-schema-or-dialect-or-capability` |
| 4 | Every `sources[]` digest present, correctly typed, and matching its file's actual bytes | `missing-source-digest` |
| 5 | `completeness.identityOnly === false` | `identity-only-true` |
| — | **Then** independent digest recomputation | `digest-mismatch` |
| — | **Then** staleness, as exact revision inequality | `stale-revision` |
| — | **Then** repository identity | `repository-identity-mismatch` |
| — | **Only then** `CatalogSnapshot`-shaped derivation | refused outright without an admission token |

```ts
import { admitEnvelope, deriveCatalogSnapshot } from '@adrkit/catalog-envelope';

const admission = admitEnvelope(envelopeText, {
  sourceBaseDir: 'path/to/descriptors',
  expectedRepositoryId: 'github.com/acme/services',
  expectedRevision: '<40-hex-sha>',
});

if (admission.outcome === 'refused') {
  // `refusedAt` names the stage, `reason` the category, `detail` the specifics.
  throw new Error(`${admission.refusedAt}: ${admission.reason} — ${admission.detail}`);
}

const { snapshot, derivedFrom } = deriveCatalogSnapshot(admission.admitted);
```

`deriveCatalogSnapshot` accepts `unknown` and **throws** on anything without an
admission token. That is deliberate: a returned rejection can be ignored and the
caller can go on to read `derivedPaths` anyway, and FR-046 does not permit that.

### Three things that are easy to get backwards

- **Staleness is exact inequality, never an ordering.** A commit SHA is an opaque
  identifier with no ordering available without git-ancestry data, which is out
  of scope. Any revision other than the configured expected-current one is stale
  — never "older than". There is no `<` anywhere in that module. The expectation
  is also keyed to a repository: repository A's expected revision says nothing
  about an envelope describing repository B.
- **Step 5 reads one boolean.** Whether an envelope is partial/identity-only is
  determined **solely** from `completeness.identityOnly`, never by scanning the
  entity list. An envelope whose entities are *all* `annotation-absent` with
  `identityOnly: false` is accepted — absent annotations are a valid, expected
  state.
- **The lossy mapping is not repaired.** `CatalogSnapshotEntity` has no
  `ownershipState`, so `explicit-empty` and `annotation-absent` both derive an
  empty `paths`. The distinction stays on the envelope; it is not smuggled into
  the core type, and changing `CatalogSnapshot` to carry it is out of scope.

## What the digest does and does not establish

Both statements travel with every mention of the digest check, in code, in tests,
and in evidence. That is a requirement (`spec.md` FR-041), not editorial caution.

- **Accidental-corruption and naive-mutation detection only.** It does not resist
  an adversary who mutates content and also recomputes the same digest with the
  same algorithm. A cryptographically-signed tamper-evidence mechanism — with its
  own key-management, trust-anchor, and deterministic-output questions — is an
  explicitly open question this feature does not attempt.
- **Integrity, not correctness.** A semantically wrong envelope can carry a
  perfectly valid self-digest.

The canonicalization primitive is `canonicalStringify` from `@adrkit/core`, not a
second implementation written here — a second definition of "canonical" could
drift silently from the generator's, which is the failure the digest exists to
detect. For the envelope's closed scalar domain its bytes are *equivalent to*
RFC 8785/JCS output; that equivalence is scoped to the domain and is not a claim
that `canonicalStringify` is a general-purpose RFC 8785 implementation.

## Status

Phase C of feature `010-catalog-backstage` is implemented: the five ordered
validation steps, digest recomputation, staleness, repository identity and
isolation, and gated derivation. Phases B, D, E, F and G are recorded in
[`specs/010-catalog-backstage/`](../../specs/010-catalog-backstage/) and are not
behaviour this package has.

Every check here was **observed failing before it was relied on**
([ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)):
each of the five steps was deleted in turn, the digest was replaced with the
declared value, staleness was rewritten as an ordering comparison, and both
repository outcomes were conflated in each direction — with the failures captured
verbatim under
[`evidence/negative-cases/`](../../specs/010-catalog-backstage/evidence/negative-cases/).
One of those observations found a real defect in a test that had been passing.

Per [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
stated in that record's own vocabulary: this is rung-1 evidence. This package is
**not** `reference-verified` (rung 2) and **not** `externally validated` (rung 3),
and claims neither. Every fixture is synthetic and hand-authored, with no external
adopter involved; every observation is maintainer-owned, which is not external,
third-party, or community adoption and will not be described as such.

No release is authorized or prepared; ADR-0020 clause 9 defers that decision to a
later record.

---

## Boundary

- **This package is deliberately not under `packages/adapters/`.** `spec.md`
  FR-044 requires the envelope validator and `CatalogSnapshot` deriver to live in
  a workspace package outside `packages/adapters/**`. The dependency check
  classifies adapters by path prefix alone, so this package is a non-adapter as a
  matter of its *location* rather than by an allowlisted exception. Moving it
  would silently invert that classification.
- **There is no dependency edge to or from `@adrkit/catalog-backstage`, in either
  direction, and there must never be one.** The envelope file on disk is the
  entire interface. Both sides declare the envelope's shape independently — the
  single deliberate duplication in this design. A shared type module would be an
  import edge, and if both sides derived their view of the envelope from one
  declaration, a generator that changed the shape would change it on both sides
  at once and this package's validation would be a tautology. The cost is real
  and accepted: the two declarations can diverge, and nothing but this package's
  validation failing will say so. **That failure is the intended signal.**
- **This package writes nothing to `schema/`.** The envelope is not added to
  `schema/adr.schema.json` and does not become a field on `CatalogSnapshot` or
  `CatalogSnapshotEntity`.
- **It is not wired into `@adrkit/cli` or `@adrkit/core`**, and wiring it in is
  explicitly out of scope for this feature.

Both directions of the boundary above are enforced by `bun run check:deps`, and
each guard was observed rejecting the edge it forbids before it was relied on
([ADR-0016](../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

---

## Toolchain

Bun for development; any published artifact targets Node
([ADR-0010](../../docs/adr/0010-bun-toolchain.md)).

```bash
bun test                     # from the repository root
bun run --filter='@adrkit/catalog-envelope' typecheck
bun run check:deps
```

## License

Apache-2.0. See the repository [LICENSE](../../LICENSE) and
[NOTICE](../../NOTICE).
