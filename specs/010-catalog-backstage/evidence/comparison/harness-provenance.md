# T087 — harness provenance: authored **after** the freeze and its audit

**R5 mechanism 3, and this file is the only artifact that carries it.**

`../../plan.md` names three enforcement mechanisms for Barrier B, all required,
none sufficient alone. The third is an **ordering** requirement:

> **Ordering of the comparison harness.** The harness that reads both generator
> output *and* the frozen expectations is written **after** the freeze and its
> audit — never before. ADR-0020 clause 5 requires two distinct steps, each
> recording its own hashes and its own PASS/FAIL. A harness authored first
> collapses them into one step, and the second step's PASS then inherits from the
> first instead of standing alone.

`../../tasks.md` states the same rule as an anti-verdict: **Phase F may not be
started early "so it is ready."** Authoring it early is the specific harm
mechanism 3 exists to prevent.

## 1. What was confirmed, and by whom

`scripts/compare-accept-corpus.ts` and `scripts/compare-accept-corpus.test.ts`
**did not exist prior to T024's confirmation, and did not exist prior to Phase E
producing output.**

The T024 confirmation is not this session's word for it. It was recorded by the
independent auditor session — the author of the T019 audit procedure and the
R5 mechanism-2 drift check, and *not* the author of the T014–T018 freeze — in
`../barrier-b-checkpoint.json`, under `confirmations.mechanism3_ordering`:

> **claim**: "No comparison harness exists anywhere in the repository, in any
> branch of this worktree, or in any scratch location."

Its recorded evidence enumerates where it looked: this worktree tracked and
untracked, `origin/main`, every local and remote branch, and scratch locations
(session-state `files/`, `/tmp`, `.test-output`). It further disposes of the two
near-misses a reader would otherwise have to check by hand —
`packages/adapters/spec-kit/test/harness.ts` (feature 003's sandbox scaffold) and
`packages/evaluator/src/compare.ts` (the generic code-unit comparator primitive) —
neither of which runs a generator or reads the oracle.

That checkpoint was committed in `b9be3dc` (2026-08-05).

## 2. What the ordering looks like in git

| Landmark | Commit | When |
| --- | --- | --- |
| Barrier B — freeze, independent audit, T024 checkpoint | `b9be3dc` | 2026-08-05 |
| Phase E — the assembled generator, which first produced output | `f7384ff` | 2026-08-05 |
| Phase F — this harness | the commit that adds this file | after both |

`git log --diff-filter=A -- scripts/compare-accept-corpus.ts` names exactly one
commit, and it is later than both landmarks above. Before that commit the path
did not exist on any branch — which is the claim `mechanism3_ordering` had
already recorded, checked again here at authoring time.

## 3. Why the record is prose rather than a passing test

A test cannot demonstrate that a file was written late. It can only observe the
present, and the present is exactly the state a harness written too early would
also produce. What is checkable — and is checked, by
`scripts/compare-accept-corpus.test.ts` — is that this record exists, that it
cites `barrier-b-checkpoint.json`, and that the checkpoint really does carry the
`mechanism3_ordering` claim quoted above. The ordering itself rests on that
independently-authored record plus git history, and is stated here rather than
implied.

## 4. What the harness may and may not do

The harness **reads** the frozen artifacts and **never writes** to them. Two
independent controls stand behind that, neither of which trusts this sentence:

- `scripts/check-freeze-hashes.ts` re-derives the canonical content hash of every
  frozen artifact on every build and fails on drift. It has been observed
  genuinely failing on a one-byte mutation (`../negative-cases/freeze-drift/`).
- `expectations-unchanged.json` (T091) compares each frozen hash, recomputed now,
  against the value Phase B recorded before any generator existed.

**The expectations are never amended to fit the output.** If the two disagree,
either the output is wrong or the expectation is wrong, and the answer is to
report it. A mismatch is a finding, not an obstacle.

## 5. What a PASS here means

It means the generator's derived ownership over the frozen accept corpus agrees,
exactly and in order, with a **maintainer-authored** expectation set frozen before
any generator output existed.

It does not establish correctness. The expectations are the maintainer's
own; agreement between our implementation and our specification is not
independent evidence that either is right. A populated, digest-verified envelope
establishes **integrity** — the bytes were not corrupted or naively mutated — and
says nothing about whether the derived ownership is semantically right. Integrity
and correctness are different properties, and only the first is what a digest
carries. See `reporting-honesty.md`.

ADR-0014 **rung 1** only. This is maintainer-owned verification, which per
ADR-0014's honesty rules must not be described as external, third-party, or
community adoption; only the corpus *data* is third-party, never the validation.
No release is scheduled, prepared, or implied.
