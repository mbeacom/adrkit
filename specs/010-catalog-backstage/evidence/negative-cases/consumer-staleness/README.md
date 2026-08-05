# Negative case: staleness implemented as an ordering comparison

**Task**: T032 · **Discharges**: FR-047
**Contract**: [`snapshot-envelope.md`](../../../../009-catalog-binding-viability/contracts/snapshot-envelope.md) §4
**Observed against**: the Phase C working tree, `packages/catalog-envelope/src/` otherwise unmodified
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/identity.test.ts`

## Why this particular wrong implementation

`snapshot-envelope.md` §4 requires staleness to be **exact inequality** of
revision. A commit SHA is an opaque identifier; it carries no ordering, and
recovering one would need git-ancestry data that is out of scope. So "stale"
means *not exactly the configured expected-current revision* — never "older
than", "behind", or "superseded by".

The dangerous implementation is not a missing check. It is a **present** check
that compares two hex strings with `<`. That produces an ordering, the ordering
is meaningless, and roughly half of all stale envelopes are accepted while the
other half are rejected — so the check looks like it works.

## Input

[`ordering-comparison-instead-of-inequality.patch`](./ordering-comparison-instead-of-inequality.patch):

```diff
-  if (declaredRevision !== expectedRevision) {
+  if (declaredRevision < expectedRevision) {
```

`stale.json` declares revision `f0e9d8c7…` against an expected-current of
`1e0f3c9a…`. Under exact inequality it is stale. Under lexicographic ordering
`f0e9…` sorts *after* `1e0f…`, so the mutated implementation calls it current
and returns `ok`.

Its digest is recomputed over its own actual (mutated-revision) content, so it
passes the digest check cleanly — the rejection under the correct
implementation is attributable specifically to staleness and never to a
coincidental digest failure (`snapshot-envelope.md` §4; User Story 7 scenario 3).
That isolation is itself asserted, by `the stale fixture passes the digest check
cleanly first`.

## Observed

Command: `bun test packages/catalog-envelope/test/{digest,identity,derive}.test.ts` ·
Exit **1** · **38 pass, 6 fail** ·
[`ordering-comparison-instead-of-inequality.observed.txt`](./ordering-comparison-instead-of-inequality.observed.txt)

Failing:

- `staleness is exact inequality > a different revision for the same repository is stale`
- `staleness is exact inequality > inequality is symmetric — direction is never inferred`
- `staleness is exact inequality > a lexicographically smaller revision is just as stale as a larger one`
- `staleness is exact inequality > the scoping does not weaken the check for the repository it is about`
- `staleness is exact inequality > admission refuses the stale fixture at the staleness stage, not the digest stage`
- `admission runs every check in order before permitting derivation > the refusal stage is named for every fixture that cannot be admitted`

The two that matter most are the symmetry case and the
lexicographically-smaller case. Each compares the *same pair* of revisions in
the opposite direction, and both must produce `stale-revision`. An ordering
implementation can only ever fail one of those two, which is exactly what makes
the pair able to detect it.

## A note on scoping, recorded because it changed the implementation

`snapshot-envelope.md` §4 configures the expected-current revision **for a given
repository ID**. `spec.md` FR-046 fixes the evaluation order as digest → staleness
→ repository identity, so staleness runs *before* an identity mismatch has been
named.

An unscoped staleness check therefore refuses `wrong-repository.json` as **stale**
rather than as **misidentified** — the right verdict category for the wrong
reason, and the §5/§6 conflation the contract warns against, wearing a staleness
label. The implementation takes the expectation's repository id and returns
`not-applicable-different-repository` when the envelope is about another
repository, leaving the verdict to the identity check that follows. Asserted by
`an expectation configured for another repository yields no staleness verdict`.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — **44 pass, 0 fail**, exit 0.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-staleness/ordering-comparison-instead-of-inequality.patch
bun test packages/catalog-envelope/test/identity.test.ts   # expect exit 1
git checkout -- packages/catalog-envelope/src/identity/staleness.ts
bun test packages/catalog-envelope/test/identity.test.ts   # expect exit 0
```

## Standing constraints

Synthetic fixtures only; no external adopter. ADR-0014 **rung 1 only** — not
reference-verified (rung 2), not externally validated (rung 3). Maintainer-owned
observation, which is not external, third-party, or community validation.
