# `@adrkit/mcp`

A **local, read-only** [Model Context Protocol](https://modelcontextprotocol.io)
server that exposes adrkit decision retrieval over stdio. It lets an agent harness
ask "has this been decided?", "what governs these files?", and "what replaced this?"
against one Git-backed ADR corpus — deterministically, offline, with no model,
network, or write access.

> Part of [adrkit](https://adrkit.dev). The corpus lives in git as one Markdown
> file per decision with typed YAML frontmatter (`@adrkit/core`); this server only
> reads it.

## Install and run

```sh
bunx @adrkit/mcp                       # run the adrkit-mcp bin
adrkit-mcp --cwd /path/to/repo --dir docs/adr
```

| Option | Env | Default | Meaning |
|---|---|---|---|
| `--cwd <path>` | `ADRKIT_MCP_CWD` | `process.cwd()` | Repository root; must canonicalize to a directory containing a readable `.git` entry (a normal clone or a linked-worktree `.git` file). |
| `--dir <path>` | `ADRKIT_MCP_DIR` | `docs/adr` | ADR directory, resolved against `--cwd` and required to stay contained within it (realpath-checked, so a symlink escape is rejected). |

Flags win over environment variables, which win over the defaults. An unusable
configuration exits non-zero with a diagnostic on **stderr** (`2` for an
unparseable flag, `1` for an invalid root/directory) and never starts a transport.
**stdout is reserved for JSON-RPC protocol frames only.**

## Library surface

The package root exports only a sealed lifecycle factory. There is no way to reach
the underlying SDK server, its registrations, or its transport:

```ts
import { createAdrkitMcpServer } from '@adrkit/mcp';

const server = createAdrkitMcpServer({ cwd: process.cwd(), dir: 'docs/adr' });
await server.start();   // validates the root, connects exactly one stdio transport
// ... later:
await server.close();
```

`createAdrkitMcpServer(options?)` performs no filesystem access at construction and
returns a frozen, null-prototype handle with exactly `start()` and `close()`.

## The four tools

All four share fixed annotations (`readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`), a `corpusHealth`
(`fingerprint`/`recordCount`/`excludedCount`) sibling on every substantive
response, and a `findings` page carrying the corpus's own parse/validation findings.

| Tool | Answers | Notable outcomes |
|---|---|---|
| `search_decisions` | Normalized literal substring search over id, title, tags, and body (graveyard included by default). Filters: `status`/`scope` (any-of), `tags` (all-of), ANDed. | `results` (empty is the same branch) |
| `get_decision` | The complete typed frontmatter + body for one ref. | `found`, `not-found`, `ambiguous-local-id` (duplicate ids), `federated-log-unavailable` (a `log:id` ref is recognized, never resolved or substituted) |
| `get_decision_context` | Governing / active-proposal / historical decisions for repo-relative `files[]`, via the corpus's own `affects` matchers. Paths are compared against patterns only — never opened. | `matches` (all three arrays; empty is the same branch) |
| `list_superseded` | Every superseded record with its **direct** local replacement state. | `entries` with `resolved` / `dangling` / `ambiguous` (`candidateCount` only) / `federated-unavailable` targets |

Relation refs (`supersedes`, `supersededBy`, `relatesTo`, `conflictsWith`) are
surfaced verbatim and never expanded — follow them with a second `get_decision`
call.

## Limits

`query` 1–256 code units (non-empty after trimming); `ref` 1–128; `files[]` 1–256
entries of 1–1024 POSIX-only chars (no leading `/`, no `..`, no drive letter, no
backslash); `status` ≤6, `scope` ≤3, `tags` ≤32 × ≤64 chars; result and findings
pages default 20, max 100; a per-record ADR source cap of 64 KiB (oversized records
are excluded and surfaced as a `record-too-large` finding, never truncated). Every
input object is strict — an unknown field is rejected before any corpus access.

## Pagination and cursor restart

Every growing channel returns a `cursor` (`null` on the last page). Cursors are
opaque, versioned, and bound to both the corpus fingerprint and the call's query
shape. Reuse a returned cursor **only** with identical request parameters against
an unchanged corpus; otherwise the response is a non-error `invalid-cursor` outcome
(`corpus-changed`, `query-mismatch`, `wrong-channel`, `offset-out-of-range`,
`cursor-not-applicable`, `version-unsupported`, or `decode-failed`) and you should
restart the walk from no cursor. The primary-result and `findings` channels page
independently.

## Boundaries (out of scope by design)

No fifth tool; no writes, proposals, or PR creation; no MCP prompts, resources,
subscriptions, or sampling; no HTTP/SSE transport or authentication; no model,
embedding, ranking, or network access; no persistent cache/index/database; no
named-log federation or multi-repository aggregation; no transitive supersession
traversal.

## Toolchain

Developed and tested with Bun; published artifacts are ESM targeting Node.js `>=22`
and are verified on Node 22 and 24. Runtime dependencies are exactly `@adrkit/core`,
`@modelcontextprotocol/sdk`, and `zod`.

Apache-2.0.
