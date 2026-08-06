# Negative case: the observed-failing register itself

**Task**: T099 · **Discharges**: FR-059 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases**: `bun test scripts/check-observed-failing-register.test.ts`
**Permanent automated case**: `scripts/check-observed-failing-register.test.ts`

## Why the register needs a negative case of its own

`evidence/observed-failing-register.md` reads as an audit. It claims that every check
feature 010 introduced was observed failing, and names where each observation lives. If it
drifted from the tree it would keep making that claim after it stopped being true, and a
reader would have no way to tell — which is strictly worse than having no register, because
a reader would reasonably trust it.

So the mapping is asserted **in both directions**, and both directions are observed failing
below. One direction alone would not do: a register that listed only cases it had rows for
would satisfy a one-way check perfectly while omitting every check it had forgotten.

---

## Case 1 — a case with no row (the FR-059 direction)

Input: [`case-1-a-case-with-no-row.patch`](./case-1-a-case-with-no-row.patch) ·
Output: [`case-1-a-case-with-no-row.observed.txt`](./case-1-a-case-with-no-row.observed.txt)

T097's two rows were changed to read `(pending)`, so `spike-heuristic/` existed on disk with
no row naming it — a check whose failing observation exists but which the close-out does not
account for.

```
(fail) the register maps to the tree, in both directions > every directory on disk appears in the register
- []
+ [
+   "observed-failing-register",
+   "spike-heuristic",
+ ]
```

**This is the direction that discharges FR-059.** A check that has been observed failing but
is missing from the register is indistinguishable, to a reader, from a check that was never
observed failing at all.

Note the second entry. The run also flagged `observed-failing-register/` — *this very
directory*, freshly created and not yet listed. The check caught its own new evidence before
its author did, which is a better demonstration than the deliberate mutation was.

---

## Case 2 — a row with no case (the rot direction)

Input: [`case-2-a-row-with-no-case.patch`](./case-2-a-row-with-no-case.patch) ·
Output: [`case-2-a-row-with-no-case.observed.txt`](./case-2-a-row-with-no-case.observed.txt)

T083's row was changed to name `determinism-and-ordering/`, a directory that does not exist —
the shape a rename or deletion would leave behind.

```
(fail) the register maps to the tree, in both directions > every directory the register names exists on disk
```

Both mapping tests fail here, because a renamed row also orphans the real directory. That
they fail together is the correct behaviour and not a redundancy: the two failures name
different problems, and a reader needs both to know which happened.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — 221 pass, 0 fail.

## What else the checker asserts

Beyond the mapping, each case directory is checked for being a *real* one — a directory
that existed but held no failing output would satisfy the mapping while evidencing nothing:

| Assertion | Why |
|---|---|
| a `README.md` exists | the convention's self-describing requirement |
| the failing input is retained | in one of the three sanctioned shapes (patch, isolated artifact, code constant) |
| the output was captured | as a file, or verbatim in the README for isolated-artifact cases |
| the restored pass is shown | except for isolated-artifact cases, where nothing was mutated in place |
| the captured output really records a failure | a `(fail)`, `FAIL`, `error:`, or non-zero exit |
| the restored capture really records a pass | no `(fail)`, no non-zero fail count |
| the code-constant symbol really exists in source | so "retained in code" cannot mean retaining nothing |

It also asserts the two ADR-0012 gate outcomes are recorded in the required form — gate 3
**as observed** and never claimed in advance, gate 4 **unmet and not yet testable** and
never recorded as passed or failed — and that the register's gaps section names the checks
it could not close.

## Standing constraints

ADR-0014 **rung 1 only**. A register that maps correctly is unit-level evidence about the
evidence; it is not reference verification and it is not external validation.
