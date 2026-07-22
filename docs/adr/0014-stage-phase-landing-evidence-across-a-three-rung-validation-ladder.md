---
schemaVersion: 0.1.0
id: "0014"
title: Stage phase-landing evidence across a three-rung validation ladder
status: accepted
date: 2026-07-22
deciders: ["@mbeacom"]
tags: [governance, process, evidence]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0001", "0007", "0009", "0012", "0013"]
affects:
  - type: path
    pattern: "specs/**/spec.md"
  - type: path
    pattern: "specs/**/tasks.md"
  - type: path
    pattern: "plan.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Redefines, org-wide and as a one-way door, what evidence is required to land
    a phase and how project maturity is honestly labeled. It supersedes the
    external-team and independent-adopter hard gates that several specs and two
    proposed ADRs (0007, 0009 via 0012/0013) currently treat as preconditions.
externalRefs:
  - type: doc
    id: adrkit-t018-dogfood
    url: "https://github.com/mbeacom/adrkit-t018-dogfood"
    label: Maintainer-owned isolated reference repository for phase validation
  - type: issue
    id: "24"
    url: "https://github.com/mbeacom/adrkit/issues/24"
    label: Seeking an external team to dogfood the ARB queue (closed — no longer gating)
  - type: issue
    id: "29"
    url: "https://github.com/mbeacom/adrkit/issues/29"
    label: Seeking a Backstage adopter (closed — no longer gating)
---

# ADR-0014: Stage phase-landing evidence across a three-rung validation ladder

## Context

adrkit ships governance tooling before it has a community. Phases 0–6 are
implemented and the first four packages plus a CI Action are public, yet the
project has **no third-party adopters and no external team** today, and none is
on the horizon it controls.

Several artifacts nonetheless treat an *external actor* as a hard prerequisite:

- `specs/007-arb-queue/` gates the rung-6 "landed" claim on SC-004 / FR-019 /
  Assumption A7 / T048 — "a team that is **not** the maintainer's own" must run
  the queue in a separate repository before Phase 6 may be called landed.
- `specs/008-spec-kit-hook-viability/` blocks its own non-shipping spike
  *execution* behind that same Phase 6 external-team gate.
- `specs/009-catalog-binding-viability/` adds a second hard gate — an
  **independent adopter** must author a real annotated catalog and hand-labeled
  oracle — as a precondition for spike execution and for any "authoritative go".
- ADR-0012 and ADR-0013 list "an independent adopter validating real entity/path
  outcomes" as a required item on the production/acceptance path.

These gates were written to keep maturity claims honest: do not say "an org runs
its ARB on it" when no org does. That intent is correct and is preserved here.
But as written they conflate two different things — *is the work correct and
reproducible?* and *has an outside party adopted it?* — and bind the first to
the second. The result is that genuine, self-verifying technical progress is
blocked on volunteers who do not exist, and recruitment issues (#24, #29) became
load-bearing dependencies. Both are now closed as no longer gating.

Waiting does not make the tool better; it only makes the ledger stall. What
*does* make the tool better and keeps claims honest is running each surface, in
a clean and isolated environment, against real inputs, and proving the result is
reproducible — even when the only operator is the maintainer. This is the same
"even if that user is only you" dogfooding principle the outcome ladder in
`plan.md` already states; this record extends it from "a real user" to "phase
landing" and separates it cleanly from external adoption.

## Decision

**Stage landing evidence across three rungs. A phase lands on rungs 1–2.
External/community validation is rung 3: an optional, later maturity signal,
never a precondition for landing, next-phase implementation, or non-shipping
spike execution.**

### The ladder

1. **Rung 1 — unit / contract / conformance evidence.** The automated suites:
   type-check, build, lint, `check:deps` boundary gates, `schema:emit` parity,
   conformance fixtures, and unit/integration tests. Necessary, never
   sufficient on its own to land a phase whose value is an operational surface.

2. **Rung 2 — maintainer-owned isolated reference-repository validation.** The
   phase's real surfaces (CLI, Action, server) are exercised against real inputs
   in a **separate, isolated repository** — distinct from this monorepo — that
   the maintainer owns and operates. This rung is **eligible to land a phase**
   when its evidence is:
   - **Reproducible** — every run pins an immutable adrkit ref (commit SHA), and
     inputs are committed or otherwise fixed;
   - **Self-verifying** — the reference repository asserts its own expected
     outcomes in CI (the run fails if the observed behavior diverges), rather
     than relying on a human reading logs;
   - **Fail-closed** — the reference evidence includes at least one
     consumer-facing failure scenario (e.g. invalid input / schema error,
     duplicate ownership marker, title conflict, or missing permission) that
     mechanically proves the surface fails **before** any side effect and mutates
     nothing;
   - **Reviewed** — the evidence is recorded as a **tracked, sanitized evidence
     index** in the phase's spec/checklists, carrying immutable ref/run/issue
     links, content hashes, tool versions, expected-vs-observed rows,
     limitations, and a reviewer verdict, and it passes review.

   A phase whose exit criterion was previously "a team that isn't yours"
   **lands / is reference-verified** when rung 2 clears. It is **not** thereby
   "externally validated".

### State vocabulary (binding)

Every artifact (specs, root `plan.md`, README, CLAUDE) MUST describe a phase's
maturity using exactly these state names, and MUST NOT substitute vague synonyms
("real user", "release-ready", "authoritative go", "production-ready") unless the
precise state is also named:

| State | Meaning |
|---|---|
| **scoped** | spec → plan → tasks written and reviewed; no code |
| **implemented** | code merged; rung-1 evidence green |
| **reference-verified** | rung-2 maintainer-owned isolated reference-repository evidence met (reproducible, self-verifying, fail-closed, reviewed) |
| **landed** | implemented **and** reference-verified (rungs 1–2). This is the bar for "landed"; it does **not** imply release or external adoption |
| **released** | a versioned artifact is published (e.g. an npm/tag release). Distinct from landed |
| **externally validated** | rung 3 — a party other than the maintainer verified the surface in their own repository |
| **adopted** | an external party uses it in real work |
| **sustained adoption** | external use persists over time |

**Phase landing is decoupled from the outcome-ladder's external-adoption rung.**
The outcome ladder in `plan.md` may state an *aspiration* (e.g. rung 6, "an org
runs its ARB on it") whose achievement is **external adoption**; that achievement
is a separate, later state (`externally validated` → `adopted`). A phase reaches
**landed** at `reference-verified`, without and independently of that outcome-rung
achievement.

3. **Rung 3 — external / community validation.** A party other than the
   maintainer adopts and validates the surface in their own repository. This is
   a **maturity signal**, tracked honestly and separately. It is **welcome and
   solicited**, but it is **never** a prerequisite for landing a phase,
   beginning the next phase's implementation, or executing a non-shipping spike.
   Its status is always reported as explicitly **absent** or **present** with
   evidence — never assumed, never fabricated.

### Honesty rules (binding)

- **`landed / reference-verified` is a distinct claim from `externally
  validated`.** A phase may be the former without being the latter; a spec, the
  root `plan.md`, README, and CLAUDE MUST use the labels precisely and MUST NOT
  imply external adoption that has not occurred.
- **Never claim an org or community adopted something without evidence.** Rung 3
  is reported as absent until a real, linkable external adoption exists.
- **The maintainer's own isolated reference repository is not "external".** It
  MUST NOT be described as an external team, a third party, or a community
  adopter. It is maintainer-owned, separate/isolated, reference verification.
- **Aspirational metrics stay aspirational.** The outcome ladder may keep
  external adoption (e.g. "an org runs its ARB on it") as a target rung, but that
  target MUST NOT block implementation or release progression before a community
  exists. Landing is governed by rungs 1–2.

### What this changes

- The external-team hard gate for Phase 6 (`specs/007-arb-queue/` SC-004 /
  FR-019 / A7 / T048) becomes a **rung-2 maintainer isolated reference-verification
  gate**, satisfied by the evidence in the reference repository
  [`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)
  (queue Action pinned at `efef89b5d747ca175a1947f1ce2f4296dab54fa3`; PRs #2/#4/#5;
  managed issue #3; self-verifying runs). Phase 6 is **landed / reference-verified**,
  explicitly **not** externally validated.
- The Phase 6 execution/landing block in `specs/008-*` and `specs/009-*` is
  **cleared** on the reference-verified basis. Each spike's *execution* is
  authorized by governance once this migration merges; its tasks remain unchecked
  until actually executed. When such a spike later lands, its raw transcripts stay
  scratch-only, but landing requires a **tracked, sanitized evidence index** with
  commit SHAs, run links, content hashes, tool versions, network/credential
  limits, negative-test results, and a reviewer verdict.
- `specs/009-*`'s independent-adopter hard gate is replaced by a **frozen,
  maintainer-authored reference oracle** created and independently audited
  **before** any generator output, **inside the scratch spike**, from pinned
  public corpora plus synthetic explicit annotations — covering positive,
  negative, overlap, absent/empty, collision, and repository-mismatch cases with a
  bounded zero false-positive/false-negative result. An external adopter's oracle
  becomes **optional later externally-validated maturity evidence**, not a
  precondition for spike execution; a `go-explicit` verdict may authorize later
  production scoping once the reference evidence is in hand.
- This record **amends ADR-0012 and ADR-0013 by reference** (it does not supersede
  them): the "independent adopter validating real entity/path outcomes" item in
  each record's production/acceptance ladder is amended from a **hard gate** to an
  **optional later externally-validated maturity signal**, and the
  maintainer-authored reference oracle above is what satisfies the corresponding
  ladder item. Their other gates (versioned interchange envelope, security/scale
  measurements, clean-clone/offline/adapter-boundary evidence) are unchanged. Both
  records carry a reciprocal "Amended by ADR-0014" note and `relatesTo: 0014`. The
  project constitution is unaffected and needs no revision.

This record governs process only. It changes **no** runtime contract, boundary
assertion, or determinism guarantee. Where it and a technical ADR disagree, the
technical ADR wins on the technical point; this ADR governs only how landing
evidence is staged and how maturity is labeled.

## Options considered

### Option A: Three-rung ladder; land on rungs 1–2, external is rung 3 (chosen)

| Dimension | Assessment |
|---|---|
| Honesty | High — separates "correct and reproducible" from "externally adopted"; forbids fabricated adoption |
| Unblocks progress | High — a self-verifying isolated reference repo can land a phase today |
| Cost | A one-time migration of gate language across specs and two ADRs |
| Risk | Maturity could be overstated if labels are sloppy — mitigated by the binding honesty rules |

### Option B: Keep the external-actor hard gates

**Pros:** Strongest possible signal that a real outside party used the tool;
zero risk of overclaiming adoption.
**Cons:** Blocks all landing and downstream implementation on volunteers who do
not exist; converts recruitment into a critical-path dependency; stalls the
ledger indefinitely while providing no improvement to the tool. Rejected: it
gates *technical* correctness on a *social* event the project does not control.

### Option C: Drop the external dimension entirely

**Pros:** Simplest; nothing ever blocks.
**Cons:** Loses a genuine, valuable maturity signal and invites silent
overclaiming ("an org uses it") with no evidence. Rejected: dishonest by
omission and discards the legitimate intent of the original gates.

## Trade-offs

Landing a phase on maintainer-owned reference verification means "landed" no
longer implies "someone else adopted it." That is a real reduction in signal
strength, and it is the cost we accept to keep progress moving. We pay it down
with the honesty rules: reference-verified and externally-validated are
different claims, and the second is reported as absent until proven. Sloppy label
discipline would let maturity be overstated; the rules above and the fresh-context
review that ships with this migration are the mitigation.

## Consequences

- **Easier:** Landing a phase whose value is an operational surface, using
  reproducible self-verifying evidence the maintainer can produce alone;
  beginning the next phase; executing non-shipping spikes.
- **Harder:** Claiming external adoption — it now requires a real, linkable
  external party and is reported as absent otherwise. Sloppy "landed" wording
  that implies adoption is now a governance violation.
- **How we would know this was wrong:** if a phase is labeled
  `landed / reference-verified` and then fails the first time a real external
  party runs it, the rung-2 evidence was not actually self-verifying or
  representative, and the reference-repository bar must be raised. Equally, if any
  artifact is found claiming external adoption without a linkable rung-3 source,
  the honesty rules were violated.
- **Revisit if:** a community forms and external validation becomes routinely
  available (then rung 3 may be promoted from optional to expected for new
  phases), or if reference-repository evidence proves an unreliable predictor of
  external behavior.

## Action items

1. [x] Migrate `specs/007-arb-queue/` SC-004 / FR-019 / A7 and banners from
   external-team hard gate to a rung-2 maintainer isolated reference-verification
   gate; replace `T048` with **`T048-R`** (maintainer reference validation, incl. a
   fail-closed scenario); mark Phase 6 `landed / reference-verified`, not externally
   validated.
2. [x] Clear the Phase 6 execution block in `specs/008-*` and `specs/009-*` on the
   reference-verified basis; keep each spike's tasks unchecked until executed; add
   the tracked-sanitized-evidence-index requirement for their eventual landing.
3. [x] Replace `specs/009-*`'s independent-adopter hard gate with a frozen,
   independently-audited, in-spike maintainer-authored reference oracle covering
   positive/negative/overlap/absent-empty/collision/repo-mismatch with bounded zero
   FP/FN; make its Phase-1 gate formula executable and non-circular; replace
   "authoritative go" with optional externally-validated maturity.
4. [x] Amend ADR-0012 and ADR-0013 by reference: independent adopter becomes an
   optional later externally-validated maturity signal, not a hard gate; add
   reciprocal "Amended by ADR-0014" notes and `relatesTo: 0014`.
5. [x] Record the reference-verification evidence as a tracked, sanitized evidence
   index (immutable ref/run/issue links, content hashes, tool versions,
   expected-vs-observed, limitations, reviewer verdict) in the Phase 6 checklists.
6. [x] Adopt the state vocabulary (scoped / implemented / reference-verified /
   landed / released / externally validated / adopted / sustained adoption) across
   the affected artifacts and remove vague `real-user` / `release-ready` /
   `authoritative-go` wording unless the precise state is also named.
