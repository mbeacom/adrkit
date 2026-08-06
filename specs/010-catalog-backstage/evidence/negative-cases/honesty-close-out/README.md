# Negative case: the honesty close-out matches claims, not vocabulary

**Task**: T100 · **Supports**: FR-062, SC-017 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases**: `bun test scripts/check-honesty-close-out.test.ts`
**Permanent automated case**: `scripts/check-honesty-close-out.test.ts` (35 tests)

## The problem this case exists to settle

ADR-0014's state vocabulary is **binding**. So the most honest sentence feature 010 can
write —

> *not `reference-verified` (rung 2), not `externally validated` (rung 3)*

— necessarily contains both of the strings a naive grep would flag. **A check that failed
on bare occurrence would fail the documentation being most careful and pass documentation
that said nothing at all.** The cheapest way to make such a check green would be to delete
the denial, which is the opposite of what ADR-0014 and ADR-0016 exist to produce.

Verifying the check on a claim alone would not settle this. Verifying it on a denial alone
would not either. **Both halves, on the same vocabulary, are the case.**

---

## Case 1 — a real claim, in the close-out itself

Input: [`case-1-a-real-claim.patch`](./case-1-a-real-claim.patch) ·
Output: [`case-1-a-real-claim.observed.txt`](./case-1-a-real-claim.observed.txt)

Added to `honesty-close-out.md`:

> The adapter is reference-verified on rungs 1-2 and is published to npm.

```
+     "assertion": "i",
+     "matched": "is reference-verified",
+     "path": "specs/010-catalog-backstage/evidence/honesty-close-out.md",
+     "ruleId": "rung-2-claim",
+     "assertion": "ii",
+     "matched": "is published to npm",
+     "ruleId": "release-claim",
```

Two rules fired, on assertions (i) and (ii), naming the file and the matched text.

---

## Case 2 — the same terms, as denials

Input: [`case-2-the-same-terms-as-denials.patch`](./case-2-the-same-terms-as-denials.patch) ·
Output: [`case-2-the-same-terms-as-denials.observed.txt`](./case-2-the-same-terms-as-denials.observed.txt)

Added to the same file, in the same place:

> The adapter is not reference-verified on rungs 1-2 and is not published to npm.
> Nothing here is externally validated, and no release is scheduled for any version.
> It is not third-party validation, and no claim is made that Backstage would ingest anything.

```
 35 pass
 0 fail
```

**Every term from case 1 is present, and every one of the six assertion families is
mentioned. The check stays green.** That pair — same vocabulary, opposite verdicts — is
what "match claims, not vocabulary" means in practice, and it is the only way to
demonstrate it.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — 35 pass, 0 fail.

---

## Three real defects the two-sided verification found

The check did **not** work when first written. Each defect below was a rule flagging a
maximally honest passage that already existed in this repository — the exact failure T100
warns about, reproduced live rather than reasoned about.

### 1. Lookbehind cannot see sentence-level negation

The rules were first written with `(?<!not\s)(?<!never\s)` guards. Three real passages were
flagged:

| Flagged passage | Where |
|---|---|
| `Nothing here is reference-verified (rung 2) or externally validated (rung 3).` | `evidence/README.md` |
| `Nothing in this tree is reference-verified (rung 2) or externally validated` | `negative-cases/README.md` |
| `It is not a claim … that Backstage would reject it` | `accept-corpus-freeze/selection-basis.md` |

All three are denials. The negation simply sits further away than a lookbehind can see, and
takes forms a lookbehind cannot enumerate. Replaced with a **sentence-scoped** negation
test.

### 2. A single newline is the wrong sentence boundary for hard-wrapped markdown

With sentence scope in place, two more honest passages were flagged:

- `nothing\nhere is reference-verified (rung 2)` — the hard wrap falls *between* the
  negation and what it negates;
- a bulleted list under the stem *"It does not warrant, and MUST NOT be written as:"*, with
  a blank line between stem and list, where the negation is in the stem and the claim shape
  is in a bullet (`contracts/admissibility.md`).

Fixed by scoping to the **paragraph** rather than the line, and by letting a list inherit
the scope of a colon-terminated stem above it. Table cells stay their own scope, because
status is stated in tables as often as in prose and a row's negation lives in its own cell.

### 3. A negative-case README must be allowed to quote its own violation

`negative-cases/consumer-correctness-claim/README.md` quotes the text its patch adds:

> This package is reference-verified and battle-tested.

That is a document *demonstrating* a violation, not committing one. Markdown blockquote
lines are now treated as attributed material.

**The cost is stated rather than hidden**: a claim could be smuggled into a blockquote.
That is accepted, because the alternative — forbidding negative-case documents from quoting
their own fixtures — would make this evidence tree unwritable.

---

## What the suite asserts, so a green result is not vacuous

| Guard | Why it is there |
|---|---|
| every rule has a claim fixture | a rule with no fixture sits untested in the passing column |
| every rule fires on its claim | a rule that fires on nothing is not a rule |
| no rule fires on any of ten denials | a rule that fires on both is not a working rule |
| the denials really contain the binding vocabulary | otherwise they would pass by saying nothing |
| the denial set splits 5 / 5, both halves named | five are structurally safe (the negation sits between verb and term); five depend on the negation test. If the second half emptied, the negation logic would be untested |
| a claim in a later sentence is not excused by a denial in an earlier one | a document-wide negation search would let one deny once and claim freely |
| the scan read more than 100 files across both packages, contracts and evidence | "found nothing" must be distinguishable from "looked at nothing" |

## Standing constraints

ADR-0014 **rung 1 only**. This check makes the feature's claims auditable; it does not make
them stronger. Nothing here is reference-verified and nothing here is externally validated.
