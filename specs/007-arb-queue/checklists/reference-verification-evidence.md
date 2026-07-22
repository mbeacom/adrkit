# Phase 6 rung-2 reference-verification evidence index (T048-R)

**Purpose**: The tracked, sanitized evidence index that satisfies the Phase 6
rung-2 gate — maintainer-owned isolated reference-repository validation — per
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md).
It supersedes the former external-team hard gate (SC-004 / FR-019 / Assumption A7
/ the original `T048`, now `T048-R`). This is **rung-2 reference verification, not
rung-3 external / community validation**. The reference repository is
**maintainer-owned and isolated**, not an external team or third-party adopter.

Phase 6 maturity per the ADR-0014 vocabulary: **implemented → reference-verified →
landed**. It is **not** `released` and **not** `externally validated`.

**Created**: 2026-07-22
**Feature**: [spec.md](../spec.md) · [tasks.md](../tasks.md)
**Reviewer verdict**: PASS (maintainer `@mbeacom`). Rung-2 criteria — reproducible,
self-verifying, fail-closed, reviewed — are all met by the artifacts below.

## Tool versions / environment

| Component | Version / ref |
|---|---|
| adrkit under test (pinned) | commit `efef89b5d747ca175a1947f1ce2f4296dab54fa3` (PR #22) |
| Queue Action bundle at that ref | `packages/ci/dist/queue-action.js`, git blob `a87448a13656f75322e71e267ebe91d388094f80` (1,750,419 bytes) |
| Action reference used by the reference repo | `mbeacom/adrkit/packages/ci/queue@efef89b5d747ca175a1947f1ce2f4296dab54fa3` |
| Reference-repo runner | `ubuntu-latest`; Action declares `node24` |
| Bun (validation workflow) | `1.3.14` (asserted by `validate-queue.sh`) |
| Fail-closed invalid fixture | `fixtures/fail-closed-invalid-corpus-dir` (a plain file), git blob `a9f7c3c4e629fda55968569c88a4a0283f7d66b4` |
| Fail-closed run environment | `ubuntu-24.04` image `20260714.240.1`; runner `2.336.0`; `actions/checkout@v4`; `actions/upload-artifact@v4` |
| Fail-closed run permissions | workflow declares `contents: read` + `issues: write`; `metadata: read` is the implicit default granted to `GITHUB_TOKEN`; no PAT, no repository secret |

## Reference repository (maintainer-owned, isolated)

[`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood) —
a separate, public repository the maintainer owns and operates. It is **not** this
monorepo and is **not** an external/community adopter. Its workflows pin the adrkit
queue Action at the immutable commit SHA above and assert their own expected
outcomes in CI (self-verifying).

| Change | Immutable merge SHA |
|---|---|
| PR [#2](https://github.com/mbeacom/adrkit-t018-dogfood/pull/2) — dogfood queue against the pinned adrkit commit | `052d8583555052549ec769eb28a325dd85d62a17` |
| PR [#4](https://github.com/mbeacom/adrkit-t018-dogfood/pull/4) — record full quorum approval on ADR 0015 (prove in-place issue update) | `707ce288abc170edf9359ea00018cf177eed2c01` |
| PR [#5](https://github.com/mbeacom/adrkit-t018-dogfood/pull/5) — make the queue workflow self-verifying after every dispatch | `10b5a604bc022898160abaf6fa8be6067dc792e0` |
| PR [#6](https://github.com/mbeacom/adrkit-t018-dogfood/pull/6) — add consumer-facing fail-closed evidence for the queue Action | `2d7f6063b1d0d93f453138cf24a2bcd81aa287a6` |

Managed queue issue: [#3 "ADR ARB Queue"](https://github.com/mbeacom/adrkit-t018-dogfood/issues/3)
— created once, updated in place across reruns. The README evidence write-up for the
fail-closed dispatch is commit
[`b1536bb`](https://github.com/mbeacom/adrkit-t018-dogfood/commit/b1536bb125b31a041a514d23b87779ab5c0bf1af)
("docs: record live fail-closed dispatch evidence (run 29920390292)").

## Fail-closed proof — mechanical details and hashes

The one live consumer-facing fail-closed scenario (run
[29920390292](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29920390292),
workflow `arb-queue-fail-closed.yml`, PR #6) establishes, mechanically and network-free:

- **Deterministic invalid input.** The checked-in path `fixtures/fail-closed-invalid-corpus-dir`
  is a **plain file** used as the Action's `dir` input, so `readdir()` throws `ENOTDIR`
  inside adrkit's corpus loader **before** any Octokit client is constructed or any write is
  attempted.
- **Mechanical expected-failure proof.** `steps.queue.outcome == failure` and the Action's
  `issue-number` output is empty — asserted by the workflow, so a non-failure would fail the
  run. (The run's overall conclusion is `success` precisely because the verifier asserts the
  **expected** Action failure.)
- **Zero mutation, proven by byte-for-byte snapshot compare.** Every OPEN+CLOSED issue is
  snapshotted before and after as `number, state, title, updatedAt, bodySha256`, then compared
  network-free. The canonical before/after snapshot SHA-256 are **identical**:
  `9b15bda8a202ec4bb9539f920ceb47f96b2844a4b46232c2a3a4465e579802d9`. Issue #3 remained `OPEN`
  with `updatedAt 2026-07-21T13:21:38Z` (unchanged by the fail-closed run).
- **Uploaded sanitized evidence artifact** (before/after snapshots) SHA-256:
  `15e3c042fbda394a579de560756d51ea1ca075031df5d1b458ffd2f8006cb966` (retained 90 days).
- **Untouched context.** The existing valid corpus, the other workflows, issue #3, and all
  previous runs were left untouched by this dispatch.

## Expected vs. observed

| # | Scenario | Expected | Observed | Evidence |
|---|---|---|---|---|
| 1 | Valid corpus, `adr queue --format json` | QueueReport v1; 3 tiers (`auto`/`async`/`arb`); overdue + due present; approvals + objections present; zero corpus findings | Asserted green by `scripts/validate-queue.sh` + `scripts/assert-queue-report.ts` at fixed `--as-of` | Runs [29920522079](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29920522079), [29920381850](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29920381850) (workflow `queue-validation.yml`) |
| 2 | First Action dispatch, valid corpus | Exactly one managed issue created; hidden ownership marker present; default token only | Issue #3 created; single issue | Run [29833185424](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29833185424) (create) |
| 3 | Rerun with changed body (ADR 0015 full quorum) | Same issue #3 body updated in place; no duplicate issue | Same issue updated; no duplicate | Run [29834061211](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29834061211); PR #4 |
| 4 | Self-verification after every dispatch | Workflow asserts its own expected outcome; diverging behavior fails the run | Passed | Run [29836486788](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29836486788); PR #5 |
| 5 | **Fail-closed**: invalid corpus dir (a file → `ENOTDIR`) | Action step fails **before** any GitHub write; no `issue-number` output; zero issue mutation across all OPEN+CLOSED issues; default token only | Step `outcome=failure`; empty `issue-number`; before/after canonical snapshot SHA-256 identical (`9b15bda8…802d9`); artifact SHA-256 `15e3c042…cb966` | Run [29920390292](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29920390292) (workflow `arb-queue-fail-closed.yml`); PR #6; README commit `b1536bb`; sanitized before/after snapshot artifacts retained 90 days |
| 6 | Credential surface | Only default `GITHUB_TOKEN` with `contents: read` + `issues: write`; no PAT/secret | Confirmed in all workflow definitions | `arb-queue.yml`, `arb-queue-fail-closed.yml`, `queue-validation.yml` |

All cited runs concluded `success`.

## Determinism (SC-001)

Identical corpus, configuration, and `--as-of` instant produce byte-for-byte
identical JSON and Markdown. Asserted in this repo's unit/contract suite (rung 1)
and consistent with the reference repository's fixed-`--as-of` validation runs.

## Limitations (honest scope of this evidence)

- This is **rung-2 reference verification only**. It is **not** rung-3 external /
  community validation: no party other than the maintainer has adopted the queue.
- The reference repository is maintainer-owned; it demonstrates correctness,
  reproducibility, and fail-closed behavior, not third-party adoption or sustained
  use.
- The live fail-closed scenario evidenced is exactly **one deterministic invalid-input
  class** — an unreadable `dir` (a plain file → `ENOTDIR`) causing pre-write failure with
  zero mutation. Other consumer-facing failure modes the Action also implements
  (duplicate ownership marker, configured-title conflict, missing `issues: write`
  permission) are covered by this repo's unit/integration tests (rung 1) rather
  than by a separate live reference-repo dispatch.
- External run/issue links are hosted on GitHub and were verified via `gh` at
  authoring time; git commit/blob SHAs are content-addressed and immutable.

## Honest maturity label

Phase 6 is **implemented, reference-verified, and landed** (ADR-0014 rungs 1–2). It
is **not released** and **not externally validated**: the rung-3 external/community
signal is **open** and tracked honestly as absent (recruitment issue
[#24](https://github.com/mbeacom/adrkit/issues/24) closed as no longer gating).
External validation remains welcome as a later maturity signal; it is not a
prerequisite for landing Phase 6, opening Phase 7/8 implementation, or executing
the `specs/008-*` / `specs/009-*` non-shipping spikes.
