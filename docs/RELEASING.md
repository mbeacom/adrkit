# Releasing adrkit

adrkit distributes four public npm packages, one repository-backed GitHub
Action, and one lockstep OCI image:

| Artifact | Distribution |
|---|---|
| `@adrkit/core` | npm |
| `@adrkit/evaluator` | npm |
| `@adrkit/cli` (`adr`, `adrkit`) | npm |
| `@adrkit/mcp` (`adrkit-mcp`) | npm |
| `packages/ci/action.yml` | Git tag (latest immutable release `v0.11.0`, moving `v0`) |
| `ghcr.io/mbeacom/adrkit` | GitHub Container Registry (`vX.Y.Z`, moving `vX`, `latest`; begins with the first release containing ADR-0032) |

`@adrkit/ci` stays private because GitHub executes the committed Action bundle
directly from the referenced repository ref.

The coordinated lockstep surface is published; the current release is `v0.11.0`. `@adrkit/core`,
`@adrkit/evaluator`, and `@adrkit/cli` use GitHub Actions Trusted Publishing.
`@adrkit/mcp` was created with the isolated one-time bootstrap path below; its
Trusted Publisher and token-restriction cleanup must be completed before the
temporary `NPM_TOKEN` is removed from the protected `npm` environment.

## Release guarantees

- All public package versions are identical. Introducing `@adrkit/mcp` as a
  fourth public package therefore required bumping `@adrkit/core`,
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
- The multi-architecture OCI image publishes only after the successful
  lockstep `Release` workflow completes. It carries the same version, an
  immutable `vX.Y.Z` tag, moving `vX` and `latest` tags, and a registry
  provenance attestation. Adapter releases do not publish it.

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
- the published image's selector names and immutable `vX.Y.Z` tag behavior.

Patch releases must be backward compatible: no removals, renames, exit-code
reclassification, or incompatible output/type-shape changes. Minor releases may
carry breaking changes before `1.0.0`, but the release notes must call them out
explicitly. Adding a runtime export is not breaking, but it intentionally expands
the API: update the matching surface test and mention the addition in the
release notes. Any `exports` map or runtime named-export change that is not
accompanied by a surface-test update is a release blocker.

`QueueReport.totalItems` carries an obligation the surface tests cannot see.
Third-party READMEs read it straight out of a published `queue.json` through a
shields.io `dynamic/json` query (ADR-0025), so those consumers never imported
`@adrkit/core` and receive no deprecation signal. A `QueueReport` v2 that moves,
renames, or reinterprets that field breaks badges in other people's
repositories; call it out in the release notes and keep the v1 field emitted for
at least one minor release.

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
podman build -f Containerfile --target adrkit -t adrkit:release-candidate .
podman build -f Containerfile --target mcp -t adrkit-mcp:release-candidate .
CONTAINER_RUNTIME=podman node scripts/smoke-container.mjs adrkit-mcp:release-candidate
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
That audit is release evidence, so it runs here, against **every packed tarball**.
`release:pack` already builds `.release/smoke/` with every artifact in the release
manifest wired as a `file:` dependency, so auditing there covers the whole
published set and cannot drift out of sync with what was packed. Note that a
lockstep pack carries the independently versioned `@adrkit/spec-kit` alongside the
four lockstep packages, so the set is five artifacts rather than four — counting
it by hand is exactly the drift this arrangement avoids:

```sh
(
  cd .release/smoke
  npm install --no-audit --no-fund   # already installed by the step 2 smoke run
  npm audit
)
```

Audit **every** packed package, not a subset. `@adrkit/evaluator` is the only path to
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

## Adapter releases (independently versioned packages)

Adapters under `packages/adapters/*` are versioned independently — ADR-0007:
"Their semver contract is with their upstream, not with our core." They release
independently too, because the alternative is republishing four unchanged
packages under a new version every time an adapter needs a fix for an upstream
change, which makes "versioned independently" true of the number and false of
everything that matters.

| | Lockstep release | Adapter release |
|---|---|---|
| Tag | `v0.3.0` | `spec-kit-v0.1.0` |
| Packages | core, evaluator, CLI, MCP (+ any adapter riding along) | exactly one adapter |
| Installed-tarball smoke | runs | skipped — the smoke project imports the lockstep surface, and an adapter that ships no JavaScript has nothing for it to import |
| `packages/ci/queue@v0` Action tag | updated | untouched |
| `ghcr.io/mbeacom/adrkit` | published after Release succeeds | untouched |
| GitHub release | created | created |

The tag form is `<slug>-v<semver>`, where the slug is the package name after the
scope. `@adrkit/spec-kit` → `spec-kit-v0.1.0`. The workflow derives the release
scope from the tag and fails on an unrecognized one.

To cut an adapter release:

```sh
# 1. Confirm the adapter's own version in its package.json is what you intend.
#    It does not move with the repository version.
git switch main && git pull

# 2. Dry-run the exact pack the workflow will perform.
bun run release:pack -- --only @adrkit/spec-kit --tag spec-kit-v0.1.0

# 3. Tag and push. The Release workflow does the rest.
git tag spec-kit-v0.1.0
git push origin spec-kit-v0.1.0
```

An adapter release also attaches a catalog asset: `scripts/pack-extension-zip.ts`
derives `<extension-id>.zip` from the already-packed, already-validated npm
tarball — so the two artifacts cannot disagree about what the extension contains
— drops `package.json`, and asserts `extension.yml` lands at the archive root,
where Spec Kit looks first. That zip is what a
[`catalog.community.json`](https://github.com/github/spec-kit/blob/main/extensions/catalog.community.json)
entry's `download_url` points at.

`release-pack` validates **every** package's manifest regardless of scope — an
adapter release is still a good moment to notice the lockstep surface drifted —
but narrows what is packed, and requires the tag to match the adapter's own
version. Publishing remains idempotent per artifact: an adapter already on the
registry at matching integrity is skipped rather than republished.

### The agent plugin — a release channel with no tag

`packages/adapters/agent-plugin` is an adapter, but it does **not** release the
way the section above describes, and the difference is easy to miss because it
looks like every other package under `packages/adapters/*`.

It is `private: true` and absent from `RELEASE_PACKAGES` in
`scripts/release-pack.ts`, so `release-pack` never packs it, `release.yml` never
triggers on it, and there is no `agent-plugin-v*` tag. Its channel is **`main`
itself**: `.claude-plugin/marketplace.json` at the repository root points at
`./packages/adapters/agent-plugin`, so whatever is on the default branch is what
`copilot plugin install adrkit@adrkit` and Claude Code's `/plugin install`
resolve. Merging is publishing.

Three consequences follow, and all three bite at the wrong moment:

1. **Bump every version-bearing surface together, in the same commit as the
   change.** The canonical value is
   `packages/adapters/agent-plugin/.claude-plugin/plugin.json`; mirror it into
   `apm.yml`, `package.json`, the workspace entry in `bun.lock`, the repository
   marketplace metadata and plugin entry, and every `skills/*/SKILL.md`
   `metadata.version`. `test/manifest.test.ts` enforces agreement, but nothing
   enforces that a content change moves them. Bun 1.4.0 does not refresh the
   dependency-free workspace version in `bun.lock` during `bun install`, so
   update that entry deliberately. Claude Code keys its plugin cache on
   `plugin.json` `version`, so shipping changed content under an unchanged
   version means installed users keep the old bytes indefinitely while new
   installers get the new bytes under the same number. Two populations, one
   version string, no way to tell them apart from a bug report.
2. **Re-run the host validators before merging a change to the plugin.** CI does
   not. `bun test` covers the failure shapes already discovered, not the ones a
   host schema will reject next:

   ```sh
   claude plugin validate packages/adapters/agent-plugin
   claude plugin validate .claude-plugin/marketplace.json
   cd "$(mktemp -d)" && git init -q . && printf 'name: probe\nversion: 0.0.1\ndependencies:\n  apm:\n    - path: %s\n' "<repo>/packages/adapters/agent-plugin" > apm.yml
   for t in claude copilot opencode; do apm install --target "$t"; done   # expect no warnings
   bun test packages/adapters/agent-plugin/test
   ```

   For a new workflow, also run the synthetic consumer case documented in
   `docs/reference-verification-agent-plugin.md`: install through a release-like
   host path, exercise the command, and compare the worktree before and after.

3. **There is no yank.** Rolling back means shipping a *higher* version with the
   fix; a revert commit alone leaves every cached install untouched. Users on a
   bad version need `copilot plugin update adrkit@adrkit`,
   `claude plugin update adrkit@adrkit` followed by a restart, or
   `apm update --yes` in the APM project. A bad release is sticky in a way the
   npm packages are not.

Because merging is publishing, a work-in-progress commit on `main` that touches
this directory is live. Land plugin changes as a single reviewed commit rather
than a series.

### First publish of a new adapter name

npm Trusted Publishing cannot be configured for a package name that does not
exist yet, so the very first publish needs a credential:

1. Add `NPM_BOOTSTRAP_TOKEN` to the `npm` environment — a granular token with
   publish rights for the `@adrkit` scope. An unscoped name such as `adrkit`
   is not covered by a scope-limited token; grant that one explicitly.
2. Add the package name to `BOOTSTRAP_PACKAGES` in `scripts/release-publish.ts`.
   It is scrubbed from every other package's environment.
3. Release.
4. Configure Trusted Publishing for the new name on npmjs.com.
5. **Remove the name from `BOOTSTRAP_PACKAGES` and delete the secret.** Leaving
   either in place hands a long-lived token to a package that no longer needs
   one.

An empty `BOOTSTRAP_PACKAGES` is the correct steady state, not an oversight. A
name belongs in it only between "does not exist on the registry" and "Trusted
Publishing is configured". `@adrkit/mcp` passed through it for 0.2.0 and
`@adrkit/spec-kit` for 0.1.0; both publish over OIDC now.

#### Do not retry the unscoped `adrkit` name

`adrkit` was built as a forwarder to `@adrkit/cli` so that `npx adrkit` could
not resolve to a stranger's package. Publishing it was attempted during the
v0.8.0 release and the registry refused the request, so the package does not
exist and never shipped:

```
403 Forbidden - PUT https://registry.npmjs.org/adrkit
Package name too similar to existing package pdfkit
```

The check compares names with punctuation stripped, so `adr-kit` and `adr_kit`
normalize to `adrkit` and are refused for the same reason. Retrying, waiting, or
hyphenating does not help; only npm support can grant a name blocked this way.

Two things follow. `npx adrkit` is permanently unsafe and the documentation
warning against it stays. And an npm 404 means *unused*, not *publishable* — the
availability check that preceded this work reported 404 and was believed to mean
the name could be had. If a future package needs a new unscoped name, the only
reliable test is a real publish attempt, so schedule it where a rejection is
cheap rather than mid-release.

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

1. Update the version in all four public package manifests, and the three places
   the version is restated outside them: `CLI_VERSION` in
   `packages/cli/src/index.ts`, `SERVER_INFO` in `packages/mcp/src/server.ts`, and
   both `version` fields in `packages/mcp/server.json`.
2. Update `bun.lock`'s four `packages/*` `version` fields to match. **`bun install`
   will not do this for you.** The dependency graph is unchanged — `workspace:*`
   still resolves to the same paths — so the install is a no-op, and
   `bun install --frozen-lockfile` reports no drift even though the file is stale.
   Nothing catches it until `release:pack` fails with
   `@adrkit/evaluator must resolve @adrkit/core to <version>, got <previous>`,
   because it validates packed manifests through the lockfile rather than the
   manifests. Deleting `bun.lock` does regenerate those fields, but it re-resolves
   the entire tree and silently upgrades transitive dependencies — edit the four
   fields directly instead, then confirm with `bun install --frozen-lockfile`. The
   diff should be exactly four lines, as in v0.6.0 (`c5dc677`) and v0.7.0.
3. Bump the pinned `@adrkit/cli@<version>` in the published badges recipe
   (`site/src/content/docs/badges.mdx`). It is pinned deliberately — the snippet
   runs inside a job holding `contents: write` (ADR-0025) — so it cannot float
   with the release. `bun run check:doc-pins` fails when the pin and the root
   `package.json` version disagree, and it runs in `clean-clone-builds`, a
   required check, so a missed bump blocks the merge rather than reaching
   adopters as an old CLI.
4. Sweep the version *narrative* — the claims prose makes about what is current,
   which no check enforces. `git grep -nE 'v?0\.[0-9]+\.0'` and update anything
   asserting the current release: `site/src/components/Hero.astro`,
   `site/src/content/docs/index.mdx`, `site/src/content/docs/quickstart.mdx`,
   README's "Project status", this file's artifact table and lede, and `CLAUDE.md`.
   Leave *historical* statements alone ("expanded in v0.5.0" records when something
   happened and stays true). This drifts silently: v0.6.0 shipped with all three
   site surfaces still advertising v0.5.0, so the hosted docs were a release behind
   for anyone reading them. `MANIFEST.md`'s decision-corpus inventory no longer
   needs this pass: it is generated by `bun run emit:manifest` and
   `clean-clone-builds` fails when the committed copy has drifted from the corpus
   ([#131](https://github.com/mbeacom/adrkit/issues/131)). It used to be
   hand-maintained, and was missing ADR-0026 and understating the record and
   accepted counts by one when v0.7.0 was cut. Prose *outside* the generated
   markers is still hand-written and still worth reading in this pass.
5. Merge the version change only after CI passes.
6. Create and push the matching annotated tag, such as `v0.3.0`.
7. Approve the protected `npm` environment deployment.
8. Confirm the workflow published all packages, created the immutable GitHub
   release, moved the Action's `v0` tag, and triggered the `Publish container`
   workflow.
9. Confirm `ghcr.io/mbeacom/adrkit:v<version>` and the moving `v0`/`latest`
   tags resolve to the attested multi-architecture image. If the downstream
   workflow failed, manually dispatch `container-release.yml` with the existing
   successful release tag.
10. Re-publish the MCP registry entry — `cd packages/mcp && mcp-publisher publish`
   (`docs/DISTRIBUTION.md` §A). **No workflow does this**, so `dev.adrkit/mcp` stays
   at the previous version until a human runs it, and `docs/DISTRIBUTION.md` should
   not claim the new version before then.

Never move an immutable `vX.Y.Z` tag. The release workflow may force-update only
the moving major Action tag (`v0`, later `v1`, and so on).

Note that steps 1–4 land on `main` before step 6 creates the tag, so between the
merge and the tag the site is deployed claiming a release that does not exist yet.
The window is short and self-correcting; it is called out here so it is not
mistaken for a mistake.

## Recovering the moving major Action tag

The repository-backed Actions are consumed through a moving lightweight tag,
currently `mbeacom/adrkit/packages/ci@v0` and
`mbeacom/adrkit/packages/ci/queue@v0`. A bad move has a broad but bounded blast
radius: new jobs using `@v0` can resolve the bad release, but the Action cannot
delete repository content or approve a change.

Moving `v0` back **stops future jobs from resolving the bad release; it does not
undo work a completed job already performed**. In particular, it does not restore
an already-edited PR comment. Restore that content from GitHub's comment edit
history, or rerun the known-good Action after recovery so it replaces its managed
comment. Cancel still-running release or consumer jobs when immediate containment
matters: a job that already resolved or checked out the old SHA can continue using
it even after the tag moves.

### Preferred guarded recovery

Choose the last verified lockstep release, then dispatch the recovery workflow
from `main`:

```sh
target=v0.10.0
gh workflow run action-tag-recovery.yml --ref main -f tag="$target"
gh run list --workflow action-tag-recovery.yml --limit 1
```

The workflow refuses a prerelease, draft, lightweight tag, tag whose commit is
not on `main`, release without a successful `Release` run for the exact peeled
commit, root-version mismatch, or tree without both committed Action bundles.
Stable release tags are annotated objects, so the workflow resolves the commit
with `git rev-parse "$target^{commit}"`; the annotated tag object's own SHA is
not a runnable Action revision.

Recovery uses only `actions: read` and `contents: write`, checks out with
credentials disabled, and exposes the write credential only during the final
push. It shares `release-${{ github.repository }}` concurrency with the normal
release workflow, so rollback and forward promotion cannot overlap. The push is
guarded by `--force-with-lease` against the exact remote tag object observed
during validation. If another actor moves the tag despite serialization, recovery
fails rather than overwriting that change.

Both forward promotion and recovery record the prior release tag/commit and the
new release tag/commit in the run summary. Verify the result independently:

```sh
target_commit=$(git rev-parse "$target^{commit}")
test "$(git ls-remote --tags origin refs/tags/v0 | awk '{print $1}')" = "$target_commit"
gh api repos/mbeacom/adrkit/git/ref/tags/v0 \
  --jq '{type: .object.type, sha: .object.sha}'
```

The API should report a lightweight tag (`type: commit`) at `target_commit`.
Consumers do not need to change their workflow files. New runs resolve the moved
tag; rerun any job that had already resolved the bad SHA. Consumers needing an
immediate immutable containment pin can temporarily use `@<target_commit>`.

### Manual fallback when GitHub Actions is unavailable

Use a clean checkout of current `main` and a credential limited to this
repository with **Actions: read** and **Contents: write**. Do not hand-write a
plain `git tag -f` / `git push --force` sequence: it omits the release guards and
can overwrite a concurrent promotion.

```sh
set -euo pipefail
target=v0.10.0
git fetch --no-tags origin main "refs/tags/$target:refs/tags/$target"
test "$(git cat-file -t "refs/tags/$target")" = tag
target_commit=$(git rev-parse "$target^{commit}")
test "$(git show "$target_commit:package.json" | jq -r .version)" = "${target#v}"
git cat-file -e "$target_commit:packages/ci/action.yml"
git cat-file -e "$target_commit:packages/ci/dist/index.js"
git cat-file -e "$target_commit:packages/ci/queue/action.yml"
git cat-file -e "$target_commit:packages/ci/dist/queue-action.js"
git merge-base --is-ancestor "$target_commit" origin/main

release=$(gh release view "$target" --json isDraft,isPrerelease)
test "$(jq -r .isDraft <<<"$release")" = false
test "$(jq -r .isPrerelease <<<"$release")" = false
runs=$(gh api \
  "repos/mbeacom/adrkit/actions/workflows/release.yml/runs?event=push&head_sha=$target_commit&per_page=100")
test "$(jq -r --arg sha "$target_commit" --arg tag "$target" \
  '[.workflow_runs[] | select(.head_sha == $sha and .head_branch == $tag and .conclusion == "success")] | length' \
  <<<"$runs")" -gt 0

moving_refs=$(git ls-remote --tags origin refs/tags/v0 refs/tags/v0^{} || true)
moving_ref_sha=$(awk '$2 == "refs/tags/v0" { print $1 }' <<<"$moving_refs")
moving_commit_sha=$(awk '$2 == "refs/tags/v0^{}" { print $1 }' <<<"$moving_refs")
moving_commit_sha=${moving_commit_sha:-$moving_ref_sha}
if [ -n "$moving_commit_sha" ] && [ "$moving_commit_sha" != "$target_commit" ]; then
  marker="action-recovery-block/$moving_commit_sha"
  if ! git show-ref --verify --quiet "refs/tags/$marker"; then
    git -c tag.gpgSign=false tag "$marker" "$moving_commit_sha"
  fi
  git push origin "refs/tags/$marker:refs/tags/$marker"
fi

bun run release:action-tag -- --recover "$target" \
  --expected-remote-ref-sha "$moving_ref_sha"
```

This fallback performs the same package-version, four-bundle, annotated-tag,
main-ancestry, stable-release, and exact successful-run checks as the workflow.
It also records a durable withdrawal marker for the commit being removed from
`v0`; the normal release workflow refuses any later rerun of that withdrawn
commit before npm publication. The script allows recovery from an arbitrary
current `v0` target, but normal `release:action-tag` calls remain monotonic and
cannot bypass the marker gate.

This recovery is intentionally separate from npm rollback. npm versions and
immutable `vX.Y.Z` git tags never move; deprecate a bad npm version, optionally
move npm's `latest` dist-tag for containment, and publish a higher hotfix as
described in [Recovering a bad npm release](#recovering-a-bad-npm-release).

## OCI container image

[ADR-0032](adr/0032-publish-one-lockstep-oci-image-after-the-coordinated-release-succeeds.md)
defines one image, `ghcr.io/mbeacom/adrkit`, as part of the lockstep release.
`.github/workflows/container-release.yml` listens for successful completion of
the `Release` workflow rather than the tag directly. That ordering is
load-bearing: npm packages and the GitHub release exist before a container tag
can claim the same version. The independently versioned Spec Kit tag never
matches the container job.

The workflow publishes:

| Tag | Contract |
|---|---|
| `vX.Y.Z` | Immutable release tag; use this in automation |
| `vX` | Newest successful container release in that major |
| `latest` | Newest successful lockstep container release across majors |

The image is built for `linux/amd64` and `linux/arm64`. Docker Buildx pushes one
manifest-list digest, and `actions/attest` attaches registry provenance to that
digest. Only the all-in-one `adrkit` target is published. Dedicated `cli`,
`mcp`, `ci`, and `queue-action` targets remain local build surfaces whose
isolation is asserted in CI.

### One-time GHCR setup and first publish

1. Merge the workflow and container files.
2. Cut the next lockstep release. Do **not** try to backfill `v0.10.0`: that
   tagged tree predates the Containerfile, and the recovery workflow builds the
   released tree rather than borrowing container code from a newer revision.
3. In the package settings, connect the resulting `adrkit` container package to
   this repository and set its visibility to **public**. GHCR creates a personal
   package as private by default; the workflow cannot make that governance
   decision implicitly.
4. Pull the immutable tag without authentication and inspect its architectures:

   ```sh
   docker pull ghcr.io/mbeacom/adrkit:vX.Y.Z
   docker buildx imagetools inspect ghcr.io/mbeacom/adrkit:vX.Y.Z
   ```

### Failure and recovery

Container publication runs after npm and the GitHub release, so its failure
cannot roll those artifacts back. Diagnose the named QEMU, Buildx, login,
build, attestation, or promotion step, then manually dispatch the workflow with
the same immutable release tag. The workflow verifies that the GitHub release
is stable, the exact tag/SHA has a successful `Release` workflow run, the tag
commit is on `main`, and the root version matches before it can push.

Buildx first pushes an untagged, content-addressed digest. The workflow attests
that digest and only then promotes it to `vX.Y.Z`, `vX`, and `latest`. An
attestation failure therefore leaves no public release tag pointing at the new
image. Promotion is globally serialized. A recovery run refuses to change an
existing immutable tag to another digest, and a historical recovery does not
rewind `vX` or `latest`; it restores only its own immutable tag.

Never rebuild an immutable tag from a different commit. To recover a bad moving
tag, first fix or identify the correct released commit, then republish through
the workflow; do not hand-push an unverified local image.

## Recovering a bad npm release

npm versions and immutable git tags are never rewritten. If a defect is found
after a lockstep release reaches `latest`:

1. Confirm the affected version and the last verified lockstep version. Stop any
   pending MCP registry or moving Action-tag promotion that has not completed.
2. Deprecate each affected package version with the same concise reason:

   ```sh
   npm deprecate @adrkit/core@<bad-version> "Use <hotfix-version>; see <issue-url>"
   npm deprecate @adrkit/evaluator@<bad-version> "Use <hotfix-version>; see <issue-url>"
   npm deprecate @adrkit/cli@<bad-version> "Use <hotfix-version>; see <issue-url>"
   npm deprecate @adrkit/mcp@<bad-version> "Use <hotfix-version>; see <issue-url>"
   ```

3. When immediate containment is safer than leaving `latest` on the bad version,
   move each package's `latest` dist-tag back to the same last verified version:

   ```sh
   npm dist-tag add @adrkit/core@<last-good-version> latest
   npm dist-tag add @adrkit/evaluator@<last-good-version> latest
   npm dist-tag add @adrkit/cli@<last-good-version> latest
   npm dist-tag add @adrkit/mcp@<last-good-version> latest
   ```

   Do not unpublish the bad version and do not move its immutable git tag or
   GitHub release. Deprecation preserves provenance and tells pinned consumers
   exactly what happened.
4. Fix forward on `main`, bump all lockstep versions to a higher patch, update
   the lockfile and version restatements, and run the full local release
   simulation. The installed-tarball smoke must exercise graph DOT, JSON,
   Mermaid, terminal, and filters before the replacement tag is created.
5. Publish the hotfix through the normal protected workflow, verify every npm
   integrity, move the major Action tag only after success, and re-publish the
   MCP registry entry. Remove the temporary `latest` rollback only by publishing
   or explicitly tagging the verified hotfix.

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
  `git status` after step 2; it was clean for v0.3.0, v0.4.0, and v0.5.0.
- The published-consumer advisory audit reported **0 vulnerabilities** at v0.3.0,
  and `KNOWN_CONSUMER_ADVISORY_ACCEPTANCES` is now empty
  ([ADR-0018](adr/0018-adopt-mcp-sdk-v2-and-serve-protocol-revision-2026-07-28-dual-era.md)
  removed the last entry). Any advisory appearing in a future run is therefore an
  unrecorded exposure and a release blocker until reconciled.

Three more from the v0.4.0 cutover, all of which cost time:

- **`bun.lock` records a `version` for each workspace package, and nothing
  refreshes it.** Neither `bun install` nor `bun install --force` updates those
  fields after a manifest bump. `release-pack` catches it — `@adrkit/evaluator
  must resolve @adrkit/core to 0.4.0, got 0.3.0` — because it validates a packed
  dependency against the dependency's own version. Deleting and regenerating the
  lockfile fixes it *and* pulls unrelated transitive drift into the release
  commit (at v0.4.0: `jose`, `undici`, `@octokit/*`, `@types/node`). Edit the
  workspace `version` lines directly, then confirm with
  `bun install --frozen-lockfile`.
- **Two hardcoded version constants move with the manifests**: `CLI_VERSION` in
  `packages/cli/src/index.ts` and `SERVER_INFO` in `packages/mcp/src/server.ts`.
  Each has a test asserting it matches its `package.json`, so `bun test` finds
  them. They are most of what "Subsequent releases" step 1 means by "update any
  inter-package expectations."
- **`bun run release:publish -- --dry-run` fails on the adapter** now that an
  independently versioned package rides along in a lockstep pack. The registry
  idempotency check that skips an already-published artifact is gated behind
  `!dryRun`, so the dry run tries to republish `@adrkit/spec-kit` at its current
  version. The four lockstep packages dry-run cleanly first, and the real run
  skips the adapter because the packed tarball's integrity matches the registry.
  Tracked in [#104](https://github.com/mbeacom/adrkit/issues/104).

Two from the v0.5.0 cutover:

- **The #104 dry-run failure is confirmed dry-run-only.** Before tagging, the
  claim above was checked rather than trusted: the registry's published
  `dist.shasum` for `@adrkit/spec-kit@0.1.2` was compared against the shasum the
  dry run had just packed, and they matched exactly, as did `dist.integrity`. The
  real run then skipped the adapter and published only the four lockstep packages.
  `npm view @adrkit/spec-kit@<version> dist.shasum` is a cheap way to turn "the
  real run should skip it" into "the real run will skip it" before you tag.
- **The MCP registry is not part of the release workflow.** `release.yml` has no
  `mcp-publisher` step, so `dev.adrkit/mcp` keeps serving the previous version
  until a human re-publishes it (see
  [DISTRIBUTION.md](DISTRIBUTION.md) §A). Its three prerequisites are worth
  re-checking against the *published* package rather than the working tree:
  `npm view @adrkit/mcp@<version> version`, `npm view @adrkit/mcp@<version>
  mcpName`, and both `version` fields in `packages/mcp/server.json`.

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
