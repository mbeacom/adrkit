---
description: "Dependency-ordered task list for the Catalog Entity-to-Path Binding Compatibility Viability Spike"
---

# Tasks: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Input**: Design documents from `specs/009-catalog-binding-viability/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`,
`contracts/owned-paths-annotation.md`, `contracts/glob-dialect.md`,
`contracts/entity-identity.md`, `contracts/input-manifest.md`,
`contracts/atomic-fail-closed.md`, `contracts/snapshot-envelope.md`,
`contracts/comparison-heuristics.md`, `contracts/structural-fixtures-and-corpora.md`,
`contracts/scale-and-security-measurement.md`, `contracts/evidence-bundle-and-verdict.md`,
`contracts/composition-and-release-boundary.md`

**Normative**: [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
(`status: accepted`, PR #26, `54dbae8` — the controlling record of the `adrkit.io/owned-paths`
contract, the restricted glob dialect, atomic fail-closed semantics, the repository boundary,
and the versioned-envelope requirement), [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
(`status: accepted`, PR #27, `48087e8` — reconciles ADR-0007/ADR-0009's narrowed clauses while
deliberately holding both `proposed`), [ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
(`status: accepted` — replaces external-actor hard gates with the three-rung evidence ladder),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md)
(`status: proposed`; the `entity` matcher grammar and the `CatalogPort`/`CatalogSnapshot`
contract this spike measures a candidate producer for), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md)
(`status: proposed`; adapter isolation, clean-clone/credential-free/network-free build and
runtime), and [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
Principles I–V.

**Generated**: 2026-07-21, as a follow-up advance-scoping session to
`specs/009-catalog-binding-viability/plan.md` (same date), under root `plan.md`'s explicit
"Advance **scoping** (spec → plan → tasks) of the next phase is explicitly permitted" exemption
— generating this checklist is scoping, not execution. ADR-0014 now satisfies the Phase 6
precondition and removes the independent-adopter pre-execution gate, so execution is authorized
once this migration merges; Phase 1 below records that satisfied basis and computes
`GATE_PASS = true` when re-run. **No task in this file is marked complete by this migration** —
every checkbox below remains `- [ ]` until actually executed.

> ✅ **Governance preconditions satisfied; spike execution authorized once this migration
> merges; Phase 1 records the satisfied basis before execution starts.**
>
> **Scheduling (distinct from authorization).** Per root `plan.md`, this spike runs **only
> after feature 008 (`specs/008-*`) completes end-to-end** (not in parallel overall), and
> execution requires the technical safety gate of a genuinely blocking network-denial mechanism
> (FR-018/T006, fail-closed).
>
> **Satisfied preconditions.** Maintainer scoping/contract ratification (adrkit issue #25,
> both 2026-07-21 decisions), catalog-binding convention governance
> ([ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md),
> `accepted`, `54dbae8`), the adapter-isolation/catalog-binding reconciliation
> ([ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md),
> `accepted`, `48087e8`), and the phase-landing evidence policy
> ([ADR-0014](../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
> `accepted`) are all **satisfied**.
>
> **Phase 6 status.** Phase 6 is **landed / reference-verified** on ADR-0014 rungs 1–2:
> `specs/007-arb-queue/tasks.md` **T048-R** and **T049** read `- [X]`, and root `plan.md` records
> the `specs/007-arb-queue/` row as `landed / reference-verified`. The evidence is the
> **maintainer-owned isolated reference repository** <https://github.com/mbeacom/adrkit-t018-dogfood>,
> not an external team and not external / community validation (ADR-0014 rung 3).
>
> **Independent-adopter status.** There is no independent-adopter pre-execution gate. The spike
> builds a **frozen, maintainer-authored reference oracle** in scratch before any generator
> output is produced, from FR-001's pinned public corpora, maintainer-authored synthetic
> explicit `adrkit.io/owned-paths` annotations, and independent adversarial review. The oracle
> covers positive, negative, overlap, absent/empty, collision (duplicate canonical ID), and
> repository-mismatch cases with bounded zero false-positive / zero false-negative results over
> those labeled cases. External-adopter evidence is optional externally-validated maturity
> evidence only.
>
> **T001–T004 below make this mechanical.** T004 now computes `GATE_PASS = gate1Pass AND
> governancePreconditionsSatisfied`; the independent-adopter term is removed. Current expected
> result after this migration merges: `GATE_PASS = true`. All tasks remain unchecked until
> actually executed.

**Tests**: This spike has no `bun test` suite of its own — it is not a workspace package.
"Tests" here are the fixed exit-code/rejection-reason contracts across all eleven
`contracts/*.md` files (`contracts/glob-dialect.md` §3's fifteen-step validator order,
`contracts/atomic-fail-closed.md` §4's fourteen-value trigger enumeration,
`contracts/snapshot-envelope.md` §2's five-step consumer validation order) and the
acceptance-scenario evidence protocol in `quickstart.md`. Where a task below is expected to
demonstrate a rejection, its predicted rule-specific reason is stated inline and checked
against the contract — the closest analogue this spike has to a RED/GREEN cycle, applied to
spec-driven requirements (a rejection probe MUST demonstrably fail in the specific documented
way, not merely "not succeed"; an acceptance probe MUST demonstrably produce the specific
documented output, not merely "not error").

**Toolchain**: A future execution session's generator/consumer scripts are TypeScript run
under Bun (ADR-0010), invoking `picomatch@4.0.5` and `yaml@2.9.0` — both already
`packages/core` dependencies, confirmed pinned in `bun.lock` (`picomatch@4.0.5`,
`yaml@2.9.0`) — as the frozen parsing/matching engines, plus `node:crypto`'s
`createHash('sha256')` for the envelope digest and `packages/core/src/fingerprint/index.ts`'s
`canonicalStringify`/`packages/core/src/ordering/index.ts`'s `compareCodeUnits` (imported as
already-published pure utilities, never copied or forked) for canonicalization. No new
runtime or dev dependency is added to any `@adrkit/*` package (Constitution Principle III).

**Model policy**: Claude Sonnet 5 is the primary and, unless stated otherwise, the sole model
for every task in this file, including the independent audit task (T085) — independence there
is achieved through a fresh, isolated review context with no authoring history, never through
a model change. **Opus 4.6 MUST NOT be used for any task in this file, under any role.**

## Format: `[ID] [P?] [Story?] Description with exact file path`

- **[P]**: Parallelizable — task touches no file/path/evidence-bundle field another
  incomplete task in the same phase also touches, and depends on no incomplete task in the
  same phase.
- **[US1]–[US8]**: Maps directly to `spec.md`'s eight user stories. Gate, Foundational,
  Security/Mutation, Cleanup, and Audit phases intentionally omit story labels, matching this
  project's own tasks-template convention (`specs/007-arb-queue/tasks.md` Phase 1/2;
  `specs/008-spec-kit-hook-viability/tasks.md`'s identical convention for this project's
  sibling spike).
- Every task's file paths are either (a) inside this session's own scratch/session-state
  artifacts directory (never this repository, never tracked — `research.md` R2/R3), or (b) a
  specific, named path inside *this* repository that the task explicitly reads, never mutates
  as a net effect.

## Path Conventions

- `<GENERAL_SCRATCH>` — a disposable directory outside any git-tracked clone of
  `mbeacom/adrkit`, or a throwaway branch/worktree of this repository kept entirely outside the
  committed `specs/` tree (`research.md` R2 item 1; Assumption A7). Houses every synthetic
  fixture source file (User Stories 1, 3, 4, 5 fixtures; the labeled comparison matrix).
- `<SYNTHETIC_REPO>` — a standalone, freshly `git init`'d scratch git repository (never a
  linked worktree of this actual repository, which cannot be independently varied —
  `contracts/input-manifest.md` §3.1) with its own `git remote add origin
  github.com/mbeacom/adrkit-spike-fixture` (a throwaway identity per Assumption A4, distinct
  from this repository's own real `github.com/mbeacom/adrkit`) and its own commit(s). Used as
  the repository-identity fixture for User Story 2's match case (`purpose:
  "repository-match-case"`, `data-model.md` §19) and reused as the repository identity for
  User Story 6's primary-synthetic generation pass.
- `<MISMATCH_REPO>` — a second, independent standalone scratch git repository, configured with
  a deliberately different `origin`/commit than any manifest under test declares (`purpose:
  "repository-mismatch-case"`), used only for User Story 2's repository-mismatch abort test.
- `<SECOND_REPO>` — a third, independent standalone scratch git repository with its own
  distinct throwaway repository identity (e.g. `github.com/mbeacom/adrkit-spike-fixture-2`,
  `purpose: "second-repository-for-isolation-check"`), used only for User Story 7's
  repository-isolation check (Acceptance Scenario 5) — never merged with `<SYNTHETIC_REPO>`'s
  envelope; two independently-generated, individually-valid single-repository envelopes.
- `<COMMUNITY_PLUGINS_CLONE>` — a local clone (shallow or full) of
  `backstage/community-plugins` fetched once, during the one-time FR-001/FR-018 preflight
  acquisition step (T005/T011), pinned at `92e9e4e09c76cc57f3475029b73e5ec84498a459`. Every
  later derivation run reads only this already-local clone's files — never a further network
  fetch.
- `<RHDH_PLUGINS_CLONE>` — the same, for `redhat-developer/rhdh-plugins` at
  `3b355ddfedb23c6656bd9effc8510f9926b765c1` (T012).
- `<EVIDENCE_DIR>` — the *executing session's own* session-scoped artifacts directory (e.g.
  this environment's `~/.copilot/session-state/<session-id>/files/spike-009/`, or whatever the
  equivalent is for the session that eventually runs this file) — never a path under this
  repository's working tree, tracked or not (`research.md` R2 item 3). Contains the fixed file
  set `research.md` R3 names: `spike-009-evidence.md`, `spike-009-evidence.json`,
  `input-manifest.{community-plugins,rhdh-plugins,synthetic}.json`,
  `snapshot-envelope.{community-plugins,rhdh-plugins,synthetic}.json`,
  `envelope-fixtures/{malformed-invalid-json,malformed-missing-or-wrong-field,malformed-unrecognized,malformed-missing-source-digest,malformed-identity-only,tampered,stale,wrong-repository,second-repository}.json`,
  `comparison-matrix.json`, `scale-evidence.json`, `git-status-captures/*.txt`.
- `<THIS_REPO>` — this repository's own root (`mbeacom/adrkit`), used only for: (a) reading
  `packages/core/src/affects/catalog.ts`/`inert.ts`/`matchers/path.ts` (never modifying them,
  FR-020), (b) the final zero-tracked-mutation confirmation (T080, T089–T090 equivalents), and
  (c) reading `specs/007-arb-queue/tasks.md` and root `plan.md` for the Phase 6
  landed/reference-verified check (T001). No task other than these ever writes inside
  `<THIS_REPO>` as a net effect.

## Task-Level Design Decision: The Primary-Synthetic Pass's Entity Set

`spec.md`/`contracts/snapshot-envelope.md` §1 fix that exactly three envelopes are required —
community-plugins-derived, rhdh-plugins-derived, and primary synthetic — but do not enumerate
which of User Story 1's many synthetic fixtures belong inside the primary-synthetic pass's own
successfully-generated envelope, as distinct from fixtures exercised only in their own isolated
rejection/atomicity-abort probes. This file fixes that composition explicitly so a future
execution session does not have to invent it inconsistently:

**Included** in the primary-synthetic pass's manifest `sources` (T057 constructs this pass;
every one of these entities validates cleanly and contributes to one successfully-produced,
byte-identical-across-runs envelope): the valid multi-pattern entity (T017, User Story 1
Acceptance Scenario 1); the default-namespace-omission entity (T021, Acceptance Scenario 4);
the `explicit-empty` and `annotation-absent` entities (T022, Acceptance Scenario 5); the two
distinct entities with overlapping `owned-paths` (T024, Acceptance Scenario 8); the
multi-document fixture's two entities (T045, User Story 5 Acceptance Scenario 1); and the
`Location`-not-followed fixture's `Location` entity, whose manifest deliberately excludes the
second, targeted file (T047, User Story 5 Acceptance Scenario 3).

**Excluded** from the primary-synthetic pass (each is exercised only in its own isolated,
single-purpose probe or contributes only to User Story 2's dedicated atomicity-abort batch,
never merged into a successfully-generated envelope): every per-rule rejection fixture (T018,
Acceptance Scenario 2); the wrong-shape/parse-error/non-string-value fixtures (T019); the
case-only duplicate-canonical-ID fixture (T020, Acceptance Scenario 3); the three-way
alias-collision fixture (T023, Acceptance Scenario 7); User Story 2's own sixth,
duplicate-ID-bearing entity (T035); and the duplicate-YAML-key fixture (T046, User Story 5
Acceptance Scenario 2) — every one of these, by construction, would abort the entire run under
`contracts/atomic-fail-closed.md` if merged into any successful pass, so none may ever appear
inside a produced `SnapshotEnvelope`.

---

## Phase 1: Gate Verification (hard block — no story label)

**Purpose**: Mechanically record the satisfied execution basis before any scratch artifact,
corpus clone, or evidence-gathering step exists. This phase produces only the gate-check record
and touches no path outside direct, read-only inspection of already-tracked repository files.

**⚠️ CRITICAL**: If T004 does not record `GATE_PASS = true`, **stop here**. Do not proceed to
Phase 2 or any later phase. Do not create `<GENERAL_SCRATCH>`, `<SYNTHETIC_REPO>`,
`<MISMATCH_REPO>`, `<SECOND_REPO>`, any corpus clone, or `<EVIDENCE_DIR>` beyond
`gate-check.json`. Report the failed precondition and end.

- [X] T001 Verify gate 1 (Phase 6 landed / reference-verified). Read, in this order: (a)
  `specs/007-arb-queue/tasks.md` — confirm the literal checkbox state of **T048-R** (the Phase 6
  SC-004/rung-2 validation task) and **T049** (the doc flip to landed/reference-verified);
  both MUST read `- [X]` (checked/complete) for `gate1Pass` to pass. (b) root `plan.md`'s
  Spec-kit realization table — confirm the `specs/007-arb-queue/` row's Status column reads
  `landed / reference-verified`. **Output**: `gate1Pass` plus the verbatim text of both source
  lines and the table row, recorded to `<EVIDENCE_DIR>/gate-check.json`. **Current snapshot now
  passes**: Phase 6 T048-R/T049 read `- [X]`, and the `plan.md` row reads `landed /
  reference-verified`. A future execution session MUST re-run this exact check itself at
  whatever date it actually executes — this note is a snapshot, not a substitute for
  re-verification.

- [X] T002 Verify the removed independent-adopter pre-execution gate and the in-spike oracle
  basis. Confirm from `spec.md` FR-025, FR-027, and A5 that there is **no** independent-adopter
  pre-execution gate: the spike builds its own **frozen, maintainer-authored reference oracle**
  inside the scratch workspace from FR-001's pinned public corpora, maintainer-authored
  synthetic explicit `adrkit.io/owned-paths` annotations, and an **independent pre-output
  audit (T014a)** before any generator output is produced. Confirm the oracle's required case classes are
  positive, negative, overlap, absent/empty, collision (duplicate canonical ID), and
  repository-mismatch, with bounded zero false-positive / zero false-negative results over
  those labeled cases. Record
  `independentAdopterPreExecutionGateRemoved: true`,
  `maintainerAuthoredReferenceOracleRequired: true`, and
  `externalAdopterEvidenceOptionalLaterMaturity: true` in `<EVIDENCE_DIR>/gate-check.json`.
  Do **not** compute a blocking `gate2Pass` boolean; external-adopter evidence remains optional
  later maturity evidence only and is not an input to T004.

- [X] T003 Restate the satisfied governance preconditions (not separate gates), so T004's
  `GATE_PASS` computation is never conflated with historical external-actor gates. Confirm and
  record to `<EVIDENCE_DIR>/gate-check.json`: (a) maintainer scoping/contract ratification
  (adrkit issue #25, both 2026-07-21 decisions, per `spec.md`'s Ratification Record); (b)
  catalog-binding convention governance — ADR-0012 `status: accepted` (PR #26, `54dbae8`);
  (c) the adapter-isolation/catalog-binding reconciliation — ADR-0013 `status: accepted` (PR
  #27, `48087e8`), which discharges issue #25's "accepted/amended or explicitly recorded as
  blocking" requirement for ADR-0007/ADR-0009 by taking the amended-and-explicitly-blocked
  branch; and (d) phase-landing evidence policy — ADR-0014 `status: accepted`, replacing
  external-actor hard gates with the three-rung evidence ladder. Record
  `governancePreconditionsSatisfied: true`. ADR-0007/ADR-0009's own eventual acceptance remains
  a separate, later, non-gating matter this spike does not perform and does not require.

- [X] T004 Gate decision checkpoint. Depends on: T001, T002, T003. Compute `GATE_PASS =
  gate1Pass AND governancePreconditionsSatisfied` and write it as the top-level field in
  `<EVIDENCE_DIR>/gate-check.json`. The independent-adopter term is intentionally absent from
  this formula. **Current expected result after this migration merges: `gate1Pass = true`,
  `governancePreconditionsSatisfied = true`, so `GATE_PASS = true`.** **If `GATE_PASS` is
  `false`: STOP.** Perform no further task in this file. Report to the coordinating/maintainer
  session exactly which precondition failed and end without creating any scratch workspace,
  without cloning either corpus, and without writing any file under `<EVIDENCE_DIR>` beyond
  `gate-check.json` itself. **If `GATE_PASS` is `true`:** proceed to Phase 2. Every task in
  Phase 2 onward states "Depends on: T004 (`GATE_PASS`)" as a standing precondition, restated
  once here rather than repeated on every single task line.

**Checkpoint**: Gate verification complete. `GATE_PASS` recorded (currently expected `true`
after this migration merges). **All of Phase 2 onward is conditioned on `GATE_PASS = true`;
this is not restated per-task below, but applies to every task T005–T086 without exception.**

---

## Phase 2: Foundational (Blocking Prerequisites for ALL User Stories)

**Purpose**: Re-verify the three frozen upstream commits, select the network-denial mechanism,
create every scratch workspace (general fixtures, the three standalone repository identities,
the two local corpus clones), initialize the evidence-capture harness, and record the
mid-run-failure recovery procedure — every one of User Stories 1–8 depends on this phase's
outputs, and none of it is story-specific.

**⚠️ CRITICAL**: No User Story task (Phase 3 onward) may begin until this phase's checkpoint
(T016) passes. Depends on: T004 (`GATE_PASS`).

- [X] T005 Re-verify the three frozen upstream commits (FR-001; `contracts/structural-fixtures-and-corpora.md`
  §1; `quickstart.md` Step 0's corrected procedure — never `git ls-remote <url> <sha>`, which
  matches ref names, not arbitrary commit objects, and never a branch `HEAD` or any newer
  commit). For each of Backstage (`1121a4facd9e321179d0402c3f355e4a649e84d9`),
  `backstage/community-plugins` (`92e9e4e09c76cc57f3475029b73e5ec84498a459`), and
  `redhat-developer/rhdh-plugins` (`3b355ddfedb23c6656bd9effc8510f9926b765c1`): `git init --bare`
  a local mirror, `git remote add origin <url>`, `git fetch --depth=1 origin <sha>`, then `git
  cat-file -e '<sha>^{commit}'` to confirm the object actually exists as a commit — halting
  immediately on any failure, never suppressed with `|| true`. **Output**: one
  `FrozenResearchInputReachability` record per commit (reachable: boolean, checkedAt: today's
  actual date) to `<EVIDENCE_DIR>/frozen-inputs-reachability.json`. **Fail-closed rule**: if
  any of the three does not resolve to its exact pinned SHA, **STOP the entire spike** — do
  not proceed to T006–T015, and require explicit spec re-ratification per
  `contracts/structural-fixtures-and-corpora.md` §1, never silently substitute a different
  commit's contents for this spec's citations (mirrors FR-001 and Assumption A2). This one-time
  networked fetch is the explicitly-permitted preflight acquisition step FR-018 itself carves
  out — distinct from every later derivation run, which must run fully offline (T068).

- [X] T006 [P] Select and record the network-denial mechanism (`research.md` R10;
  `contracts/scale-and-security-measurement.md` §5). Determine which of the two genuinely
  qualifying mechanisms is actually available in the execution environment — (1) an OS-level
  network namespace or firewall block, or (2) a process-level sandbox that structurally denies
  network syscalls (e.g. `seccomp`, macOS `sandbox-exec` with a network-deny profile, `unshare
  --net`) — **never** an allowlisted-environment-plus-static-source-review check as the sole
  claimed mechanism, since that does not itself block any network syscall and cannot, alone,
  satisfy FR-018's "actively denied" requirement. Record `NetworkDenialRecord`
  (`data-model.md` §20) — `mechanismUsed`, `supplementaryStaticReview` (boolean),
  `configurationStatement` (the exact configuration, non-empty), `appliedToInvocations`
  (initially empty; populated incrementally as each later derivation task runs under it) — to
  `<EVIDENCE_DIR>/network-denial.json`. **If neither qualifying mechanism is available in the
  execution environment, this task MUST record that fact and every subsequent derivation task
  in this file MUST NOT proceed** — this is a fail-closed constraint on the execution
  environment itself, not merely an evidence-recording nicety. **Environment-readiness note
  (2026-07-22 probe; not task execution):** a qualifying mechanism is present here —
  `/usr/bin/sandbox-exec` with a `(deny network*)` profile blocked network without privileges
  (`curl` returned exit 6), and Podman 5.4.2 `--network none` is available as an optional
  stronger container path (Docker daemon unavailable). A future execution session MUST still
  select, apply, and record the actual mechanism and its limitations at execution time; this
  note establishes readiness, not completion. Depends on: T004 only.

- [X] T007 [P] Establish `<GENERAL_SCRATCH>` (`research.md` R2 item 1; Assumption A7). Create a
  disposable scratch directory outside any git-tracked clone of `mbeacom/adrkit`, or a
  throwaway branch/worktree of this repository kept entirely outside the committed `specs/`
  tree. Confirm, and record to `<EVIDENCE_DIR>/scratch-workspaces.json`, that it resolves to a
  path with no `.git` ancestor pointing at `mbeacom/adrkit`'s own tracked history in a way that
  could accidentally stage a fixture there. Depends on: T004 only. No path overlap with
  T008–T010, T013, T015.

- [X] T008 [P] Establish `<SYNTHETIC_REPO>` (`contracts/input-manifest.md` §3.1; Assumption
  A4). `git init` a fresh, standalone directory (never a `git worktree add` of this actual
  repository — a linked worktree shares remote configuration and cannot be independently
  varied); `git remote add origin github.com/mbeacom/adrkit-spike-fixture`; make one commit.
  Record `StandaloneScratchRepository` (`data-model.md` §19) — `path`,
  `isLinkedWorktreeOfThisRepo: false` (fixed, MUST be `false`), `configuredOriginUrl`,
  `headCommitSha`, `purpose: "repository-match-case"` — to
  `<EVIDENCE_DIR>/scratch-workspaces.json`. Depends on: T004 only. No path overlap with T007,
  T009, T010.

- [X] T009 [P] Establish `<MISMATCH_REPO>` (`contracts/input-manifest.md` §3.1; Assumption
  A4). Same procedure as T008, but with a deliberately different `origin`/commit than any
  manifest under test in User Story 2 will declare. Record `StandaloneScratchRepository` with
  `purpose: "repository-mismatch-case"` to `<EVIDENCE_DIR>/scratch-workspaces.json`. Depends
  on: T004 only. No path overlap with T007, T008, T010.

- [X] T010 [P] Establish `<SECOND_REPO>` (`contracts/snapshot-envelope.md` §6; Assumption A4).
  Same procedure as T008, but with a second, distinct throwaway repository identity (e.g.
  `github.com/mbeacom/adrkit-spike-fixture-2`) reserved for User Story 7's repository-isolation
  check. Record `StandaloneScratchRepository` with `purpose:
  "second-repository-for-isolation-check"` to `<EVIDENCE_DIR>/scratch-workspaces.json`. Depends
  on: T004 only. No path overlap with T007, T008, T009.

- [X] T011 [P] Clone `<COMMUNITY_PLUGINS_CLONE>` locally (FR-018's one-time preflight
  acquisition step). Fetch `backstage/community-plugins` at
  `92e9e4e09c76cc57f3475029b73e5ec84498a459` into a local clone under scratch storage (outside
  any tracked path). Confirm exactly 156 files with the exact basename
  `catalog-info.yaml`/`catalog-info.yml` (never a path-suffix match) and zero at the repository
  root, matching Assumption A2's own re-verification obligation. Record the clone path and
  descriptor count to `<EVIDENCE_DIR>/corpus-clones.json`. Depends on: T005 (reachability
  confirmed). No path overlap with T012.

- [X] T012 [P] Clone `<RHDH_PLUGINS_CLONE>` locally (FR-018's one-time preflight acquisition
  step). Fetch `redhat-developer/rhdh-plugins` at
  `3b355ddfedb23c6656bd9effc8510f9926b765c1` into a local clone under scratch storage. Confirm
  exactly 38 files with the exact basename `catalog-info.yaml`/`catalog-info.yml` (never 39 —
  `workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml` ends in the
  string "catalog-info.yaml" without being one) and confirm it does have a repository-root
  `catalog-info.yaml` (`metadata.name: rhdh-plugins`). Record the clone path and descriptor
  count to `<EVIDENCE_DIR>/corpus-clones.json`. Depends on: T005. No path overlap with T011.

- [X] T013 [P] Initialize `<EVIDENCE_DIR>` and its fixed file manifest (`research.md` R3).
  Create the session-scoped evidence artifacts directory (never a path under this
  repository's working tree) and pre-register (as empty placeholders, populated by later
  tasks) every file `research.md` R3 names:
  `spike-009-evidence.{md,json}`,
  `reference-oracle.json`,
  `parsing-validation-results.json`, `identity-canonicalization-results.json`,
  `atomic-failure-records.json`, `repository-identity-checks.json`, `identity-only-results.json`,
  `structural-edge-case-fixtures.json`, `dotfile-policy-confirmation.json`, `network-denial.json`,
  `mutation-baselines.json`,
  `input-manifest.{community-plugins,rhdh-plugins,synthetic}.json`,
  `snapshot-envelope.{community-plugins,rhdh-plugins,synthetic}.json`,
  `envelope-fixtures/{malformed-invalid-json,malformed-missing-or-wrong-field,malformed-unrecognized,malformed-missing-source-digest,malformed-identity-only,tampered,stale,wrong-repository,second-repository}.json`,
  `comparison-matrix.json`, `scale-evidence.json`, `git-status-captures/`. Depends on: T004
  only. No path overlap with T007–T010.

- [X] T014 Author and freeze the reference oracle and its inputs (secret
  scrubbing; mutation-baseline bracketing — `research.md` R2/R10/R11; `data-model.md`
  §21.5). **Before any generator output exists**, and as a self-contained input set that
  does **not** depend on the later US1 generator fixtures (T017–T024): (1) author the
  maintainer's synthetic explicit `adrkit.io/owned-paths` annotation inputs plus the
  relevant descriptors drawn from FR-001's pinned public corpora into
  `<EVIDENCE_DIR>/reference-oracle-inputs/`; (2) compute and record a SHA-256 for every
  oracle input file into `<EVIDENCE_DIR>/reference-oracle-inputs.sha256`; (3) write the
  frozen `<EVIDENCE_DIR>/reference-oracle.json` — the hand-labeled expected entity→path
  outcomes — covering positive, negative, overlap, absent/empty, collision (duplicate
  canonical ID), and repository-mismatch case classes, with expected false-positive and
  false-negative counts set to zero over those bounded labeled cases; and (4) record the
  SHA-256 of `reference-oracle.json` itself. The oracle and its inputs are **frozen**
  after this task: no later task may edit them. Independent audit of this frozen set is a
  **separate** task (T014a) and MUST complete before any generator/derivation output.
  Then write a single reusable
  capture helper under
  `<EVIDENCE_DIR>/capture.sh` that, given a command line and working directory: (a) runs `git
  status --porcelain=v1` immediately before, in both `<THIS_REPO>` and whichever scratch
  repository is relevant to that invocation; (b) runs the command under the T006 network-denial
  mechanism, with no credential or bearer-token environment variable set; (c) captures
  stdout/stderr verbatim to `<EVIDENCE_DIR>/transcripts/<label>.stdout`/`.stderr` and records
  the exit code; (d) runs `git status --porcelain=v1` immediately after, in the same
  location(s); (e) computes `MutationBaseline.identical` (`data-model.md` §21) as the
  before/after comparison; (f) runs a mechanical grep pass over every captured file for the
  secret-shaped pattern list (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `_AUTH`) before any
  transcript is considered final — a match halts finalization and requires manual review
  before the transcript may be trusted. Every later invocation task in Phases 3–9 that runs a
  derivation/consumer probe uses this harness rather than improvising its own capture. Depends
  on: T011, T012, T013.

- [X] T014a Independent pre-output audit of the frozen reference oracle. Depends on: T014.
  **A fresh-context reviewer other than the oracle's author** (the maintainer acting in a
  distinct review capacity, or a fresh-context review agent) audits the frozen
  `reference-oracle.json` and its hashed inputs **before any generator output is produced**:
  confirm the six case classes are all present and correctly labeled; confirm the bounded
  zero-FP/zero-FN expectation is internally coherent with the labeled inputs; confirm the
  recorded input SHA-256s match the files on disk (the set is genuinely frozen). Record the
  reviewer identity, an explicit PASS/FAIL verdict, the audited `reference-oracle.json`
  SHA-256, and the timestamp to `<EVIDENCE_DIR>/reference-oracle-audit.json`. **If the verdict
  is FAIL, STOP**: no generator/derivation output may be produced; the oracle must be corrected
  and re-frozen (a new T014/T014a cycle) first. This task exists so the "frozen, independently
  audited before generator output" property (FR-025) is mechanically enforced by task order,
  not merely self-attested.

  > **PR #37 review remediation:** the run that produced `reference-oracle-audit.json` used
  > "Independent fresh-context Claude Sonnet 4.6" as its reviewer identity — this is
  > independent/fresh-context as the task's own text requires, but it violates the session's
  > explicit top-level instruction that this specific audit role ("frozen-oracle audit") MUST
  > use Claude Opus 4.8 or GPT-5.6 Sol, never Opus 4.6 (nor, by the same instruction's intent,
  > any other non-designated model). Per the same honest-checkbox principle applied elsewhere
  > in this remediation round (and mirroring feature008's T005 precedent for a
  > selection-criterion violation caught by review), this is disclosed rather than left
  > silent. Because a **genuinely compliant remediation rerun has now been performed and
  > passed** — a fresh Claude Opus 4.8 sub-agent, with no prior authoring involvement,
  > independently recomputed all ten input file hashes and the oracle's own hash (all match),
  > re-derived all six case classes from raw fixture bytes against every relevant contract,
  > and returned **PASS**, recorded to
  > `<EVIDENCE_DIR>/reference-oracle-audit.opus48.json` — this task remains `[X]`: the
  > property this task exists to enforce (a genuinely independent, compliant, PASS-verdict
  > pre-output audit exists) is now truly satisfied, and `reference-oracle-audit.opus48.json`
  > is the authoritative record for T016's gate check (the original Sonnet 4.6 file is
  > preserved unmodified as an honest historical record, not deleted). The compliant rerun
  > also disclosed one genuine, non-verdict-changing finding the Sonnet 4.6 run missed: the
  > oracle's `positive` case records `derivedPathPatterns` in input order rather than the
  > `compareCodeUnits`-sorted order `owned-paths-annotation.md` §3 mandates for the
  > `explicit-paths` derived array (`["apis/payments/**", "packages/payments/**"]`, not
  > `["packages/payments/**", "apis/payments/**"]`). This does not change the case class,
  > discriminator, or accept/reject outcome for any case, and this spike's own scratch
  > tooling never diffs generator output against these oracle fixture files by name (the
  > oracle is a maintainer-authored, pre-generator-output ground-truth reference per FR-025,
  > not an executed test harness in this spike) — it is disclosed here for legibility and
  > left uncorrected in the already-frozen oracle rather than risk any appearance of
  > backfilling a frozen artifact after generator/derivation work has already run against it.

- [X] T015 [P] Document and rehearse the mid-run-failure recovery procedure (`research.md`
  R11) to `<EVIDENCE_DIR>/recovery-procedure.md`: if a derivation run aborts partway (expected
  for every atomic-fail-closed test case in User Story 2 and elsewhere), the recovery action is
  simply to discard that run's scratch inputs/outputs and re-run from a clean scratch
  directory for the next test case — **never** to "patch" a partially-written envelope file
  into a valid one, since `contracts/atomic-fail-closed.md` itself requires "no usable partial
  snapshot" ever exist in the first place. Depends on: T004 only. No path overlap with
  T007–T013.

- [X] T016 Checkpoint: Foundational complete. Depends on: T005, T006, T007, T008, T009, T010,
  T011, T012, T013, T014, T014a, T015. Confirm all outputs exist and are internally consistent
  (e.g. each `StandaloneScratchRepository`'s `purpose` in `scratch-workspaces.json` is unique
  and matches the three distinct repository roles this phase created), **and that
  `reference-oracle-audit.json` records a PASS verdict for the frozen oracle (T014a)**. No User
  Story task below may begin until this checkpoint is confirmed — therefore **no
  generator/derivation output is produced until the frozen reference oracle has been
  independently audited PASS before any output** (FR-025).

---

## Phase 3: User Story 1 — Prove Option A's Annotation Contract Parses, Validates, and Canonicalizes Exactly as Hardened (Priority: P1) 🎯 MVP

**Goal**: The hardened `adrkit.io/owned-paths` contract, fed every per-pattern validation rule
the maintainer ratified, produces the exact, deterministic outcome the hardened contract
specifies for each — never a looser interpretation of either dated decision.

**Independent Test** (`spec.md` User Story 1): Run the same fixture set through the Option A
parser three or more times and confirm byte-identical sorted, deduplicated output every time
for valid fixtures; confirm the case-only duplicate is a duplicate-ID failure, never silently
merged; confirm the default-namespace substitution; confirm `explicit-empty` and
`annotation-absent` are recorded as two distinct, never-conflated states.

Depends on: T016 (Foundational checkpoint).

- [X] T017 [P] [US1] Author the valid multi-pattern fixture in
  `<GENERAL_SCRATCH>/fixtures/us1-valid-multi-pattern.yaml` (Acceptance Scenario 1):
  `adrkit.io/owned-paths: '["packages/payments/**","apis/payments/**"]'`. No path overlap with
  T018–T024.

- [X] T018 [P] [US1] Author, in `<GENERAL_SCRATCH>/fixtures/us1-rejection-<rule>.yaml` (one file
  per rule), the fourteen per-pattern rejection fixtures in `contracts/glob-dialect.md` §3's
  fixed order — `empty` (`""`), `leading-slash` (`/packages/**`), `absolute-or-drive-or-unc`
  (`C:\packages\**` or `\\server\share`), `backslash` (`packages\payments`), `nul-or-control-char`
  (a pattern containing a literal NUL or `0x7F`), `brace` (`packages/{a,b}/**`), `bracket`
  (`packages/[ab]/**`), `parenthesis` (`packages/@(a|b)/**`), `comma` (`packages/a,b/**`),
  `leading-bang` (`!packages/**`), `traversal-segment` (`packages/../etc`), `empty-segment`
  (`packages//payments`), `disallowed-character` (`packages/foo@bar/**` — closes the gap a pure
  blacklist cannot), and `malformed-double-star` (`packages/a**b`) — each violating **exactly
  one** rule so the predicted single reason is unambiguous. Depends on: T007. No path overlap
  with T017, T019–T024.

- [X] T019 [P] [US1] Author the shape/parse-error/non-string-value fixtures (FR-003; `spec.md`
  Edge Cases; `contracts/owned-paths-annotation.md` §1/§3) in
  `<GENERAL_SCRATCH>/fixtures/us1-shape-<case>.yaml`: `wrong-shape-object` (`'{"paths":
  ["a/**"]}'`), `wrong-shape-bare-string` (`'"packages/payments/**"'`), `wrong-shape-non-string-element`
  (`'["packages/payments/**", 3]'`), `parse-error` (`'["packages/payments/**"'` — missing
  closing bracket), `annotation-value-not-a-string` (a YAML sequence or mapping node authored
  directly under the annotation key, never a quoted JSON-in-a-string), and the single-element
  empty-string edge case `["", "packages/**"]` (distinct from `explicit-empty`'s `[]` — rejected
  per the `empty` per-pattern rule, not this file's own shape rule, but authored here for
  completeness of the shape/edge-case fixture set). Depends on: T007. No path overlap with
  T017, T018, T020–T024.

- [X] T020 [P] [US1] Author the case-only duplicate canonical-ID fixture (Acceptance Scenario
  3) in `<GENERAL_SCRATCH>/fixtures/us1-duplicate-id-case-only.yaml`: two descriptors, one with
  `kind: Component`, `namespace: Default`, `name: Payments`, and one with `kind: component`,
  `namespace: default`, `name: payments` — both canonicalize to `component:default/payments`.
  Depends on: T007. No path overlap with T017–T019, T021–T024.

- [X] T021 [P] [US1] Author the default-namespace-omission fixture (Acceptance Scenario 4) in
  `<GENERAL_SCRATCH>/fixtures/us1-default-namespace.yaml`: one descriptor with `kind:
  component`, `metadata.namespace` entirely omitted, `name: billing`, and a sibling with
  `namespace: default`, `name: billing` explicitly — both must canonicalize to
  `component:default/billing`. Depends on: T007. No path overlap with T017–T020, T022–T024.

- [X] T022 [P] [US1] Author the `explicit-empty`/`annotation-absent` fixture pair (Acceptance
  Scenario 5) in `<GENERAL_SCRATCH>/fixtures/us1-explicit-empty.yaml` (`adrkit.io/owned-paths:
  '[]'`) and `<GENERAL_SCRATCH>/fixtures/us1-annotation-absent.yaml` (the annotation key wholly
  absent from `metadata.annotations`). Depends on: T007. No path overlap with T017–T021,
  T023–T024.

- [X] T023 [P] [US1] Author the three-way alias-collision fixture (Acceptance Scenario 7) in
  `<GENERAL_SCRATCH>/fixtures/us1-alias-collision.yaml`: entity 1 with canonical ID
  `component:default/billing` and a fixture-authored alias ref `component:default/billing-legacy`
  (per FR-006, supplied directly in the fixture's own `refs` array); entity 2 whose own
  canonical ID is `component:default/billing-legacy` (colliding with entity 1's *alias*, not its
  ID); entity 3 with ref `Component:Default/Billing-Legacy` (the case-only variant of that same
  collision). Depends on: T007. No path overlap with T017–T022, T024.

- [X] T024 [P] [US1] Author the two-distinct-entities overlapping-glob fixture (Acceptance
  Scenario 8) in `<GENERAL_SCRATCH>/fixtures/us1-overlapping-glob.yaml`: `component:default/billing`
  and `component:default/invoicing`, distinct canonical IDs, both declaring
  `packages/shared/**` among their `owned-paths`. Depends on: T007. No path overlap with
  T017–T023.

- [X] T025 [US1] Run the decode-then-validate pipeline (`contracts/owned-paths-annotation.md`
  §1) and the fixed-order glob validator (`contracts/glob-dialect.md` §3) against T017's valid
  fixture and T020–T024's collision/overlap fixtures **three or more times each**. For T017:
  confirm byte-identical sorted, deduplicated output every time
  (`["apis/payments/**","packages/payments/**"]`), compiling each accepted pattern exactly once
  per run (`contracts/glob-dialect.md` §6). For T020–T024: confirm each is run through the same
  canonicalization/uniqueness pipeline (never treated as producing valid `paths` output, since
  each is a collision/overlap classification test, not a determinism test) with consistent
  classification across all three-or-more runs. Record to
  `<EVIDENCE_DIR>/parsing-validation-results.json` (populates
  `EvidenceBundle.parsingValidationResults`, `data-model.md` §22). Depends on: T017, T020, T021,
  T022, T023, T024.

- [X] T026 [US1] Run the same pipeline against T018's fourteen per-pattern rejection fixtures
  and T019's shape/parse-error/non-string-value fixtures, individually, in isolation
  (Acceptance Scenario 2's own "in isolation" wording — whole-operation atomicity for a mixed
  batch is User Story 2's concern, not this task). Confirm each reports **exactly** the one
  rule-specific reason `contracts/glob-dialect.md` §3's fixed fifteen-step order predicts —
  never a different reason, and never more than one reason for a pattern that happens to
  violate multiple rules (the fixed order is never reversed or permuted; the first rule that
  matches in that exact sequence is always the one reported, deterministically, regardless of
  implementation). Confirm the single-element-empty-string case
  (`["", "packages/**"]`, from T019) is rejected per the `empty` per-pattern rule specifically
  — distinct from, and never conflated with, the `explicit-empty`/`annotation-absent`
  distinction T029 separately confirms. Confirm the `annotation-value-not-a-string` fixture
  (T019) is classified by the explicit **string-scalar check** (`contracts/owned-paths-annotation.md`
  §1 step 2, `data-model.md` §1's `rawYamlValueIsString`) **before** `JSON.parse` is ever
  reached — never coerced through `JSON.parse`'s `ToString` (e.g. a one-element sequence
  `["[]"]` must not be silently accepted as `explicit-empty`) — and that `annotation-absent` is
  decided from the `annotationPresent === false` discriminant, never from a `rawValue` being
  `undefined` (which is ambiguous between absent and present-but-non-string). Record to
  `<EVIDENCE_DIR>/parsing-validation-results.json`. Depends on: T018, T019.

- [X] T027 [US1] Confirm T020's case-only duplicate-ID pair is classified
  `"duplicate-canonical-id"` (never `"duplicate-canonical-ref"`, which is reserved for an
  alias colliding with a different entity's ID or another alias) — not silently merged, and
  not resolved by first-wins/last-wins. Record to
  `<EVIDENCE_DIR>/identity-canonicalization-results.json` (populates
  `EvidenceBundle.identityCanonicalizationResults`, `data-model.md` §22). Depends on: T020,
  T025.

- [X] T028 [US1] Confirm T021's default-namespace-omission descriptor canonicalizes using
  Backstage's own `default` namespace constant (matching `stringifyEntityRef`'s own
  default-namespace substitution, `packages/catalog-model/src/entity/ref.ts` at the pinned
  Backstage commit) before lowercasing — not an empty or omitted namespace segment — and that
  both siblings in T021's fixture resolve to the identical canonical ID
  `component:default/billing`. Record to
  `<EVIDENCE_DIR>/identity-canonicalization-results.json`. Depends on: T021, T025.

- [X] T029 [US1] Confirm T022's three ownership states — the valid non-empty fixture from
  T017, the `explicit-empty` fixture, and the `annotation-absent` fixture — are labeled,
  respectively, `explicit-paths`, `explicit-empty`, and `annotation-absent`, and that no two of
  the three are ever treated as equivalent to one another anywhere in the evidence bundle
  (`contracts/owned-paths-annotation.md` §3's non-conflation rule). Record to
  `<EVIDENCE_DIR>/parsing-validation-results.json`. Depends on: T017, T022, T025.

- [X] T030 [US1] Confirm T023's three-way alias-collision fixture produces a
  `"duplicate-canonical-ref"` classification for **every one** of the three pairings
  (alias-vs-ID, and the case-only variant of it) — never silently merged, and never treated as
  acceptable merely because the collision involves an alias rather than a primary ID
  (`contracts/entity-identity.md` §3's own explicit requirement). Record to
  `<EVIDENCE_DIR>/identity-canonicalization-results.json`. Depends on: T023, T025.

- [X] T031 [US1] Positively demonstrate the "no exclusive winner" rule using T024's fixture
  (`contracts/entity-identity.md` §4; FR-031): confirm the run **succeeds** (this is never a
  duplicate-ID/duplicate-ref condition and never triggers an atomicity abort), both entities'
  derived `paths` retain the overlapping `packages/shared/**` pattern, and a changed file
  matching that pattern is recorded as owned by **both** entities simultaneously — never merely
  asserted by the absence of a rejection rule. Record to
  `<EVIDENCE_DIR>/identity-canonicalization-results.json`. Depends on: T024, T025.

- [X] T032 [US1] Run the same decode-then-validate pipeline against the real
  `<COMMUNITY_PLUGINS_CLONE>`'s 156 sampled `catalog-info.yaml`/`.yml` descriptors. Confirm
  every one of the 156 is recorded `annotation-absent` — never inferred from its descriptor's
  location — and confirm the exact figures **23 of 156** carry any `metadata.annotations`
  block at all, and **0 of 156** carry `adrkit.io/owned-paths`, recorded verbatim in the
  evidence bundle (FR-015; SC-007). Record to
  `<EVIDENCE_DIR>/parsing-validation-results.json`. Depends on: T016 (Foundational
  checkpoint — which requires the T014a pre-output oracle audit to PASS; a real-corpus
  derivation run is generator output and MUST NOT precede the frozen-oracle audit).

**Checkpoint**: User Story 1 complete. Option A's mechanical soundness is proven against its
own current, hardened contract — every per-pattern rule, every collision kind, the
default-namespace substitution, and the three-way ownership discriminator — matching all 8
Acceptance Scenarios. This alone can already produce a `no-go` if any validation rule proved
unenforceable.

---

## Phase 4: User Story 2 — Prove the Repository-Boundary Manifest and Whole-Operation Atomic Fail-Closed Semantics (Priority: P1)

**Goal**: A repository mismatch aborts generation before any path is derived, and introducing
exactly one invalid entity into an otherwise-valid batch aborts the **entire** snapshot
operation — never a snapshot that silently omits or skips the bad entity.

**Independent Test** (`spec.md` User Story 2): Using `<SYNTHETIC_REPO>` (never a linked
worktree of this actual repository, whose `origin` cannot be independently varied), construct
a matching manifest and confirm five-entity generation succeeds; add one duplicate-ID entity
and confirm the six-entity run aborts non-zero with no usable partial snapshot; construct a
manifest whose declared repository ID/revision does not match `<MISMATCH_REPO>`'s actual
`origin`/`HEAD` and confirm it aborts before deriving any paths.

Depends on: T016 (Foundational checkpoint). Independent of Phase 3 — builds its own manifest
and its own six-entity batch, not Phase 3's fixture set (though it may reuse T020's duplicate-ID
pattern for its sixth entity, per the Independent Test's own suggestion).

- [X] T033 [US2] Read `<SYNTHETIC_REPO>`'s actual `git remote get-url origin` (normalized to
  lowercase `github.com/<owner>/<repo>` per `research.md` R6's exact algorithm) and `git
  rev-parse HEAD`, via separate git tooling — never by re-reading the manifest file under test.
  Construct `<EVIDENCE_DIR>/input-manifest.synthetic.json` (`contracts/input-manifest.md` §1)
  declaring the exact matching repository ID/revision, `manifestSchemaVersion: "1"`,
  `requestedSnapshotSchemaVersion: "1"`, `requiredCapabilities: ["pathOwnership"]`, and
  `sources` naming five valid synthetic entity descriptor files (fresh, distinct from Phase 3's
  fixture set, or a reused subset — either is acceptable) with their SHA-256 digests. Depends
  on: T008.

- [X] T034 [US2] Run generation against the five valid entities with T033's matching manifest.
  Confirm one complete `SnapshotEnvelope` is produced naming that exact repository ID and
  revision (Acceptance Scenario 1). Record `RepositoryIdentityCheck` (`data-model.md` §4) with
  `outcome: "match"` to `<EVIDENCE_DIR>/repository-identity-checks.json` (populates
  `EvidenceBundle.repositoryIdentityChecks`). Depends on: T033.

- [X] T035 [US2] Add a sixth entity with a duplicate canonical ID (reusing T020's case-only
  duplicate pattern, or a fresh equivalent) to the same five-entity batch. Run generation
  **once** over all six entities in one invocation. Confirm the run exits non-zero and that
  **no snapshot** — not even one covering the five otherwise-valid entities — was produced or
  is usable; confirm the evidence bundle explicitly records this, distinguishing it from a
  hypothetical (and explicitly rejected) partial-success outcome (Acceptance Scenario 2;
  `contracts/atomic-fail-closed.md` §3's worked example). Record `AtomicFailureRecord`
  (`data-model.md` §6) with `triggerClass: "duplicate-canonical-id"`, `runAborted: true`,
  `partialSnapshotProduced: false` to `<EVIDENCE_DIR>/atomic-failure-records.json` (populates
  `EvidenceBundle.atomicFailureRecords`). Depends on: T034.

- [X] T036 [US2] Construct manifests exercising `contracts/input-manifest.md`'s manifest-level
  rejection classes, each violating **exactly one**: the three §2 version/capability classes —
  `manifestSchemaVersion: "2"`; `requestedSnapshotSchemaVersion: "2"`; a `requiredCapabilities`
  entry other than `"pathOwnership"` (e.g. `["pathOwnership", "sync"]`) — plus a manifest listing
  a descriptor path/digest absent from the actual fixture set on disk (an "incomplete required
  source" — digest mismatch, §4), plus a **structurally malformed** manifest (an
  `invalid-manifest-shape` case: e.g. `sources` not an array, a non-40-hex `repository.revision`,
  or an unrecognized top-level field — the closed-schema violation §1 forbids). Run generation
  for each. Confirm each aborts non-zero with no usable partial snapshot **before deriving any
  entity's paths** — all are properties of the manifest/generation request itself, never of an
  individual entity within a batch (Acceptance Scenario 4). Record `AtomicFailureRecord`s with
  `triggerClass` `"unsupported-manifest-version"`, `"unsupported-snapshot-version"`,
  `"unsupported-capability"`, `"incomplete-required-source"`, and `"invalid-manifest-shape"`
  respectively, to `<EVIDENCE_DIR>/atomic-failure-records.json`. **Additionally**, construct
  source-path-escape manifests exercising `contracts/input-manifest.md` §4.1's two-stage
  source-path validation: (a) a lexically-invalid source `path` (an absolute path or leading `/`,
  a `..` traversal segment, a drive/UNC/backslash form, or a control character) rejected by the
  pre-open lexical pass; and (b) a lexically-clean source `path` that is a symlink whose
  `realpath` target resolves **outside** the verified checkout root, rejected fail-closed by the
  confined-realpath pass — confirm neither file is ever opened, and record each as an
  `"incomplete-required-source"` `AtomicFailureRecord` (`triggeringEntityOrSource` naming the
  offending path), proving the repository boundary is enforced by path handling, not merely
  assumed from the "repo-relative" label. Depends on: T033.

- [X] T037 [US2] Read `<MISMATCH_REPO>`'s actual `origin`/`HEAD` via separate git tooling.
  Construct a manifest declaring a repository ID/revision that does **not** match. Run
  generation. Confirm it aborts on repository mismatch **before deriving any entity's paths**,
  non-zero, with a reason naming the mismatch — the comparison is manifest-vs-separately-read-
  checkout-identity, never manifest-vs-anything-inferred-from-the-descriptors, and never
  satisfiable by running inside a linked worktree of this actual repository (Acceptance
  Scenario 3). Record `RepositoryIdentityCheck` with `outcome: "repository-mismatch"` (or
  `"revision-mismatch"`/`"repository-and-revision-mismatch"` as the specific test case
  requires) to `<EVIDENCE_DIR>/repository-identity-checks.json`. Separately, cite
  `redhat-developer/rhdh-plugins`'s three non-identical `github.com/project-slug` values (Phase
  5's T040) as additional evidence for why repository identity comes from an explicit manifest
  rather than any inferred annotation (Acceptance Scenario 5) — this citation may be added once
  T040 exists; note the forward reference here rather than duplicating the finding. Depends on:
  T009.

**Checkpoint**: User Story 2 complete. The hardened contract's atomicity and repository-boundary
guarantees are proven as whole-operation properties, distinct from Phase 3's per-rule
validation — the single most consequential correction the hardening decision made to the
initial ratification.

---

## Phase 5: User Story 3 — Measure Descriptor-Parent (B) and Repository-Root (C) as Labeled Heuristics Only, Never as Ground Truth (Priority: P1)

**Goal**: B and C are measured over both pinned real corpora (cardinality/collision findings
only, since neither carries ground truth) and over a spike-authored synthetic labeled matrix
(a genuine precision/false-positive comparison) — every output row carries an explicit
non-authoritative label.

**Independent Test** (`spec.md` User Story 3): Run B and C against every sampled descriptor in
both corpora, confirming every row is labeled `non-authoritative`; build a ≥10-entity labeled
matrix guaranteeing both a labeled-true and labeled-false example per entity; compute
`precision`/`falsePositiveRate` per heuristic, recording
`undefined-for-this-heuristic-on-this-matrix` for any zero-denominator metric without
suppressing the other heuristic's defined metric.

Depends on: T016 (Foundational checkpoint).

- [X] T038 [P] [US3] Apply the descriptor-parent (B) and repository-root (C) heuristics to
  every one of `<COMMUNITY_PLUGINS_CLONE>`'s 156 sampled descriptors
  (`contracts/comparison-heuristics.md` §2). Confirm zero descriptors sit at the repository
  root, so C assigns the identical `**` glob to every one of the 156 entities (a single,
  indistinguishable candidate path set across the whole corpus — recorded as a
  collision/cardinality finding, never a precision figure). Confirm the three sibling
  descriptors `workspaces/adr/plugins/adr/catalog-info.yaml`,
  `workspaces/adr/plugins/adr-backend/catalog-info.yaml`, and
  `workspaces/adr/plugins/adr/examples/component/catalog-info.yaml` produce three different
  granularities under B (Acceptance Scenarios 1–2). Confirm **every** output row carries
  `authoritativeLabel: "non-authoritative"` (FR-002, unconditionally). Record
  `ComparisonHeuristicMeasurement[]` (`data-model.md` §13) with `measurementLevel:
  "real-corpus-cardinality"`, `corpusOrFixtureSet: "community-plugins"` to
  `<EVIDENCE_DIR>/comparison-matrix.json` (the `ComparisonHeuristicMeasurement[]` portion of
  that file, which `EvidenceBundle.comparisonMatrix` references). Depends on: T011. No path overlap with
  T039–T041.

- [X] T039 [P] [US3] Apply the same two heuristics to every one of `<RHDH_PLUGINS_CLONE>`'s 38
  sampled descriptors (by exact basename — never 39). Confirm C would still bind all 37 other
  descriptor-derived entities to the same repository-wide path set as the repository-root
  entity itself (`metadata.name: rhdh-plugins`) — a collision named explicitly, not smoothed
  over because a root descriptor happened to exist (Acceptance Scenario 3). Confirm every
  output row carries `authoritativeLabel: "non-authoritative"`. Record to
  `<EVIDENCE_DIR>/comparison-matrix.json` with `corpusOrFixtureSet: "rhdh-plugins"`. Depends
  on: T012. No path overlap with T038, T040, T041.

- [X] T040 [P] [US3] Record `<RHDH_PLUGINS_CLONE>`'s three non-identical `github.com/project-slug`
  values as the required "stale project slug" evidence (FR-014): `redhat-developer/rhdh-plugins`
  at the repository root (matching the actual GitHub owner), `red-hat-developer-hub/rhdh-plugins`
  at `workspaces/orchestrator/catalog-info.yaml`, and
  `red-hat-developer-hub/backstage-plugins` at both
  `workspaces/orchestrator/plugins/orchestrator-backend/catalog-info.yaml` and
  `workspaces/bulk-import/catalog-info.yaml` — two of the three do not match the actual GitHub
  organization. Record this as evidence against **any** authoritative inference from this
  field, including repository-identity inference specifically (Acceptance Scenario 4) — the
  narrower framing the hardening decision adopted over the initial "path-ownership inference
  only" framing. Record to `<EVIDENCE_DIR>/comparison-matrix.json`. Depends on: T012. No path
  overlap with T038, T039, T041.

- [X] T041 [P] [US3] Build the synthetic labeled entity × changed-file matrix
  (`contracts/comparison-heuristics.md` §3) in `<GENERAL_SCRATCH>/fixtures/us3-labeled-matrix.json`:
  at least 10 synthetic entities, each with a spike-authored `adrkit.io/owned-paths` value, and
  a finite, spike-authored labeled entity × changed-file matrix constructed to guarantee both a
  labeled-true and a labeled-false example for every entity (so `TP + FP + TN + FN` covers
  every combination the matrix needs). Every label is assigned by the fixture's own
  construction, never derived from any heuristic. Depends on: T007. No path overlap with
  T038–T040.

- [X] T042 [US3] Apply B and C to T041's matrix. Classify every (entity, changed-file) pair as
  TP (predicted true, labeled true), FP (predicted true, labeled false), TN (predicted false,
  labeled false), or FN (predicted false, labeled true). Compute `precision = TP / (TP + FP)`
  and `falsePositiveRate = FP / (FP + TN)` per heuristic. **Zero-denominator handling**: if
  either denominator is zero for a given heuristic, record that specific metric as the literal
  string `"undefined-for-this-heuristic-on-this-matrix"` — never a divide-by-zero, never
  silently omitted — and confirm an undefined metric for one heuristic never suppresses
  reporting the other heuristic's defined metric on the same matrix (Acceptance Scenario 5).
  Every row under `measurementLevel: "synthetic-precision"` MUST be explicitly labeled as
  measured against a spike-authored proxy oracle, never external-adopter maturity
  evidence, and therefore insufficient by itself to claim external / community validation or
  optional externally-validated maturity (SC-012).
  Record `LabeledEntityChangedFilePair[]` (`data-model.md` §14) to
  `<EVIDENCE_DIR>/comparison-matrix.json` (the labeled-matrix portion of that file, which
  `EvidenceBundle.comparisonMatrix` references). Depends
  on: T041.

**Checkpoint**: User Story 3 complete. The trade-off issue #25 predicted is demonstrated with
real numbers where real numbers are available (both corpora's cardinality/collision findings),
and with an honestly-labeled synthetic proxy where they are not (the labeled matrix's
precision/false-positive-rate figures).

---

## Phase 6: User Story 4 — Measure Identity-Only Normalization (D) and Confirm It Does Not Unlock Current Matching (Priority: P2)

**Goal**: An entity with empty or absent `paths` never activates a changed-file match through
adrkit's real, unmodified core code — confirmed with the precise returned shape, not a
re-implementation.

**Independent Test** (`spec.md` User Story 4): Build `CatalogSnapshot` fixtures whose entities
carry `refs` (from Option D normalization) but no `paths`; feed them, alongside a normal Option
A fixture that does match, to the existing, unmodified `resolveAffects`/`matchEntityPattern`
functions in `packages/core/src/affects/`; confirm the entity matcher never matches for the
Option-D-only entities, and does match for the Option A entity, in the same pass.

Depends on: T016 (Foundational checkpoint).

- [X] T043 [US4] Build `CatalogSnapshot` fixtures in
  `<GENERAL_SCRATCH>/fixtures/us4-identity-only.json` whose entities carry `id`/`refs` from
  Option D normalization (drawn from `<COMMUNITY_PLUGINS_CLONE>`/`<RHDH_PLUGINS_CLONE>`
  identity normalization, plus a synthetic entity) but **no** `paths` field (empty or
  omitted). Depends on: T011, T012.

- [X] T044 [US4] Feed T043's Option-D-only entities, **in the same run** as T017's Option A
  entity (populated `paths` covering a changed-file list T017's own `owned-paths` values
  match), to the **existing, unmodified** `matchEntityPattern`/`entitiesForPaths`
  (`packages/core/src/affects/inert.ts` — read only, never modified per FR-020). Confirm every
  Option-D-only entity returns the literal, unmodified `{ matched: false }` shape with
  `unresolvable` **absent** (`undefined`, never explicitly `false` — `inert.ts`'s own
  `matchEntityPattern` only ever sets `unresolvable: true` in its `if (!catalog)` branch, never
  `unresolvable: false`). Record this as `rawCoreReturnValue` (the literal core output) plus a
  separately-labeled, spike-derived `unresolvableFindingAttached: false` diagnostic
  (`data-model.md` §15 — never conflating the two). Confirm, **in the same pass**, the Option A
  entity **does** match — proving the distinction is due to the presence or absence of `paths`,
  not an environment difference between two separate measurements (Acceptance Scenario 2).
  Record `IdentityOnlyEntity[]` to `<EVIDENCE_DIR>/identity-only-results.json` (populates
  `EvidenceBundle.identityOnlyResults`). Depends on: T043, T017.

**Checkpoint**: User Story 4 complete. Option D's real (if narrower) value is confirmed
insufficient on its own to unlock adrkit's current changed-file entity matching, using
adrkit's real code rather than a re-implementation — cheap confirmation of a boundary already
ratified, not new design.

---

## Phase 7: User Story 5 — Exercise Structural Edge Cases Without Violating the "Local Manifest Only" Constraint (Priority: P2)

**Goal**: A genuine multi-document descriptor, a duplicate-YAML-key descriptor, and a
`Location` entity are each exercised via synthetic fixtures, proving the generator's contract
against the format's real structural range while also proving it correctly refuses to chase
references outside its declared input manifest.

**Independent Test** (`spec.md` User Story 5): Author one multi-document fixture, one
duplicate-key fixture, and one `Location` fixture whose target file is deliberately excluded
from the manifest. Confirm the multi-document case parses both entities with no cross-document
leakage; confirm the duplicate-key case is rejected; confirm the `Location` case yields zero
derived paths for the target `Component`, because the generator never reads the file the
`Location` merely points at.

Depends on: T016 (Foundational checkpoint).

- [X] T045 [P] [US5] Author the multi-document fixture (Acceptance Scenario 1) in
  `<GENERAL_SCRATCH>/fixtures/us5-multi-document.yaml`: two `---`-separated YAML documents in
  one file (a `System` and a `Component`), each carrying its own distinct
  `adrkit.io/owned-paths` value. Run derivation. Confirm each entity's derived paths come only
  from its own document's annotation, with **no cross-document leakage**. Record
  `StructuralEdgeCaseFixture` (`data-model.md` §16) with `fixtureKind: "multi-document"`,
  `outcome: "both-entities-parsed-independently"`, `isSynthetic: true`, to
  `<EVIDENCE_DIR>/structural-edge-case-fixtures.json` (populates
  `EvidenceBundle.structuralEdgeCaseFixtures`). No path overlap with T046, T047.

- [X] T046 [P] [US5] Author the duplicate-YAML-key fixture (Acceptance Scenario 2) in
  `<GENERAL_SCRATCH>/fixtures/us5-duplicate-yaml-key.yaml`: two `metadata:` blocks in one
  document. Parse using `yaml@2.9.0`'s own default `uniqueKeys: true` behavior (`research.md`
  R8 — never a bespoke duplicate-key scanner, never `uniqueKeys: false`). Confirm the parse
  throws/rejects, and that this rejection contributes to (rather than being exempt from) the
  whole-operation atomicity proven in Phase 4. Record `StructuralEdgeCaseFixture` with
  `fixtureKind: "duplicate-yaml-key"`, `outcome: "rejected-duplicate-key"` to
  `<EVIDENCE_DIR>/structural-edge-case-fixtures.json`. No path overlap with T045, T047.

- [X] T047 [P] [US5] Author the `Location`-not-followed fixture (Acceptance Scenario 3) in
  `<GENERAL_SCRATCH>/fixtures/us5-location-not-followed.yaml` (the `Location` entity, `kind:
  Location`, `spec.targets` pointing at a second fixture file
  `<GENERAL_SCRATCH>/fixtures/us5-location-target-component.yaml` carrying an actual
  `Component` and its own `adrkit.io/owned-paths` annotation) — but with **only** the
  `Location` file itself named in the input manifest's `sources` array; the second, targeted
  file is deliberately excluded. Run generation using only the manifest-listed files. Confirm
  the target `Component` entity contributes **zero** derived paths, recorded as
  `"zero-derived-paths-never-read"` (`contracts/input-manifest.md` §6) — **never**
  `"invalid-input"` — because the generator never opened the target file to find it, not
  because its annotation was invalid. Separately, note that if the descriptor-parent
  heuristic (B) were applied to this same `Location` fixture, its "parent directory" is not
  meaningfully a path a `Location` entity itself owns — record both facts as independent data
  points for B's unreliability (`contracts/comparison-heuristics.md` §2), never silently
  skipping either. Record `StructuralEdgeCaseFixture` with `fixtureKind:
  "location-not-followed"`, `outcome: "zero-derived-paths-never-read"` to
  `<EVIDENCE_DIR>/structural-edge-case-fixtures.json`. No path overlap with T045, T046.

- [X] T048 [US5] Directly execute `picomatch@4.0.5` with the frozen options (`{ dot: false,
  nocase: false, nonegate: true }`) against `.github/**` and, separately, a bare `**` and a
  plain `packages/**`, each against the changed-file path `.github/workflows/ci.yml`
  (Acceptance Scenario 4; `contracts/glob-dialect.md` §4). Confirm `.github/**` matches and
  both `**` and `packages/**` do not — matching the hardened contract's explicit dotfile policy
  exactly. Record this as `picomatch`'s existing native `dot: false` behavior, requiring **zero
  new code**, not a design choice either existing core matcher had to make — while explicitly
  recording that `packages/core/src/affects/matchers/path.ts` and
  `packages/core/src/affects/inert.ts` are **not** identical at the source-code level
  (`path.ts` carries its own additional, redundant `hasDotSegment`/`patternAllowsDotSegment`
  guard that `inert.ts` lacks); only observed **behavioral** parity for the tested cases is ever
  claimed, never source-code equivalence. Record `DotfilePolicyConfirmation`
  (`data-model.md` §17) to `<EVIDENCE_DIR>/dotfile-policy-confirmation.json` (populates
  `EvidenceBundle.dotfilePolicyConfirmation`). Depends on: T016 only (no dependency on
  T045–T047).

**Checkpoint**: User Story 5 complete. Option A's contract is proven against structural shapes
the Backstage descriptor format allows, and the generator correctly refuses to chase references
outside its declared input manifest.

---

## Phase 8: User Story 6 — Prove Deterministic Ordering and Produce the Required Versioned Snapshot Envelope With Scale Evidence (Priority: P1)

**Goal**: Each of the three single-repository generation passes (community-plugins-derived,
rhdh-plugins-derived, primary synthetic — never merged across passes, per FR-009) produces
byte-identical output across 3+ runs, one populated `SnapshotEnvelope` from an actual run, and
per-pass scale evidence, aggregated in the evidence bundle with attribution preserved.

**Independent Test** (`spec.md` User Story 6): For each of the three passes, run the full
derivation (Option A plus the B/C/D measurements) three or more times against identical fixture
inputs and diff the outputs (byte-identical within a pass; cross-pass byte-identity is neither
expected nor required). Produce one concrete envelope document per pass from an actual run.
Measure and record scale evidence per pass, then aggregate into one combined summary with
per-pass attribution preserved.

Depends on: T016 (Foundational checkpoint), T032 (community-plugins corpus already read in
Phase 3), T039 (rhdh-plugins corpus already read in Phase 5), and the Task-Level Design
Decision above (primary-synthetic pass composition).

### Community-plugins-derived pass

- [X] T049 [US6] Construct
  `<EVIDENCE_DIR>/input-manifest.community-plugins.json`: `repository.id:
  "github.com/backstage/community-plugins"`, `repository.revision:
  "92e9e4e09c76cc57f3475029b73e5ec84498a459"`, `manifestSchemaVersion: "1"`,
  `requestedSnapshotSchemaVersion: "1"`, `requiredCapabilities: ["pathOwnership"]`, `sources`
  naming all 156 descriptor paths/digests from `<COMMUNITY_PLUGINS_CLONE>`. Verify this
  manifest's declared repository ID/revision against `<COMMUNITY_PLUGINS_CLONE>`'s own actual
  `origin`/`HEAD` (`contracts/input-manifest.md` §3). Depends on: T011.

- [X] T050 [US6] Run the full derivation (Option A plus the B/C/D measurements from Phases 3–6)
  **3 or more times** against T049's identical 156-descriptor input. Diff the outputs. Confirm
  all runs are byte-identical — sort order, deduplication, canonicalization, and
  rejection-reason text — compiling each accepted pattern exactly once **per repetition**
  (`contracts/glob-dialect.md` §6; `contracts/scale-and-security-measurement.md` §2 item 3).
  Depends on: T049.

- [ ] T051 [US6] Produce this pass's populated `SnapshotEnvelope` (`contracts/snapshot-envelope.md`
  §1) from an actual run — schema version `"1"`, `repository: {id:
  "github.com/backstage/community-plugins", revision:
  "92e9e4e09c76cc57f3475029b73e5ec84498a459"}`, generator version, `globDialect: {engine:
  "picomatch", version: "4.0.5", options: {dot: false, nocase: false, nonegate: true}}`,
  `capabilities: ["pathOwnership"]`, `completeness: {wholeCatalog: false, identityOnly:
  false}` (derivation was genuinely attempted for every entity even though all 156 are
  `annotation-absent`, per FR-022's "regardless of the resulting ownership-state distribution"
  rule), `sources`, the deterministic 156-entity list (each entity serialized as
  `data-model.md` §9's `SnapshotEntityRecord`: a nested `identity`
  (`{ canonicalId, allRefs }` — the reduced `SerializedEntityIdentity` projection, never the
  flattened or full §7 object), the `explicit-paths` \| `explicit-empty` \|
  `annotation-absent` discriminator, `derivedPaths`, a `sourceDocument`
  (`{ sourcePath, documentIndexInFile }`), and `provenance`), and the RFC-8785-style canonical
  SHA-256 `digest` computed over every field including `schemaVersion` and excluding only the
  digest field itself. Write to `<EVIDENCE_DIR>/snapshot-envelope.community-plugins.json`.
  Depends on: T050.

  > **PR #37 review correction: T051 is marked incomplete (`- [ ]`).** T050's derivation was
  > genuinely attempted and genuinely ran against the real 156-descriptor community-plugins
  > corpus, but it deterministically, correctly fail-closed-rejected on all 6 repetitions
  > (duplicate-canonical-id — the 5 unsubstituted `${{ values.name | dump }}` template
  > skeletons; see T050's own record and `atomic-failure-records.json`). Per
  > `contracts/atomic-fail-closed.md` §1, a failed run produces **no usable partial
  > snapshot** — there is no entity list, no digest, and no way to honestly populate the
  > `SnapshotEnvelope` shape this task literally requires. What was actually written to
  > `<EVIDENCE_DIR>/snapshot-envelope.community-plugins.json` is a differently-shaped,
  > honest rejection record (`passOutcome:
  > "deterministic-rejection-no-populated-envelope-possible"`), not a populated
  > `SnapshotEnvelope`. Marking this `[X]` would overclaim what happened, contrary to the
  > "mark tasks complete only from observed evidence" rule. This is **not** a claim that
  > T050's run didn't happen or wasn't evidenced (it did, fully, and is recorded) — it is a
  > correction of only this task's own checkbox, matching feature008's T005/T012/T057
  > precedent for an honestly-unmet literal deliverable. T074 explicitly anticipates and
  > names this exact scenario ("the envelope or scale-evidence record (Phase 8) could not be
  > fully populated from an actual run for any pass") as the task-file-recognized driver of
  > the `blocked` verdict's `envelope-or-scale-evidence-incomplete` shortfall — this
  > correction does not change that verdict; it only makes this one task's own status
  > honest. T052 (scale-evidence measurement) is unaffected and remains `[X]`: it depends on
  > T050, not T051, and genuine partial timing data was captured independent of envelope
  > population.

- [X] T052 [US6] Measure and record this pass's scale evidence
  (`contracts/scale-and-security-measurement.md` §1–§2): one fixed candidate changed-file list
  defined before measurement begins; at least 6 total repetitions (1 discarded warm-up + ≥5
  retained); the median of the retained iterations' wall-clock compile+match time plus the
  full retained-iteration list; host OS/CPU architecture/runtime version recorded alongside.
  `annotationBytesTotal: 0` (this corpus carries no annotation). Record `ScaleEvidenceRecord`
  (`data-model.md` §18) with `pass: "community-plugins"`, `productionLimitProposed: false`
  (fixed), to `<EVIDENCE_DIR>/scale-evidence.json`. Depends on: T050.

### Rhdh-plugins-derived pass

- [X] T053 [P] [US6] Construct
  `<EVIDENCE_DIR>/input-manifest.rhdh-plugins.json`: `repository.id:
  "github.com/redhat-developer/rhdh-plugins"`, `repository.revision:
  "3b355ddfedb23c6656bd9effc8510f9926b765c1"`, same fixed manifest fields as T049, `sources`
  naming all 38 descriptor paths/digests from `<RHDH_PLUGINS_CLONE>`. Verify against
  `<RHDH_PLUGINS_CLONE>`'s own actual `origin`/`HEAD`. Depends on: T012. No path overlap with
  T049.

- [X] T054 [US6] Run the full derivation 3+ times against T053's identical 38-descriptor input.
  Diff the outputs. Confirm all runs are byte-identical. Depends on: T053.

- [ ] T055 [US6] Produce this pass's populated `SnapshotEnvelope`, from an actual run, with
  `repository: {id: "github.com/redhat-developer/rhdh-plugins", revision:
  "3b355ddfedb23c6656bd9effc8510f9926b765c1"}` and its own deterministic 38-entity list. Write
  to `<EVIDENCE_DIR>/snapshot-envelope.rhdh-plugins.json`. Depends on: T054.

  > **PR #37 review correction: T055 is marked incomplete (`- [ ]`),** for exactly the same
  > reason as T051 above: T054's derivation genuinely ran against the real 38-descriptor
  > rhdh-plugins corpus and deterministically, correctly fail-closed-rejected (its own
  > independent `duplicate-canonical-id` instance) on all 6 repetitions, so no populated
  > `SnapshotEnvelope` could be honestly produced — only a differently-shaped rejection
  > record exists at `<EVIDENCE_DIR>/snapshot-envelope.rhdh-plugins.json`. See T051's note
  > for the full rationale; it applies here without modification. T056 (scale-evidence
  > measurement) is unaffected and remains `[X]`.

- [X] T056 [US6] Measure and record this pass's scale evidence (same fixed protocol as T052).
  `annotationBytesTotal: 0`. Record `ScaleEvidenceRecord` with `pass: "rhdh-plugins"` to
  `<EVIDENCE_DIR>/scale-evidence.json`. Depends on: T054.

### Primary synthetic pass

- [X] T057 [P] [US6] Construct `<EVIDENCE_DIR>/input-manifest.synthetic.json` for the primary
  synthetic pass: `repository.id`/`repository.revision` matching `<SYNTHETIC_REPO>`'s actual
  `origin`/`HEAD` (T008/T033), `sources` naming exactly the entities the Task-Level Design
  Decision above includes (T017, T021, T022, T024, T045, T047) and no others. Confirm this
  manifest is distinct from T033's own five/six-entity Phase-4 atomicity-test manifest, even
  though both share `<SYNTHETIC_REPO>`'s repository identity — the two are separate generation
  invocations with separate `sources` arrays. Depends on: T008, T017, T021, T022, T024, T045,
  T047. No path overlap with T049, T053.

- [X] T058 [US6] Run the full derivation (Option A plus the B/C/D measurements) 3+ times
  against T057's identical synthetic input set. Diff the outputs. Confirm all runs are
  byte-identical. Depends on: T057.

- [X] T059 [US6] Produce this pass's populated `SnapshotEnvelope`, from an actual run, with
  `repository` matching `<SYNTHETIC_REPO>`'s identity and its own deterministic entity list
  drawn only from the Task-Level Design Decision's included set. Write to
  `<EVIDENCE_DIR>/snapshot-envelope.synthetic.json`. Depends on: T058.

- [X] T060 [US6] Measure and record this pass's scale evidence (same fixed protocol).
  `annotationBytesTotal` is non-zero (this is the only one of the three passes that actually
  carries the annotation). Record `ScaleEvidenceRecord` with `pass: "synthetic"` to
  `<EVIDENCE_DIR>/scale-evidence.json`. Depends on: T058.

### Aggregation

- [X] T061 [US6] Aggregate all three passes' `ScaleEvidenceRecord`s (T052, T056, T060) into one
  combined scale-evidence summary in `<EVIDENCE_DIR>/scale-evidence.json`, with **every figure
  clearly attributed to its originating pass** — never merged into an undifferentiated total.
  Confirm `productionLimitProposed: false` on every record (fixed literal) and that the
  evidence bundle explicitly declines to propose a production scale limit from this evidence
  alone, per the hardened contract's "not guessed now" instruction (FR-023). Depends on: T052,
  T056, T060.

**Checkpoint**: User Story 6 complete. Reproducibility and each envelope's actual shape are
demonstrated directly, from actual runs — never a schema sketch — without ever implying a
single snapshot spans more than one repository, and any future production feature inherits
measured scale numbers rather than guessed limits.

---

## Phase 9: User Story 7 — Prove Malformed/Tampered/Stale/Misidentified Snapshot Rejection and Repository Isolation, Using Synthetic Fixtures, Without an Adopter Oracle (Priority: P2)

**Goal**: A consumer correctly rejects a structurally malformed/unsupported, tampered, stale,
or misidentified-repository envelope, and correctly isolates queries across two
independently-valid single-repository envelopes without ever rejecting either — all
demonstrated as offline, mechanical generator/consumer-boundary properties requiring no
external adopter, and explicitly distinguished from external / community validation and the
optional externally-validated maturity.

**Independent Test** (`spec.md` User Story 7): Produce one valid envelope (T059). Construct
malformed, tampered, stale, and wrong-repository derivative copies and confirm each is
rejected for its specific reason, in the correct order relative to the digest/revision/identity
checks. Construct a second, fully independent, valid envelope for a distinct repository and
confirm a tool querying across both, scoped to one, never leaks the other's entities — neither
envelope rejected.

Depends on: T059 (the primary-synthetic pass's valid envelope — every derivative in this phase
is a deliberately mutated **copy** of it, never a fresh independent generation, per `research.md`
R3, so the mutation is auditable by diff against the valid original).

- [X] T062 [US7] Construct **five separate** malformed/unsupported envelope-copy derivatives of
  T059's envelope, **one file per mutually-exclusive malformation kind** (they cannot share one
  file — one is syntactically invalid JSON and the other four are different valid-JSON
  mutations, per `contracts/snapshot-envelope.md` §2/§7 and `research.md` R3):
  `<EVIDENCE_DIR>/envelope-fixtures/malformed-invalid-json.json` (`malformationKind:
  "invalid-json"`, syntactically invalid JSON — fails validation step 1);
  `malformed-missing-or-wrong-field.json` (`"missing-or-wrong-required-field"` — omit a required
  top-level field or give one the wrong JSON type — fails step 2); `malformed-unrecognized.json`
  (`"unrecognized-schema-or-dialect-or-capability"` — an unrecognized `schemaVersion`, a
  `globDialect` whose `engine`/`version`/`options` is not exactly
  `picomatch`/`4.0.5`/`{dot:false,nocase:false,nonegate:true}`, or `capabilities` other than
  exactly `["pathOwnership"]` — fails step 3); `malformed-missing-source-digest.json`
  (`"missing-source-digest"` — omit a declared source's digest — fails step 4); and
  `malformed-identity-only.json` (`"identity-only-true"` — `completeness.identityOnly: true` —
  fails step 5). For each, confirm a consumer performing path-ownership matching rejects it as
  malformed/unsupported/partial, non-zero, **before any digest, revision, or
  repository-identity check is even attempted** — record one
  `MalformedEnvelopeRejectionResult` per kind (`data-model.md` §22) with `malformationKind`,
  `exitCodeNonZero: true`, `rejectedBeforeDigestCheck: true`, `rejectedBeforeRevisionCheck:
  true`, `rejectedBeforeRepositoryIdentityCheck: true`, and a `fixtureRef` pointing at that
  kind's own file. The five results form `EvidenceBundle.envelopeRejectionResults.malformed`
  (an array). Depends on: T059.

- [X] T063 [US7] Construct, separately, an otherwise well-formed envelope-copy whose entities
  simply all happen to be `annotation-absent`, with `completeness.identityOnly: false`.
  Confirm a consumer **accepts** it — an envelope is never treated as partial/identity-only
  merely because its entities' ownership states happen to be absent; only
  `completeness.identityOnly` decides that (contrast case for T062). Depends on: T059.

- [X] T064 [US7] Construct a tampered envelope-copy in `<EVIDENCE_DIR>/envelope-fixtures/tampered.json`:
  mutate one entity's `derivedPaths` after generation **without** updating the envelope's own
  digest (computed per T059's RFC-8785-style canonicalization over every field including
  `schemaVersion`, not the entity list alone). Confirm a consumer that **independently
  recomputes** that digest rejects it, non-zero, naming the mismatch — never silently trusting
  mutated content. Record `TamperCheckResult` (`data-model.md` §10) with `outcome: "tampered"`,
  `guaranteeScope: "accidental-corruption-and-naive-mutation-only"` (this proves
  accidental-corruption/naive-mutation detection, never adversarial cryptographic
  tamper-resistance, which remains an explicitly open question this spike does not attempt —
  FR-035). Depends on: T059.

- [X] T065 [US7] Construct a stale envelope-copy in `<EVIDENCE_DIR>/envelope-fixtures/stale.json`:
  declare any revision other than a consumer's separately-configured expected-current
  revision for the same repository ID, with its digest **recomputed** over its own actual
  (mutated-revision) content so it passes the digest check cleanly. Confirm rejection is
  specifically attributable to staleness — **exact inequality, not chronological
  comparison**, since opaque commit SHAs carry no ordering this spike can determine without
  separate ancestry data (out of scope) — never to a coincidental digest mismatch. Record
  `StalenessAndIdentityCheckResult` (`data-model.md` §11) with `stalenessOutcome: "stale"`.
  Depends on: T059.

- [X] T066 [US7] Construct a wrong-repository envelope-copy in
  `<EVIDENCE_DIR>/envelope-fixtures/wrong-repository.json`: declare a different repository ID
  than a consumer's own separately-configured expected repository, with its digest recomputed
  over its own actual content. Confirm the consumer rejects it outright, non-zero, naming the
  identity mismatch specifically — never confused with T067's multi-repository query-isolation
  case. Record `StalenessAndIdentityCheckResult` with `identityOutcome:
  "unexpected-repository"`. Depends on: T059.

- [X] T067 [US7] Generate a second, fully independent, valid single-repository envelope for
  `<SECOND_REPO>`'s distinct throwaway repository identity, following the same manifest →
  derivation → envelope procedure as T057–T059, and write it to
  `<EVIDENCE_DIR>/envelope-fixtures/second-repository.json` (never a merged or federated
  snapshot — FR-009's single-repository-only constraint is unaffected). Confirm a tool
  deliberately querying across both T059's envelope and this one, scoped to T059's repository
  ID, returns **only** T059's entities — no entity from `<SECOND_REPO>`'s envelope is ever
  returned, and **neither envelope is rejected** (isolation is a property of the query, not an
  error condition). Record `RepositoryIsolationCheck` (`data-model.md` §12) with `outcome:
  "isolated"`. Depends on: T010, T059.

**Checkpoint**: User Story 7 complete. Malformed/tamper/stale/repository-isolation
requirements are demonstrated as an offline, mechanical generator-and-consumer property this
spike genuinely can prove — distinct from, and never a substitute for, later external-adopter
validation.

---

## Phase 10: Security/Mutation Evidence Across All Runs (cross-cutting, no story label)

**Purpose**: Confirm, across every derivation run/probe performed in Phases 2–9, that the
network-denial mechanism was genuinely used, no credential was ever set, and no mutation
occurred — the security/mutation properties `contracts/scale-and-security-measurement.md` §5
requires of every invocation, checked once here in aggregate rather than trusted from
individual task narratives alone.

Depends on: T067 (Phase 9 complete — the last phase performing a derivation/consumer
invocation).

- [X] T068 Confirm one of the two genuinely-blocking network-denial mechanisms T006 selected
  was actually used, and is named explicitly with its exact configuration, for **every**
  derivation run/probe across Phases 2–9 (`NetworkDenialRecord.appliedToInvocations`,
  `data-model.md` §20 — never an allowlisted-environment-plus-static-review-only claim for any
  single invocation). Record to `<EVIDENCE_DIR>/network-denial.json` (finalizes
  `EvidenceBundle.networkDenial`).

- [X] T069 Confirm no credential or bearer-token environment variable was set for any
  derivation run across Phases 2–9 (`contracts/scale-and-security-measurement.md` §5).

- [X] T070 Confirm the `git status --porcelain` before/after capture pair captured by T014's
  harness is identical for **every** run/probe across Phases 2–9
  (`MutationBaseline.identical === true` in every instance — a `false` value anywhere is itself
  an `SC-012`/`no-go`-triggering finding, per `contracts/evidence-bundle-and-verdict.md` §2).
  Record `MutationBaseline[]` to `<EVIDENCE_DIR>/mutation-baselines.json` (populates
  `EvidenceBundle.mutationBaselines`).

**Checkpoint**: Security/mutation evidence complete and aggregated. Every derivation run in
this file is now bracketed by an identical before/after `git status --porcelain` capture, with
the network-denial mechanism explicitly named, in every tested case.

---

## Phase 11: User Story 8 — Record Exactly One Spike Verdict, Distinct From Any Optional Externally-Validated Maturity, Leaving the Release Vehicle Undecided (Priority: P1)

**Goal**: Read the complete evidence bundle from User Stories 1–7 and compute exactly one of
`go-explicit` / `blocked` / `no-go`, per `contracts/evidence-bundle-and-verdict.md` §2's fixed
precedence, with every driving field cross-referenced, the required disclaimers present
unconditionally, and (if `go-explicit`) a non-binding recommendation with `releaseVehicleDecision`
fixed `null`.

**Independent Test** (`spec.md` User Story 8): Read the completed evidence bundle and confirm
it maps to exactly one verdict per the fixed-precedence definitions, with every piece of
required evidence present and cross-referenced, and confirm the report explicitly states that
this spike's result alone does not satisfy external / community validation or optional
externally-validated maturity evidence.

Depends on: T016, T032, T037, T042, T044, T048, T061, T067, T070 (every prior phase's
checkpoint).

> **Verdict-task pipeline model.** T072 (`no-go`), T073 (`go-explicit`), and T074 (`blocked`)
> are the three fixed-precedence checks, evaluated **in sequence** as a linear task pipeline —
> each `Depends on:` the previous only for **ordering**, not for a claim that all three run. The
> first whose condition holds **sets `outcome`**; every later check in the sequence, seeing
> `outcome` already set, is a recorded **no-op** that neither re-decides nor overrides it (so a
> downstream task depending on T074 is satisfied whether T074 decided the outcome or merely
> passed it through). T075 (drivingEvidence cross-reference) and T077 (disclaimers) run for
> **every** outcome; T076 (`NonBindingRecommendation`) runs **only** when `outcome ===
> "go-explicit"` and is otherwise skipped with `recommendation = null`. This is the task-DAG
> encoding of `contracts/evidence-bundle-and-verdict.md` §2's "stop at the first matching rule."

- [X] T071 [US8] Validate evidence bundle completeness
  (`contracts/evidence-bundle-and-verdict.md` §1). Confirm the **fifteen evidence-gathering**
  top-level `EvidenceBundle` fields (`data-model.md` §22) are each populated **before** any
  verdict is computed — the sixteenth field, `verdict`, is populated last (by T072–T077) and is
  therefore **not** a precondition of this check, only its downstream consumer. The fifteen:
  `parsingValidationResults`, `identityCanonicalizationResults`, `atomicFailureRecords`,
  `repositoryIdentityChecks`, `identityOnlyResults`, `structuralEdgeCaseFixtures`,
  `dotfilePolicyConfirmation`, `inputManifests` (reference), `envelopes` (reference),
  `comparisonMatrix` (reference to `comparison-matrix.json`, carrying both the labeled
  matrix and the B/C measurements), `scaleEvidence` (reference), `envelopeRejectionResults`
  (inline results, each referencing its fixture file), `repositoryIsolationCheck` (inline,
  referencing `second-repository.json`), `networkDenial` (reference), and `mutationBaselines`
  (reference to `mutation-baselines.json`).
  **Additionally**,
  cross-check trigger-class coverage against `contracts/atomic-fail-closed.md` §4's
  fourteen-value enumeration. Thirteen are **specific** classes that MUST each be exercised by
  at least one fixture; the fourteenth, `"other-invalid-input"`, is a deliberate always-present
  **backstop** (`data-model.md` §6) expected to be empty in practice and therefore **not**
  required to be exercised. Build the coverage matrix explicitly and confirm each of the
  thirteen specific classes maps to at least one fixture: `invalid-pattern` (T018);
  `invalid-annotation-shape`/`invalid-annotation-parse` (T019); `duplicate-canonical-id`
  (T020/T035); `duplicate-canonical-ref` (T023); `unsupported-manifest-version`/
  `unsupported-snapshot-version`/`unsupported-capability`/`incomplete-required-source` (T036);
  `invalid-manifest-shape` (T036's malformed-manifest probe); `repository-mismatch` (T037);
  `duplicate-yaml-key` (T046); and `invalid-yaml-syntax` (a dedicated syntactically-invalid-YAML
  descriptor fixture — none of T045–T047's three current structural fixtures is itself
  syntactically invalid, so author one alongside them in Phase 7 if not already present). **Any of the thirteen specific
  classes left without a covering fixture is a coverage gap that MUST be closed by authoring the
  missing fixture before execution — never waived.** A newly-discovered trigger not among the
  thirteen specific classes is recorded as the fourteenth value, `"other-invalid-input"`, never
  invented ad hoc. **A bundle missing any required field above
  (when every upstream gate/re-verification step succeeded) is incomplete and MUST NOT have a
  verdict recorded against it** — if any field is genuinely missing (not merely populated with
  an unfavorable result, which is still a populated field), stop and complete the missing
  evidence-gathering task before proceeding to T072.

- [X] T072 [US8] Evaluate Step 1 — `no-go` (checked first; dominates all other results). Check,
  against the assembled bundle: any `MutationBaseline.identical === false` (T070); any
  network/credentialed/live-API access occurred during a derivation run (T068/T069 violated);
  whole-operation atomicity did not hold in some tested case (any `AtomicFailureRecord`
  scenario in Phase 4 produced a partial/usable snapshot); repository-mismatch abort did not
  hold (any `RepositoryIdentityCheck` mismatch case in Phase 4 failed to abort before path
  derivation); any invalid-pattern/invalid-shape class was silently accepted (any
  `RestrictedGlobPattern`/`OwnedPathsAnnotation` invalid case from Phase 3 reached `"accepted"`
  or a valid ownership state); any of Phase 9's envelope-rejection checks — the five
  malformed-kind probes plus the tampered, stale, and wrong-repository cases (T062, T064, T065,
  T066) — failed to reject an envelope that should have been rejected; the repository-isolation check
  (T067) itself failed (`RepositoryIsolationCheck.outcome === "leaked"`, or either
  independently-valid envelope was incorrectly rejected); or Option A's output was not
  byte-identical across repeated runs within a single-repository pass (any of T050/T054/T058's
  3+ runs produced non-identical output). **If any trigger fired**: set `outcome = "no-go"`,
  `noGoTrigger` to the specific name (`data-model.md` §23's closed enumeration), `recommendation
  = null` ("no production catalog adapter is recommended at this time"), `drivingEvidence` to
  the specific triggering field(s). **STOP — do not evaluate T073 or T074.** Depends on: T071.

- [X] T073 [US8] Evaluate Step 2 — `go-explicit` (checked second; only if T072 did not match).
  Confirm **every** acceptance scenario in User Stories 1–7 passed exactly as specified:
  deterministic parsing/validation/canonicalization (Phase 3); whole-operation atomic
  fail-closed behavior and repository-boundary enforcement (Phase 4); B/C measured and
  correctly labeled at both the real-corpus and synthetic levels (Phase 5); D's no-effect
  confirmed with the precise returned shape (Phase 6); all three required synthetic structural
  fixtures resolved unambiguously and the dotfile policy confirmed (Phase 7); per-pass
  determinism proven with the envelope and scale evidence both actually produced for every pass
  (Phase 8); and malformed/tampered/stale/misidentified-envelope rejection plus repository
  isolation mechanically demonstrated (Phase 9). **If every scenario passed**: set `outcome =
  "go-explicit"`, `drivingEvidence` to **every** `EvidenceBundle` field (a `go-explicit` verdict
  is by definition "everything passed"). `recommendation` is now required — it is drafted in
  T076. **Stop — do not apply T074's `blocked` fallback**; proceed through T075 (drivingEvidence
  cross-reference) to T076. Depends on: T072.

- [X] T074 [US8] Evaluate Step 3 — `blocked` (exhaustive fallback; only if T072 and T073 did not
  match). By construction, no `no-go` trigger fired but the result fell short of full
  `go-explicit` in some way that is **not itself unsafe**. Identify which named case applies:
  the synthetic B/C precision comparison (Phase 5, T042) could not be completed; any of the
  three required synthetic structural fixtures (Phase 7, T045–T047) produced an ambiguous
  rather than a clean outcome; the envelope or scale-evidence record (Phase 8) could not be
  fully populated from an actual run for any pass; the default-namespace canonicalization case
  (Phase 3, T028) could not be verified; or `(other)` — a free-text description of a different
  non-unsafe shortfall. Set `blockedShortfall` accordingly. For a `blocked` outcome
  `recommendation` is **`null`** (a `NonBindingRecommendation` is produced only for
  `go-explicit`, per `contracts/evidence-bundle-and-verdict.md` §4 — T076 is skipped). Proceed
  to T075. Depends on: T073.

- [X] T075 [US8] Cross-reference `verdict.drivingEvidence` (`contracts/evidence-bundle-and-verdict.md`
  §6). Confirm the array populated by whichever of T072/T073/T074 fired lists, **by exact
  field name** from `EvidenceBundle` (`data-model.md` §22), every field that determined the
  outcome. **A verdict recorded with an empty `drivingEvidence` array is invalid under this
  contract regardless of what prose elsewhere in `spike-009-evidence.md` claims** — if empty,
  return to T072–T074 and populate it before proceeding. Depends on: T074.

- [X] T076 [US8] Draft the `NonBindingRecommendation` (`contracts/evidence-bundle-and-verdict.md`
  §4) **only if** `outcome === "go-explicit"` — skip this task entirely otherwise, where
  `recommendation` is fixed `null`. Populate `bindingStatus: "non-binding"` (literal);
  `minimalScopeDescription` (the smallest viable production scope this evidence supports — e.g.
  "an offline `packages/adapters/catalog-backstage` generator limited to Option A alone,
  reading only a local input manifest, deriving `CatalogSnapshotEntity.paths` from
  `adrkit.io/owned-paths` alone, enforcing whole-operation atomicity and single-repository
  binding, and writing only the versioned envelope — never a `CatalogSnapshot`-shaped artifact
  directly"); **`releaseVehicleDecision: null` — always, unconditionally, with no exception**
  (if a future execution session finds itself tempted to populate this field with an npm
  target, repository location, or version/tag, that session has exceeded this spike's
  authorized scope and must stop and re-scope rather than proceed); `externalMaturityDisclaimer`
  (states explicitly that this recommendation, even under `go-explicit`, does not itself
  satisfy external / community validation (ADR-0014 rung 3), optional later external-adopter
  evidence, or the optional externally-validated maturity);
  `productionAuthorizationClaimed: false`. Depends on: T075.

  > **PR #37 review annotation added (no functional change — this task genuinely was, and
  > remains, correctly skipped):** the recorded `outcome` is `"blocked"` (T072/T073 both
  > `"did-not-fire"`; T074 `"fired"`), not `"go-explicit"`, so per this task's own literal
  > text this task is **correctly skipped in its entirety** and `recommendation` is fixed
  > `null` (verified in `verdict.json`/`spike-009-evidence.json`). Matching feature008's own
  > convention for tasks validly skipped due to their own stated precondition not holding
  > (see `specs/008-spec-kit-hook-viability/tasks.md`'s T047 and related notes), this
  > annotation makes that explicit for reviewer legibility; it does not change any recorded
  > evidence or the verdict.

- [X] T077 [US8] Set `Verdict.gateDisclaimers` (fixed literal shape:
  `{ phase6NotCausedByThisSpike: true, externalCommunityValidationNotClaimed: true,
  governancePreconditionsAlreadySatisfiedIndependently: true,
  independentAdopterEvidenceOptionalLaterMaturity: true }`) and
  `externalMaturityDistinctionStatement` — **present unconditionally on every verdict, never
  contingent on `outcome`**. Restate in the narrative (to feed T079) all SC-013 disclaimers
  verbatim in substance: (a) **Phase 6 credit-taking disclaimer** — this spike's own technical
  result does not itself satisfy, substitute for, or take credit for Phase 6 landing /
  reference-verification; Phase 6 is already landed / reference-verified under ADR-0014 rungs
  1–2 and is not external / community validation; (b) **governance credit-taking disclaimer** —
  this spike's output MUST NOT claim or take credit for ADR-0012's acceptance, ADR-0013's
  resolution of ADR-0007/ADR-0009, or ADR-0014's acceptance, all of which occurred
  independently of this spike's own execution or verdict; (c) **external-adopter maturity
  disclaimer** — this spike's output MUST NOT claim or imply that its own verdict constitutes,
  causes, or substitutes for external / community validation, optional external-adopter
  evidence, or the optional externally-validated maturity, regardless of which verdict
  is recorded. Depends on: T075.

- [X] T078 [US8] Assemble the final `<EVIDENCE_DIR>/spike-009-evidence.json`
  (`research.md` R4; `contracts/evidence-bundle-and-verdict.md`) — the complete
  `EvidenceBundle` manifest (`data-model.md` §22) plus `Verdict` (§23) plus
  `NonBindingRecommendation` (§24, or `null`). Per §22's single representation, **reference**
  every component artifact file each earlier task wrote (`parsing-validation-results.json`,
  `identity-canonicalization-results.json`, `atomic-failure-records.json`,
  `repository-identity-checks.json`, `identity-only-results.json`,
  `structural-edge-case-fixtures.json`, `dotfile-policy-confirmation.json`,
  `input-manifest.*.json`, `snapshot-envelope.*.json`, `comparison-matrix.json`,
  `scale-evidence.json`, `network-denial.json`, `mutation-baselines.json`, and — for the two
  inline User Story 7 result records — the `envelope-fixtures/*.json` fixtures including the
  five `malformed-*.json`) via an `ArtifactFileReference` (`{ relativePath, sha256 }`) rather
  than embedding it inline. The only inline members are the computed `verdict` and the two
  User Story 7 result records (`envelopeRejectionResults`, `repositoryIsolationCheck`), which
  themselves reference their fixture files — never both embed and reference the same artifact —
  so each artifact remains independently diffable. Depends on: T076, T077.

- [X] T079 [US8] Write the final `<EVIDENCE_DIR>/spike-009-evidence.md` narrative
  (`research.md` R3) — the one human-readable artifact a maintainer reads end-to-end: the
  recorded verdict and its `drivingEvidence`; a reference-oracle subsection citing
  `reference-oracle.json`, its pre-generator independent audit, the six required case classes,
  and the bounded zero FP/FN expectation; one subsection per User Story 1–7 with
  fixture/transcript excerpts and pass/fail per acceptance scenario, citing every FR/SC by ID;
  the three SC-013 disclaimers verbatim in substance (T077); and, if applicable, T076's
  non-binding recommendation. Depends on: T078.

**Checkpoint**: User Story 8 complete. Exactly one verdict is recorded. This is the spike's
actual deliverable (`spec.md`: "It produces exactly one artifact of consequence").

---

## Phase 12: Cleanup and Closeout (cross-cutting, no story label)

**Purpose**: Confirm every constraint this spike was required to hold throughout — zero
tracked mutation, no package/schema/core/CI/version/tag/ADR change, no Phase 6 or governance-status
credit-taking claim — holds at the end, not merely at each individual step, and tear down (or
knowingly leave, since nothing here is tracked) every scratch workspace.

Depends on: T079 (evidence bundle finalized).

- [X] T080 Confirm zero tracked mutation in `<THIS_REPO>` across the entire spike. Run `git
  status --porcelain=v1` at `<THIS_REPO>`'s root — MUST show nothing related to this spike
  (and, ideally, nothing at all, modulo any unrelated pre-existing dirty state the spike did
  not itself cause). This is the final, whole-spike version of every per-invocation check
  T014/T070 already performed individually.

- [X] T081 Confirm no package/schema/core/CI/version/tag/ADR change was introduced anywhere in
  `<THIS_REPO>` (Out of Scope section; FR-020). Diff (conceptually or literally, against a
  pre-spike reference) root and every workspace `package.json`, `schema/adr.schema.json`,
  `packages/core/src/schema/adr.schema.ts`, `packages/core/src/affects/catalog.ts`,
  `packages/core/src/affects/inert.ts`, every file under `docs/adr/**`, and every file under
  `.github/workflows/**` — all MUST be byte-identical to their pre-spike state. Confirm no
  `packages/adapters/catalog-*/**` directory of any kind was created.

- [X] T082 Confirm no claim anywhere in `spike-009-evidence.{md,json}` states or implies that
  Phase 6 is landed / reference-verified because of this spike, that ADR-0012's/ADR-0013's/
  ADR-0014's acceptance was caused by this spike, that external-adopter maturity evidence exists
  because of this spike, or that
  ADR-0007/ADR-0009's own blockers are cleared — regardless of this spike's own verdict. A
  mechanical grep for "landed"/"accepted"/"externally-validated maturity" across the evidence files should
  surface only T077's own required, correctly-worded disclaimer language, never a credit-taking
  claim.

- [X] T083 [P] Confirm no scratch artifact from this spike was ever staged or committed in
  `<THIS_REPO>` at any point — `git log` and `git status` at `<THIS_REPO>`'s root show no
  scratch feature, no scratch ADR, no fixture file, and no envelope file ever entering this
  repository's tracked history (FR-019). No path overlap with T084.

- [X] T084 [P] Tear down (or knowingly leave, since none of it is tracked by any git repository
  this spike cares about) `<GENERAL_SCRATCH>`, `<SYNTHETIC_REPO>`, `<MISMATCH_REPO>`,
  `<SECOND_REPO>`, `<COMMUNITY_PLUGINS_CLONE>`, and `<RHDH_PLUGINS_CLONE>`. No push, fetch, or
  remote registration for any standalone scratch repository ever occurred beyond the one
  `origin` its own test case configured (`research.md` R11 item 2). No path overlap with T083.

**Checkpoint**: Cleanup complete. Every constraint this spike was required to hold is
reconfirmed holding at the end, not merely believed to hold from individual steps.

---

## Phase 13: Independent Evidence Audit and Final Result Report (cross-cutting)

**Purpose**: Have a fresh, independent-context reviewer check the finished evidence bundle
before it is reported as final, then deliver the one deliverable this entire file
exists to produce.

Depends on: T080, T081, T082, T083, T084.

- [X] T085 Independent evidence audit. Dispatch a fresh-context review (no authoring context
  from the session that gathered the evidence — Claude Sonnet 5, this file's model policy;
  **never Opus 4.6, under any role**; independence here comes from context isolation, not a
  model change) to check `spike-009-evidence.{md,json}` against every FR-001–FR-038,
  SC-001–SC-014, and all eleven `contracts/*.md` files for: (a) internal consistency between
  the JSON manifest and the Markdown narrative; (b) the verdict's precedence was applied in the
  fixed order (`no-go` → `go-explicit` → `blocked`) with no skipped or reordered step; (c)
  `drivingEvidence` is non-empty and names real `EvidenceBundle` fields; (d)
  `releaseVehicleDecision` is `null` in every case it appears; (e) all three SC-013 disclaimers
  are present and correctly worded, including the Phase-6-transition-survives-`landed` framing
  (T077's item (a)); (f) every one of the **thirteen specific**
  `AtomicFailureRecord.triggerClass` values was genuinely exercised (the fourteenth,
  `"other-invalid-input"`, is a non-required backstop), not merely asserted (T071's coverage
  matrix); and (g) no fabricated or
  assumed evidence — every transcript/fixture/envelope excerpt traces to an actual file under
  `<EVIDENCE_DIR>`, never a paraphrase presented as a direct quote. Record findings; remediate
  any defect found before T086.

- [X] T086 Produce the final result report to the coordinating/maintainer session: the recorded
  verdict and its `drivingEvidence`; the evidence bundle's location
  (`<EVIDENCE_DIR>/spike-009-evidence.{json,md}`); any `no-go` trigger or `blocked` shortfall
  by name; the explicit restatement that neither Phase 6 landing/reference-verification nor optional external-adopter
  maturity evidence is satisfied, caused, or substituted for by this spike's own result, and
  that the governance preconditions (T003) were already satisfied independently of this spike;
  an explicit note that raw transcripts remain scratch-only and any later **landed** claim
  requires a tracked, sanitized evidence index with commit SHAs, run links, content hashes, tool
  versions, network/credential limits, negative-test results, and a reviewer verdict; and an
  explicit note that **any resulting change to `spec.md`/`plan.md`/this file that this spike's
  findings suggest is itself a separate, later, explicitly-scoped follow-up — never something
  this execution session decides or performs unilaterally as part of running this file.**

**Checkpoint**: Spike execution complete. One verdict, independently audited, reported. No
production package scoped, scheduled, or committed to by this file's execution.

---

## Dependency Graph

```
Phase 1 (Gate):         T001 [P w/ T002 read-only] + T002 + T003 → T004 (GATE_PASS)
                        ✅ GATE_PASS = true expected after this migration merges. If it records false: STOP.

Phase 2 (Foundational): T004 → T005 (frozen-input re-verify; fail-closed halt point)
                              → T006 [P] + T007 [P] + T008 [P] + T009 [P] + T010 [P]
                                + T013 [P] + T015 [P] (no path overlap)
                        T005 → T011 [P] + T012 [P] (corpus clones)
                        T013 → T014 (author + freeze + hash the reference oracle and inputs)
                        T014 → T014a (independent pre-output audit of the frozen oracle; must PASS)
                        T005 + T006 + T007 + T008 + T009 + T010 + T011 + T012 + T013 + T014
                              + T014a + T015 → T016

Phase 3 (US1):  T016 → T017 [P] + T018 [P] + T019 [P] + T020 [P] + T021 [P] + T022 [P]
                       + T023 [P] + T024 [P] (fixture authoring, no path overlap)
                T017 + T020 + T021 + T022 + T023 + T024 → T025
                T018 + T019 → T026
                T020 + T025 → T027;  T021 + T025 → T028;  T017 + T022 + T025 → T029
                T023 + T025 → T030;  T024 + T025 → T031
                T016 → T032 (independent of T017–T031; gated on the T014a pre-output oracle audit via T016)

Phase 4 (US2):  T016 → T033 → T034 → T035
                T033 → T036 (independent of T034/T035)
                T009 → T037 (independent of T033–T036; cites T040 once available)

Phase 5 (US3):  T011 → T038 [P]; T012 → T039 [P] + T040 [P] (no path overlap)
                T007 → T041 [P] (independent of T038–T040)
                T041 → T042

Phase 6 (US4):  T011 + T012 → T043;  T043 + T017 → T044

Phase 7 (US5):  T007 → T045 [P] + T046 [P] + T047 [P] (no path overlap)
                T016 → T048 (independent of T045–T047)

Phase 8 (US6):  T011 → T049 → T050 → T051 + T052
                T012 → T053 [P, no overlap w/ T049] → T054 → T055 + T056
                T008 + T017 + T021 + T022 + T024 + T045 + T047 → T057 [P, no overlap w/ T049/T053]
                       → T058 → T059 + T060
                T052 + T056 + T060 → T061

Phase 9 (US7):  T059 → T062 + T063 + T064 + T065 + T066 (five independent derivative
                       constructions, each its own file — parallelizable in principle, listed
                       sequentially here for evidence-bundle narrative clarity)
                T010 + T059 → T067

Phase 10 (Sec): T067 → T068 + T069 + T070 (aggregation over every prior invocation)

Phase 11 (US8): T016 + T032 + T037 + T042 + T044 + T048 + T061 + T067 + T070 → T071
                T071 → T072 [no-go check] → (if matched, outcome set; else ↓)
                       T073 [go-explicit check] → (if matched, outcome set; else ↓)
                       T074 [blocked fallback] → (outcome set by construction)
                → T075 (cross-reference) → T076 (recommendation; forced null for no-go/blocked)
                → T077 (disclaimers — applies to every outcome, unconditionally) → T078 → T079

Phase 12 (Cleanup): T079 → T080 → T081 → T082 → T083 [P] + T084 [P]

Phase 13 (Audit):   T080 + T081 + T082 + T083 + T084 → T085 → T086
```

**Parallel opportunities by phase**:

- Phase 1: T001 and T002 read independent sources (no shared path) — parallelizable, though
  both feed the single sequential T003/T004 decision.
- Phase 2: T006 + T007 + T008 + T009 + T010 + T013 + T015 (seven independent concerns —
  network-denial selection, general scratch, three standalone repository identities, evidence
  directory, recovery-procedure documentation) are mutually parallelizable; T011 + T012 (two
  independent corpus clones) are parallelizable with each other, both gated behind T005.
- Phase 3: T017–T024 (eight independent fixture files) are fully parallelizable; T032 (the
  real-corpus run) is independent of T017–T031 but, as a generator/derivation run, is gated on
  the T014a pre-output oracle audit via the T016 Foundational checkpoint — it may run at any
  point after T016.
- Phase 4: T036 (the four manifest-request-level rejections) has no dependency on T034/T035
  beyond T033's manifest construction, so it may run in parallel with the T034→T035 sequence;
  T037 (the mismatch test) is fully independent of T033–T036, using `<MISMATCH_REPO>` rather
  than `<SYNTHETIC_REPO>`.
- Phase 5: T038 (community-plugins) + T039 (rhdh-plugins) + T040 (stale-slug citation, same
  corpus as T039 but a distinct read) are parallelizable with each other; T041 (matrix
  construction) is independent of all three and may run at any point after T007.
- Phase 7: T045 + T046 + T047 (three independent fixture files) are fully parallelizable; T048
  (the direct `picomatch` execution) has no dependency on any of them.
- Phase 8: The three passes' construction/derivation/envelope/scale-evidence sequences
  (T049–T052, T053–T056, T057–T060) are mutually parallelizable at the sequence level — no
  path overlap between any two passes' manifest/envelope/scale-evidence files — though each
  sequence's own four steps are strictly ordered internally.
- Phase 9: T062–T066 (five distinct envelope-rejection derivatives, five distinct files) have
  no path overlap with one another and are parallelizable in principle, though listed
  sequentially above for narrative traceability in the evidence bundle; T067 (the
  second-repository isolation check) is independent of T062–T066.
- Phase 12: T083 (commit-history check) and T084 (scratch-workspace teardown) touch disjoint
  concerns (git history vs. filesystem cleanup) — parallelizable.
- All other tasks are strictly sequential: each records evidence into files that later tasks in
  the same story read, or performs a state transition (generate → tamper/mutate → re-verify)
  that only makes sense in one order.

---

## Implementation Strategy

### This Is Not an MVP-and-Iterate Feature

Unlike a typical spec-kit feature, this spike has no meaningful "MVP subset" of user stories to
ship early — User Story 8's single verdict is the only deliverable, and it requires evidence
from User Stories 1–7 in full (`spec.md`: "every other story is evidence feeding this one
conclusion"). There is no partial-credit release; either the complete evidence bundle exists
and one verdict is recorded, or the spike has not yet concluded. "MVP" here means: **Phase 1 +
Phase 2 + User Story 1 (T001–T032) is the smallest slice that produces any falsifiable
finding** — if the frozen-input re-verification or Option A's own per-rule validation itself
fails, that alone is enough evidence to inform (though not yet fully determine, per SC-012's
precedence) a `no-go`-leaning result, without needing to reach User Stories 2–7.

### Execution Order (after T004 records `GATE_PASS = true`)

1. Phase 1 (T001–T004) — gate check. **Proceed only if it records `GATE_PASS = true`; if it
   records `false`, stop and run nothing below.** Current expected result after this migration
   merges is `GATE_PASS = true`.
2. Phase 2 (T005–T016) — foundational. **If T005 finds a reachability mismatch, stop; nothing
   below runs, and spec re-ratification is required before any retry.**
3. Phases 3–7 (User Stories 1–5, T017–T048) — Phase 3 (US1) and Phase 4 (US2) are P1 and should
   run first since either alone can already produce a `no-go`; Phases 5–7 (US3–US5, all P1/P2)
   may then proceed in any order relative to each other, since none depends on another's
   output beyond the shared Phase 2 foundation.
4. Phase 8 (User Story 6, T049–T061) — depends on Phase 3's community-plugins read (T032) and
   Phase 5's rhdh-plugins read (T039), plus the Task-Level Design Decision's primary-synthetic
   composition (which itself depends on T017/T021/T022/T024/T045/T047).
5. Phase 9 (User Story 7, T062–T067) — depends on Phase 8's synthetic-pass envelope (T059) and
   `<SECOND_REPO>` (T010).
6. Phase 10 (Security/mutation aggregation, T068–T070) — depends on every prior phase's
   invocations being complete.
7. Phase 11 (User Story 8, T071–T079) — the verdict, computed only once every prior phase's
   evidence exists.
8. Phase 12 (Cleanup, T080–T084) — mandatory, not optional, regardless of verdict.
9. Phase 13 (Audit and Report, T085–T086) — the actual handoff to the maintainer.

### What Happens on a `no-go` or Gate Failure Partway Through

- **Precondition failure (T004) or frozen-input reachability mismatch (T005)**: stop immediately;
  no scratch artifact or corpus clone is created (T004 failure), or the spike halts with only
  `frozen-inputs-reachability.json` populated (mismatch); report and end.
- **A `no-go` trigger firing mid-sequence** (e.g. at T035's atomicity check, or T070's mutation
  check): per this spike's own evidence-completeness discipline, the evidence-gathering pass
  continues through the remaining User Stories so the bundle is complete (T071 requires every
  field populated regardless of how unfavorable any individual result is) — only the eventual
  *verdict's production recommendation* is foreclosed by a `no-go`, never the obligation to
  finish evidencing the rest.
- **Any point where cleanup (Phase 12) cannot be completed** (e.g. a scratch repository cannot
  be torn down because of a filesystem permission error): the spike halts and reports this
  explicitly as its own finding — a repository left in an ambiguous state is never silently
  accepted as a completed spike run.

---

## Notes

- **[P] tasks** = different files/paths/evidence-bundle fields, no dependency on another
  incomplete task in the same phase. Fixture-authoring tasks (Phases 3, 5, 7) are the richest
  source of parallelism in this file; verdict-computation and cross-referencing tasks (Phase
  11) are intentionally sequential, since each depends on the fixed-precedence outcome of the
  one before it.
- **[Story] label** maps each task to its `spec.md` user story for traceability; Gate,
  Foundational, Security/Mutation, Cleanup, and Audit phases omit it by convention (matching
  `specs/007-arb-queue/tasks.md`'s Phase 1/2/6 style and `specs/008-spec-kit-hook-viability/tasks.md`'s
  identical convention for this project's sibling spike).
- **No task in this file may be marked complete by this planning/scoping session.** Every
  checkbox above is `- [ ]` as generated; only a future, gate-cleared execution session may
  check any of them, and only after actually performing the described step.
- **No evidence file is created by generating this task list.** `<EVIDENCE_DIR>`,
  `<GENERAL_SCRATCH>`, `<SYNTHETIC_REPO>`, `<MISMATCH_REPO>`, `<SECOND_REPO>`,
  `<COMMUNITY_PLUGINS_CLONE>`, and `<RHDH_PLUGINS_CLONE>` do not exist yet; this file describes
  what a future session creates, it does not create anything itself.
- **This file adds no production package, build step, release artifact, or CI job.** Out of
  Scope items from `spec.md` apply identically to every task above — no task here may be
  reinterpreted, when eventually executed, as authorizing a `packages/adapters/catalog-backstage`
  package, a runtime plugin loader, a live Backstage API call, a `main` commit/branch/PR, a
  schema change, an npm publish, or a version/tag change.
- **Any change to `spec.md`, `plan.md`, or this file that a future execution's findings
  suggest is itself a separate, later, explicitly-scoped activity** — not something the
  execution session performs as a side effect of running through Phases 1–13 above.
- **Model policy** (restated from the header): Claude Sonnet 5 for every task in this file,
  including T085's independent audit (achieved through context isolation, not a model change)
  — **Opus 4.6 MUST NOT be used anywhere in this file, under any role.**
