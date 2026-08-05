# Negative case: the three manifest-level version and capability rejections

**Task**: T040 · **Discharges**: FR-008
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree
for each run.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test test/manifest-version.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/manifest-version.test.ts`

`input-manifest.md` §2 fixes exactly three manifest-level rejections, and
`atomic-fail-closed.md` §5 groups them with `incomplete-required-source` as the four
manifest-request-level rejections. Each of the three was disabled in turn and the
suite observed failing, then restored and observed passing.

| # | Check disabled | Reason that stopped being emitted | Tests failing |
|---|---|---|---|
| 1 | `manifestSchemaVersion` comparison | `unsupported-manifest-version` | 2 |
| 2 | `requestedSnapshotSchemaVersion` comparison | `unsupported-snapshot-version` | 1 |
| 3 | `requiredCapabilities` membership | `unsupported-capability` | 2 |

---

## Case 1 — `unsupported-manifest-version`

Input: [`case-1-unsupported-manifest-version.patch`](./case-1-unsupported-manifest-version.patch) ·
Output: [`case-1-unsupported-manifest-version.observed.txt`](./case-1-unsupported-manifest-version.observed.txt)

```
(fail) T040 — the three version/capability rejections (FR-008) > `unsupported-manifest-version` — an unsupported manifestSchemaVersion
Expected: false
Received: true

(fail) T040 — the three version/capability rejections (FR-008) > a manifest violating two rules reports the first, deterministically
Expected: "unsupported-manifest-version"
Received: "unsupported-snapshot-version"
```

The second failure is the one worth keeping. With the first check disabled, a manifest
wrong on **both** version fields reports the *snapshot* version instead — which is
exactly the order-dependence `input-manifest.md` §2's fixed table ordering exists to
prevent, surfacing as a different reported reason for the same input.

## Case 2 — `unsupported-snapshot-version`

Input: [`case-2-unsupported-snapshot-version.patch`](./case-2-unsupported-snapshot-version.patch) ·
Output: [`case-2-unsupported-snapshot-version.observed.txt`](./case-2-unsupported-snapshot-version.observed.txt)

```
(fail) T040 — the three version/capability rejections (FR-008) > `unsupported-snapshot-version` — an unsupported requestedSnapshotSchemaVersion
Expected: false
Received: true
```

## Case 3 — `unsupported-capability`

Input: [`case-3-unsupported-capability.patch`](./case-3-unsupported-capability.patch) ·
Output: [`case-3-unsupported-capability.observed.txt`](./case-3-unsupported-capability.observed.txt)

```
(fail) T040 — the three version/capability rejections (FR-008) > `unsupported-capability` — any string other than pathOwnership in the array
Expected: false
Received: true

(fail) T040 — what §2’s capability rule does and does not say > capability matching is exact, never case-insensitive
Expected: false
Received: true
```

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 11 tests pass, 0 fail, with
the source reverted.

## Standing constraints

ADR-0014 **rung 1 only**. Nothing here is reference-verified (rung 2) or externally
validated (rung 3); the observation is the maintainer's own.
