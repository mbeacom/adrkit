# CI-surface comment path — rung-2 reference-verification evidence index

**Purpose**: the tracked, sanitized evidence index for the governing-decisions
**comment** path of `packages/ci`, per
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rung 2 and [ADR-0026](../../../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md) action items 8–9.
This is **rung-2 reference verification, not rung-3 external / community
validation** — the reference repository is maintainer-owned and isolated, not a
third-party adopter.

It is the sibling of
[`specs/007-arb-queue/checklists/reference-verification-evidence.md`](../../007-arb-queue/checklists/reference-verification-evidence.md),
which covers the *queue* Action. The queue Action is reference-verified; the comment
Action is not, and that asymmetry is the gap [#135](https://github.com/mbeacom/adrkit/issues/135)
names.

**Created**: 2026-08-14
**Feature**: [spec.md](../spec.md) · [tasks.md](../tasks.md)
**Runnable artifact**: [`../evidence/reference-repo/comment-idempotence.yml`](../evidence/reference-repo/comment-idempotence.yml)
· [how to run it](../evidence/reference-repo/README.md)

## Status: NOT YET OBSERVED

**Reviewer verdict: none. No run has occurred.**

Nothing below is claimed as evidence. The `Observed` column is empty on purpose, and
this file must not be read as satisfying rung 2 until it is filled from real runs with
immutable links. ADR-0014's honesty rules make `landed / reference-verified` a distinct
claim from `implemented`, and the comment path is currently **implemented** with
continuous rung-1 evidence only.

The distinction this index exists to keep visible: an empty `Observed` column is
*visibly* unverified, whereas the state before this index existed — was
indistinguishable from verified to anyone who did not go looking.

## Tool versions / environment

| Component | Value |
|---|---|
| adrkit under test (pinned) | `71f46d61595b4b956ec640adc72db219ff991385` (committed 2026-08-14T04:20:31Z) |
| Comment Action bundle at that ref | `packages/ci/dist/index.js`, git blob `8f039d0d0521baff403a769c278780538f542f6d`, 1,809,405 bytes |
| `packages/ci/action.yml` at that ref | git blob `471327bfa93c3195077bf80da1a448f6175cfc66`, 823 bytes (`using: node24`, `main: dist/index.js`) |
| Action reference used by the reference repo | `mbeacom/adrkit/packages/ci@71f46d61595b4b956ec640adc72db219ff991385` |
| Assertion script at that ref | `scripts/check-ci-comment.ts`, git blob `6e93b491b753ea8119536a9d870d6177733c114a`, 24,737 bytes (the same one `action-dogfood` runs) |
| Reference-repo runner | `ubuntu-24.04` — images differed **between jobs of one run** (`ubuntu24/20260720.247` and `ubuntu24/20260810.271`), which bounds how reproducible "ubuntu-latest" is |
| Bun (assertion step) | `1.3.14`, pinned by the artifact |
| Action runtime | `node24` |
| Fail-closed invalid fixture | `fixtures/fail-closed-invalid-corpus-dir` — git mode `100644`, blob `a9f7c3c4e629fda55968569c88a4a0283f7d66b4`, 1,083 bytes, sha256 `e9fa3bd4ffd31d75e27b5720db82c6a72a7b7b455a7fb35f94e8d00dc7319b98`, `file(1)` = ASCII text. Plain file, untouched by the run |
| Installed-file fidelity | `diff` against the shipped artifact = exactly 5 changed lines (the pins); 0 remaining `0000…` placeholders; exactly one `continue-on-error`, the shipped one. No assertion weakened, removed, or added |
| Credential surface | default `GITHUB_TOKEN` only; no PAT, no repository secret. Repository `default_workflow_permissions` is `read`, and the job-level `pull-requests: write` still granted write — this run is the proof |

## Runs

Pull request [`adrkit-t018-dogfood#16`](https://github.com/mbeacom/adrkit-t018-dogfood/pull/16),
branch `mbeacom-rung-2-comment-verification` (a branch in that repository, not a fork),
head `77050b7d579333d9d9701bae15d246996b2f41d3`.

| Attempt | URL | Window (UTC) | Conclusion |
|---|---|---|---|
| 1 — update/update | [run 31773014051 attempt 1](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773014051/attempts/1) | 05:26:43 → 05:27:27 | success |
| 2 — **cited**, create/update | [run 31773014051 attempt 2](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773014051/attempts/2) | 05:30:37 → 05:31:18 | success |

All six jobs (3 × 2 attempts) concluded `success`.

## Expected vs. observed

| # | Scenario | Expected | Observed (attempt 2) | Evidence |
|---|---|---|---|---|
| 1 | First dispatch, from **zero** comments | The Action creates; exactly one comment leads with `<!-- adrkit:ci -->`, authored by a Bot; `check-ci-comment` exits 0 | `already ours before this run:` **empty**; `adrkit: created the governing-decisions comment.`; `1 owned, 0 lead with the marker but are not bot-authored, 0 quote it`; comment **#5289855976** | `idempotence` job `94683213626` |
| 2 | Second dispatch updates rather than creates | The surviving comment's **id is unchanged** (`--expect-id`), so a count of one cannot be satisfied by a replacement | `adrkit: updated the governing-decisions comment.`; id after dispatch 1 = **#5289855976**, after dispatch 2 = **#5289855976** — same, and distinct from the deleted #5289832099 | `idempotence` job `94683213626` |
| 3 | **Fail-closed**: `dir` is a plain file (`ENOTDIR`) | Step `outcome=failure`; before/after comment snapshot byte-identical over `id`, `updated_at`, and body | `observed: steps.invalid.outcome=failure`; `ENOTDIR: not a directory, scandir '…/fixtures/fail-closed-invalid-corpus-dir'`; `before.tsv` = `after.tsv` = sha256 `dff3abf92c7cbc6074b56b19cb01c72e8fe9cc1733cad128d0d966a14e3eab49`; verified again offline with `cmp` after downloading the artifact | `fail-closed` job `94683269202`; artifact zip sha256 `8ed723256019e07739d6c0c0bd34f60ad6ef14def15b3a742f43776e7503ee6b` (558 B) |
| 4 | **FR-014 degrade**: `pull-requests: read` | Step `outcome=success` (a log notice, not a failure); comment set unchanged | `steps.readonly.outcome=success`; `adrkit: an app installation token, whose login is not resolvable; matching on the marker and a bot author.`; `##[notice] adrkit: no permission to comment on this PR (read-only token); posting the result to the job log instead.`; `observed: read-only dispatch degraded, comment set unchanged` | `degrade-read-only` job `94683296850` |
| 5 | A `pull-requests: read` token can list issue comments at all | The non-empty snapshot guard does not trip | Guard did not trip; step concluded `success`. Nothing had established this before — the Action's degrade path had only ever been read from source | `degrade-read-only` job `94683296850` |
| 6 | Credential surface | Only the default `GITHUB_TOKEN`; permissions exactly as declared per job | Confirmed in all three job definitions; repository `default_workflow_permissions` is `read` | Workflow definition + run logs |

## Two values that are easy to record wrongly

- **The artifact zip hash is not the snapshot hash.** `8ed72325…` (attempt 2) and
  `3b0feecb…` (attempt 1) are the uploaded **zip containers**; `dff3abf9…` and
  `41ad5cb4…` are the `before.tsv`/`after.tsv` **members**. The `sha256sum … | tee` lines
  in the log are member hashes. Conflating them would put a container digest in a row
  that claims byte-identical comment state.
- **`steps.invalid.outcome=failure` is not what the REST API reports.**
  `continue-on-error: true` converts that step's *conclusion* to `success`; only
  `outcome` is `failure`. The artifact asserts on `outcome`, which is correct — but an
  index filled from the API rather than the log would record the opposite of what
  happened.

## An assertion this run converted from rationale into observation

In **both** attempts, `updated_at == created_at` after the second dispatch and `[edited]`
was never flagged, even though the Action logged `updated the governing-decisions
comment` and therefore issued a PATCH. GitHub does not bump `updated_at` for a PATCH
whose body is byte-identical.

`check-ci-comment.ts` asserts **id stability** rather than `updated_at` advancing, and
documents that choice as a hedge against an uncontractual API detail. This run shows the
hedge was load-bearing: an artifact asserting `updated_at` would have failed both
attempts against a healthy Action.

## Why attempt 1 is not the cited run

Attempt 1 was green and proved strictly less than it appeared to. The reference
repository's own `adr.yml` — pinned at the **moving** `@main`, not at the commit under
test — created the comment four seconds after `idempotence` started and before its
snapshot step read it. So `already ours before this run: 5289832099` was non-empty, both
dispatches *updated*, and no **create** was observed.

That matters because "one comment, same id" is also exactly what an Action writing
nothing produces. The `absent` rule was satisfied by a comment this workflow did not
create, and by a build that was not the one under test.

Attempt 2 removed that comment, confirmed the pull request carried zero, and re-ran this
workflow alone. It is the run that establishes the #107 property. The hazard is now
documented in the artifact's README as a setup precondition.

Scenario 4 is the one rung 1 cannot reach at all: `action-dogfood` excludes fork and
Dependabot pull requests *because* their token is read-only, so the repository's own CI
structurally cannot exercise the degrade path it skips.

## Known limitations, stated up front

- **Nothing in this run was observed *failing*.** Every assertion passed. That shows the
  gate accepting healthy behaviour; it does not show the gate *catching* a regression,
  which is the property [ADR-0016](../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
  says a check must demonstrate before it counts as coverage. The observed-failure
  requirement is met at rung 1 instead, by `scripts/__fixtures__/ci-comment/` — the
  duplicate (#107), absent, empty, human-authored, and impostor shapes, each watched
  rejecting. A rung-2 run pinned to a **pre-`1426916`** adrkit commit would supply the
  missing half against real published behaviour; it has not been done, and is recorded
  here as an option not taken rather than as a plan.
- **The retry paths never executed.** `--expect-total`'s `incomplete` rule did not fire
  in either attempt, so neither the 5× nor the 3× retry loop ran a single retry. They are
  unexercised in practice.
- **The FR-014 observation is a proxy, not a fork pull request.** It comes from a job
  granted `pull-requests: read` — the same read-only-token condition a fork gets — but no
  genuine fork pull request was involved. Any claim that fork behaviour was *observed*
  must say so.
- **The multi-page `prior-ids` defect was read, not observed.** With `--paginate`, a
  `join(",")` inside `--jq` emits one line per page, which would hand `--expect-ids` a
  multi-line value past 30 comments. Reproduced against the labels endpoint and fixed in
  both workflows; never seen on this pull request, which carried one comment.
- **`gh`'s version on the runner is unknown** — no step prints it.
- **Rung 3 is absent.** No party other than the maintainer has validated this surface.
  The reference repository is maintainer-owned, so this is rung 2 however real the run.

## Defects this run found in the artifact itself

Recorded because an artifact that has never executed is not yet evidence of anything,
and because all four were invisible to static review:

1. **`path: .adrkit` clobbered a tracked directory.** The reference repository already
   tracks `.adrkit/lint.json` and `.adrkit/queue.json`, and `actions/checkout` deletes
   its target's contents — logged verbatim as `Deleting the contents of '…/.adrkit'`.
   Latent (no step in this workflow reads them) but destructive. Fixed to `.adrkit-src`,
   the name that repository already reserves in `.gitignore` for this exact purpose.
2. **A second workflow writing the same marker silently weakens the run** — see *Why
   attempt 1 is not the cited run*. Now a documented precondition.
3. **`degrade-read-only` never echoed its observed outcome**, unlike its sibling, so that
   row had to be read from the REST API rather than a log line. Fixed.
4. **`prior-ids` was multi-line past one page.** Fixed in the reference workflow *and* in
   adrkit's own `action-dogfood`, which carried the same defect.

Items 1, 3, and 4 were fixed without a re-run being required to establish the evidence
above; a confirming run of the corrected artifact is the remaining step.
