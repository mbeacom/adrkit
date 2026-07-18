---
description: "Task list for Schema and Core (Phase 0)"
---

# Tasks: Schema and Core (Phase 0)

**Input**: Design documents from `specs/001-schema-and-core/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-commands.md

**Tests**: REQUIRED. The spec's SC-002 and constitution Principles IV–V mandate a
pass/fail test per cross-field and cross-record invariant. Test tasks are included.

**Organization**: Grouped by user story (US1–US4) so each can be built and
verified independently. Toolchain is Bun (ADR-0010): `bun install`, `bun test`,
`bun run`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an unbuilt file)
- **[Story]**: US1 (validate), US2 (schema contract), US3 (new), US4 (graph), or
  SETUP/FOUND/CI/POLISH for cross-cutting work
- Paths are repo-relative to the worktree root.

## Path Conventions

Bun monorepo per plan.md Project Structure:
`packages/core/src/**`, `packages/cli/src/**`, `schema/**`, `scripts/**`,
`.github/workflows/**`. Root `package.json` already declares workspaces
`["packages/*","packages/adapters/*"]` and the `build/test/typecheck/lint/
schema:emit/check:deps/adr` scripts (targets created by these tasks).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: workspace skeleton so every later package resolves.

- [ ] T001 Create `packages/core/` and `packages/cli/` with `package.json`
  (`@adrkit/core`, `@adrkit/cli`), `tsconfig.json` extending the root, and empty
  `src/index.ts` barrels. `@adrkit/cli` depends on `@adrkit/core` and declares the
  `adr` bin; neither declares any adapter dependency.
- [ ] T002 Add dev dependencies to the appropriate `package.json`: `zod@^4`,
  `yaml`, `@types/bun`. Run `bun install`; confirm `bun.lock` stays text
  (`saveTextLockfile`) and `linker="isolated"` is untouched.
- [ ] T003 [P] Verify root scripts resolve to the new packages: `bun run typecheck`
  succeeds on the empty barrels; `bun run build` (if a build step exists) is a
  no-op or succeeds. Fix path wiring only — do not add tools.

**Checkpoint**: `bun install` + `bun run typecheck` are green on empty packages.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the record contract and parser everything else depends on.
**⚠️ No user-story work starts until this phase is done.**

- [ ] T004 Port `schema/adr.schema.ts` into `packages/core/src/schema/adr.schema.ts`
  verbatim (Zod source of truth), re-exporting `AdrFrontmatter`, `Adr` types,
  `SCHEMA_VERSION`, and the `.refine()` chain. Keep root `schema/adr.schema.ts` as
  a thin re-export from core so existing imports and MANIFEST paths stay valid.
- [ ] T005 Implement `packages/core/src/schema/emit.ts` exporting `emitJsonSchema()`
  using Zod 4 `z.toJSONSchema()` (R1). Add `packages/core/src/schema/emit.cli.ts`
  (writes `schema/adr.schema.json`, sorted-key, trailing newline) wired to the
  root `schema:emit` script.
- [ ] T006 Regenerate `schema/adr.schema.json` via `bun run schema:emit`; commit
  the regenerated file so a fresh emit is byte-identical (resolves the drafting
  drift, R1). `git diff --exit-code schema/adr.schema.json` must be clean.
- [ ] T007 Implement `packages/core/src/parse/frontmatter.ts` — split leading
  `---` YAML block from body (preserve body bytes) and parse via `yaml` (R2).
  Returns `{ data: unknown, body: string }`; throws a typed error on missing/
  malformed fence.
- [ ] T008 Implement `packages/core/src/load/corpus.ts` — walk a dir for
  `NNNN-*.md`, skip `0000-template.md` and non-matching names, sort by path,
  parse+validate each into `Adr`, and expose `byId` lookup (R3, data-model
  Corpus).
- [ ] T009 Implement `packages/core/src/validate/findings.ts` — the `Finding` type
  (rule, severity, message, path?, id?, field?) and helpers to sort findings
  (by id then rule) and compute the aggregate exit code (non-zero iff any error).

**Checkpoint**: core can load and contract-validate a corpus; schema emit is drift-free.

---

## Phase 3: User Story 1 — Validate the corpus (Priority: P1) 🎯 MVP

**Goal**: `adr lint` reports contract + cross-record violations and exits non-zero
on error. Shipping condition for the phase (SC-001).

- [ ] T010 [US1] Implement `packages/core/src/validate/contract.ts` — run the Zod
  `safeParse` per record; map issues (including the intra-record `.refine()`
  failures) to `Finding`s with stable rule ids and the offending `field` path.
- [ ] T011 [US1] Implement `packages/core/src/validate/corpus-invariants.ts` —
  unique `id` across records, and resolution of `supersedes`/`supersededBy`/
  `relatesTo`/`conflictsWith` to existing records; `conflictsWith`→warn, unresolved
  required refs→error (R4, data-model corpus invariants).
- [ ] T012 [US1] Implement `packages/core/src/validate/index.ts` `lintCorpus(dir)`
  composing load + contract + corpus-invariants into a single sorted `Finding[]`
  and `checked` count; malformed files become findings, not crashes (FR-012).
- [ ] T013 [P] [US1] Tests `packages/core/test/invariants.test.ts` — a pass and a
  fail case for each intra-record refine (superseded↔supersededBy,
  accepted-needs-decider-unless-imported, agent-accepted-needs-ratifier,
  one-way-door≠auto, strict-unknown-key) using fixtures (SC-002).
- [ ] T014 [P] [US1] Tests `packages/core/test/corpus-invariants.test.ts` —
  duplicate id detected; dangling `supersededBy`/`relatesTo` detected; clean
  corpus yields zero errors.
- [ ] T015 [P] [US1] Tests `packages/core/test/frontmatter.test.ts` — block
  scalars, arrays, nested maps parse; body bytes preserved; missing fence errors.
- [ ] T016 [US1] Implement `packages/cli/src/index.ts` dispatch + `adr lint`
  (`node:util parseArgs`, `--json`, `--dir`, exit 0/1/2 per contract). Human output
  grouped by file with the summary line; `--json` stable/sorted (R5, CLI contract).
- [ ] T017 [US1] Tests `packages/cli/test/lint.test.ts` — run `adr lint` over
  `docs/adr/` and assert exit 0 and `errors 0` (SC-001); assert exit 1 on a
  fixture corpus containing an error.

**Checkpoint**: `bun run adr lint` green on this repo; MVP deliverable met.

---

## Phase 4: User Story 2 — Schema is the published contract (Priority: P2)

**Goal**: JSON Schema is emitted from the Zod source and drift is gated (SC-003).

- [ ] T018 [US2] Tests `packages/core/test/schema-emit.test.ts` — assert a fresh
  `emitJsonSchema()` deep-equals the committed `schema/adr.schema.json` (the
  `schema-emit-matches` assertion at test level).
- [ ] T019 [US2] Tests `packages/core/test/schema-shape.test.ts` — the emitted
  schema advertises the expected `$id` (`https://adrkit.dev/...`), `schemaVersion`
  default, and required top-level fields; documents that `.refine()` invariants are
  intentionally absent from JSON Schema (R1 note).

**Checkpoint**: schema drift is a test failure; artifact matches source.

---

## Phase 5: User Story 3 — Scaffold a new record (Priority: P3)

**Goal**: `adr new` writes a record that immediately passes `adr lint` (SC-004).

- [ ] T020 [US3] Implement `packages/core/src/scaffold/new.ts` — next sequential
  id (max existing + 1, zero-pad ≥4), slugify title, render frontmatter + body
  skeleton mirroring `docs/adr/0000-template.md`; no `affects` inference (deferred).
- [ ] T021 [US3] Wire `adr new <title> [--status] [--dir] [--json]` into the CLI
  dispatch (CLI contract); refuse to overwrite an existing path (exit 1).
- [ ] T022 [P] [US3] Tests `packages/core/test/scaffold.test.ts` — generated record
  parses and lints clean; id increments past the current max (0010 → 0011);
  slug/title bounds enforced.

**Checkpoint**: `adr new` output validates without hand-editing.

---

## Phase 6: User Story 4 — Visualize decision relationships (Priority: P3)

**Goal**: `adr graph` emits a diffable relationship graph (SC-007).

- [ ] T023 [US4] Implement `packages/core/src/graph/build.ts` — nodes from records,
  edges from `supersededBy` + `relatesTo`/`conflictsWith`; drop edges to absent
  records (R6, CLI contract). Renderers: DOT (default) and JSON edge list.
- [ ] T024 [US4] Wire `adr graph [--dir] [--format dot|json]` into the CLI dispatch;
  `graph` never fails on dangling refs (that is `lint`'s job).
- [ ] T025 [P] [US4] Tests `packages/core/test/graph.test.ts` — a known superseding
  pair yields the expected edge; an edge to a missing id is omitted; DOT and JSON
  renderers agree on the node/edge set.

**Checkpoint**: `adr graph` renders this repo's corpus.

---

## Phase 7: CI & Enforcement Gates

**Purpose**: make the constitution gates executable (Principles II, III, V).

- [ ] T026 Implement `scripts/check-deps.ts` — fail if any non-adapter workspace
  depends on `packages/adapters/**`, or if `@adrkit/core`/`@adrkit/cli` declare a
  disallowed dependency (R7, ADR-0007). Wire to root `check:deps` script.
- [ ] T027 [P] Tests `scripts/check-deps.test.ts` (or `packages/core/test/`) — the
  check passes on the current tree and fails on a synthetic adapter-dep injection.
- [ ] T028 Create `.github/workflows/ci.yml` running, on a clean clone with Bun:
  `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run
  schema:emit && git diff --exit-code schema/adr.schema.json`
  (`schema-emit-matches`), `bun run check:deps` (`core-has-no-adapter-deps`), and
  `bun run adr lint` — the three named gate assertions plus the clean-clone build
  (`clean-clone-builds`). No credentials, no services, no network beyond install.
- [ ] T029 Update root `package.json` scripts if any target path changed; confirm
  `build`, `test`, `typecheck`, `lint`, `schema:emit`, `check:deps`, `adr` all
  resolve to real files.

**Checkpoint**: CI encodes clean-clone-builds, schema-emit-matches, core-has-no-adapter-deps.

---

## Phase 8: Polish & Verification

- [ ] T030 Run the full local gate: `bun install`, `bun run typecheck`, `bun test`,
  `bun run schema:emit && git diff --exit-code schema/adr.schema.json`,
  `bun run check:deps`, `bun run adr lint`. All green (quickstart "green").
- [ ] T031 [P] Ensure `bun run lint` (formatting/static analysis, if configured)
  passes; do not introduce a new linter — use what the repo already declares.
- [ ] T032 [P] Sanity-check `adr new` + `adr graph` manually per quickstart; delete
  any scratch record created during the check so `docs/adr/` returns to 0001–0010.

**Checkpoint**: Phase 0 exit criteria met — `adr lint` green on `docs/adr/`, schema
emit drift gated in CI.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T009)** block everything.
- **US1 (T010–T017)** depends only on Foundational — this is the MVP; ship first.
- **US2 (T018–T019)** depends on T005–T006 (emit).
- **US3 (T020–T022)** and **US4 (T023–T025)** depend on Foundational + the CLI
  dispatch from T016; they are independent of each other and of US2.
- **CI (T026–T029)** depends on the scripts/commands it invokes existing.
- **Polish (T030–T032)** last.

## Parallel Opportunities

- All `[P]` test tasks within a story run together once their target module exists.
- After Foundational, US2 / US3 / US4 module work can proceed in parallel lanes;
  US1 should land first to satisfy the MVP checkpoint.

## Implementation Strategy (MVP first)

1. Setup + Foundational.
2. US1 end-to-end → verify `adr lint` green on `docs/adr/` (STOP: MVP shippable).
3. US2 drift gate.
4. US3 + US4 in parallel.
5. CI gates, then full verification.
