# `frozen-expectations/` — the re-frozen oracle

Holds the `FrozenExpectationSet` of `../../data-model.md` §16.

| File | Written by | Present |
| --- | --- | --- |
| `frozen-expectation-set.json` | T017 | see the directory |
| `audit-record.json` | **T019** — the independent audit | not written by T014–T018 |

## Why this directory exists at all

ADR-0012 gate 3 is `Unmet`: the oracle exists but carries a **known-wrong**
expected result. Spike 009 froze `derivedPathPatterns` in **input order**;
`../../data-model.md` §16 and ADR-0020 clause 6 require **`compareCodeUnits`-sorted
order**, matching the `explicit-paths` requirement in
`specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` §3 that
derived paths are sorted and deduplicated.

Correcting that ordering is the entire reason ADR-0020 clause 6 demands a *fresh*
T014 → T014a cycle rather than reuse. The spike's bundle is untracked
(ADR-0015 Condition of Acceptance 1), so nothing in the repository prevents
someone reusing the stale copy; the only control is doing the cycle again, from
scratch, and tracking the result. That is what this directory is.

## What the audit must do, and what it may not do

Per T019 and `../../data-model.md` §16, the auditor **recomputes**
`contentHash` from the artifact. Copying the recorded value verifies nothing.
The auditor also confirms that `derivedPathPatterns` is in `compareCodeUnits`
order and **not** in input order, and records their own PASS/FAIL.

The auditor must have had **no authoring involvement** in T014–T018. An audit by
the author of the freeze is not an independent audit, and recording it as one
would defeat the control rather than implement it.
