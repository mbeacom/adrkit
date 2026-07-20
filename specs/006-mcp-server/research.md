# Research: MCP Server (Read-Only Retrieval) — Phase 5

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-20

This document is decision-oriented. Every claim about the MCP protocol or the
`@modelcontextprotocol/sdk` was checked against a first-party source on 2026-07-20 —
the npm registry, the SDK's own `v1.x`-branch source at the exact pinned tag, or
`modelcontextprotocol.io` — and, where the SDK's actual runtime behavior was the
question rather than its documented API, verified empirically by installing the exact
pinned version in an isolated scratch directory and running it. Nothing below is
carried over from general training-time knowledge of older SDK releases without a
2026-07-20 check, because this SDK has changed shape (see R0) since most such
knowledge would have been formed.

---

## R0 — SDK package and version: stable `@modelcontextprotocol/sdk@1.29.0`; v2 is a separate, beta, split-package line

**Decision**: depend on the single, unified, stable `@modelcontextprotocol/sdk`
package at **exact `1.29.0`**, imported only via its `server/mcp.js`, `server/stdio.js`,
`inMemory.js`, and (test-only) `client/index.js` subpaths. Do **not** depend on the
split `@modelcontextprotocol/server` / `@modelcontextprotocol/client` packages.

**Evidence**:
- `npm view @modelcontextprotocol/sdk dist-tags --json` → `{"latest":"1.29.0"}` on
  2026-07-20; `npm view @modelcontextprotocol/sdk versions --json` lists `1.29.0` as
  the highest of 78 published versions, with no `2.x` version ever published under
  this package name.
- The SDK repository's `main` branch README (fetched from
  `raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`)
  states in its banner: *"This is the `main` branch — v2 of the SDK, **now in
  beta**"* (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`),
  targeting the **2026-07-28** MCP spec revision, and: *"We expect a stable release
  alongside the full release of the 2026-07-28 spec... Until then, **v1.x remains
  the supported release for production**; it keeps receiving bug fixes and security
  updates for at least 6 months after v2 ships."* `npm view @modelcontextprotocol/server
  dist-tags --json` confirms the actual published state: `{"latest":"2.0.0-beta.4","beta":"2.0.0-beta.4"}`
  — a beta channel, no `latest`-stable v2 release exists.
- v2 is precisely **beta**, not alpha, and it is architecturally a **split-package
  rewrite** (`@modelcontextprotocol/server`/`client`, Standard-Schema-based tool/prompt
  schemas instead of a Zod-specific API) rather than a point release of the unified
  package. This spec's Assumption A5 is stated as "beta", matching this finding exactly
  — either framing ("alpha" or "beta") would reach the same design conclusion: v2 is
  unstable, pre-1.0-of-its-own-numbering, and explicitly not the production-recommended
  line as of this date — exactly the profile ADR-0007 already treats as disqualifying
  for a build-time dependency ("several are explicitly pre-1.0... coupling the core to
  any of them transfers their churn directly into ours").
- `@modelcontextprotocol/sdk@1.29.0`'s own `package.json`: `license: MIT`,
  `repository: git+https://github.com/modelcontextprotocol/typescript-sdk.git`,
  `engines.node: >=18` (compatible with this project's `>=22` floor),
  `peerDependencies: { zod: "^3.25 || ^4.0", "@cfworker/json-schema": "^4.1.1" }`, with
  `peerDependenciesMeta` marking `zod` required and `@cfworker/json-schema` **optional**
  (satisfied by this workspace's existing `zod@^4`; `@cfworker/json-schema` is not
  installed and is not needed by anything this server imports — R2's subpath-import
  boundary applies to it exactly as it does to the SDK's other unused, HTTP/OAuth-only
  dependencies). `npm audit --json` against a scratch install of exactly this version
  reported `{"info":0,"low":0,"moderate":0,"high":0,"critical":0}` on 2026-07-20.

**Rationale**: ADR-0007/ADR-0010 already commit this project to depending only on
stable, non-pre-1.0 public surfaces wherever avoidable, and to a Node-targeted
published artifact. The unified `1.x` package is the one still documented as "the
supported release for production" by its own maintainers, has a long, otherwise-
unremarkable release history (0.4.0 → 1.29.0 over many minor/patch releases, one
`-beta` prerelease at 1.23.0 that promoted cleanly), and its documented `McpServer` /
`registerTool` / `StdioServerTransport` / `InMemoryTransport` surface (R1) is exactly
what this spec's Assumption A5 already anticipated. Pinning **exact** (no `^`/`~`)
matches this project's existing precedent for a single vetted engine dependency
(`@adrkit/evaluator`'s `jsonpath-rfc9535@1.3.0`, research 005 §R1) and means a
Renovate/Dependabot bump is a reviewed PR, not a silent transitive change to a
protocol-facing dependency.

**Alternatives rejected**:
- *Depend on `@modelcontextprotocol/server`/`client` v2* — rejected: beta, targets a
  spec revision not yet finalized (2026-07-28, still eight days out from this
  research date), and is a different package/API shape this spec did not scope.
  Revisit only after v2 reaches a stable release **and** after this phase has its
  own real-user gate (mirroring the outcome-ladder posture already applied to SDK
  choices elsewhere in this project).
- *Depend on a caret range (`^1.29.0`)* — rejected for the same reason
  `jsonpath-rfc9535` was pinned exact: a protocol SDK is exactly the kind of
  dependency this project wants a reviewed diff for, not an automatic minor bump.
- *Vendor a minimal hand-rolled JSON-RPC/stdio implementation instead of the SDK* —
  rejected: reimplementing the protocol duplicates work the spec's own Assumption A5
  already treats as a given, forgoes the SDK's own conformance with
  `tools/list`/`tools/call`/pagination/annotation shapes (R1), and is exactly the kind
  of "second implementation" this project's own affects-resolution precedent
  (ADR-0009) warns against normalizing away from a canonical one.

---

## R1 — SDK server surface: `McpServer` + `registerTool` + `StdioServerTransport` + `InMemoryTransport`, and how schema validation reconciles with structured errors

**Decision**: use a closure-private `McpServer`
(`@modelcontextprotocol/sdk/server/mcp.js`) with
`registerTool(name, { title, description, inputSchema, outputSchema, annotations },
handler)`, `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`) for the
bin, and `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`)
plus `Client` (`@modelcontextprotocol/sdk/client/index.js`) for in-process tests through
a package-internal builder. The public package exports only
`createAdrkitMcpServer(options)`, which returns a frozen null-prototype
`{ start, close }` handle; the concrete server, registration APIs, low-level server,
internal builder, and transport remain unavailable to consumers. This is first-party
documented (`docs/server.md` on the SDK's `v1.x` branch) and was additionally verified by
installing `@modelcontextprotocol/sdk@1.29.0` + `zod@4` in an isolated scratch project
and exercising it directly (five scratch scripts, referenced by finding below; not part
of this repository).

### R1.1 Tool registration and output-schema shape (verified)

`inputSchema`/`outputSchema` accept either a **raw shape** (a plain object literal of
`{ field: ZodType }`, which the SDK wraps in `z.object(...)` itself) or a full Zod
schema instance directly. Per the MCP spec's own `Tool` data type
(`modelcontextprotocol.io/specification/2025-06-18/server/tools`) and the SDK's
`ToolSchema` (`src/types.ts`): *"`outputSchema`: ... **Must have `type: 'object'` at the
root level per MCP spec**."*

**Finding, verified empirically**: passing a bare, top-level
`z.discriminatedUnion('outcome', [...])` directly as `outputSchema` **is broken** in
1.29.0 — `tools/list` reports `outputSchema: undefined` (the SDK's internal
`normalizeObjectSchema`/`toJsonSchemaCompat` conversion has no root-object form for a
union), and **every** call to that tool — even a call that should succeed — then throws
`Cannot read properties of undefined (reading '_zod')` from inside the SDK's own output
validation and is caught by the SDK's own catch-all into a generic `isError: true`
text-only result. This is not a corner case; it reproduced on the first attempt and
would have shipped a broken server had it not been checked.

**Working pattern, verified empirically**: nest the discriminated union **one level
down**, as the value of a single key in the raw shape — e.g.
`outputSchema: { result: z.discriminatedUnion('outcome', [...]) }`. The emitted
`tools/list` JSON Schema is then a valid root object (`type: 'object'`,
`properties.result.oneOf: [...]`, `additionalProperties: false`), and calls succeed with
`structuredContent: { result: { outcome: '...', ... } }` validating correctly. This was
re-verified with three union variants, arrays of extended object schemas nested inside
variants, and a **reused** Zod schema carrying a cross-field `.refine()` nested two
levels deep (mirroring reuse of `@adrkit/core`'s `AdrFrontmatter`) — all passed through
registration and a real `tools/list` + `tools/call` round trip with no crash and correct
validation. **Design consequence** (data-model.md §6, contracts/tools.md §2): every
tool's `outputSchema` raw shape is `{ corpusHealth: CorpusHealthSchema.optional(),
result: <ToolName>Outcome }`, where `<ToolName>Outcome` is a `z.discriminatedUnion`
nested under `result`, never at the schema root.

### R1.2 Reconciling SDK-level schema validation with FR-015's three structured cases (verified, not hand-waved)

Reading `@modelcontextprotocol/sdk@1.29.0`'s `src/server/mcp.ts` at the exact pinned
tag, the `CallToolRequestSchema` handler `McpServer` installs internally is:

```ts
this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    // ...tool lookup...
    const args = await this.validateToolInput(tool, request.params.arguments, name); // throws McpError(InvalidParams) on Zod failure
    const result = await this.executeToolHandler(tool, args, extra);                  // my handler runs here
    await this.validateToolOutput(tool, result, name);                                // throws McpError(InvalidParams) on schema mismatch — SKIPPED when result.isError
    return result;
  } catch (error) {
    if (error instanceof McpError && error.code === ErrorCode.UrlElicitationRequired) throw error; // irrelevant here
    return this.createToolError(error instanceof Error ? error.message : String(error));            // { content: [text], isError: true } — NO structuredContent
  }
});
```

`validateToolOutput` additionally contains `if (result.isError) { return; }` — output-
schema conformance is **only enforced when the result is not an error**.

This was verified empirically end to end (not just read): an unknown extra field, a
value over a declared `z.string().max(256)`, a wrong-typed field, and a custom
`.refine()` rejecting `..`/absolute/drive-qualified/empty `files[]` entries **all**
surfaced as `{ isError: true, content: [{ type: 'text', text: 'MCP error -32602:
Input validation error: ...<exact Zod issue path/message>...' }] }`, produced entirely
by the SDK **before** the tool handler ran at all — never a raw, unhandled exception,
and never a bare JSON-RPC protocol-level error reaching the caller as something other
than a `CallToolResult`. A handler that threw a plain `Error` was caught the same way.
A handler returning `isError: true` with **no** `structuredContent`, and separately one
returning `isError: true` with an arbitrary **off-schema** `structuredContent`, both
passed through completely unvalidated. A handler returning a non-error result whose
`structuredContent` violated the declared `outputSchema` was itself caught and
converted to the same `isError: true` text-only shape (a safety net against *this
server's own* implementation bugs, never something a caller can trigger by supplying
adversarial input, since output-schema mismatches at the wire boundary while `isError`
is false can only be produced by miscoded server logic — see contracts/tools.md §3).

**Design consequence — the two-tier error model** (contracts/tools.md §3):

1. **Raw input-shape violations** (unknown/extra field, wrong type, over a bound the
   Zod input schema declares, or a semantic-but-string-shaped violation expressed as an
   input-schema `.refine()` — e.g. `files[]` path-traversal/absolute/drive-qualified/
   empty) are **not handled by this server's own code at all**. They are FR-015 case
   (a) satisfied entirely by the SDK's own `validateToolInput`, "before any corpus
   access" (FR-012/FR-030) by construction, because the handler never runs. The result
   is a genuine `CallToolResult` (satisfying "a structured, actionable tool result... not
   a raw, unhandled exception") whose `content[0].text` names the tool and echoes the
   exact violated Zod issue; it carries no `structuredContent`, which is accepted
   because FR-016's "findings must be part of structured content" duty is scoped to
   findings encountered *while answering* a well-formed call — a call this malformed
   never reaches "answering" at all.
2. **Everything else that is anticipated and name-able** — an ambiguous unqualified id,
   a well-formed empty search, a decision-context match with zero results, an invalid,
   mismatched, or stale pagination cursor (contracts/pagination-and-cursors.md), or an
   unavailable corpus at call time — is modeled as an **ordinary, non-error,
   fully schema-validated branch** of the same `outcome` discriminated union every
   substantive answer uses (never `isError`). This is a deliberate choice, not the only
   one the SDK would allow: it keeps every anticipated condition inside the one
   SDK-enforced contract (so a coding mistake there is caught the same way a malformed
   success would be, per the safety net above), gives callers exactly one place
   (`structuredContent.result.outcome`) to branch on regardless of which of the three
   FR-015 cases applies, and reserves `isError` for the narrow, genuinely exceptional
   set: the SDK's own pre-handler rejections, and an unanticipated internal exception
   (which the SDK's own catch-all still turns into a well-formed, non-crashing result —
   never a raw exception — even though this server does not construct it directly).

**Alternatives rejected**:
- *Throw a custom `McpError(ErrorCode.InvalidParams, ...)` from inside a handler for
  anticipated conditions (ambiguous id, invalid cursor)* — rejected after verifying it
  is behaviorally identical to throwing a plain `Error`: the same outer catch-all
  converts it to `{ isError: true, content: [text] }` with no `structuredContent`,
  which would then fail FR-016 for exactly the conditions (findings-adjacent,
  anticipated) that most need structured detail. `McpError` is reserved for the one
  sentinel this server never uses (`UrlElicitationRequired`); ordinary anticipated
  conditions gain nothing from throwing it over returning a typed union branch, and
  lose `structuredContent`.
- *A single generic `{ ok: boolean, error?: string }` output shape* — rejected: FR-015
  explicitly forbids conflating usage errors, empty results, and findings into "a
  single generic failure shape"; a flat boolean cannot express which of the three
  applies without a second, redundant field, and loses the SDK's own schema
  enforcement on the substantive payload.
- *Flat object with an `outcome` enum plus a pile of `.optional()` fields, no true Zod
  union* — considered and rejected in favor of the nested-union pattern above:
  functionally works (also verified) and is one level shallower, but the emitted JSON
  Schema cannot express "these fields are required together for this outcome" the way
  `oneOf` variants can, which matters for the "strict... discriminated outcomes"
  requirement this design is explicitly asked to satisfy precisely.

### R1.3 Tool annotations (verified against `ToolAnnotationsSchema`, `src/types.ts`)

`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` are each
`z.boolean().optional()`; the SDK's own doc comments state
`destructiveHint`/`idempotentHint` are "meaningful only when `readOnlyHint == false`."
All four tools declare `readOnlyHint: true, destructiveHint: false, idempotentHint:
true, openWorldHint: false` per the binding design direction. Declaring
`destructiveHint`/`idempotentHint` explicitly is harmless and improves the annotation's
legibility as a complete, accurate statement (FR-014) even though the SDK's own
comment marks them as informative-only once `readOnlyHint` is `true`; `openWorldHint:
false` is the one annotation doing real work here — it is the accurate declaration
that this server's domain of interaction is the one configured corpus, never anything
beyond it (FR-008, FR-014).

### R1.4 `InMemoryTransport` (verified against `src/inMemory.ts` at the pinned tag)

`InMemoryTransport.createLinkedPair(): [InMemoryTransport, InMemoryTransport]` returns
a `[clientTransport, serverTransport]` pair; connecting an SDK `Client` to one and an
`McpServer` to the other lets a test call `client.listTools()`/`client.callTool()`
against the real registered handlers with no subprocess, no stdio framing, and no
filesystem beyond whatever fixture corpus the test itself points at. This is the
mechanism data-model.md and quickstart.md use for the fast in-process test/example path,
and is exactly what the binding design direction and this spec's contracts require.

---

## R2 — Package placement and dependency vetting: `@adrkit/mcp` is a first-party surface package, one new public dependency

**Decision**: `packages/mcp/` (`@adrkit/mcp`), a peer of `@adrkit/cli`, `@adrkit/ci`, and
`@adrkit/evaluator` — **not** under `packages/adapters/**`. Its only new public
dependency is `@modelcontextprotocol/sdk` (exact `1.29.0`, R0); it also depends on
`@adrkit/core` (`workspace:*`) and `zod` (`^4`, matching the rest of the workspace).

**Rationale**: Principle III's literal text names `@adrkit/core`, `@adrkit/cli`, and
"the schema" as depending on nothing but the filesystem, workspace packages, and
`zod`/`yaml`. It does not name `@adrkit/evaluator`, `@adrkit/ci`, or (now) `@adrkit/mcp`
— and the project already has a settled precedent for this exact situation:
`@adrkit/evaluator`'s own plan.md Constitution Check reasons that a first-party
**surface** package (not core, not cli, not schema, not an adapter) may depend on one
additional vetted, deterministic, network-free, credential-free public library beyond
`zod`/`yaml`, provided it is individually vetted the way `@adrkit/evaluator` vetted
`jsonpath-rfc9535` (research 005 §R1) and the way this document vets
`@modelcontextprotocol/sdk` in R0/R1 above (license, advisories, maintenance, exact
pin). `@adrkit/mcp` follows that same precedent for the same reason `@adrkit/evaluator`
did: it introduces no new *external integration* (it reads the same git-backed corpus
`@adrkit/core` already parses; the MCP protocol is a local, stdio, in-process
serialization concern, not a network integration ADR-0007 was written to fence off),
so it is not an adapter, and it is small and single-purpose enough not to need its own
package tier.

**A deliberately narrow import boundary, stated precisely rather than left implicit**:
`@modelcontextprotocol/sdk@1.29.0`'s own `dependencies` (not just `devDependencies`)
include `express`, `hono`, `@hono/node-server`, `cors`, `express-rate-limit`, `jose`,
`eventsource`, `pkce-challenge`, `ajv`, `ajv-formats`, and `cross-spawn` — an HTTP/SSE/
OAuth-transport dependency tree, because npm/Bun install a package's **full declared
dependency graph** regardless of which subpath is imported. This project's own
`clean-clone-builds`/`core-has-no-adapter-deps` gates (`scripts/check-deps.ts`) operate
at **declared-manifest** granularity — they check what each *workspace* package
directly declares, not what a third-party dependency's own transitive tree contains —
exactly as they already do for every other dependency in the project (they do not, for
example, recursively vet `zod`'s own transitive tree either). No gate-mechanics change
is needed. What matters, and what this design states explicitly rather than leaving to
inference: `@adrkit/mcp`'s own source imports **only** `@modelcontextprotocol/sdk/server/
mcp.js`, `.../server/stdio.js`, and `.../inMemory.js` in its production code path (plus
`.../client/index.js` in test-only code) — never `.../server/streamableHttp.js`,
`.../server/express.js`, `.../client/*` in the bin, or any OAuth module. Those unused
subpaths' code is installed on disk but never `import`ed, so it never executes; FR-005/
FR-006/FR-011 ("no network listener," "no authentication," "no network access of any
kind") bind to what `@adrkit/mcp`'s own code does, not to what bytes happen to sit
unexecuted in `node_modules`. Building/testing/publishing this package still requires
no credential and no runtime network call, satisfying ADR-0007's actual constraint.

**Alternatives rejected**:
- *Place `@adrkit/mcp` under `packages/adapters/*`* — rejected: it integrates with
  nothing external; it is a reader of the same corpus every other first-party surface
  package already reads. Adapter placement exists for upstreams "permitted to break on
  upstream churn" via runtime-configured discovery (ADR-0007) — the wrong shape for a
  server whose only job is to expose `@adrkit/core`'s existing capabilities over stdio.
- *Vet and adopt only a subset of the SDK by re-exporting hand-picked internals* —
  rejected: the SDK does not offer a slimmer package boundary than subpath imports
  already provide (verified: `exports` includes `./client`, `./server`, `./validation`,
  `./experimental`, and a catch-all `./*`, not a further-split package), and hand-
  slicing internals would create exactly the kind of second, parallel implementation
  this project's affects-resolution precedent already warns against.

---

## R3 — `@adrkit/core`'s current loading surface: the real gap, and the minimal additive fix

**Finding** (grep-verified across `packages/core/src`, `packages/cli/src`,
`packages/ci/src`, `packages/evaluator/src`): two *different* loaders exist in
`@adrkit/core` today, and only one of them is actually used by any shipped code path.

1. `loadCorpus()` / `Corpus { records, byId }` (`packages/core/src/load/corpus.ts`) is
   **fail-fast** — `loadAdrFile` calls `AdrFrontmatter.parse(...)`, which **throws** on
   the first schema-invalid record — and its `byId: Map<string, Adr>` is keyed by the
   bare `record.frontmatter.id` only, so two records sharing a bare id (the only way
   this can occur today; see below) silently overwrite each other. **This function and
   `Corpus`/`byId` are not called by any of `@adrkit/cli`, `@adrkit/ci`, or
   `@adrkit/evaluator`** — confirmed by grep; they remain exported from
   `packages/core/src/index.ts` (so an external consumer could still reach them) but
   are otherwise dead code today.
2. `lintCorpus()` (`packages/core/src/validate/index.ts`) is what every real consumer
   (`adr lint`/`graph`/`explain`/`check`/`evaluate`, `@adrkit/ci`, `@adrkit/evaluator`)
   actually calls. It already does the graceful thing this feature needs: it discovers
   every candidate file (via `expandRecordInputs`, which discovers via `discoverAdrFiles`
   when no explicit `paths` are given, or resolves exactly the given `paths` otherwise —
   both exported from `packages/core/src/load/corpus.ts`), `try`/`catch`es each
   parse+validate individually, pushes a parse/contract `Finding` for anything invalid,
   and returns `{ checked, findings, records }` where `records` contains **only** the
   schema-valid, invariant-checked `Adr[]` — one bad record never blocks the rest, and it
   never throws for a single invalid record. It has **no** `byId` index at all, and its
   own `unique-id` corpus invariant (`validate/corpus-invariants.ts`) flags any bare-id
   collision as an `error`-severity finding **without removing either colliding record
   from `records[]`** — both remain fully present and loadable. This invariant, and
   `lintCorpus` generally, is entirely **local and log-unaware**: it groups by
   `record.frontmatter.id` alone (never by any `log` field) and its dangling-reference
   check (`ids.has(ref)`) tests a raw ref string against that same bare-id set — so a
   genuinely log-qualified ref (e.g. `payments:0012`) never matches, even if the numeric
   id `0012` exists locally. `@adrkit/mcp` relies on exactly this existing, unmodified
   behavior rather than working around it.

**Decision**: `@adrkit/mcp` builds exclusively on `lintCorpus()` — never on
`loadCorpus()`/`Corpus`/`byId` — and this feature makes the smallest possible change
that lets a caller-supplied `ref` string be parsed once, canonically, instead of twice
(independently) as it is today: `@adrkit/core` gains **one new file** with **two new
exported functions**, plus **one migrated caller**. Nothing in `load/corpus.ts` or
`validate/*.ts` is modified; no existing file's *behavior* changes; no dependency
changes anywhere.

**New file**: `packages/core/src/schema/ref.ts`

```ts
export interface ParsedAdrRef {
  readonly id: string;
  readonly log?: string;
}

/** Splits a caller-supplied ref string on its first ':' into a (log, id) pair.
 *  A leading colon or no colon at all is treated as unqualified — returns { id: ref }
 *  (the untouched original string, since it is never split in that case) — identical
 *  observable behavior and object shape to the private `parseRef` already duplicated in
 *  `packages/evaluator/src/rules/no-orphan-refs.ts`, promoted to one canonical,
 *  exported location so it is no longer implicitly re-derived per consumer. */
export function parseAdrRef(ref: string): ParsedAdrRef { /* ref.indexOf(':'); idx <= 0 → { id: ref } */ }
```

Re-exported additively from `packages/core/src/index.ts` via one new
`export * from './schema/ref.ts';` line, alongside the existing thirteen. There is no
`formatAdrRef` — see "Why no inverse function" below.

**The migration this promotion actually requires, done now rather than deferred**:
`packages/evaluator/src/rules/no-orphan-refs.ts`'s private `parseRef` (same `indexOf`,
same `idx <= 0` guard) is replaced by an import of the new `parseAdrRef` — a safe,
one-line-import substitution verified by that rule's own existing test suite passing
unchanged, since the two functions are specified to preserve exact observable behavior
and object shape for every input, not merely to happen to agree on the cases already
tested. ("Byte-identical" is deliberately not the claim: the two source files were never
compared byte-for-byte, and nothing about this promotion requires them to have been — what
matters, and what is specified, is that calling either with the same input string returns
deep-equal objects with the same keys present.) Promoting the logic to a shared export but
leaving the evaluator's own private copy in place would recreate the exact duplication
this project's "no second parser" posture exists to close — this is genuine,
previously-duplicated parsing logic with a second real caller today, not a hypothetical
future one, so deferring the migration to "a separate, optional follow-up" was the wrong
call and is corrected here: the migration ships in the same change that adds the export.

**Why no inverse function (`formatAdrRef`)**: an earlier draft of this research proposed
one, reasoned as "kept for round-tripping an unqualified local id through one shared,
tested function." That reasoning does not survive contact with this feature's actual
call sites: every place this design echoes a ref back to a caller (`GetDecisionResult`'s
`requestedRef`, `SupersededEntry`'s `targetRef`) reuses the caller's or the frontmatter's
own original string verbatim — never reconstructs one from a parsed `{ id, log? }` pair.
`get_decision`/`list_superseded` (contracts/tools.md §§4, 7) each call `parseAdrRef`
exactly once, to detect **whether** a ref is log-qualified, and never need to serialize
one back afterward. Shipping an inverse function with zero production callers in this
feature would be exactly the kind of speculative, unrequested surface this project's
"smallest change that satisfies the task" posture (§3 below) argues against elsewhere in
this same research entry — so it is removed here for the same reason, not added.

**Why this is the whole fix, and why it is smaller than "a new loader"**: `lintCorpus`
already satisfies "returns valid ADRs plus structured per-record findings" completely —
that is what it is. The only genuinely missing piece is a **local, multi-valued `id`
index** (`id` → every record sharing that id — never a canonical log-qualified index,
because this phase has no `log` dimension to index by at all; see the
forward-compatibility note below), and building that from `lintCorpus`'s output is a
six-line loop directly over a field the `Adr` interface already exposes
(`record.frontmatter.id`) — it needs no string-splitting and therefore no shared parser,
so it lives entirely inside `@adrkit/mcp`'s own `src/corpus/projection.ts` (data-model.md
§3), built once per call from that call's fresh `lintCorpus()` result. The one piece
worth promoting into core is `parseAdrRef`, because it is genuine, previously-duplicated
**parsing** logic (the project's own evaluator already needed it and wrote a private
copy) applied to a caller-**supplied ref string** (`get_decision`'s `ref` argument, and
each `superseded` record's `supersededBy` value inside `list_superseded`) — a different
operation from indexing already-loaded records, and the one this project's "no
duplicate parser" posture actually binds to. Its entire job in `@adrkit/mcp` is
detecting **whether** a ref is log-qualified (so the tool can answer
`federated-log-unavailable` instead of attempting a local lookup with it) — never
building or consulting a log-aware index, because none exists.

**The size guard is deliberately not a core addition, and it runs *before* `lintCorpus`,
never after.** Neither `loadCorpus` nor `lintCorpus` caps source file size today, and
this design needs one (FR-012, `record-too-large`). That cap is a **product policy
specific to this one consumer** (64 KiB, contracts/tools.md §8) — `adr lint`/`graph`/
`check` must not silently start excluding large-but-valid records as a side effect of
this feature. `@adrkit/mcp` applies the cap itself, entirely as a **pre-read** step:
it calls the already-exported `discoverAdrFiles(dir, cwd)` directly (the same discovery
`lintCorpus` would otherwise perform internally), `stat()`s each candidate path, and
passes only the paths that are within-limit at that check to `lintCorpus({ paths, cwd })`.
A second `stat()` after `lintCorpus` compares each survivor's `dev`/`ino`/`size`/
nanosecond `mtime` tuple with the pre-read value and rechecks the cap; a mismatch makes
the whole call `corpus-unavailable` / `corpus-changed-during-load`, so a changing or
now-oversized candidate is never returned or fingerprinted as stable. A `stat()` failure
on one candidate (e.g. a permission error or a race-deleted file) becomes its own
structured, path-only finding; a failure discovering the ADR directory itself (it does
not exist, is not a directory, or is not readable) is corpus-wide unavailable, not a
per-file finding. This ordering prevents files already known to be oversized from
entering core's unbounded read path and prevents a normal stat-to-read race from leaking
an oversized or internally inconsistent record into a response. It does not claim that
a file which grows during core's `readFile()` was never read; it rejects that provisional
load before output. This adds no new `@adrkit/core` export and touches no existing one;
`discoverAdrFiles` was already exported before this feature.

**A verified implementation pitfall this design must special-case, not merely note**:
reading `packages/core/src/load/corpus.ts`'s `expandRecordInputs` directly shows `if
(!paths || paths.length === 0) { return discoverAdrFiles(dir, cwd); }` — an **empty**
`paths` array is treated identically to **no** `paths` argument at all, and both fall
back to a fresh, unfiltered `discoverAdrFiles(dir, cwd)` call. If the pre-read guard
above excludes every discovered candidate (the corpus's one file is oversized, say),
naively calling `lintCorpus({ paths: [], cwd })` would silently **re-discover and
re-include** the exact file the guard just excluded, defeating it for that specific edge
case. `@adrkit/mcp` therefore special-cases zero within-limit paths by skipping the
`lintCorpus` call entirely and returning zero records with only the guard's own findings
(data-model.md §3.3) — this is not an edge case a reviewer should have to infer; it is
observable by reading `expandRecordInputs` directly, and a design that called
`lintCorpus({ paths: keptPaths })` unconditionally would have silently reintroduced
exactly the bug this guard exists to close.

**Forward-compatibility, stated precisely — this phase defers federation completely,
not partially**: `Adr.log` (`packages/core/src/schema/adr.schema.ts:315`) is a real,
typed, optional field on the runtime `Adr` interface — but grep-confirmed, **nothing in
`@adrkit/core` today ever sets it**; every record `loadCorpus`/`lintCorpus` produces has
`log === undefined`, and this server's own discovery (via `discoverAdrFiles`) is
non-recursive over the one configured ADR directory, so there is no way for this phase
to observe more than one named log from what it actually loads even in principle. This
design does **not** carry a vestigial `(log ?? "", id)` tuple through its index "ready to
degrade gracefully" the moment core starts populating `.log` — that framing was
considered and is deliberately rejected (see Alternatives Rejected): it would keep a
structural placeholder for a capability this phase does not build, test, or specify, and
the review guidance for this correction is explicit that named-log/multi-repository
federation is deferred **completely**, governed by the root `plan.md`'s own open
question, not quietly half-designed here. Concretely: the local index is `id → readonly
Adr[]`, full stop; two records sharing a bare `id` (an authoring mistake today, or
whatever a future same-corpus, multi-log design would eventually need to distinguish)
are exactly the "zero/one/many" `ambiguous-local-id` case FR-022 already requires, with
no log-shaped hook reserved for later. If `@adrkit/core` ever starts populating `.log`
for a genuine multi-log corpus, resolving it is new, out-of-scope design work for that
future feature, not a field this phase's index already accommodates.

**Alternatives rejected**:
- *Fix `loadCorpus`/`Corpus`/`byId` in place* — rejected: not needed (nothing calls it),
  and touching it would be a change to `@adrkit/core`'s existing exported surface this
  task explicitly asks to avoid; leaving it exactly as-is is strictly safer.
- *Add an inverse `formatAdrRef(log, id)` alongside `parseAdrRef`* — rejected, and
  corrected from an earlier draft of this research: no call site this feature actually
  builds ever needs to reconstruct a `log:id` string from parsed parts (§3, "Why no
  inverse function"). Every ref this design echoes back to a caller is the original,
  caller- or frontmatter-supplied string, reused verbatim. An unused inverse function
  would be speculative surface, not a promotion of proven, duplicated logic — the
  opposite of the standard `parseAdrRef` itself is held to.
- *A new `loadCorpusForMcp()`-style function in `@adrkit/core` that re-implements
  discovery + parse + validate + index in one call* — rejected: this would be a second,
  parallel corpus loader alongside `lintCorpus`, risking exactly the kind of drift
  ADR-0009's "no second resolver" posture warns against for `affects`; every existing
  consumer's behavior must stay provably identical, which is easiest to guarantee by
  changing nothing they call.
- *Push the byte-size cap into `@adrkit/core` as a `lintCorpus` option* — rejected: it
  would change `adr lint`/`graph`/`check`'s observable behavior (a new, silently-
  applicable exclusion path) for a policy that belongs to exactly one consumer.
- *Apply the size guard after `lintCorpus` returns, by `stat`-ing each returned record's
  path* — rejected, and corrected from an earlier draft of this research: it would mean
  `lintCorpus` (and therefore `parseAdrFile`) already read and parsed an oversized
  file's full bytes before this server decides to exclude it, which is exactly the "never
  read into an unbounded response" property FR-012 forbids weakening. Pre-reading via
  `discoverAdrFiles` + `stat()`, then calling `lintCorpus({ paths })` with only the
  survivors, is the only ordering that keeps the guarantee genuine.
- *Retain a `(log ?? "", id)`-shaped index with a single, deterministically-chosen
  "representative" record per key even when more than one record shares a bare id* —
  rejected: an arbitrary representative is precisely the "silent choice" FR-022
  forbids; every consumer of the local index gets the full bucket (`readonly Adr[]`)
  and decides zero/one/many for itself.
- *Call `lintCorpus({ paths: keptPaths, cwd })` unconditionally, including when
  `keptPaths` is empty* — rejected after tracing `expandRecordInputs`: an empty array is
  treated identically to "no `paths`," silently re-triggering a full, unfiltered
  `discoverAdrFiles` and reintroducing every file the guard just excluded — exactly the
  bug the special case above exists to close, not a theoretical concern.
- *Defer migrating `no-orphan-refs.ts` to a separate, later change* — rejected: the
  duplication this promotion exists to close already has a second, real caller today;
  shipping the export without its one known consumer migrated leaves the duplication
  exactly as it was, just with an unused third copy of the same logic sitting beside it.

---

## R4 — Reusing `resolveAffects`: per-record invocation to keep matches unambiguous

**Decision**: `get_decision_context` reuses `@adrkit/core`'s existing, pure
`resolveAffects({ records, changedFiles, snapshots, log })`
(`packages/core/src/affects/index.ts`) unchanged — the exact function `adr check`,
`adr explain`, and `@adrkit/ci` already call — but calls it **once per record**
(`records: [oneRecord]`) rather than once for the whole corpus, and never supplies a
`log` value (consistent with FR-035: this phase configures no log identity for the
server at all).

**Rationale**: `resolveAffects`'s `AffectsMatch` result carries only `recordId: string`
(`record.frontmatter.id`, bare) and `firedMatchers[]` — not a reference back to the
`Adr` object itself. When the corpus contains two records sharing a bare id (R3 — the
only way this happens today), a single batched call across the whole corpus could
return two `AffectsMatch` entries with the **identical** `recordId`, and nothing in
`resolveAffects`'s public contract promises a stable, documented way to re-associate
each match with the specific record that produced it (the array happens to preserve the
input-record iteration order before its own internal final sort, but that is an
implementation detail of a function this package does not own, not a contract to depend
on). Calling `resolveAffects` once per record trivially removes the ambiguity — each
call's `matches` array has zero or one entries, and if one, it is unambiguously that
record — at the cost of `O(records)` calls instead of one, which is immaterial at this
project's actual corpus sizes (tens to low thousands of records) and does not change
`resolveAffects`'s semantics, inputs, or purity in any way (ADR-0009's per-ADR
union-not-winner match semantics are per-record by definition already; calling it per
record does not alter what "matches" means). Findings returned per call (e.g.
`affects-unresolvable` for a `package` matcher with no snapshot) are this tool's
**derived** findings (data-model.md §3.5): concatenated across all per-record calls,
then merged with `CorpusProjection.corpusFindings` into this call's own
`responseFindings`, re-sorted canonically, and only then paginated (contracts/
pagination-and-cursors.md) — `CorpusProjection` itself is read, never written to, by this
step.

**A disclosed, existing-behavior consequence of passing no `log`**: `AffectsMatcher.repo`
(schema-documented as "Qualifier for federated logs. Omit for same-repo.") makes
`resolveAffects`'s own, unmodified `matcherAppliesToLog` check (`!matcher.repo ||
matcher.repo === log`) skip any matcher whose `repo` is set whenever `log` is
`undefined` — and it skips it **silently**, with `continue` before any match/finding
logic runs, unlike a `package`/`entity`/other unbacked matcher, which still produces an
explicit inert/informational finding. Because this phase never configures a `log`
(FR-035), any `repo`-qualified `affects` matcher on any record therefore never fires and
never contributes a finding through `get_decision_context`, exactly as `adr check`/
`adr explain` already behave for the same input today — this is existing, unmodified
`@adrkit/core` behavior this design relies on rather than a new gap, but it is stated
here explicitly so a future reader does not mistake "no match, no finding" for a bug:
resolving `repo`-qualified matchers is the same out-of-scope, federation-adjacent
capability named in [Assumption A1](../spec.md#assumptions).

**Alternatives rejected**:
- *One batched call, reconstruct association by array position* — rejected after
  tracing `resolveAffects`'s implementation: the reconstruction would depend on an
  internal iteration-order detail of a function this package does not own and whose
  contract does not promise it: fragile, and the exact kind of thing "do not hand-wave"
  is warning against.
- *One batched call, reconstruct association via `find(r => r.frontmatter.id ===
  match.recordId)`* — rejected: silently wrong under id collision (returns the first
  match, which is exactly the "silent first match" FR-022 forbids, just relocated into
  `get_decision_context` instead of `get_decision`).
- *Fork `resolveAffects` to also return the source `Adr`* — rejected: this is exactly
  the "no duplicate... affects matcher" the task guards against; the per-record call
  achieves the same correctness using the function exactly as published.

---

## R5 — Search normalization: trim → NFKC → locale-independent `toLowerCase()`

**Decision**: `normalize(s) = s.trim().normalize('NFKC').toLowerCase()`, applied
identically to the query and to every searchable field (id, title, each tag, body)
before a literal substring comparison. No stemming, fuzzy matching, locale collation,
embeddings, or per-field/per-record weighting (FR-026).

**A whitespace-only query is an input-contract rejection, not a match-everything
query.** `search_decisions.query`'s input schema requires `query.trim().length >= 1`, in
addition to the raw `1–256` code-unit bound (contracts/tools.md §5, §8) — checked, and
rejected as an ordinary input-shape violation (FR-015 case (a), before any corpus
access), independently of the raw-length check. This closes a real correctness gap an
earlier draft left open: a raw bound of `min(1)` alone accepts a string of one or more
space characters, which then normalizes to the empty string; `String.prototype.includes('')`
is `true` for every string, so an un-guarded whitespace-only query would silently match
**every** record in the corpus, which is a fundamentally different (and wrong) result
from "no query supplied" or "query matched nothing." Requiring non-emptiness after
`trim()` — not merely non-emptiness of the raw input — closes this before the query ever
reaches the matching step.

**Rationale, first-party per ECMA-262**: `String.prototype.toLowerCase()` (no argument)
is defined by the ECMAScript specification to apply the Unicode default case-conversion
algorithm and is explicitly **not** locale-sensitive — that is the specific, narrower
`String.prototype.toLocaleLowerCase()`, which *is* locale-sensitive (the canonical
example being Turkish `İ`/`i`/`I`/`ı`) and is exactly what this design must avoid,
because a locale-sensitive fold would make search results depend on the server
process's runtime locale — a hidden, environment-dependent input this project's
determinism posture (Principle IV, extended by this spec's FR-004/FR-026) cannot admit.
Plain `toLowerCase()`/`String.prototype.normalize('NFKC')` are core ECMA-262/Unicode-
data-table built-ins implemented directly in the JS engine (V8, in both Node and Bun);
neither requires Node's `--with-intl=full-icu` flag or any ICU data bundle — that
requirement is specific to `Intl.*` and the `toLocale*` family, not to `normalize()` or
plain case folding. This makes the three-step pipeline portable and reproducible across
Node 22, Node 24, and Bun with no build flag or bundled-data dependency, satisfying
FR-039/FR-040's clean-clone/Node-targeted requirements as a byproduct of using only
engine-builtin, non-ICU string operations.

**Order**: trim first (strip incidental caller whitespace before it can affect
normalization), then `normalize('NFKC')` (fold compatibility variants — e.g. full-width
forms, some ligatures — into their canonical composed form), then `toLowerCase()`
(case-fold the already-normalized codepoints) — the exact order the binding design
direction specifies, and the sensible general order (normalize codepoints, then fold
case on the result) rather than the reverse.

**Alternatives rejected**:
- *Accept any raw `query` of length >= 1, relying on normalization alone* — rejected and
  corrected from an earlier draft: as described above, a whitespace-only raw query
  normalizes to `''`, which matches every record via `includes('')` — a silent,
  surprising, effectively-unbounded result for what looks like a narrow, specific query.
  Validating `query.trim().length >= 1` in the input schema itself closes this before
  matching ever runs.
- *`toLocaleLowerCase()` / `Intl.Collator`-based comparison* — rejected: introduces a
  hidden, runtime-locale-dependent input into a channel FR-014/FR-026 require to be
  deterministic and closed-world; two identical calls on two different locale-configured
  hosts could disagree.
- *NFC instead of NFKC* — rejected: NFC only canonically composes; NFKC additionally
  folds compatibility variants, which is the more forgiving, more useful choice for a
  literal-substring search surface and is what the binding design direction specifies.
- *Stemming or fuzzy matching* — rejected outright by FR-004/FR-026/A2: this phase is
  deterministic literal matching only; a ranking heuristic is a future, explicitly
  out-of-scope, probabilistic feature (Out of Scope).

---

## R6 — Pagination cursors and the corpus fingerprint

**Decision**: every cursor is an opaque (by protocol convention, not by any
confidentiality guarantee — see Rationale), base64url-encoded, versioned, JSON envelope —
never a raw offset or a raw query echoed back — bound to (a) a **corpus fingerprint**
covering `records`/`corpusFindings`/`corpusHealth` and (b) a **hash of the exact
query-shape parameters** (`qh`) it was minted against, so that a corpus change or a
parameter change between pages is caught explicitly rather than silently gapping or
duplicating results. See contracts/pagination-and-cursors.md for the full wire format,
the exact fingerprint algorithm, and the field-scoping rules (which input field a given
cursor is valid in). Summarized here:

- **The one comparator this feature defines**: a fixed, locale-independent code-unit
  comparator, `compare(a, b) = a < b ? -1 : a > b ? 1 : 0` over plain JS strings (which
  compares by UTF-16 code unit, never by `localeCompare`'s locale-sensitive collation).
  `@adrkit/mcp` uses this **one** function everywhere an order matters: the canonical
  `(id, sourcePath)` record/result order (contracts/tools.md §2), every `matchedFields`
  array, and — the reason it is introduced here — recursively sorting object keys when
  building the canonical JSON below. `@adrkit/core`'s own `sortFindings()`
  (`validate/findings.ts`) is **not** reused for any of this, because it calls
  `String.prototype.localeCompare`, which is locale-sensitive and therefore not the
  deterministic, environment-independent ordering this feature's fingerprint and
  pagination guarantees depend on; `lintCorpus`'s own `localeCompare`-ordered findings
  array is accepted as **input** (an already-deduplicated, already-structured set) and
  then **re-sorted** by `@adrkit/mcp`'s own comparator — using the same field-priority
  tuple `sortFindings` already uses (`rule`, then `id ?? ""`, then `pattern ?? ""`, then
  `path ?? ""`, then `field ?? ""`, then `message`) but comparing each field with the
  code-unit comparator instead of `localeCompare` — before it is fingerprinted, paginated,
  or returned on any tool's `findings` channel.
- **Fingerprint scope: corpus findings only, not every tool-derived finding.** SHA-256,
  hex-encoded, over the **canonical JSON serialization** (object keys sorted recursively
  with the code-unit comparator above, no whitespace) of exactly:

  ```ts
  {
    records: /* every valid, within-limit record, in canonical (id, sourcePath) order */
      readonly { sourcePath: string; frontmatter: AdrFrontmatter; body: string }[],
    corpusFindings: /* @adrkit/mcp's own re-sorted findings for THIS PROJECTION ONLY —
                       lintCorpus's own findings plus the pre-read guard's own findings;
                       never a tool-derived finding (below) */ readonly Finding[],
    corpusHealth: { recordCount: number; excludedCount: number },
  }
  ```

  This is the **wire-relevant corpus projection**, not raw file bytes and not "every
  finding any tool could ever produce for this call": it hashes exactly the parsed,
  structured corpus data every tool's response is built *from* (the same
  `frontmatter`/`body` `get_decision` echoes verbatim, the same `corpusFindings` every
  tool folds into its own response, the same counts `corpusHealth` reports) — so it
  changes on every change to the **corpus projection** itself, and requires no second
  file read, because every value it hashes is already in hand once
  `loadCorpusProjection` has run (`lintCorpus`'s own parse step already produced
  `frontmatter`/`body` for every within-limit record; the pre-read guard and
  `lintCorpus` together already produced `corpusFindings` and the two counts). It is
  deliberately insensitive to a raw *frontmatter* formatting edit that parses to an
  identical `AdrFrontmatter` object (key order, quoting style, incidental whitespace
  inside the YAML block) — hashing the parsed object, not the YAML bytes, is what makes
  that true — and, by the same reasoning, insensitive to a change in an oversized
  candidate's raw bytes as long as the file remains oversized under the same path (its
  contribution to the projection stays "excluded, `record-too-large`, this `path`"
  either way — hashing the parsed/derived projection, never raw bytes, is what makes
  *that* true too) — while remaining fully sensitive to any change in `body` (the raw
  Markdown text is echoed verbatim with no normalization, so any byte of it changing
  changes the fingerprint), any change in `sourcePath`, any change in which files are
  discovered at all, and any change to a corpus finding or either health count.

  **What the fingerprint deliberately excludes, and why that is still safe**: a
  tool-derived finding — `get_decision_context`'s per-record `resolveAffects` findings,
  `list_superseded`'s `superseded-target-ambiguous`/`superseded-target-federated-unavailable`
  findings (data-model.md §3.5) — is never part of the hashed value above. An earlier
  draft of this research described the fingerprint as covering "the complete findings
  set for this call" and claimed it "changes on every change observable through any tool
  result or finding"; both statements are corrected here, because neither was ever true
  for a tool-derived finding, which depends on that call's own substantive inputs
  (`files[]`, or nothing beyond the corpus itself), not on the corpus alone. Excluding
  them from the fingerprint is safe, not merely convenient: each tool-derived finding is
  a **pure, deterministic** function of `(CorpusProjection, that call's own substantive
  inputs)`, and the cursor's `qh` (contracts/pagination-and-cursors.md §4) already
  covers exactly those inputs for the channel being paginated. An unchanged `fingerprint`
  together with an unchanged `qh` therefore already pins down the derived findings
  exactly, with no need to fold them into the hashed corpus projection as well — doing so
  anyway would be redundant at best, and would be actively wrong for
  `list_superseded`'s findings-channel `qh`, which intentionally hashes nothing but
  `findingsLimit` (that tool takes no filter input) — if a tool-derived finding were part
  of the hashed corpus projection, a change to it would need to invalidate every open
  cursor for every tool, including tools whose own inputs never changed, which is not
  this design's intent.

  The canonical JSON serialization and SHA-256 pass are the dominant additional
  per-call CPU/allocation cost introduced by this feature: every call already reads the
  full within-limit corpus through `lintCorpus`, then serializes and hashes that full
  parsed projection even when the requested result is one record. This remains the
  explicitly accepted linear-in-corpus cost for Phase 5's no-cache design.

  An earlier draft of this research also proposed hashing `path + "\0" +
  sha256(fileBytes)` for every discovered candidate file's raw bytes, reusing bytes
  `lintCorpus`'s own `parseAdrFile` already read; that claim is likewise corrected here
  — this design never hashes raw candidate-file bytes. A candidate already oversized at
  the pre-read check is never handed to `lintCorpus`; a candidate that changes during
  loading causes the provisional projection to be rejected before hashing (R3).
- **Cursor payload**: `{ v: 1, scope: '<tool>.<channel>', fp: <fingerprint>, qh: <query-
  shape hash>, offset: <positive safe integer> }`, JSON-encoded with a fixed field order
  and base64url-encoded. `offset` is never `0`: the implicit first page of any channel
  needs no cursor at all, and every minted continuation cursor's `offset` is the prior
  offset (or `0`, for an implicit first page) plus that page's item count, which is at
  least `limit`'s own minimum of `1` — so a genuine, server-minted cursor's `offset` is
  always `>= 1`, and a decoded `0` (or any non-positive or non-safe value) is rejected
  outright as malformed. An **offset**, not an opaque "resume-after key," is safe here
  specifically *because* it is always paired with an exact-match fingerprint check and an
  explicit in-range check: if the fingerprint and query-shape hash both match, the freshly
  recomputed, deterministically sorted candidate array for that call is byte-identical to
  the one the offset was issued against, and an explicit `offset < array.length` check
  (contracts/pagination-and-cursors.md §2, step 8) catches an offset that was never
  validly issued against that exact array — so slicing at that offset cannot drift, gap,
  duplicate, or read past the end.
- **Two independent cursors per call**: every tool's input carries a primary-channel
  `cursor`/`limit` pair and an independent `findingsCursor`/`findingsLimit` pair
  (contracts/pagination-and-cursors.md §4) — "how result and findings cursors coexist"
  is exactly this: both are minted against the same fingerprint but distinct `scope`
  values and query-shape hashes, and track independent offsets into two
  independently-sorted, independently-paginated arrays, so a caller can walk one channel
  to completion without being forced to walk the other. **Every supplied cursor is
  always decoded and verified — never silently skipped** because a call's substantive
  outcome turns out to have no channel for it to apply to; see the decode/verify order
  below and contracts/pagination-and-cursors.md §5 for exactly when a primary cursor
  applies and when it does not (`get_decision`'s `found`/`not-found`/
  `federated-log-unavailable` outcomes have no primary channel at all).
- **Decode/verify order**: base64url-decode → parse as JSON strictly → check `v` is a
  version this build understands → check `scope` matches the specific input field (and
  tool) the cursor arrived in (a findings-cursor value presented in the primary `cursor`
  field, or a cursor scoped to a different tool entirely, is rejected, not silently
  reinterpreted) → check `fp` equals this call's freshly computed fingerprint → check
  `qh` equals this call's freshly computed query-shape hash → (primary cursor only)
  check this call's resolved substantive outcome actually has a paginated primary
  channel for this scope to apply to → recompute that channel and check the offset is
  still in range → only then use `offset` as an array index. Any failure at any step is
  the shared `invalid-cursor` outcome (§R1.2) with a specific `reason`
  (`decode-failed | version-unsupported | wrong-channel | query-mismatch |
  corpus-changed | cursor-not-applicable | offset-out-of-range`) — never a silent
  fallback to page 1 and never a thrown exception.

**Rationale, and what "opaque" actually protects.** MCP itself defines an
**opaque**-cursor convention for its own list methods (`tools/list`, `resources/list`,
etc.) — `modelcontextprotocol.io/specification/2025-06-18/server/utilities/pagination`:
*"the cursor is an opaque string token... Clients MUST treat cursors as opaque tokens:
don't make assumptions about format, don't parse or modify, don't persist across
sessions... Invalid cursors SHOULD result in an error."* This project's four tools never
grow in number, so there is no protocol-level `tools/list` pagination need — the cursors
this design defines are entirely inside each tool's own `structuredContent`, not the
protocol's own `params.cursor`/`result.nextCursor`, and MCP does not standardize a
tool-result-level pagination shape. This design deliberately mirrors the *idiom*
(opaque, non-parseable, invalid-is-an-explicit-error) for consistency with the rest of
MCP's own vocabulary — a caller is not *meant* to construct, parse, or persist one, and
this design never asks a caller to — while implementing it as an ordinary Zod-validated
string field, base64url-encoded, because nothing in the protocol does this for tool
results already. **Base64url is a plain, reversible encoding, not a cryptographic one**:
it grants zero confidentiality and provides no integrity guarantee on its own; anyone who
reads this document can compute a matching `qh` and hand-construct a plausible cursor
with no help from this server. This design never claims otherwise, and never relies on
that being hard. What actually protects correctness is the strict decode/verify sequence
above, run identically regardless of where the cursor value came from: any mismatch at
any step is rejected as `invalid-cursor`, never silently accepted. This is a
**correctness/staleness** binding, not an authentication or security mechanism — there is
no secret to protect, and a cursor that passes every check can, at most, hand the caller
an in-range offset into their own already-authorized, read-only view of the same corpus
they could otherwise page through one item at a time.

**Alternatives rejected**:
- *Raw numeric offset as a plain input field, no cursor object* — rejected: not
  bound to a specific corpus/query (nothing stops reusing an offset from a completely
  different query against a different corpus state) and not "versioned" (no way to
  evolve the format later without breaking every in-flight cursor silently).
- *An "after last-key" resumption token instead of an offset* — rejected as unnecessary
  complexity: it only pays for itself when the underlying collection isn't guaranteed to
  be byte-identical across calls with a matching fingerprint, which is precisely the
  case this design's fingerprint check already rules out.
- *Encrypt or HMAC-sign the cursor* — rejected: there is no confidentiality or forgery
  concern to defend against — a forged, edited, or hand-constructed cursor can, at worst,
  cause a benign `invalid-cursor` response (a mismatched `fp`/`qh`, an inapplicable
  scope, or an out-of-range offset) or a benign in-range offset into the caller's **own**
  already-authorized view of the same read-only corpus; it can never widen access, skip
  validation, or reach a different corpus. Signing would add real implementation cost
  (key management, for a server with no other secret to manage) to close a threat this
  design does not have.
- *Reuse `@adrkit/core`'s `sortFindings()` directly for the findings channel's order and
  for canonical-JSON key sorting* — rejected: `sortFindings` compares with
  `String.prototype.localeCompare`, whose result can vary by the server process's
  runtime locale (ICU data, `Intl` defaults) — the same category of hidden,
  environment-dependent input R5 already rules out for search normalization. A
  fingerprint or a page boundary that could differ between two otherwise-identical
  processes purely because of a locale setting would silently break the "byte-identical
  on repeat calls" guarantee this contract exists to provide; the one-line, engine-builtin
  code-unit comparator has no such dependency.
- *Hash raw candidate-file bytes (the earlier draft's approach) instead of the parsed
  wire projection* — rejected and corrected (see the Fingerprint bullet above): it
  requires reading every candidate file's bytes, including candidates already known by
  the pre-read size guard (R3) to exceed the response policy, and it does not actually match
  "changes whenever the corpus projection changes" as precisely as hashing the parsed
  projection does (e.g. it would falsely change on a no-op frontmatter re-serialization
  that alters YAML byte layout without altering the parsed result).
- *Fold every tool-derived finding into the hashed corpus projection* — rejected and
  corrected from an earlier draft that implied this by describing the fingerprint as
  covering "the complete findings set for this call": doing so would make a
  `get_decision_context` cursor invalidate on a `files[]` change that is already fully
  captured by that channel's own `qh`, would make `list_superseded`'s cursor
  (deliberately `findingsLimit`-only in its `qh`) either need a redundant, corpus-scoped
  hash input it does not otherwise need or silently stop noticing a change it should
  notice, and conflates a corpus-scope concern (the fingerprint) with a call-scope
  concern (`qh`) that this design otherwise keeps cleanly separated (contracts/
  pagination-and-cursors.md §4; data-model.md §3.5).
- *Silently ignore a primary cursor whenever the call's outcome resolves to a
  non-paginated singleton* — rejected and corrected from an earlier draft, which reasoned
  "there is nothing to resume, so a stale value there cannot surface as a spurious
  failure." That reasoning trades away a real signal for a marginal convenience: a
  `get_decision` caller who supplies a `cursor` expecting an `ambiguous-local-id` page and
  instead silently gets a clean `found`/`not-found` answer has no way to tell "your cursor
  was ignored" from "there was never anything to page through," which can mask a client
  bug (a caller that assumed a previous, no-longer-ambiguous ref was still ambiguous).
  Explicitly reporting `invalid-cursor` / `cursor-not-applicable` in that specific case
  costs one extra branch and is honest about what happened instead.

---

## R7 — Startup configuration and CLI conventions: `adrkit-mcp --cwd <path> --dir <path>`

**Decision**: a dedicated bin, `adrkit-mcp`, distinct from the existing `adr` CLI bin,
accepting `--cwd <path>` (default `process.cwd()`) and `--dir <path>` (default
`docs/adr`, resolved relative to `--cwd` unless absolute) — reusing `lintCorpus`'s own
`{ cwd, dir }` parameter names exactly, and matching the CLI's existing `--dir docs/adr`
convention verbatim (`packages/cli/src/index.ts`'s `runLint`/`runGraph`/`runCheck`, all
`{ dir: { type: 'string', default: 'docs/adr' } }`). Optional environment-variable
fallbacks `ADRKIT_MCP_CWD` / `ADRKIT_MCP_DIR` are accepted (CLI flags win when both are
given) for harnesses that configure subprocess launches via an environment map more
naturally than argv. No other startup input exists — no log-identity setting, no
backing-snapshot path, no port, no config file (FR-035).

**Rationale**: `grep`-confirmed, no existing `@adrkit/*` bin exposes a `--cwd` flag
today — every CLI command implicitly uses `process.cwd()` and only varies `--dir`. This
is a deliberate, justified departure from that specific precedent, not an accidental
one: the CLI is invoked by a human from inside the repository being governed, so
`process.cwd()` is already correct; an MCP server is launched as a subprocess by a
third-party agent harness (ADR-0010) whose own working directory is not guaranteed to
be — and in general-purpose harnesses commonly is not — the governed repository root.
An explicit, separately-nameable `--cwd` decouples "where the harness happened to start
the subprocess" from "which corpus this server answers for," which is exactly the
boundary FR-008/FR-035 need to be unambiguous about. `--dir` is reused verbatim because
nothing about it needs to change: it is already exactly "the ADR directory, relative to
the root," under a different name for "root" only.

**Root and directory validation at startup — realpath-based, path-segment-safe
containment, and why it needs no shell-out**: `--cwd` (after resolving flag → env var →
`process.cwd()` default) MUST canonicalize, via `fs.realpath`, to a directory that is
readable and contains a readable `.git` entry directly beneath it — `fs.stat`/`fs.access`
on `<canonicalCwd>/.git`, accepting either a **directory** (an ordinary clone) or a
**file** (a linked worktree's `.git` file, which contains a `gitdir:` pointer rather than
being the object database itself — this server only needs to confirm the entry exists
and is readable, not parse or follow that pointer). No `git` CLI invocation or other
shell-out is required or performed; this is a plain filesystem check, consistent with
FR-011's "no network access" and this project's general preference for filesystem truth
over shelling out to a tool. `--dir` is then resolved **against** the canonical `cwd` and
must itself canonicalize, via `fs.realpath`, to a readable directory whose canonical path
equals or is **path-segment-safely contained within** the canonical `cwd` — computed as
`path.relative(canonicalCwd, canonicalDir)` and rejecting unless that value is empty or
its first segment is not `..` (never a plain `startsWith()` string-prefix test, which a
sibling directory sharing a name prefix — e.g. `/repo` vs. `/repo-secrets` — would
defeat). An absolute `--dir` that does not fall under `cwd`, a `--dir` whose resolved
path escapes `cwd` via a `..` traversal segment, and — the gap a purely lexical check
like the one above misses — a `--dir` that is, or whose canonical resolution passes
through, a **symlink** that lands outside `cwd` are all rejected identically: all are
"unusable configuration" (FR-036), not a corpus-content problem. `fs.realpath`
specifically is what catches the symlink case: it resolves every symlink on the path,
including in intermediate segments, before the containment check ever runs on the two
canonical strings, so a `dir` string that reads as perfectly contained lexically (no
literal `..`) but resolves through a symlink to somewhere outside `cwd` is still caught.
This closes the startup-time lexical/symlink gap FR-008/FR-009 already close for
tool-input paths. It does not by itself claim an atomic filesystem snapshot.

**Startup establishes an expected canonical root; every load revalidates all path
boundaries.** The public handle performs no I/O at construction. Its `start()` validates
`cwd`/`dir`, retains the immutable configured strings plus the expected canonical root,
and only then constructs the private server and stdio transport. Before and after every
core load, the implementation re-realpaths and validates both configured paths, requires
the fresh root to equal the startup root, and repeats the `.git`, readability, and
segment-safe containment checks. Each discovered candidate is additionally
`lstat`-checked as a regular non-symlink, realpath-contained in the fresh ADR directory,
and bigint-`stat` checked for `dev`/`ino`/`size`/nanosecond-`mtime` equality across the
load. Any observed difference discards the complete projection.

These are portable Node `>=22` consistency checkpoints, not a lock or uniform atomic
open-beneath/no-follow guarantee. A hostile swap that occurs and reverts entirely
between checkpoints while core performs a path-based read cannot be proven absent and
is explicitly outside this phase's guarantee.

**A separate bin, not a subcommand of `adr`**: `adr` is today a purely one-shot,
argument-in/exit-code-out program with zero long-running subcommands; `adrkit-mcp` is a
process that blocks on `stdin` for its entire lifetime. Mixing those two operational
shapes under one entrypoint (`adr mcp`) would make `adr`'s own usage/exit-code contract
ambiguous (what does `adr mcp --help` exit with, if the process is meant to run
forever?) for no benefit — the two are launched by different callers (a human's shell
vs. an agent harness's subprocess spawner) for different reasons, and this spec's
Assumption A4/A6 already frame `@adrkit/mcp` as its own package, not a CLI feature.

**Alternatives rejected**:
- *No `--cwd`, rely on the harness setting the subprocess's working directory
  correctly* — rejected: shifts a correctness-critical, security-relevant boundary
  (FR-008: "no tool input may expand, redirect, or escape [the corpus] boundary") onto
  every harness's launch configuration getting `cwd` exactly right, with no way for this
  server to state or verify what it is actually rooted at.
- *A `.adrkitrc`/config-file convention* — rejected: FR-035 fixes configuration to
  "startup-only" via "environment variables, CLI flags, or equivalent launch
  configuration," explicitly not a third persistent-file mechanism this phase has no
  other need for, and adding one would be new, unrequested surface area.
- *Shell out to `git rev-parse --show-toplevel`/`git rev-parse --is-inside-work-tree` to
  validate the root* — rejected: it requires a `git` executable on `PATH` (a new,
  unstated runtime dependency this project has otherwise avoided) and a child-process
  spawn for a fact a direct filesystem check already answers; it would also subtly change
  behavior inside a linked worktree depending on which `git` subcommand and version is
  installed, where a plain `.git`-entry check is both simpler and more predictable.
- *Skip root validation entirely and only check `--dir` is readable* — rejected: a
  readable directory that happens not to be a git working tree at all (e.g. a stray
  directory of Markdown files) would silently pass, defeating the "git holds the record"
  posture (ADR-0001) this server's whole premise depends on; requiring a `.git` entry is
  the cheap, direct check that the configured root is genuinely the thing ADR-0001 and
  ADR-0004 are talking about.
- *Check containment on the raw, uncanonicalized `--cwd`/`--dir` strings (reject only a
  literal `..` segment or a leading `/`)* — rejected, and corrected from an earlier draft
  of this research: a lexical-only check is blind to a `dir` that resolves, once symlinks
  are followed, to somewhere outside `cwd` — every character of the configured string can
  look perfectly contained while the real, followed path is not. `fs.realpath` on both
  sides before the containment check is what actually closes this, not an additional
  string pattern to blocklist.
- *Check containment with `canonicalDir.startsWith(canonicalCwd)`* — rejected: a plain
  string-prefix test is fooled by a sibling directory that merely shares a name prefix
  (`/repo` vs. `/repo-secrets`); `path.relative` plus a check that the result's first
  segment is not `..` is the standard, path-segment-safe form of this check.
- *Validate `cwd`/`.git`/`dir` once, at startup only, and trust them for the life of the
  process* — rejected: a long-lived MCP server can outlive a filesystem change to any of
  those paths. Both root and directory are revalidated before and after every load.

---

## R8 — stdio safety and the test strategy that proves it

**Decision**: two independent lines of evidence, mirroring this project's existing
dual bun-test/Node-smoke pattern rather than inventing a third:

1. **In-process** (`bun test`, fast, no subprocess): `InMemoryTransport.createLinkedPair()`
   (§R1.4) drives the SDK's own `Client` against a package-internal concrete-server
   builder that is absent from every public export for the large majority of behavioral
   tests — every tool's
   discriminated-outcome branches, cursor/fingerprint edge cases, and annotation/schema
   shape assertions. This is the primary test surface because it is fast and exercises
   the real registered handlers with no protocol-framing concerns of its own.
2. **Real stdio subprocess** (both `bun test`, against `src/bin.ts` via Bun, and the
   Node-targeted smoke pipeline, against the built `dist/bin.js` under Node 22/24): spawn
   the bin as a child process against a fixture corpus, write one newline-delimited
   `initialize` request followed by one `tools/call` request to its `stdin`, capture
   every byte written to its `stdout`, and assert (a) each line parses as well-formed
   JSON-RPC and (b) the expected response for each request appears — proving, on the
   real transport, that `stdout` carries **only** protocol frames (FR-007), directly
   satisfying `modelcontextprotocol.io`'s own stdio transport rule: *"The server **MUST
   NOT** write anything to its `stdout` that is not a valid MCP message"*
   (`specification/2025-06-18/basic/transports`). Any diagnostic output this server ever
   emits is written to `stderr` only (the spec permits this: *"The server **MAY** write
   UTF-8 strings to its standard error... for logging purposes"*) — though per
   Assumption A7, this phase does not require any log output to exist at all, so the
   simplest compliant implementation emits none, and the no-stdout-pollution test still
   holds trivially.

**Rationale**: this is precedent, not invention — `scripts/smoke-node.mjs` and
`.release/smoke/smoke.mjs` already spawn the built `@adrkit/cli`/`@adrkit/ci` artifacts
as subprocesses under Node and assert on their output; the MCP bin gets the same
treatment plus the one MCP-specific assertion (line-by-line JSON-RPC well-formedness)
neither of those existing checks needs, because neither of them is a long-lived,
bidirectional stdio protocol server. Because the SDK's `StdioServerTransport` reads
`process.stdin` and writes `process.stdout` via standard Node-compatible stream APIs,
and Bun implements those APIs compatibly, the same bin runs correctly under both
runtimes with no separate code path — matching ADR-0010's Bun-for-development/
Node-for-published-artifact split exactly, with Bun used for the fast dev-loop subprocess
test and Node used for the artifact-fidelity smoke test.

**Alternatives rejected**:
- *Only the in-memory test, treat the stdio framing as "the SDK's problem"* —
  rejected: the SDK cannot protect this server from a bug in *this server's own* code
  that writes to `console.log`/`process.stdout.write` directly (bypassing the transport
  entirely) — only a real subprocess-level byte-capture test can catch that class of
  regression, and FR-007/SC-006 are explicit that this must be verified on the actual
  stream, not inferred from using the "right" transport class.
- *A hand-rolled JSON-RPC framing test that reimplements newline-delimited parsing* —
  unnecessary: `StdioServerTransport` already frames correctly (R1); the test only
  needs to assert every captured line is valid JSON, not implement a second parser.

---

## R9 — Why prompts, resources, HTTP/auth, and indexing are excluded

Not four independent choices — one posture, stated once and applied uniformly, per
FR-001–FR-011 and the constitution's Principles I/II/IV:

- **Prompts/resources/subscriptions/sampling (FR-003)**: MCP defines these as
  genuinely separate, optional capabilities from tools
  (`modelcontextprotocol.io/specification/2025-06-18/server/tools` explicitly documents
  tools, resources, and prompts as three distinct primitives with their own capability
  flags) — nothing about exposing four **read tools** requires declaring any of the
  other three, and this spec's scope (plan.md Phase 5 exit criteria: "read tools only")
  is exactly four named tools, not a broader "expose the corpus over MCP" mandate.
  Sampling specifically would mean asking the connected client's model to generate
  content mid-call — a probabilistic step this phase's Principle IV posture forbids
  entering before (or here, at all within) the deterministic retrieval path.
- **HTTP/SSE/auth (FR-005, FR-006)**: `modelcontextprotocol.io`'s own transport spec
  requires Streamable HTTP servers to validate the `Origin` header, prefer binding to
  `127.0.0.1`, and "**SHOULD** implement proper authentication for all connections" —
  a whole security surface (DNS-rebinding protection, auth) that exists only because an
  HTTP transport is reachable by something other than the process that spawned it.
  stdio has none of that surface by construction (the client *is* the process that
  spawned this server); adding HTTP would mean adopting Express/Hono/CORS/host-header
  validation/OAuth machinery this project has zero present need for, purely to satisfy
  a transport this feature does not use — directly the kind of "authenticated, network,
  or service access" ADR-0007's clean-clone posture treats as disqualifying by default.
- **Indexing/caching/database (FR-010)**: ADR-0004 already settles this for the whole
  project — "the CLI and CI action never require the index; `@adrkit/core` performs its
  work against the filesystem alone" — and explicitly names "the MCP retrieval tools" as
  a reader of that same filesystem-or-index reality, never a second writer or a required
  consumer of an index. Building a private cache inside `@adrkit/mcp` would reintroduce
  exactly the "database quietly becomes authoritative" failure mode ADR-0004 was written
  to prevent, one layer down and unreviewed by that record's own reasoning.

---

## R10 — Distribution wiring and side-effect gates

Phase 5 implementation changes the following non-behavioral package/verification
surfaces. Actual publication, tag creation, release-version selection, and
`scripts/release-publish.ts` changes remain excluded:

| File | Change needed when this phase implements |
|---|---|
| `packages/mcp/package.json` (new) | `name: "@adrkit/mcp"`, `bin: { "adrkit-mcp": "./dist/bin.js" }`, `exports["."]` for only the sealed lifecycle factory + types (no internal builder subpath), `dependencies: { "@adrkit/core": "workspace:*", "@modelcontextprotocol/sdk": "1.29.0", "zod": "^4" }` (exact pin on the SDK, `^4` on zod matching the rest of the workspace — R0/R2), `engines.node: ">=22"`, `publishConfig.access: "public"`, `files: ["dist", "README.md", "src"]` — mirroring `@adrkit/evaluator`'s manifest shape field-for-field. |
| `scripts/check-deps.ts` | One new branch in `allowedDependenciesFor`: `'@adrkit/mcp'` → `{ dependencies: {'@adrkit/core','@modelcontextprotocol/sdk','zod'}, devDependencies: {'@types/bun'} }`, mirroring the existing `@adrkit/evaluator` branch exactly in shape. |
| `packages/mcp/test/side-effect-denial-preload.mjs` (new) | A Node preload module (loaded via `node --import`/`--require`) that patches through `createRequire` plus `syncBuiltinESMExports()` and throws on the enumerated network APIs; filesystem write/create/truncate/rename/copy/remove/directory/link/permission/ownership/time APIs in callback, sync, promise, stream, and returned-`FileHandle` forms; write-capable `open` flags; child-process/cluster/worker/native-addon paths. A Bun companion traps `Bun.write`, file writer/delete, spawn/spawnSync, and shell access. The same tests start the built server, call all four tools, retain full-sandbox/parent-sentinel/`HOME`/`TMPDIR` snapshots, and report only bounded executed-path evidence. |
| `scripts/release-pack.ts` | One new `RELEASE_PACKAGES` entry (`name: '@adrkit/mcp'`, `directory: 'packages/mcp'`, `expectedFiles` mirroring evaluator's list plus `dist/bin.js`, `workspaceDependencies: ['@adrkit/core']`), one new assertion mirroring the existing CLI-only `packedManifest.bin?.adr === './dist/index.js'` check (`packedManifest.bin?.['adrkit-mcp'] === './dist/bin.js'`), and a new import+functional check appended to the generated `.release/smoke/smoke.mjs` template inside `prepareSmokeProject`. |
| `scripts/release-publish.ts` | No change: it already publishes `manifest.artifacts` in the order `release-pack.ts` produced them, so the new entry's position in `RELEASE_PACKAGES` alone determines publish order. |
| `scripts/smoke-node.mjs` | A new section: import the built `packages/mcp/dist/index.js` factory and assert it returns only the sealed `start`/`close` handle; spawn the built `packages/mcp/dist/bin.js` under Node and side-effect denial against this repository's own real `docs/adr/` corpus, send initialize/list plus one call per tool, and assert well-formed responses with zero non-protocol `stdout` bytes (R8). |
| `.github/workflows/ci.yml` | **No direct edit** — `clean-clone-builds`'s `bun run --filter='*' build/lint` and `bun test`, and `node-smoke-built-artifacts`'s `node scripts/smoke-node.mjs` / `.release/smoke/smoke.mjs`, already pick up any new workspace package generically once `scripts/smoke-node.mjs` itself is updated (previous row). |
| `docs/RELEASING.md` | Add a `@adrkit/mcp` \| npm row to the distribution table; extend "Packages publish in dependency order: core, evaluator, CLI" to name `@adrkit/mcp` at the end of that list (it depends only on core, so its position relative to evaluator/cli is not functionally constrained, but appending it preserves the list's existing chronological-addition ordering). |
| Root `package.json` | **No change required** for workspace discovery — `workspaces: ["packages/*", "packages/adapters/*"]` already globs any new `packages/mcp/` directory. |

**Clean-clone interpretation after Constitution v1.0.2.** With Bun 1.3.14
preinstalled, `bun install --frozen-lockfile` may contact only the unauthenticated
public package registry and must use committed `bun.lock` plus the repository
`bunfig.toml` settings. Networking is then disabled for build, typecheck, tests, lint,
release-pack generation, installed-tarball smoke, built Node 22/24 smoke, and server
execution. A warm global package cache is neither required evidence nor a substitute
for the frozen public install.

**Exact side-effect APIs exercised by the denial harness.** Node coverage includes
callback, sync, and `node:fs/promises` forms where present:

- filesystem content/mutation: `write`, `writev`, `writeFile`, `appendFile`,
  `createWriteStream`, `truncate`, `ftruncate`, `rename`, `copyFile`, `cp`,
  `unlink`, `rm`, `rmdir`, `mkdir`, `mkdtemp`, `link`, `symlink`, `chmod`,
  `fchmod`, `lchmod`, `chown`, `fchown`, `lchown`, `utimes`, `futimes`, and
  `lutimes`; plus `open`/`openSync`/`promises.open` when flags permit write,
  append, create, truncate, or update;
- returned `FileHandle`: `write`, `writev`, `writeFile`, `appendFile`, `truncate`,
  `createWriteStream`, `chmod`, `chown`, `utimes`, `sync`, and `datasync`;
- process/runtime escape: every `child_process` spawn/exec/execFile/fork sync and
  async form, `cluster.fork`, `new worker_threads.Worker`, and `process.dlopen`;
- network: `fetch`, net/http/https/dgram connect/request/get/socket/listen paths;
- Bun: `Bun.write`, `Bun.file(...).writer()`, `Bun.file(...).delete()`,
  `Bun.spawn`, `Bun.spawnSync`, and static rejection of Bun shell imports/member
  use when no reliable patch point exists.

Passing proves only that the exercised startup and four-tool paths invoked none of
these enumerated JavaScript-level APIs. It is defense-in-depth evidence, not proof
against raw native syscalls or future unenumerated runtime APIs.

**How the preload actually intercepts a builtin — verified empirically, not a
hand-wave (checked directly for this correction, `node -v` `v22.22.2`).** Simply
reassigning a property on the object returned by `require('node:http')` is not
sufficient *in every ordering*: Node lazily constructs each builtin's ES Module facade
the first time anything actually does `import 'node:http'` (or a named/default import
from it) in the process, and the docs for `module.syncBuiltinESMExports()` demonstrate,
and this research independently re-verified with two small scratch scripts, exactly
when that matters.

- **Scratch script 1** (patch via `require()` *before* anything has ever imported
  `node:http` as an ES Module, i.e., a `--require` preload running ahead of the rest of
  the program — the intended deployment shape for this harness): the later `import {
  request } from 'node:http'` already observed the patched function, **even without**
  calling `syncBuiltinESMExports()` — because the ESM facade did not exist yet at patch
  time, so its first construction simply reads the already-patched object.
- **Scratch script 2** (patch via `require()` *after* the process has already done
  `await import('node:http')` once — i.e., the ESM facade already exists, exactly the
  shape Node's own `module.syncBuiltinESMExports()` documentation example walks through):
  the SAME later `import('node:http')` call returned the **stale, cached facade** —
  calling the "patched" `request` on it did **not** throw; it attempted a real
  `ECONNREFUSED` TCP connection instead, a real, observable network-call leak. Calling
  `syncBuiltinESMExports()` immediately after the patch, and only then, made the same
  cached facade observe the patched function and throw as intended.

The conclusion this research draws from both results together: whether a bare
`require()`-side patch alone is already sufficient depends on an internal, undocumented
ordering (has anything materialized this builtin's ESM facade yet?) that this design has
no reliable way to guarantee holds for every builtin, every Node minor version, and every
possible module-graph shape `@modelcontextprotocol/sdk` or its dependencies might exercise
in the future. Calling `syncBuiltinESMExports()` unconditionally, immediately after every
patch, removes that dependency entirely — it is a documented no-op when the facade did not
exist yet, and it is load-bearing, demonstrated-necessary correctness when it did. The
preload therefore, for every builtin function it intercepts: (1) obtains each target
builtin's real, mutable CJS exports object via `createRequire(import.meta.url)` (or, if
the preload itself runs as CJS under `--require`, via a plain `require()`) — this is the
same live object `http`/`https`/`net`/`dgram` are backed by everywhere in the process,
CJS or ESM; (2) reassigns the specific functions to intercept (`request`, `get`,
`connect`, `createConnection`, `createSocket`) directly on that object, and separately
patches `net.Server.prototype.listen` (a shared prototype **method** on a class object,
reachable identically regardless of how a caller imported `net`/`http`/`https`, since a
prototype is one shared object with no separate ESM-namespace snapshot to go stale — this
one target genuinely needs no `syncBuiltinESMExports()` call, unlike the named function
exports above); and (3) calls `syncBuiltinESMExports()` (`node:module`) immediately after
every property patch, unconditionally, so that `import { request } from 'node:http'`
elsewhere in the same process (including inside `@modelcontextprotocol/sdk`'s own
compiled output, wherever and whenever it happens to import a builtin from) is guaranteed
to observe the patched, throwing function, never a stale cached one. `globalThis.fetch`
needs none of this — it is a plain global, not a builtin module export, so reassigning it
directly is sufficient.

**What this harness actually proves, stated at the same confidence level the tests
support — no more.** A pass means: across the specific executed code paths exercised by
starting the stdio server and calling each of the four tools once, no JavaScript-level
call to any enumerated network, filesystem-mutation, subprocess, worker, native-addon,
or Bun-shell entry point occurred. This is genuine, defense-in-depth,
**executed-path** evidence — meaningfully stronger than the declared-dependency
allow-list alone, because it observes runtime behavior rather than inferring it from a
manifest. It is deliberately **not** claimed as proof that no network access could occur
through any conceivable channel: a native Node addon, a worker thread with its own,
separately-patched global scope, a raw file-descriptor/syscall path bypassing every
patched JS-level API entirely, or a future SDK version routing through a builtin this
list does not yet name, would all fall outside what this specific harness observes. This
project's `@adrkit/mcp` source imports no native addon and spawns no worker thread
(R2: only the SDK's `server/mcp.js`/`server/stdio.js`/`inMemory.js` subpaths, plus
`client/index.js` in test-only code), so those particular escape hatches are closed by
import discipline rather than by this harness — the harness and the import-discipline
check are deliberately two different, complementary lines of evidence for that reason,
neither claimed sufficient alone. Together — the direct-declaration allow-list (what this
package declares), the import-discipline check (which of the SDK's own subpaths this
package's code actually imports), and this preload harness (which network-capable
JS-level entry points actually execute) — they satisfy this phase's no-network contract
(FR-011) to the standard "no network access of any kind, verified by executed-path
evidence at every layer this design controls" — not to the stronger, and here
unclaimed, standard of a formal proof that no imaginable channel exists in the runtime
underneath it.

**Why `check-deps.ts` alone is not sufficient evidence of "no network access," stated
precisely (SC-013)**: `checkDependencyRules` (confirmed by reading
`scripts/check-deps.ts` directly) reads each workspace package's **own** `package.json`
`dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` sections and
compares each declared entry against a per-package allow-list — a **direct-declaration**
check, exactly as it already operates for every existing package (it does not, for
example, walk `zod`'s own transitive tree either — R2). Extending it with an
`@adrkit/mcp` branch proves this package declares only `@adrkit/core`, the pinned SDK,
and `zod` — a real, useful, mechanical guarantee — but it does **not**, by construction,
inspect what code the SDK's own transitive dependencies (`express`, `hono`, `jose`,
`ajv`, `cross-spawn`, etc. — R2) would do if ever invoked, because that question is about
runtime import/execution behavior, not declared manifests. This phase therefore treats
FR-002/FR-011 as proven by complementary checks: the direct-declaration allow-list
(what this package declares), import-discipline/static rejection (which escape surfaces
source can reach), the side-effect-denial preloads (which enumerated APIs execute), and
independent complete disposable-sandbox/parent-sentinel/`HOME`/`TMPDIR` snapshots.
No one check is sufficient; together they cover declared, reachable, executed, and
observable filesystem surfaces at the bounded defense-in-depth confidence stated above.

**The one genuine deferred scheduling decision this research surfaces (not a design
ambiguity or Phase 5 implementation task)**: `docs/RELEASING.md`'s own stated release guarantee is "all public package
versions are identical." Introducing `@adrkit/mcp` as a fourth public package therefore
forces a coordinated version bump of `@adrkit/core`, `@adrkit/evaluator`, and
`@adrkit/cli` to whatever version `@adrkit/mcp` first ships at, at the moment it first
ships — a real release-scheduling decision (which version, and whether it lands in the
same release as other in-flight changes to the other three packages), not a technical
unknown. This is named here as exactly the "release-version timing" item flagged in the
completion summary, deliberately left for the maintainer to decide at actual release
time. Phase 5 adds distribution/pack/smoke/docs wiring only; it does not choose a version,
publish, tag, or change `scripts/release-publish.ts`.

---

## R11 — Fixed limits and their rationale

| Limit | Value | Rationale |
|---|---|---|
| Query length (`search_decisions.query`) | 1–256 raw UTF-16 code units; non-empty after `trim()` | Generous for any realistic search phrase; bounds worst-case normalization/scan cost per call to a small constant multiple of the query length, independent of corpus size. The `trim()`-non-empty check (research §R5) is not a size bound but a correctness one: a whitespace-only raw query would otherwise normalize to `''`, which matches every record. |
| `ref` length (`get_decision.ref`) | 1–128 chars | Comfortably exceeds any realistic `AdrRef` (a numeric id or a ULID, optionally `log:`-prefixed); bounds the cost of the `AdrRef`-grammar `.refine()` check and of `parseAdrRef` per call. |
| Path length (`get_decision_context.files[i]`) | max 1024 chars | Comfortably exceeds real filesystem path-length limits on every OS this project targets, while bounding the cost of the `.refine()` traversal/absolute/drive-letter/backslash checks (§R1.2) per entry. |
| `files[]` count | max 256 entries | A realistic upper bound on "files touched by one PR/plan" (the actual calling scenario, US2) with headroom; bounds the number of per-record `resolveAffects` calls (R4) a single request can trigger to `256 × recordCount`, a known, finite cost. |
| `tags[]` count (`search_decisions.tags`) | 1–32 unique entries when present | An earlier draft left this filter unbounded in count — corrected here: 32 comfortably exceeds any realistic per-query tag combination while bounding the cost of the per-record, all-of tag-membership check (contracts/tools.md §5) to a small constant per record, independent of corpus size. Requiring at least one entry when the field is present (rather than allowing an ambiguous explicit empty array) mirrors the same "if present, non-empty" rule `status`/`scope` already use. |
| `tags[i]` length | 1–64 chars | Matches this project's own slug convention (`^[a-z0-9][a-z0-9-]*$`, `packages/core/src/schema/adr.schema.ts`) with generous headroom over any realistic tag actually authored in a corpus. |
| Result page size | default 20, max 100 | Matches this project's own `mcp-builder` reference guidance ("default to 20-50 items... 20-100 typical") and the general MCP ecosystem convention; small enough that a model consuming results does not need to discard most of a page, large enough that a well-formed query rarely needs more than one or two pages. |
| Findings page size | default 20, max 100 | Same reasoning as result pages, kept numerically identical to avoid a second magic-number pair a caller has to remember; findings are typically far rarer than matches, so this ceiling is rarely reached. |
| ADR source max | 64 KiB | Comfortably above any real, human-authored decision record (the project's own `docs/adr/*.md` corpus is a small fraction of this); large enough that no legitimate record is ever excluded, small enough to bound `get_decision`'s worst-case response size to a small, fixed multiple of one file. This one cap bounds a record's entire source-derived footprint — frontmatter and body together — so it transitively bounds every summary/finding field derived from that record too (data-model.md §3.5); it is not one of two overlapping budgets with pagination, which bounds item counts, not serialized bytes. |
| Cursor max | 4 KiB | The actual minted cursor payload (R6) is on the order of 150–250 bytes base64url-encoded; 4 KiB is pure defensive headroom against an oversized/garbage input string, rejected by the input schema before any decode attempt. |

No value above was adjusted from the binding design direction's own starting point for
the limits it specified — each of those was reviewed against this project's actual scale
and found already appropriate, which is itself recorded here so a future reviewer does
not need to re-derive it. The `tags[]` count and per-tag length limits are new in this
pass, closing a gap an earlier draft left as an unbounded array of unbounded strings.
