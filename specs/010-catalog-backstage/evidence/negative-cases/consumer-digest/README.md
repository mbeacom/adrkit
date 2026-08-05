# Negative case: the declared digest trusted instead of recomputed

**Task**: T031 · **Discharges**: FR-041
**Contract**: [`snapshot-envelope.md`](../../../../009-catalog-binding-viability/contracts/snapshot-envelope.md) §3
**Observed against**: the Phase C working tree, `packages/catalog-envelope/src/` otherwise unmodified
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/digest.test.ts`

## What this check does and does not prove

Stated first, because FR-041 requires the scope to travel with every mention of
this check rather than trail it as a footnote:

- **Accidental-corruption and naive-mutation detection only.** It does not
  resist an adversary who mutates content and also recomputes the same digest
  with the same algorithm. A cryptographically-signed tamper-evidence mechanism
  is an explicitly open question this feature does not attempt.
- **Integrity, not correctness** (ADR-0020 clause 5). A semantically wrong
  envelope can carry a perfectly valid self-digest. A `match` says the bytes are
  the bytes that were written. It says nothing about whether the ownership those
  bytes record is right.

Nothing below may be cited as evidence of either of the things named above as
excluded.

## Input

[`declared-digest-trusted.patch`](./declared-digest-trusted.patch) replaces the
recomputation in `checkEnvelopeDigest` with the envelope's own declared value:

```diff
-  const recomputedDigest = recomputeEnvelopeDigest(envelope);
+  const recomputedDigest = envelope.digest;
```

This is the realistic wrong implementation — not an obvious deletion. It reads
correctly, always reports `match`, and comparing a value against itself is the
failure `snapshot-envelope.md` §3 names when it says a consumer must
"independently recompute" rather than trust the declared value.

## Observed

Command: `bun test packages/catalog-envelope/test/{digest,identity,derive}.test.ts` ·
Exit **1** · **38 pass, 6 fail** ·
[`declared-digest-trusted.observed.txt`](./declared-digest-trusted.observed.txt)

Failing:

- `digest verification > the tampered fixture is rejected, and the mismatch is named`
- `digest verification > the declared digest is never trusted unconditionally`
- `digest verification > a single flipped character anywhere in the payload is detected`
- `digest verification > admission refuses the tampered fixture at the digest stage, not earlier`
- `admission runs every check in order before permitting derivation > the refusal stage is named for every fixture that cannot be admitted`
- `admission runs every check in order before permitting derivation > admission without a configured revision or repository still runs digest`

`tampered.json` is the fixture that carries this: it gained a third element in
`entities[0].derivedPaths` **after** the digest was computed, so it passes all
five validation steps — the payload is structurally perfect. Recomputation is
the only thing that can catch it, which is why trusting the declared value makes
it sail through and why the six failures above are the check reporting that it
can see.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — **44 pass, 0 fail**, exit 0.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-digest/declared-digest-trusted.patch
bun test packages/catalog-envelope/test/digest.test.ts   # expect exit 1
git checkout -- packages/catalog-envelope/src/digest/index.ts
bun test packages/catalog-envelope/test/digest.test.ts   # expect exit 0
```

## Standing constraints

Synthetic fixtures only; no external adopter. ADR-0014 **rung 1 only** — not
reference-verified (rung 2), not externally validated (rung 3). Maintainer-owned
observation, which is not external, third-party, or community validation.
