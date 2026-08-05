# Negative case: comparison mismatch (T089)

**Retained permanent negative case for the ADR-0016 observation of the ADR-0020
clause-5 step (b) comparison gate (`scripts/compare-accept-corpus.ts`).**

The gate requires derived ownership for every annotated entity in the frozen
accept corpus to match the frozen expectations at **zero false positives and zero
false negatives**. A gate that has only ever been seen green is not coverage, so
it was made to fail.

## What was constructed

A deliberate mismatch was introduced into the **comparison input** — the corpus
side — and never into the frozen expectations. One overlay annotation value was
replaced with a plausible-looking near-miss:

| | Value |
| --- | --- |
| Frozen overlay for `workspaces/adr/plugins/adr-backend/catalog-info.yaml[0]` | `["packages/core/**","packages/core/**","packages/cli/**"]` |
| Mutated value | `["packages/core/**","packages/clx/**"]` |

`cli` → `clx`: one character. The near-miss is the point. A wholesale replacement
would fail on everything at once and would not show that the comparison
discriminates; this yields **exactly one false negative** and **exactly one false
positive** on the same entity, plus the corpus-wide pattern-union mismatch that
follows from it.

The mutation lives in source as the named constant `T089_MUTATION` in
`scripts/compare-accept-corpus.ts`, so the retained artifact is a line of code
rather than a shell invocation somebody has to reproduce exactly. It is reachable
only through the `--observe-failing` flag, which writes no report; the committed
`diff-report.json` always describes an unmutated run.

## The command that produced the failure

```bash
bun run scripts/compare-accept-corpus.ts --observe-failing
```

`bun run scripts/compare-accept-corpus.ts` (no flag) is **not** interchangeable
with it: the unflagged form runs the real comparison and passes.

## Observed output

Captured verbatim into `observed-fail.txt` by the run itself, not transcribed:

```
compare-accept-corpus: FAIL — 24 expected entities, 1 false positive(s), 1 false negative(s), 1 other mismatch(es)
  false-negative component:default/backstage-plugin-adr-backend: expected path was not derived — expected "packages/cli/**"; derivedPaths = ["packages/clx/**","packages/core/**"]
  false-positive component:default/backstage-plugin-adr-backend: derived path is not in the frozen expectation — derived "packages/clx/**"; expectedPaths = ["packages/cli/**","packages/core/**"]
  other-mismatch (corpus-wide): the union of derived patterns does not match the oracle derivedPathPatterns — oracle records 25 patterns, output yields 26
exit=1
```

Removing the mutation returns the gate to PASS, captured in
`restored.observed.txt`:

```
compare-accept-corpus: PASS — 24 expected entities, 0 false positive(s), 0 false negative(s), 0 other mismatch(es)
exit=0
```

## What was not touched

**The frozen expectations.** Nothing in this cycle wrote to
`../../frozen-expectations/` or `../../accept-corpus-freeze/`, and two independent
controls would have caught it if anything had: `bun run check:freeze-hashes` and
`../../comparison/expectations-unchanged.json`, which compares each frozen hash
recomputed now against the value the Barrier B checkpoint recorded before any
generator existed.

This directory holds no mutated artifact of its own, for the same reason
`freeze-drift/` does not: a mutated file left in the tree would make a live check
fail on every build.

## Where the permanent automated case lives

`scripts/compare-accept-corpus.test.ts` performs the whole mutate → FAIL →
restore → PASS cycle in-suite against the real corpus, asserts the exact reason
strings above, and separately asserts that the frozen artifact's bytes are
identical before and after the mutated run. Every individual failure mode of the
comparison kernel — missing entity, undelivered expected path, unlicensed derived
path, wrong ownership state, right members in the wrong order, wrong source
document, wrong pattern union, and an out-of-set entity deriving ownership — is
additionally driven against an input built to trip it.

## Standing constraints

ADR-0014 **rung 1 only**. This observation is maintainer-owned, which is not
external, third-party, or community validation.
