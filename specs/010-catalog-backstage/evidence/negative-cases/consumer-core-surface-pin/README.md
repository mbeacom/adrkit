# Negative case: the pinned core and published-schema surfaces

**Task**: T026 · **Discharges**: FR-004 (and FR-005's "never part of any published schema" half)
**Observed against**: the Phase C working tree; the two mutated files reverted after each run
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/no-core-schema-change.test.ts`

## Why the guard is a digest pin

The obvious version of this check — "assert `SnapshotEnvelope` does not appear in
`packages/core`" — asserts an **absence**, and ADR-0016 clause 3 is explicit that
an absence and a blind check render identically. It is also the wrong shape: it
would pass while somebody widened `CatalogSnapshotEntity` with a `derivedPaths`
or `ownershipState` field, which is a different route to the same forbidden
outcome.

So the guard pins a **specific observed value** per file — the SHA-256 of its
bytes at `99ba8d2500eaf37625ea164f66b4a17870e40dad` — across all five files under
`packages/core/src/affects/`, plus `packages/core/src/schema/adr.schema.ts` and
`schema/adr.schema.json`, and additionally pins the file list under `affects/` so
that adding or removing a file is caught too.

## Case A — a core type widened

[`case-a-catalog-type-widened.patch`](./case-a-catalog-type-widened.patch) adds
an optional `ownershipState?: string` to `CatalogSnapshotEntity` — the most
plausible way this rule gets broken in practice, since the envelope preserves a
distinction the core type cannot express and adding the field "just to keep it"
looks harmless.

[`case-a-catalog-type-widened.observed.txt`](./case-a-catalog-type-widened.observed.txt) —
exit **1**, **12 pass, 1 fail**:

```text
(fail) the protected core and schema surfaces are unchanged >
       packages/core/src/affects/catalog.ts is byte-identical to its pin
```

## Case B — the published schema touched

[`case-b-published-schema-touched.patch`](./case-b-published-schema-touched.patch)
inserts an `x-derivedPaths` key into `schema/adr.schema.json`.

[`case-b-published-schema-touched.observed.txt`](./case-b-published-schema-touched.observed.txt) —
exit **1**, **11 pass, 2 fail**:

```text
(fail) the protected core and schema surfaces are unchanged >
       schema/adr.schema.json is byte-identical to its pin
(fail) the envelope is not smuggled into the core types >
       the published schema mentions no envelope vocabulary
```

Two guards fire, which is the intended overlap: the digest pin catches *any*
change, and the vocabulary assertion names *which* forbidden term appeared. The
vocabulary assertion alone would be an absence check; it is kept because it says
something specific, and it is meaningful only because the digest pin sits behind
it.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — **13 pass, 0 fail**, exit 0.

## If one of these pins fails in future

A failure means a protected surface changed. Under this feature that is a
**violation**, not a stale pin — FR-004 is unconditional, and updating the pin to
match would be amending the expectation to fit the output. A legitimate change to
these files belongs to separately-authorized later work, and whoever makes it
takes on re-justifying this guard against whatever governs then.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-core-surface-pin/case-a-catalog-type-widened.patch
bun test packages/catalog-envelope/test/no-core-schema-change.test.ts   # expect exit 1
git checkout -- packages/core/src/affects/catalog.ts
bun test packages/catalog-envelope/test/no-core-schema-change.test.ts   # expect exit 0
```

## Standing constraints

ADR-0014 **rung 1 only** — not reference-verified (rung 2), not externally
validated (rung 3). Maintainer-owned observation, which is not external,
third-party, or community validation.
