# Contract: `adr check`, the `@adrkit/ci` Action, and the PR comment (Phase 3)

## CLI: `adr check <changed-files...> [--dir docs/adr] [--json]`

The deterministic, provider-agnostic substrate (seed 21). Builds the full `lintCorpus`
result and calls the neutral core function `checkChanges` (RC3); adds no new resolution
or validation.

- **Positionals**: one or more repo-relative changed-file paths (POSIX, no leading
  slash). An empty list is a no-op success.
- **`--dir`**: corpus directory (default `docs/adr`).
- **`--json`**: emit the machine-readable `Check outcome` (see data-model), stably
  sorted; otherwise print a human summary.
- **Behavior**: load the corpus via `lintCorpus` (keeping its full findings, including
  those for malformed files it drops from `records`); call `checkChanges({ lint,
  changedFiles, dir })`; print the governing decisions (id + title + fired matcher, like
  `adr explain`) and the changed-record findings.
- **Exit**: `0` on success; **non-zero** iff a **changed record** has an
  `error`-severity finding (FR-002); `2` on usage error. `info`/`warn` never fail.
- **Purity/determinism**: identical `(lint result, changedFiles, snapshots)` → identical
  output; no clock, no network, no traversal beyond the corpus load and the supplied list
  (ADR-0009). No model (Principle IV).

**Human output (sketch)**:

```text
Decisions governing this change:
  0007  Isolate integrations as optional adapters
    via path: packages/*/package.json
  0009  Pin affects resolution semantics ...
    via path: packages/core/src/affects/**
Changed records: 0
checked: 3 governing, 0 changed-record errors
```

`--json` output shape:

```ts
{
  changedFiles: string[];
  governedBy: { recordId: string; title: string; firedMatchers: { type: string; pattern: string }[] }[];
  changedRecords: string[];
  findings: Finding[];
  ok: boolean;
}
```

## Library reuse (`@adrkit/core`)

`adr check` and the Action call into `@adrkit/core`. The **existing** `resolveAffects`
and validators are unchanged; a **new neutral** core entrypoint (`checkChanges`, R1)
composes them so both surfaces share one implementation without either depending on
the other (see the contract below):

```ts
resolveAffects(input: {
  records: readonly Adr[];
  changedFiles: readonly string[];
  snapshots?: { changedDependencies?: ChangedDependency[]; catalog?: CatalogSnapshot };
}): { matches: AffectsMatch[]; findings: Finding[] }

deriveChangedDependenciesFromBunLockDiff(...)   // for `package` matcher snapshots
lintCorpus({ dir }): { records: Adr[]; findings: Finding[]; checked: number }  // full lint result
```

## Neutral shared function: `checkChanges` (`@adrkit/core`, RC3)

The single implementation of "resolve governing decisions + validate changed records",
called by **both** `adr check` (CLI) and the Action. It lives in **core** so neither
surface imports the other (RC3/R2). It takes the **full lint result** (so findings kept
for malformed files dropped from `records` are not lost) plus optional snapshots:

```ts
checkChanges(input: {
  lint: { records: Adr[]; findings: Finding[]; checked: number };  // full lintCorpus result
  changedFiles: string[];
  dir?: string;                                 // corpus dir, to identify changed records
  snapshots?: {
    changedDependencies?: ChangedDependency[];  // Action-supplied lockfile diff (package matchers)
    catalog?: CatalogSnapshot;                  // inert this phase
  };
}): CheckOutcome
```

Pure and deterministic (no fs/clock/network beyond the already-loaded lint result).
`adr check` builds `lint` via `lintCorpus`; the Action does the same after checkout.

## GitHub Action: `@adrkit/ci` (`action.yml`)

- **Metadata**: `runs.using: node24` (FR-016/R11) with `runs.main` pointing at the
  **committed self-contained bundle** (core + toolkit, FR-015/R10).
- **Inputs**:
  - `dir` (default `docs/adr`) — corpus directory.
  - `token` (default `${{ github.token }}`) — the default `GITHUB_TOKEN`; **no other
    secret** (FR-008).
- **Runtime steps**:
  1. Extract the PR's **complete** changed-file list via a **fully paginated
     `pulls.listFiles`** or a local **merge-base diff** — never the truncation-prone
     compare API; handle the provider file cap explicitly (impure; lives in the Action,
     not the resolver — R4/FR-003).
  2. Build the lint result + snapshots and run `checkChanges` (RC3).
  3. Render the comment (selective, marker-bearing) and **create or update** it,
     locating the prior comment by marker **and** author identity across **all** comment
     pages (R5/FR-005).
  4. Set the job outcome: **fail** iff a changed record has an `error` finding
     (FR-002); otherwise succeed regardless of governing-list size.
- **Permissions**: needs `pull-requests: write` to comment. With a read-only token
  (e.g. fork PRs), it **still runs the check** and downgrades commenting to a job-log
  notice — it does **not** fail the job on a comment-permission error (FR-014/R8).
- **Side effects**: exactly one PR comment (created or edited). **No** record write,
  **no** database/index (ADR-0004/FR-010). It never approves or merges (FR-011).
- **Isolation**: `@adrkit/ci` imports `@adrkit/core` + public Action libs only; **no**
  `packages/adapters/*` import (FR-013). `core-has-no-adapter-deps` covers it **and**
  asserts the GitHub toolkit (`@actions/*`, Octokit) never reaches `@adrkit/core` or
  the schema (maintainer-resolved).

## PR comment contract

- **Selectivity (FR-006/SC-003)**: the comment lists **exactly** the resolver's union
  for the changed files — one entry per governing record with its fired matcher(s).
  A record that governs no changed file MUST NOT appear. On a >10-record corpus with a
  subset diff, the comment MUST NOT list the whole corpus. The renderer MAY group by
  matcher type and MAY cap an extreme list with a "+N more" tail, but MUST NOT add or
  drop records from the resolver's set.
- **Idempotency (FR-005/SC-004)**: the comment carries a stable hidden marker
  (`<!-- adrkit:ci -->`). To update in place the Action **paginates all PR comments**
  and matches on **both** the marker **and** its own author identity; a second run edits
  that comment rather than posting a new one. A foreign comment bearing the marker is
  ignored; the Action's own comment on a later page is found, not duplicated. **Tests**
  cover a foreign/pre-existing marker and a marker on a later page.
- **Empty state (FR-007/SC-005)**: when nothing governs the diff, render a concise
  "No governing decisions for the changed files." — not a corpus dump.
- **Validation surfacing (R7)**: when a changed record has an `error` finding, the
  comment names the failing record + rule, and the job fails (FR-002).

## Non-goals (contract-level)

- No database/index use (ADR-0004); no record mutation or write path; no approval or
  merge gating beyond validation (FR-011).
- No catalog/IaC/OpenAPI backing — `entity`/`resource`/`api`/`data` stay inert
  (ADR-0009/FR-009).
- No non-GitHub CI provider packaging in this phase (the CLI is portable; the Action
  is GitHub-specific).
- No probabilistic/LLM ranking or summarization of the comment (Principle IV).
