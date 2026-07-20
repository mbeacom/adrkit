---
description: "Dependency-ordered task list for Deterministic Evaluator (Pass 0)"
---

# Tasks: Deterministic Evaluator (Pass 0)

**Input**: Design documents from `specs/005-deterministic-evaluator/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/pass-0-evaluation.md`, `quickstart.md`, and `checklists/requirements.md`

**Normative**: `docs/adr/0004-git-is-source-of-truth-database-is-an-index.md`,
`docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md`,
`docs/adr/0007-adapter-isolation-and-public-surface-build.md`,
`docs/adr/0009-affects-resolution-and-catalog-binding.md`,
`docs/adr/0010-bun-toolchain.md`, `docs/EVALUATOR_RUBRIC.md`, and
`.specify/memory/constitution.md`

> # ✅ T001 AND T002 ARE CLEARED
>
> Feature 004 T018 is checked with linked second-repository evidence, and the maintainer's
> Rego/JSONPath engine decision is recorded in research, data-model, and contract. Source
> implementation may proceed in dependency order.

**Tests**: REQUIRED and test-first. Each story's test tasks must be written and observed
failing before its implementation tasks begin. All fixtures are offline and model-free.

**Toolchain**: Bun. Any future install or lockfile update must use **stable Bun 1.3.14** and
must preserve `bun.lock` lockfileVersion 1. The environment's canary Bun must not write the
lockfile.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Parallelizable only when the task touches different files and has no dependency on
  another incomplete task in the same phase.
- **[US1]…[US5]**: Maps only user-story-phase tasks to the five stories in `spec.md`.
- Gate, setup, foundational, and polish tasks intentionally have no story label.
- Tasks are checked only with implementation evidence; T001/T002 are complete.
- Every heading named **Execution Phase** below is internal sequencing within feature 005;
  none renumbers project **Phase 4 — Deterministic evaluator** in the root `plan.md`.

## Fixed Pass 0 Contract

The implementation tasks below must preserve this exact rule order and severity:

1. `schema-valid` — `error`
2. `id-unique` — `error`
3. `supersession-consistent` — `error`
4. `no-orphan-refs` — `error`
5. `affects-resolvable` — `warn`
6. `affects-overlap` — `warn`
7. `scope-hierarchy` — `error`
8. `assertions-compile` — `error`
9. `assertions-pass` — `warn`
10. `decider-resolvable` — `warn`
11. `expiry-sane` — `info`

The exhaustive reason-code groups to freeze in code and snapshots are:

- `schema-valid`: `ok`, `file-read`, `parse-error`, `contract-error`
- `id-unique`: `ok`, `collision`
- `supersession-consistent`: `ok`, `dangling-superseded-by`, `non-reciprocal`, `cycle`
- `no-orphan-refs`: `ok`, `dangling-supersedes`, `dangling-relates-to`,
  `federated-log-absent`
- `affects-resolvable`: `ok`, `zero-targets`, `backing-absent`, `resolver-absent`
- `affects-overlap`: `accepted-intersection`, `no-accepted-corpus`, `backing-absent`,
  `none` (primary selection follows failure → empty accepted corpus → inert backing →
  fully evaluated no-intersection)
- `scope-hierarchy`: `ok`, `contradicts-org-assertion`, `evidence-absent`,
  `engine-absent`, `source-absent`, `base-input-absent`, `proposed-input-absent`,
  `not-applicable-scope`
- `assertions-compile`: `ok`, `none`, `no-source`, `ambiguous-source`, `parse-error`,
  `engine-absent`, `source-absent`
- `assertions-pass`: `ok`, `none`, `evaluates-false`, `evaluation-error`,
  `engine-absent`, `input-absent`
- `decider-resolvable`: `ok`, `none-declared`, `zero-match`, `ambiguous-match`,
  `directory-absent`
- `expiry-sane`: `ok`, `past-or-equal`
- shared prerequisites: `not-evaluated.schema-invalid`,
  `not-evaluated.prereq-failed`
- routing: the eight `route.escalate.*` codes and matching
  `route.evidence.*.not-proven` codes in this fixed order:
  `one-way-door`, `cost-threshold`, `security-surface`, `data-residency`, `regulatory`,
  `contradicts-accepted-adr`, `agent-authored-production`, `human-requested`
- route targets: `route.target.not-required`, `route.target.deciders`,
  `route.target.codeowners`, `route.target.catalog-owner`, `route.target.unresolved`

Status aggregation is always `fail > inert > pass`; `not-evaluated` is reserved for
schema-invalid results and `assertions-pass` after compile failure. The primary reason is the
first reason for the winning status in the catalog order, never discovery order.
`candidate-status-not-proposal` is a typed input-contract error, not a rule reason: it emits
no report/patch and maps to CLI exit 2.

---

## Execution Phase 0: Hard Gates

**Purpose**: Enforce the outcome ladder and resolve the only genuine technology gap before
implementation.

- [x] T001 Verify that `specs/004-ci-surface/tasks.md` T018 is checked and links evidence for a second repository, >10 ADRs, selective governing-subset comment behavior, same-comment update after a second push, and default `GITHUB_TOKEN` only; keep T001 open and stop all T002+ work while any item is missing. **Evidence:** public [12-ADR repo](https://github.com/mbeacom/adrkit-t018-dogfood), one-file [PR #1](https://github.com/mbeacom/adrkit-t018-dogfood/pull/1), selective two-ADR [comment](https://github.com/mbeacom/adrkit-t018-dogfood/pull/1#issuecomment-5017253372), [create run](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29702471862), and [same-comment update run](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29702494926), both default-token-only.
- [x] T002 After T001, obtain and record the maintainer's per-engine Rego/JSONPath decision in `specs/005-deterministic-evaluator/research.md`, `specs/005-deterministic-evaluator/data-model.md`, and `specs/005-deterministic-evaluator/contracts/pass-0-evaluation.md`: choose either a vetted deterministic offline in-process source parser/evaluator or the documented caller-supplied compiled-artifact profile; record conformance evidence, artifact validation/security constraints, maintenance/license review, exact wire-profile and dependency impact; forbid any `opa` shell-out and explicitly state that `@open-policy-agent/opa-wasm` evaluates precompiled Wasm and does not compile raw Rego. **Decision:** exact `jsonpath-rfc9535@1.3.0` restricted source profile; fixed caller-supplied Rego-Wasm envelope and typed port, with no built-in Rego runtime or execution in this release. `grep`/`custom` remain inert unless a deterministic caller port is registered.

**Gate checkpoint**: T001 blocks every later task. T002 additionally blocks package
scaffolding, evaluator/CLI work, engine conformance, dependencies, and final verification;
only the neutral core matcher reuse tests/exports T005–T006 may proceed after T001 before
T002. T002 is a maintainer decision, not permission to add dependencies by itself.

---

## Execution Phase 1: Setup

**Purpose**: Create the first-party evaluator surface only after both gates clear.

**Blocked by**: T001 and T002.

- [x] T003 After T001 and T002, scaffold `packages/evaluator/package.json`, `packages/evaluator/tsconfig.json`, and `packages/evaluator/tsconfig.build.json` as the `@adrkit/evaluator` first-party surface with `@adrkit/core` as `workspace:*`; add only dependencies approved by T002 (or none for caller-supplied compiled snapshots), run any manifest/lockfile work with Bun 1.3.14, and preserve dependency direction `@adrkit/cli -> @adrkit/evaluator -> @adrkit/core` in `packages/cli/package.json` and `bun.lock`
- [x] T004 [P] After T001 and T002, define the offline fixture layout and provenance rules in `packages/evaluator/test/fixtures/README.md`, including strict `adrkit.pass0.snapshot/v1` JSON bundles, explicit `evaluationDate`, optional current target-resolution `log` distinct from record source logs, optional federated logs, compact canonical assertion keys produced exactly by `JSON.stringify([record.log ?? "", record.path, assertion.id])` with noncanonical spellings rejected, separate base/current-proposed assertion inputs, the approved source/compiled-artifact engine profiles, and a ban on network, credentials, model calls, clocks, arbitrary port/module selection, and evaluator-side filesystem reads

**Checkpoint**: The package and fixture contract exist, but no rule implementation starts
before the foundational tests below are failing.

---

## Execution Phase 2: Foundational Contracts

**Purpose**: Freeze shared types, catalogs, ports, and core matcher reuse before any story.

**Blocked by**: T001. T005–T006 are intentionally core-only and may run after T001 before
T002/T003; T003 is required only for evaluator tasks T007–T011. T005–T011 must not add or
import adapters.

- [x] T005 After T001, write failing reuse tests in `packages/core/test/affects-target-primitives.test.ts` for the existing repo-relative path glob semantics (including dot segments and invalid/leading-slash patterns) and `parsePackagePattern` semantics over complete dependency inventories, proving the evaluator can reuse the grammar instead of duplicating it
- [x] T006 After T001 and T005, expose only the required neutral path/package matcher primitives from `packages/core/src/affects/index.ts` and `packages/core/src/affects/matchers/path.ts`, preserving existing `resolveAffects` behavior and keeping evaluator-specific target registry concepts out of core
- [x] T007 After T001 and T003, write failing public-contract tests in `packages/evaluator/test/contracts.test.ts` that assert exactly eleven rule ids in fixed order/severity, the exhaustive reason-code catalog and per-rule ordering above, exactly eight routing triggers, compact collision-safe assertion keys exactly equal to `JSON.stringify([record.log ?? "", record.path, assertion.id])` with whitespace/noncanonical variants rejected, an explicit current target-resolution log input separate from record source logs, strict `SnapshotBundleJsonV1` DTO separation from executable ports, typed `candidate-status-not-proposal` input outcomes, generic engine-owned opaque compile payloads paired directly with the same port's evaluate method without unsafe casts, report-only `RuleFinding` identity/evidence fields with `adr: AdrRef`, deeply readonly input shapes, and no duplicate public finding ids
- [x] T008 [P] After T001 and T007, add type-only `z.infer` aliases beside the existing `AdrRef`, `AffectsMatcher`, `Assertion`, `DeterministicFinding`, `Evaluation`, `EscalationReason`, and `Severity` Zod values in `packages/core/src/schema/adr.schema.ts` and export them through `packages/core/src/index.ts` without changing any Zod/JSON schema; then implement immutable Pass 0 input/result/input-error, versioned JSON wire DTO, target, generic assertion-engine payload, identity, routing, report finding/evidence, patch, and envelope types in `packages/evaluator/src/types.ts`, reusing those aliases plus existing `Adr` and `LintCorpusResult` instead of redefining contract shapes
- [x] T009 [P] After T001 and T007, implement the fixed rule/severity catalog, exhaustive `ReasonCode` union, per-rule reason precedence, and eight-trigger routing order in `packages/evaluator/src/catalog.ts`
- [x] T010 [P] After T001 and T007, implement pure caller-supplied interfaces and registries in `packages/evaluator/src/targets/registry.ts`, `packages/evaluator/src/assertions/registry.ts`, and `packages/evaluator/src/identity/directory.ts`; assertion registry properties are generic per engine and preserve the engine-owned opaque immutable payload from compile/artifact validation directly into the same typed port's evaluate call with no hidden mutable ref cache, recompile, or unsafe cast; all ports accept immutable data and expose no filesystem, network, clock, shell, command, or model capability
- [x] T011 After T001 and T008–T010, export only `evaluatePass0`, immutable contract types, catalogs, and port interfaces from `packages/evaluator/src/index.ts`; add a build/typecheck assertion in `packages/evaluator/test/contracts.test.ts` that the public surface contains no CLI, CI, adapter, or executable snapshot-bundle loader

**Checkpoint**: Shared contracts are fixed and matcher grammar is reused from core.

---

## Execution Phase 3: User Story 1 — Structurally Broken Proposals Return Before Any Model (Priority: P1) 🎯 MVP

**Goal**: Return malformed, duplicate-id, inconsistent-supersession, and orphan-reference
proposals with complete deterministic feedback and no later-pass invocation.

**Independent Test**: Evaluate an offline malformed proposal with no model configured and
assert `schema-valid` fails, the next ten results are `not-evaluated` in rubric order,
`outcome` is `returned`, routing is eight `not-proven` statuses plus `not-required`, inputs
are untouched, and `adr evaluate` exits 1.

**Blocked by**: T001 and Phase 2. The CLI composition work also depends on T002.

### Tests for User Story 1 — write and observe failing first

- [x] T012 [P] [US1] After T001, write failing schema/orchestrator tests and pass/fail fixtures in `packages/evaluator/test/schema-valid.test.ts` and `packages/evaluator/test/fixtures/schema-valid/` for parse, file-read, and contract findings on `proposalPath`, asserting one `schema-valid` failure plus exactly ten `not-evaluated.schema-invalid` results, eight ordered `not-proven` routing statuses, `escalate=false`, target `not-required`, a schema-violation-only patch, and no typed-rule execution
- [x] T013 [P] [US1] After T001, write failing pass/fail fixtures and tests in `packages/evaluator/test/id-unique.test.ts` and `packages/evaluator/test/fixtures/id-unique/` proving uniqueness is scoped by `[record.log ?? "", id]`: duplicate ids in one local or named log fail, while the same id in two different named logs passes
- [x] T014 [P] [US1] After T001, write failing tests in `packages/evaluator/test/supersession-consistent.test.ts` and fixtures in `packages/evaluator/test/fixtures/supersession-consistent/` for reciprocal acyclic pass, non-reciprocal fail, cycle fail, and `dangling-supersededBy` ownership without duplicate orphan findings
- [x] T015 [P] [US1] After T001, write failing tests in `packages/evaluator/test/no-orphan-refs.test.ts` and fixtures in `packages/evaluator/test/fixtures/no-orphan-refs/` for local pass/fail, `dangling-supersedes`, `dangling-relatesTo`, a supplied optional federated-log snapshot, and missing federated-log backing as inert rather than orphan failure
- [x] T016 [P] [US1] After T001 and T002, write failing CLI tests in `packages/cli/test/evaluate.test.ts` for malformed-proposal exit 1, invalid invocation/snapshot-contract exit 2, each schema-valid non-proposal status (`accepted`, `rejected`, `superseded`, `deprecated`) producing `candidate-status-not-proposal`, no report/patch, and exit 2, no `--write` option, and proof that no model or later pass is invoked on a structural error

### Implementation for User Story 1

- [x] T017 [US1] After T001 and T012, implement proposal lookup and explicit mapping of proposal-path parse/contract findings onto `schema-valid` in `packages/evaluator/src/rules/schema-valid.ts`, preserving lower-level rule/path/id/field/pattern evidence in report-only `RuleFinding.lowerLevel`/`recordPath` fields and keeping `RuleFinding.adr` strictly an `AdrRef`
- [x] T018 [US1] After T001 and T013, implement `id-unique` in `packages/evaluator/src/rules/id-unique.ts` over the candidate-inclusive corpus plus optional federated-log snapshots, comparing `[record.log ?? "", id]`, allowing equal ids across different logs, and emitting one rubric-keyed aggregate result
- [x] T019 [US1] After T001 and T014, implement deterministic reciprocity and cycle detection in `packages/evaluator/src/rules/supersession-consistent.ts`, reusing `buildAdrGraph` for edges only and mapping `dangling-supersededBy` exclusively to this rule
- [x] T020 [US1] After T001 and T015, implement local and optional federated reference checks in `packages/evaluator/src/rules/no-orphan-refs.ts`, mapping `dangling-supersedes`/`dangling-relatesTo` only here and returning `no-orphan-refs.federated-log-absent` when required external-log data is missing
- [x] T021 [US1] After T001 and T017–T020, implement the schema-invalid short-circuit, typed `candidate-status-not-proposal` input outcome for schema-valid non-`draft`/`proposed` records, and non-schema-error continuation skeleton in `packages/evaluator/src/pass0.ts`, guaranteeing exactly eleven ordered result slots only for evaluated proposal candidates, deterministic schema-invalid routing (`8x not-proven`, no escalation, `not-required`), no report/patch for the input-error branch, `returned` iff an error rule fails, and no invocation point for Passes 1–3
- [x] T022 [US1] After T001, T002, T016, and T021, add `adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [--json]` dispatch in `packages/cli/src/index.ts` with composition helpers in `packages/cli/src/evaluate.ts` and `packages/cli/src/evaluate-snapshot.ts`; load the full `lintCorpus` result including malformed findings, reject schema-valid non-`draft`/`proposed` candidates as `candidate-status-not-proposal`, strictly validate `adrkit.pass0.snapshot/v1` JSON with unknown/duplicate-key and compact `JSON.stringify` assertion-key rejection, pass the optional bundle `log` as current target-resolution context without conflating it with record source logs, normalize omitted optional backing to inert runtime containers and only set-like arrays deterministically while preserving semantic declaration arrays, inject executable registries separately, call `@adrkit/evaluator`, print without mutation, and implement structural-error exit 1 versus usage/input-contract exit 2

**Checkpoint**: US1's malformed and structural-error paths are independently testable
offline and never reach a model-bearing pass.

---

## Execution Phase 4: User Story 2 — Byte-Reproducible Ordered Reports (Priority: P1)

**Goal**: Produce total-ordered, canonical report and patch bytes from identical inputs.

**Independent Test**: Run the same fixture twice with reordered input collections and assert
identical LF-terminated bytes for `report` and `patch`, with run metadata excluded.

**Blocked by**: T001, Phase 2, and T021.

### Tests for User Story 2 — write and observe failing first

- [x] T023 [P] [US2] After T001, write failing aggregate-result tests in `packages/evaluator/test/aggregate-result.test.ts` for multiple sub-findings, `fail > inert > pass`, fixed primary-reason selection, retained subordinate findings, and `assertions-pass` prerequisite `not-evaluated` outside ordinary aggregation
- [x] T024 [P] [US2] After T001, write failing ordering snapshots in `packages/evaluator/test/report-order.test.ts` and `packages/evaluator/test/fixtures/report-order/expected.json` for rubric order first and `RuleFinding` secondary keys in candidate `AdrRef`, related `AdrRef`, matcher/assertion key, canonical target key, `recordPath`, `field`, and message order; preserve lower-level evidence; prove `adr` never contains a path; and place routing after the eleven rules
- [x] T025 [P] [US2] After T001, write failing canonical-byte tests in `packages/evaluator/test/canonical-bytes.test.ts` for sorted object keys, canonical comparators on set-like maps/sets/arrays only, preservation of rubric/trigger/declaration order for rule results, routing reasons/evidence, deciders, CODEOWNERS rules/owners, catalog owners, matchers, and assertions, LF newlines, no accidental insertion-order dependence, and no timestamp/run id/duration inside the deterministic payload

### Implementation for User Story 2

- [x] T026 [US2] After T001 and T023, implement deterministic finding aggregation and primary-reason selection in `packages/evaluator/src/report/aggregate.ts`
- [x] T027 [US2] After T001, T024, and T026, implement exactly-eleven `Pass0Report` assembly and stable secondary comparators in `packages/evaluator/src/report/assemble.ts` and `packages/evaluator/src/report/order.ts`
- [x] T028 [US2] After T001, T025, and T027, implement canonical JSON serialization for report/patch payloads in `packages/evaluator/src/report/serialize.ts`, excluding caller metadata and emitting sorted object keys, documented sorting only for set-like arrays, preserved fixed/declaration order for semantic arrays, and LF termination
- [x] T029 [US2] After T001 and T028, update `packages/cli/src/evaluate.ts` so `--json` wraps deterministic `{ report, patch }` bytes with optional caller metadata outside the result and the human renderer consumes the same ordered content

**Checkpoint**: US2 reproduces identical deterministic bytes across input order and machine
boundaries.

---

## Execution Phase 5: User Story 3 — Complete Model-Free Pass 0 in a Clean Clone (Priority: P1)

**Goal**: Implement all eleven rules over immutable offline inputs, with explicit inert
degradation and no runtime I/O in the pure library.

**Independent Test**: Run the complete pass/fail/inert fixture matrix in a clean clone with no
model, key, network, service, clock, or evaluator-side filesystem access.

**Blocked by**: T001 and Phases 2–4. T032 and T037 also depend on the approved T002 engine
decision.

### Tests for User Story 3 — write and observe failing first

- [x] T030 [P] [US3] After T001, write failing target-resolution tests in `packages/evaluator/test/affects-rules.test.ts` and fixtures in `packages/evaluator/test/fixtures/affects/` for path/package grammar reuse, caller-registered entity/resource/api/data resolvers, ADR-0009 include+negation subtraction, negation-only empty resolution, same-`repo` match and different-`repo` local non-match against an explicit current target-resolution log distinct from record source logs, backing-absent and resolver-absent inert results, present backing with zero targets as warn, canonical ids, accepted-only overlap, `affects-overlap.no-accepted-corpus` when no accepted ADRs, `affects-overlap.none` when accepted ADRs exist without intersection, fail/inert/pass primary precedence, and one warn per proposal/accepted-ADR pair
- [x] T031 [P] [US3] After T001, write failing scope tests in `packages/evaluator/test/scope-hierarchy.test.ts` and fixtures in `packages/evaluator/test/fixtures/scope-hierarchy/` for component-only applicability, accepted org overlap, org-without-domain global behavior, exact domain matching, evaluator-computed base-green to current/proposed-red assertion transitions, rejection of precomputed contradiction verdicts, and every missing source/artifact/engine/base/proposed prerequisite as inert
- [x] T032 [P] [US3] After T001 and T002, write failing assertion tests in `packages/evaluator/test/assertions.test.ts` and fixtures in `packages/evaluator/test/fixtures/assertions/` for compact `JSON.stringify([record.log ?? "", record.path, assertion.id])` keys that remain distinct under duplicate ADR ids and reject whitespace/noncanonical variants, inline versus caller-resolved file content, both/neither source errors, missing engine/source/artifact/input inertness, approved Rego/JSONPath source or compiled-artifact conformance, registered grep/custom behavior, one compile/artifact-validation whose engine-owned opaque immutable payload is passed directly into evaluate without ref lookup/recompile/unsafe cast, compile failure causing only `assertions-pass` to be `not-evaluated.prereq-failed`, and false/evaluation-error warn outcomes
- [x] T033 [P] [US3] After T001, write failing identity/date tests in `packages/evaluator/test/identity-expiry.test.ts` and fixtures in `packages/evaluator/test/fixtures/identity-expiry/` for every decider resolving once, none/zero/ambiguous warnings, absent directory inertness, absent `reviewBy` pass, and `reviewBy` strictly after versus equal/before an explicitly supplied `evaluationDate` without reading the clock
- [x] T034 [P] [US3] After T001, write the failing complete matrix and purity tests in `packages/evaluator/test/pass0-matrix.test.ts` and `packages/evaluator/test/purity.test.ts`: pass/fail/inert where applicable for all eleven rules, mixed fail+inert aggregate precedence, exact reason codes, deep-frozen input immutability, current/proposed assertion input separation, and traps that fail on evaluator clock/network/filesystem/model access

### Implementation for User Story 3

- [x] T035 [US3] After T001, T006, and T030, implement canonical target normalization plus pure path/package built-ins and caller-supplied entity/resource/api/data ports in `packages/evaluator/src/targets/canonical.ts`, `packages/evaluator/src/targets/path.ts`, and `packages/evaluator/src/targets/package.ts`, reusing core matcher primitives without copying their grammar and passing the caller's current target-resolution log explicitly to each port
- [x] T036 [US3] After T001, T030, and T035, implement `affects-resolvable` and accepted-only once-per-pair `affects-overlap` in `packages/evaluator/src/rules/affects-resolvable.ts` and `packages/evaluator/src/rules/affects-overlap.ts`
- [x] T037 [US3] After T001, T002, and T032, implement the approved Rego/JSONPath option and generic deterministic registry behavior in `packages/evaluator/src/assertions/rego.ts`, `packages/evaluator/src/assertions/jsonpath.ts`, and `packages/evaluator/src/assertions/registry.ts`: each engine owns an opaque immutable payload type shared by its compile/validate and evaluate methods; either truthfully compile/evaluate source in-process with vetted engines or validate/evaluate only the fixed caller-supplied compiled-artifact DTO through the trusted registered port; never shell out, import/select arbitrary snapshot modules, use hidden mutable compiled-state registries, recompile during evaluate, require unsafe casts, or describe `opa-wasm` as a raw-Rego compiler
- [x] T038 [US3] After T001, T032, and T037, implement exactly-one-source compilation and evaluation in `packages/evaluator/src/rules/assertions-compile.ts` and `packages/evaluator/src/rules/assertions-pass.ts`, reading resolved content/input only from immutable snapshots, passing each successful `CompiledAssertion<E, Payload>` directly to the same typed port's evaluate method, and keeping compile failure distinct from evaluate-false
- [x] T039 [US3] After T001, T031, T035, and T038, implement attributable scope contradiction evaluation in `packages/evaluator/src/rules/scope-hierarchy.ts`, using accepted org assertions with explicit base versus current/proposed inputs and never inferring contradiction from prose or overlap alone
- [x] T040 [US3] After T001 and T033, implement immutable directory decider resolution and explicit-date expiry checks in `packages/evaluator/src/rules/decider-resolvable.ts` and `packages/evaluator/src/rules/expiry-sane.ts`
- [x] T041 [US3] After T001 and T034–T040, wire all eleven real rule modules into `packages/evaluator/src/pass0.ts`, continue independent rules after non-schema errors, enforce only direct prerequisite suppression, return new values without mutating input, and perform no runtime I/O
- [x] T042 [US3] After T001, T002, and T041, complete strict `SnapshotBundleJsonV1` validation and normalization in `packages/cli/src/evaluate-snapshot.ts` for optional current target-resolution `log`, optional federated logs/per-type target inventories, assertion sources or approved compiled artifacts, current/proposed inputs, identity, scope/routing evidence, canonical tuple/target keys, immutable set conversion, and required `--date`, while preventing JSON from selecting modules/ports and constructing trusted target/assertion ports in `packages/cli/src/evaluate.ts`

**Checkpoint**: US3 is a complete, useful, offline Pass 0 with all eleven rules and no model.

---

## Execution Phase 6: User Story 4 — Declarative Reason Events and Human Routing (Priority: P2)

**Goal**: Emit ordered reason-code events, escalate only on proven evidence, and route to one
named active human or an explicit unresolved state without approving.

**Independent Test**: Exercise all eight triggers and target fallbacks offline; assert ordered
proven/not-proven evidence, named-human or unresolved routing, no record mutation, and exit 0
for warn/info-only escalation.

**Blocked by**: T001 and T041–T042. Engine-backed accepted-assertion routing also depends on
T002/T037.

### Tests for User Story 4 — write and observe failing first

- [x] T043 [P] [US4] After T001, write failing routing-trigger tests in `packages/evaluator/test/routing-triggers.test.ts` and fixtures in `packages/evaluator/test/fixtures/routing/` for exactly eight ordered evidence statuses, each proven trigger, missing evidence as not-proven, later-pass-only reasons absent, non-escalated `route.target.not-required`, and `contradicts-accepted-adr` based on overlap plus accepted-assertion failure against current/proposed input without the org/domain/base-green requirements of `scope-hierarchy`
- [x] T044 [P] [US4] After T001, write failing routing-target tests in `packages/evaluator/test/routing-target.test.ts` for source order `deciders -> CODEOWNERS(resolved paths) -> catalog owners(resolved entities)`; decider declaration order; canonical unique-path order with the last matching CODEOWNERS rule winning per path and its owners preserving declaration order; canonical unique-entity order with catalog owners preserving snapshot order; stable first-occurrence deduplication without global identity sorting; inactive direct-human skipping; teams resolving to exactly one active human; the first zero/many-active-member team immediately producing `route.target.unresolved` without later fallback; and exhausted candidates producing unresolved
- [x] T045 [P] [US4] After T001 and T002, write failing CLI boundary/exit tests in `packages/cli/test/evaluate-routing.test.ts` proving snapshot JSON cannot select/import modules or ports, any approved compiled artifact is consumed only by its trusted fixed-profile engine, registries come from composition code, exit 0 covers pass/warn/info/inert results even when escalated or unresolved, exit 1 only covers rubric errors, exit 2 only covers usage/malformed bundle, and no path approves or persists

### Implementation for User Story 4

- [x] T046 [US4] After T001 and T043, implement the declarative OR and ordered trigger evidence in `packages/evaluator/src/routing/triggers.ts`, using only the eight existing Pass 0 escalation reasons and evaluating routing after all eleven rule results
- [x] T047 [US4] After T001 and T044, implement the exact decider/CODEOWNERS/catalog candidate construction, CODEOWNERS last-matching-rule semantics, declaration-order preservation, stable first-occurrence dedupe, direct-human skipping, team ambiguity barrier, and explicit unresolved/not-required targets in `packages/evaluator/src/routing/target.ts`
- [x] T048 [US4] After T001, T037, T043, T046, and T047, implement accepted-ADR assertion routing in `packages/evaluator/src/routing/accepted-assertion.ts` and integrate it in `packages/evaluator/src/pass0.ts`, keeping its current/proposed failure condition distinct from the narrower scope-hierarchy base-green transition
- [x] T049 [US4] After T001, T002, T045, and T048, complete human/JSON rendering and exit selection in `packages/cli/src/evaluate.ts` and `packages/cli/src/index.ts`, preserving the data-snapshot versus trusted executable-port boundary and exact exit codes 0/1/2

**Checkpoint**: US4 routes on proven evidence, never approves, and resolves a human honestly.

---

## Execution Phase 7: User Story 5 — Current-Schema Evaluation Patch (Priority: P2)

**Goal**: Return a violations-only patch that validates against the current schema while all
richer evidence stays on the runtime report.

**Independent Test**: Validate every returned patch against the current committed schema,
assert no extra fields or inert/not-evaluated findings, and prove schema emit is byte-clean.

**Blocked by**: T001 and T027, T041, and T048.

### Tests for User Story 5 — write and observe failing first

- [x] T050 [P] [US5] After T001, T027, T041, and T048, write failing patch-projection tests in `packages/evaluator/test/evaluation-patch.test.ts` for violations only, exact `{ rule, severity, message?, adr? }` finding keys with `adr` validating strictly as `AdrRef`, rubric-id mapping without duplicate lower-level findings, report-only candidate/related ADR, matcher/assertion key, target, `recordPath`, field, source, and lower-level evidence fields, proof that no path can be projected into `adr`, and escalation reasons copied in fixed trigger order
- [x] T051 [P] [US5] After T001, T027, T041, and T048, write failing current-schema and drift tests in `packages/evaluator/test/evaluation-patch-schema.test.ts` using the committed `packages/core/src/schema/adr.schema.ts`, and extend `packages/core/test/schema-emit.test.ts` to prove evaluator output requires no Zod or JSON Schema edit and `schema/adr.schema.json` emits byte-clean

### Implementation for User Story 5

- [x] T052 [US5] After T001, T027, T041, T048, and T050, implement the schema-minimal violations-only projection in `packages/evaluator/src/patch/project.ts`, stripping all operational-only fields and returning data without writing any ADR, review state, database, or index
- [x] T053 [US5] After T001, T027–T029, T041, T048, T051, and T052, integrate `{ report, patch }` return assembly in `packages/evaluator/src/pass0.ts` and `packages/cli/src/evaluate.ts`, preserving canonical bytes and keeping caller run metadata outside both deterministic artifacts

**Checkpoint**: US5 validates against the existing schema with no schema change or persistence.

---

## Execution Phase 8: Purity Gates, Documentation, and Clean-Clone Verification

**Purpose**: Make the architecture and offline guarantees mechanically enforceable.

**Blocked by**: T001, T002, and all selected user-story phases.

- [x] T054 [P] After T001 and T002, write failing dependency-boundary cases in `scripts/check-deps.test.ts` for the allowed chain `@adrkit/cli -> @adrkit/evaluator -> @adrkit/core`, conditional T002-approved deterministic engine dependencies only, and rejection of evaluator imports from `packages/adapters/*`, model/prompt/embedding/retrieval packages, GitHub toolkits, network clients, filesystem traversal helpers, or undeclared engine/tool binaries
- [x] T055 After T001, T002, and T054, extend `scripts/check-deps.ts` to enforce the evaluator allow-list and the one-way package graph, then verify `packages/evaluator/package.json`, `packages/cli/package.json`, and `bun.lock` contain only the T002-approved dependencies installed with Bun 1.3.14
- [x] T056 [P] After T001 and T053, add evaluator/CLI Node 22 and 24 smoke coverage plus an offline no-model fixture invocation to `scripts/smoke-node.mjs` and `.github/workflows/ci.yml`, preserving the existing `clean-clone-builds`, dependency, schema-emit, ADR lint, and Action bundle gates without adding credentials, services, or network runtime requirements
- [x] T057 [P] After T001, T002, and T053, update `README.md` and `specs/005-deterministic-evaluator/quickstart.md` with the final offline `adr evaluate` invocation, immutable snapshot-data contract, executable-port boundary, explicit date, exit codes 0/1/2, named-human/unresolved routing, no `--write`, and the approved T002 Rego/JSONPath semantics without claiming raw Rego compilation when only compiled snapshots are supported
- [x] T058 After T001 and T055–T057, run and record final evidence in `specs/005-deterministic-evaluator/quickstart.md` using stable Bun 1.3.14: frozen clean-clone install, typecheck, all offline tests including the 11-rule pass/fail/inert matrix, build, lint, dependency checks, Node 22/24 smoke, canonical-byte repetition, input immutability, no-model/no-I/O proof, and `bun run schema:emit` followed by a byte-clean `schema/adr.schema.json` diff

---

## Dependencies & Execution Order

### Hard-Gate Dependencies

- **T001 blocks every task T002–T058.** T001 may be checked only after feature 004 T018 itself
  is checked with linked evidence for all five required observations.
- **T002 is the second gate.** It blocks T003–T004, T016, T022, T032, T037, T042, T045, T048,
  T049, T054, T055, T057, and T058. No engine dependency, manifest, lockfile, conformance
  implementation, or CLI registry composition may precede the approved decision.
- T001 and T002 are now complete; later tasks still preserve their declared dependencies.

### Phase Dependencies

- **Setup (T003–T004)**: Depends on T001 and T002.
- **Foundational (T005–T011)**: Depends on T001. Core-only T005–T006 intentionally may run
  before T002/T003; T006 follows failing T005. T003 is a prerequisite only for evaluator
  tasks T007–T011; implementations T008–T010 follow failing T007; T011 follows T008–T010.
- **US1 (T012–T022)**: Depends on Foundation. Tests T012–T016 precede implementations
  T017–T022. T021 follows all structural rules; T022 follows T002, T016, and T021.
- **US2 (T023–T029)**: Depends on Foundation and T021. Tests T023–T025 precede T026–T029.
- **US3 (T030–T042)**: Depends on US1/US2 contracts. Tests T030–T034 precede T035–T042.
  Assertion conformance tasks additionally depend on T002.
- **US4 (T043–T049)**: Depends on the complete rule set T041–T042. Tests T043–T045 precede
  T046–T049.
- **US5 (T050–T053)**: Depends on report assembly T027, full rules T041, and routing T048.
  Tests T050–T051 precede T052–T053.
- **Polish (T054–T058)**: Depends on all desired stories; final verification T058 follows all
  dependency, CI, and documentation tasks.

### User Story Completion Order

```text
T001 upstream evidence
  ├──> T005 -> T006 neutral core matcher reuse (may precede T002/T003)
  └──> T002 engine decision
       -> T003-T004 Setup
       -> T007-T011 evaluator Foundation
  -> US1 structural return (MVP path)
  -> US2 canonical report
  -> US3 complete eleven-rule offline Pass 0
  -> US4 routing/reason events
  -> US5 schema-compatible patch
  -> purity gates + clean-clone verification
```

US1 and US2 are both P1 but share report/orchestrator contracts, so implement US1 first and
then canonicalize its outputs in US2. US3 completes the full rule set before US4 routing can
consume target/assertion evidence. US5 projects the completed report and routing decision.

### Success-Criteria Traceability

| Success criterion | Primary proving tasks |
|---|---|
| SC-001 structural errors return / exit 1 | T012–T022, T041, T049 |
| SC-002 warn/info-only exit 0 | T045, T049 |
| SC-003 all-rule offline pass/fail/inert fixtures | T012–T015, T030–T034, T058 |
| SC-004 byte reproduction | T025, T028, T053, T058 |
| SC-005 total ordering | T024, T027, T043 |
| SC-006 dependency purity / clean clone | T034, T054–T058 |
| SC-007 missing backing is inert | T015, T030–T034 |
| SC-008 current-schema patch / no persistence | T050–T053, T058 |
| SC-009 lower-level finding maps once | T007, T014–T020, T050 |
| SC-010 eleven reason events | T007, T024, T027, T043 |
| SC-011 proven escalation subset only | T043, T046, T048 |
| SC-012 no mutation / DB / runtime I/O | T034, T041, T052, T058 |
| SC-013 upstream outcome gate | T001 |
| SC-014 named-human / unresolved routing | T044, T047, T049 |
| SC-015 schema-invalid complete shape | T012, T021 |

---

## Parallel Execution Examples

Parallel work never bypasses T001. Only neutral core tasks T005–T006 may proceed before T002;
all setup, evaluator, CLI, engine, dependency, and verification work waits for T002.

### User Story 1

```text
After Foundation: T012 || T013 || T014 || T015 || T016
Then: T017 || T018 || T019 || T020
Then: T021 -> T022
```

### User Story 2

```text
After T021: T023 || T024 || T025
Then: T026 -> T027 -> T028 -> T029
```

### User Story 3

```text
After US2 and T002: T030 || T031 || T032 || T033 || T034
Then independent modules where prerequisites permit:
  T035 -> T036
  T037 -> T038
  T040
Then: T039 -> T041 -> T042
```

### User Story 4

```text
After T041-T042: T043 || T044 || T045
Then: T046 || T047
Then: T048 -> T049
```

### User Story 5

```text
After T048: T050 || T051
Then: T052 -> T053
```

---

## Implementation Strategy

### Gate First

1. Feature 004 T018 evidence was reviewed and T001 was checked.
2. T002 records the maintainer decision and conformance/security evidence.
3. Package, evaluator, CLI, engine, dependency, and verification work may now proceed
   in the dependency order below.

### MVP First

1. Complete Setup and Foundation.
2. Write US1 tests first and observe them fail.
3. Implement US1's schema-invalid and structural-return paths.
4. Stop and validate the US1 independent test with no model configured.
5. Add US2 canonical reporting before expanding to all externally backed rules.

### Incremental Delivery

1. **US1**: Structural errors return before any probabilistic pass.
2. **US2**: The runtime record is canonical and byte-reproducible.
3. **US3**: All eleven rules run offline with honest inert degradation.
4. **US4**: Proven triggers emit ordered events and route to a human/unresolved target.
5. **US5**: The returned violations-only patch validates against the current schema.
6. Extend purity/dependency/clean-clone gates and run the complete offline verification.

### Non-Negotiable Boundaries

- Scope remains deterministic Pass 0 only; no Passes 1–3, model, prompt, retrieval,
  embedding, scoring, adversarial logic, or acceptance decision.
- `@adrkit/evaluator` performs no runtime I/O and imports no adapter.
- `@adrkit/cli` owns filesystem/git reads and data-bundle validation; snapshot JSON never
  selects or executes code.
- The evaluator returns `report` and `patch`; it never writes records or persistence state.
- No schema edit is allowed. Rich evidence stays on `Pass0Report`; the patch remains the
  committed four-field finding shape plus existing escalation fields.
