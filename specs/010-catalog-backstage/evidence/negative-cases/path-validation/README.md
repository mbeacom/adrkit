# Negative case: two-stage source-path validation

**Task**: T044 · **Discharges**: FR-012 · **Supports**: SC-008
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases below**: `bun test test/manifest-paths.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/manifest-paths.test.ts`

`input-manifest.md` §4.1 requires two stages, and **each was observed failing
independently** — which is the point of having two records here rather than one. The
stages are not redundant:

- Stage 1 is purely lexical and runs before the filesystem is touched. It **cannot** see
  symlinks.
- Stage 2 resolves symlinks and requires the resolved real path to lie beneath the
  verified checkout root. It **cannot** be replaced by a stricter stage 1, because
  §4.1 says in terms that "a lexically-clean relative path can still symlink outside
  the root."

Case 1 and case 2 fail on disjoint test sets, which is the evidence that neither stage
is covering for the other.

---

## Case 1 — stage 1: the traversal-segment rule

Input: [`case-1-stage-1-lexical-traversal-unchecked.patch`](./case-1-stage-1-lexical-traversal-unchecked.patch) ·
Output: [`case-1-stage-1-lexical-traversal-unchecked.observed.txt`](./case-1-stage-1-lexical-traversal-unchecked.observed.txt)

```
(fail) T044 stage 1 — lexical rejection, before the filesystem is touched > "../../secret.yaml" is rejected as path-traversal-segment
(fail) T044 stage 1 — lexical rejection, before the filesystem is touched > "packages/./catalog-info.yaml" is rejected as path-traversal-segment
(fail) T044 stage 1 — lexical rejection, before the filesystem is touched > "packages/../../etc/passwd" is rejected as path-traversal-segment
Expected: false
Received: true
```

Five tests fail, including `stage 1 rejects without any filesystem access` — the one
run against a checkout root that **does not exist**, so a stage-1 failure could only be
a rejection rather than a thrown `ENOENT` if stage 1 really did run first.

## Case 2 — stage 2: confined realpath

Input: [`case-2-stage-2-confinement-unchecked.patch`](./case-2-stage-2-confinement-unchecked.patch) ·
Output: [`case-2-stage-2-confinement-unchecked.observed.txt`](./case-2-stage-2-confinement-unchecked.observed.txt)

```
(fail) T044 stage 2 — confined realpath > a lexically-clean path escaping through a symlink fails closed
(fail) T044 stage 2 — confined realpath > the same escape is rejected through the combined two-stage entry point
(fail) T044 stage 2 — confined realpath > the two stages emit different reasons for their own failures
Expected: false
Received: true
```

The fixture is a directory symlink out of a scratch checkout: `escape/secret.yaml` has
no `..`, no leading slash, and no backslash, so it **passes stage 1** — asserted
explicitly in the same test — and is caught only by resolution. That is the case §4.1
says a pure string check cannot reach.

---

## Trigger-class attribution, recorded as an inference rather than a quotation

§4.1 names stage 2's failure explicitly (`incomplete-required-source`, "and the file is
never opened"). It does **not** name a trigger class for stage 1, saying only "reject
the manifest, non-zero". Stage 1 is attributed to `invalid-manifest-shape` here because
it is a defect in the manifest's own content rather than in the checkout's. That
attribution is an inference from the contract's silence and is reported as a contract
gap rather than presented as settled.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 22 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**.
