# Implementation Plan: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Feature directory**: `009-catalog-binding-viability` | **Implementation
branch**: Not yet assigned; execution is authorized by governance once this
migration merges, but this plan's authoring session remains scoping-only and
did not open an implementation branch. This plan was authored on
`mbeacom-spec-009-plan-catalog-binding`, itself a scoping-only worktree
stacked on `mbeacom-spec-009-catalog-binding-viability` at commit `e892ba1`
("docs: scope catalog binding viability"). | **Date**: 2026-07-21 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
`specs/009-catalog-binding-viability/spec.md` (banner + Ratification Record,
User Stories 1–8, Functional Requirements FR-001–FR-038, Success Criteria
SC-001–SC-014, Assumptions A1–A11, Output Recommendation section).

**Normative sources** (ADRs win on conflict):
[ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
(`status: accepted`, PR #26, `54dbae8` — the controlling record of the
`adrkit.io/owned-paths` contract, the restricted glob dialect, atomic
fail-closed semantics, the repository boundary, and the versioned-envelope
requirement),
[ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
(`status: accepted`, PR #27, `48087e8` — reconciles ADR-0007/ADR-0009's
narrowed clauses while deliberately holding both `proposed`, and defines
their own future acceptance path),
[ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(`status: accepted` — replaces external-actor hard gates with the three-rung evidence ladder),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md)
(`status: proposed`; affects resolution semantics, the `entity` matcher
grammar, and the `CatalogPort`/`CatalogSnapshot` contract this spike measures
a candidate producer for — its body now carries ADR-0013's amendment
blockquote),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md)
(`status: proposed`; adapter isolation, clean-clone/credential-free/
network-free build and runtime — its body now carries ADR-0013's "no dynamic
runtime adapter/plugin loader" amendment blockquote for the catalog surface),
and [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–V (v1.0.2; git is truth; clean clone builds green with no
post-install network/credentials/services; core and CLI depend on no
adapter; deterministic before probabilistic; schema is the contract).

**Upstream/corpus targets** (frozen, cited verbatim from `spec.md` FR-001;
re-verify at execution time, never reselect; **not re-fetched by this
planning session** — see `research.md` R1): Backstage
`1121a4facd9e321179d0402c3f355e4a649e84d9`;
`backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459`
(156 `catalog-info.yaml`/`.yml` descriptors, 23/156 with any
`metadata.annotations`, 0/156 with `adrkit.io/owned-paths`);
`redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1`
(38 descriptors by exact basename, not 39).

> ✅ **Governance preconditions satisfied; spike execution authorized once this migration
> merges; tasks remain unchecked until actually executed.**
>
> **Satisfied preconditions.** Maintainer scoping/contract ratification (adrkit issue #25,
> both 2026-07-21 decisions), catalog-binding convention governance
> ([ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md),
> `accepted`, `54dbae8`), the adapter-isolation/catalog-binding reconciliation
> ([ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md),
> `accepted`, `48087e8`), and the phase-landing evidence policy
> ([ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
> `accepted`) are all **satisfied**. ADR-0007 and ADR-0009 remaining `status: proposed` with
> documented blockers is this precondition's satisfied, final disposition — not an execution
> gate.
>
> **Phase 6 status.** Phase 6 is **landed / reference-verified** on ADR-0014 rungs 1–2:
> `specs/007-arb-queue/tasks.md` T048-R/T049 read `- [X]`, and root `plan.md` records the
> `specs/007-arb-queue/` row as `landed / reference-verified`. The rung-2 evidence is the
> **maintainer-owned isolated reference repository** <https://github.com/mbeacom/adrkit-t018-dogfood>,
> not an external team and not external / community validation (ADR-0014 rung 3).
>
> **Independent-adopter status.** The previous independent-adopter pre-execution gate is
> removed. The spike builds its own **frozen, maintainer-authored reference oracle** in the
> scratch workspace before any generator output is produced, from FR-001's pinned public
> corpora, maintainer-authored synthetic explicit `adrkit.io/owned-paths` annotations, and
> independent adversarial review. The oracle covers positive, negative, overlap, absent/empty,
> collision (duplicate canonical ID), and repository-mismatch cases with bounded zero
> false-positive / zero false-negative results over those labeled cases. External-adopter
> evidence is optional externally-validated maturity evidence only, not a hard gate for this
> spike or Phase 6.
>
> **Follow-up scoping session — `tasks.md` was subsequently generated.** A later advance-scoping
> session produced `tasks.md` with **T001–T086**, all unchecked. Phase 1 of `tasks.md` (T001–T004)
> now records the satisfied basis and computes `GATE_PASS = true` once re-run, authorizing Phase
> 2 onward after this migration merges. Generating or migrating the task list still marks no
> task complete and performs no fixture derivation, corpus re-fetch, comparison run, evidence
> gathering, commit, push, or PR.

## Summary

Design, on paper only, the disposable synthetic fixtures, the two standalone
scratch-repository test harnesses, and the complete evidence-bundle/verdict
protocol that ADR-0012's action item 1 requires before any production
`packages/adapters/catalog-backstage` package is scoped. This plan fixes
exactly how a future, gate-cleared execution session mechanically satisfies
`spec.md`'s 8 user stories and 38 functional requirements: the
decode-then-validate pipeline and three-state ownership discriminator for
the hardened `adrkit.io/owned-paths` annotation
(`contracts/owned-paths-annotation.md`); the frozen `picomatch@4.0.5`
restricted-dialect validator, its fixed rejection-reason order, and the
already-confirmed dotfile policy (`contracts/glob-dialect.md`); canonical
lowercase entity identity and global-uniqueness collision failure
(`contracts/entity-identity.md`); the closed-schema single-repository input
manifest, its repository-identity/revision verification algorithm, and its
read/write input boundary (`contracts/input-manifest.md`); the
whole-operation atomic fail-closed rule as a closed fourteen-trigger
enumeration (`contracts/atomic-fail-closed.md`); the versioned snapshot
envelope's exact shape, its consumer-side validation-before-derivation
order, its RFC-8785-equivalent canonicalization/digest scope (reusing
`@adrkit/core`'s own existing `canonicalStringify` pattern), and its
malformed/tampered/stale/misidentified-repository rejection plus
repository-isolation proofs (`contracts/snapshot-envelope.md`); the A/B/C/D
comparison protocol, with B/C's real-corpus cardinality findings and
synthetic precision matrix always labeled `non-authoritative`
(`contracts/comparison-heuristics.md`); the three required synthetic
structural fixtures plus the real-corpus citations, copied verbatim from
`spec.md` with no new fetch (`contracts/structural-fixtures-and-corpora.md`);
a fixed scale/security measurement protocol that explicitly never proposes a
production limit (`contracts/scale-and-security-measurement.md`); the
evidence-bundle completeness rule and the three-way verdict's fixed
precedence, including the disclaimers distinguishing every verdict from optional
externally-validated maturity (`contracts/evidence-bundle-and-verdict.md`);
and the standalone-offline-generator/no-dynamic-loader composition boundary
with the permanently-undecided release vehicle
(`contracts/composition-and-release-boundary.md`).

This plan produces zero code, zero fixture files on disk outside this
planning session's design docs, and zero adapter package. It changes nothing
in `packages/core/src/affects/**`, the `CatalogPort`/`CatalogSnapshot` types,
the ADR schema, or any `packages/adapters/**` path.

## Technical Context

**Language/Version**: A future execution session's generator/consumer
scripts are TypeScript run under Bun (matching this repository's own
toolchain, ADR-0010), invoking `picomatch@4.0.5` and `yaml@2.9.0` — both
already `packages/core` dependencies — as the frozen parsing/matching
engines. This planning session itself writes no TypeScript; every artifact
here is Markdown/JSON design documentation.

**Primary Dependencies**: `picomatch@4.0.5` (already pinned, `bun.lock`;
frozen options `dot:false`/`nocase:false`/`nonegate:true`, identical to both
existing core matchers). `yaml@2.9.0` (already pinned; its default
`uniqueKeys: true` behavior is reused, not overridden, for duplicate-key
detection — `research.md` R8). `node:crypto`'s `createHash('sha256')`
(already used by `packages/core/src/fingerprint/index.ts`'s `fingerprintOf`)
for the envelope digest. No new runtime or dev dependency is added to any
`@adrkit/*` package by this plan (Constitution Principle III).

**Storage**: None, in production terms. A future execution session's
evidence bundle and every intermediate fixture/envelope are scratch-only
files under session-scoped and standalone-scratch-repository locations
(`research.md` R2) — never a database, never a tracked repository file.

**Testing**: This spike has no `bun test` suite of its own — it is not a
package. "Testing" here means the acceptance-scenario evidence protocol in
`quickstart.md` and the fixed exit-code/rejection-reason contracts across
all eleven `contracts/*.md` files. Verification of *this planning artifact
set itself* is the fresh-context adversarial reader test recorded in
`research.md` R13, per the doc-coauthoring reader-test pattern and this
task's own explicit review instruction — not a CI job, since nothing here is
merged to `main`.

**Target Platform**: Whatever platform a future execution session's own host
is — cross-platform (Windows path/line-ending) rendering of synthetic
fixtures is not addressed by this plan and would need its own review at
execution time if relevant.

**Project Type**: Not a workspace feature. Every fixture, manifest, and
envelope this plan designs lives entirely outside `packages/`, on disposable
scratch locations (`research.md` R2) — never a `packages/adapters/
catalog-backstage` package, never registered in root `package.json`
`workspaces`, and never subject to `core-has-no-adapter-deps` or
`clean-clone-builds` because none of it ever enters the tracked tree those
gates inspect.

**Constraints**: No network access during any derivation run beyond the
one-time, already-completed preflight acquisition of the three FR-001
commits (FR-018). No credentials at any step (Principle II). Zero mutation
of `docs/adr/**`, the schema, or any other tracked file at any point in
future execution (FR-019). Generation reads only the descriptor files an
explicit input manifest names, by path and digest (`research.md` R7;
`contracts/input-manifest.md` §5) — never a directory walk, never a followed
`Location` target. Every invocation is bracketed by a `git status
--porcelain` capture (FR-018/SC-011). All spike execution stays on scratch
locations outside the committed `specs/` tree (`research.md` R2; A7).

**Scale/Scope**: Three required single-repository generation passes
(community-plugins-derived, rhdh-plugins-derived, primary synthetic) plus a
fourth, second-repository pass for the repository-isolation check; at least
10 synthetic entities in the labeled comparison matrix; two pinned real
corpora (156 and 38 descriptors respectively); no multi-repository or
federated snapshot at any point.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design
below. Both checks additionally verify the two properties specific to this
feature: (a) this plan produces no shipping artifact, and (b) the double
gate from `spec.md`'s banner is recorded, not loosened, by this plan.*

### Pre-Design Check (initial)

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Git Is the Source of Truth** | ✅ PASS | This plan and its companion artifacts are authored by this planning session only in its own scoping worktree (`mbeacom-spec-009-plan-catalog-binding`); as of this Constitution Check, none has been committed, pushed, or proposed via PR (confirmed by `git status --porcelain`; see the Completion Report below). No decision content (`docs/adr/**`) is read as anything but citation, written, or proposed for change by this plan (FR-020 and the Out of Scope section's ADR-schema-untouched constraints both extend to this). |
| **II. Clean Clone Builds Green** | ✅ PASS | This plan adds no dependency, no workspace package, no build step, and no CI job. Every future execution step is designed to run fully offline (beyond the one-time FR-001 preflight fetch already completed) with no credentials (`contracts/scale-and-security-measurement.md` §5). |
| **III. Core Depends on No Adapter** | ✅ PASS | No fixture, manifest, or envelope this plan designs is a package under `packages/adapters/*` or is ever installed into this repository's workspace. `@adrkit/core`, `@adrkit/cli`, and the schema are untouched — the design's own generator only *reuses the pattern of* an already-published pure utility (`canonicalStringify`), never imports an adapter, and the composition boundary is explicitly a standalone offline executable, never a runtime-discovered plugin (`contracts/composition-and-release-boundary.md` §1–§2). |
| **IV. Deterministic Before Probabilistic** | ✅ PASS | Every parsing/validation/canonicalization/comparison step this plan designs is a deterministic algorithm (`contracts/owned-paths-annotation.md`, `contracts/glob-dialect.md`, `contracts/entity-identity.md`) with a fixed execution order (`research.md` R9). The verdict-decision procedure (`contracts/evidence-bundle-and-verdict.md` §2) is a fixed, exhaustive, mutually-exclusive precedence table — not a probabilistic judgment. No model call is designed into any derivation or consumer-side check. |
| **V. The Schema Is the Contract** | ✅ PASS | This plan proposes no change to `AdrFrontmatter`, `schema/adr.schema.json`, or `bun run schema:emit` (FR-020; Out of Scope section's "[a]ny change to the ADR schema" exclusion). The `SnapshotEnvelope`/`InputManifest` shapes this plan fixes are a *different*, spike-scoped schema this plan documents but never merges into the ADR schema or the existing `CatalogSnapshot` types (`contracts/composition-and-release-boundary.md` §2). |

No violations. Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/009-catalog-binding-viability/
├── spec.md                                    # Ratified; double-gate banner + Ratification Record
├── checklists/
│   └── requirements.md                        # Passed; reader-tested
├── plan.md                                    # This file — Phase 0/1 output (the authoring session stopped here)
├── research.md                                # Phase 0 output — R1–R13, all narrow decisions resolved
├── data-model.md                              # Phase 1 output — 24 entities plus a relationship summary (evidence/verdict schema, not production data)
├── quickstart.md                              # Phase 1 output — future GATED execution/validation guide
├── contracts/
│   ├── owned-paths-annotation.md              # Decode/validate pipeline; three-state ownership discriminator
│   ├── glob-dialect.md                        # Restricted picomatch grammar/options; dotfile policy; migration rule
│   ├── entity-identity.md                     # Canonical lowercase ids/refs; global uniqueness; collision failure
│   ├── input-manifest.md                      # Single-repo manifest; identity/revision checks; source digests; input boundary
│   ├── atomic-fail-closed.md                  # Whole-operation fail-closed semantics; closed trigger enumeration
│   ├── snapshot-envelope.md                   # Versioned envelope; validation-before-derivation; digest/stale/tamper/mismatch
│   ├── comparison-heuristics.md                # A/B/C/D protocol; B/C non-authoritative labeling; D no-effect confirmation
│   ├── structural-fixtures-and-corpora.md      # Pinned corpora citations; multi-doc/dup-key/Location synthetic fixtures
│   ├── scale-and-security-measurement.md       # Fixed measurement protocol; network-denial hierarchy; no invented limits
│   ├── evidence-bundle-and-verdict.md          # Bundle completeness; fixed 3-way verdict precedence; optional externally-validated maturity distinction
│   └── composition-and-release-boundary.md     # Standalone offline generator; no dynamic loader; undecided release vehicle
└── tasks.md                                   # Phase 2 output — generated in a follow-up advance-scoping session (T001–T086, all unchecked; execution still gated)
```

### Source Code (repository root)

**None.** This feature adds no file under `packages/`, no change to root
`package.json` `workspaces`, and no CI workflow. The fixtures, manifests,
and envelopes this plan designs are explicitly designed to live outside the
tracked tree entirely (`research.md` R2) — see
`contracts/composition-and-release-boundary.md` §6 for the explicit "adds
nothing to the repository" statement. This absence is itself Constitution
Check evidence for Principles II and III above: there is nothing here for
`clean-clone-builds` or `core-has-no-adapter-deps` to even inspect.

**Structure Decision**: Design-only artifacts under
`specs/009-catalog-binding-viability/`; zero source-tree changes. See
`research.md` R2–R7 for the full scratch-location and I/O-boundary
rationale.

## Phase 0: Research

Research artifacts are in [research.md](./research.md). All narrow
implementation-planning decisions this task required are resolved without
broadening `spec.md`'s ratified scope or changing core semantics/dependencies.
Summary of binding decisions:

- **R1 Citation discipline (no new fetch)**: every Backstage/corpus fact is
  copied verbatim from `spec.md`'s own citations; this planning session
  performed no new fetch, per the task's explicit "use immutable
  upstream/corpus refs from the spec only" instruction.
- **R2 Scratch/session artifact paths**: three-way split — general
  derivation scratch, a standalone scratch git repository specifically for
  repository-mismatch tests (never a linked worktree), and a session-scoped
  evidence-bundle directory, never this repository's own working tree.
- **R3 Exact evidence filenames/formats**: one narrative Markdown file, one
  top-level JSON manifest, and a fixed set of per-pass/per-check JSON
  artifact files, named explicitly rather than embedded inline.
- **R4 Deterministic ordering/canonical JSON choice**: reuses
  `packages/core/src/fingerprint/index.ts`'s `canonicalStringify` and
  `packages/core/src/ordering/index.ts`'s `compareCodeUnits` patterns —
  already-published, already-precedented pure utilities — rather than
  introducing a new RFC 8785 dependency.
- **R5 Manifest/envelope shapes**: one digest algorithm (SHA-256) throughout;
  both schemas closed, never open passthrough bags.
- **R6 Repository ID normalization algorithm**: the exact parsing rule from
  any real `git remote get-url origin` form to the canonical lowercase
  `github.com/<owner>/<repo>` shape, applied identically to the manifest's
  declared value and the checkout's actual value.
- **R7 Input boundaries**: the generator's exact read/write surface,
  operationalizing FR-010's completeness constraint mechanically.
- **R8 Parser duplicate-key behavior**: reuses `yaml@2.9.0`'s own default
  `uniqueKeys: true` behavior rather than a bespoke duplicate-key scanner.
- **R9 Restricted glob pattern validator algorithm**: a fixed 14-rule rejection
  validation order resolving which single reason a multi-violating pattern
  reports.
- **R10 Scale/security measurement protocol**: fixed workload/warm-up/
  aggregation-statistic shape, reusing this project's own `specs/007-...`
  and `specs/008-...` measurement/network-denial precedents.
- **R11 Cleanup and recovery**: explicit teardown order and mid-run-failure
  recovery procedure, preventing an execution session from "patching" a
  partial artifact into a false valid one.
- **R12 Verdict precedence**: structural encoding of SC-012's fixed
  precedence, mirroring `specs/008-...`'s own structural-verdict pattern.
- **R13 Reader test**: fresh-context adversarial review findings and
  remediation for this complete artifact set.

## Phase 1: Design Artifacts

All Phase 1 artifacts are generated:

- **[data-model.md](./data-model.md)**: 24 entity definitions (§1–§24) plus a relationship-summary section (§25) spanning the
  annotation/pattern/identity layer (§1–§8), the manifest/repository-boundary
  layer (§3–§4), the envelope/rejection layer (§9–§12), the comparison layer
  (§13–§15), the structural-fixture layer (§16–§17), the
  scale/security/scratch layer (§18–§21), and the evidence-bundle/verdict
  layer (§22–§24). Explicitly evidence/verdict schema — never production ADR
  data, never a schema change to `AdrFrontmatter` or `CatalogSnapshot`.
- **[contracts/owned-paths-annotation.md](./contracts/owned-paths-annotation.md)**:
  Decode-then-validate order; the three-state ownership discriminator and
  its non-conflation rule; the single-element-empty-string edge case.
- **[contracts/glob-dialect.md](./contracts/glob-dialect.md)**: Frozen
  engine/options; allowed character set; the fixed 14-rule rejection order;
  the confirmed (not newly designed) dotfile policy with its precise
  source-level-parity scope limit; the migration/reclassification rule.
- **[contracts/entity-identity.md](./contracts/entity-identity.md)**:
  Canonicalization algorithm; synthetic-fixture-only alias sourcing; global
  uniqueness and every collision kind (including alias-vs-ID and case-only);
  the positive "no exclusive winner" demonstration; the unaffected
  case-sensitive production boundary.
- **[contracts/input-manifest.md](./contracts/input-manifest.md)**: Closed
  manifest schema; the three FR-033 version/capability rejections;
  repository identity/revision verification (including the standalone-
  scratch-repository requirement); source digests and "incomplete required
  source"; the exact input read/write boundary; the `Location`-not-followed
  worked example.
- **[contracts/atomic-fail-closed.md](./contracts/atomic-fail-closed.md)**:
  The whole-operation rule stated precisely against its most likely
  misimplementation; the closed fourteen-trigger enumeration; the four
  manifest-request-level rejections.
- **[contracts/snapshot-envelope.md](./contracts/snapshot-envelope.md)**:
  Full envelope shape (one per pass, never merged); the consumer-side
  validation-before-derivation order; the exact canonicalization/digest
  algorithm with a worked example and its honestly-scoped guarantee;
  staleness as exact inequality; repository-identity mismatch as outright
  rejection; repository isolation as acceptance-with-correct-filtering,
  never a rejection; the five User Story 7 checks consolidated in one table.
- **[contracts/comparison-heuristics.md](./contracts/comparison-heuristics.md)**:
  The four options' roles and authoritativeness boundaries; real-corpus
  cardinality findings (copied verbatim, no re-fetch); the synthetic
  precision protocol with a worked zero-denominator example; Option D's
  confirmed no-effect using unmodified core code.
- **[contracts/structural-fixtures-and-corpora.md](./contracts/structural-fixtures-and-corpora.md)**:
  The three frozen research-input commits; the three required synthetic
  structural fixtures; the three real-corpus evidence reproductions
  (absent-annotation rate, descriptor-parent granularity, stale project
  slug); the "never a silent skip" outcome requirement.
- **[contracts/scale-and-security-measurement.md](./contracts/scale-and-security-measurement.md)**:
  The fixed measurement set and protocol; per-pass aggregation with
  attribution; the "not guessed now" production-limit prohibition; the
  ranked network-denial hierarchy with honest limitations; mutation-baseline
  bracketing.
- **[contracts/evidence-bundle-and-verdict.md](./contracts/evidence-bundle-and-verdict.md)**:
  Bundle completeness; the fixed three-step verdict precedence with every
  named trigger/shortfall; the explicit, unconditional
  optional externally-validated maturity distinction; the non-binding recommendation's required
  fields; the three SC-013 disclaimers, present on every verdict regardless
  of outcome; the cross-reference requirement.
- **[contracts/composition-and-release-boundary.md](./contracts/composition-and-release-boundary.md)**:
  The standalone-offline-generator/no-dynamic-loader composition model; core/
  CLI isolation unaffected; ADR-0007/ADR-0009 status framing; the absolute
  no-shipping-artifact scope boundary; the permanently-undecided release
  vehicle; this plan's own zero-repository-footprint statement.
- **[quickstart.md](./quickstart.md)**: A governance-authorized, step-by-step
  validation walkthrough mapping directly to User Stories 1–8 and Success
  Criteria SC-001–SC-014; tasks remain unchecked until executed.

## Constitution Check (Post-Design)

| Principle | Final Status | Notes |
|-----------|-------------|-------|
| **I** | ✅ PASS | The complete design artifact set adds zero tracked files under `docs/adr/**`, proposes zero schema change, and opens zero implementation branch. The ADR-0014 governance authorization from `spec.md`'s banner is restated in this plan's own banner, with tasks still unchecked until executed. |
| **II** | ✅ PASS | No dependency, build step, or CI job was added anywhere in the repository by this planning session. The designed execution protocol (`contracts/scale-and-security-measurement.md` §5) requires no network beyond the one-time FR-001 preflight fetch and no credentials at any step. |
| **III** | ✅ PASS | No file was added under `packages/adapters/*` or any other package. `contracts/composition-and-release-boundary.md` §1–§2 fix the future composition boundary as a standalone offline executable, never a runtime-discovered plugin, and confirm `@adrkit/core`/`@adrkit/cli` never learn an adapter exists. |
| **IV** | ✅ PASS | Every contract's own decision procedure (`contracts/owned-paths-annotation.md`, `contracts/glob-dialect.md`, `contracts/entity-identity.md`, `contracts/evidence-bundle-and-verdict.md` §2) is a fixed, deterministic algorithm or precedence table, checked in a stated order, with no probabilistic or model-assisted step anywhere in the design. |
| **V** | ✅ PASS | No change to `AdrFrontmatter`, `schema/adr.schema.json`, the `schema-emit-matches` gate, or the existing `CatalogSnapshot`/`CatalogSnapshotEntity` types. `data-model.md`'s 24 entities are this spike's own evidence/verdict/fixture shapes, versioned and scoped only to this feature directory. |

## Complexity Tracking

> No Constitution Check violations. This table is intentionally empty.

## Reader Test

A fresh-context, adversarial reader test of this complete planning set
(`plan.md`, `research.md`, `data-model.md`, `quickstart.md`, all eleven
`contracts/*.md` files) against `spec.md`, ADR-0012, ADR-0013, ADR-0014, ADR-0009,
ADR-0007, `.specify/memory/constitution.md`, the referenced
`packages/core/**` source files, and `specs/007-arb-queue/tasks.md` was
performed per the doc-coauthoring reader-test pattern, using GPT-5.6 Sol at
high reasoning effort — a high-capability model distinct from this session's
own Claude Sonnet 5 (the primary authoring model), per this task's "Sonnet 5
primary" instruction for authoring paired with its separate "Opus 4.8 or
GPT-5.6 Sol" instruction for the review itself — reading with a dedicated,
isolated review context and no authoring history. The review found no
critical findings, 9 high, 7 medium, and 4 low/nit findings; all 9 high and
all medium/low findings were remediated in the current version of every
referenced file. Full findings and remediation are recorded in
[research.md](./research.md) §R13.

## Completion Report

**Branch**: `mbeacom-spec-009-plan-catalog-binding` (scoping-only, stacked on
`mbeacom-spec-009-catalog-binding-viability` at `e892ba1`; no implementation
branch opened; no commit/push/PR performed by this session).
**IMPL_PLAN path**: `specs/009-catalog-binding-viability/plan.md` (this
file). **Generated artifacts (Phase 0/1, this authoring session)**:
`research.md`, `data-model.md`, `quickstart.md`, and all eleven
`contracts/*.md` files listed in Project Structure above. **Generated in a
follow-up advance-scoping session (Phase 2)**: `tasks.md` (T001–T086,
dependency-ordered, every task unchecked as generated) — produced under root
`plan.md`'s "spec → plan → tasks" scoping exemption. That task list is
**scoping, not execution**: it now records the satisfied Phase 6 and governance
basis and computes `GATE_PASS = true` once T001–T004 are re-run, but no task is
marked complete until actually executed. This authoring session itself
performed no implementation, fixture derivation, corpus re-fetch, comparison
run, evidence gathering, commit, push, or PR.
**Constitution status**: all five principles PASS, before and after design;
Complexity Tracking empty. **Gate status**: Phase 6 is **landed /
reference-verified** (ADR-0014 rungs 1–2) via a maintainer-owned isolated
reference repository, not external / community validation (ADR-0014 rung 3);
maintainer ratification, ADR-0012, ADR-0013, and ADR-0014 are satisfied; the
previous independent-adopter pre-execution gate is removed and replaced by the
in-scratch frozen, maintainer-authored reference oracle. External-adopter evidence is
optional externally-validated maturity evidence only. **Review status**: an
independent GPT-5.6 Sol reader-test pass found no critical findings, 9 high, 7
medium, and 4 low/nit findings; all were remediated in the current version of
the affected files (research.md §R13). **This plan and its companion `tasks.md`
authorize execution only after this migration merges, and neither marks any
execution task complete.**
