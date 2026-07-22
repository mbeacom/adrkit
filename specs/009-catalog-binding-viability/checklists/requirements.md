# Specification Quality Checklist: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) beyond what is required to cite
      the exact existing adrkit core code paths (`packages/core/src/affects/**`) and exact
      pinned upstream file paths/values this spike measures against — cited as fixed research
      grounding and comparison targets, not as new implementation choices.
- [x] Focused on user value and business needs (a defensible go-explicit/blocked/no-go
      decision for a later production feature, without shipping code today, and without
      overstating that decision as optional externally-validated maturity)
- [x] Written for non-technical stakeholders where possible; technical citations are
      necessarily precise (exact commit SHAs, file paths, annotation values, descriptor
      counts) because the spike's entire value is falsifiable, reproducible evidence
- [x] All mandatory sections completed (User Scenarios & Testing, Requirements, Success
      Criteria, Assumptions)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (each FR maps to at least one acceptance
      scenario or Success Criterion)
- [x] Success criteria are measurable (SC-001–SC-014 each name a specific, checkable outcome)
- [x] Success criteria are technology-agnostic in outcome even where citations are
      necessarily specific (the *outcome* measured — e.g. "whole-operation atomic
      fail-closed" — is technology-agnostic; the *evidence* citing it is deliberately
      concrete per this spike's falsifiability goal)
- [x] All acceptance scenarios are defined (8 user stories, each with Given/When/Then
      scenarios)
- [x] Edge cases are identified (8 edge cases covering JSON shape errors, the brace/traversal
      near-miss now resolved by the restricted dialect, overlapping-but-distinct entities,
      empty-string-in-array vs. `explicit-empty`/`annotation-absent`, heuristic B applied to a
      never-read `Location` fixture, stale-corpus re-fetch drift, and manifest-vs-annotation
      repository-identity disagreement)
- [x] Scope is clearly bounded (Out of Scope section names 14 explicit exclusions; the
      satisfied governance preconditions, ADR-0014's phase-landing evidence ladder, and the
      two-decision Ratification Record bound what this document itself authorizes)
- [x] Dependencies and assumptions identified (11 assumptions, A1–A11, including the pinned
      commit re-verification requirement, the corrected exact descriptor counts, and the
      explicit note that the hardened decision controls wherever the two ratifications
      differ)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria (FR-001–FR-038 each
      cross-reference a user story, edge case, or success criterion)
- [x] User scenarios cover primary flows (Option A mechanics, repository-boundary/atomic
      fail-closed semantics, B/C non-authoritative measurement at both the real-corpus and
      synthetic-oracle level, D no-effect confirmation, structural edge cases including the
      not-followed `Location` case, determinism plus the required envelope/scale evidence,
      mechanical tamper/staleness/repository-isolation rejection, and the final
      spike-verdict-vs-optional externally-validated maturity distinction)
- [x] Feature meets measurable outcomes defined in Success Criteria (SC-001–SC-014 are each
      independently checkable against the evidence bundle FR-019/FR-022/FR-023/FR-034–FR-036
      describe)
- [x] No implementation details leak into specification beyond the necessary, deliberate
      citation of exact existing core file paths and exact pinned upstream file
      paths/values/counts that ground this spike's falsifiability

## Notes

- This spec's execution is now authorized by satisfied governance preconditions once this
  migration merges: Phase 6 is **landed / reference-verified** (ADR-0014 rungs 1–2, not
  external / community validation), maintainer scoping/contract ratification is satisfied
  (issue #25), ADR-0012 and ADR-0013 are accepted, and
  [ADR-0014](../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
  removes the previous external-actor hard gates. ADR-0007/ADR-0009 remain `proposed` with
  documented blockers; that is **not** an execution gate because requiring their acceptance
  first would be circular. The previous independent-adopter condition is replaced by the spike's own
  in-scratch **frozen, maintainer-authored reference oracle**, created and independently
  audited before generator output and covering positive, negative, overlap, absent/empty,
  collision, and repository-mismatch cases with bounded zero FP/FN. External-adopter evidence
  is optional externally-validated maturity evidence only. The
  banner and FR-030/SC-013 are written so that Phase 6 being landed / reference-verified does
  not let the spike claim credit for that landing or claim external/community adoption.
- The Ratification Record captures **two** dated maintainer decisions on adrkit issue #25: the
  initial 2026-07-21T21:30:41Z ratification and a materially stricter
  2026-07-21T21:40:53Z "Contract hardening decision" made "following adversarial review."
  Every requirement in this spec is written against the hardened (later) decision; Assumption
  A11 states this explicitly so a reader does not mistake the initial decision's text —
  preserved verbatim for provenance — for an alternative the spec's requirements could satisfy
  instead.
- All primary-source citations (Backstage `entity/ref.ts`, `location/annotation.ts`; the
  `community-plugins` and `rhdh-plugins` `catalog-info.yaml` samples, including the three-way
  `github.com/project-slug` mismatch and the exact 156/38 descriptor counts and 23/156,
  0/156 annotation-presence counts) were fetched directly from the pinned commits at
  spec-drafting time (2026-07-21) and independently cross-checked by a second, fresh-context
  adversarial reviewer who fetched the same raw content and GitHub API responses separately.
  That review also caught and corrected: an off-by-one in the `rhdh-plugins` descriptor count
  (39 → 38, due to a path-suffix false match), a fabricated dotfile-behavior divergence
  between the two existing core matchers (disproved by direct `picomatch` execution), an
  internal contradiction between per-entity and whole-operation failure semantics, and a
  Phase-6-landed timing contradiction in the original draft's gate/disclaimer wording — all
  are corrected in the current spec.md. Spike execution must still independently re-verify
  every citation per Assumption A2 rather than trust this spec's transcription.
- Items marked incomplete would require spec updates before `/speckit.clarify` or
  `/speckit.plan` — none are currently incomplete.
- A later resume round added **User Story 7** (mechanical malformed/tamper/stale/misidentified
  snapshot rejection and repository isolation via synthetic fixtures, FR-034–FR-038, SC-014)
  after a separate contract-challenge process flagged that the Evidence Gate's tamper/stale/
  repository-isolation items needed explicit spike-level test coverage, distinct from the
  adopter-oracle-dependent precision guarantee that remains exclusive to the hardened
  contract's optional externally-validated maturity (FR-025). The verdict story was renumbered to User
  Story 8 accordingly; all "User Stories 1–N" cross-references were updated to match. A
  second fresh-context adversarial pass against this expanded draft additionally caught and
  corrected: a false claim that repository-isolation contradicted single-repository-only
  generation (clarified as a consumer-side property across independently-valid envelopes,
  never a merged/federated snapshot); an underspecified tamper-digest mechanism (now scoped
  explicitly to accidental-corruption/naive-mutation detection, not adversarial
  cryptographic tamper-resistance, and computed over all security-relevant envelope fields,
  not just entities); an undefined alias/ref input source (now explicitly a
  synthetic-fixture-authored value mirroring the existing `CatalogSnapshotEntity.refs` field,
  never a claim about a real Backstage annotation); a nuance in ADR-0007's existing
  "resolved at runtime" language versus the hardened no-general-loader constraint (now
  explicitly distinguished, with reconciliation deferred at that time to the then-separate ADR
  gate — a framing later superseded first by the satisfied-precondition model and then by
  ADR-0014's removal of external-actor hard gates); an
  overclaim that two core matcher files have no code-level divergence (corrected to
  behavioral-parity-for-tested-cases only); a contradiction between Assumption A3 and FR-013
  over whether required synthetic structural fixtures could be replaced by a real corpus find
  (corrected to always-required, real examples supplement rather than replace); a
  single-run-across-two-repositories ambiguity in User Story 6 (corrected to separate,
  per-repository generation passes with per-pass determinism, aggregated only in the evidence
  bundle); and two stale acceptance-scenario cross-references left over from the User Story 7
  insertion. All are corrected in the current spec.md.
- A **third** fresh-context pass against that corrected draft found the corruption-only tamper
  check still insufficient against the hardened contract's literal "tampered snapshot
  rejection" language, plus six further issues, all now corrected: envelope digest/signature
  is upgraded from an unsigned, self-recomputable checksum to a real Ed25519 signature over an
  RFC-8785-canonicalized, SHA-256-hashed envelope (genuine tamper rejection, not merely
  corruption detection — Assumption A12 documents the spike-scoped, credential-free signing
  key); FR-034 was broadened from "malformed only" into full consumer-side envelope validation
  (wrong field types, unrecognized schema/dialect/capability, incomplete sources, and
  partial/identity-only artifact rejection, per the hardened contract's explicit
  "[p]roduction consumers reject partial/identity-only artifacts" line); FR-021 corrected an
  ADR misattribution ("resolved at runtime" is ADR-0007's language, not ADR-0009's) and an
  ADR-0007 boundary violation (a separate composition host, never `@adrkit/core` itself,
  performs adapter discovery); staleness was redefined from an undefined "older revision"
  ordering (opaque commit SHAs have none without separate ancestry data) to exact-inequality
  against a configured expected-current revision; FR-022/SC-001/SC-010 were corrected from an
  implied single cross-repository envelope to three explicit per-repository-pass envelopes;
  SC-012's `no-go` trigger and `go-explicit` bullet were corrected to state that the
  repository-isolation check's correct outcome is both envelopes remaining *accepted* with
  isolated query results, never a rejection, distinct from the four *rejection* checks; and
  "JSON or equivalent" envelope-format ambiguity was removed in favor of an exact JSON
  requirement. All are corrected in the current spec.md.
- A **fourth** fresh-context pass against the digest-and-signature version of that draft found
  the added Ed25519 signing mechanism introduced more problems than it solved — an unverifiable
  trust anchor for the shipped public key, a random-key input that broke the byte-identical
  determinism SC-001 requires, an ambiguous carve-out from the credential-free constraint, and
  an incomplete test that didn't actually isolate the signature's added value from the digest's.
  Rather than further elaborate a production-grade signing scheme inside a non-shipping
  scoping spike (itself a form of scope creep this feature's own Out of Scope section warns
  against), the signing mechanism was reverted: FR-035/User Story 7 now use an honestly-scoped,
  unsigned SHA-256 digest over an RFC-8785 canonicalization, explicitly described as proving
  accidental-corruption/naive-mutation detection only, with genuine cryptographic
  tamper-resistance left as an explicitly open, later, separately-scoped design question
  (the previously added Assumption A12 and all signature/keypair language were removed
  accordingly, restoring the assumption count to A1–A11). That same pass
  also caught a genuine bug independent of the signing question — FR-034 had wrongly implied an
  envelope is "identity-only" merely because its entities all happen to be `annotation-absent`,
  contradicting the hardened contract's own rule that absent annotations are a valid, expected
  state; FR-034 now determines partial/identity-only status solely from an explicit
  completeness flag, never by scanning entity ownership-state distribution — and a lingering
  CLI-import ambiguity in FR-021's composition-host wording (which briefly reintroduced "a
  later CLI subcommand" as a candidate importer, undermining its own "`@adrkit/cli` never
  imports adapters" claim two sentences earlier). All are corrected in the current spec.md.
- **PR #26 and PR #27 merged to `main` while this spec was in scoping.**
  [ADR-0012](../../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
  ("Bind catalog entities to owned paths with an explicit annotation," PR #26, merged at
  `54dbae8`) formally ratifies the hardened contract as `status: accepted` project law — it is
  now the citation of record for the contract itself throughout this spec, in place of the
  issue #25 comments (which remain, preserved verbatim, only as ADR-0012's own historical
  provenance).
  [ADR-0013](../../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
  ("Reconcile adapter isolation and catalog binding with the offline snapshot generator," PR
  #27, merged separately) amends ADR-0007's and ADR-0009's narrowed clauses by reference while
  **deliberately and explicitly holding both `status: proposed`**, per ADR-0012's own
  Governance section's "explicitly-blocked" branch, with a documented future acceptance path.
  This spec's historical second execution condition was, in that round, split into two sub-clauses in the banner,
  FR-027, and FR-032 (a framing later superseded by the next correction and then by ADR-0014 —
  the current spec has no independent-adopter pre-execution condition): the catalog-binding-ADR sub-clause
  was **satisfied** (ADR-0012 accepted), while the ADR-0007/ADR-0009 resolution sub-clause was
  then treated as unresolved (both `proposed`, deliberately, per ADR-0013) — and every place in
  this spec that previously described that second condition,
  ADR-0007/ADR-0009's status, or "the maintainer's ratification" as a single monolithic,
  entirely-unsatisfied item was updated (banner, Ratification Record, FR-021, FR-027, FR-028,
  FR-032, SC-013, Assumptions A6 and A9, and the Overview) and to
  never imply ADR-0007/ADR-0009's remaining blockers are cleared by ADR-0012's or ADR-0013's
  acceptance. No plan/tasks/code/commit/push/PR was created; only `spec.md` and this checklist
  were updated.
- A fresh-context review of this ADR-0012/0013 update caught three further issues, all
  corrected: FR-021 had partially reinstated a runtime-discovery composition-host pattern
  ADR-0013's "no dynamic runtime adapter/plugin loader" language forecloses for the catalog
  surface — rewritten so the catalog adapter is a directly-invoked standalone executable, never
  something a separate host dynamically discovers/imports; FR-032 had an "ADR-0007 and/or
  ADR-0009" ambiguity that could be read as clearing that second condition's sub-clause with only one of the
  two records resolved — corrected to require both, independently; and the review surfaced a
  circularity between this spec's own then-modeled second condition (requiring
  ADR-0007/ADR-0009 accepted before spike execution) and ADR-0013's acceptance path for those
  same ADRs (requiring this spike's own evidence first). That round recorded the tension in the
  Overview and banner as an open governance question for the maintainer — a framing **the next
  note supersedes**: the following round determined the tension was a mis-scoping (the
  acceptance requirement was never actually required by issue #25) and removed it entirely, so
  the current spec no longer records any open circular tension.
- **Maintainer resolved the recorded circularity directly: it was a mis-scoping, not an open
  question.** Issue #25's hardening decision named exactly two valid, complete resolutions for
  the catalog-binding ADR — "accepted/amended, **or** explicitly recorded as blocking before
  implementation" — and ADR-0013 took the second, documented one. Requiring ADR-0007/ADR-0009
  to additionally reach `accepted` before this spike could execute was therefore an
  over-reading never actually required by issue #25, and it was the sole source of the
  circularity the prior round recorded (since ADR-0013's own acceptance path for those two ADRs
  lists this spike's evidence as a precondition). Removing that over-reading dissolves the
  circularity without inventing any new governance fact: the catalog-governance precondition
  (ADR-0012's acceptance + ADR-0013's status-ambiguity resolution) is **fully satisfied**, not
  a "second condition with one unresolved sub-clause." This historical framing was later superseded by
ADR-0014's three-rung ladder. Worktree was re-synced to `main` at `48087e8`
  (fast-forward only; untracked spec/checklist/`.specify/feature.json` preserved) before this
  round. This spec's banner, Ratification Record, Overview ("No circular ADR gate" note),
  FR-019, FR-027, FR-028, FR-029, FR-032, SC-013, the Output Recommendation, and Assumptions A5,
  A6, and A9 were all rewritten to the resulting historical **two-gate model** (now superseded by ADR-0014): gate 1 was Phase 6
  T048-R/T049 landing and the second condition was independent-adopter annotation/oracle evidence. Under the
  current spec, Phase 6 is landed / reference-verified and the independent-adopter item is
  optional externally-validated maturity evidence only. ADR-0007/ADR-0009's own
  *eventual* acceptance or supersession remains real, separate, and non-gating — this spec
  never claims it has occurred or is required for this spike's execution, and continues to
  disclaim that neither ADR-0012's nor ADR-0013's acceptance clears ADR-0007/ADR-0009's own
  remaining blockers for production purposes. Maintainer scoping ratification (issue #25) was
  reconfirmed satisfied throughout and was never itself part of the circularity. A focused
  fresh-context review targeting circularity and current-`main` accuracy specifically was run
  after these edits; see the entry below for its findings and remediation. No plan/tasks/code/
  commit/push/PR was created at any point in this round — only `spec.md` and this checklist
  were touched, and `git status --porcelain` continues to show only
  `M .specify/feature.json` and the untracked `specs/009-catalog-binding-viability/` tree.
- **ADR-0014 migration superseded the historical two-gate model.** Phase 6 is now
  **landed / reference-verified** based on a maintainer-owned isolated reference repository,
  not external / community validation; the independent-adopter item is no longer a
  pre-execution gate and is replaced by the in-scratch frozen, maintainer-authored reference oracle.
  External-adopter evidence remains optional externally-validated maturity evidence only, and no
  009 task is marked complete by this documentation migration.
