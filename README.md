# adrkit

**Decision memory for human- and agent-authored plans** — architecture decision
records that are machine-readable, enforceable in CI, and legible to agents,
without leaving git.

[![npm version](https://img.shields.io/npm/v/@adrkit/cli?logo=npm&label=%40adrkit%2Fcli)](https://www.npmjs.com/package/@adrkit/cli)
[![CI](https://github.com/mbeacom/adrkit/actions/workflows/ci.yml/badge.svg)](https://github.com/mbeacom/adrkit/actions/workflows/ci.yml)
[![ADRs](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fadrkit.dev%2Flint.json&query=%24.checked&label=ADRs&color=cb492d)](./docs/adr)
[![ARB queue](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fadrkit.dev%2Fqueue.json&query=%24.totalItems&label=ARB%20queue&suffix=%20pending&color=cb492d)](./docs/adr)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Most ADR tooling is a markdown template and a static site generator. That
*records* a decision; it doesn't make the decision *do* anything. adrkit treats a
record as **typed data with a markdown body** and adds one field — `affects` —
so a tool can answer *"which decisions govern this pull request?"* and put the
answer where the next decision is being made.

## Quickstart

The CLI is published as [`@adrkit/cli`](https://www.npmjs.com/package/@adrkit/cli)
and exposes the `adr` binary. Published artifacts target **Node 22+**:

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

## Choose a starting point

| If you want to... | Start here | Notes |
|---|---|---|
| Validate or inspect an ADR corpus | [`@adrkit/cli`](packages/cli/README.md) | `npx @adrkit/cli ...` on Node 22+ |
| Build your own tooling | [`@adrkit/core`](packages/core/README.md) | Pure parser, validator, matcher, and queue APIs |
| Run the deterministic proposal checks | [`@adrkit/evaluator`](packages/evaluator/README.md) | Pass 0 is the shipped evaluator surface today |
| Feed prior decisions to coding agents | [`@adrkit/mcp`](packages/mcp/README.md) | Local, read-only stdio MCP server |
| Run adrkit from an OCI image | [Container usage](#container-usage) | Lockstep multi-architecture image, beginning with the first release containing ADR-0032 |
| Comment governing decisions on pull requests | [Use in CI](https://adrkit.dev/ci/) | GitHub Action from this repository |
| Add decision memory to Spec Kit | [`@adrkit/spec-kit`](packages/adapters/spec-kit/README.md) | Published separately for Spec Kit `>=0.13.0,<0.16.0` |
| Add decision memory to Copilot, Claude Code, or opencode | [`adrkit` agent plugin](packages/adapters/agent-plugin/README.md) | Install from this repository or marketplace |

## Container usage

Beginning with the first lockstep release containing
[ADR-0032](docs/adr/0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md),
releases are published as a multi-architecture OCI image at
`ghcr.io/mbeacom/adrkit`. Pin an immutable `vX.Y.Z` tag in automation; `vX`
and `latest` move only after that lockstep release has completed:

```sh
docker run --rm --read-only --network none \
  -v "$PWD:/workspace:ro" \
  ghcr.io/mbeacom/adrkit:vX.Y.Z lint

docker run --rm --read-only --network none -i \
  -v "$PWD:/workspace:ro" \
  ghcr.io/mbeacom/adrkit:vX.Y.Z mcp
```

The MCP command keeps stdin open because MCP uses stdio. Its repository mount is
read-only, matching the server contract; use an absolute host path in MCP client
configuration. For CLI commands that intentionally write (`new`, or
`migrate` without `--dry-run`), omit `--read-only` and the mount's `:ro`
suffix. The image runs as the non-root `node` user; on a host with a different
UID/GID, add `--user "$(id -u):$(id -g)"`. On SELinux hosts, add the
appropriate bind-mount label (for example, `:Z`).

The default image treats an unrecognized selector as an `adr` subcommand.
Explicit selectors are `cli`/`adr`/`adrkit`, `mcp`/`adrkit-mcp`,
`ci`/`adrkit-ci`, and `queue-action`/`adrkit-queue-action`. The default
`--help` describes these selectors; `cli --help` opens the CLI command
reference. The container also reserves `-h`, `container-help`, and
`--container-help`; CLI help subcommands such as `help lint` otherwise pass
through unchanged.

Build the same source locally with Docker or Podman. Purpose-specific `cli`,
`mcp`, `ci`, and `queue-action` targets are isolated for local policy and SBOM
inspection; the registry publishes only the all-in-one `adrkit` target:

```sh
docker build -f Containerfile -t adrkit:local .
docker build -f Containerfile --target mcp -t adrkit-mcp:local .
docker run --rm --read-only --network none -i \
  -v "$PWD:/workspace:ro" \
  adrkit-mcp:local
```

The two CI entry points preserve the existing GitHub Actions runtime contract:
they expect `GITHUB_WORKSPACE`, the event payload and repository environment,
`INPUT_*` values, and a token. For hosted GitHub Actions, the repository-backed
Actions remain the simpler interface:
`mbeacom/adrkit/packages/ci@v0` and
`mbeacom/adrkit/packages/ci/queue@v0`. Container publication and recovery are
documented in [`docs/RELEASING.md`](docs/RELEASING.md#oci-container-image).

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

## For spec-driven workflows: the Spec Kit extension

[Spec Kit](https://github.com/github/spec-kit) takes you from `specify` to
`plan` to `tasks` to `implement`. What it does not do is check the plan it just
produced against the decisions you already made, or record the new decisions
that plan contains — so every feature starts from an empty context and
re-litigates settled questions.

[`@adrkit/spec-kit`](packages/adapters/spec-kit/README.md) closes that loop:

| Command | Purpose | Writes |
|---|---|---|
| `/speckit.adrkit.context` | Pull the governing decisions — including rejected and superseded ones — into context *before* planning | no |
| `/speckit.adrkit.check` | Check a produced plan against the decisions that govern it | no |
| `/speckit.adrkit.draft` | Scaffold a draft ADR from the plan artifact | one new record |

Plus one `after_plan` hook that *offers* to run the check. It is optional by
construction, and hooks can only reach commands that do not write — `draft` is
deliberately unreachable from any hook, because a plan-phase hook creating
records unprompted would manufacture decision memory rather than record it.

Pinned to Spec Kit `>=0.13.0,<0.16.0` and tested against 0.13.0, 0.14.4, and
0.15.1. It is available from the Spec Kit community catalog; see the package
README for setup.

## For any coding agent: the plugin

[Spec Kit](https://github.com/github/spec-kit) is one workflow. The place plans
are actually written now is inside a coding agent that has no idea your decision
corpus exists.

[`packages/adapters/agent-plugin`](packages/adapters/agent-plugin/README.md)
packages the same loop as portable agent components — installable into GitHub
Copilot CLI, Claude Code, opencode, and anything
[APM](https://github.com/microsoft/apm) targets:

```sh
copilot plugin marketplace add mbeacom/adrkit && copilot plugin install adrkit@adrkit
/plugin marketplace add mbeacom/adrkit        # Claude Code, then /plugin install adrkit@adrkit
apm install mbeacom/adrkit/packages/adapters/agent-plugin --target opencode
```

Every component shells out to the `adr` CLI, so install that too if you have not
already — `npm i -g @adrkit/cli`, or add `@adrkit/cli` to the project. The
components resolve it from `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then
`PATH`.

| Component | Purpose | Writes |
|---|---|---|
| `decision-memory` skill | Teaches the context → check → draft loop, the exit-code contract, and the rules that keep the record honest | no |
| `decision-backfill` skill | Audits code, documentation, plans, and history for evidence-backed ADR candidates without treating implementation as ratification | no |
| `decision-checker` agent | Reconciles a plan or diff against the corpus, one verdict per decision | no |
| `/adr-context [paths...]` | Load the decisions governing the paths you are about to change | no |
| `/adr-check [paths...]` | Check the change, or a plan, against them | no |
| `/adr-draft <title-or-candidate-key>` | Draft one ADR from a current decision or selected backfill handoff | one new record |
| `/adr-queue` | The review queue — the questions still open | no |
| `/adr-backfill [paths...]` | Produce a coverage ledger and deduplicated candidate ADR report from an inherited codebase or documentation corpus | no |

It deliberately ships **no MCP configuration**: Copilot CLI spawns a plugin's
MCP servers outside the workspace, and outside any Git repository, so the adrkit
server exits during `initialize`. MCP is wired per project instead — see the
[plugin README](packages/adapters/agent-plugin/README.md#mcp-is-configured-per-project-not-shipped-here)
for the host-specific setup and
[ADR-0028](docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md).
The backfill expansion is authorized by
[ADR-0034](docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md).

Status: installable today from this repository and versioned independently from
the npm packages. It makes the context -> check -> backfill -> draft loop
available inside current coding-agent hosts.

The backfill workflow is read-only until a human selects a candidate. See the
[guide](https://adrkit.dev/backfill/) for source routing, evidence thresholds,
status treatment, and the `/adr-backfill` → `/adr-draft` handoff.

Independently versioned per ADR-0007. The original context/check/draft/queue
workflow is at **rung 1** of ADR-0014 — unit and contract coverage plus
maintainer verification against the installed hosts. The v0.2.0 backfill
addition is contract- and static-host-validated and has a fresh functional
Copilot synthetic-consumer run proving candidate reconciliation and no writes.
No persistent reference-repository run or external validation exists for the
plugin.

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
    pattern: "apps/web/app/\\(authed\\)/**"   # ( and ) are glob syntax — escape them
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
- **`adr explain <path>`** — print every decision governing a file, and why.
  Decisions reach a file in two directions and the output keeps them apart: the
  record's own `affects` pattern matched (`via path: src/**`), or the file
  declared the decision itself with an `@adr 0012` marker in a comment
  (`declared by src/sync.ts:3`). Markers let `affects` stay narrow — the
  defining files — while the surrounding code opts in one line at a time, in any
  language, with no schema change. Only `accepted` records are reported as
  governing; matched proposals and superseded/rejected/deprecated records are
  listed separately.
- **`adr check <files...>`** — validate the changed records and list the decisions
  governing a changed-file set, including inbound `@adr` declarations. Marker reads
  are bounded to 3,000 files / 16 concurrent reads, 64 declarations per file, and
  10,000 declarations per batch, all reported in `--json`; marker claims and scan
  warnings never influence the exit code.
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
  on the PRs that touch or explicitly declare them; pattern matches render as `via`
  and PR-authored marker claims as `declared by`. The comment also distinguishes
  marker files it could not inspect, marker declarations omitted at a safety cap,
  and claims it read but could not bind. All are advisory: they never fail the job.
  It runs with only the default
  `GITHUB_TOKEN` and degrades (never fails the job) on a read-only fork token.
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

adrkit is still pre-1.0, but several surfaces are ready to use today. This
table is the short version:

| State | Surface | What that means |
|---|---|---|
| Available now | `@adrkit/core`, `@adrkit/cli`, `@adrkit/evaluator`, `@adrkit/mcp` | Published on npm for Node 22+ |
| Available now | `@adrkit/spec-kit` | Published separately for current Spec Kit releases |
| Available now | `adr queue` and the governing-decisions GitHub Action | Queue reporting and PR comments are part of the shipped workflow |
| Available now | `adrkit` agent plugin | Install from this repository or marketplace; shells out to `adr` |
| In development | Later evaluator passes | Passes 1–3 and calibration remain design targets; Pass 0 is the implemented evaluator surface |
| In development | Catalog packages | `@adrkit/catalog-envelope` and `@adrkit/catalog-backstage` exist in the workspace at `0.0.0` and are not released |
| Planned | Additional downstream integrations | Future integrations will build on the current typed corpus and read-only retrieval model |

## Design commitments

These are enforced, not aspirational. Each links to the record that decided it.

| Commitment | Record |
|---|---|
| Git is the source of truth; every machine write opens a PR | [0001](docs/adr/), [0004](docs/adr/) |
| The schema is a strict MADR superset — migrations are additive | [0002](docs/adr/) |
| A clean clone with no credentials builds, tests, and lints green | [0007](docs/adr/) |
| Every integration is an optional adapter; the core depends on none | [0007](docs/adr/) |
| Match resolution is a pure function — reproducible in CI | [0009](docs/adr/) |
| Deterministic checks run before any model call | [0027](docs/adr/) |
| Bun is a development dependency only; published artifacts run on Node | [0010](docs/adr/) |
| Parsers are deterministic; models suggest, they never parse | [0008](docs/adr/) |

## Dogfooding

Every decision in this project is governed by this project. The repository's
first commit is its own decision corpus — see [`docs/adr/`](docs/adr/). The
evaluator rubric is itself versioned here too. The published evaluator currently
implements the deterministic Pass 0 only; later passes remain documented design
targets rather than released behavior.

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
