# Negative case: the two repository outcomes, conflated in each direction

**Task**: T033 · **Discharges**: FR-048
**Contract**: [`snapshot-envelope.md`](../../../../009-catalog-binding-viability/contracts/snapshot-envelope.md) §5, §6
**Observed against**: the Phase C working tree, `packages/catalog-envelope/src/` otherwise unmodified
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/identity.test.ts`

## The distinction being defended

| Situation | Correct behaviour | Contract |
|---|---|---|
| A consumer expected **exactly one** repository and is handed an envelope declaring a different one | **Reject**, naming the mismatch | §5 |
| A tool deliberately holds **several** independently-generated, individually-valid single-repository envelopes and queries them scoped to one | **Accept all of them**; the query returns only the scoped repository's entities | §6 |

Both failure modes are quiet. Collapsing §5 into §6 turns a genuine mismatch
into a silent filter that returns an empty result and reads as "no matches".
Collapsing §6 into nothing lets one repository's entities answer another
repository's query. Neither throws, and neither produces a wrong-looking value —
which is why each needs its own constructed failure rather than one shared one.

`wrong-repository.json` is the same file in both cases. What differs is what the
consumer was configured to expect. Its digest is recomputed over its own actual
content, so it passes the digest check cleanly and each rejection is attributable
specifically to identity (§5) — asserted by `the wrong-repository fixture passes
the digest check cleanly first`.

## Case A — a mismatch accepted (§5 collapsed into §6)

[`mismatch-accepted.patch`](./mismatch-accepted.patch) disables the mismatch
branch in `checkRepositoryIdentity`, so a foreign repository id reports `ok`.

Command: `bun test packages/catalog-envelope/test/{digest,identity,derive}.test.ts` ·
Exit **1** · **40 pass, 4 fail** ·
[`mismatch-accepted.observed.txt`](./mismatch-accepted.observed.txt)

Failing:

- `repository identity mismatch is a rejection > a different repository id is a mismatch`
- `repository identity mismatch is a rejection > admission refuses at the identity stage, after staleness has passed`
- `repository identity mismatch is a rejection > the same refusal holds with no revision expectation at all`
- `admission runs every check in order before permitting derivation > the refusal stage is named for every fixture that cannot be admitted`

Note what did **not** fail: every §6 isolation test still passes. The mutation
is localized to the rejection path, which is the evidence that the two behaviours
are implemented separately rather than as one function wearing two names.

## Case B — isolation leaking (§6 collapsed into nothing)

[`isolation-leaks.patch`](./isolation-leaks.patch) removes the `continue` from
`queryEntitiesForRepository`, so out-of-scope envelopes are counted as
out-of-scope and then contribute their entities anyway.

Command: same · Exit **1** · **41 pass, 3 fail** ·
[`isolation-leaks.observed.txt`](./isolation-leaks.observed.txt)

Failing:

- `repository isolation is acceptance, not rejection > a query scoped to one repository returns only that repository's entities`
- `repository isolation is acceptance, not rejection > no entity from one repository ever leaks into the other repository's result`
- `repository isolation is acceptance, not rejection > a query scoped to a repository nobody loaded returns nothing and says so`

The third of those is the one that would otherwise be easy to leave out. A query
scoped to a repository that was never loaded must return nothing **and say what
it looked at** — `repositoriesConsidered` and `envelopesOutOfScope`. Without
them, an empty result is indistinguishable from a query that never ran, which is
ADR-0016's central failure shape and not something the other two tests can catch.

Note again what did not fail: every §5 rejection test still passes under this
mutation. The two mutations fail disjoint sets of tests, and that disjointness is
the actual evidence that the contract's distinction is implemented.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — **44 pass, 0 fail**, exit 0.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-repository-identity/mismatch-accepted.patch
bun test packages/catalog-envelope/test/identity.test.ts   # expect exit 1
git checkout -- packages/catalog-envelope/src/identity/repository.ts
bun test packages/catalog-envelope/test/identity.test.ts   # expect exit 0
```

## Standing constraints

Synthetic fixtures only; no external adopter. ADR-0014 **rung 1 only** — not
reference-verified (rung 2), not externally validated (rung 3). Maintainer-owned
observation, which is not external, third-party, or community validation.
