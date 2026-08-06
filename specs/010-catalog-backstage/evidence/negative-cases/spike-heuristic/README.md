# Negative case: no spike-009 B/C/D comparison heuristic

**Task**: T097 · **Discharges**: FR-061 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases**: `bun run check:no-spike-heuristics`, from the repository root
**Permanent automated case**: `scripts/check-no-spike-heuristics.test.ts` (19 tests)

## What B, C and D are

From spike 009's
[`contracts/comparison-heuristics.md` §1](../../../../009-catalog-binding-viability/contracts/comparison-heuristics.md),
read at its original location:

| Option | What it is | Authoritative? |
|---|---|---|
| **A** (`adrkit.io/owned-paths`) | The sole candidate for default, authoritative binding | The only one measured as such |
| **B** (descriptor-parent) | Candidate paths = the descriptor file's own parent-directory glob | **Never** |
| **C** (repository-root) | Candidate paths = the entire repository (`**`) | **Never** |
| **D** (identity-only) | Canonical refs with no path binding at all | Not applicable |

`contracts/README.md` §2 excludes that contract from feature 010 outright: *"This feature
has no options to compare — ADR-0020 authorizes one design."*

## The claim rests on a signature, not on a word search

A grep for "heuristic" would prove nothing. A heuristic implemented without ever using the
word is still a heuristic, and prose *describing* the prohibition is not a violation of it.

What actually binds is that **`deriveOwnership` receives the annotation node and nothing
else** — no source path, no descriptor path, no checkout root. Without those values, a
parent-directory glob (B) and a repository-root glob (C) are not things the function could
compute. Options B and C are **inexpressible at the derivation boundary**, which is a
stronger statement than their absence from a text scan.

The lexical rules are a second layer, for the case someone adds the parameter.

**Option D needs care.** Identity with no path binding is not forbidden as a *shape* — it
is exactly an `annotation-absent` entity, which this feature emits deliberately. What is
forbidden is D as a *comparison option*: a labelled alternative, an opt-in mode, a report
row. The rule targets the apparatus, not the shape.

---

## Case 1 — option B reintroduced

Input: [`case-1-option-b-descriptor-parent.patch`](./case-1-option-b-descriptor-parent.patch) ·
Output: [`case-1-option-b-descriptor-parent.observed.txt`](./case-1-option-b-descriptor-parent.observed.txt)

`deriveOwnership` was given an optional `sourcePath` parameter and computed
`` `${dirname(sourcePath)}/**` `` from it — option B, written out.

```
check-no-spike-heuristics: FAIL — a spike-009 B/C/D comparison heuristic appears in scope.
  packages/adapters/catalog-backstage/src/ownership/derive.ts
    [option B] derivation-receives-a-path: matched "sourcePath"
    [option B] ownership-imports-path: matched "node:path"
    [option B] descriptor-parent-heuristic: matched "descriptorParent"
exit=1
```

**All three layers fired independently** — the signature check, the module-import check,
and the lexical rule. That redundancy is deliberate: a mutation that dodged the lexical
rule by renaming the variable would still be caught by the first two, which is the point
of not resting the claim on vocabulary.

---

## Case 2 — option C reintroduced

Input: [`case-2-option-c-repository-root.patch`](./case-2-option-c-repository-root.patch) ·
Output: [`case-2-option-c-repository-root.observed.txt`](./case-2-option-c-repository-root.observed.txt)

A `** `-as-fallback was added: `decoded.value.patterns ?? ['**']`. This is subtler than
case 1 — no new parameter, no new import, no suspicious identifier. It reads like ordinary
defensive coding, and it is option C.

```
check-no-spike-heuristics: FAIL — a spike-009 B/C/D comparison heuristic appears in scope.
  packages/adapters/catalog-backstage/src/ownership/derive.ts
    [option C] repository-root-fallback: matched "['**']"
    a `**` default is option C: candidate paths = the entire repository
exit=1
```

Only one layer fired, and it fired on the shape of the expression rather than on a name.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — ok, 100 modules scanned across 2
packages, exit 0.

## The guard does not fire on documentation of the rule it enforces

This is the failure mode that would actually bite. Both packages document the prohibition
at length, and a scanner matching prose could only be silenced by deleting the
documentation. The scan therefore runs over **comment-stripped** source, and the unit
suite asserts the discrimination in both directions:

- a doc comment naming `descriptorParent`, `dirname(sourcePath)`, `optionC` and
  `"non-authoritative"` → **no violation**;
- the same identifier in real code → **violation**;
- `"non-authoritative"` in a *string literal* → **violation**, because strings survive
  stripping deliberately: the label in a string is the report label itself, not a
  description of it.

The suite also asserts that every declared rule has a fixture, so a rule can never sit in
the passing column unexercised — which is the gap T099 would otherwise have to report.

## The runtime agrees with the structural claim

| Input | `ownershipState` | `derivedPaths` |
|---|---|---|
| no annotation | `annotation-absent` | `[]` — not the parent glob, not `**` |
| `[]` | `explicit-empty` | `[]` |
| `["packages/one/**","docs/**"]` | `explicit-paths` | exactly those two, sorted per FR-033 |

The third row is where B or C would appear as an *extra* member. The length assertion is
what rules out augmentation.

## Standing constraints

ADR-0014 **rung 1 only**. Only corpus **data** is third-party; the validation never is.
