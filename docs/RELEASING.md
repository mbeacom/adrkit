# Releasing adrkit

adrkit distributes four public npm packages and one repository-backed GitHub
Action:

| Artifact | Distribution |
|---|---|
| `@adrkit/core` | npm |
| `@adrkit/evaluator` | npm |
| `@adrkit/cli` (`adr`) | npm |
| `@adrkit/mcp` (`adrkit-mcp`) | npm |
| `packages/ci/action.yml` | Git tag (latest immutable release `v0.2.0`, moving `v0`) |

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

## Local release simulation

From a clean checkout:

```sh
bun install --frozen-lockfile
bun run release:pack -- --tag v0.2.0
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
3. Create and push the matching annotated tag, such as `v0.2.0`.
4. Approve the protected `npm` environment deployment.
5. Confirm the workflow published all packages, created the immutable GitHub
   release, and moved `v0` to the released commit.

Never move an immutable `vX.Y.Z` tag. The release workflow may force-update only
the moving major Action tag (`v0`, later `v1`, and so on).

### One-time `@adrkit/mcp` bootstrap for v0.2.0

npm requires a package to exist before its Trusted Publisher can be configured.
For v0.2.0 only, add a short-lived granular `NPM_TOKEN` to the protected `npm`
environment with publish access limited to `@adrkit/mcp`. The workflow exposes
it to the release script as `NPM_BOOTSTRAP_TOKEN`, and the script maps it to
`NODE_AUTH_TOKEN` only for the `@adrkit/mcp` subprocess; the three existing
packages continue to authenticate with OIDC. After the workflow succeeds:

1. Configure `@adrkit/mcp` with the same GitHub Actions Trusted Publisher
   (`mbeacom/adrkit`, `release.yml`, environment `npm`).
2. Require 2FA and disallow tokens for `@adrkit/mcp`.
3. Delete the temporary `NPM_TOKEN` environment secret.

All releases after v0.2.0 are tokenless for all four packages.
