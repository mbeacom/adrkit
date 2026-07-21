# adrkit — seed bundle manifest

Everything below is current as of packaging. Unpack at the repo root; the
directory structure is the intended layout.

```
adrkit/
├── README.md                      positioning, quickstart, license carve-out
├── CONTRIBUTING.md                DCO + the two hard rules from ADR-0007
├── CODEOWNERS                     governance surfaces gated
├── NOTICE                         Apache attribution + CC0 carve-out notice
├── plan.md                        orchestrator handoff: phases, exit criteria, tasks
├── MANIFEST.md                    this file
├── .gitignore  .editorconfig
├── bunfig.toml  .bun-version    linker = "isolated" is load-bearing (ADR-0010)
├── .github/workflows/ci.yml       enforces ADR-0002 and ADR-0007 commitments
├── schema/
│   ├── adr.schema.ts              SOURCE OF TRUTH (Zod). v0.1.0
│   ├── adr.schema.json            GENERATED. Do not hand-edit.
│   └── LICENSE                    CC0, schema only
└── docs/
    ├── EVALUATOR_RUBRIC.md        4 passes, 8 dimensions, escalation triggers
    └── adr/
        ├── 0000-template.md
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
        └── 0012  explicit catalog owned-paths binding     accepted
```

## Not included — add at repo creation

| File | Why not here |
|---|---|
| `LICENSE` (root, Apache-2.0) | Take GitHub's byte-exact copy from the license picker so detection works |
| `CODE_OF_CONDUCT.md` | Standard template; GitHub's community-health prompt generates it |
| `SECURITY.md` | Same |
| `package.json`, lockfile, `packages/` | Phase 0, task seeds 1–7 in `plan.md` |

## Known-open, deliberately

- CI references `bun run schema:emit`, `bun run check:deps`, `bun run adr lint` —
  none exist yet. Phase 0 task seeds 2, 3, 6, 7. CI failing until they land is
  the correct state for a repo whose first commit is its decisions.
- Schema `$id` is `https://adrkit.dev/...`. Now recorded and hosted — see
  ADR-0011: the docs site serves the schema byte-for-byte at its `$id` on the
  apex domain via GitHub Pages, and the hostname is fixed for the life of the
  major version. Not `mbeacom.github.io` — ADR-0006 publishes under a personal
  namespace that may later transfer to an org, and a namespace-encoded `$id`
  breaks every pinned reference on transfer. Remaining owner action: the apex
  DNS records in Cloudflare (see `site/DEPLOYMENT.md`).
- ADR-0006 action item 5 — outside-OSS participation obligations — is a gate on
  going public, not on committing locally.
- Three open questions at the foot of `plan.md`. Do not let an implementer
  resolve them silently.

## Repo target

`github.com/mbeacom/adrkit` — personal namespace per ADR-0006, not a new org.
Transfer to an organization remains available later; GitHub preserves redirects.
`CODEOWNERS` is already scoped to `@mbeacom`. The npm scope `@adrkit` is
independent of the GitHub namespace and unaffected either way.

## Verification

12 records, ids 0001–0012, no gaps. All at schema 0.1.0. No dangling `relatesTo`.
No one-way door on the auto tier. No accepted record without a decider or an
import provenance. JSON Schema and Zod agree on property casing. No `@adr/`
references remain — the scope is `@adrkit/*` throughout.
