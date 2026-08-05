# Specification Quality Checklist: Backstage Catalog Adapter — Offline Owned-Paths Snapshot Generator

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### The one item deliberately left unchecked

**"No [NEEDS CLARIFICATION] markers remain" does not pass, and must not be forced to pass.**
Three markers remain, recorded under the spec's *Open questions* heading. All three are gaps at
the **ADR level**, not drafting omissions: each was traced to the point where the normative
records stop short, and each is quoted against the record that declines to decide it.

| # | Question | Why it is unresolvable from the ADRs |
|---|---|---|
| 1 | Which package owns consumer-side envelope validation and `CatalogSnapshot` derivation? | ADR-0020 clause 7 places it outside the adapter ("the generator writes the envelope and nothing else"); ADR-0007 and Constitution Principle III place it outside `packages/core` and `packages/cli`; ADR-0012 and FR-005 forbid the envelope entering any published schema. No record names the remaining home. |
| 2 | How, if at all, is `allRefs` populated beyond the primary `canonicalId` in production? | Spike 009's `entity-identity.md` §2 sourced aliases from synthetic fixtures only and explicitly deferred the production mechanism as "an explicitly separate, later, out-of-scope design decision this contract does not make." No ADR makes it either. |
| 3 | What constitutes the "release evidence" component of ADR-0012 gate 4? | Gate 4 reads "clean-clone / offline / adapter-boundary / **release** evidence passing," but ADR-0020 clause 9 defers the release vehicle (publish target, tag, channel) to a later record. The first three components are specifiable now; the fourth has no decidable referent. |

Resolving these by guess would violate the specification's own binding honesty rules (and
ADR-0012's "production limits are **not** guessed now; they must be ratified from evidence").
They are therefore **carried forward for a maintainer decision**, which is the correct disposition
for an ADR-level gap, rather than closed by invention. Items 1 and 3 should be settled before the
planning phase, since item 1 is load-bearing for FR-044 through FR-048.

### Validation notes for the checked items

- **Implementation details.** The spec names pinned external artifacts — `picomatch` with frozen
  options, the Backstage validator commit `1121a4facd9e321179d0402c3f355e4a649e84d9`, SHA-256 —
  as *frozen contract terms* inherited from ADR-0012, ADR-0015 and the 009 contracts, not as
  design choices being made here. Under this repository's conventions a frozen, ratified
  dependency pin is a requirement, not an implementation leak. No internal module layout,
  function signature, or code structure is prescribed.
- **Testability.** Every functional requirement is stated as an observable input/output or
  abort condition. Requirements imposing process obligations (FR-052 through FR-062) are
  verifiable against recorded artifacts — frozen hashes, audit findings, observed-failing
  records — as ADR-0016 requires.
- **Traceability.** Every requirement cites its normative source. Requirements derived rather
  than quoted are marked as derived and carry the clause they are derived from.
- **Counts.** All quantities in the spec were counted in the cited source and the source is named
  at the point of use. In particular the fatal trigger enumeration is **fifteen** for this
  feature: the fourteen that `atomic-fail-closed.md` §4 requires ("MUST be one of exactly these
  fourteen values"), **plus** `inadmissible-descriptor`, which ADR-0015 adds and which appears
  nowhere under `specs/009-catalog-binding-viability/`. FR-035 states explicitly that fourteen is
  correct for spike 009 and wrong for feature 010, and cites **ADR-0015's Condition of Acceptance
  2** — binding "on any work that cites this record" — as the direct authority, this feature being
  the follow-up that condition names. ADR-0020's separate "13 required trigger classes" figure is
  deliberately never cross-mixed with the fourteen- and fifteen-value enumerations. Other counted
  quantities: fifteen ordered glob rules; five consumer validation steps; four ADR-0012 production
  gates; sixteen placeholder descriptors in three distinct forms; the corpus file and document
  counts.
- **Verified during review.** All ten relative document links resolve. The ADR-0015 validator
  table transcribed into FR-016 is byte-identical to ADR-0015 lines 120–123. FR numbering is
  contiguous FR-001…FR-062, SC numbering contiguous SC-001…SC-017, and every internal `FR-`/`SC-`
  cross-reference falls in range. A targeted sweep found no claim about Backstage-as-a-running-system,
  no release-authorization language, and no ADR-0014 rung 2 or rung 3 claim.
- **Known correction made during review.** SC-007 originally required every one of the fifteen
  glob rules to be exercised by a violating pattern. Rule 15's `invalid-glob-compile-failure` is
  described by its own contract as a defensive backstop "expected to never occur in practice,"
  so that criterion was unsatisfiable as written; it now requires rules 1–14 to be exercised by
  violating patterns and rule 15's `accepted` outcome by valid ones, and explicitly states that a
  run never producing `invalid-glob-compile-failure` is conformant.
- **Second correction, applied after maintainer review.** The `inadmissible-descriptor`
  requirements were strengthened and two requirements added, on the authority of ADR-0015's
  Condition of Acceptance 2 read in full:
  - **FR-018** now states the consequence explicitly — abort, non-zero status, no usable partial
    output, *identical to every other fatal trigger* — and quotes ADR-0015's "adds a failure
    *class*; it removes no failure."
  - **FR-019 (new)** requires that no inadmissible descriptor participate in a uniqueness
    comparison, per ADR-0015's "Ordering" section.
  - **FR-020** now requires **all three** record fields. ADR-0015's "Failure semantics" section
    names the offending path, the failing field, **and the validator that rejected it** — three
    items, where a two-item paraphrase would have dropped the validator.
  - **FR-021 (new)** forbids treating duplicate detection as a proxy for validity, and requires
    conformance evidence to include a descriptor that is inadmissible **and** canonically unique.
    ADR-0015 records that `bulk-import` and `orchestrator` in `rhdh-plugins` "canonicalize
    distinctly" and so "collide with nothing," yet "are exactly as invalid as the other fourteen";
    it concludes "[d]uplicate detection is not a validity check."

  Because the repository uses letter suffixes for tasks (`T014a`) but never for functional
  requirements, the two additions were absorbed by renumbering rather than by inventing an
  `FR-018a` convention: former FR-019 became FR-020, and former FR-020…FR-060 became
  FR-022…FR-062. The rewrite was applied by script across definitions and prose references
  together, then re-verified — numbering is contiguous FR-001…FR-062, no suffixed or sentinel
  identifiers survive, and every internal reference resolves in range.

### Scope reminder for downstream phases

This specification is authorized by ADR-0020 toward **ADR-0014 rung 1 only**. It authorizes the
work, not the release. Planning and task generation must preserve that boundary, must not schedule
a release, and must not begin generator output before the fresh T014 → T014a oracle cycle
(ADR-0020 clause 6) and the clause 5(a) freeze/audit have both completed.
