---
schemaVersion: 0.2.0
id: "0061"
title: "Ship GitHub Agentic Workflows shared components as an advisory distribution surface, staged until calibrated"
status: proposed
date: 2026-11-05
deciders:
  - "@mbeacom"
tags:
  - architecture
  - distribution
  - adapter
  - agentic-workflows
  - ci
  - calibration
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0007"
  - "0014"
  - "0016"
  - "0018"
  - "0022"
  - "0027"
  - "0028"
  - "0030"
  - "0031"
  - "0032"
  - "0034"
  - "0035"
  - "0036"
  - "0037"
  - "0038"
  - "0040"
  - "0042"
  - "0044"
  - "0045"
  - "0051"
  - "0055"
affects:
  - type: path
    pattern: "packages/adapters/gh-aw/**"
    note: "Source of the shared component and the workflows; the only place they are authored."
  - type: path
    pattern: ".github/workflows/shared/adrkit.md"
    note: "Consumer-side import of the shared component (dogfood or reference repository)."
  - type: path
    pattern: ".github/workflows/adrkit-decision-review.md"
  - type: path
    pattern: ".github/workflows/adrkit-decision-review.lock.yml"
    note: "Compiled by gh aw; derived, never hand-edited (ADR-0040)."
provenance:
  authoredBy: agent-drafted
externalRefs:
  - type: doc
    url: "https://github.github.com/gh-aw/reference/triggers/"
    label: "gh-aw triggers: Pre-Activation Steps (on.steps:)"
  - type: doc
    url: "https://github.github.com/gh-aw/reference/safe-outputs/"
    label: "gh-aw safe outputs (submit-pull-request-review allowed-events, create-check-run)"
  - type: doc
    url: "https://github.github.com/gh-aw/reference/sandbox/"
    label: "gh-aw sandbox: host binaries visible to the agent"
  - type: doc
    url: "https://github.github.com/gh-aw/reference/fork-support/"
    label: "gh-aw fork support: repo-id check, base-SHA restore of agent config"
  - type: other
    url: "https://github.com/github/gh-aw/releases/tag/v1.0.1"
    label: "gh-aw v1.0.1, the version measured here"
---

# ADR-0061: Ship GitHub Agentic Workflows shared components as an advisory distribution surface, staged until calibrated

> **Status: proposed.** Agent-drafted and not ratified. It adds a sixth
> distribution surface beside the plugin
> ([ADR-0028](./0028-ship-decision-memory-as-a-portable-agent-plugin-and-omit-the-mcp-wiring-hosts-cannot-honor.md))
> and the OCI image
> ([ADR-0032](./0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md)),
> and binds its first model-backed pass to
> [ADR-0027](./0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)'s
> calibration ordering. Facts 1–7 are a local `gh aw compile` against gh-aw
> v1.0.1 or a source read at that tag; fact 8 is a staged spike on GitHub in
> `mbeacom/adrkit-demo` (2026-11-05, PRs #9–#14). Nothing has run unstaged.

## Context

Three outcomes motivate this, and none is reachable by the surfaces adrkit ships
today.

1. **Adoption.** A team already on GitHub Agentic Workflows (gh-aw) should get
   decision review by adding one import and one container reference, with no
   new install. The plugin reaches interactive agent hosts; the governing-
   decisions Action reaches CI but makes no model judgment; the Copilot CLI
   `adr-review` dynamic workflow
   ([ADR-0045](./0045-ship-an-advisory-adr-review-dynamic-workflow-in-the-portable-agent-plugin.md))
   runs only where a person runs it.
2. **Runtime.** ADR-0027 carries a model-backed evaluator pass forward as
   intent. gh-aw already provides a sandbox, an egress firewall, an MCP gateway,
   per-run credit caps (`max-ai-credits`), and billing. Building those for
   adrkit would be a second, worse copy.
3. **Calibration first.** No probabilistic verdict may be posted before it has
   been calibrated (ADR-0027 §3). The original plan assumed gh-aw staged mode
   could shadow-run the verdict and that gh-aw's outcome evaluation would score
   it. Measurement says otherwise (fact 5).

What was measured (gh-aw v1.0.1, 2026-10-27, commit `0627fdbe`; adrkit 0.20.0):

1. **The deterministic gate is feasible.** `on.steps:` run in the
   `pre_activation` job; a full-depth checkout, a Node setup, and the pinned
   CLI compiled in strict mode. A step output re-exported through
   `jobs.pre-activation.outputs` plus a top-level `if:` gates the agent; the
   compiler moves that `if:` onto the activation job. With workflow-level
   `permissions: {}` the pre-activation job has no scopes, so it needs
   `on.permissions: {contents: read}`. gh-aw prepends a membership check
   (`admin,maintainer,write`).
2. **`adr check --json` is the right gate input.** It emits a top-level
   `governing[]` keyed by `recordId`. Exit `0` includes "nothing governs";
   exit `1` only for an `error` finding on a changed record; exit `2` for usage
   or a missing corpus. Every run in this repository carries `info` findings,
   so "any findings" is not a usable signal. There is no `--base` flag; the
   caller supplies paths. ADR-0031 commits to `CheckOutcome` as a whole,
   additively, and to the exit codes.
3. **The APM import route fails; native `plugins:` works.** `gh aw add` of
   `microsoft/apm`'s `shared/apm.md` fails schema validation on v1.0.1, and a
   vendored copy fails strict mode. `plugins: [mbeacom/adrkit/packages/adapters/agent-plugin@<tag>]`
   compiles: the ref resolves to a SHA and the lock runs `copilot plugin
   install` on that subpath. The plugin's `apm.yml` declares no dependency on
   the `adr` CLI, so the CLI must be provided separately; host binaries
   installed in top-level `steps:` are visible inside the agent sandbox.
4. **The MCP container works under gh-aw's mount rules.** The gateway runs the
   container on the host daemon; `mounts: ["${{ github.workspace }}:/workspace:ro"]`
   renders and is allowlisted `:ro`. The adrkit MCP server checks only that
   `<cwd>/.git` exists and never runs git, so the mount must include `.git`.
5. **Staged mode cannot calibrate.** Staged items are excluded from the
   outcomes manifest (`actions/setup/js/safe_output_manifest.cjs:285`), so
   `gh aw logs --outcomes` never scores them. There is no `gh aw outcomes`
   command.
6. **`create-check-run` cannot be restricted.** Its schema has no conclusions
   key and its handler accepts all seven conclusions, `failure` included
   (`create_check_run.cjs:186-192`). `submit-pull-request-review` with
   `allowed-events: [COMMENT]` is enforced by its handler
   (`submit_pr_review.cjs:138-144`).
7. **On `pull_request` the lock comes from the PR's merge ref.** A same-repo PR
   can change the workflow it runs under. gh-aw blocks fork PRs by repo id
   unless `forks:` is set, restores `.github/`, `.agents/`, `.claude/` and
   `AGENTS.md` from the base SHA, checks the lock against the source hash, and
   pins every action by SHA and every gh-aw image by digest. It does not pin a
   user-supplied MCP container image.
8. **A staged spike ran on GitHub, and the agent used neither MCP nor the
   plugin.** Five PRs against the spike branch in `mbeacom/adrkit-demo`
   (gh-aw v1.0.1, Copilot CLI 1.0.103, `claude-sonnet-5.5`):
   - The gate skipped the agent on the README-only PR (no activation, no
     credits) and ran it on all four governed PRs.
   - All four staged verdicts matched labels written before the runs: money
     helpers in integer units `consistent` with 0002; float helpers `conflicts`
     with 0002; an in-place ledger correction `conflicts` with 0006, with the
     superseded 0003 and proposed 0009 named as context only; a query-parameter
     idempotency key `conflicts` with 0007, citing its header-only line.
     Changed-file line citations were correct; record citations used a glob
     (`docs/adr/0002-*.md:35`) or no file.
   - Nothing was posted: no review, review comment, issue, or check run.
     Every review used `COMMENT`.
   - The adrkit MCP container started exactly as declared (`docker run …
     :/workspace:ro --read-only --network none -w /workspace …@sha256:… mcp`),
     reported `@adrkit/mcp` 0.20.0, and listed its four tools. **The agent
     called none of them.** The gateway rejected the `2026-07-28` protocol
     (`-32022`) and every server fell back to the 2025 era.
   - The plugin installed at its pinned SHA and the runtime loaded one agent and
     both skills, but gh-aw's own `skill_inventory.json` omits them and the
     runtime warns that direct plugin installs are deprecated. **The agent
     invoked no skill and no subagent.** It read `/tmp/gh-aw/agent/check.json`
     and the records with `bash`.
   - Agent AI credits per governed run: 7.52, 8.43, 14.83, 7.80 (median 8.11);
     detection about 0.54 each. The firewall blocked nothing; only
     `api.github.com` and `api.githubcopilot.com` were reached.

This is a decision rather than a preference because it adds a public surface
(ADR-0031's semver concern), a workflow source that runs a model on other
people's pull requests, and a calibration commitment ADR-0027 left open.

## Decision

We will ship gh-aw shared components as an **advisory** distribution surface,
default **staged**, whose posted verdicts are calibrated before any consumer is
told to unstage them.

**This decision is conditional on a spike.** It is not ratified until a spike in
`mbeacom/adrkit-demo` has measured four load-bearing items. Two are measured
(fact 8): container `args` reach `docker run` intact, and the plugin's skills
and agent load in the sandbox. Two remain Unverified: remote subpath
`imports:`, and what `gh aw logs --outcomes` scores unstaged. If either fails,
this record is revised before ratification, not superseded after it. No
`gh-aw-v*` tag is cut before ratification.

1. **Location.** Source lives in `packages/adapters/gh-aw/`: one shared
   component `shared/adrkit.md` (no `on:`) and one workflow
   `workflows/adrkit-decision-review.md`. ADR-0007 places adapters under
   `packages/adapters/*`. ADR-0030 clause 1 qualifies a surface to live here
   when it "declares no third-party `dependencies`, `devDependencies`, or
   `peerDependencies`"; these are Markdown files with none. The image, CLI, and
   plugin a consumer pulls are adrkit's own published artifacts, not a
   dependency tree this repository takes on; we read ADR-0030's "install cost"
   against this repository's graph, and say so because the headline sentence
   could be read more broadly. The workflow is not named `adr-review`, which
   ADR-0045 already uses. *Test:* a glob scan finds `shared/adrkit.md` and
   `adrkit-decision-review.md` nowhere in the source tree outside
   `packages/adapters/gh-aw/` (consumer copies under `.github/workflows/` in a
   reference repository excepted); the package declares no dependencies of any
   kind (the ADR-0030 check).
2. **Versioning and pins.** The adapter is versioned independently on a
   `gh-aw-v<semver>` tag (ADR-0007, as `spec-kit-v*`). Consumers reference
   immutable tags only, never a moving major. Inside the component:
   gh-aw compiler `v1.0.1` (installed with `gh extension install github/gh-aw
   --pin v1.0.1` and stamped in the lock's first line), the adrkit image by
   `@sha256:` digest, `@adrkit/cli` at an exact version, and the plugin at a tag
   that gh-aw resolves to a SHA. Every compiled `.lock.yml` is a derived surface
   (ADR-0040): CI recompiles with the pinned compiler and fails on any diff.
   *Test:* a contract test fails on a tag-only image, a range CLI version, a
   compiler version that differs from the pin, or an image digest whose
   `org.opencontainers.image.version` label differs from the pinned CLI
   version; the lock-diff step is observed failing against a hand-edited lock
   (ADR-0016). These tests guard the shipped source in this repository, not a
   consumer's copy of it.
3. **Capabilities given to the agent.** By default: the `adr` CLI installed on
   the host in top-level `steps:`, a `check.json` those steps write before the
   agent starts, and read access to the checkout. The prompt resolves each
   `recordId` to its real file under the corpus directory and cites
   `<that file>:<line>`, never a glob. The agent job's `permissions` are
   `contents: read` and `pull-requests: read` only. The read-only MCP container
   (`container: ghcr.io/mbeacom/adrkit@sha256:…`, `entrypointArgs: ["mcp"]`,
   `args: ["--read-only", "--network", "none", "-w", "/workspace"]`, the `:ro`
   workspace mount including `.git`) and the plugin via `plugins:` are
   **opt-in, off by default**: in the spike the agent reached every expected
   verdict without calling either (fact 8), and they cost a container start, a
   deprecated install path, and an experimental key. They are re-enabled by
   default only if calibration shows misses that their context would fix. The
   APM import route is not used. *Test:* the default compiled lock has no
   `mcp-servers.adrkit` and no plugin install step, and has the permissions
   above; an opt-in fixture compiles to the rendered mount string and args.
4. **Safe-output allowlist.** The review workflow may emit exactly:
   `submit-pull-request-review` with `allowed-events: [COMMENT]`;
   `create-pull-request-review-comment` with a `max`; and one custom safe-output
   job that creates a check run whose conclusion is hard-coded `neutral` and
   whose name (`adrkit decisions (advisory)`) matches no required check.
   **Forbidden:** an `APPROVE` or `REQUEST_CHANGES` review; any check
   conclusion other than `neutral`; the built-in `create-check-run`; any write to
   `docs/adr/**`; issues, labels, merges, or pushes. A later draft workflow may
   add `create-pull-request` for **one new file** under `docs/adr/` with
   `status: proposed`, never a modification (ADR-0034, ADR-0044, ADR-0051); that
   is out of scope until its path restriction is measured. *Test:* a contract
   test parses each compiled lock and fails on any safe-output type, review
   event, or write-scoped agent-job permission outside this list; on any job
   permission outside a per-job allowlist (the custom check job gets `checks:
   write` and nothing else); and on any conclusion literal other than
   `neutral` in the custom job's source. It is observed failing against a
   planted `APPROVE`, a planted `failure`, and a planted `contents: write`.
   It runs against an unstaged compile too, because staged compiles hide the
   `safe_outputs` job's write scopes. **Known gap:** gh-aw's `conclusion` job
   always runs a "Log detection run" step that can open an `[aw] Detection
   Runs` issue and has no opt-out. With the default token it lacks
   `issues: write` and fails closed; with a consumer PAT in
   `GH_AW_GITHUB_TOKEN` it would succeed. The docs therefore forbid setting
   `GH_AW_GITHUB_TOKEN` or `GH_AW_GITHUB_MCP_SERVER_TOKEN` for this workflow,
   and the contract test fails if the lock grants that step any write scope.
5. **Verb guard.** No workflow, shared component, or prompt in
   `packages/adapters/gh-aw/` names `accept`, `approve`, `object`, or `resolve` as
   an `adr` call, under the same matcher the plugin's wiring test uses.
   *Test:* the guard is observed failing against a planted `adr approve`.
6. **Deterministic gate.** Pre-activation runs, in order: checkout at full
   depth with `persist-credentials: false`; the pinned CLI; `adr lint`; then
   `adr check --json -- <files changed between base and head>`. It emits
   `governs=true` only when lint exits `0`, check exits `0` or `1`, and
   `.governing | length > 0`; otherwise `governs=false`. When lint or check
   cannot complete, the step writes `unverified` with the exit code to the job
   summary instead of skipping silently (ADR-0038). A check that completes can
   still be **partial**: `adr check` passes no dependency or catalog snapshot,
   so `package`, `entity` and the always-inert matcher types report
   `affects-unresolvable` and match nothing, and a capped marker scan or
   declaration list (`marker-scan-capped`, `marker-declarations-capped`) omits
   inputs; none of these changes the exit code or `ok`. The gate keys on those
   three rule ids, never on severity (`info` findings are always present), and
   when any is present it writes `partial` to the job summary with the record
   ids whose matchers were inert and the cap counts. `governs` still follows
   `.governing | length`, so a PR whose only possible governor is an inert
   matcher is skipped **visibly as partial**, not silently. The exit-code
   contract is unchanged (ADR-0031); `affects-repo-not-applicable` is not
   partial, because a matcher for another repository cannot govern this one.
   The agent job runs only on
   `governs == 'true'`, so an erroring gate spends nothing. The prompt judges
   each `governing` record `consistent`, `conflicts`, or `unclear` with record
   and line citations, and treats `history` hits as context, never judged.
   *Test, now:* a lock-shape test fails unless the activation `if:` contains the
   conjunct `needs.pre_activation.outputs.governs == 'true'` (the compiler
   wraps it with its own repo-id and stack checks), observed failing against a
   planted `!= '0'` / `|| true` variant (ADR-0016). *Test, in the spike
   (passed, fact 8):* on a PR touching only ungoverned paths the agent job is
   skipped and zero credits are recorded. *Test, to land:* gate fixtures for a
   corpus with a `package` matcher, an `entity` matcher, and a capped marker
   scan each produce `partial` in the summary, observed failing against a gate
   that reads only `.governing`. The `unverified` summary is visible only in the run's job summary,
   because the pre-activation job has no write token; that is an accepted limit
   (see Trade-offs), not a silent skip.
7. **Staged by default, and the exit criterion.** The shipped component sets
   `staged: true`. Because staged items are never scored (fact 5), calibration
   runs **unstaged in a maintainer-owned reference repository only**
   (`mbeacom/adrkit-demo`), never in a consumer's. This record treats a model
   verdict posted by CI as ADR-0027's "first probabilistic pass", and binds it
   to §3:
   - a holdout of labeled PRs is frozen and committed **before** the pass
     produces its first score, staged or not (ADR-0027:157 says "ship", and a
     staged run still runs the model). The report names the holdout's commit
     SHA, which must be an ancestor of the first calibration run's commit; one
     frozen after any score counts as backfilled;
   - the holdout is drawn mostly from **replayed historical pull requests of
     `mbeacom/adrkit`** (real governed changes, labeled before replay), not
     only from conflicts planted for the test, to limit selection bias;
   - proposed exit (for the maintainer to tune before ratification), stated as
     confidence bounds rather than point estimates so a small sample cannot
     pass by luck: at least **30 human-labeled `conflicts`** and at least
     **90 labeled `consistent` or `unclear`** (PR, governing record) pairs; the
     one-sided 95% Wilson lower bound on recall for `conflicts` ≥ **0.70**
     (roughly an observed 0.85 at n = 30) and on precision for `conflicts` ≥
     **0.75**;
   - cost: median AI credits per accepted outcome (a posted judgment that
     matches the holdout label) ≤ **2×** the median per-run agent credits
     measured on governed PRs in the staged spike. That median is **8.11**
     (fact 8, n = 4, with the plugin and MCP loaded), so the threshold is
     **16.2 credits**; it is re-measured on the default capability set of
     clause 3 before calibration, and `max-ai-credits` is set to **30**;
   - usefulness: across the calibration run, at least **half** of posted
     `conflicts` comments are judged actionable by the labeler. A calibrated
     but useless reviewer is grounds to drop the surface, not unstage it;
   - the report publishes whole-gate and probabilistic-marginal figures
     separately (ADR-0027), discloses any reconstructed snapshot, and records
     the compiler, engine, image digest, and CLI versions.
   Until that report is committed, documentation tells consumers to keep
   `staged: true`. *Test:* the shipped component's `staged` is `true`; the docs
   contain no unstaged example without a link to a committed report.
8. **Trust posture on `pull_request`.** The workflow triggers on
   `pull_request` only, never `pull_request_target`; `forks:` is not set, so
   fork PRs get no review (an accepted limit); gh-aw's membership check is kept.
   It is advisory under ADR-0035: never a required check. That does **not**
   confine a same-repo PR that edits its own workflow (fact 7). The custom
   check job holds `checks: write`, and a modified job can publish a check run
   under any name, a required context included; required checks match by name
   (ADR-0035, "The half a trusted workflow does not close"). Checking the
   advisory name cannot stop this. The residual risk is accepted, and it is
   no larger than any workflow a writer can add: the real control is
   protection of `.github/workflows/**`. In this repository that is ADR-0042's
   `gate-change-acknowledged`; the consumer docs **require** an equivalent
   (a ruleset or code-owner review on workflow paths) and say plainly that
   without it a writer can forge a required check with this workflow or
   without it. The governing-decisions Action remains the CI authority (ADR-0045), and
   markers keep no exit-code authority (ADR-0022). Any change under
   `.github/workflows/**` in this repository needs `gate-change-acknowledged`
   from an admin or maintainer (ADR-0042). *Test:* a contract test fails on
   `pull_request_target` or a `forks:` key. Where this repository or the
   reference repository dogfoods the workflow, CI reads the live branch ruleset
   through the API and fails if the check name is required. A consumer's branch
   protection is outside any test here; the docs state the requirement.

## Options considered

### Option A: shared components in this repository, under `packages/adapters/gh-aw/` (chosen)

| Dimension | Assessment |
|---|---|
| Adoption | One `imports:` line; the shared component installs the pinned CLI on the runner, so nothing is added to the consumer's own dependencies |
| Isolation | Markdown only, no dependency tree, so ADR-0030 permits it here |
| Drift | Same-repository contract tests catch a CLI JSON change or a plugin rename in the same run |
| Cost | A sixth surface to version, and a compiler pin to bump |

### Option B: a separate `adrkit-aw` repository

**Pros:** independent cadence; gh-aw's catalog conventions may expect a
dedicated repository; no `.github/workflows/**` gate changes here.
**Cons:** ADR-0030 sends a surface out only when it carries a dependency tree,
and this carries none. A CLI JSON or plugin change would break it with no
same-run signal, which is the loss ADR-0030 accepts only when it buys
something. Rejected for now; revisit if gh-aw's catalog requires a root-level
repository.

### Option C: documentation-only recipes

**Pros:** no new versioned surface; nothing to recompile.
**Cons:** every consumer copies frontmatter that encodes security choices (the
COMMENT-only review, the neutral check run, the fail-closed gate). Copies drift,
and no test here sees them. It also gives calibration nothing fixed to
calibrate.

### Option D: do nothing; rely on the Copilot CLI dynamic workflow

**Pros:** ADR-0045 already ships a review judged by the same `decision-checker`.
**Cons:** it runs only when a person starts it, in their session, on their
credits. It never reviews a pull request by itself, and gives ADR-0027 no
place for a posted, calibratable verdict.

### Option E: import the plugin through APM (`shared/apm.md`)

**Pros:** APM is the documented package route and would also bring
`apm.yml`-declared dependencies.
**Cons:** measured failing on gh-aw v1.0.1 (schema error on `gh aw add`;
strict-mode failure when vendored). Using it means `strict: false`, which turns
off the compiler checks the trust posture relies on. APM also deploys the
plugin's `extensions/` to no target.

## Trade-offs

- **A neutral check run carries no gating value, by design.** The v1 value is the
  cited per-decision review comments; the check run is only a findable summary.
  Blocking stays with the deterministic governing-decisions Action. If, after
  the calibration run plus 90 days of tagged availability, no adopter or issue
  references the check run, drop it rather than give it a conclusion.
- **A failing gate is quiet.** When `adr lint` fails, the agent is skipped and
  `unverified` lands only in the job summary, because the pre-activation job
  holds no write token. Giving it one to post a check would put a write token
  in the job that reads PR content before any sandbox.
- **A custom safe-output job is code adrkit owns.** It replaces a built-in that
  cannot be restricted, and must be maintained across gh-aw upgrades.
- **Calibration happens in one repository.** A demo repository's PRs are not a
  consumer's distribution; the report is rung 2 at most (ADR-0014).
- **Dropping MCP and the plugin by default gives up context.** Four easy PRs,
  each governed by one record whose rule is stated in a single line, did not
  need it. A change whose conflict spans several records, or turns on a
  supersession chain, might. Calibration, not the spike, decides.
- **`plugins:` is experimental, and direct plugin installs are deprecated.** The
  runtime warned so in the spike, and gh-aw's skill inventory omitted the
  plugin's skills. The opt-in path may stop working on a gh-aw upgrade without
  failing the compile.
- **A partial gate still skips.** Running the agent whenever a matcher is
  inert would spend credits on every PR in a corpus with any `package` or
  `entity` matcher. Reporting `partial` instead keeps the cost bounded and
  the gap visible, at the price of no review on a change that only an inert
  matcher would govern.
- **The check job's `checks: write` is forgeable by a PR that edits it.**
  Being advisory limits what the legitimate job means, not what a modified one
  can publish; consumers without workflow-path protection carry that risk with
  or without this workflow.
- **Fork PRs get nothing.** The safe posture costs the contributors who most
  need context.
- **Each gh-aw upgrade is a gate change.** The compiler pin, recompiled locks,
  and the `gate-change-acknowledged` label make upgrades deliberate and slow.

## Consequences

- Easier: decision review on every governed pull request for gh-aw users, with
  credits spent only when a decision governs the change.
- Harder: a compiler pin and a custom safe-output job to maintain; a holdout to
  label by hand before any calibration run.
- **How we would know this was wrong:** the gate runs the agent on a PR with an
  empty `governing`; any compiled lock grants the agent job a write scope; a
  review event other than `COMMENT` or a conclusion other than `neutral` is
  ever posted; the calibration report misses the exit thresholds after two
  holdout rounds; median credits per accepted outcome exceed the threshold;
  fewer than half of posted `conflicts` comments are actionable; or either of
  the two remaining load-bearing Unverified items fails.
- **Revisit if:** gh-aw adds a conclusions restriction to `create-check-run`
  (drop the custom job); staged items become scorable (calibrate staged); APM
  imports pass strict mode; gh-aw's `plugins:` leaves experimental status or
  is removed; calibration misses would be fixed by MCP or plugin context
  (enable them by default); or the gateway accepts the `2026-07-28` MCP
  protocol (ADR-0018's modern era is unexercised here until then).

### Unverified

- That a remote `imports:` of `mbeacom/adrkit/packages/adapters/gh-aw/shared/adrkit.md@<tag>`
  resolves a subpath.
- Whether `ubuntu-slim` carries Node; the component sets
  `runs-on-slim: ubuntu-latest` until measured.
- Whether `gh aw logs --outcomes` evaluates `submit-pull-request-review` and
  review comments when unstaged; if not, calibration scoring is an adrkit-side
  comparison against the holdout.
- Whether `create-pull-request` can be restricted to adding one new file under
  `docs/adr/`; the draft workflow waits on it.
- That the agent is equally accurate and cheaper with the MCP container and
  plugin absent (the spike ran with both loaded, though unused).
- That the prompt change in clause 3 produces real record filenames.
- Measured in the spike and no longer open: `args` reach `docker run` intact;
  the image starts under `--read-only` with the worktree mounted `:ro`; the
  plugin's skills and agent load in the sandbox (fact 8).
- The calibration thresholds in clause 7 are proposals; the cost threshold
  rests on four spike runs.

## Evidence rung

**Rung 1, plus a partial rung-2 smoke** (ADR-0014): local `gh aw compile`
against v1.0.1, source reads at that tag, and one staged run of five PRs in the
maintainer-owned reference repository `mbeacom/adrkit-demo` (fact 8). That run
measured mechanics, not accuracy: four maintainer-written PRs are a smoke test,
not a holdout. The calibration run would complete rung 2, limited by its
holdout's provenance. No external run exists.

## Action items

1. [x] Spike the shared component and workflow in `mbeacom/adrkit-demo`; compile
   cleanly with gh-aw v1.0.1 (PR mbeacom/adrkit-demo#9, strict compile, one
   warning for experimental `plugins:`).
2. [ ] Measure the four load-bearing Unverified items and the per-run credit
   baseline in a staged run there; revise this record if any fails. Two items
   and the baseline measured (fact 8); remote subpath `imports:` and unstaged
   `gh aw logs --outcomes` remain.
3. [ ] Rebuild the spike on clause 3's default capability set (no MCP, no
   plugin, real record filenames), add clause 6's `partial` summary to its
   gate, and re-measure cost on it.
4. [ ] Label and commit the holdout before the pass's first score.
5. [ ] Tune clause 7, then ratify or reject this record. No `gh-aw-v*` tag
   before this item.
6. [ ] Land the contract tests in clauses 1, 2, 3, 4, 5, 6, and 8, each
   observed failing first.
7. [ ] Publish the calibration report; only then document unstaging.
