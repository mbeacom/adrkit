# `accept-corpus-freeze/` — the ADR-0020 clause-5 gate artifact

Holds the `AcceptCorpusFreeze` of `../../data-model.md` §17.

| File | Written by | Purpose |
| --- | --- | --- |
| `selection-basis.md` | T014 | How the corpus was chosen, how large, and how the known-failing populations were handled — **recorded before the rule was applied** |
| `overlay.json` | T015 | The maintainer-authored `adrkit.io/owned-paths` overlay |
| `expected-paths.json` | T016 | Expected path matches per canonical id, hand-derived from the frozen contracts |
| `accept-corpus-freeze.json` | T018 | The assembled artifact, frozen in the same cycle |
| `adequacy-audit.json` | **T019** | The independent audit, with its **explicit adequacy finding** |

## The two things a reader should check first

1. **`selection-basis.md` was committed before the corpus was enumerated.**
   ADR-0020 clause 5 requires the selection basis and size to be "fixed and
   recorded in that same cycle, **not chosen afterwards**". Selecting entities and
   then writing down a rationale that fits them is the precise failure mode the
   clause forecloses, and prose alone cannot distinguish the two. The ordering is
   therefore recorded in git history rather than asserted: see `selection-basis.md`
   §7, which names the commit that fixed the rule and the commit that applied it.

2. **The audit reaches adequacy, not merely integrity.** ADR-0020 clause 5 and
   SC-010 are explicit: "an audit that passes on integrity without reaching
   adequacy **does not satisfy this clause**". `adequacy-audit.json` must carry an
   `adequacyFinding` of `"adequate-for-the-claim"` or `"inadequate"`, with a
   reason. A run that confirms the hashes and stops is a **FAIL**, and T021
   retains exactly that run as a permanent negative case.

## What this freeze does and does not buy

Carried from ADR-0020 clause 5 so it is not overstated downstream. It exercises
ownership derivation against real descriptor structure and real field shapes, at
whatever scale the audited corpus fixes. It gates **technical compatibility
only**. It does **not** evidence that the mapping reflects anyone's actual
ownership, that anyone else wants the annotation, or that adoption risk has
fallen.
