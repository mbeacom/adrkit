# Tasks: Production Backstage Catalog Adapter

**Feature**: `010-catalog-backstage`
**Feature directory**: `specs/010-catalog-backstage/`
**Input documents** (all frozen; read, obeyed, never edited by any task below):
`spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/README.md`, `contracts/atomic-fail-closed.md`, `contracts/admissibility.md`,
`contracts/package-boundary.md`, `checklists/requirements.md`, `quickstart.md`

**Adopted contracts inherited unchanged or with delta from spike 009**
(`specs/009-catalog-binding-viability/contracts/`, per `contracts/README.md` §2):
`glob-dialect.md`, `owned-paths-annotation.md`, `snapshot-envelope.md`,
`input-manifest.md`, `entity-identity.md`.

**Normative governance**: ADR-0007 (versioning), ADR-0010 (`bun test` only),
ADR-0012 (gates), ADR-0013, ADR-0014 (evidence rungs), ADR-0015 (conditions of
acceptance), ADR-0016 (observed-failing-first), ADR-0020 (authorization of this
work), Constitution v1.0.2.

---

## Standing constraints — these bind every task in this document

1. **This feature has produced nothing.** No package exists. No generator has run.
   No envelope exists. No check has been observed failing. Every statement in this
   document is a *requirement*, never a *report*. No task may cite evidence that
   does not yet exist.

2. **ADR-0014 rung 1 only.** ADR-0020 authorizes the *work*, not the *release*.
   No task may schedule, imply, or prepare a release. No task may claim rung 2 or
   rung 3. Only corpus *data* may be described as third-party; never the validation.

3. **Honesty about warrant.** No task, test name, comment, or document may assert
   what *Backstage as a running system* does. The warrant available to this feature
   is exactly: what a pure validator predicate returns when invoked against
   descriptor content pinned at commit `1121a4facd9e321179d0402c3f355e4a649e84d9`.

4. **Toolchain.** Tests are `bun test` (ADR-0010). Never jest, vitest, npm, yarn,
   or pnpm. Typecheck is `bun run typecheck`. Dependency boundary is
   `bun run check:deps`.

5. **ADR-0016 is binding.** A check that has only ever been observed passing is not
   coverage. Every check-building task carries an explicit paired step that
   introduces a violation, observes the check fail *and records the exact reason
   string emitted*, then restores and observes the pass. These are never collapsed
   into "write the check" — the observation *is* the coverage (`research.md` R8).

6. **ADR-0020's own frontmatter assertion is inert.**
   (`engine: custom` → optional registry port → none registered → `status: 'inert'`,
   `reason: 'assertions-compile.engine-absent'`.) No task may cite it as enforcement.
   The clause-8 gate must be a real CI check, observed failing before observed passing.

7. **Generating this task list marks no task complete and performs no
   implementation.** Every checkbox below is unchecked and stays unchecked until
   the corresponding work is actually done and observed.

---

## Barrier B — the organizing constraint

ADR-0020 clause 6 and clause 5(a), plus ADR-0012 gate 3, require that the fresh
T014 → T014a oracle cycle **and** the clause-5 accept-corpus freeze/audit — overlay,
expected paths, recorded selection basis and size, and an explicit adequacy finding —
all complete **before any generator-derived output exists**.

### What counts as generator output (`research.md` R4)

A `SnapshotEnvelope` written or returned by the assembled generator, **or** any
derived-ownership result computed for a descriptor-sourced entity — whether
persisted, held in memory, or asserted in a test.

### The distinguishing test (`research.md` R4)

> *Where does this test's expected value come from?*

- Expected value comes from a contract frozen in `specs/` or `docs/adr/` → **barrier-free**.
- Expected value is sourced from — or could be silently adjusted to match — the
  oracle expectation set or the clause-5 expected paths → **behind the barrier**.

Where the definition and the distinguishing test diverge (whole-operation atomicity
over a mixed batch), `plan.md` takes **the definition**: all assembled-generator work
sits behind the barrier, in Phase E.

### Three enforcement mechanisms (`research.md` R5) — all required, none sufficient alone

| # | Mechanism | How this task list enforces it |
|---|---|---|
| 1 | **Input absence** — no manifest in the tree ⇒ no corpus ⇒ no output. Backed by `input-manifest.md` §5's ban on recursive walking and glob discovery. | T024 confirms no manifest exists anywhere in the tree before Phase E may begin. |
| 2 | **Hash match** — CI re-derives the freeze hashes and fails on drift. This is why the freeze artifacts must be git-tracked under `specs/010-catalog-backstage/evidence/`. | T022 builds the drift check; T023 observes it failing; T091 re-verifies the hashes are unchanged across all of E and F. |
| 3 | **Ordering** — the comparison harness is authored strictly *after* freeze and audit. | T024 confirms no comparison harness exists anywhere; T087 authors it and records that it did not exist before T024. |

### Phase → barrier side (preserved exactly from `plan.md`)

| Phase | Scope | Barrier side | Depends on |
|---|---|---|---|
| **A** | Workspace placement + dependency-boundary enforcement | **BEFORE** | — |
| **B** | Barrier B itself: fresh T014→T014a cycle + accept-corpus freeze/audit | **IS THE BARRIER** | — |
| **C** | Consumer package `@adrkit/catalog-envelope` | **BEFORE** | A |
| **D** | Adapter pure validators | **BEFORE** *(settled 2026-08-04 by maintainer decision in favour of the narrower clause-6 reading)* | A |
| **E** | Assembled generator: pipeline, atomicity, envelope | **BEHIND** | A, B, D |
| **F** | Clause-5 step (b): post-output comparison | **BEHIND** | B, E |
| **G** | Clean clone, offline, clause-8 CI gate | **BEHIND** | C, E, F |

**T024 is the hard gate.** Every task in phases E, F, and G lists `T024` in its
`Depends` line. The dependency graph — not prose — is what makes it mechanically
impossible to start behind-barrier work early.

---

## Task format

```
- [ ] T001 [P] [US1] Description naming the exact file(s) created or modified
      Barrier: BEFORE | IS THE BARRIER | BEHIND
      Discharges: FR-xxx, SC-xxx  (or: none — supports FR-xxx)
      Depends: T000, T000  (or: none)
      Contract: <contract file> §<section>   (omitted when no contract applies)
```

- **`[P]`** appears **only** where tasks touch disjoint files, share no state, and
  have no ordering dependency on one another. Where there is any doubt, the task is
  serial. 20 of 100 tasks carry `[P]`.
- **Story labels.** Per `.specify/templates/tasks-template.md`, setup and
  foundational scaffolding carries no story label. Applied here: Phase A's
  pure-scaffolding tasks are unlabeled; Phase A tasks that directly serve a US9
  acceptance scenario carry `[US9]`; all tasks in phases B–G carry their story label.
- **Discharges** names the FRs and SCs the task closes. Where `plan.md` assigns one
  identifier to two phases, the task states *which named half* it discharges, and the
  coverage table lists both task IDs. See "Coverage" below — this is stated plainly
  rather than forced into a fabricated 1:1.

### Path conventions

| Alias | Path |
|---|---|
| `<ADAPTER>` | `packages/adapters/catalog-backstage/` |
| `<CONSUMER>` | `packages/catalog-envelope/` |
| `<EVIDENCE>` | `specs/010-catalog-backstage/evidence/` |

Root-level checks follow the existing repository convention: implementation in
`scripts/<name>.ts`, test alongside at `scripts/<name>.test.ts` (six such pairs
already exist, e.g. `scripts/check-deps.test.ts`).

---

## Phase A — Workspace placement and dependency-boundary enforcement

**Barrier side: BEFORE.** No task in this phase reads a descriptor, computes an
ownership result, or produces an envelope. Phase A may run concurrently with Phase B.

- [X] T001 [P] Create the adapter package skeleton at `<ADAPTER>` — `package.json`
      (name `@adrkit/catalog-backstage`, `type: module`, `publishConfig.access: public`,
      and the `"//versioning"` note citing ADR-0007 and `ReleaseVersioning` in
      `scripts/release-pack.ts`, following the `packages/adapters/spec-kit/` precedent),
      `tsconfig.json`, `src/index.ts`, `LICENSE`, `NOTICE`.
      Barrier: BEFORE
      Discharges: FR-001
      Depends: none
      Contract: `package-boundary.md` §2, §6

- [X] T002 [P] Create the consumer package skeleton at `<CONSUMER>` — `package.json`
      (name `@adrkit/catalog-envelope` — working name, `type: module`),
      `tsconfig.json`, `src/index.ts`. This package is **not** under
      `packages/adapters/` and must not be.
      Barrier: BEFORE
      Discharges: FR-044 (placement half)
      Depends: none
      Contract: `package-boundary.md` §3

- [X] T003 Confirm both packages are picked up by the existing root `workspaces`
      globs `["packages/*", "packages/adapters/*"]` (root `package.json` lines 18–21)
      **without modifying them** — a needed change to those globs is a signal that
      placement is wrong. Declare the Node target in each package's `engines` field;
      the existing `node-smoke-built-artifacts` CI job then covers it.
      Files: `<ADAPTER>/package.json`, `<CONSUMER>/package.json` (verify only:
      root `package.json`).
      Barrier: BEFORE
      Discharges: FR-051
      Depends: T001, T002

- [X] T004 [P] [US9] Write `<ADAPTER>/README.md` using ADR-0014 rung-1 language only,
      with no rung-2 or rung-3 synonyms, and carrying the FR-063 adoption statement:
      what a downstream consumer may and may not conclude from this adapter's output.
      Barrier: BEFORE
      Discharges: FR-062, FR-063 (documentation half), SC-017
      Depends: T001

- [X] T005 [P] Write `<CONSUMER>/README.md` under the same rung-1 honesty constraint,
      framing the package as an integrity validator and never as a correctness oracle.
      Barrier: BEFORE
      Discharges: none — supports SC-017
      Depends: T002

- [X] T006 [P] [US9] Add a structural assertion test proving the adapter is reachable
      only by explicit static import and registers no dynamic loader, plugin registry,
      or discovery hook.
      Files: `<ADAPTER>/test/no-dynamic-loader.test.ts`.
      Barrier: BEFORE
      Discharges: FR-002
      Depends: T001

- [X] T007 [P] Add a locality guard test asserting that neither new package writes to
      or regenerates `schema/`, and that the envelope shape each package needs is
      declared locally rather than in a shared schema module.
      Files: `<ADAPTER>/test/envelope-shape-locality.test.ts`.
      Barrier: BEFORE
      Discharges: FR-005 (locality half)
      Depends: T001, T002
      Contract: `package-boundary.md` §5

- [X] T008 Add explicit `allowedDependenciesFor()` entries for `@adrkit/catalog-backstage`
      (deps `@adrkit/core`, `picomatch`, `yaml`; devDeps `@types/bun`, `@types/picomatch`)
      and `@adrkit/catalog-envelope` (deps `@adrkit/core`; devDeps `@types/bun`).
      Do **not** amend the existing `@adrkit/cli` entry.
      Files: `scripts/check-deps.ts`.
      Barrier: BEFORE
      Discharges: FR-003
      Depends: T001, T002
      Contract: `package-boundary.md` §2, §4

- [X] T009 [US9] **Observed failing.** Introduce a dependency edge from `@adrkit/core`,
      then `@adrkit/cli`, then the `schema/` surface, onto the adapter; observe the
      isolation check fail in each case and record the exact emitted reason string;
      remove the edge; observe the pass. Retain the failing inputs as permanent
      negative cases.
      **The three surfaces are not observed by the same command, and the deposit MUST
      name which command produced each failure.** `core` and `cli` fail
      `bun run check:deps`. **`schema/` cannot**: it has no `package.json`, so
      `readWorkspacePackages()` never visits it and `check:deps` returns exit 0 — and no
      change to `check-deps.ts` fixes that without teaching it to scan sources rather
      than manifests. That clause is held instead by `bunfig.toml`'s isolated linker,
      observed via `bun run typecheck` failing with `TS2307: Cannot find module`.
      SC-015 is discharged because it requires "the **isolation check**" to fail, not
      `check:deps` specifically — but the deviation must be recorded, not smoothed over.
      This is `package-boundary.md` §4's trap one level up: there, a *package* with no
      allowlist entry is silently unconstrained; here, a *directory* with no manifest is
      invisible outright. Both fail in the direction of a check that cannot fail.
      Files: `scripts/check-deps.test.ts`, `<EVIDENCE>/negative-cases/dep-core-to-adapter/`.
      Barrier: BEFORE
      Discharges: SC-015
      Depends: T008

- [X] T010 [US9] **Observed failing.** Add `@adrkit/catalog-backstage` to the consumer's
      dependencies; run `bun run check:deps`; observe the guard at
      `scripts/check-deps.ts` emits `non-adapter workspace depends on an
      adapter package`; record the exact string; remove; observe the pass.
      Files: `scripts/check-deps.test.ts`, `<EVIDENCE>/negative-cases/dep-consumer-to-adapter/`.
      Barrier: BEFORE
      Discharges: FR-044 (direction half, i)
      Depends: T008, T009
      Contract: `package-boundary.md` §3

- [X] T011 [US9] **Observed failing.** Add `@adrkit/catalog-envelope` to the adapter's
      dependencies; run `bun run check:deps`; observe the guard at
      `scripts/check-deps.ts` emits `<name> declares a dependency outside its
      allowed public surface`; record the exact string; remove; observe the pass.
      Files: `scripts/check-deps.test.ts`, `<EVIDENCE>/negative-cases/dep-adapter-to-consumer/`.
      Barrier: BEFORE
      Discharges: FR-044 (direction half, ii)
      Depends: T008, T010
      Contract: `package-boundary.md` §3

- [X] T012 [US9] **Observed failing — closes the silent-unconstrained trap.**
      `allowedDependenciesFor()` returns `undefined` for any package with no entry
      (`allowedDependenciesFor()` returns `undefined`), and the allowed-surface guard is then skipped
      entirely — so a package with no entry passes `check:deps` no matter what it
      declares. The only proof T008's entries actually exist is to add a disallowed
      dependency to each new package and observe a violation. Do so for both packages
      independently; record both reason strings; remove; observe both passes.
      Files: `scripts/check-deps.test.ts`, `<EVIDENCE>/negative-cases/dep-allowlist-present/`.
      Barrier: BEFORE
      Discharges: none — supports FR-003, FR-044
      Depends: T008, T011
      Contract: `package-boundary.md` §4

> **T009–T012 are serial by construction.** All four mutate `scripts/check-deps.ts`
> and/or package dependency blocks and re-run the same command. They must not be
> marked `[P]` and must not be split across worktrees.

---

## Phase B — Barrier B itself: the fresh T014 → T014a cycle and the clause-5 freeze/audit

**Barrier side: IS THE BARRIER.** Every task in this phase carries `[US1]`.
**No task in Phase B is marked `[P]`, and Phase B may not be split
freeze-now/audit-later** — SC-010 requires the corpus, the overlay, the expected
matches, and the recorded selection basis and size to be frozen in the **same cycle**,
with the audit recording its own hashes and its own PASS/FAIL. Phase B may run
concurrently with Phase A and with nothing else.

- [X] T013 [US1] Create the tracked evidence tree — `<EVIDENCE>/README.md`,
      `<EVIDENCE>/frozen-expectations/`, `<EVIDENCE>/accept-corpus-freeze/`, and
      `<EVIDENCE>/negative-cases/`.
      **`negative-cases/` is a SHARED, CROSS-PHASE tree.** Roughly twenty tasks spanning
      phases A–G deposit into it, each owning its **own subdirectory** — which is what makes
      it safe for concurrent worktree sessions, since different subdirectories never collide
      on merge. Do not write an index of it: an enumeration goes stale on the next deposit,
      which is the exact failure ADR-0016 exists to prevent.
      These artifacts must be **git-tracked**: R5 mechanism 2 depends on CI being able
      to re-derive their hashes, and ADR-0015 Condition of Acceptance 1 requires them
      to be inspectable in the repository.
      Barrier: IS THE BARRIER
      Discharges: none — enables FR-053, FR-054, FR-055
      Depends: none

- [X] T014 [US1] **Record the accept-corpus selection basis and size before acting on
      it.** Write `<EVIDENCE>/accept-corpus-freeze/selection-basis.md` stating how the
      corpus was chosen and how large it is, and how the populations documented in
      `research.md` R14 were handled — specifically the invalid-`metadata.name`
      population and the unsubstituted-skeleton placeholder-collision population.
      Recording the basis *after* seeing which entities are convenient would defeat
      the purpose.
      Barrier: IS THE BARRIER
      Discharges: FR-055
      Depends: T013

- [X] T015 [US1] Author the maintainer-authored `adrkit.io/owned-paths` overlay at
      `<EVIDENCE>/accept-corpus-freeze/overlay.json`. This content is maintainer-authored,
      never upstream-authored, and the record must say so.
      Barrier: IS THE BARRIER
      Discharges: FR-054 (overlay half)
      Depends: T014

- [X] T016 [US1] Author the expected path matches per canonical id at
      `<EVIDENCE>/accept-corpus-freeze/expected-paths.json`. These are **hand-derived
      from the frozen contracts**, never produced by, checked against, or adjusted to
      match any generator — no generator exists at this point, and Phase E may not
      begin until T024.
      Barrier: IS THE BARRIER
      Discharges: FR-054 (expected-paths half)
      Depends: T015

- [X] T017 [US1] **Re-freeze the oracle (the fresh T014 step).** Write
      `<EVIDENCE>/frozen-expectations/frozen-expectation-set.json` containing
      `derivedPathPatterns` in `compareCodeUnits`-sorted order — this ordering is the
      correction the fresh cycle exists to make; input order is the defect — plus
      `expectedByEntity`, `frozenAt`, and `contentHash`.
      Barrier: IS THE BARRIER
      Discharges: FR-053
      Depends: T014

- [X] T018 [US1] Assemble `<EVIDENCE>/accept-corpus-freeze/accept-corpus-freeze.json`
      — `corpusRef`, `selectionBasis`, `size`, `overlay`, `expectedPaths`, `contentHash`
      — **in the same cycle** as T014–T017. This artifact and the T017 oracle are
      frozen together or not at all.
      Barrier: IS THE BARRIER
      Discharges: FR-054 (same-cycle freeze)
      Depends: T015, T016, T017

- [X] T019 [US1] **The independent audit (the T014a step).** A reviewer with no
      authoring involvement in T014–T018 **recomputes** both content hashes from the
      artifacts themselves — never copies the recorded values — confirms the
      `derivedPathPatterns` ordering is `compareCodeUnits` and not input order, records
      an **explicit adequacy finding** on the corpus (an integrity confirmation alone
      does not satisfy clause 5(a)), and records the auditor's **own** PASS/FAIL.
      Files: `<EVIDENCE>/frozen-expectations/audit-record.json`,
      `<EVIDENCE>/accept-corpus-freeze/adequacy-audit.json`.
      Barrier: IS THE BARRIER
      Discharges: FR-057 (step (a) half), SC-010
      Depends: T018

- [x] T020 [US1] **Observed failing.** Construct an oracle variant whose
      `derivedPathPatterns` are in input order rather than `compareCodeUnits` order;
      run the T019 audit against it; observe the audit return FAIL and record the
      exact reason; restore the correct artifact; observe PASS. Retain the failing
      variant at `<EVIDENCE>/negative-cases/oracle-input-order/`.
      Barrier: IS THE BARRIER
      Discharges: none — supplies the ADR-0016 observation for FR-053
      Depends: T019

- [x] T021 [US1] **Observed failing.** Construct an audit run that confirms hash
      integrity but never reaches an adequacy finding; observe it recorded as FAIL
      against SC-010 rather than silently accepted; restore; observe PASS. Retain at
      `<EVIDENCE>/negative-cases/audit-integrity-only/`.
      Barrier: IS THE BARRIER
      Discharges: none — supplies the ADR-0016 observation for SC-010
      Depends: T019, T020

- [x] T022 [US1] Build the CI freeze-hash drift check — **R5 mechanism 2**. It
      re-derives the content hashes of everything under `<EVIDENCE>/frozen-expectations/`
      and `<EVIDENCE>/accept-corpus-freeze/` and fails the build on any drift.
      Files: `scripts/check-freeze-hashes.ts`, `scripts/check-freeze-hashes.test.ts`,
      `.github/workflows/ci.yml`.
      Barrier: IS THE BARRIER
      Discharges: none — implements R5 mechanism 2
      Depends: T019

- [x] T023 [US1] **Observed failing.** Mutate a single byte of one frozen artifact;
      run the T022 check; observe it fail and record the exact reason; restore the byte;
      observe the pass.
      Files: `scripts/check-freeze-hashes.test.ts`,
      `<EVIDENCE>/negative-cases/freeze-drift/`.
      Barrier: IS THE BARRIER
      Discharges: none — supplies the ADR-0016 observation for R5 mechanism 2
      Depends: T022

- [x] T024 [US1] **BARRIER B CHECKPOINT — HARD GATE.** Confirm and record all three
      R5 mechanisms simultaneously:
      **(1) input absence** — no input manifest exists anywhere in the tree, and the
      adapter contains no recursive walking or glob discovery that could substitute for
      one (`input-manifest.md` §5);
      **(2) hash match** — the T022 drift check is green in CI over both frozen trees;
      **(3) ordering** — no comparison harness exists anywhere in the repository, in
      any branch of this worktree, or in any scratch location.
      Record the outcome as `BARRIER_B_CLEARED` at
      `<EVIDENCE>/barrier-b-checkpoint.json`, with the three confirmations stated
      separately and the recording timestamped.
      **No task in Phase E, F, or G may begin until this task is checked complete.**
      Barrier: IS THE BARRIER
      Discharges: none — gates FR-014, FR-023, FR-024, FR-034…FR-043, FR-050, FR-052,
      FR-056, FR-057 (step b), FR-058 (report half), FR-059, FR-060, FR-061,
      FR-063 (report half), SC-001, SC-002, SC-003, SC-009, SC-011, SC-012
      (demonstration half), SC-013, SC-016
      Depends: T019, T021, T023

---

## Phase C — Consumer package `@adrkit/catalog-envelope`

**Barrier side: BEFORE.** Every task carries `[US8]`. The consumer validates an
envelope it is *given*; it never generates one. Its expected values come from
`snapshot-envelope.md`, not from the oracle or the clause-5 expectations, so the
whole phase is barrier-free under the R4 distinguishing test. Phase C may run
concurrently with Phase D.

- [X] T025 [P] [US8] Declare the consumer's **own independent** envelope shape at
      `<CONSUMER>/src/envelope-shape.ts`. This duplication of the adapter's shape is
      deliberate: a shared module would create exactly the coupling FR-005 forbids.
      Barrier: BEFORE
      Discharges: FR-005 (consumer half)
      Depends: T002, T007
      Contract: `package-boundary.md` §5

- [X] T026 [P] [US8] Add a guard test proving this feature leaves
      `packages/core/src/affects/**` (including `packages/core/src/affects/catalog.ts`),
      `packages/core/src/schema/adr.schema.ts`, and `schema/adr.schema.json` unchanged.
      Files: `<CONSUMER>/test/no-core-schema-change.test.ts`.
      Barrier: BEFORE
      Discharges: FR-004
      Depends: T002

- [X] T027 [P] [US8] Author the envelope fixtures under `<CONSUMER>/test/fixtures/` —
      one malformed fixture per validation step (five), plus mutated-payload, stale,
      foreign-repository, valid, and the **all-annotation-absent acceptance contrast
      case**: **ten** in total.
      The tenth is required by `snapshot-envelope.md` §7 row 1b — an otherwise-valid
      envelope whose entities are *all* `annotation-absent` with `identityOnly: false`,
      which MUST be **accepted**. It is the case step 5's wording exists to protect, and
      without it the fixture set contains only rejections, which cannot prove the
      validator does not **over**-reject.
      Barrier: BEFORE
      Discharges: none — enables FR-045…FR-049
      Depends: T002

- [X] T028 [US8] Implement the **five ordered validation steps** at
      `<CONSUMER>/src/validate/index.ts`, each rejecting at its own step with its own
      distinct reason.
      Barrier: BEFORE
      Discharges: FR-045
      Depends: T025, T027
      Contract: `snapshot-envelope.md` §2

- [X] T029 [US8] **Observed failing, per step, individually.** Drive each of the five
      malformed fixtures through T028; observe five *distinct* failures; record each
      exact reason string; confirm no fixture fails at a step earlier than its target;
      restore; observe the pass.
      Files: `<CONSUMER>/test/validate-steps.test.ts`,
      `<EVIDENCE>/negative-cases/consumer-steps/`.
      Barrier: BEFORE
      Discharges: none — supplies the ADR-0016 observations for SC-014
      Depends: T028

- [X] T030 [US8] Add the ordering guard: no `derivedPaths` value is read before all
      five steps pass, and any attempt to derive before validation is refused.
      Files: `<CONSUMER>/src/validate/index.ts`, `<CONSUMER>/test/no-early-read.test.ts`.
      Barrier: BEFORE
      Discharges: FR-046
      Depends: T028, T029

- [X] T031 [P] [US8] Implement digest recomputation at `<CONSUMER>/src/digest/index.ts`,
      with every claim scoped to **integrity**, never correctness. Observe the
      mutated-payload fixture failing; record the reason; restore; observe the pass.
      Barrier: BEFORE
      Discharges: FR-041
      Depends: T027, T028
      Contract: `snapshot-envelope.md` §3

- [X] T032 [P] [US8] Implement staleness as **exact revision inequality** at
      `<CONSUMER>/src/identity/staleness.ts` — never an ordering, chronological, or
      ancestry comparison. Observe the stale fixture failing; record the reason;
      restore; observe the pass.
      Barrier: BEFORE
      Discharges: FR-047
      Depends: T027, T028
      Contract: `snapshot-envelope.md` §4

- [X] T033 [P] [US8] Implement repository identity handling at
      `<CONSUMER>/src/identity/repository.ts`: an envelope whose repository does not
      match is **rejected as misidentified**; a *valid* envelope from a *different*
      repository is **accepted**, and a query against it simply returns no matches.
      These two outcomes must not be conflated. Observe both.
      Barrier: BEFORE
      Discharges: FR-048
      Depends: T027, T028
      Contract: `snapshot-envelope.md` §5, §6

- [X] T034 [US8] Implement `CatalogSnapshot`-shaped derivation at
      `<CONSUMER>/src/snapshot/index.ts`, reachable only after all five steps, the
      digest recomputation, the staleness check, and the identity check have passed.
      Barrier: BEFORE
      Discharges: FR-049
      Depends: T030, T031, T032, T033

- [X] T035 [US8] Add the integrity-is-not-correctness framing to the consumer's public
      surface and README, plus a test asserting no correctness-claim language appears
      in the package's exported types, error strings, or documentation.
      Files: `<CONSUMER>/README.md`, `<CONSUMER>/test/no-correctness-claim.test.ts`.
      Barrier: BEFORE
      Discharges: FR-058 (consumer framing half), SC-012 (framing half)
      Depends: T031, T034

- [X] T036 [US8] SC-014 close-out: a consolidated test asserting every malformed
      envelope is rejected **at its own step** with its own reason, and that no
      `derivedPaths` value was read in any rejected case.
      Files: `<CONSUMER>/test/sc-014.test.ts`.
      Barrier: BEFORE
      Discharges: SC-014
      Depends: T029, T030, T034
      Contract: `snapshot-envelope.md` §7

- [X] T037 [US8] FR-044 behavioural half: assert the consumer imports nothing from
      `packages/adapters/**` at build time or runtime — a build-graph assertion, not
      only a `package.json` inspection.
      Files: `<CONSUMER>/test/no-adapter-import.test.ts`.
      Barrier: BEFORE
      Discharges: FR-044 (behavioural half)
      Depends: T034
      Contract: `package-boundary.md` §3

---

## Phase D — Adapter pure validators

**Barrier side: BEFORE.** Settled 2026-08-04 by maintainer decision in favour of the
narrower reading of ADR-0020 clause 6: clause 6 does not reach unit-level validator
execution whose expected values come from frozen contracts. Every expected value in
Phase D is traceable to `admissibility.md`, `input-manifest.md`, `entity-identity.md`,
`owned-paths-annotation.md`, or `glob-dialect.md` — never to the oracle or the clause-5
expectations. No task in this phase assembles the pipeline, computes an ownership
result for a descriptor-sourced entity end to end, or produces an envelope.

Phase D may run concurrently with Phase C. It divides into three disjoint module
slices — **D2** (input boundary), **D1a** (admissibility and identity), **D1b**
(ownership and glob) — which touch disjoint directories under `<ADAPTER>/src/`.

> **Constraint on all Phase D slices:** no Phase D task may modify
> `<ADAPTER>/package.json` or `<ADAPTER>/tsconfig.json`. Those files are owned by
> Phase A. Any Phase D need for a new dependency must be raised back to T008 rather
> than edited in place, or concurrent worktrees will conflict.

### D2 — Input boundary (`[US2]`)

- [X] T038 [US2] Implement the closed input-manifest schema at
      `<ADAPTER>/src/manifest/schema.ts`: any unrecognized top-level field is rejected
      rather than ignored.
      Barrier: BEFORE
      Discharges: FR-006
      Depends: T001
      Contract: `input-manifest.md` §1

- [X] T039 [US2] Enforce single-repository binding: one manifest describes exactly one
      repository, and a manifest naming more than one is rejected.
      Files: `<ADAPTER>/src/manifest/schema.ts`, `<ADAPTER>/test/manifest-single-repo.test.ts`.
      Barrier: BEFORE
      Discharges: FR-007
      Depends: T038
      Contract: `input-manifest.md` §1

- [X] T040 [US2] Implement the three version and capability rejections —
      `unsupported-manifest-version`, `unsupported-snapshot-version`,
      `unsupported-capability` — each **observed failing** with its own exact reason,
      then restored and observed passing.
      Files: `<ADAPTER>/src/manifest/version.ts`,
      `<ADAPTER>/test/manifest-version.test.ts`,
      `<EVIDENCE>/negative-cases/manifest-version/`.
      Barrier: BEFORE
      Discharges: FR-008
      Depends: T038
      Contract: `input-manifest.md` §2

- [X] T041 [US2] Obtain repository identity and revision through separate git tooling
      at `<ADAPTER>/src/repository/identity.ts` — **never** from a descriptor
      annotation or any content under the repository being described.
      **Fixture constraint (`input-manifest.md` §3.1):** the mismatch fixture must be a
      standalone scratch `git init` repository, **never** a `git worktree add` linked
      worktree, because a linked worktree shares remote configuration with its parent
      and would silently pass. The current working directory *is* such a worktree.
      Files: `<ADAPTER>/src/repository/identity.ts`,
      `<ADAPTER>/test/repository-identity.test.ts`.
      Barrier: BEFORE
      Discharges: FR-009
      Depends: T038
      Contract: `input-manifest.md` §3, §3.1

- [X] T042 [US2] Enforce **exact string equality** on repository identity and revision;
      a partial, prefix, or normalized match aborts the operation. Observe a
      near-miss revision failing; record the reason; restore; observe the pass.
      Files: `<ADAPTER>/src/repository/identity.ts`,
      `<ADAPTER>/test/repository-exact-match.test.ts`,
      `<EVIDENCE>/negative-cases/repository-mismatch/`.
      Barrier: BEFORE
      Discharges: FR-010
      Depends: T041
      Contract: `input-manifest.md` §3

- [X] T043 [P] [US2] Verify every declared per-source digest **before any entity is
      processed**; a mismatch or a missing source yields `incomplete-required-source`.
      Observe it failing; record the reason; restore; observe the pass.
      Files: `<ADAPTER>/src/manifest/digests.ts`,
      `<ADAPTER>/test/manifest-digests.test.ts`,
      `<EVIDENCE>/negative-cases/incomplete-required-source/`.
      Barrier: BEFORE
      Discharges: FR-011
      Depends: T038
      Contract: `input-manifest.md` §4

- [X] T044 [P] [US2] Implement **two-stage** path validation at
      `<ADAPTER>/src/manifest/paths.ts`: a lexical rejection stage, then a confined
      realpath stage. Both stages observed failing independently, each with its own
      reason; restored; observed passing.
      Files: `<ADAPTER>/src/manifest/paths.ts`, `<ADAPTER>/test/manifest-paths.test.ts`,
      `<EVIDENCE>/negative-cases/path-validation/`.
      Barrier: BEFORE
      Discharges: FR-012
      Depends: T038
      Contract: `input-manifest.md` §4.1

- [X] T045 [P] [US2] Close the input boundary: assert the adapter never follows
      `Location.spec.targets`, never invokes a Backstage processor, plugin, or
      ingestion path, and never performs recursive walking or glob discovery to find
      descriptors. Include the `Location` worked example as a test.
      Files: `<ADAPTER>/src/manifest/boundary.ts`,
      `<ADAPTER>/test/input-boundary.test.ts`.
      Barrier: BEFORE
      Discharges: FR-013
      Depends: T038
      Contract: `input-manifest.md` §5, §6

- [X] T046 [US2] SC-008 close-out: a consolidated test asserting every input reaching
      the adapter arrived through the declared manifest and through no other route.
      Files: `<ADAPTER>/test/sc-008.test.ts`.
      Barrier: BEFORE
      Discharges: SC-008
      Depends: T042, T043, T044, T045

### D1a — Admissibility and identity (`[US3]`)

- [X] T047 [P] [US3] Implement descriptor reading at `<ADAPTER>/src/descriptor/read.ts`
      using `yaml`'s `parseDocument` with `uniqueKeys` left at its default `true`.
      Observe `duplicate-yaml-key` and `invalid-yaml-syntax` emerging as **two distinct
      outcomes**, never collapsed into one; record both reason strings; restore;
      observe the pass.
      Files: `<ADAPTER>/src/descriptor/read.ts`, `<ADAPTER>/test/descriptor-read.test.ts`,
      `<EVIDENCE>/negative-cases/yaml-read/`.
      Barrier: BEFORE
      Discharges: none — supports FR-023, which is discharged at T071
      Depends: T001

- [X] T048 [US3] Enforce that admissibility is evaluated **before** canonicalization,
      structurally rather than by convention.
      Files: `<ADAPTER>/src/admissibility/index.ts`,
      `<ADAPTER>/test/admissibility-ordering.test.ts`.
      Barrier: BEFORE
      Discharges: FR-015
      Depends: T047
      Contract: `admissibility.md` §4, §4.1

- [X] T049 [US3] Implement the **four** admissibility field validators at
      `<ADAPTER>/src/admissibility/validators.ts`, each **separately attributed** so a
      rejection names which validator rejected. Observe each of the four failing
      independently; record four distinct reason strings; restore; observe the pass.
      Files: `<ADAPTER>/src/admissibility/validators.ts`,
      `<ADAPTER>/test/admissibility-validators.test.ts`,
      `<EVIDENCE>/negative-cases/admissibility-validators/`.
      Barrier: BEFORE
      Discharges: FR-016
      Depends: T048
      Contract: `admissibility.md` §2, §2.1

- [X] T050 [US3] Implement the separator rule: an identity string with **two or more**
      separators is rejected; one with **no** separator is evaluated by the suffix
      predicate alone, so a bare `v1` passes. Observe both branches.
      Files: `<ADAPTER>/src/admissibility/separator.ts`,
      `<ADAPTER>/test/admissibility-separator.test.ts`.
      Barrier: BEFORE
      Discharges: FR-017
      Depends: T049
      Contract: `admissibility.md` §3

- [X] T051 [US3] Implement `inadmissible-descriptor` classification and its failure
      semantics.
      Files: `<ADAPTER>/src/admissibility/classify.ts`,
      `<ADAPTER>/test/admissibility-classify.test.ts`.
      Barrier: BEFORE
      Discharges: FR-018
      Depends: T049, T050
      Contract: `admissibility.md` §5

- [X] T052 [US3] Ensure every inadmissibility record identifies **all three** of:
      the descriptor path, the failing field, and the rejecting validator — and is
      distinguishable from a `duplicate-canonical-id` record.
      Files: `<ADAPTER>/src/admissibility/classify.ts`,
      `<ADAPTER>/test/admissibility-record.test.ts`.
      Barrier: BEFORE
      Discharges: FR-020
      Depends: T051
      Contract: `admissibility.md` §5, §5.1

- [X] T053 [US3] Enforce that **no inadmissible descriptor participates in a
      uniqueness comparison** — duplicate detection is not a validity test and must
      never be reached by an inadmissible input.
      Files: `<ADAPTER>/src/admissibility/index.ts`,
      `<ADAPTER>/test/admissibility-excluded-from-uniqueness.test.ts`.
      Barrier: BEFORE
      Discharges: FR-019
      Depends: T052
      Contract: `admissibility.md` §6

- [X] T054 [US3] **Observed failing — permanent negative case.** Construct a descriptor
      that is simultaneously **inadmissible and canonically unique**. Observe it
      produce `inadmissible-descriptor` and **not** `duplicate-canonical-id`; record
      both the emitted reason and the absence of the wrong one; restore; observe the
      pass. This fixture is retained permanently — it is the only thing that
      distinguishes T053 from an accident of ordering.
      Files: `<ADAPTER>/test/inadmissible-and-unique.test.ts`,
      `<EVIDENCE>/negative-cases/inadmissible-and-unique/`.
      Barrier: BEFORE
      Discharges: FR-021
      Depends: T053

- [X] T055 [US3] Implement **two-step** canonicalization at
      `<ADAPTER>/src/identity/canonicalize.ts`: default-namespace substitution first,
      then lowercase the **entire** identity string — not merely the name component.
      Barrier: BEFORE
      Discharges: FR-022
      Depends: T054
      Contract: `entity-identity.md` §1

- [X] T056 [US3] SC-004 close-out: a consolidated test asserting inadmissibility is
      decided before canonical identity is computed, for every admissibility failure
      mode.
      Files: `<ADAPTER>/test/sc-004.test.ts`.
      Barrier: BEFORE
      Discharges: SC-004
      Depends: T055
      Contract: `admissibility.md` §8

### D1b — Ownership and glob (`[US4]`)

- [X] T057 [P] [US4] Derive ownership from the `adrkit.io/owned-paths` annotation
      **alone** at `<ADAPTER>/src/ownership/derive.ts`. No inference from the
      descriptor's file location, its parent directory, the repository root, or any
      other signal.
      Barrier: BEFORE
      Discharges: FR-025
      Depends: T001
      Contract: `owned-paths-annotation.md` §1

- [ ] T058 [US4] Implement the **five** ordered annotation decode steps at
      `<ADAPTER>/src/ownership/annotation.ts`. **Three** of the five can reject, each with
      its own distinct reason: step 2 → `annotation-value-not-a-string`, step 3 →
      `parse-error`, step 4 → `wrong-shape`. Observe each of those three failing
      independently; record three distinct reason strings; restore; observe the pass.
      **Step 1 (presence) does not reject** — an absent annotation is the legitimate
      `annotation-absent` ownership state (`owned-paths-annotation.md` §1 step 1).
      **Step 5 (per-pattern) does not produce an annotation-decode reason** — it delegates
      to the glob dialect, whose reasons belong to that contract and are covered by SC-007.
      Five steps, three reasons; do not conflate the counts.
      Files: `<ADAPTER>/src/ownership/annotation.ts`,
      `<ADAPTER>/test/annotation-decode.test.ts`,
      `<EVIDENCE>/negative-cases/annotation-decode/`.
      Barrier: BEFORE
      Discharges: FR-026
      Depends: T057
      Contract: `owned-paths-annotation.md` §1

- [X] T059 [US4] **Observed failing — permanent negative case.** Step 2's string-scalar
      check runs against the **raw YAML node**, before `JSON.parse`. Therefore the
      annotation value `["[]"]` — a YAML sequence, not a string — must yield
      `annotation-value-not-a-string`, and must **never** be silently coerced into
      `explicit-empty`. Observe the correct reason; observe the absence of the wrong
      one; restore; observe the pass. Retain permanently.
      Files: `<ADAPTER>/test/annotation-step2-raw-node.test.ts`,
      `<EVIDENCE>/negative-cases/annotation-sequence-coercion/`.
      Barrier: BEFORE
      Discharges: FR-027
      Depends: T058
      Contract: `owned-paths-annotation.md` §1

- [X] T060 [US4] Keep the **three** ownership states distinct and never conflated, and
      decide `explicit-empty` on the **decoded** value — so `'[]'`, `'[ ]'`, and
      `'[\n]'` all qualify — never by raw-string equality.
      Files: `<ADAPTER>/src/ownership/states.ts`,
      `<ADAPTER>/test/ownership-states.test.ts`.
      Barrier: BEFORE
      Discharges: FR-028
      Depends: T059
      Contract: `owned-paths-annotation.md` §1

- [X] T061 [US4] SC-005 close-out: a consolidated test over the three ownership states.
      Files: `<ADAPTER>/test/sc-005.test.ts`.
      Barrier: BEFORE
      Discharges: SC-005
      Depends: T060

- [ ] T062 [US4] SC-006 close-out: a consolidated test over the **five** annotation decode
      steps, asserting that the **three** rejecting steps each reject at their own step with
      their own reason, and documenting why the other two do not — step 1 yields the
      `annotation-absent` state rather than a rejection, and step 5 delegates to the glob
      dialect (SC-007). The test MUST assert the five-step *ordering* as well as the three
      reasons, so that a reordering which happened to preserve the reasons still fails.
      Files: `<ADAPTER>/test/sc-006.test.ts`.
      Barrier: BEFORE
      Discharges: SC-006
      Depends: T060, T061

- [X] T063 [P] [US4] Implement the restricted glob dialect and freeze the engine and
      its options at `<ADAPTER>/src/glob/dialect.ts`. The `picomatch` version must be
      **read at runtime from the resolved dependency**, never transcribed into a
      literal — a transcribed version silently goes stale.
      Barrier: BEFORE
      Discharges: FR-029
      Depends: T001
      Contract: `glob-dialect.md` §1, §6

- [X] T064 [US4] Implement the **fifteen** ordered rules with first-match-wins
      semantics at `<ADAPTER>/src/glob/validate.ts`.
      Barrier: BEFORE
      Discharges: FR-030
      Depends: T063
      Contract: `glob-dialect.md` §3

- [X] T065 [US4] **Observed failing for rules 1–14 only.** For each of rules 1 through
      14, supply a pattern that violates *that* rule and no earlier one; observe the
      rule fire; record its exact rejection reason; restore; observe the pass.
      **Rule 15 (`invalid-glob-compile-failure`) is a defensive backstop that its own
      contract states is "expected to never occur in practice."** Its `accepted`
      outcome *is* exercised by valid patterns reaching it, but its rejection reason is
      **not required**, and rule 15 not firing is **conformant** and **must not be
      reported as a coverage gap** in any artifact this feature produces.
      Files: `<ADAPTER>/test/glob-rules.test.ts`, `<EVIDENCE>/negative-cases/glob-rules/`.
      Barrier: BEFORE
      Discharges: SC-007
      Depends: T064
      Contract: `glob-dialect.md` §3

- [X] T066 [US4] Assert rule-specific rejection reasons hold when a **mixed batch** of
      patterns is validated, each pattern evaluated in isolation so no pattern's
      outcome influences another's.
      Files: `<ADAPTER>/test/glob-mixed-batch.test.ts`.
      Barrier: BEFORE
      Discharges: FR-031
      Depends: T065
      Contract: `glob-dialect.md` §3

- [X] T067 [US4] Compile each pattern **once per run** and reuse the compiled matcher,
      so validation and matching cannot diverge.
      Files: `<ADAPTER>/src/glob/dialect.ts`, `<ADAPTER>/test/glob-compile-once.test.ts`.
      Barrier: BEFORE
      Discharges: FR-032
      Depends: T066
      Contract: `glob-dialect.md` §6

- [X] T068 [US4] Sort `derivedPaths` with `compareCodeUnits`
      (`packages/core/src/ordering/index.ts:12`) and deduplicate.
      Files: `<ADAPTER>/src/glob/order.ts`, `<ADAPTER>/test/glob-order.test.ts`.
      Barrier: BEFORE
      Discharges: FR-033
      Depends: T067

---

## Phase E — Assembled generator: pipeline, atomicity, envelope

**Barrier side: BEHIND.** Every task in this phase lists **T024** in its `Depends`
line. **No task in Phase E is marked `[P]`, and — per anti-verdict 1 — nothing
whatsoever runs concurrently with Phase E.** Phase E is where generator-derived output
first exists; the whole point of Barrier B is that this moment comes after the freeze
and the audit.

- [ ] T069 [US2] Compose the Phase D units into `<ADAPTER>/src/pipeline.ts` in fixed
      stage order: manifest → repository → digests → descriptor read → admissibility →
      canonicalization → ownership → glob → envelope. Composition only; no new
      validation logic.
      Barrier: BEHIND
      Discharges: none — enables FR-014, FR-023, FR-024, FR-034…FR-043
      Depends: T024, T046, T056, T068

- [ ] T070 [US2] Set `completeness.wholeCatalog === false` unconditionally, in every
      envelope, on every path. There is no configuration, flag, or input that can make
      it `true`.
      Files: `<ADAPTER>/src/envelope/completeness.ts`,
      `<ADAPTER>/test/completeness-always-false.test.ts`.
      Barrier: BEHIND
      Discharges: FR-014
      Depends: T024, T069

- [ ] T071 [US5] Enforce **global canonical uniqueness over every ref**, emitting
      `duplicate-canonical-id`, `duplicate-canonical-ref`, and `duplicate-yaml-key` as
      three distinct classes. First-wins and last-wins resolution are forbidden — a
      collision aborts.
      Files: `<ADAPTER>/src/identity/uniqueness.ts`,
      `<ADAPTER>/test/uniqueness.test.ts`.
      Barrier: BEHIND
      Discharges: FR-023
      Depends: T024, T069
      Contract: `entity-identity.md` §3
      > **[NEEDS CLARIFICATION]** — carried forward unresolved from `plan.md` and
      > `research.md` R12 (`spec.md`:1275; `data-model.md` §5 line 190): what populates
      > `allRefs` beyond `canonicalId`. **Do not resolve by guess.** Consequence to
      > record at this task: the reachability of `duplicate-canonical-ref` outside
      > synthetic fixtures is unknown, and SC-003 may be satisfiable only synthetically
      > for that one class.

- [ ] T072 [US5] Establish that **overlap between distinct canonical ids is not a
      collision** — two entities may derive overlapping paths, and no exclusive winner
      is selected.
      Files: `<ADAPTER>/src/identity/overlap.ts`, `<ADAPTER>/test/overlap.test.ts`.
      Barrier: BEHIND
      Discharges: FR-024
      Depends: T024, T071
      Contract: `entity-identity.md` §4

- [ ] T073 [US5] Implement whole-operation abort: any fatal trigger aborts the entire
      operation, exits non-zero, and leaves **no usable partial output** — no partial
      envelope, no partial file, no truncated stream.
      Files: `<ADAPTER>/src/failure/abort.ts`, `<ADAPTER>/test/abort.test.ts`.
      Barrier: BEHIND
      Discharges: FR-034
      Depends: T024, T069
      Contract: `atomic-fail-closed.md` §1, §2

- [ ] T074 [US5] Declare the closed **fifteen**-value fatal trigger enumeration as a
      string-literal union at `<ADAPTER>/src/failure/triggers.ts`. This feature's count
      is **fifteen** — spike 009's fourteen **plus** `inadmissible-descriptor`, added by
      ADR-0015 Condition of Acceptance 2. The enumeration, verbatim from
      `atomic-fail-closed.md` §4 (lines 68–81):
      `duplicate-canonical-id` | `duplicate-canonical-ref` | `duplicate-yaml-key` |
      `invalid-yaml-syntax` | `invalid-manifest-shape` | `invalid-annotation-shape` |
      `invalid-annotation-parse` | `invalid-pattern` | `unsupported-manifest-version` |
      `unsupported-snapshot-version` | `unsupported-capability` | `repository-mismatch` |
      `incomplete-required-source` | `inadmissible-descriptor` | `other-invalid-input`.
      **No artifact this feature produces may state "fourteen" as this feature's
      trigger count.**
      Barrier: BEHIND
      Discharges: FR-035
      Depends: T024, T073
      Contract: `atomic-fail-closed.md` §4

- [ ] T075 [US5] Implement `other-invalid-input` as a **deliberate, always-present
      backstop** — never removed as unreachable, never treated as dead code, and never
      used to absorb a case that has its own class.
      Files: `<ADAPTER>/src/failure/triggers.ts`,
      `<ADAPTER>/test/backstop-trigger.test.ts`.
      Barrier: BEHIND
      Discharges: FR-036
      Depends: T024, T074
      Contract: `atomic-fail-closed.md` §4.2

- [ ] T076 [US5] Enforce that each abort carries **exactly one** trigger class, and
      that it is the **correct** one — including for the collapsible pairs the contract
      identifies as most at risk of being merged.
      Files: `<ADAPTER>/src/failure/classify.ts`,
      `<ADAPTER>/test/trigger-classification.test.ts`.
      Barrier: BEHIND
      Discharges: FR-037
      Depends: T024, T075
      Contract: `atomic-fail-closed.md` §4.3

- [ ] T077 [US5] Assert **whole-operation atomicity over a mixed batch** — a batch
      containing both valid and invalid entities produces no output at all. This is a
      *separate property* from the per-rule tests in Phase D, which is precisely why
      `plan.md` places it behind the barrier under the R4 definition even though the
      distinguishing test alone might not have.
      Files: `<ADAPTER>/test/sc-002-mixed-batch.test.ts`.
      Barrier: BEHIND
      Discharges: SC-002
      Depends: T024, T076
      Contract: `atomic-fail-closed.md` §2

- [ ] T078 [US5] Drive **all fifteen** trigger classes through the **full assembled
      pipeline**, each **observed failing first** with its exact reason string, each
      failing input retained permanently.
      Files: `<ADAPTER>/test/sc-003-all-triggers.test.ts`,
      `<EVIDENCE>/negative-cases/triggers/`.
      Barrier: BEHIND
      Discharges: SC-003
      Depends: T024, T077
      > **[NEEDS CLARIFICATION]** consequence carried from T071: if `allRefs` is
      > populated only by `canonicalId`, `duplicate-canonical-ref` may be reachable
      > only via a synthetic fixture. Record that plainly here rather than presenting a
      > synthetic case as a corpus-derived one.

- [ ] T079 [US6] Emit the versioned envelope as the **only** output: no side files, no
      logs presented as output, no auxiliary artifacts.
      Files: `<ADAPTER>/src/envelope/write.ts`, `<ADAPTER>/test/envelope-only.test.ts`.
      Barrier: BEHIND
      Discharges: FR-038
      Depends: T024, T069

- [ ] T080 [US6] Implement the envelope's declared fields and **exactly five** fields
      per `entities[]` record. The flatter triple shape is forbidden.
      Files: `<ADAPTER>/src/envelope/shape.ts`, `<ADAPTER>/test/envelope-shape.test.ts`.
      Barrier: BEHIND
      Discharges: FR-039
      Depends: T024, T079
      Contract: `snapshot-envelope.md` §1 (see also `data-model.md` §9, §10)

- [ ] T081 [US6] Compute the envelope digest using `@adrkit/core`'s `canonicalStringify`
      (`packages/core/src/fingerprint/index.ts:16`, exported at
      `packages/core/src/index.ts:24`), SHA-256, rendered as 64 lowercase hex
      characters. **Never** use the same-named function at
      `packages/evaluator/src/report/serialize.ts:38` — it has a different signature
      `(root, pretty = false)` and importing it crosses a disallowed dependency
      boundary. Every digest claim must travel with its scope qualification: for the
      envelope's closed scalar domain the bytes are *equivalent to* RFC 8785 / JCS
      output; **no document may claim `canonicalStringify` is a general-purpose RFC 8785
      implementation.**
      Files: `<ADAPTER>/src/envelope/digest.ts`, `<ADAPTER>/test/envelope-digest.test.ts`.
      Barrier: BEHIND
      Discharges: FR-040
      Depends: T024, T080
      Contract: `package-boundary.md` §2.2

- [ ] T082 [US6] Maintain the provenance boundary in the envelope: upstream-authored
      descriptor content and maintainer-authored overlay content are recorded as
      distinct provenances and never merged into an undifferentiated whole.
      Files: `<ADAPTER>/src/envelope/provenance.ts`,
      `<ADAPTER>/test/envelope-provenance.test.ts`.
      Barrier: BEHIND
      Discharges: FR-043
      Depends: T024, T081

- [ ] T083 [US2] Produce **byte-identical** output across repeated runs over identical
      input.
      Files: `<ADAPTER>/test/byte-identical.test.ts`.
      Barrier: BEHIND
      Discharges: FR-042
      Depends: T024, T082

- [ ] T084 [US2] Assert determinism across **at least three** runs, on the **accept
      path and the reject path alike** — a deterministic rejection is as much a
      requirement as a deterministic envelope.
      Files: `<ADAPTER>/test/sc-001-determinism.test.ts`.
      Barrier: BEHIND
      Discharges: SC-001
      Depends: T024, T083

- [ ] T085 [US6] SC-013 close-out: exactly one envelope is produced; each
      `entities[]` record carries exactly five fields; the recorded digest matches an
      **independent** recomputation, not the generator's own.
      Files: `<ADAPTER>/test/sc-013.test.ts`.
      Barrier: BEHIND
      Discharges: SC-013
      Depends: T024, T081, T084

- [ ] T086 [US2] SC-009 close-out — the **rescoped** criterion (spike 009's SC-010,
      rescoped by ADR-0020 clause 3): every required pass yields either a populated
      envelope **or** a deterministic, atomic, correctly-classified rejection; at least
      one pass over the **frozen accept corpus** yields a populated envelope; and a
      fabricated or hand-edited envelope never satisfies it.
      Files: `<ADAPTER>/test/sc-009.test.ts`.
      Barrier: BEHIND
      Discharges: SC-009
      Depends: T024, T084, T085

---

## Phase F — Clause-5 step (b): post-output comparison

**Barrier side: BEHIND.** Every task carries `[US7]` and lists **T024** in `Depends`.
**Phase F is fully serial and — per anti-verdict 2 — may not be started early "so it
is ready."** Authoring the comparison harness before the freeze and the audit would
collapse ADR-0020 clause 5's two distinct steps into one, which is the exact failure
the barrier exists to prevent.

- [ ] T087 [US7] **Author the comparison harness now, and not before.** Write
      `scripts/compare-accept-corpus.ts` and `scripts/compare-accept-corpus.test.ts`.
      Record explicitly, at `<EVIDENCE>/comparison/harness-provenance.md`, that no
      comparison harness existed prior to T024's confirmation and prior to Phase E
      producing output — this is R5 mechanism 3, and the record is the only artifact
      that carries it.
      Barrier: BEHIND
      Discharges: none — implements R5 mechanism 3
      Depends: T024, T086

- [ ] T088 [US7] Diff the derived ownership for **every annotated entity in the frozen
      accept corpus** against the frozen expectations, requiring **zero false positives
      and zero false negatives**.
      Files: `scripts/compare-accept-corpus.ts`,
      `<EVIDENCE>/comparison/diff-report.json`.
      Barrier: BEHIND
      Discharges: FR-056, SC-011
      Depends: T024, T087

- [ ] T089 [US7] **Observed failing.** Introduce a deliberate mismatch into the
      comparison input; observe the gate FAIL and record the exact reason; remove the
      mismatch; observe the PASS. Retain the mismatch as a permanent negative case at
      `<EVIDENCE>/negative-cases/comparison-mismatch/`.
      Barrier: BEHIND
      Discharges: none — supplies the ADR-0016 observation for SC-011
      Depends: T024, T088

- [ ] T090 [US7] Record step (b)'s **own** hashes and **own** PASS/FAIL at
      `<EVIDENCE>/comparison/step-b-record.json`. Step (b) inherits nothing from step
      (a): it recomputes, and it renders its own verdict.
      Barrier: BEHIND
      Discharges: FR-057 (step (b) half)
      Depends: T024, T089

- [ ] T091 [US7] **Prohibition guard: expectations are never amended to fit output.**
      Assert that every hash under `<EVIDENCE>/frozen-expectations/` and
      `<EVIDENCE>/accept-corpus-freeze/` is unchanged from its Phase B value, across
      the whole of Phase E and Phase F. A comparison that passes because the
      expectations moved is not a passing comparison.
      Files: `scripts/check-freeze-hashes.test.ts`,
      `<EVIDENCE>/comparison/expectations-unchanged.json`.
      Barrier: BEHIND
      Discharges: none — enforces the clause-5 prohibition
      Depends: T024, T090

- [ ] T092 [US7] Reporting-honesty close-out: assert that no Phase F artifact presents
      the populated, digest-verified envelope as evidence of **correctness**. A digest
      establishes integrity. The comparison establishes agreement with a maintainer-authored
      expectation set. Neither establishes that the adapter is correct, and no artifact
      may imply otherwise.
      Files: `<EVIDENCE>/comparison/reporting-honesty.md`,
      `scripts/compare-accept-corpus.test.ts`.
      Barrier: BEHIND
      Discharges: FR-058 (report half), FR-063 (report half), SC-012 (demonstration half)
      Depends: T024, T091

---

## Phase G — Clean clone, offline operation, clause-8 CI gate

**Barrier side: BEHIND.** Every task lists **T024** in `Depends`. Phase G runs after
Phase F completes.

- [ ] T093 [US9] Verify from a **clean clone** that build, typecheck, lint, and
      `bun test` are all green with both new packages present, and that network access
      is permitted **only** during `bun install --frozen-lockfile`.
      Files: `.github/workflows/ci.yml` (job `clean-clone-builds`).
      Barrier: BEHIND
      Discharges: FR-050
      Depends: T024, T092

- [ ] T094 [US2] Run the generator with network access **actively denied** — no
      credential present, no service reachable — and confirm it completes. Confirm
      further that it does **not** degrade to a networked path when one happens to be
      available: the offline path is the only path.
      Files: `<ADAPTER>/test/offline-run.test.ts`, `.github/workflows/ci.yml`.
      Barrier: BEHIND
      Discharges: FR-052
      Depends: T024, T093

- [ ] T095 [US9] SC-016 close-out: the evidence must be a **denial**, not an absence of
      observed calls. An absence of calls is consistent with a network path that simply
      was not taken. Cite the denial mechanism from spike 009's
      `scale-and-security-measurement.md` §5 **at its original location**; do not copy
      it into this feature's contracts.
      Files: `<ADAPTER>/test/sc-016.test.ts`.
      Barrier: BEHIND
      Discharges: SC-016
      Depends: T024, T094

- [ ] T096 [P] [US8] Cross-package end-to-end check: an envelope written by the
      generator is validated successfully by the consumer, with **no import edge in
      either direction** between the two packages — the envelope travels as data.
      Files: `scripts/cross-package-envelope.test.ts`.
      Barrier: BEHIND
      Discharges: none — supports FR-044
      Depends: T024, T037, T086
      Contract: `package-boundary.md` §3

- [ ] T097 [P] [US9] Assert that **no B/C/D comparison heuristic from spike 009**
      appears in the adapter — not as an inferred behaviour, not as an authoritative
      rule, not as a default, and not as an opt-in. Implement as a repository-wide
      check, and observe it failing by temporarily reintroducing one such heuristic;
      record the reason; remove; observe the pass.
      Files: `scripts/check-no-spike-heuristics.ts`,
      `scripts/check-no-spike-heuristics.test.ts`,
      `<EVIDENCE>/negative-cases/spike-heuristic/`.
      Barrier: BEHIND
      Discharges: FR-061
      Depends: T024, T086

- [ ] T098 [US9] Build the ADR-0020 **clause-8 executable CI gate**, tied to clause 5,
      and **observe it failing before observing it passing**. ADR-0020's own frontmatter
      assertion is **inert** (`status: 'inert'`, `reason: 'assertions-compile.engine-absent'`)
      and **must not be cited as enforcement** — the gate must be a real CI check.
      Files: `scripts/check-clause8-gate.ts`, `scripts/check-clause8-gate.test.ts`,
      `.github/workflows/ci.yml`, `<EVIDENCE>/negative-cases/clause8-gate/`.
      Barrier: BEHIND
      Discharges: FR-060
      Depends: T024, T090, T095

- [ ] T099 [US9] Repository-wide observed-failing-first close-out: enumerate **every**
      check this feature introduced, and confirm for each that a failing observation was
      recorded, with its exact reason string, and that a permanent negative case is
      retained. A check appearing only in the passing column is a coverage gap and must
      be reported as one.
      Files: `<EVIDENCE>/observed-failing-register.md`,
      `scripts/check-observed-failing-register.test.ts`.
      Barrier: BEHIND
      Discharges: FR-059
      Depends: T024, T098
      > **[NEEDS CLARIFICATION]** — carried forward unresolved from `plan.md` and
      > `research.md`:427 (`spec.md`:1290): the **release-evidence component of
      > ADR-0012 gate 4**. **Do not resolve by guess.** Consequence to record at this
      > task: gate 4 remains not-yet-testable regardless of this feature's outcome, and
      > must be recorded as unmet rather than as passed or failed.

- [ ] T100 [US9] Final honesty close-out. Assert, as executable checks where possible
      and as a recorded finding otherwise, that:
      (i) no artifact this feature produced claims ADR-0014 rung 2 or rung 3;
      (ii) no task, script, workflow, or document schedules, implies, or prepares a
      release;
      (iii) ADR-0012 gate 3's outcome is recorded **as observed**, never claimed in
      advance;
      (iv) ADR-0012 gate 4 is recorded **unmet and not yet testable**, per the carried
      clarification at T099;
      (v) no artifact asserts what Backstage as a running system does — every claim is
      scoped to what a pure validator predicate returns at the pinned commit
      `1121a4facd9e321179d0402c3f355e4a649e84d9`;
      (vi) only corpus **data** is described as third-party; the validation never is.
      **The check MUST match claims, not vocabulary.** ADR-0014's terms are binding, so
      the maximally honest phrasing — "**not** `reference-verified` (rung 2), **not**
      `externally validated` (rung 3)" — necessarily contains the very strings a naive
      grep would flag. A check that fails on bare occurrence punishes the documentation
      that is being most honest and rewards silence. Match assertion patterns (a claim
      *of* the status) and treat negations and prohibitions as conformant, then verify
      the check itself on both a real claim and a real denial before trusting it
      (ADR-0016).
      Files: `<EVIDENCE>/honesty-close-out.md`,
      `scripts/check-honesty-close-out.test.ts`.
      Barrier: BEHIND
      Discharges: none — supports FR-062, SC-017
      Depends: T024, T099

---

## Coverage — all 63 FRs and all 17 SCs

`plan.md` distributes every FR and SC across phases A–G. Six identifiers are assigned
by `plan.md` to **two phases each**, because each names two genuinely separable
obligations. They are represented below as **split discharges with named halves**, so
every FR and SC has exactly one row and every row lists every task that discharges it.
This is stated plainly rather than silently deduplicated to force a fabricated 1:1 —
the split is in `plan.md`, and hiding it would be the dishonest option.

The six split identifiers: **FR-005**, **FR-044**, **FR-057**, **FR-058**, **FR-063**,
**SC-012**. All other 57 FRs and 16 SCs are discharged by exactly one task.

### Functional requirements

| FR | Discharged by | Phase |
|---|---|---|
| FR-001 | T001 | A |
| FR-002 | T006 | A |
| FR-003 | T008 | A |
| FR-004 | T026 | C |
| FR-005 | T007 *(locality half)* + T025 *(consumer half)* | A + C |
| FR-006 | T038 | D |
| FR-007 | T039 | D |
| FR-008 | T040 | D |
| FR-009 | T041 | D |
| FR-010 | T042 | D |
| FR-011 | T043 | D |
| FR-012 | T044 | D |
| FR-013 | T045 | D |
| FR-014 | T070 | E |
| FR-015 | T048 | D |
| FR-016 | T049 | D |
| FR-017 | T050 | D |
| FR-018 | T051 | D |
| FR-019 | T053 | D |
| FR-020 | T052 | D |
| FR-021 | T054 | D |
| FR-022 | T055 | D |
| FR-023 | T071 | E |
| FR-024 | T072 | E |
| FR-025 | T057 | D |
| FR-026 | T058 | D |
| FR-027 | T059 | D |
| FR-028 | T060 | D |
| FR-029 | T063 | D |
| FR-030 | T064 | D |
| FR-031 | T066 | D |
| FR-032 | T067 | D |
| FR-033 | T068 | D |
| FR-034 | T073 | E |
| FR-035 | T074 | E |
| FR-036 | T075 | E |
| FR-037 | T076 | E |
| FR-038 | T079 | E |
| FR-039 | T080 | E |
| FR-040 | T081 | E |
| FR-041 | T031 | C |
| FR-042 | T083 | E |
| FR-043 | T082 | E |
| FR-044 | T002 *(placement)* + T010, T011 *(direction, i & ii)* + T037 *(behavioural)* | A + C |
| FR-045 | T028 | C |
| FR-046 | T030 | C |
| FR-047 | T032 | C |
| FR-048 | T033 | C |
| FR-049 | T034 | C |
| FR-050 | T093 | G |
| FR-051 | T003 | A |
| FR-052 | T094 | G |
| FR-053 | T017 | B |
| FR-054 | T015 *(overlay)* + T016 *(expected paths)* + T018 *(same-cycle freeze)* | B |
| FR-055 | T014 | B |
| FR-056 | T088 | F |
| FR-057 | T019 *(step (a) half)* + T090 *(step (b) half)* | B + F |
| FR-058 | T035 *(consumer framing half)* + T092 *(report half)* | C + F |
| FR-059 | T099 | G |
| FR-060 | T098 | G |
| FR-061 | T097 | G |
| FR-062 | T004 | A |
| FR-063 | T004 *(documentation half)* + T092 *(report half)* | A + F |

### Success criteria

| SC | Discharged by | Phase |
|---|---|---|
| SC-001 | T084 | E |
| SC-002 | T077 | E |
| SC-003 | T078 | E |
| SC-004 | T056 | D |
| SC-005 | T061 | D |
| SC-006 | T062 | D |
| SC-007 | T065 | D |
| SC-008 | T046 | D |
| SC-009 | T086 | E |
| SC-010 | T019 | B |
| SC-011 | T088 | F |
| SC-012 | T035 *(integrity-is-not-correctness framing half)* + T092 *(demonstration half)* | C + F |
| SC-013 | T085 | E |
| SC-014 | T036 | C |
| SC-015 | T009 | A |
| SC-016 | T095 | G |
| SC-017 | T004 | A |

### Per-phase totals

| Phase | Tasks | Range | `[P]` | FRs discharged | SCs discharged |
|---|---|---|---|---|---|
| A | 12 | T001–T012 | 6 | FR-001, 002, 003, 005 *(half)*, 044 *(halves)*, 051, 062, 063 *(half)* | SC-015, SC-017 |
| B | 12 | T013–T024 | 0 | FR-053, 054, 055, 057 *(half)* | SC-010 |
| C | 13 | T025–T037 | 6 | FR-004, 005 *(half)*, 041, 044 *(half)*, 045, 046, 047, 048, 049, 058 *(half)* | SC-012 *(half)*, SC-014 |
| D | 31 | T038–T068 | 6 | FR-006…013, 015…022, 025…033 | SC-004, 005, 006, 007, 008 |
| E | 18 | T069–T086 | 0 | FR-014, 023, 024, 034…040, 042, 043 | SC-001, 002, 003, 009, 013 |
| F | 6 | T087–T092 | 0 | FR-056, 057 *(half)*, 058 *(half)*, 063 *(half)* | SC-011, SC-012 *(half)* |
| G | 8 | T093–T100 | 2 | FR-050, 052, 059, 060, 061 | SC-016 |
| **Total** | **100** | **T001–T100** | **20** | **63** | **17** |

---

## Dependency graph

`T024` is the hard gate. Every task in phases E, F, and G names it. This graph — not
the prose above it — is what makes it mechanically impossible to begin behind-barrier
work before the barrier is cleared.

```
                    ┌─────────────────────── BEFORE THE BARRIER ────────────────────────┐

 PHASE A (before)                                PHASE B (IS THE BARRIER)
 ────────────────                                ────────────────────────
 T001 ─┬─> T003                                  T013 ──> T014 ─┬─> T015 ──> T016 ─┐
 T002 ─┘     │                                                  │                  │
 T001 ──> T004                                                  └─> T017 ──────────┤
 T002 ──> T005                                                                     │
 T001 ──> T006                                                     T018 <──────────┘
 T001,T002 ──> T007                                                  │
 T001,T002 ──> T008                                                  v
                │                                                  T019 ─┬─> T020 ──> T021
                v                                                        │
              T009 ──> T010 ──> T011 ──> T012   (strictly serial)        └─> T022 ──> T023
                                                                                       │
                                     T019, T021, T023 ────────────────────> T024 <─────┘
                                                                        ╔═══════════╗
                                                                        ║  BARRIER  ║
                                                                        ║ B CLEARED ║
                                                                        ╚═══════════╝
 PHASE C (before, needs A)                       PHASE D (before, needs A)
 ─────────────────────────                       ─────────────────────────
 T002,T007 ──> T025 ─┐                           D2:  T038 ─┬─> T039
 T002      ──> T026  │                                      ├─> T040
 T002      ──> T027 ─┴─> T028 ─┬─> T029 ─┐                  ├─> T041 ──> T042 ─┐
                               ├─> T030 <┘                  ├─> T043 ──────────┤
                               ├─> T031 ─┐                  ├─> T044 ──────────┤
                               ├─> T032  │                  └─> T045 ──────────┤
                               └─> T033 ─┤                        T046 <───────┘
                                  T034 <─┘
                                    ├──> T035                D1a: T047 ──> T048 ──> T049 ──> T050
                                    ├──> T036                     ──> T051 ──> T052 ──> T053
                                    └──> T037                     ──> T054 ──> T055 ──> T056

                                                             D1b: T057 ──> T058 ──> T059 ──> T060
                                                                       ├─> T061 ──> T062
                                                                  T063 ──> T064 ──> T065 ──> T066
                                                                       ──> T067 ──> T068

                    └──────────────────────────────────────────────────────────────────┘

 ══════════════════════════ NOTHING BELOW MAY START BEFORE T024 ══════════════════════════

 PHASE E (behind — fully serial; nothing runs concurrently with it)
 ──────────────────────────────────────────────────────────────────
 T024 + T046 + T056 + T068 ──> T069 ─┬─> T070
                                     ├─> T071 ──> T072
                                     ├─> T073 ──> T074 ──> T075 ──> T076 ──> T077 ──> T078
                                     └─> T079 ──> T080 ──> T081 ──> T082 ──> T083 ──> T084
                                                              │                        │
                                                              └──────> T085 <──────────┘
                                                                         │
                                                                       T086
 PHASE F (behind — fully serial)
 ───────────────────────────────
 T024 + T086 ──> T087 ──> T088 ──> T089 ──> T090 ──> T091 ──> T092

 PHASE G (behind)
 ────────────────
 T024 + T092 ──> T093 ──> T094 ──> T095 ─┐
 T024 + T037 + T086 ──> T096  [P]        │
 T024 + T086        ──> T097  [P]        │
 T024 + T090 + T095 ─────────> T098 <────┘
                                 │
                               T099 ──> T100
```

### Gate edges, stated explicitly

- **T024 → every one of T069–T100.** No exception. Phase E, F, and G tasks each carry
  `T024` in their `Depends` line, so no dispatcher can schedule one of them while the
  barrier checkpoint is unchecked.
- **T019, T021, T023 → T024.** The checkpoint cannot be reached until the audit has
  rendered its own verdict (T019), the two audit-failure modes have been observed
  (T020, T021), and the drift check has been observed failing (T023).
- **T046, T056, T068 → T069.** The assembled pipeline may not be composed until all
  three Phase D slices are closed out.
- **T086 → T087.** The comparison harness is authored only after Phase E has produced
  output. This edge *is* R5 mechanism 3.
- **T090, T095 → T098.** The clause-8 gate cannot be built until step (b) has rendered
  its own verdict and the network denial has been observed as a denial.

---

## Parallel opportunities and worktree dispatch

### The adopted sequence

```
[A ∥ B] → [C ∥ D] → E → F → G
```

### Recorded but NOT adopted

Under the stricter reading of ADR-0020 clause 6 — that clause 6 reaches unit-level
validator execution — the sequence would have been `[A ∥ B] → [B ∥ C] → D → E → F → G`,
placing Phase D behind the barrier. That reading was **settled 2026-08-04 by maintainer
decision in favour of the narrower reading**, and Phase D sits before the barrier.
The counterfactual is recorded here because the decision was contested, not because it
is available to be re-adopted mid-implementation.

### The three anti-verdicts — hard rules, not guidance

1. **Nothing runs concurrently with Phase E.** Not Phase F "getting started", not
   Phase G's CI wiring, not documentation. Phase E is where generator output first
   exists; concurrency there is how a barrier gets crossed by accident.
2. **Phase F may not be started early "so it is ready."** Authoring the comparison
   harness before the freeze and audit collapses ADR-0020 clause 5's two distinct steps
   into one. T087's provenance record exists precisely to make an early start visible.
3. **Phase B may not be split freeze-now / audit-later.** SC-010 requires the corpus,
   the overlay, the expected matches, and the recorded selection basis and size to be
   frozen in the **same cycle**, with the audit recording its own hashes and its own
   PASS/FAIL. A freeze whose audit arrives later is not an audited freeze.

### Safe to hand to concurrent worktree sessions

| Slice | Tasks | Owns | Why it is safe |
|---|---|---|---|
| **Worktree A** | T001–T012 | `<ADAPTER>` and `<CONSUMER>` skeletons, `scripts/check-deps.ts` | Touches no evidence artifact and no `src/` module logic. |
| **Worktree B** | T013–T024 | `<EVIDENCE>/**`, `scripts/check-freeze-hashes.ts` | Touches no package source. Runs concurrently with A. |
| **Worktree C** | T025–T037 | `<CONSUMER>/src/**`, `<CONSUMER>/test/**` | Disjoint from all adapter source. Needs A complete. |
| **Worktree D2** | T038–T046 | `<ADAPTER>/src/{manifest,repository}/**` | Disjoint directories. Needs A complete. |
| **Worktree D1a** | T047–T056 | `<ADAPTER>/src/{descriptor,admissibility,identity}/**` | Disjoint directories. Needs A complete. |
| **Worktree D1b** | T057–T068 | `<ADAPTER>/src/{ownership,glob}/**` | Disjoint directories. Needs A complete. |

**Constraint binding all four of C, D2, D1a, D1b:** no task in these slices may modify
`<ADAPTER>/package.json`, `<ADAPTER>/tsconfig.json`, `<CONSUMER>/package.json`,
`<CONSUMER>/tsconfig.json`, or `scripts/check-deps.ts`. Those files are owned by
Phase A. A newly discovered dependency need must be raised back to T008 and merged
through Phase A, not edited in place — otherwise concurrent worktrees will conflict on
the manifest files and, worse, may each pass `check:deps` locally while together
violating it.

### Must be held serial

| Held serial | Why |
|---|---|
| **T009 → T010 → T011 → T012** within Phase A | All four mutate `scripts/check-deps.ts` and/or package dependency blocks and re-run the same command. Interleaving them makes each observation unattributable. |
| **All of Phase B (T013 → T024)** | Anti-verdict 3. The freeze and the audit are one cycle. The audit must be performed by someone with no authoring involvement in T014–T018, which is a *reviewer* constraint, not a parallelism opportunity. |
| **All of Phase E (T069 → T086)** | Anti-verdict 1. Nothing runs concurrently with Phase E. |
| **All of Phase F (T087 → T092)** | Anti-verdict 2, plus each task consumes the previous task's verdict. |
| **Phase G apart from T096 and T097** | T093 → T094 → T095 share the CI workflow and the offline-execution environment; T098 → T099 → T100 are a verdict chain. Only T096 and T097 are genuinely disjoint. |

---

## Implementation strategy

This is **not** an MVP-and-iterate feature, and the task list must not be read as one.
The barrier makes the ordering load-bearing: a phase started early is not merely
premature, it invalidates the evidence the phase was supposed to produce.

The strategy is:

1. **Establish the ground truth first, under audit** (Phase B), concurrently with
   getting the workspace boundaries enforceable (Phase A). Neither depends on the other.
2. **Build every pure validator whose expected values come from frozen contracts**
   (Phases C and D), concurrently, in disjoint module slices.
3. **Assemble** (Phase E), alone, in one place, with nothing else moving.
4. **Compare** (Phase F), with a harness that provably did not exist before the freeze.
5. **Harden and gate** (Phase G).

Throughout: every check is observed failing before it counts as coverage (ADR-0016);
every count is verified in source before it is written down; and no artifact claims
more than rung 1.

### Carried unknowns — unresolved, and not to be resolved by guess

| # | Unknown | Carried at | Consequence |
|---|---|---|---|
| 1 | What populates `allRefs` beyond `canonicalId` (`research.md` R12; `spec.md`:1275; `data-model.md` §5 line 190) | **T071**, with the consequence restated at **T078** | The reachability of `duplicate-canonical-ref` outside synthetic fixtures is unknown. SC-003 may be satisfiable only synthetically for that one trigger class, and that must be reported as such. |
| 2 | The release-evidence component of ADR-0012 gate 4 (`research.md`:427; `spec.md`:1290) | **T099**, with the recording obligation at **T100** | Gate 4 remains not-yet-testable regardless of this feature's outcome, and is recorded **unmet** — never as passed, never as failed. |

A third open question — whether ADR-0020 clause 6 reaches unit-level validator
execution (`research.md` R4) — was **resolved on 2026-08-04** by maintainer decision in
favour of the narrower reading. It is recorded here as **resolved**, not open, and is
the reason Phase D sits before the barrier.

### Counting facts this document depends on — each verified in source

| Count | Value | Read at |
|---|---|---|
| Fatal trigger classes **for this feature** | **fifteen** — spike 009's fourteen plus `inadmissible-descriptor` (ADR-0015 Condition of Acceptance 2) | `contracts/atomic-fail-closed.md` §4, lines 68–81 |
| Glob dialect ordered rules | **fifteen**, of which conformance covers rules **1–14 firing**; rule 15 `invalid-glob-compile-failure` is a backstop its own contract calls "expected to never occur in practice", and its non-firing **is conformant and is not a coverage gap** | `specs/009-catalog-binding-viability/contracts/glob-dialect.md` §3, lines 33–74; `plan.md` Phase D; `quickstart.md` §5.2 |
| Consumer validation steps | five | `snapshot-envelope.md` §2 |
| Admissibility field validators | four | `contracts/admissibility.md` §2 |
| Manifest version/capability rejections | three, plus `incomplete-required-source` = four manifest-request-level rejections | `contracts/atomic-fail-closed.md` §6; `input-manifest.md` §2 |
| Ownership states | three | `owned-paths-annotation.md` §1 |
| Annotation decode steps | five | `owned-paths-annotation.md` §1 |
| Path validation stages | two | `input-manifest.md` §4.1 |
| Canonicalization steps | two | `entity-identity.md` §1 |
| Fields per `entities[]` record | five | `data-model.md` §9, §10 |
| `community-plugins` corpus @ `92e9e4e09c76cc57f3475029b73e5ec84498a459` | **156 descriptor files / 167 entity documents** — file counts and document counts are different quantities | `research.md` R14, lines 571–572 |
| `rhdh-plugins` corpus @ `3b355ddfedb23c6656bd9effc8510f9926b765c1` | **38 descriptor files / 39 entity documents** — the 38/39 figure holds only under exact `catalog-info.yaml` basename matching | `research.md` R14, lines 571–572 |
| Spike-009 contracts in the adoption register | eleven — 5 adopted unchanged, 3 adopted with delta, 3 excluded | `contracts/README.md` §2 |

The corpus figures are **reference figures for fixture design**, not scale targets, and
must not be presented as either throughput evidence or coverage evidence.

---

**Generating this task list marked no task complete and performed no implementation.**
Every checkbox above is unchecked. No package exists. No check has been observed
failing. No envelope exists. Nothing in this document is a report.
