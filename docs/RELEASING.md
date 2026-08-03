# Releasing adrkit

adrkit distributes four public npm packages and one repository-backed GitHub
Action:

| Artifact | Distribution |
|---|---|
| `@adrkit/core` | npm |
| `@adrkit/evaluator` | npm |
| `@adrkit/cli` (`adr`) | npm |
| `@adrkit/mcp` (`adrkit-mcp`) | npm |
| `packages/ci/action.yml` | Git tag (latest immutable release `v0.3.0`, moving `v0`) |

`@adrkit/ci` stays private because GitHub executes the committed Action bundle
directly from the referenced repository ref.

The coordinated `v0.2.0` release is complete. `@adrkit/core`,
`@adrkit/evaluator`, and `@adrkit/cli` use GitHub Actions Trusted Publishing.
`@adrkit/mcp` was created with the isolated one-time bootstrap path below; its
Trusted Publisher and token-restriction cleanup must be completed before the
temporary `NPM_TOKEN` is removed from the protected `npm` environment.

## Release guarantees

- All public package versions are identical. Introducing `@adrkit/mcp` as a
  fourth public package therefore requires bumping `@adrkit/core`,
  `@adrkit/evaluator`, and `@adrkit/cli` to the same version in the same
  coordinated release. The first MCP release shipped as v0.2.0.
- The tag is exactly `v<package version>`.
- Packages publish in dependency order: core, evaluator, CLI, MCP (`@adrkit/mcp`
  depends only on core, so it is appended last to preserve the list's
  chronological order).
- Bun 1.3.14 builds and packs the artifacts.
- Packed manifests contain no `workspace:` protocols.
- Tarballs include compiled ESM, declarations, README, LICENSE, and NOTICE.
- Installed tarballs run on Node.js 22 and 24 before publication.
- npm Trusted Publishing supplies short-lived OIDC authentication and automatic
  provenance. npm CLI 11.5.1 is used only as the registry transport because Bun
  1.3.14 does not implement npm's OIDC exchange.
- A rerun skips an already-published package only when its registry integrity
  exactly matches the local tarball.
- The GitHub release and moving major Action tag are created only after every
  npm package succeeds.

## SemVer and export-surface policy

Until adrkit reaches `1.0.0`, the four public npm packages still move in
lockstep: every release uses the same `0.x.y` version for `@adrkit/core`,
`@adrkit/evaluator`, `@adrkit/cli`, and `@adrkit/mcp`, even when only one
package changed.

The public surface is:

- each package's `package.json` `exports` map and binaries;
- the runtime named exports of each public entrypoint, pinned by the package
  surface tests;
- documented CLI commands, flags, exit codes, and JSON output envelopes.

Patch releases must be backward compatible: no removals, renames, exit-code
reclassification, or incompatible output/type-shape changes. Minor releases may
carry breaking changes before `1.0.0`, but the release notes must call them out
explicitly. Adding a runtime export is not breaking, but it intentionally expands
the API: update the matching surface test and mention the addition in the
release notes. Any `exports` map or runtime named-export change that is not
accompanied by a surface-test update is a release blocker.

## Local release simulation

From a clean checkout:

```sh
bun install --frozen-lockfile
bun run release:pack -- --tag v0.3.0
# With Node 22 selected in your Node version manager:
node .release/smoke/smoke.mjs "$PWD"
# Switch the same shell to Node 24, then run:
node .release/smoke/smoke.mjs "$PWD"
bun run release:publish -- --dry-run
```

The generated tarballs and manifest live under `.release/npm/` and are ignored
by git. The Node version manager is intentionally not prescribed; CI uses
`actions/setup-node` for both supported versions. Do not substitute the npm
`node` package through `bunx`: its executable resolution is platform-dependent.

### Published-consumer advisory audit

The PR CI `bun audit` gate deliberately scopes itself to this workspace's
resolved tree and does **not** audit consumer installs of the published
`@adrkit/*` manifests
([ADR-0017](adr/0017-keep-dependency-audit-scope-explicit-and-release-scoped.md)).
That audit is release evidence, so it runs here, against the packed tarballs —
**all four of them**. `release:pack` already builds `.release/smoke/` with every
artifact in the release manifest wired as a `file:` dependency, so auditing there
covers the whole published set and cannot drift out of sync with what was packed:

```sh
(
  cd .release/smoke
  npm install --no-audit --no-fund   # already installed by the step 2 smoke run
  npm audit
)
```

Audit **all four** packages, not a subset. `@adrkit/evaluator` is the only path to
`jsonpath-rfc9535`, and `@adrkit/cli` is the only path to the evaluator, so an
audit of `@adrkit/core` + `@adrkit/mcp` alone never sees that subtree at all
(ADR-0017 action item 2).

The `overrides` block in that project pins the `@adrkit/*` packages to the local
tarballs — which is the point, since the release is not published yet. It does not
affect third-party resolution, so the transitive tree `npm audit` examines is the
genuine consumer tree.

Root overrides are not published in package manifests, so a consumer resolves a
different tree than this workspace does. Reconcile every advisory `npm audit`
reports against `KNOWN_CONSUMER_ADVISORY_ACCEPTANCES` in `scripts/audit-gate.ts`:
each one must already be recorded there with a matching advisory id, an
unexpired `acceptedUntil`, and an `affectedPublishedVersion` equal to the version
being cut. An unrecorded advisory, or a recorded one whose observed version has
moved, is a release blocker until the record is refreshed or the exposure is
removed.

## One-time npm bootstrap (completed for v0.1.0)

The npm scope and packages must exist before Trusted Publishers can be attached.
For the first release only:

1. Create or verify ownership of the public npm `@adrkit` organization/scope.
2. Create a protected GitHub environment named `npm`; require a maintainer
   approval for deployments to it.
3. Create a short-lived granular npm token that can create the three packages,
   add it as the `npm` environment secret `NPM_TOKEN`, and retain 2FA on the
   publishing account.
4. Merge the release-ready change and push the initial version tag. The release
   workflow uses the token only as a bootstrap fallback and still publishes
   provenance:

   ```sh
   git tag -a v0.1.0 -m "adrkit v0.1.0"
   git push origin v0.1.0
   ```

5. In each package's npm settings, configure the GitHub Actions Trusted
   Publisher with:
   - repository owner: `mbeacom`
   - repository: `adrkit`
   - workflow filename: `release.yml`
   - environment: `npm`
6. Delete the `NPM_TOKEN` environment secret and set each package's publishing
   access to require 2FA and disallow tokens.

All later releases are tokenless except when a new package needs the one-time
bootstrap described below.

## Subsequent releases

1. Update the version in all four public package manifests. Update any
   inter-package expectations and run `bun install` with stable Bun 1.3.14 when
   the lockfile changes.
2. Merge the version change only after CI passes.
3. Create and push the matching annotated tag, such as `v0.3.0`.
4. Approve the protected `npm` environment deployment.
5. Confirm the workflow published all packages, created the immutable GitHub
   release, and moved `v0` to the released commit.

Never move an immutable `vX.Y.Z` tag. The release workflow may force-update only
the moving major Action tag (`v0`, later `v1`, and so on).

## v0.3.0 cutover runbook — **COMPLETE**

**All eight steps are done.** v0.3.0 published on 2026-07-31 from `3adefc7` (npm:
`@adrkit/core`, `@adrkit/evaluator`, `@adrkit/cli`, `@adrkit/mcp`; GitHub release;
`v0` moved to the release commit); the MCP registry entry was re-published at
`0.3.0` the same day. Step 8 needed no work — the queue Action examples were
already de-pinned to `@v0` during the v0.2.1 cutover (#65), and the one surviving
full-commit pin is in `specs/007-arb-queue/checklists/reference-verification-evidence.md`,
which is deliberately immutable because it records reproducible evidence.

This section is retained as the worked template for the next cutover — substitute
the new version throughout.

Run these steps only after the version-bump PR is the last change merged to
`main`; for v0.3.0 that was #68. If anything else merges ahead of the version
bump, refresh the changelog and re-run the local simulation before tagging.

Two notes worth carrying forward from the v0.3.0 cutover:

- `bun run release:pack` triggers a **non-frozen** `bun install`, which can pull
  transitive drift into the committed `packages/ci/dist` bundles. Check
  `git status` after step 2; it was clean for v0.3.0.
- The published-consumer advisory audit reported **0 vulnerabilities** at v0.3.0,
  and `KNOWN_CONSUMER_ADVISORY_ACCEPTANCES` is now empty
  ([ADR-0018](adr/0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)
  removed the last entry). Any advisory appearing in a future run is therefore an
  unrecorded exposure and a release blocker until reconciled.

1. Start from the final release commit on `main`.

   ```sh
   git switch main
   git pull --ff-only origin main
   git log -1 --oneline
   ```

   Verify that the last commit is the intended v0.3.0 release-prep commit.

2. Re-run the local release simulation.

   ```sh
   bun install --frozen-lockfile
   bun run release:pack -- --tag v0.3.0
   # With Node 22 selected:
   node .release/smoke/smoke.mjs "$PWD"
   # With Node 24 selected:
   node .release/smoke/smoke.mjs "$PWD"
   bun .release/smoke/smoke.mjs "$PWD"
   bun run release:publish -- --dry-run
   bun -e "const m = await Bun.file('.release/npm/manifest.json').json(); if (m.version !== '0.3.0' || m.artifacts.length !== 4 || !m.artifacts.every((a) => a.version === '0.3.0')) throw new Error('release manifest is not entirely 0.3.0');"
   ```

   Verify that all commands exit 0; the final assertion fails if the release
   manifest is missing or names any package version other than `0.3.0`. Then run
   the [published-consumer advisory audit](#published-consumer-advisory-audit)
   against the tarballs just packed, and confirm every reported advisory is
   already recorded in `scripts/audit-gate.ts` at `affectedPublishedVersion:
   '0.3.0'` with an unexpired acceptance.

3. Create and push the immutable release tag.

   ```sh
   git tag -a v0.3.0 -m "adrkit v0.3.0"
   git push origin v0.3.0
   ```

   Verify the release workflow started:

   ```sh
   release_sha=$(git rev-list -n 1 v0.3.0)
   release_run_id=$(
     gh run list \
       --workflow release.yml \
       --event push \
       --commit "$release_sha" \
       --limit 10 \
       --json databaseId,headSha \
       --jq "map(select(.headSha == \"$release_sha\")) | first | .databaseId // empty"
   )
   test -n "$release_run_id"
   gh run view "$release_run_id" --json status,conclusion,headSha,url
   ```

4. Approve the protected `npm` environment deployment in GitHub Actions.

   Verify the exact release workflow run succeeds:

   ```sh
   release_sha=$(git rev-list -n 1 v0.3.0)
   release_run_id=$(
     gh run list \
       --workflow release.yml \
       --event push \
       --commit "$release_sha" \
       --limit 10 \
       --json databaseId,headSha \
       --jq "map(select(.headSha == \"$release_sha\")) | first | .databaseId // empty"
   )
   test -n "$release_run_id"
   gh run watch "$release_run_id" --exit-status
   ```

5. Confirm all npm packages and the MCP ownership metadata are published.

   ```sh
   for package in @adrkit/core @adrkit/evaluator @adrkit/cli @adrkit/mcp; do
     test "$(npm view "${package}@0.3.0" version)" = "0.3.0"
   done
   test "$(npm view @adrkit/mcp@0.3.0 mcpName)" = "dev.adrkit/mcp"
   ```

   Verify the command exits 0; any missing package, wrong version, or missing
   `mcpName` fails the step.

6. Confirm the GitHub release and moving major Action tag.

   ```sh
   gh release view v0.3.0
   release_sha=$(git rev-list -n 1 v0.3.0)
   remote_release_sha=$(git ls-remote --tags origin 'refs/tags/v0.3.0^{}' | awk '{print $1}')
   remote_major_sha=$(git ls-remote --tags origin refs/tags/v0 | awk '{print $1}')
   test "$remote_release_sha" = "$release_sha"
   test "$remote_major_sha" = "$release_sha"
   gh api 'repos/mbeacom/adrkit/contents/packages/ci/queue/action.yml?ref=v0' --jq .path
   ```

   Verify the release exists, both tag comparisons exit 0, and the contents API
   prints `packages/ci/queue/action.yml`.

7. Publish the official MCP registry entry after the npm checks pass.

   ```sh
   cd packages/mcp
   mcp-publisher publish
   curl --fail --silent --show-error \
     'https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.adrkit/mcp' \
     | grep -F 'dev.adrkit/mcp' \
     | grep -F '0.3.0'
   ```

   Verify the command exits 0; the grep pipeline fails if the registry response
   does not include both `dev.adrkit/mcp` and package version `0.3.0`. If
   namespace proof has not been completed yet, follow
   [`docs/DISTRIBUTION.md`](./DISTRIBUTION.md) section A before publishing.

8. De-pin queue Action examples only after `queue@v0` resolves.

   ```sh
   gh api 'repos/mbeacom/adrkit/contents/packages/ci/queue/action.yml?ref=v0' --jq .sha
   rg 'mbeacom/adrkit/packages/ci/queue@efef89b5d747ca175a1947f1ce2f4296dab54fa3'
   ```

   Verify the contents API returns the queue Action blob SHA. Then update
   copy-pasteable documentation examples from the full commit pin to
   `mbeacom/adrkit/packages/ci/queue@v0`; keep immutable pins where the text is
   explicitly teaching reproducibility.

### One-time `@adrkit/mcp` bootstrap for v0.2.0 (completed)

This step is **done** and is kept only as a record. The workflow no longer
passes any npm secret; the `NPM_BOOTSTRAP_TOKEN` wiring was removed from
`release.yml` once `@adrkit/mcp` had its own Trusted Publisher.

npm requires a package to exist before its Trusted Publisher can be configured.
For v0.2.0 only, a short-lived granular `NPM_TOKEN` was added to the protected
`npm` environment with publish access limited to `@adrkit/mcp`. The workflow
exposed it to the release script as `NPM_BOOTSTRAP_TOKEN`, and the script mapped
it to `NODE_AUTH_TOKEN` only for the `@adrkit/mcp` subprocess; the three existing
packages continued to authenticate with OIDC. After the workflow succeeded:

1. `@adrkit/mcp` was configured with the same GitHub Actions Trusted Publisher
   (`mbeacom/adrkit`, `release.yml`, environment `npm`).
2. 2FA was required and tokens disallowed for `@adrkit/mcp`.
3. The temporary `NPM_TOKEN` environment secret was deleted.

`publishEnvironment` in `scripts/release-publish.ts` still honours
`NPM_BOOTSTRAP_TOKEN` if it is ever set, but nothing sets it. All releases after
v0.2.0 are tokenless for all four packages.
