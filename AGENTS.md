# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–6 landed and v0.10.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `queue`, `migrate --from madr`, `evaluate`) are published on npm, as is
the independently versioned `@adrkit/spec-kit` Spec Kit extension (0.1.2); the
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

## Inbound `@adr` markers (v0.5.0: explain, check, and CI)

A file can declare the decision it lives under by putting `@adr 0012` on a
dedicated comment line inside its first 8192 bytes. v0.4.0 shipped that inbound
edge for `adr explain <path>` under ADR-0021 and
[#97](https://github.com/mbeacom/adrkit/pull/97). v0.5.0 extended the same
resolution to `adr check` and the governing-decisions Action under
[ADR-0022](./docs/adr/0022-scan-inbound-markers-in-check-and-ci-without-giving-them-exit-code-authority.md),
which **supersedes ADR-0021** — read 0022, not 0021, for the current scope. No
schema change: `AdrFrontmatter`,
`AffectsType`, and `schema/adr.schema.json` are untouched.

Two properties are load-bearing and easy to break:

- **Marker I/O stays outside the pure resolvers.** `adr explain`, `adr check`,
  and the CI Action scan at their filesystem boundaries; `checkChanges` accepts
  pre-scanned `markerScans` and remains pure. `declaredBy` lives on the shared
  `GoverningDecision`, so both `check --json` and the Action can report marker
  provenance. Markers add governance context and findings but never gain
  exit-code authority. `packages/adapters/spec-kit/scripts/context.sh` delegates
  path-aware context to `adr check`, so it inherits that marker scan without
  implementing a separate reader.
- **A marker must not be able to lie.** The scanner requires the comment
  introducer to begin the physical line with `@adr` as the comment's first
  content, so prose discussing a decision, a string literal containing one, and
  a trailing `} // @adr 0012` are all rejected. Two further rules narrow that to
  lines the file's own format hides
  ([ADR-0023](./docs/adr/0023-read-a-marker-only-where-the-format-hides-it-fences-and-markdown-prose.md),
  [#101](https://github.com/mbeacom/adrkit/issues/101)): a line inside a ` ``` `
  or `~~~` fence is an example rather than a declaration, and in
  `.md`/`.mdx`/`.markdown` the only introducers are `<!--` and `{/*`, because `#`
  and `*` are markdown's heading and bullet rather than comments. Both are
  line-lead rules, and both only ever remove a declaration — the one addition is
  `{/*`, which previously could not declare anywhere. `path` consequently selects
  the introducer set, so the pure scanner's result is no longer a function of the
  text alone. Truncation uses the byte count
  `read.ts` observed rather than re-deriving it from decoded text, because
  `TextDecoder` drops a BOM and expands invalid bytes, and a re-derived window
  can sever a reference mid-token and report a record the file never named.

Unlike the surfaces below, this is at **rung 1** of ADR-0014 only — unit,
contract, and purity coverage plus maintainer verification. No reference-repository
run.

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

## The Spec Kit extension (`packages/adapters/spec-kit`)

`@adrkit/spec-kit` is the first package under `packages/adapters/*` and the
second distribution surface
([ADR-0003](./docs/adr/0003-ship-as-spec-kit-extension.md)). It adds three
namespaced commands to a [Spec Kit](https://github.com/github/spec-kit) project
— `/speckit.adrkit.context`, `/speckit.adrkit.check`, `/speckit.adrkit.draft` —
plus one **optional** `after_plan` hook that offers to run the check. Pinned to
Spec Kit `>=0.13.0,<0.16.0`, verified against 0.13.0, 0.14.4, and 0.15.1.
Authorized by
[ADR-0019](./docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md).
**Landed / reference-verified** on ADR-0014 rungs 1–2; rung 3 open.

Things that are load-bearing and easy to break:

- **It is versioned independently** of the lockstep surface, per
  [ADR-0007](./docs/adr/0007-adapter-isolation-and-public-surface-build.md) — its
  semver contract is with Spec Kit, not with `@adrkit/core`. It releases on its
  own `spec-kit-v<semver>` tag (see [`docs/RELEASING.md`](./docs/RELEASING.md)),
  currently **0.1.2**, and does **not** move with the repository version.
- **Two version fields must agree**: `package.json` (npm) and `extension.yml`
  (Spec Kit). A test asserts they match — 0.1.1 shipped with them diverged and
  told every user the wrong version.
- **It ships no `dist` and declares no dependencies**, not even dev ones.
  `specify extension add --dev` copies the directory verbatim, and a single
  declared dependency is enough for Bun's isolated linker to create a
  `node_modules/` here that then lands in someone else's repo or aborts their
  install. `LICENSE` and `NOTICE` are committed rather than generated for the
  same reason. Enforced by `test/packaging.test.ts`.
- **Hooks can only reach commands that do not write.** `draft` is the only
  writing command and is unreachable from any hook, by test.
- `packages/core`, `packages/cli`, and `schema/` import nothing from
  `packages/adapters/*`; CI enforces this, and the rule has been observed
  failing against a deliberately introduced violation
  ([ADR-0016](./docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

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

## The agent plugin (`packages/adapters/agent-plugin`)

The `adrkit` plugin is the fourth distribution surface and the one that reaches
GitHub Copilot CLI, Claude Code, opencode, and Agent Package Manager. It ships
one skill (`decision-memory`), one read-only subagent (`decision-checker`), and
four commands (`/adr-context`, `/adr-check`, `/adr-draft`, `/adr-queue`), all of
which drive the `adr` CLI. Independently versioned per ADR-0007, not published
to npm, and catalogued from the repository root's
`.claude-plugin/marketplace.json`. Authorized by
[ADR-0028](./docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md).
**Rung 1 only** — unit and contract coverage plus maintainer verification
against the installed hosts, including a functional exercise in an ephemeral
consumer repository. No persistent reference-repository run, no external
validation. Scope and limitations:
[`docs/reference-verification-agent-plugin.md`](./docs/reference-verification-agent-plugin.md).

Things that are load-bearing and easy to break — each measured against the real
hosts rather than read off their docs, so a change that "looks more correct"
will usually be a regression:

- **The manifest declares no component paths.** `agents`, `skills`, and
  `commands` are documented Copilot CLI fields, but `claude plugin validate`
  rejects the string form outright (`commands: Invalid input`). Both hosts
  discover the conventional directories without them. `category` belongs to the
  marketplace entry, not the plugin manifest.
- **No component declares a `tools` list.** Claude Code takes a comma-separated
  string of capitalized names, Copilot CLI an array of lowercase ones, and
  opencode requires a name-to-boolean mapping and *rejects the agent at load
  time* when handed a list. The read-only contract lives in the agent body
  instead.
- **The plugin deliberately ships no `.mcp.json`.** Copilot CLI spawns a
  plugin's MCP servers with a working directory that is neither the workspace
  nor any Git repository, and exports nothing naming the repository. The adrkit
  server requires a Git worktree root, so it exits during `initialize` and logs
  `Failed to start MCP client for adrkit` every session. MCP is wired per
  project, where the working directory is correct. Do not "fix" this by adding
  the file back.
- **The subagent must resolve the CLI properly.** `@adrkit/cli` is normally a dev
  dependency, so a bare `adr` is not on `PATH`. An agent that tries only that
  concludes "no CLI available" and falls back to reading ADR frontmatter by hand
  — which cannot expand glob matchers, cannot read inbound `@adr` markers, and
  has no exit code, so it produces an answer that looks complete and is not.
  Measured, then fixed: both the skill and the agent now state
  `$ADRKIT_CLI` → `./node_modules/.bin/adr` → `PATH`, and a test enforces it.
- **Three version fields must agree**: `.claude-plugin/plugin.json`, `apm.yml`,
  and `package.json`. Claude Code keys its plugin cache on `version`.
- `copilot plugin install` prints only a skill count. "Installed 1 skill" does
  not mean the rest were dropped — verify in a fresh session, not from the
  install output.

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

## Host-specific entry points

This file is the canonical, host-neutral project memory. The per-host files are
thin pointers to it and carry only what is genuinely specific to their host —
duplicating content into them costs every agent context on every session, and
the copies drift:

- [`CLAUDE.md`](./CLAUDE.md) — Claude Code
- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — GitHub Copilot
- opencode reads this file directly.

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
