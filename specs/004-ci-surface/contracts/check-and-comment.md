# Contract: `adr check`, the `@adrkit/ci` Action, and the PR comment (Phase 3)

## CLI: `adr check <changed-files...> [--dir docs/adr] [--json]`

The deterministic, provider-agnostic substrate (seed 21). Reuses `resolveAffects`
(ADR-0009) and the existing corpus validators; adds no new resolution or validation.

- **Positionals**: one or more repo-relative changed-file paths (POSIX, no leading
  slash). An empty list is a no-op success.
- **`--dir`**: corpus directory (default `docs/adr`).
- **`--json`**: emit the machine-readable `Check outcome` (see data-model), stably
  sorted; otherwise print a human summary.
- **Behavior**: load the corpus; run `resolveAffects({ records, changedFiles })`;
  identify changed records (corpus ∩ changed files) and collect their findings;
  print the governing decisions (id + title + fired matcher, like `adr explain`) and
  any changed-record findings.
- **Exit**: `0` on success; **non-zero** iff a **changed record** has an
  `error`-severity finding (FR-002); `2` on usage error. `info`/`warn` never fail.
- **Purity/determinism**: identical `(corpus, changedFiles)` → identical output; no
  clock, no network, no traversal beyond the corpus load and the supplied list
  (ADR-0009). No model (Principle IV).

**Human output (sketch)**:

```
Decisions governing this change:
  0007  Isolate integrations as optional adapters
    via path: packages/*/package.json
  0009  Pin affects resolution semantics ...
    via path: packages/core/src/affects/**
Changed records: 0
checked: 3 governing, 0 changed-record errors
```

`--json` output shape:

```
{
  changedFiles: string[];
  governedBy: { recordId: string; title: string; firedMatchers: { type: string; pattern: string }[] }[];
  changedRecords: string[];
  findings: Finding[];
  ok: boolean;
}
```

## Library reuse (`@adrkit/core`, unchanged)

`adr check` and the Action call the **existing** exports — no new core surface:

```
resolveAffects(input: {
  records: readonly Adr[];
  changedFiles: readonly string[];
  snapshots?: { changedDependencies?: ChangedDependency[]; catalog?: CatalogSnapshot };
}): { matches: AffectsMatch[]; findings: Finding[] }

deriveChangedDependenciesFromBunLockDiff(...)   // for `package` matcher snapshots
lintCorpus({ dir }) / the existing validators   // for changed-record findings
```

## GitHub Action: `@adrkit/ci` (`action.yml`)

- **Inputs**:
  - `dir` (default `docs/adr`) — corpus directory.
  - `token` (default `${{ github.token }}`) — the default `GITHUB_TOKEN`; **no other
    secret** (FR-008).
- **Runtime steps**:
  1. Extract the PR's changed-file list (base…head) from the event/compare API
     (impure; lives in the Action, not the resolver — R4/FR-003).
  2. Run the shared check logic (`resolveAffects` + validate) over that list.
  3. Render the comment (selective, marker-bearing) and **create or update** it.
  4. Set the job outcome: **fail** iff a changed record has an `error` finding
     (FR-002); otherwise succeed regardless of governing-list size.
- **Permissions**: needs `pull-requests: write` to comment. With a read-only token
  (e.g. fork PRs), it **still runs the check** and downgrades commenting to a job-log
  notice — it does **not** fail the job on a comment-permission error (FR-014/R8).
- **Side effects**: exactly one PR comment (created or edited). **No** record write,
  **no** database/index (ADR-0004/FR-010). It never approves or merges (FR-011).
- **Isolation**: `@adrkit/ci` imports `@adrkit/core` + public Action libs only; **no**
  `packages/adapters/*` import (FR-013). `core-has-no-adapter-deps` covers it.

## PR comment contract

- **Selectivity (FR-006/SC-003)**: the comment lists **exactly** the resolver's union
  for the changed files — one entry per governing record with its fired matcher(s).
  A record that governs no changed file MUST NOT appear. On a >10-record corpus with a
  subset diff, the comment MUST NOT list the whole corpus. The renderer MAY group by
  matcher type and MAY cap an extreme list with a "+N more" tail, but MUST NOT add or
  drop records from the resolver's set.
- **Idempotency (FR-005/SC-004)**: the comment carries a stable hidden marker
  (`<!-- adrkit:ci -->`); a second run edits that comment rather than posting a new
  one.
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
