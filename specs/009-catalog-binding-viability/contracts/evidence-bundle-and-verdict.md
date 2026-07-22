# Contract: Evidence Bundle Completeness, Verdict Decision Procedure, and the Authoritative-`go` Distinction

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-019, FR-024
through FR-032, User Story 8 (all 3 acceptance scenarios), SC-012, SC-013.
Companion to `data-model.md` §22 (`EvidenceBundle`), §23 (`Verdict`), §24
(`NonBindingRecommendation`), `research.md` R12. Normative source: the
Ratification Record's Evidence Gate; ADR-0013's "Acceptance path for
ADR-0007 and ADR-0009."

## 1. Evidence Bundle Completeness (FR-019)

The bundle is scratch/untracked output only (`research.md` R2/R3). A bundle
missing any of the 16 required top-level `EvidenceBundle` fields
(`data-model.md` §22) — when every upstream gate/re-verification step
succeeded — is **incomplete** and MUST NOT have a `verdict` recorded against
it, mirroring `specs/008-spec-kit-hook-viability/contracts/evidence-bundle-and-verdict.md`
§1's identical completeness rule for this project's sibling spike. If the
verdict, together with this spec's two remaining execution gates having
already cleared, jointly justify incorporating a summary into a tracked
document, that incorporation happens through its own explicitly-scoped,
separately-authorized subsequent PR — never as a side effect of running this
spike.

## 2. Verdict Decision Procedure — Fixed Precedence (SC-012)

Evaluate in **exactly** this order. Stop at the first rule that matches.

### Step 1 — Check `no-go` (dominates; checked first)

`outcome = "no-go"` if **any** of the following holds:

| Trigger | Evidence field checked |
|---|---|
| A tracked-file mutation occurred | Any `MutationBaseline.identical === false` |
| Network/credentialed/live-API access occurred during a derivation run | `NetworkDenialRecord` shows a violation, or FR-018/SC-011 was otherwise not upheld |
| Whole-operation atomicity did not hold in some tested case | Any `AtomicFailureRecord` scenario produced a partial/usable snapshot |
| Repository-mismatch abort did not hold | Any `RepositoryIdentityCheck` mismatch case failed to abort before path derivation |
| Any invalid-pattern or invalid-shape class was silently accepted | Any `RestrictedGlobPattern`/`OwnedPathsAnnotation` invalid case reached `"accepted"`/valid ownership state |
| Any malformed/tampered/stale/misidentified-repository envelope check failed to reject an envelope that should have been rejected | Any of `envelopeRejectionResults`'s four cases accepted a case it should have rejected |
| The repository-isolation check itself failed | `RepositoryIsolationCheck.outcome === "leaked"`, or either independently-valid envelope in that test was incorrectly rejected |
| Option A's output could not be made byte-identical across repeated runs within a single-repository pass | Any pass's 3+ repeated runs produced non-identical output |

If `outcome = "no-go"`: set `noGoTrigger` to the specific trigger name (see
`data-model.md` §23's closed enumeration); set `recommendation = null` ("no
production catalog adapter is recommended at this time"); set
`drivingEvidence` to the specific field(s) that triggered it. **Stop. Do not
evaluate Step 2 or Step 3.** No-go dominates regardless of how well any
other scenario performed — the underlying finding is recorded so a future
re-attempt does not repeat the same failure blind.

### Step 2 — Check `go-explicit` (checked second, only if Step 1 did not match)

`outcome = "go-explicit"` if **every** acceptance scenario in User Stories
1–7 passed exactly as specified: deterministic parsing/validation/
canonicalization; whole-operation atomic fail-closed behavior;
repository-boundary enforcement; the `explicit-paths`/`explicit-empty`/
`annotation-absent` distinction; B/C measured and correctly labeled at both
the real-corpus and synthetic levels; D's no-effect confirmed with the
precise returned shape; all three required synthetic structural fixtures
resolved unambiguously; the dotfile policy confirmed as already-correct
`picomatch` behavior; per-pass determinism proven with the envelope and
scale evidence both actually produced for each pass; and
malformed/tampered/stale/misidentified-envelope rejection plus repository
isolation mechanically demonstrated.

If `outcome = "go-explicit"`: `recommendation` is required (non-null) — see
§4 below. `drivingEvidence` lists every `EvidenceBundle` field, since a
`go-explicit` verdict is by definition "everything passed." **Stop. Do not
evaluate Step 3.**

### Step 3 — `blocked` (exhaustive fallback; only if Steps 1–2 did not match)

By construction, reaching this step means no `no-go` trigger fired but the
result fell short of full `go-explicit` in some way that is **not itself
unsafe**. Minimum named cases (never exhaustive in prose, but every
occurrence MUST name the specific shortfall, never leaving it implicit):

| Named case | Condition |
|---|---|
| Synthetic precision comparison incomplete | The B/C precision comparison (`contracts/comparison-heuristics.md` §3) could not be completed |
| Structural fixture ambiguous | Any of the three required synthetic structural fixtures produced an ambiguous, rather than a clean, outcome |
| Envelope/scale evidence incomplete | The envelope or scale-evidence record could not be fully populated from an actual run for any pass |
| Default-namespace canonicalization unverified | The default-namespace case (User Story 1, Acceptance Scenario 4) could not be verified |
| (other) | Any other non-unsafe shortfall — `blockedShortfall` describes it in free text rather than force-fitting it into a named case above |

No production recommendation is made beyond naming what would need to be
resolved first (`recommendation = null`).

## 3. Neither Verdict Is the Hardened Contract's "Authoritative `go`" (FR-025, FR-029; SC-012)

**None of the three verdicts is, or is described as, the hardened contract's
separate "authoritative `go`" status.** That status additionally requires
the independent-adopter oracle (FR-025) and is never reachable from this
spike's own evidence alone, regardless of which verdict is recorded. This
spike CAN and MUST mechanically demonstrate malformed/tampered/stale/
misidentified snapshot rejection and repository isolation using its own
synthetic fixtures (FR-034–FR-038, `contracts/snapshot-envelope.md`) — these
are offline, generator/consumer-boundary properties requiring no adopter.
What this spike explicitly **cannot** itself produce, and what remains
exclusive to the authoritative `go` status, is an independent adopter's
hand-labeled entity/path oracle and the zero-false-positive/negative
precision guarantee over real, adopter-authored annotations that only that
oracle can establish. `Verdict.authoritativeGoDistinctionStatement`
(`data-model.md` §23) MUST be present, verbatim in substance, on **every**
verdict this spike ever records — not conditioned on `outcome`.

## 4. Non-Binding Recommendation (FR-026)

**Required when `outcome === "go-explicit"`. Forbidden (`null`) otherwise.**
A `NonBindingRecommendation` (`data-model.md` §24) MUST include:

- `bindingStatus: "non-binding"` — literal, always present.
- `minimalScopeDescription` — the smallest viable production scope this
  evidence supports, e.g. "an offline generator that reads a vendored or
  locally-cloned catalog checkout via one explicit local input manifest,
  derives `CatalogSnapshotEntity.paths` from `adrkit.io/owned-paths` alone,
  enforces whole-operation atomicity and single-repository binding, and
  writes only the versioned envelope — never a `CatalogSnapshot`-shaped
  artifact directly."
- `releaseVehicleDecision: null` — **always**, unconditionally. This is the
  explicitly unresolved decision this recommendation must never make: where
  a future `packages/adapters/catalog-backstage` package would publish,
  ship, or live is a separate, later, maintainer decision this spike's
  evidence may inform but never decide.
- `authoritativeGoDisclaimer` — states explicitly that this recommendation,
  even under `go-explicit`, does not itself satisfy the independent-adopter
  gate or the hardened contract's "authoritative `go`" status.
- `productionAuthorizationClaimed: false` — a positively-named flag whose
  literal `false` reads plainly as "no production authorization is claimed."
  (Renamed from the earlier inverted `noProductionAuthorizationClaim: false`,
  which double-negated its own meaning.) This recommendation MUST NOT
  authorize or schedule a `packages/adapters/catalog-backstage`
  implementation.

## 5. The Required Disclaimers — Present on Every Verdict, Regardless of Outcome (SC-013; FR-028–FR-030)

Every recorded verdict, unconditionally, MUST state:

1. **(FR-030) Phase 6 credit-taking disclaimer**: this spike's own technical
   result does not itself satisfy, substitute for, or take credit for Phase 6
   (`specs/007-arb-queue/`) landing, and MUST NOT assert its own verdict
   caused or constitutes that landing. This is distinct from, and MUST NOT
   be read as requiring the spike to falsely claim, that Phase 6 remains
   permanently unlanded — by the time execution gate 1 clears,
   `specs/007-arb-queue/tasks.md` T049 will itself have updated `plan.md`'s
   Phase 6 row to `landed`, and this disclaimer is written to remain true
   after that update, not to contradict it.
2. **(FR-028) Governance credit-taking disclaimer**: this spike's output
   MUST NOT claim or take credit for ADR-0012's acceptance or for ADR-0013's
   resolution of ADR-0007/ADR-0009's status ambiguity — both are present
   facts (`54dbae8` PR #26; `48087e8` PR #27) that occurred entirely
   independently of this spike's own execution or verdict. The spike's
   output may accurately cite them but must not frame either as something
   the spike itself achieved.
3. **(FR-029) Independent-adopter gate disclaimer**: this spike's output
   MUST NOT claim or imply that its own verdict constitutes, causes, or
   substitutes for the independent-adopter gate or the hardened contract's
   "authoritative `go`" status, regardless of which verdict is recorded.

`Verdict.gateDisclaimers` (`data-model.md` §23) is a fixed literal
`{ phase6NotCausedByThisSpike: true, independentAdopterGateNotCausedByThisSpike:
true, governancePreconditionsAlreadySatisfiedIndependently: true }` present
unconditionally on every verdict — never contingent on `outcome`.

## 6. Cross-Reference Requirement (User Story 8's Independent Test)

`Verdict.drivingEvidence` MUST list, by exact field name from
`EvidenceBundle` (`data-model.md` §22), every field that determined the
outcome. A verdict recorded with an empty `drivingEvidence` array is invalid
under this contract regardless of what prose elsewhere in
`spike-009-evidence.md` claims.
