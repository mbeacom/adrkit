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
  `actions/deploy-pages`. It runs on push to `main` (for changes under `site/`,
  `schema/adr.schema.json`, `docs/adr/**`, or the workflow), and can be run
  manually with **workflow_dispatch**.
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
