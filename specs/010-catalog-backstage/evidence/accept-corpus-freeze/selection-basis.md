# Accept-corpus selection basis and size (T014)

**Task**: T014 · **Barrier side**: `IS THE BARRIER` · **Discharges**: FR-055
**Normative sources**: ADR-0020 clause 5; ADR-0012 gate 3; `../../spec.md` FR-054,
FR-055; `../../research.md` R14; `../../data-model.md` §17;
`../../contracts/admissibility.md`;
`specs/009-catalog-binding-viability/contracts/entity-identity.md`;
`specs/009-catalog-binding-viability/contracts/glob-dialect.md`;
`specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md`.

> **Read §7 first if you are auditing this.** ADR-0020 clause 5 requires the
> selection basis and size to be "fixed and recorded in that same cycle, **not
> chosen afterwards**". Prose cannot distinguish a rule written first from a
> rationale written to fit entities already seen. §7 records that distinction in
> git history instead, where it can be checked.

---

## 1. The corpus this freeze draws from

| Field | Value |
| --- | --- |
| `corpusRef.repository` | `github.com/backstage/community-plugins` |
| `corpusRef.commit` | `92e9e4e09c76cc57f3475029b73e5ec84498a459` |

**Why this repository and this pin.** `../../research.md` R14 records the full
population facts for exactly two pinned corpora, and this is one of them. Its
counts, its invalid-`metadata.name` population, and its unsubstituted-skeleton
population are all already frozen in a document this feature may not edit, so the
selection rule below can be stated against facts that were fixed before this task
existed rather than against facts discovered while choosing.

The descriptors are **real, authored upstream, and left otherwise unmodified**
(ADR-0020 clause 5). Only the corpus *data* is third-party. The overlay, the
expected paths, this selection basis, and the audit are the maintainer's own, and
none of them may be described as external, third-party, or community validation
(ADR-0014 honesty rules; ADR-0014 rung 1 only).

## 2. The admissibility-and-uniqueness predicate `P`

`P` is evaluated over **every entity document of the pinned corpus**, not over a
pre-filtered subset. A document satisfies `P` when all five hold:

1. **Basename.** Its file's basename is exactly `catalog-info.yaml`. R14 attaches
   this qualification explicitly: a looser path-suffix match over-counts.
2. **Parse.** The file parses as YAML with `uniqueKeys: true` and the document
   reports zero parse errors. This is the guard against `duplicate-yaml-key`
   (`entity-identity.md` §3), which is a fatal whole-operation trigger.
3. **Shape.** The document is a mapping carrying `apiVersion`, `kind`, and
   `metadata.name` — i.e. it is an entity document rather than an empty or
   non-entity document.
4. **Admissible under ADR-0015.** All four field validator predicates in
   `../../spec.md` FR-016's reproduced table return true, at Backstage commit
   `1121a4facd9e321179d0402c3f355e4a649e84d9`:
   `isValidApiVersion`, `isValidKind`, `isValidEntityName`, and — only when
   `metadata.namespace` is present — `isValidNamespace`.
5. **Canonically unique corpus-wide.** Its canonical id
   (`entity-identity.md` §1: default the namespace, then lowercase the **entire**
   `kind:namespace/name` string) is unique across **all** admissible documents of
   the pinned corpus.

### 2.1 Why criterion 5 excludes *both* members of a collision

`entity-identity.md` §3 forbids resolving a canonical-id collision by first-wins
or last-wins. Keeping one member of a colliding pair and discarding the other
would be last-wins applied at selection time instead of at derivation time — the
same prohibited resolution, moved earlier so it is harder to see. Every member of
any colliding group is therefore excluded.

## 3. The selection rule `S`, and the size

Let the **workspace** of a document be the path segment immediately below
`workspaces/`.

1. Order workspace names ascending by `compareCodeUnits`
   (`packages/core/src/ordering/index.ts`; never `localeCompare`).
2. A workspace is **eligible** if at least one of its documents satisfies `P`.
3. From each eligible workspace take the single document satisfying `P` that is
   least under `compareCodeUnits` on `sourcePath`, with `documentIndexInFile`
   ascending as the tiebreak.
4. The accept corpus is the documents so taken from the **first 24 eligible
   workspaces**.

**`size` = 24**, one entity per workspace, from 24 distinct upstream workspaces.

### 3.1 The size is a maintainer judgement, and is deliberately not a minimum

ADR-0012 holds that production limits are "**not** guessed now; they must be
ratified from evidence," and ADR-0020 clause 5 declines to fix a minimum entity
count for exactly that reason. `../../spec.md` FR-055 carries the prohibition
forward: **no minimum entity count may be invented by the specification or by the
implementation.**

24 is therefore **not** a minimum, **not** a threshold, and **not** a production
limit. It is the size of this one frozen corpus. Nothing here may be read as
ratifying a scale bound (`../../plan.md`, note on FR-055).

The two considerations that fixed it, stated so they can be disagreed with:

- **Upper bound — reviewability.** Every expected-path array in
  `expected-paths.json` is authored by hand (T016). A corpus large enough that
  the expectations must be produced by running something would defeat the
  purpose: the artifact would then be code-derived, and a later "fix" to that
  code would silently move the expectations. Hand authorship is only credible at
  a size a reviewer can actually check line by line.
- **Lower bound — coverage with repetition.** The corpus must carry every
  ownership state and every glob feature the overlay exercises (§4), each with at
  least two independent instances, so no behaviour rests on a single example.

**Whether 24 is adequate is not this document's finding to make.** ADR-0020
clause 5 places that determination with the independent auditor, as an explicit
adequacy finding, and T019 is where it is recorded. This document states the
judgement and its reasons so that the auditor has something specific to accept or
reject.

## 4. The overlay rule, fixed here in the same cycle

`overlay.json` (T015) is **maintainer-authored** and is assigned by position, not
chosen per entity. Positions are 0-based over the accept corpus in the frozen
order of §3.

| Positions | Ownership state | Overlay |
| --- | --- | --- |
| 0–21 | `explicit-paths` | annotation value = catalogue entry `C[i mod 11]` (§4.1), in the catalogue's authored input order |
| 22 | `explicit-empty` | annotation present, value exactly `"[]"` |
| 23 | `annotation-absent` | **no overlay entry at all** |

Positional assignment is what keeps the overlay from being cherry-picked: no
entity was chosen for the annotation it would receive, because the annotation is
a function of the entity's index in an order fixed before the entities were
enumerated.

Because `i mod 11` runs twice over positions 0–21, **each catalogue entry is
carried by exactly two distinct canonical ids.** That is deliberate: it gives
eleven independent instances of `entity-identity.md` §4's "no exclusive winner"
rule — two distinct entities whose owned paths overlap must both derive
successfully, and must not be treated as a collision.

All three states of `owned-paths-annotation.md` §3 are present, which is what the
non-conflation rule needs: `explicit-empty` and `annotation-absent` both yield an
empty `derivedPaths`, and the corpus must be able to tell them apart. Clause 5's
"at least one non-empty annotation" floor is met 22 times over, and its warning
that an all-`annotation-absent` corpus satisfies nothing does not apply here.

### 4.1 The pattern catalogue — hand-authored, from the frozen glob dialect

Every pattern below is valid under `glob-dialect.md` §3's fifteen ordered rules:
POSIX segments over `A-Z a-z 0-9 _ - .` plus `*`, whole-segment `**`, and `?`; no
leading `/`, no `\`, no brace, bracket, parenthesis or comma, no leading `!`, no
`.` or `..` segment, no empty segment, and no `**` sharing a segment with other
characters.

Input order is the authored order and is **deliberately not sorted**, because the
defect this whole cycle exists to correct is a `derivedPathPatterns` recorded in
input order rather than `compareCodeUnits` order.

| # | Authored input order | What it exercises |
| --- | --- | --- |
| `C0` | `workspaces/alpha/src/**`, `workspaces/alpha-tools/**`, `workspaces/alpha.config/**` | `-` (0x2D) < `.` (0x2E) < `/` (0x2F) — the separator-ordering trap; input order fully reversed from sorted order |
| `C1` | `packages/core/**`, `packages/core/**`, `packages/cli/**` | duplicate element requiring dedupe |
| `C2` | `**`, `.github/**` | dotfile policy (`glob-dialect.md` §4): a bare `**` does not imply dotfile ownership, an explicit dot segment does |
| `C3` | `docs/**` | single-pattern annotation |
| `C4` | `src/utils/**`, `src/Utils/**`, `src/README.md` | case sensitivity: `R` (0x52) < `U` (0x55) < `u` (0x75) |
| `C5` | `scripts/build-?.ts`, `scripts/*.test.ts`, `scripts/build.ts` | `?` and in-segment `*`; `*` (0x2A) sorts before letters |
| `C6` | `packages/core/src/**`, `packages/core/**` | prefix nesting; partial overlap with `C1` |
| `C7` | `plugins/v2/**`, `plugins/v10/**`, `plugins/v_next/**` | digits sort lexicographically, so `v10` precedes `v2`; `_` (0x5F) after digits |
| `C8` | `.github/workflows/**`, `Makefile`, `.github/**` | uppercase `M` (0x4D) after `.` (0x2E); partial overlap with `C2` |
| `C9` | `docs/**`, `examples/**`, `docs/**` | dedupe combined with already-sorted remainder; full overlap with `C3` on `docs/**` |
| `C10` | `a/b/**`, `a-b/**`, `a/**`, `a.b/**` | all three separator characters plus `*`-before-letter, in one entry |

## 5. How R14's known-failing populations were handled

`../../research.md` R14 records these as **selection constraints, not incidental
facts**: "a corpus selected without regard to them would fail its own gate on
inputs that were known in advance to fail."

Each population below was re-derived from the pinned checkout by applying
FR-016's four validator predicates and `entity-identity.md` §1's canonicalization
directly. Every figure reproduced R14 exactly; none is asserted from R14 without
having been re-derived, and none was adjusted to fit.

| R14 fact | R14's value | Re-derived | Handling |
| --- | --- | --- | --- |
| Descriptor files (exact `catalog-info.yaml` basename) | 156 | 156 | `P`.1 |
| Entity documents | 167 | 167 | the population `P` is evaluated over |
| Files carrying any `metadata.annotations` | 23 of 156 | 23 | not a selection criterion; recorded because R14 records it |
| Descriptors carrying `adrkit.io/owned-paths` | 0 | 0 | **this is why the overlay must be maintainer-authored** — see §5.1 |
| Unsubstituted skeleton descriptors | 5 files | 5 files, all one placeholder form (`${{ values.name \| dump }}`) | excluded by `P`.4 — see §5.2 |
| Invalid `metadata.name` | 7 — **5** on character class, **2** on **length alone** | 7 — 5 character class, 2 length alone | excluded by `P`.4 |

### 5.1 Why the overlay is maintainer-authored, and why that is not a weakness

**Zero** descriptors in the pinned corpus carry `adrkit.io/owned-paths`.
Requiring an externally-authored annotation would make this gate contingent on
external adoption, which ADR-0014 forbids as a blocker and which ADR-0012 gate 3
calls "welcome as an optional later production-maturity signal … **not** a hard
gate."

ADR-0020 clause 5 adopts ADR-0012 gate 3's named construction verbatim:
"synthetic explicit annotations over pinned public corpora under independent
adversarial review" — annotations added by us, over real upstream descriptors
left otherwise untouched. That is exactly what §4 does, and the "independent
adversarial review" half is T019, not this document.

### 5.2 The placeholder population is excluded on inadmissibility, not on collision

R14 notes that 14 of the 16 skeleton descriptors across both corpora share
`${{ values.name | dump }}` and "collide on canonicalization". **In this corpus
they never reach canonicalization at all.** All 5 placeholder descriptors here
carry that form as `metadata.name`, which fails `isValidObjectName`, so they are
inadmissible under `P`.4 — and `../../contracts/admissibility.md` §4.1 is explicit
that an inadmissible descriptor never acquires a canonical id and therefore can
never participate in a duplicate determination in either direction.

Recording them as excluded-for-collision would be wrong even though it reaches
the same 5 documents. `../../spec.md` FR-020 fixes the attribution: inadmissibility
is "the earlier and more specific defect."

### 5.3 The residual valid duplicate — the Nexus pair

`workspaces/nexus-repository-manager/plugins/nexus-repository-manager/catalog-info.yaml`
holds **two** YAML documents, both `kind: Component`, both declaring
`metadata.name: backstage-community-nexus-repository-manager`. Both are **fully
admissible** — the re-derivation above confirms all four validators return true
for both — and both canonicalize to
`component:default/backstage-community-nexus-repository-manager`.

This is the exact pair ADR-0020's own "SC-010 cannot be satisfied under the frozen
inputs" section names, and it is the residual valid duplicate ADR-0015's Condition
of Acceptance 3 says no admissibility rule can or should reach. It is upstream's
descriptor, in a repository this project does not control.

Both documents are excluded by `P`.5, and per §2.1 **both**, never one. Their
workspace has no other document satisfying `P`, so `nexus-repository-manager` is
not an eligible workspace under `S`.2 and contributes no entity. This is recorded
rather than passed over silently: the accept corpus is free of duplicate canonical
ids because this pair was identified and excluded, not because the corpus happened
to be clean.

### 5.4 What no exclusion above means

Excluding a descriptor from this accept corpus is a statement about **this
freeze**, and nothing else. It is not a claim that the descriptor is defective,
that Backstage would reject it, or that the generator may skip it at run time.
`../../spec.md` FR-018 is emphatic in the other direction: at run time an
inadmissible descriptor aborts the entire operation and is **never** skipped,
filtered, downgraded, or set aside so the remainder of a batch can succeed.

## 6. What this freeze does not establish

Carried from ADR-0020 clause 5 and `../../data-model.md` §17 so it is not
overstated downstream:

- It gates **technical compatibility only**.
- It does **not** evidence that the mapping reflects anyone's actual ownership,
  that anyone else wants the annotation, or that adoption risk has fallen.
- A populated, digest-verified envelope would prove **integrity, not
  correctness**. Correctness is claimed only on FR-056 / SC-011's post-output
  comparison at zero false positives and zero false negatives — a separate step,
  in Phase F, recording its own hashes and its own PASS/FAIL, inheriting nothing
  from this one.
- No claim is made about Backstage as a running system. The admissibility warrant
  is exactly what the four pinned validator predicates return at commit
  `1121a4facd9e321179d0402c3f355e4a649e84d9`.
- ADR-0014 **rung 1 only**. This is not reference-verified and not externally
  validated, and nothing here schedules or prepares a release.

## 7. Evidence that the rule preceded its application

ADR-0020 clause 5's "not chosen afterwards" is an ordering requirement, and this
document cannot discharge an ordering requirement by asserting it. So the ordering
is recorded where it can be checked:

- **§1 through §6 above — the whole rule, including `size` = 24 and the complete
  pattern catalogue — were committed before the corpus was enumerated.** At that
  commit, this file contained no entity list, no canonical id, and no
  `sourcePath`. Nothing about which entities the rule would select was known.
- **§8 below was added by a later commit**, together with the artifacts derived
  from it, and that commit did not modify §1–§6.

Both claims are mechanically checkable and are meant to be checked rather than
believed:

```bash
# The rule commit — §8 absent, no entity named:
git log --diff-filter=A --format=%H -- \
  specs/010-catalog-backstage/evidence/accept-corpus-freeze/selection-basis.md

# The rule was not touched when the enumeration landed:
git diff <rule-commit> <enumeration-commit> -- \
  specs/010-catalog-backstage/evidence/accept-corpus-freeze/selection-basis.md
```

The second command must show additions only, and none of them above §8. Any
change to §1–§6 between those commits invalidates this freeze, and the correct
response is to redo the cycle rather than to amend the record.

---

*Sections below this line were added after the rule above was committed. They are
the result of applying it, and they are recorded here so the rule and its outcome
travel together.*
