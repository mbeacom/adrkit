# Reference-repository artifact — the comment Action's rung-2 run

[ADR-0014](../../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rung 2 asks for maintainer-owned isolated reference-repository validation that is
**reproducible, self-verifying, fail-closed, and reviewed**.
[ADR-0026](../../../../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md) action item 9
places the comment path's end-to-end evidence on **both** rungs: rung 1 continuously,
inside this repository's own CI (`action-dogfood` in `.github/workflows/ci.yml`), and
rung 2 here, against a published-shaped consumer.

`comment-idempotence.yml` in this directory is that rung-2 run, shipped as a runnable
file. [ADR-0016](../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
clause 4 is explicit that deferring work means handing over the failing case, not the
instruction to construct one — "an instruction to observe a failure, with no failure
attached, is a check that cannot fail dressed as a handoff."

## What it covers that rung 1 cannot

| Scenario | rung 1 (`action-dogfood`) | rung 2 (this file) |
|---|---|---|
| Two dispatches leave one comment | yes | yes, against a pinned immutable ref |
| Runs as a *consumer* — `uses: mbeacom/adrkit/packages/ci@<sha>` | no, `uses: ./packages/ci` | yes |
| Fail-closed: invalid corpus dir writes nothing | no | yes, byte-for-byte snapshot compare |
| FR-014 degrade on a read-only token | **no — structurally impossible** | yes |

The fourth row is the reason both rungs exist rather than one. `action-dogfood` skips
fork pull requests precisely because their token is read-only, so the repository's own
CI can never exercise the degrade path it skips over. A reference repository can grant
`pull-requests: read` deliberately and assert the Action stays green and writes
nothing.

## Running it

1. Copy `comment-idempotence.yml` into `.github/workflows/` of
   [`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood).
2. Replace every `0000000000000000000000000000000000000000` — the `ADRKIT_REF` env and
   the four `uses:` refs — with the 40-character adrkit commit under test. A tag or a
   branch is not acceptable here: ADR-0016 records a stale read by ref that returned
   HTTP 200 and coherent content while being behind the branch head.

   **The commit must contain `scripts/check-ci-comment.ts`**, because the assertion
   steps run that script from this ref. No published release tag does yet, so pinning
   the commit `@v0` resolves to would check out cleanly and then fail with a
   module-not-found inside the assertion — a broken-looking artifact that is really a
   mis-set input.
3. Ensure a **plain file** exists at `fixtures/fail-closed-invalid-corpus-dir` (any
   content). It must be a file, not a directory — that is what makes `readdir()` throw
   `ENOTDIR` inside adrkit's corpus loader, before any GitHub write is attempted. In
   `adrkit-t018-dogfood` it is already committed; leave it alone rather than recreating
   it, so the corpus is not perturbed between runs.
4. Push a branch **in that repository** carrying the workflow and the fixture, and open
   the pull request from it. Not from a fork: a fork's token is read-only, so the
   `idempotence` job would find nothing to assert. A pull request opened from a branch
   that does not carry steps 1 and 3 runs no jobs at all, which looks like success.
5. **In the reference repository:** record the observed values — run URLs, job
   conclusions, verbatim `check-ci-comment:` lines, comment ids before and after each
   dispatch, `steps.<id>.outcome` strings, and snapshot hashes.
6. **Back in adrkit, by a maintainer:** transcribe them into
   [`../../checklists/reference-verification-evidence.md`](../../checklists/reference-verification-evidence.md)
   and move the comment-Action maturity sentence in `site/src/content/docs/ci.mdx` —
   that page is what adopters read. Steps 5 and 6 are separate because whoever runs this
   artifact is working in the reference repository and cannot commit to adrkit.

7. **Close the pull request without merging, and keep the branch.** This is a run-once
   harness on a throwaway branch, not a workflow to adopt. Merging it to the reference
   repository's default branch makes it run on **every** future pull request there,
   concurrently with whatever else writes the marker — which converts the documented race
   from an incidental hazard into a permanent CI failure mode: false #107 reports on
   unrelated changes, and `fail-closed`/`degrade-read-only` reddening whenever another
   write lands inside their byte-for-byte snapshot brackets. Retaining the branch keeps
   the run, its logs, and its uploaded artifacts reachable for the evidence index to cite.

## Prerequisites that are easy to discover the hard way

- **A token with the `workflow` scope.** The entire artifact is delivered as a file under
  `.github/workflows/`, and a push that creates or updates one is rejected without that
  scope (`refusing to allow an OAuth App to create or update workflow … without
  `workflow` scope`). Observed on the first real run.
- **No other workflow in the reference repository may post the `<!-- adrkit:ci -->`
  comment.** A second writer does not necessarily fail the run, and that is what makes it
  dangerous: if it wins the race it satisfies the `absent` rule with a comment *this*
  workflow did not create, and `idempotence` then passes having observed two updates and
  no create — proving strictly less than a green run appears to. Exactly that happened on
  the first real run, where the repository's own `adr.yml` created the comment four
  seconds before the snapshot step read it. GitHub concurrency groups cannot serialise
  across workflows, so the `concurrency` block here cannot guard it.

  **Order matters, and the obvious order is wrong.** Do NOT delete the comment before
  pushing. An earlier revision of this file said to, and it caused a genuine
  double-create: with the comment cleared, both writers listed an empty set and both
  created, on the same second, producing consecutive ids `#5289920445` and `#5289920446`
  and a failed run that blamed #107 for an Action that had behaved correctly. Clearing
  the comment first removes the accidental protection — a pre-existing comment makes the
  other writer *update* — and converts an unlikely race into a likely one.

  The race-free order is:

  1. **Push first**, and let any other marker-writing workflow run to completion.
  2. **Confirm it has finished**, then delete every `<!-- adrkit:ci -->` comment on the
     pull request and confirm the count is **zero**.
  3. **`gh run rerun <run-id>` for this workflow alone.** A re-run does not re-trigger
     other workflows, so the race is *structurally excluded* rather than merely unlikely
     — verified twice: after `gh run rerun`, this workflow advanced to `attempt=2` while
     the other stayed at `attempt=1, completed`.

  Then verify from the log that `already ours before this run:` is **empty** — that line
  is what distinguishes a run which observed a create from one which only observed
  updates.

## Why it does not live in adrkit's own CI

The reference repository is a **consumer**: it pins an immutable adrkit ref and calls
the Action the way `site/src/content/docs/ci.mdx` tells adopters to. Running these
three scenarios here instead would test the monorepo's working tree against itself,
which is a different claim — and the `pull-requests: read` job in particular would be
asserting a degrade path using a token this repository grants itself, rather than one a
consumer was handed.
