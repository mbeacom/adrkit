---
schemaVersion: 0.2.0
id: "0056"
title: "Ship the Azure deployment surface as Terraform in a separate repository behind APIM Standard v2 with public_access"
status: proposed
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - architecture
  - distribution
  - azure
  - deployment
  - container
  - mcp
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0007"
  - "0014"
  - "0016"
  - "0030"
  - "0032"
  - "0044"
  - "0051"
  - "0052"
  - "0054"
  - "0055"
affects:
  - type: path
    pattern: "packages/server/**"
    note: "Owns the .adrkit-corpus.json sidecar read; the sync job here writes it."
  - type: path
    pattern: "Containerfile"
  - type: path
    pattern: "scripts/container-entrypoint.sh"
    note: "The server selector the deployment invokes by name."
  - type: resource
    pattern: "azurerm_api_management"
    repo: "mbeacom/adrkit-azure"
  - type: resource
    pattern: "azurerm_container_app_environment"
    repo: "mbeacom/adrkit-azure"
  - type: resource
    pattern: "azurerm_container_app_job"
    repo: "mbeacom/adrkit-azure"
  - type: resource
    pattern: "azapi_resource"
    repo: "mbeacom/adrkit-azure"
provenance:
  authoredBy: agent-drafted
externalRefs:
  - type: doc
    url: "https://learn.microsoft.com/azure/api-management/private-endpoint"
    label: "APIM inbound private endpoint: disable public access only after the endpoint exists; v2 custom-domain limit"
  - type: doc
    url: "https://learn.microsoft.com/azure/api-management/virtual-network-concepts"
    label: "APIM networking models by tier (v2 integration, Premium v2 injection)"
  - type: doc
    url: "https://learn.microsoft.com/azure/api-management/manage-mcp-servers-rest-api"
    label: "APIM MCP servers via REST/Bicep/Terraform: azurerm has no native resource, use azapi"
  - type: doc
    url: "https://learn.microsoft.com/azure/container-apps/jobs"
    label: "Container Apps job trigger types and on-demand start"
---

# ADR-0056: Ship the Azure deployment surface as Terraform in a separate repository behind APIM Standard v2 with public_access

> **Status: proposed.** Agent-drafted and not ratified. It deploys what
> [ADR-0055](./0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md)
> builds (the `server` selector of the image
> [ADR-0032](./0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md)
> publishes) and serves the portal bundle of
> [ADR-0054](./0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md).
> The repository it names, `mbeacom/adrkit-azure`, does not exist yet. Nothing
> here has been deployed or measured.

## Context

ADR-0055 adds a read-only HTTP server that authenticates no one and must sit
behind a gateway that does. A team that wants that server reachable, fully
private or deliberately public, needs infrastructure this repository has never
carried. Facts that shape where and how:

1. **This repository federates to no cloud subscription.** Its workflows request
   `id-token: write` for npm Trusted Publishing (`release.yml`), Pages deployment
   (`site.yml`), and container provenance (`container-release.yml`), and for
   nothing else. `docs/repository-trust-operations.md` §4 names merge access as
   the boundary. Adding Azure federation here would widen what a merge can reach
   to a subscription.
2. **ADR-0030 already moves surfaces out.** Its rule keeps a surface here only if
   it adds no install cost, and it narrowed ADR-0007 Option C on a new ground
   rather than claiming ADR-0007's revisit condition (independent contributors)
   was met. Infrastructure code is not an npm install cost, so ADR-0030 clause 1
   does not decide this case by itself; the credential boundary and the
   adopter's use (fork it, or consume it as a module) do.
3. **The server code and image stay here.** ADR-0055 puts `packages/server` in
   this repository and the selector in the lockstep image (ADR-0032 clause 4:
   one published target). A deployment consumes an image tag, not source.
4. **ADR-0055's contract with a deployment is two things:** the sidecar
   written into each corpus directory, populated by swap so a load never sees
   half a sync (its clauses 4 and 5); and the localhost default bind, overridden by
   `ADRKIT_SERVER_HOST` as the operator's assertion that an authenticating
   gateway is in front (clause 14). Its routes are `GET`-only under
   `/api/v1/corpora/...`, plus `/openapi.json`, `/healthz`, and the portal at
   `/`. It `realpath`-resolves each corpus directory at start (clause 6).
5. **Provider facts, each marked.** Verified against Microsoft Learn on
   2026-10-10 unless marked otherwise:
   - **Verified.** APIM Standard v2 supports an inbound private endpoint, and
     combining it with outbound virtual network integration is documented as
     end-to-end isolation. Public network access can be disabled only *after* a
     private endpoint exists, and only on an existing instance, never at
     creation.
   - **Verified.** VNet injection is a Premium v2 feature, configurable only at
     creation, and an instance cannot switch between injection and integration.
   - **Verified.** In Standard v2 and Premium v2, a custom gateway domain must be
     publicly resolvable; the documented workaround for a private name is an
     Application Gateway in front.
   - **Verified.** "REST API as MCP server" is available on Standard v2, exposes
     operations as tools only (no resources or prompts), and is modelled as an
     API of type `mcp` with `apis/tools` children whose `operationId` points at
     the backing REST operation, at API version `2025-09-01-preview` or later.
     The azurerm provider has no native resource for it; Microsoft documents
     `azapi_resource` instead.
   - **Verified.** Terraform Azure Verified Modules exist for Container Apps
     managed environments (`avm-res-app-managedenvironment`) and jobs
     (`avm-res-app-job`; it requires azapi `~> 2.12` and azurerm
     `>= 4.73.0, < 5.0.0`, and pulls a `modtm` telemetry provider). No APIM
     Terraform AVM module surfaced in the search; treat it as absent until
     found.
   - **Verified.** A Container Apps job has exactly one trigger type (`Manual`,
     `Schedule`, or `Event`), and any job can also be started on demand through
     ARM `jobs/{name}/start`, which needs `Microsoft.App/jobs/start/action`.
   - **By omission.** The private-endpoint page's tier list includes classic
     Basic but not Basic v2. This record treats Basic v2 as unable to be private
     on that evidence, not on a statement that it cannot.
   - **Unverified, load-bearing.** azurerm's `public_network_access_enabled` on
     `azurerm_api_management` is documented as applying to the management plane
     only and as required `true` at creation. Microsoft Learn shows disabling
     gateway public access on Standard v2 through the portal only; the REST
     `publicNetworkAccess` property is shown for classic tiers and Premium v2.
     That an ARM update of `publicNetworkAccess` works on Standard v2 is
     unmeasured.
   - **Unverified.** Whether azurerm's `virtual_network_type` and
     `virtual_network_configuration` express v2 *outbound integration* at all.
     Their documentation describes classic injection (port 3443).
   - **Unverified.** Whether APIM passes MCP protocol revision `2026-07-28`
     (ADR-0055 clause 15), and whether a GitHub `X-Hub-Signature-256` HMAC can be
     verified inside an APIM policy.

## Decision

We will ship the Azure deployment surface as Terraform, using azurerm and azapi,
in a separate repository, `mbeacom/adrkit-azure`. It runs ADR-0055's `server`
selector from a pinned image tag in an internal Azure Container Apps environment
behind APIM Standard v2. A `public_access` variable switches the gateway between
fully private and deliberately public.

1. **Repository and tool.** Terraform (azurerm first, azapi where azurerm lags or
   misreports), in `mbeacom/adrkit-azure`, consumable as a root configuration to
   fork and as a module. No Terraform, Bicep, cloud credential, or OIDC
   federation to a subscription enters this repository. This narrows ADR-0007
   Option C on a new ground, the cloud-credential boundary and module-shaped
   adoption, as ADR-0030 clause 6 did. ADR-0007's revisit condition is still
   not met, and this record does not claim it is.
2. **Image.** The deployment pins an immutable `ghcr.io/mbeacom/adrkit:vX.Y.Z`
   tag (by digest where the module allows) and runs the `server` selector. It
   never tracks `latest` or the moving `vX`. It sets
   `ADRKIT_SERVER_HOST=0.0.0.0` inside the internal environment. That is exactly
   the operator assertion ADR-0055 clause 14 describes, made true by clauses 3 and
   6: the only path in is through APIM.
3. **Compute.** One Azure Container Apps environment on workload profiles,
   internal in **both** modes, so flipping `public_access` never recreates the
   backend. The server app runs with minimum replicas 1 (no cold start for MCP
   clients), a read-only corpus mount, ingress internal, and target port 8080.
4. **Corpus sync, and agreement to ADR-0055's sidecar.** A Container Apps job
   with a `Schedule` trigger shallow-clones `docs/adr` of each configured
   repository into an Azure Files share mounted read-only by the server. For
   each corpus key it writes the tree to `<key>.next/`, writes
   `.adrkit-corpus.json` with the cloned commit **last**, then moves `<key>/`
   aside and moves `<key>.next/` into its place, because a rename onto a
   non-empty directory fails on POSIX. A symlink flip is not used, because ADR-0055
   clause 6 `realpath`-resolves directories at start and would never follow it.
   The two moves are not atomic, so a load can find the directory briefly
   absent between them. ADR-0055 clause 5 then keeps serving the old handle, which makes the
   window survivable. Whether directory rename on Azure Files (SMB) behaves this
   way, two moves and the brief absence, is unmeasured and is the first rung-1
   item. **This record agrees to the
   sidecar contract as ADR-0055 clause 4 states it, worded identically in
   both: `.adrkit-corpus.json` is a JSON object holding at least
   `{ "commit": "<40 hex>" }`, where `commit` is the full 40-hex SHA of the
   tree written; the populator is its only writer, writes it last, into a tree
   written aside and swapped in whole; a field added later is additive.** Here
   the populator is this sync job.
5. **Private repositories.** The sync job authenticates as a GitHub App whose
   private key is stored in Key Vault and read by the job's managed identity.
   The App is granted `contents: read` on the configured repositories only. The
   server itself holds no GitHub credential and makes no outbound call
   (ADR-0055 clause 4).
6. **Gateway: APIM Standard v2.** It has an inbound private endpoint with a
   Private DNS zone, and outbound virtual network integration into the subnet
   that reaches the internal environment. It exposes two things, plus clause 9's optional public-mode webhook: the
   `GET` routes of ADR-0055's OpenAPI document (`/api/v1/...`, `/openapi.json`,
   and, in private mode only, the portal at `/`; see clause 8), and an API of type `mcp` whose tools map those
   operations, created with `azapi_resource` because azurerm has none.
   `/healthz` is probed inside the environment and is not published. No
   operation other than `GET`/`HEAD` exists on these APIs. No policy reads
   `context.Response.Body`, because that breaks streaming.
7. **`public_access`, a second step in one apply.** APIM is created with public
   access enabled (Azure requires it). The private endpoint and DNS follow, and
   an `azapi_update_resource` that depends on them sets `publicNetworkAccess`.
   It sets `Disabled` when `public_access = false`, which is the default, and
   `Enabled` otherwise. Terraform orders this within one `terraform apply`. The
   instance is still reachable publicly between creation and the update, so the
   first apply attaches no API until the update has succeeded, and a global
   `ip-filter` denying all is in place from creation. The azurerm attribute
   carries `lifecycle { ignore_changes = [public_network_access_enabled] }`, so
   a plan does not try to revert the flip. Whether the ARM update works on
   Standard v2 is unverified (Context fact 5). If it does not, this clause
   falls back to a documented portal step and the record is revisited.
8. **Public mode adds controls, not routes.** With `public_access = true`, every
   API runs `validate-azure-ad-token` against a configured tenant and audience,
   and `rate-limit-by-key` keyed on the token's subject. Front Door Premium with
   WAF, reaching APIM over Private Link, is optional and off by default. The
   backend, routes, and tools are identical in both modes.
   A browser loading the portal at `/` carries no bearer token, so in public
   mode the token policy alone makes the portal unreachable. The first version
   therefore serves `/` in private mode only and leaves it out of the public
   API. Public portal access would need an interactive sign-in in front, such
   as Front Door or Application Gateway with an identity provider. That is
   unmeasured and is a later change.
9. **The webhook, public mode only, and bounded.** In public mode, an optional
   second APIM API accepts one `POST` from GitHub. It verifies the
   `X-Hub-Signature-256` HMAC in policy, forwards no part of the payload, and
   calls ARM `jobs/start` on the sync job. It authenticates with APIM's managed
   identity, which holds only `Microsoft.App/jobs/start/action` on that one job.
   It is the one non-`GET` route in the deployment. It writes nothing to any
   corpus and records no decision; it can only make the next sync sooner. In
   private mode GitHub.com cannot reach the gateway, so the schedule is the
   only trigger. ADR-0055's commit-in-every-response is how a reader tells how
   stale an answer is. If HMAC verification in policy proves infeasible
   (unverified), the webhook is dropped, not weakened.
10. **Private custom domain needs Application Gateway.** A private custom
    gateway name is out of scope for the first version. A team that needs one
    adds an Application Gateway in front, which is Microsoft's documented
    workaround for the v2 limit. The module exposes the APIM default hostname
    in private mode.
11. **No write path anywhere.** Recording a person's act (`accept`, `approve`,
    `object`, `resolve`) stays a human-run CLI command and a pull request
    (ADR-0044, ADR-0051, ADR-0052). The deployment publishes no route, tool, or
    job that changes a record. The webhook in clause 9 changes only when the
    read-only copy refreshes.
12. **Modules.** Networking: VNet, subnets for the environment, private
    endpoints, and APIM integration, plus Private DNS zones for APIM, Files,
    and Key Vault. Then Log Analytics, the Container Apps environment (AVM where
    it fits), the server app, the sync job (AVM `avm-res-app-job` where it
    fits), and a storage account with a Files share behind a private endpoint.
    Then Key Vault behind a private endpoint, APIM Standard v2 (azurerm for the
    service, azapi for the `publicNetworkAccess` flip, MCP API, and tools, and
    for v2 outbound integration if azurerm cannot express it), and optional
    Front Door Premium.

## Options considered

### Option A: Bicep and `azd` in this repository

This is Microsoft's most-documented path, and every MCP sample comes in Bicep.
Rejected: it puts subscription credentials and OIDC federation into this
repository's trust model (Context fact 1). It also couples a deployment's
cadence to the lockstep release, which ADR-0007 exists to avoid.

### Option B: Terraform in this repository

The same tool as chosen, without a second repository. Rejected for the same
credential reason, and because adopters would vendor a subdirectory of a
TypeScript monorepo to get a module.

### Option C: Terraform in a separate repository (chosen)

This keeps cloud credentials out of this repository and gives the deployment
its own cadence. Adopters can fork it or reference it as a module. The cost is
cross-repository drift on two contracts, handled under Consequences.

### Option D: APIM Premium v2 with VNet injection

The gateway gets a private IP without a private endpoint, and injection covers
inbound and outbound together. Rejected as the baseline: a much higher fixed
cost, and injection is create-time only, so a later change of networking
recreates the instance. Teams already on Premium v2 can adapt the module.

### Option E: APIM Basic v2

The cheapest v2 tier. Rejected: the private-endpoint tier list omits it, so it
cannot meet the fully private mode.

### Option F: Static Web Apps for the portal

A cheap static host. Rejected: it cannot be fully private in the way the gateway
is, and it would be a second renderer host serving a second copy of the data.
ADR-0055 clause 9 already serves the portal from the same handle and commit as
the API.

## Trade-offs

- **The one apply is not atomic.** Between creation and the
  `publicNetworkAccess` update, the instance is publicly addressable. No API is
  attached and an `ip-filter` denies all, but the window exists.
- **azapi is pinned to a preview API version** for MCP resources
  (`2025-09-01-preview`). A breaking change there breaks the MCP half of an
  apply, not the REST half.
- **The webhook is a non-`GET` route.** It is bounded to one job start with no
  payload forwarded, but it is a write-adjacent surface the rest of the design
  avoids, and it exists only in public mode.
- **Two repositories, two cadences.** A server change here can break a
  deployment there with no same-run signal (ADR-0030's accepted loss).

## Consequences

- **Cost.** APIM Standard v2 is a fixed monthly charge whether or not anything
  calls it. Each private endpoint (APIM, Files, Key Vault) bills hourly, plus
  Private DNS zones. Minimum replicas 1 keeps one server replica always on, and
  the workload-profiles environment adds its own charge. Front Door Premium,
  if enabled, is the largest optional line. The README must state these before
  the first `terraform apply`, and none are measured here.
- **Two-step operation.** `public_access` changes in place. The backend is never
  recreated, but the first apply of a new instance always passes through the
  public window above.
- **Drift, and how it is caught.** Two contracts cross the repository boundary:
  the image tag (with its `server` selector and `ADRKIT_SERVER_HOST`) and the
  sidecar. In `adrkit-azure`, Dependabot or Renovate proposes image-tag bumps.
  A CI job there runs the pinned image's `server` selector over a fixture corpus
  written by the sync script, and asserts that `/api/v1/corpora` returns the
  fixture's commit and that a missing sidecar answers 503. It is observed
  failing first against a planted bad sidecar (ADR-0016). That is ADR-0030
  clause 5's conformance-fixture pattern applied to an image instead of a
  package.
- Easier: a private, gateway-authenticated decision API and remote MCP tools for
  teams on Azure, with no cloud credential in this repository.
- Harder: a second repository to maintain, a preview API dependency, and costs
  that accrue while idle.
- **How we would know this was wrong:** a published operation other than `GET`
  or `HEAD` outside the webhook. A server reachable without passing APIM. A
  response whose commit differs from the commit the sync job cloned. The
  `publicNetworkAccess` update failing on Standard v2. A plan that reverts the
  flip. A sync that a load observes half-written.
- **Revisit if:** the ARM flip is unsupported on Standard v2; azurerm gains
  native MCP or v2 outbound-integration support; APIM is measured against a
  `2026-07-28` client; `@adrkit/mcp` gains streamable HTTP (ADR-0055 Option B);
  or adopters ask for a Bicep module.

## Evidence rung

**None yet; rung 1 at best when built** under ADR-0014. Nothing is deployed. The
first rung-1 measurements are the unverified items in Context fact 5: the ARM
`publicNetworkAccess` update on Standard v2, v2 outbound integration through
azurerm or azapi, the two-move swap on Azure Files, HMAC verification in
policy, and APIM's MCP protocol revisions. After those come the drift CI job
above, observed failing first. No reference-repository or external run exists.

## Action items

1. [ ] Create `mbeacom/adrkit-azure` and record its URL here, as ADR-0030 action
   item 6 does for the Backstage surface.
2. [ ] Measure the `publicNetworkAccess` ARM update on a Standard v2 instance,
   and whether azurerm can express v2 outbound integration. Record both here
   and correct clause 7 or 12 if either fails.
3. [ ] Measure the `<key>.next/` two-move swap on an Azure Files share against
   ADR-0055's reload, under concurrent reads.
4. [ ] Land the drift CI job in `adrkit-azure`, observed failing against a
   planted bad sidecar.
5. [ ] Decide the webhook after measuring HMAC verification in APIM policy;
   drop clause 9 if it cannot be verified there.
6. [ ] Publish the cost lines in the `adrkit-azure` README before the first
   tagged release.
7. [ ] Ratify or reject this record.
