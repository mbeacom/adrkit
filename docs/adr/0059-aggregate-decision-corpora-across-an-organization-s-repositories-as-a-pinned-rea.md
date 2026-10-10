---
schemaVersion: 0.2.0
id: "0059"
title: "Aggregate decision corpora across an organization's repositories as a pinned, read-only federation"
status: proposed
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - architecture
  - federation
  - portal
  - sdk
  - governance
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0002"
  - "0004"
  - "0009"
  - "0012"
  - "0013"
  - "0014"
  - "0016"
  - "0022"
  - "0029"
  - "0030"
  - "0031"
  - "0033"
  - "0039"
  - "0040"
  - "0044"
  - "0051"
  - "0052"
  - "0053"
  - "0054"
  - "0055"
  - "0056"
  - "0058"
affects:
  - type: path
    pattern: "schema/federation.schema.json"
    note: "Proposed home of the federation manifest's JSON Schema; does not exist yet."
  - type: path
    pattern: "packages/sdk/**"
  - type: path
    pattern: "packages/portal/**"
  - type: path
    pattern: "packages/ci/portal/**"
  - type: path
    pattern: "packages/ci/federation/**"
    note: "Proposed home of the populator Action; does not exist yet."
  - type: path
    pattern: "packages/core/src/validate/corpus-invariants.ts"
    note: "Clause 5 changes how a log-qualified relatesTo is reported."
provenance:
  authoredBy: agent-drafted
---

# ADR-0059: Aggregate decision corpora across an organization's repositories as a pinned, read-only federation

> **Status: proposed.** Agent-drafted and not ratified. It adds no schema
> field: the reference grammar it relies on (`<log>:<id>`) has been in
> `AdrRef` since the first schema, and the `affects` `repo` qualifier is
> already in use (ADR-0056). It changes one existing behavior, called out in
> clause 5: `adr lint` stops treating a log-qualified `relatesTo` or
> `conflictsWith` reference as an `error`. It builds on the single-corpus
> contracts of
> [ADR-0053](./0053-implement-adrkit-sdk-over-core-s-kernels-and-accept-an-in-repo-consumer-as-its-r.md),
> [ADR-0054](./0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md),
> and
> [ADR-0055](./0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md)
> without reinterpreting any of them.

## Context

An organization with decisions in several repositories wants one place to
browse them, an org-level portal, and wants the same aggregate available to
the CLI, the SDK, MCP, the REST server, and Backstage. Every surface adrkit
ships today reads one corpus in one working tree. What exists, measured in this
tree on 2026-10-10:

- **A federation vocabulary already exists in the schema, unused.**
  `packages/core/src/schema/adr.schema.ts` defines `AdrRef` as
  `^(([a-z0-9][a-z0-9-]*):)?(<4+ digits>|<ULID>)$`, documented as "`0042`
  (same log) or `payments:0012` (federated)". A record's own `id` admits no
  prefix. `Adr.log` is documented as the "log name for federated corpora;
  undefined for single-repo". No loader sets it. `parseAdrRef` in
  `packages/core/src/schema/ref.ts` splits a reference on its first `:`.
- **Surfaces disagree about a log-qualified reference.** The evaluator's
  `no-orphan-refs` rule resolves `payments:0012` against a supplied
  `FederatedLogSnapshot` (`{ log, adrIds, sourceRef? }`, accepted by
  `adr evaluate`'s snapshot contract), and without one reports it `inert`
  (`no-orphan-refs.federated-log-absent`). The marker resolver reports a
  qualified marker as unresolvable (`info`, ADR-0022). The MCP server returns
  `federated-log-unavailable`. **`adr lint` does not:**
  `validateCorpusInvariants` compares the raw string with the corpus's ids, so a
  record with `relatesTo: ["payments:0012"]` fails with
  `error dangling-relatesTo` and exit `1`. That was measured on a one-record
  fixture. The schema accepts a reference that the corpus gate then rejects.
- **Two qualifier grammars coexist.** The `log` in an `AdrRef` is a slug and
  cannot contain `/`. `AffectsMatcher.repo` is a free string ("qualifier for
  federated logs"), and ADR-0056 already writes it as
  `repo: "mbeacom/adrkit-azure"`. `matcherAppliesToLog` in
  `packages/core/src/affects/index.ts` applies a matcher only when
  `matcher.repo === input.log`. No caller passes `log`, so every repo-qualified
  matcher is skipped in every run, and nothing reports the skip. Measured:
  `adr check src/a.ts` against a record whose only matcher is
  `{ type: path, pattern: "src/**", repo: "payments" }` returns no governing
  record and no finding.
- **The I/O pattern is settled.** ADR-0004 makes git the source of truth and
  every database or projection derived and rebuildable. ADR-0013 puts external
  data behind an offline snapshot generator, so core never learns an adapter
  exists. ADR-0055 clause 4 has the REST server never run git or call GitHub.
  It reads a directory that a populator wrote aside and swapped in whole, with
  a sidecar `.adrkit-corpus.json` holding `{ "commit": "<40 hex>" }`. Clause 6
  of that record already serves many corpora, keyed by
  `^[a-z0-9][a-z0-9-]{0,63}$`. That is the `AdrRef` log grammar with a length
  cap.
- **The single-corpus contracts are fixed.** `portal-data.json` v1 (ADR-0054
  clause 3) has one corpus directory, one commit, and records keyed by bare
  id. Reinterpreting any field is `version: "2"`. `openDecisions` (ADR-0053)
  is the only place the SDK reads a corpus (its other I/O door is
  `governing(path)`'s marker scan) and takes one `{ dir, cwd }`. The SDK is
  unpublished and independently versioned (ADR-0031 clauses 7 and 8). The CLI's
  JSON output is a semver contract (ADR-0031 clause 5), and its write surface
  is deliberately small. The published CLI's only subprocess is
  `git` in `as-of.ts`, and it makes no network call.
- **MCP's federation exclusion was ratified.** `plan.md`'s Phase 5 scope lists
  "named-log federation" among what the stdio server does not do, ratified by
  the maintainer on 2026-07-20. Remote MCP clients reach adrkit through the
  REST API (ADR-0055 clause 15).
- **"Catalog" is taken.** In this codebase it means the IDP entity catalog:
  ADR-0009, ADR-0012, and ADR-0013, `packages/catalog-envelope`, the `catalog`
  assertion input, and `CatalogSnapshot`. Code that already handles
  multi-repository corpora says "federated" and "log".
- `plan.md`'s open questions list "whether federated multi-repo aggregation
  uses ULIDs or log-prefixed ordinals" as undecided. The id grammar in
  `packages/core/src/schema/adr.schema.ts` permits both (see also `plan.md`).

## Decision

We will aggregate an organization's decision corpora as a **federation**: a
derived, read-only projection. A manifest lists the member repositories, a
populator pins each one to a commit, and the readers assemble the result from
directories already on disk. Git in each member stays the source of truth.

1. **A federation manifest, `adrkit.federation.yaml`, in a repository the
   organization chooses** (typically a `decisions` repository). It holds
   `version: 1` and `members`, a list where each member has:
   - `log`, the member's name in references. It must match
     `^[a-z0-9][a-z0-9-]{0,63}$`, which is both the `AdrRef` log grammar and
     ADR-0055's corpus key, so one string serves both.
   - `repo`, as `owner/name`.
   - `ref`, a branch, tag, or 40-hex commit.
   - `dir`, the corpus directory, defaulting to `docs/adr`.
   - `visibility`, `public` or `private`, required with no default (clause 9).

   `log` and `repo` must each be unique in the manifest. Its JSON Schema is
   `schema/federation.schema.json`, emitted from a Zod definition as
   `adr.schema.json` is. The schema forbids unknown keys, and a field added
   later is additive. Identifiers say `federation`, not `catalog`, because of
   the collision in the context. Prose may still call the result the
   organization's decision catalog.

2. **A populator does all network and git work, outside every kernel.** For
   each member it fetches `ref` and resolves it to a full commit SHA. It writes
   only `dir` from that commit into `<root>/<log>/<dir>`, writes the tree aside,
   writes ADR-0055's `.adrkit-corpus.json` sidecar last with that SHA (worded
   exactly as in ADR-0055 clause 4), and swaps the tree in whole. It also
   writes `<root>/federation.lock.json` with each member's `log`, `repo`, `ref`,
   resolved `commit`, `dir`, and checked visibility. The populated root is the
   contract, as ADR-0055's sidecar is. Any process that writes that layout is a
   valid populator, including a person's own script or `actions/checkout`
   steps. adrkit ships one implementation, a nested Action,
   `packages/ci/federation/action.yml`. It takes a `token` input with no
   `github.token` default, because a repository token cannot read sibling
   repositories. The documented setup is a GitHub App with `contents: read` on
   the member repositories only. Live reads from GitHub at query time are not
   offered by any surface.

3. **The aggregate key is `(log, id)`, and ids are never rewritten.** Every
   member keeps its own numbering. Two members' `0001` records are distinct,
   and that is not a collision. Across repositories a record is addressed as
   `<log>:<id>`, the existing `AdrRef` form. `owner/repo#0012` is not adopted
   (Options). A ULID id is qualified like any other, so this record closes
   `plan.md`'s ULID-or-prefix question for federation: prefixes, with ULIDs
   still allowed. A duplicate id within one member stays that member's
   `unique-id` error. Duplicate `log` or `repo` values make the manifest
   invalid, and every reader refuses it.

4. **Cross-repository `relatesTo` and `conflictsWith` become valid. Cross-repository
   supersession stays out.** A log-qualified `relatesTo` or `conflictsWith`
   resolves only where the named log is present: in a federation, or in the
   evaluator with a `FederatedLogSnapshot`. In a federation, a reference whose
   log is a member but whose id that member lacks is `dangling-relatesTo`
   (`error`) or `dangling-conflictsWith` (`warn`), the severities a local
   reference has today. A reference naming a log that is not a member is
   reported `federated-ref-unresolved` (`info`). A log-qualified `supersedes` or
   `supersededBy` stays a `dangling-*` error everywhere in this version.
   `dangling-supersededBy` gates `adr explain` before any temporal code runs,
   and an `--as-of` window cannot close on a successor in another repository
   without that repository's dates. That is the `undetermined` problem
   ADR-0039 has for `deprecated`. Admitting cross-repository supersession needs
   its own record.

5. **`adr lint` reports a log-qualified `relatesTo` or `conflictsWith` as
   `federated-ref-unresolved` (`info`) instead of `dangling-*` (`error`).** This
   is the one existing behavior this record changes, and it relaxes a CLI exit
   code. Without it, a member repository cannot hold the references clause 4
   admits, because its own corpus gate fails. The severity follows
   `marker-unresolvable` (`info`, ADR-0022). A member's CI cannot fix such a
   reference locally, so `warn` would leave a permanent warning there. A
   misspelled log is caught where it can be judged: in the federation, by
   clause 4's member check. An unqualified dangling reference is unchanged.
   `validateCorpusInvariants` uses `parseAdrRef` for this. This is the only
   non-additive change in this record. It renames a finding in
   `adr lint --json` and lowers its severity for the qualified case, so it asks
   ADR-0031 clause 5's additive-only obligation to give way. It is confined to
   a case the schema has always accepted and the gate has always rejected. It
   goes in the CHANGELOG as a behavior change of the lockstep CLI.

6. **The SDK gains one aggregate entry point, `openFederation`.**
   `openFederation({ root })` reads `federation.lock.json` and each member's
   sidecar under a populated root and opens one `openDecisions` handle per
   member. It returns a `DecisionFederation` with `members` (each one's `log`,
   `repo`, `commit`, and its `DecisionSet`), `get(ref)` for a qualified `AdrRef`,
   `issues` (each member's issues tagged with its `log`, plus the federation's
   own: a missing sidecar, a sidecar commit that disagrees with the lock, a
   manifest error, and clause 4's reference findings), and
   `graph({ kinds })` with nodes keyed `<log>:<id>`. A member that fails to
   open stays listed with its issues and is never dropped. This is additive to
   an unpublished package. It widens the surface `docs/sdk-surface.md` counts,
   so that count is re-measured as ADR-0054's SDK fields were. `openDecisions`
   and `DecisionSet` do not change. `openFederation` does no network or git
   work. It reads files under `root` and is confined to `root` by `realpath`.

7. **The portal aggregates by indexing members, not by merging them.** Each
   member keeps its own `portal-data.json` v1, built by the existing pure
   builder from that member's handle and commit, at `members/<log>/portal-data.json`.
   A new `federation-index.json` (`version: "1"`) lists each member's `log`,
   `repo`, `commit`, record and issue counts, and the path to its data file.
   The page loads the index when it exists and otherwise behaves exactly as it
   does today. Routes gain a member segment (`#/m/<log>/adr/0012`). An
   org view shows status counts and the queue across members, each row naming
   its log. A qualified reference becomes a link when its log is a member. The
   page is static and cannot call the SDK, so the generator writes the
   cross-member graph into the index. It holds nodes keyed `<log>:<id>` and
   edges of all three kinds, taken from `openFederation`'s graph, under the
   board's limits (a summary past 300 records or 1,000 relationships). In a
   member's own v1 file, a qualified `relatesTo` or `conflictsWith` target
   has no node. The page renders it as unresolved reference text, never as an
   edge to nothing, so the copied layout module is never handed a dangling
   edge. Merging records into one v1 file would make `records[].id`
   non-unique, a reinterpretation ADR-0054 clause 3 reserves for v2. A
   single-repository build stays byte-identical. In a federation build,
   governance by path always says it has no table, as ADR-0055 clause 9's
   server does. The populator writes only corpus directories, and ADR-0054
   clause 6's table needs the member's tracked tree and git. Each member's own
   single-repository portal remains the place for that view.

8. **The portal Action gains a `federation-root` input, exclusive with `dir`.**
   It builds from a root the populator wrote. Exit codes follow ADR-0054
   clause 9 per member. Any member with error findings marks the build exit
   `1` and shows a banner naming that member. A missing or unreadable member,
   a sidecar mismatch, or an invalid manifest is exit `2` and writes nothing.
   The Action still holds `contents: read` only. The populator's token is a
   separate step's secret and never reaches the build.

9. **Private members fail closed, twice.** The populator compares each
   member's declared `visibility` with the repository's actual visibility,
   read from the GitHub API with the token it already holds. It refuses on a
   mismatch, and `internal` counts as `private`. The portal build refuses any
   federation with a `private` member unless `publish-private: true` is set,
   with the same meaning as ADR-0054 clause 10. The aggregate also discloses
   member names and repository paths, so a federation's index is no more
   public than its least public member.

10. **The aggregate never writes and never gates.** No federation surface
    records review or ratifies. A decision is approved, objected to,
    resolved, and accepted in its own repository, by a person, through a pull
    request (ADR-0044, ADR-0051, ADR-0052). Clause 7's page shows review
    facts with no verdict and no review or ratifying command (ADR-0054
    clause 5). Reference findings from clauses 4 and 5 never change a
    member's exit code. Another repository's records never enter a member's
    `adr check` or governing-decisions Action. ADR-0022's markers keep their
    single-repository scope and gain no authority across repositories. The
    writing-verb test ADR-0055 clause 2 applies to `packages/server/src` is
    applied to the new SDK module and the populator too.

11. **Cross-repository `affects` is named, not built.** In a federation, a
    `repo`-qualified matcher applies to a member when it equals that member's
    `repo` or its `log`. That rule settles the two grammars, keeping ADR-0056's
    `owner/name` form valid. It is the rule a future `governing(<log>, path)`
    on `DecisionFederation` will use. That method, the core change to
    `matcherAppliesToLog` that accepts both names, and an `info` finding for a
    repo-qualified matcher skipped in a single-repository run are deferred to
    the second phase.

12. **Surfaces and phases.**
    - **Phase 1 (this record's scope):** the manifest and its schema, the
      populator Action, clause 5's lint change, `openFederation`, and the
      portal index with the Action input. That is the smallest set that
      delivers an org-level portal, and the portal is the real consumer
      ADR-0031 clause 8 asks for.
    - **REST (ADR-0055):** no code change is needed to serve members, because a
      populated root is already a valid server configuration, with one corpus
      key per `log` and the sidecar ADR-0055 expects. An aggregate route
      (`/api/v1/federation`, over `openFederation`) and the server-hosted org
      portal are deferred until phase 1's SDK handle has been exercised.
    - **CLI:** deferred, and it will never fetch. A later read-only
      `--federation-root <dir>` on `lint`, `graph`, and `queue` may read a
      populated root through the SDK, as ADR-0031 clause 6's CLI adapter
      would. That is new semver surface, so it waits for adopter demand. The
      CLI gains no network path and no new subprocess.
    - **MCP:** deferred. Named-log federation is outside the maintainer-ratified
      stdio scope. Remote clients get the aggregate through REST.
    - **Backstage (ADR-0029, external):** consumes `openFederation` or the REST
      routes. Tier 1 is unchanged. Mapping a catalog entity to a member `log`
      is entity-derived, so it is Tier 2 and is not authorized here.
    - **GitHub Projects (ADR-0058):** one org project fed from a federation is
      deferred. If it is built, its `ADR ID` key field holds the qualified
      `<log>:<id>`, so single-repository items do not collide.

## Options considered

### Aggregation model

- **Option A: a manifest and a populator producing a pinned, populated root
  (chosen).** It reuses ADR-0013's offline-generation boundary and ADR-0055's
  sidecar verbatim. Every reader stays file-only, and identical lock files give
  identical output.
- **Option B: live cross-repository reads at query time.** These would come
  from the GitHub API in the SDK, server, or page. They put network access and
  credentials inside surfaces ADR-0055 clause 4 keeps away from GitHub. Results
  would depend on when someone asked, and the SDK would gain a network-reading door
  with failure modes `openDecisions` deliberately lacks. Rejected.
- **Option C: copy records into the org repository by pull request.** This is
  auditable, but it creates a second copy of each record that can drift from
  its source. ADR-0004 rejects exactly that. Rejected.
- **Option D: git submodules.** This pins commits natively, but it pulls whole
  repositories, needs credentials at clone time for every reader, and leaves
  ref updates to people. It is still a valid way to write the populated layout,
  and clause 2 admits it as a populator.

### Pinning

- **A lock file written by the populator (chosen).** The manifest states
  intent (`ref`), and the lock records the resolved SHAs. A manifest whose
  `ref` is a 40-hex SHA is fully reproducible.
- **A committed lock, updated by pull request like `bun.lock`.** This makes
  every advance of a member a reviewed change. It is a reasonable later mode,
  and the lock's shape allows it, but nobody has asked for it. Deferred.

### Identity

- **`<log>:<id>`, the existing `AdrRef` form (chosen).** It needs no schema
  change, and the evaluator, the marker resolver, and MCP already parse it.
- **`owner/repo#0012`.** It reads well on GitHub, but `AdrRef` rejects `/` and
  `#`. Adopting it is a schema change to every reference field. It would also
  tie record content to a hosting path that changes when a repository is
  renamed or moves organization. A `log` is a stable name the manifest maps
  to a `repo`, so a rename is a one-line manifest change.
- **Globally unique ULIDs only.** These avoid collisions without qualifiers,
  but require every member to renumber, and the schema's id grammar permits ordinals.

### Portal data

- **Per-member v1 files plus an index (chosen).** Nothing in v1 is
  reinterpreted, and single-repository builds do not change.
- **`portal-data.json` v2 with a `corpora` dimension.** One file is simpler for
  the page, but it is a breaking version for every v1 reader, including
  ADR-0055's server. Deferred until a v2 is needed for another reason.
- **Merge into v1 with qualified ids.** This silently changes what
  `records[].id` means. Rejected under ADR-0054 clause 3.

### Where the fetch lives

- **A nested Action, with the layout as the contract (chosen).** Network
  access and credentials stay in CI, and other populators remain possible.
- **`adr federation fetch` in the CLI.** This would add network access and
  credential handling to a published, semver-bound tool whose only subprocess
  is a local `git`. It would also add CLI surface for an operation that is CI
  plumbing. Advised against.

## Trade-offs

- **The aggregate is as fresh as the last populator run.** Every view names
  each member's commit, so staleness is visible rather than hidden.
- **Clause 5 relaxes a gate.** A typo in a qualified `relatesTo` that `adr lint`
  failed on before is now `info` in the member and is caught only in a
  federation. Qualified references were always meant to be inert until
  resolved, as the evaluator, markers, and MCP already treat them, so the old
  `error` was the outlier. Unqualified references lose nothing.
- **Cross-repository supersession is refused.** An organization that replaces
  one repository's decision with another's must, for now, supersede within one
  repository and relate across them.
- **Another nested Action (the fifth, after the portal's under ADR-0054 and the
  project Action's under ADR-0058) and a second portal input** join the
  lockstep release and `action-tag-recovery.yml`'s bundle list, beside the
  entries those records add.
- **The page grows a member dimension.** Hash routes gain a segment. The
  single-repository routes stay as they are.

## Consequences

- Easier: an organization gets one portal over several repositories. It is
  built from pinned commits with the existing generator, and every record
  stays where it was decided.
- Easier: the SDK gains an aggregate a Backstage backend or the REST server
  can hold, built from handles it already has.
- Easier: `relatesTo: ["payments:0012"]` becomes something a member can
  commit, and the schema and the gate agree.
- Harder: `scripts/check-deps.ts` needs an entry for the populator's package
  and an updated `@adrkit/ci` entry, each with a negative case.
- Harder: three readers now interpret a qualified reference, and they must
  stay consistent. A shared fixture runs lint, the evaluator, the marker
  resolver, and `openFederation` over one qualified reference.
- **Risks.** A private member's records reach a public site through a wrong
  `visibility`. Clause 9 checks it against the API and also requires
  `publish-private`. A populator token with access beyond the member list.
  The documented App is scoped to the members. A member whose history is
  rewritten so a pinned SHA disappears. The populator fails for that member
  with exit `2`, and nothing is half-written.
- **How we would know this was wrong:** a federation surface calls GitHub or
  runs git outside the populator; a single-repository portal build changes a
  byte; a member's exit code moves because of another repository; a private
  member publishes without `publish-private: true`; any federation surface
  records review or ratifies; `openFederation` and a member's own
  `openDecisions` disagree about that member's records; or a cross-repository
  `supersedes` is silently accepted.
- **Revisit if:** organizations ask for cross-repository supersession; a
  committed lock becomes the norm; another reason forces `portal-data.json`
  v2; or a federation outgrows reading every member into memory, which is
  ADR-0004's derived index.

## Evidence rung

Nothing here exists. Phase 1 reaches **rung 1** of ADR-0014 at best when
action items 1 to 6 land, with unit, contract, purity, and fail-closed tests,
each observed failing first (ADR-0016). A federation of this repository and
the dogfood repository, built and published by the populator and the portal
Action (item 7), would be rung 2. No external organization has run it, so
rung 3 is absent.

## Action items

1. [ ] Define the manifest in Zod, emit `schema/federation.schema.json`, and
   add the manifest validator (unique `log` and `repo`, required
   `visibility`, no unknown keys).
2. [ ] Change `validateCorpusInvariants` per clause 5, with a CHANGELOG
   behavior-change entry and a test observed failing first.
3. [ ] Add `packages/ci/federation/action.yml`: fetch per member, write the
   tree aside, write the sidecar last, swap, write the lock, and check
   visibility. Add `check-deps` and `action-tag-recovery.yml` entries.
4. [ ] Add `openFederation` and `DecisionFederation` to `@adrkit/sdk`,
   re-measure `docs/sdk-surface.md`, and add the writing-verb test.
5. [ ] Add `federation-index.json`, per-member data files, member routes, and
   the org view to `packages/portal`. Assert single-repository output is
   byte-identical.
6. [ ] Add the portal Action's `federation-root` input with clause 8's exit
   codes and clause 9's `publish-private` refusal.
7. [ ] Build a federation of this repository and `adrkit-t018-dogfood` as
   the rung-2 run.
8. [ ] Ratify or reject this record.
