# adrkit

Decision memory for human- and agent-authored plans — machine-readable ADRs
that are enforceable in CI and legible to agents, without leaving git.
Status: early — phases 0–6 landed and v0.17.0 is public. `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli` (`lint`, `new`, `graph`, `explain`,
`check`, `queue`, `accept`, `migrate --from madr`, `evaluate`) are published on npm, as is
the independently versioned `@adrkit/spec-kit` Spec Kit extension (0.1.4); the
repository-backed CI Action is available at `mbeacom/adrkit/packages/ci@v0`.
The governing-decisions Action also has a root `action.yml` alias for GitHub
Marketplace beginning with v0.13.0. Root
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
server's entry in the Inspector's `mcp.json`; Inspector 2.8.0 (verified 2026-09-27) also accepts
`--protocol-era legacy|auto|modern` in CLI mode.

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

## Time travel (`adr explain --as-of`)

`adr explain <path> --as-of <date|ref>` answers which decisions governed a path
on a past date, under
[ADR-0039](./docs/adr/0039-derive-a-valid-time-window-from-date-and-supersession-and-resolve-a-git-ref-at-th.md)
(**accepted**, part B of [#116](https://github.com/mbeacom/adrkit/issues/116);
part A shipped in [#187](https://github.com/mbeacom/adrkit/pull/187)). A
valid-time window opens at a record's own `date` and closes at its **immediate**
successor's — not the terminal one, which would report a record in force for its
successor's whole tenure. No schema change.

Five things are load-bearing and easy to break:

- **The as-of view has its own bucketing.** `decisionBucketFor` sends
  `superseded` to `history` unconditionally, which is right in the present tense
  and exactly wrong here. Routing `--as-of` through `bucketDecisions` produces a
  command that runs, passes its tests, and decorates rather than answers.
  Standings are `governing`, `activeProposals`, `history`, `notYetRecorded`, and
  `undetermined`, and windows are **half-open** so the successor owns its own
  start day.
- **`deprecated` is `undetermined`, never guessed.** `adr.schema.ts` allows
  `supersededBy` only on `superseded`, so a `deprecated` record carries no close
  date anywhere in frontmatter. Treating it as "open from `date`" would assert it
  governed in a year it may not have. `rejected` is history on every date,
  because it was in force on none. Both emit advisory findings with no exit-code
  authority.
- **`--as-of` re-dates the corpus, never the working tree.** `affects` patterns
  come from today's records and `@adr` markers from today's files. Reading file
  contents at a past ref needs rename tracking and a blob read, and is
  deliberately out of scope — it is the boundary #116's author named when
  deferring part B. The human view prints a note saying so, because the evidence
  lines are the one thing that is not re-dated; do not delete it as noise.
- **A marker accurate on that date is not stale.** `resolveSourceMarkers` takes
  an optional `asOf`, and suppresses `stale-marker` for a record that was in
  force then. Without it, the same output tells you to fix a marker while
  reporting its record as governing. Absent the option, behavior is unchanged —
  `adr check` and the CI Action never pass it.
- **The kernel is pure; git lives at the CLI boundary.**
  `packages/core/src/temporal/**` has no clock, no filesystem, and no
  subprocess — the date is always an argument. `packages/cli/src/as-of.ts` holds
  the only subprocess in `@adrkit/cli`, tries the date grammar **before** a git
  ref (so a tag named `2026-03-01` reads as a date), peels with
  `rev-parse --verify <ref>^{commit}`, and dates with the **committer** date
  (`%cI`, a stated choice). **Inherited git config is a hazard on both sides**:
  tests that shell out to git must set `GIT_CONFIG_GLOBAL=/dev/null`, because a
  developer with `tag.gpgSign = true` globally otherwise hangs the suite on a
  passphrase prompt; and `git show` must keep `--no-show-signature`, because a
  user with `log.showSignature = true` and a signed commit otherwise gets
  `Good "git" signature for …` prepended to stdout and `--as-of HEAD` fails with
  a misleading "could not resolve". Both were found by running the code.
- **Shipped source must be Node-compatible.** `packages/cli/src`,
  `packages/core/src`, and `packages/evaluator/src` build with `--target=node`,
  and `bun build` does **not** shim the `Bun` global — it emits the reference
  verbatim. A `Bun.spawn` there is a `ReferenceError` in every published install
  while the whole Bun-run suite stays green. `as-of.ts` shipped exactly that
  once, behind a `catch` that reported it as "git is not installed", so the
  subprocess wrapper uses `node:child_process` and catches only `ENOENT`.
  `packages/cli/test/node-compatibility.test.ts` enforces the rule; adapters
  under `packages/adapters/*` are Bun-only and exempt, which is why copying
  `runGit` from one of them was wrong.
- **An inverted window is not an interval.** `isInvertedWindow` lives in
  `@adrkit/core` and is used by both the kernel and the CLI renderer, so a
  window the kernel refuses to call governing is never printed as `in force
  <opens> → <closes>`.
- **`temporal-window-open` is library-only.** A `superseded` record whose
  successor the corpus lacks is a `dangling-supersededBy` **error**, which gates
  `adr explain` before any temporal code runs. The finding is reachable through
  `resolveDecisionsAsOf` as a library call and not through the CLI.

Additive: without the flag, stdout and `--json` are unchanged, and the
present-tense `governing`/`activeProposals`/`history` keys keep their meaning
beside the new `asOf` block. **Rung 1–2** of ADR-0014: rung 1 is unit,
contract, purity and mutation coverage plus a Node-runtime smoke; rung 2 is
maintainer-owned isolated reference-repository validation in
[`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)
(fixtures exercising the window closing along a real supersession chain, a
`deprecated` and a `rejected` record, and a deliberately inverted-date pair;
self-verifying and fail-closed CI; see
[mbeacom/adrkit-t018-dogfood#24](https://github.com/mbeacom/adrkit-t018-dogfood/pull/24)
and its tracked evidence index). Not rung 3 — no external party has run
this.

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
Spec Kit `>=0.13.0,<1.1.0`, verified against 0.13.0, 0.14.4, 0.15.1, 0.16.5,
1.0.0, and 1.0.4–1.0.6.
Authorized by
[ADR-0019](./docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md).
**Landed / reference-verified** on ADR-0014 rungs 1–2; rung 3 open.

Things that are load-bearing and easy to break:

- **It is versioned independently** of the lockstep surface, per
  [ADR-0007](./docs/adr/0007-adapter-isolation-and-public-surface-build.md) — its
  semver contract is with Spec Kit, not with `@adrkit/core`. It releases on its
  own `spec-kit-v<semver>` tag (see [`docs/RELEASING.md`](./docs/RELEASING.md)),
  currently **0.1.4**, and does **not** move with the repository version.
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
adr queue [--dir docs/adr] [--as-of YYYY-MM-DD] [--format auto|terminal|markdown|json]
```

- `--dir` (default `docs/adr`): ADR corpus directory.
- `--as-of` (default: today, UTC): UTC calendar date used for SLA state
  computation. Accepts a bare `YYYY-MM-DD` or an ISO datetime with an explicit
  timezone (e.g. `2026-01-08T00:00:00Z`); timezone-less datetimes are rejected.
- `--format` (default `auto`): `terminal` on a TTY, otherwise `markdown`; or an
  explicit `terminal`, `markdown`, or `json` (QueueReport v1). Only a TTY ever
  gets the terminal view — under
  [ADR-0044](./docs/adr/0044-ratify-a-proposed-record-with-adr-accept-and-present-the-queue-for-terminals.md)
  (**accepted**), following ADR-0033 — so piped output is unchanged.

Exit codes: `0` = report with no corpus error findings; `1` = report emitted
(complete, to stdout) with one or more error-severity corpus findings; `2` =
usage error (invalid flag/value or unreachable corpus directory). Identical
inputs produce byte-for-byte identical output (SC-001).

Records corpus discovery cannot see — misnamed, or nested below the corpus root —
are reported as `corpus.file-skipped` corpus findings at **`warn`** severity, so a
`proposed` record never disappears from the queue silently. Being `warn`, they do
not change the exit code and do not fail the managed-issue Action.

## `adr accept`

`adr accept <id> --by <identity>` ratifies a `proposed` record, under
[ADR-0044](./docs/adr/0044-ratify-a-proposed-record-with-adr-accept-and-present-the-queue-for-terminals.md)
(**accepted**). It is the third writing command, after `new` and `migrate`.

- **It splices three fields and nothing else**: `status`,
  `provenance.ratifiedBy`, and `review.decidedAt`. A `yaml` round trip would
  reformat 39 of this corpus's 44 records, so `acceptAdrSource` in
  `packages/core/src/transition/` edits lines. It then re-parses the result and
  refuses unless every other field is semantically unchanged. That re-check
  caught a real ordering bug during development, so do not replace it with a
  serializer.
- **`--by` is mandatory and never inferred.** The clock is read in
  `packages/cli/src/accept.ts`; the core transition is pure.
- **It refuses rather than overrides** review state: a record that is not
  `proposed`, has an unresolved objection, has fewer approvals than its
  `review.quorum`, or would fail validation is left untouched, with exit `1`.
- **No agent surface runs it.** The agent plugin's wiring test fails if any
  command, skill, or agent mentions `adr accept`. The queue's terminal view may
  *print* the command for a human. It does so only when a dry run of the same
  `acceptAdrSource` transition, made in `queue.ts`, would succeed; otherwise it
  prints that refusal. Review state alone misses refusals such as an empty
  `deciders`, so do not replace the dry run with a field check.

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
through the `adr` CLI. Since 0.4.0 it also ships one GitHub Copilot CLI dynamic
workflow, `adr-review` (`extensions/adrkit/`), authorized by
[ADR-0045](./docs/adr/0045-ship-an-advisory-adr-review-dynamic-workflow-in-the-portable-agent-plugin.md)
(**accepted**). `claude plugin validate` passes with it present; APM 0.33.0
installs it into `apm_modules` and deploys it to no target (its one warning,
`Unrecognized plugin manifest $schema`, predates the workflow); a
native opencode load is unmeasured. Independently versioned per ADR-0007, not
published to npm, and catalogued from the repository root's
`.claude-plugin/marketplace.json`. Authorized by
[ADR-0028](./docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)
and its accepted backfill amendment,
[ADR-0034](./docs/adr/0034-extend-the-portable-agent-plugin-with-decision-backfill.md).
**Rung 1 only** — unit and contract coverage plus maintainer verification
against the installed hosts, including a functional exercise in an ephemeral
consumer repository. The v0.4.0 `adr-review` workflow adds unit and contract
tests and a maintainer live smoke on Copilot CLI 1.0.92 (two subagents, both
planted conflicts found, worktree clean). It also has a repeat through the
published GitHub install on 1.0.93, plus a deletion-only run. Since 0.5.0 it
also ships one read-only Copilot app canvas, `decision-review`, in the same
extension, authorized by
[ADR-0046](./docs/adr/0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md)
(**accepted**). The canvas is **rung 1**: unit and contract tests plus a
headless Copilot CLI 1.0.93 SDK-host smoke (open, state, refresh, and one
`run_review` at about 0.16 AI credits), plus maintainer sessions in Copilot app
1.1.27 where the panel rendered in the app's theme and a review started from it
came back as `findings`. Earlier
Copilot CLI versions and a native opencode load are unverified.
No persistent reference-repository run, no external validation. Scope and
limitations:
[`docs/reference-verification-agent-plugin.md`](./docs/reference-verification-agent-plugin.md).
That functional evidence covers the v0.1.0 context/check/draft/queue baseline.
The v0.2.0 backfill skill and command are contract- and static-host-validated.
A fresh Copilot synthetic-consumer run produced the expected covered/history/new
classification and a complete handoff without changing the worktree. For the
v0.3.1 bootstrap-record offer, detection is measured against synthetic corpora
(missing, empty, source-only, process-record-present, unmigrated MADR, and — added
after 0.3.0 review — `proposed`, `rejected`, and mixed-validity); host surfacing
behavior and the offer's write path end to end are both unverified. No persistent reference-repository or
external run exists.

Things that are load-bearing and easy to break — each measured against the real
hosts rather than read off their docs, so a change that "looks more correct"
will usually be a regression:

- **The manifest declares no component paths.** `agents`, `skills`, and
  `commands` are documented Copilot CLI fields, but `claude plugin validate`
  rejects the string form outright (`commands: Invalid input`). Both hosts
  discover the conventional directories without them. `category` belongs to the
  marketplace entry, not the plugin manifest.
- **The manifest declares no `extensions` key either.** Measured on Copilot CLI
  1.0.93: a non-string `extensions` value (three objects and an array were tried, not
  `null`, booleans or numbers; the string form loads) in `.claude-plugin/plugin.json`
  stops the plugin's extension from loading, so the workflow and canvas vanish while
  `plugins.list` still shows the plugin enabled. `claude plugin validate` only warns
  and APM accepts it, so both validators pass a change that removes the shipped
  surface. That rules out the Agent Plugins 1.0 `extensions["com.github.copilot"].logo`
  listing key; see `docs/reference-verification-agent-plugin.md`.
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
- **The bootstrap record is an offer, not a candidate.** A repository with no
  corpus is missing the process decision (keep decisions in git) and the tooling
  decision (enforce them with adrkit). Nothing proves a human ratified either,
  so it stays out of the candidates table and out of every `backfillHandoff` —
  it governs the corpus directory, a glob, and could never supply concrete
  `candidatePaths` — and routes to plain `/adr-draft`. Adopting adrkit is never
  a supersession of the decision to record decisions; `supersedes` is reserved
  for a prior *tooling* record, and a MADR corpus is migrated, not superseded.
  Detection reads the exit code **before** the buckets, and reads **all three
  buckets** — `governing` holds `accepted` alone, so `activeProposals`
  (`draft`/`proposed`) and `history` (`rejected`/`superseded`/`deprecated`) are
  where a record already settling the question actually sits. Reading
  `governing` by itself makes the offer re-propose its own output, because
  `/adr-draft` writes `proposed`. The corpus-wide gate is `adr lint`, not
  `adr check`, whose exit code is path-scoped: a malformed record elsewhere
  leaves `adr check` at exit `0` with an empty result. Both the skill **and**
  `commands/adr-backfill.md` carry this, because `/adr-backfill` loads the
  command
  ([ADR-0038](./docs/adr/0038-offer-the-bootstrap-decision-record-as-an-offer-rather-than-a-backfill-candidate.md)).
- **The offered record must bind the corpus directory.** `adr new` scaffolds
  `affects: []`, and a record that binds nothing is invisible to the detection
  above however many buckets are read — so the offer states the matcher. Found
  by the first functional run of the write path, not by review; it is the
  failure ADR-0038 already listed under "how we would know this was wrong".
- **`/adr-draft` can write into a repository with no corpus.** Its `adr lint`
  gate stops on exit `2` except when the corpus directory does not exist yet:
  `adr new` creates it and allocates `0001`, so the bootstrap offer's own
  headline case is writable. A corpus that exists and does not parse is still a
  hard stop.
- **The `adr-review` workflow lives at the plugin root `extensions/`.** For a
  `.claude-plugin/plugin.json` plugin Copilot reads
  `<plugin-root>/extensions/<dir>/extension.mjs`; `com.github.copilot/extensions/`
  is for Agent Plugins 1.0 manifests and was not found. Exactly one copy.
- **The workflow's exit code is always 0, so `result.status` is the gate.**
  `copilot workflow run` exits 0 on success, a thrown error, invalid
  arguments, and an unknown name. The workflow is advisory, and the single
  gating rule is: the run's status is `completed` and `result.status` is
  `"ok"`. `status` is `ok` | `findings` | `incomplete` | `usage-error`, with
  precedence usage-error > findings > incomplete > ok; `checkExitCode`,
  `lintExitCode`, `verdicts`, and `unverified` are detail, not the gate. A
  missing judgment makes the run `incomplete`, and an unresolvable explicit
  `base`, or an unresolved `origin/main` over a clean working tree, is a
  `usage-error` — never `ok`. A non-zero `adr` exit is data, never a throw, or
  the run settles with no result and still exits 0.
- **The agent name is namespaced.** `ctx.agent` must use
  `adrkit:decision-checker`; the bare name resolves to `null` without throwing,
  so every null is reported under `unverified`, never dropped.
- **The CLI is chosen by the environment only, and a repo-local one is gated.**
  `$ADRKIT_CLI`, then `./node_modules/.bin/adr` only when
  `ADRKIT_ALLOW_REPO_CLI=1`, then `PATH`. `cli` and `allowRepoCli` are
  deliberately not workflow arguments: a model that read untrusted repository
  content can choose arguments, and extension code runs outside Copilot's
  permission prompts. Unknown arguments are a `usage-error`. Do not add them
  back.
- **One extension registers both the workflow and the canvas, and each
  registration is guarded.** `register.mjs` builds each in its own `try` and
  logs a failure through `session.log`. Measured: one invalid workflow
  definition (no `meta.phases`) throws at import and took the whole extension
  down, canvas included. A throwing canvas must likewise not stop the workflow.
- **The canvas server starts lazily inside `open()`.** The app launched 181
  extension loads within minutes of starting, one process per restored session;
  a server bound at load would bind a port in every one. A test imports the
  modules under Node and asserts no socket opens.
- **The panel is hardened because ADR titles are untrusted.** Every route
  checks a per-panel token before routing (403 otherwise), a POST needs the
  token as a header and a same-origin `Origin`, the CSP is `default-src 'none'`
  with `'self'` scripts and styles, and the page builds its DOM with
  `textContent` only. Do not add `innerHTML`, an inline script or style, or a
  looser CSP; tests fail on each.
- **`refresh` costs nothing and `run_review` spends credits.** `refresh` runs
  `git diff`, `adr check`, and `adr lint`; `run_review` starts `adr-review`,
  one `decision-checker` call per governing decision. Invalid `run_review`
  arguments throw `invalid_input` before anything is spent. The explain
  affordance is an HTTP route the page uses, not an agent action.
- **The canvas takes its directory from `ctx.session.workingDirectory`.** That
  is the documented source. The app's *runtime* process runs from `/`, but each
  extension process it forks starts in its session's directory: a probe in an
  app session measured `process.cwd()` equal to `sessionWorkingDirectory`, both
  the app's session worktree. The workflow starts from that `process.cwd()` and
  then follows `session.context_changed` (`session-dir.mjs`, below), which is
  why `run_review` reviews the right repository in the app. If a later runtime
  breaks that equality at fork, the workflow must take the session directory
  too.
- **An app session is a fresh worktree off the default branch.** A new app
  session showed `0 changed file(s)` because nothing had changed in it yet.
  That is correct, not a bug: the panel shows the session's own changes.
- **`show_review` never replaces a run the panel started.** In the app, a
  finished panel run is surfaced to the agent, which then handed the same
  result back and relabelled it "supplied by the agent". Measured, then fixed;
  do not loosen the guard. It also refuses a result whose status is cleaner
  than its own payload, or whose files or governing records are not the
  panel's, and a refresh drops a shown review once any changed file's size or
  modification time moves. File names alone miss an edit inside the set.
- **Canvases render only in the Copilot app.** A CLI terminal session has no
  canvas renderer, so the agent gets no canvas tools there. Do not describe the
  canvas as available in the CLI.
- **Canvas provenance shows only what `adr check` reports**
  ([ADR-0047](./docs/adr/0047-show-provenance-review-cost-and-a-read-only-proposal-queue-in-the-decision-revie.md),
  **proposed**). Measured on a fixture: `declaredBy` names the changed file and
  line of an inbound marker, but an `affects` match carries only
  `{ type, pattern }`, with no file. The page says so instead of matching
  globs itself; the extension cannot import core, and a homemade matcher could
  disagree with the CLI and present that as provenance. If core gains per-file
  attribution, read it.
- **`judgeCalls` follows the Judge, which is
  `ctx.pipeline(governing, … ctx.agent(…))`** in `review.mjs`: at most one
  `decision-checker` call per governing decision. It is the governing count when
  `adr check` and `adr lint` exit 0 or 1, and 0 otherwise, because the workflow
  then skips the Judge. Change the workflow's Judge shape and the button label
  and `run_review` description go stale. The button is disabled whenever
  `judgeCalls` is 0, and says why.
- **The canvas queue is an allowlist, and that is what keeps a ratifying
  field out.** `adr queue`'s terminal view prints that command for a human;
  the canvas reads only the JSON and keeps nine named item fields, so a field
  added later is dropped unnamed. That selects fields, not text: a kept string
  such as `title` is untrusted repository text shown as data, and is not
  sanitized for command-like wording. A test plants such fields and checks the
  snapshot, `/api/state`, the rendered page, and the shipped page strings.
  Queue rows have no control or explain, and their ids are not explainable. A
  queue failure is a fixed note, never CLI stderr, and never changes the panel's
  status, governing list, or notes. The queue starts beside the check with
  its own timeout (30 s, then its process is signalled). The check commits and
  broadcasts when it settles and the queue follows in a second update, so a
  hung `adr queue` cannot hold the governing view; opening a panel and the
  page's routes (GET and POST) do not wait for it, nor does `run_review`'s
  pre-run refresh; only agent `get_state`/`refresh` do. Its strings, and
  `declaredBy` paths, are clipped like CLI messages, and the rows share a
  256 KiB (UTF-8 bytes) serialized budget, before every broadcast.
- **The extension also registers two advisory session hooks**
  (`hooks.mjs`, [ADR-0049](./docs/adr/0049-add-advisory-session-hooks-that-never-block-to-the-portable-agent-plugin.md),
  **proposed**): `onSessionStart` adds a governing-decisions summary;
  `onPostToolUse`, after an edit, names the accepted decision(s) governing the
  file just edited and refreshes open `decision-review` panels. Their
  registration is guarded like the other two, and `ADRKIT_HOOKS=0` makes the
  factory return `undefined`, so no `hooks` key is joined at all.
- **There is no `onPreToolUse`, and do not add one.** Measured on Copilot CLI
  1.0.93 through `session.rpc.tools.execute`: a pre-tool hook that never
  answers holds the tool call unexecuted (still pending at 90 s), while a
  post-tool hook that hangs lets the edit land and only holds the result. The
  CLI changelog also records versions where a pre-tool hook error denies the
  call. A pre-tool hook makes extension liveness a gate, which ADR-0022 denies
  to an advisory. A crashed extension failed open in both hooks there.
- **A hook returns `additionalContext` and nothing else.** No
  `permissionDecision` (the SDK's own example returns `"allow"`, which would
  override a person's `ask`), no `modifiedArgs`, `modifiedResult`, or
  `suppressOutput`. A test asserts the key set and was observed failing against
  an `"allow"` mutation.
- **Hook context carries ids, never text.** Record ids are checked against a
  record's own id grammar (`adr.schema.ts` `id`: 4+ digits or a ULID, no
  namespace, because a namespace segment is free text) and statuses against a
  fixed set; anything else is skipped silently. Titles, paths, and error
  messages never reach it, because the model reads hook context as
  instructions.
- **`session.log` is fire-and-forget in hooks; never `await fail(...)`.** It is
  an RPC with no deadline: awaiting it let a never-answering log hold
  `onSessionStart` past its 5 s deadline indefinitely (found in review), pin a
  failed cached check, and wedge the single-flight refresh. `fail` guards both
  a synchronous throw and a rejected log; removing either guard fails a test
  (one of them a Node child-process test for an unhandled rejection that would
  kill the extension).
- **`onSessionStart` fires with the first prompt, not at load.** Measured on
  1.0.93 (SDK host): a plugin extension joins after `session.start`; with no
  prompt no hook fires, even on resume. With a prompt it fires after
  `onUserPromptSubmitted` with `source: "new"`. It races a 5 s deadline, because
  its sequential calls (up to two `git diff`s, then one `adr check` per
  batch of a wide diff) could otherwise hold the first prompt for 15 s or
  more. When the deadline wins, the hook aborts the call in flight and starts
  no further batch: nobody reads that summary, and a 40,000-path diff would
  otherwise keep one hook slot busy for minutes (found in review; a counting
  test pins it).
- **The edit tools are the ones the runtime classifies as edits**: `edit` and
  `create` (`{ path }`, absolute in session logs), `str_replace` (`edit`'s
  shape), `str_replace_editor` only when `command` is `create`, `str_replace`,
  or `insert` (its `view` reads; both from the bundle, unobserved in logs), and
  `apply_patch`, whose `toolArgs` is the raw patch **string** (measured with
  `gpt-6-luna`), parsed for `*** Add/Update/Delete File:` and `*** Move to:`
  and cut at 20 paths while parsing. A renamed tool turns the note off
  silently. Paths are made relative to the hook input's `workingDirectory`,
  never `process.cwd()`.
- **Hook cost is capped, and the caps are tested.**
  - Non-edit tools return before any I/O.
  - At most two hook-spawned processes run at once, each with
    `AbortSignal.timeout(5000)`.
  - There is one `adr check` per distinct path per process, shared by
    concurrent edits and cached even when it fails, except when a signal, a
    timeout, or an abort ended it: that says nothing about the file, so the
    next edit checks again (a CLI that cannot start stays cached, so it is not
    retried on every edit). The 500-check budget is a
    monotonic count, not the cache size, because a corpus edit clears the
    cache and must not re-arm the budget.
  - The post-edit note gives up after 2 s and the check keeps filling the
    cache.
  - The hook-triggered canvas refresh is single-flight: one in flight, at most
    one queued, under one 15 s abort signal passed through `refreshOpen` into
    the canvas's `refresh`. That signal bounds the `adr queue` read too,
    combined with the queue's own timeout rather than replacing it, and the
    hook's refresh waits for the queue so single-flight stays true. When the
    signal fires, the panel keeps its previous result and queue under fixed
    timeout notes; an aborted refresh never commits the abort's exception text
    as a usage error.
  - The debounce timer is `unref`'d.
  - A timeout or abort ends the whole process tree on POSIX. The shared
    `runCommand` in `review.mjs` (the one runner the workflow, canvas, tools,
    and hooks all use; there are no copies) spawns with stdin ignored and
    `detached`, then signals the group once: SIGTERM, then SIGKILL after an
    unref'd 1 s grace, skipped if a signal-0 probe already shows the group
    gone. Signalling only the child left a grandchild behind a
    version-manager shim running (shown against the 0.8.0 runner with a shell
    wrapper and with a node shim; Node-run tests now assert the grandchild is
    gone). A descendant that calls `setsid` itself leaves the group and is
    out of reach.
  - Detached groups must not outlive the extension, and `detached` alone made
    them do so: measured on 1.0.93 in a headless SDK host, both a SIGTERM to
    the extension process and a plain `disconnect` + `client.stop()` left the
    child and its grandchild running before the fix, and ended both after it.
    So a group stays tracked until a probe says it is gone (not merely until
    its leader closes; at most 10 probes, 1 s apart, then it is dropped so a
    lingering member or an EPERM probe cannot keep the listeners forever), an
    `exit` listener SIGKILLs tracked groups, and while
    any group is tracked, listeners for SIGTERM, SIGINT, and SIGHUP do the
    same, remove themselves, and re-raise the signal so its default action
    still ends the process. With no group tracked no listener exists, so the
    extension's own signal behavior is unchanged; if the host added its own
    listener for that signal, the signal is not re-raised.
  - Every command has a 120 s ceiling (`COMMAND_CEILING_MS`). The callers'
    own limits are shorter, so it only bounds calls that had none: the
    workflow, the page's own refresh, and the tools. It ends the group and
    rejects with a `TimeoutError`.
  - On Windows the signal goes to `spawn`, which ends the direct child only:
    a stated limit, not fixed.
- **One join retry ladder serves the hooks and the tools**: without `hooks`,
  without `tools`, without both, without `canvases` alone, then the workflow
  alone (at most six joins; `onEvent` is never dropped). It rethrows the
  original error if every rung fails, and logs exactly the fields the
  successful join dropped. A runtime that refuses `hooks` must not cost the
  workflow, the canvas, or the tools, and one that refuses the tools must not
  cost the hooks. Because `hooks` goes first, a one-off unrelated
  join error turns the hooks off for the session; that is accepted, and the
  log line says so instead of blaming them.
- **`ADRKIT_*` variables reach the extension without
  `requestedEnvironmentVariables`.** Measured on 1.0.93 through the SDK host,
  including a variable whose name ends in `_SECRET_TOKEN`. Its arrival in the
  app, and hook firing in the app, an interactive CLI session, and subagent
  child sessions, are unmeasured.
- `copilot plugin install` prints only a skill count. Version 0.8.0 should report
  two skills; that does not inventory the agent or commands — verify them in a
  fresh session.

### Extension tools (`adr_check`, `adr_explain`, `adr_lint`)

The same extension registers three read-only tools through
`joinSession({ tools })`, proposed in
[ADR-0048](./docs/adr/0048-supply-read-only-adrkit-tools-to-github-copilot-through-the-plugin-extension-ins.md)
(**proposed**). They amend ADR-0028's inventory without reversing it: the plugin
still ships no `.mcp.json`. **Rung 1**: unit and contract tests plus headless
Copilot CLI 1.0.93 measurements with no model calls; unmeasured in the Copilot
app. Measured, and easy to break:

- **A tool invocation carries no directory, and `process.cwd()` goes stale.**
  After `metadata.setWorkingDirectory` (what `/cd` uses) the extension is not
  restarted and its `process.cwd()` does not move, but it receives
  `session.context_changed` with the new `cwd`. The tools track that event,
  through `joinSession`'s `onEvent` so a change during the join is kept; do
  not "simplify" them back to `process.cwd()`. The workflow reads the same
  tracker (`session-dir.mjs`) when each run starts, through
  `createReviewWorkflow`, so a review after `/cd` reviews the new directory;
  a tracker value captured at load would be stale too.
- **A bad tool definition refuses the whole join.** A name outside
  `/^[a-zA-Z0-9_-]+$/` made the runtime reject `joinSession`, workflow and
  canvas included, so `register.mjs` retries without the tools on the shared
  ladder described under the hooks above, keeping the workflow always. A name that collides with a built-in
  joins but breaks `tools.initializeAndValidate()` for the **whole session**, so
  never name a tool after a built-in.
- **The executable is chosen by the environment only**, through the workflow's
  `resolveCli`. No tool argument selects it, and unknown keys are refused.
- **Arguments are validated in the extension**, because the host does not enforce
  the schema: relative paths only, no `..`, no leading `-`, no control
  characters, at most 200 paths of 1024 characters, and a conservative `base`
  (`isSafeBaseRef`: `^[A-Za-z0-9._/@{}~^-]+$`, no leading `-`, `..` only in a
  `...` range), shared with the workflow's `validateArgs` because `base` is
  repeated in the Judge prompt's commands. The
  corpus directory taken from the argument or the default `docs/adr` is
  `realpath`-checked against the session root before spawning, so a committed
  symlink out of the worktree is refused (`symlink-escape`); a user-set
  `ADRKIT_DIR` is trusted, and the checked value is the value passed as `--dir`.
- **Every `adr check` is batched, and every echoed file list is capped.** The
  CLI takes paths as arguments only (no stdin or file list), so a wide diff
  can exceed Windows' ~32 KiB command line. `checkInBatches` splits paths at
  about 24 KiB of argv and merges the reports (decisions by record id, sorted;
  findings deduplicated and sorted with core's `sortFindings` key, restated
  and pinned against core by a test; highest exit; `markerScan` dropped,
  because per-call scan counts do not add up; `batches: N` added). One batch
  returns the CLI's result untouched, so `batches` marks the merged shape.
  ADR-0022's declaration caps apply per call. Echoed lists stop at 200 paths
  with a `filesOmitted` count and, in the workflow result, a `filesDigest`
  (SHA-256 of the full sorted list). The canvas keeps the **full** list in
  memory and compares a capped result with `sameFileSet`, by digest;
  `sanitizeReviewResult` refuses a capped result with no digest; comparing a capped result with the full list would drop every
  wide-change review as stale (pinned in `test/batching.test.ts`).
- **A capped Judge prompt must say how to see the rest.** A bare
  `git diff --name-only` prints nothing for committed work, so a Judge shown
  200 unrelated paths answered from what it could see (found in review). The
  prompt lists the paths whose markers declared the decision first, then
  names the range the run collected (`git diff --name-only <base>...HEAD`, or
  `HEAD` in the fallback); for explicit `files` it says the caller supplied
  the list, with its count. One test per mode pins the hint.
- **Results never carry exception text or a writing command.** Rejections and
  spawn failures return fixed messages chosen by code (CodeQL
  `js/stack-trace-exposure`). CLI stderr is returned only on exit `2`, capped
  and without stack-frame lines, because a crash's stderr is a stack. The
  workflow result, the canvas's notes, `/api/state`, and its agent results
  follow the same rule since 0.8.1: every error is a `ReviewError` or is
  mapped by `publicMessage` from its `code` and `signal` alone, `validateArgs`
  no longer echoes the value it refused, and a run's own `error`/`reason` is
  never shown. `test/error-text.test.ts` plants a sentinel in stderr and in
  thrown errors and asserts it reaches none of those outputs. Every
  string is scrubbed **before** serialization, matching any whitespace or
  format character between `adr` and the subcommand: scrubbing the JSON text
  missed `adr\naccept` (found in review). A non-zero `adr` exit with a report
  is `success` with its `exitCode`.
- **Commands and skills do not mention the tools.** Claude Code and opencode
  never load extensions; the CLI path stays the portable one.

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

## Derived surfaces stay in lockstep three different ways

[ADR-0040](./docs/adr/0040-keep-derived-surfaces-in-lockstep-with-three-mechanisms-matched-to-three-classes.md)
(**accepted**) splits documentation drift into three classes and refuses to
pretend one mechanism covers them. Conflating them is what produces a gate that
reports green while checking nothing.

- **Derived inventory** — `MANIFEST.md`'s record table is a pure function of
  `docs/adr/`. `bun run emit:manifest` generates the block between its markers;
  `clean-clone-builds` asserts no diff. Never hand-edit it.
- **Referential integrity** — `bun run check:stale-refs` fails when a document
  speaking in the present tense cites a `superseded`, `rejected`, or
  `deprecated` record without saying so. Acknowledgement is per **paragraph or
  list item**, and for a superseded record it must be the *successor's id*, not
  the word "superseded" — the word does not tell the reader where to go next.
  The `@adr` marker half of the same class is the separate, already-shipped
  `stale-marker` finding; the two share one definition of successor and nothing
  else, and prose is never treated as an inbound governance declaration.
- **Implementation claims** — ADR action-item checkboxes are neither derivable
  nor checkable. Verify each claim against the tree before ticking, and leave an
  item unchecked when the evidence does not support it. This is process, and the
  record says so rather than faking automation.

Two boundaries are load-bearing:

- **Scan scope is the whole decision, and it is hand-maintained on purpose.**
  `docs/adr/`, `CHANGELOG.md`, `specs/`, `plan.md`, and source are excluded
  because they narrate history correctly — rewriting them would falsify the
  past. That exclusion is the difference between one finding and 149 mentions.
  A new top-level prose document is unguarded until someone adds it to
  `SCANNED` in `scripts/check-stale-adr-references.ts`.
- **Neither rule gains exit-code authority over a consumer's corpus.** The
  prose guard fails this repository's own CI step. It does not change
  `adr lint`, `adr check`, or the governing-decisions Action, and ADR-0022's
  deliberate denial of exit-code authority to marker findings is untouched.

Both guards are repo-local scripts, not CLI surface: `adr graph --format json`
already emits every node's `status` and every `supersedes` edge, and the public
CLI is a semver commitment (ADR-0031) whose write surface is deliberately
small: `new`, `migrate`, and `accept` (ADR-0044, **accepted**). A public
Markdown inventory formatter waits for adopter demand.

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
