# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–4 landed and v0.1.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, and `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `migrate --from madr`, `evaluate`) are published on npm; the
repository-backed CI Action is available at `mbeacom/adrkit/packages/ci@v0`.
The read-only MCP server is scoped under `specs/006-mcp-server/`; its exact
four-tool, local-only surface was ratified by the maintainer on 2026-07-20, so
its 43-task graph is generated and critical/high artifact remediation is in
progress before a fresh analysis and implementation (see [`plan.md`](./plan.md)).

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
