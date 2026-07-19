# Quickstart: CI Surface (Phase 3)

> **⚠️ Implementation is gated.** Do not build this feature until the rung-2 gate
> clears — a subset of a real, permissively-licensed public MADR corpus vendored as
> an **offline fixture** and round-tripped by `adr migrate` (that maintainer dogfood
> round-trip **is** the required "real user"; no external human adopter needed). See
> [research.md §R0](./research.md) and tasks.md **T000/T00A**. The commands below
> describe the *intended* surface for the future implement thread.

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

This repo can run `adr check` on its own PRs (an added CI job) so the CI surface
governs the project that ships it — the same dogfooding stance as `adr lint`.
