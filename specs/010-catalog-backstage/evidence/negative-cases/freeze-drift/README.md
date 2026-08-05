# Negative case: freeze-hash drift (T023)

**Retained permanent negative case for the ADR-0016 observation of the R5
mechanism-2 drift check (`scripts/check-freeze-hashes.ts`).**

The drift check re-derives the canonical content hash of every frozen artifact
and fails CI on any divergence from the recorded `contentHash`. To observe it
genuinely failing, a single byte of `frozen-expectation-set.json` was flipped
inside a value (`workspaces/alpha/src/**` → `workspaces/blpha/src/**`, one
character, JSON still parseable) in an **isolated copy** — the live frozen
artifact was never left mutated.

Observed reason string (verbatim), from
`bun scripts/check-freeze-hashes.ts <mutated copy>`:

```
frozen-expectations/frozen-expectation-set.json: recorded contentHash does not match recomputed canonical hash (freeze drift) recorded=e641ae5e4201a099e92e98fbaa7683bc0eb0290adb01f93abbd474c695c2430c recomputed=311e54427cce1b1564adb1e4467c7c57b868b61e2a8cc13e2483007cc4e1413f
exit=1
```

Restoring the byte returns the check to `ok` (exit 0). The observation is also
locked in the suite by `scripts/check-freeze-hashes.test.ts` (T023), which
performs the mutate → FAIL → restore → PASS cycle against a copied evidence
tree. This directory records the exact observed output; it holds no mutated
artifact of its own so that the drift check never fails on the live corpus.
