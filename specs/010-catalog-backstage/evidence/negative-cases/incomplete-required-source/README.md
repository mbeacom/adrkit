# Negative case: `incomplete-required-source`

**Task**: T043 · **Discharges**: FR-011
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test test/manifest-digests.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/manifest-digests.test.ts`

`input-manifest.md` §4: each listed file is read, its actual digest **independently
recomputed**, and compared. A mismatch, or a manifest-listed path absent from disk, is
an `incomplete-required-source` rejection — "a property of the manifest/generation
request, aborting before any entity's paths are derived, never a per-entity skip."

FR-011 adds a third condition to §4's two: a **wrongly typed** digest.

| # | Check disabled | Fine-grained reason that stopped being emitted | Tests failing |
|---|---|---|---|
| 1 | digest recomputation compared against the declared value | `digest-mismatch` | 3 |
| 2 | source-existence check | `source-missing` | 3 |
| 3 | digest shape (64 lowercase hex) | `digest-malformed` | 4 |

---

## Case 1 — the declared digest is trusted rather than verified

Input: [`case-1-digest-not-verified.patch`](./case-1-digest-not-verified.patch) ·
Output: [`case-1-digest-not-verified.observed.txt`](./case-1-digest-not-verified.observed.txt)

```
(fail) T043 — digest verification against bytes > a single changed byte is a mismatch
(fail) T043 — digest verification against bytes > the digest is recomputed, never trusted from the manifest
(fail) T043 — verification over the whole source set > the three reasons are mutually distinct
Expected: false
Received: true
```

The middle failure is the load-bearing one: its fixture declares a perfectly
**well-formed** digest of the **wrong** content, so an implementation that only
shape-checked the declared value would accept it. Shape-checking alone is not
verification.

## Case 2 — a manifest-listed path absent from disk is not noticed as absent

Input: [`case-2-missing-source-skipped.patch`](./case-2-missing-source-skipped.patch) ·
Output: [`case-2-missing-source-skipped.observed.txt`](./case-2-missing-source-skipped.observed.txt)

```
(fail) T043 — verification over the whole source set > a manifest-listed path absent from disk is `source-missing`
Expected: "source-missing"
Received: "source-unreadable"
```

Worth recording precisely: with the existence check removed the run still fails, but it
fails **for the wrong reason** — the read throws and is reported as `source-unreadable`.
A reader would conclude a permissions or I/O fault where the actual defect is a manifest
naming a file that is not there. Both map to `incomplete-required-source`, so the
trigger class alone would not have caught this; the distinct fine-grained reason is what
does.

## Case 3 — a malformed digest is compared instead of rejected

Input: [`case-3-digest-shape-unchecked.patch`](./case-3-digest-shape-unchecked.patch) ·
Output: [`case-3-digest-shape-unchecked.observed.txt`](./case-3-digest-shape-unchecked.observed.txt)

```
(fail) T043 — digest shape (FR-011’s "wrongly typed") > an uppercase-hex digest is rejected before any file is opened
(fail) T043 — digest shape (FR-011’s "wrongly typed") > a truncated digest is rejected
(fail) T043 — digest shape (FR-011’s "wrongly typed") > a non-hex digest is rejected
Expected: false
Received: true
```

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 16 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**.
