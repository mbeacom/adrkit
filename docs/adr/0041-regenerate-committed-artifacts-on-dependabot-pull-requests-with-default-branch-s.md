---
schemaVersion: 0.1.0
id: "0041"
title: "Regenerate committed artifacts on Dependabot pull requests with default-branch scripts behind a maintainer label"
status: accepted
date: 2026-09-27
deciders:
  - "@mbeacom"
tags:
  - ci
  - supply-chain
  - dependencies
  - security
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo:
  - "0007"
  - "0010"
  - "0016"
  - "0035"
  - "0036"
affects:
  - type: path
    pattern: ".github/workflows/regenerate-artifacts.yml"
  - type: path
    pattern: ".github/dependabot.yml"
  - type: path
    pattern: "packages/ci/dist/**"
  - type: path
    pattern: "schema/adr.schema.json"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
reviewBy: 2027-09-27
---

# ADR-0041: Regenerate committed artifacts on Dependabot pull requests with default-branch scripts behind a maintainer label

## Context

Two artifacts in this repository are generated from dependencies and committed,
and CI requires each to match a fresh regeneration byte for byte:

- **`packages/ci/dist/index.js` and `queue-action.js`**, the Action bundles. A
  JavaScript Action runs from the repository at the ref a consumer names, so the
  bundle has to exist at that commit — the root `action.yml` alias (ADR-0036) and
  the nested `@v0` consumers both depend on it. The bundles inline 23 packages and
  mark each module with a source-path comment such as
  `// ../../node_modules/.bun/yaml@2.9.0/…`, so **any** version change to a
  bundled package rewrites them. Besides the direct dependencies (`yaml`, `zod`,
  `semver`, `picomatch`, `@actions/*`) that includes transitives no Dependabot
  pattern can name: `undici`, `@octokit/*`, `tunnel`, `before-after-hook`, and
  others. `clean-clone-builds` fails on `git diff --exit-code packages/ci/dist`.
- **`schema/adr.schema.json`**, emitted from the Zod source. A `zod` bump can
  change it, and `clean-clone-builds` fails on `schema:emit && git diff`.

Dependabot edits manifests and `bun.lock`; it regenerates neither artifact. The
result is observed rather than predicted:

- [#206](https://github.com/mbeacom/adrkit/pull/206), the `root-bun` group, is red
  on `clean-clone-builds` with a diff consisting only of `yaml@2.9.0 → 2.9.1`
  path comments in the bundle. It held `@types/bun` red with it.
- [#209](https://github.com/mbeacom/adrkit/pull/209), `zod`, is red for the reason
  `dependabot.yml` already records.
- #188, #194, #200, and #206 — every `root-bun` PR since #188 — were closed rather
  than merged; the `dependabot.yml` comment records #200 as red on
  `clean-clone-builds`. The last `root-bun` PR to merge was #99, a types-only
  bump that touched nothing bundled.

The response so far has been to exclude each dependency from the group once it is
seen failing (`zod`, `picomatch`, and, in
[#223](https://github.com/mbeacom/adrkit/pull/223), `yaml`). That isolates the
failure without fixing it: the excluded bump still arrives as its own red PR, and
the transitives cannot be excluded at all.

It does not even reliably isolate it. The first `root-bun` PR after #223,
[#227](https://github.com/mbeacom/adrkit/pull/227), proposes only `@types/bun`, yet
its `bun.lock` also moves `yaml` 2.9.0 → 2.9.1 and it fails the same bundle diff.
`yaml` is declared as the `latest` dist-tag in `packages/core` and
`packages/adapters/catalog-backstage`, so re-resolving the lock for any update
floats it regardless of `exclude-patterns`. An exclusion list is a filter on what
Dependabot *proposes*, not on what the lockfile *resolves*.

Regenerating by hand is possible but not cheap. `CONTRIBUTING.md` documents it:
the bundle must be rebuilt under **linux/amd64 Bun 1.3.14**, because Bun's CommonJS
interop output differs by host target and a Mac-built bundle fails the same gate.
The maintainer works on a Mac, so every regeneration today is a `docker run
--platform linux/amd64 oven/bun:1.3.14 …`, a host reinstall, a commit, and a push
— per dependency PR, weekly.

### Why this needs a decision, not a workflow

Automating that means a job that writes to a branch after installing and running
code from a bot-authored change. ADR-0035 is the relevant boundary, and it has to
be read precisely. It governs **gates** — jobs whose verdict certifies a PR — and
its rule that nothing privileged may "check out, install, build, or execute
pull-request code" is how those gates stay trustworthy. A regenerator is not a
gate; its output is judged by the gates, unchanged. But it is a privileged writer
operating on the same untrusted input, so every lesson ADR-0035's three rounds of
security review paid for applies to it, and one of them applies directly:
`gate-integrity` blocks any PR touching `packages/ci/**` without the
`gate-change-acknowledged` label, and dismisses that label whenever the head
moves. A regenerated bundle is such a change.

Running dependency code is not hypothetical here. `bun build` bundles
`@actions/*` without executing it, but `schema:emit` runs
`bun ./src/schema/emit.cli.ts`, which **executes** the bumped `zod`.

### What Dependabot and GitHub provide natively

Checked against the vendor's own documentation and tracker before choosing,
because a first-party mechanism would beat anything built here:

- **Dependabot has no post-update command.** `dependabot.yml` has no key that runs
  a build before the PR is opened. It has been requested since 2020
  ([dependabot-core#1758](https://github.com/dependabot/dependabot-core/issues/1758),
  [#2004](https://github.com/dependabot/dependabot-core/issues/2004), both closed
  without it) and is requested again, still open as of this record, in
  [#14549](https://github.com/dependabot/dependabot-core/issues/14549) — whose
  text names this repository's exact failure: the workaround is a workflow that
  pushes the rebuild back, and a `GITHUB_TOKEN` push never retriggers the required
  checks. `versioning-strategy`, `groups`, `ignore`, and `allow` all shape *which*
  PRs exist; none shapes what is in them beyond manifests and lockfiles.
- **GitHub's documented automation pattern is the one to avoid.** GitHub's
  guidance for automating Dependabot PRs is a `pull_request` workflow gated on
  `if: github.actor == 'dependabot[bot]'`, where the token is read-only and only
  Dependabot secrets are available
  ([troubleshooting Dependabot on Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions)).
  `github.actor` is whoever caused the latest event, and published research shows
  an attacker can make Dependabot that actor on a PR it did not author, and inject
  through crafted branch names
  ([Boost Security, "Weaponizing Dependabot"](https://boostsecurity.io/blog/weaponizing-dependabot-pwn-request-at-its-finest)).
  An actor check is not an identity check.
- **Dependabot can keep maintaining a PR someone else has committed to.** By
  default it stops rebasing once extra commits land, but a commit whose message
  contains `[dependabot skip]` is one it is allowed to force-push over
  ([managing Dependabot PRs](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/managing-pull-requests-for-dependency-updates)).

The first finding is why something has to be built; the second is why it is not
built on `github.actor`; the third removes what would otherwise be this design's
largest cost.

## Decision

**We will regenerate committed artifacts on Dependabot pull requests with a
maintainer-triggered `pull_request_target` workflow that builds with the default
branch's scripts in an unprivileged job and pushes the result, restricted to the
artifact paths, from a separate job holding a GitHub App token.**

In `.github/workflows/regenerate-artifacts.yml`:

1. **Trigger: a maintainer applies the `regenerate-artifacts` label.** Applying a
   label requires triage or write access, is recorded against whoever did it,
   and makes the maintainer — not `dependabot[bot]` — the triggering actor. That
   last property is why the label is not optional: GitHub restricts secrets for
   workflows Dependabot triggers, and a label applied by a person is how the job
   reaches an Actions secret at all. The job records the head SHA it was granted
   for and refuses if the head has moved. A final job, `if: always()`, removes the
   label whatever the outcome and confirms the removal with a live API read. It
   uses the workflow's own `GITHUB_TOKEN` with `pull-requests: write` and nothing
   else — the App token has `contents: write` only and cannot remove a label, and
   keeping the two credentials apart keeps each one minimal. No job keys anything
   on `github.actor`, and the head branch name is never interpolated into a
   command: it is read from the API and passed through `env:`, since a
   branch name is attacker-influenced text in the research cited above.
2. **Eligibility, read from the API and not the event payload.** The PR's author
   is `dependabot[bot]`, and its head repository is this repository — Dependabot
   branches are never forks. Every commit on it is either **authored** by
   `dependabot[bot]` (checked by account login, not by the free-text email) or is
   this workflow's own earlier regeneration commit, authored by the App and
   touching only the artifact paths in item 4 — so a second run on the same PR is
   possible. The committer is not checked: Dependabot creates commits through the
   API, and they carry `web-flow` as committer (observed on #206, signature
   verified). Its changed files (paginated) are only `bun.lock`,
   `package.json`, and `packages/**/package.json` — plus the artifact paths in
   item 4, admitted **only** when every commit that touches them is an App
   regeneration commit. Without that second clause a re-run after an earlier
   regeneration would refuse its own output. Each changed manifest must
   differ from the default branch's copy **only** in `dependencies`,
   `devDependencies`, `peerDependencies`, and `optionalDependencies` — a path
   allowlist alone would pass a changed `scripts` block. Anything else refuses
   with a message naming what failed. `site/` and the `github-actions` ecosystem
   are out of scope by construction.
3. **Build job: unprivileged.** `permissions: contents: read`, no secrets,
   `persist-credentials: false`. It checks out the **default branch** and, from the
   PR's head commit fetched as objects, writes `bun.lock` verbatim and **only the
   dependency fields** of each eligible manifest onto `main`'s copy — so the build
   and emit scripts that run are `main`'s even if `main` changed them after
   Dependabot branched, and the PR contributes nothing but dependency versions.
   Eligibility compares each manifest with its **merge-base** copy, which is what
   Dependabot started from. It runs `bun install --frozen-lockfile
   --ignore-scripts` under the pinned Bun, then, under
   `scripts/run-network-denied.ts`, `bun run --filter='@adrkit/ci' build` and
   `bun run schema:emit`, on `ubuntu-24.04` — the runner `clean-clone-builds`
   pins, not `ubuntu-latest`, because the bundle must match that job's rebuild
   byte for byte and `-latest` moves. It uploads the changed artifact files and a list
   of their paths, and nothing else; a rebuild that adds or removes an artifact
   file refuses rather than guessing. An empty diff is a result, not an error: the push job
   then creates no commit and reports the artifacts as already current.
4. **Push job: privileged, and never checks anything out.** ADR-0035's rule lists
   *checkout* beside install, build, and execute, so this job has no worktree at
   all. It downloads the upload — untrusted, because the build job
   ran dependency code — and rejects it unless every listed path is a top-level
   `packages/ci/dist/*.js` file or exactly `schema/adr.schema.json` and is a
   regular file, and writes the
   result through the Git Data API: a blob per changed file, a tree based on the
   recorded head SHA's tree, a commit whose parent is that SHA and whose message
   carries a `Signed-off-by` for the App's bot identity (`check-dco` already
   accepts a bot sign-off) and `[dependabot skip]`, so Dependabot keeps rebasing
   the PR and force-pushes over the regeneration when it does, then a non-forced
   ref update — which fails, as the
   lease should, if the branch has moved. Commits an App creates through the API
   are expected to be signed by GitHub and so show as verified like Dependabot's;
   that is an expectation to observe (action item 2), not an assumption the
   design depends on — no gate here requires a signature.
   It authenticates with a GitHub App installation token scoped to
   `contents: write` on this repository, because a push made with `GITHUB_TOKEN`
   does not trigger workflows and would leave the PR's required checks attached to
   the old head. The job installs no Bun and runs no repository script.
5. **The gates then judge the result unchanged.** The push moves the head, so
   `gate-integrity` dismisses any `gate-change-acknowledged` label and requires it
   again for the `packages/ci/dist` diff; `clean-clone-builds` rebuilds and diffs
   independently. The regenerator removes a mechanical step. It adds no authority.

`dependabot.yml`'s `zod` exclusion may be lifted once this has regenerated a real
`zod` bump green. The `picomatch` exclusion stays — its test records a version
observation that no regeneration updates — and so does the
`@modelcontextprotocol/*` pin, which needs a protocol run, not a rebuild.

### What we are explicitly not doing

- **Not triggering without the label.** An automatic run on every Dependabot
  `synchronize` would have `dependabot[bot]` as the actor, lose access to the App
  secret, and remove the one human step that decides a given bump is worth
  building. Storing the App key as a *Dependabot* secret to get around that is
  Option G below.
- **Not regenerating `bun.lock`.** The stale-optional-binding lock seen on
  [#221](https://github.com/mbeacom/adrkit/pull/221) is Bun 1.3.14's own
  incremental resolution — plain `bun install` from `main`'s lock reproduces it
  byte for byte — and fixing it is a fresh resolve, which is a reviewable change to
  every transitive, not a mechanical one. It is tracked with the Starlight failure
  in [#224](https://github.com/mbeacom/adrkit/issues/224).
- **Not touching `site/`.** It commits no dependency-derived artifact.

### What implementation clarified

Recorded here rather than folded silently into the ratified text above, which
items 3 and 4 were edited to match. Neither changes what was decided; both
narrow how.

- **An overlay against the merge base, not a copy.** Copying the pull request's
  manifests would revert any `scripts` change `main` made after Dependabot
  branched. The build writes only the dependency fields onto `main`'s manifests,
  and eligibility compares each manifest with its merge-base copy — what
  Dependabot actually started from.
- **Files plus a path list, not a patch.** The build uploads the changed artifact
  files and their paths, and the push job validates both as untrusted, because
  the build ran dependency code. Writing blobs from files needs no `git apply`,
  and so no worktree, in the privileged job. Writing the validator's tests found
  that a shell `case` pattern's `*` also matches `/`, so the nested-path refusal
  is the rule that stops traversal and has to come first.

## Options considered

### Option A: Label-triggered two-job `pull_request_target` workflow with a GitHub App token (chosen)

| Dimension | Assessment |
|---|---|
| Removes the manual step | Yes, for every root-workspace bump, including transitives |
| New privilege | An App with `contents: write` on this repository; its key is a secret |
| Where dependency code runs | Only in the build job, which holds no write token and no secret |
| Human in the loop | One label per PR, plus the existing `gate-change-acknowledged` review |
| Honest limit | Whoever can label can cause a push; merge access remains the boundary, as in ADR-0035 |

### Option B: Keep regenerating by hand in the pinned container

The status quo, already documented in `CONTRIBUTING.md`. It adds no privilege and
no secret, and a `bun run regen:artifacts` wrapper around the `docker run` would
make it one command.

**Pros:** nothing new to secure; the regeneration happens where the maintainer is
already reviewing.
**Cons:** requires Docker and a linux/amd64 emulation layer on the maintainer's
machine for every bump; the host `node_modules` must be reinstalled afterwards;
the evidence is that bumps are closed rather than regenerated — every `root-bun`
PR since #188, four of them, closed unmerged. A control nobody runs is ADR-0016's
subject.

Option B remains the fallback if the App is ever revoked, and the documented path
for contributors.

### Option C: Stop committing the bundle; build it at release time

**Pros:** removes the bundle half of the problem entirely.
**Cons:** a JavaScript Action runs from the repository at the consumer's ref, so
the bundle must exist at every tagged commit that `@v0` or the root Marketplace
alias (ADR-0036) can resolve to. Building it only at release means a
release-only commit that `main` never contains, which breaks the recovery
workflow's requirement that the tag peel to a commit on `main`. It also leaves
`schema/adr.schema.json`, which is served at its `$id`. Much larger than the
problem.

### Option D: `pull_request` with `contents: write` granted to Dependabot's token

GitHub lets a workflow raise `GITHUB_TOKEN` permissions on Dependabot-triggered
`pull_request` runs.

**Pros:** no App, no secret.
**Cons:** the workflow file comes from the PR's merge ref, not the default branch
— the exact property ADR-0035 exists to remove; the write token and the executed
`zod` share a job; and the push does not re-trigger CI, so the PR stays attached
to red checks for the old head. Rejected on all three.

### Option E: Exclude every bundled dependency from Dependabot

**Pros:** no red PRs.
**Cons:** #227 shows an exclusion does not stop a dist-tag-declared dependency
from moving inside someone else's PR; transitives cannot be named by pattern;
security updates still arrive
and still fail; and it converts "we cannot merge dependency updates" into "we do
not see them". Rejected.

### Option F: Do nothing

Dependency PRs keep failing, and keep being closed. The bundled `undici` and
`@octokit/*` versions that ship to every Action consumer drift until a security
advisory forces a manual rebuild under time pressure.

### Option G: GitHub's documented pattern — automatic, with the App key as a Dependabot secret

A `pull_request` workflow gated on `github.actor == 'dependabot[bot]'`, reading the
App key from a Dependabot secret so that no label is needed.

**Pros:** fully automatic; the pattern GitHub documents; nothing to remember.
**Cons:** it keys trust on `github.actor`, which the Boost Security research shows
can be made `dependabot[bot]` on a PR Dependabot did not author; the workflow
file comes from the PR's merge ref rather than the default branch, the property
ADR-0035 removed; and a Dependabot secret is exposed to every Dependabot-triggered
run of every workflow, not just this one. Rejected. The label costs one click and
buys a trusted trigger.

### Option H: Replace Dependabot with self-hosted Renovate and `postUpgradeTasks`

Renovate is the ecosystem's standard answer to the missing feature: its
`postUpgradeTasks` runs allowlisted commands after an update and commits the
result into the same PR, with the checks triggered normally.

**Pros:** regeneration happens before the PR exists, so there is never a red PR
and no second workflow; one tool for every ecosystem.
**Cons:** `postUpgradeTasks` is available only when Renovate is self-hosted —
here, a scheduled workflow holding a write-capable token *while* it installs and
builds the updated dependencies, which is the co-residence this record's two-job
split exists to avoid. It also replaces Dependabot outright, including the
security-update PRs tied to GitHub's advisory database, the `github-actions`
SHA-pin updates, and every exclusion and comment in `dependabot.yml`: a migration,
not a fix. Revisit if Option A proves too costly to operate, or if
[dependabot-core#14549](https://github.com/dependabot/dependabot-core/issues/14549)
ships and makes both unnecessary.

## Trade-offs

- **A standing privileged credential.** The App key can push to this repository.
  It is scoped to one repository and `contents: write`, used only in a job that
  executes nothing from the PR, and its use is gated on a maintainer's label — but
  it exists, and a leak of it is a leak of push access.
- **A rebase discards the regeneration.** Because the commit carries
  `[dependabot skip]`, Dependabot keeps rebasing and re-resolving the PR — which is
  the point — but each rebase force-pushes over the regenerated commit, and the
  label must be applied again. Without the marker the regeneration would survive,
  and Dependabot would stop maintaining the PR entirely; re-labelling is the
  cheaper of the two.
- **Two labels per bundled bump.** `regenerate-artifacts` to build, then
  `gate-change-acknowledged` because the push touched `packages/ci/**`. Merging the
  two would let the regenerator acknowledge its own output, so they stay separate.
- **More workflow surface under ADR-0035's gate.** The new workflow is itself a
  gate-defining path, so every change to it needs acknowledgment. That is correct,
  and it is also a cost.

## Consequences

- Easier: merging dependency updates, including the transitive ones in the
  shipped Action bundle; lifting the `zod` exclusion.
- Harder: rotating and auditing an App credential; reasoning about one more
  privileged workflow.
- **How we would know this was wrong:** (a) any regenerated commit contains a path
  outside `packages/ci/dist/` or `schema/adr.schema.json`, or builds with a script
  that is not `main`'s — either is a defect in the boundary, and the workflow is
  disabled until fixed; (b) by `reviewBy`, fewer than half of the Dependabot PRs
  that received the label were merged, meaning the automation did not unblock
  what it was built for; (c) the App token is used by anything other than this
  workflow.
- Revisit if: GitHub gives `GITHUB_TOKEN` pushes the ability to trigger workflows
  (the App becomes unnecessary); the Action bundle stops being committed; or Bun's
  output stops depending on host target, which would make Option B cheap enough;
  or Dependabot ships post-update commands
  ([dependabot-core#14549](https://github.com/dependabot/dependabot-core/issues/14549)),
  which would supersede this record with configuration.

## Action items

1. [ ] Create a GitHub App with `contents: write`, install it on this repository
       only, and store its id and private key as Actions secrets. Done by
       @mbeacom (`adrkit-dep-gates`), with the **Client ID** rather than the App
       ID, since `create-github-app-token` v3 deprecates `app-id`, plus the
       `REGENERATE_ARTIFACTS_APP_SLUG` variable. Left unticked only because the
       single-repository installation scope was reported, not verified here.
2. [ ] Confirm, by observing a labelled run on a Dependabot PR, that the App secret
       is available when a maintainer applies the label, and unavailable when
       `dependabot[bot]` is the actor. This record's argument for the label rests
       on it. In the same run, confirm the Git Data API commit shows as verified
       and passes both `dco` and `trusted-dco`, and that the next Dependabot
       rebase force-pushes over it as `[dependabot skip]` promises.
       **Observed so far:** the secret is available on a maintainer-applied
       label (#209 runs 36336189018 and 36336372382; #237 run 36361081418); the
       App's commits are `verified` and passed `dco` and `trusted-dco` on both
       pull requests. **Not yet observed:** the secret being unavailable with
       `dependabot[bot]` as actor, and a Dependabot rebase over the App commit.
3. [x] Implement `.github/workflows/regenerate-artifacts.yml` per the Decision,
       with the eligibility checks in a tested script under `scripts/` that imports
       Node builtins only.
4. [ ] Observe each refusal failing before it counts (ADR-0016): a non-Dependabot
       author, a commit authored by neither Dependabot nor the App, an App commit
       touching a non-artifact path, a changed `scripts` block, a file outside the
       allowlist, a head repository other than this one, a head moved after
       labelling, and a patch touching a path outside the artifact set. Also
       observe the positive case the review of this record found missing: a
       second run on a PR that already carries an App regeneration commit.
       The positive second run was observed live on #209, where it also exposed
       an empty-commit defect fixed in #234. Each refusal has a unit or contract
       test; the scripts-diff, author, force-push, nested/traversal, symlinked
       ancestor, Dependabot-path, and every-commit rules were each observed
       failing a test when disabled. The rest have not been.
5. [x] Regenerate one real bundled bump end to end — `yaml` is the waiting case —
       and merge it with `clean-clone-builds` and `gate-integrity` green. #237
       (`yaml` 2.9.0 → 2.9.1): one App commit rewrote both bundles, every check
       passed, merged as `267ca00`.
6. [ ] After a `zod` bump regenerates green, remove the `zod` exclusion from
       `dependabot.yml` and update its comment. #209 regenerated correctly but
       could not go green: zod 4.5 changes the published `v0.1.0` schema, which
       ADR-0011 makes immutable. `zod` is capped below 4.5 (#236) and this item
       now waits on schema `v0.2.0` (#235).
7. [x] Document the label in `CONTRIBUTING.md` beside the existing container
       instructions, which remain the fallback.
