# Releasing adrkit

adrkit distributes three public npm packages and one repository-backed GitHub
Action:

| Artifact | Distribution |
|---|---|
| `@adrkit/core` | npm |
| `@adrkit/evaluator` | npm |
| `@adrkit/cli` (`adr`) | npm |
| `packages/ci/action.yml` | Git tag (`v0.1.0`, moving `v0`) |

`@adrkit/ci` stays private because GitHub executes the committed Action bundle
directly from the referenced repository ref.

## Release guarantees

- All public package versions are identical.
- The tag is exactly `v<package version>`.
- Packages publish in dependency order: core, evaluator, CLI.
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
bun run release:pack -- --tag v0.1.0
bunx --package node@22 node .release/smoke/smoke.mjs "$PWD"
bunx --package node@24 node .release/smoke/smoke.mjs "$PWD"
bun run release:publish -- --dry-run
```

The generated tarballs and manifest live under `.release/npm/` and are ignored
by git.

## One-time npm bootstrap

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
6. Delete the `NPM_TOKEN` environment secret. For maximum security, set each
   package's publishing access to require 2FA and disallow tokens.

All later releases are tokenless.

## Subsequent releases

1. Update the version in all three public package manifests. Update any
   inter-package expectations and run `bun install` with stable Bun 1.3.14 when
   the lockfile changes.
2. Merge the version change only after CI passes.
3. Create and push the matching annotated tag, such as `v0.2.0`.
4. Approve the protected `npm` environment deployment.
5. Confirm the workflow published all packages, created the immutable GitHub
   release, and moved `v0` to the released commit.

Never move an immutable `vX.Y.Z` tag. The release workflow may force-update only
the moving major Action tag (`v0`, later `v1`, and so on).
