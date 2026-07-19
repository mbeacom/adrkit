# Provenance: vendored real MADR corpus

This directory holds a small, **offline** subset of **real, third-party** MADR
decision records, vendored verbatim to exercise `adr migrate --from madr`
against genuine real-world prose (Phase-2 follow-up / Phase-3 gate — see
`specs/004-ci-surface/research.md` §R0 and `tasks.md` T00A). It is **never**
fetched at test/CI time (ADR-0007 forbids network at CI time).

## Source

- **Repository**: <https://github.com/adr/madr> (the MADR project's own
  `docs/decisions/` — MADR dogfooding its own format).
- **Commit**: `835fc94baa37887774b1cddddb2ae874881e703b` (default branch
  `develop`, committed 2026-07-07).
- **License**: `MIT OR CC0-1.0` (repository root `LICENSE`) — dual permissive +
  public-domain dedication, so vendoring carries no attribution burden. This
  provenance record is kept as good practice, not as a license obligation.

## Vendored files (verbatim, byte-for-byte)

Each file is copied unchanged from
`https://github.com/adr/madr/blob/835fc94baa37887774b1cddddb2ae874881e703b/docs/decisions/<name>`.

| File | Upstream git blob SHA |
|---|---|
| `0000-use-markdown-architectural-decision-records.md` | `7d803f4383f8d69a583c7057a7fdd6e3138b1e67` |
| `0008-add-status-field.md` | `3de51f41eadef604b08b7f44817c8ab62d1c1abb` |
| `0009-support-links-between-adrs-inside-an-adrs.md` | `f08efe328f8be879ece70b6b054c2b061ea43dc8` |
| `0013-use-yaml-front-matter-for-meta-data.md` | `738b3fb40ddad6ccbbde570d8c491257ae54b7a3` |
| `0014-allow-neutral-arguments.md` | `6bacf3beb3e2807bb86384067e485c0fb3a83311` |

## Why these records

They exercise real-world prose and body shapes the previous synthetic fixture
could not reproduce, and each round-trips **cleanly** through
`adr migrate --from madr` (idempotent, body-byte-preserving, zero lint errors):

- `0000` — foundational classic MADR body (Context/Problem, Considered Options,
  Decision Outcome).
- `0008` — the richest stressor: fenced code blocks whose contents *look like*
  frontmatter (lines that read `---` and `status: on hold` / `status: accepted`
  inside the body), image references, and shields.io badge links. Verifies the
  parser's leading-fence-only behavior and byte-exact body preservation of
  frontmatter-shaped body content.
- `0009` — a Markdown table plus cross-ADR relative links and autolinks.
- `0013` — an embedded YAML metadata code fence (`status:`/`date:`/
  `decision-makers:`) in the body — a second body-vs-frontmatter stressor.
- `0014` — a title carrying literal double quotes (`Allow "neutral" arguments`),
  exercising YAML title quoting on emit, plus neutral-argument bullet lists.

## Known corpus properties (not defects)

The MADR project's own decision records use **Just-the-Docs** front matter
(`parent` / `nav_order`), **not** MADR metadata front matter. As a faithful
consequence of vendoring them verbatim:

- **All migrate to `status: proposed`.** None carry a MADR `status`, so
  `mapMadrStatus` maps the missing status to `proposed`. The vetted corpus does
  **not** contain records with `accepted` / `rejected` / `superseded` /
  `deprecated` status front matter, so that status variance is not exercised
  here. This is a property of the real corpus, not fabricated — status was
  deliberately **not** injected into third-party prose.
- **All titles derive from the `# heading`.** None carry a `title` in front
  matter, so every record exercises the heading-derived (classic-title) path.

Migration-status mapping variance is covered separately by the deterministic
unit tests in `packages/core/test/migrate-status.test.ts`.
