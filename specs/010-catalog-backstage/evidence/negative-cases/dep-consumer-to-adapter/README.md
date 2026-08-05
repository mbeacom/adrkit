# Negative case: the consumer depends on the adapter

**Task**: T010 · **Discharges**: FR-044 (direction half, i)
**Contract**: `contracts/package-boundary.md` §3
**Observed against**: `10149724938eb172972c7fb98a33956807ee761f`, worktree clean
**Tools**: Bun 1.3.14
**Permanent automated case**: `scripts/check-deps.test.ts` —
*"rejects @adrkit/catalog-envelope depending on the adapter"*

FR-044 forbids `@adrkit/catalog-envelope` from depending on
`@adrkit/catalog-backstage`. The envelope file on disk is the entire interface
between them; an import edge in this direction would let the consumer read the
generator's own declarations, and its structural validation would then be
comparing the generator against itself rather than checking it.

## Input

[`dep-consumer-to-adapter.patch`](./dep-consumer-to-adapter.patch) — adds
`"@adrkit/catalog-backstage": "workspace:*"` to the consumer's `dependencies`.

## Observed

Command: `bun run check:deps` · Exit **1** ·
[`observed.txt`](./observed.txt)

```
packages/catalog-envelope/package.json: @adrkit/catalog-envelope dependencies.@adrkit/catalog-backstage - non-adapter workspace depends on an adapter package
packages/catalog-envelope/package.json: @adrkit/catalog-envelope dependencies.@adrkit/catalog-backstage - @adrkit/catalog-envelope declares a dependency outside its allowed public surface
```

T010 names the first of these — the non-adapter guard, at
`scripts/check-deps.ts:216–224` (cited in the task as `175–182`; see the drift
note in `dep-core-to-adapter/README.md`). It is recorded here that a **second**
guard also fires, at `:236–244`, because the adapter is not on the consumer's
allowlist. Recording only the expected one would leave a reader believing a
single guard holds this direction when two do.

### What the first violation additionally proves

`isAdapterPackage()` classifies by path prefix alone, so
`non-adapter workspace depends on an adapter package` can only be emitted for a
package located **outside** `packages/adapters/`. Its appearance here is
therefore also positive, mechanical confirmation that
`packages/catalog-envelope/` is placed correctly — the FR-044 *placement* half,
observed rather than asserted. Had the consumer been created under
`packages/adapters/`, this line would be absent and the misplacement silent.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — edge removed,
`bun run check:deps` exits **0**, `core-has-no-adapter-deps: ok`.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/dep-consumer-to-adapter/dep-consumer-to-adapter.patch
bun run check:deps                                   # expect exit 1
git checkout -- packages/catalog-envelope/package.json
bun run check:deps                                   # expect exit 0
```
