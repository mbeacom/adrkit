/**
 * `@adrkit/catalog-envelope` — the consumer's only public entry point.
 *
 * **What this package is.** An *integrity* validator. It reads a snapshot
 * envelope, checks that the envelope is structurally well-formed, internally
 * consistent, self-consistent with its declared digests, current, and about the
 * repository asking — and only then derives a `CatalogSnapshot`-shaped artifact
 * from it (`spec.md` FR-045 through FR-049).
 *
 * **What this package is not.** A correctness oracle. A populated,
 * digest-verified envelope proves integrity, not correctness: a semantically
 * wrong envelope can carry a perfectly valid self-digest (ADR-0020 clause 5).
 * Everything this package can conclude is a statement about whether an envelope
 * is intact and current — never a statement about whether its contents are
 * *right*.
 *
 * **The boundary.** This package neither imports from nor is imported by
 * `@adrkit/catalog-backstage` (`spec.md` FR-044). The envelope file on disk is
 * the entire interface between them, and each declares the envelope's shape
 * independently. That duplication is deliberate: were both sides to derive their
 * view of the envelope from one shared declaration, a generator that changed the
 * shape would change it on both sides at once, and this package's validation
 * would be comparing the generator against itself.
 *
 * **What exists today.** Phase A of feature `010-catalog-backstage` creates this
 * package's placement, its dependency boundary, and this entry point, and nothing
 * else. The five ordered validation steps, digest recomputation, staleness
 * evaluation, repository-identity handling, and snapshot derivation are
 * requirements on a later phase, not behaviour this package has.
 *
 * @see {@link ../README.md}
 * @see `specs/010-catalog-backstage/contracts/package-boundary.md`
 */

/**
 * This package's own name.
 *
 * Exported so that a test can assert a *specific observed value* obtained by
 * statically importing this module, rather than asserting an absence and calling
 * that coverage (ADR-0016 clause 3).
 */
export const PACKAGE_NAME = '@adrkit/catalog-envelope';
