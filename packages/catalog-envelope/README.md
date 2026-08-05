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

## Status: this package validates nothing yet

Feature `010-catalog-backstage` is partially built. What exists here today is the
package's **placement** and its **dependency boundary**. The five ordered
validation steps, digest recomputation, staleness evaluation, repository-identity
handling, and snapshot derivation are requirements on a later phase, recorded in
[`specs/010-catalog-backstage/`](../../specs/010-catalog-backstage/). They are not
behaviour this package has.

Per [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
stated in that record's own vocabulary: rung-1 evidence covers only what exists,
which is placement and boundary. This package is **not** `reference-verified`
(rung 2) and **not** `externally validated` (rung 3), and claims neither. Any
verification performed here is maintainer-owned, which is not external,
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
