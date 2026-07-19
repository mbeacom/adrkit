# Implementation Plan: CI Surface (Phase 3)

**Branch**: `004-ci-surface` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-ci-surface/spec.md`
**Normative sources**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md), [ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md).

> **⚠️ Gate status — implementation blocked.** This plan is authored during
> scoping. Per the strict outcome ladder, Phase 3 code MUST NOT start until the
> **rung-2** outcome is genuinely met (a **real public MADR corpus** round-tripped
> by `adr migrate`, with a real user). Today it is met only by a **synthetic**
> fixture — see [research.md §R0](./research.md) and `tasks.md` **T000**. Scoping
> proceeds; building does not.

## Summary

Make the decision→code mapping visible at review time. Add `@adrkit/ci` as a GitHub
Action and `adr check <changed-files>` as its provider-agnostic CLI equivalent. The
Action extracts the PR's changed-file list, hands it to the **existing pure resolver**
(`resolveAffects`, ADR-0009), validates the changed records with the **existing
validators**, and posts a single, **selective**, idempotently-updated PR comment
naming the governing decisions and the matcher that fired for each. It runs with
nothing but the default `GITHUB_TOKEN`, touches no database (ADR-0004), imports no
adapter (ADR-0007), and never approves or mutates anything — it routes attention.
Exit condition: on a repo that isn't this one and has more than ten records, a PR
touching a governed subset gets a comment naming exactly that subset, updated in
place on each push, using only the default token.

## Technical Context

**Language/Version**: TypeScript (ESNext), Bun for development; the CLI (`adr check`)
ships as a Node-targeted artifact (`node >=22`, ADR-0010). The Action runs on the
GitHub-hosted Node runner.

**Primary Dependencies**: `@adrkit/core` (`workspace:*`) for resolution + validation;
the public GitHub Action toolkit (`@actions/core`, `@actions/github`/Octokit) in
`@adrkit/ci` only. No new dependency in core. Changed-dependency snapshots reuse the
existing `deriveChangedDependenciesFromBunLockDiff` export.

**Storage**: Git working tree + the PR itself only. **No database, no index** — the
Action never calls the ADR-0004 projection; comment identity is a hidden marker in
the PR, not stored state.

**Testing**: `bun test`. Deterministic `adr check` tests (governing list + validation
+ exit codes per severity, `--json` shape); comment-renderer tests (selectivity,
empty state, idempotent marker); an injected fake GitHub client for the Action
(create-vs-update, read-only-token degradation) — **no network, no token in CI**. An
end-to-end selectivity assertion on a fixture corpus with more than ten records.

**Target Platform**: GitHub Actions (Node runner) for the Action; portable CLI for
any provider.

**Project Type**: Bun-workspace monorepo — adds a `@adrkit/ci` surface package and an
`adr check` subcommand to `@adrkit/cli`.

**Performance Goals**: Resolution is linear in `records × matchers × changed-files`;
a PR comment renders in well under a second for hundreds of changed files.

**Constraints**: Pure resolution (ADR-0009 `resolution-is-pure` stays green — the
Action does the impure file-list extraction); clean clone builds/tests/lints green
with no credentials (ADR-0007 `clean-clone-builds`); `@adrkit/ci` imports no adapter
(`core-has-no-adapter-deps`, extended to cover it); default-token-only at runtime
(FR-008); read-only-token degradation, not job failure (FR-014); comment is
selective and idempotent (FR-005/FR-006).

**Bun-version note**: use the pinned stable Bun (CI pins `1.3.14`) for all installs so
`bun.lock` stays lockfileVersion 1; the env default `bun` is a canary that writes an
unreadable v2 lockfile and breaks CI.

## Constitution Check

*GATE: passed before design; re-check after design. No violations. (The rung-2
outcome gate above is an **outcome-ladder** precondition on implementation, not a
Principle I–V violation of this design.)*

| Principle | Assessment |
|---|---|
| **I. Git is the source of truth** | PASS — the Action reads records from git and writes **only** a PR comment (a derived projection); it mutates no record and writes to no database (FR-010, ADR-0004). Lifecycle stays PR-driven. |
| **II. Clean clone builds green** | PASS — the GitHub toolkit is a public registry dependency confined to `@adrkit/ci` and stubbed in tests (R3); install/build/test/lint need no token, service, or network. `clean-clone-builds` continues to guard (SC-007). |
| **III. Core depends on no adapter** | PASS — `@adrkit/ci` is a first-party **surface** package (peer of `@adrkit/cli`), under `packages/ci/`, **not** `packages/adapters/*`; it imports `@adrkit/core` and public Action libs only, never an adapter (FR-013). `core-has-no-adapter-deps` is extended to assert this. |
| **IV. Deterministic before probabilistic** | PASS — the CI surface adds **no** model step. Governing-decision resolution is the existing pure resolver; validation is the existing deterministic validators; the comment renders their output verbatim (R1/R6). The surface routes/informs; it never decides (FR-011). |
| **V. The schema is the contract** | PASS — `adr check` and the Action consume the existing schema, validators, and resolver output; **no** schema change and no new record field. The comment renders records against the existing contract. |

**Result**: PASS — Complexity Tracking is empty (no deviations to justify). The
GitHub-toolkit dependency is explicitly *permitted* under ADR-0007 (public surface,
confined to `@adrkit/ci`, stubbed in tests), so it is not a violation.

## Project Structure

### Documentation (this feature)

```text
specs/004-ci-surface/
├── spec.md                        # Feature spec (done)
├── plan.md                        # This file
├── research.md                    # R0 gate assessment + R1–R9 decisions
├── data-model.md                  # changed-file set / governing result / comment / outcome
├── quickstart.md                  # How to run adr check + wire the Action; what green means
├── contracts/
│   └── check-and-comment.md       # adr check CLI + Action I/O + comment/idempotency contract
├── checklists/
│   └── requirements.md            # Spec quality checklist (done)
└── tasks.md                       # Produced next (T000 = the rung-2 gate precondition)
```

### Source Code (repository root — extends merged Phase 0/1/2)

```text
packages/cli/src/
├── index.ts                 # add `check` to dispatch: adr check <files...> [--dir] [--json]
└── (check rendering: governing list like `adr explain` + changed-record findings; --json)

packages/ci/                 # NEW first-party surface package @adrkit/ci (peer of cli)
├── package.json             # deps: @adrkit/core workspace:*, @actions/core, @actions/github
├── action.yml               # GitHub Action metadata (inputs: dir, token; runs: node20/node-dist)
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts             # Action entrypoint: extract files → check → render → comment
│   ├── changed-files.ts     # PR base…head changed-file extraction (impure; not in core)
│   ├── github.ts            # thin GitHub client port (find/create/update marker comment)
│   ├── comment.ts           # comment renderer (selective; hidden marker; empty/error states)
│   └── check.ts             # shared: run resolveAffects + validate over the file list
└── test/
    ├── check.test.ts            # governing list + validation + exit codes per severity; --json
    ├── comment-render.test.ts   # selectivity (>10 records), empty state, marker present
    ├── comment-idempotent.test.ts # fake client: create then update same comment
    ├── token-degrade.test.ts    # read-only token → check runs, comment skipped, job not failed
    └── fixtures/                # a >10-record corpus + changed-file lists

scripts/check-deps.ts             # extend to assert @adrkit/ci has no adapter dependency
.github/workflows/ci.yml          # add adr check job (self-dogfood); gate set otherwise unchanged
```

**Structure Decision**: `adr check` is a new subcommand on the existing `@adrkit/cli`
dispatch, reusing `resolveAffects` and the corpus validators — no new resolution
logic. `@adrkit/ci` is a **new surface package** under `packages/ci/` (not
`packages/adapters/*`), holding the only impure code (changed-file extraction, GitHub
API) behind small ports so the deterministic core stays pure and offline-testable.
The GitHub client is injected in tests; nothing in the default build needs a token.

## Complexity Tracking

No constitution violations — table intentionally empty. (Outcome-ladder gate on
implementation is tracked in research.md §R0 and tasks.md T000, not here.)
