# Phase 6 rung-2 reference-validation evidence (SC-004)

**Purpose**: Record the immutable evidence that satisfies the Phase 6 rung-2
gate — maintainer-owned isolated reference-repository validation — per
[ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md).
This supersedes the former external-team hard gate (SC-004 / FR-019 / Assumption
A7 / T048 as originally written). It is **rung-2 reference validation, not rung-3
external/community validation**. The reference repository is **maintainer-owned
and isolated**, not an external team or third-party adopter.

**Created**: 2026-07-22
**Feature**: [spec.md](../spec.md) · [tasks.md](../tasks.md)

## Under test (immutable)

| Artifact | Immutable reference |
|---|---|
| adrkit Phase 6 implementation merge | `efef89b5d747ca175a1947f1ce2f4296dab54fa3` (PR [#22](https://github.com/mbeacom/adrkit/pull/22)) |
| Queue Action ref pinned by the reference repo | `mbeacom/adrkit/packages/ci/queue@efef89b5d747ca175a1947f1ce2f4296dab54fa3` |

## Reference repository (maintainer-owned, isolated)

[`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)
— a separate, public repository the maintainer owns and operates. It is **not**
this monorepo and is **not** an external/community adopter. Its workflows pin the
adrkit queue Action at an immutable commit SHA and assert their own expected
outcomes in CI (self-verifying).

| Evidence | Immutable reference |
|---|---|
| Dogfood the queue against the pinned adrkit commit | PR [#2](https://github.com/mbeacom/adrkit-t018-dogfood/pull/2), merge `052d8583555052549ec769eb28a325dd85d62a17` |
| Record full quorum approval on ADR 0015 (prove in-place issue update) | PR [#4](https://github.com/mbeacom/adrkit-t018-dogfood/pull/4), merge `707ce288abc170edf9359ea00018cf177eed2c01` |
| Make the queue workflow self-verifying after every dispatch | PR [#5](https://github.com/mbeacom/adrkit-t018-dogfood/pull/5), merge `10b5a604bc022898160abaf6fa8be6067dc792e0` |
| Managed queue issue (created once, updated in place) | Issue [#3 "ADR ARB Queue"](https://github.com/mbeacom/adrkit-t018-dogfood/issues/3) |
| Self-verifying workflow runs (all `success`) | [29833185424](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29833185424) · [29833230666](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29833230666) · [29834061211](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29834061211) · [29836486788](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/29836486788) |

## What the evidence proves (maps to SC-004 / FR-019 as reference-validation)

- **First-run create**: the Action creates exactly one managed issue (#3) with
  the hidden ownership marker on first dispatch.
- **No duplicate / in-place update**: a subsequent dispatch with changed corpus
  state (PR #4 recorded full quorum approval) updates the **same** issue body in
  place — no second issue is created.
- **All three tiers**: the corpus spans `auto`, `async`, and `arb` review tiers.
- **SLA / overdue**: at least one record is overdue or at the SLA-due boundary as
  of the run date, exercised through the SLA state computation.
- **Approvals + objections**: at least one record carries both `review.approvals`
  and `review.objections` entries.
- **Default token only**: the workflow runs with only the default `GITHUB_TOKEN`
  (`contents: read` + `issues: write`); no PAT, no other credential.
- **Self-verifying**: after every dispatch the workflow asserts its own expected
  outcomes (PR #5), so a divergence fails the run rather than requiring a human to
  read logs. The four runs above all concluded `success`.
- **Negative fixture CI**: the reference repository also exercises a negative
  fixture path in CI.
- **Determinism (SC-001)**: identical corpus, configuration, and as-of instant
  produce byte-for-byte identical output — asserted in this repo's unit/contract
  suite (rung 1) and consistent with the reference-repository runs.

## Honest maturity label

Phase 6 is **landed / reference-validated** on ADR-0014 rungs 1–2. It is **not**
externally validated: no party other than the maintainer has adopted the queue in
their own repository. The rung-3 external/community signal is **open** and tracked
honestly as absent (recruitment issue
[#24](https://github.com/mbeacom/adrkit/issues/24) closed as no longer gating).
External validation remains welcome as a later maturity signal; it is not a
prerequisite for landing Phase 6, opening Phase 7/8 implementation, or executing
the `specs/008-*` / `specs/009-*` non-shipping spikes.
