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
| 25 | Session working directory | A new app session runs in a fresh worktree branched from the repository's default branch, so the panel showed `0 changed file(s)` from `origin/main...HEAD` and later from `main...HEAD`, correctly. It sees only that session's own changes. (Corrected in 0.9.1: `0` was not correct for a session with uncommitted edits, which 0.9.0 and earlier never listed; see "0.9.1 changed-file scope".) A session started on an existing checkout used that checkout |
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
- Re-measure on app upgrades: the workflow starts from `process.cwd()` and
  follows `session.context_changed` (since 0.8.1), while the panel uses the
  session directory (equal at start in the one app session measured), and
  whether every runtime accepts `canvases` in `joinSession` (`register` retries
  without `canvases` if one rejects it; unmeasured).
- App version drift: rows 8 to 15 were measured under app 1.1.14 with runtime
  1.0.93-1, and rows 23 to 29 under app 1.1.27. Neither set is re-dated to the
  other.
- Whether `ADRKIT_CLI`, when exported, reaches extension processes in the
  Copilot app. In the headless SDK host on Copilot CLI 1.0.93 it does (rows C12
  and H6 below): `ADRKIT_*` variables, including one named like a secret,
  reached the extension without `requestedEnvironmentVariables`. The app builds
  its extensions' environment from its own launch, and `ADRKIT_CLI` was null in
  the app probe because it was not set.
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

## v0.8.0 advisory session hooks (2026-10-08)

Measured on 2026-10-08 at **rung 1** of ADR-0014. The hooks are proposed in
[ADR-0049](adr/0049-add-advisory-session-hooks-that-never-block-to-the-portable-agent-plugin.md)
(**proposed**): `onSessionStart` and `onPostToolUse`, registered by the same
`joinSession` as the workflow and the canvas, returning nothing but
`additionalContext`. A first design also had an `onPreToolUse` note; rows H12
to H17 are why it was removed.

All rows: Copilot CLI 1.0.93 through a headless SDK host (`CopilotClient`,
`createSession({ pluginDirectories, requestExtensions: true,
requestCanvasRenderer: true, workingDirectory })`), on a fixture repository
where 0001 (`src/**`) and 0002 (`package.json`) are `accepted` and both files
differ from `origin/main`. Latencies are the runtime's own `hook.start` to
`hook.end` event timestamps. "Free" rows made no model call; several drive a
tool directly with `session.rpc.tools.execute`, which runs it through the
session's native invocation pipeline and fires the pre- and post-tool hooks.

| # | Probe | Result |
|---|-------|--------|
| H1 | A probe extension registering every hook; session created, no prompt (free) | `load` and `joined` only; no hook fired. Resuming the session with no prompt fired none either |
| H2 | Same probe, one prompt asking for one edit (`gpt-6-luna`) | `onUserPromptSubmitted`, then `onSessionStart` (`source: "new"`, `initialPrompt` set), then the model; `onPreToolUse` and `onPostToolUse` around the edit; then `onAgentStop` and `onSessionEnd` (`reason: "complete"`) |
| H3 | Did the context reach the model? | The model quoted the session-start, prompt, and pre-tool sentinels verbatim |
| H4 | Edit tool and arguments, `gpt-6-luna` | `apply_patch`; `toolArgs` is the raw patch string, `*** Update File: src/net.ts`, a relative path; `toolResult.resultType` `success` in the post hook |
| H5 | Edit tool shapes in 2,424 local Copilot session logs (free) | `edit` `{ path, old_str, new_str }` and `create` `{ path, file_text }` with absolute paths; `apply_patch` with relative and absolute paths. `str_replace_editor` (which the bundle switches on `command`, including a read-only `view`) and `str_replace` appeared in no log |
| H6 | `ADRKIT_HOOKS=0` and `ADRKIT_PROBE_SECRET_TOKEN` set in the runtime environment via `forStdio({ env })`, no `requestedEnvironmentVariables` (free) | Both present in the extension's `process.env` |
| H7 | The shipped extension with `ADRKIT_HOOKS=0` (free) | Loaded (`status: "running"`); the `decision-review` canvas still listed |
| H8 | First design, one turn (`gpt-6-luna`), canvas open, two separate edits of `src/net.ts` | `onSessionStart` **111 ms**, returned the summary naming 0001 and 0002 |
| H9 | Same turn, the then `onPreToolUse` note | First `apply_patch` of `src/net.ts`: **117 ms** (one uncached `adr check`), note naming 0001. Second edit of the same file: **0 ms**, nothing returned. Six other pre-tool calls (`skill`, `extensions_manage`, `view`): 0 to 1 ms |
| H10 | Same turn, `onPostToolUse` | 0 to 1 ms every call. The panel's `updatedAt` moved 1.7 s after the last edit's post hook, consistent with the 1.5 s debounce (the two post hooks were 2.3 s apart, so coalescing was not exercised live); `review` stayed `null`, so no review started |
| H11 | Same turn, outcome | The model quoted both advisories verbatim and read 0001 before editing; both edits landed |
| H12 | Probe pre-tool hook throws, one `create` via `tools.execute` (free) | Tool ran, file written |
| H13 | Probe post-tool hook throws (free) | Tool ran |
| H14 | Extension process exits inside the pre-tool hook (free) | Tool ran; the runtime reported the hook `success: true`; a later call ran too, with the extension listed `failed` |
| H15 | Extension process exits inside the post-tool hook (free) | Tool ran; a later call ran, extension `failed` |
| H16 | Probe pre-tool hook never answers (free) | **Tool not run**: no file written, the call still pending when the host gave up at 90 s |
| H17 | Probe post-tool hook never answers (free) | Tool **ran** (file written); its result still held at 90 s |
| H18 | Shipped hooks, `create` of `src/hooks-probe.ts` via `tools.execute`, canvas open (free) | `onPostToolUse` **104 ms**, returned "adrkit (advisory; it blocked nothing): the file(s) you just edited are governed by accepted decision(s) 0001. …" |
| H19 | Same session: a second governed file, an ungoverned file, a `view` | 109 ms with the note; 110 ms (one check, no note); 0 ms. The panel's `updatedAt` moved, `review` stayed `null` |
| H20 | After rebasing onto the tools (ADR-0048) and the canvas queue (ADR-0047): one session, no prompt sent | The extension `running`; `adr_check`, `adr_explain`, `adr_lint` registered; `decision-review` listed; `adr-review` with an unknown argument `completed` as `usage-error`. Via `tools.execute`: `adr_check` 102 ms naming 0001; `create` of a governed file, post hook 96 ms with the 0001 note; `view` 0 ms; an ungoverned `create`, post hook 95 ms, no note. The panel's `updatedAt` moved, the queue read was `available`, `review` stayed `null`. No `joined without` log line |
| H21 | Same session, unplanned | The workflow's terminal `system.notification` started a model turn on the session's default model (`claude-sonnet-5.5`), which fired `onSessionStart` (107 ms, summary naming 0001 and 0002) and called `adr_check` itself. Starting `adr-review` in an SDK session with a live model is therefore not free, even when the run spends nothing |

Spend: two paid turns, both `gpt-6-luna`. H2 cost 208,739,500 nano-AIU and H8
to H11 cost 605,392,000, about 0.81 AI credits together at 10^9 nano-AIU per
credit. H21 was an unplanned third turn, 6,768,480,000 nano-AIU (about 6.77
credits), started by the workflow's completion notice rather than by a prompt.
Every other row was free. H2 and H8 are single runs of a non-deterministic
agent, not a pass rate.

### Not verified

- Hook firing in the Copilot app: **unmeasured in the Copilot app**. That
  includes whether `onSessionStart` fires with the first prompt there, as it
  does for a plugin extension in the SDK host.
- Hook firing in an interactive Copilot CLI terminal session, and
  `source: "startup"` or `"resume"`.
- Hook behavior in subagent child sessions: whether a child's post-tool hook
  reaches this extension, and whether `onSessionStart` fires per child. The
  once-per-session note for a second session id is unit-tested only.
- The shipped post-edit note in a model turn. H18 and H19 used
  `tools.execute`, not the model's tool loop.
- Whether the model's tool loop treats a hook error the way `tools.execute`
  does (H12 to H15). The CLI changelog says 1.0.57 made pre-tool hook errors
  deny the call; this plugin registers no pre-tool hook.
- Any live model family other than `gpt-6-luna`. The `edit` and `create`
  shapes come from session logs, not from a run of these hooks.
- The off switch end to end with a model turn. H6 shows the variable arrives
  and H7 that the extension loads without hooks; that no hook then fires is
  unit-tested, not observed. Its arrival in the Copilot app is unmeasured.
- Whether the person sees hook context in the CLI or the app transcript.
- On Windows, a timeout still ends only the process the hook started, not a
  grandchild (for example `node` behind a version-manager shim for `adr`).
  The POSIX case is fixed in 0.8.1; see "0.8.1 hardening" below.

## 0.8.1 hardening (2026-10-09)

Four follow-ups logged in review of #269 to #271, all in
`extensions/adrkit/`, with no new surface and no new ADR. ADR-0048's open note
on the workflow's directory and ADR-0049's note on timeouts are amended in
place. Spend for this section: **0 AI credits**. No prompt was sent and the
workflow was not run live.

| # | Follow-up | Evidence |
| --- | --- | --- |
| E1 | No CLI stderr, exception text, or echoed argument in the workflow result, the canvas's notes, `/api/state`, the event stream, agent canvas results, tool results, or hook context | `test/error-text.test.ts` plants `ZZ-SENTINEL-7f3a` in git and `adr` stderr, in thrown errors, in an unknown argument key, and in refused file and base values, then asserts it is absent from every one of those outputs. Before the fix, 37 of its 44 cases failed. The 7 that already passed are the tools' and hooks' existing rules and one canvas case, kept as regression guards. The tools' capped, stack-stripped stderr on exit 2 is unchanged. |
| E2 | The `adr-review` workflow follows the session directory after `/cd` | Unit test: `createReviewWorkflow` reads the shared `session-dir.mjs` tracker when each run starts, so every git and adr call and `$ADRKIT_CLI` resolution uses the moved directory. Live, for the tools that share the tracker: see the table below. The workflow was not run live. |
| E4 | `adr check` over a wide change fits the command line, and echoed file lists are capped | `test/batching.test.ts`: 2,000 paths (about 120 KiB of argv) become several `adr check` calls of at most 24 KiB each, through the workflow, the canvas, `adr_check` base mode, and the session-start hook. The merged report unions decisions by id. Results list 200 paths and count the rest. A panel-started review of the same wide change survives a refresh. `packages/cli/src` has no stdin or file-list input for `adr check`, so batching was the only option. |
| E5 | A timeout or abort ends the whole process tree on POSIX (descendants that stay in the group, within the 1 s grace) | Shown first against the 0.8.0 runner under Node 22.22.2. A `/bin/sh` wrapper that backgrounds `sleep 300` and records its pid was run with a 400 ms `AbortSignal.timeout`. The runner rejected with `AbortError`, and the grandchild was still alive 1.5 s later. The new tests run the same wrapper through the 0.8.1 runner (the grandchild is gone within 5 s), and a Node child process that exits mid-command leaves no grandchild behind. Windows keeps the direct-child behavior, a documented limit. |

### Headless SDK host: the tracker after `/cd` (Copilot CLI 1.0.93, no model calls)

Run with `scratchpad/expand/E-probe/host-cd.mjs`, which uses `CopilotClient`
and `createSession({ pluginDirectories: [<worktree>/packages/adapters/agent-plugin], requestExtensions: true, workingDirectory: repoA })`,
with `ADRKIT_CLI` set to the worktree's built `packages/cli/dist/index.js`
(0.17.0). `repoA` holds records 0001 and 0002, both governing `src/**`.
`repoB` holds 0001 only.

| # | Step | Observed |
| --- | --- | --- |
| H1 | `tools.execute adr_check { paths: ["src/a.ts"] }` and `adr_lint {}` in repoA | `governing` 0001, 0002; `checked` 2 |
| H2 | `session.rpc.metadata.setWorkingDirectory({ workingDirectory: repoB })` | Returned repoB; the session emitted `session.context_changed` with `cwd` repoB |
| H3 | The same two calls again | `governing` 0001 only; `checked` 1. The shared tracker moved. The extension's new spawn-based runner started the CLI (a `.js` `ADRKIT_CLI`, so run by the `node` on `PATH`) |

### Not verified

- The workflow following `/cd` in a live run, in the CLI or the app. It is
  unit-tested only.
- Group termination on Windows. Not implemented: `spawn` ends the direct child
  only there.
- A wide change against a real Windows command line. The 24 KiB budget is
  reasoned from Windows' 32,767-character limit and a UTF-8 byte count, never
  smaller than the UTF-16 count, not measured on Windows. The 8 KiB of slack
  covers Windows quoting unless a batch holds more than about 4,000 paths that
  each contain a space or quote (each adds at least two characters). Very
  short space-bearing paths could exceed the limit; the result is an
  `args-too-long` usage error, not a silent miss.
- Which mechanism Copilot uses to end an extension on `disconnect` and
  `client.stop()` (closing its stdio or a signal). Round 1 (below) measured
  the outcome, that running groups end either way, not the mechanism.
- All four changes in the Copilot app: unmeasured in the Copilot app.

### Round 1 fixes (2026-10-09, after review)

Spend: **0 AI credits**. No prompt was sent, and the workflow was not run
live.

| # | Finding | Evidence |
| --- | --- | --- |
| R1 | The capped Judge prompt named a bare `git diff --name-only`, which prints nothing for committed work | `test/batching.test.ts` pins the hint per mode: `git diff --name-only <base>...HEAD`, `git diff --name-only HEAD` in the fallback, and "supplied by the caller (N files)" for explicit `files`. A path that declared the decision is listed first even when it sorts past position 200, directly and through the workflow. All six failed before the fix. |
| R2 | Session-start batches kept running after the deadline | A counting fake with about six 40 ms batches and a 60 ms deadline. Five calls started before the fix; now no call starts after the deadline and the one in flight is aborted. |
| R3 | `detached` groups survived a stop of the extension | Headless SDK host on Copilot CLI 1.0.93 (`scratchpad/expand/E-probe/m2/host-stop.mjs`). `ADRKIT_CLI` was a shell script that records its pid, backgrounds `sleep 300`, and waits. `adr_lint` was started, then the extension process (the `copilot … extension_bootstrap.mjs` parent of the script) was sent SIGTERM, or the host ran `session.disconnect()` and `client.stop()`. With the pre-fix plugin (e82b372) the script and its `sleep` were both alive afterwards, in both modes. With the fix, both were gone, in both modes. A Node-run test (`test/run-command.test.ts`) self-signals SIGTERM with a group running: the grandchild ends and the process still dies of SIGTERM. A second asserts that no signal listener remains once no group is tracked. |
| R4 | Unbounded calls | Every command now has a 120 s ceiling (`COMMAND_CEILING_MS`), unit-tested with a short ceiling. |
| R5 | Bookkeeping: SIGKILL after the group was gone, a group untracked while a member lived, repeated SIGTERM on overflow | Unit tests with a fake `kill` whose signal-0 probe is scripted. |
| R6 | The timeout test ran under Bun, not Node | `test/run-command.test.ts` runs the timeout through `node` against a node shim that starts a node grandchild. The same shim against the 0.8.0 runner left the grandchild alive (`scratchpad/expand/E-red/round1/l4-old.log`). |
| R7 | Fixed messages named the wrong program | Rejections carry `tool` (`git` or `adr`) and, for ENOENT, `missing` (`cwd` or `command`); messages are chosen by those codes. Unit-tested, including a real spawn into a missing directory. |
| R8 | Merged reports were unmarked, with findings in batch order | `batches: N` on merged reports only. Findings are sorted with core's `sortFindings` key, and a test compares against core's own function. |
| R9 | `show_review` matched a capped result on its first 200 paths and count | Workflow results carry `filesDigest`. A result that shares the first 200 paths and the total but differs later is refused, and the matching digest is accepted. |
| R11 | Copilot review on #272 | A capped result must list exactly the canonical 200-path prefix, checked even when its digest matches, and any result is refused above 200 paths. An explicit `files` list over 200 paths makes the run `incomplete` with a fixed note. Four tests in `test/round2.test.ts`, observed failing first. |
| R10 | Re-review Lows (optional, fixed before the PR) | `test/round2.test.ts`, all observed failing first (15 cases). A capped result without `filesDigest` is refused. A hook check ended by a signal, a timeout, or an abort is not cached, and the next edit checks again; a CLI that cannot start stays cached. Probing a group that still looks alive stops after 10 probes. `base` is held to `^[A-Za-z0-9._/@{}~^-]+$`, with no leading `-` and `..` only in a `...` range, in both the workflow and the tools. |

## `decision-board` canvas (2026-10-09)

Measured on 2026-10-09 at **rung 1** of ADR-0014 (shipped as plugin 0.9.0), for the
canvas proposed in [ADR-0050](adr/0050-ship-a-read-only-decision-board-canvas-that-maps-the-corpus-from-adr-graph-and-a.md) (**proposed**). Rows are numbered B1
onward so they do not collide with other sections.

### CLI output shapes (this repository)

The CLI was built from the branch (`bun run build`) and run with Node.

| # | Probe | Result |
|---|-------|--------|
| B1 | `adr graph --format json` | `{ nodes, edges }`; each node `{ id, title, status }`, each edge `{ from, to, kind }`. 49 nodes, 238 edges. Exit 0 |
| B2 | `adr graph --format json --focus 0046 --kind supersedes --kind relatesTo` | 10 nodes and 9 `relatesTo` edges, every edge touching 0046. Exit 0 |
| B3 | `adr graph --format json --focus 9999` and `--kind bogus` | Exit 2 with a usage message on stderr, for both |

### Headless SDK host (Copilot CLI 1.0.93, no model calls)

The ADR-0046 smoke host (`CopilotClient`,
`createSession({ pluginDirectories, requestCanvasRenderer: true, requestExtensions: true, workingDirectory })`),
with `pluginDirectories` set to this branch's plugin directory at `28da95e` and
`ADRKIT_CLI` set in the runtime's environment to the branch's built CLI. No
prompt was sent and no workflow was run, so nothing was spent. Actions were
called through `session.rpc.canvas.action.invoke`, whose result is
`{ result }`.

| # | Probe | Result |
|---|-------|--------|
| B4 | `canvas.list` | `decision-review` and `decision-board`, both from `plugin:adrkit:adrkit` |
| B5 | Open on this repository | Status `49 records · 238 relationships`; URL on `127.0.0.1` |
| B6 | Page headers | `GET /` 200 `text/html`, the ADR-0046 CSP, `nosniff`, `no-store`. `/app.js` 200, uses `createElementNS`, contains no `innerHTML`, no ratifying command, and no "ready" |
| B7 | State | `mode: "graph"`, 49 nodes, 238 edges (236 `relatesTo`, 2 `supersedes`), 3 queue rows (0047, 0048, 0049) with exactly the eleven allowlisted fields, 19,618 bytes serialized |
| B8 | Ratifying command | Present in `/api/state` only inside ADR-0044's own title; absent with titles blanked, and absent from `/app.js` |
| B9 | `focus { id: "0046" }` | 10 records (0007, 0014, 0022, 0028, 0034, 0045, 0046, 0047, 0048, 0049) and 9 relationships, matching B2 |
| B10 | `focus { kinds: ["supersedes"] }` | 4 records and 2 relationships |
| B11 | `focus { id: "9999" }` | `available: false` with the fixed exit-2 note; the queue was unaffected |
| B12 | `focus { id: "12" }` | Refused by the board's handler: `id must be a record id: four or more digits, or a 26-character ULID.` |
| B13 | `focus { kinds: ["approves"] }` | Refused by the runtime before the handler ran, with its own schema message (`/kinds/0: "approves" is not one of …`). The id has no schema pattern, so B12 reached the handler |
| B14 | `focus null`, then `refresh null` | Back to 49 records and 238 relationships |
| B15 | Open a second panel with `{ id: "0046" }` | Status `10 records · 9 relationships · focus 0046 · 3 open` |
| B16 | Boundaries | No token or a wrong token: 403 on `/` and `/api/state`. `POST /api/refresh` without the header: 403. `POST /api/focus` with the header and a foreign `Origin`: 403. `POST /api/focus` with a bad id: 400 with the fixed message. After close, both panels' ports refused connections |
| B17 | Open on a four-record fixture (no relationships, two proposals) | Status `4 records · 0 relationships`; 2 queue rows; `focus { id: "0004" }` gave 1 record; `{ kinds: ["supersedes"] }` gave 0 |

The fixture run first showed `1 records`; the status line now counts in the
singular, covered by a unit test.

### Re-run after the first review (same host, `01a10cf`, 50 records)

The review found that panels on one repository shared a filter, that a focus
result could report another call's filter, and smaller issues. After the fix,
the same harness against this repository (now 50 records, with ADR-0050):

| # | Probe | Result |
|---|-------|--------|
| B18 | Open, state | `50 records · 244 relationships`, 4 queue rows, 20,491 bytes |
| B19 | `focus { id: "0046" }` | 11 records, 10 relationships; `filter.id` `0046` |
| B20 | Panel B opened with `{ id: "0046" }`, then panel A's `get_state` | B: `11 records · 10 relationships · focus 0046 · 4 open`. A: still 50 records, 244 relationships, no filter |
| B21 | `focus { id: "12" }` and a 65-digit id | Refused by the runtime from the new schema `pattern` and `maxLength`, before the handler |
| B22 | `refresh { dir: "../.." }` | Refused with the fixed message `dir must resolve inside the session repository, also after following symbolic links. Nothing was run.` |
| B23 | Boundaries and close | Unchanged from B16 |

The overlapping-focus result (`superseded: true`), the event-stream byte
budget, both sequence guards, the extent cap, and symlink confinement are
covered by unit tests, each observed failing under the mutation that removes
it; none was provoked in the SDK host.

### Re-run after rebasing onto the 0.8.1 hardening (same host, `6b22f11`, 51 records)

After rebasing onto the 0.8.1 hardening (spawn-based `runCommand` with process
groups) and the review-state CLI, the board runs through `spawn` like every
other component. The same harness, with the CLI rebuilt from the rebased
branch:

| # | Probe | Result |
|---|-------|--------|
| B24 | Open on this repository | `51 records · 250 relationships`; 5 queue rows; 21,269 bytes |
| B25 | `focus { id: "0046" }`, `{ kinds: ["supersedes"] }`, `{ id: "9999" }` | 12 records and 11 relationships; 4 and 2; the fixed exit-2 note |
| B26 | Panel B opened with `{ id: "0046" }`, then panel A's `get_state` | B `12 records · 11 relationships · focus 0046 · 5 open`; A still 51 and 250 with no filter |
| B27 | Refusals | `id: "12"` and a 65-digit id refused by the runtime's schema check; `refresh { dir: "../.." }` refused with the fixed confinement message; `POST /api/focus` with a bad id 400 with the fixed message |
| B28 | Page and boundaries | `GET /` 200 with the shared CSP; `/app.js` uses `createElementNS` and has no `innerHTML`, no ratifying command, and no "ready"; no token or a wrong token 403; POST without the header or with a foreign `Origin` 403; both ports refused connections after close |
| B29 | Ratifying command | In `/api/state` only inside ADR-0044's title; absent with titles blanked |
| B30 | Four-record fixture | `4 records · 0 relationships`, 2 queue rows; a second panel focused on 0004 read `1 record · 0 relationships · focus 0004 · 2 open` |

### Local browser render (not the Copilot app)

The board was served by a Node script against this repository and opened in
Chromium through Playwright. The SVG nodes carried their status classes
(`node status-accepted` computed a green fill and stroke), `relatesTo` edges
computed a `6px, 4px` dash, the legend named every status and kind in text,
and focusing a record and pressing Enter selected it, filled the detail pane
with its neighbors, and returned keyboard focus to the redrawn record with
`aria-pressed="true"`. The only console error was a 403 for `/favicon.ico`,
which the token check refuses like every other route.

### Not verified

- **The board is unmeasured in the Copilot app.** Its rendering, theme,
  keyboard behavior, and layout in an app session are unverified.
- A corpus past the 300-record budget, the 1000-relationship cap, or the
  512 KiB snapshot budget, and how long `adr graph` takes on one. These are
  covered by unit tests only.
- The 30-second graph timeout and the oversized-output note. Unit tests only.
- Whether the app forwards `ADRKIT_CLI` and `ADRKIT_DIR` to the extension (the
  ADR-0046 open question).
- A join the runtime refuses because of the board's definition. There is no
  ladder rung that drops only the board, so decision-review would be dropped
  with it; this is a stated limit in ADR-0050, not a measurement.

## 0.9.1 changed-file scope (2026-10-09, shipping as plugin 0.9.1)

Two reports drove this release. On the dogfood repository the maintainer had
uncommitted edits to `src/platform/ledger-client.ts`,
`src/temporal/legacy/restart.ts`, and `src/temporal/pool/worker-pool.ts` on
`main`, and `@adr` markers in them never reached the governing list. On Windows
a session showed git's `--no-index` usage text.

### Cause (Bug 1)

`collectChangedFiles` returned `git diff --name-only <base>...HEAD` alone
whenever that command exited 0, and used `git diff HEAD` only when the range
failed. On `main` with `origin/main` equal to `HEAD`, the range is empty with
exit 0, so the panel, the workflow, the tools, and the session-start hook saw
no files. This was true from 0.4.0. Row 25 of the 0.5.0 app table read the
resulting `0 changed file(s)` as correct; it was not, because edits made in a
session never showed until they were committed.

The default change is now the union, deduplicated and sorted by code units, of:

- `git diff --name-only -z <base>...HEAD` (committed branch work);
- `git diff --name-only -z HEAD` (staged and unstaged edits, deletions
  included);
- `git ls-files --others --exclude-standard --full-name -z -- :/` (untracked
  files that are not ignored). `--full-name -- :/` matters: plain
  `git ls-files` is relative to, and limited to, the current directory, while
  `git diff --name-only` is repository-relative and whole-repository. Measured
  from a subdirectory with git 2.50.1.

`source` is `git:<base>...HEAD+worktree` for the union and `git:worktree` for
the fallback when the default `origin/main` does not resolve; only the
fallback is partial. An explicit `base` that does not resolve is still a
`base-unresolved` usage error, and an empty fallback is still `no-changes`.

### Headless SDK host (Copilot CLI 1.0.93, no model calls, 0 AI credits)

A copy of the dogfood repository (`cp -R`, so the three uncommitted edits came
along; `core.fsmonitor` turned off in the copy) with one added untracked file,
`src/marker-probe.ts`, whose first line is `// @adr 0012`. The host created a
session with this branch's plugin directory and `ADRKIT_CLI` pointing at this
branch's built CLI, opened `decision-review` with `input: null`, read
`get_state`, closed it, and called `adr_check` with no arguments through
`session.rpc.tools.execute`. No prompt was sent and nothing started a review.

| # | Run | Observed |
| --- | --- | --- |
| W1 | Plugin from `origin/main` (0.9.0), same copy | `0` files from `git:origin/main...HEAD`, status **`ok`**, note "No changed files; nothing was checked." `adr_check`: `files: []`. A false clean. |
| W2 | This branch, same copy | 4 files (the three edits and the untracked `src/marker-probe.ts`) from `git:origin/main...HEAD+worktree`; status `incomplete` (3 governing records without a verdict); `judgeCalls: 3` |
| W3 | W2 buckets | governing `0005`, `0012`, `0018`; active proposal `0015`; history `0016`, `0017`, `0019`, `0020` (the same buckets `adr check` gives on the three paths directly) |
| W4 | W2 provenance | `0005` and `0015` declared by `src/platform/ledger-client.ts:1`; `0012` declared by the untracked `src/marker-probe.ts:1`; `0016` declared by `src/temporal/pool/worker-pool.ts:1` |
| W5 | W2 findings | one `stale-marker` warning: `@adr 0016` in `src/temporal/pool/worker-pool.ts:1` names superseded 0016, update it to 0018 |
| W6 | W2 `adr_check` with no arguments | the same 4 files and source; governing `0005`, `0012`, `0018` |
| W7 | This branch, an empty directory outside any repository | panel `usage-error` with the single note "the session directory is not inside a git work tree as seen by git; open the session in the repository or pass files"; queue note "the ADR corpus directory was not found in the session directory"; `adr_check` failure `not-work-tree` with the same message |

### Windows "no-index" report (Bug 2)

adrkit passes no `--no-index` anywhere. git prints
`usage: git diff --no-index ...` when `git diff` runs in a directory it does
not treat as a work tree. Measured with git 2.50.1 on macOS:

- outside any repository, `git diff --name-only HEAD` prints that usage and
  exits 129, and `git rev-parse --is-inside-work-tree` exits 128;
- inside `.git`, `rev-parse --is-inside-work-tree` prints `false` with exit 0;
- under `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` (git's test switch for its
  `safe.directory` ownership check), `git diff --name-only HEAD` prints the same
  `--no-index` usage, and `rev-parse` exits 128 with "detected dubious
  ownership".

The extension now runs `git rev-parse --is-inside-work-tree` before listing
anything. Exit non-zero or output other than `true` is `not-work-tree`, with
the fixed message above. When git's stderr contains "dubious ownership" it is
`git-unsafe-directory`, whose fixed message names `safe.directory`. stderr is
only compared, never shown. The canvas and `runCommand` pass the session
directory through `path.resolve` (`windowsHide: true` was already set). When
`adr queue` exits 2 and the corpus directory does not exist in the session
directory, the panel says the corpus directory was not found instead of
"adr queue exited 2".

Maintainer report, Windows, `git version 2.55.0.vfs.0.10`: with the session
outside a repository, the panel showed "The open-proposal list is unavailable:
adr queue exited 2" and "git could not list the changed files against
origin/main or against HEAD. Is this a git repository?". The maintainer
believes that session was not in a repository directory. W7 is the same
situation on macOS and now shows the two messages above. **Not reproduced on
Windows.**

### Not verified

- **The Windows report's cause.** Leading hypotheses, in order: the session
  directory was outside the repository (the maintainer's own reading); git's
  ownership check refused the repository (a directory owned by another
  account or SID, a network share, or a OneDrive or VFS-for-Git location;
  measured above to give the identical `--no-index` text); a session-directory
  path form git did not resolve to the work tree. What would settle it: the git
  version (`2.55.0.vfs.0.10`, reported), the session directory as Copilot
  reported it, and the output of `git -C <dir> rev-parse --show-toplevel` and
  `git config --global --get-all safe.directory` there. 0.9.1's messages now
  separate the first two causes.
- **Unmeasured in the Copilot app.** The union in an app session, the new
  messages on the panel, and the session-start hook summary's new wording.
- `path.resolve` on a Windows session directory: unit-tested on POSIX only.
- A repository with no commit yet (`HEAD` unborn) still reports `git-failed`
  rather than listing untracked files. Unchanged from 0.9.0.

## Decision board review controls (2026-10-09)

Measured on 2026-10-09 at **rung 1** of ADR-0014 (shipping as plugin 0.10.0),
for the controls proposed in [ADR-0052](adr/0052-record-review-from-the-decision-board-under-adrkit-reviewer-with-a-confirmed-sin.md)
(**proposed**). They need `@adrkit/cli` 0.18.0 or later. Rows are numbered RV1
onward so they do not collide with other sections. Nothing here made a model
call, so nothing was spent.

### CLI behavior the controls depend on

Each command was run with Node in a scratch Git repository.

| # | Probe | Result |
|---|-------|--------|
| RV1 | `@adrkit/cli` 0.17.0 (`npx -y @adrkit/cli@0.17.0`): `approve 0001 --by @x --json`, `object … --summary=hi --json`, `resolve … --objection 1 --by @x --json` | Exit 2 for each, `Error: Unknown command "<verb>"` and the help text on stderr, 0 bytes on stdout. `--version` prints `0.17.0` |
| RV2 | 0.18.0 (this branch's build): `approve` on a record with lint errors, with `--json` | Exit 1; the reason and the findings on stderr; nothing on stdout. A refusal has no machine-readable code |
| RV3 | 0.18.0: `approve 0099` (no such record), and `--dir nope` | Exit 2 with a usage message on stderr, for both: the same exit code as RV1 |
| RV4 | `npx -y @adrkit/cli@0.18.0 --version` | `0.18.0` |

RV1 and RV3 are why an exit 2 is followed by `adr --version`, and RV2 is why a
refusal is one fixed message.

### Headless SDK host (no model calls)

The client came from the Copilot CLI 1.0.93 SDK package
(`~/.copilot/pkg/darwin-arm64/1.0.93/copilot-sdk`), and the runtime was the
installed `copilot` binary, which reported `1.0.94-3`. `createSession` had
`pluginDirectories` set to this branch's plugin directory at `2759e2c`,
`requestCanvasRenderer` and `requestExtensions` on, and the working directory
set to a two-record fixture: 0001 `accepted`, and 0002 `proposed` with
`review.quorum: 2` and `relatesTo: ["0001"]`. `adr lint` reported 0 errors for
it. `ADRKIT_CLI` was set in the runtime's environment to the branch's built CLI,
and `ADRKIT_REVIEWER` to `@fixture-reviewer`. No prompt was sent and no workflow
was run. Writes went through the page's routes with the URL token, the
`X-Adrkit-Token` header, and no `Origin`, as the page sends them.

| # | Probe | Result |
|---|-------|--------|
| RV5 | `canvas.list`, open the board | `decision-review` and `decision-board`; status `2 records · 1 relationship · 1 open`; the board's actions were still `get_state`, `refresh`, `focus` |
| RV6 | `/api/state` and the `get_state` action | Both carried `review: { enabled: true, reviewer: "@fixture-reviewer", note: null }`; 0002 at `0/2` approvals, 0 objections |
| RV7 | `POST /api/review/nonce { kind: "approval", id: "0002" }` | 200 with a 64-hex nonce and `expiresInMs: 120000`. A `get_state` result taken afterwards did not contain the nonce |
| RV8 | `POST /api/review` without the header token, and with `Origin: http://evil.example` | 403 for both; the nonce was not spent (RV9 used it) |
| RV9 | `POST /api/review { kind: "approval", id: "0002", nonce }` | 200, `outcome: "written"`, the fixed "Recorded an approval of ADR-0002 by @fixture-reviewer…" message; the reply's queue row read `1/2` |
| RV10 | The same request again (replayed nonce) | 403 with the fixed "This confirmation expired or was already used…" message |
| RV11 | A fresh nonce, then a body with `by: "@attacker"` | 400 with the fixed shape message; nothing was written |
| RV12 | Objection with summary `-Needs a load test: "p99" # first` | 200 `written`; the row read 1 unresolved, 0 resolved |
| RV13 | Resolution of objection 1 | 200 `written`; the row read 0 unresolved, 1 resolved |
| RV14 | Resolution of objection 5 | 200 `outcome: "refused"` with the fixed exit-1 message |
| RV15 | The fixture's frontmatter afterwards | `approvals: ["@fixture-reviewer"]` and one objection `{ by: "@fixture-reviewer", summary: "-Needs a load test: \"p99\" # first", resolved: true }` as block lists under the existing `review:`; no other line changed |
| RV16 | Session events | Four `session.info` events: `adrkit: decision board review approval on ADR-0002 as @fixture-reviewer: written`, then the same for the objection and the resolution, and the refused resolution with `: refused`. None carried the summary |
| RV17 | The same host with `ADRKIT_REVIEWER` unset | `review.enabled: false` with the fixed "Recording review is off…" note; the nonce route 403 with that note; a write 403 |
| RV18 | The same host with `ADRKIT_CLI` at `@adrkit/cli` 0.17.0 and the reviewer set | The controls reported enabled; the nonce route answered 409 with "This adr CLI does not support review commands; upgrade @adrkit/cli to 0.18.0 or later." No review subcommand was spawned |

### Tests

`test/board-review.test.ts` (45 tests) and the narrowed guard in
`test/wiring.test.ts`. All of them failed before the module existed. Then 24
mutations of the code were run, and each was killed by a named test, with three
exceptions. Two were equivalent: the key allowlist refuses `by` before it could
be used, and the review state never holds a nonce. The third, dropping the
nonce on panel close, survived because the test posted a made-up nonce; the test
now spends the closed panel's own nonce and fails under that mutation. Written
into the real files, a review verb in `board.mjs`'s actions or in
`board-page.mjs`, `accept` in the exempt module, a second exempt entry, and an
import of the write module from `tools.mjs` each failed the suite. The guard
test also plants verbs into the sources of `board.mjs`, `board-page.mjs`,
`tools.mjs`, `hooks.mjs`, and `canvas.mjs` in memory and asserts each is caught. The end-to-end test runs the
routes against `packages/cli/dist/index.js` on a fixture: approve, a repeated
approve (`unchanged`), object, resolve, an out-of-range resolve (`refused`),
and an unknown id (`usage-error`), with the queue counts checked after each.

### Not verified

- **The controls are unmeasured in the Copilot app.** The two-click flow, the
  confirmation step, the disabled state, keyboard use, and how the controls
  render in the app's theme have not been seen.
- Whether the app forwards `ADRKIT_REVIEWER` to the extension. It reached the
  extension through the SDK host (RV6), as other `ADRKIT_*` variables do.
- The 30-second write timeout and the `unknown` outcome for an exit other than
  0, 1, or 2. Unit tests only.
- Two writes from two boards in different extension processes on one record.
  Each board allows one write at a time, but separate processes are not
  serialized, as ADR-0051 accepts for the CLI.

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
