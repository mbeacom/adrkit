# @adrkit/catalog-envelope

Reads a catalog snapshot envelope, validates its **integrity**, and - only after
every check passes - derives a `CatalogSnapshot`-shaped artifact from it.

This package reads envelopes. It never generates them.

> **Status:** experimental workspace package, version `0.0.0`, not released.
> The implemented surface is admission plus derivation for snapshot envelopes.
> It is not wired into the CLI or other public adrkit packages.

## An integrity validator, not a correctness oracle

Everything this package can establish is that an envelope is **intact,
well-formed, self-consistent, current, and about the repository that is
asking.** None of that establishes that the envelope's contents are **right**.

A green result means "nothing was corrupted, dropped, or stale." It does not
mean "the recorded ownership is correct."

Two consequences are easy to invert:

- **A rejection is about the envelope, not the repository.** A failed admission
  means the artifact is unusable, not that the catalog it describes is wrong.
- **Isolation is a query result, not a rejection.** A valid envelope for a
  different repository can still be admitted; the repository mismatch shows up as
  an empty query, not a structural error.

## What it does, in order

The order below is the contract. Each stage runs only after the stage above it
has passed, and each failure has its own named reason.

| # | Stage | Rejects as |
|---|---|---|
| 1 | Parses as JSON at all | `invalid-json` |
| 2 | Complete envelope shape, with correct JSON types at every nesting level | `missing-or-wrong-required-field` |
| 3 | Frozen matcher contract by exact value: `schemaVersion`, the full `globDialect`, and the exact `capabilities` tuple | `unrecognized-schema-or-dialect-or-capability` |
| 4 | Every `sources[]` digest present, correctly typed, and matching the source bytes | `missing-source-digest` |
| 5 | `completeness.identityOnly === false` | `identity-only-true` |
| - | Independent digest recomputation | `digest-mismatch` |
| - | Staleness as exact revision inequality | `stale-revision` |
| - | Repository identity | `repository-identity-mismatch` |
| - | `CatalogSnapshot`-shaped derivation | refused outright without an admission token |

```ts
import { admitEnvelope, deriveCatalogSnapshot } from '@adrkit/catalog-envelope';

const admission = admitEnvelope(envelopeText, {
  sourceBaseDir: 'path/to/descriptors',
  expectedRepositoryId: 'github.com/acme/services',
  expectedRevision: '<40-hex-sha>',
});

if (admission.outcome === 'refused') {
  throw new Error(`${admission.refusedAt}: ${admission.reason} - ${admission.detail}`);
}

const { snapshot, derivedFrom } = deriveCatalogSnapshot(admission.admitted);
```

`deriveCatalogSnapshot` accepts `unknown` and **throws** on anything without an
admission token. That keeps callers from ignoring a refusal and deriving anyway.

## Contract details that matter in practice

- **Staleness is exact inequality, never ordering.** A commit SHA is treated as
  an opaque identifier. Any revision other than the configured expected revision
  is stale.
- **Step 5 reads one boolean.** Whether an envelope is partial is determined
  solely from `completeness.identityOnly`, never by scanning the entity list.
- **The lossy mapping is intentional.** `CatalogSnapshotEntity` has no
  `ownershipState`, so `explicit-empty` and `annotation-absent` both derive an
  empty `paths` array. The distinction stays on the envelope.

## What the digest does and does not establish

- **Accidental-corruption and naive-mutation detection only.** It does not
  protect against an actor who changes content and recomputes the same digest.
- **Integrity, not correctness.** A semantically wrong envelope can still carry
  a valid self-digest.

The package uses `canonicalStringify` from `@adrkit/core` for digest input, so
the validator and generator do not drift into competing definitions of
"canonical." For the envelope's closed scalar domain, the resulting bytes are
equivalent to RFC 8785/JCS output; that is not a claim of general-purpose RFC
8785 coverage.

## Boundary

- **This package is deliberately outside `packages/adapters/`.** Its placement is
  part of the dependency boundary.
- **There must never be a dependency edge to or from
  `@adrkit/catalog-backstage`.** The envelope file on disk is the whole
  interface between them.
- **This package writes nothing to `schema/`.** The envelope is not added to
  `schema/adr.schema.json` and does not become a field on
  `CatalogSnapshot` or `CatalogSnapshotEntity`.
- **It is not wired into `@adrkit/cli` or `@adrkit/core`.** Check the boundary
  with `bun run check:deps`.

## Toolchain

Development uses Bun; any future published artifact will target Node `>=22`.

```bash
bun test
bun run --filter='@adrkit/catalog-envelope' typecheck
bun run check:deps
```

## License

Apache-2.0. See the repository [LICENSE](../../LICENSE) and
[NOTICE](../../NOTICE).
