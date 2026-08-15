# Negative case: SC-009 limb 2, discharged over the frozen accept corpus

**Task**: T086 · **Discharges**: SC-009 (limb 2) · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases**: `bun test test/sc-009.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/sc-009.test.ts`

SC-009 limb 2 requires that *"at least one pass over a real corpus meeting ADR-0020
clause 5's conditions produces a populated envelope."* Phase E left T086 unchecked because
the corpus was not in this repository. T086a vendored it; Phase F ran the pass and recorded
the outcome. This task wires that outcome into SC-009's close-out.

**The pass is not performed in `sc-009.test.ts`, and the close-out does not pretend it is.**
Every fixture in that file is maintainer-authored and meets none of clause 5's conditions —
a fact the suite continues to assert. The clause-5 conforming pass is Phase F's
`compareAcceptCorpus`, which runs a live generation over the vendored tree on every
`bun test`. The close-out asserts Phase F's recorded outcome and **pins the citation**.

## What the close-out asserts

| Assertion | Source read |
|---|---|
| verdict `PASS` | `evidence/comparison/step-b-record.json` |
| 24 expected entities, **25** envelope entities, 0 FP, 0 FN | same |
| envelope digest is a 64-hex sha256 | same |
| step (b)'s recomputed freeze hash matches the freeze as it exists now | same + `accept-corpus-freeze.json` |
| repository is `github.com/backstage/community-plugins`, size 24 | `accept-corpus-freeze.json` |
| the cited harness still performs a live comparison | `scripts/compare-accept-corpus.test.ts` |

The 25/24 gap is not a discrepancy. 24 *selected descriptor files* carry 24 annotated
entities; one of those files holds a second, unselected document, so the envelope carries
25. Descriptor **file** counts and entity **document** counts are different numbers
throughout this feature.

---

## Case 1 — the recorded verdict is flipped

Input: [`case-1-recorded-verdict-flipped.patch`](./case-1-recorded-verdict-flipped.patch) ·
Output: [`case-1-recorded-verdict-flipped.observed.txt`](./case-1-recorded-verdict-flipped.observed.txt)

`step-b-record.json`'s `verdict` was changed `PASS` → `FAIL` and `falsePositives` `0` → `1`.

```
(fail) T086 / SC-009 limb 2 — discharged over the frozen accept corpus > a pass over that corpus produced a POPULATED envelope — 25 entities, 0 FP / 0 FN

Expected: "PASS"
Received: "FAIL"
```

13 pass, 1 fail. Restored: 14 pass, 0 fail.

---

## Case 2 — the cited harness is gutted

Input: [`case-2-harness-gutted.patch`](./case-2-harness-gutted.patch) ·
Output: [`case-2-harness-gutted.observed.txt`](./case-2-harness-gutted.observed.txt)

Every live `compareAcceptCorpus(REPO_ROOT)` call in `scripts/compare-accept-corpus.test.ts`
was replaced with a `readRecordedReport()` stub — the substitution that would make limb 2's
recorded outcome self-referential, with nothing generating anything.

```
(fail) T086 / SC-009 limb 2 — discharged over the frozen accept corpus > the live pass this close-out cites really is a live pass, and still exists

Expected: >= 4
Received: 0
```

### The first version of this pin did NOT fail, and that is why this case exists

The citation pin was written first as a bare
`expect(harnessTest).toContain('compareAcceptCorpus(REPO_ROOT)')`. Under a gutted SC-011
block **it passed** — 14 pass, 0 fail — because the same call appears in other `describe`
blocks of the same file. A substring check over a whole file cannot tell "the block that
proves limb 2 still runs a live pass" from "the string appears somewhere".

Observing that pass is what produced the current pin: it slices the SC-011 block out of the
file and counts live calls **within it**. Had the check only ever been run against a healthy
harness, it would have been recorded as coverage and would have been worth nothing — which
is precisely ADR-0016's claim, met in practice rather than in principle.

Restored: 14 pass, 0 fail.

---

## Standing constraints

ADR-0014 **rung 1 only**. This is maintainer-owned verification. It is not external,
third-party, or community validation, and limb 2's discharge does not make it any of those.
Only the corpus **data** is third-party; the validation is not.

The envelope digest recorded above is **integrity, not correctness** (ADR-0020 clause 5).
What speaks to correctness is the 0/0 comparison against the frozen expectations.
