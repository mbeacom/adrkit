# @adrkit/catalog-backstage

Offline generator package for turning Backstage catalog descriptors into an
adrkit snapshot envelope.

> **Status:** in development. This workspace package is version `0.0.0` and is
> not released. Today it exists to hold the package boundary, entry point, and
> tests for future work. It does **not** yet read input manifests, parse
> descriptors, derive ownership, or write snapshot envelopes.

## What exists today

- the package manifest and workspace placement
- the package entry point
- the dependency boundary around the future adapter

If you are looking for a generator you can run today, this is not it yet.

## Intended contract when output ships

This package is meant to validate descriptor content and produce one offline
snapshot envelope. Even when that generator exists, a consumer should conclude
only that the adapter's rules returned a particular result for particular
descriptor bytes.

A consumer should **not** infer any of the following from the adapter's output:

- **How a running Backstage instance behaves.** This package will evaluate
  descriptor content, not a live Backstage deployment.
- **That integrity implies correctness.** A valid envelope can still record the
  wrong ownership.
- **That ownership was inferred.** Ownership comes only from an explicit
  `adrkit.io/owned-paths` annotation.
- **That missing ownership means "owns nothing."** Annotation-absent,
  explicit-empty, and matched-nothing remain distinct states.

## Boundary

- **Nothing outside `packages/adapters/**` may depend on this package.**
  `packages/core`, `packages/cli`, and `schema/` must not import from it. Check
  this with `bun run check:deps`.
- **This package does not depend on `@adrkit/catalog-envelope`, and that package
  does not depend on this one.** The envelope file on disk is the whole
  interface between them.
- **The `@adrkit/core` dependency is for canonicalization helpers only.** It
  does not couple this package's versioning to core's API.
- **This package writes nothing to `schema/`.** The snapshot envelope stays a
  separate artifact.

## Toolchain

Development uses Bun; any future published artifact will target Node `>=22`.

```bash
bun test
bun run --filter='@adrkit/catalog-backstage' typecheck
bun run check:deps
```

## License

Apache-2.0. See the repository [LICENSE](../../../LICENSE) and
[NOTICE](../../../NOTICE).
