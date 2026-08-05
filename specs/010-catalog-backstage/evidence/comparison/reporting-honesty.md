# T092 — reporting honesty: what step (b) claims, and what it does not

**FR-058, FR-063, SC-012.** ADR-0020 clause 5 is blunt about the distinction this
file exists to protect:

> A populated, digest-verified envelope proves integrity, not correctness — a
> semantically wrong envelope can carry a perfectly valid self-digest.

That single sentence is the reason step (b) exists at all. If a valid digest were
evidence that the derivation were right, freezing the expectations would have been
enough and no comparison would be needed.

## 1. Three claims, and only the third is about the derivation

| Claim | What carries it | What it is worth |
| --- | --- | --- |
| The envelope's bytes are intact | `digest` (`step-b-record.json` → `ownHashes.envelopeDigest`) | **Integrity.** It detects accidental corruption and naive mutation. It does not detect an adversary who recomputes it, and it says nothing about the contents' meaning. |
| The frozen expectations did not move | `expectations-unchanged.json`, `scripts/check-freeze-hashes.ts` | **Immutability.** It shows the target was not moved to meet the arrow. It does not show the target was in the right place. |
| Derived ownership matches the frozen expectations | `diff-report.json` | **Agreement with a maintainer-authored expectation set**, at zero false positives and zero false negatives, over one frozen corpus. |

Only the third speaks to the derivation, and even it is narrower than
"the adapter is correct" — see §2.

## 2. Why agreement is not correctness

The expectations were written by hand, by the maintainer, by applying frozen
contracts to a maintainer-authored overlay
(`../accept-corpus-freeze/expected-paths.json` → `derivation.howProduced`). The
generator was written by the maintainer too.

So a PASS says: **our implementation agrees with our specification of it.** That
is worth having — it is exactly what spike 009's oracle never demonstrated, on its
own evidence index's admission that it was "not an executed test harness" — but it
is not independent evidence that either the implementation or the specification is
right. Both could be wrong in the same direction, and this comparison would still
pass.

What would speak to that is review by someone who authored neither, or use by
someone who is not us. Neither has happened. ADR-0014 **rung 1**.

## 3. What is deliberately not claimed

- **Nothing about Backstage as a running system.** The only warrant available is
  what four pure validator predicates return when invoked at Backstage commit
  `1121a4facd9e321179d0402c3f355e4a649e84d9`. No statement here describes the
  behaviour of a Backstage catalog, ingester, or processor.
- **Nothing about adoption.** Zero descriptors in the pinned corpus carry
  `adrkit.io/owned-paths`; every annotation in the corpus is the maintainer's own
  overlay, and every entity in the envelope carries
  `provenance: "maintainer-overlay"` accordingly. Per `../../data-model.md` §10, an
  entity asserts third-party adoption only when its ownership state is
  `explicit-paths` or `explicit-empty` **and** its provenance is
  `upstream-authored`. No entity in this corpus does. Adoption by anyone other than
  the maintainer is neither established nor gated by this feature (FR-063).
- **Nothing about scale.** The corpus size is 24 because that is what was frozen.
  Per ADR-0012 and FR-055 no minimum entity count is invented, and nothing here
  ratifies a production limit.
- **Nothing about rung 2 or rung 3.** This is maintainer-owned verification. Per
  ADR-0014's honesty rules it must not be described as external, third-party, or
  community adoption; only the corpus **data** is third-party, never the
  validation.
- **No release.** ADR-0020 clause 9 defers both the release vehicle and the
  decision to release at all to a later record. Nothing in Phase F schedules,
  prepares, or implies one.

## 4. Where the third-party boundary is legible

Two structural choices keep it visible rather than asserted:

1. **The vendored corpus carries no annotation.** `../../corpus/` holds the 24
   descriptors as pristine upstream bytes, each verified against the content
   address the pinned commit fixes. The maintainer-authored overlay lives in
   `../accept-corpus-freeze/overlay.json` and is applied at generation time into a
   temporary directory that is deleted. A reader can therefore tell by inspection
   which bytes are upstream and which are ours — which is precisely what
   `../../data-model.md` §10's `provenance` field exists to make possible, and what
   pre-merging the two would have destroyed.
2. **`provenance` is declared, not inferred.** A file that carries the annotation
   because an upstream author wrote it and one that carries it because we overlaid
   it are byte-identical on disk. The declaration is required, exhaustive, and has
   no default, so an omission cannot silently become a third-party adoption claim.

## 5. How this is enforced rather than promised

`scripts/compare-accept-corpus.test.ts` scans every artifact this phase writes —
both scripts, both prose files, all three JSON records, the negative case, and the
vendored corpus's own README and manifest — for affirmative overclaims about
correctness and about ADR-0014 rungs, and drives that scan against a fixture that
must trip it so that a clean result means it looked. It separately requires the
diff report to carry both an `establishes` statement and a `doesNotEstablish`
list, and requires this file and `harness-provenance.md` to carry the
integrity/correctness distinction and the rung 1 disclosure.

A promise in prose is not a control. The scan is.
