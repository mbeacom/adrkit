# Negative case: the four admissibility field validators, separately attributed

**Task**: T049 · **Discharges**: FR-016 · **Supports**: FR-017, SC-004
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test test/admissibility-validators.test.ts`, run
from `packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/admissibility-validators.test.ts`

## The warrant, before anything else

Every statement here is a statement about **what a pure validator predicate returns when
invoked**, at Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`. It is **not**
a statement about what Backstage as a running system does with a descriptor. This
feature has never run one and will not. The pin is load-bearing: a different commit is a
different predicate and therefore a different contract (`admissibility.md` §1).

## Each of the four, observed failing independently

`admissibility.md` §8 requires each of the four predicates and the composition to land by
three moves: construct a descriptor that should fail *that specific* validator, observe
the failure and record the exact reason, then correct the input and observe the pass.

| # | Validator disabled | Pinned binding it reproduces (ADR-0015) | Tests failing |
|---|---|---|---|
| 1 | `validateApiVersion` — the two-or-more-separator rejection only | `isValidApiVersion` → `CommonValidatorFunctions.isValidPrefixAndOrSuffix` | 1 |
| 2 | `validateKind` | `isValidKind` | 4 |
| 3 | `validateEntityName` | `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName` | 5 |
| 4 | `validateNamespace` | `isValidNamespace` → `KubernetesValidatorFunctions.isValidNamespace` → `CommonValidatorFunctions.isValidDnsLabel` | 5 |

---

## Case 1 — `validateApiVersion`, separator rule (FR-017)

Input: [`case-1-validateApiVersion-separator-rule.patch`](./case-1-validateApiVersion-separator-rule.patch) ·
Output: [`case-1-validateApiVersion-separator-rule.observed.txt`](./case-1-validateApiVersion-separator-rule.observed.txt)

Only the `too-many-separators` branch was flipped, leaving the prefix and suffix
predicates intact.

```
(fail) T049 — `validateApiVersion` > the four facts ADR-0015 recorded as executed against the pin
Expected: false
Received: true
```

That test pins the four `apiVersion` facts ADR-0015 records as obtained by **executing**
the pinned sources rather than reading them — a 243-character prefix passes; a
254-character one, an over-63 label, and a two-separator value all fail. They are the
only admissibility expectations in the source documents obtained that way, which is why
they are asserted as a group.

## Case 2 — `validateKind`

Input: [`case-2-validateKind.patch`](./case-2-validateKind.patch) ·
Output: [`case-2-validateKind.observed.txt`](./case-2-validateKind.observed.txt)

```
(fail) ... > a leading digit fails — the first character class excludes it
(fail) ... > punctuation fails
(fail) ... > the ≤63 bound holds at the boundary
Expected: false
Received: true
```

## Case 3 — `validateEntityName`

Input: [`case-3-validateEntityName.patch`](./case-3-validateEntityName.patch) ·
Output: [`case-3-validateEntityName.observed.txt`](./case-3-validateEntityName.observed.txt)

```
(fail) ... > a leading or trailing separator fails
(fail) ... > the unsubstituted scaffolder placeholders ADR-0015 names all fail
(fail) ... > the ≤63 bound holds at the boundary
Expected: false
Received: true
```

The second failure covers the three placeholder forms ADR-0015 names —
`${{ values.name | dump }}`, `${{ values.name }}`, `${{ values.entityName }}` — which
that record says "fail `isValidObjectName` on character class: `$`, `{`, `}` and the
spaces are outside the permitted set in every case, and `|` in the first."

## Case 4 — `validateNamespace`

Input: [`case-4-validateNamespace.patch`](./case-4-validateNamespace.patch) ·
Output: [`case-4-validateNamespace.observed.txt`](./case-4-validateNamespace.observed.txt)

```
(fail) ... > uppercase fails — this is where ADR-0015 and `admissibility.md` §2 diverge
(fail) ... > a leading or trailing hyphen fails
(fail) ... > an empty namespace fails — present-and-empty is not omitted
Expected: false
Received: true
```

---

## Two contract discrepancies this case surfaced, reported not resolved

1. **The namespace character class.** `contracts/admissibility.md` §2's summary table
   gives `metadata.namespace` the class "`[A-Za-z0-9]` plus `-`, `_`, `.`" — the same
   class it gives `metadata.name`. ADR-0015 and FR-016 give it the DNS-label predicate
   `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, which admits **no** uppercase, **no** `_`, and
   **no** `.`. FR-016 requires "exactly the four field validators in ADR-0015's table",
   so ADR-0015 governs. The failing test named in case 4 is the one that would pass if
   someone implemented §2's summary instead.
2. **`AdmissibilityField`.** `data-model.md` §4 types it as
   `"kind" | "metadata.name" | "metadata.namespace" | "spec.type"` — omitting
   `apiVersion`, which ADR-0015 requires, and adding `spec.type`, which no validator in
   the table covers. ADR-0015's four fields are used.

## One composition, flagged rather than buried

ADR-0015 states `isValidDnsSubdomain`'s **bounds** (≤253 total, each dot-separated label
≤63) but not the character class of an individual label. It states
`CommonValidatorFunctions.isValidDnsLabel`'s predicate in the namespace row of the same
table. A subdomain is therefore implemented as *dot-separated labels each satisfying the
stated `isValidDnsLabel` predicate*, bounded as stated — a composition of two things the
table says, not an invention, but the only place transcription was insufficient. Case 1
is the check that this composition reproduces ADR-0015's own executed observations.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 30 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**. `admissibility.md` §7: an admissibility pass warrants exactly
one sentence — *the four validator predicates at the pinned commit returned true for
this descriptor's four fields.* It does not warrant that the descriptor is valid,
correct, well-formed, or accepted; that Backstage would ingest it; or that any path
derived from it is a path anyone actually owns.
