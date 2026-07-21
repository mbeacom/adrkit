# Data Model: Spec Kit Hook Compatibility Viability Spike

**Feature**: `008-spec-kit-hook-viability` | **Companion to**: [plan.md](./plan.md), [research.md](./research.md)

> **This is not production ADR data.** Every entity below describes the
> spike's own disposable fixture, its evidence bundle, and its verdict — not
> a change to `AdrFrontmatter`, `schema/adr.schema.json`, or any other part of
> the ADR schema contract (Principle V). Nothing here is written to
> `docs/adr/**`. These shapes exist solely to make the evidence bundle
> mechanically checkable rather than free prose.

## 1. FrozenUpstreamReference — Entity

The single, immutable identification of the Spec Kit version this spike
targets (spec.md Key Entities; FR-001; A1).

| Field | Type | Notes |
|---|---|---|
| `releaseTag` | `string` (literal) | Fixed: `"v0.13.0"`. Never reselected. |
| `commitSha` | `string` (literal, 40 hex chars) | Fixed: `"9a30db484b0876cb7e5a391cf735d59bd968e985"`. |
| `tagObjectSha` | `string` (literal, 40 hex chars) | Fixed: `"7c95192e6b1a164f5294cc9f2e3851b28d3ba171"` — the annotated tag object, distinct from `commitSha` (A1). |
| `reportedCliVersion` | `string` (literal) | Fixed: `"0.13.0"` — expected `specify --version` output. |
| `reverifiedAt` | `string` (ISO 8601 date) | Filled in at execution time: the date the re-verification in FR-001 was actually performed. Never the spec-writing date. |
| `reverificationOutcome` | `"match"` \| `"mismatch"` | If `"mismatch"`, FR-001's fail-closed rule applies: halt, do not proceed, require spec re-ratification. No other field in this data model is populated if this is `"mismatch"`. |

**Validation rule**: `reverificationOutcome` MUST be computed by checking, in
this order: (a) does `git ls-remote --tags` (or equivalent) for
`github/spec-kit` show `refs/tags/v0.13.0` resolving to `commitSha`; (b) does
the installed `specify --version` report exactly `reportedCliVersion`. Both
must hold for `"match"`; either failing yields `"mismatch"`.

## 2. CompatibilityFixture — Entity

The minimal, disposable, manifest-v1 extension created solely for this spike
(spec.md Key Entities; FR-002–FR-004; A3–A5, A7). Design-time content is
fully fixed by `contracts/upstream-target.md` and `contracts/fixture-surface.md`;
this entity records only its identifying metadata.

| Field | Type | Notes |
|---|---|---|
| `extensionId` | `string` (literal) | Fixed: `"adrkit-spike"` (research.md R2). |
| `manifestSchemaVersion` | `string` (literal) | Fixed: `"1.0"`. |
| `extensionVersion` | `string` (literal, semver) | Fixed: `"0.0.1"` — a throwaway version; never bumped, never published. |
| `commandName` | `string` (literal) | Fixed: `"speckit.adrkit-spike.probe"`, matching pattern `^speckit\.[a-z0-9-]+\.[a-z0-9-]+$`. |
| `wrappedAdrCliCommand` | `string` (literal) | Fixed: `"queue --format json"` (research.md R2) — the exact argument vector passed to the built `adr` CLI subprocess. |
| `hookEvent` | `string` (literal) | Fixed: `"after_plan"`. |
| `hookOptional` | `boolean` (literal) | Fixed: `true`. Never `false` (FR-004). |
| `installSourcePath` | `string` | The local filesystem path passed to `specify extension add --dev <path>` at execution time — a scratch-workspace path (research.md R3), never a URL, never a catalog name. |

**Validation rules**: `commandName` MUST match
`^speckit\.adrkit-spike\.[a-z0-9-]+$` exactly (the extension-id segment is
fixed, not a free variable, for this spike). Exactly one entry may exist in
`provides.commands` and exactly one event key may exist in `hooks` — a
manifest with more than one of either is not this fixture and invalidates the
spike's single-command/single-hook premise (FR-003/FR-004).

## 3. ScratchWorkspace — Entity

The disposable environment the fixture and its exercising `/speckit.plan` run
live in (research.md R3; FR-017; A8).

| Field | Type | Notes |
|---|---|---|
| `kind` | `"fixture-source"` \| `"scratch-project"` | Distinguishes the fixture's own source directory from the initialized `specify init`-project it is installed into for verification. May be the same physical directory for the `--dev` install case. |
| `path` | `string` | Absolute path, outside any git-tracked clone of `mbeacom/adrkit`. |
| `isTrackedByThisRepo` | `boolean` (literal) | MUST be `false` for every `ScratchWorkspace` instance this spike creates — a `true` value here is itself a spike defect, never a valid state. |
| `scratchFeatureDirectory` | `string` \| `null` | For the `scratch-project` kind used in User Story 2's live `/speckit.plan` run: the path to the scratch feature directory created for that one run. `null` for the `fixture-source` kind. |

## 4. NetworkDenialRecord — Entity

Records which mechanism from research.md R8's ranked hierarchy was actually
available and used, and its honest limitations (Edge Cases note in spec.md).

| Field | Type | Notes |
|---|---|---|
| `mechanismUsed` | `"os-namespace-or-firewall"` \| `"process-level-egress-block"` \| `"allowlisted-env-plus-static-review"` | Exactly one of research.md R8's three ranked tiers. |
| `limitationsStatement` | `string` | Required, non-empty. For tier 3, MUST include the exact honest-limitation language from research.md R8 ("does not *prove* the absence of a network call... established that no credential or endpoint is configured..."). |
| `appliedToInvocations` | `string[]` | Which of the seven FR-018 evidence-bundle invocation categories this mechanism covered. Empty array is invalid — this record exists precisely because it must apply somewhere. |

## 5. MutationBaseline — Entity

One before/after pair, captured per research.md R5/R7, for a single fixture
invocation.

| Field | Type | Notes |
|---|---|---|
| `invocationLabel` | `string` | Human-readable identifier, e.g. `"install"`, `"hook-fire"`, `"disable"`, `"remove"`, `"probe-absent-context"`, `"probe-absent-cli"`, `"manual-invoke"`. |
| `gitTreeRoot` | `"scratch-project"` \| `"this-repository"` | Which git tree the status/diff was captured against (research.md R7 — only `"hook-fire"` uses `"this-repository"`). |
| `statusBefore` | `string` | Raw `git status --porcelain=v1` output, captured immediately before the invocation. |
| `statusAfter` | `string` | Raw `git status --porcelain=v1` output, captured immediately after. |
| `adrDiffStatBefore` | `string` \| `null` | `git diff --stat -- docs/adr` output, captured immediately before. Present only when `gitTreeRoot` is `"this-repository"`. |
| `adrDiffStatAfter` | `string` \| `null` | Same, captured immediately after. |
| `identical` | `boolean` | Computed: `statusBefore === statusAfter` and (if present) `adrDiffStatBefore === adrDiffStatAfter`. A `false` value here is an SC-003 failure and triggers the `no-go` verdict path. |

## 6. EvidenceBundle — Entity

The complete, cross-referenced record the spike produces (spec.md Key
Entities; FR-018). This is the spike's actual deliverable — the fixture
itself is disposable.

| Field | Type | Notes |
|---|---|---|
| `frozenReference` | `FrozenUpstreamReference` | §1. |
| `fixture` | `CompatibilityFixture` | §2. |
| `installTranscript` | `LifecycleTranscript` | See `contracts/lifecycle-evidence.md` for the shape; covers FR-005/FR-006. |
| `registeredFiles` | `string[]` | Absolute or repo-relative paths actually found on disk after install — never merely the CLI's own reported success message (Edge Cases note on partial-install defects). Covers FR-007/FR-008. |
| `hookFireTranscript` | `HookFireTranscript` | See `contracts/agent-verification.md`; covers FR-009/FR-010. |
| `offlineSubprocessProof` | `SubprocessInvocation` | The nested capture (research.md R5) of the fixture command's call into the built `adr` CLI. Covers FR-011. |
| `mutationBaselines` | `MutationBaseline[]` | §5, one per invocation category. Covers FR-012/SC-003. |
| `disableTranscript` | `LifecycleTranscript` | Covers FR-013. |
| `removeTranscript` | `LifecycleTranscript` | Covers FR-014. |
| `secondAgentRenderingCheck` | `AgentRenderingCheck` | See `contracts/agent-verification.md`. Covers FR-008/SC-005. |
| `absentContextProbe` | `FailureProbeResult` | Covers FR-015. |
| `absentCliProbe` | `FailureProbeResult` | Covers FR-016. |
| `networkDenial` | `NetworkDenialRecord` | §4. |
| `verdict` | `Verdict` | §7. Computed last, from every field above. |

**Cross-referencing rule (FR-019)**: `verdict.drivingEvidence` (§7) MUST list,
by field name from this table, every `EvidenceBundle` field that determined
the verdict — a verdict recorded without at least one entry in
`drivingEvidence` is invalid per this data model, independent of prose
narrative elsewhere in the bundle.

## 7. Verdict — Entity

Exactly one of three enumerated outcomes (spec.md Key Entities; SC-007), with
a fixed precedence rule this data model encodes structurally rather than
leaving to prose.

| Field | Type | Notes |
|---|---|---|
| `outcome` | `"no-go"` \| `"go"` \| `"manual-command-only"` | Exactly one value; the three are exhaustive and mutually exclusive by SC-007's own precedence rule. |
| `precedenceEvaluationOrder` | `["no-go", "go", "manual-command-only"]` (fixed literal array) | Documents, not merely asserts, the order SC-007 fixes: `no-go` is checked first and dominates; `go` is checked second; `manual-command-only` is the exhaustive fallback. |
| `drivingEvidence` | `string[]` | Non-empty. Field names from `EvidenceBundle` (§6) that determined `outcome`, per the cross-referencing rule above. |
| `noGoTrigger` | `string` \| `null` | If `outcome === "no-go"`: which specific trigger fired — one of `"mutation"`, `"disable-or-remove-failed"`, `"failure-probe-unsafe"`, `"hook-never-fired"`. `null` otherwise. |
| `manualCommandOnlyShortfall` | `string` \| `null` | If `outcome === "manual-command-only"`: which specific, non-unsafe shortfall caused the fallback — at minimum one of the two named cases in SC-007 (`"hook-unreliable-or-context-starved"`, `"second-agent-rendering-partial-or-failed"`) or a free-text description of another non-unsafe shortfall SC-007's "any other" clause covers. `null` otherwise. |
| `recommendation` | `NonBindingRecommendation` \| `null` | Required (non-null) when `outcome` is `"go"` or `"manual-command-only"` (FR-019/spec.md Output Recommendation section); MUST be `null` when `outcome === "no-go"` — a `no-go` verdict recommends nothing (spec.md: "No production Spec Kit integration is recommended at this time"). See `contracts/evidence-bundle-and-verdict.md`. |
| `phase6LandedClaim` | `false` (fixed literal) | SC-008: every verdict, regardless of `outcome`, explicitly states Phase 6 is not landed. This field is a literal `false` precisely so no future edit can silently flip it. |

**Validation rules** (structural encoding of SC-007's precedence, restated
from `contracts/evidence-bundle-and-verdict.md` for entity-level completeness):

1. If any `MutationBaseline.identical === false`, OR `disableTranscript`/
   `removeTranscript` show a failure, OR `absentContextProbe`/
   `absentCliProbe` show an unsafe result (exit `0`, or an unhandled crash
   rather than a specific message), OR `hookFireTranscript` shows the hook
   never firing/crashing the session/corrupting state — THEN
   `outcome` MUST be `"no-go"`, regardless of how every other field looks.
2. Else, if every acceptance scenario in User Stories 1–4 passed exactly as
   specified — THEN `outcome` MUST be `"go"`.
3. Else — THEN `outcome` MUST be `"manual-command-only"`. This branch is
   exhaustive: it is not possible for a well-formed `EvidenceBundle` to reach
   this point and fail all three rules.

## 8. NonBindingRecommendation — Entity

The "smallest later production slice" note (spec.md Output Recommendation
section; FR-021).

| Field | Type | Notes |
|---|---|---|
| `bindingStatus` | `"non-binding"` (fixed literal) | Present precisely so this cannot be mistaken for an authorized task list. |
| `minimalScopeDescription` | `string` | Free text, e.g. "manual namespaced command only, no lifecycle hook, wrapping `adr queue --format json`, rendered for GitHub Copilot only." |
| `releaseVehicleDecision` | `null` (fixed literal) | **MUST always be `null`.** This field exists in the schema specifically to make explicit, by its permanently-null type, that this entity never decides the production package's publish target, location, or ship timeline (FR-021). Any future code or document that would populate this field with a non-null value is out of this spike's scope by construction. |

## 9. Supporting Transcript/Check Shapes (referenced above, defined in `contracts/`)

These five shapes are referenced by `EvidenceBundle` (§6) above but their full
field-level contracts live in the named `contracts/*.md` file, to avoid
duplicating a contract's normative text in this data model:

- `LifecycleTranscript` — `contracts/lifecycle-evidence.md`
- `HookFireTranscript` — `contracts/agent-verification.md`
- `SubprocessInvocation` — `contracts/isolation-and-offline.md`
- `AgentRenderingCheck` — `contracts/agent-verification.md`
- `FailureProbeResult` — `contracts/fixture-surface.md`

## 10. Entity Relationship Summary

```text
FrozenUpstreamReference ──┐
CompatibilityFixture ─────┤
ScratchWorkspace ──────────┼──▶ EvidenceBundle ──▶ Verdict ──▶ NonBindingRecommendation
NetworkDenialRecord ───────┤        (or null, if outcome === "no-go")
MutationBaseline[] ────────┘
   (LifecycleTranscript, HookFireTranscript, SubprocessInvocation,
    AgentRenderingCheck, FailureProbeResult nest inside EvidenceBundle
    per §6's field table)
```

Every arrow is a "feeds into, never mutates" relationship: `Verdict` is
computed once, at the end, from a fully-populated `EvidenceBundle`, and
`EvidenceBundle` itself is never partially written back to — a future
execution session either completes an invocation's evidence fully or the
bundle is incomplete and no verdict may be recorded (FR-019's "no ambiguity
about which evidence drove the choice" reading applied structurally).
