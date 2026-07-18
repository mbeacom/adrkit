# Contract: Resolver API, Catalog Port, and `adr explain` (Phase 1)

## Library: `resolveAffects` (`@adrkit/core`)

```
resolveAffects(input: {
  records: Adr[];                 // loaded corpus (or a subset)
  changedFiles: string[];         // repo-relative POSIX paths
  snapshots?: {
    changedDependencies?: { name: string; version: string }[];
    catalog?: CatalogSnapshot;
    // iacPlan?, apiDocs? — reserved; absent => inert
  };
  log?: string;                   // resolve within this log/repo; default same-repo
}): {
  matches: { recordId: string; firedMatchers: { type: string; pattern: string }[] }[];
  findings: Finding[];            // affects-unresolvable / affects-unknown-type / affects-bad-pattern
}
```

**Guarantees**:
- **Pure**: no clock, network, filesystem, env, or global state. Same inputs →
  identical output (referential transparency), asserted by `resolution-is-pure`.
- **Union, per-ADR match**: a record is included iff ≥1 non-negated matcher matches
  a changed file and no negated matcher of that record matches it. Negation is
  scoped to the record.
- **Determinism**: `matches` sorted by `recordId`; `firedMatchers` sorted by
  `(type, pattern)`; `findings` sorted by `(rule, recordId, pattern)`.
- **Degradation**: unbacked `entity`/`resource`/`api`/`data` (and `package` with no
  changed-dependency set) contribute no match and add one `affects-unresolvable`
  (info) each; unknown types add `affects-unknown-type` (warn) and are ignored.

### `path` matcher

picomatch, POSIX separators, repo-relative (no leading slash), **case-sensitive**,
`**` crosses directories, dotfiles only when the pattern says. A leading-slash
pattern yields `affects-bad-pattern` (warn) and does not match.

### `package` matcher

`name` or `name@<semver range>`. Fires iff `snapshots.changedDependencies`
contains an entry with the same `name` and (if a range is given) a `version`
satisfying it. No changed-dependency set → inert (`affects-unresolvable`). An
invalid range → `affects-bad-pattern` (warn), no match.

## Catalog port (defined in core; no adapter this phase)

```
interface CatalogPort {
  resolveEntity(ref: string): EntityId[];
  entitiesForPaths(paths: string[]): EntityId[];
  snapshot(): CatalogSnapshot;   // serializable
}
```

`entity` matchers resolve against a supplied `CatalogSnapshot`; absent → inert.

## CLI: `adr explain <path> [--dir docs/adr] [--json]`

- **Input**: one repo-relative path.
- **Behavior**: load the corpus; run `resolveAffects` with `changedFiles=[path]`
  and no snapshots (unless the environment later supplies them); print every
  governing record and, for each, the matcher (type + pattern) that fired.
- **Output (human)**: for each governing record: `id  title` then indented
  `via <type>: <pattern>` lines. If none govern: `No decision governs <path>.`
  Inert/unresolved matchers relevant to the path are listed separately as info.
- **Output (`--json`)**: `{ "path": "...", "governedBy": [{recordId, title,
  firedMatchers:[{type,pattern}]}], "findings": Finding[] }`, stably sorted.
- **Exit**: `0` normally (including "no decision governs"); `2` on usage error.
- **Determinism**: identical corpus + path ⇒ identical output.

## Non-goals (contract-level)

- No precedence/winner selection (union only).
- No adapter, catalog snapshot producer, IaC, or OpenAPI resolution.
- `explain` does not fail on unresolved matchers — it reports them.
