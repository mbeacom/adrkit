# Implementation Plan: Schema and Core (Phase 0)

**Branch**: `001-schema-and-core` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-schema-and-core/spec.md`

## Summary

Stand up the enforceable foundation: publish the record contract as a generated,
drift-gated JSON Schema; build `@adrkit/core` to walk the corpus, parse
frontmatter deterministically, and validate every record against the contract and
its cross-record invariants; expose `@adrkit/cli` (`lint`, `new`, `graph`); and
wire CI so the three gate assertions (`clean-clone-builds`, `schema-emit-matches`,
`core-has-no-adapter-deps`) run green. Exit condition: `adr lint` passes on this
repo's own `docs/adr/` corpus in CI (rung 1).

## Technical Context

**Language/Version**: TypeScript (ESNext modules), authored/run on Bun `>=1.2`;
published artifacts target Node `>=22` (ADR-0010).

**Primary Dependencies**: `zod@^4` (contract source; JSON Schema emitted via Zod
4's native `z.toJSONSchema`). `yaml` (deterministic YAML frontmatter parse). CLI
argument parsing via `node:util` `parseArgs` (no dependency). No adapter, ever.

**Storage**: Git working tree only — markdown records under `docs/adr/`. No
database, no index (ADR-0001, ADR-0004).

**Testing**: `bun test` (co-located `*.test.ts`), one failing/passing case per
invariant plus a schema-drift test and an adapter-independence test.

**Target Platform**: CLI + library; Linux/macOS CI runners; Node `>=22` consumers.

**Project Type**: Bun-workspace monorepo — library (`@adrkit/core`) + CLI
(`@adrkit/cli`) + generated schema artifact.

**Performance Goals**: Validate a corpus of ~10–500 records in well under one
second; no per-record network or I/O beyond reading the files.

**Constraints**: Deterministic (no clock/network/nondeterministic ordering in
parse/validate); no runtime network; clean-clone build green; `isolated` linker
retained.

**Scale/Scope**: This repo's 10 records today; must not degrade on hundreds.

## Constitution Check

*GATE: passed before design; re-checked after design. No violations.*

| Principle | Assessment |
|---|---|
| **I. Git is the source of truth** | PASS — `lint`/`graph` are read-only; `new` writes a single markdown file the author commits via PR. No database; no in-place machine mutation of existing records. |
| **II. Clean clone builds green** | PASS — deps are public packages; no credentials, services, or runtime network. `clean-clone-builds` CI job enforces it. |
| **III. Core depends on no adapter** | PASS — `@adrkit/core` imports only `zod`, `yaml`, and `node:*`; `@adrkit/cli` imports `@adrkit/core`. No `packages/adapters/*` exists yet; `core-has-no-adapter-deps` guards it. `isolated` linker retained. |
| **IV. Deterministic before probabilistic** | PASS — parsing and validation are pure and model-free; no evaluator/model path in this phase. |
| **V. The schema is the contract** | PASS — Zod source is authoritative; `schema:emit` regenerates the JSON Schema; `schema-emit-matches` fails on drift; invariants enforced in code with per-invariant tests. |

**Result**: PASS — Complexity Tracking is empty (no deviations to justify).

## Project Structure

### Documentation (this feature)

```text
specs/001-schema-and-core/
├── spec.md              # Feature spec (done)
├── plan.md              # This file
├── research.md          # Decisions & rationale
├── data-model.md        # Record / Finding / Corpus model
├── quickstart.md        # How to run and verify
├── contracts/
│   └── cli-commands.md  # lint / new / graph command contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Produced by /speckit.tasks
```

### Source Code (repository root)

```text
packages/
├── core/
│   ├── package.json                 # @adrkit/core (deps: zod, yaml)
│   ├── src/
│   │   ├── index.ts                 # public surface
│   │   ├── schema/
│   │   │   ├── adr.schema.ts         # Zod source (ported from /schema)
│   │   │   └── index.ts
│   │   ├── parse/
│   │   │   ├── frontmatter.ts        # split + YAML parse (deterministic)
│   │   │   └── loader.ts             # file -> Adr; corpus walker
│   │   ├── validate/
│   │   │   ├── invariants.ts         # cross-record rules over a corpus
│   │   │   └── findings.ts           # Finding type + severity + rendering
│   │   └── emit/
│   │       └── json-schema.ts        # z.toJSONSchema wrapper
│   └── scripts/
│       └── emit-schema.ts            # writes schema/adr.schema.json
├── cli/
│   ├── package.json                 # @adrkit/cli (dep: @adrkit/core), bin: adr
│   └── src/
│       ├── index.ts                 # arg dispatch (node:util parseArgs)
│       └── commands/{lint,new,graph}.ts

schema/
├── adr.schema.ts                     # kept as published source-of-record mirror
├── adr.schema.json                   # GENERATED (regenerated to match emit)
└── LICENSE                           # CC0 (unchanged)

scripts/
└── check-deps.ts                     # core-has-no-adapter-deps graph check

.github/workflows/
└── ci.yml                            # clean-clone, schema-emit-matches, deps, test, typecheck, lint
```

**Structure Decision**: Bun-workspace monorepo. The Zod schema is ported into
`packages/core/src/schema/` (the affects target of ADR-0002 is
`packages/core/src/schema/**` *and* `schema/**`); the repo-root `schema/` remains
the published artifact location. `emit-schema.ts` is the single writer of
`schema/adr.schema.json`, and CI asserts the working tree is unchanged after a
fresh emit.

## Complexity Tracking

No constitution violations — table intentionally empty.
