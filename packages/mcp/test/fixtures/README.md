# `@adrkit/mcp` offline test fixtures

Every corpus here is a **local, offline, model-free, credential-free** set of ADR
markdown files authored by hand for this package's tests. Nothing in this tree is
fetched over a network, generated at test time, or copied from an external corpus.
Dynamic scenarios that need a real repository shape (a `.git` entry, oversized
sources, mid-load swaps, symlink escapes, linked worktrees) are built by
`packages/mcp/test/helpers.ts` in disposable temporary directories, never committed
here.

## `status-corpus/` — one valid record per `Status`

Six schema-valid records, exactly one per `Status` value, each carrying an
`affects: [{ type: path, pattern: "src/**" }]` matcher so a single
`get_decision_context` query for `src/…` partitions all six statuses across the
three buckets:

| id | status | bucket | notes |
|----|--------|--------|-------|
| `0001` | `accepted` | governing | has deciders; body contains the body-only token `pgvector` |
| `0002` | `draft` | activeProposals | |
| `0003` | `proposed` | activeProposals | |
| `0004` | `rejected` | history | title names `MongoDB` (title-search fixture) |
| `0005` | `superseded` | history | `supersededBy: "0001"` (resolves to an accepted target) |
| `0006` | `deprecated` | history | |

`lintCorpus` reports **six records, zero findings** for this corpus.

## `edge-corpus/` — duplicate ids and every supersession target shape

| id | status | purpose |
|----|--------|---------|
| `0010` (×2) | `accepted`, `proposed` | one id held by two files → `ambiguous-local-id` / `unique-id` finding |
| `0015` | `accepted` | the unique, resolvable supersession target |
| `0011` | `superseded` | `supersededBy: "0010"` → ambiguous target (`candidateCount: 2`) |
| `0012` | `superseded` | `supersededBy: "0099"` → dangling target (+ core `dangling-supersededBy`) |
| `0013` | `superseded` | `supersededBy: "payments:0020"` → log-qualified / federated target |
| `0014` | `superseded` | `supersededBy: "0015"` → resolved unique target |

`lintCorpus` reports **seven records** and the findings `unique-id` (×2 for `0010`)
plus `dangling-supersededBy` for `0012` and `0013`.

## `degraded-corpus/` — schema-invalid record beside inert-matcher records

| id | status | purpose |
|----|--------|---------|
| `0030` | `accepted` | title `"ab"` is below the schema minimum → excluded from `records`, surfaced only as a finding |
| `0031` | `accepted` | has an inert `package` matcher (`left-pad@^1`) → `affects-unresolvable` (info) when `get_decision_context` runs, with no dependency snapshot |
| `0032` | `draft` | a plain valid neighbor that stays fully retrievable despite the invalid sibling |

`lintCorpus` reports **two records** (`0031`, `0032`) and one exclusion finding for
`0030`, proving a schema-invalid record degrades to a finding without removing any
valid neighbor from tool results.
