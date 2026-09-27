---
schemaVersion: 0.1.0
id: "0041"
title: "Regenerate committed artifacts on Dependabot pull requests with default-branch scripts behind a maintainer label"
status: proposed
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
   for and refuses if the head has moved; the label is removed when the job
   finishes, whatever the outcome.
2. **Eligibility, read from the API and not the event payload.** The PR's author
   is `dependabot[bot]`. Every commit on it is either **authored** by
   `dependabot[bot]` (checked by account login, not by the free-text email) or is
   this workflow's own earlier regeneration commit, authored by the App and
   touching only the artifact paths in item 4 — so a second run on the same PR is
   possible. The committer is not checked: Dependabot creates commits through the
   API, and they carry `web-flow` as committer (observed on #206, signature
   verified). Its changed files (paginated) are only `bun.lock`,
   `package.json`, and `packages/**/package.json`. Each changed manifest must
   differ from the default branch's copy **only** in `dependencies`,
   `devDependencies`, `peerDependencies`, and `optionalDependencies` — a path
   allowlist alone would pass a changed `scripts` block. Anything else refuses
   with a message naming what failed. `site/` and the `github-actions` ecosystem
   are out of scope by construction.
3. **Build job: unprivileged.** `permissions: contents: read`, no secrets,
   `persist-credentials: false`. It checks out the **default branch** and copies in
   only the eligible files from the PR's head commit, fetched as objects — so the
   build and emit scripts that run are `main`'s, and the PR contributes nothing
   but dependency versions. It runs `bun install --frozen-lockfile
   --ignore-scripts` under the pinned Bun, then, under
   `scripts/run-network-denied.ts`, `bun run --filter='@adrkit/ci' build` and
   `bun run schema:emit`, on `ubuntu-latest` (linux/amd64). It uploads the
   resulting `git diff` as a patch and nothing else.
4. **Push job: privileged, and never checks anything out.** ADR-0035's rule lists
   *checkout* beside install, build, and execute, so this job has no worktree at
   all. It downloads the patch, rejects it unless every path is under
   `packages/ci/dist/` or is exactly `schema/adr.schema.json`, and writes the
   result through the Git Data API: a blob per changed file, a tree based on the
   recorded head SHA's tree, a commit whose parent is that SHA and whose message
   carries a `Signed-off-by` for the App's bot identity (`check-dco` already
   accepts a bot sign-off), then a non-forced ref update — which fails, as the
   lease should, if the branch has moved. Commits created this way through an App
   are signed by GitHub, so the regeneration commit is verified like Dependabot's.
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
  building.
- **Not regenerating `bun.lock`.** The stale-optional-binding lock seen on
  [#221](https://github.com/mbeacom/adrkit/pull/221) is Bun 1.3.14's own
  incremental resolution — plain `bun install` from `main`'s lock reproduces it
  byte for byte — and fixing it is a fresh resolve, which is a reviewable change to
  every transitive, not a mechanical one. It is tracked with the Starlight failure
  in [#224](https://github.com/mbeacom/adrkit/issues/224).
- **Not touching `site/`.** It commits no dependency-derived artifact.

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

## Trade-offs

- **A standing privileged credential.** The App key can push to this repository.
  It is scoped to one repository and `contents: write`, used only in a job that
  executes nothing from the PR, and its use is gated on a maintainer's label — but
  it exists, and a leak of it is a leak of push access.
- **Dependabot stops maintaining the PR.** Dependabot rebases a PR only while
  nobody else has committed to it. After a regeneration, a conflict needs
  `@dependabot recreate`, which discards the regenerated commit; the label must
  then be applied again.
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
  output stops depending on host target, which would make Option B cheap enough.

## Action items

1. [ ] Create a GitHub App with `contents: write`, install it on this repository
       only, and store its id and private key as Actions secrets.
2. [ ] Confirm, by observing a labelled run on a Dependabot PR, that the App secret
       is available when a maintainer applies the label, and unavailable when
       `dependabot[bot]` is the actor. This record's argument for the label rests
       on it. In the same run, confirm the Git Data API commit shows as verified
       and passes both `dco` and `trusted-dco`.
3. [ ] Implement `.github/workflows/regenerate-artifacts.yml` per the Decision,
       with the eligibility checks in a tested script under `scripts/` that imports
       Node builtins only.
4. [ ] Observe each refusal failing before it counts (ADR-0016): a non-Dependabot
       author, a commit authored by neither Dependabot nor the App, an App commit
       touching a non-artifact path, a changed `scripts` block, a file outside the
       allowlist, a head moved after labelling, and a patch touching a path
       outside the artifact set.
5. [ ] Regenerate one real bundled bump end to end — `yaml` is the waiting case —
       and merge it with `clean-clone-builds` and `gate-integrity` green.
6. [ ] After a `zod` bump regenerates green, remove the `zod` exclusion from
       `dependabot.yml` and update its comment.
7. [ ] Document the label in `CONTRIBUTING.md` beside the existing container
       instructions, which remain the fallback.
