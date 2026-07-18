---
description: "Task list for Affects Resolution (Phase 1)"
---

# Tasks: Affects Resolution (Phase 1)

**Input**: Design docs from `specs/002-affects-resolution/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/resolver-and-explain.md
**Normative**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (one-way-door).

**Tests**: REQUIRED. SC-002 + Principle IV/V and ADR-0009's `resolution-is-pure`
mandate per-branch tests and a purity assertion. The conformance suite (FR-010) is
itself the primary test artifact.

**Toolchain**: Bun. **Use a published stable Bun (1.3.14) for `bun install`** — the
env default `bun` is a canary that writes an unreadable lockfileVersion 2. Keep
`bun.lock` at lockfileVersion 1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an unbuilt file)
- **[Story]**: US1 (path resolve), US2 (package), US3 (explain), US4 (inert), or
  SETUP/FOUND/CI/POLISH.

---

## Phase 1: Setup

- [ ] T001 Add dependencies to `packages/core/package.json`: `picomatch` (+ its
  types) and a semver satisfaction utility (`semver` or a minimal check).
  **Install with stable Bun 1.3.14**; confirm `bun.lock` stays lockfileVersion 1
  and `check:deps` still passes (both are vetted net-free libs).
- [ ] T002 [P] Create the `packages/core/src/affects/` module skeleton
  (`index.ts`, `matchers/path.ts`, `matchers/package.ts`, `inert.ts`,
  `catalog.ts`) with typed signatures per `contracts/resolver-and-explain.md`,
  exported from `packages/core/src/index.ts`.

## Phase 2: Foundational (blocking)

- [ ] T003 Extend `packages/core/src/validate/findings.ts` with the new rule ids
  (`affects-unresolvable` info, `affects-unknown-type` warn, `affects-bad-pattern`
  warn) and ensure the existing sort helper orders them deterministically.
- [ ] T004 Define the catalog **port** in `packages/core/src/affects/catalog.ts`
  (`CatalogPort`, `CatalogSnapshot`, `EntityId`) — interfaces only, no adapter,
  no implementation. `check:deps` must still show `core-has-no-adapter-deps: ok`.
- [ ] T005 Implement the resolver core in `packages/core/src/affects/index.ts`:
  `resolveAffects({records, changedFiles, snapshots?, log?})` that, per record,
  applies the union-per-ADR rule (≥1 non-negated match, no negated match; negation
  scoped to the record), unions across records, and returns stably-sorted
  `matches` + `findings`. Dispatch each matcher to its type handler; collect
  degradation findings. Pure: no clock/network/fs/env.

**Checkpoint**: resolver skeleton compiles and returns empty results deterministically.

## Phase 3: User Story 1 — Path resolution (Priority: P1) 🎯 MVP

- [ ] T006 [US1] Implement `matchers/path.ts` using `picomatch` (POSIX,
  case-sensitive, `**` crosses, `dot:false`); repo-relative, reject leading-slash
  patterns as `affects-bad-pattern` (warn, no match).
- [ ] T007 [US1] Wire path matching + negation into `resolveAffects` (negated
  matchers suppress only their own record; a record needs ≥1 positive match).
- [ ] T008 [P] [US1] Tests `packages/core/test/affects-path.test.ts`: positive
  match; no-match; self-negation suppresses; another record's negation does not
  suppress; a file governed by two records yields both (union); `**` crossing and
  dotfile behavior; leading-slash → bad-pattern.
- [ ] T009 [US1] Create the conformance suite scaffold
  `packages/core/test/conformance/` (`cases/*.json` +
  `README.md` describing `{matchers, changedFiles, snapshots?, expected}`) and a
  loader test that runs every case. Seed it with the path cases from T008.

**Checkpoint**: `resolveAffects` passes all path conformance cases (SC-001).

## Phase 4: User Story 2 — Package resolution (Priority: P2)

- [ ] T010 [US2] Implement `matchers/package.ts`: parse `name` / `name@<range>`;
  fire iff `snapshots.changedDependencies` has a matching name and (if ranged) a
  satisfying version; invalid range → `affects-bad-pattern` (warn); no
  changed-dependency set → inert (`affects-unresolvable` info).
- [ ] T011 [P] [US2] Add a minimal, deterministic helper to derive a
  changed-dependency set from a `bun.lock` diff (or accept a precomputed set);
  document that only `bun.lock` is supported in v1 (Assumption A1). Keep this OUT
  of the pure resolver — it is a caller-side input producer.
- [ ] T012 [P] [US2] Tests `packages/core/test/affects-package.test.ts`: fires on a
  lockfile change to the matching dep; range in-range fires, out-of-range does not;
  manifest-only edit (no changed-dependency entry) does not fire (SC-002); no set →
  inert. Add package cases to the conformance suite.

**Checkpoint**: `package` matchers honor "lockfile, not manifest".

## Phase 5: User Story 4 — Inert degradation (Priority: P3)

*(US4 before US3 so `explain` can render inert matchers correctly.)*

- [ ] T013 [US4] Implement `inert.ts`: `entity`/`resource`/`api`/`data` with no
  backing snapshot contribute no match and emit exactly one `affects-unresolvable`
  (info) each; an unknown `type` emits `affects-unknown-type` (warn) and is
  ignored. `entity` resolves against a supplied `CatalogSnapshot` when present
  (port call), otherwise inert.
- [ ] T014 [P] [US4] Tests `packages/core/test/affects-inert.test.ts`: each unbacked
  type yields one info and no match; unknown type warns and is ignored; a supplied
  catalog snapshot makes `entity` resolve (using a fake in-test port). Add inert
  cases to the conformance suite. (SC-003)

**Checkpoint**: a corpus with all matcher types resolves with zero errors offline.

## Phase 6: User Story 3 — `adr explain` (Priority: P2)

- [ ] T015 [US3] Add `explain` to `packages/cli/src/index.ts` dispatch: load the
  corpus, call `resolveAffects` with `changedFiles=[path]`, render each governing
  record (`id  title` + indented `via <type>: <pattern>`) and, separately, any
  info/warn findings; `--json` per the contract; "no decision governs" exits 0;
  usage error exits 2.
- [ ] T016 [P] [US3] Tests `packages/cli/test/explain.test.ts`: path governed by
  two records names both + their matchers (SC-004); ungoverned path → clear line,
  exit 0; inert matcher shown as unresolved, not a match; `--json` stable/sorted.

**Checkpoint**: `adr explain` is the human view of the resolver; no match is unexplained.

## Phase 7: Purity & CI

- [ ] T017 Implement `packages/core/test/affects-purity.test.ts`
  (`resolution-is-pure`): repeated calls with identical inputs return
  deep-equal output; a call does not read the clock, env, or filesystem (assert via
  no side effects / referential transparency). Structure `affects/` so it imports
  no `node:fs`/`node:child_process`/network modules.
- [ ] T018 Add `resolution-is-pure` to `.github/workflows/ci.yml` (it runs as part
  of `bun test`, but name it explicitly in the gate list/comment so the ADR-0009
  assertion is visible). Keep the Node 22/24 smoke and existing gates. Confirm the
  CI Bun pin remains a published stable version (1.3.14).
- [ ] T019 [P] Extend `scripts/check-deps.ts` expectations if needed so `affects/`
  additions keep `core-has-no-adapter-deps` green; add a test that `@adrkit/core`
  declares only vetted deps (`zod`, `yaml`, `picomatch`, semver).

## Phase 8: Polish & Verification

- [ ] T020 Run the full gate with **stable Bun 1.3.14**: `bun install`,
  `bun run typecheck`, `bun test` (incl. conformance + purity), `bun run build`,
  `bun run lint`, `bun run check:deps`, `bun run schema:emit && git diff
  --exit-code schema/adr.schema.json`, and the Node smoke. All green.
- [ ] T021 [P] `bun run adr explain <a real governed path>` and
  `<an ungoverned path>` per quickstart; confirm output shapes and exit codes.
- [ ] T022 [P] Confirm the conformance `README.md` is sufficient for an independent
  implementation (no adrkit imports required to interpret the cases).

---

## Dependencies & Execution Order

- Setup (T001–T002) → Foundational (T003–T005) block all stories.
- US1 (T006–T009) is the MVP; land first.
- US2 (T010–T012) depends on Foundational.
- US4 (T013–T014) before US3 so `explain` renders inert matchers.
- US3 (T015–T016) depends on the resolver + the CLI dispatch.
- Purity/CI (T017–T019) after the resolver exists; Polish (T020–T022) last.

## Parallel Opportunities

- `[P]` test tasks run together once their target module exists.
- After Foundational, US2 and US4 module work can proceed alongside US1's tests;
  US1 should reach its conformance checkpoint first (MVP).

## Implementation Strategy (MVP first)

1. Setup + Foundational.
2. US1 path resolver + conformance → verify SC-001 (STOP: MVP).
3. US2 package firing.
4. US4 inert degradation, then US3 `adr explain`.
5. Purity assertion + CI, then full verification with stable Bun.
