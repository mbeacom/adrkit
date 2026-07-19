# Quickstart: CI Surface (Phase 3)

> **✅ Gate cleared; implemented.** The rung-2 gate closed when a subset of the real,
> permissively-licensed [adr/madr](https://github.com/adr/madr) MADR corpus was vendored
> as an **offline fixture** and round-tripped by `adr migrate` (see
> [research.md §R0](./research.md), tasks.md **T000/T00A**, and the fixture PROVENANCE).
> `adr check` and the `@adrkit/ci` Action described below are implemented.

Prerequisites: **stable Bun 1.3.14** (CI pins it) — not the canary that self-reports
1.4.0 (it writes an unreadable lockfile). Clean clone, no network, no credentials.

## `adr check` — the deterministic CLI (any provider)

```bash
bun install

# Validate changed records + list the decisions governing a changed-file set
bun run adr check packages/core/src/affects/index.ts packages/cli/src/index.ts
bun run adr check <files...> --dir docs/adr --json      # stable machine-readable output

# Exit code: 0 on success; non-zero iff a CHANGED record has an error finding.
echo $?
```

## The GitHub Action — `@adrkit/ci`

Add to a consuming repo's workflow. It needs only the default `GITHUB_TOKEN`, runs on
the `node24` runner, and executes a committed self-contained bundle (no install in the
consumer checkout):

```yaml
# .github/workflows/adr.yml (in a repo that adopts adrkit)
name: ADR
on: pull_request
permissions:
  contents: read
  pull-requests: write        # to post/update the governing-decisions comment
jobs:
  adr:
    runs-on: ubuntu-latest
    env:
      # Exposing the default token here lets the Action confirm its own comment
      # identity (github-actions[bot]) so it updates one comment in place. Without
      # it, an unidentifiable token safely posts a fresh comment each run.
      GITHUB_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history for the merge-base changed-file diff
      - uses: mbeacom/adrkit/packages/ci@v0     # @adrkit/ci Action (runs.using: node24)
        with:
          dir: docs/adr
          # token defaults to ${{ github.token }} — no other secret required
```

On a PR, the Action extracts the changed files, resolves the governing decisions,
validates the changed records, and posts (or updates) a single comment.

## What "green" means

- On a PR touching governed paths (on a repo that isn't this one), a comment names
  **exactly** the governing decisions — id + title + fired matcher (SC-001).
- `adr check <files>` exits non-zero **iff** a changed record has an error finding
  (SC-002).
- On a **>10-record** repo with a subset diff, the comment lists only the governing
  subset — never the whole corpus (SC-003).
- A second push **updates the same comment** rather than adding a new one (SC-004).
- A diff nothing governs yields a concise "no governing decisions" note (SC-005).
- The Action completes with only the default `GITHUB_TOKEN`, and degrades commenting
  (not the check) on a read-only fork token (SC-006).
- Clean clone builds/tests/lints green with the new `@adrkit/ci` package;
  `clean-clone-builds` and `core-has-no-adapter-deps` stay green and now also cover
  `@adrkit/ci` (incl. the toolkit→core boundary), plus the **bundle-drift** check and a
  **Node-24 smoke** of the committed bundle pass (SC-007, RC6/RC7).

## Self-dogfood

This repo runs `adr check` on its own PRs (the `self-dogfood` CI job) so the CI surface
governs the project that ships it — the same dogfooding stance as `adr lint`.

## Owner-run exit check (T018 — cannot be automated in CI)

The rung-3 exit criterion is a **manual** verification on a **second** repository (not
this one), which CI cannot perform. Run it once as the owner:

1. In a separate repo with a **>10-record** ADR corpus, add the workflow above
   (`mbeacom/adrkit/packages/ci@<ref>`), granting `pull-requests: write`.
2. Open a PR that touches a **subset** of governed paths. Confirm the posted comment
   names **exactly** the governing subset (id + title + fired matcher) — not the whole
   corpus (SC-001/003).
3. Push a second commit to the same PR. Confirm the **same** comment updates in place
   rather than a new one being added (SC-004).
4. Confirm it ran with only the default `GITHUB_TOKEN` (no PAT/secret) (SC-006), and
   that a fork PR (read-only token) still runs the check and degrades commenting to a
   job-log notice without failing the job.

This is the owner-run equivalent of the site's DNS cutover: everything up to it is
green in CI; this last step needs a real second repo and is left unchecked in
`tasks.md` until performed.
