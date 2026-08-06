# Negative case: the annotation's ordered decode steps

**Task**: T058 · **Discharges**: FR-026 · **Supports**: SC-006
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test test/annotation-decode.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/annotation-decode.test.ts`

`owned-paths-annotation.md` §1 fixes five ordered steps. **Three of them can produce a
rejection reason of their own** — steps 2, 3 and 4. Step 1 (presence) has no rejection:
an absent annotation is the legitimate `annotation-absent` state, not an error. Step 5
delegates to the glob dialect, whose reasons are that contract's and are covered by
[`../glob-rules/`](../glob-rules/). That asymmetry is stated here rather than left
implicit, because "five steps, three reasons" otherwise reads as two missing cases.

| # | Step disabled | Distinct reason that stopped being emitted | Tests failing |
|---|---|---|---|
| 1 | 2 — string-scalar check on the raw node | `annotation-value-not-a-string` | 9 |
| 2 | 3 — JSON decode (reason collapsed into step 4's) | `parse-error` | 7 |
| 3 | 4 — shape: exactly `array<string>` | `wrong-shape` | 14 |
| 4 | *(none disabled)* — steps 2 and 3 **reordered**, every reason preserved | the *ordering* itself | 1 |

---

## Case 1 — step 2, the string-scalar check

Input: [`case-1-step-2-string-scalar-check.patch`](./case-1-step-2-string-scalar-check.patch) ·
Output: [`case-1-step-2-string-scalar-check.observed.txt`](./case-1-step-2-string-scalar-check.observed.txt)

```
(fail) T058 — `owned-paths-annotation.md` §1’s worked-example table > row 2 — a YAML sequence yields `annotation-value-not-a-string`
(fail) T058 step 1 — presence, via an explicit discriminant > presence is not inferred from the value — a present null reaches step 2
(fail) T058 step 2 — the string-scalar check, before any parse > a YAML sequence is rejected as `annotation-value-not-a-string`
Expected: "annotation-value-not-a-string"
Received: "wrong-shape"
```

The `Received: "wrong-shape"` line is what makes this more than a missing rejection:
with step 2 gone, non-string nodes are silently coerced by `JSON.parse` and then
misreported under a *neighbouring* step's reason. The dedicated FR-027 case — where the
misclassification is `explicit-empty` rather than a rejection at all — is recorded
separately at [`../annotation-sequence-coercion/`](../annotation-sequence-coercion/).

## Case 2 — step 3, JSON decode

Input: [`case-2-step-3-parse-error-collapsed-into-wrong-shape.patch`](./case-2-step-3-parse-error-collapsed-into-wrong-shape.patch) ·
Output: [`case-2-step-3-parse-error-collapsed-into-wrong-shape.observed.txt`](./case-2-step-3-parse-error-collapsed-into-wrong-shape.observed.txt)

The catch branch's reason was changed from `parse-error` to `wrong-shape` — collapsing
step 3 into step 4, which §1 step 3 forbids in terms ("**not** the same reason as step
2's non-string failure or step 4's shape failure").

```
(fail) T058 — `owned-paths-annotation.md` §1’s worked-example table > row 6 — malformed JSON yields `parse-error`
(fail) T058 step 3 — JSON decode, reached only by a present string scalar > "[\"packages/**\"" is rejected as `parse-error`
Expected: "parse-error"
Received: "wrong-shape"
```

## Case 3 — step 4, shape validation

Input: [`case-3-step-4-shape-check.patch`](./case-3-step-4-shape-check.patch) ·
Output: [`case-3-step-4-shape-check.observed.txt`](./case-3-step-4-shape-check.observed.txt)

Fourteen tests fail — the whole shape population, including every row of §1's worked
example that ends in `wrong-shape`:

```
(fail) T058 — §1’s worked-example table > row 3 — a JSON object yields `wrong-shape`
(fail) T058 — §1’s worked-example table > row 4 — a bare string yields `wrong-shape`, never a single-element array
(fail) T058 — §1’s worked-example table > row 5 — an array with a non-string element yields `wrong-shape`
Expected: false
Received: true
```

---

## The three reasons, restored

| Step | Raw annotation node | Reason | Trigger class |
|---|---|---|---|
| 2 | `["[]"]` (YAML sequence) | `annotation-value-not-a-string` | `invalid-annotation-parse` |
| 3 | `'["packages/payments/**'` | `parse-error` | `invalid-annotation-parse` |
| 4 | `'{"paths": ["a/**"]}'` | `wrong-shape` | `invalid-annotation-shape` |

Steps 2 and 3 share a trigger class and are kept distinct at the `reason` level, which
is what §1 actually requires. `data-model.md` §8 carries only two annotation trigger
classes, so a 1:1 mapping to three reasons is not available.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 30 tests pass, 0 fail.

---

## Case 4 — the ordering, with every reason preserved (T062)

**Task**: T062 · **Discharges**: SC-006 · **Observed**: 2026-08-05, Phase G
**Command**: `bun test test/sc-006.test.ts`

Input: [`case-4-step-2-3-reorder.patch`](./case-4-step-2-3-reorder.patch) ·
Output: [`case-4-step-2-3-reorder.observed.txt`](./case-4-step-2-3-reorder.observed.txt)

Cases 1–3 each **disable** a step, so each is caught by the reason that stops being
emitted. T062 requires more than that: the test must also catch a **reordering which
happened to preserve the reasons**. Cases 1–3 do not demonstrate that, because a
reorder removes no reason.

This case is the hostile construction. Steps 2 and 3 are swapped so the `JSON.parse`
runs first, **and the diagnostics record is left reporting `jsonParseOutcome:
'not-a-string'`** — that is, the mutation lies about its own ordering, so that every
assertion reading the diagnostic record still passes. The reason for the primary
step-2 fixture also survives: `['[]']` is coerced by `ToString` to `'[]'`, parses
cleanly, and then still fails the string check with `annotation-value-not-a-string`.

**16 of 17 tests passed under the reorder.** One did not:

```
(fail) SC-006 — the string-scalar check runs BEFORE any JSON parse > a mapping that would fail to parse still reports step 2
Expected: "annotation-value-not-a-string"
Received: "parse-error"
```

The discriminating input is a YAML **mapping**. `String({a: 1})` is `'[object Object]'`,
which throws in `JSON.parse` — so it yields step 2's reason under the correct order and
step 3's under the reversed one. A sequence could not have distinguished them.

Because the ordering claim rested on a single fixture inside a differently-named
`describe` block, an explicitly named assertion — *"a reason-preserving reorder of
steps 2 and 3 is still caught"* — was added to `test/sc-006.test.ts` after this
observation, carrying both inputs and citing this file. The margin, not the outcome,
is what the addition addresses.

**Restored**: 17 pass, 0 fail.

---

## Standing constraints

ADR-0014 **rung 1 only**.
