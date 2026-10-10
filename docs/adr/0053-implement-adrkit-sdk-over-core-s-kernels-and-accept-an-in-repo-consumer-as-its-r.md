---
schemaVersion: 0.2.0
id: "0053"
title: "Implement @adrkit/sdk over core's kernels and accept an in-repo consumer as its real consumer"
status: accepted
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - architecture
  - packaging
  - api
  - governance
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0014"
  - "0016"
  - "0029"
  - "0030"
  - "0031"
  - "0051"
  - "0054"
  - "0055"
affects:
  - type: path
    pattern: "packages/sdk/**"
  - type: path
    pattern: "docs/sdk-surface.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  decidedAt: 2026-10-10T16:17:54Z
---

# ADR-0053: Implement @adrkit/sdk over core's kernels and accept an in-repo consumer as its real consumer

> **Status: accepted.** Agent-drafted, ratified by `@mbeacom` on 2026-10-10. This record implements
> [ADR-0031](./0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
> and interprets its clause 8; it supersedes nothing. It authorizes building
> the SDK's runtime, **not** publishing it. Publication stays a later record's
> act, as ADR-0031 clause 8 and
> [ADR-0029](./0029-scope-backstage-publication-as-a-downstream-consumer-tiered-on-the-entity-owners.md)
> clause 10 require. Nothing described below is implemented at this revision.

## Context

ADR-0031 made `@adrkit/sdk` the consumer contract and authorized its design and
construction. Action item 3 produced the design: `packages/sdk/src/index.ts`
declares `openDecisions(options?)` and a `DecisionSet` handle with `records`,
`issues`, `get(id)`, `queue(options?)`, `graph()`, and `governing(path,
options?)` — seven callable entry points, 17 exported symbols, 0 of 12 object
shapes structurally identical to a core type (`docs/sdk-surface.md`).

That is all that exists. At this revision:

- `src/index.ts` is types only: `openDecisions` is a `declare`, the handle is an
  interface, and the file has no `import` from `@adrkit/core`.
- `package.json` is version `0.0.0` with no `exports`, no `files`, and no
  `dist`; its `//status` note calls it a "types-only design sketch".
- `@adrkit/sdk` is absent from `RELEASE_PACKAGES` in `scripts/release-pack.ts`,
  and `test/packaging.test.ts` asserts that absence, the manifest's shape, and
  that no `export … from` appears in `src/index.ts`.
- `scripts/check-deps.ts` limits the package's dependencies to `@adrkit/core`
  (and `@types/bun` as a dev dependency).
- `docs/sdk-surface.md` says plainly: "Nothing is implemented," and places the
  surface at ADR-0014 rung 0, because no consumer has exercised it.

ADR-0031 clause 8 withholds release until the surface "has been exercised by a
real consumer rather than designed against a hypothetical one." The consumer it
was designed for, a Backstage backend, lives in its own repository under
[ADR-0030](./0030-keep-extension-surfaces-that-carry-a-dependency-tree-outside-this-repository.md)
and does not exist. Waiting for it leaves the SDK unbuilt indefinitely, and an
unbuilt SDK is exactly what the out-of-repo consumers are supposed to build
against.

[ADR-0054](./0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
proposes a static GitHub Pages portal in this repository, built from the SDK. It
is the first consumer that would call this surface for real. The maintainer
decided (D1, 2026-10-10) that an in-repo consumer such as that portal counts as
clause 8's "real consumer", provided the publication record says so and names
what it leaves untested.

Two further facts shape the implementation:

1. **Core's kernels are not all pure.** The projections the handle needs —
   `buildQueueReport`, `resolveAsOf`, `buildAdrGraph`, `resolveAffects`,
   `resolveSourceMarkers`, `bucketDecisions`, `decisionBucketFor` — take their
   inputs as arguments. Reading the corpus (`lintCorpus`, `loadCorpus`) and
   reading a file's inbound `@adr` marker (`readSourceMarkers`) touch the
   filesystem.
2. **The queue's "today" default is still inlined in three places.**
   `new Date().toISOString().slice(0, 10)` appears at `packages/cli/src/queue.ts`,
   `packages/ci/src/queue-action-entrypoint.ts`, and
   `packages/core/src/scaffold/new.ts`, exported from none. `QueueOptions.asOf`
   in the SDK defaults to today, so an implementation either consumes a core
   export or adds a fourth copy. ADR-0031 action item 8 is open and is that
   record's stated publication gate.

## Decision

We will implement the surface declared in `docs/sdk-surface.md` and
`packages/sdk/src/index.ts`, as declared plus the additive widening in
decision 11, as a mapping layer over `@adrkit/core`:

1. **The SDK keeps declaring its own types** (ADR-0031 clause 4). The
   implementation imports core's functions and types internally and maps their
   results onto the SDK's declared shapes. No core type leaves through the
   public surface, and `test/packaging.test.ts`'s no-re-export assertion stays.
   The mapping is the insulation; a core rename is absorbed in the mapping, not
   passed to consumers.
2. **I/O has two doors, and both are named.** `openDecisions` is the only place
   the corpus is read: it resolves the directory, calls core's corpus reader
   once, and returns a handle over the loaded result. A corpus that fails to
   parse yields a handle whose `issues` say so; only an unreadable directory
   rejects, as the declared doc comment states. The one other read is the
   inbound-marker scan in `governing(path)`, which is why that method is
   asynchronous; `readMarkers: false` skips it. `records`, `issues`, `get`,
   `queue`, and `graph` do no I/O and read no clock other than the `queue`
   default below.
3. **No writer.** The SDK imports no transition from core (`acceptAdrSource`,
   the review transitions, the scaffold writer) and exposes no write. This
   keeps ADR-0029's Tier 1 read-only boundary and the rule that the pull
   request is the only write path.
4. **`governing(path)` reproduces `adr explain`'s assembly**, the eight-call
   chain measured from `runExplain`, through core's exported functions. It does
   not reimplement matching. A behaviour test asserts that, for each path in a
   fixture corpus, `governing` groups the same record ids as `adr explain
   --json` does. The caller's obligation to pass only an explicitly supplied
   path (ADR-0029 clause 1) stays in the method's doc comment; the SDK cannot
   enforce it.
5. **`queue()` carries the inline default for now, marked as the fourth
   copy.** When the caller omits `asOf`, the SDK computes today's UTC date
   with the same inline expression, in one function whose comment names it
   the fourth copy of the three listed above. ADR-0031 action item 8 stays
   open and stays a publication gate (decision 9): it replaces all four
   copies with one core export.
6. **Tests before trust.** Behaviour tests for each of the seven entry points
   against fixture corpora (a clean one, one with an invalid record, one with a
   skipped file, one with a dangling supersession); contract tests that the
   SDK's results agree with `adr queue --format json`, `adr graph --format
   json`, and `adr explain --json` on the same corpus; and the conformance
   fixture that ADR-0030 clause 5 names and ADR-0031 action item 6 assigns to
   the SDK — a golden `adr queue --format json` / `adr check --json` pair over a
   small fixed corpus, used as the SDK's own test fixture so one artifact
   discharges both items. The existing
   `packages/core/test/conformance/` suite is a `resolveAffects` table, not that
   fixture. Every new check is observed failing first
   ([ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
7. **No release is prepared.** `test/packaging.test.ts`'s clause-8 assertions —
   absent from `RELEASE_PACKAGES`, version `0.0.0`, no `exports`, no `files` —
   stay exactly as they are until a publication record removes them in the same
   change that authorizes publishing. An in-repo consumer resolves the package
   through the workspace and needs none of them.
8. **D1: an in-repo consumer is ADR-0031 clause 8's "real consumer".** We read
   clause 8 as requiring that a consumer outside `packages/sdk/` has been
   built against the implemented surface and exercised in CI, not that the
   consumer live in another repository. ADR-0054's portal, which builds a
   static site from `openDecisions` at build time, can satisfy it. **The gap
   is stated here and must be restated in the publication record:** the portal
   is a build-time consumer. It opens the corpus once per build and exits. It
   never exercises the reason the surface is a handle at all — a long-lived
   server (a Backstage backend, or the REST API of ADR-0055) serving many
   requests against one load, and the reload or invalidation such a server
   needs when the corpus changes. D1 therefore tests the projections and leaves
   the handle's lifetime model untested.
9. **The gates before a publication record**, which this record sets (ADR-0031
   names only its item 8 as a gate; it calls item 4 hygiene, and this record
   elevates it):
   - ADR-0031 action item 4: `explain`, `lint`, and `new` `--json` converged
     onto core formatters, so the contract tests in decision 6 compare against
     shapes core owns rather than shapes the CLI assembles inline.
   - ADR-0031 action item 8: the absent-input `--as-of` clause exported from
     core and consumed by the CLI, the CI Action, the scaffold, and the SDK,
     replacing all four inline copies (decision 5).
   - ADR-0031 action item 6 / ADR-0030 action item 5: the conformance fixture
     exists and the SDK's tests run against it.
   - A consumer — ADR-0054's portal or another — actually built against the
     implemented SDK in this repository and exercised in CI.
   - The SDK's built output is Node-compatible (decision 10).

10. **Shipped SDK source must run under Node.** Like `packages/cli/src`,
    `packages/core/src`, and `packages/evaluator/src`, the implementation must
    not reference the `Bun` global. `packages/cli/test/node-compatibility.test.ts`
    does not cover `packages/sdk` today; extending it, or an equivalent check, is
    an action item, not a claim.

11. **The surface widens additively, before any publication, in this record's
    scope.** Nothing is published, so these additions cost no consumer a break,
    and they are what ADR-0054's views and ADR-0055 clause 9 need. Each is
    additive to the declared shape; no declared field is removed or
    reinterpreted, and the surface count in `docs/sdk-surface.md` is
    re-measured when they land, as ADR-0031 action item 3 measured it.
    - **`DecisionRecord.body`**: the record's raw Markdown after the
      frontmatter, as core's parser already holds it, so no new I/O. The SDK
      does not render, parse, or sanitize it; that is the consumer's job (for
      ADR-0054, its in-house subset parser). This **reverses** the sketch's
      exclusion of the body (`docs/sdk-surface.md`, "What is deliberately
      excluded"), whose reason was that rendering prose is the document layer
      (ADR-0029 clause 9). A raw string takes over no rendering:
      `@backstage-community/plugin-adr` can still read the file itself and
      ignore the field. The reversal is needed because the portal
      (ADR-0054 clause 12) and the REST server (ADR-0055 clause 9) are two
      hosts of one data file, and the body must reach both the same way
      without either reading record files around the SDK.
    - **`QueueEntry` review fields**, matching what `adr queue --format json`
      (QueueReport v1) carries per item: `approvalCount` (distinct identities,
      as core already counts them under ADR-0051), `quorum`,
      `unresolvedObjectionCount`, `resolvedObjectionCount`, `routingTargets`,
      and a finding count of the item's `itemFindings`. QueueReport v1's other
      item fields (`tierLabel`, `queuedAt`, `slaDays`, `reviewBy`,
      `escalatedAt`, `decidedAt`) stay out until a consumer needs one. No
      readiness verdict is added; the queue reports facts.
    - **Graph edges of all three kinds**: each edge is `{ from, to, kind }`
      with `kind` one of `supersedes`, `relatesTo`, `conflictsWith`, in
      `buildAdrGraph`'s direction convention: for `supersedes`, `from` is the
      successor and `to` the replaced record (derived from both `supersedes`
      and `supersededBy`); for `relatesTo` and `conflictsWith`, `from` is the
      record that declares the relation. `graph()` keeps its documented
      default of supersession edges only; the other two kinds are opt-in
      through an additive `kinds` option, and nodes are never filtered. This
      **extends ADR-0029 clause 1's Tier 1 "supersession graph" to all three
      relation kinds**: each is already public in `adr graph --format json`,
      and none needs the ownership mapping that keeps Tier 2 deferred. With
      this edge shape the ADR-0031 overlap measure moves from 0 of 12 to
      1 of 13 (`DecisionEdge` matches core's `GraphEdge` member for member,
      because both mirror the published `adr graph` edge), still under the
      one-third threshold. The type is renamed from `SupersessionEdge` to
      `DecisionEdge`, which costs nothing before publication.

## Options considered

### Option A: implement now over core, and accept an in-repo consumer (chosen)

Builds the contract the out-of-repo surfaces are meant to consume, and gives
clause 8 a consumer that can exist in this repository. Costs a mapping layer and
a test suite, and leaves the long-lived use untested (decision 8).

### Option B: keep waiting for the out-of-repo Backstage consumer

Keeps clause 8's most literal reading. But that consumer has no repository, and
ADR-0030 expects it to bind to a published SDK; each waits on the other. The
SDK's first shape would stay a guess, which is the risk ADR-0031's trade-offs
name.

### Option C: re-export core's types and skip the mapping layer

Less code. Rejected by ADR-0031 clause 4: a re-export is an alias, and the first
core rename reaches every consumer. `test/packaging.test.ts` would fail on it.

### Option D: implement the SDK over the CLI's JSON (spawn `adr`)

Rejected by ADR-0031 clause 6 and Option B there: a subprocess and string
parsing for a Node consumer that could call a function, and the CLI's `explain`,
`lint`, and `new` JSON is not yet a core shape.

### Option E: let the portal import `@adrkit/core` directly

Fastest for the portal. It would make the first real consumer the one ADR-0031's
second wrongness signal describes — a consumer reaching into core — and would
exercise nothing the SDK is supposed to prove.

## Trade-offs

- **The in-repo consumer is friendlier than a stranger would be.** It is written
  by the same hands as the SDK, against a workspace link, and can change in the
  same pull request. It will find missing projections; it is unlikely to find
  ergonomic or lifetime problems an outside author would.
- **The handle's premise stays unproven.** Load-once is the design's stated
  reason for being a handle (`docs/sdk-surface.md`, "Why a handle, not free
  functions"). A build-time consumer never stresses it.
- **Two contracts still drift.** Decision 6's contract tests compare the SDK
  with the CLI's JSON, which narrows the drift ADR-0031 names; until item 4
  lands, one of those comparisons, `adr explain --json`, is against a shape
  the CLI assembles inline. The queue and graph JSON already come from core
  formatters (`formatQueueReportJson`, `renderJsonGraph`).
- **One more thing to keep Node-compatible**, with a check that does not exist
  yet.

## Consequences

- Easier: ADR-0054's portal, ADR-0055's REST API, and an out-of-repo Backstage
  plugin get one tested way into the corpus instead of re-assembling core's
  kernels; clause 8 gets a consumer that can exist now.
- Harder: a mapping layer to maintain on every intended core change, and a
  contract suite to keep green against the CLI.
- **How we would know this was wrong:**
  - more than a third of the SDK's declared object shapes become structurally
    identical to a type `@adrkit/core` exports (ADR-0031's criterion; baseline
    0 of 12, re-measured after decision 11's widening, where the
    `{ from, to, kind }` edge is expected to match core's `GraphEdge` and
    counts as one);
  - the portal, or any consumer, imports `@adrkit/core` directly to get
    something the SDK lacks;
  - `governing(path)` and `adr explain --json` disagree on which records govern
    a fixture path;
  - the first long-lived consumer has to reopen the corpus per request, or needs
    a reload or invalidation method the surface does not have — the evidence
    that a build-time consumer was not enough to settle the handle's shape;
  - the published package (once a later record allows it) fails to load under
    Node.
- **Revisit if:** the Backstage repository or ADR-0055's API exists before
  publication, in which case it, not the portal, should be the consumer the
  publication record cites; or the handle needs a lifetime API, which would be
  additive before publication and a break after it.

## Evidence rung

**Rung 0** under ADR-0014 at this revision: a types-only design that no consumer
has exercised. Implementing it with the tests in decision 6 would reach **rung
1** at best. A consumer built in this repository is still rung 1; rung 2 would
need a maintainer-owned reference-repository run, and rung 3 an external party.
No external validation is claimed.

## Action items

1. [ ] Ratify or reject this record, including the D1 reading of ADR-0031
   clause 8.
2. [ ] Implement `openDecisions` and the six `DecisionSet` members over
   `@adrkit/core`, keeping the declared types, adding the fields of decision
   11, and adding no re-export.
3. [ ] Before publication, export the absent-input `--as-of` default from
   core (ADR-0031 action item 8) and replace all four inline copies with it:
   the CLI, the CI Action, the scaffold, and the SDK's `queue()`.
4. [ ] Add behaviour tests per entry point and contract tests against
   `adr queue`, `adr graph`, and `adr explain` JSON, each observed failing first.
5. [ ] Build the conformance fixture (ADR-0031 action item 6, ADR-0030 action
   item 5) and run the SDK's tests against it.
6. [ ] Extend `packages/cli/test/node-compatibility.test.ts`, or add an
   equivalent check, to cover `packages/sdk/src`.
7. [ ] When the implementation lands, update `src/index.ts`'s header,
   `package.json`'s `//status`, and `docs/sdk-surface.md`'s "Nothing is
   implemented" and rung statement to match the tree, and replace the
   body exclusion there with decision 11's reason.
8. [ ] Converge `explain`, `lint`, and `new` `--json` onto core formatters
   (ADR-0031 action item 4).
9. [ ] Before any publication record: a consumer built against the implemented
   SDK in this repository and exercised in CI, with the build-time gap of
   decision 8 restated in that record.
