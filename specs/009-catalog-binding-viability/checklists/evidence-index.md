# Spike 009 evidence index (FR-019 / FR-025)

**Purpose**: The tracked, sanitized evidence index this non-shipping compatibility
spike's own `spec.md` (FR-019) anticipates as the *task/plan housekeeping record*
of an executed run. It mirrors ADR-0014's rung-2 discipline — content hashes, tool
versions, network/credential limits, negative-test results, and a reviewer
verdict — **without** embedding the full raw evidence bundle, corpus checkouts, or
live-session transcripts, which remain scratch/session-artifact-only per this
spike's own contract (`spec.md` FR-019: "the evidence bundle itself MUST remain
scratch/untracked output"). Because this run's own recorded verdict is `blocked`
(not `go-explicit`), no "landed" claim is made by this index, and no tracked
sanitized evidence index beyond this task/plan-completion record is warranted or
authorized. **This index does not itself constitute, cause, or substitute for
Phase 6 external/community validation, optional externally-validated maturity, or
any production/shipping integration decision.**

**Executed**: this session, from `main` post-PR-#36 merge `8c06dc656cdd9abf22d59e5ae49da9eb058c604d`.
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/](../contracts/)

## Recorded verdict

**`outcome: "blocked"`**, `blockedShortfall: "envelope-or-scale-evidence-incomplete"`.

Precedence was evaluated in the fixed order `no-go` → `go-explicit` → `blocked`
(data-model.md §23; SC-012). Neither `no-go` nor `go-explicit` fired; `blocked`
is the exhaustive, honestly-reached fallback.

- **`no-go` (did not fire)**: all eight named unsafe conditions were checked
  against the assembled evidence — determinism (`mutation-baselines.json`: 11/11
  gated invocations byte-identical), network/credential isolation
  (`network-denial.json`, `credential-absence.json`), whole-operation atomicity
  (`atomic-failure-records.json`: 13/13 `runAborted=true`,
  `partialSnapshotProduced=false`), repository-mismatch rejection,
  invalid-pattern/invalid-shape rejection, envelope-rejection correctness
  (tampered/stale/wrong-repository/malformed-kind), repository-isolation, and
  cross-run byte-identical output — **none fired**.
- **`go-explicit` (did not fire)**: every User Story 1–7 acceptance scenario
  passed exactly as specified **except** Phase 8 (US6), which requires a
  populated envelope/scale-evidence record for every real-corpus pass. The
  pinned `community-plugins` and `rhdh-plugins` corpora each contain a genuine,
  pre-existing `duplicate-canonical-id` defect (five unsubstituted Backstage
  software-template skeleton files sharing the literal, un-templated
  `metadata.name: "${{ values.name | dump }}"` placeholder) that deterministically,
  correctly, fail-closed-triggers rejection on all 6 repetitions, byte-identically,
  for both corpora. SC-001 (byte-identical output) and SC-002 (whole-operation
  atomicity) both **hold** — the rejection itself is deterministic with zero
  partial output — but SC-010 (three populated envelopes) is unsatisfiable for 2
  of 3 required real-corpus passes. This is the generator working exactly as
  designed against a genuine corpus defect, not a bug — disclosed, not patched
  (this is a non-shipping spike; no production-code fix is authorized or
  attempted).
- **`blocked` (fired, exhaustive fallback)**: `blockedShortfall =
  "envelope-or-scale-evidence-incomplete"`, affecting the `community-plugins` and
  `rhdh-plugins` passes only — the `synthetic` pass fully produced a populated
  9-entity envelope. B/C comparison-heuristic measurement (391 measurements,
  independent of the Phase 8 snapshot-pipeline shortfall) succeeded fully for
  both real corpora and synthetic data.

## Reference oracle (T014–T016; pre-generator gate)

`reference-oracle.json` sha256 `8f0e260fbf86eadf495726f6f8d6f569586c75ed0f74cafa1b5c8411610ae9d5`
was authored by the maintainer role, frozen, and hashed **before** any
generator-derived output existed. It was independently audited pre-generator
(T014a) by a fresh-context sub-agent with no prior authoring involvement, which
recomputed the sha256 (match confirmed) and confirmed all six required case
classes (positive / negative / overlap / annotation-absent vs. explicit-empty /
canonical collision / repository mismatch) present and correctly labeled, with
the contract's bounded zero-false-positive/zero-false-negative bar satisfied.
`reference-oracle-audit.json` sha256
`f80b67c021ddcbd9bc155921252c5cb73c36b2b185c08bc2ba050dca08f87c48`.

**Disclosed model-policy deviation**: this session's execution instructions
specified Claude Opus 4.8 or GPT-5.6 Sol (never Opus 4.6) for the frozen-oracle
audit and the final fresh-context evidence audit. T014a was performed by an
independent, fully context-isolated Claude **Sonnet 4.6** sub-agent — genuine
context-isolated independence was achieved and the audit passed on its merits,
but the specific model brand used does not match the instructed Opus
4.8/GPT-5.6 Sol requirement (it is not Opus 4.6 either, so the explicit
prohibition was not violated). This is disclosed rather than silently omitted.
T085 (below) was dispatched correctly per the instructed model policy.

## Network-denial mechanism (T006; FR-018; SC-011)

Rank-1 mechanism selected and applied for all 11 gated derivation/probe
invocations: **`podman run --network none`** (client 5.8.5), pinned image
`docker.io/oven/bun:1.3.14`. Live-verified as genuinely blocking (an in-container
`fetch()` to an external host failed with a connection error), not merely
"no network calls happened to occur." Docker daemon was unavailable;
`/usr/bin/sandbox-exec (deny network*)` was probed and confirmed functional but
not selected (syscall-filter/allowlist-based, weaker than Podman's kernel
network-namespace isolation). Allowlist-only reliance was explicitly rejected.
`network-denial.json` sha256 `13b25fe1699ad986397817bcfd890b4d66dd2038f1bdfaeeb722d1666af6dd88`.

## Credential absence (T069; FR-018)

`capture.sh`'s `podman run` invocation never passes `-e`/`--env` for any host
variable — structurally, no credential is forwarded into any container. An
empirical probe run inside the same harness confirmed the container's actual
environment contains exactly 8 standard container/runtime variables and zero
credential/bearer-token-shaped names. `credential-absence.json` sha256
`788281b3510eb0704d72aafcf4efaee841501e053ea5febbfa125b36e95ebd6d`.

## Mutation baselines (T070; FR-019; SC-012)

All 11 gated invocations show `git status --porcelain=v1` byte-identical before
and after, for both the tracked repository and whichever scratch repository was
in scope. `mutation-baselines.json` sha256
`d71b94708d71006450ad838bd7513a69311136a6c42b5a9c5f360b7165732886`.

## Negative-test / trigger-class coverage (T071)

All 13 required `AtomicFailureRecord.triggerClass` values were genuinely
exercised through the full generator pipeline (not merely asserted); the 14th,
`"other-invalid-input"`, is a deliberately-empty, non-required backstop.
`trigger-class-coverage.json` sha256
`86c391e481934ca295bffa247ed59cad820eb9fa09842a55cb9e2d8ec0d4f328`.

## Independent audit (T085)

**Reviewer verdict: PASS, zero defects.** A fresh-context sub-agent (Claude
**Opus 4.8**, no prior authoring involvement) reviewed the complete evidence
bundle (`spike-009-evidence.{json,md}`) against every FR-001–FR-038,
SC-001–SC-014, and all eleven `contracts/*.md` files, checking: (a)
JSON↔Markdown internal consistency; (b) fixed no-go→go-explicit→blocked
precedence with no skipped/reordered step; (c) `drivingEvidence` non-empty and
naming real `EvidenceBundle` fields; (d) no `releaseVehicleDecision` (or
equivalent) ever non-null; (e) all three SC-013 disclaimers present and
correctly worded; (f) all 13 required trigger classes genuinely exercised; (g)
no fabricated/assumed evidence (8 claims spot-checked and traced to source,
including an independently recomputed reference-oracle sha256 match); (h)
`blocked` is honest, non-gamed fail-closed behavior; (i) no scope creep (no
`packages/adapters/catalog-*/**`, clean tracked git status, no adoption claim).
Two non-blocking, self-disclosed observations were noted (the T014a
model-brand deviation above; one Phase 7 synthetic fixture's internal
rejection label reading `invalid-yaml-syntax` for what is actually a
duplicate-YAML-key case — the fail-closed *outcome* itself is unambiguous and
correct) — both transparent disclosures, not hidden defects.
`t085-independent-audit.json` sha256
`ea9bee81d6cec012130c2502f2b90a0de256adcc8f747335ffa0a1556414b343`.

## Full evidence bundle (scratch-only; hashes recorded here for integrity)

`spike-009-evidence.json` sha256
`9221666f25034ca800ea3ae0f902cc302672b14931dfc7dca82e2dfb34e9b08b` · `spike-009-evidence.md`
sha256 `5076c754960681a1a2015a3ab3e9722ce89dfaf30b5d1fa83335ca698e8caee0` · `verdict.json` sha256
`5a01ad965fbd08b3f3ad1e365839d24ca53992b6865c0db0d6ddfed8782203ad`. These files, all raw
transcripts (`transcripts/*.{stdout,stderr,meta.json}`), corpus checkouts, and
scratch repositories are session-artifact-only per FR-019 and are **not** part
of this repository's tracked history.

## Frozen upstream commits and tool versions (T005–T013)

`backstage/backstage@1121a4facd9e321179d0402c3f355e4a649e84d9`,
`backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459`,
`redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1` — all
re-verified reachable via `git fetch --depth=1` + `git cat-file -e` (never
`ls-remote`/branch-HEAD substitution) before any work began. Toolchain: Bun
1.3.14, `yaml` 2.9.0, `picomatch` 4.0.5 (restricted positive-only dialect,
overlap-as-union).

## Limitations and scope

This spike is **non-shipping**: it introduces no `packages/adapters/catalog-*`
package, authorizes no production catalog adapter, and makes no release-vehicle
or version/tag decision. Its `blocked` verdict does not satisfy, cause, or
substitute for optional external/community validation or optional
externally-validated maturity (ADR-0014 rung 3), regardless of the recorded
outcome — Phase 6 remains exactly landed/reference-verified as before, rung 3
still open. Any future change to `spec.md`/`plan.md`/`tasks.md` that this
spike's findings might suggest is a separate, later, explicitly-scoped
follow-up decision — not something this execution performed or decided
unilaterally.
