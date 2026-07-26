# `@adrkit/mcp`

**Deterministic, offline, read-only decision memory for coding agents — including
the decisions you already rejected.**

A local [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an agent harness query one Git-backed ADR (Architecture Decision Record) corpus
over stdio: *"has this been decided?"*, *"what governs these files?"*, and *"what
replaced this?"* It surfaces **superseded and rejected** decisions specifically so
agents stop re-proposing paths the team already ruled out.

> **No model calls. No network calls. No writes.** The server reads Markdown files
> from your repo and returns structured JSON. It never calls an LLM, never opens a
> socket, and never mutates your corpus. Every tool is annotated
> `readOnlyHint: true`, `openWorldHint: false`.

Part of [adrkit](https://adrkit.dev). The corpus lives in git as one Markdown file
per decision with typed YAML frontmatter (`@adrkit/core`); this server only reads
it. Registry namespace: **`dev.adrkit/mcp`** (this is the Node/npm `@adrkit/mcp`
package — unrelated to the `adr-kit` Python package on PyPI).

## Maturity

adrkit is **early**. Phases 0–6 are *landed / reference-verified* against
[ADR-0014](https://github.com/mbeacom/adrkit/blob/main/docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rungs 1–2 (unit/contract/conformance plus maintainer-owned isolated
reference-repository validation). It has **no external adopters or production users
yet**, and rung-3 external/community validation is openly tracked as not-yet-met.
The 4-tool surface is locked by a
[surface test](https://github.com/mbeacom/adrkit/blob/main/packages/mcp/test/surface.test.ts).

## Quick start

The published binary is **`adrkit-mcp`**. Run it with `npx` (no install):

```sh
npx -y @adrkit/mcp --cwd /path/to/your/repo --dir docs/adr
```

It speaks JSON-RPC over stdio, so you normally point an MCP client at it rather than
running it by hand. Copy-pasteable client configs follow.

### Claude Desktop

Edit `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`). Claude launches
servers from an arbitrary working directory, so set `ADRKIT_MCP_CWD` to your repo's
absolute path:

```json
{
  "mcpServers": {
    "adrkit": {
      "command": "npx",
      "args": ["-y", "@adrkit/mcp"],
      "env": {
        "ADRKIT_MCP_CWD": "/absolute/path/to/your/repo",
        "ADRKIT_MCP_DIR": "docs/adr"
      }
    }
  }
}
```

### VS Code

Create `.vscode/mcp.json` in your workspace (VS Code uses the `servers` key and
substitutes `${workspaceFolder}`):

```json
{
  "servers": {
    "adrkit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@adrkit/mcp", "--cwd", "${workspaceFolder}", "--dir", "docs/adr"]
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "adrkit": {
      "command": "npx",
      "args": ["-y", "@adrkit/mcp"],
      "env": {
        "ADRKIT_MCP_CWD": "/absolute/path/to/your/repo",
        "ADRKIT_MCP_DIR": "docs/adr"
      }
    }
  }
}
```

### GitHub Copilot CLI

Add to `~/.copilot/mcp-config.json` (user-level) or `./.copilot/mcp-config.json`
(per-repo). Copilot CLI runs servers from the trusted repo directory, so the default
`cwd` usually resolves correctly:

```json
{
  "mcpServers": {
    "adrkit": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@adrkit/mcp", "--dir", "docs/adr"],
      "tools": ["*"]
    }
  }
}
```

You can also add it interactively with `/mcp add` inside a `copilot` session.

### Configuration reference

| Option | Env | Default | Meaning |
|---|---|---|---|
| `--cwd <path>` | `ADRKIT_MCP_CWD` | `process.cwd()` | Repository root; must canonicalize to a directory containing a readable `.git` entry (a normal clone or a linked-worktree `.git` file). |
| `--dir <path>` | `ADRKIT_MCP_DIR` | `docs/adr` | ADR directory, resolved against `--cwd` and required to stay contained within it (realpath-checked, so a symlink escape is rejected). |

Flags win over environment variables, which win over the defaults. An unusable
configuration exits non-zero with a diagnostic on **stderr** (`2` for an
unparseable flag, `1` for an invalid root/directory) and never starts a transport.
**stdout is reserved for JSON-RPC protocol frames only.**

## The four tools

Exactly four tools, all read-only. Each shares fixed annotations
(`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
`openWorldHint: false`), returns a deterministic human-readable summary line in
`content[0].text`, and carries a `findings` page with the corpus's own
parse/validation findings. Every substantive response also includes a
`corpusHealth` sibling: `{ fingerprint, recordCount, excludedCount }`.

Shapes below are the real input/output contracts (see
[`packages/mcp/src/tools`](https://github.com/mbeacom/adrkit/tree/main/packages/mcp/src/tools)).
Each tool's structured output is `{ corpusHealth?, result }`; the objects shown
under "output" are the members of that discriminated `result` union (keyed on
`outcome`). `findings` and every growing array are cursor-paginated (see
[Pagination](#pagination-and-cursor-restart)); `findings` and repeated pagination
fields are elided here for brevity.

### `search_decisions`

Normalized literal substring search over id, title, tags, and body (the graveyard of
superseded/rejected records is included by default). Filters are ANDed:
`status`/`scope` match any-of; `tags` matches all-of.

```jsonc
// input
{
  "query": "postgres",          // required, 1–256 code units, non-empty after trim
  "status": ["accepted"],        // optional, ≤6, any-of
  "tags": ["database"],          // optional, ≤32 tags × ≤64 chars, all-of
  "scope": ["backend"]           // optional, ≤3, any-of
}
// output → single "results" branch (empty results use the same branch)
{
  "outcome": "results",
  "items": [
    {
      "id": "0007",
      "title": "Adopt Postgres",
      "status": "accepted",
      "sourcePath": "docs/adr/0007-adopt-postgres.md",
      "matchedFields": ["title", "body"]   // subset of id | title | tag | body
    }
  ],
  "cursor": null
}
```

### `get_decision`

The complete typed frontmatter + body for one ref.

```jsonc
// input
{ "ref": "0007" }               // AdrRef, 1–128 chars (local id, or a "log:id" federated ref)
// output → discriminated on "outcome"
// found (the full record is nested under "decision"):
{
  "outcome": "found",
  "decision": {
    "requestedRef": "0007",
    "id": "0007",
    "title": "Adopt Postgres",
    "status": "accepted",
    "sourcePath": "docs/adr/0007-adopt-postgres.md",
    "frontmatter": { /* typed YAML: status, tags, affects, relations, ... */ },
    "body": "## Context\n..."
  }
}
// other outcomes:
// { "outcome": "not-found", "requestedRef": "9999" }
// { "outcome": "ambiguous-local-id", "requestedRef": "0007", "candidates": [ /* DecisionSummary[] */ ] }
// { "outcome": "federated-log-unavailable", "requestedRef": "core:12", "log": "core", "id": "12" }
```

A `log:id` federated ref is recognized but **never resolved or substituted** — this
server reads exactly one local corpus.

### `get_decision_context`

Governing / active-proposal / historical decisions for repo-relative `files[]`, via
each record's own `affects` matchers. **Paths are compared against patterns only —
never opened.**

```jsonc
// input
{
  "files": ["src/db/pool.ts", "src/db/schema.sql"]
  // 1–256 entries; each POSIX, 1–1024 chars; no leading "/", no "..", no drive, no "\"
}
// output → single "matches" branch (all three arrays; empty is the same branch)
{
  "outcome": "matches",
  "governing": [
    {
      "id": "0007",
      "title": "Adopt Postgres",
      "status": "accepted",
      "sourcePath": "docs/adr/0007-adopt-postgres.md",
      "firedMatchers": [ { "type": "path", "pattern": "src/db/**" } ],
      "relations": { "supersedes": [], "supersededBy": null, "relatesTo": [], "conflictsWith": [] }
    }
  ],
  "activeProposals": [],
  "history": []
}
```

### `list_superseded`

Every superseded record with its **direct** local replacement state — the tool that
keeps agents from re-proposing rejected paths.

```jsonc
// input (pagination only)
{}
// output → single "entries" branch
{
  "outcome": "entries",
  "items": [
    {
      "id": "0003",
      "title": "Use MySQL",
      "status": "superseded",
      "sourcePath": "docs/adr/0003-use-mysql.md",
      "supersededBy": {            // one of four states:
        "resolved": true,
        "target": { "id": "0007", "title": "Adopt Postgres", "status": "accepted", "sourcePath": "docs/adr/0007-adopt-postgres.md" }
      }
      // unresolved states:
      //   { "resolved": false, "targetRef": "0099", "reason": "dangling" }
      //   { "resolved": false, "targetRef": "0007", "reason": "ambiguous", "candidateCount": 2 }
      //   { "resolved": false, "targetRef": "core:1", "reason": "federated-unavailable", "log": "core", "id": "1" }
    }
  ],
  "cursor": null
}
```

Relation refs (`supersedes`, `supersededBy`, `relatesTo`, `conflictsWith`) are
surfaced verbatim and never expanded — follow them with a second `get_decision`
call. Supersession is reported one hop deep; there is no transitive traversal.

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
independently. A `corpus-unavailable` outcome is returned when the ADR directory
cannot be read.

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
