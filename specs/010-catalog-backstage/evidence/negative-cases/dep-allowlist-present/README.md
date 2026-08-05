# Negative case: proving the allowlist entries exist at all

**Task**: T012 · **Supports**: FR-003, FR-044
**Contract**: `contracts/package-boundary.md` §4
**Observed against**: `10149724938eb172972c7fb98a33956807ee761f`, worktree clean
**Tools**: Bun 1.3.14
**Permanent automated cases**: `scripts/check-deps.test.ts` — *"proves the
adapter allowlist entry exists…"*, *"proves the consumer allowlist entry
exists…"*, and *"the trap itself: a package with no allowlist entry passes with
the same disallowed dependency"*

## The trap this closes

`allowedDependenciesFor()` returns `undefined` for any package it has no entry
for (`scripts/check-deps.ts:192`), and the allowed-surface guard is then
**skipped entirely**. A package with no entry is *silently unconstrained*: it
passes `check:deps` no matter what it declares.

So a green `check:deps` proves nothing about a package's allowlist. Omitting an
entry does not produce a failure — it produces a green check that means nothing.
The only way to show an entry is present is to add a dependency it forbids and
watch a violation appear.

Three cases: one per new package with the entries in place, and one with an entry
removed. **The third is what makes the first two mean anything.**

---

## Case A — adapter declares `undici`, entry present

Input: [`case-a-adapter-disallowed-dep.patch`](./case-a-adapter-disallowed-dep.patch) ·
Output: [`case-a-adapter-disallowed-dep.observed.txt`](./case-a-adapter-disallowed-dep.observed.txt)

Command: `bun run check:deps` · Exit **1**

```
packages/adapters/catalog-backstage/package.json: @adrkit/catalog-backstage dependencies.undici - @adrkit/catalog-backstage declares a dependency outside its allowed public surface
```

## Case B — consumer declares `undici`, entry present

Input: [`case-b-consumer-disallowed-dep.patch`](./case-b-consumer-disallowed-dep.patch) ·
Output: [`case-b-consumer-disallowed-dep.observed.txt`](./case-b-consumer-disallowed-dep.observed.txt)

Command: `bun run check:deps` · Exit **1**

```
packages/catalog-envelope/package.json: @adrkit/catalog-envelope dependencies.undici - @adrkit/catalog-envelope declares a dependency outside its allowed public surface
```

Run independently of case A, as T012 requires: each package's entry is proven on
its own, not inferred from the other's.

`undici` was chosen because it is a network client — the category Constitution
Principle III excludes most clearly, and a dependency neither package could ever
be granted.

---

## Case C — the trap itself: same edge, entry removed

Input: [`case-c-entry-removed-trap.patch`](./case-c-entry-removed-trap.patch) —
declares `undici` in the adapter **and** deletes
`allowedDependenciesFor('@adrkit/catalog-backstage')` ·
Output: [`case-c-entry-removed-trap.observed.txt`](./case-c-entry-removed-trap.observed.txt)

Command: `bun run check:deps` · Exit **0**

```
core-has-no-adapter-deps: ok
```

A network client sits in an adapter's `dependencies` and the check reports
success.

**`case-c-entry-removed-trap.observed.txt` and `restored.observed.txt` are
byte-identical** — verified with `diff`, which reports no difference. The tree
with a forbidden dependency and no rule, and the tree that is actually clean,
produce the same bytes. There is no signal to read.

This is what `package-boundary.md` §4 means by *"the one place where the absence
of a rule is indistinguishable from a satisfied rule"*, and it is
[ADR-0016](../../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)'s
central defect shape: a check that reports success when it has failed to look.

It also makes cases A and B meaningful. Without case C, an exit-1 in A and B
could not distinguish "the entry exists and rejected `undici`" from "some other
guard happened to reject it." Case C removes only the entry, holds everything
else fixed, and the violation disappears — so the entry is what produced it.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — both packages' manifests and
`scripts/check-deps.ts` reverted; `bun run check:deps` exits **0**.

Note the honest reading: **this file alone is not evidence of anything.** It is
identical to case C's output. It is meaningful only alongside A and B, which show
that the same command *does* distinguish an allowed surface from a disallowed one
while the entries are present.

## Reproducing

```bash
# case A
git apply .../dep-allowlist-present/case-a-adapter-disallowed-dep.patch
bun run check:deps                                                # expect exit 1
git checkout -- packages/adapters/catalog-backstage/package.json

# case C — the trap
git apply .../dep-allowlist-present/case-c-entry-removed-trap.patch
bun run check:deps                                                # expect exit 0
git checkout -- packages/adapters/catalog-backstage/package.json scripts/check-deps.ts
```
