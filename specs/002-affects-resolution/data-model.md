# Data Model: Affects Resolution (Phase 1)

Entities the resolver operates on. The record contract itself is unchanged from
Phase 0 (`packages/core/src/schema/adr.schema.ts`); this phase adds no record
fields.

## Input: AffectsMatcher (existing, from the schema)

`{ type, pattern, repo?, negate }` — `type ∈ {path, entity, package, resource,
api, data}`, `pattern` non-empty, `repo?` federated-log qualifier (omit =
same-repo), `negate` defaults false. Consumed as-is.

## Input: ChangedFileSet

An array of repo-relative POSIX paths (no leading slash) supplied by the caller
(e.g. a PR's changed files, or the single `<path>` argument to `adr explain`).

## Input: ResolutionSnapshots (all optional, caller-supplied)

Keeps resolution pure — the resolver never reads these from disk.

| Snapshot | Feeds | v1 status |
|---|---|---|
| `changedDependencies` | `package` matchers | Produced from `bun.lock`; name + resolved version |
| `catalog: CatalogSnapshot` | `entity` matchers | Port defined; no adapter → typically absent → inert |
| `iacPlan` | `resource` matchers | Absent this phase → inert |
| `apiDocs` | `api` matchers | Absent this phase → inert |
| (adapter-defined) | `data` matchers | No core semantics → inert |

## Output: Match

A governing result: `{ recordId, firedMatcher }` where `firedMatcher` is the
`{type, pattern}` that caused the match. A record governing via several matchers
yields several `Match` entries (or one with a list — see the contract); output is
the **union** across records, stably sorted by `recordId` then matcher.

## Output: Finding (reuse Phase 0 `Finding`)

New rule ids used by this phase:

| rule | severity | when |
|---|---|---|
| `affects-unresolvable` | info | an `entity`/`resource`/`api`/`data` (or unsupported `package` lockfile) matcher has no backing snapshot |
| `affects-unknown-type` | warn | a matcher `type` this tool version does not recognize |
| `affects-bad-pattern` | warn | e.g. a `path` pattern with a leading slash, or an invalid semver range |

Findings never change the exit behavior of resolution itself; `info`/`warn` here
are informational (the surrounding command decides its own exit semantics).

## Catalog port (defined in core; no adapter)

```
interface CatalogSnapshot { /* serializable, cacheable, diffable */ }
interface CatalogPort {
  resolveEntity(ref: string): EntityId[];        // may return several; wildcards
  entitiesForPaths(paths: string[]): EntityId[];
  snapshot(): CatalogSnapshot;
}
```

`entity` matchers resolve against a supplied `CatalogSnapshot`; with none, they
are inert. Adapters (later, under `packages/adapters/catalog-*`) implement the
port; the core never imports them.
