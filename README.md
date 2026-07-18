# adrkit

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Decision memory for human and agent-authored plans.**

Architecture decision records that are machine-readable, enforceable in CI, and
legible to agents — without leaving git.

> Status: pre-alpha. The schema and decision records exist; the implementation
> does not yet. See [`plan.md`](./plan.md).

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
- **CI comment** — surface governing decisions on the PRs that touch them
- **MCP server** — let agents retrieve prior decisions, including the rejected
  ones, before proposing something already tried
- **Evaluator** — score proposals against a published rubric and route them;
  deterministic checks first, humans on the conditions that warrant them

It never approves anything. It routes, and humans decide.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md). Contributions require a DCO sign-off,
and must build from a clean clone with no credentials configured.
