# Negative case: repository identity and revision compared by exact string equality

**Task**: T042 · **Discharges**: FR-010 · **Supports**: SC-008
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test test/repository-exact-match.test.ts`, run
from `packages/adapters/catalog-backstage/`
**Permanent automated cases**:
`packages/adapters/catalog-backstage/test/repository-exact-match.test.ts` and
`test/repository-identity.test.ts`

`input-manifest.md` §3 step 4: "Any outcome other than both-match aborts generation
**before any entity's paths are derived** — including a partial match (e.g. revision
matches but repository ID does not)."

**A note on the fixture constraint, because it is the thing most likely to be lost.**
`input-manifest.md` §3.1 requires the *repository-identity* fixture be a standalone
scratch `git init` repository and never a `git worktree add` linked worktree, because a
linked worktree shares its remote configuration with the repository it was created from
and would report `github.com/mbeacom/adrkit` no matter what the test intended. The
checkout this work was done in **is** such a worktree.
`test/repository-identity.test.ts` creates a scratch repository per run and asserts the
premise (`git rev-parse --git-dir` differs from `--git-common-dir`) rather than
assuming it. The two cases below are the pure-comparison half and use fixed strings, so
they carry no git state at all.

---

## Case 1 — a prefix match is accepted where an exact match is required

Input: [`case-1-revision-prefix-match.patch`](./case-1-revision-prefix-match.patch) ·
Output: [`case-1-revision-prefix-match.observed.txt`](./case-1-revision-prefix-match.observed.txt)

`manifest.revision === observed.head` was replaced with
`observed.head.startsWith(manifest.revision)` — the single most plausible way a real
implementation ends up accepting an abbreviated SHA.

```
(fail) T042 — exact string equality on both values (FR-010) > an abbreviated revision is a mismatch, not a prefix match
Expected: false
Received: true
```

## Case 2 — the identity half is not compared at all

Input: [`case-2-identity-not-compared.patch`](./case-2-identity-not-compared.patch) ·
Output: [`case-2-identity-not-compared.observed.txt`](./case-2-identity-not-compared.observed.txt)

`idMatches` was forced to `true`, leaving only the revision compared. Four tests fail,
and the emitted detail shows the partial-match reporting collapsing:

```
(fail) T042 — exact string equality on both values (FR-010) > a partial match — revision agrees, identity does not — still aborts
Expected: false
Received: true

(fail) T042 — exact string equality on both values (FR-010) > both disagreeing reports both halves
Received: "revision: manifest \"0000000000000000000000000000000000000000\" !== observed \"3f5a1c9e8b2d4f6a0c7e1b3d5f7a9c1e3b5d7f90\""

(fail) T042 — exact string equality on both values (FR-010) > a repository-id prefix is a mismatch
```

The `Received` line is the one that shows the defect precisely: a run that disagreed on
*both* halves reports only the revision, so a reader would conclude the repository
identity had agreed when it had never been checked.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 11 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**. The check's warrant is bounded by `input-manifest.md` §3: it
confirms the manifest agrees with the checkout's own **locally-configured** git state.
It is not a network-verified provenance check and is not described as one anywhere.
