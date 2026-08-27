# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–6 landed and v0.12.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `queue`, `migrate --from madr`, `evaluate`) are published on npm, as is
the independently versioned `@adrkit/spec-kit` Spec Kit extension (0.1.3); the
repository-backed CI Action is available at `mbeacom/adrkit/packages/ci@v0`.
The governing-decisions Action also has a root `action.yml` alias for GitHub
Marketplace beginning with the first compatible release after v0.12.0. Root
Marketplace guidance uses immutable release tags; never advertise
`mbeacom/adrkit@v0`, because recovery may move that shared tag to a pre-alias
release. The queue Action remains nested because GitHub lists only root Action
metadata.
The published `@adrkit/mcp` server has exactly four local stdio tools and serves
**both** MCP protocol eras over one stdio connection — `2026-07-28` (stateless;
opened by `server/discover` or a 2026 `_meta` envelope) and the 2025 era (opened
by `initialize`) — via the SDK v2 `serveStdio` entry
([ADR-0018](./docs/adr/0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)).
It passed real-session dogfood against the published artifact on **both** eras,
driven through the official MCP Inspector. The Inspector defaults to the 2025
era; select the modern one with `"protocolEra": "modern"` (or `"auto"`) in the
server's entry in the Inspector's `mcp.json` — there is no CLI flag for it.

## Visual `adr graph`

`adr graph` preserves agent/script compatibility while giving interactive users
a useful view under
[ADR-0033](./docs/adr/0033-select-interactive-graph-presentation-at-the-cli-boundary-while-preserving-piped-dot.md).
Its default is `auto`: stdout attached to a TTY receives the terminal
status/relationship instrument; piped, redirected, and captured stdout still
receives deterministic DOT. Explicit
`--format terminal|dot|json|mermaid` always wins. `--focus <id>` keeps one ADR
and its direct neighborhood; repeatable
`--kind supersedes|relatesTo|conflictsWith` filters every format.

Three boundaries are load-bearing:

- TTY detection belongs only at the CLI boundary. `buildAdrGraph`,
  `filterAdrGraph`, and every core renderer stay pure; JSON retains its existing
  `{ nodes, edges }` contract.
- Full dense corpora are summarized in the terminal instead of being rendered
  as an unreadable network. Use `--focus` or `--kind` to expand a useful
  subgraph. Native SVG/HTML is deliberately deferred; polished DOT remains the
  dependency-free path to Graphviz SVG.
- Terminal views have node and relationship budgets, and title truncation uses
  grapheme-safe display width rather than UTF-16 length. Valid records still
  produce complete DOT/JSON/Mermaid output when another corpus record is
  invalid, but graph writes those error findings to stderr and exits `1`.

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
- **PR-authored declarations are capped before resolution.** A file retains the
  first 64 parsed declarations in physical/source order; a batch retains the
  first 10,000 in code-unit path then source order after concurrent reads finish.
  Exact overflow is collapsed into one advisory report/finding, never one object
  per dropped declaration, and never gains exit-code authority.
- **A marker naming history stays historical and gets an advisory warning.**
  `superseded`, `rejected`, and `deprecated` declarations emit `stale-marker`;
  a resolvable supersession chain names its terminal live successor, but the
  resolver never silently substitutes that record. The original declaration
  remains under `history`, and the warning never changes an exit code.
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
  currently **0.1.3**, and does **not** move with the repository version.
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

## Moving Action tag recovery

Normal lockstep releases publish npm and create a draft GitHub release. A human
publishes that draft with the Marketplace selection; only the resulting
`release: published` finalization moves the lightweight major Action tag (`v0`)
and starts container publication.
`.github/workflows/action-tag-recovery.yml` is the explicit backward path. Run it
from `main` with an existing stable `vX.Y.Z` release tag. It requires an annotated
tag that peels to a commit on `main`, an exact successful `Release` run, matching
root version, and both committed nested Action bundles. It deliberately permits
pre-Marketplace releases so the first compatible release does not remove the
last known-good target for nested `@v0` consumers. It shares the release
concurrency group, holds only `actions: read` and `contents: write`, and pushes
with a lease against the observed remote tag object.
Recovery also records a durable `action-recovery-block/<commit>` tag for the
commit removed from `v0`; the normal release workflow rejects a rerun of that
commit before npm publication. A context-validation job fails dispatches from
another repository or ref instead of leaving a skipped workflow green.

Moving `v0` stops future jobs from resolving a bad release; it does not undo an
already-edited PR comment or change a job that already resolved the old SHA.
Restore comment content from GitHub's edit history or rerun the known-good Action.
The full preferred and manual fallback runbook is in `docs/RELEASING.md`.
It also does not contain an immutable root ref copied from Marketplace: unpublish
the bad listing, warn pinned consumers, and publish a higher hotfix.

## The agent plugin (`packages/adapters/agent-plugin`)

The `adrkit` plugin is the fourth distribution surface and the one that reaches
GitHub Copilot CLI, Claude Code, opencode, and Agent Package Manager. It ships
two skills (`decision-memory`, `decision-backfill`), one read-only subagent
(`decision-checker`), and five commands (`/adr-context`, `/adr-check`,
`/adr-draft`, `/adr-queue`, `/adr-backfill`), all of which drive or reconcile
through the `adr` CLI. Independently versioned per ADR-0007, not published
to npm, and catalogued from the repository root's
`.claude-plugin/marketplace.json`. Authorized by
[ADR-0028](./docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](./docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md).
**Rung 1 only** — unit and contract coverage plus maintainer verification
against the installed hosts, including a functional exercise in an ephemeral
consumer repository. No persistent reference-repository run, no external
validation. Scope and limitations:
[`docs/reference-verification-agent-plugin.md`](./docs/reference-verification-agent-plugin.md).
That functional evidence covers the v0.1.0 context/check/draft/queue baseline.
The v0.2.0 backfill skill and command are contract- and static-host-validated.
A fresh Copilot synthetic-consumer run produced the expected covered/history/new
classification and a complete handoff without changing the worktree. No
persistent reference-repository or external run exists.

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
- **Every version-bearing surface must agree**: `.claude-plugin/plugin.json`,
  `apm.yml`, `package.json`, `bun.lock`, marketplace metadata and entry, and
  every skill's metadata. Claude Code keys its plugin cache on `version`.
- **Backfill discovery is read-only evidence triage.** Code proves current
  state, not intent or ratification. `/adr-backfill` produces a coverage ledger
  and candidates; only `/adr-draft` may create one `proposed` record after a
  human selects it. Statusless evidence never becomes `accepted` automatically.
- **Repository content and local executables are trust boundaries.** Backfill
  treats source text as untrusted data, stays inside the worktree, enforces
  explicit scan caps, and requires confirmation before running a CLI resolved
  inside an inherited repository.
- `copilot plugin install` prints only a skill count. Version 0.2.0 should report
  two skills; that does not inventory the agent or commands — verify them in a
  fresh session.

## The OCI container (`ghcr.io/mbeacom/adrkit`)

The OCI image is the fifth distribution surface, authorized by
[ADR-0032](./docs/adr/0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md).
It is versioned with the lockstep release, not independently. A successful
`Release` workflow creates the lockstep draft only after npm succeeds. Publishing
that stable draft triggers `.github/workflows/container-release.yml`, whose
narrow write-capable job moves the Action's `v0` tag before a separate
lower-privilege job publishes one multi-architecture all-in-one image under
immutable `vX.Y.Z`, moving `vX`, and `latest` tags with a registry provenance
attestation. A failed or adapter-only Release run publishes no container. Manual
recovery runs only from `main` and accepts only an existing successful stable
GitHub release.

Things that are load-bearing:

- **Only the all-in-one `adrkit` target is published.** The `cli`, `mcp`, `ci`,
  and `queue-action` targets exist for local isolation, SBOM, and policy checks;
  each final stage contains only its own executable. Publishing five packages
  would multiply visibility, retention, and rollback operations without adding
  behavior.
- **Bun builds; Node runs.** The build stage uses the repository-pinned Bun
  version and bundles CLI/MCP source for Node. Final stages use Node 24, matching
  the Action runtime, and both base image indexes are pinned by digest.
- **MCP stays read-only and networkless.** Run it with `--read-only`,
  `--network none`, and a `:ro` repository mount. The CI smoke speaks both MCP
  protocol eras through the dedicated image rather than treating clean EOF as a
  protocol test.
- **A container publish follows the coordinated release.** It does not race the
  npm publication workflow and does not run for the independently versioned
  Spec Kit adapter. Container failure is recoverable by manually dispatching
  the workflow for the already-created release tag. All promotions are
  serialized; recovery may restore an immutable historical tag but moves `vX`
  or `latest` only when that release is still newest, and never changes an
  immutable tag to a different digest.

This surface is at **rung 1** of ADR-0014: contract tests, local Docker/Podman
build and runtime smoke, and CI construction. No reference-repository or
external/community validation has been recorded.

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
