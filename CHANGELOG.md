# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until `1.0.0`, minor releases may include breaking changes
([ADR-0002](docs/adr/0002-typed-frontmatter-as-madr-superset.md)).

## [Unreleased]

### Added

- **A GitHub Actions Marketplace entry point for governing decisions.** The
  repository-root `action.yml` runs the existing committed Action bundle while
  preserving `mbeacom/adrkit/packages/ci@<ref>` for compatibility. A contract
  keeps both metadata files and bundle targets aligned, forward release rejects
  trees without the root entry point, and recovery keeps pre-Marketplace releases
  eligible for existing nested consumers. The queue Action remains nested rather
  than creating a second distribution repository; immutable Marketplace failures
  use an explicit unpublish-and-hotfix runbook
  ([ADR-0036](docs/adr/0036-expose-the-governing-decisions-action-through-one-root-marketplace-entry-point.md)).

### Fixed

- **Completed locale-independent ordering for `check --json` and the
  governing-decisions Action.** The final three `affects/**` sorts now compare
  record ids, fired matcher `(type, pattern)` tuples, and changed dependency
  `(name, version)` tuples by UTF-16 code unit. Identical inputs therefore
  produce the same serialized order across ICU locales. Consumers golden-diffing
  output may see one intentional reordering for mixed-case ULIDs or
  case-sensitive matcher and dependency values. The committed Action bundle was
  rebuilt with the same behavior
  ([#115](https://github.com/mbeacom/adrkit/issues/115)).

## [0.12.0] - 2026-08-27

### Added

- **A guarded recovery path for the moving `v0` Action tag.** Manual recovery
  accepts only an existing stable release whose annotated tag peels to a commit
  on `main`, whose exact `Release` run succeeded, whose root version matches,
  and whose committed Action bundles exist. Tag movement uses a lease and leaves
  a durable withdrawal marker that prevents the removed commit from being
  republished on a rerun
  ([#175](https://github.com/mbeacom/adrkit/pull/175),
  [#136](https://github.com/mbeacom/adrkit/issues/136),
  [#122](https://github.com/mbeacom/adrkit/issues/122)).

- **Marker scan health and unbound claims in the governing-decisions Action
  comment.** Changed files that were absent, unreadable, out of tree, or skipped
  are reported separately from `@adr` claims that were read but did not bind to
  this corpus. Both sections are bounded, escaped, advisory, and ordered behind
  changed-record errors
  ([#178](https://github.com/mbeacom/adrkit/pull/178),
  [#112](https://github.com/mbeacom/adrkit/issues/112),
  [#126](https://github.com/mbeacom/adrkit/issues/126)).

- **`MANIFEST.md`'s decision-corpus inventory is generated, not hand-written.**
  `bun run emit:manifest` renders the record table and the status counts from
  `adr graph --format json` between stable markers, and `clean-clone-builds`
  regenerates it and asserts the tree is unchanged — the same shape as the
  schema emit and the committed Action bundle. The inventory had drifted six
  records before it was noticed
  ([#131](https://github.com/mbeacom/adrkit/issues/131)). No public CLI surface
  was added: the CLI stays read-only and the writing lives in a repo-local
  script ([#132](https://github.com/mbeacom/adrkit/issues/132)). Judgment prose
  outside the markers stays hand-maintained.

- **Trusted CI gates that the pull request cannot edit.** A new
  `.github/workflows/trusted-gates.yml` runs on `pull_request_target`, which
  GitHub executes from the repository's default branch — workflow file,
  referenced actions, and `actions/checkout` commit alike. `trusted-dco` is now
  the authoritative sign-off gate, reading the pull request's commits as fetched
  git objects that are never checked out or executed; the `dco` job in `ci.yml`
  is retained as a faster advisory report that can only fail open. `gate-integrity`
  blocks any change under `.github/workflows/`, `.github/actions/`, `scripts/`,
  `packages/ci/`, or any of the three locations GitHub resolves `CODEOWNERS` from,
  unless a maintainer applies the `gate-change-acknowledged` label — which
  requires triage or write access, and which is dismissed automatically on every
  event that can move the head or the base (an exclusion list: only `labeled` and
  `unlabeled` do not dismiss), so an acknowledgment authorizes the state it was
  given for and not the one that follows it
  ([#137](https://github.com/mbeacom/adrkit/issues/137),
  [ADR-0035](docs/adr/0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md)).
  The workflow deliberately has no workflow-level concurrency group: GitHub
  replaces an existing pending run when a newer run enters the group even when
  `cancel-in-progress` is `false`, which let a title edit replace the pending
  run that had to dismiss a stale acknowledgment. Overlapping runs remain
  fail-closed because check runs bind to their event head SHA, while live API
  reads, dismissal verification, and changed-file completeness checks abort or
  block on inconsistent state.
  Scope is stated rather than overstated: this closes name-shadowing and protects
  the trusted gates' definition, but it does **not** make the advisory gates in
  `ci.yml` tamper-proof — they execute pull-request code and reach it through
  `bun run <name>`, so the root manifest can redirect them. The specific
  unprotected routes are enumerated in `DOCUMENTED_UNPROTECTED_ROUTES` and pinned
  by a test.

- **`scripts/check-gate-integrity.ts`**, backing that second gate. Imports Node
  builtins only, so it runs with no `bun install` and a broken dependency graph
  cannot take it down. Its pass condition is an absence, so it refuses to report
  a pass over an empty changed-file list, over a list the GitHub API truncated,
  or over a payload it could not parse — each of those observed firing before the
  check counted as coverage
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
  It reads a rename's `previous_filename` as well as its `filename`, because the
  files endpoint reports only the new path and a rename out of a protected prefix
  would otherwise have passed clean and deleted the gate on merge.

- **[`docs/repository-trust-operations.md`](docs/repository-trust-operations.md)**,
  separating the controls that are active from the ones that could not be applied
  until the trusted workflow reached `main`, with the exact verified commands and
  the evidence for each. Both gates are now deployed and required: the live `main`
  ruleset lists `trusted-dco` and `gate-integrity` among its ten required
  contexts, and the pull-request-controlled `dco` context was removed from that
  set only after the trusted one reported green on real pull requests. Both were
  observed failing before being relied on
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)):
  `gate-integrity` went red before an acknowledgment and green after it on three
  ordinary pull requests, and `trusted-dco` went red on a commit that deliberately
  omitted `Signed-off-by` and green once it was signed. That is deployed evidence
  in both directions, not a fixture or a local invocation.

### Changed

- **Actions must now be pinned to a full-length commit SHA** at the repository
  level (`sha_pinning_required`, `false` → `true`). Every action here was already
  SHA-pinned, so no workflow changed; the setting removes the ability to
  introduce a mutable tag later.

- **`CODEOWNERS` names the gate-defining paths explicitly**, with both caveats
  stated in the file: the default `*` line already covered them, and with no
  `pull_request` rule on the `main` ruleset these lines request a review rather
  than requiring one. ADR-0035 records why required review is not available to
  this repository as a real control rather than shipping a rule that only looks
  like one.

- **`scripts/check-dco.ts` no longer carries a "known limitation" note.** It now
  states which invocation is the authority and which is advisory, because the
  limitation stopped being true for the one that gates the merge.

### Fixed

- **Inbound marker amplification is bounded before resolution.** One file now
  retains at most the first 64 parsed declarations, and one batch at most the
  first 10,000 in deterministic code-unit path plus source order. Exact overflow
  collapses into one advisory `marker-declarations-capped` finding and
  `markerScan.declarations` metadata; `explain`, `check`, and the Action report
  it without giving PR-authored markers exit-code authority
  ([#113](https://github.com/mbeacom/adrkit/issues/113)).

- **`adr queue` no longer stays silent when a proposed record has a review
  deadline but no routing tier.** `item.tier-absent` now fires whenever the tier
  cannot be determined on a record that has entered review — a `review` block,
  or a top-level `reviewBy`. The carve-out the spec actually states is
  two-conditioned (both absent), but only the first condition was implemented,
  so a `cross-team` record with `reviewBy` and no `review` block was listed with
  `tier=None` and no finding at all
  ([#111](https://github.com/mbeacom/adrkit/issues/111)). A `proposed` record
  with neither remains `not-queued` and silent. Severity stays `info`, so no
  exit code changes.

## [0.11.0] - 2026-08-26

### Added

- **A source-built OCI image for the CLI, MCP server, and both CI entry
  points.** The final image runs as a non-root user on Node 24, while Bun
  remains the pinned build tool. Dedicated local build targets contain only
  their own executable surface; the all-in-one target dispatches
  `cli`/`adr`/`adrkit`, `mcp`/`adrkit-mcp`, `ci`/`adrkit-ci`, and
  `queue-action`/`adrkit-queue-action`. MCP examples use a read-only root and
  repository mount.

- **Lockstep GitHub Container Registry publication.** A successful lockstep
  Release workflow now triggers a multi-architecture
  `ghcr.io/mbeacom/adrkit` build with immutable `vX.Y.Z`, moving `vX`, and
  `latest` tags plus a registry provenance attestation. The workflow supports
  manual recovery only for an existing successful GitHub release
  ([ADR-0032](docs/adr/0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md)).

- **`adr graph` now has terminal and Mermaid renderers plus focused views.**
  `--format terminal` prints a compact status/relationship instrument,
  `--format mermaid` emits deterministic GitHub-compatible flowchart source,
  `--focus <id>` keeps one decision and its direct neighborhood, and repeatable
  `--kind <supersedes|relatesTo|conflictsWith>` filters every format. The pure
  `filterAdrGraph` and `renderMermaidGraph` functions are also exported from
  `@adrkit/core`. Terminal rendering is bounded for large sparse and focused
  corpora and truncates multilingual titles by grapheme-safe display width.

- **The portable `adrkit` agent plugin now supports evidence-backed ADR
  backfill (plugin v0.2.0).** The auto-triggered `decision-backfill` skill and
  read-only `/adr-backfill` command audit code, documentation, plans, and git
  history; route existing MADR corpora to deterministic migration; reconcile
  candidates against accepted, proposed, rejected, and superseded decisions;
  and return a coverage ledger plus candidate evidence cards. They never
  bulk-write records or promote statusless observations to `accepted`; a human
  selects one candidate before the existing `/adr-draft` flow creates a
  `proposed` record. The workflow is documented at
  [`adrkit.dev/backfill`](https://adrkit.dev/backfill/).

  ADR-0034 authorizes the component expansion. Review hardening adds
  repository-local CLI trust confirmation, in-worktree path containment,
  explicit scan budgets, untrusted-evidence handling, custom `--dir` routing,
  option terminators, exit-code recovery, a structured candidate-to-draft
  handoff, retained contradictory fixtures, complete version-surface checks,
  and per-host update guidance.

  PR review hardening adds immediate pre-write reconciliation, literal argv
  handling for evidence-derived titles, MCP worktree/corpus identity checks, and
  schema-shaped `affects` matchers in every handoff.

### Changed

- **Interactive `adr graph` is human-readable without breaking pipes.** The
  default format is now `auto`: a TTY receives the terminal view, while captured,
  piped, and redirected stdout continues to receive deterministic DOT. Explicit
  `terminal`, `dot`, `json`, and `mermaid` formats always win. DOT output now
  carries visible status labels and the portable adrkit palette while preserving
  node ids, status attributes, relationship directions, and edge labels
  ([ADR-0033](docs/adr/0033-select-interactive-graph-presentation-at-the-cli-boundary-while-preserving-piped-dot.md)).
  Graph JSON preserves its historical locale ordering. A graph built from a
  partially invalid corpus is still emitted completely from valid records, but
  the error findings are now written to stderr and the command exits `1`.

- **Release simulation now exercises every graph channel from installed
  tarballs.** Node 22/24 smoke checks cover piped DOT, focused and kind-filtered
  JSON, Mermaid, explicit terminal output, and the new core exports. The release
  runbook now includes bad-version deprecation, temporary dist-tag rollback, and
  forward-only lockstep hotfix steps.

### Fixed

- **Release publication dry-runs now verify registry integrity before deciding
  what to publish.** An unchanged independently versioned adapter riding along
  with a lockstep release is skipped when its packed bytes match npm, just as it
  is during real publication, instead of `npm publish --dry-run` rejecting the
  already-published version.

## [spec-kit-0.1.3] - 2026-08-26

### Changed

- Refreshed the Spec Kit extension README with the community-catalog install
  path, project-local CLI resolution, a concise plan-loop workflow, and clearer
  runtime guarantees and support guidance.

## [0.10.0] - 2026-08-26

### Changed

- **The CLI help is now task-oriented and suitable for discovery.** Top-level
  help names and describes each command, shows common workflows, links to the
  command reference, and no longer exposes an internal ADR citation. Every
  command now documents its arguments and examples; usage errors point to the
  relevant command instead of dumping unrelated global help; likely command
  typos receive a suggestion; and invoking `adr` without arguments shows help
  successfully.

- **CLI mistake recovery is now smarter across commands.** Mistyped long options
  now suggest the intended flag, and the closed value sets for `new --status`,
  `graph --format`, `migrate --from`, and `queue --format` give near-miss
  hints without changing the existing exit codes or stdout/stderr split.

- **`adr completion` now prints deterministic shell scripts for Bash, Zsh, and
  Fish.** The command writes to stdout only, covers top-level commands plus each
  command's documented options, and the CLI README now includes copy-paste
  activation examples for both `adr` and `adrkit`, including Fish instructions
  that install or symlink both `adr.fish` and `adrkit.fish`.

- **Human-facing CLI output now respects TTY color and `NO_COLOR`.** Plain text
  output stays ANSI-free when piped or redirected, `--color auto|always|never`
  controls terminal styling, and JSON/completion output remain unchanged.

## [0.9.0] - 2026-08-24

### Added

- **A new `@adrkit/core` runtime export, plus its result type:**
  `resolveAsOf` (pinned by the package surface test) and `AsOfResolution`
  (`packages/core/src/queue/as-of.ts`). This is the rule that turns an `--as-of`
  input into the UTC calendar date `buildQueueReport` computes SLA state against —
  a bare `YYYY-MM-DD`, or an ISO datetime carrying an explicit timezone, with a
  timezone-less datetime rejected as ambiguous rather than guessed. It previously
  lived privately in the CLI, so **a library consumer building the ARB queue had to
  reimplement it, and any difference produced a queue that disagreed with CI about
  which decisions were overdue — same corpus, same day, no error raised.** If you
  reimplemented that rule, you can now stop
  ([ADR-0031](docs/adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
  action item 7).

- **A portable agent plugin — adrkit's fourth distribution surface**
  (`packages/adapters/agent-plugin`, plugin name `adrkit`, v0.1.0). One skill
  (`decision-memory`), one read-only subagent (`decision-checker`), and four
  commands (`/adr-context`, `/adr-check`, `/adr-draft`, `/adr-queue`), installable
  into GitHub Copilot CLI, Claude Code, opencode, and anything
  [APM](https://github.com/microsoft/apm) targets. The repository is now also its
  own marketplace, via a hand-authored `.claude-plugin/marketplace.json` at the
  root — the one catalog location both Copilot CLI and Claude Code resolve.
  Independently versioned per
  [ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md), not
  published to npm because every host installs it from git. Authorized by
  [ADR-0028](docs/adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md).

  Four host disagreements were measured rather than inferred, and each is now a
  test that has been observed failing against a deliberate violation
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)):
  the manifest declares no component paths, because `claude plugin validate`
  rejects the string form of `commands`/`agents`/`skills` that Copilot CLI
  documents; no component declares a `tools` list, because opencode requires a
  name-to-boolean mapping and *rejects the agent at load time* when handed the
  list the other two hosts take; the manifests carry no `"//"` comment keys; and
  all three version fields must agree.

  A fifth defect came from exercising the components rather than loading them:
  the subagent reported "no CLI available" in a repository where `@adrkit/cli`
  was installed as a dev dependency, because it tried only a bare `adr` and then
  silently fell back to reading ADR frontmatter by hand — an answer that looks
  complete but cannot expand glob matchers, read inbound `@adr` markers, or
  produce an exit code. The skill and the agent now both state the resolution
  order `$ADRKIT_CLI` → `./node_modules/.bin/adr` → `PATH`. Full scope, and what
  these runs do *not* establish, in
  [`docs/reference-verification-agent-plugin.md`](docs/reference-verification-agent-plugin.md).

- **`AGENTS.md` as the canonical, host-neutral project memory.** `CLAUDE.md` and
  the new `.github/copilot-instructions.md` are now thin pointers to it carrying
  only genuinely host-specific notes, rather than a second copy that costs
  context on every session and drifts from the first. opencode reads `AGENTS.md`
  directly.

### Fixed

- **Path normalization now preserves literal backslashes on POSIX.**
  `checkChanges` converts backslashes only where the runtime platform treats them
  as separators, and applies that same rule to changed paths and the ADR corpus
  directory. This prevents one POSIX filename from being reported or governed as
  a different path, and prevents a root-level file such as
  `docs\adr\0001-x.md` from being mistaken for an ADR under `docs/adr`. The
  committed governing-decisions Action bundle carries the same fix
  ([#160](https://github.com/mbeacom/adrkit/pull/160)).

- **`--as-of` accepted two classes of input that produced a wrong date rather than
  an error.** An expanded-year datetime (`+010000-01-01T00:00:00Z`) was truncated to
  a non-date such as `+010000-01`; because the queue kernel compares `asOf` to
  deadlines lexicographically and `+` sorts below every digit, that silently reported
  **every** deadline-bearing item as within SLA. And an impossible date was rejected
  when written bare (`2026-02-30`) but normalized to a different day when written as a
  datetime (`2026-02-30T00:00:00Z` → `2026-03-02`) — the same input answered two ways
  depending on spelling. Both now return `invalid`. Real leap days and legitimate
  offset shifts are unaffected.

### Notes

- **A four-lens deep review (adversarial, architect, consumer, operator) found
  five further issues in the shipped guidance, all now fixed and guarded.** Three
  were verified against adrkit 0.8.0 before acting. (1) The four command bodies
  lacked the `$ADRKIT_CLI` → `./node_modules/.bin/adr` → `PATH` resolution order
  that the skill and agent had gained — and a slash command is injected
  deterministically while the skill loads only when the model judges it relevant,
  so under the documented dev-dependency install the commands would fail and
  invite the hand-read fallback. (2) The guidance sent the "did we already reject
  this?" check to `list_superseded`, which skips every record whose status is not
  `superseded` and can never return a `rejected` one — a well-formed empty answer
  that defeats one of the three failure modes the skill exists to prevent; it now
  uses `search_decisions` with `status: ["rejected"]`. (3) `/adr-draft` never set
  `provenance.authoredBy`, and `adr new` hard-codes `human` with no flag to change
  it, so agent-drafted records claimed human authorship *and* disarmed the
  `agent-accepted-requires-ratifier` invariant, which only fires for `agent` /
  `agent-drafted`. (4) The check flow could report "nothing governs this" at exit
  `0` while a malformed governing record sat on disk, because `adr check` keeps
  findings only for the paths given and drops unparseable records entirely; it now
  runs `adr lint` first and treats an ungoverned verdict as unverified when the
  corpus is dirty. (5) All four commands carried `allowed-tools` with Copilot
  CLI's lowercase vocabulary — the same unmeasured portability hazard that got the
  agent `tools:` field removed — so it is gone, matching the sibling Spec Kit
  adapter.

- **`docs/RELEASING.md` now documents the plugin's release channel.** It is the
  one adapter with no release tag: it is `private`, absent from `RELEASE_PACKAGES`,
  and published by merging to `main`, so the runbook covers the three-field version
  bump, the host-validator commands CI does not run, and the fact that there is no
  yank — rolling back means shipping a higher version.

- **The plugin ships no `.mcp.json`, deliberately.** GitHub Copilot CLI spawns a  plugin's MCP servers with a working directory that is neither the workspace nor
  any Git repository, and exports nothing naming the repository — measured by
  configuring the server command to record its own `pwd` and environment. Since
  the adrkit MCP server requires a Git worktree root, it exits during
  `initialize` and logs `Failed to start MCP client for adrkit` every session. A
  server that cannot start is worse than one never configured, so MCP stays wired
  per project, where the working directory is correct.

## [0.8.0] - 2026-08-15

### Changed

- **`action-dogfood` is a required status check on `main`** (2026-08-15), added once it
  had run green across several commits of #143 — it could not be required before that,
  since it skips on the pull requests that cannot satisfy it. Checked while adding it:
  `clean-clone-builds` was **already** required, which closes the hole the second operator
  review raised conditionally. That coupling is now recorded on
  [ADR-0026](docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md),
  because it is invisible from both sides — `action-dogfood` declares
  `needs: clean-clone-builds`, a job skipped for a failed dependency reports success
  exactly like one skipped by an `if:`, and nothing in `ci.yml` says that dropping
  `clean-clone-builds` from the ruleset would silently weaken the comment gate.

- **The comment path is `reference-verified`** — reviewed and passed by `@mbeacom` on
  2026-08-15, completing the last of ADR-0014's four rung-2 criteria. Still **not**
  `externally validated`; the reference repository is maintainer-owned, so rung 3 remains
  absent, and the index's stated limitations are part of the verdict rather than footnotes
  to it.

### Fixed

- **The rung-2 evidence index shipped in #143 with a header contradicting its own body** —
  `NOT YET OBSERVED` and `Reviewer verdict: none. No run has occurred.` directly above a
  table of observed runs with comment ids and content hashes. The cause was a scripted
  `.replace()` written without an assertion, against text a previous edit had already
  changed: it matched nothing, did nothing, and reported success. That is the failure this
  index exists to make visible, committed in the index itself, so the corrected header
  records it rather than quietly overwriting it.

### Added

- **The unscoped `adrkit` package was attempted and abandoned — npm will not issue the
  name.** The plan was a forwarder to `@adrkit/cli` owning the bare name, so that
  `npx adrkit` could not resolve to anyone else's package. It was built, tested, and
  packed; publishing it was attempted during this release and the registry refused the
  request, so the package does not exist:

  ```
  403 Forbidden - PUT https://registry.npmjs.org/adrkit
  Package name too similar to existing package pdfkit
  ```

  npm's similarity check compares names after stripping punctuation, and `adrkit` is too
  close to `pdfkit`. This is not a race for the name and not something a retry fixes: the
  same rule blocks `adr-kit` and `adr_kit`, which normalize to `adrkit` exactly. The
  availability check that preceded the work — `npm view adrkit` returning 404 — proved
  only that the name was unused, which is a weaker property than publishable, and the
  distinction is invisible until the registry rejects the `PUT`.

  The consequence is narrow but real: the zero-install `npx adrkit` form is permanently
  unavailable, `npx @adrkit/cli` remains the zero-install form, and the documentation
  warning against `npx adrkit` stays rather than being lifted. Nothing that installs
  `@adrkit/cli` is affected — see the binary alias below, which is unrelated to the
  registry and shipped normally.

- **`@adrkit/cli` now installs an `adrkit` binary alongside `adr`.** The bare name `adr`
  on npm belongs to an unrelated package (`phodal/adr`, published since 2017), so the
  `adr` command is ambiguous in two ways adrkit does not control: a bare `npx adr` fetches
  that package whenever adrkit's binary is not linked into `node_modules/.bin`, and a
  project holding both dependencies has them compete for the same `.bin` entry. `adrkit`
  collides with nothing, so `adrkit lint` is unambiguous for globally-installed users and
  in `node_modules/.bin`. `adr` is unchanged and remains the primary name — this is purely
  additive, and nothing that works today stops working. The alias covers the **installed**
  binary only. `npx adrkit` is *not* made safe by it — that depended on owning the
  unscoped package name, which npm refused (above), so `npx adrkit` still resolves against
  the registry and would run whatever anyone publishes there, without prompting in CI
  where npm assumes `--yes` on a non-TTY. `npx --no` is not a sufficient answer either: it
  declines to install a missing package but still runs one already in the npx cache. Use
  `npx @adrkit/cli` for zero-install, and `adrkit` only as an installed binary.
  `release-pack` now asserts both binaries are present in the packed manifest, and that
  assertion was observed failing with the alias removed before it was counted as coverage
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

- **The comment-posting Action now has an end-to-end signal**
  ([ADR-0026](docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)
  action item 9, #135). `self-dogfood` runs the **CLI** with `contents: read`, so it never
  constructed a GitHub client, resolved an identity, or posted a comment — the surface
  #107 lived in had no coverage before it shipped to every adopter pinned at the moving
  `v0` tag. That is how #107 survived two releases: every suite was green, and the job
  log it printed (`adrkit: created the governing-decisions comment.`) is what healthy
  operation prints.

  **A new `action-dogfood` job** runs `uses: ./packages/ci` **twice** against the
  repository's own pull requests and asserts, over the API, that exactly one comment
  leads with `<!-- adrkit:ci -->` and that a Bot authored it. It is gated on
  `clean-clone-builds` so it cannot pass over a stale committed bundle, and serialized
  per pull request so two concurrent runs cannot both create and fail a correct Action.
  The assertion also runs *between* the two dispatches, on a bounded retry, as a
  read-your-writes barrier — GitHub can serve the comment list from a replica, and a
  second dispatch that listed before the first comment became visible would create a
  duplicate and fail a healthy Action. This is the only job in the repository with a
  write capability (`pull-requests: write`), scoped to one job rather than raised at the
  workflow level.

  **`exactly one`, not `at most one`.** An empty comment list satisfies "at most one",
  and an empty list is what a revoked permission, a wrong pull-request number, and a
  silently-degraded Action all produce — the blind-pass shape
  [ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
  exists to prevent. Three cross-checks close the remaining blind spots: the list is
  compared against the comment count GitHub reports for the issue, so a lost
  `--paginate` cannot hide a duplicate on page two; the surviving comment's **id** is
  compared across dispatches, so a count of one cannot be satisfied by a replacement;
  and the ids owned **before** the run are recorded, so a duplicate the pull request
  already carried is not reported as a fresh regression. Ownership requires a **bot
  author** as well as a leading marker, matching the Action's own rule — without that,
  anyone able to comment could red the check with one invisible line. The gate is
  `scripts/check-ci-comment.ts`, which imports only builtins, reports every marked
  comment it examined rather than only its verdict, and ships permanent negative
  fixtures for the duplicate (#107), absent, empty, human-authored, and impostor shapes,
  each observed rejecting.

  **What it does not cover, stated rather than implied.** After a pull request's first
  push the comment already exists, so a dispatch that writes nothing satisfies both
  assertions. The inverse of #107 is therefore caught on every newly-opened pull
  request's first run and not on later pushes within one pull request; the rung-2
  artifact covers the create-then-update pair from a clean state. Adding an Action
  output to close it was rejected — expanding a published contract to serve a test is
  the wrong direction, and a self-report is the evidence #107 already defeated.

  **Fork and Dependabot pull requests are excluded**, because their `GITHUB_TOKEN` is
  read-only whatever `permissions:` declares — the Action correctly degrades to a log
  notice (FR-014) and posts nothing, so the assertion would fail a healthy Action.
  `pull_request_target` would close that blind spot by running base-repo workflows with
  a write token against fork-authored code, and was rejected outright.

- **The rung-2 reference run happened, and closed [ADR-0026](docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)
  action item 8.** Three scenarios green on
  [`adrkit-t018-dogfood#16`](https://github.com/mbeacom/adrkit-t018-dogfood/pull/16)
  against adrkit pinned at `71f46d6`. The Action logged `created` then `updated` with the
  comment id unchanged at `#5289930628` from a clean start; a plain file as `dir` failed
  the step with `ENOTDIR` leaving the comment set byte-identical; and a
  `pull-requests: read` token produced the FR-014 degrade — a log notice, a green job,
  nothing written. That degrade path had **never been observed anywhere**; it had only
  ever been read from source. Reviewed and passed by `@mbeacom` on 2026-08-15, which
  completes ADR-0014's rung-2 criteria: the comment path is **landed /
  reference-verified**, and still **not** `externally validated` — the reference
  repository is maintainer-owned, so rung 3 stays absent.

  **Running it found four defects in the artifact, all invisible to static review.**
  `path: .adrkit` deleted the contents of a directory the reference repository tracks
  (now `.adrkit-src`, the name that repo already reserves); a second workflow posting the
  same marker silently *weakens* a run rather than failing it, because a foreign comment
  satisfies the `absent` rule — the first attempt was green having observed two updates
  and no create; `degrade-read-only` never echoed its outcome, so that evidence row had
  to be read from the REST API; and `--paginate` with `join(",")` inside `--jq` emits one
  line per page, which would hand `--expect-ids` a multi-line value past 30 comments —
  reproduced against the labels endpoint and fixed in **`action-dogfood` too**, which
  carried the same defect. A run against the corrected artifact confirmed all four fixes
  and is the cited evidence — an artifact fixed after its own verification run is an
  unverified artifact.

  **A fifth defect was in the instructions, and it caused a real failure.** The README
  said to delete the marker comment *before* pushing. That removes the accidental
  protection a pre-existing comment provides — it makes a second writer *update* rather
  than create — so both the verification workflow and the reference repository's own
  `adr.yml` listed an empty set and both created, within the same second, producing
  consecutive comment ids and a failed run that blamed #107 for an Action that had
  behaved correctly. The order is now push → settle → delete → `gh run rerun`, which
  excludes the race structurally, because a re-run does not re-trigger other workflows.

  That failure is also the first time the `duplicate` rule has been observed **firing**
  outside a fixture, which closes an ADR-0016 gap the evidence index had recorded as
  open. It exposed a sixth defect in passing: the message asserted "a dispatch in this
  run created rather than updated — the regression of #107" when a concurrent writer was
  responsible. `--expect-ids` separates *predates this run* from *created during it*, but
  not *created by this run* from *created by another writer*, so the message now names
  both causes and points at the Action's own log, which does distinguish them.

  It also produced a claim that had to be withdrawn, which is worth recording because the
  withdrawal is the useful part. `updated_at` did not move across either in-place update,
  and that was generalised into "GitHub does not bump `updated_at` for a byte-identical
  PATCH" on the strength of a probe in one context. It does not hold in another: on
  `mbeacom/openleague`, three same-commit re-runs with a SHA-256-identical body advanced
  it every time. A second explanation — the actor — was then offered and is also wrong,
  contradicted by the evidence table it sat beside: the unchanged and advanced bot rows
  are the same actor. Endpoint and elapsed time are ruled out by measurement. **The
  mechanism is not established**, and is left unexplained rather than given a third
  plausible story. The gate asserts **id
  stability** rather than `updated_at`, and that choice never depended on the direction —
  only on the field being uncontractual, which two contradicting contexts evidence better
  than either result alone.

- **A second review found the retry loops were decorative, and the fix is `--just-wrote`.**
  The read-your-writes race the loops exist for — a comment created moments ago and not
  yet visible on a read replica — produces the `absent` rule, not `incomplete`. With
  `absent` permanently definitive, the checker exited 1 and the workflow killed the step
  on attempt 1, so the loops could only ever retry the lost-`--paginate` class, which
  retrying cannot fix. Reproduced before fixing: `check-ci-comment empty.json
  --expect-total=1` exited 1, not 2. `--just-wrote` now marks `absent` retryable for a
  caller that dispatched a write immediately beforehand, and definitive otherwise —
  a duplicate or a changed id stays fatal either way, by test.

  Also from that review: every `gh api` read is now soft, not just the ones in the first
  loop (a single 502 killed the step the loop was built to survive); comment counts are
  validated as decimal integers before `$(( ))`, which read a non-numeric value as a
  variable name and silently disabled the completeness check at zero; the `prior-ids` jq
  filter splits on all three line terminators, matching the classifier rather than being a
  fourth place that decides ownership differently; retries use exponential backoff to 75s,
  since a secondary rate limit is answered with a `Retry-After` well past a flat 25s; and
  the job gained `timeout-minutes: 10`, because a hung request would otherwise leave a
  required check Pending for six hours — the one state with no notification and no log.

  **`cancel-in-progress` is now `false`**, matching `release.yml` and the reference
  workflow. This job was the odd one out at `true` while the reference file argued the
  opposite in writing, for the same write to the same comment — both files written here.
  Cancellation is a signal plus a grace period, so a cancelled dispatch can still be
  mid-create when its replacement lists an empty set and creates its own, and the
  resulting duplicate is non-retryable and needs a human to delete a comment.

- **A runnable rung-2 reference-repository artifact for the comment path**
  (`specs/004-ci-surface/evidence/reference-repo/`). It calls the Action as a consumer
  does — `uses: mbeacom/adrkit/packages/ci@<sha>` — and covers two scenarios the
  in-repository job structurally cannot: a fail-closed dispatch against an invalid
  corpus directory that must write nothing, and the FR-014 degrade under
  `pull-requests: read` that must stay green. Shipped as a workflow file rather than as
  a task, per ADR-0016 clause 4 — it is the mechanism for ADR-0026 action item 8, which
  stays open until it is run. Its evidence index
  (`specs/004-ci-surface/checklists/reference-verification-evidence.md`) was created
  **empty and explicitly `NOT YET OBSERVED`**, and has since been filled from real runs
  and reviewed.

## [0.7.0] - 2026-08-12

### Added

- **DCO sign-off is enforced, not just documented** ([ADR-0006](docs/adr/0006-license-apache-2-and-single-monorepo.md)
  action item 2, #130). A `dco` job checks every commit a pull request adds and is a
  required status check on `main`. Sign-off was practiced by every contributor and
  required by both `CONTRIBUTING.md` and the PR template, but no ruleset check
  enforced it — the control was honor-system, and an unsigned commit would have
  merged.

  **A repository script (`scripts/check-dco.ts`), not the [DCO app](https://github.com/apps/dco),**
  so the gate stays inside the surface [ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md)
  keeps mechanical and self-contained rather than adding a third-party app to the IP
  boundary. It imports only Node builtins and runs with no `bun install`, so a broken
  dependency graph cannot take the sign-off gate down with it. Accept/reject semantics
  track the app's, because that is the contract contributors already know, with two
  deliberate differences: a sign-off's **name and address must come from one identity**
  (the app takes the name from either the author or the committer and the address from
  either, so a web-UI commit signed `Jane Doe <noreply@github.com>` passes there), and
  a **bot still has to sign** — app accounts are exempt from the *address* half only,
  because Dependabot signs from `support@github.com` and cannot equal its own author
  address by construction, but the trailer must still name the bot. Every exemption is
  named in the job output, so a commit is never skipped silently.

  **The squash-merge body setting moved from `BLANK` to `COMMIT_MESSAGES`.** A
  pull-request check certifies the *contributor*, which is what the DCO is for, but a
  blank squash body discards every trailer at merge: `main`'s own head (`f74c089`)
  carried no sign-off while every commit proposed to it carried one. ADR-0006 traded
  away commercial leverage for provenance, and provenance that is verified and then
  thrown away at merge is not provenance.

  Observed rejecting a real unsigned commit in a real repository before it counted as
  coverage ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
  The negative cases are permanent in `scripts/check-dco.test.ts`, including the one
  that matters most for this class of check: **an empty commit range is an error, not
  a pass.** An unfetched or misspelled base ref makes `git log` return nothing and
  drives every count in the report to zero, which renders identically to a clean run —
  the exact fail-quiet shape ADR-0016 exists to prevent.

- **Badges — corpus size and ARB queue depth — as recipes over output adrkit
  already produces.** A new [badges guide](https://adrkit.dev/badges/) documents two
  snippets, both rendering a number through shields.io from JSON your own repository
  publishes: `$.checked` from `adr lint --json` for how many decisions are on
  record, and `$.totalItems` from `adr queue --format json` for how many await
  review ([ADR-0025](docs/adr/0025-ship-badges-as-recipes-over-existing-output.md)).
  A static "uses adrkit" badge is deliberately not offered — it asserts something a
  reader cannot check, and a count proves the same thing for the same cost. The
  pass/fail badge for a workflow running `adr check` is documented too, but it is
  GitHub's badge and works the same for any workflow.

  **No new CLI surface and no service.** `adr queue --format json` already emits
  `totalItems`, `asOf`, and `corpusFingerprint`, so an `adr badge` command would be
  public API maintained forever to reformat a field that exists. A hosted endpoint
  was refused separately: it would add an uptime dependency to every adopter's
  README, put a computed surface on the origin ADR-0011 froze as static and
  immutable, and make badge renders a de-facto record of who uses adrkit.

  **adrkit publishes its own number as a site build artifact,** not as a committed
  file: `site.yml` already rebuilds on `docs/adr/**`, so it emits
  `site/public/queue.json` (gitignored, like the served schema), served at
  `https://adrkit.dev/queue.json` for a badge to read. No workflow holds a write token and there
  is no stored artifact to fall behind. The recipe published for adopters commits
  the file instead, since most repositories have no site to piggyback on, and names
  the alternatives for a protected default branch rather than shipping a snippet
  that fails where nobody looks.

  The recipe badges `$.totalItems` and nothing else, because queue *depth* is a pure
  function of the corpus — `buildQueueReport` selects items by `status: proposed` —
  while SLA state advances with the calendar. Depth therefore stays true when
  regenerated on corpus change; a deadline-derived badge would need a scheduled
  rebuild and a daily bot commit to avoid going quietly wrong. Adopters are pointed
  at the queue Action for deadline pressure, since a badge cannot detect its own
  staleness and an issue can notify.

### Changed

- **Ratified the five foundational ADRs that the corpus had already been building
  on**: [ADR-0003](docs/adr/0003-ship-as-spec-kit-extension.md) (Spec Kit extension
  plus standalone CLI), [ADR-0006](docs/adr/0006-license-apache-2-and-single-monorepo.md)
  (Apache-2.0, DCO, monorepo), [ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md)
  (adapter isolation and the public-surface build),
  [ADR-0008](docs/adr/0008-import-and-migration-semantics.md) (MADR migration and
  one-way import), and [ADR-0009](docs/adr/0009-affects-resolution-and-catalog-binding.md)
  (`affects` resolution and catalog binding) move from `proposed` to `accepted`.

  **This closed a governance inversion, not a formality.** Nine accepted records
  already relied on ADR-0007 and six on ADR-0009, and two of them narrowed clauses
  of records that had never been ratified — ADR-0013 amends both, ADR-0012 refines
  ADR-0009. Accepted decisions were resting on a `proposed` foundation. Each of the
  five was verified against the tree before ratification rather than on the strength
  of its own checkboxes: ADR-0007's two assertions run as the `clean-clone-builds`
  CI job and `scripts/check-deps.ts`, four of ADR-0009's five deliverables exist
  (`core/src/affects/`, the purity test, `test/conformance/`, and `adr explain`),
  and ADR-0006 is irreversible in fact because the repository is already public.

  Ratification is recorded on each record as `review.decidedAt` and
  `review.approvals`, the first use of either field in this corpus, so the audit
  trail says when the decision was taken and by whom rather than leaving `status`
  to carry it alone. Stale action-item checkboxes were corrected to match verified
  reality; items that are genuinely open were left unchecked, including ADR-0006's
  DCO bot, which CONTRIBUTING.md required but which no ruleset check enforced at the
  time of that ratification — closed later in this same release by the DCO gate
  described above — ADR-0008's re-import pull request, which is unbuilt because
  non-MADR
  re-import is unbuilt, and ADR-0009's catalog port item — the port type exists but
  no adapter implementation ships, since `catalog-backstage` is placement and
  dependency boundary only. Ratification rests on the resolution semantics, which
  are implemented and conformance-tested; the catalog adapter remains governed by
  ADR-0013 and ADR-0020. `MANIFEST.md` is brought back in step with the corpus,
  and the follow-ups ADR-0012 and ADR-0013 left open for this decision are closed
  by it.

  **ARB queue depth drops from 6 to 1**, which the queue-depth badge reads from
  `$.totalItems`. [ADR-0005](docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md)
  deliberately stays `proposed`: only Pass 0 of its four passes exists, and the
  record carries a `SOC2 CC8.1` control plus a standing commitment to publish
  escalation precision and recall each release. Ratifying it would assert a
  compliance obligation the project cannot yet compute. Its `reviewBy` of
  2027-01-18 leaves room to ship Passes 1–3 first.

### Fixed

- **The governing-decisions Action now updates its own comment instead of posting a
  new one on every push** ([#107](https://github.com/mbeacom/adrkit/issues/107),
  [ADR-0026](docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)).
  **If you added `env: GITHUB_TOKEN: ${{ github.token }}` as a workaround, you can
  remove it once you are on this release** — it becomes a no-op rather than a
  requirement, so leaving it costs nothing. Comments a pull request accumulated before
  upgrading stay put — the
  Action deletes nothing; it updates the newest and leaves the rest for you to clear
  once. A long-lived pull request previously gained one near-identical comment per
  push, which is the exact anti-pattern the hidden `<!-- adrkit:ci -->` marker exists
  to prevent.

  **The upsert was correct; the identity it depended on was unobtainable.** Locating
  the Action's own comment required its own login, and the default `GITHUB_TOKEN` is a
  GitHub App installation token that cannot call `users.getAuthenticated`. The fallback
  was gated on recognising the token as the default one by comparing it against
  `process.env.GITHUB_TOKEN` — but `action.yml` defaults the `token` input to
  `${{ github.token }}`, and Actions does not export `GITHUB_TOKEN` into a step unless
  the workflow asks. So the comparison had no right-hand side, the identity resolved to
  "unknown", and every run created. Passing `token:` explicitly changed nothing, because
  the input already held that value.

  **Identity is now classified by what the token actually proves.** A permission-shaped
  refusal of `users.getAuthenticated` is not missing information — it is how an app
  installation token is always refused, so it establishes that the author is a *bot*.
  The Action pairs that with a stricter marker rule for this path: the marker must be
  exactly the body's **first line**, which is true of every comment it has ever posted
  and false of a human or another bot quoting one. That is the same ownership test the
  ARB queue Action already applies to its managed issue, so both now answer "is this
  ours?" identically. A resolved login still matches exactly. An identity that cannot be
  resolved at all still adopts nothing, but now says so as a job-log warning instead of
  passing silently.

  This also fixes repositories using a custom GitHub App token (`actions/create-github-app-token`),
  which never had a working upsert. Making the update path reachable also made a race
  reachable that had never fired: a prior comment deleted between the list and the
  update now yields a replacement rather than costing that push its comment.

## [0.6.0] - 2026-08-11

### Added

- `adr explain --json` reports `markers.scannedBytes` and `markers.fileBytes`
  alongside the existing `windowBytes` and `truncated` (#108). `truncated` says
  bytes were left unscanned but not how many, and the window constant does not
  answer that either: the scan stops at the last complete line inside the window,
  so `min(fileBytes, windowBytes)` is not the extent. Measured over all 144
  tracked `.ts` files under `packages/<pkg>/src/**` and
  `packages/adapters/<pkg>/src/**` at canonical LF content, 29 exceed the
  window and their extents land 1–77 bytes short of it — and arbitrarily further
  when one line spans the boundary, down to `0` for a window with no terminator at
  all. `fileBytes - scannedBytes` is now the size of the unscanned remainder,
  which is the number a per-file policy is written against:
  `packages/cli/src/evaluate.ts` and `packages/cli/src/evaluate-snapshot.ts` both
  report `truncated: true`, but the first left 141 bytes unread and the second
  18825. This does **not** distinguish "a marker may lie past the window" from
  "every marker is in the header" — nothing can, short of reading further — and
  `truncated: false` licensed `declared: []` as a complete search before this
  change and still does. Both new fields are omitted for a state that never opened
  the file (`absent`, `unreadable`, `out-of-tree`), because `0` is itself a real
  extent and cannot also mean "not measured" — the "found none" vs "could not
  look" distinction ADR-0021 and ADR-0022 built the scan states for. Purely
  additive and no existing field changed meaning, though the two keys are inserted
  between `windowBytes` and `truncated`, so a consumer golden-diffing the
  `markers` block sees a positional change rather than an append; `check --json` is
  untouched and stays byte-identical. `@adrkit/core`'s exported
  `SourceMarkerScan` gains the same two optional fields. Note when differencing
  them: `scannedBytes` is the prefix handed to the scanner, not the bytes pulled
  from the handle (which include a truncation probe byte and a discarded partial
  line), and `fileBytes` comes from an `fstat` taken before the read loop — so a
  file written concurrently can make `fileBytes - scannedBytes` negative. The two
  are left unreconciled deliberately, because agreeing them would hide a file that
  changed underneath the scan; clamp the difference at `0`. Recorded as
  [ADR-0024](docs/adr/0024-report-the-measured-scan-extent-not-the-window-constant.md).

- **One new `@adrkit/core` runtime export**, pinned by the package surface test:
  `compareByDisplayPath(a, b, cwd)`, the code-unit comparison of two paths by
  their normalized display form. It is the composition of the already-public
  `compareCodeUnits` and `normalizeDisplayPath`, and it exists so the corpus
  orderings settle their locale-independence in one place instead of repeating
  the compound expression at each call site. Additive — nothing was removed or
  renamed.

### Changed

- Human output no longer prints the header-window constant where it is not the
  number it describes (#108). `adr explain`'s note reads "only the first \<extent>
  of \<size> bytes of \<path> were scanned" instead of restating 8192, and
  `adr check`'s per-path warning now reads "marker scan truncated (bytes scanned
  of total): \<path> \<extent>/\<size>" instead of "truncated after 8192 bytes".
  Not one of this repository's 29 over-window source files stops at 8192, and the
  gap is not cosmetic: a file whose header is one 12-byte marker line followed by
  8192 bytes of content was reported as stopping at 8192 when it stopped at 13.
  `adr explain --help` is corrected the same way. `check --json` is unchanged and
  stays byte-identical — `runCheck` already holds the batch scan, so the human
  renderer could report the measurement without `MarkerScanReport` carrying it
  (ADR-0024 action item 3). `adr check`'s human stdout is not a stability
  contract; consumers that need the truncated-path list should read `--json`.

### Fixed

- Some of the `check --json` determinism-contract sorts now order by code unit
  rather than `localeCompare` (#115): `CheckOutcome.changedFiles` (which also
  decides `changedRecords`), the shared `sortFindings` tuple that orders every
  findings array, the Action's `changedFiles` / `markerFiles` /
  changed-dependency lists, corpus discovery in
  `packages/core/src/load/corpus.ts` (`discoverAdrFiles`,
  `discoverSkippedMarkdownFiles`, `expandRecordInputs`), and `lintCorpus`'s own
  `scannedDirectories` and `records` sorts in
  `packages/core/src/validate/index.ts`. Identical inputs now serialize to
  identical bytes regardless of the runtime's ICU locale for those surfaces —
  but the contract is **not** fully closed. One tree still reaches
  `CheckOutcome` through `localeCompare` and remains recorded on #115: the three
  sorts under `packages/core/src/affects/**`, pinned byte-identical by feature
  010's FR-004 guard until a separately-authorized unfreeze. The ordering guard
  now scans whole directories rather than a file allowlist, so a new module on
  the scanned path is covered the day it lands; `affects/**` stays excluded, and
  its header explains why.

  The `load/corpus.ts` half of this was live, not theoretical. Under a
  duplicate-id corpus, `discoverAdrFiles`'s locale-dependent discovery order
  survived into `lintCorpus`'s `records` (the `frontmatter.id` tiebreak is a
  no-op for equal ids over a stable sort), and `checkChanges` picked whichever
  duplicate landed later as the id's canonical record — so `governing` /
  `activeProposals` / `governedBy` could differ by runtime for byte-identical
  inputs while `ok` and `findings` stayed the same. A regression test pins the
  duplicate-id case order-invariant and was observed failing against the
  `localeCompare` implementation (ADR-0016).

  The `validate/index.ts` sorts are a narrower fix. For *distinct* ids
  `records` order does not reach `CheckOutcome` — `resolveAffects` re-sorts its
  matches totally by `recordId`, so the frozen `affects/**` sort, not this one,
  decides `governedBy` order; and for *equal* ids the comparison is a no-op that
  simply carries discovery order through. What changes is
  `LintCorpusResult.records`, a public `@adrkit/core` surface a caller can
  observe directly, which mixed-case ULID ids could previously order by locale.

  Because `records` was already reordered downstream, note that a clean run of
  the ordering guard means "no scanned module reaches for `localeCompare`" — not
  "`check --json` is locale-independent end to end". That stronger statement
  holds only once #115's `affects/**` remainder lands.

## [0.5.0] - 2026-08-10

### Added

- `adr check` and the governing-decisions Action now resolve inbound `@adr`
  markers from changed files. Reads are hoisted outside pure `checkChanges`, bounded
  to 3,000 normalized paths — GitHub's own changed-file ceiling, so every diff the
  Action evaluates is scanned completely — at 16 concurrent reads, and reported through a
  deterministic `markerScan` result so absent, truncated, and skipped files are never silent.
  Marker-derived edges render as `declared by` and never influence exit status.

  This answers the separate decision ADR-0021 left open rather than revising it.
  [ADR-0022](docs/adr/0022-scan-inbound-markers-in-check-and-ci-without-giving-them-exit-code-authority.md)
  supersedes ADR-0021, whose argument stands unedited as the record of the
  explain-only scope shipped in v0.4.0; only its `status` and `supersededBy`
  moved when ADR-0022 was ratified.

- **Three new `@adrkit/core` runtime exports**, pinned by the package surface
  test: `readSourceMarkersBatch`, the impure batch boundary callers use to
  pre-scan before the pure `checkChanges`; and `MARKER_SCAN_FILE_CAP` /
  `MARKER_SCAN_CONCURRENCY`, the bounds it enforces. Additive — nothing was
  removed or renamed.

- **`{/*` is accepted as a comment introducer.** MDX rejects `<!-- -->`, so the
  markdown introducer rule under *Fixed* below would otherwise leave that dialect
  unable to declare at all. This also closes one of the two false negatives
  ADR-0021 recorded: a JSX expression comment now declares in `.tsx` as well.

### Changed

- **`scanSourceMarkers(source, path)` now depends on `path`.** Its extension
  selects the introducer set, so two files with identical bytes and different
  extensions can scan differently. The function remains pure and filesystem-free.

### Fixed

- Marker scanning no longer resolves a path through `realpath`, which rewrites a
  backslash *inside* a POSIX filename into a separator: `src/we\ird.ts` opened
  `src/we/ird.ts` and reported that file's markers, as `scanned` rather than
  `absent`. Containment is now derived from the already-verified symlink-free
  components. `adr check` also stays quiet about the marker scan when there was no
  path to scan.
- The Action now scans only current/head-side filenames for markers while retaining
  both sides of a rename for `affects` matching. Previous rename paths can no longer
  consume the 3,000-file scan budget and cause a current file's marker-only
  governance to be skipped.
- The Action no longer hands deleted files to the marker scanner. A `removed` path
  is guaranteed absent in the checkout, so it consumed a scan slot only to report
  `absent` — the one signal that would otherwise tell an operator the checkout does
  not match the pull request head.
- Marker path selection and every `markerScan` path list now sort by code unit
  rather than `localeCompare`, whose order depends on the runtime's ICU locale.
  The sort decides which paths survive the 3,000-file cap and which ten appear in
  the `marker-scan-capped` warning, so two environments could disagree on both
  while `CheckOutcome` promises identical inputs produce identical output.

- **A fenced documentation example no longer declares the decision it
  illustrates.** `@adr` markers are now skipped inside ` ``` ` and `~~~` fenced
  blocks. Three files in this repository — `packages/cli/README.md`,
  `docs/adr/0021-*.md`, and `site/src/content/docs/commands.mdx` — documented the
  marker syntax and were read as *using* it, so `adr explain packages/cli/README.md`
  reported ADR-0012 as an `accepted` decision governing the CLI README. Fence
  tracking is CommonMark-lite and still line-lead only: a closer must be at least
  as long as its opener and carry nothing else, backtick and tilde fences do not
  close each other, and an unclosed fence runs to the end of the scanned window
  ([#101](https://github.com/mbeacom/adrkit/issues/101),
  [ADR-0023](docs/adr/0023-read-a-marker-only-where-the-format-hides-it-fences-and-markdown-prose.md)).

- **A markdown heading or list bullet no longer declares.** In `.md`, `.mdx`, and
  `.markdown` the introducers are now `<!--` and `{/*` only. `#` opens a heading
  and `*` opens a list item in markdown — both render, so `* @adr 0012 explains
  this` was a visible sentence claiming a decision governs the file. The other
  introducers are source-language comment syntax and are ignored in markdown.

### Security

- Marker scanning now rejects every symlink before resolving its target, closing the
  existence/permission oracle that would otherwise become available to fork PRs.
- The governing-decisions comment renders every path, rule, field, and matcher through
  a code span the value cannot escape. A filename may legally hold a backtick, and
  `` src/x`[Approved](https://evil.example)`y.ts `` closed the span early and rendered a
  live link inside a comment authored by github-actions[bot]. Control characters are
  escaped too, since a newline in a filename ends the bullet however the span is fenced.
  The flaw predates inbound markers — it reached any changed ADR record path — but
  markers widened it to every changed source path.
- The governing-decisions comment bounds the declarations rendered per decision and
  the body as a whole. One 8 KB header window holds ~630 marker lines, which produced
  a 70,585-character body; GitHub rejects anything over 65,536 with a `422`, and that
  is not a permission error, so pull-request-authored marker content could fail the
  job it is documented as never being able to affect.
- Blocking finding paths and rules now remain visible when an authored finding message
  is larger than the comment budget; optional field/message detail is bounded before
  the whole-line limiter runs. Code-span fence sizing also scans backtick runs
  iteratively instead of spreading an unbounded matcher into `Math.max`, which could
  throw a Node `RangeError` and fail the Action before truncation.

## [0.4.0] - 2026-08-08

### Added

- **Inbound `@adr <id>` source markers, resolved without a schema change.** A file
  can now declare the decision it lives under by writing `@adr 0012` on a dedicated
  comment line in its first 8192 bytes, and `adr explain <path>` reports that record
  as governing the file alongside the `affects` patterns that already matched it.
  Until now a decision reached a file in exactly one direction — the record declared
  `affects` patterns and `resolveAffects` matched repo-relative paths against them,
  with no way for a file to point back
  ([ADR-0021](docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md)).
  `AdrFrontmatter`, `AffectsType`, and `schema/adr.schema.json` are unchanged, and
  no runtime dependency is added.

  Contributed by [@aballiet](https://github.com/aballiet) in
  [#97](https://github.com/mbeacom/adrkit/pull/97), from
  [#95](https://github.com/mbeacom/adrkit/issues/95) — the first community feature
  this project has shipped.

  **The asymmetry is deliberate: markers reach `adr explain` and nothing else.**
  `adr check`, `checkChanges`, the CI Action, and the Spec Kit context script do not
  scan them, so no CI semantics move and `packages/ci/dist` is byte-identical to
  v0.3.0. `declaredBy` lands on an explain-only `ExplainedDecision` rather than the
  shared `GoverningDecision`, so `adr check --json` output is unchanged. Extending
  enforcement to those surfaces is a separate decision, because it changes CI
  semantics and moves the filesystem boundary.

  A marker is a *claim*, so both ways it could lie are closed and tested. The
  scanner requires a **dedicated comment line** — an introducer begins the physical
  line and `@adr` is the comment's first content — because prose that merely
  discusses a decision, a string literal containing one, and a trailing
  `} // @adr 0012` must not make an accepted record binding; across this repository
  that rule finds 4 marker-looking lines where a looser first draft found 51.
  **Truncation uses the byte count the read observed** rather than re-deriving it
  from decoded text: `TextDecoder` may drop a BOM or expand invalid bytes, so a
  re-derived window can sever a reference mid-token, report a record the file never
  named, and still claim `truncated: false`. The read is confined to one regular
  file beneath the working tree, checked lexically before any I/O and again on the
  real path.

  **Landed** on [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  rung 1 — unit, contract, and purity coverage, plus maintainer verification against
  the branch. No reference-repository run yet (rung 2 open); not externally
  validated (rung 3 open).

- The release pipeline now supports **independently versioned, dist-less
  packages**. `scripts/release-pack.ts` previously asserted that every release
  package shared one version and shipped a `dist` — both true of a single
  lockstep Node surface, neither true of an adapter, and forcing them would have
  contradicted ADR-0007's "adapters ... are versioned independently. Their
  semver contract is with their upstream, not with our core." Definitions now
  declare `versioning: 'lockstep' | 'independent'` and `shipsNodeArtifact`, and a
  package that ships no Node artifact is *rejected* for publishing `dist`.
  Workspace dependencies also now resolve against the dependency's own version
  rather than the depender's.

- **Adapter releases.** Independently versioned packages now release on their own
  tag (`spec-kit-v0.1.0`) rather than riding a lockstep release. Without this,
  shipping an adapter fix would mean republishing core, evaluator, CLI, and MCP
  under a new version despite no change to any of them — which would make
  ADR-0007's "versioned independently" true of the number and false of everything
  that matters. `release-pack` gains `--only`, the release manifest carries its
  own `tag`, and the workflow derives scope from the tag: installed-tarball
  smoke and the `packages/ci/queue@v0` Action tag are lockstep-only. An adapter
  release also attaches a catalog `.zip` asset, derived from the packed tarball
  so the npm and catalog artifacts cannot disagree.

### Changed

- ADR-0007's `core-has-no-adapter-deps` assertion is no longer vacuous. It had
  nothing to guard while `packages/adapters/` was empty; with the first adapter
  present it has been observed failing against a deliberately introduced
  `@adrkit/core → @adrkit/spec-kit` dependency.

### Security

- `BOOTSTRAP_PACKAGES` is empty again. `@adrkit/spec-kit` needed a credential for
  its first publish because npm Trusted Publishing cannot be configured for a
  name that does not exist yet; with the name established and Trusted Publishing
  on, it publishes over OIDC and the `NPM_BOOTSTRAP_TOKEN` secret can be deleted.
  A test asserts no package receives the credential, and was observed failing
  against a name left in the set.

### Documentation

- **adrkit.dev documents the Spec Kit extension.** It had shipped, been released
  three times, and existed nowhere on the site — no page, no sidebar entry, and
  absent from the homepage's own list of published packages. A new
  [Spec Kit extension](https://adrkit.dev/spec-kit/) guide joins "Use in CI" and
  "MCP setup", covering the three commands, the optional hook and why `draft` is
  unreachable from it, the environment-variable configuration, the tested
  guarantees, and the honest ADR-0014 rung-2 status.

- Stale versions swept out of the docs. The homepage hero still advertised
  v0.2.1 two releases after v0.3.0 shipped; the roadmap still said "shipped in
  v0.2.0"; the `queue@v0` pinning note explained the tag as of the v0.2.1
  release though it has since moved to the v0.3.0 commit; and the bug-report
  template suggested `0.2.0` as the version to report and offered no
  `@adrkit/spec-kit` surface to file against.

- `MANIFEST.md` is an inventory again rather than a seed-bundle snapshot. It had
  not been touched since ADR-0013 and still claimed "13 records, ids 0001–0013"
  with statuses six records out of date, no `packages/` tree, and a "not
  included — add at repo creation" list of files that have existed for months.

- `CLAUDE.md` documents `packages/adapters/spec-kit`, including the constraints
  that have already been broken once each: the two version fields that must
  agree, the independent release tag, and the no-dependencies/no-`dist` rule.

## [spec-kit-0.1.2] - 2026-08-03

### Fixed

- `@adrkit/spec-kit` **0.1.2** reports its own version correctly. 0.1.1 shipped
  with `extension.yml` still saying `0.1.0`, so `specify extension info` and
  `specify extension list` told every user they had 0.1.0. Two version fields —
  `package.json` for npm, `extension.yml` for Spec Kit — with nothing keeping
  them in sync. A test now asserts they match, and was observed failing against
  the exact 0.1.1 state.

## [spec-kit-0.1.1] - 2026-08-03

### Fixed

- `@adrkit/spec-kit` **0.1.1** ships `LICENSE` and `NOTICE`. 0.1.0 did not: every
  sibling package copies them into `dist` at build time, and this package has no
  build, so nothing carried them. The files are committed rather than generated
  because the extension has three install paths — npm, the catalog zip, and
  `specify extension add --dev` from a checkout — and a generated file would be
  absent from the last one. A test asserts they stay byte-identical to the root
  copies, and that `.extensionignore` never excludes them.

## [spec-kit-0.1.0] - 2026-08-03

### Added

- **`@adrkit/spec-kit` — the Spec Kit extension** (`packages/adapters/spec-kit/`),
  the first package under `packages/adapters/*` and the second distribution
  surface [ADR-0003](docs/adr/0003-ship-as-spec-kit-extension.md) commits to. It
  adds three namespaced commands to a [Spec Kit](https://github.com/github/spec-kit)
  project — `/speckit.adrkit.context` (pull the governing decisions into agent
  context before planning), `/speckit.adrkit.check` (check a produced plan against
  them, routing through the deterministic evaluator when a snapshot bundle is
  configured), and `/speckit.adrkit.draft` (scaffold a draft ADR from the plan
  artifact) — plus one **optional** `after_plan` hook that offers to run the check.
  Pinned to Spec Kit `>=0.13.0,<0.16.0`, verified by installing and rendering
  against 0.13.0, 0.14.4, and 0.15.1. Distributed on **npm** and via the **Spec
  Kit community catalog**; the manifest declares `category: process` and
  `effect: read-write` for `specify extension info` and the catalog.

  Hooks can only reach commands that do not write: `draft` is the sole writing
  command and is unreachable from any hook, because a plan-phase hook creating
  records unprompted would manufacture decision memory rather than record it. That
  boundary, the never-mandatory hook, the honest-failure contract, and `check`'s
  zero-mutation guarantee are enforced by tests, each observed failing under a
  deliberately introduced defect before being trusted
  ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

  **Landed / reference-verified** on [ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  rungs 1–2. Rung 2 is a maintainer-owned isolated reference repository that
  reinstalls the extension from a pinned adrkit commit into a real Spec Kit
  project across all three declared upstream versions, on every push and weekly —
  41 self-verifying, fail-closed assertions each. The gate was observed failing
  on a deliberate divergence run before being trusted. Evidence index:
  [`docs/reference-verification-spec-kit-extension.md`](docs/reference-verification-spec-kit-extension.md).
  Not externally validated (rung 3 open).

  Authorized by [ADR-0019](docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md),
  which records the `no-go` verdict from spike
  [008](specs/008-spec-kit-hook-viability/) as a measurement artifact of that
  spike's own verdict procedure — a byte-identical `git status` bar applied to
  `install` and `remove`, lifecycle actions whose entire purpose is to write files
  — rather than a finding against the mechanism, which the spike verified working
  in every respect. Spike 008's verdict, evidence bundle, and audit history are
  unmodified.

### Fixed

Two packaging defects that only surfaced by installing the extension for real,
against live Spec Kit, rather than reasoning about it:

- `specify extension add --dev` copies the extension directory verbatim and does
  **not** skip `node_modules`. Bun's isolated linker had created one for a single
  `@types/bun` devDependency, and the workspace symlink inside it aborted the
  install partway through with a `shutil.Error`, leaving a half-installed
  extension. `@adrkit/spec-kit` now declares no dependencies at all; types
  resolve from the root tsconfig.
- The install was depositing the extension's own test suite and `tsconfig.json`
  into the consuming project's `.specify/extensions/adrkit/`. Now excluded via
  `.extensionignore`, which upstream supports across the whole pinned range.

## [0.3.0] - 2026-07-31

### Added

- `@adrkit/mcp` now serves **MCP protocol revision `2026-07-28`** alongside the
  2025-era revision on the same stdio connection. The opening exchange selects the
  era and pins it for the connection's lifetime: a `server/discover` call (or any
  request carrying a 2026 `_meta` envelope) gets the stateless 2026 revision, while
  an `initialize` handshake is served exactly as before. Tool names, schemas,
  annotations, and structured results are identical on both eras, and 2025-era
  responses are unchanged from 0.2.1 apart from `tools/list` ordering (see below).
- `tools/list` and `server/discover` are served with SEP-2549 cache fields
  (`ttlMs: 300000`, `cacheScope: "public"`) on the 2026 revision. The four-tool
  surface is immutable for the life of the process and carries no corpus content or
  caller identity, so a client can reuse it instead of re-listing. Corpus reads stay
  uncacheable — every `tools/call` still loads a fresh projection.

### Changed

- Migrated `@adrkit/mcp` from `@modelcontextprotocol/sdk@1.29.0` to the MCP
  TypeScript SDK v2 package split: `@modelcontextprotocol/server@2.0.0` in
  production and `@modelcontextprotocol/client@2.0.0` as a development-only test
  driver. `zod` tightened to `^4.2.0` — v2 converts schemas through the authoring
  instance's `~standard.jsonSchema`, which zod added in 4.2.0. On zod 4.0–4.1 the
  SDK falls back to its own bundled converter with a one-time stderr warning and
  silently drops `.describe()` field descriptions from the advertised JSON Schema,
  so the declared range excludes those versions rather than relying on the resolved
  version happening to be new enough.
- Tool `outputSchema`s are now explicit `z.object(...)` schemas rather than raw Zod
  shapes (v2 deprecates the raw-shape overloads). The advertised JSON Schema is
  unchanged: still a root object of `corpusHealth` + `result`.
- `tools/list` advertises the four tools in lexicographic order, so the catalog is
  deterministic across restarts (`2026-07-28` minor change 3). This is the one
  2025-era wire change in this release: the SDK serves registration order on both
  eras, so legacy clients see the new order too. MCP treats `tools` as an unordered
  set, so no client behavior depends on it; the order is asserted unsorted on both
  eras so it cannot drift unobserved.

### Removed

- The root `@hono/node-server` and `fast-uri` `overrides`, and the recorded
  `@adrkit/mcp` consumer-advisory acceptance for
  [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9). All
  three are now dead: `@modelcontextprotocol/server@2.0.0` depends only on
  `@modelcontextprotocol/core` and `zod`, so the SDK no longer drags Hono, Express,
  Ajv, `cors`, or `zod-to-json-schema` into the tree, and neither `@hono/node-server`
  nor `fast-uri` resolves anywhere in it. The advisory retired by its own recorded
  `resolvesWhen` clause ("...or adrkit removes that transitive path"), ahead of its
  `2026-10-31` expiry. `bun audit` is clean with no overrides in effect.

### Fixed

- The `adrkit-mcp` binary no longer fails silently when its stdio transport
  breaks. `serveStdio` reports transport failures only through its `onerror`
  callback — it consumes the rejected `start()` promise itself — so a client that
  went away mid-session tore the connection down while the process still exited
  `0`, a dead server reporting success. `createAdrkitMcpServer` now takes an
  `onError` option (defaulting to a stderr diagnostic) and the binary wires it to
  a stderr diagnostic plus a non-zero exit. stdout remains protocol-only.

## [0.2.1] - 2026-07-27

### Added

- `adr queue` — emit the ARB operations queue, a read-only, deterministic
  projection of the corpus's `review` metadata (tiers, SLA state, approvals,
  objections) as Markdown or `QueueReport` v1 JSON. The pure `buildQueueReport`
  kernel and formatters live in `@adrkit/core` (Phase 6).
- Managed-issue queue GitHub Action (`packages/ci/queue`) that creates or updates
  a single dedicated issue carrying the deterministic queue report, using only the
  default `GITHUB_TOKEN` with `issues: write`. Landed and maintainer
  reference-verified; external validation is tracked as open
  ([ADR-0014](docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)).
- MCP registry distribution metadata: `@adrkit/mcp` declares
  `mcpName: dev.adrkit/mcp`, `packages/mcp/server.json` points at the 0.2.1 npm
  package, and the repository includes Smithery and Glama manifests plus a
  distribution playbook.

### Changed

- Hardened CI and release posture: every GitHub Action reference is pinned to a
  full commit SHA, checkout credentials are not persisted into the worktree, and
  the release job injects its push credential only for the moving major Action tag
  update.
- Added a fail-closed `bun audit` gate that treats malformed audit output,
  unexpected schema shapes, unknown arguments, and any advisory as CI failures.
  The gate states its scope in its own output — it examines this workspace's
  resolved tree after root overrides, not consumer installs of the published
  `@adrkit/*` manifests — and records known out-of-scope consumer exposures with
  an expiry instead of hiding them
  ([ADR-0017](docs/adr/0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)).
- Refreshed public README/site/package docs so Node-targeted `npx`/`npm` install
  paths are first-class while Bun remains the repository development toolchain.

### Fixed

- `adr --help`, `adr help`, and `adr --version` now work and exit successfully.
- `adr check`, `adr explain`, and the governing-decisions CI Action no longer
  report `rejected`, `superseded`, or `deprecated` ADRs as governing active code;
  their output now includes status where it affects interpretation.
- `adr migrate --from madr` preserves more legacy MADR/Nygard status and decider
  forms, including MADR 2.x `* Deciders:` header bullets, and avoids creating
  records that adrkit discovery cannot see.
- `adr queue` reports skipped or undiscoverable ADR files instead of silently
  omitting them from the operations queue.
- `adr lint`, `adr graph`, `adr explain`, `adr check`, `adr migrate`, and
  `adr evaluate` now classify an unreachable `--dir` as a usage error — exit `2`
  with `Corpus directory not found: '<dir>'` — instead of leaking a raw `ENOENT`
  at exit `1`. This matches `adr queue` and the documented exit-code contract.
- `adr lint` now rejects an `accepted` record whose `provenance.authoredBy` is
  `agent-drafted` and that names no `provenance.ratifiedBy`. The ratification
  gate previously checked only `agent`, so a machine-drafted decision could reach
  `accepted` with no named human ratifier.
- The MCP server reports a runtime `SERVER_INFO.version` matching the published
  package version.

### Security

- Bumped `sharp` to `^0.35.0` in the docs site to patch
  [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj).
- Added root overrides for vulnerable transitive releases of `fast-uri` and
  `@hono/node-server`, yielding a clean root `bun audit` before release.
- Known, unfixed in this release: a consumer installing `@adrkit/mcp` still
  resolves a vulnerable `@hono/node-server`
  ([GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9)).
  The root override is not published in the package manifest, and
  `@modelcontextprotocol/sdk@1.29.0` pins `@hono/node-server` to `^1.19.9`,
  which cannot resolve the patched `>=2.0.5`. Impact is limited — the advisory is
  a Windows `serve-static` path traversal, and the stdio server neither uses Hono
  `serve-static` nor serves HTTP static files — and it resolves when the SDK
  widens that range. Recorded with a `2026-10-31` expiry after which CI fails
  closed
  ([ADR-0017](docs/adr/0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)).

## [0.2.0] - 2026-07-20

### Added

- `@adrkit/mcp` — a local, read-only Model Context Protocol server exposing
  decision retrieval over stdio with exactly four tools (`search_decisions`,
  `get_decision`, `get_decision_context`, `list_superseded`). No writes, no
  network, no model calls; the graveyard is included by default. Passed
  real-session validation through the official MCP Inspector (Phase 5).

## [0.1.0] - 2026-07-20

### Added

- Typed ADR schema as a strict MADR superset, and the `@adrkit/core` library
  (Phase 0).
- `affects` resolution as a pure function, and `adr explain <path>` to report
  which decisions govern a file (Phase 1).
- `adr migrate --from madr` — in-place, additive, non-destructive MADR migration,
  reading status/date/deciders from MADR 3.x frontmatter, MADR 2.x `* Status:`
  bullets, and Nygard `## Status` sections (Phase 2).
- `adr lint`, `adr new`, and `adr graph` in the `@adrkit/cli` binary.
- Astro Starlight documentation site on GitHub Pages, hosting the canonical JSON
  Schema at its `$id`
  ([ADR-0011](docs/adr/0011-host-the-canonical-json-schema-at-its-id-on-adrkit-dev.md)).
- `adr check` and the governing-decisions CI Action (`packages/ci`) that comments
  the decisions governing a PR's changed files (Phase 3).
- The deterministic, model-free Pass 0 evaluator (`@adrkit/evaluator`) and
  `adr evaluate`, applying the eleven-rule rubric over an offline snapshot bundle
  and routing without ever approving.
- Node-targeted published distribution of all packages, smoke-tested under Node
  22 and 24.

[Unreleased]: https://github.com/mbeacom/adrkit/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/mbeacom/adrkit/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/mbeacom/adrkit/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/mbeacom/adrkit/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/mbeacom/adrkit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/mbeacom/adrkit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/mbeacom/adrkit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/mbeacom/adrkit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mbeacom/adrkit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mbeacom/adrkit/compare/v0.3.0...v0.4.0
[spec-kit-0.1.3]: https://github.com/mbeacom/adrkit/compare/spec-kit-v0.1.2...spec-kit-v0.1.3
[spec-kit-0.1.2]: https://github.com/mbeacom/adrkit/compare/spec-kit-v0.1.1...spec-kit-v0.1.2
[spec-kit-0.1.1]: https://github.com/mbeacom/adrkit/compare/spec-kit-v0.1.0...spec-kit-v0.1.1
[spec-kit-0.1.0]: https://github.com/mbeacom/adrkit/releases/tag/spec-kit-v0.1.0
[0.3.0]: https://github.com/mbeacom/adrkit/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mbeacom/adrkit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mbeacom/adrkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbeacom/adrkit/releases/tag/v0.1.0
