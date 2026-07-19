---
description: "Task list for CI Surface (Phase 3)"
---

# Tasks: CI Surface (Phase 3)

**Input**: Design docs from `specs/004-ci-surface/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/check-and-comment.md
**Normative**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md), [ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md).

> **⛔ T000 IS A HARD PRECONDITION — DO NOT START T001+ UNTIL IT IS MET.** The outcome
> ladder gates a phase's **implementation** (not its scoping) on the one below being
> landed **and having a real user**. **Resolved (maintainer decision; reviewer may
> override):** that "real user" for rung 2 is the **maintainer dogfooding** `adr migrate`
> against a **real** public MADR corpus — no external human adopter required. Rung 2 is
> met only by a **synthetic** fixture today (research.md §R0), so the gate is not yet
> cleared; complete **T00A** first. Building Phase 3 before then violates the ladder.

**Tests**: REQUIRED. SC-001..007 and Principles IV/V require deterministic
`adr check` tests (governing list + validation + exit code per severity, `--json`
shape), comment-renderer tests (selectivity on a >10-record corpus, empty state,
marker), and Action tests against an **injected fake GitHub client** (create-vs-update,
read-only-token degradation) — **no network, no token in CI**.

**Toolchain**: Bun. **Use stable Bun 1.3.14 for `bun install`** — the env default is a
canary that writes an unreadable lockfile. Keep `bun.lock` at lockfileVersion 1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unbuilt file)
- **[Story]**: US1 (governing comment), US2 (`adr check`), US3 (selective/idempotent),
  US4 (default token), or GATE/SETUP/FOUND/CI/POLISH.

---

## Phase 0: Gate (blocking — outcome ladder)

- [ ] T000 [GATE] **Do not start T001+ until the rung-2 gate is cleared.** The gate is
  cleared by completing **T00A** below (vendor + exercise a real, permissively-licensed
  public MADR corpus subset). **Resolved (maintainer decision; reviewer may override):**
  a live external **human user** is **not** required for Phase 3 — that is a higher rung
  (3+). The precondition is the *real-corpus fixture*, not a real adopter. Until T00A is
  merged and green, **STOP**: do not start T001. (See research.md §R0.)
- [ ] T00A [GATE] **Source + vendor the gating corpus (Phase-2 follow-up / Phase-3
  precondition — does NOT reopen or re-implement Phase 2).** Find a genuinely real,
  permissively-licensed public MADR corpus (e.g. CC0/CC-BY/MIT/Apache, or the MADR
  project's own example records). Vendor a **small subset of real third-party prose**
  into `packages/core/test/fixtures/madr-corpus/` (replacing the synthetic sample),
  with **attribution + provenance** (source URL, license, commit/date) recorded in the
  fixture directory. Point the existing corpus test at it and assert the **same**
  properties as today via `adr migrate --from madr`: idempotency + body-byte
  preservation + clean lint. Keep it OFFLINE (vendored, never fetched at CI time —
  ADR-0007). **If no cleanly-licensed real corpus can be found, STOP and flag it —
  do not vendor prose of unknown license.**

## Phase 1: Setup

- [ ] T001 [P] [SETUP] Scaffold the `@adrkit/ci` surface package at `packages/ci/`
  (peer of `@adrkit/cli`): `package.json` (deps `@adrkit/core` `workspace:*`,
  `@actions/core`, `@actions/github`), `tsconfig.json`, `tsconfig.build.json`,
  `action.yml` with **`runs.using: node24`** (FR-016/R11) and `runs.main` pointing at the
  committed bundle (T00B). Inputs `dir`, `token`. Install with **stable Bun 1.3.14**;
  confirm `bun.lock` stays lockfileVersion 1.
- [ ] T00B [SETUP] **Committed self-contained bundle (FR-015/R10).** Add a `bun build`
  step that bundles the Action entrypoint **plus `@adrkit/core` and the GitHub toolkit**
  into a single committed `packages/ci/dist/` artifact, and point `action.yml`'s
  `runs.main` at it. Add a **bundle drift check** to `.github/workflows/ci.yml` (rebuild
  and `git diff --exit-code` the committed bundle, mirroring `schema-emit-matches`) and a
  **Node smoke test** that the bundle runs under Node 24 (extend `scripts/smoke-node.mjs`
  or add a sibling). Commit the built bundle.
- [ ] T002 [SETUP] Extend `scripts/check-deps.ts` so `core-has-no-adapter-deps` also
  asserts (a) `@adrkit/ci` imports nothing from `packages/adapters/*` and (b) the
  GitHub toolkit (`@actions/*`, Octokit) never reaches `@adrkit/core` or the schema —
  it stays confined to the `@adrkit/ci` surface (FR-013, R2/R3); confirm the check
  passes.

## Phase 2: Foundational (blocking)

- [ ] T003 [FOUND] Implement the neutral shared function **in `@adrkit/core`**
  (`checkChanges`, e.g. `packages/core/src/check/index.ts`, exported from the core
  index): it takes the **full `lintCorpus` result** (`{ records, findings, checked }`) +
  `changedFiles` + optional `dir` + optional `snapshots` (`changedDependencies`,
  `catalog`), calls `resolveAffects`, identifies changed records (corpus ∩ files), and
  returns the `CheckOutcome` (`{ changedFiles, governedBy, changedRecords, findings, ok }`).
  **Takes the full lint result, not just `records`** — `lintCorpus` drops malformed files
  from `records` but keeps their errors in `findings`, and those errors MUST still count
  toward `ok` (RC3/R1). Pure; no GitHub, no adapter import, no fs traversal beyond the
  supplied lint result. (Placing it in core lets both `adr check` and the Action call it
  without the CLI depending on `@adrkit/ci` or its GitHub deps — R2.)
- [ ] T004 [FOUND] Implement `packages/ci/src/comment.ts` — render the comment from a
  `Check outcome`: hidden marker `<!-- adrkit:ci -->`, governing list (`id — title`
  + `via <type>: <pattern>`), concise empty state (FR-007), and a validation notice
  when a changed record has an `error` finding (R7). Selective by construction —
  renders the resolver's set verbatim (R6/FR-006).

**Checkpoint**: check logic + comment renderer exist and are unit-testable offline.

## Phase 3: User Story 2 — `adr check` CLI (Priority: P1) 🎯 substrate

- [ ] T005 [US2] Add `check` to `packages/cli/src/index.ts` dispatch:
  `adr check <files...> [--dir docs/adr] [--json]`; build the full `lintCorpus` result
  and call the core `checkChanges` (T003); print the governing list (like `adr explain`)
  + changed-record findings; `--json` emits the stable sorted `CheckOutcome`; exit
  non-zero iff a changed record has an `error` finding (FR-002), `2` on usage error.
  Update the `usage()` help text.
- [ ] T006 [P] [US2] Tests `packages/cli/test/check.test.ts` (or core-adjacent):
  governing list correct for a fixed file list; changed-record error → non-zero;
  only info/warn → `0`; `--json` shape stable and sorted (SC-002).

**Checkpoint**: `adr check` validates + resolves deterministically for any provider.

## Phase 4: User Story 1 — Governing-decisions PR comment (Priority: P1) 🎯 MVP

- [ ] T007 [US1] Implement `packages/ci/src/changed-files.ts` — extract the PR's
  **complete** changed-file list via a **fully paginated `pulls.listFiles`** (all pages)
  or a local **merge-base (`base…head`) `git diff`** on the checkout; **do not** use the
  compare API's file list (GitHub caps it, e.g. 300 files, and truncates). Handle the
  cap **explicitly** — paginate to completion, or fall back to the local diff, and emit a
  notice if a complete list cannot be obtained (impure; Action-only, R4/FR-003). Derive
  `changedDependencies` from the lockfile diff via the existing
  `deriveChangedDependenciesFromBunLockDiff` for `package` matchers.
- [ ] T008 [US1] Implement `packages/ci/src/github.ts` — a thin injectable client port:
  **paginate all PR comments** and find the Action's prior comment by matching **both**
  the `<!-- adrkit:ci -->` marker **and** the Action's own author identity; create or
  update accordingly (R5/FR-005). Real impl uses `@actions/github`; tests inject a fake.
- [ ] T009 [US1] Implement `packages/ci/src/index.ts` — the Action entrypoint: read
  inputs (`dir`, `token` default `${{ github.token }}`), extract the complete file list
  (T007), build the lint result + snapshots and run the core `checkChanges` (T003),
  render (T004), create/update the comment (T008), and set job outcome — **fail iff** a
  changed record has an `error` finding (FR-002), succeed otherwise regardless of
  governing-list size.
- [ ] T010 [P] [US1] Tests `packages/ci/test/comment-render.test.ts`: governing entry
  shape (id + title + fired matcher); union of multiple records; inert matchers
  (entity/resource/api/data) absent from the list but present as `info` findings
  (FR-009).

**Checkpoint**: the Action posts a governing-decisions comment on a governed PR (US1).

## Phase 5: User Story 3 — Selective & idempotent (Priority: P2)

- [ ] T011 [P] [US3] Tests `packages/ci/test/comment-idempotent.test.ts` (fake client):
  first run creates a marker comment; second run **edits the same** comment, not a new
  one (SC-004). Plus RC5 coverage: (a) a **foreign/pre-existing comment bearing the
  marker** (different author) is **not** edited — the Action creates/edits only its own;
  (b) the Action's **own marker comment on a later page** is found and edited, not
  duplicated (requires the client to paginate).
- [ ] T012 [P] [US3] Tests `packages/ci/test/selectivity.test.ts`: a **>10-record**
  fixture corpus with a subset diff yields a comment listing **only** the governing
  subset (SC-003); a diff nothing governs yields the concise empty note (SC-005), not
  a corpus dump.

**Checkpoint**: the comment is useful on a big corpus and never spams the PR.

## Phase 6: User Story 4 — Default-token-only & degradation (Priority: P1)

- [ ] T013 [US4] In the Action, detect a read-only/insufficient token and **degrade**:
  still run the check, skip commenting with a job-log notice, and **do not** fail the
  job on a comment-permission error (FR-014/R8). Require no secret beyond `token`
  (default `GITHUB_TOKEN`).
- [ ] T014 [P] [US4] Tests `packages/ci/test/token-degrade.test.ts` (fake client that
  rejects writes): the check still runs and the job is not failed by the comment
  failure (SC-006).

**Checkpoint**: works with only the default token; friendly to fork PRs.

## Phase 7: CI wiring & Polish

- [ ] T015 [CI] Add a self-dogfood job to `.github/workflows/ci.yml` that runs
  `adr check` on the repo's changed ADR files (and optionally the packaged Action on
  PRs), so the CI surface governs the project that ships it. Keep the existing gate
  set (`clean-clone-builds`, `schema-emit-matches`, `core-has-no-adapter-deps`,
  `adr lint`) unchanged and green, and include the new bundle-drift + Node-24 smoke
  gates from T00B.
- [ ] T016 [POLISH] Document the Action + `adr check` in `README`/`quickstart`
  (inputs, permissions, default-token-only, portability, `node24` runtime, committed
  bundle), and note the CI surface is read-only + comment-only (no DB, no approval —
  ADR-0004/FR-011).
- [ ] T017 [POLISH] Run the full gate with **stable Bun 1.3.14**: `bun install`,
  `bun run typecheck`, `bun test` (incl. selectivity + idempotency + RC5 marker/author +
  degradation), `bun run build`, `bun run lint`, `bun run check:deps` (now covering
  `@adrkit/ci` + the toolkit→core boundary), `bun run schema:emit && git diff
  --exit-code schema/adr.schema.json` (must be clean — no schema change), the **bundle
  drift check** (`git diff --exit-code packages/ci/dist`), and the Node smoke on **22/24**
  incl. the Action bundle. All green.
- [ ] T018 [P] [POLISH] Manually validate on a **second repo** (not this one) with a
  >10-record corpus: open a PR touching a governed subset, confirm the comment names
  exactly the subset, push again and confirm the same comment updates (SC-001/003/004),
  using only the default token (SC-006).

---

## Dependencies & Execution Order

- **T000/T00A (gate) block everything.** No implementation task starts until the
  rung-2 gate is cleared by T00A (real, permissively-licensed, offline MADR corpus
  subset vendored + round-tripped). A live human user is *not* a precondition.
- Setup (T001, T00B, T002) → Foundational (T003–T004) block all stories. T00B (bundle)
  can proceed in parallel with T002 once T001 scaffolds the package.
- US2 (`adr check`, T005–T006) is the deterministic substrate; land first.
- US1 (comment, T007–T010) depends on Foundational + US2's check logic; it is the MVP
  outcome (rung 3).
- US3 (T011–T012) and US4 (T013–T014) depend on the Action path (US1).
- CI wiring + polish (T015–T018) last; T018 is the exit-criterion verification on a
  second repo.

## Parallel Opportunities

- `[P]` test tasks run together once their target module exists.
- After Foundational: `changed-files.ts` (T007) and `github.ts` (T008) are independent
  and parallelizable; the comment renderer (T004) and check logic (T003) are too.

## Implementation Strategy (MVP first)

1. **Clear the gate first (T00A, satisfying T000)** — vendor + round-trip the real
   MADR corpus subset; do not start T001 otherwise.
2. Setup + Foundational (shared check + comment renderer).
3. US2 `adr check` → verify SC-002 (portable, deterministic substrate).
4. US1 Action comment → verify SC-001 (rung 3 MVP) on a second repo.
5. US3 selective/idempotent + US4 default-token/degradation → SC-003..006.
6. CI dogfood + full verification with stable Bun; second-repo exit check.
