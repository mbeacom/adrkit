# adrkit docs site

The [adrkit.dev](https://adrkit.dev) documentation site — an
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build) static
site that also **hosts the canonical JSON Schema at its `$id`**.

This directory is intentionally **not** a Bun workspace member, so it stays out of
the root project's `build`, `lint`, `typecheck`, `check:deps`, and `adr lint`
gates. It has its own `package.json`, `bun.lock`, and `bunfig.toml`. See
[ADR-0011](../docs/adr/0011-host-the-canonical-json-schema-at-its-id-on-adrkit-dev.md).

## Commands

Run everything with [Bun](https://bun.com) ([ADR-0010](../docs/adr/0010-bun-toolchain.md)):

| Command | Action |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Generate content, then start the dev server at `localhost:4321` |
| `bun run build` | Generate content, then build to `./dist` |
| `bun run preview` | Preview the production build locally |
| `bun run sync:schema` | Copy the canonical schema into `public/` at its `$id` path |
| `bun run check:schema` | Fail if the served schema differs from the canonical file |
| `bun run gen:adr` | Render `docs/adr/*.md` into Starlight pages |
| `bun run check:rendered` | Assert rendered invariants in a browser (run `build` first) |
| `bun run check:rendered:self-test` | Prove those assertions can still fail |
| `bun run check:rendered:allow-skip` | Same, but skip cleanly if you have no browser |

## The rendered check

`bun run build` tells you the pages compile. It cannot see how they render, and
the site is deliberately outside every root gate ([ADR-0011](../docs/adr/0011-host-the-canonical-json-schema-at-its-id-on-adrkit-dev.md)),
so nothing else looks either. `bun run check:rendered` loads the built output in
a browser and asserts specific computed styles and geometry — contrast on the
coral band in both themes, the shared left edge, the docs title alignment, the
code-chip treatment on both sides of the Starlight carve-out, the print
fallback, and horizontal overflow from 320 to 2000px.

Two things to know before it goes red on you:

- **It needs a Chrome or Chromium already on your machine.** None is downloaded
  — `playwright-core` ships no binaries, which is what keeps the install inside
  CONTRIBUTING's first hard rule. Set `CHROME_PATH` if yours is somewhere
  unusual. If you have no browser at all, `bun run check:rendered:allow-skip`
  exits 0 with a notice; CI never passes that flag, so skipping locally is fine
  — say so in the PR and let CI do the looking.
- **It is blocking on pull requests and annotating on `main`.** A rendered
  regression should stop a PR, but it must never withhold the deploy that
  republishes the canonical schema at its `$id`.

`check:rendered:self-test` is the negative case: it sabotages each invariant and
fails unless every sabotage-reachable check catches it, so a checker that has
quietly stopped looking cannot report a green zero.

## Generated content — do not edit by hand

Two build steps run before every `dev`/`build` (both are git-ignored output):

- **`scripts/sync-schema.ts`** reads `../schema/adr.schema.json`, derives the
  served path from the schema's own `$id`, and writes the bytes verbatim to
  `public/schema/adr/vX.Y.Z/adr.schema.json`. A `--check` mode guards byte
  equality with the canonical file so the two cannot drift.
- **`scripts/gen-adr-pages.ts`** reads the canonical ADR corpus in
  `../docs/adr/*.md` and renders each record as a Starlight page under
  `src/content/docs/adr/`, mapping adrkit's typed frontmatter to page metadata.
  **The source ADR files are never modified.**

## Deployment

Deployed to GitHub Pages at the apex `adrkit.dev` by
[`.github/workflows/site.yml`](../.github/workflows/site.yml). See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the exact Cloudflare DNS records and the
one-time TLS/HTTPS steps the repo owner must complete.
