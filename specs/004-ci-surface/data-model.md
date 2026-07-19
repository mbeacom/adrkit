# Data Model: CI Surface (Phase 3)

Entities the CI surface operates on. **No record-schema change** — this phase
consumes the existing schema, resolver output, and `Finding` type. Everything below
is either a reuse of a Phase 0/1 type or a small, derived, non-persistent structure.

## Input: Changed-file set

The repo-relative paths a PR touches (base…head), produced by the **Action** (not the
resolver):

- `changedFiles: string[]` — POSIX, repo-relative, no leading slash (the resolver's
  `path` grammar, ADR-0009). Includes added/modified/renamed/deleted paths as the
  source reports them.
- `changedDependencies?: ChangedDependency[]` — derived from the lockfile diff via the
  existing `deriveChangedDependenciesFromBunLockDiff`, for `package` matchers.

This is the resolver's input; resolution never walks the tree (ADR-0009 purity).

## Reuse: Governing-decision result

The Phase 1 resolver output, rendered verbatim (R6). Per governing record:

| Field | Source |
|---|---|
| `recordId` | `AffectsMatch.recordId` |
| `title` | record frontmatter `title` (looked up by id) |
| `firedMatchers` | `FiredMatcher[]` — `{ type, pattern }` that fired (a union) |

The full result is `{ matches: AffectsMatch[]; findings: Finding[] }` from
`resolveAffects` — matches sorted by `recordId`, findings sorted deterministically.
Records with **no** fired matcher are absent (FR-006 selectivity).

## Reuse: Changed-record validation set

The ADR files under `--dir` that appear in the changed-file set, plus their reused
Phase 0/2 `Finding`s:

- `changedRecords: string[]` — corpus paths ∩ changed files.
- `findings: Finding[]` — from the existing validators over those records.
- `hasError: boolean` — any changed-record finding at `error` severity (drives exit
  code, FR-002).

Pre-existing errors on **unchanged** records do not fail the job (A5).

## Entity: Check outcome (`adr check` result)

The stable structure `adr check --json` emits and the Action consumes:

```ts
{
  changedFiles: string[];
  governedBy: { recordId: string; title: string; firedMatchers: FiredMatcher[] }[];
  changedRecords: string[];
  findings: Finding[];         // resolver + validation findings, deterministically sorted
  ok: boolean;                 // false iff a changed record has an error finding
}
```

- **Exit code**: `0` when `ok`, non-zero when a changed record has an `error` finding
  (FR-002). Usage errors exit `2` (mirrors the other subcommands).
- Deterministic and pure: identical `(lintResult, changedFiles, snapshots)` → identical
  output.

## Entity: Neutral check input (`checkChanges`, R1/RC3)

The shared core entrypoint takes the **full lint result** (not just `records`) plus the
optional resolution snapshots, so it sees the findings `lintCorpus` keeps for malformed
files that it drops from `records`, and so `package` matching has its snapshot:

```ts
checkChanges(input: {
  lint: { records: Adr[]; findings: Finding[]; checked: number };  // full lintCorpus result
  changedFiles: string[];
  dir?: string;                              // corpus dir, to identify changed records
  snapshots?: {
    changedDependencies?: ChangedDependency[];  // from the Action's lockfile diff (T007)
    catalog?: CatalogSnapshot;                  // inert in this phase
  };
}): CheckOutcome
```

Both `adr check` (CLI) and the Action build this input and call the same function; neither
surface imports the other (R2/RC3).

## Entity: PR comment

A rendered markdown comment; a **derived projection of git**, never a record and
never persisted outside the PR (ADR-0004).

| Part | Content |
|---|---|
| Hidden marker | stable `<!-- adrkit:ci -->` used to locate the comment for update (R5) |
| Heading | e.g. "Decisions governing this change" |
| Governing list | one entry per governing record: `id — title`, with `via <type>: <pattern>` per fired matcher |
| Empty state | concise "No governing decisions for the changed files." (FR-007) |
| Validation notice | when a changed record has an error finding, the failing record + rule (R7) |

**Identity/lifecycle**: located by the marker; **created** on first run, **edited**
on subsequent runs (FR-005). Exactly one comment per PR from this Action.

## Entity: Action configuration & context

Inputs the Action reads (FR-008 — default token only):

| Input | Source | Default |
|---|---|---|
| `dir` | Action input | `docs/adr` |
| `token` | Action input | `${{ github.token }}` (the default `GITHUB_TOKEN`) |
| PR head/base SHAs | `pull_request` event payload | — |
| `canComment` | derived from token permission | degrade if false (FR-014) |

No other secret, service, or network is read (FR-008).

## Rule ids (reused / referenced — no new record-schema rule)

The CI surface introduces no new schema invariant. It **surfaces** existing findings:

| rule | severity | origin |
|---|---|---|
| `affects-unresolvable` | info | inert matcher (entity/resource/api/data, or package w/o lockfile diff) — ADR-0009 |
| `affects-bad-pattern` | warn | malformed path/package matcher — Phase 1 |
| `affects-unknown-type` | warn | forward-compat unknown matcher type — Phase 1 |
| *(existing corpus/contract findings)* | info/warn/error | Phase 0/2 validators over changed records |

`error`-severity findings on **changed** records drive the non-zero exit (FR-002);
`info`/`warn` inform only.
