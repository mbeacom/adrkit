# Negative case: a dependency edge from core / CLI / `schema/` onto the adapter

**Task**: T009 · **Discharges**: SC-015 · **Requires**: FR-003
**Observed against**: `10149724938eb172972c7fb98a33956807ee761f`, worktree clean
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Permanent automated case**: `scripts/check-deps.test.ts`, describe block
`catalog adapter and consumer dependency boundary (feature 010)`

FR-003 requires that `packages/core`, `packages/cli` and `schema/` import nothing
from `packages/adapters/**`. Three edges were constructed, one per named surface.

**Two of the three fail under `bun run check:deps`. The third does not, and that
is the point of this record.**

| # | Edge | Command that rejects it | Exit |
|---|---|---|---|
| 1 | `@adrkit/core` → adapter | `bun run check:deps` | 1 |
| 2 | `@adrkit/cli` → adapter | `bun run check:deps` | 1 |
| 3 | `schema/` → adapter | **`bun run typecheck`** — `check:deps` passes | 2 (`check:deps` exits **0**) |

---

## Case 1 — `@adrkit/core` depends on the adapter

Input: [`case-1-core-to-adapter.patch`](./case-1-core-to-adapter.patch) ·
Output: [`case-1-core-to-adapter.observed.txt`](./case-1-core-to-adapter.observed.txt)

Command: `bun run check:deps` · Exit **1**

```
packages/core/package.json: @adrkit/core dependencies.@adrkit/catalog-backstage - non-adapter workspace depends on an adapter package
packages/core/package.json: @adrkit/core dependencies.@adrkit/catalog-backstage - @adrkit/core declares a dependency outside its allowed public surface
```

Both guards fire: the non-adapter guard (`scripts/check-deps.ts:216–224`) because
core sits outside `packages/adapters/`, and the allowed-surface guard
(`:236–244`) because the adapter is not on core's allowlist.

## Case 2 — `@adrkit/cli` depends on the adapter

Input: [`case-2-cli-to-adapter.patch`](./case-2-cli-to-adapter.patch) ·
Output: [`case-2-cli-to-adapter.observed.txt`](./case-2-cli-to-adapter.observed.txt)

Command: `bun run check:deps` · Exit **1**

```
packages/cli/package.json: @adrkit/cli dependencies.@adrkit/catalog-backstage - non-adapter workspace depends on an adapter package
packages/cli/package.json: @adrkit/cli dependencies.@adrkit/catalog-backstage - @adrkit/cli declares a dependency outside its allowed public surface
```

The CLI's `allowedDependenciesFor()` entry was **not** amended to accommodate
this, per `contracts/package-boundary.md` §7.

## Case 3 — `schema/` reaches the adapter: `check:deps` cannot see it

Input: [`case-3-schema-to-adapter.patch`](./case-3-schema-to-adapter.patch) ·
Output: [`case-3-schema-to-adapter.observed.txt`](./case-3-schema-to-adapter.observed.txt)

An `import { PACKAGE_NAME } from "@adrkit/catalog-backstage"` was added to
`schema/adr.schema.ts` — a real edge from the `schema/` surface into the adapter,
exactly what FR-003 forbids.

**`bun run check:deps` exits 0 and prints `core-has-no-adapter-deps: ok`** —
identical to a clean tree.

```
$ bun run check:deps
core-has-no-adapter-deps: ok
EXIT=0
```

**`bun run typecheck` exits 2:**

```
schema/adr.schema.ts(2,30): error TS2307: Cannot find module '@adrkit/catalog-backstage' or its corresponding type declarations.
```

### Why, and what actually enforces the clause

`schema/` has **no `package.json`**. `readWorkspacePackages()`
(`scripts/check-deps.ts:68–90`) walks `packages/` and reads manifests; a
directory with no manifest is never visited, so `check:deps` has nothing to
apply a rule to. This is the same shape as the allowlist trap in
`contracts/package-boundary.md` §4, one level up: there, a *package* with no
entry is silently unconstrained; here, a *directory* with no manifest is
invisible outright. In both, absence of a rule and a satisfied rule render as the
same green string.

The clause is enforced instead by **`bunfig.toml`'s `linker = "isolated"`**.
Root-level files resolve against the root `node_modules/`, and under the isolated
linker that directory contains **no `@adrkit/` scope at all** — verified: `ls
node_modules/@adrkit/` returns `No such file or directory`. A root-level file
therefore has no path by which to reach any workspace package, and the edge fails
to resolve at typecheck.

That is Constitution Principle III's own stated reason for the setting — *"The
`isolated` linker is load-bearing: it forbids phantom dependencies that could let
the check pass while the core imports an adapter. It MUST NOT be changed to
unblock an install."* — observed doing the work it is there to do.

### Consequence for the task list

T009 instructs: *"run `bun run check:deps`; observe the failure"* for all three
surfaces. **For `schema/` that is not satisfiable**, and no change to
`check-deps.ts` would make it so without teaching the script to scan source files
rather than manifests. The failure is recorded above under the command that
genuinely produces it, and the distinction is stated rather than smoothed over,
because a reader who assumes `check:deps` covers `schema/` would be wrong — and
would be wrong in the direction of a check that cannot fail.

A test in `scripts/check-deps.test.ts` pins this as a specific observed value
(*"does NOT see a manifest-less directory such as schema/, and this records that
limitation"*) so the limitation is asserted rather than remembered.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — with all three edges
reverted, `bun run check:deps` exits 0 (`core-has-no-adapter-deps: ok`) and
`bun run typecheck` exits 0.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/dep-core-to-adapter/case-1-core-to-adapter.patch
bun run check:deps            # expect exit 1
git checkout -- packages/core/package.json
bun run check:deps            # expect exit 0
```

Case 3 uses `bun run typecheck` in place of `bun run check:deps`, and reverts
with `git checkout -- schema/adr.schema.ts`.

## Line-number drift

T009–T012 and `contracts/package-boundary.md` §4 cite the guards at `175–182`
and `196–204`. T008 inserted two allowlist entries earlier in the file, so as of
the commit above they are at **`216–224`** and **`236–244`**. The reasons they
emit are unchanged; only the line numbers moved.
