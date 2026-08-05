# Implementation Plan: Backstage Catalog Adapter — Offline Owned-Paths Snapshot Generator

**Feature**: `010-catalog-backstage`
**Feature directory**: `specs/010-catalog-backstage/`
**Worktree branch**: `mbeacom-supreme-guacamole` (a linked worktree of `mbeacom/adrkit`)
**Date**: 2026-08-04
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/010-catalog-backstage/spec.md`, with
[research.md](./research.md) (R1–R14), [data-model.md](./data-model.md), and
[contracts/](./contracts/) as its completed Phase 0 / Phase 1 companions.

**Authorization**: ADR-0020 (accepted) authorizes **the work**, not the release. Nothing in this
plan schedules, implies, or depends on a release. ADR-0020 clause 9 defers release; ADR-0012
gate 3 is open and gate 4 is unmet and not yet testable (`research.md` R9).

---

## Summary

Build an offline generator that reads one explicit manifest plus the descriptor files that
manifest names, decides each descriptor's admissibility against a pinned Backstage predicate
surface, canonicalizes entity identity, derives owned-path patterns from the
`adrkit.io/owned-paths` annotation alone, and writes exactly one versioned `SnapshotEnvelope` —
or aborts the whole operation, atomically and fail-closed, on any of **fifteen** trigger classes.
Build alongside it a separate consumer package that validates such an envelope and derives a
`CatalogSnapshot`-shaped artifact from it, and which depends on the generator in no way at all.

The technical approach is fixed almost entirely by prior decisions, and this plan adopts them
rather than re-deciding them: package placement (`research.md` R1), canonicalization reuse (R2),
glob engine provenance (R3), dependency direction (R7), YAML reading (R11), and the corpus pins
(R14). What this plan adds is **sequencing** — because the single hardest constraint on this
feature is not what to build but *what may not exist yet when a given piece is built*.

That constraint is ADR-0020 clause 6's pre-output barrier, called **Barrier B** throughout this
plan. It is not a checklist item. It is the organizing structure of the build, and every phase
below states which side of it the phase sits on.

**No evidence exists for this feature.** Nothing has been built, run, or measured. Every
behavioural statement in this document is a requirement on work not yet done. This is ADR-0014
**rung 1** work throughout: maintainer verification, with only the corpus *data* being
third-party. It is never external, third-party, or community validation.

---

## Technical Context

**Language / Version**: TypeScript, developed on the Bun toolchain (Bun 1.3.14, from the root
`package.json` `packageManager` field). Published artifacts target Node `>=22` (root
`package.json` `engines.node`, and FR-051).

**Primary Dependencies**:

| Dependency | Declared | Resolved | Role |
| --- | --- | --- | --- |
| `picomatch` | `^4` (`bun.lock:47`) | `4.0.5` (`bun.lock:165`) | Glob compilation, `{ dot: false, nocase: false, nonegate: true }` (R3) |
| `yaml` | `latest` (`bun.lock:49`) | `2.9.0` (`bun.lock:187`) | `parseDocument`, `uniqueKeys` left at its default `true` (R11) |
| `@adrkit/core` | workspace | workspace | `canonicalStringify` and `compareCodeUnits` (R2, decision G1) |

All three lockfile line numbers were read in this worktree. Both registry dependencies are
already present in the committed lockfile; **this feature adds no new registry surface.**

Two provenance rules travel with these:

- The `picomatch` version recorded in an envelope MUST be **read at runtime from the resolved
  dependency**, never transcribed into a table. Spike 009's `glob-dialect.md` §1 pinned the
  literal; the value is unchanged today, but the *provenance* is a production delta (R3).
  Authority: `spec.md` assumption A6, plus the consumer's own exact-value deep-equal check —
  `snapshot-envelope.md` §2 step 3 states a version-only check is insufficient.
- The `yaml` declaration is `latest`, so the resolved version is pinned only by the committed
  lockfile. Anything that re-resolves the lockfile can move `2.9.0`. Duplicate-key detection
  depends on `uniqueKeys` defaulting to `true`; the default MUST never be set to `false`, and a
  version move MUST be treated as a change to the parse contract, not as housekeeping.

**Storage**: Filesystem only. One envelope JSON file per successful run, at a caller-specified
path. No database, no index, no cache. Consistent with Constitution Principle I: anything
derived is disposable and rebuildable from git.

**Testing**: `bun test` (root `package.json` `test` script), under ADR-0016's observed-failing-
first discipline (`research.md` R8). A check only ever observed passing is not coverage.

**Target Platform**: Node `>=22` for the published artifact shape; Bun for development and CI.
Runtime posture is offline, credential-free, and service-free (FR-050, FR-052).

**Project Type**: Two workspace library packages — one adapter (a standalone generator invoked
directly by name, with **no** dynamic loader, per ADR-0013 and FR-002) and one non-adapter
consumer library. No CLI surface wiring in this feature.

**Performance Goals**: **None, deliberately.** Per FR-055 and ADR-0012, production limits "are
not guessed now; they must be ratified from evidence." No throughput target, no latency target,
and no minimum or maximum entity count is set by this plan. Recording a guess here would create
exactly the unratified default ADR-0012 forbids.

**Constraints**:

- Offline at generation time; the input boundary is the manifest, the manifest-listed and
  digest-verified descriptor paths, and two git-identity values read via subprocess (FR-013, R10).
- No recursive directory walking and no glob-based discovery of inputs (`input-manifest.md` §5).
- Byte-identical output across repeated runs on identical inputs (FR-042). The envelope's field
  list carries no clock-derived field, which is what makes this achievable.
- Whole-operation atomic fail-closed over **fifteen** trigger classes (FR-034, FR-035).
- Single repository per operation (FR-007).
- ADR-0014 rung 1 only; no release scheduling (FR-062, FR-063).

**Scale / Scope**: Bounded by the manifest, not by the tree. For orientation only, the corpus
pins in `research.md` R14 are `community-plugins` at
`92e9e4e09c76cc57f3475029b73e5ec84498a459` — **156 descriptor files** carrying **167 entity
documents** — and `rhdh-plugins` at `3b355ddfedb23c6656bd9effc8510f9926b765c1` — **38 descriptor
files** carrying **39 entity documents** (the 38/39 figure holds only under exact
`catalog-info.yaml` basename matching). **File counts and document counts are different
populations** and must never be reported interchangeably. These are reference figures for
fixture design; they are not scale targets.

---

## Constitution Check

Evaluated against `.specify/memory/constitution.md` v1.0.2. This is the **pre-design** pass; the
post-design re-evaluation follows the Project Structure section.

### Principle I — Git Is the Source of Truth

**PASS, and load-bearing.**

The generator writes only an envelope to a caller-specified path; it never mutates a record under
`docs/adr/**`. The envelope is a derived, disposable projection, rebuildable from the manifest
and the descriptor files — precisely the category Principle I permits.

Principle I is doing real work here rather than being merely satisfied. ADR-0015's Condition of
Acceptance 1 identifies spike 009's untracked scratch evidence bundle as a hazard. Barrier B's
second enforcement mechanism (hash re-derivation in CI, R5) is only possible if the frozen
artifacts are **tracked in git**. So Principle I is the reason the freeze artifacts in Phase B
live in the repository rather than in a scratch directory.

### Principle II — Clean Clone Builds Green

**PASS, with one obligation named rather than assumed.**

Both new packages are matched by existing `workspaces` globs and are therefore picked up by
`bun run --filter='*' …` and by `bun test` with **no workflow change** (R10). The existing
`clean-clone-builds` job (`.github/workflows/ci.yml:12`, whose steps run frozen install,
typecheck, build, lint, test, and `check:deps` at lines 23–40) covers them as-is. No new registry
dependency is introduced, so the only permitted public-registry access — during
`bun install --frozen-lockfile` — is unchanged.

The obligation: SC-016 requires network access to be **actively denied** during the generator
run, not merely unexercised. "No calls were observed" is a weaker claim than "calls were
impossible." Meeting the stronger form is Phase G work and is tracked there, not waved through
here.

### Principle III — Core Depends on No Adapter

**PASS.** This is the Principle the design interacts with most, in three directions.

*Direction (a) — nothing outside adapters may depend on an adapter.* The consumer lives at
`packages/catalog-envelope/`, outside `packages/adapters/**`, and depends on `@adrkit/core` only
(FR-044). `isAdapterPackage()` (`scripts/check-deps.ts:92–94`) classifies purely by the
`packages/adapters/` path prefix, so the consumer is a non-adapter **by construction** — there is
no allowlisted carve-out granting it that status. `core-has-no-adapter-deps` is satisfied
structurally.

*Direction (b) — the adapter's own dependency on core.* Decision **G1** (`research.md` R7) has
the adapter depend on `@adrkit/core` for canonicalization primitives. R7 recorded this as
"undesirable but permitted." Principle III's own text describes adapters as packages that "live
under `packages/adapters/*`, **depend on the core**, and are permitted to break on upstream
churn" — so G1 is the Principle's expected shape, not a concession. The residual concern is
versioning legibility, and it is handled by an explicit `"//versioning"` note following the
precedent already carried in `packages/adapters/spec-kit/package.json`.

*Direction (c) — an apparent tension worth naming.* Principle III says adapter "discovery is by
runtime configuration." ADR-0013 and FR-002 forbid a dynamic loader outright; the generator is
invoked directly by name. Where the Constitution and an accepted ADR differ, the Constitution's
own precedence rule gives it to the ADR. This is recorded as a resolved precedence question, not
as a violation, and not as something to quietly ignore.

The `isolated` linker in `bunfig.toml` is not changed by this feature.

### Principle IV — Deterministic Before Probabilistic

**PASS.**

The generator is wholly deterministic: no model, no heuristic, no clock in the derivation path.
The envelope's field list (`data-model.md` §9) contains no temporal field, which is what makes
FR-042's byte-identical repeat runs achievable rather than aspirational. The only timestamps in
this feature are on *evidence* artifacts (`FrozenExpectationSet.frozenAt`,
`AcceptCorpusFreeze.auditRecord.auditedAt`), which are records about the work, not outputs of it.

`packages/core/src/affects/**` is untouched (FR-004), so the existing `resolution-is-pure`
assertion stays green unchanged.

One subtlety worth stating because it looks like a conflict and is not: Principle IV requires
that "a matcher whose backing source is missing resolves to inert with an informational finding —
never a fatal error," while this feature is aggressively fail-closed. These are different
subjects. Fail-closed governs the **generator**; inert-on-missing governs core's **`affects`
resolver**. When the consumer rejects an envelope, core sees a matcher with an absent backing
source and behaves exactly as before. Neither rule is bent.

### Principle V — The Schema Is the Contract

**PASS.**

No change to `packages/core/src/schema/adr.schema.ts` or to `schema/adr.schema.json` (FR-004,
FR-005). The `schema-emit-matches` check is unaffected because nothing is emitted differently.

Naming the misreading in advance: the two packages each declare the envelope's shape
independently (`data-model.md` cross-cutting table, and `contracts/package-boundary.md` §5). That
is a deliberate duplication and it is **not** a Principle V violation, because Principle V is
scoped to the typed *frontmatter* schema — the ADR record contract. The envelope is explicitly a
separate artifact that never joins that schema. The duplication is what makes the consumer's
structural validation a real check instead of a tautology; a shared type module would be an
import edge, and the import edge is exactly what FR-044 forbids.

### Pre-design verdict

**No violations.** Proceed to design.

---

## Project Structure

### Documentation (this feature)

```text
specs/010-catalog-backstage/
├── spec.md                      # committed; frozen for this phase
├── plan.md                      # this file
├── research.md                  # R1–R14; frozen
├── data-model.md                # §1–§17; frozen
├── quickstart.md                # validation/run guide
├── checklists/
│   └── requirements.md          # frozen
├── contracts/
│   ├── README.md                # the register: adopted / delta / excluded / new
│   ├── atomic-fail-closed.md    # delta D1: fourteen → fifteen
│   ├── admissibility.md         # new (ADR-0015 postdates spike 009)
│   └── package-boundary.md      # new (spike 009 built no packages)
└── evidence/                    # created in Phase B; tracked, hash-checked
    ├── frozen-expectations/     # FrozenExpectationSet (data-model.md §16)
    └── accept-corpus-freeze/    # AcceptCorpusFreeze (data-model.md §17)
```

Five spike-009 contracts are **carried forward by reference, not copied**: `glob-dialect.md`,
`owned-paths-annotation.md`, `entity-identity.md`, `input-manifest.md`, and
`snapshot-envelope.md`, all under `specs/009-catalog-binding-viability/contracts/` (that
directory holds exactly 11 files, counted in this worktree). `contracts/README.md` §2 is the
register of what is adopted unchanged, adopted with delta, and excluded. Two further spike
sections remain relevant and are cited from their original locations rather than restated:
`scale-and-security-measurement.md` §5 (network denial) and `input-manifest.md` §3.1 (the
standalone scratch repository requirement).

The `evidence/` placement is a decision made by this plan. Its authority is `research.md` R5
mechanism 2, which requires CI to re-derive the freeze hashes — which requires the artifacts to
be tracked — together with ADR-0015 Condition of Acceptance 1, which identifies untracked scratch
evidence as the hazard being corrected. No prior document fixes the path; this one does.

### Source code (repository root)

```text
packages/
├── adapters/
│   ├── spec-kit/                     # existing; unchanged
│   └── catalog-backstage/            # NEW — the offline generator (adapter)
│       ├── package.json              # independent versioning + "//versioning" note (ADR-0007)
│       └── src/
│           ├── manifest/             # manifest schema, two-stage path validation, digests
│           ├── repository/           # git identity + revision, exact string equality
│           ├── descriptor/           # parseDocument reader; uniqueKeys default true
│           ├── admissibility/        # ADR-0015's four field validators
│           ├── identity/             # two-step canonicalization
│           ├── ownership/            # annotation decode; three ownership states
│           ├── glob/                 # fifteen ordered rules; compile once per run
│           ├── envelope/             # assembly + digest via @adrkit/core (G1)
│           └── failure/              # the fifteen fatal trigger classes
└── catalog-envelope/                 # NEW — the consumer (NOT an adapter)
    ├── package.json
    └── src/
        ├── validate/                 # five ordered validation steps
        ├── digest/                   # recomputation; integrity-scoped claims only
        ├── identity/                 # staleness (exact inequality) + repository isolation
        └── snapshot/                 # CatalogSnapshot-shaped derivation

scripts/check-deps.ts                 # MODIFIED — allowlist entries for both new packages
.github/workflows/ci.yml              # MODIFIED — freeze-hash drift check; clause-8 gate
```

Root `package.json` `workspaces` is `["packages/*", "packages/adapters/*"]`, which already
matches both new paths. **It is not changed.** A change there would be evidence the placement is
wrong.

### Structure decision

Two packages, no edge between them, the envelope file on disk as the entire interface.

The generator is an adapter because its semver contract is with the pinned Backstage predicate
surface and it is permitted to break on upstream churn (ADR-0007). The consumer is not an
adapter, because a package outside `packages/adapters/**` is the only kind of package that core
or the CLI could ever be permitted to depend on later — and Principle III explicitly allows core
and CLI to depend on "their own workspace packages." That future is left open by placement and
is **out of scope here**: wiring the consumer into `@adrkit/cli` would require amending
`allowedDependenciesFor('@adrkit/cli')`, currently exactly `{'@adrkit/core', '@adrkit/evaluator'}`
(`scripts/check-deps.ts:107–115`). Do not amend it under this feature.

Both packages need explicit `allowedDependenciesFor()` entries, and this is not optional
housekeeping: the function returns `undefined` for any package it has no entry for
(`scripts/check-deps.ts:151`), and the allowed-surface guard is then skipped entirely. A package
with no entry is **silently unconstrained** and passes `check:deps` regardless of what it
declares. Full detail in `contracts/package-boundary.md` §4.

### Post-design Constitution re-check

Re-evaluated against the structure above. **No violations.**

- Principle I — unchanged; the `evidence/` decision strengthens it.
- Principle II — unchanged; both new package paths are covered by existing globs, so the clean
  clone job needs no edit. The two CI edits listed are the freeze-drift check and the clause-8
  gate, neither of which weakens the clean-clone posture.
- Principle III — the structure makes the consumer a non-adapter by location and gives the
  adapter exactly the core dependency Principle III describes. Strengthened, not strained.
- Principle IV — the module split keeps every derivation unit pure; the only impure edges are
  the manifest/descriptor reads and the git-identity subprocess, both confined to
  `manifest/` and `repository/`.
- Principle V — no schema file is touched. The deliberate two-sided envelope declaration is
  restated above as a non-violation.

---

## Barrier B — the pre-output barrier

This is the organizing constraint of the build. It comes from ADR-0020 clause 6 and is defined
in `research.md` R4 and R5. It is restated here because a phase sequence that does not carry it
is not a plan for this feature.

### What counts as generator output

Per R4, **generator output** is:

> a `SnapshotEnvelope` written or returned by the assembled generator, **or** any
> derived-ownership result computed for a descriptor-sourced entity — whether persisted, held in
> memory, or asserted in a test.

The "held in memory, or asserted in a test" clause is the whole point. An in-memory ownership
derivation that is never written to disk is still generator output. So is one that exists only
inside a test assertion.

### R4's reviewer-applicable distinguishing test

> **Where does this test's expected value come from?**
> If it comes from a contract frozen in `specs/` or `docs/adr/`, the work is barrier-free.
> If it comes from — or could be silently adjusted to match — the oracle expectation set or the
> clause-5 accept-corpus expected paths, it is behind the barrier.

The second limb matters more than the first. A test whose expected value *could be quietly
edited* to match whatever the generator produced is behind the barrier even if today it happens
to be hand-written, because the barrier exists to make that edit impossible rather than merely
discouraged.

### Where the definition and the distinguishing test diverge, and how this plan resolves it

They do diverge, at exactly one place: a whole-operation atomicity test over a mixed batch
(several valid entities plus one triggering entity). Its expected value — *exit non-zero, no
envelope* — comes from `contracts/atomic-fail-closed.md`, a frozen contract, so the
distinguishing test would call it barrier-free. But running it may compute in-memory ownership
for the valid entities before the abort, which the **definition** catches.

**This plan takes the definition, and places all assembled-generator work behind the barrier
(Phase E).** The cost is low, because Barrier B is early and cheap relative to Phase E. No part
of this plan relies on the distinguishing test to release assembly work early.

### The three enforcement mechanisms (R5)

All three are required. None is sufficient alone.

1. **Input absence.** No manifest ⇒ no corpus ⇒ no output. This is backed by
   `input-manifest.md` §5, which forbids recursive walking and glob-based input discovery. The
   generator physically cannot find a corpus to run against; there is nothing to *remember* not
   to do.
2. **Hash match.** Each freeze records its own hashes; CI re-derives them and fails on drift.
   This is what stops a frozen expectation from being edited after output exists. It requires the
   freeze artifacts to be tracked in git, which is why they live under
   `specs/010-catalog-backstage/evidence/`.
3. **Ordering of the comparison harness.** The harness that reads both generator output *and*
   the frozen expectations is written **after** the freeze and its audit — never before.
   ADR-0020 clause 5 requires two distinct steps, each recording its own hashes and its own
   PASS/FAIL. A harness authored first collapses them into one step, and the second step's
   PASS then inherits from the first instead of standing alone.

### The clause-6 reach question, resolved

**Resolved 2026-08-04 by maintainer decision: the narrower reading applies.** ADR-0020 clause
6's bar on "generator output" does **not** reach unit-level execution of the adapter's pure
validators — glob dialect, annotation decode, admissibility, identity canonicalization —
against hand-authored fixtures whose expected values come from contracts frozen in `specs/` or
`docs/adr/`. It reaches the assembled generator's output.

The reason the narrower reading is safe, stated so a reviewer can check it: clause 6 exists to
prevent **backfilling** — adjusting a frozen expectation to match output already seen. That
control has no purchase on a test whose expected value the oracle never sourced. R4's
distinguishing test is the operative rule:

> *Where does this test's expected value come from?* If it comes from a contract frozen in
> `specs/` or `docs/adr/`, the work is barrier-free. If it comes from — or could be silently
> adjusted to match — the oracle expectation set or the clause-5 accept-corpus expected paths,
> it is behind the barrier.

Two limits travel with this decision and are **not** relaxed by it. Where R4's definition and
its distinguishing test disagree — a whole-operation atomicity test over a mixed batch, whose
expected value is contract-sourced but which may compute in-memory ownership before aborting —
**this plan takes the definition**, and all assembled-generator work stays behind the barrier.
And the decision changes only Phase D's barrier side; every other phase, and all three of R5's
enforcement mechanisms, are unaffected.

Consequence for scheduling: Phase D is barrier-free, so the adopted sequence is
`[A ∥ B] → [C ∥ D] → E → F → G`.

---

## Phased build sequence

Seven phases, in dependency order. Each states its side of Barrier B and the requirements and
success criteria it discharges.

### Phase A — Workspace placement and dependency-boundary enforcement

**Barrier side: BEFORE.** Barrier-free under both readings of clause 6. No generator exists, no
descriptor is read, no ownership is derived.

Create both package skeletons at the paths in the Project Structure section; add explicit
`allowedDependenciesFor()` entries for both (`contracts/package-boundary.md` §2); record the
adapter's `"//versioning"` note; write package READMEs carrying rung-1 language and no forbidden
synonym.

**Discharges**: FR-001, FR-002, FR-003, FR-005, FR-044 *(placement and direction half)*, FR-051,
FR-062, FR-063 · SC-015, SC-017.

**Depends on**: nothing.

### Phase B — Barrier B: fresh T014 → T014a cycle and clause-5 accept-corpus freeze

**Barrier side: THIS PHASE IS THE BARRIER.**

Re-run the T014 → T014a oracle cycle from scratch — spike 009's oracle carries a known-wrong
expected result and cannot be reused (`research.md` R9, ADR-0012 gate 3). Produce the corrected
`FrozenExpectationSet` (`data-model.md` §16) with `derivedPathPatterns` in `compareCodeUnits`-
sorted order and its own content hash. Freeze the accept corpus, its maintainer-authored
`adrkit.io/owned-paths` overlay, its expected path matches, and its selection basis and size
**in the same cycle** (`data-model.md` §17). Obtain an independent audit by a reviewer with no
authoring involvement, who recomputes and matches the hashes and records an **explicit adequacy
finding** — an audit that passes on integrity without reaching adequacy is a FAIL (SC-010). Add
the CI hash-drift check (mechanism 2).

**Discharges**: FR-053, FR-054, FR-055, FR-057 *(step (a) half)* · SC-010.

**Depends on**: nothing. It touches `specs/` and CI only, never `packages/**`.

Note on FR-055: the freeze records the corpus's selection basis and size as *facts about the
frozen corpus*. It does **not** set a production limit. Nothing here may be read as ratifying a
scale bound.

### Phase C — Consumer package `@adrkit/catalog-envelope`

**Barrier side: BEFORE.** Barrier-free under **both** readings. The stricter reading concerns
code under `packages/adapters/catalog-backstage/`; this package is not there. Its fixtures are
hand-authored envelopes, so nothing it processes is a descriptor-sourced entity, and its expected
values come from `snapshot-envelope.md` — a contract frozen in `specs/`.

Implement the five ordered validation steps, digest recomputation, staleness as **exact
inequality** of revision (never an ordering comparison), repository isolation, and
`CatalogSnapshot`-shaped derivation gated behind all five steps passing. Fixtures: a malformed
envelope for each step, a mutated-payload envelope, a stale envelope, a foreign-repository
envelope, and a valid one.

**Discharges**: FR-004, FR-005, FR-041, FR-044 *(behavioural half)*, FR-045, FR-046, FR-047,
FR-048, FR-049, FR-058 · SC-012 *(the integrity-is-not-correctness framing)*, SC-014.

**Depends on**: Phase A.

### Phase D — The adapter's pure validators

**Barrier side: BEFORE.** Settled by the maintainer's 2026-08-04 adoption of the narrower
reading of clause 6 (see "The clause-6 reach question, resolved" above). Had the stricter
reading been taken, this phase — and only this phase — would sit behind Barrier B.

*D1, per-descriptor validators*: descriptor reading via `parseDocument` with `uniqueKeys` left at
its default (`duplicate-yaml-key` and `invalid-yaml-syntax` are two **distinct** trigger classes);
the four admissibility validators and the separator rule; two-step canonicalization; annotation
decode in its fixed order, with step 2 checking the annotation node as a YAML **string scalar on
the raw node before** `JSON.parse` — because `JSON.parse` coerces via `ToString`, and the YAML
sequence `["[]"]` would otherwise stringify to `"[]"`, parse as an empty array, and be
misclassified `explicit-empty`; the three ownership states kept distinct, with `explicit-empty`
decided on the **decoded value** (`'[]'`, `'[ ]'`, `'[\n]'` all qualify) and never by raw-string
equality; the glob dialect's fifteen ordered rules, first-match-wins, each accepted pattern
compiled exactly once per derivation run.

*D2, input-boundary validators*: manifest schema and version/capability rejection; the two-stage
path validation (lexical, then realpath confinement); per-source digest verification; repository
identity as exact string equality on both identity and revision.

**Discharges**: FR-006 through FR-013, FR-015 through FR-022, FR-025 through FR-033 · SC-004,
SC-005, SC-006, SC-007, SC-008.

**Depends on**: Phase A. Under the stricter reading, also Phase B.

Two counting constraints bind this phase. The glob dialect has **fifteen** ordered rules, but
SC-007 requires only rules **1–14** to be exercised: rule 15's `invalid-glob-compile-failure` is
a defensive backstop described in `glob-dialect.md` §3 (lines 33–74, counted in this worktree) as
"expected to never occur in practice, given rules 1–14's exhaustiveness." Its non-occurrence is
conformant and MUST NOT be reported as a coverage gap. Fifteen rules is not fourteen required
exercises, and neither number is the trigger count.

Research R4 names four validators in its open question; D2's input-boundary validators are
included in the same phase on the same reasoning, so that under the stricter reading the whole
phase moves together and the barrier-free residue is exactly Phases A and C — as R4 states.

### Phase E — Assembled generator: pipeline, atomicity, envelope emission

**Barrier side: BEHIND.** Strictly after Phase B clears. This is where the definition of
generator output binds, including the in-memory case (see the divergence note above).

Compose the Phase D units into the generator; enforce whole-operation atomicity across all
**fifteen** trigger classes with exactly one class recorded per abort and `other-invalid-input`
retained as a deliberate always-present backstop; assemble and emit the envelope with its
`digest` computed via `@adrkit/core`'s `canonicalStringify` (never the same-named function at
`packages/evaluator/src/report/serialize.ts:38`, which is a different function with a different
signature); enforce envelope-only output; record `allRefs` and the provenance boundary between
upstream-authored descriptor content and maintainer-authored overlay.

**Discharges**: FR-014, FR-023, FR-024, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040,
FR-042, FR-043 · SC-001, SC-002, SC-003, SC-009, SC-013.

**Depends on**: Phases A, B, D.

Every digest claim emitted from this phase carries the scope qualification from
`contracts/package-boundary.md` §2.2: for the envelope's closed scalar domain the bytes are
*equivalent to* RFC 8785 / JCS output, and no document claims `canonicalStringify` is a
general-purpose RFC 8785 implementation.

`[NEEDS CLARIFICATION: whether allRefs is populated beyond canonicalId in production.
research.md R12, spec.md line 1275, and data-model.md §5 line 190 all record this as undecided.
The consequence is that it is unknown whether duplicate-canonical-ref is reachable outside
synthetic fixtures — so SC-003's requirement that every trigger class be observed failing may,
for that one class, be satisfiable only synthetically.]`

### Phase F — Clause-5 step (b): post-output comparison at zero FP / zero FN

**Barrier side: BEHIND**, and written **after** Phase B's freeze and audit — mechanism 3.

Author the comparison harness; diff derived ownership for **every** annotated entity in the frozen
accept corpus against the frozen expectations; require zero false positives and zero false
negatives. Any mismatch fails the gate. **The expectations are never amended to fit the output.**
This step records its own hashes and its own PASS/FAIL, inherited from nothing.

**Discharges**: FR-056, FR-057 *(step (b) half)*, FR-058, FR-063 · SC-011, SC-012.

**Depends on**: Phases B and E.

A pass here is a **possible outcome** for ADR-0012 gate 3, never a claim made in advance. Gate 3
is open today because the oracle carries a known-wrong expected result (R9); Phase B addresses
that directly, and Phase F is where it would be demonstrated — or not.

### Phase G — Clean clone, offline enforcement, and the clause-8 executable CI gate

**Barrier side: BEHIND.** It requires a real generator invocation.

Demonstrate a clean clone building, typechecking, linting, and testing green with both new
packages present; demonstrate a generator run with network access **actively denied**, no
credential, and no service; run the cross-package end-to-end — a generator-written envelope
validated by the consumer; add the ADR-0020 clause 8 executable CI gate tied to clause 5, and
observe it failing before observing it pass.

**Discharges**: FR-050, FR-052, FR-059 *(repository-wide close-out)*, FR-060, FR-061 · SC-016.

**Depends on**: Phases C, E, F.

The clause-8 gate must be a **real CI check**. ADR-0020's own frontmatter assertion is currently
**inert** — `engine: custom` resolves to an optional registry port, no port is registered, and
the result is `status: 'inert'` with `reason: 'assertions-compile.engine-absent'` (R8). Citing
that assertion as enforcement would be wrong. Only a check observed failing counts.

ADR-0012 gate 4 remains **unmet and not yet testable** after this phase. Its clean-clone, offline,
and adapter-boundary components are producible here; its release component is not.

`[NEEDS CLARIFICATION: what the "release evidence" component of ADR-0012 gate 4 requires, given
ADR-0020 clause 9 defers release entirely. research.md R9 line 427 and spec.md line 1290 record
the gap at the ADR level; neither resolves it.]`

---

## Where each ADR-0016 observed-failing-first check sits

Per `research.md` R8, every check lands by three moves: construct the input that should fail, run
it and **observe the failure** recording the exact reason string, then correct the input and
observe the pass. A check only ever observed passing has not been shown to be wired in.

| Phase | Checks whose failing observation lands here |
| --- | --- |
| A | Adapter isolation: a deliberately introduced non-adapter → adapter dependency observed producing `non-adapter workspace depends on an adapter package` (SC-015). The reverse edge observed producing the allowed-public-surface violation. **And** confirmation that each new package actually has an allowlist entry — because a package with none is silently unconstrained (`scripts/check-deps.ts:151`), so a green `check:deps` there is not evidence of anything. |
| B | Freeze-hash drift: mutate a frozen artifact, observe CI fail, restore, observe pass. Audit FAIL: an oracle whose `derivedPathPatterns` are in input order rather than `compareCodeUnits` order must be observed producing an audit FAIL. An integrity-only audit that never reaches adequacy must likewise be observed as FAIL. |
| C | Each of the five ordered consumer validation steps, individually. Digest mismatch on a mutated payload. Staleness on an exact revision inequality. A foreign-repository envelope refused. Derivation attempted before validation completes, refused. |
| D | Each of glob rules **1–14** (rule 15 is exempt — see Phase D). Each annotation decode step, including the step-2 coercion case where `["[]"]` must **not** be classified `explicit-empty`. Each of the four admissibility validators, separately attributed. A descriptor that is **inadmissible and canonically unique**, observed producing `inadmissible-descriptor` and **not** `duplicate-canonical-id` (FR-021). Manifest version and capability rejections. Both stages of path validation. Repository identity mismatch. |
| E | Each of the **fifteen** fatal trigger classes driven through the full pipeline (SC-003). Whole-operation atomicity: one triggering entity in a batch of otherwise-valid entities produces no envelope, not even a partial one (SC-002). Byte-identical output across three or more runs (SC-001). |
| F | The comparison itself observed failing: introduce a deliberate mismatch between derived ownership and the frozen expectations, observe the gate fail, remove it, observe the gate pass. |
| G | The clause-8 CI gate observed failing before it is observed passing (FR-060). Network denial observed as a *denial*, not as an absence of calls (SC-016). |

Two placement constraints shape this table. A check whose failing observation requires generator
output over a corpus is **behind** Barrier B by construction. A check producible from a
hand-authored fixture is not — subject to the open question on Phase D.

One construction constraint applies to Phase D's repository-mismatch fixture: a `git worktree add`
linked worktree **shares remote configuration with its parent**, so the fixture requires a
standalone scratch `git init` repository and can never be a worktree of `mbeacom/adrkit`
(`input-manifest.md` §3.1; R10). This applies to the current worktree, which is exactly such a
linked worktree.

---

## Parallelization verdict

Stated plainly, because this will be used to decide real concurrent dispatch. Where the
dependency argument is not airtight, the verdict is serial.

| Pair or phase | Verdict | Reason |
| --- | --- | --- |
| **A ∥ B** | **CONCURRENT** | Disjoint file sets with no read-write overlap. A touches `packages/**` and `scripts/check-deps.ts`; B touches `specs/010-catalog-backstage/evidence/` and adds one CI check. Neither consumes the other's output. B is the barrier, so starting it as early as possible is strictly good. |
| **C ∥ D** | **CONCURRENT** | FR-044 makes the two packages' source trees disjoint *by construction* and forbids an import edge in either direction, so there is no shared file and no build-order coupling. Both depend only on Phase A. This pairing depends on the narrower reading of clause 6, which the maintainer adopted on 2026-08-04; under the stricter reading it would have dissolved. |
| **B ∥ C** | **CONCURRENT** | Holds under **both** readings, and is the fallback if the stricter reading is taken. Phase C is outside `packages/adapters/**` and its expected values come from `snapshot-envelope.md`, so no reading of clause 6 reaches it. Disjoint file sets. |
| **E** | **STRICTLY SERIAL** | Three independent reasons, any one sufficient. It requires A, B, and D complete. It is the first phase that produces generator output under R4's definition, including the in-memory case, so it cannot begin before Barrier B clears. And its atomicity work touches every module Phase D produced, so concurrent edits would collide throughout. |
| **F** | **STRICTLY SERIAL, after E** | R5 mechanism 3 is a *sequencing* requirement, not a dependency: the comparison harness must be authored after the freeze and its audit. Writing it concurrently with B or E collapses ADR-0020 clause 5's two distinct steps into one, and step (b)'s PASS would then inherit from step (a) instead of standing alone. This is the phase where running early does active harm rather than merely risking it. |
| **G** | **SERIAL, after F** | It needs C and E to exist to run the end-to-end at all, and the clause-8 gate it installs is a gate *on clause 5* — which is Phase F. A gate whose subject does not yet exist cannot be observed failing for the right reason. Its clean-clone and network-denial components technically need only E, so a maintainer may split those out; **this plan does not assume that split**, and the verdict stands as serial. |

### The verdict in sequence form

The adopted sequence, following the maintainer's 2026-08-04 clause-6 decision:

```text
[ A ∥ B ]  →  [ C ∥ D ]  →  E  →  F  →  G
```

Recorded as a counterfactual, because it is the thing that would change if that decision were
ever revisited — under the stricter reading of clause 6:

```text
[ A ∥ B ]  →  [ B ∥ C ]  →  D  →  E  →  F  →  G
```

— that is, the parallel envelope would shrink to **Phases A and C**, exactly as `research.md` R4
states. Nothing else in the sequence would change. The plan is deliberately structured so that
the reading costs concurrency and nothing else; no phase's *content* depends on which reading is
taken.

### Anti-verdicts, stated so they are not inferred

- **Nothing may run concurrently with Phase E** — not F, not G, not a late slice of D.
- **Phase F may not be started early "so it is ready."** Authoring it early is the specific harm
  mechanism 3 exists to prevent.
- **Phase B may not be split** into "freeze now, audit later." SC-010 requires the corpus, its
  overlay, its expected matches, and its selection basis and size to be frozen **in the same
  cycle**, with the audit recording its own hashes and its own PASS/FAIL.

---

## Carried unknowns

Two `[NEEDS CLARIFICATION]` markers are carried forward unresolved. Each is a gap at the **ADR
level**, not a drafting omission, and each is recorded at the point where the normative records
stop short. This plan does not resolve either of them, and resolving one is not a prerequisite for
starting.

1. **`allRefs` population beyond `canonicalId`** — `research.md` R12, `spec.md:1275`,
   `data-model.md` §5 line 190. Stated at Phase E. Consequence: reachability of
   `duplicate-canonical-ref` outside synthetic fixtures is unknown.
2. **ADR-0012 gate 4's "release evidence" component** — `research.md` R9 line 427,
   `spec.md:1290`. Stated at Phase G. Consequence: gate 4 stays not-yet-testable regardless of
   how well this feature goes.

A third — **ADR-0020 clause 6's reach into unit-level validator execution** (`research.md` R4
line 219) — was **resolved on 2026-08-04 by maintainer decision** in favour of the narrower
reading. See "The clause-6 reach question, resolved" in the Barrier B section. `research.md` R4
retains the original open marker as the historical record of what was undecided when the
research ran; this plan is where the decision is recorded. Consequence: Phase D is barrier-free
and the adopted sequence is `[A ∥ B] → [C ∥ D] → E → F → G`.

---

## Complexity Tracking

**No Constitution violations. This table is empty by design, not by omission.**

Two aspects of the design resemble violations closely enough that a reviewer will reach for this
section; both were evaluated in the Constitution Check and neither is one:

| Apparent violation | Why it is not one |
| --- | --- |
| The adapter depends on `@adrkit/core` (decision G1) | Principle III describes adapters as packages that "live under `packages/adapters/*`, **depend on the core**, and are permitted to break on upstream churn." G1 is the Principle's expected shape. The independent-versioning concern raised by `research.md` R7 is real but is a documentation obligation, discharged by the `"//versioning"` note precedent in `packages/adapters/spec-kit/package.json` — not a Constitution violation. |
| Both packages declare the envelope's shape independently | Principle V is scoped to the typed frontmatter schema; the envelope is explicitly a separate artifact that never joins it (FR-005). The duplication is load-bearing: a shared type module would be an import edge, which FR-044 forbids, and would make the consumer's structural validation a tautology rather than a check. |

If either is later judged a genuine violation, the remedy is a change to the design, not an entry
justifying it here.
