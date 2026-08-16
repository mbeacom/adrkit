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
- Nothing here is reproducible by a third party yet. The plugin was installed
  from a local marketplace pointing at a worktree path, because the branch was
  not yet public.

Plugin maturity per the [ADR-0014](./adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary: **implemented**. It is **not** `reference-verified`, **not**
`released`, and **not** `externally validated`.

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
- `npx -y @adrkit/mcp@^0.8.0` resolves correctly in an ordinary repository but
  fails inside the adrkit monorepo, where `npx` prefers the unbuilt workspace
  copy (`sh: adrkit-mcp: command not found`). The package's bin name differs
  from its package name, so `npx -y -p @adrkit/mcp@<range> adrkit-mcp` is the
  robust form.

## Limitations (honest scope of this evidence)

- **Ephemeral, not a reference repository.** No persistent repo, no immutable
  refs, no CI run links, no re-run on a schedule. A regression would not be
  caught by anything here; only the in-repo unit and contract tests run in CI.
- **One host driven end to end.** Runs 1–4 are Copilot CLI only. Claude Code was
  validated statically and APM by integration output; neither had its commands
  or agent executed. opencode was never driven at all — its coverage is APM's
  placement plus the rejection warning it produced.
- **Installed from a local path.** The marketplace source was a worktree
  directory, not `mbeacom/adrkit`. The public install flow in the README is
  therefore **unverified end to end** until the branch is merged.
- **Single-run observations.** Each functional row is one run of a
  non-deterministic agent. They demonstrate the components work; they do not
  establish a pass rate.
- **The MCP finding is one host, one version.** Copilot CLI 1.0.80 on macOS. It
  was not measured on Claude Code or Linux, and it may change — it is a host
  implementation detail, not a documented contract.
- **No adversarial testing.** Nothing probed a malformed corpus, a corpus with
  error-severity findings, a non-git directory, or a missing corpus, beyond the
  CLI's own unit coverage of those paths.

## Verdict

The plugin's six components load on Copilot CLI and function correctly against a
real corpus, including the two behaviors most likely to be got wrong: surfacing
a rejected decision instead of reporting nothing, and writing exactly one
`proposed` record rather than ratifying it. Five defects were found and fixed in
the process, three of which were invisible from any single host's documentation.

That is **rung 1**. Rung 2 requires a persistent, CI-attached reference
repository and a run against the public marketplace source; rung 3 requires an
adopter who is not the maintainer. Both remain open.
