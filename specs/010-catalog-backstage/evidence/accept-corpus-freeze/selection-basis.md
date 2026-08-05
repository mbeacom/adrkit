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

## 8. The result of applying the rule

**Rule commit**: `654031b3ef84f3a625bc8d06d274c4ae83056b84`
**Enumeration commit**: the commit that added this section. Resolve it with
`git log --format=%H -1 -- <this file>` after checking out the freeze, or read it
off `git log --follow -p -- <this file>`; the diff between the two commits must be
additions only, none of them above this section.

### 8.1 The funnel, from the whole corpus to the accept corpus

| Stage | Count |
| --- | --- |
| Entity documents in the pinned corpus | 167 |
| — failing `P`.4 (inadmissible under ADR-0015) | 7 |
| — failing `P`.5 (canonical id not unique corpus-wide) | 2 |
| Documents satisfying `P` | **158** |
| Documents satisfying `P` that lie outside `workspaces/` | 0 |
| Eligible workspaces (§3.2) | **79** |
| Workspaces taken (the first 24 in `compareCodeUnits` order) | **24** |
| **Accept corpus size** | **24** |
| Distinct canonical ids in the accept corpus | **24** |

`nexus-repository-manager` is **not** among the 79 eligible workspaces. Its only
descriptor file holds the residual valid duplicate of §5.3, both documents of
which `P`.5 excludes, leaving that workspace with nothing to contribute.

`azure-devops` is worth reading as a check that `P` filters before `S` orders.
That workspace holds four descriptor files. The `compareCodeUnits`-least of them
by `sourcePath` is `plugins/azure-devops-backend/catalog-info.yaml`, but its
`metadata.name` is 72 characters and fails `isValidObjectName` on length, so it
does not satisfy `P`.4 and is not a candidate. The least **candidate** —
`plugins/azure-devops-common/catalog-info.yaml` — is what `S`.3 selects.

### 8.2 The accept corpus

Positions are the frozen order of §3. The overlay column is the assignment fixed
in §4 before these entities were known: `C[i mod 11]` for positions 0–21,
`explicit-empty` at 22, `annotation-absent` at 23.

| # | Workspace | Canonical id | `sourcePath` (`#documentIndexInFile`) | Overlay |
| --- | --- | --- | --- | --- |
| 0 | `acr` | `component:default/backstage-community-acr` | `workspaces/acr/plugins/acr/catalog-info.yaml` `#0` | `C0` |
| 1 | `adr` | `component:default/backstage-plugin-adr-backend` | `workspaces/adr/plugins/adr-backend/catalog-info.yaml` `#0` | `C1` |
| 2 | `agent-forge` | `component:default/backstage-plugin-agent-forge` | `workspaces/agent-forge/plugins/agent-forge/catalog-info.yaml` `#0` | `C2` |
| 3 | `airbrake` | `component:default/backstage-plugin-airbrake-backend` | `workspaces/airbrake/plugins/airbrake-backend/catalog-info.yaml` `#0` | `C3` |
| 4 | `allure` | `component:default/backstage-plugin-allure` | `workspaces/allure/plugins/allure/catalog-info.yaml` `#0` | `C4` |
| 5 | `analytics` | `component:default/backstage-plugin-analytics-module-ga4` | `workspaces/analytics/plugins/analytics-module-ga4/catalog-info.yaml` `#0` | `C5` |
| 6 | `apache-airflow` | `component:default/backstage-plugin-apache-airflow` | `workspaces/apache-airflow/plugins/apache-airflow/catalog-info.yaml` `#0` | `C6` |
| 7 | `apollo-explorer` | `component:default/backstage-plugin-apollo-explorer` | `workspaces/apollo-explorer/plugins/apollo-explorer/catalog-info.yaml` `#0` | `C7` |
| 8 | `azure-devops` | `component:default/backstage-plugin-azure-devops-common` | `workspaces/azure-devops/plugins/azure-devops-common/catalog-info.yaml` `#0` | `C8` |
| 9 | `azure-sites` | `component:default/backstage-plugin-azure-sites-backend` | `workspaces/azure-sites/plugins/azure-sites-backend/catalog-info.yaml` `#0` | `C9` |
| 10 | `badges` | `component:default/backstage-plugin-badges-backend` | `workspaces/badges/plugins/badges-backend/catalog-info.yaml` `#0` | `C10` |
| 11 | `bazaar` | `component:default/backstage-plugin-bazaar-backend` | `workspaces/bazaar/plugins/bazaar-backend/catalog-info.yaml` `#0` | `C0` |
| 12 | `bitbucket-pull-requests` | `component:default/bitbucket-pull-requests` | `workspaces/bitbucket-pull-requests/catalog-info.yaml` `#0` | `C1` |
| 13 | `bitrise` | `component:default/backstage-plugin-bitrise` | `workspaces/bitrise/plugins/bitrise/catalog-info.yaml` `#0` | `C2` |
| 14 | `bookmarks` | `component:default/example-website` | `workspaces/bookmarks/plugins/bookmarks/examples/component/catalog-info.yaml` `#0` | `C3` |
| 15 | `catalog` | `component:default/backstage-plugin-catalog-backend-module-codeowners` | `workspaces/catalog/plugins/catalog-backend-module-codeowners/catalog-info.yaml` `#0` | `C4` |
| 16 | `checkmarx` | `component:default/backstage-plugin-checkmarx-backend` | `workspaces/checkmarx/plugins/checkmarx-backend/catalog-info.yaml` `#0` | `C5` |
| 17 | `cicd-statistics` | `component:default/backstage-plugin-cicd-statistics-module-buildkite` | `workspaces/cicd-statistics/plugins/cicd-statistics-module-buildkite/catalog-info.yaml` `#0` | `C6` |
| 18 | `cloudbuild` | `component:default/backstage-plugin-cloudbuild` | `workspaces/cloudbuild/plugins/cloudbuild/catalog-info.yaml` `#0` | `C7` |
| 19 | `code-climate` | `component:default/backstage-plugin-code-climate` | `workspaces/code-climate/plugins/code-climate/catalog-info.yaml` `#0` | `C8` |
| 20 | `code-coverage` | `component:default/backstage-plugin-code-coverage-backend` | `workspaces/code-coverage/plugins/code-coverage-backend/catalog-info.yaml` `#0` | `C9` |
| 21 | `codescene` | `component:default/backstage-plugin-codescene` | `workspaces/codescene/plugins/codescene/catalog-info.yaml` `#0` | `C10` |
| 22 | `copilot` | `component:default/backstage-plugin-copilot-backend` | `workspaces/copilot/plugins/copilot-backend/catalog-info.yaml` `#0` | `explicit-empty` |
| 23 | `cost-insights` | `component:default/backstage-plugin-cost-insights-common` | `workspaces/cost-insights/plugins/cost-insights-common/catalog-info.yaml` `#0` | `annotation-absent` |

Two entities are worth noting because their canonical id does not follow from
their workspace name, which is exactly why the frozen record names entities by
canonical id and by `sourcePath` rather than by workspace:

- position 14, workspace `bookmarks`, is `component:default/example-website` —
  its only descriptor sits under `plugins/bookmarks/examples/component/`;
- position 12, workspace `bitbucket-pull-requests`, is
  `component:default/bitbucket-pull-requests` — its descriptor is at the
  workspace root rather than under `plugins/`.

### 8.3 How the corpus facts in §5 were re-derived

Applying `../../spec.md` FR-016's four validator predicates and
`entity-identity.md` §1's canonicalization directly to the pinned checkout,
outside this repository, over all 156 `catalog-info.yaml` files. Every figure in
§5 reproduced `research.md` R14 exactly, including the split of the seven invalid
names into **5** on character class and **2** on **length alone** — the two
populations `../../contracts/admissibility.md` §2.1 warns must never be reported
as one.

**No ownership was derived at any point.** Nothing decoded an annotation,
compiled a glob, or matched a path. Admissibility and identity canonicalization
are `plan.md` Phase D concerns, placed **before** Barrier B, and ADR-0020 clause 5
requires both of them in order to select an admissible, collision-free corpus at
all — a corpus could not be selected under clause 5's own conditions if computing
them were barred.

### 8.4 Recorded hashes

| Artifact | `contentHash` |
| --- | --- |
| `../frozen-expectations/frozen-expectation-set.json` | `e641ae5e4201a099e92e98fbaa7683bc0eb0290adb01f93abbd474c695c2430c` |
| `accept-corpus-freeze.json` | `f98e6d464b53ba334298c1e5b76bbd0222ff2a460f7637439f0e8d54c9294aca` |

Computed per `../README.md` §3. **T019 must recompute both from the artifacts
rather than copy them from this table** — `../../data-model.md` §16: "An audit that
transcribes the author's declared hash has verified nothing."

### 8.5 What has *not* been done, and must not be inferred from this document

- **No generator was run**, because none exists. `packages/adapters/catalog-backstage`
  has not been created. No `SnapshotEnvelope` exists. No derived-ownership result
  for any descriptor-sourced entity exists — not persisted, not held in memory, not
  asserted in a test (`research.md` R4).
- **No input manifest exists anywhere in the tree**, and nothing in this evidence
  tree is one (`../README.md` §4).
- **No comparison harness exists.** Phase F authors it, after this freeze and after
  its audit, so that ADR-0020 clause 5's two steps stay two steps.
- **This freeze is not audited yet.** T019 is the independent audit, and it must be
  performed by a reviewer with **no authoring involvement in T014–T018**. An audit
  by the author of this document would not be an independent audit, and recording
  one as such would defeat the control rather than implement it. Until T019 records
  its own PASS/FAIL and its own **explicit adequacy finding**, SC-010 is **not**
  satisfied and no part of it may be reported as satisfied.
- **T020, T021, T023's observed-failing runs have not been performed**, so under
  ADR-0016 none of the checks over this freeze counts as coverage yet.
- **Barrier B has not cleared.** T024 is the gate, and it is unchecked.
