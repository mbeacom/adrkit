---
schemaVersion: 0.2.0
id: "0043"
title: "Publish schema v0.2.0 with RFC 3339 seconds, retain v0.1.0, and validate every record against the current schema"
status: proposed
date: 2026-09-28
deciders: ["@mbeacom"]
tags: [schema, core, dependencies, hosting]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0011", "0016", "0041"]
affects:
  - type: path
    pattern: "packages/core/src/schema/**"
  - type: path
    pattern: "schema/**"
  - type: path
    pattern: "site/scripts/sync-schema.ts"
  - type: package
    pattern: "zod"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    The first SCHEMA_VERSION bump. It exercises ADR-0011's immutability rule for
    the first time and makes a previously valid minutes-only timestamp invalid
    for every consumer corpus that upgrades.
  queuedAt: 2026-09-28T00:00:00Z
  slaDays: 30
---

# ADR-0043: Publish schema v0.2.0 with RFC 3339 seconds, retain v0.1.0, and validate every record against the current schema

## Context

`zod` 4.5.0 made `z.iso.datetime()` require seconds, per RFC 3339
([colinhacks/zod#6457](https://github.com/colinhacks/zod/pull/6457)). Five
frontmatter fields are declared through it — `provenance.importedFrom.importedAt`,
`review.queuedAt`, `review.escalatedAt`, `review.decidedAt` and
`evaluation.ranAt` — so the emitted pattern for each goes from
`…T HH:MM(:SS(.f+)?)? offset` to `…T HH:MM:SS(.f+)? offset`. `2026-01-01T12:30Z`
stops validating; `2026-01-01T12:30:00Z` still does.

Three things make this a decision rather than a dependency bump:

- **ADR-0011 makes every published schema path immutable.** Regenerating
  `schema/adr.schema.json` under the new `zod` rewrote the `v0.1.0` bytes in
  place (observed on #209), and the SHA-256 pin in
  `packages/catalog-envelope/test/protected-surfaces.json` failed, as it should.
  Taking the new `zod` therefore means a new schema version, and ADR-0011 action
  item 6 — retain every previously published version file — is its hard
  prerequisite. Nothing implemented it: the site served only the current version.
- **The stricter pattern is the correct one.** These fields have always declared
  `"format": "date-time"`, which JSON Schema defines as RFC 3339, where seconds
  are mandatory. The `pattern` was looser than the `format` it sat beside.
- **`schemaVersion` has never been dispatched on.** Every record declares it, it
  is regex-checked as a semver string, and nothing reads it afterwards. Every
  record in every corpus is validated by the one `AdrFrontmatter` schema the
  installed `@adrkit/core` ships. So the question a bump has to answer, and has
  never had to before, is whether a record declaring the old version is held to
  the old rules.

`zod` was capped at `>=4.4.3 <4.5`, with a Dependabot `ignore`, until this was
settled (#236). The cap was a hold, not a decision to stay on 4.4.

## Decision

We will publish ADR JSON Schema **v0.2.0** with mandatory seconds, keep serving
**v0.1.0** byte for byte at its own `$id`, and continue to validate **every**
record against the current schema regardless of the `schemaVersion` it declares.

- **Retain prior versions as committed files.** Each published schema is kept
  verbatim at `schema/versions/v<semver>/adr.schema.json` and is never
  regenerated. `site/scripts/sync-schema.ts` serves each retained file at the path
  derived from *its own* `$id`, exactly as it serves the canonical file, and
  `--check` covers all of them. It refuses a retained file whose `$id` version
  differs from its directory, and a canonical schema whose version equals a
  retained version with different bytes — "never repoint" made executable.
- **Pin v0.1.0.** `site/scripts/sync-schema.test.ts` pins the retained file to the
  SHA-256 the v0.1.0 schema was published with (`1e1841151174cc5a…`) and proves
  the planner serves it at `/schema/adr/v0.1.0/adr.schema.json`.
- **Bump `SCHEMA_VERSION` to `0.2.0`** and take `zod` `^4.6.5`. `adr new` writes
  `schemaVersion: 0.2.0`; existing records keep whatever they declare.
- **Hold a `0.1.0` record to the v0.2.0 rule.** A minutes-only value in one of
  the five fields fails `adr lint` whatever `schemaVersion` the record declares,
  with a message naming the fix: append `:00`. The CHANGELOG marks this breaking.

## Options considered

### Option A: Strict for every record, prior schema files retained (chosen)

| Dimension | Assessment |
|---|---|
| Existing corpora | Breaking only for a minutes-only value in five rarely hand-written fields; none observed in this corpus |
| Runtime model | Unchanged: one `AdrFrontmatter`, one set of rules |
| Emitted schema | Plain `pattern`, consistent with `format: date-time` |
| Maintenance | No per-version code; a future bump repeats one directory copy |
| ADR-0011 | Satisfied: v0.1.0 served unchanged, v0.2.0 added |

### Option B: Validate each record against the version it declares

A record declaring `0.1.0` keeps accepting minutes-only times; only records
declaring `0.2.0` (every new one) are strict.

**Pros:** non-breaking for any existing corpus; an editor using the v0.1.0 `$id`
and `adr lint` would agree about a v0.1.0 record.
**Cons:** there is no single `zod` expression for the old rule on new `zod`.
`precision: -1` accepts *only* minutes, so the lenient form is a union, which
emits `anyOf` and can never reproduce the v0.1.0 bytes — the runtime check and
the archived JSON would be two different truths. It needs a factory over the
whole `AdrFrontmatter` object (the fields sit three levels deep in
`Provenance`, `Review` and `Evaluation`), a version dispatch at every validation
site — five in `@adrkit/core` plus the MCP `get_decision` output schema, where "which
version" has no meaning — and one more variant on every future bump. That is a
standing cost to preserve a leniency the field's own `format` never granted.

### Option C: Keep minutes-only valid on new `zod` with a union

`z.union([z.iso.datetime({ offset: true }), z.iso.datetime({ offset: true, precision: -1 })])`.

**Pros:** no consumer-visible validation change.
**Cons:** still changes the emitted bytes (to `anyOf`), so it still needs v0.2.0
and retention — it buys nothing on that front — and it keeps the pattern looser
than `format: date-time` permanently. Recommended against in #235.

### Option D: Do nothing — stay on `zod` 4.4

**Pros:** no schema change at all.
**Cons:** a cap held indefinitely against every future `zod` fix, and the
retention prerequisite stays unbuilt until the next bump forces it under
pressure.

## Trade-offs

- **A v0.1.0 record can disagree with its own `$id`.** An editor validating a
  record against `https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json` accepts
  `2026-01-01T12:30Z`; `adr lint` rejects it. The `$id` is a contract of content
  for that version, not a promise that current tooling applies it. The
  disagreement is confined to five fields and has a one-token fix.
- **The change is breaking for any consumer with a minutes-only value** in those
  fields. Pre-1.0 minors may break (ADR-0002), so it ships in a minor with the
  migration in the CHANGELOG.
- **`schemaVersion` is still not dispatched on.** It records which schema a record
  was written against; it does not select the rules. Choosing Option B later
  remains possible, because the retained files are exactly the data it would
  need.

## Consequences

- Easier: `zod` tracks upstream again; the retention mechanism exists before it
  is needed a second time; the schema's `pattern` and `format` agree.
- Harder: every future `SCHEMA_VERSION` bump must copy the outgoing canonical file
  into `schema/versions/` in the same change, or `sync-schema.test.ts`'s pin and
  the site's `--check` stop it.
- **How we would know this was wrong:** a consumer reports a corpus failing
  `adr lint` after upgrading only because of minutes-only timestamps and cannot
  reasonably rewrite it — in which case Option B's per-version validation, fed by
  the retained files, is the fallback. Or `/schema/adr/v0.1.0/adr.schema.json`
  stops serving the pinned bytes.
- Revisit if: a second schema bump needs a rule change that a one-line migration
  cannot express.

## Action items

1. [x] Retain `schema/adr.schema.json` as published at v0.1.0 in
       `schema/versions/v0.1.0/adr.schema.json` and serve every retained file from
       `site/scripts/sync-schema.ts`, with `--check` covering each.
2. [x] Pin the retained v0.1.0 bytes and the never-repoint rules in
       `site/scripts/sync-schema.test.ts`, each observed failing first (ADR-0016).
3. [x] Bump `SCHEMA_VERSION` to `0.2.0`, lift the `zod` cap and Dependabot
       `ignore`, re-emit the schema, and re-pin `protected-surfaces.json`.
4. [x] Record the breaking change and the `:00` migration in the CHANGELOG.
5. [ ] Confirm, after the next site deploy, that
       `https://adrkit.dev/schema/adr/v0.1.0/adr.schema.json` serves SHA-256
       `1e1841151174cc5a8ed22dadae070f087477e5068bd928d5292c3acd2e2681cc` and
       `https://adrkit.dev/schema/adr/v0.2.0/adr.schema.json` serves the canonical
       file.
