# adrkit

**Decision memory for human- and agent-authored plans** — architecture decision
records that are machine-readable, enforceable in CI, and legible to agents,
without leaving git.

[![npm version](https://img.shields.io/npm/v/@adrkit/cli?logo=npm&label=%40adrkit%2Fcli)](https://www.npmjs.com/package/@adrkit/cli)
[![CI](https://github.com/mbeacom/adrkit/actions/workflows/ci.yml/badge.svg)](https://github.com/mbeacom/adrkit/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Most ADR tooling is a markdown template and a static site generator. That
*records* a decision; it doesn't make the decision *do* anything. adrkit treats a
record as **typed data with a markdown body** and adds one field — `affects` —
so a tool can answer *"which decisions govern this pull request?"* and put the
answer where the next decision is being made.

## Quickstart

The CLI is published as [`@adrkit/cli`](https://www.npmjs.com/package/@adrkit/cli)
and exposes the `adr` binary. Published artifacts target **Node 22+**
([ADR-0010](docs/adr/0010-bun-toolchain.md)):

```sh
npx @adrkit/cli lint                 # validate the corpus in docs/adr
npx @adrkit/cli explain src/payments/api.ts   # which decisions govern this file?
```

Or add it to a project (Bun-first repos can use `bun add -D @adrkit/cli` / `bunx`):

```sh
npm i -D @adrkit/cli
```

The pure library surfaces install independently:
`npm i @adrkit/core @adrkit/evaluator`.

See the [Quickstart guide](https://adrkit.dev/quickstart/) and the full
[command reference](https://adrkit.dev/commands/).

## What it looks like

`adr queue` emits the review backlog as a deterministic, read-only projection of
the corpus — byte-for-byte identical for identical inputs:

```text
# ARB Queue — 2026-07-25

Corpus fingerprint: `96e7f3185c5bb89bd1c87e10a28dcbef66703f381d3f14ea486ceaf29903cb00`
7 item(s) | 0 corpus finding(s) | 0 item(s) with findings

## Queue Items

| # | ID | Title | Tier | SLA State | Deadline | Approvals | Objections |
|---|----|-------|------|-----------|----------|-----------|------------|
| 1 | `0005` | Gate proposals with a deterministic-first evaluator … | arb | within-sla | 2027-01-18 | 0/- | 0 |
| 2 | `0015` | Validate descriptors against Backstage field formats … | arb | within-sla | 2027-01-25 | 0/- | 0 |
```

In CI, the `@adrkit/ci` Action comments the governing decisions on the PRs that
touch them — read-only, comment-only, no database, no approval. See
[Use in CI](https://adrkit.dev/ci/).

## For agents: the MCP server

The most differentiated hook: `@adrkit/mcp` is a local, **read-only**
[Model Context Protocol](https://modelcontextprotocol.io) server that lets an
agent retrieve prior decisions — **including the rejected and superseded ones** —
before proposing something already tried. No writes, no HTTP/auth, no model,
embedding, or network access, and no persistent index. It exposes exactly four
tools:

| Tool | Purpose |
|------|---------|
| `search_decisions` | Filtered search across the corpus |
| `get_decision` | Fetch one record by id |
| `get_decision_context(files[])` | Decisions governing a set of files |
| `list_superseded` | The graveyard — what was already rejected |

Run it against a repository's corpus:

```sh
npx @adrkit/mcp             # or the adrkit-mcp bin
adrkit-mcp --cwd /path/to/repo --dir docs/adr
```

`--cwd` (env `ADRKIT_MCP_CWD`) must be a Git worktree root; `--dir` (env
`ADRKIT_MCP_DIR`, default `docs/adr`) is resolved within it. stdout carries only
JSON-RPC frames; diagnostics go to stderr; the graveyard is included by default.
See the [MCP setup guide](https://adrkit.dev/mcp/) and
[`packages/mcp/README.md`](packages/mcp/README.md) for the full tool contracts.

## The problem

Your organization decides something. Six months later nobody remembers, the
decision gets re-litigated, and the code drifts from what was agreed. Now agents
write plans too — faster than anyone can review them, with no memory of what was
already decided and rejected.

## The idea

Treat a decision record as **typed data with a markdown body**, and give it one
field that changes everything — `affects`, declaring what the decision governs:

```yaml
---
id: "0042"
title: Use server-side rendering for authenticated routes
status: accepted
reversibility: one-way-door
blastRadius: cross-team
affects:
  - type: path
    pattern: "apps/web/app/(authed)/**"
  - type: package
    pattern: "next@>=16"
---
```

Now a tool can answer *"which decisions govern this pull request?"* — and put the
answer where the next decision is actually being made.

## What it does

- **`adr lint`** — validate records, catch supersession cycles, find decisions
  that silently contradict each other. Warns when markdown under the corpus
  directory is not discoverable, so "checked 0 records" is never silent.
- **`adr migrate --from madr`** — adopt an existing MADR corpus in place,
  additively, without breaking your current tooling. Reads status, date, and
  deciders from MADR 3.x frontmatter, MADR 2.x `* Status:` bullets, and Nygard
  `## Status` sections. `--rename` also renames each file to `<id>-<slug>.md`.
- **`adr explain <path>`** — print every decision governing a file, and the
  matcher that fired. Only `accepted` records are reported as governing; matched
  proposals and superseded/rejected/deprecated records are listed separately.
- **`adr check <files...>`** — validate the changed records and list the decisions
  governing a changed-file set; deterministic, provider-agnostic, `--json` for tools.
- **`adr evaluate <proposal> --snapshot <bundle.json> --date YYYY-MM-DD`** — run the
  **deterministic, model-free Pass 0** over a proposal ADR plus an immutable offline
  snapshot bundle. It applies the eleven rubric rules, escalates on **proven**
  triggers to one named active human (or an explicit `unresolved`), and **returns**
  a rich `Pass0Report` plus a schema-compatible `evaluationPatch`. It reads **no**
  model, network, clock, or (in the library) filesystem, and **routes — it never
  approves, persists, or writes**.
- **`adr queue`** — emit the ARB operations queue: a read-only, deterministic
  projection of the corpus's `review` metadata (tiers, SLA state, approvals,
  objections) as Markdown or `QueueReport` v1 JSON; also a managed-issue Action.
- **CI comment** — the `@adrkit/ci` GitHub Action surfaces the governing decisions
  on the PRs that touch them; runs with only the default `GITHUB_TOKEN` and
  degrades (never fails the job) on a read-only fork token.
- **MCP server** — let agents retrieve prior decisions, including the rejected
  ones, before proposing something already tried.

It never approves anything. It routes, and humans decide.

Use both CI Actions from their moving major tag (see [Use in CI](https://adrkit.dev/ci/)):

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v4
  - uses: mbeacom/adrkit/packages/ci@v0
```

## Why not plain MADR — or "Structured MADR"?

adrkit's frontmatter is a strict [MADR](https://adr.github.io/madr/) superset, so
this is not "instead of MADR" — you can `adr migrate --from madr` an existing
corpus in place. The distinction is what happens *after* the record exists.

A **template** — including a more structured MADR variant — standardizes how you
*write* a decision. It does not:

- **enforce it in CI** — adrkit resolves `affects` and comments the governing
  decisions on the PRs that change the files they govern;
- **answer "which decisions govern this PR?"** — that requires a pure,
  reproducible matcher over typed `affects` fields
  ([ADR-0009](docs/adr/0009-affects-resolution-and-catalog-binding.md)), not prose;
- **let an agent retrieve the graveyard** — the read-only MCP server surfaces
  `rejected`/`superseded`/`deprecated` records so an agent stops re-proposing them.

A schema you can hand to a linter, a resolver, an agent, and a CI job is a
different artifact from a heading convention. That is the whole thesis.

## Project status

Early, under active development, and deliberately honest about what is proven.

- **Published — v0.3.0 on npm.** The schema, `@adrkit/core`, `@adrkit/cli`,
  the deterministic Pass 0 `@adrkit/evaluator`, and the read-only `@adrkit/mcp`
  server are all implemented and released. The MCP server speaks both protocol
  eras and passed real-session dogfood against the published artifact on each,
  driven through the official MCP Inspector
  ([ADR-0018](docs/adr/0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)).
- **Landed, maintainer reference-verified — not yet externally validated.** The
  Phase 6 ARB queue (`adr queue` plus the managed-issue Action) is verified on
  rungs 1–2 of the
  [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  evidence ladder via a maintainer-owned isolated reference repository. The rung-3
  external/community signal is tracked honestly as **open**.
- **Not built yet.** The later probabilistic evaluator passes (Passes 1–3) and
  pluggable catalog binding. See [`plan.md`](./plan.md) and
  [CHANGELOG.md](./CHANGELOG.md).

No release is cut by governance or docs changes alone.

## Design commitments

These are enforced, not aspirational. Each links to the record that decided it.

| Commitment | Record |
|---|---|
| Git is the source of truth; every machine write opens a PR | [0001](docs/adr/), [0004](docs/adr/) |
| The schema is a strict MADR superset — migrations are additive | [0002](docs/adr/) |
| A clean clone with no credentials builds, tests, and lints green | [0007](docs/adr/) |
| Every integration is an optional adapter; the core depends on none | [0007](docs/adr/) |
| Match resolution is a pure function — reproducible in CI | [0009](docs/adr/) |
| Deterministic checks run before any model call | [0005](docs/adr/) |
| Bun is a development dependency only; published artifacts run on Node | [0010](docs/adr/) |
| Parsers are deterministic; models suggest, they never parse | [0008](docs/adr/) |

## Dogfooding

Every decision in this project is governed by this project. The repository's
first commit is its own decision corpus — see [`docs/adr/`](docs/adr/). The
evaluator rubric is itself an ADR, and changes to it ship with calibration data.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

**Exception:** the contents of [`schema/`](./schema/) are additionally released
under [CC0](./schema/LICENSE). The schema is intended to become a shared
contract; competing implementations should be able to adopt it with no license
consideration at all.

## Toolchain

Built with [Bun](https://bun.com) — see
[ADR-0010](docs/adr/0010-bun-toolchain.md). **Bun is a development dependency
only.** Nothing published by this project requires it: the CLI, the GitHub
Action, and the MCP server are Node-targeted and smoke-tested under Node 22 and
24 in CI.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md), including the **"Your first PR"**
on-ramp. Contributions require a DCO sign-off, and must build from a clean clone
with no credentials configured.
