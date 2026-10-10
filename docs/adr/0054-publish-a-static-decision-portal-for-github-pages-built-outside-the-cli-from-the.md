---
schemaVersion: 0.2.0
id: "0054"
title: "Publish a static decision portal for GitHub Pages, built outside the CLI from the SDK"
status: proposed
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - distribution
  - portal
  - ci
  - visualization
  - governance
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0007"
  - "0014"
  - "0016"
  - "0025"
  - "0030"
  - "0031"
  - "0033"
  - "0040"
  - "0044"
  - "0050"
  - "0052"
  - "0053"
  - "0055"
  - "0056"
affects:
  - type: path
    pattern: "packages/portal/**"
  - type: path
    pattern: "packages/ci/portal/**"
provenance:
  authoredBy: agent-drafted
---

# ADR-0054: Publish a static decision portal for GitHub Pages, built outside the CLI from the SDK

> **Status: proposed.** Agent-drafted and not ratified. This record amends no
> record and supersedes none. It places an HTML renderer where
> [ADR-0033](./0033-select-interactive-graph-presentation-at-the-cli-boundary-while-preserving-piped-dot.md)
> decision 11 leaves room for one: that clause keeps native SVG/HTML out of
> "this surface", the CLI, and stays binding on `@adrkit/cli`. It reuses three
> pure modules from the decision board
> ([ADR-0050](./0050-ship-a-read-only-decision-board-canvas-that-maps-the-corpus-from-adr-graph-and-a.md))
> as generated copies, and none of the review-write path
> ([ADR-0052](./0052-record-review-from-the-decision-board-only-after-the-host-s-own-confirmation.md)).
> It is the in-repo consumer that
> [ADR-0053](./0053-implement-adrkit-sdk-over-core-s-kernels-and-accept-an-in-repo-consumer-as-its-r.md)
> names for ADR-0031 clause 8.

## Context

A team on GitHub Pages has no way to browse its decisions in a browser. The
pieces exist but do not compose:

- **The CLI may not render HTML.** ADR-0033 decision 11 refuses to spawn
  Graphviz or ship native SVG/HTML in `adr graph`. Its Option D was rejected
  for its dependency cost: system Graphviz, a layout/WASM package, or an
  in-house engine inside the CLI.
- **Pages already serves CLI projections.** `.github/workflows/site.yml`
  writes `adr queue --format json` and `adr lint --json` into the site build,
  publishes on exit `1` ("the report is complete and publishable"), and skips a
  report on exit `2` or above (ADR-0025). Its build job holds `contents: read`;
  `pages: write` and `id-token: write` live only in the deploy job. `site/`
  itself is adrkit.dev's Astro/Starlight site and is not reusable by adopters.
- **The CLI's JSON is too thin for a portal.** `adr graph --format json` nodes
  carry `id`, `title`, and `status` only (`packages/core/src/graph/build.ts`),
  and `adr queue` covers `proposed` records only.
- **The SDK is the intended source, and it has gaps.** `packages/sdk/src/index.ts`
  is types only. Measured against what a portal shows: `QueueEntry` carries
  id, title, path, tier, SLA state, and deadline, but no approvals, quorum,
  objection counts, routing targets, or finding count (core's `QueueItem` has
  all of them); `DecisionGraph` edges are supersession only, with no
  `relatesTo` or `conflictsWith`; `DecisionRecord` has no body, deliberately,
  because rendering prose is "the document layer". ADR-0053 decision 11
  closes all three gaps additively, as part of implementing the SDK and before
  anything is published, and reverses the body exclusion for this portal and
  ADR-0055.
- **The board already solved layout and theme.** In
  `packages/adapters/agent-plugin/extensions/adrkit/`, `board-layout.mjs`
  (deterministic supersession columns, a summary past 300 records or 20,000 px),
  `board-view.mjs` (pan and zoom helpers), and `canvas-theme.mjs` (tokens with
  light and dark fallbacks and a contrast test) contain no import statement.
  `board-page.mjs` is bound to a token-gated local server, and `board.mjs`
  routes to `board-review-write.mjs`, which records review.
- **The plugin cannot import a shared module.** Every host installs it by
  copying its directory from git. Its `package.json` declares no dependencies,
  and `test/packaging.test.ts` allows an extension module to import only
  `node:` builtins and a named list of siblings, with no dynamic import.
- **`check-deps` reads declarations, not source.** `scripts/check-deps.ts`
  flags a non-adapter workspace that *declares* an adapter dependency. A
  relative source import from `packages/portal` into `packages/adapters/**`
  would not be seen. A package with no `allowedDependenciesFor` entry is,
  in that file's words, "silently unconstrained".
- **ADR-0030 clause 1** admits a surface to this repository only if it declares
  no third-party dependency beyond the vetted set. That rules out a Markdown
  library.

## Decision

We will publish a static, read-only decision portal that a consumer's own
workflow deploys to GitHub Pages:

1. **A private generator, `packages/portal`, built on `@adrkit/sdk` alone.**
   Its only runtime dependency is `@adrkit/sdk`; it never imports
   `@adrkit/core` or `@adrkit/cli`, and spawns no `adr` process. The fields
   its views need beyond the original sketch (the review counts and routing on
   queue entries, the `relatesTo` and `conflictsWith` edges, and the record
   body) are in ADR-0053's implementation scope (its decision 11), with the
   surface count re-measured as ADR-0031 item 3 did. The portal does not
   reach around the SDK, and ships the views those fields feed only once they
   exist. That constraint is what makes the portal ADR-0031 clause 8's real
   consumer rather than a second caller of core. The body comes through the
   SDK rather than a file read in the portal so that both hosts of clause 12
   get it the same way, which ADR-0055 also requires; ADR-0053 decision 11
   records that this reverses the SDK sketch's exclusion of the body.

2. **A nested, build-only Action, `packages/ci/portal`.** `action.yml` with
   inputs `dir` (default `docs/adr`), `out` (default `_site`), and `base-url`
   (optional), running `../dist/portal-action.js` on `node24`, as the queue
   Action does. It builds the bundle into `out` and nothing else. It needs
   `contents: read` only. The consumer's workflow uploads `out` with
   `actions/upload-pages-artifact` and deploys it with `actions/deploy-pages`
   in a separate job that alone holds `pages: write` and `id-token: write`, as
   `site.yml` does. A short workflow doing exactly that is documented with the
   Action. The root `action.yml` stays the governing-decisions alias; GitHub
   lists only root metadata, so this Action stays nested.

3. **A versioned data contract, `portal-data.json`.** One file with
   `version: "1"`, the corpus directory, the commit SHA, and the queue's
   `asOf`; records (id, title, status, standing, date, path, tags,
   supersession, and the body as a restricted token tree); corpus issues; graph
   nodes and edges of all three kinds; queue entries; and the path table of
   clause 6. One pure function in `packages/portal` builds it from an SDK
   handle, so a host that produces the file per request (ADR-0055) produces
   the same shape. That builder takes everything as arguments: the handle,
   the commit, `asOf`, and the already-resolved path table. It reads no
   clock, file, or environment and spawns nothing, and it must stay that way,
   because ADR-0055's server calls it directly; a test asserts its purity.
   The build-time generator does the I/O around it: it resolves `asOf` to
   today (UTC) when none is given, and resolves the path table. The file has
   no `generatedAt`: identical corpus, commit, `asOf`, and path table give
   byte-identical output, the queue's SC-001 discipline. A field is added
   additively; removing or reinterpreting one is `version: "2"`.

4. **Five views, all read-only:** the record list and each record; status
   counts; the supersession graph, laid out by the generated copy of
   `board-layout.mjs`, with its summary past the board's limits; the review
   queue; and governance by path. The page has no form, no POST, and no
   control that changes anything.

5. **The queue shows raw review facts and no verdict.** Approvals against
   quorum, unresolved and resolved objection counts, SLA state, deadline,
   routing, and finding count, as ADR-0050 clause 2 shows them. It never says
   ready, eligible, or ratifiable, and the portal's own strings never contain
   the ratifying command or a review verb as a command. A record's title or
   body may still contain one, as ADR-0044's title does; that is repository
   text shown as data. A test fails on either word set in the shipped page
   strings.

6. **Governance by path is a precomputed table, not a matcher.** At build time
   the generator calls the SDK's `governing(path)` for every tracked file and
   keeps the paths at least one decision reaches, with the governing,
   active-proposal, and history ids and the evidence kind. The page looks a
   path up; it ships no glob engine that could disagree with the CLI. The table
   is capped (count and bytes); a capped table says so, and a lookup that
   misses in a capped table says "not in this table", never "ungoverned".
   When the corpus has any error finding, the SDK's `governing` returns all
   three groups empty with the corpus issues, as `adr explain` does. The
   generator then marks the table unavailable with that reason, and the page
   says resolution was withheld because the corpus has errors; it never shows
   an empty or "ungoverned" result (see clause 9).

7. **Security, because titles and bodies are untrusted text on the consumer's
   origin.** A `<meta>` Content-Security-Policy of `default-src 'none'` with
   `'self'` scripts, styles, images, and `connect-src`, plus `base-uri 'none'`
   and `form-action 'none'`. Pages cannot set headers, and `frame-ancestors`
   is ignored in a meta policy; the container (ADR-0055) sets the policy as a
   header and adds `frame-ancestors 'none'`. The page builds its DOM with
   `createElement` and `textContent` only: no `innerHTML`, no inline script, no
   inline style, no `style` attribute, enforced by a test like the canvases'
   `visual-pass.test.ts`. The body is parsed by the builder (clause 3) with an in-house,
   pure Markdown-subset parser (paragraphs, headings, lists, emphasis, code,
   tables, links) into tokens; raw HTML and anything unsupported is rendered as
   literal text. Links are kept only for `http:`, `https:`, fragments, and
   relative links that resolve to another record (rewritten to its route);
   images render as their alt text.

8. **Position-independent output.** Assets are referenced relatively and
   routes are hash routes (`#/adr/0031`), so the bundle works at a Pages
   project path (`/<repo>/`), a custom domain root, or the container's mount
   without a rebuild or a server rewrite. `base-url` feeds absolute links only.

9. **An exit-`1` corpus still publishes.** Exit codes follow `site.yml`'s
   `publish ()` step: `0` writes the bundle; `1` writes the complete bundle
   with every error finding shown in a banner on every page and in the data
   file, the path table marked unavailable as clause 6 says, and the Action succeeds with a warning annotation and an `exit-code`
   output; `2` or above (usage, unreadable corpus) writes nothing and fails the
   Action.

10. **A private repository fails closed.** When the event payload marks the
    repository private or internal, the Action refuses with a fixed message
    unless `publish-private: true` is set, because the bundle carries every
    record body and the governed file paths. The Action cannot read the Pages
    site's visibility, so the input is the person's statement that they
    checked it.

11. **The layout, view, and theme modules are generated copies, owned by the
    plugin.** `board-layout.mjs`, `board-view.mjs`, and `canvas-theme.mjs` are
    copied byte for byte into `packages/portal` by an `emit` script, with a
    header naming the source. `clean-clone-builds` asserts no diff, the
    MANIFEST mechanism of ADR-0040, observed failing first (ADR-0016). The
    copied set is pinned by name. A portal test fails if a copied file imports
    anything or names a review verb. `board-page.mjs`, `board.mjs`,
    `panel-http.mjs`, and `board-review-write.mjs` are never copied. The
    portal writes its own page module. The theme's app-token-first aliases
    fall back to its `--ak-*` tokens outside the app, which is exactly the path
    its contrast test covers.

12. **One bundle, two hosts.** The REST server in the OCI image (ADR-0055),
    deployed to Azure (ADR-0056), serves this same bundle. It produces
    `portal-data.json` by calling this package's pure builder (clause 3), so
    the private `@adrkit/server` depends on the private `@adrkit/portal`, both
    bundled into the same image; the details are that record's decision, and
    the contract here is the file's shape. The server holds `docs/adr` and no
    source tree, so it passes an empty path table and the governance-by-path
    view there says it has no table rather than "ungoverned". In ADR-0056's
    first version the gateway publishes `/` in private mode only.

## Options considered

### The renderer's home

- **Option A: a private package outside the CLI, fed by the SDK (chosen).**
  Keeps ADR-0033 decision 11 intact and gives the SDK a consumer.
- **Option B: `adr portal` or `adr graph --format html`.** Exactly what
  decision 11 refuses, and new lockstep CLI surface (ADR-0031's semver
  commitment) for a build artifact.
- **Option C: feed the portal from CLI JSON, as `site.yml` feeds badges.**
  No new contract, but the graph JSON is thin, the queue lacks non-`proposed`
  records, and three commands' JSON is still assembled in the CLI
  (ADR-0031 clause 6). The portal would rebuild per-record detail from
  frontmatter, which is the reimplementation ADR-0031 exists to stop.
- **Option D: a separate repository.** ADR-0030 sends a surface out only when
  it carries a dependency tree. This one declares none beyond the SDK.

### The shared renderer

- **Option 1: generated copies, the plugin as owner (chosen).** No import
  edge in either direction, so the plugin's install-by-copy and its sibling
  allowlist hold, and `check-deps` is not bypassed. Drift is a CI failure, as
  for `MANIFEST.md`. AGENTS.md already accepts "pure helpers shipped twice"
  for `board-view.mjs`, whose functions are embedded in the page by
  `Function.prototype.toString` and tested as embedded.
- **Option 2: a shared pure module both import.** The plugin cannot import
  it: it declares no dependencies, its packaging test admits only named
  siblings, and its install copies one directory. Putting the module in the
  plugin and importing it from `packages/portal` by relative path is an
  adapter edge `check-deps` cannot see, because it reads `package.json`. That
  defeats ADR-0007's guard rather than satisfying it, and would carry adapter
  code into `@adrkit/ci`'s bundle with no declaration.
- **Option 3: a portal-only renderer.** No coupling, but a second layout
  algorithm and a second token set, two pictures of one corpus that can
  disagree, and a contrast test to duplicate.

### Markdown

- **In-house subset parser (chosen).** Required by ADR-0030 clause 1.
- **A Markdown library with HTML disabled.** Better fidelity, but a
  third-party dependency in a surface admitted for having none.
- **Show the body as preformatted text.** Safe and simple, but tables and
  headings in records become unreadable.

## Trade-offs

- **Fidelity.** The subset parser renders less than GitHub does. Each record
  links to its source when a repository URL is known.
- **A copy is still a copy.** A layout fix lands in the plugin, then reaches
  the portal through the emit script and a regenerated `@adrkit/ci` bundle.
  The no-diff check makes forgetting a red build, not drift.
- **The SDK must grow first.** The queue, full-graph, and record-body views
  wait on the SDK fields ADR-0053 decision 11 adds, and each one widens the
  surface ADR-0031 commits to keep.
- **A third nested Action** joins the lockstep draft-and-`v0` release, and
  `action-tag-recovery.yml` (which checks `dist/index.js` and
  `dist/queue-action.js`) must learn its bundle.
- **The table is as of one commit.** It cannot answer for a branch, an
  uncommitted file, or a path added since the build.
- **Pages cannot carry `frame-ancestors`.** The page has no control worth
  framing, so the residual clickjacking risk is accepted on Pages only.

## Consequences

- Easier: a Pages team gets records, status, the supersession graph, the
  queue, and path lookup in a browser with one Action and a documented
  workflow, and no server.
- Easier: the SDK gets the consumer ADR-0031 clause 8 asked for, exercised on
  every build.
- Harder: `check-deps` needs an `@adrkit/portal` entry (`@adrkit/sdk` only)
  with a negative case, and `@adrkit/ci`'s entry must admit the portal.
  Without the first, the package is silently unconstrained. ADR-0055's
  `@adrkit/server` entry admits `@adrkit/portal` too, which is why the
  builder's purity (clause 3) is a contract, not a convenience.
- Harder: `packages/ci/package.json` gains a third `bun build` line and
  `portal` in `files`; `docs/RELEASING.md` gains a row.
- **Risks.** A private repository's Pages site may be readable by anyone,
  depending on the plan and the site's visibility setting; clause 10 makes
  that a stated choice, not a default. A record title or body that carries
  script, HTML, or a hostile link is shown as text or dropped; the CSP is a
  second wall, not the first. The governed-path table discloses file names to
  whoever can read the site.
- **How we would know this was wrong:** the portal imports `@adrkit/core` or
  spawns `adr`; a page says a record is ready, or shows a ratifying or review
  command outside repository text; any element is built from an HTML string,
  or a record body runs script; the copied modules differ from the plugin's
  without a red build; a write route or form appears; an exit-`1` corpus fails
  to publish; the table and `adr explain` disagree for the same commit; a
  private repository publishes without `publish-private: true`.
- **Revisit if:** the SDK cannot take the queue and edge fields additively;
  the plugin gains a way to import a module outside its directory; Pages gains
  response headers; or ADR-0033's revisit condition (a dependency-appropriate
  engine producing self-contained, accessible SVG) is met. That would change
  the CLI's options, not this package's.

## Evidence rung

Nothing here exists yet. The surface enters **rung 1** of ADR-0014 at best
when action items 1 to 7 land: unit, contract, and purity tests, each
observed failing first (ADR-0016), and a byte-identity check on the copies.
A dogfood build of this repository's own corpus from `site.yml` (item 8)
would be rung 2. No external party has run it, so rung 3 is absent.

## Action items

1. [ ] Land ADR-0053 decision 11 (the queue review fields, the two missing
   edge kinds, and the record body, added to the SDK additively, with the
   surface re-measured) before the views that read them.
2. [ ] Create `packages/portal` (private): generator, `portal-data.json` v1,
   subset Markdown parser, page module, and path table, with determinism,
   purity, sanitizer, and no-`innerHTML`/no-inline-style tests.
3. [ ] Add the emit script and no-diff check for the three copied modules,
   and the copied-set and no-review-verb tests.
4. [ ] Add `check-deps` entries for `@adrkit/portal` and the widened
   `@adrkit/ci`, each with a negative case.
5. [ ] Add `packages/ci/portal/action.yml`, the `dist/portal-action.js`
   build, the exit-code and `publish-private` behavior, and the documented
   consumer workflow.
6. [ ] Teach `action-tag-recovery.yml` and `docs/RELEASING.md` the third
   nested bundle.
7. [ ] Add a test that the portal's shipped strings contain no ratifying or
   review command and no readiness word.
8. [ ] Build this repository's corpus from `site.yml` and publish it under
   adrkit.dev as the rung-2 dogfood.
9. [ ] Ratify or reject this record.
