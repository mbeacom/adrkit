# CI-surface comment path — rung-2 reference-verification evidence index

**Purpose**: the tracked, sanitized evidence index for the governing-decisions
**comment** path of `packages/ci`, per
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rung 2 and [ADR-0028](../../../docs/adr/0028-give-the-comment-posting-action-an-end-to-end-signal-on-both-rungs.md).
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
*visibly* unverified, whereas the state before ADR-0028 — no index at all — was
indistinguishable from verified to anyone who did not go looking.

## Tool versions / environment

| Component | Value |
|---|---|
| adrkit under test (pinned) | _pending — 40-character commit SHA, never a tag or branch_ |
| Comment Action bundle at that ref | _pending — `packages/ci/dist/index.js` git blob + byte size_ |
| Action reference used by the reference repo | `mbeacom/adrkit/packages/ci@<sha>` |
| Assertion script at that ref | `scripts/check-ci-comment.ts` (the same one `action-dogfood` runs) |
| Reference-repo runner | `ubuntu-latest`; Action declares `node24` |
| Bun (assertion step) | `1.3.14` |
| Fail-closed invalid fixture | `fixtures/fail-closed-invalid-corpus-dir` (a plain file) |
| Credential surface | default `GITHUB_TOKEN` only; no PAT, no repository secret |

## Expected vs. observed

| # | Scenario | Expected | Observed | Evidence |
|---|---|---|---|---|
| 1 | Two dispatches on one pull request | Exactly one comment leads with `<!-- adrkit:ci -->`; its author is a Bot; `check-ci-comment` exits 0 | _pending_ | _pending_ |
| 2 | A third dispatch on the same pull request, after a push | Still exactly one comment; `updated_at` has advanced past `created_at` | _pending_ | _pending_ |
| 3 | **Fail-closed**: `dir` is a plain file (`ENOTDIR`) | Step `outcome=failure`; before/after comment snapshot byte-identical over `id`, `updated_at`, and body | _pending_ | _pending_ |
| 4 | **FR-014 degrade**: `pull-requests: read` | Step `outcome=success` (a log notice, not a failure); comment set unchanged | _pending_ | _pending_ |
| 5 | Credential surface | Only the default `GITHUB_TOKEN`; permissions exactly as declared per job | _pending_ | _pending_ |

Scenario 4 is the one rung 1 cannot reach at all: `action-dogfood` excludes fork and
Dependabot pull requests *because* their token is read-only, so the repository's own CI
structurally cannot exercise the degrade path it skips.

## Known limitations, stated up front

- **The pre-fix negative case cannot be reproduced here.** The regression this evidence
  guards against — [#107](https://github.com/mbeacom/adrkit/issues/107) — is fixed in
  every ref worth pinning, so scenario 1 cannot be *observed failing* against a real
  adrkit commit without deliberately pinning a pre-`1426916` one. The observed-failure
  requirement of [ADR-0016](../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
  is met instead at rung 1, by `scripts/__fixtures__/ci-comment/duplicate.json`, which
  is the real shape of a #107 pull request and which the shared assertion script
  rejects. Pinning a pre-fix ref for one run would be strictly better evidence and is
  recorded here as an option, not as something that was done.
- **Rung 3 is absent.** No party other than the maintainer has validated this surface.
