# Contract: Evidence Bundle Schema and Verdict Decision Procedure

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-018, FR-019, FR-021,
FR-022(b), FR-023, FR-024, SC-007, SC-008, [ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md), and the Output Recommendation section's
non-binding-recommendation requirement. Companion to `data-model.md` §6
(`EvidenceBundle`), §7 (`Verdict`), §8 (`NonBindingRecommendation`).

## 1. Evidence Bundle Schema (FR-018)

The complete bundle is the two-file pair from `research.md` R4:
`spike-008-evidence.json` (machine-checkable manifest, matching
`data-model.md` §6's `EvidenceBundle` shape exactly, field for field) and
`spike-008-evidence.md` (human-readable narrative). Both live in the
executing session's own scratch artifacts directory
(`contracts/isolation-and-offline.md` §1) — never in this repository.

**The JSON manifest's top-level required fields, restated as a checklist a
future execution session can literally tick off**:

- [ ] `frozenReference` — populated only if `reverificationOutcome === "match"`
      (`contracts/upstream-target.md` §3); if `"mismatch"`, the bundle stops
      here and every field below is absent, not merely empty.
- [ ] `fixture` — the exact manifest values from `contracts/upstream-target.md` §2.
- [ ] `installTranscript`, `disableTranscript`, `removeTranscript` — per `contracts/lifecycle-evidence.md` §1.
- [ ] `registeredFiles` — direct on-disk inspection results, never CLI-message-only.
- [ ] `hookFireTranscript` — per `contracts/agent-verification.md` §2.
- [ ] `offlineSubprocessProof` — per `contracts/isolation-and-offline.md` §3.
- [ ] `mutationBaselines` — one per invocation category, per `contracts/isolation-and-offline.md` §2; every entry's `identical` field checked.
- [ ] `secondAgentRenderingCheck` — per `contracts/agent-verification.md` §3.
- [ ] `absentContextProbe`, `absentCliProbe` — per `contracts/fixture-surface.md` §3–§4.
- [ ] `networkDenial` — per `contracts/isolation-and-offline.md` §4.
- [ ] `verdict` — computed last, per §2 below.

A bundle missing any checked-required field above (when `frozenReference`
matched) is **incomplete** and MUST NOT have a `verdict` recorded against it
— FR-019's "no ambiguity about which evidence drove the choice" reading
applied structurally, matching `data-model.md`'s "Verdict is computed once,
at the end, from a fully-populated EvidenceBundle" relationship rule.

**Tracked sanitized evidence index for later landing (FR-024)**: this contract
keeps raw transcripts and scratch artifacts outside the repository, but an
executed spike cannot be landed in tracked history with only scratch-local
evidence. Landing requires a tracked, sanitized evidence index that points back
to the scratch bundle without copying raw transcripts. The index MUST include
commit SHAs, workflow-run links if any workflow is used, content hashes for the
scratch evidence files, tool versions, network and credential limits,
negative-test results (including fail-closed probes), and a reviewer verdict.
This is a future landing requirement only; the current scoped-but-unexecuted
spike has no such evidence to record yet.

> ✅ **Status update — Executed 2026-07-22.** The paragraph above describes this
> contract's applicability *before* execution and is retained as the historical
> scoping record; it no longer describes the current state. This landing requirement
> has since been satisfied: the tracked, sanitized index is
> [`../checklists/evidence-index.md`](../checklists/evidence-index.md), and the
> recorded verdict is **`no-go`** (mutation trigger). See
> [`../tasks.md`](../tasks.md)'s executed-summary banner for the authoritative,
> current status, including two explicit task exceptions (T005, T012) left unchecked
> per PR review.

## 2. Verdict Decision Procedure (SC-007) — Fixed Precedence, Exhaustive, Mutually Exclusive

Evaluate in **exactly** this order. Stop at the first rule that matches.

### Step 1 — Check `no-go` (dominates; checked first)

`outcome = "no-go"` if **any** of the following holds:

| Trigger | Evidence field checked |
|---|---|
| A mutation occurred | Any `MutationBaseline.identical === false` in `mutationBaselines` |
| The fixture could not be safely disabled or fully removed | Any row in `contracts/lifecycle-evidence.md` §3/§4's tables failed |
| A required failure-mode probe was unsafe | `absentContextProbe.isUnhandledCrash === true`, or `absentContextProbe.exitCode === 0`, OR the same fields on `absentCliProbe` |
| The live `after_plan` hook could not be fired at all | `hookFireTranscript` shows the hook crashing the agent session, corrupting repository state, or never surfacing in the rendered Mandatory Post-Execution Hooks section |

If `outcome = "no-go"`: set `noGoTrigger` to the specific trigger name
(`"mutation"` / `"disable-or-remove-failed"` / `"failure-probe-unsafe"` /
`"hook-never-fired"`); set `recommendation = null` (spec.md: "No production
Spec Kit integration is recommended at this time"); set `drivingEvidence` to
the specific field(s) that triggered it. **Stop. Do not evaluate Step 2 or
Step 3.** This is the one place SC-007 designates a single trigger as
sufficient regardless of every other field's value.

### Step 2 — Check `go` (checked second, only if Step 1 did not match)

`outcome = "go"` if **every** acceptance scenario in User Stories 1–4 passed
exactly as specified: install (US1, all 3 scenarios), real hook-fire with
genuine context and offline subprocess invocation (US2, all 4 scenarios),
zero mutation across every invocation (already implied by passing Step 1),
clean disable/remove (US3, scenarios 1–2), Copilot live rendering (US3,
scenario 3) AND second-agent structural rendering fully correct (US3,
scenario 4 — all four `*Correct` fields `true`), and both honest-failure
probes (US4, both scenarios).

If `outcome = "go"`: `recommendation` is required (non-null) — see §3 below.
`drivingEvidence` lists every `EvidenceBundle` field, since a `go` verdict is
by definition "everything passed." **Stop. Do not evaluate Step 3.**

### Step 3 — `manual-command-only` (exhaustive fallback; only if Steps 1–2 did not match)

By construction, reaching this step means no `no-go` trigger fired (Step 1)
but the result fell short of full `go` (Step 2) in some way that is not
itself unsafe. SC-007 names two minimum cases explicitly, and this contract
requires naming the actual shortfall, never leaving it implicit:

| Named case | Condition |
|---|---|
| (a) Command verified, hook mechanism unreliable | US1, US4, and Copilot rendering (US3 scenario 3) all passed, **but** `hookFireTranscript` shows the `after_plan` hook itself proved unreliable or context-starved (e.g. it fired but without genuine plan context) in a way a manually-invoked command would not inherit |
| (b) Second-agent rendering partial/failed | Everything else passed, but `secondAgentRenderingCheck` has at least one `*Correct` field `false` (partial or failed structural rendering) |
| (other) | Any other shortfall that is not itself unsafe — `manualCommandOnlyShortfall` MUST describe it in free text rather than force-fitting it into (a) or (b) |

Set `manualCommandOnlyShortfall` to exactly which case applied.
`recommendation` is required (non-null), scoped per §3 below to "manual
namespaced command only" and/or "only the agent(s) that rendered cleanly," as
SC-007's own text for this branch specifies.

## 3. Non-Binding Recommendation (FR-021; `data-model.md` §8)

**Required when `outcome` is `"go"` or `"manual-command-only"`. Forbidden
(`null`) when `outcome === "no-go"`.**

A `NonBindingRecommendation` MUST include:

- `bindingStatus: "non-binding"` — literal, always present, so the
  recommendation can never be read as an authorized task list.
- `minimalScopeDescription` — the smallest viable production scope this
  evidence supports. For `go`: "manual command + `after_plan` hook, wrapping
  an existing read-only `@adrkit/cli` command, rendered for at least Copilot
  and the second verified agent." For `manual-command-only`: "manual
  namespaced command only, no lifecycle hook, and/or scoped to only the
  agent(s) that rendered cleanly" (SC-007's own text for this branch).
- `releaseVehicleDecision: null` — **always**, unconditionally. This is the
  explicitly unresolved decision this recommendation must never make: *where*
  a future `packages/adapters/spec-kit` package would publish, ship, or live
  is a separate, later, maintainer decision this spike's evidence may inform
  but never decide (FR-021, Output Recommendation section). A future
  execution session that finds itself tempted to populate this field with an
  npm target, a repository location, or a version/tag has exceeded this
  spike's authorized scope and must stop and re-scope rather than proceed.

## 4. Phase 6 Maturity Claim (SC-008; FR-023)

Every `Verdict`, regardless of `outcome`, carries `phase6ExternalValidationClaim: false`
as a fixed literal (`data-model.md` §7). The evidence bundle's narrative file
(`spike-008-evidence.md`) MUST additionally restate, in prose, that Phase 6
(`specs/007-arb-queue/`) is landed / reference-verified under ADR-0014 rungs 1–2,
not externally validated; that external / community validation (ADR-0014 rung 3)
remains absent unless separately evidenced; and that this spike did not cause or
advance Phase 6's status. A `go` verdict does not and cannot create rung-3 evidence;
the spike verdict and Phase 6 maturity label are independent facts about the repository.

## 5. Cross-Reference Requirement (FR-019)

`Verdict.drivingEvidence` MUST list, by exact field name from
`EvidenceBundle` (`data-model.md` §6), every field that determined the
outcome. A verdict recorded with an empty `drivingEvidence` array is invalid
under this contract regardless of what prose elsewhere in
`spike-008-evidence.md` claims — the cross-reference is a structural
requirement of the bundle, not merely a stylistic preference for the
narrative.
