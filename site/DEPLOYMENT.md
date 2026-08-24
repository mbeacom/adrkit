# Deploying the adrkit docs site

The site in this directory is an [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build) static site. It is built with
[Bun](https://bun.com) ([ADR-0010](../docs/adr/0010-bun-toolchain.md)) and
deployed to **GitHub Pages** at the apex custom domain **`adrkit.dev`**.

Besides the documentation, the site serves the canonical JSON Schema at the exact
URL baked into its `$id` — see
[ADR-0011](../docs/adr/0011-host-the-canonical-json-schema-at-its-id-on-adrkit-dev.md).

```
https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json
```

## How the deploy works

- **Workflow:** [`.github/workflows/site.yml`](../.github/workflows/site.yml)
  builds with Bun and deploys via `actions/upload-pages-artifact` +
  `actions/deploy-pages`. It runs on **every** push to `main` — the push trigger
  carries no `paths` filter on purpose, because the site serves projections of
  the corpus and the CLI, so a change to either must redeploy. The path list
  (`site/`, `schema/adr.schema.json`, `docs/adr/**`, the workflow) filters the
  *pull-request* build only. It can also be run manually with
  **workflow_dispatch**.
- **Pages source:** GitHub Actions (already configured on this repo —
  `build_type: workflow`). No branch/folder source is used.
- **Schema serving:** `bun run sync:schema` copies the canonical
  `schema/adr.schema.json` into the site's `public/` output at the path derived
  from the schema's own `$id`, and `bun run check:schema` fails the build if the
  served bytes ever differ from the canonical file.
- **Custom domain persistence:** [`public/CNAME`](./public/CNAME) contains
  `adrkit.dev`, so the custom domain survives every deploy.

## One-time setup the repo owner must do

Everything above is automated. The two things that require the owner are DNS
(in Cloudflare) and flipping on HTTPS enforcement once the certificate issues.

### 1. Add the DNS records in Cloudflare

The domain `adrkit.dev` is managed in Cloudflare. Point the **apex** at GitHub
Pages using **one** of the two options below.

> **Set the records to "DNS only" (grey cloud), not proxied (orange cloud),
> initially.** GitHub needs to see the origin to provision the Pages TLS
> certificate for `adrkit.dev`. Proxying before the certificate is issued will
> block issuance. You may re-enable the Cloudflare proxy afterwards if you want,
> but "DNS only" is the simplest working configuration.

#### Option A — Apex A/AAAA records (recommended, standard GitHub Pages)

Create these eight records for the apex (`adrkit.dev`). In Cloudflare, use the
name `@` (or `adrkit.dev`) for the apex.

| Type | Name | Value / Target        | Proxy status | TTL  |
| ---- | ---- | --------------------- | ------------ | ---- |
| A    | `@`  | `185.199.108.153`     | DNS only     | Auto |
| A    | `@`  | `185.199.109.153`     | DNS only     | Auto |
| A    | `@`  | `185.199.110.153`     | DNS only     | Auto |
| A    | `@`  | `185.199.111.153`     | DNS only     | Auto |
| AAAA | `@`  | `2606:50c0:8000::153` | DNS only     | Auto |
| AAAA | `@`  | `2606:50c0:8001::153` | DNS only     | Auto |
| AAAA | `@`  | `2606:50c0:8002::153` | DNS only     | Auto |
| AAAA | `@`  | `2606:50c0:8003::153` | DNS only     | Auto |

#### Option B — Cloudflare CNAME flattening at the apex

Cloudflare can flatten a CNAME at the apex. Instead of the A/AAAA records above,
create a single record pointing the apex at this repository owner's Pages host:

| Type  | Name | Target               | Proxy status | TTL  |
| ----- | ---- | -------------------- | ------------ | ---- |
| CNAME | `@`  | `mbeacom.github.io`  | DNS only     | Auto |

Cloudflare automatically flattens the apex CNAME to A/AAAA responses. (Note the
target is the **owner** host `mbeacom.github.io`, *not* `mbeacom.github.io/adrkit`
— GitHub routes to this repo via the custom domain / `CNAME` file.)

#### Optional — `www` subdomain

If you also want `www.adrkit.dev` to work, add:

| Type  | Name  | Target              | Proxy status | TTL  |
| ----- | ----- | ------------------- | ------------ | ---- |
| CNAME | `www` | `mbeacom.github.io` | DNS only     | Auto |

GitHub will redirect between the apex and `www` once both resolve.

### 2. Confirm the custom domain and enable HTTPS

1. After the first successful deploy and after DNS has propagated, open
   **repo → Settings → Pages**. The custom domain should read `adrkit.dev`
   (populated from `public/CNAME`). If it is empty, set it to `adrkit.dev` and
   save; GitHub will run a DNS check.
2. Wait for GitHub to report the domain as verified and the certificate as
   provisioned (this can take a few minutes to an hour).
3. Tick **Enforce HTTPS**.

## Verifying the deploy

Once DNS and TLS are in place:

```sh
# The site loads over HTTPS at the apex
curl -I https://adrkit.dev/

# The schema resolves at its $id with the exact canonical bytes
curl -s https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json | head -3

# $id inside the served schema matches the URL it is served from
curl -s https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json \
  | grep '"$id"'
```

The `$id` line must read
`"$id": "https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json"` — the URL and the
bytes it serves are the same contract every editor and `$ref` depends on.

Those three commands verify the *schema*. They stay green while the marketing
page is unreadable, so they are not a check on the site itself — that is what
`bun run check:rendered` does in the workflow, against the built output before it
is published.

## Rolling back

**The only supported rollback is a revert commit on `main`.**

```sh
git revert <sha>                    # the commit that broke it
git push origin HEAD:refs/heads/main   # if you have push access to main
```

`main` is protected by an active ruleset (`deletion`, `non_fast_forward`, and
required status checks, bypassable by repository role), so if a direct push is
rejected, open the revert as a pull request and merge it normally. Note that the
site `build` job is **not** in `main`'s required-checks list, so a red rendered
check does not block the merge — but `deploy` needs `build`, so it does hold the
publish.

Two things the timing depends on, neither obvious:

- **The revert has to build before it deploys.** Budget the full job, not the
  push.
- **It cannot pre-empt the bad run.** `concurrency` uses
  `cancel-in-progress: false` so a deploy already in flight finishes and
  publishes first. If the bad artifact has not published yet, cancel that
  workflow run in the Actions UI before pushing the revert; otherwise the revert
  queues behind it.

If the build job itself is red for an environment reason — no browser on the
runner, a `playwright-core` or Chrome bump — the rendered steps are already
non-blocking on `main` and annotate instead, so the deploy proceeds. Do not
delete the steps to unblock a release; that removes the check silently and
nothing records it.

Do **not** roll back by re-running an older workflow run, and do not
`workflow_dispatch` from an older tag or branch. The deploy is whole-artifact:
one run builds the pages, copies the canonical schema to its `$id` path, and
projects `queue.json` and `lint.json` from the corpus and the CLI *as they exist
on the ref it ran on*. Deploying an older ref therefore also republishes:

- an **older schema** at the `$id` that other tools fetch over HTTP, and
- **stale badge projections**, which degrade to plausible-but-wrong numbers
  rather than to an error.

Neither failure announces itself. `check:schema` compares the served copy against
the canonical file *within the deployed ref*, so it passes on an old ref by
construction — this is the staleness the missing `paths:` filter on the `push`
trigger exists to prevent (see the comment at the top of
[`site.yml`](../.github/workflows/site.yml)), and ADR-0011 treats it as a
governance failure rather than a routine fix.

A revert commit has none of that: it redeploys with the current schema and
freshly projected badges, and it leaves the reason in the history.

## Local development

```sh
cd site
bun install
bun run dev      # regenerates the served schema + ADR pages, then starts Astro
bun run build    # production build into site/dist
bun run preview  # preview the production build
```

The served schema (`public/schema/…`) and the rendered ADR pages
(`src/content/docs/adr/…`) are generated from the source of truth on every
`dev`/`build` and are git-ignored — never edit them by hand.
