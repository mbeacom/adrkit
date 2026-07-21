# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–5 landed and v0.2.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `migrate --from madr`, `evaluate`) are published on npm; the
repository-backed CI Action is available at `mbeacom/adrkit/packages/ci@v0`.
The published `@adrkit/mcp` server has exactly four local stdio tools and passed
real-session dogfood through the official MCP Inspector. Phase 6 ARB queue
implementation is in progress under `specs/007-arb-queue/` (see
[`plan.md`](./plan.md)): the pure `buildQueueReport` kernel and canonical
JSON/Markdown formatters live in `@adrkit/core`, the `adr queue` CLI subcommand
ships in `@adrkit/cli`, and a managed-issue queue Action lives in the private
`@adrkit/ci` (`packages/ci/queue/action.yml`, bundled to
`packages/ci/dist/queue-action.js`). The external-team rung 6 exit gate (SC-004)
is still outstanding, so Phase 6 is not yet landed.

## `adr queue`

Emit the ARB operations queue — a read-only, deterministic projection of the
local ADR corpus — to stdout:

```bash
adr queue [--dir docs/adr] [--as-of YYYY-MM-DD] [--format markdown|json]
```

- `--dir` (default `docs/adr`): ADR corpus directory.
- `--as-of` (default: today, UTC): UTC calendar date used for SLA state
  computation. Accepts a bare `YYYY-MM-DD` or an ISO datetime with an explicit
  timezone (e.g. `2026-01-08T00:00:00Z`); timezone-less datetimes are rejected.
- `--format` (default `markdown`): `markdown` or `json` (QueueReport v1).

Exit codes: `0` = report with no corpus error findings; `1` = report emitted
(complete, to stdout) with one or more error-severity corpus findings; `2` =
usage error (invalid flag/value or unreachable corpus directory). Identical
inputs produce byte-for-byte identical output (SC-001).

## Toolchain

This project uses **Bun** as its runtime, package manager, test runner, and
bundler. Default to Bun instead of Node.js, npm, pnpm, or Vite:

- `bun install` / `bun add`, not `npm`/`yarn`/`pnpm`
- `bun run <script>`, `bunx <pkg>`
- `bun test`, not `jest`/`vitest`
- `bun build`, not `webpack`/`esbuild`

See [ADR-0010](./docs/adr/0010-bun-toolchain.md) for the rationale (Bun for
development; Node-targeted published artifacts).

Full, editor-scoped Bun conventions live in the subcontext rule files — keep
them in sync when the tooling guidance changes:

- Cursor: [`.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`](./.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc)
- GitHub Copilot / VS Code: [`.github/instructions/use-bun.instructions.md`](./.github/instructions/use-bun.instructions.md)
