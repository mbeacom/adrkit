# adrkit — repository manifest

A map of the tracked surfaces and the decision corpus that governs them. This
file started as the seed-bundle manifest for the first commit; it is now the
inventory, refreshed as the corpus and the package layout move.

```
adrkit/
├── README.md                      positioning, quickstart, license carve-out
├── CONTRIBUTING.md                DCO + the two hard rules from ADR-0007
├── CHANGELOG.md                   Keep a Changelog; SemVer per ADR-0002
├── CODEOWNERS                     governance surfaces gated
├── NOTICE                         Apache attribution + CC0 carve-out notice
├── plan.md                        orchestrator handoff: phases, exit criteria, tasks
├── MANIFEST.md                    this file
├── DESIGN.md  PRODUCT.md          design and product framing
├── .gitignore  .editorconfig
├── bunfig.toml  .bun-version    linker = "isolated" is load-bearing (ADR-0010)
├── .github/workflows/             CI enforces ADR-0002 and ADR-0007 commitments
├── schema/
│   ├── adr.schema.ts              re-export of the Zod source of truth
│   ├── adr.schema.json            GENERATED. Do not hand-edit. $id at v0.1.0
│   └── LICENSE                    CC0, schema only
├── packages/
│   ├── core/                      @adrkit/core — schema (SOURCE OF TRUTH:
│   │                              src/schema/adr.schema.ts), resolver, queue kernel
│   ├── cli/                       @adrkit/cli — the `adr` binary
│   ├── evaluator/                 @adrkit/evaluator — deterministic Pass 0
│   ├── mcp/                       @adrkit/mcp — read-only stdio MCP server
│   ├── ci/                        private — the two GitHub Actions + bundled dist
│   └── adapters/
│       └── spec-kit/              @adrkit/spec-kit — independently versioned
│                                  (ADR-0007); ships no dist, no dependencies
├── scripts/                       release pack/publish, dep boundary + audit gates
├── site/                          Astro Starlight docs site; hosts the schema at its $id
├── specs/                         001–009, one spec-kit feature per phase/spike
└── docs/
    ├── EVALUATOR_RUBRIC.md        4 passes, 8 dimensions, escalation triggers
    ├── RELEASING.md               lockstep and adapter release procedures
    ├── DISTRIBUTION.md            registry/directory playbook
    ├── reference-verification-spec-kit-extension.md   ADR-0014 rung-2 evidence index
    └── adr/
        ├── 0000-template.md                              draft (template)
        ├── 0001  git-native markdown records            accepted
        ├── 0002  MADR-superset typed frontmatter        accepted
        ├── 0003  Spec Kit extension + standalone CLI    proposed
        ├── 0004  git truth, DB as derived index         accepted
        ├── 0005  deterministic-first evaluator          proposed
        ├── 0006  Apache-2.0, DCO, monorepo              proposed
        ├── 0007  adapter isolation, public-surface build proposed
        ├── 0008  MADR migration + one-way import         proposed
        ├── 0009  affects resolution + catalog binding    proposed
        ├── 0010  Bun toolchain, Node-targeted output      accepted
        ├── 0011  host schema at its $id (adrkit.dev)      accepted
        ├── 0012  explicit catalog owned-paths binding     accepted
        ├── 0013  reconcile 0007/0009 with offline gen     accepted
        ├── 0014  three-rung phase-landing evidence ladder accepted
        ├── 0015  validate descriptors before canonicalizing accepted
        ├── 0016  observed-failing as the coverage bar      accepted
        ├── 0017  explicit, release-scoped dependency audit accepted
        ├── 0018  MCP SDK v2, dual-era protocol revisions   accepted
        └── 0019  ship the Spec Kit extension (spike no-go) accepted
```

## Known-open, deliberately

- Schema `$id` is `https://adrkit.dev/...` — recorded and hosted per ADR-0011:
  the docs site serves the schema byte-for-byte at its `$id` on the apex domain
  via GitHub Pages, and the hostname is fixed for the life of the major version.
  Not `mbeacom.github.io` — ADR-0006 publishes under a personal namespace that
  may later transfer to an org, and a namespace-encoded `$id` breaks every
  pinned reference on transfer.
- Six records remain `proposed` (0003, 0005–0009). They are queued for review by
  `adr queue`; being proposed does not stop the code they describe from having
  shipped, and the queue reports that state rather than hiding it.
- ADR-0014 rung-3 external/community validation is open for both the Phase 6 ARB
  queue and the Spec Kit extension. Tracked honestly as absent, never as met.
- Catalog binding (`packages/adapters/catalog-*`) is not built. The viability
  spike `specs/009-catalog-binding-viability/` recorded `blocked`.
- Three open questions at the foot of `plan.md`. Do not let an implementer
  resolve them silently.

## Repo target

`github.com/mbeacom/adrkit` — personal namespace per ADR-0006, not a new org.
Transfer to an organization remains available later; GitHub preserves redirects.
`CODEOWNERS` is already scoped to `@mbeacom`. The npm scope `@adrkit` is
independent of the GitHub namespace and unaffected either way.

## Verification

20 files under `docs/adr/` — the template plus 19 records, ids 0001–0019, no
gaps. All at schema 0.1.0: 13 accepted, 6 proposed, and the template at `draft`.
No dangling `relatesTo`. No one-way door on the auto tier. No accepted record
without a decider or an import provenance. JSON Schema and Zod agree on property
casing. No `@adr/` references remain — the scope is `@adrkit/*` throughout.
