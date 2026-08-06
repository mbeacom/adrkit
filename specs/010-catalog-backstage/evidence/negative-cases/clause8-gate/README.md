# Negative case: the ADR-0020 clause-8 gate

**Task**: T098 · **Discharges**: FR-060 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun run check:clause8`, run from the repository root
**Permanent automated case**: `scripts/check-clause8-gate.test.ts` (18 tests)

## The gate is this check. It is NOT ADR-0020's frontmatter assertion.

ADR-0020 carries an assertion, `catalog-adapter-accept-path-needs-annotated-real-corpus`,
stating clause 5 in full. It is declared `engine: custom`; that engine resolves through an
optional registry port; **no port is registered**; the evaluator returns `status: 'inert'`
with `reason: 'assertions-compile.engine-absent'`. It never fails and never can.

Clause 8 says exactly that: *"The frontmatter assertion on this record is **currently
inert** and must not be mistaken for enforcement … It records the rule; it does not enforce
it."* So `scripts/check-clause8-gate.ts` cites the assertion as **the rule it compiles
from** and reads the evidence tree itself. The gate additionally fails if the assertion is
removed, or if its engine changes — because at that point "inert" would have stopped being
true and clause 8's distinction would need revisiting rather than silently going stale.

## Tied to clause 5, without preparing a release

Clause 9 defers both the release vehicle and the decision to release at all. A gate
concluding "clause 5 is met, therefore release" would prepare one.

The assertion's own form avoids that, because it is a **prohibition**: the adapter *may not
be released, and may not claim ADR-0014 rung 2, until* clause 5's evidence exists. That is
violated in exactly two ways, and the gate checks both:

- **Limb A** — clause 5's evidence is incomplete, absent, or FAILing;
- **Limb B** — something claims release or rung 2.

Neither holds today. The gate passes for that reason, not because it authorized anything.

---

## Case 1 — a non-zero false-negative count

Input: [`case-1-nonzero-false-negatives.patch`](./case-1-nonzero-false-negatives.patch) ·
Output: [`case-1-nonzero-false-negatives.observed.txt`](./case-1-nonzero-false-negatives.observed.txt)

`step-b-record.json` was changed to record `falseNegatives: 2`.

```
check-clause8-gate: FAIL — ADR-0020 clause 5 is not satisfied by the recorded evidence.
  [zero false positives and zero false negatives]
    step (b) records falseNegatives = 2
exit=1
```

Clause 5: *"must match with **zero** false positives and **zero** false negatives; any
mismatch fails this assertion."*

---

## Case 2 — a release is prepared

Input: [`case-2-release-prepared.patch`](./case-2-release-prepared.patch) ·
Output: [`case-2-release-prepared.observed.txt`](./case-2-release-prepared.observed.txt)

`@adrkit/catalog-backstage` was given version `0.1.0`.

```
check-clause8-gate: FAIL — ADR-0020 clause 5 is not satisfied by the recorded evidence.
  [the adapter may not be released until clause 5 is met (clause 9 defers it regardless)]
    packages/adapters/catalog-backstage/package.json declares version 0.1.0; clause 9 defers release, so 0.0.0 is the only honest value
exit=1
```

This is limb B, and it is the limb that would otherwise never be exercised: clause 5's
evidence is complete and PASSing, so a gate checking only limb A would report the same
green whether or not limb B was wired up at all.

---

## Case 3 — step (b) inherits step (a)'s verdict

Input: [`case-3-step-b-inherits.patch`](./case-3-step-b-inherits.patch) ·
Output: [`case-3-step-b-inherits.observed.txt`](./case-3-step-b-inherits.observed.txt)

`step-b-record.json` was changed to `inheritsFromStepA: true`.

```
check-clause8-gate: FAIL — ADR-0020 clause 5 is not satisfied by the recorded evidence.
  [two distinct steps, each recording its own hashes and its own PASS/FAIL]
    step (b) does not record `inheritsFromStepA: false`, so the two steps are not distinct
exit=1
```

Clause 5: *"The pre-output freeze/audit and the post-output comparison are two distinct
steps, each recording its own hashes and its own PASS/FAIL."* FR-057 adds: *"Neither may
inherit the other's verdict."*

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — `check-clause8-gate: ok`, exit 0.

## The other requirements, exercised in the unit suite

Mutating the committed evidence tree for every requirement would risk leaving it mutated,
so the remaining cases run against a **copy** in `scripts/check-clause8-gate.test.ts`.
Each asserts the gate names the right requirement, not merely that it failed — a gate that
failed for the wrong reason is indistinguishable in CI from one that failed for the right
one.

| Requirement (clause 5's words) | Mutation |
|---|---|
| two distinct steps, each with own hashes and PASS/FAIL | step (a) verdict → `FAIL` |
| a populated, digest-verified `SnapshotEnvelope` | `envelopeEntities` → 0 |
| zero false positives and zero false negatives | `falsePositives` → 1 |
| the frozen artifacts still hash to what was frozen | a recomputed hash → `match: false` |
| the expectations are never amended to fit the output | `allUnchanged` → `false` |
| descriptors upstream-authored and otherwise unmodified | vendor commit → zeros |
| at least one non-empty owned-paths annotation | every overlay value → `[]` |
| an explicit auditor adequacy finding | the finding removed |
| an absent artifact is not a satisfied one | `step-b-record.json` deleted |
| clause 9: no release claimed or prepared | consumer version; `RELEASE_PACKAGES` entry |
| clause 8: the assertion is still inert | assertion removed; `engine:` changed |

## Standing constraints

ADR-0014 **rung 1 only**. This gate passing does not make the feature reference-verified
and does not make it externally validated; it makes clause 5's evidence checkable.

**No release is scheduled, implied, or prepared.** The gate exists partly to keep that
true: limb B fails the build if it stops being.
