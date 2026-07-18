# Implementation Plan: Affects Resolution (Phase 1)

**Branch**: `002-affects-resolution` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-affects-resolution/spec.md`
**Normative source**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (one-way-door).

## Summary

Make decision records **locatable**. Add a pure resolver in
`packages/core/src/affects/` that maps each record's `affects` matchers onto a
changed-file set (plus optional, caller-supplied backing snapshots) and returns
the governing records, per ADR-0009 union-per-ADR semantics. Fully implement the
two reproducible matcher types (`path`, `package`); make `entity`/`resource`/
`api`/`data` parse and resolve **inert** with an `info` finding when unbacked.
Define a core-only catalog **port** (no adapter). Ship `adr explain <path>` that
names every governing record and the matcher that fired, and publish a
**conformance fixture suite** as portable test data. Exit condition: resolver
passes the conformance suite and `resolution-is-pure` runs green in CI.

## Technical Context

**Language/Version**: TypeScript (ESNext), authored/run on Bun (see Bun-version
note below); published artifacts target Node `>=22` (ADR-0010).

**Primary Dependencies**: `picomatch` for `path`-matcher glob semantics (POSIX,
case-sensitive, `**` crossing) and a semver range check for `package` matchers.
Both are vetted, deterministic, network-free, credential-free public libraries
(permitted by amended Principle III). Reuse existing `zod`/`yaml`; no adapter.

**Storage**: Git working tree only — records under `docs/adr/`. Resolver reads no
files itself; the caller supplies the changed-file list and any snapshots.

**Testing**: `bun test`. The conformance suite (matcher set + file list +
snapshots + expected result) is the primary artifact and doubles as the test
corpus. A dedicated `resolution-is-pure` test/assertion enforces purity.

**Target Platform**: CLI + library; Linux/macOS CI; Node `>=22` consumers.

**Project Type**: Bun-workspace monorepo — extends `@adrkit/core` and `@adrkit/cli`.

**Performance Goals**: Resolve hundreds of records against thousands of changed
files in well under a second; O(records × matchers × files) with cheap per-pair
matching.

**Constraints**: Resolution MUST be a pure function of `(matchers, changedFiles,
snapshots)` — no clock, network, or filesystem traversal beyond supplied inputs
(ADR-0009). Deterministic, stably-ordered output. Clean-clone build stays green.

**Bun-version note (carried from Phase 0 CI fix)**: the dev environment's default
`bun` is a **canary** (self-reports 1.4.0) that writes `bun.lock` as
lockfileVersion 2, which no published stable Bun can parse. Installs and any
lockfile-affecting command in this feature MUST use a **published stable Bun**
(1.3.14 pinned in CI) so `bun.lock` stays lockfileVersion 1 and CI's
`--frozen-lockfile` succeeds. Adding `picomatch`/semver deps requires an install —
do it with stable Bun.

## Constitution Check

*GATE: passed before design; re-check after design. No violations.*

| Principle | Assessment |
|---|---|
| **I. Git is the source of truth** | PASS — resolver and `explain` are read-only; no database, no machine mutation of records. |
| **II. Clean clone builds green** | PASS — `picomatch`/semver are public, offline packages; resolver does no network or filesystem traversal. `clean-clone-builds` continues to guard. |
| **III. Core depends on no adapter** | PASS — the catalog **port** lives in `@adrkit/core`; no adapter is imported or implemented this phase. `entity`/`resource`/`api`/`data` degrade inert without a backing snapshot. `core-has-no-adapter-deps` guards the boundary; new deps are vetted net-free libs permitted by amended Principle III. |
| **IV. Deterministic before probabilistic** | PASS — resolution is a pure, model-free function; `resolution-is-pure` is asserted in CI (ADR-0009). Output is stably ordered. |
| **V. The schema is the contract** | PASS — matchers are consumed exactly as typed by the Phase 0 `AffectsMatcher` schema; no new record fields are introduced. |

**Result**: PASS — Complexity Tracking is empty (no deviations to justify).

## Project Structure

### Documentation (this feature)

```text
specs/002-affects-resolution/
├── spec.md                       # Feature spec (done)
├── plan.md                       # This file
├── research.md                   # Decisions & rationale
├── data-model.md                 # Matcher / Match / Snapshot / Port model
├── quickstart.md                 # How to run and verify
├── contracts/
│   └── resolver-and-explain.md   # resolver API, catalog port, `adr explain`
├── checklists/
│   └── requirements.md           # Spec quality checklist (done)
└── tasks.md                      # Produced next
```

### Source Code (repository root — extends merged Phase 0)

```text
packages/core/src/
├── affects/
│   ├── index.ts            # resolveAffects(records|matchers, changedFiles, snapshots) -> Match[]
│   ├── matchers/
│   │   ├── path.ts         # picomatch semantics; negation handled by the resolver
│   │   └── package.ts      # name / name@range against the changed-dependency set
│   ├── inert.ts            # entity/resource/api/data -> affects-unresolvable (info)
│   ├── catalog.ts          # catalog PORT interface (resolveEntity/entitiesForPaths/snapshot)
│   └── purity.ts           # (optional) guard helpers keeping resolve() pure
├── validate/
│   └── findings.ts         # reuse Finding type; add affects-unresolvable rule id
└── (existing load/ parse/ schema/ validate/ graph/ scaffold/)

packages/cli/src/
├── index.ts                # add `explain` to the dispatch (case 'explain')
└── (explain rendering: governing records + matcher that fired; --json)

packages/core/test/
├── affects-path.test.ts        # path matcher + negation + union cases
├── affects-package.test.ts     # lockfile-change firing; range in/out; manifest-only no-fire
├── affects-inert.test.ts       # unbacked types inert + info; unknown type warn+ignore
├── affects-purity.test.ts      # resolution-is-pure (no clock/net/fs; referential transparency)
└── conformance/                # PUBLISHED fixture suite (portable test data)
    ├── cases/*.json            # {matchers, changedFiles, snapshots?, expected}
    └── README.md               # how a second implementation runs these

scripts/
└── (check-deps.ts unchanged; assert affects/ imports no adapter)

.github/workflows/ci.yml         # add resolution-is-pure to the gate set
```

**Structure Decision**: The resolver is a new `affects/` module inside the
existing `@adrkit/core`, consuming the already-loaded `Adr` records from the
Phase 0 loader and the Phase 0 `AffectsMatcher` type. `adr explain` is a new
subcommand added to the existing CLI dispatch, reusing corpus loading. The
conformance suite is committed under `packages/core/test/conformance/` as plain
JSON so a second implementation can run it without adrkit internals (FR-010).

## Complexity Tracking

No constitution violations — table intentionally empty.
