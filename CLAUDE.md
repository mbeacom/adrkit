# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–6 landed and v0.3.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `migrate --from madr`, `evaluate`) are published on npm; the
repository-backed CI Action is available at `mbeacom/adrkit/packages/ci@v0`.
The published `@adrkit/mcp` server has exactly four local stdio tools and serves
**both** MCP protocol eras over one stdio connection — `2026-07-28` (stateless;
opened by `server/discover` or a 2026 `_meta` envelope) and the 2025 era (opened
by `initialize`) — via the SDK v2 `serveStdio` entry
([ADR-0018](./docs/adr/0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)).
It passed real-session dogfood against the published artifact on **both** eras,
driven through the official MCP Inspector. The Inspector defaults to the 2025
era; select the modern one with `"protocolEra": "modern"` (or `"auto"`) in the
server's entry in the Inspector's `mcp.json` — there is no CLI flag for it.

Phase 6 ARB queue is
implemented under `specs/007-arb-queue/` (see [`plan.md`](./plan.md)): the pure
`buildQueueReport` kernel and canonical JSON/Markdown formatters live in
`@adrkit/core`, the `adr queue` CLI subcommand ships in `@adrkit/cli`, and a
managed-issue queue Action lives in the private `@adrkit/ci`
(`packages/ci/queue/action.yml`, bundled to `packages/ci/dist/queue-action.js`).
Phase 6 is **landed / reference-verified** on rungs 1–2 of the
[ADR-0014](./docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
evidence ladder — unit/contract/conformance plus maintainer-owned isolated
reference-repository validation ([`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood),
queue Action pinned at `efef89b`). It is **not** yet externally validated; the
rung-3 external/community signal is tracked honestly as open.

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

Records corpus discovery cannot see — misnamed, or nested below the corpus root —
are reported as `corpus.file-skipped` corpus findings at **`warn`** severity, so a
`proposed` record never disappears from the queue silently. Being `warn`, they do
not change the exit code and do not fail the managed-issue Action.

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

## Agent working directories

**Do not write to the maintainer's main checkout.** Agent runs work in a git
worktree on their own branch, never in place on the primary clone.

Before the first write in a session, check where you are:

```bash
git rev-parse --show-toplevel   # is this the main checkout?
git worktree list               # the first entry is the main checkout
git status --porcelain          # is someone else's work already here?
```

If the toplevel is the main checkout, stop and create a worktree instead:

```bash
git worktree add -b <branch> ../copilot-worktrees/adrkit/<name> origin/main
```

Two rules follow from this, and both have been violated in practice:

- **A dirty main checkout is a hard stop**, not a state to work around. Staged
  or modified files there are someone else's uncommitted work. Do not commit,
  stash, reset, checkout, or "clean up" around them — the owning session may
  still be running, and its work is invisible to `git worktree list`.
- **Never `git worktree remove` or `git branch -D` on the strength of commit
  ancestry alone.** Squash merges rewrite history, so a fully-merged branch is
  *never* an ancestor of `main` and `git log main..<branch>` is not empty.
  Compare *content* instead — `git diff <branch> origin/main -- <paths>` — and
  gate the destructive command on that check actually passing, not merely on
  having printed a warning.
