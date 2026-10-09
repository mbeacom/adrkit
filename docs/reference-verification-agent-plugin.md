# Agent plugin — host verification evidence index

**Purpose**: The tracked, sanitized evidence index for the `adrkit` agent plugin
(`packages/adapters/agent-plugin`). It records what was actually run against the
installed agent hosts, what those runs produced, and — as plainly as possible —
what they do **not** establish.

This is **rung-1 evidence with functional confirmation**, not rung-2 reference
verification and not rung-3 external validation. The distinction matters and is
stated here rather than left for a reader to infer:

- The consumer repository below is **ephemeral and local**, created and destroyed
  inside a single maintainer session. It is not the maintainer-owned, persistent,
  CI-attached reference repository that
  [`reference-verification-spec-kit-extension.md`](./reference-verification-spec-kit-extension.md)
  documents for `@adrkit/spec-kit`. There are no immutable refs and no run links
  to cite, because there was no CI run.
- The runs recorded here are not reproducible from immutable evidence. They
  installed the plugin from a local marketplace pointing at a worktree path,
  before [PR #157](https://github.com/mbeacom/adrkit/pull/157) merged and made
  the plugin public through the repository's live `main` marketplace channel.
  That later publication does not retroactively add immutable refs or CI run
  links to these measurements.

Plugin maturity per the [ADR-0014](./adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary: **implemented** and **released** through the live `main` marketplace
channel. Release is separate from the evidence ladder: this remains **rung 1**,
not `reference-verified`, not `landed`, and not `externally validated`.

**Created**: 2026-08-16
**Decision**: [ADR-0028](./adr/0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md)

## Tool versions / environment

| Component | Version |
|---|---|
| GitHub Copilot CLI | 1.0.80 |
| Claude Code | `claude plugin validate` (local install) |
| Agent Package Manager | 0.28.0 (`e041462`) |
| opencode | installed; exercised via APM's opencode target, not driven directly |
| `@adrkit/cli` | 0.8.0, installed as a **dev dependency** in the consumer repo |
| Plugin under test | `adrkit` 0.1.0 |
| Platform | macOS (arm64) |

## Consumer repository (ephemeral, local)

A fresh git repository outside the adrkit worktree, seeded with a four-record
corpus chosen so that each retrieval path has a distinguishable correct answer:

| Record | Status | `affects` | Why it is there |
|---|---|---|---|
| `0001` Adopt PostgreSQL | `accepted` | `src/db/**` | The binding case. `src/db/pool.ts` also carries an inbound `// @adr 0001` marker on line 1. |
| `0002` PgBouncer pooling | `proposed` | `src/db/**` | The in-flight case, with an overdue `reviewBy`, so the queue has a non-empty SLA state. |
| `0003` Payment state in Redis | `rejected` | `src/payments/**` | The graveyard case — the one a plan can re-propose without conflicting with anything binding. |
| `0004` Redis as non-authoritative cache | `proposed` | `src/payments/**` | Not seeded. **Written by the plugin** during the `/adr-draft` run below. |

Baseline, established with the CLI directly before the plugin was involved:

- `adr explain src/db/pool.ts` → governed by `0001`, marker resolved at
  `src/db/pool.ts:1`, `0002` reported as an active proposal.
- `adr check src/payments/api.ts` → 0 governing, 1 historical (`0003`), exit `0`.
- `adr queue` → one item, `0002`, SLA state `overdue`.
- `adr lint` → 3 records, 0 errors, 0 warnings.

## Static host validation

| Host | Command | Observed |
|---|---|---|
| Claude Code | `claude plugin validate packages/adapters/agent-plugin` | PASS |
| Claude Code | `claude plugin validate .claude-plugin/marketplace.json` | PASS |
| APM | `apm install --target claude` | 1 agent, 4 commands, 1 skill integrated; no warnings |
| APM | `apm install --target copilot` | 4 prompts, 1 agent, 1 skill integrated; no warnings |
| APM | `apm install --target opencode` | 1 agent, 4 commands, 1 skill integrated; no warnings |
| Copilot CLI | `plugin marketplace add` + `plugin install adrkit@adrkit` | installed; skill, agent, and all four commands present in a fresh session |

Three of these passed only after fixing defects they exposed; see
**Defects found by these runs** below.

## Functional runs (Copilot CLI, consumer repo)

Each run is a fresh non-interactive session in the consumer repository.

| # | Invocation | Expected | Observed |
|---|---|---|---|
| 1 | `/adr-context src/db/pool.ts` | `0001` binding, `0002` in flight, marker cited, groups kept distinct | Matched. Cited `src/db/pool.ts:1` for the marker and named `adr explain` as its source. |
| 2 | `/adr-check src/payments/api.ts` with a plan to move payment state to Redis | Surfaces `0003` as `re-proposes-rejected` rather than reporting "nothing governs this"; does not write | Matched. Returned `re-proposes-rejected`, quoted the rejection rationale with line numbers, distinguished it from a binding conflict, offered comply-or-supersede, and **stopped without writing**. |
| 3 | `/adr-draft "Use Redis as a non-authoritative cache…"` | Exactly one new record, `status: proposed`, with an `affects` matcher; corpus still lints | Matched. Corpus 3 → 4 records. New record carried `status: proposed`, `affects: src/payments/**`, `provenance.authoredBy: agent`, `relatesTo: ["0001","0003"]`. It declined to supersede `0003`, arguing the cache case is materially different from the rejected authoritative-store case. `adr lint` → 4 records, 0 errors. A follow-up `adr check src/payments/api.ts` then reported the new record as an active proposal, closing the loop. |
| 4 | `decision-checker` agent on "rewrite `src/db/pool.ts` to use MySQL" | Per-decision verdicts from the CLI, not from hand-read frontmatter | **Failed on first run** — see defects. Passed after the fix: resolved `./node_modules/.bin/adr` (v0.8.0) after `command -v adr` failed, ran `adr check --json`, `adr queue --format json`, and `adr graph --format json`, returned `departs` on `0001` and `unreconciled` on `0002`, and raised an unprompted caveat that `adr check` evaluates the file as it exists rather than the planned diff. |

## v0.2.0 backfill run (2026-08-26)

This is a new rung-1 functional observation for `/adr-backfill`, not a rewrite
of the v0.1.0 runs above.

### Static host and placement validation

| Host | Command | Observed |
|---|---|---|
| Claude Code | `claude plugin validate packages/adapters/agent-plugin` | PASS |
| Claude Code | `claude plugin validate .claude-plugin/marketplace.json` | PASS |
| Copilot CLI 1.0.80 | `copilot --plugin-dir packages/adapters/agent-plugin plugin list` | external plugin `adrkit` loaded |
| APM | isolated install to `claude,copilot,opencode` | 5 Copilot prompts, 1 agent per target, 5 commands in each command-based target, and 2 skills integrated; no component warning |

These were rerun after trust, path, budget, handoff, version, and retained
negative-fixture remediation. They establish schema/discovery/placement, not
functional behavior; the Copilot run below is the functional observation.

### Functional Copilot run

| Component | Value |
|---|---|
| Copilot CLI | 1.0.80, non-interactive, local plugin via `--plugin-dir` |
| Plugin | `adrkit` 0.2.0 working tree |
| CLI | trusted `$ADRKIT_CLI` wrapper outside the consumer worktree, reporting 0.10.0 |
| Consumer | fresh local git repository under the session artifact directory |
| Scope | 4 files, 944 bytes, 1 commit |
| Corpus | accepted PostgreSQL ADR for `src/db/**`; rejected RabbitMQ ADR for `src/jobs/**` |

The synthetic architecture corpus repeated the accepted PostgreSQL choice and
introduced an unrecorded affirmative NATS JetStream choice for `src/jobs/**`.
The run:

1. resolved the trusted CLI outside the target worktree and reported
   `ADR_DIR=docs/adr`;
2. preflighted the scope below every configured cap;
3. ran `lint`, `graph`, `queue`, and
   `check --dir docs/adr --json -- <paths...>`;
4. classified PostgreSQL as `covered`, retained RabbitMQ in `history`, and
   classified NATS JetStream as one `new` candidate;
5. emitted `BF-001` with `corpusDir`, one concrete `candidatePaths` file,
   schema-shaped `affects`, primary source, exact citations, missing evidence,
   alternatives, reconciliation, and a candidate-specific snapshot containing
   the full corpus fingerprint, `governing: []`, `activeProposals: []`, and
   `history: ["0002"]`; and
6. stated that no record was created or edited.

The before/after observations were identical:

```text
git status --porcelain: <empty>
tracked-file fingerprint:
b50e4f4624582064c1804f34ac3f4433f4c1c7fab3f741abb979c836b5b4f23b
ADR markdown count: 2
```

This establishes one Copilot path through candidate reconciliation and the
read-only boundary. It does **not** establish Claude Code or APM functional
behavior, hostile local-executable sandboxing, large-corpus behavior, a
persistent reference repository, or external validation.

The smoke was rerun after PR review tightened freshness and schema handling. The
final handoff used `candidatePaths: ["src/jobs/publisher.ts"]` (no glob), an
`affects` object with `type: path` and `pattern: "src/jobs/**"`, and the exact
`history` key. The before/after fingerprint and ADR count remained unchanged.

## Defects found by these runs

Every one of these was found by running a host, not by reading its
documentation. Each is now covered by a test that has been observed failing
against a deliberate violation
([ADR-0016](./adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

1. **`claude plugin validate` rejects the manifest shape Copilot CLI
   documents.** `agents`, `skills`, and `commands` as path strings produce
   `Invalid input`. Both hosts discover the conventional directories without
   them, so the manifest now declares none. `category` moved to the marketplace
   entry, where Claude Code's validator says it belongs.
2. **opencode rejects an agent whose `tools` is a list.** Reported by
   `apm install --target opencode`: it requires a name-to-boolean mapping, while
   Claude Code takes a comma-separated string and Copilot CLI an array. No
   portable value exists, so no component declares `tools`; the read-only
   contract lives in the agent body.
3. **`"//"` comment keys are unknown fields to Claude Code's validator.**
   Removed from both manifests.
4. **A plugin-shipped `.mcp.json` cannot work for this server on Copilot CLI.**
   Measured by configuring the server command to record its own `pwd` and
   environment: the spawn directory is neither the workspace nor any git
   repository, and the environment carries `PLUGIN_ROOT` / `COPILOT_PLUGIN_ROOT`
   but nothing naming the repository. The adrkit MCP server requires a git
   worktree root, so it exits during `initialize`, logging
   `Failed to start MCP client for adrkit` once per session. The file was
   removed rather than shipped broken. See ADR-0028.
5. **The subagent reported "no CLI available" when the CLI was installed.** Run 4,
   first attempt. `@adrkit/cli` is normally a dev dependency, so a bare `adr` is
   not on `PATH`; the agent tried only that, concluded no tooling existed, and
   fell back to reading ADR frontmatter by hand. It reached a defensible verdict
   on a four-record corpus, which is precisely why this is dangerous — the
   fallback cannot expand glob matchers, cannot read inbound `@adr` markers, and
   has no exit code, so it produces an answer that looks complete and is not.
   The skill and the agent now both state the resolution order
   (`$ADRKIT_CLI` → `./node_modules/.bin/adr` → `PATH`) and are required to
   label a result unverified if all three fail.

Two smaller measurements, recorded because they will otherwise be rediscovered:

- `copilot plugin install` prints only a skill count. "Installed 1 skill" does
  not mean the agent and commands were dropped; they load at session start.
- `npx -y @adrkit/mcp@^0.8.0` starts correctly in an ordinary consumer
  repository, and fails **inside the adrkit monorepo** with
  `sh: adrkit-mcp: command not found`. The
  `npx -y -p @adrkit/mcp@<range> adrkit-mcp` form was measured failing there
  too, so it is **not** a workaround — an earlier draft of this index and of the
  plugin README recommended it, on the strength of one run in a different
  directory, and that recommendation was wrong. The cause is that npx resolves
  `@adrkit/mcp` to the local workspace package and Bun's isolated linker does not
  create `node_modules/.bin/adrkit-mcp` for a workspace member. Inside the
  repository, `node packages/mcp/dist/bin.js` after `bun run build` completes an
  `initialize` handshake; that is the workspace-local invocation.

## Limitations (honest scope of this evidence)

- **Ephemeral, not a reference repository.** No persistent repo, no immutable
  refs, no CI run links, no re-run on a schedule. A regression would not be
  caught by anything here; only the in-repo unit and contract tests run in CI.
- **One host driven end to end.** Runs 1–4 are Copilot CLI only. Claude Code was
  validated statically and APM by integration output; neither had its commands
  or agent executed. opencode was never driven at all — its coverage is APM's
  placement plus the rejection warning it produced.
- **Installed from a local path.** At the time of these runs, the marketplace
  source was a worktree directory, not `mbeacom/adrkit`. PR #157 has since
  merged and the public source is live, but no post-merge rerun has been added
  to this evidence index. The public install flow in the README therefore
  remains **unverified end to end**.
- **Single-run observations.** Each functional row is one run of a
  non-deterministic agent. They demonstrate the components work; they do not
  establish a pass rate.
- **The MCP finding is one host, one version.** Copilot CLI 1.0.80 on macOS. It
  was not measured on Claude Code or Linux, and it may change — it is a host
  implementation detail, not a documented contract.
- **No adversarial testing.** Nothing probed a malformed corpus, a corpus with
  error-severity findings, a non-git directory, or a missing corpus, beyond the
  CLI's own unit coverage of those paths.

## Open, and owned by the maintainer

Two findings from the deep-review panel are deliberately **not** fixed here,
because they are release-policy decisions rather than defects:

- **Nothing in CI re-runs the host validators.** `bun test` covers the failure
  shapes already discovered; it cannot catch the next host schema constraint. A
  future manifest or component change that Claude Code's validator or opencode
  rejects will merge green and ship, because the repository is the live
  marketplace. `docs/RELEASING.md` now documents the commands to run by hand
  before merging a plugin change; wiring them into CI is the durable fix and
  needs a decision about adding host CLIs as CI dependencies.
- **The marketplace `source` is unpinned.** `.claude-plugin/marketplace.json`
  points at `./packages/adapters/agent-plugin` with no `ref` or `sha`, and the
  plugin cuts no tag, so an installer during an in-flight `main` state gets that
  state. Pinning to a cut ref, or protecting the directory behind a single
  reviewed release commit, are both real options with different costs.

## v0.3.0 bootstrap-record guidance (2026-09-08)

`decision-backfill` gained one section: a repository with no corpus, or one
whose corpus never recorded why it keeps decisions, is offered the process and
tooling decisions as an **offer rather than a candidate**, routed to plain
`/adr-draft` and excluded from every `backfillHandoff`. `decision-memory` gained
a matching clause on its no-corpus branch.

**This addition is contract- and static-host-validated only.** It has no
functional run of any kind — no Copilot synthetic-consumer exercise, no
reference repository, no external adopter.

| Check | Command | Observed |
|---|---|---|
| Contract | `bun test packages/adapters/agent-plugin/` | 40 pass, 0 fail |
| Claude Code | `claude plugin validate packages/adapters/agent-plugin` | PASS |
| Claude Code | `claude plugin validate .claude-plugin/marketplace.json` | PASS |

The new wiring test was observed failing before the guidance was written, per
[ADR-0016](./adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md).
It asserts the two properties that are easy to regress: the bootstrap record
stays out of the candidates table and out of every `backfillHandoff`, and
adopting adrkit carries a `relatesTo` edge to a process record while reserving
`supersedes` for a *prior tooling* record.

### Detection measured against synthetic corpora

The `governing`-bucket detection was exercised directly against throwaway
repositories rather than reasoned about, using a CLI built from this worktree
and reporting `0.13.0` (an earlier pass used a stale `0.5.0` dist and was
re-run):

| Corpus | `adr check --json` over a path | Exit | `governing` | Reading |
|---|---|---|---|---|
| `docs/adr/` absent | any changed file | `2` | — (usage error) | Nothing to detect; offer both decisions |
| `docs/adr/` present but empty | any changed file | `0` | `[]` | No process record; offer both decisions |
| Records binding `src/**` only | a record inside the corpus | `0` | `[]` | No process record; offer both decisions |
| Plus a record binding `docs/adr/**` | a record inside the corpus | `0` | `["0002"]` | Detected by matcher, not by id or title |
| Unmigrated MADR (no frontmatter fence) | a record inside the corpus | `1` | `[]` + `rule: frontmatter-fence` | **Trap** — a parse failure, not an absence |

Re-measured for **0.3.1**, after review found that reading `governing` alone and
trusting `adr check`'s exit code were both unsound. Same method, same throwaway
corpora, CLI built from the fix branch:

| Corpus | Probe | Exit | `governing` | `activeProposals` | `history` | Reading |
|---|---|---|---|---|---|---|
| Process record `status: proposed`, `affects: docs/adr/**` | that record | `0` | `[]` | `["0001"]` | `[]` | **Trap** — the record exists; `governing` alone reports absence |
| Process record `status: rejected`, same matcher | that record | `0` | `[]` | `[]` | `["0001"]` | **Trap** — settled against; re-proposing it is failure mode 3 |
| Malformed process record + healthy unrelated record | the *healthy* record | `0` | `[]` | `[]` | `[]` | **Trap** — findings come back *empty*; corpus-wide `adr lint` exits `1` |
| Same corpus | corpus-wide `adr lint` | `1` | — | — | — | The signal that actually catches it |
| No corpus at all | `adr lint --dir docs/adr` | `2` | — | — | — | `/adr-draft`'s old gate stopped here |
| No corpus at all | `adr new "<title>" --dir docs/adr` | `0` | — | — | — | Creates the directory, allocates `0001` |

The first three rows each ship an offer the repository did not need. The last two
are why `/adr-draft`'s exit-`2` gate was narrowed: `adr lint` and `adr new`
disagree about whether an absent corpus is an error, and `adr new` is right,
because `createAdr` creates the directory itself.

### Functional run of the offer's write path (0.3.1)

Detection above is measured against fixtures. This is the first exercise of the
**write path end to end**, in an ephemeral consumer repository — a fresh `git
init` with one source file and no `docs/adr/` — driving the CLI the way the
guidance tells an agent to:

| Step | Command | Result |
|---|---|---|
| 1 | `adr lint --dir docs/adr` | exit `2`, `Corpus directory not found` — the bootstrap case |
| 2 | `adr new "<title>" --dir docs/adr` | exit `0`, creates the directory, allocates `0001` |
| 3 | `adr lint --dir docs/adr` | exit `0` — the corpus is valid |
| 4 | `adr check --dir docs/adr --json -- docs/adr/0001-*.md` | exit `0`, **all three buckets empty** |
| 5 | same probe, after hand-adding `affects: [{type: path, pattern: "docs/adr/**"}]` | exit `0`, `activeProposals: ["0001"]` |

Steps 1–3 confirm the narrowed `/adr-draft` gate: the headline case is writable.

**Step 4 found a defect the static review did not.** `adr new` scaffolds
`affects: []` and `status: draft`. A record with no matcher binds nothing, so it
is invisible to detection no matter how many buckets are read — every bucket
comes back empty and the next audit offers the same decision again. The
three-bucket fix only engages once the record carries a matcher covering the
corpus directory, which step 5 demonstrates. ADR-0038 listed exactly this
outcome — "a consumer's bootstrap record lands with no rejected alternative and
no `affects` matcher" — under *how we would know this was wrong*, and it turned
out to be the default behavior of the path the offer prescribes. Both the skill
and the command now require the offer to state the matcher.

**Still unverified:** whether any host actually surfaces the offer in a real
session. That needs an interactive host run and remains open as action item 5.


The last row changed the guidance. An unmigrated MADR corpus returns exactly the
same empty `governing` bucket as a corpus with no process record, because none of
its records parse — including, in the fixture, the process record itself. Reading
the bucket without reading the exit code first would offer a duplicate of a record
the repository already has, which is the failure ADR-0038 names as proof the
design is wrong. The skill reads the exit code first and names the MADR case;
a wiring test covers both sentences, and was confirmed failing against the
pre-fix text.

Detection is therefore measured. What remains unverified is **host behavior**:
whether Claude Code, Copilot CLI, or opencode actually surface the offer when
backfill runs against an empty corpus. That needs a functional run in a real
host session and is tracked as an open action item on ADR-0038.

## v0.4.0 `adr-review` dynamic workflow (2026-10-08)

Measured on 2026-10-08 against GitHub Copilot CLI 1.0.92, at **rung 1** of
ADR-0014. The workflow is specified by
[ADR-0045](adr/0045-ship-an-advisory-adr-review-dynamic-workflow-in-the-portable-agent-plugin.md)
(proposed when measured; accepted 2026-10-08). Probes used throwaway plugins loaded with `--plugin-dir` and through
a local marketplace install; the workflow itself was then run end to end.

There is no stated minimum Copilot CLI version. The workflow was measured on
Copilot CLI 1.0.92; earlier versions are unmeasured, and a CLI that loads plugin
extensions but predates dynamic workflows may fail to load the extension.

### Platform measurements

| # | Probe | Result |
|---|-------|--------|
| 1 | `.claude-plugin/plugin.json` plugin with `extensions/<dir>/extension.mjs` at the plugin root | Workflow registered and ran |
| 2 | Same extension under `com.github.copilot/extensions/` | Not found; that path is read only for Agent Plugins 1.0 manifests |
| 3 | Extension `process.cwd()` and `git rev-parse --show-toplevel`, under `--plugin-dir` and local-marketplace install | Both the workspace repository |
| 4 | Plugin extension in an untrusted folder | Ran; project extensions were excluded, plugin extensions were not |
| 5 | `copilot workflow run` exit status for success, thrown error, arguments failing `argsSchema`, unknown name | 0, 0, 0, 0 |
| 6 | `--result-file` on a thrown error | Not written; exit status still 0 |
| 7 | `ctx.agent(..., { agent: "adrkit:decision-checker" })` with the plugin installed via a local marketplace | Resolved and ran with the decision-checker's own instructions |
| 8 | `ctx.agent(..., { agent: "decision-checker" })` (bare name), same install | `null`, no throw |
| 9 | `claude plugin validate` on a plugin containing `extensions/` | Passes |
| 10 | `adr check --json` exit 0 and exit 1 | Complete CheckOutcome on both; exit 2 is a usage error |
| 11 | `--output-format json` and `--result-file` output shape (2026-10-08) | stdout is JSONL with warnings on stderr; the final `workflow.result` event has `.data.run` = `{runId, attempt, status, result}`; with `--result-file`, `.data.run` has no `result`, `.data.resultFile` holds the path, and the file holds the bare result object |
| 12 | Agent Package Manager 0.33.0, `apm install --target claude`, `--target copilot`, and `--target opencode` on the plugin (2026-10-08) | One warning on every target, `Unrecognized plugin manifest $schema` (APM classifies the plugin by structure); it comes from the manifest's `$schema` field, present before this release, not from `extensions/`. `extensions/` lands only in `apm_modules` and is deployed to no target |

### End-to-end run

A scratch git repository on `main` held two accepted records: 0001 (use the
platform fetch API; affects `src/**`) and 0002 (zero runtime dependencies;
affects `package.json`). A branch commit, "switch to axios", added the axios
dependency and replaced `fetch` in `src/net.ts`.

```sh
ADRKIT_CLI=<abs>/node_modules/@adrkit/cli/dist/index.js \
  copilot --plugin-dir <worktree>/packages/adapters/agent-plugin \
  workflow run adr-review --args '{"base":"main"}' \
  --output-format json --result-file r.json
```

The CLI was the published `@adrkit/cli` 0.17.0, run through `node` because
`ADRKIT_CLI` ends in `.js`.

| Observation | Value |
|---|---|
| Process exit status | 0, even with `status: "findings"` |
| Run settled | `completed` |
| Subagents consumed | 2 |
| AI credits | about 0.16 (158798625000 nano-AIU) |
| Elapsed | 33985 ms |
| Result | `status: "findings"`, `checkExitCode` 0, `lintExitCode` 0, files `package.json` and `src/net.ts` |
| Verdicts | 0001 `conflicts` and 0002 `conflicts`, each with evidence citing the diff |
| `unverified` | empty |
| Smoke repository `git status` afterwards | clean |

Both planted conflicts were found. The process exit status carried none of it,
which is why the documentation gives callers one gating rule: the run's status
is `completed` and `result.status` is `"ok"`. `result.status` is `ok`,
`findings`, `incomplete`, or `usage-error`; the other result fields are detail,
not the gate.

### Published install (2026-10-08, Copilot CLI 1.0.93)

After 0.4.0 merged, I installed the plugin the way a user does:
`copilot plugin marketplace add mbeacom/adrkit`, then
`copilot plugin install adrkit@adrkit`. The install reported `v0.4.0` and two
skills. It is a copy in `~/.copilot/installed-plugins/adrkit/adrkit/`, not a
live link, and the copied `review.mjs` was the merged code. The same fixture
and the published `@adrkit/cli` 0.17.0 were used, with no `--plugin-dir`:

| Run | Result |
|---|---|
| `{"base":"main"}` on the "switch to axios" branch | Exit 0; run `completed`; `status: "findings"`; 0001 and 0002 both `conflicts`; 2 subagents; about 0.16 AI credits (159854750000 nano-AIU); worktree clean |
| `{"base":"main"}` on a branch whose only change deletes `src/net.ts` | Run `completed`; `status: "ok"`; `files` is `["src/net.ts"]`; 0001 judged `consistent` (removing a `fetch` call does not contradict "use fetch") |

The copied install loads from root `extensions/`, runs with the workspace as
its working directory, and resolves `adrkit:decision-checker` exactly as the
`--plugin-dir` and local-marketplace probes did. The second run is the first
live exercise of the deletion handling added before merge: before it, a
deletion-only change had no files and returned `ok` without any judgment.
`copilot workflow list` does not exist in 1.0.93 (`unrecognized subcommand`).
I did not re-run the exit-code, invalid-args, or `--result-file` probes on
1.0.93.

- Maintainer click-through (measured 2026-10-08, Copilot app 1.1.27, by @mbeacom): both
  README launcher links opened the expected onboarding, marketplace add for link 1 and
  plugin install for link 2. After installing through them, the app showed the extension
  and recognized the `decision-review` canvas. This is a hand observation, not a
  scripted measurement.

### Not verified

- The Copilot app canvas, the SDK host, and `/every` scheduling.
- A native opencode load of `extensions/`. APM's opencode target was measured
  (row 12); opencode itself was never pointed at the directory.
- Copilot CLI versions before 1.0.92, and on 1.0.93 everything except the two
  published-install runs above.
- The Copilot cloud agent in Actions. Dynamic workflows are a CLI and app
  feature.
- Any persistent reference-repository run or external validation (rungs 2 and
  3). This is one run of a non-deterministic agent on a two-record fixture, not
  a pass rate.

## v0.5.0 `decision-review` canvas (2026-10-08)

Measured on 2026-10-08 at **rung 1** of ADR-0014. The canvas is specified by
[ADR-0046](adr/0046-ship-a-read-only-decision-review-canvas-for-the-github-copilot-app-in-the-portab.md)
(**accepted**). It lives beside the `adr-review` workflow in
`extensions/adrkit/` and is registered by the same `joinSession` call. Canvases
are `@experimental` in the Copilot SDK 1.0.93 typings, so every row below is a
measurement of one version, not a contract.

### Headless SDK host (Copilot CLI 1.0.93, no model calls except where stated)

The probes were driven by a throwaway host: `CopilotClient` with
`createSession({ pluginDirectories, requestCanvasRenderer: true,
requestExtensions: true, workingDirectory })`, then
`session.rpc.canvas.{list,open,action.invoke,close}`.

| # | Probe | Result |
|---|-------|--------|
| 1 | `.claude-plugin/plugin.json` plugin with a canvas in root `extensions/<dir>/extension.mjs` | Canvas delivered; extensionId `plugin:<plugin>:<dir>` (`user:<dir>` for a user-scope extension) |
| 2 | One `joinSession({ canvases, workflows })` | Registers both |
| 3 | A workflow definition missing `meta.phases` | Throws at import and takes the whole extension down, canvas included |
| 4 | `open()` and action `ctx` | Carries `session.workingDirectory` (the session cwd) and no `host` field; extension `process.cwd()` equals the session cwd |
| 5 | `open()` returning a loopback URL | Page fetchable; action results round-trip |
| 6 | An action named with the `canvas.` prefix | Rejected by the runtime as reserved |
| 7 | A canvas action starting a workflow in-process | `session.rpc.workflow.run({ name, args })` returned `{ runId, attempt, status: "running" }` |

### Desktop app (GitHub Copilot.app 1.1.14)

| # | Probe | Result |
|---|-------|--------|
| 8 | Which runtime the app runs | Its own, `github-copilot-sdk/cli/1.0.93-1/copilot --server --stdio`; an earlier session ran 1.0.80, and it moved to `1.0.93-1`. The terminal CLI is a separate install |
| 9 | Runtime environment | Carries the login-shell `PATH` (homebrew, `~/.bun/bin`, nvm, `/usr/local/bin`), not launchd's minimal one; `ADRKIT_CLI` was null unless exported in the shell profile |
| 10 | Runtime working directory | `/` or `~/.copilot`, so the session directory must come from the session |
| 11 | A probe canvas (user scope, not the shipped one), one maintainer app session | Rendered in the app side panel |
| 12 | What that panel reported | `cwd` equal to `sessionWorkingDirectory`, both the app's session worktree; `host` null; extensionId `user:adrkit-app-probe`; `joined: canvas+workflow` |
| 13 | Extension processes across restored sessions | 181 `load` and 180 `joined` events within minutes of the app starting: one extension process per restored session, in several repositories |
| 14 | SDK exports seen in the app | `Canvas`, `CanvasError`, `WorkflowResumeError`, `createCanvas`, `defineWorkflow`, `isWorkflowRunTerminal`, `joinSession` |
| 15 | The installed adrkit 0.4.0 extension in app sessions | Launched and imported with no error in its logs |

Row 13 is why the canvas starts its HTTP server inside `open()` and not when
the extension loads: loading the extension must not bind a port. The probe was
removed afterwards.

### Shipped canvas, headless smoke (Copilot CLI 1.0.93 SDK host)

Run against the code at commit `2823994` plus the ADR draft merge, from
`pluginDirectories`, on a two-record fixture. The no-spend part was re-run after
the review fixes at `4781c02`. The differences: the status line read
`2 governing · incomplete`, because an unjudged governing decision is never
`ok`, and the CSP's `style-src` is `'self' 'unsafe-inline'`, so the app's
injected theme styles apply. The 403s, the snapshot and the port release on
close were unchanged.

| # | Probe | Result |
|---|-------|--------|
| 16 | Open | extensionId `plugin:adrkit:adrkit`; status line `2 governing · ok`; the page returned 200 with the full Content-Security-Policy |
| 17 | `GET /api/state` without the token | 403 |
| 18 | `POST /api/refresh` without the header token | 403 |
| 19 | State after open | Files `package.json` and `src/net.ts`; governing 0001 and 0002; `adr check` and `adr lint` exit 0 |
| 20 | `refresh` | Returned the snapshot |
| 21 | After close | The port refused connections |
| 22 | `run_review` (with `RUN_REVIEW=1`) | Returned `{ runId, status: "running" }`; polling `get_state` reached run status `completed`, panel status `findings`, verdicts 0001 and 0002 both `conflicts`, `unverified` empty; about 0.16 AI credits; the smoke repository was clean afterwards |

Rows 16 to 22 are one run of a non-deterministic agent on a two-record fixture,
not a pass rate. The status line in row 16 is the wording measured on that
commit; before a review runs the panel shows what `adr check` found.

### Shipped canvas in the Copilot app (1.1.27)

Three maintainer app sessions on 2026-10-08. The first ran the branch at
`fd22dac` as a user-scope copy of the extension, with the plugin uninstalled; the
fixes it prompted landed in `3ffcbb4`. The second ran `3ffcbb4` the same way.
The third ran `3ffcbb4`'s extension files copied over the installed `adrkit`
plugin's `extensions/adrkit/`, so the `decision-checker` agent was present. The
second and third used the two-record fixture from rows 16 to 22.

| # | Probe | Result |
|---|-------|--------|
| 23 | Opening it | The agent called `list_canvas_capabilities`, then `open_canvas`. Its first call passed `input: null`, which the runtime rejected (`(root): null is not of type "object"`); it retried with `{}`. Fixed in `3ffcbb4`: the open and action input schemas accept `null` as no input, re-checked headless |
| 24 | Render and theme | Rendered in the side panel; the maintainer confirmed the app's dark theme applied, so the injected theme styles get through the CSP |
| 25 | Session working directory | A new app session runs in a fresh worktree branched from the repository's default branch, so the panel showed `0 changed file(s)` from `origin/main...HEAD` and later from `main...HEAD`, correctly. It sees only that session's own changes. A session started on an existing checkout used that checkout |
| 26 | `Run review` from the panel, at `fd22dac` | The run completed; the runtime then surfaced it to the agent, which called `show_review` with the same result, and the panel relabelled it "supplied by the agent". Fixed in `3ffcbb4`: `show_review` no longer replaces a run the panel started |
| 27 | `Run review`, extension present but plugin uninstalled | The runtime logged `Unknown agent_type: adrkit:decision-checker` for both judges, so both resolved to null. The panel and the run reported `incomplete` with 0001 and 0002 unverified, never `ok`. This is the first `incomplete` produced by a real host. The panel kept its own run label |
| 28 | `Run review`, plugin installed with the terminal CLI's `copilot plugin install` | Run `371e206f` completed with `findings`; 0001 and 0002 both `conflicts`, with evidence citing `src/net.ts:1-2` and `package.json:1`; the panel kept its own run label. The agent again called `show_review` with the finished result; the canvas answered `ignored` and the label stayed, which is the row 26 fix working live. The app picked up the agent the CLI installed, so the two share `~/.copilot/installed-plugins` |
| 29 | Explain button on 0001 | Started an agent turn with the fixed prompt, which names only the record id and says read-only. The agent ran `adr explain` and `adr check` and explained 0001 and its conflict with the change in chat, without editing anything |

Rows 26 to 28 are single runs of a non-deterministic agent, not a pass rate.

### Not verified

- Installing the plugin from GitHub with the canvas in place. Row 28 overlaid
  the branch's extension files on the installed 0.4.0 plugin; the 0.5.0
  install itself happens when this merges.
- Whether `frame-ancestors *` matters in the app. The CSP allows
  `style-src 'self' 'unsafe-inline'` because the app injects its theme as
  `<style>` elements (`applyExtensionCanvasTheme` in the app binary), and row 24
  shows that theme applying. The binary's strings also suggest a dedicated
  native webview, which would make `frame-ancestors *` a no-op; how the app
  frames the panel was not observed, so the directive stays.
- Re-measure on app upgrades: the workflow reviews `process.cwd()` while the
  panel uses the session directory (equal in the one app session measured), and
  whether every runtime accepts `canvases` in `joinSession` (`register` retries
  without `canvases` if one rejects it; unmeasured).
- App version drift: rows 8 to 15 were measured under app 1.1.14 with runtime
  1.0.93-1, and rows 23 to 29 under app 1.1.27. Neither set is re-dated to the
  other.
- Whether `ADRKIT_CLI`, when exported, reaches extension processes. The CLI
  strips "sensitive" variables unless an extension requests them; whether this
  one counts is unmeasured. It was null in the app probe because it was not set.
  Measured afterwards in the headless SDK host (row C12): it does reach the
  extension there. The app remains unmeasured.
- Copilot app and CLI versions other than those above, and a Windows host.
- Any persistent reference-repository run or external validation (rungs 2 and
  3).

## Copilot app listing and install links (2026-10-08)

Question: can the plugin carry an Agent Plugins 1.0 `extensions["com.github.copilot"].logo`
(as awesome-copilot plugins do) for the Copilot app's listing, and do the README's
launcher links say what they claim? Nothing in the manifest changed, because the
measurement below says it must not. Measured with `claude` 2.1.295, `apm` 0.33.0,
and the Copilot CLI 1.0.93 SDK host (`CopilotClient`, `createSession` with
`pluginDirectories`, `requestCanvasRenderer`, `requestExtensions`, then
`session.rpc.canvas.list`, `extensions.list`, `plugins.list`; no model calls, no
AI credits). Every run used a copy of the plugin directory outside the repository. The loader
variants were run twice, once ad hoc and once from a retained script
(`variants.sh`); the second pass reproduced every outcome, and its per-variant output
is kept as `result-<variant>.json` plus `variants-summary.txt` in the investigation
scratchpad (not committed). The `claude validate` and APM columns were run only on
the unmodified and the logo-object copies.

### Manifest: `extensions` with a logo breaks extension loading

| Copy of the plugin | `claude plugin validate` | APM 0.33.0 `install --target copilot` | Extension and canvas loaded (SDK host) |
| --- | --- | --- | --- |
| Unmodified (control) | passes | accepts | yes: `plugin:adrkit:adrkit` running, canvas listed (`control-unmodified`) |
| Plus a 128x128 `assets/preview.png`, manifest unmodified | not run | not run | yes (`control-png-only`) |
| Plus `extensions: {"com.github.copilot": {"logo": "assets/preview.png"}}` | passes **with a warning**: `extensions: Unknown field 'extensions'. Claude Code ignores it at load time.` | accepts (it reports only the existing `$schema` warning) | **no**: extension list empty, canvas list empty, on 2 of 2 runs (`ext-logo-object`) |
| `extensions: {}` | not run | not run | no (`ext-empty-object`) |
| `extensions: {"com.github.copilot": {}}` | not run | not run | no (`ext-empty-vendor-map`) |
| `extensions: {"other.vendor": {"logo": ...}}` | not run | not run | no (`ext-other-vendor`) |
| `extensions: ["extensions/adrkit"]` | not run | not run | no (`ext-array`) |
| `extensions: "extensions"` | not run | not run | yes (`ext-string`) |

Reading: in Copilot CLI 1.0.93, each non-string `extensions` value tested above (three
objects and an array) in
`.claude-plugin/plugin.json` stops the plugin's extension from loading, so the
workflow and the canvas both disappear. The plugin itself still lists as enabled in
`plugins.list`, which is why nothing reports an error. The key is read as a
component-path field (the string form loads; `null`, booleans and numbers were not tried), not as an Agent Plugins 1.0
vendor-extension map. I did not find why from the runtime bundle (it contains no
`com.github.copilot` or `agent-plugins.org` string), so the cause is inferred from
the variants, not read from source. Whether the runtime surfaces the logo is
**not shown by this run**: the only copies that declared a logo loaded no extension, and
the copies that loaded declared none, so the absence of `logo` in the dumped RPC output
(`plugins.list`, `extensions.list`, `canvas.list`) is uninformative. The typings are the
only evidence: `PluginList`, `InstalledPluginInfo` and `Extension` carry no logo field in
the 1.0.93 `generated/rpc.d.ts`, and its only `logo` fields belong to the connector catalogue.

A validator pass is therefore not sufficient evidence for a manifest key here: Claude
validates it with a warning and APM accepts it, while Copilot silently drops the
shipped canvas. No manifest key and no logo file were added.

### Agent Plugins 1.0 root `plugin.json`

GitHub's [plugin documentation](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins)
(fetched 2026-10-08) says an Agent Plugins 1.0 manifest is selected by its `$schema` and
"requires the manifest at the plugin root". It does not mention `.claude-plugin/plugin.json`,
`extensions`, or `logo`. A copy with only a root `plugin.json` (the 1.0 `$schema`, the
`extensions` map, no `.claude-plugin/`) loaded no extension and no canvas
(`root-plugin-json`). That run is confounded by the `extensions` finding above, and
`plugins.list` shows the same two `adrkit` entries for every run, so it does not show
that Copilot read the root manifest at all, nor whether it could carry the components. Adopting the 1.0 format would
also mean a second manifest to keep in step on every version bump, so it is not pursued
without a measured gain.

### Install links

- Encoding: both README launcher URLs round-trip exactly. `decodeURIComponent` of the
  `open=` value gives `ghapp://plugins/marketplace/add?source=mbeacom%2Fadrkit` and
  `ghapp://plugins/install?source=adrkit%40adrkit`, and `encodeURIComponent` of those
  strings reproduces the README's values byte for byte; `URL.searchParams.get("open")`
  agrees. GitHub's
  [deep-link documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/open-with-deep-links)
  documents the same double encoding (`@` becomes `%40`, then `%2540`), gives the install
  example, and gives no launcher example for marketplace add; the README's marketplace
  URL follows the documented method.
- Launcher: `curl` (no redirect following, no credentials) returned HTTP 200 with
  `text/html` and no redirect target for both URLs (`links-curl.txt`; the round-trip check
  is `links-roundtrip.json`, both in the investigation scratchpad). A separate fetch of the
  install URL showed the page title "Open GitHub Copilot" and the decoded `ghapp://` link
  in its body; that was not retained. This shows the launcher accepts the URLs; it does not
  show the app handles them.

### Not verified

- Whether the app shows a logo, or a different listing, for a plugin that declares one.
  Unmeasured in the Copilot app, and moot while the key disables the extension on the CLI
  runtime.
- Whether the app's runtime (cached 1.0.93-1) treats `extensions` as the CLI does.
  Unmeasured in the Copilot app.
- Behaviour on Copilot CLI versions other than 1.0.93.

## Canvas provenance, review cost, and proposal queue (2026-10-08)

Measured on 2026-10-08 at **rung 1** of ADR-0014 (shipping as plugin 0.6.0), for the additions proposed in
[ADR-0047](adr/0047-show-provenance-review-cost-and-a-read-only-proposal-queue-in-the-decision-revie.md)
(**proposed**). Rows are numbered C1 onward so they do not collide with other
sections.

### CLI output shapes (fixture repository)

A four-record fixture: `0001` accepted with `affects: src/net/**`, `0002`
accepted with an `affects` pattern that matches nothing and named by an inbound
marker on line 1 of `src/net/client.ts`, and `0003` and `0004` proposed. The
change adds `src/net/client.ts` and `src/net/other.ts` on a branch off `main`.
The CLI was built from the branch (`bun run build`).

| # | Probe | Result |
|---|-------|--------|
| C1 | `adr check --json -- src/net/client.ts src/net/other.ts` | `0001`: `firedMatchers: [{ type: "path", pattern: "src/net/**" }]`, no `declaredBy`, and no field naming which of the two files matched. `0002`: `firedMatchers: []`, `declaredBy: [{ path: "src/net/client.ts", line: 1, ref: "0002" }]`. `0003` in `activeProposals` |
| C2 | `adr queue --format json` | QueueReport `version: "1"` with `asOf`, `totalItems: 2`, `totalCorpusFindings`, `items` (`0003`, `0004`, each with `id`, `title`, `sourcePath`, tier and SLA fields, `routingTargets`, `quorum`, approval and objection counts, `itemFindings`), and `corpusFindings`. No field carries a ratifying command |
| C3 | `adr queue --format json --dir nope` | Exit 2, usage message on stderr |

### Headless SDK host (Copilot CLI 1.0.93, no model calls)

The ADR-0046 smoke host, with `pluginDirectories` set to this branch's plugin
directory at commit `7689837`, `ADRKIT_CLI` set in the runtime's environment to
the branch's built CLI, and the fixture above. No prompt was sent and
`run_review` was not invoked, so nothing was spent.

| # | Probe | Result |
|---|-------|--------|
| C4 | Open with `{ base: "main" }` | extensionId `plugin:adrkit:adrkit`; status line `2 governing · incomplete` |
| C5 | Page headers | `GET /` 200 `text/html`, the ADR-0046 CSP unchanged, `nosniff`, `no-store`; `/app.js` and `/api/state` carry the same CSP |
| C6 | State provenance | `0001` with its pattern and no `declaredBy`; `0002` with `declaredBy` `src/net/client.ts`, line 1, ref `0002` |
| C7 | State cost | `judgeCalls: 2`. A `refresh` with `{ files: ["src/base.ts"] }`, which nothing governs, gave status `ok` and `judgeCalls: 0` |
| C8 | State queue | `available: true`, `exitCode: 0`, `totalItems: 2`, items `0003` and `0004` with exactly the nine allowlisted fields |
| C9 | Ratifying command | Absent from the `/api/state` body and from `/app.js` |
| C10 | `refresh` with `{ dir: "nope" }` | Queue `available: false`, `exitCode: 2`, note "The open-proposal list is unavailable: adr queue exited 2."; the check reported its own `usage-error`; no CLI stderr in the queue block |
| C11 | Boundaries | `/api/state` without the token 403; `POST /api/refresh` without the header 403; with the header and a foreign `Origin` 403; `POST /api/explain` for queue-only id `0004` 404; after close the port refused connections |
| C12 | `ADRKIT_CLI` pointed at a missing file in the runtime's environment | Status `0 governing · usage-error` naming the configured path, and the queue note "the adr CLI could not be started". So in this headless host the variable reaches the extension, and C4 to C11 ran the branch's CLI rather than the `adr` on `PATH` |

C12 is the SDK host only. Whether the app forwards `ADRKIT_CLI` stays in the
ADR-0046 "Not verified" list.

After review, the queue was moved to run concurrently with the check, with a
30-second timeout and a separate note for an oversized report; `judgeCalls`
became 0 when `adr check` or `adr lint` exits 2 or more; and queue strings and
`declaredBy` paths are now clipped. Rows C4 to C11 were re-run at `fa4e664`
with the same results. The timeout, the oversized-report note, the clipping, and
the check-or-lint-failed button state are covered by unit tests only; none was
provoked in the SDK host.

### Not verified

- **The new UI is unmeasured in the Copilot app.** The provenance lines, the
  call-count button label and its disabled state at zero governing decisions,
  and the "Open proposals, corpus-wide" section have been run under the fake
  DOM in the unit tests and served by the headless host, but not rendered in an
  app session.
- That `judgeCalls` equals the `decision-checker` calls a completed run makes.
  It is read from `review.mjs`; no run was made for this section, so runtime
  retries and their cost are unmeasured.
- A corpus large enough for the 200-item queue cap, and how long `adr queue`
  adds to a refresh on a large corpus.
- Per-file attribution of `affects` matches. `adr check --json` does not report
  it (C1), and the canvas does not compute it.

## Read-only extension tools: `adr_check`, `adr_explain`, `adr_lint` (2026-10-08)

Measured on 2026-10-08 at **rung 1** of ADR-0014, before any release. The tools
are proposed in
[ADR-0048](adr/0048-supply-read-only-adrkit-tools-to-github-copilot-through-the-plugin-extension-ins.md)
(**proposed**, not ratified). They are registered by the same `joinSession` as
the workflow and the canvas. Every row was measured on Copilot CLI 1.0.93
through a headless SDK host (`CopilotClient`,
`createSession({ pluginDirectories, requestExtensions: true, workingDirectory })`)
with **no model calls and no AI credits**: `session.rpc.tools.getCurrentMetadata()`
lists a session's tools, and `session.rpc.tools.execute({ name, arguments })`
runs one without a model turn.

### Probe extension (throwaway, removed afterwards)

| # | Probe | Result |
|---|-------|--------|
| T1 | A tool from `joinSession({ tools })` in a `.claude-plugin` plugin's root `extensions/<dir>/extension.mjs` | Listed by `getCurrentMetadata` and executed by `tools.execute` |
| T2 | The handler's invocation | Keys `sessionId`, `toolCallId`, `toolName`, `arguments`, `availableTools`, `traceparent`, `tracestate`, `signal`; no directory. `process.cwd()` was the session directory |
| T3 | `session.rpc.metadata.setWorkingDirectory` to a second repository (what `/cd` calls) | The extension was not restarted; `process.cwd()` stayed at the first repository; the extension received `session.context_changed` with the new `cwd`. The tool list read empty until `tools.initializeAndValidate()` ran again |
| T4 | An unknown key in `joinSession` | Joined |
| T5 | A tool named `bad name!` | The runtime refused the whole join (`session resume failed: … Tool names may only contain ASCII letters, digits, underscores, and hyphens`); a second `joinSession` from the same process succeeded |
| T6 | A tool named `bash` without `overridesBuiltInTool` | Joined, then `tools.initializeAndValidate()` failed for the session (`External tool "bash" conflicts with a built-in tool of the same name`) |
| T7 | Two tools with the same name in one join | Joined |
| T7a | A handler passed as `joinSession({ onEvent })` | Received events (`session.tools_updated`, `permission.completed`, `session.extensions_loaded`) from before the join resolved, and `session.context_changed` after `setWorkingDirectory`. The shipped tools use it for directory tracking |

### Shipped tools (the plugin directory of this change)

A scratch repository with two `accepted` records whose `affects` is `src/**`,
one commit changing `src/x.ts`, and `ADRKIT_CLI` set to the worktree's built
`@adrkit/cli` 0.17.0. A second scratch repository held one record.

| # | Probe | Result |
|---|-------|--------|
| T8 | Registration | `adr_check`, `adr_explain`, and `adr_lint` listed among 215 tools, none with `deferLoading`; the `decision-review` canvas listed beside them |
| T9 | Permission prompts | Session creation raised one `extension-permission-access` request; no tool call raised one |
| T10 | `adr_check { paths: ["src/x.ts"] }` | `success`, `exitCode` 0, governing 0001 and 0002 |
| T11 | `adr_check { base: "HEAD~1" }` | `success`, files `src/x.ts` from `git:HEAD~1...HEAD`, governing 0001 and 0002 |
| T12 | `adr_explain { path: "src/x.ts" }` | `success`, governing 0001 and 0002 |
| T13 | `adr_lint {}` | `success`, 2 records checked |
| T14 | `adr_lint { dir: "bad" }` (one malformed record) | `success`, `exitCode` 1, 2 findings: a non-zero exit with a report is data |
| T15 | `adr_lint { dir: "nope" }` | `failure`, `exitCode` 2, carrying the CLI's `Corpus directory not found` |
| T16 | An absolute path, a `..` path, an unknown `cli` key, and `base: "no-such-ref"` | `failure`, each with its fixed message and no echo of the input |
| T17 | `ADRKIT_CLI` set to a missing path | Every tool returned the fixed `cli-unresolved` message, so the variable reached the extension process under the CLI host |
| T18 | `setWorkingDirectory` to the second repository, then `adr_lint {}` | 1 record checked: the tools followed the session |
| T19 | `adr-review` started in the same session with an unknown argument | `completed` with `usage-error`: the workflow still registered beside the tools |

Rows T8 to T19 were re-run after the review fixes (directory tracking through
`onEvent`, stderr only on exit 2, the split git messages), with the same
results; `base: "no-such-ref"` now returns `git-base-unresolved`.

### Not verified

- **The tools in the Copilot app: unmeasured in the Copilot app.** Whether they
  register there, whether an app session's model calls them, and which
  directory they see. The canvas's app measurements (rows 12 and 25) suggest
  the extension starts in the session's worktree, but that is the canvas's
  evidence, not the tools'.
- A model choosing and calling the tools in a real turn. Every invocation above
  went through `tools.execute`, which bypasses the model.
- Whether `ADRKIT_CLI` reaches extension processes in the app (row T17 is the
  CLI host, where the SDK host passed its environment to the runtime).
- Copilot CLI versions other than 1.0.93, an install from GitHub with the tools
  in place, a Windows host, and any rung-2 or rung-3 evidence.

## Verdict

The plugin's six components load on Copilot CLI and function correctly against a
real corpus, including the two behaviors most likely to be got wrong: surfacing
a rejected decision instead of reporting nothing, and writing exactly one
`proposed` record rather than ratifying it. Five defects were found and fixed in
the process, three of which were invisible from any single host's documentation.

That remains **rung 1** after release. Publishing through `main` changes the
distribution state, not the evidence state. Rung 2 requires a persistent,
CI-attached reference repository and a run against the public marketplace
source; rung 3 requires an adopter who is not the maintainer. Both remain open.
