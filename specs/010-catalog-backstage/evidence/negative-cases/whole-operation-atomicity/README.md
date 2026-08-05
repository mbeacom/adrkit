# Negative case: whole-operation atomicity

**Tasks**: T071, T073, T077 · **Discharges**: FR-023, FR-034 · **Supports**: SC-002
**Observed against**: `19f316413d5550b30296e7987c74d267c96655f9` plus Phase E's own
uncommitted work; in each case the named mutation was the only additional change in the
tree, and it was reverted before the next case was run.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test <named test files>`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated cases**: `test/sc-002-mixed-batch.test.ts`, `test/abort.test.ts`,
`test/uniqueness.test.ts`

## What is being protected

`atomic-fail-closed.md` §1: any invalid input "MUST abort the **entire** run with
non-zero status and produce **no usable partial snapshot**, including for entities that
would otherwise have validated cleanly in the same run."

§1 then names the mistake the rule exists to foreclose: *"skip the bad entity and keep
going"* — "explicitly wrong under this contract, regardless of how reasonable it might
seem as a convenience."

§2 adds that this is a **separate property** from the per-rule validation Phase D
covers: "Passing the per-rule tests does not demonstrate this contract. The two
properties MUST be tested independently."

The three cases below are the three distinct ways the property can be lost, and they
fail differently. That is the point of recording all three rather than one.

---

## Case 1 — "skip the bad entity and keep going"

Input: [`case-1-skip-the-bad-entity-and-keep-going.patch`](./case-1-skip-the-bad-entity-and-keep-going.patch) ·
Output: [`case-1-skip-the-bad-entity-and-keep-going.observed.txt`](./case-1-skip-the-bad-entity-and-keep-going.observed.txt)

`collectAdmitted`'s all-or-nothing branch is replaced with `continue`, which is exactly
the convenience §1 forbids. The batch of five valid entities plus one inadmissible
descriptor then produces an envelope covering the five:

```
(fail) T077 / SC-002 — §5's variant — the sixth entity is inadmissible instead > the same five plus the offender abort with inadmissible-descriptor
(fail) T077 / SC-002 — §5's variant — the sixth entity is inadmissible instead > no envelope exists — not even one covering the five that would have validated
(fail) T077 / §1 — "skip the bad entity and keep going" is not what happens > the consequence does not vary by which trigger fired
(fail) T077 / §1 — "skip the bad entity and keep going" is not what happens > an offender placed first aborts exactly as one placed last does
```

Note which cases *keep passing*: the duplicate-id, pattern, YAML-key and annotation
cases are unaffected, because skipping happens at admissibility. A suite that had tested
only one trigger's mixed batch would have missed this entirely — which is why
`test/sc-002-mixed-batch.test.ts` runs the same experiment across five different
triggers.

## Case 2 — an envelope written on the failure branch

Input: [`case-2-envelope-written-on-the-failure-branch.patch`](./case-2-envelope-written-on-the-failure-branch.patch) ·
Output: [`case-2-envelope-written-on-the-failure-branch.observed.txt`](./case-2-envelope-written-on-the-failure-branch.observed.txt)

The other half of "no usable partial output": the run correctly aborts, and then writes
something anyway. `generateAndWriteEnvelope` is changed to write a partial artifact
before returning the failure. Seven tests fail — every "no envelope exists" case across
all five triggers, plus both of T073's directory checks:

```
(fail) T077 / SC-002 — [all five triggers] > no envelope exists — not even one covering the five that would have validated
(fail) T073 / §3 — no output exists for the five entities that would have validated > the destination path is never created
(fail) T073 / §3 — no output exists for the five entities that would have validated > no side file is left in the destination directory either
```

This is the case that justifies checking the **filesystem** rather than the writer's
return value: the mutated writer still reports `ok: false`, and only the directory
contradicts it.

## Case 3 — uniqueness resolved by last-wins

Input: [`case-3-uniqueness-resolved-by-last-wins.patch`](./case-3-uniqueness-resolved-by-last-wins.patch) ·
Output: [`case-3-uniqueness-resolved-by-last-wins.observed.txt`](./case-3-uniqueness-resolved-by-last-wins.observed.txt)

`entity-identity.md` §3: collisions may not "be resolved by first-wins or last-wins".
Disabling the collision branch makes the `Map` retain the last occurrence silently — a
last-wins resolution that produces a plausible-looking envelope. Thirteen tests fail,
spanning both the uniqueness kernel and the mixed-batch property:

```
(fail) T077 / SC-002 — §3's own worked example — a sixth entity with a duplicate canonical id > the same five plus the offender abort with duplicate-canonical-id
(fail) T077 / §1 — "skip the bad entity and keep going" is not what happens > the abort is not a filtered result with five entities in it
(fail) T071 — row 1: identical canonical ids are `duplicate-canonical-id` > two descriptors canonicalizing alike collide
(fail) T071 — row 2: an alias colliding with a different entity's id is `duplicate-canonical-ref` > §3's worked example, on a synthetic identity set
```

The accept-corpus freeze's own selection basis makes the same point about its
construction: "EVERY member of any colliding group excluded rather than one member kept
— keeping one would be last-wins resolution, which entity-identity.md §3 forbids, moved
earlier so it is harder to see."

---

## The non-zero exit status

FR-034 requires a non-zero **process** exit status, not a constant. `test/abort.test.ts`
spawns a real subprocess through `exitCodeFor` and asserts on the observed exit code, so
the status is an observation rather than an assertion about a value this package also
defines. The probe script is generated at run time rather than committed, so the test
cannot pass by reading a file someone edited to say the right thing.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all tests pass, 0 fail, across the
three named test files.

## Standing constraints

ADR-0014 **rung 1 only**. Nothing here is external, third-party, or community
validation.
