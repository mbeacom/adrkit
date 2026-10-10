---
schemaVersion: 0.2.0
id: "0057"
title: "Preview the decision portal locally through a preview selector in the published image, published to loopback only"
status: proposed
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - portal
  - container
  - distribution
  - security
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0014"
  - "0016"
  - "0030"
  - "0031"
  - "0032"
  - "0033"
  - "0053"
  - "0054"
  - "0055"
affects:
  - type: path
    pattern: "packages/portal/src/preview.ts"
  - type: path
    pattern: "packages/portal/src/bin.ts"
  - type: path
    pattern: "Containerfile"
  - type: path
    pattern: "scripts/container-entrypoint.sh"
provenance:
  authoredBy: agent-drafted
---

# ADR-0057: Preview the decision portal locally through a preview selector in the published image, published to loopback only

> **Status: proposed.** Agent-drafted and not ratified. It adds a second
> in-image consumer of the portal generator of
> [ADR-0054](./0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md),
> beside the `server` selector of
> [ADR-0055](./0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md),
> in the one image
> [ADR-0032](./0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md)
> publishes. It amends no record and supersedes none. It keeps
> [ADR-0033](./0033-select-interactive-graph-presentation-at-the-cli-boundary-while-preserving-piped-dot.md)
> decision 11 intact: the selector is not a CLI command. Nothing here is built
> yet.

## Context

The maintainer asked whether a person with a checkout can bring the portal up
locally and walk an architecture review board (ARB) through the open
proposals. Today they cannot without writing code:

- **The generator has no command-line entry.** `packages/portal/src/generate.ts`
  exports `generatePortal(options)`, and nothing calls it except tests.
  `packages/portal/package.json` declares no `bin`.
- **`@adrkit/portal` is private and unpublished.** Its `package.json` says so,
  and its `//release` note names the two ways it reaches users: bundled into
  the nested portal Action (ADR-0054 clause 2) and "later, the OCI image
  (ADR-0055)". It imports the SDK as the subpath `@adrkit/sdk/src/index.ts`,
  because the SDK declares no exports map (`packages/sdk/package.json`; no
  release is authorized under ADR-0031 clause 8), so it cannot be
  published on its own as things stand.
- **The Pages Action is not built.** AGENTS.md says so, and
  [#293](https://github.com/mbeacom/adrkit/issues/293) tracks it (ADR-0054
  items 4 to 6). A Pages deploy would in any case show what is merged, not
  the proposal on someone's branch.
- **The CLI may not render HTML.** ADR-0033 decision 11, which ADR-0054 kept
  binding on `@adrkit/cli`.
- **The image cannot run the generator.** The `Containerfile`'s build stage
  copies `packages/sdk/package.json` but neither `packages/sdk/src` nor
  `packages/portal/src`; `.dockerignore` admits only the core, evaluator,
  CLI, and MCP sources and the committed Action bundles, and
  `scripts/container-contract.test.ts` asserts that allowlist. The final
  stages derive from `node:24-alpine` pinned by digest, with no `git`
  installed.
- **The generator needs git, and refuses to work around ownership.** It runs
  only `git rev-parse`, `git ls-files`, and `git status`, with stdin closed,
  `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`, so a read-only mount is
  fine. A git that cannot start is exit 2 ("install git or put it on PATH").
  An ownership refusal (`dubious ownership`, `safe.directory`) is exit 2 with a
  fixed message, and the file says it deliberately does not override the
  user's global git config. `runGit` passes `process.env` through, so git's
  own environment configuration reaches it.
- **Ownership mismatch is host-dependent.** The image runs as `node` (uid
  1000 in the official image). On Linux Docker and rootless Podman, a mount
  owned by any other uid (a CI runner is 1001) makes git refuse; on Docker
  Desktop the file-sharing layer usually presents the files as the container
  user's. The README already offers `--user "$(id -u):$(id -g)"` for this.
- **A linked worktree has no reachable git directory in the container.** Its
  `.git` is a file naming the main checkout's `.git/worktrees/<name>`, a host
  path that is not mounted. `git rev-parse` then exits 128 with "not a git
  repository", which `gitTopLevel` classifies as `outside`: the corpus is
  still read, `commit` is `null`, and the path table is `absent`. Measured
  with a `.git` file pointing at a missing directory.
- **A dirty checkout is not attributed to HEAD.** `checkoutMatchesHead` gives
  `commit: null` when any tracked file is staged or modified, or any untracked
  file sits inside the corpus directory; an untracked file elsewhere keeps the
  SHA. The page then uses its no-commit wording. That is the right answer for
  walking an uncommitted proposal.
- **The output directory may not be the repository.** `generatePortal`
  refuses an `out` that is the repository, the working directory, or above
  either (lexically and through symlinks), and builds the bundle in a staging
  directory beside `out` (`mkdtemp(dirname(out))`) before swapping it in whole.
  A read-only mount therefore needs `out` outside it, with a writable parent.
- **The page already declares its policy.** `packages/portal/src/page/index.html`
  carries a meta CSP of `default-src 'none'; script-src 'self'; style-src
  'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action
  'none'`. A meta policy cannot carry `frame-ancestors`; ADR-0054 clause 7
  leaves that header to a host that can set one. The bundle's files are
  `index.html`, `app.css`, `page/app.mjs`, two `vendor/*.mjs` modules, and
  `portal-data.json` (`src/page/assets.ts`).
- **ADR-0055's server is the wrong vehicle.** It never runs git and reads a
  commit only from a `.adrkit-corpus.json` sidecar a populator writes (its
  clause 4), holds `docs/adr` rather than a source tree, and binds
  `127.0.0.1` by default (clause 14). A local checkout has no sidecar and
  is a source tree.

## Decision

We will add a `preview` selector to the published all-in-one image that
generates the portal from a mounted checkout once and serves it read-only on
one port, documented only in a form that publishes that port to the host's
loopback.

1. **The documented run.**

   ```sh
   docker run --rm --read-only --tmpfs /tmp \
     -v "$PWD:/workspace:ro" \
     -p 127.0.0.1:8080:8080 \
     ghcr.io/mbeacom/adrkit:vX.Y.Z preview [--dir docs/adr] [--as-of YYYY-MM-DD] [--port 8080]
   ```

   The mount point is `/workspace`, the image's `WORKDIR` and the path every
   existing README and CI example uses. `--read-only` stays, as ADR-0032
   clause 7 asks of examples, with a `tmpfs` for the bundle. `--network none`
   is impossible here, because a published port needs a network; the
   process opens no outbound connection of its own (clause 6). Every
   document that shows this command shows `-p 127.0.0.1:…`, never
   `-p 8080:8080`, which publishes the port on every host interface, the LAN
   included. The README says so in the sentence before the command.

2. **Generate once, then serve.** `bin.ts` calls
   `generatePortal({ cwd: '/workspace', dir, asOf, out })` with `out` a fresh
   directory under the system temporary directory, so both `out` and its
   staging sibling are on the `tmpfs` and outside the mount. Exit 2 from the
   generator is exit 2 from `preview`, with the generator's fixed message, and
   nothing is served. Exit 1 serves the complete bundle, whose banner shows
   every corpus error (ADR-0054 clause 9), and prints one warning line. There
   is no watch mode in this version: the startup line says to restart to
   refresh. A later watch can re-run `generatePortal`, which already swaps a
   staged bundle in whole, so a reader never sees half a bundle.

3. **Git ships in the `adrkit` stage only, pinned.** The `adrkit` final stage
   adds `apk add --no-cache git=<version>`. The shared `runtime` stage does
   not, so the `cli`, `mcp`, `ci`, and `queue-action` isolation targets stay
   git-free, as ADR-0032 clause 4's isolation rationale wants. A new local
   `preview` target mirrors them (the portal bundle and git, nothing else),
   for isolation and inspection, and is not published. The base images stay
   pinned by digest; the package is pinned by version, which is weaker (see
   Trade-offs).

4. **Ownership is trusted for this one process and this one path.** The
   entrypoint's `preview` case sets `GIT_CONFIG_COUNT=1`,
   `GIT_CONFIG_KEY_0=safe.directory`, and `GIT_CONFIG_VALUE_0=/workspace` on
   the `exec` of the preview process alone. Git treats these as command-scope
   configuration, which `safe.directory` honors; no gitconfig file is written,
   and no other selector sees the variables. `generate.ts` is unchanged and
   keeps its rule of never overriding the user's global config. Measured
   locally with git 2.50.1 under `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`: refused
   without the variables, `true` with them. `--user "$(id -u):$(id -g)"`
   remains valid and needs no exception. A linked worktree is served with
   `commit: null` and no path table (Context); the README says to mount the
   main checkout, or to accept that.

5. **A static server that serves the bundle and nothing else**
   (`packages/portal/src/preview.ts`, `node:http`, no framework, per ADR-0030
   clause 1 and ADR-0055 fact 4):
   - **Routes are the bundle's file list.** At start the server takes the
     paths in `PORTAL_ASSETS` plus `portal-data.json`, reads each as a
     regular file from `out` (`lstat`; a symlink is refused), and holds them
     in memory. `/` is `index.html`. Any other path is 404 with fixed text.
     The request path is percent-decoded once and must equal a listed path
     exactly, so `..`, encoded separators, and backslashes cannot name
     anything. It reads no file after start.
   - **`GET` and `HEAD` only**; anything else is 405 with `Allow: GET, HEAD`,
     and no request body is read.
   - **A fixed type map** (`.html`, `.css`, `.mjs` as `text/javascript`,
     `.json`, each with `charset=utf-8`) and `X-Content-Type-Options: nosniff`.
   - **Headers on every response:** `Content-Security-Policy` equal to the
     page's meta policy plus `frame-ancestors 'none'`, `Cache-Control:
     no-store`, and `Referrer-Policy: no-referrer`; no CORS headers. A test
     compares the header with the meta policy in `index.html`, so the two
     cannot drift.
   - **A `Host` check against DNS rebinding.** The hostname of the `Host`
     header, ignoring any port (a person may publish `127.0.0.1:9000:8080`),
     must be `localhost`, `127.0.0.1`, or `[::1]`; otherwise 403 with fixed
     text. This stops a hostile web page from reading the bundle through a
     rebound name. It is not access control: a client that can reach the
     port can send any `Host`, which is why clause 1's loopback publish is
     the actual boundary.
   - **Errors are fixed text**, never a path, an exception message, or
     stderr, as ADR-0055 clause 8 requires of its server.

6. **The bind address is set by the selector, not the server.** `bin.ts`
   defaults to `127.0.0.1`, ADR-0055 clause 14's default, so a host-side run
   (`bun run preview`, clause 8) is loopback-only. The entrypoint's `preview`
   case passes `--host 0.0.0.0`, because inside a container a loopback bind is
   unreachable through a published port. That is a deliberate divergence
   from the server's container default, and it is safe only together with
   clause 1's documented form; the startup line prints the URL as
   `http://localhost:<port>/` and repeats that the port should be published
   to `127.0.0.1` only.

7. **It is an image selector, not CLI surface.** `preview` and `server`
   (ADR-0055) are distinct selectors with distinct jobs: one walks a checkout
   once, the other hosts synced corpora behind a gateway. Neither adds an
   `adr` subcommand, so ADR-0033 decision 11 and the CLI's semver surface
   (ADR-0031) are untouched. `bin.ts` and `preview.ts` import only `node:`
   builtins and the portal's own modules, so `scripts/check-deps.ts`'s
   `@adrkit/portal` entry (`@adrkit/sdk` alone) does not change. ADR-0054's
   `//release` line already anticipates the image; this record names a
   second way it reaches it and does not edit that record.

8. **A repository script is a by-product.** A root `bun run preview` runs
   `bin.ts` against this repository for the maintainer. It is not the
   deliverable: adopters get the image.

9. **The portal still shows no review or ratifying command.** ADR-0054 clause
   5 and its strings test apply unchanged to everything `preview` serves,
   including any view added for an ARB walkthrough. The preview server adds
   no page strings of its own beyond fixed error text, which the same test
   covers.

## Options considered

- **Option A: a `preview` selector in the published image (chosen).** One
  `docker run` for anyone with a checkout, no install, and no change to the
  portal's private status. It costs git in the image (clause 3) and a second
  network-facing selector.
- **Option B: publish `@adrkit/portal` with a `bin`.** The most natural
  `npx` story, but it reverses ADR-0054's private package, and the portal
  deep-imports `@adrkit/sdk/src`, so it needs the SDK's publication under
  ADR-0031 and ADR-0053 first. Rejected for now.
- **Option C: a "local mode" for ADR-0055's server.** One server instead of
  two, but its contract is that it never runs git and reads its commit only
  from a populator's sidecar (clause 4). A local mode would either run git,
  breaking that, or ask the person to write a sidecar by hand. Rejected.
- **Option D: a repository-local script only.** Works for this repository,
  and nowhere else. Kept as a by-product (clause 8), not the answer.

## Trade-offs

- **Git enlarges the published image and its attack surface,** and only
  `preview` uses it. The isolation targets stay clean (clause 3), but the
  one published image does not.
- **An apk version pin is weaker than a digest.** Alpine's repositories keep
  only the current package version per branch, so a pinned `git=<version>`
  fails the build when Alpine ships a fix, even with the base digest
  unchanged. That is a loud failure, maintained like the base digests, rather
  than silent drift, but it is a new kind of maintenance.
- **There is no SBOM or image scanner in CI to catch a bad package.** The
  checks that exist are `scripts/container-contract.test.ts` (digest pins,
  per-target isolation, selector, help, and README sync, the `.dockerignore`
  allowlist), the `container-smoke` job, and the release workflow's
  provenance attestation. Adding git relies on those and on review.
- **A container bind of `0.0.0.0` depends on documentation.** A person who
  types `-p 8080:8080` exposes the portal, every record body, and the
  governed path list to their network. The `Host` check does not stop a LAN
  client. Clause 1's wording and the startup line are the mitigation.
- **One-shot generation.** An edit needs a restart; a watch mode is future
  work.
- **A linked worktree previews without a commit or a path table.** The
  records and every other view still work.

## Consequences

- Easier: an ARB chair runs one command on a checkout, including a branch
  with an uncommitted proposal, and walks the records, graph, and queue in a
  browser, with nothing sent anywhere.
- Easier: the portal gets a second runtime consumer under Node in the image,
  so a Node-only fault in the generator shows up before the Pages Action
  exists.
- Harder: the `Containerfile` build stage copies `packages/sdk/src` and
  `packages/portal/src` and bundles `bin.ts` with `--target=node`;
  `.dockerignore` admits both sources; `scripts/container-contract.test.ts`
  learns the `preview` surface (target, aliases, artifact, entrypoint), the
  allowlist lines, and the smoke strings. ADR-0055 clause 12 plans the same
  two `COPY` lines; whichever lands first adds them, and this record does not
  depend on `packages/server` existing.
- Harder: `bin.ts` and `preview.ts` run under Node, so they may not touch the
  `Bun` global (AGENTS.md), and need a guard like
  `packages/cli/test/node-compatibility.test.ts`.
- Side effect: the `adrkit` stage's git also reaches the `cli` selector in
  the same image, which today has none for `adr explain --as-of <ref>`.
- **Risks.** A LAN-exposed preview through a mistyped `-p` (above). The
  bundle carries every record body and governed path; ADR-0054 clause 10's
  private-repository gate does not apply because nothing is published, and
  the person running it already holds the checkout.
- **How we would know this was wrong:** a documented example publishes the
  port beyond loopback; the server answers a path outside the bundle, a
  method other than `GET`/`HEAD`, or a `Host` outside the three; its CSP
  header differs from the page's meta policy plus `frame-ancestors`; any
  selector other than `preview` sees the `safe.directory` variables; git
  appears in the `cli`, `mcp`, `ci`, or `queue-action` targets; a page served
  by `preview` names a review or ratifying command; `preview` becomes an
  `adr` subcommand.
- **Revisit if:** the SDK is published with an exports map (Option B becomes
  cheap); Alpine pinning breaks builds more than occasionally; or people ask
  for watch mode often enough to build it.

## Follow-ups (not decided here)

The walkthrough itself has gaps this record does not close:

- **An agenda view** of the queue, sorted by SLA deadline then id, grouped by
  routing, printable with `@media print`, with an as-of cut-off. It is a
  portal view, under ADR-0054.
- **A per-record review timeline.** It needs who-approved and when, which
  `adr queue` does not report; QueueReport v1 carries counts only. That is an
  additive CLI and QueueReport field first, then a view.

Neither may show a review or ratifying command, even as text (ADR-0054
clause 5).

## Evidence rung

Nothing here exists yet. The selector enters **rung 1** of ADR-0014 at best
when action items 1 to 5 land: unit and contract tests, each observed failing
against a planted violation first (ADR-0016), and a CI container smoke. No
reference-repository run is planned by this record, and no external party has
run it.

## Action items

1. [ ] Add `packages/portal/src/preview.ts` and `bin.ts`, with
   `preview.test.ts` covering traversal and encoded-path attempts, symlinked
   bundle files, the `Host` check (port ignored), 405 with `Allow`, the type
   map with `nosniff`, and CSP-header equality with the page's meta policy,
   each observed failing against a planted mutation.
2. [ ] Extend the Node-compatibility guard to `packages/portal/src`.
3. [ ] Update the `Containerfile` (copy the SDK and portal sources, bundle
   `bin.ts` with `--target=node`, add pinned git to the `adrkit` stage, add a
   local `preview` target), `.dockerignore`, and
   `scripts/container-contract.test.ts`, asserting git is absent from the
   other isolation targets.
4. [ ] Add the `preview` case and help line to
   `scripts/container-entrypoint.sh`, setting the three `GIT_CONFIG_*`
   variables and `--host 0.0.0.0` for that process only, with an entrypoint
   test.
5. [ ] Add a `container-smoke` step that runs `preview` against a fixture
   repository mounted `:ro` and owned by a uid other than 1000, and asserts
   200 on `/` and `/portal-data.json` and the CSP header.
6. [ ] Document the run in the README with the loopback-only `-p` form and
   the warning before it, the worktree limit, and `--user` as an alternative.
7. [ ] Add the root `bun run preview` script.
8. [ ] Ratify or reject this record.
