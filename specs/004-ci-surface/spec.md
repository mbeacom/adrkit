# Feature Specification: CI Surface

**Feature Branch**: `004-ci-surface`
**Created**: 2026-07-18
**Status**: Draft
**Phase**: 3 (outcome ladder rung 3)
**Normative sources**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (resolution semantics, one-way-door), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (isolation / clean clone), [ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is truth; the CI action never requires the index), [ADR-0001](../../docs/adr/0001-record-architecture-decisions-in-git.md). Where this spec and an ADR disagree, the ADR wins.

> **⚠️ Upstream gate — read [research.md §R0](./research.md) first.** Phase 2
> (rung 2) shipped its code (PR #7) but its rung-2 *outcome* — `adr migrate
> --from madr` round-tripping a **real** third-party MADR corpus — was satisfied only
> by a **synthetic** fixture. **Scoping (this document) proceeds; Phase 3
> _implementation_ is blocked** until the gate clears. **Resolved (maintainer
> decision; reviewer may override):** the gate is cleared by vendoring a subset of a
> genuinely real, permissively-licensed public MADR corpus as an **offline fixture**
> (attribution + provenance) and exercising it through `adr migrate` — a live external
> human user is a higher rung, *not* a Phase-3 precondition. See
> [research.md §R0](./research.md) and `tasks.md` **T000** / **T00A**. This spec is
> written now so the design is ready the moment the gate clears.

## Overview

Phase 0 made records valid, Phase 1 made them **locatable** (the pure `affects`
resolver), and Phase 2 let an existing corpus move in. This phase makes the
mapping **visible at review time**: on a pull request, tell the author *which
decisions govern this change* and *whether the changed records are still valid* —
without leaving git, without a database, and with no credential beyond the token
GitHub already hands every workflow.

The deliverable is **`@adrkit/ci`**, a GitHub Action, plus **`adr check
<changed-files>`** as its provider-agnostic CLI equivalent. The Action extracts
the PR's changed-file list, hands it to the existing pure resolver (ADR-0009),
lints the changed records, and posts a single, **selective**, idempotently-updated
PR comment naming the governing decisions and the matcher that fired for each.

The load-bearing property is **selectivity**: on a repo with more than ten
records, a comment that lists *everything* is a defect — it means the `affects`
matchers are too broad or the comment renderer is wrong. The comment must earn its
place by saying only what governs the diff in front of the reviewer.

## User Scenarios & Testing

### User Story 1 — A PR tells you which decisions govern it (Priority: P1) 🎯 MVP

As a reviewer (or author) on a pull request, I want a comment that names the
decision records governing the files this PR changed — each with the matcher that
fired — so I can see the relevant prior decisions without hunting through
`docs/adr/`.

**Why this priority**: This is rung 3 ("a PR tells you which decisions govern
it") and the whole point of the phase. It is independently valuable and is the MVP.

**Independent Test**: On a test repository (not this one) with a records corpus,
open a PR touching files a record's `path` matcher covers; assert a PR comment
appears naming exactly that record (id + title + fired matcher) and not the
records that don't govern the diff.

**Acceptance Scenarios**:

1. **Given** a PR whose changed files are matched by one record's `path` matcher,
   **When** the Action runs, **Then** it posts a PR comment listing that record's
   `id`, `title`, and the `path` matcher that fired.
2. **Given** a PR whose changed files are governed by several records, **When** the
   Action runs, **Then** the comment lists all of them (a **union**, per ADR-0009),
   each with its fired matcher(s), in a stable order.
3. **Given** a record whose matchers do **not** fire on any changed file, **When**
   the Action runs, **Then** that record does **not** appear in the comment.
4. **Given** an `entity`/`resource`/`api`/`data` matcher (no backing snapshot in
   this phase), **When** the Action runs, **Then** that matcher is **inert** (an
   `info` finding) and neither blocks the run nor pads the comment (ADR-0009).

### User Story 2 — `adr check` validates changed records deterministically (Priority: P1)

As a maintainer, I want a single deterministic command — `adr check
<changed-files>` — that both validates the changed records and reports the
governing decisions for a changed-file set, so CI (any provider) has a stable,
scriptable contract and the Action stays a thin wrapper.

**Why this priority**: This is the deterministic substrate the Action wraps
(Principle IV: the CI surface adds no probabilistic step). It is what makes the
Action portable and testable **without GitHub**, and it is seed 21. It ships with
US1.

**Independent Test**: Run `adr check <files> --json` over a fixed changed-file list
against a fixture corpus; assert the JSON names the governing records and the
lint findings for the changed records, and that the exit code is non-zero iff a
changed record has an error-severity finding.

**Acceptance Scenarios**:

1. **Given** a changed-file list and a corpus, **When** I run `adr check
   <files>`, **Then** it prints the governing decisions (id + title + fired
   matcher, like `adr explain`) and validates any changed records.
2. **Given** a changed record with an **error**-severity finding, **When** I run
   `adr check`, **Then** the command exits non-zero.
3. **Given** changed records with only `info`/`warn` findings, **When** I run
   `adr check`, **Then** the command exits `0` (warnings inform, they do not fail).
4. **Given** `--json`, **When** I run `adr check`, **Then** the output is a stable,
   sorted machine-readable object the Action (and other CI providers) can consume.

### User Story 3 — The comment stays useful and doesn't spam (Priority: P2)

As a maintainer of a repo with more than ten records, I want the comment to list
only the governing subset and to **update in place** on each push, so the PR isn't
buried under a wall of every decision or a new comment per commit.

**Why this priority**: This is exit criterion (b) — the usefulness gate. A first
comment (US1) is worthless if it dumps the corpus or posts N copies. Essential for
real adoption, but not required to prove the mapping fires (US1).

**Independent Test**: On a >10-record repo, push twice to the same PR touching a
small subset of governed paths; assert the comment names only the governing subset
and that the second push **updates the same comment** rather than adding a new one.

**Acceptance Scenarios**:

1. **Given** a repo with more than ten records where the diff touches a subset,
   **When** the Action runs, **Then** the comment lists only the governing subset,
   never the full corpus.
2. **Given** a prior comment from a previous push, **When** the Action runs again,
   **Then** it edits that same comment (located by a stable hidden marker) instead
   of posting a new one.
3. **Given** a diff that **no** decision governs, **When** the Action runs, **Then**
   it renders a concise "no governing decisions" note (or removes/updates its
   comment to say so) — never a dump of every record.
4. **Given** a very large diff (hundreds of files), **When** the Action runs,
   **Then** resolution is linear and the comment stays selective and readable.

### User Story 4 — Runs with only the default token (Priority: P1)

As an adopter, I want the Action to work with nothing but the workflow's default
`GITHUB_TOKEN`, so I can add it to a repo without provisioning secrets, services,
or network access.

**Why this priority**: This is exit criterion (c) and the ADR-0007 clean-clone
principle applied to the runtime. It ships with US1 because a commenting Action
that needs a bespoke token is a non-starter for the target adopter.

**Independent Test**: Configure a workflow that grants only the default
`GITHUB_TOKEN` (with `pull-requests: write`); assert the Action validates, resolves,
and comments end-to-end with no other secret present.

**Acceptance Scenarios**:

1. **Given** a workflow with only the default `GITHUB_TOKEN`, **When** the Action
   runs, **Then** it completes validation + resolution + commenting with no other
   credential.
2. **Given** a fork PR whose token is read-only, **When** the Action runs, **Then**
   it still runs the check and **degrades gracefully** on commenting (skips or logs
   a notice) rather than failing the job on a permissions error.
3. **Given** no network access beyond the GitHub API, **When** the Action runs,
   **Then** it needs nothing else — resolution and validation are local and pure.

### Edge Cases

- **PR changes code but no records**: validation is a no-op; resolution still runs
  and the comment names the governing decisions for the changed code.
- **PR changes only records**: the changed records are validated; the
  governing-decisions section may be empty or self-referential (a record whose
  `path` matcher covers `docs/adr/**`) — rendered gracefully, never a crash.
- **A changed record has an error finding**: `adr check` exits non-zero (the job
  fails); the comment still posts, and surfaces the validation failure.
- **First run vs. subsequent runs**: no prior comment → create one; prior comment
  present → update it (idempotent via the hidden marker).
- **Fork PR / read-only token**: commenting is skipped or downgraded to a job log
  annotation; the deterministic check still runs.
- **Renamed or deleted files in the diff**: included in the changed-file list as
  the source provides them; deletions still resolve against matchers.
- **Empty diff / no changed files**: no-op with a clear, quiet outcome.
- **A matcher backing source is absent** (no lockfile diff for `package`, no
  catalog for `entity`): inert `info` finding; never an error, never in the comment.

## Requirements

### Functional Requirements

- **FR-001**: `adr check <changed-files...> [--dir docs/adr] [--json]` MUST, for the
  supplied changed-file list, (a) resolve the governing decisions using the
  existing **pure** resolver (ADR-0009) and (b) validate any changed records via
  the existing validators — deterministically, with no clock, no network, and no
  filesystem traversal beyond the corpus load and the supplied list.
- **FR-002**: `adr check` MUST exit **non-zero** when a **changed record** has an
  **error**-severity finding, and `0` when findings are only `info`/`warn` — mirroring
  `adr lint` exit semantics.
- **FR-003**: The Action MUST derive the PR's changed-file list (base…head) and pass
  it to the resolver/`adr check`. File-list extraction is the **Action's**
  responsibility; the resolver MUST remain pure (ADR-0009) and MUST NOT traverse the
  working tree to discover changes.
- **FR-004**: The Action MUST post a single PR comment listing the governing
  decisions for the changed files, each with `id`, `title`, and the matcher(s) that
  fired (mirroring `adr explain`). Records are a **union**; ordering is stable.
- **FR-005**: The comment MUST be **idempotent**: subsequent runs on the same PR
  update the same comment (located by a stable hidden HTML marker) rather than
  posting a new one.
- **FR-006**: The comment MUST be **selective** — only records whose matchers fire
  on the changed files appear. A record that governs no changed file MUST NOT
  appear. On a corpus of more than ten records touched by a subset diff, the comment
  MUST NOT list the whole corpus.
- **FR-007**: On a diff that **no** decision governs, the Action MUST render a
  concise "no governing decisions" outcome (note, or an updated/removed comment) —
  never a full-corpus dump.
- **FR-008**: The Action MUST run with **no credential beyond the default
  `GITHUB_TOKEN`**; it MUST NOT require any other secret, service, or network access
  besides the GitHub API (ADR-0007).
- **FR-009**: A matcher whose backing source is absent (`entity`/`resource`/`api`/
  `data`, or `package` without a changed-dependency snapshot) MUST remain **inert**
  with an `info` finding; it MUST NOT block the check nor appear in the governing
  list (ADR-0009 degradation).
- **FR-010**: The Action and `adr check` MUST NOT write decision content, mutate
  records, or require a database/index (ADR-0004). They read the corpus + the
  supplied file list and write **only** the PR comment.
- **FR-011**: The CI surface **routes attention; it never decides.** It MUST NOT
  approve, merge, or auto-resolve anything; its only failure signal is a changed
  record failing validation (FR-002). No probabilistic/model step runs (Principle IV;
  the evaluator is Phase 4).
- **FR-012**: `adr check` MUST provide `--json` output with a **stable, sorted**
  shape so the Action and other CI providers consume a contract rather than scraping
  human text.
- **FR-013**: **Package boundary.** `@adrkit/ci` MUST depend only on `@adrkit/core`
  and public GitHub Action libraries; it MUST NOT import from `packages/adapters/*`
  (ADR-0007). `@adrkit/ci` is a first-party **surface** package (a peer of
  `@adrkit/cli`), **not** core and **not** an adapter. The `core-has-no-adapter-deps`
  check MUST cover it **and** MUST assert the GitHub toolkit dependency (`@actions/*`,
  Octokit) never reaches `@adrkit/core` or the schema — the toolkit stays confined to
  the `@adrkit/ci` surface.
- **FR-014**: On a fork PR whose token cannot comment, the Action MUST still run the
  deterministic check and **degrade** commenting to a non-fatal notice rather than
  failing the job on a permissions error (FR-008 clean-degradation, consistent with
  ADR-0009's "degrade, never fail" posture).

### Key Entities

- **Changed-file set**: the list of repo-relative paths the PR touches (base…head),
  produced by the Action from the GitHub event/API or a git range; the input to the
  pure resolver.
- **Governing-decision result**: reuse of the Phase 1 resolver output —
  `{ recordId, title, firedMatchers[] }` per governing record (a union).
- **Changed-record / validation set**: the ADR files under the corpus dir that
  appear in the diff, plus their reused Phase 0/2 `Finding`s.
- **PR comment**: rendered markdown carrying a stable hidden marker for idempotent
  update; a **derived projection** of git, never a record.
- **Check outcome**: `pass | fail` (fail iff a changed record has an error finding),
  plus the human/`--json` payload the Action consumes.

## Success Criteria

- **SC-001**: On a PR touching governed paths **on a repo that is not this one**, the
  Action posts a comment naming exactly the governing decisions (id + title + fired
  matcher). (rung 3; exit a)
- **SC-002**: `adr check <changed-files>` validates the changed records and exits
  non-zero **iff** a changed record has an error-severity finding (SC verified per
  severity).
- **SC-003**: On a repo with **more than ten** records where the diff touches a
  subset, the comment lists **only** the governing subset — never all records.
  (exit b)
- **SC-004**: A second push to the same PR **updates the existing comment** rather
  than adding a new one (idempotent).
- **SC-005**: A diff that no decision governs yields a concise "no governing
  decisions" outcome, not a full-corpus dump.
- **SC-006**: The Action completes end-to-end using **only** the default
  `GITHUB_TOKEN`, and degrades commenting (not the check) on a read-only fork token.
  (exit c)
- **SC-007**: A clean clone builds, tests, and lints green with the new
  `@adrkit/ci` package; `clean-clone-builds` and `core-has-no-adapter-deps` remain
  green and the dependency check now also covers `@adrkit/ci`.

## Assumptions

Documented, ADR-consistent choices (revisit at plan stage):

- **A1 — Changed-file extraction**: the Action derives the changed-file list from the
  PR (the `pull_request` event payload and/or the compare API, or a `base…head` git
  range on the checkout). The list is the resolver's input; resolution never walks
  the tree (ADR-0009). Extraction lives in `@adrkit/ci`, not in core.
- **A2 — Comment identity**: idempotency is achieved with a stable hidden HTML
  marker (e.g. `<!-- adrkit:ci -->`) the Action searches for among PR comments; the
  first run creates, later runs edit. No state is stored outside the PR (ADR-0004).
- **A3 — Selectivity is resolver-driven**: the comment contains exactly the resolver's
  union output for the changed files — nothing is added. "Lists everything" can only
  happen if a record's matchers are genuinely over-broad (e.g. `**`), which is a
  corpus/authoring defect the comment should make visible, not hide.
- **A4 — Backing snapshots**: in this phase only `path` and `package` matchers have
  backing (repo contents + lockfile diff, both available with the default token);
  `entity`/`resource`/`api`/`data` stay inert (ADR-0009). No catalog adapter is
  configured or required.
- **A5 — Validation scope**: "changed records" are ADR files under `--dir` that
  appear in the changed-file set. The Action MAY lint the whole corpus for context
  but only **changed** records failing at error severity fail the job (FR-002), so a
  PR is never blocked by a pre-existing error it did not introduce.
- **A6 — GitHub API client**: a public Action toolkit (e.g. `@actions/core` +
  `@actions/github`/Octokit) is an acceptable dependency of the **surface** package
  `@adrkit/ci` (like `@adrkit/cli`'s own deps), never of core, and is stubbed in
  tests so `clean-clone-builds` needs no token (ADR-0007).

## Out of Scope

- **No database / index** (ADR-0004): the Action targets the corpus + supplied file
  list only; `adr index rebuild` and any projection are explicitly not used here.
- **No write path, no approval, no merge gating beyond validation** — the CI surface
  comments and checks; it never mutates records or decides (FR-011). The evaluator is
  Phase 4.
- **No catalog / IaC / OpenAPI adapters**: `entity`/`resource`/`api`/`data` matchers
  stay inert. No cloud catalog (ADR-0009, as amended).
- **No non-GitHub CI provider integration** in this phase: `adr check` is
  provider-agnostic and portable, but the packaged Action targets GitHub only.
- **No probabilistic/LLM summarization** of the comment (Principle IV).
- **No emission of the Phase 2 divergence report as a PR** — wiring migration into
  a PR/Action surface remains a separate, later concern.
