# Negative case: `duplicate-yaml-key` and `invalid-yaml-syntax` collapsed into one

**Task**: T047 · **Supports**: FR-023 (discharged at T071)
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3, `yaml@2.9.0`
**Command**: `bun test test/descriptor-read.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/descriptor-read.test.ts`

`data-model.md` §3 types `parseOutcome` as three values and §8 maps two of them to
**different** trigger classes. `atomic-fail-closed.md` §4 records that
`invalid-yaml-syntax` was added specifically because "the original eleven triggers had
no corresponding `AtomicFailureRecord.triggerClass` for the non-duplicate-key case."

`research.md` R8 fixes the mechanism: the `yaml` package's `uniqueKeys` option defaults
to `true`, so a duplicate mapping key at any level is already reported without
configuration. This module never passes `uniqueKeys: false` and never writes a bespoke
duplicate-key walker — asserted by a test that scans the module's own comment-stripped
source for the string `uniqueKeys` and requires its absence.

---

## Case 1 — the two outcomes collapsed

Input: [`case-1-outcomes-collapsed.patch`](./case-1-outcomes-collapsed.patch) ·
Output: [`case-1-outcomes-collapsed.observed.txt`](./case-1-outcomes-collapsed.observed.txt)

The `firstError.code === DUPLICATE_KEY_CODE` discrimination was replaced with a constant
`'invalid-yaml-syntax'`, so both YAML failure modes report one outcome. Five tests fail:

```
(fail) T047 — the two failure outcomes are distinct > a repeated top-level key is `duplicate-yaml-key`
Expected: "duplicate-yaml-key"
Received: "yaml-parse-error"

(fail) T047 — the two failure outcomes are distinct > a repeated nested key is also `duplicate-yaml-key`
Expected: "duplicate-yaml-key"
Received: "yaml-parse-error"

(fail) T047 — the two failure outcomes are distinct > the two reasons, and the two trigger classes, are different values
```

The third failure is the one that states the property directly: with the discrimination
gone, the two reasons and the two trigger classes are no longer different values.

---

## What the emitted strings are, restored

Read from `test/descriptor-read.test.ts`, which is the permanent case:

| Input | `parseOutcome` | reason | trigger class |
|---|---|---|---|
| `kind: Component` / `kind: API` | `duplicate-yaml-key` | `duplicate-yaml-key` | `duplicate-yaml-key` |
| `metadata:` with a repeated `name` | `duplicate-yaml-key` | `duplicate-yaml-key` | `duplicate-yaml-key` |
| `kind: "Component` (unterminated) | `yaml-parse-error` | `invalid-yaml-syntax` | `invalid-yaml-syntax` |
| `kind: [unterminated` | `yaml-parse-error` | `invalid-yaml-syntax` | `invalid-yaml-syntax` |

The library's own error code appears in the emitted detail (`DUPLICATE_KEY: Map keys
must be unique at line 2, column 1`), which is what the discrimination reads.

## The trap this case also records

A duplicate key **still resolves to a value**: `yaml` reports `DUPLICATE_KEY` *and*
resolves the mapping last-wins. An implementation that read `doc.toJSON()` without
checking `doc.errors` would obtain a plausible-looking descriptor and never notice.
`test/descriptor-read.test.ts` asserts that the reported outcome is the error and that
`raw`/`rawKind` are left `undefined` in that case.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 18 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**.
