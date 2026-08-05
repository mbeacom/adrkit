# Negative case: a correctness claim, and a rung claim

**Task**: T035 · **Discharges**: FR-058 (consumer framing half), SC-012 (framing half)
**Observed against**: the Phase C working tree; each mutated file reverted after its run
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/no-correctness-claim.test.ts`

## What is being defended

ADR-0020 clause 5: a populated, digest-verified envelope proves **integrity, not
correctness** — a semantically wrong envelope can carry a perfectly valid
self-digest. SC-012 requires that no artifact, report, or document produced under
this feature present such an envelope as evidence of semantic correctness.

Prose alone does not hold this. The framing is easy to state once in a README and
then quietly undo in an identifier, an error string, or a sentence written six
months later by someone summarising the package. So the guard scans three
surfaces: the exported names, the strings the package actually emits across the
whole fixture corpus, and its documentation including every source file's own
doc comments.

The forbidden list is deliberately narrow. It targets phrases asserting semantic
rightness about ownership or the catalog — not the word "valid", which is the
contract's own vocabulary (`snapshot-envelope.md` §2's "valid JSON", §6's
"individually valid"). A check banning "valid" outright would be unsatisfiable
against the contract it enforces.

## Case A — the README presents a digest match as correctness

[`case-a-readme-claims-correctness.patch`](./case-a-readme-claims-correctness.patch)
adds to the README:

> A digest match means the recorded ownership is correct ownership, and the check
> is tamper-proof.

Two forbidden claims in one sentence — `correct ownership` and `tamper-proof`.
The second is the one FR-041 names specifically: the digest does not resist an
adversary who mutates content and recomputes it.

[`case-a-readme-claims-correctness.observed.txt`](./case-a-readme-claims-correctness.observed.txt) —
exit **1**, **6 pass, 1 fail**:

```text
(fail) the documentation makes no correctness claim > no document carries a forbidden claim
```

## Case B — a rung claim

[`case-b-rung-claim.patch`](./case-b-rung-claim.patch) adds:

> This package is reference-verified and battle-tested.

ADR-0014 rung 1 only, per ADR-0020's closing paragraph and `spec.md` FR-062. The
guard permits these terms **when denied** — "is **not** reference-verified" is
the required framing and appears throughout this package — and rejects them when
asserted, by inspecting the forty characters preceding each occurrence for a
negation.

[`case-b-rung-claim.observed.txt`](./case-b-rung-claim.observed.txt) — exit **1**,
**6 pass, 1 fail**:

```text
(fail) the documentation makes no correctness claim > no document claims rung 2 or rung 3 standing
```

That case A and case B fail *different* assertions is the point: the correctness
guard and the rung guard are separate rules, and a single mutation failing both
would not have shown that.

## Case C — an emitted string overclaims

[`case-c-emitted-string-claims-correctness.patch`](./case-c-emitted-string-claims-correctness.patch)
prefixes `DIGEST_GUARANTEE_SCOPE` — the string carried on **every**
`DigestCheckResult`, so that a caller serializing a result into evidence cannot
drop the scope — with "This check is tamper-proof."

[`case-c-emitted-string-claims-correctness.observed.txt`](./case-c-emitted-string-claims-correctness.observed.txt) —
exit **1**, **5 pass, 2 fail**:

```text
(fail) the strings this package emits make no correctness claim > no emitted string carries a forbidden claim
(fail) the documentation makes no correctness claim > no document carries a forbidden claim
```

Both fire because the constant is both an emitted string and source text. This is
the case that matters most operationally: a claim in a README misleads a reader,
but a claim in an emitted string propagates into whatever evidence bundle quotes
the result.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — **7 pass, 0 fail**, exit 0.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-correctness-claim/case-c-emitted-string-claims-correctness.patch
bun test packages/catalog-envelope/test/no-correctness-claim.test.ts   # expect exit 1
git checkout -- packages/catalog-envelope/src/digest/index.ts
bun test packages/catalog-envelope/test/no-correctness-claim.test.ts   # expect exit 0
```

## Standing constraints

ADR-0014 **rung 1 only** — not reference-verified (rung 2), not externally
validated (rung 3). Maintainer-owned observation, which is not external,
third-party, or community validation.
