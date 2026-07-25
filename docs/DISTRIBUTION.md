# Distribution & discoverability playbook (prepared, not submitted)

This document is a **prepared-submissions playbook** for giving `@adrkit/mcp` and
the `@adrkit/*` CLI presence in the MCP and ADR-tooling ecosystems. It contains
ready-to-paste content and exact procedures.

> **Nothing here has been submitted.** Every outbound action — publishing to a
> registry, opening a PR, filling a form, creating a git tag, or posting anywhere —
> is left for a human to perform. This file only *prepares* those actions.

## Honesty guardrail (binding)

Per [ADR-0014](./adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md),
adrkit is **early**: phases 0–6 are *landed / reference-verified* (rungs 1–2), and
rung-3 external/community validation is **openly not-yet-met**. A registry listing is
**distribution, not adoption**. None of the copy below may state or imply that
adrkit has external adopters, production users, or rung-3 validation. Listing copy
describes *what the tool is and does*, never *who uses it*.

---

## Shared prerequisites

Most venues below ultimately read from the **official MCP registry** or from the
GitHub repo, so a small number of prerequisites unblock several venues at once.

### P1 — npm packages are published

`@adrkit/mcp`, `@adrkit/cli`, `@adrkit/core`, `@adrkit/evaluator` are published at
`0.2.0` (verify with `npm view @adrkit/mcp version`). The MCP registry hosts
*metadata only*; the npm package must already exist at the version named in
`server.json`.

### P2 — `mcpName` marker in `packages/mcp/package.json` (REQUIRED, not yet present)

The official registry verifies npm ownership by requiring an `mcpName` property in
the package's `package.json` whose value **exactly** matches the `name` in
`server.json`. Without it, `mcp-publisher publish` fails with
`Registry validation failed for package`.

**This file is owned by another workstream and has not been changed here.** The
required edit (do not merge until the namespace decision in A1 is final):

```jsonc
// packages/mcp/package.json
{
  "name": "@adrkit/mcp",
  "mcpName": "dev.adrkit/mcp",   // ← add; MUST equal server.json "name"
  // ...
}
```

`server.json` does **not** need to be added to the package's `files` allowlist —
`mcp-publisher` reads it from the working directory at publish time and it is not
required inside the npm tarball.

### P3 — namespace decision (see A1)

The registry namespace determines the ownership-verification method. This choice
propagates to `server.json` `name`, the `package.json` `mcpName`, and every listing
below. Decide A1 first.

### P4 — `adr-kit` (PyPI) name collision — disambiguation

An **unrelated** `adr-kit` package exists on PyPI (a different project). To avoid
confusion in every listing:

- Lead with the scoped npm name **`@adrkit/mcp`** / **`@adrkit/cli`** and the
  registry namespace **`dev.adrkit/mcp`**, never the bare string "adrkit-kit" or
  "adr-kit".
- Where a venue has a one-line description, include "Node/npm" and link
  `https://adrkit.dev` so it is unambiguous this is the JavaScript/TypeScript
  project, not the Python `adr-kit`.
- Recommended disambiguation clause (reuse verbatim): *"Node/npm project
  (`@adrkit/*`); unrelated to the `adr-kit` package on PyPI."*

---

## A. Official MCP registry (`registry.modelcontextprotocol.io`)

This is the highest-leverage venue: **PulseMCP, mcp.so, Glama, and Smithery all
ingest or can ingest from it.** The registry is in public preview.

The manifest is authored at [`packages/mcp/server.json`](../packages/mcp/server.json)
and was validated against the published schema
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
(draft-07) with `ajv` → **VALID**.

### A1 — choose a namespace (this drives everything)

| Path | Namespace / `name` | Ownership proof | Notes |
|---|---|---|---|
| **DNS (recommended)** | `dev.adrkit/mcp` | DNS TXT on the **apex** of `adrkit.dev` | Brandable, matches the homepage, cleanly disambiguates from `adr-kit` on PyPI. **This is what `server.json` currently declares.** |
| **GitHub (simpler)** | `io.github.mbeacom/adrkit-mcp` | GitHub device-flow login | No DNS needed. Requires **editing** `server.json` `name` **and** `package.json` `mcpName` to `io.github.mbeacom/adrkit-mcp`. |

The rest of section A documents the DNS path (matching the committed `server.json`),
then the GitHub fallback.

### A2 — install `mcp-publisher` (human)

```sh
# macOS (Homebrew)
brew install mcp-publisher
# or a prebuilt binary:
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
mcp-publisher --help
```

### A3 — DNS namespace verification (human, DNS path only)

The TXT record **must** sit on the **apex** of `adrkit.dev` (e.g. `adrkit.dev`),
**not** a selector like `_mcp-auth.adrkit.dev` (MCP DNS auth uses SPF-style apex
placement, not DKIM-style selectors).

```sh
# 1. Generate an Ed25519 keypair.
#    NOTE: needs OpenSSL 3.0+. macOS system LibreSSL cannot do Ed25519 in genpkey —
#    use `brew install openssl@3` and call that openssl explicitly.
openssl genpkey -algorithm Ed25519 -out adrkit-mcp-key.pem
PRIVATE_KEY=$(openssl pkey -in adrkit-mcp-key.pem -text -noout | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')
PUBLIC_KEY=$(openssl pkey -in adrkit-mcp-key.pem -pubout -outform DER | tail -c 32 | xxd -p -c 32)

# 2. Publish this TXT record at the apex of adrkit.dev via your DNS provider:
echo "adrkit.dev. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
# Wait for propagation (minutes). If you ever rotate keys, DELETE the old TXT record.

# 3. Authenticate, then publish (run from packages/mcp/, where server.json lives):
mcp-publisher login dns --domain adrkit.dev --private-key "${PRIVATE_KEY}"
cd packages/mcp && mcp-publisher publish
```

> HTTP fallback (if DNS is inconvenient): host
> `https://adrkit.dev/.well-known/mcp-registry-auth` containing
> `v=MCPv1; k=ed25519; p=<PUBLIC_KEY>` and use `mcp-publisher login http --domain adrkit.dev --private-key <key>`.

### A3′ — GitHub namespace verification (human, fallback path)

If using `io.github.mbeacom/adrkit-mcp` instead: first change `server.json` `name`
and `package.json` `mcpName` to `io.github.mbeacom/adrkit-mcp` (an org namespace
`io.github.<org>/…` requires you to be an **Owner** of that org; a personal
namespace `io.github.mbeacom/…` always works). Then:

```sh
cd packages/mcp && mcp-publisher login github   # device flow at https://github.com/login/device
mcp-publisher publish
```

### A4 — verify (human)

```sh
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.adrkit/mcp"
```

### A5 — the committed `server.json`

```jsonc
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "dev.adrkit/mcp",
  "title": "adrkit decision memory",
  "description": "Deterministic, offline, read-only ADR decision memory for coding agents. No model or network calls.",
  "version": "0.2.0",
  "websiteUrl": "https://adrkit.dev",
  "repository": {
    "url": "https://github.com/mbeacom/adrkit",
    "source": "github",
    "subfolder": "packages/mcp"
  },
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "@adrkit/mcp",
      "version": "0.2.0",
      "runtimeHint": "npx",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "ADRKIT_MCP_CWD", "description": "Repository root to read (default: process.cwd()).", "isRequired": false, "isSecret": false },
        { "name": "ADRKIT_MCP_DIR", "description": "ADR directory under the repo root (default: docs/adr).", "isRequired": false, "isSecret": false }
      ]
    }
  ]
}
```

> Keep `version` (top-level) and `packages[0].version` in lockstep with the npm
> release you are publishing. If a new release (e.g. the SDK-CVE patch) bumps
> `@adrkit/mcp`, bump both fields here before re-publishing.

**Listing criteria met?** Yes — schema-valid, npm package exists, stdio transport,
public repo. The only blocker is the human steps above (namespace proof + the P2
`mcpName` edit).

---

## B. Directories that ingest the registry or crawl GitHub

### B1 — mcp.so

- **Process:** web form at <https://mcp.so/submit>. Free tier = queued review,
  nofollow link, no badge; a $39 one-time tier gets immediate publish + verified
  badge (not necessary).
- **Fields:** Repository URL (`https://github.com/mbeacom/adrkit`), Name (`adrkit`).
- **Ready-to-paste name / description:**
  - Name: `adrkit`
  - Repository URL: `https://github.com/mbeacom/adrkit`
  - Description: *Deterministic, offline, read-only ADR (Architecture Decision
    Record) memory for coding agents. Four read-only MCP tools —
    `search_decisions`, `get_decision`, `get_decision_context`, `list_superseded` —
    surface decisions you already made (and rejected) so agents stop re-proposing
    them. No model or network calls. Node/npm project (`@adrkit/*`); unrelated to
    the `adr-kit` package on PyPI.*
- **Prerequisite:** none beyond a public repo.
- **Criteria met?** Yes.

### B2 — PulseMCP

- **Process:** PulseMCP **ingests the official MCP registry daily and processes it
  weekly** (<https://www.pulsemcp.com/submit>). The most reliable path is to
  publish to the official registry (section A); adrkit then appears automatically.
  For edits or to expedite, email <hello@pulsemcp.com> or use the submit form's URL
  field (`https://github.com/mbeacom/adrkit`).
- **Prerequisite:** official-registry listing (recommended) — so **A must land
  first** for the automatic path.
- **Criteria met?** Yes, once A is published. No separate machine format.

### B3 — Smithery

- **Process:** connect the GitHub repo at <https://smithery.ai/new> ("Deploy → From
  GitHub"); Smithery reads a `smithery.yaml` at the **repo root**.
- **Ready-to-paste `smithery.yaml`** (belongs at **repo root** — outside this
  workstream's owned paths; hand to the root/CI owner):

  ```yaml
  # smithery.yaml (repo root)
  startCommand:
    type: stdio
    commandFunction: |
      (config) => ({
        command: 'npx',
        args: ['-y', '@adrkit/mcp', '--dir', config.dir || 'docs/adr'],
        env: config.cwd ? { ADRKIT_MCP_CWD: config.cwd } : {}
      })
  configSchema:
    type: object
    properties:
      cwd:
        type: string
        title: Repository root
        description: Absolute path to the git repo whose ADRs to read (defaults to the launch cwd).
      dir:
        type: string
        default: docs/adr
        title: ADR directory
        description: ADR directory under the repo root.
    additionalProperties: false
  exampleConfig:
    dir: docs/adr
  ```

- **Prerequisite:** `smithery.yaml` at repo root (REPORT: not owned here).
- **Criteria met?** Partially, with an honest caveat: adrkit is a **local** server
  whose tools require a real on-disk ADR corpus in a git repo. Smithery's hosted
  tool-playground has no such corpus, so the interactive "try in browser" surface
  cannot meaningfully exercise the tools — the value is discovery/listing, and the
  copy should say the server runs locally against the user's repo.

### B4 — Glama

- **Process:** Glama crawls GitHub for a `glama.json` at the **repo root** and
  indexes within ~24h; the repo already signals MCP via name/topics.
- **Ready-to-paste `glama.json`** (belongs at **repo root** — REPORT: not owned
  here):

  ```json
  {
    "$schema": "https://glama.ai/mcp/schemas/server.json",
    "maintainers": ["mbeacom"]
  }
  ```

- **Prerequisite:** `glama.json` at repo root; repo public with "mcp" in
  topics/description.
- **Criteria met?** Yes (public, documented, MCP server). Discovery-only listing.

### B5 — `awesome-mcp-servers` (GitHub PR)

- **Repo:** <https://github.com/punkpeye/awesome-mcp-servers> (PR to `README.md`).
  Automated-agent PRs may append `🤖🤖🤖` to the PR title to fast-track; a human
  must open it.
- **Category:** `### 🧠 Knowledge & Memory` (best fit — decision memory). Alternate:
  `### 💻 Developer Tools`. Maintain alphabetical order by repo path within the
  section.
- **Legend used:** `📇` TypeScript, `🏠` local service, `🍎 🪟 🐧` cross-platform.
  (No `🎖️` — that is reserved for official Anthropic implementations.)
- **Ready-to-paste entry line:**

  ```markdown
  - [mbeacom/adrkit](https://github.com/mbeacom/adrkit) 📇 🏠 🍎 🪟 🐧 - Deterministic, offline, read-only decision memory (ADRs) for coding agents. Four read-only tools surface prior and **superseded/rejected** decisions so agents stop re-proposing them. No model or network calls. Node/npm; unrelated to `adr-kit` on PyPI.
  ```

- **Prerequisite:** none beyond a public repo.
- **Criteria met?** Yes.

### B6 — `adr.github.io` "Decision Capturing Tools" (GitHub PR)

- **Repo:** <https://github.com/adr/adr.github.io>; edit
  `_posts/2024-10-28-adr-tooling.md`. CONTRIBUTING requires following the existing
  format; entries are alphabetical.
- **Best fit:** the **"MADR template"** table (adrkit consumes MADR via
  `adr migrate --from madr`). It could alternatively sit under **"Tooling close to
  the code"** (its `check`/`explain`/MCP surface binds decisions to code paths).
- **Ready-to-paste table row** (insert alphabetically into the MADR-template table):

  ```markdown
  | [adrkit](https://github.com/mbeacom/adrkit) | 2.x / 3.x (one-way import) | Node CLI (`@adrkit/cli`) plus a read-only MCP server (`@adrkit/mcp`). Typed-frontmatter ADR format that is a superset of MADR: `adr migrate --from madr` imports MADR one-way and non-destructively; `adr lint`/`check`/`explain` enforce decisions and bind them to code paths in CI; the MCP server exposes decision memory (including superseded/rejected records) to coding agents. |
  ```

- **Prerequisite:** none beyond a public repo.
- **Criteria met?** Yes. The MADR-version column is honest ("2.x / 3.x import"): the
  importer reads both MADR 2.x header bullets and 3.x YAML frontmatter (see
  `packages/core/src/import/madr.ts`). Confirm exact version wording before opening
  the PR.

### Venue readiness summary

| Venue | Machine format | Prerequisite | Ready to submit? | What the human must do |
|---|---|---|---|---|
| Official MCP registry | `server.json` (validated) | P2 `mcpName` edit + namespace proof | **Blocked on P2 + namespace proof** | Add `mcpName`, add DNS TXT (or GitHub login), run `mcp-publisher publish` |
| mcp.so | web form | public repo | **Yes** | Fill form at mcp.so/submit (free tier) |
| PulseMCP | (ingests registry) | official-registry listing | **After A** | Publish A; optionally email hello@pulsemcp.com |
| Smithery | `smithery.yaml` (root) | file at repo root | **Prepared; file not placed** | Add root `smithery.yaml`, connect repo at smithery.ai/new |
| Glama | `glama.json` (root) | file at repo root | **Prepared; file not placed** | Add root `glama.json`; Glama auto-indexes |
| awesome-mcp-servers | README PR | public repo | **Yes** | Open PR with the entry line |
| adr.github.io tooling | Jekyll post PR | public repo | **Yes** | Open PR with the table row |

---

## C. Zero-install demo (`npx @adrkit/cli`) — actually run

Both sequences below were **run end-to-end** against the published `@adrkit/cli@0.2.0`
in a scratch directory outside the repo. The output is real, not aspirational.
The binary published by `@adrkit/cli` is `adr`, so `npx -y @adrkit/cli <cmd>` works
with no install.

### C1 — scaffold and enforce a decision (offline, ~2 min)

```sh
mkdir adrkit-demo && cd adrkit-demo && git init -q

# 1. Scaffold two decisions.
npx -y @adrkit/cli new "Adopt PostgreSQL for the primary datastore"
#   → docs/adr/0001-adopt-postgresql-for-the-primary-datastore.md
npx -y @adrkit/cli new "Use connection pooling with PgBouncer"
#   → docs/adr/0002-use-connection-pooling-with-pgbouncer.md

# 2. In 0001's frontmatter set `status: accepted`, add a decider, and add an
#    `affects` matcher binding the decision to code paths:
#      deciders:
#        - "you@example.com"
#      affects:
#        - type: path
#          pattern: "src/db/**"

# 3. Lint the corpus.
npx -y @adrkit/cli lint
#   → checked 2 records, 0 errors, 0 warnings

# 4. Ask which decision governs a code file.
npx -y @adrkit/cli explain src/db/pool.ts
#   → 0001  Adopt PostgreSQL for the primary datastore
#   →   via path: src/db/**

# 5. The CI gate form — nonzero exit if a governed file changes without review.
npx -y @adrkit/cli check src/db/pool.ts
#   → Decisions governing this change:
#   →   0001  Adopt PostgreSQL for the primary datastore
#   →     via path: src/db/**
#   → checked: 1 governing, 0 changed records, 0 changed-record errors
#   (exit 0)

# 6. Render the decision graph.
npx -y @adrkit/cli graph --format dot
#   → digraph adr {
#   →   rankdir=LR;
#   →   "0001" [label="0001: Adopt PostgreSQL for the primary datastore", status="accepted"];
#   →   "0002" [label="0002: Use connection pooling with PgBouncer", status="draft"];
#   → }
```

Before the decider was added, `lint` correctly failed with
`accepted-requires-decider-unless-imported` (exit 1) — the enforcement is real, not
cosmetic.

### C2 — import a real MADR corpus (one-way, non-destructive)

Run against the canonical MADR repository, `adr/madr` (`docs/decisions/`):

```sh
mkdir madr-demo && cd madr-demo && git init -q && mkdir -p docs/adr
# Copy a few real MADR files from https://github.com/adr/madr/tree/main/docs/decisions
#   into docs/adr/ (e.g. 0000-use-markdown-…, 0005-use-dashes-…, 0008-add-status-field.md)

npx -y @adrkit/cli migrate --from madr --dry-run
#   → migrated  docs/adr/0000-use-markdown-architectural-decision-records.md
#   → migrated  docs/adr/0005-use-dashes-in-filenames.md
#   → migrated  docs/adr/0008-add-status-field.md
#   → summary: migrated 3, updated 0, unchanged 0, diverged 0, skipped 0
#   → Divergence (report only):
#   →   none
#   → Findings:
#   →   warn import-status-unrecognized 0000 status: MADR status is missing; using "proposed"
#   →   warn import-status-unrecognized 0005 status: MADR status is missing; using "proposed"
#   →   warn import-status-unrecognized 0008 status: MADR status is missing; using "proposed"

npx -y @adrkit/cli migrate --from madr    # writes the typed frontmatter in place
npx -y @adrkit/cli lint
#   → checked 3 records, 0 errors, 0 warnings
```

The importer reads both MADR 2.x header bullets and 3.x YAML frontmatter, is
one-way (round-trip sync is out of scope per ADR-0008), and surfaces honest findings
(missing MADR status → `proposed`) rather than silently guessing.

> These runs demonstrate the tool **works**. They are functional evidence only and
> say nothing about external adoption (see the honesty guardrail).

---

## D. The moving `queue@v0` tag

The README/plan pin the ARB-queue GitHub Action to a commit:

```yaml
uses: mbeacom/adrkit/packages/ci/queue@efef89b5d747ca175a1947f1ce2f4296dab54fa3
```

…"until a moving `queue@v0` tag is published." Here is what that actually requires.

### D1 — current state (verified)

- The queue Action (`packages/ci/queue/action.yml`) was added in commit
  `efef89b5d747ca175a1947f1ce2f4296dab54fa3`, which landed **after** the `v0.2.0`
  release.
- The repo-wide `v0` tag currently points at the `v0.2.0` commit
  (`66a1e7f…`), which does **not** contain `packages/ci/queue/action.yml`.
- Therefore `mbeacom/adrkit/packages/ci/queue@v0` would currently **fail to
  resolve** — which is exactly why the README pins the full commit SHA.

### D2 — there is no separate `queue@v0` tag

`queue@v0` is not its own tag. It is the **repo-wide `v0` major tag** plus the
subpath `packages/ci/queue`. `scripts/update-action-tag.ts` force-moves the
`v${major}` (= `v0`) tag to the release commit during a release, but **only** when a
new stable `vX.Y.Z` tag is pushed and the new version is newer than the tag's
current target (see `docs/RELEASING.md`, "Subsequent releases").

### D3 — procedure to make `queue@v0` resolve (human; do NOT run here)

1. Cut the next release (e.g. `v0.2.1` or `v0.3.0`) whose release commit **includes**
   `packages/ci/queue/action.yml` — i.e. any release cut from current `main`.
   Per `docs/RELEASING.md`: bump all four package manifests to the same version,
   merge after CI is green, then push the annotated `vX.Y.Z` tag and approve the
   `npm` deploy environment.
2. The release workflow runs `scripts/update-action-tag.ts`, which **force-updates
   the `v0` tag** to that release commit.
3. `mbeacom/adrkit/packages/ci/queue@v0` then resolves to an Action tree that
   contains `packages/ci/queue/action.yml`, and adopters can switch the pin from the
   commit SHA to `@v0`.

**Do not create or push any tag as part of this wave.** This is documentation of the
procedure only; the release is a human action.

---

## E. Changes needed from other workstreams (report only)

| File (not owned here) | Needed change | Why |
|---|---|---|
| `packages/mcp/package.json` | Add `"mcpName": "dev.adrkit/mcp"` (must equal `server.json` `name`). | Required for official MCP registry npm-ownership verification (P2). |
| repo-root `smithery.yaml` | Create with the content in B3. | Smithery reads it from the repo root. |
| repo-root `glama.json` | Create with the content in B4. | Glama crawls it from the repo root. |

`server.json` does **not** need to be added to `packages/mcp/package.json` `files`.
