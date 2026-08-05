# Negative case: determinism

**Tasks**: T083, T084 · **Discharges**: FR-042 · **Supports**: SC-001
**Observed against**: `19f316413d5550b30296e7987c74d267c96655f9` plus Phase E's own
uncommitted work; the named mutation was the only additional change in the tree, and it
was reverted afterwards.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command**: `bun test test/sc-001-determinism.test.ts test/byte-identical.test.ts`, run
from `packages/adapters/catalog-backstage/`
**Permanent automated cases**: `test/sc-001-determinism.test.ts`,
`test/byte-identical.test.ts`

## What is being protected

FR-042: "Identical inputs MUST produce **byte-identical** output across repeated runs,
including array ordering and serialization details."

SC-001 adds the half that is easiest to leave out: determinism holds "on the accept path
and on the reject path alike". A deterministic **rejection** matters for the same reason
a deterministic envelope does — ADR-0016 records the exact emitted string as evidence,
and a reason string that varies between runs is not evidence of anything.

## Why a non-determinism case is hard to construct honestly, and what was chosen

Most plausible mistakes here are *wrong but still deterministic*: sorting with the wrong
comparator, or preserving declaration order where sorted order was intended, both produce
stable output that is stable in the wrong way. Those are covered by the ordering
assertions in `test/byte-identical.test.ts` and by Phase D's `test/glob-order.test.ts`,
not by this case.

The mutation below is genuine non-determinism — a randomised entity order — because that
is the failure FR-042's word "byte-identical" is actually about, and it is the one a
suite comparing parsed objects rather than bytes would miss.

---

## Case 1 — entity order made non-deterministic

Input: [`case-1-entity-order-made-non-deterministic.patch`](./case-1-entity-order-made-non-deterministic.patch) ·
Output: [`case-1-entity-order-made-non-deterministic.observed.txt`](./case-1-entity-order-made-non-deterministic.observed.txt)

The envelope's `entities` array is shuffled before the digest is computed. Every entity
is still present and every record is still correct — the envelope is *valid*, and only
its bytes vary. Five tests fail:

```
(fail) T084 / SC-001 — the accept path > 5 runs serialize byte-identically
(fail) T084 / SC-001 — the accept path > every array's ordering is identical across runs
(fail) T084 / SC-001 — the accept path > the digest is identical across runs
(fail) T083 / FR-042 — repeated runs are byte-identical > two runs over identical input serialize identically
(fail) T083 / FR-042 — repeated runs are byte-identical > two files written by two runs have identical bytes
```

Two things this shows that a weaker check would not:

- **"5 runs all succeed" keeps passing.** Non-determinism is not a failure; it is a
  difference. A suite asserting only that generation succeeds would be green.
- **The digest failure is downstream of the ordering failure.** `snapshot-envelope.md` §3
  serializes arrays "in their existing declaration order (never re-sorted)", so a varying
  declaration order changes the canonical form and therefore the digest. The digest is a
  useful *symptom* of non-determinism; the ordering assertion is what names the cause.

## The reject path

SC-001's reject half is asserted in `test/sc-001-determinism.test.ts` over five runs
against four separate rejection fixtures and one input violating several rules at once.
The whole `AtomicFailureRecord` is compared — trigger class, reason, detail, stage and
location — because any of them varying is non-determinism, and the multi-violation case
is the one that catches an implementation reporting whichever violation its iteration
order surfaced first.

No separate mutation is recorded for the reject path: the mutation above sits after every
abort point, so it cannot affect a rejecting run. A mutation that *did* would be a
mutation to one of the ordered validators, which are Phase D's and are covered by
`../annotation-decode/` and `../glob-rules/`.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all tests pass, 0 fail, across both
named test files.

## Standing constraints

ADR-0014 **rung 1 only**. Nothing here is external, third-party, or community
validation.
