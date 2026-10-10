---
schemaVersion: 0.2.0
id: "0055"
title: "Serve a read-only REST API over the SDK in the OCI image, and reach MCP clients through it"
status: accepted
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - architecture
  - server
  - container
  - mcp
  - api
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0007"
  - "0014"
  - "0016"
  - "0018"
  - "0022"
  - "0029"
  - "0031"
  - "0032"
  - "0044"
  - "0051"
  - "0052"
  - "0053"
  - "0054"
  - "0056"
affects:
  - type: path
    pattern: "packages/server/**"
  - type: path
    pattern: "Containerfile"
  - type: path
    pattern: "scripts/container-entrypoint.sh"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  decidedAt: 2026-10-10T16:17:54Z
---

# ADR-0055: Serve a read-only REST API over the SDK in the OCI image, and reach MCP clients through it

> **Status: accepted.** Agent-drafted, ratified by `@mbeacom` on 2026-10-10. It depends on
> [ADR-0053](./0053-implement-adrkit-sdk-over-core-s-kernels-and-accept-an-in-repo-consumer-as-its-r.md)
> (an implemented `@adrkit/sdk`) and pairs with
> [ADR-0054](./0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
> (the portal bundle it serves) and
> [ADR-0056](./0056-ship-the-azure-deployment-surface-as-terraform-in-a-separate-repository-behind-a.md)
> (the deployment that syncs its corpora and puts a gateway in front of it).
>
> **This server authenticates no one.** In its first version it must run on
> localhost or behind a gateway that does (ADR-0056 uses Azure API Management).
> It binds `127.0.0.1` unless told otherwise.

## Context

The surfaces that read a decision corpus today are all local: the CLI, the
stdio MCP server, the CI Actions, and the agent plugin. A team that wants one
place to browse decisions across repositories, or an agent that cannot spawn a
local process, has nothing to call. ADR-0056 proposes an Azure deployment for
that case and needs something in this repository to deploy.

Facts that shape the design, each read from the tree at this revision:

1. **The SDK is the contract, and it is a handle.** ADR-0031 makes
   `@adrkit/sdk` the consumer contract. Its declared surface
   (`packages/sdk/src/index.ts`) is one I/O door, `openDecisions`, returning a
   `DecisionSet` with `records`, `issues`, `get`, `queue`, `graph`, and
   `governing`. Its own doc comment names "a Backstage backend serving many
   requests against one corpus" as the reason it is a handle. Nothing is
   implemented yet; ADR-0053 implements it.
2. **A long-lived server is the use the in-repo portal does not exercise.**
   ADR-0053 counts the GitHub Pages portal (ADR-0054) as ADR-0031 clause 8's
   real consumer, and names the gap: the portal is a build-time consumer. A
   server holding a handle across requests is the other half.
3. **The stdio MCP server cannot host a synced corpus.** `@adrkit/mcp`'s
   startup check refuses a root without a `.git` entry (`root-not-git` in
   `packages/mcp/src/corpus/projection.ts`). A deployment that copies only
   `docs/adr` does not satisfy it, and stdio is not reachable remotely in any
   case.
4. **ADR-0018 removed an HTTP stack on purpose.** The MCP SDK v1 line shipped
   Express, Hono, and `@hono/node-server` to a server that never ran them, and
   one of them carried the advisory ADR-0017 could only accept. The v2 server
   package has two dependencies.
5. **The image publishes one target.** ADR-0032 clause 4: the all-in-one
   `adrkit` target is published; `cli`, `mcp`, `ci`, and `queue-action` are
   local isolation targets. Its selector script
   (`scripts/container-entrypoint.sh`) passes any unknown first argument to the
   CLI, so a new selector is additive. The `Containerfile` copies
   `packages/sdk/package.json` but not `packages/sdk/src`.
6. **The stdio MCP container is networkless.** Its documented run is
   `--read-only --network none` with a `:ro` repository mount (README,
   AGENTS.md). An HTTP server is network-facing by construction, so that rule
   cannot carry over whole.
7. **`governing` reads the file at the supplied path** unless
   `readMarkers: false` is passed, to scan for an inbound `@adr` marker
   (ADR-0022). A deployment that holds `docs/adr` holds none of the source
   files those paths name.
8. **The SDK as sketched carries no record body and no commit.** The sketch's
   `DecisionRecord` omits the body deliberately; ADR-0053 decision 11 adds it,
   as raw Markdown, within the SDK's implementation scope. Nothing in the
   surface names the revision a corpus was read at, so the commit has to come
   from outside the SDK (clause 4).
9. **The SDK has no search.** `@adrkit/mcp` has `search_decisions`; the SDK's
   seven entry points do not include one.

## Decision

We will add a private package, `packages/server` (`@adrkit/server`), that
serves read-only HTTP routes over `@adrkit/sdk`, ship it as a `server`
selector in the existing all-in-one image, and make it the first path by
which a remote MCP client reaches adrkit.

1. **Routes, all `GET`.** Under `/api/v1/corpora/{corpus}`: `records`,
   `records/{id}`, `graph` (optional `kinds`, a comma-separated subset of
   `supersedes`, `relatesTo`, `conflictsWith`; without it, the SDK's default
   of supersession edges only), `queue` (optional `asOf=YYYY-MM-DD`), `issues`
   (the corpus findings `DecisionSet.issues` carries, the lint view), and
   `governing?path=<path>`. Plus `/api/v1/corpora` (the configured keys and
   each one's commit), `/openapi.json`, `/healthz`, and the portal at `/`
   (clause 9). Each route is one SDK call and a serialization; the server
   resolves nothing itself (ADR-0029 clause 8). There is no search route until
   the SDK has search, so the remote tool set is not the stdio server's.
2. **No write routes, enforced twice.** Only `GET` and `HEAD` are routed;
   every other method gets 405 with `Allow: GET, HEAD`, and no route reads a
   request body. A test enumerates the route table and fails on any other
   method. A second test applies the regexes of
   `packages/mcp/test/writing-verbs.test.ts` to `packages/server/src`, so
   neither a CLI verb (`accept`, `approve`, `object`, `resolve`) nor a writing
   transition (`acceptAdrSource` and its siblings) can appear. Recording a
   person's act stays a human-run CLI command and a pull request (ADR-0044,
   ADR-0051, ADR-0052). Each test is observed failing against a planted
   violation before it counts (ADR-0016).
3. **Every response names its commit and is deterministic.** Data responses
   are `{ corpus, commit, data }`, with `asOf` added on the queue. For the same
   commit and the same parameters the body is byte-identical: no timestamp,
   request id, or host name in it. `ETag` derives from the commit and the
   canonical query. A queue request without `asOf` uses the UTC date at
   request time and echoes it, so it is deterministic given the echoed value.
   `/healthz` is the one route that is not.
4. **The corpus is a local directory, and the commit comes with it.** The
   server never calls GitHub, never runs `git`, and spawns no process. It reads
   each corpus from a directory that something else populates (ADR-0056's sync
   job, or a person's checkout). The commit SHA comes from a sidecar file the
   populator writes into that directory. That file is the contract between
   this record and ADR-0056, worded identically in both: **`.adrkit-corpus.json`
   is a JSON object holding at least `{ "commit": "<40 hex>" }`, where `commit`
   is the full 40-hex SHA of the tree written; the populator is its only
   writer, writes it last, into a tree written aside and swapped in whole; a
   field added later is additive.** A sidecar is valid when it parses as a
   JSON object whose `commit` matches `^[0-9a-f]{40}$`. A corpus without a
   valid sidecar is not served: its routes answer 503 with a fixed message,
   never an answer without a commit.
5. **A new sync becomes visible by swap, never mid-read.** The server keeps one
   `DecisionSet` per corpus. When the sidecar's commit changes it opens a fresh
   handle, reads the sidecar again, and keeps the new handle only if the commit
   did not move during the load; requests already in flight finish on the old
   one. The populator must write the new tree aside and swap it in whole
   (ADR-0056), so a load never sees half a sync. This reopens per sync, never
   per request, using `openDecisions` alone. If the SDK turns out to need a
   reload or invalidation method for this, that is the signal ADR-0053 lists
   for its handle's shape, and the change belongs in the SDK, not here.
6. **Many corpora, configured, confined.** A read-only JSON config maps a key
   (`^[a-z0-9][a-z0-9-]{0,63}$`, the `{corpus}` path segment) to a directory.
   Each directory is `realpath`-resolved at start and must stay inside a
   configured root, as the agent plugin's `staysInside` does. An unknown key is
   404 with a fixed message. Keys are names a person chose, so `/api/v1/corpora`
   lists them; a deployment that considers repository names private must name
   keys accordingly, because the server has no per-caller view.
7. **`governing` never reads a file.** The server always passes
   `readMarkers: false`. It holds `docs/adr`, not the source tree, so a marker
   scan has nothing to read; passing a path through would also turn a query
   parameter into a file read. Evidence is therefore `affects` matches only,
   and responses say so in a fixed field. The path is supplied by the caller,
   which is ADR-0029's Tier 1; nothing derives it from a catalog. It is
   validated first: relative, no `..` segment, no leading `-`, no control
   character, at most 1024 characters. An `{id}` must match the schema's id
   grammar before lookup. When the corpus has any error finding, the SDK
   returns all three groups empty with the corpus issues, as `adr explain`
   does; the route then returns those issues and a fixed state saying
   resolution was withheld because the corpus has errors, never a bare empty
   result that reads as "ungoverned".
8. **Errors are fixed text.** Every error response is
   `{ error: { code, message } }` with the message looked up by code. No
   stderr, exception message, stack, or file system path reaches a response or
   the access log, mirroring the agent plugin's `publicMessage` rule. A test
   plants a sentinel in a thrown error and in a corpus that fails to load and
   asserts it appears in no response, as
   `packages/adapters/agent-plugin/test/error-text.test.ts` does. Corpus
   findings in `issues` are data, served as the SDK returns them; they are not
   error text. A query value the SDK refuses with a `RangeError` (an
   impossible or non-calendar `asOf`; an empty or unknown `kinds`) is a 400
   with fixed text, validated before the call where the server can.
9. **It serves the portal.** `/` serves the static bundle ADR-0054 builds,
   and the bundle's data file is generated per request from the same loaded
   handle at the same commit as the API, by calling `@adrkit/portal`'s pure
   builder (ADR-0054 clause 3) with the handle, the sidecar's commit, the
   resolved `asOf`, and an empty path table. The server holds no source tree,
   so the governance-by-path view says it has no table and points at this
   server's own `governing?path=` route; every other view is the same on
   both hosts. Letting the server-hosted page call that route itself is
   deliberately left out of the first version: it would give the one
   renderer a network path the Pages host does not have, and a looser CSP. Because the output is a function of commit and
   `asOf`, it can be cached per commit and `asOf`. The server always serves
   `/`; whether a gateway publishes it is the deployment's choice, and
   ADR-0056's first version publishes it in private mode only. ADR-0054 owns
   the bundle being base-path-relative and its renderer's textContent-only
   rule. This server sets the headers, because this is the origin where
   untrusted titles render: `Content-Security-Policy` with
   `default-src 'none'`, `'self'` scripts, styles, and data fetches, and
   `frame-ancestors 'none'` (which ADR-0054 clause 7 relies on, because a
   meta policy cannot carry it), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer`, and no CORS headers. Record bodies in the data file come through the SDK
   (ADR-0053 decision 11), not from a file read here.
10. **`node:http`, no framework.** The package depends at runtime on
    `@adrkit/sdk` and on the private `@adrkit/portal` (for its pure builder
    only), and nothing else; both are workspace packages bundled into the same
    image. Fact 4 is why there is no framework. `scripts/check-deps.ts` gains
    an `@adrkit/server` entry admitting exactly those two, with a negative
    case, so the package is not silently unconstrained. Its source builds with
    `--target=node` and uses no `Bun` global, enforced as
    `packages/cli/test/node-compatibility.test.ts` does for the CLI.
11. **An OpenAPI document is part of the surface.** `/openapi.json` describes
    every route with a stable `operationId`. It is the input APIM's "REST API
    as MCP server" imports, and its operation ids become tool names, so
    renaming one is a break for remote agents. A test fails if the document
    and the route table disagree.
12. **The image gains a selector, not a package.** The all-in-one `adrkit`
    target adds `/opt/adrkit/server.js` and a `server` / `adrkit-server`
    selector in `scripts/container-entrypoint.sh`. A local `server` target
    mirrors `cli` and `mcp` for isolation and SBOM checks. Nothing new is
    published; ADR-0032 clause 4 stands. The build stage copies
    `packages/sdk/src`, `packages/portal/src`, and `packages/server/src`. The
    package is private and rides the lockstep image; it bundles the SDK and
    the portal builder from the same tree, so the
    SDK's independent version (ADR-0031 clause 7) does not enter the image's
    versioning.
13. **Container posture: one way in, no way out, nothing writable.** The stdio
    MCP rule (`--read-only --network none`, `:ro` mount) stays as it is for
    `mcp`. The server keeps everything but `--network none`: a read-only root
    file system, corpora and config mounted `:ro`, the non-root `node` user,
    one listening port (default `8080`), and no outbound connection of its
    own. A test runs the server under a variant of
    `packages/mcp/test/side-effect-denial-preload.mjs` that permits that one
    listener and denies file system mutation, child processes, and outbound
    connections. A writable mount is never part of a documented server run.
14. **Bind localhost by default; no auth in the first version.** The default
    host is `127.0.0.1`, which inside a container is unreachable from outside
    it. Reaching it needs an explicit `ADRKIT_SERVER_HOST=0.0.0.0` (or another
    address). Setting it is the operator asserting that a gateway that
    authenticates, or the host's own loopback, is in front. On a non-loopback
    bind the server logs one fixed warning saying it authenticates no one. The
    README section for this selector leads with that sentence.
15. **Remote MCP goes through the REST API first.** The first remote path is
    APIM's "REST API as MCP server" over these routes (ADR-0056): APIM
    presents the operations as MCP tools, tools only. A native streamable-HTTP
    transport for `@adrkit/mcp` is deferred to a later record. Through APIM, a
    client sees APIM's tools, named by `operationId`, not the stdio server's
    four (`get_decision`, `get_decision_context`, `search_decisions`,
    `list_superseded`), and ADR-0018's dual-era property does not carry over:
    which protocol revisions APIM serves is APIM's. Whether it serves the
    stateless `2026-07-28` era is unmeasured.

## Options considered

### Option A: a read-only `node:http` server over the SDK, in the existing image (chosen)

One renderer for the API and the portal, one image, no new published package,
and the long-lived consumer ADR-0053 says the portal does not provide. Costs
a network-facing process the project has not run before, and a gateway it
does not ship.

### Option B: native streamable-HTTP for `@adrkit/mcp` first

Agents get the four tools they already know, with dual-era serving. But it
gives the portal and other HTTP clients nothing, `@adrkit/mcp` would need a
non-git root mode (fact 3) plus HTTP session and auth handling ADR-0018 kept
out of the package, and APIM's "expose an existing MCP server" path still
needs it. Deferred, not rejected.

### Option C: a separate published image for the server

Narrower SBOM for the deployment. Rejected by ADR-0032's reasoning: a second
registry package, tag set, and recovery path for an entry point the one image
can select.

### Option D: an HTTP framework (Hono, Express, Fastify)

Routing and middleware for free. Rejected: the route table is ten `GET`
paths (six per corpus, plus `/api/v1/corpora`, `/openapi.json`, `/healthz`,
and the portal at `/`),
and fact 4 is a measured cost of exactly this dependency class.

### Option E: shell out to `adr ... --json` per request

No SDK dependency. Rejected: a process per request, and the CLI JSON for
`explain` and `lint` is assembled in the CLI (ADR-0031's own table). It would
also put a child process in a server that otherwise spawns none.

### Option F: authentication in the server

A bearer-token or OIDC check in-process. Deferred: the first deployment
authenticates in APIM (`validate-azure-ad-token`, ADR-0056), and a second,
weaker check here would invite running without the gateway. Revisit if a
non-Azure deployment needs it.

## Trade-offs

- **An unauthenticated server can be exposed by mistake.** Binding `0.0.0.0`
  with a published port and no gateway serves every configured corpus to
  anyone who can reach it, private repositories included. The localhost
  default, the one-line warning, and the README are the only guards in this
  repository; the gateway is ADR-0056's.
- **`governing` is weaker than `adr explain`.** No marker evidence (clause 7),
  so a file governed only by an `@adr` marker shows nothing. Fixed text in the
  response says so; it cannot show what the server cannot read.
- **The remote tool set differs from the stdio one** (clause 15), and there is
  no search. An agent configured for both sees two vocabularies.
- **A new serialization contract.** The route shapes and `operationId`s are a
  surface that remote agents and the portal depend on. They are versioned
  under `/api/v1` and change additively, as ADR-0031 asks of the SDK.
- **The commit is only as true as the sidecar.** The server trusts what the
  populator wrote. A sync job that writes the wrong SHA produces confidently
  attributed answers about the wrong revision.
- **Stale between syncs.** Answers lag the default branch by the sync
  interval; the commit in every response is how a reader tells.

## Consequences

- Easier: one HTTP surface for a portal, a team dashboard, and remote agents,
  every answer pinned to a commit; and a real long-lived consumer of the SDK.
- Harder: a network-facing process to secure and operate, a sidecar contract
  with ADR-0056, an OpenAPI document to keep in step, and a container target
  to add to CI.
- **How we would know this was wrong:** a route accepts a method other than
  `GET`/`HEAD` or changes a file; a response omits the commit, or two
  responses for the same commit and parameters differ; the server makes an
  outbound connection or spawns a process; stderr, a stack, or a path appears
  in an error response; the server binds a non-loopback address without being
  told to; or a deployment reaches it without a gateway because the docs made
  that the easy path.
- **Revisit if:** the SDK gains search; APIM is measured
  with a `2026-07-28` client (either way); a deployment needs in-process
  authentication; or a native streamable-HTTP transport for `@adrkit/mcp` is
  taken up.

## Evidence rung

**None yet; rung 1 at best when built** under ADR-0014. Nothing in this record
is implemented, and it depends on ADR-0053's SDK. Rung 1 would be the unit,
contract, method-guard, verb-guard, error-text, side-effect-denial, and
OpenAPI-agreement tests above, each observed failing first (ADR-0016), plus a
local container smoke. The APIM path (clause 15) is unmeasured, and a
reference-repository or external run does not exist.

## Action items

1. [ ] Create `packages/server` (private) on `node:http` over `@adrkit/sdk`,
   with the routes, envelope, sidecar read, and swap of clauses 1 to 7, and
   its `check-deps` entry (`@adrkit/sdk` and `@adrkit/portal` only) with a
   negative case.
2. [ ] Add the method guard, the verb and transition guard, the error-text
   sentinel test, and the side-effect-denial variant, each observed failing.
3. [ ] Serve `/openapi.json` and test it against the route table.
4. [ ] Serve ADR-0054's bundle and its data file from the loaded handle, with
   the headers of clause 9.
5. [ ] Add the `server` selector and local target to the `Containerfile` and
   `scripts/container-entrypoint.sh`, and a CI smoke under
   `--read-only` with `:ro` mounts.
6. [ ] Agree the `.adrkit-corpus.json` sidecar with ADR-0056.
7. [ ] Document the selector in the README, leading with "this server
   authenticates no one".
8. [ ] Measure APIM's "REST API as MCP server" over these routes with a
   2025-era and a `2026-07-28` client (ADR-0056).
9. [ ] Ratify or reject this record.
