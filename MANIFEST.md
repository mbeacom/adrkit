# adrkit - repository manifest

A quick map of the repository's public surfaces, supporting packages, and
decision corpus.

```
adrkit/
├── README.md                      product overview, install paths, status
├── CONTRIBUTING.md                contributor workflow, quality bar, DCO
├── CHANGELOG.md                   released changes
├── CODEOWNERS                     review ownership for governed surfaces
├── NOTICE                         Apache attribution + CC0 carve-out notice
├── plan.md                        active planning and open questions
├── MANIFEST.md                    this file
├── DESIGN.md  PRODUCT.md          design and product framing
├── Containerfile  .dockerignore   OCI build and minimal context
├── .gitignore  .editorconfig
├── bunfig.toml  .bun-version      Bun development toolchain; isolated linker
├── .github/workflows/             CI workflows
├── schema/
│   ├── adr.schema.ts              compatibility re-export
│   ├── adr.schema.json            generated JSON Schema; do not hand-edit
│   └── LICENSE                    CC0, schema only
├── packages/
│   ├── core/                      @adrkit/core - parsing, validation, resolution
│   ├── cli/                       @adrkit/cli - `adr` / `adrkit` binaries
│   ├── evaluator/                 @adrkit/evaluator - deterministic Pass 0
│   ├── mcp/                       @adrkit/mcp - read-only stdio MCP server
│   ├── ci/                        private GitHub Actions + bundled dist
│   ├── catalog-envelope/          experimental envelope reader/validator
│   └── adapters/
│       ├── spec-kit/              @adrkit/spec-kit - published Spec Kit extension
│       ├── agent-plugin/          portable plugin for Copilot/Claude/APM/opencode
│       └── catalog-backstage/     experimental Backstage generator package
├── scripts/                       release, audit, dependency-boundary, and DCO checks
├── site/                          Astro Starlight docs site; hosts the schema at its $id
├── specs/                         feature work and contracts
└── docs/
    ├── EVALUATOR_RUBRIC.md        evaluator rubric and status boundary
    ├── RELEASING.md               release procedures
    ├── DISTRIBUTION.md            distribution channels and registry notes
    ├── reference-verification-spec-kit-extension.md
    ├── reference-verification-agent-plugin.md
    └── adr/                       numbered decision records plus the draft template
```

## Current planning sources

- [README.md](README.md) - reader-facing overview and install paths
- [CHANGELOG.md](CHANGELOG.md) - what has shipped
- [plan.md](plan.md) - active planning and open questions
- [docs/adr/](docs/adr/) - governing decisions
- [docs/RELEASING.md](docs/RELEASING.md) - release procedures

## Decision corpus

- The ADR corpus lives in [docs/adr/](docs/adr/), with `0000-template.md` plus
  numbered records.
- There are 35 files: the template plus 34 records, ids `0001`-`0034`, with 32
  accepted and 2 superseded records.
- The schema source of truth lives in
  `packages/core/src/schema/adr.schema.ts`.
- `schema/adr.schema.json` is generated from that source and hosted at the
  schema `$id` through the docs site.
