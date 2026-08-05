# Negative case: the adapter depends on the consumer

**Task**: T011 · **Discharges**: FR-044 (direction half, ii)
**Contract**: `contracts/package-boundary.md` §3
**Observed against**: `10149724938eb172972c7fb98a33956807ee761f`, worktree clean
**Tools**: Bun 1.3.14
**Permanent automated case**: `scripts/check-deps.test.ts` —
*"rejects the adapter depending on @adrkit/catalog-envelope"*

The other direction of the same boundary: `@adrkit/catalog-backstage` must not
depend on `@adrkit/catalog-envelope`.

## Input

[`dep-adapter-to-consumer.patch`](./dep-adapter-to-consumer.patch) — adds
`"@adrkit/catalog-envelope": "workspace:*"` to the adapter's `dependencies`.

## Observed

Command: `bun run check:deps` · Exit **1** ·
[`observed.txt`](./observed.txt)

```
packages/adapters/catalog-backstage/package.json: @adrkit/catalog-backstage dependencies.@adrkit/catalog-envelope - @adrkit/catalog-backstage declares a dependency outside its allowed public surface
```

## Exactly one guard fires here, and that is not an oversight

Unlike T010's mirror case, only the allowed-surface guard
(`scripts/check-deps.ts:236–244`; cited in the task as `196–204`, see the drift
note in `dep-core-to-adapter/README.md`) reports. The non-adapter guard at
`:216–224` correctly does **not**, because its condition is `!adapterPackage` and
the adapter *is* an adapter package.

The consequence is worth stating, because it is the reason T012 exists:

> **In this direction, the allowlist entry is the only thing standing between the
> two packages.**

The structural protection that catches every other case — "nothing outside
`packages/adapters/` may depend on an adapter" — offers nothing here, since the
depending package is itself inside `packages/adapters/`. If
`allowedDependenciesFor('@adrkit/catalog-backstage')` were ever removed, this
edge would pass silently. That is precisely the scenario constructed and observed
in [`../dep-allowlist-present/`](../dep-allowlist-present/) case C.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — edge removed,
`bun run check:deps` exits **0**, `core-has-no-adapter-deps: ok`.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/dep-adapter-to-consumer/dep-adapter-to-consumer.patch
bun run check:deps                                                # expect exit 1
git checkout -- packages/adapters/catalog-backstage/package.json
bun run check:deps                                                # expect exit 0
```
