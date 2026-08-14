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
| adrkit under test (pinned) | `b840e915477c6532ca9697eae1fa277cafa971bc` — the corrected artifact. Runs 1–2 used `71f46d61595b4b956ec640adc72db219ff991385`, which shipped the four defects listed below |
| Comment Action bundle at that ref | `packages/ci/dist/index.js`, git blob `8f039d0d0521baff403a769c278780538f542f6d`, 1,809,405 bytes — **byte-identical at both pins**, so runs 1–4 exercised the same Action through a changing harness, and the behavioural evidence carries across the correction |
| `packages/ci/action.yml` at that ref | git blob `471327bfa93c3195077bf80da1a448f6175cfc66`, 823 bytes (`using: node24`, `main: dist/index.js`) |
| Action reference used by the reference repo | `mbeacom/adrkit/packages/ci@b840e915477c6532ca9697eae1fa277cafa971bc` |
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

| Run | Artifact | URL | Window (UTC) | Conclusion |
|---|---|---|---|---|
| 1 — update/update | `71f46d6` | [31773014051 attempt 1](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773014051/attempts/1) | 05:26:43 → 05:27:27 | success |
| 2 — create/update | `71f46d6` | [31773014051 attempt 2](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773014051/attempts/2) | 05:30:37 → 05:31:18 | success |
| 3 — corrected artifact, **failed** | `b840e91` | [31773788433 attempt 1](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773788433/attempts/1) | 05:41:14 → 05:41:31 | **failure** |
| 4 — **cited**, create/update, corrected artifact | `b840e91` | [31773788433 attempt 2](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/31773788433/attempts/2) | 05:42:51 → 05:43:35 | success |

Runs 3 and 4 share head SHA `668ae517b2577be361402ef331bdea6cc3109d31`. **Run 3 failed**,
and it is the most useful run in this table — see *The one run that failed*.

## Expected vs. observed

| # | Scenario | Expected | Observed (run 3, corrected artifact) | Evidence |
|---|---|---|---|---|
| 1 | First dispatch, from **zero** comments | The Action creates; exactly one comment leads with `<!-- adrkit:ci -->`, authored by a Bot; `check-ci-comment` exits 0 | `already ours before this run:` **empty**; `adrkit: created the governing-decisions comment.`; `1 owned, 0 lead with the marker but are not bot-authored, 0 quote it`; comment **#5289930628** | `idempotence` job `94685162912` |
| 2 | Second dispatch updates rather than creates | The surviving comment's **id is unchanged** (`--expect-id`), so a count of one cannot be satisfied by a replacement | `adrkit: updated the governing-decisions comment.`; id after dispatch 1 = **#5289930628**, after dispatch 2 = **#5289930628** — same, and distinct from every earlier run's comment | `idempotence` job `94685162912` |
| 3 | **Fail-closed**: `dir` is a plain file (`ENOTDIR`) | Step `outcome=failure`; before/after comment snapshot byte-identical over `id`, `updated_at`, and body | `observed: steps.invalid.outcome=failure`; `ENOTDIR: not a directory, scandir '…/fixtures/fail-closed-invalid-corpus-dir'`; `before.tsv` = `after.tsv` = sha256 `037f3377bafb696b86a9b81885fc9baf9fd303e77a22f7030be0ba903437a781` | `fail-closed` job `94685221523`; artifact zip sha256 `28b6344989ac683267d40a9b81bbf3b15e929c7bd23a8638fd7ab644ae54809d`. Run 2's members hashed `dff3abf9…` and its zip `8ed72325…`, re-verified offline with `cmp` |
| 4 | **FR-014 degrade**: `pull-requests: read` | Step `outcome=success` (a log notice, not a failure); comment set unchanged | `steps.readonly.outcome=success`; `adrkit: an app installation token, whose login is not resolvable; matching on the marker and a bot author.`; `##[notice] adrkit: no permission to comment on this PR (read-only token); posting the result to the job log instead.`; `observed: steps.readonly.outcome=success`; `observed: read-only dispatch degraded, comment set unchanged` | `degrade-read-only` job `94685245595` |
| 5 | A `pull-requests: read` token can list issue comments at all | The non-empty snapshot guard does not trip | Guard did not trip; step concluded `success`. Nothing had established this before — the Action's degrade path had only ever been read from source | `degrade-read-only` job `94685245595` |
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

In every dogfood attempt, `updated_at == created_at` after the second dispatch and
`[edited]` was never flagged, even though the Action logged `updated the
governing-decisions comment` and therefore issued a PATCH.

An earlier revision of this index generalised the dogfood observation into a mechanism —
"GitHub does not bump `updated_at` for a PATCH whose body is byte-identical" — on the
strength of a probe in one context. **That claim is withdrawn**, and so is its
replacement, which named the actor as the remaining variable:

| Context | Actor | Body | Gap | `updated_at` |
|---|---|---|---|---|
| `adrkit#143` probes ×3 (6 PATCHes, +5s to +310s) | User via OAuth | byte-identical | seconds–minutes | **unchanged** |
| `adrkit-t018-dogfood#16`, both dispatches, every run | `github-actions[bot]` | identical render | seconds, one run | **unchanged** |
| `openleague#328`, 3 same-commit workflow re-runs | `github-actions[bot]` | SHA-256 identical | minutes, separate runs | **advanced every time** |

Rows 2 and 3 are the **same actor** with opposite outcomes, so the actor does not explain
it. Ruled out by measurement rather than argument: the endpoint (the Action calls
`octokit.rest.issues.updateComment`; the probe PATCHed `/issues/comments/:id` — the same
one) and elapsed time (probed at +5s, +50s, +70s, +90s and +150s). What remains
uncontrolled is that rows 1–2 update within a single run or session and row 3 updates
across separate workflow runs. **The mechanism is not established**, and it is left
unexplained here rather than given a third plausible story — two have already been wrong.

**Why this strengthens the gate.** `check-ci-comment.ts` asserts **id stability**, and
that never depended on which direction `updated_at` moves — only on the field being
uncontractual. Contexts that disagree evidence that better than agreement would have. An
artifact asserting `updated_at` advanced fails rows 1–2; one asserting it held fails row
3; id stability holds in all three. The falsification made the gate more defensible, not
less.

## Why the first attempt is not cited

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

## The one run that failed, and why it is the most useful

Run 3 failed, on a real two-comment state, with the `duplicate` rule firing exactly as
designed:

```
check-ci-comment: examined 2 comment(s); 2 owned, 0 lead with the marker but are not bot-authored, 0 quote it
  own      #5289920445  github-actions[bot] (Bot)  created 2026-08-14T05:41:24Z
  own      #5289920446  github-actions[bot] (Bot)  created 2026-08-14T05:41:24Z
  [duplicate] 2 bot-authored comments lead with <!-- adrkit:ci -->; exactly one is expected
```

Two things follow, and they point in opposite directions.

**It closes the observed-failure gap at rung 2.** Until this run, every rung-2 assertion
had passed, which shows the gate accepting healthy behaviour and never shows it catching
anything — the exact insufficiency
[ADR-0016](../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
names. The `duplicate` rule has now been observed rejecting a genuine duplicate produced
by real infrastructure, not by a fixture.

**It was caused by this repository's own instructions.** An earlier revision of the
reference README said to delete the comment *before* pushing. Doing so removed the
accidental protection that a pre-existing comment provides — it makes a second writer
*update* rather than create — so both this workflow and the repository's `adr.yml` listed
an empty set and both created, within the same second, producing consecutive ids. The
guidance made the race likely instead of preventing it. The README now specifies
push → settle → delete → `gh run rerun`, which excludes the race structurally because a
re-run does not re-trigger other workflows.

**And the message it printed was wrong about the cause.** It said "a dispatch in this run
created rather than updated — the regression of #107", when the Action had behaved
correctly and logged exactly one `created`. `--expect-ids` separates *predates this run*
from *created during it*; it cannot separate *created by this run's dispatch* from
*created by a concurrent foreign writer*. The message now names both causes and points at
the Action's own log, which does distinguish them.

## Known limitations, stated up front

- **A rung-2 run against genuinely broken published behaviour has not been done.** The
  `duplicate` rule has now been observed firing (above), but on a duplicate produced by a
  concurrent writer rather than by the #107 defect itself. A run pinned to a
  **pre-`1426916`** adrkit commit would exercise the real regression; it is recorded here
  as an option not taken rather than as a plan. The fixture-based negative cases in
  `scripts/__fixtures__/ci-comment/` remain the rung-1 evidence.
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

All four were fixed in `b840e91` and **confirmed by run 3**, which is why run 3 is the
cited evidence rather than run 2: an artifact corrected after its own verification run is
an unverified artifact, which is the state this index exists to make visible.

Confirmed in run 3 specifically:

- `Deleting the contents of '…/.adrkit'` no longer appears. All three deletion lines in
  the run are the ordinary root-workspace clear, one per job, and the checkout now
  initialises `…/.adrkit-src/.git/` rather than clearing `.adrkit`. Repository integrity
  is evidenced indirectly rather than claimed directly: `ADR ARB queue validation` on the
  same head SHA ran `scripts/validate-badge-reports.sh`, whose *Assert the committed
  badge reports are current* step concluded `success`, and that script fails if
  `.adrkit/lint.json` or `.adrkit/queue.json` is missing or stale. The files' survival
  **inside the `idempotence` runner workspace** was not directly observed — the artifact
  prints no file listing — and is not claimed.
- `already ours before this run:` is **empty**, so the create was genuinely observed.
- `observed: steps.readonly.outcome=success` now appears in the degrade log, so that row
  is fillable from a log line rather than from the REST API.
