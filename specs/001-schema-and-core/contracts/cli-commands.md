# CLI Contract: `adr` (Phase 0)

Binary `adr` (from `@adrkit/cli`). Text I/O, exit codes, `--json` where noted.
Human output → stdout; error-severity findings and diagnostics → stderr.

## `adr lint [paths...] [--json] [--dir docs/adr]`

Validate the corpus (default `docs/adr/`) against the contract and corpus
invariants.

- **Input**: optional explicit record paths; otherwise walk `--dir`.
- **Behavior**: parse each record; run Zod contract validation and cross-record
  invariants; collect `Finding`s. Malformed/non-record files are reported and do
  not abort the run (FR-012).
- **Output (human)**: findings grouped by file; a summary line
  `checked N records, E errors, W warnings`.
- **Output (`--json`)**: `{ "checked": N, "findings": Finding[] }`.
- **Exit**: `0` if no `error` findings; `1` if any `error`; `2` on usage error.
- **Determinism**: identical corpus ⇒ identical output and exit (FR-011).

## `adr new <title> [--status draft] [--dir docs/adr] [--json]`

Scaffold a new, valid record.

- **Input**: a title (imperative phrase, 3–120 chars). Optional starting status
  (default `draft`).
- **Behavior**: compute next sequential id (max existing + 1, zero-padded to ≥4);
  slugify title; write `docs/adr/<id>-<slug>.md` with populated frontmatter
  (`id`, `title`, `status`, `date`=today, `schemaVersion`) and a body skeleton
  mirroring `0000-template.md`. Does **not** infer `affects` (deferred question).
- **Output**: created file path (human) or `{ "path": "...", "id": "..." }`
  (`--json`).
- **Postcondition**: `adr lint <newfile>` exits `0` (SC-004).
- **Exit**: `0` on success; `2` on usage error (e.g. title too short); `1` if the
  target path already exists.

## `adr graph [--dir docs/adr] [--format dot|json]`

Emit decision relationships.

- **Behavior**: build edges from `supersededBy` (superseding → superseded) and
  `relatesTo`/`conflictsWith`. Omit edges whose target is absent from the corpus.
- **Output (`dot`, default)**: a Graphviz `digraph` to stdout.
- **Output (`json`)**: `{ "nodes": [{id,title,status}], "edges": [{from,to,kind}] }`.
- **Exit**: `0` normally; `2` on usage error. `graph` does not fail on dangling
  references — that is `lint`'s job.

## Shared conventions

- `--json` output is stable and sorted (by record id, then rule) for diffable,
  deterministic results.
- No command performs network I/O or requires credentials (FR-009).
- Unknown flags → exit `2` with a usage message on stderr.
