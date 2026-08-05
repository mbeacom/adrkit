# `comparison/` — ADR-0020 clause 5 **step (b)**

Written by Phase F (T087–T092). Step (a) — the pre-output freeze and its
independent audit — lives in `../frozen-expectations/` and
`../accept-corpus-freeze/` and is **not written to by anything here**.

| File | Written by | Purpose |
| --- | --- | --- |
| `harness-provenance.md` | T087 | That the comparison harness was authored **after** the freeze and its audit — R5 mechanism 3 |
| `diff-report.json` | T088 | The diff itself: derived ownership vs. the frozen expectations, at zero FP / zero FN |
| `step-b-record.json` | T090 | Step (b)'s **own** hashes and **own** PASS/FAIL, inheriting nothing from step (a) |
| `expectations-unchanged.json` | T091 | That the frozen hashes are unchanged from their Phase B values, across all of E and F |
| `reporting-honesty.md` | T092 | What this phase's artifacts do and do not claim |

Every JSON file here is **produced by a run**, never hand-written:

```bash
bun run scripts/compare-accept-corpus.ts
```

## The two things a reader should check first

1. **The comparison never wrote to the frozen trees.** `expectations-unchanged.json`
   compares each frozen artifact's hash, recomputed now, against the value the
   **Barrier B checkpoint** recorded before any generator existed —
   `../barrier-b-checkpoint.json`, written by the independent auditor session
   rather than by the freeze's author. `scripts/check-freeze-hashes.ts`
   independently fails the build on any drift, and has been observed genuinely
   failing on a one-byte mutation (`../negative-cases/freeze-drift/`).

   A comparison that passes because the expectations moved is not a passing
   comparison. That is the failure this whole apparatus exists to prevent.

2. **The gate has been observed failing.** `../negative-cases/comparison-mismatch/`
   holds the verbatim FAIL output from a deliberately mutated comparison input,
   and the restored PASS. A gate seen only green is not coverage (ADR-0016).

## What step (b) establishes, and what it does not

It establishes that the generator's derived ownership over this frozen corpus
agrees, exactly and in order, with a **maintainer-authored** expectation set
frozen before any generator output existed.

It does **not** establish correctness in any absolute sense. The expectations are
the maintainer's own, hand-derived from frozen contracts; agreement between our
implementation and our specification is not independent evidence that either is
right. The envelope's self-digest establishes **integrity**, not correctness — a
semantically wrong envelope can carry a perfectly valid self-digest.

`reporting-honesty.md` states this in full, and
`scripts/compare-accept-corpus.test.ts` scans every artifact in this directory to
check that none of them says otherwise.

ADR-0014 **rung 1 only**. Nothing here is reference-verified (rung 2) or
externally validated (rung 3), and nothing here schedules or prepares a release.
