# adrkit

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Decision memory for human and agent-authored plans.**

Architecture decision records that are machine-readable, enforceable in CI, and
legible to agents — without leaving git.

> Status: early, under active development. **v0.2.0 is published** with the
> schema, `@adrkit/core`, `@adrkit/cli`, the deterministic **Pass 0
> evaluator** (`@adrkit/evaluator`), and the read-only `@adrkit/mcp` server
> implemented — `adr lint`, `new`, `graph`,
> `explain`, `check`,
> `migrate --from madr`, and `adr evaluate` all work, including `affects`
> resolution, in-place MADR migration, and the offline eleven-rule Pass 0. The
> MCP server exposes its exact four-tool, local-only boundary and passed
> real-session dogfood through the official MCP Inspector. The Phase 6 ARB queue
> (`adr queue` plus the managed-issue GitHub Action) is implemented and **landed /
> reference-verified** through a maintainer-owned isolated reference repository —
> it is **not** yet externally validated (see
> [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)).
> Also not yet built: the later probabilistic
> passes (Passes 1–3). See [`plan.md`](./plan.md).
>
> A future **v0.3.0** would follow Phase 6 being reference-verified / landed; its
> release notes must state the queue is **maintainer reference-verified** and that
> **external adoption is not evidenced**. No release is cut by governance/docs
> changes alone.

---

## The problem

Your organization decides something. Six months later nobody remembers, the
decision gets re-litigated, and the code drifts from what was agreed. Now agents
write plans too — faster than anyone can review them, with no memory of what was
already decided and rejected.

Most ADR tooling is a markdown template and a static site generator. That
records decisions. It doesn't make them *do* anything.

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
  that silently contradict each other
- **`adr migrate --from madr`** — adopt an existing MADR corpus in place,
  additively, without breaking your current tooling
- **`adr explain <path>`** — print every decision governing a file, and the
  matcher that fired
- **`adr check <files...>`** — validate the changed records and list the decisions
  governing a changed-file set; deterministic, provider-agnostic, `--json` for tools
- **`adr evaluate <proposal> --snapshot <bundle.json> --date YYYY-MM-DD`** — run the
  **deterministic, model-free Pass 0** over a proposal ADR plus an immutable offline
  snapshot bundle. It applies the eleven rubric rules, escalates on **proven** triggers
  to one named active human (or an explicit `unresolved`), and **returns** a rich
  `Pass0Report` plus a schema-compatible `evaluationPatch`. It reads **no** model,
  network, clock, or (in the library) filesystem, and **routes — it never approves,
  persists, or writes**. There is **no `--write`**. Exit codes: **2** invalid
  usage/malformed bundle (including a schema-valid non-`draft`/`proposed` candidate),
  **1** a rubric error, **0** warn/info/inert/pass — even when it escalates or routes
  `unresolved`. The bundle is strict `adrkit.pass0.snapshot/v1` **data only**: it can
  never select or import an engine/resolver port; the CLI injects those from trusted
  composition code. Assertions use the restricted **`jsonpath-rfc9535`** RFC 9535
  source profile; **Rego** is validated as the fixed compiled-artifact envelope but is
  inert by default (adrkit ships no Rego runtime and never compiles raw Rego).
- **CI comment** — the `@adrkit/ci` GitHub Action surfaces the governing decisions
  on the PRs that touch them. Read-only and comment-only — no database, no approval
  ([0004](docs/adr/)); runs with only the default `GITHUB_TOKEN` on the `node24`
  runner from a committed self-contained bundle, and degrades (never fails the job)
  on a read-only fork token
- **`adr queue`** — emit the ARB operations queue: a read-only, deterministic
  projection of the corpus's `review` metadata (tiers, SLA state, approvals,
  objections) as Markdown or `QueueReport` v1 JSON; also available as a
  managed-issue GitHub Action
- **MCP server** — let agents retrieve prior decisions, including the rejected
  ones, before proposing something already tried
- **Evaluator** — score proposals against a published rubric and route them;
  deterministic checks first, humans on the conditions that warrant them

It never approves anything. It routes, and humans decide.

## Install

The CLI is published as `@adrkit/cli` and exposes the `adr` binary:

```sh
bun add --dev @adrkit/cli
bunx adr lint
```

For one-off use:

```sh
bunx @adrkit/cli explain src/payments/api.ts
```

The pure library surfaces are independently installable:

```sh
bun add @adrkit/core @adrkit/evaluator
```

### MCP server (`@adrkit/mcp`)

`@adrkit/mcp` provides a local, **read-only** [Model Context Protocol](https://modelcontextprotocol.io)
server so an agent harness can retrieve decisions over stdio. It exposes exactly
four tools — `search_decisions`, `get_decision`, `get_decision_context(files[])`,
and `list_superseded` — and nothing else: no writes, no HTTP/auth, no model,
embedding, or network access, and no persistent index. Run the `adrkit-mcp` bin,
pointing it at the repository whose corpus it should answer for:

```sh
bunx @adrkit/mcp             # or: adrkit-mcp
adrkit-mcp --cwd /path/to/repo --dir docs/adr
```

`--cwd` (env `ADRKIT_MCP_CWD`, default `process.cwd()`) must be a Git worktree
root; `--dir` (env `ADRKIT_MCP_DIR`, default `docs/adr`) is resolved and contained
within it. Flags win over environment variables. stdout carries only JSON-RPC
protocol frames; all diagnostics go to stderr. Every call re-reads the corpus,
the graveyard (`rejected`/`superseded`/`deprecated`) is included by default, and
growing responses paginate through opaque, corpus-bound cursors. See
[`packages/mcp/README.md`](packages/mcp/README.md) for the full tool contracts,
limits, and cursor-restart rules.

Published artifacts are ESM and require Node.js 22 or newer. Bun remains the
project's development package manager and test/build runtime.

Use the GitHub Action from its moving major tag, or pin the immutable release
tag/commit for maximum reproducibility:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v4
  - uses: mbeacom/adrkit/packages/ci@v0
```

All four npm packages, immutable `v0.2.0` release, and moving `v0` Action tag are
live. Source checkouts can also run the CLI with `bun run adr`.

### ARB operations queue (`adr queue`)

Emit the ARB operations queue — a read-only, deterministic projection of the local
corpus — to stdout:

```sh
adr queue --dir docs/adr --format markdown      # or --format json (QueueReport v1)
adr queue --as-of 2026-01-08                     # UTC date used for SLA state
```

Identical inputs produce byte-for-byte identical output. Exit codes: `0` clean,
`1` report emitted with error-severity corpus findings, `2` usage error.

A managed-issue GitHub Action (`packages/ci/queue`) creates or updates exactly one
dedicated issue whose body carries the deterministic Markdown report, using only the
default `GITHUB_TOKEN` with `issues: write`. Phase 6 is landed / reference-verified
(see [`plan.md`](./plan.md)); pin the queue Action to an immutable commit SHA until a
moving `queue@v0` tag is published:

```yaml
permissions:
  contents: read
  issues: write

steps:
  - uses: actions/checkout@v4
  - uses: mbeacom/adrkit/packages/ci/queue@efef89b5d747ca175a1947f1ce2f4296dab54fa3
```

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
24 in CI (see [`plan.md`](./plan.md)).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Contributions require a DCO sign-off,
and must build from a clean clone with no credentials configured.
