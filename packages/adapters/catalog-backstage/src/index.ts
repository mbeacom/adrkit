/**
 * `@adrkit/catalog-backstage` — the adapter's only public entry point.
 *
 * **How this package is reached.** By an explicit, static `import` of this module,
 * written by name in a caller's source. Per ADR-0013 and `spec.md` FR-002 the
 * adapter is a standalone offline snapshot generator: there is no dynamic runtime
 * adapter or plugin loader of any kind, and no composition host that discovers,
 * resolves, or dynamically imports a catalog adapter at runtime — not even one
 * restricted to a single statically-known package name. Nothing here registers
 * itself with anything, and importing this module has no side effect.
 *
 * **What exists today.** Phase A of feature `010-catalog-backstage` creates this
 * package's placement, its dependency boundary, and this entry point. It creates
 * nothing else. The input-manifest reader, the descriptor admissibility and
 * ownership validators, and the envelope generator are *not* implemented here;
 * they are requirements on later phases, not behaviour this package has.
 *
 * **What this package has been shown to do: nothing.** No generator has run, no
 * envelope exists, and no claim about Backstage as a running system is made or
 * implied anywhere in this package. See `README.md`.
 *
 * @see {@link ../README.md}
 * @see `docs/adr/0007-adapter-isolation-and-public-surface-build.md`
 * @see `docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md`
 * @see `docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md`
 */

/**
 * This package's own name.
 *
 * Exported so that a test can assert a *specific observed value* obtained by
 * statically importing this module, rather than asserting the absence of a
 * loader and calling that coverage (ADR-0016 clause 3).
 */
export const PACKAGE_NAME = '@adrkit/catalog-backstage';
