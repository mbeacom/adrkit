# Honesty close-out

**Task**: T100 · **Supports**: FR-062, SC-017 · **Barrier side**: BEHIND
**Compiled**: 2026-08-05, Phase G · **Tools**: Bun 1.3.14, TypeScript 6.0.3
**Machine-checked by**: `scripts/check-honesty-close-out.test.ts`

This is the last artifact feature 010 produces. It states what the feature does and does
not claim, and — where a claim is the kind of thing a pattern can catch — it is enforced
rather than asserted.

---

## 1. Why this check matches claims and not vocabulary

ADR-0014's state vocabulary is **binding**. `reference-verified` and `externally validated`
are the exact terms every artifact must use, and vague synonyms are forbidden. It follows
that the most honest sentence this feature can write —

> *not `reference-verified` (rung 2), not `externally validated` (rung 3)*

— necessarily contains both of the strings a naive grep would flag.

**A check that failed on bare occurrence would fail the documentation being most careful
and pass documentation that said nothing at all.** It would reward silence. That is the
opposite of what ADR-0014's honesty rules and ADR-0016 exist to produce, and it would make
this close-out actively harmful: the way to get a green build would be to delete the
denial.

So every rule in `check-honesty-close-out.test.ts` matches an **assertion pattern** — a
claim *of* a status, anchored on "is", "was", "has been" — and treats negations,
prohibitions and "not yet" conditionals as conformant.

### The rules are verified on both sides before they are trusted

ADR-0016 applied to the check itself. Each rule is run against:

- a **claim** fixture — the sentence someone would actually write if they were
  overclaiming, not a strawman built to match the regex. Every rule must fire.
- ten **denial** fixtures — the maximally honest phrasings, each containing the binding
  vocabulary. **No rule may fire on any of them.**

A rule that fires on the claim but also on the denial is not a working rule; a rule that
fires on neither is not a rule. The suite additionally asserts that the denial fixtures
really do contain `reference-verified`, `externally validated`, `third-party`, `gate 3`,
`gate 4`, `Backstage` and `npm` — otherwise they would pass by not mentioning anything, and
the whole exercise would be circular.

Two structural guards close the remaining ways this could be vacuous: every rule must have
a claim fixture (so no rule sits untested), and the artifact scan asserts it read more than
100 files across both packages, the contracts, and the evidence tree (so "found nothing" is
distinguishable from "looked at nothing").

---

## 2. (i) No artifact claims ADR-0014 rung 2 or rung 3

**This feature is `implemented`. It is not `reference-verified` (rung 2) and it is not
`externally validated` (rung 3).**

That sentence uses ADR-0014's binding vocabulary deliberately, and is the exact case §1
exists to protect.

| Rung | State | Basis |
|---|---|---|
| 1 — unit / contract / conformance | **met** | 1873 tests, typecheck, lint, `check:deps`, `check:freeze-hashes`, `check:clause8`, `check:no-spike-heuristics`, `check:clean-clone` |
| 2 — maintainer-owned isolated reference repository | **not claimed** | no separate maintainer-owned repository exercised this surface; nothing here is reproducible-pinned, self-verifying, fail-closed **and** reviewed in one |
| 3 — external / community validation | **absent** | no party other than the maintainer has verified this in their own repository |

ADR-0014 requires rung 3 be "always reported as explicitly **absent** or **present** with
evidence — never assumed, never fabricated." It is reported here as **absent**.

**Maintainer verification is not external.** ADR-0014: *"The maintainer's own isolated
reference repository is not 'external'. It MUST NOT be described as an external team, a
third party, or a community adopter."* Nothing in this feature was performed by anyone
else.

---

## 3. (ii) Nothing schedules, implies, or prepares a release

**No release is scheduled, implied, or prepared.**

ADR-0020 clause 9 defers **both** the release vehicle and the decision to release at all to
a later record. This feature respects both halves, and the second is the one easier to
erode: producing evidence that a gate is met is not the same as deciding to walk through it.

| Structural statement | Where |
|---|---|
| both packages carry version `0.0.0` | `package.json` in each |
| neither is in `RELEASE_PACKAGES` | `scripts/release-pack.ts` |
| neither ships a `dist` or an exports map | both manifests |
| each carries a `"//release"` note saying so in prose | both manifests |

`check:clause8` fails the build if any of that changes — observed failing at
`negative-cases/clause8-gate/` case 2, where giving the adapter version `0.1.0` produced
`declares version 0.1.0; clause 9 defers release, so 0.0.0 is the only honest value`.

The clause-8 gate is deliberately shaped as a **prohibition** rather than a permission. It
never concludes "clause 5 is met, therefore release"; it fails if clause 5's evidence rots
**or** if something claims release. Passing it authorizes nothing.

---

## 4. (iii) ADR-0012 gate 3 — the outcome, recorded as observed

Gate 3 requires *"a maintainer-authored reference oracle — synthetic explicit annotations
over pinned public corpora under independent adversarial review — validating real entity
and path outcomes."*

**What ran, and what it returned** (`evidence/comparison/step-b-record.json`,
`evidence/frozen-expectations/audit-record.json`,
`evidence/accept-corpus-freeze/adequacy-audit.json`):

| Element | Observed |
|---|---|
| the re-frozen oracle's independent audit | verdict `PASS`, with an explicit adequacy finding |
| the post-output comparison over the frozen accept corpus | verdict `PASS` |
| expected entities / envelope entities | 24 / 25 |
| false positives / false negatives | **0 / 0** |
| the two steps | distinct; step (b) records `inheritsFromStepA: false` |

**This is an outcome recorded after the fact, not a verdict — it is recorded as observed,
never claimed in advance.** `plan.md` fixes the distinction: a pass here is *"a **possible
outcome** for ADR-0012 gate 3, never a claim made in advance."* Accordingly this close-out
does **not** declare gate 3 closed — **gate 3 is ADR-0012's to close**, on a record of its
own, and ADR-0020 clause 6 says in terms that it "remains open and is not waived".

The 25-versus-24 figure is not a discrepancy: 24 *selected descriptor files* carry 24
annotated entities, and one of those files holds a second, unselected document. Descriptor
**file** counts and entity **document** counts are different numbers throughout this
feature.

---

## 5. (iv) ADR-0012 gate 4 — unmet, and not yet testable

Gate 4 is *"clean-clone / offline / adapter-boundary / **release** evidence passing."*

| Component | Status |
|---|---|
| clean-clone | produced — `check:clean-clone`, the `clean-clone-builds` job |
| offline | produced — a proved denial, not an absence of observed calls |
| adapter-boundary | produced — `check:deps`, `envelope-shape-locality`, the T096 round trip |
| **release** | **not produced, and not producible here** |

The release component carries a `[NEEDS CLARIFICATION]` marker carried forward unresolved
from `research.md` R9:427 and `spec.md`:1290, through `plan.md`, to T099. What "release
evidence" requires is undefined while ADR-0020 clause 9 defers both the release vehicle and
the decision to release at all.

**It is not resolved by guess.** The consequence, as `plan.md` fixes it and this close-out
records it: **gate 4 remains unmet and not yet testable regardless of this feature's
outcome, and is recorded as unmet — never as passed, and never as failed.**

"Failed" would be the subtler dishonesty of the two. It would imply the gate had been
tested and had not held. It has not been tested, because it cannot yet be.

---

## 6. (v) No claim about Backstage as a running system

Every admissibility claim this feature makes is scoped to **what a pure validator predicate
returns when invoked** at the pinned Backstage commit
`1121a4facd9e321179d0402c3f355e4a649e84d9`.

Nothing here started Backstage, ingested a descriptor into a catalog, or observed a
rendered entity. The feature therefore does not say what Backstage *would do* with any
descriptor — only what four pinned predicates return for it.

The distinction is load-bearing rather than pedantic: a descriptor that satisfies all four
predicates may still be rejected by a running Backstage for reasons no predicate models —
processor configuration, permissions, entity relations, catalog policy. Claiming
compatibility from predicate agreement would be claiming something nobody measured.

`contracts/README.md` §4 states the same constraint for every contract file, and
`package-boundary.md` §9 notes that it "makes no Backstage claim at all."

---

## 7. (vi) Only corpus **data** is third-party

| Element | Provenance |
|---|---|
| the 24 vendored descriptors | **third-party** — `github.com/backstage/community-plugins` at `92e9e4e09c76cc57f3475029b73e5ec84498a459`, verbatim, verified by digest |
| the `adrkit.io/owned-paths` overlay | maintainer-authored |
| the frozen expected paths | maintainer-authored |
| the pre-output audit and adequacy finding | maintainer-authored |
| the post-output comparison | maintainer-authored |
| every check enumerated in the register | maintainer-authored |

**Only the corpus **data** is third-party; the validation never is.** ADR-0020 clause 5
draws exactly this boundary, and `data-model.md` §10 makes it legible from the artifact
itself: `provenance` describes the **annotation**, not the descriptor, and every entity in
the accept corpus carries `maintainer-overlay` because **zero** upstream descriptors carry
the annotation.

That zero is also why the field is not dead metadata: `upstream-authored` becomes reachable
only if real adoption occurs. It is a live adoption signal, currently reading none.

---

## 8. What this feature is, stated once, plainly

Feature 010 built an offline Backstage catalog descriptor → ownership generator and an
independent envelope consumer, and produced rung-1 evidence for both. It closed ADR-0020
clause 5's two steps with a `PASS` at zero false positives and zero false negatives over a
frozen, independently audited accept corpus of real upstream descriptors. It installed the
clause-8 executable gate that clause 8 required and that ADR-0020's own inert frontmatter
assertion could not provide.

It did not release anything, did not verify anything in a separate reference repository,
and was not validated by anyone other than the maintainer. It made no claim about Backstage
as a running system.

Those two paragraphs are the whole of it, and neither is larger than the evidence behind it.
