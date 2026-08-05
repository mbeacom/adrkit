# Negative case: a descriptor that is **inadmissible and canonically unique**

**Task**: T054 · **Discharges**: FR-021 · **Supports**: SC-004
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command**: `bun test test/inadmissible-and-unique.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/inadmissible-and-unique.test.ts` —
**retained permanently**, per T054.

## Why this specific fixture exists

`admissibility.md` §6: the two determinations are independent, and conformance evidence
"MUST demonstrate that independence rather than assert it. Specifically, the evidence
MUST include at least one descriptor that is **inadmissible and canonically unique** — a
descriptor that fails §2 while colliding with nothing. Without such a case, a passing
suite is equally consistent with an implementation that has silently fused the two
checks."

ADR-0015 says the same about the corpus that motivated it: of the sixteen unsubstituted
placeholder descriptors, fourteen share `${{ values.name | dump }}` and collide with one
another, while `bulk-import` (`${{ values.name }}`) and `orchestrator`
(`${{ values.entityName }}`) "canonicalize distinctly and collide with nothing. They are
exactly as invalid as the other fourteen, and the contract has no mechanism of any kind
that would notice. The duplicate rule catches the fourteen only incidentally, as a side
effect of their sharing a string; behind it there is nothing."

Both outliers are reproduced as hand-authored fixtures. **No corpus is read.**

---

## Case 1 — the two checks fused

Input: [`case-1-admissibility-fused-into-duplicate-detection.patch`](./case-1-admissibility-fused-into-duplicate-detection.patch) ·
Output: [`case-1-admissibility-fused-into-duplicate-detection.observed.txt`](./case-1-admissibility-fused-into-duplicate-detection.observed.txt)

`classifyAdmissibility`'s `admissible` was forced to `true`, which is precisely the
implementation §6 warns a passing suite would otherwise be consistent with: one where
duplicate detection is the only validity check. **Eleven tests fail.**

```
(fail) T054 — the fixture is genuinely inadmissible > bulk-import descriptor classifies as inadmissible, attributed to metadata.name
(fail) T054 — the fixture is genuinely inadmissible > orchestrator descriptor classifies as inadmissible, attributed to metadata.name
(fail) T054 — it produces `inadmissible-descriptor` and NOT `duplicate-canonical-id` > bulk-import descriptor: the emitted trigger class
Expected: false
Received: true
```

The failure set includes `%s: alone in a run, with nothing to collide with` for both
outliers — a batch of one, where no pair exists and therefore no duplicate rule could
possibly fire. That is the case that isolates admissibility from duplicate detection
completely: the rejection that fires there can only have come from admissibility.

---

## What is emitted, restored

| Fixture | `metadata.name` | reason | trigger class | attributed to |
|---|---|---|---|---|
| `bulk-import` | `${{ values.name }}` | `inadmissible-descriptor` | `inadmissible-descriptor` | `metadata.name` / `validateEntityName` |
| `orchestrator` | `${{ values.entityName }}` | `inadmissible-descriptor` | `inadmissible-descriptor` | `metadata.name` / `validateEntityName` |

And the absence that matters: the emitted record contains no canonical id, and
`JSON.stringify(rejection)` contains no occurrence of `duplicate`.

The record carries all three FR-020 attributions, e.g.

```
plugins/bulk-import/catalog-info.yaml[0]: metadata.name rejected by validateEntityName
(isValidEntityName → KubernetesValidatorFunctions.isValidObjectName, pinned at
1121a4facd9e321179d0402c3f355e4a649e84d9); observed "${{ values.name }}"
```

## The counting note

The **fourteen** in this record counts *placeholder descriptors*. It is **not** the
trigger count. This feature's fatal trigger enumeration has **fifteen** members
(`admissibility.md` §5.1 and §6.1; `data-model.md` §8). Two unrelated fourteens; §6.1
says a reader who fuses them "will produce a document this repository fails."

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 15 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**. These are hand-authored fixtures reproducing the *strings*
ADR-0015 records. Nothing here asserts what Backstage as a running system does with
them — only what the pinned validator predicate returns.
