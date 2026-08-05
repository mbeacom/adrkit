# Negative case: the consumer importing the adapter

**Task**: T037 · **Discharges**: FR-044 (behavioural half)
**Contract**: [`package-boundary.md`](../../../contracts/package-boundary.md) §3
**Observed against**: the Phase C working tree, `packages/catalog-envelope/src/index.ts` otherwise unmodified
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/no-adapter-import.test.ts`

Nothing under `packages/adapters/` was modified to construct either case. The
edge is introduced in the **consumer's own** source, which is the direction
FR-044 names first and the one that would make this package's validation a
tautology if it were ever real.

## What this adds over Phase A's dependency-check evidence

Phase A already observed both manifest-level guards firing
([`dep-consumer-to-adapter/`](../dep-consumer-to-adapter/),
[`dep-adapter-to-consumer/`](../dep-adapter-to-consumer/)). Those cover the
*declaration*. T037 asks for a **build-graph assertion, not only a `package.json`
inspection**, and case B below is the reason that distinction was written into
the task.

## Case B — the relative-path import, and the gap it exposes

[`case-b-relative-path-import.patch`](./case-b-relative-path-import.patch) adds
to `packages/catalog-envelope/src/index.ts`:

```ts
import { PACKAGE_NAME as ADAPTER_NAME } from '../../adapters/catalog-backstage/src/index.ts';
```

This declares nothing. It compiles, it resolves, it builds, and the module is
genuinely in the consumer's build graph.

| Check | Command | Result |
|---|---|---|
| Manifest dependency check | `bun run check:deps` | **exit 0**, prints `core-has-no-adapter-deps: ok` — [`case-b-relative-path-import.check-deps.observed.txt`](./case-b-relative-path-import.check-deps.observed.txt) |
| This test | `bun test packages/catalog-envelope/test/no-adapter-import.test.ts` | **exit 1**, 2 pass / 2 fail — [`case-b-relative-path-import.observed.txt`](./case-b-relative-path-import.observed.txt) |

The green `check:deps` is the point. It is not wrong — the manifest genuinely
declares no adapter dependency — but it is green about a question that is no
longer the one being asked. Recording the two side by side is the evidence that
the build-graph assertion covers something the manifest check structurally
cannot.

The failing assertion names the module it found:

```text
const offending = modules.filter((path) => path.includes(FORBIDDEN_PATH_SEGMENT));
expect(offending).toEqual([])

- []
+ [ "packages/adapters/catalog-backstage/src/index.ts" ]
```

### A defect in this test, found by this observation and fixed

On the first run of case B, the build-graph assertion failed as expected but the
companion source-scan assertion **passed**. The scan tested whether an import
specifier contained the literal string `packages/adapters/`, and
`../../adapters/catalog-backstage/src/index.ts` does not contain it. The scan was
blind to exactly the specifier form that also evades `check:deps`.

The scan now resolves relative specifiers against the importing file's directory
before testing them, and the captured output above is from the re-run, in which
both assertions fail:

```text
(fail) the consumer imports nothing from an adapter >
       the build graph contains no module under packages/adapters/
(fail) the consumer imports nothing from an adapter >
       no source file names any adapter package or its path
```

This is what ADR-0016 is for: the check was written, looked correct, passed, and
did not work. Only constructing the violation said so.

### Why the test derives adapter names instead of naming one

The forbidden package name is read from `packages/adapters/*/package.json` at run
time rather than written as a literal. That is the stronger rule — FR-003 and
FR-044 forbid reaching **any** adapter, not one named adapter — and it is also
forced: Phase A's locality guard at
`packages/adapters/catalog-backstage/test/envelope-shape-locality.test.ts`
forbids any `.ts` file under the consumer from naming the adapter package, which
a self-referential guard would otherwise have to do. Phase A resolves the same
problem for its own guards with an `EXCLUDED_FROM_SCAN` list, but that list lives
in the adapter's tree, which Phase C does not own. This is reported for central
reconciliation, not treated as settled.

## Case A — the package-name import, reported precisely

[`case-a-package-name-import.patch`](./case-a-package-name-import.patch) adds:

```ts
import { PACKAGE_NAME as ADAPTER_NAME } from '@adrkit/catalog-backstage';
```

[`case-a-package-name-import.observed.txt`](./case-a-package-name-import.observed.txt) —
**exit 1**, 0 pass / 1 fail / 1 error:

```text
error: Cannot find module '@adrkit/catalog-backstage' from
  '…/packages/catalog-envelope/src/index.ts'
```

**Stated plainly rather than counted as a detection**: this case goes red, but at
*module resolution*, not because the graph assertion saw anything. The consumer
declares no dependency on the adapter, so Bun's isolated linker never links it,
and the import cannot resolve at all. Reaching the adapter this way would require
also amending `packages/catalog-envelope/package.json` — which is the edge
Phase A already observed `check:deps` rejecting with
`non-adapter workspace depends on an adapter package`.

So case A demonstrates that the package-name route is closed by a **different**
mechanism than the one this test provides, and it is recorded that way. Claiming
it as a build-graph detection would overstate what the output shows. `check:deps`
also exits 0 on case A, for the same manifest-level reason as case B.

## Restored

- [`restored.observed.txt`](./restored.observed.txt) — **4 pass, 0 fail**, exit 0
- [`restored.check-deps.observed.txt`](./restored.check-deps.observed.txt) — exit 0

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-adapter-import/case-b-relative-path-import.patch
bun run check:deps                                                  # exit 0 — the gap
bun test packages/catalog-envelope/test/no-adapter-import.test.ts   # exit 1
git checkout -- packages/catalog-envelope/src/index.ts
bun test packages/catalog-envelope/test/no-adapter-import.test.ts   # exit 0
```

## Standing constraints

ADR-0014 **rung 1 only** — not reference-verified (rung 2), not externally
validated (rung 3). Maintainer-owned observation, which is not external,
third-party, or community validation.
