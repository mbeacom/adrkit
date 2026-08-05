# @adrkit/catalog-backstage

A standalone, offline generator that reads Backstage catalog descriptor files —
named explicitly by one local input manifest — and writes one versioned snapshot
envelope.

It is invoked directly, by name. There is no dynamic runtime adapter or plugin
loader of any kind, and no composition host that discovers, resolves, or
dynamically imports a catalog adapter at runtime — not even one restricted to a
single statically-known package name
([ADR-0013](../../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)).

---

## Status: this package generates nothing yet

Feature `010-catalog-backstage` is partially built. What exists in this package
today is its **placement** and its **dependency boundary** — the package
manifest, the entry point, and the tests that hold the boundary in place. That
is all.

Not implemented here, and therefore not to be inferred from this package's
existence: the input-manifest reader, descriptor admissibility, canonical
identity, ownership derivation, the glob dialect, the atomic fail-closed
pipeline, and the snapshot envelope itself. Those are requirements on later
phases of the feature, recorded in
[`specs/010-catalog-backstage/`](../../../specs/010-catalog-backstage/). They are
not behaviour this package has.

**No generator has run. No envelope exists.**

### Where this sits on the evidence ladder

Per [ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
and stated in that record's own vocabulary rather than a synonym for it:

| Rung | State | This package |
|---|---|---|
| 1 | unit / contract / conformance evidence | partial — covers only what exists, which is placement and boundary |
| 2 | **reference-verified** | **not reached, and not claimed** |
| 3 | **externally validated** | **not reached, and not claimed** |

[ADR-0020](../../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
authorizes this work toward **rung 1 only**. It authorizes the work; it does not
authorize a release, and the decision to release at all is deferred to a later
record (clause 9). Nothing in this package is `reference-verified`, `externally
validated`, `adopted`, or in `sustained adoption`.

Any verification performed here is performed by the maintainer. Maintainer-owned
verification is not external, third-party, or community adoption, and this
package will not describe it as any of those. Where a corpus of upstream-authored
descriptors is used as *input*, only that corpus **data** is third-party — never
the validation applied to it.

---

## What a consumer may and may not conclude from this adapter's output

This section is a requirement on this document
(`spec.md` FR-062, FR-063), not a disclaimer appended to it.

**A consumer may conclude**, once the adapter produces output at all, exactly
this much: that a set of pure validator predicates returned a particular result
when invoked against particular descriptor content. That is the whole warrant.

**A consumer may not conclude:**

- **Anything about Backstage as a running system.** This package makes no claim
  about how a Backstage instance resolves, interprets, or acts on a descriptor.
  It evaluates descriptor *content* against a pinned model of the descriptor
  format. A predicate's return value and a running system's behaviour are
  different facts, and only the first is available here.
- **That a valid envelope is a correct envelope.** A populated, digest-verified
  envelope proves **integrity**, not **correctness**: a semantically wrong
  envelope can carry a perfectly valid self-digest (ADR-0020 clause 5). The
  digest tells a reader the envelope is intact and unmodified. It says nothing
  about whether the ownership it records is right.
- **That ownership was inferred.** Ownership comes from an explicit
  `adrkit.io/owned-paths` annotation and from nowhere else. No descriptor-parent,
  repository-root, or identity-only normalization heuristic is present in this
  package as inferred, authoritative, default, or opt-in behaviour. Those were
  measurement instruments in an earlier spike, labelled non-authoritative by
  their own contract, and they do not carry into this adapter (`spec.md` FR-061).
- **That the `adrkit.io/owned-paths` annotation is an established convention.**
  **Adoption of `adrkit.io/owned-paths` by anyone other than the maintainer is
  neither established nor gated by this feature.** No descriptor in any upstream
  corpus consulted by this work carries the annotation. Where an annotation
  appears over real upstream descriptors, it is a maintainer-authored overlay
  applied to descriptors that are otherwise unmodified — and the fact that the
  overlay is maintainer-authored travels with any claim made from it.
- **That absence of ownership means anything about the entity.** An entity with
  no annotation, an entity with an empty annotation, and an entity whose
  annotation matched no path are three distinct states, and none of them is
  evidence that the entity owns nothing.

---

## Boundary

- **Nothing outside `packages/adapters/**` may depend on this package.**
  `packages/core`, `packages/cli`, and `schema/` import nothing from it and must
  not otherwise learn it exists
  ([ADR-0007](../../../docs/adr/0007-adapter-isolation-and-public-surface-build.md);
  Constitution Principle III). Enforced by `bun run check:deps`, whose guard was
  observed rejecting exactly that edge before it was relied on
  ([ADR-0016](../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
- **This package does not depend on `@adrkit/catalog-envelope`, and that package
  does not depend on this one.** The envelope file on disk is the entire
  interface between them. Each declares the envelope's shape independently, which
  is what makes the consumer's validation a check rather than a comparison of the
  generator against itself.
- **The `@adrkit/core` dependency is for canonicalization primitives only** —
  `canonicalStringify` and `compareCodeUnits`. It does **not** couple this
  package's version to core's API. This adapter is versioned independently per
  ADR-0007: its semver contract is with Backstage, not with `@adrkit/core`.
- **This package writes nothing to `schema/`** and adds nothing to
  `schema/adr.schema.json`. The snapshot envelope is a separate artifact and
  stays one.

---

## Toolchain

Bun for development; any published artifact targets Node
([ADR-0010](../../../docs/adr/0010-bun-toolchain.md)).

```bash
bun test                     # from the repository root
bun run --filter='@adrkit/catalog-backstage' typecheck
bun run check:deps           # the dependency boundary above
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
