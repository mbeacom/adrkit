# Negative case: `["[]"]` silently coerced into `explicit-empty`

**Task**: T059 · **Discharges**: FR-027 · **Supports**: SC-006
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3, `yaml@2.9.0`
**Command**: `bun test test/annotation-step2-raw-node.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/annotation-step2-raw-node.test.ts` —
**retained permanently**, per T059.

## The exact fixture, and why it is this one

The annotation value `["[]"]` — a YAML **sequence** containing the string `"[]"`, not a
string — must yield `annotation-value-not-a-string`, and must **never** be silently
coerced into `explicit-empty`.

The coercion path is a language-level fact, not a hypothetical.
`owned-paths-annotation.md` §1 step 2 spells it out: ECMA-262 defines `JSON.parse(text)`
as first coercing `text` to a string via `ToString`, so `["[]"]` becomes the string
`"[]"`, parses cleanly as an empty array, and is then misclassified.

**A misclassification here is worse than a crash.** `explicit-empty` is a *legitimate*
state meaning "this entity deliberately owns nothing", so the failure would be silent and
would look like a considered decision by the descriptor's author.

The TypeScript signature of `JSON.parse` provides **no** runtime protection: it declares
a `string` parameter, and a value arriving from YAML is `unknown`. Only the explicit
`typeof rawNode === 'string'` pre-parse check does.

---

## Case 1 — step 2 removed

Input: [`case-1-step-2-removed-yields-explicit-empty.patch`](./case-1-step-2-removed-yields-explicit-empty.patch) ·
Output: [`case-1-step-2-removed-yields-explicit-empty.observed.txt`](./case-1-step-2-removed-yields-explicit-empty.observed.txt)

Six tests fail. The two that matter most:

```
(fail) T059 — the correct reason is produced, and the wrong one is absent > `decodeAnnotation` yields `annotation-value-not-a-string`
Expected: false
Received: true

(fail) T059 — the correct reason is produced, and the wrong one is absent > and never `explicit-empty` — the absence of the wrong outcome
Expected: false
Received: true
```

The second is the whole point of the case: the assertion that the serialized outcome
does **not** contain `explicit-empty` is what fails. With step 2 gone, the descriptor is
recorded as having deliberately declared ownership of nothing.

Note also what **passes** in the same failing run:

```
(pass) T059 — the coercion this check exists to prevent is real > so an implementation without step 2 would classify it `explicit-empty`
```

That test reproduces the coercion directly, so "step 2 is load-bearing" is a confirmed
danger rather than an assertion about a hypothetical one.

---

## Why the ordering, not merely the presence, is demonstrated

Three fixtures in the permanent case each take a *different* wrong path if step 2 is
skipped, and all three must still report step 2:

| Raw node | Reason if step 2 is skipped | Required reason |
|---|---|---|
| `["[]"]` | classified `explicit-empty` | `annotation-value-not-a-string` |
| `{ a: 1 }` | `parse-error` (`[object Object]` is not JSON) | `annotation-value-not-a-string` |
| `3` | `wrong-shape` (`"3"` parses to a number) | `annotation-value-not-a-string` |

If the check merely existed somewhere later, at most one of these would land correctly.
All three landing on step 2 is what shows the ordering.

The diagnostics record carries the same claim structurally:
`jsonParseOutcome === 'not-a-string'` and `shapeOutcome === undefined`, i.e. step 3 was
never reached.

## The check is not a blanket ban

A genuine `explicit-empty` is still reachable — `deriveOwnership(true, '[]')` yields it.
If `["[]"]` were rejected by something that also rejected the legitimate case, this
fixture would prove nothing about step 2 specifically.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 12 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**.
