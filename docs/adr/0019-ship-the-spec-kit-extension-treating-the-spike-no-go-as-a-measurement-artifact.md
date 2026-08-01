---
schemaVersion: 0.1.0
id: "0019"
title: Ship the Spec Kit extension, treating the spike's no-go as a measurement artifact
status: accepted
date: 2026-08-01
deciders: ["@mbeacom"]
tags: [strategy, integration, distribution, evidence, governance]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0007", "0010", "0014", "0016"]
affects:
  - type: path
    pattern: "packages/adapters/spec-kit/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Realizes ADR-0003's distribution strategy by creating the first package under
    packages/adapters/**, and overrides the recorded outcome of a completed,
    independently audited spike. Both the packaging boundary and the precedent for
    when a recorded verdict may be set aside are expensive to reverse informally.
externalRefs:
  - type: doc
    url: https://github.com/github/spec-kit/blob/9a30db484b0876cb7e5a391cf735d59bd968e985/extensions/EXTENSION-API-REFERENCE.md
    label: Spec Kit extension API reference at the frozen v0.13.0 commit
reviewBy: 2027-08-01
---

# ADR-0019: Ship the Spec Kit extension, treating the spike's no-go as a measurement artifact

## Context

ADR-0003 commits this project to two distribution surfaces: a standalone CLI,
which ships, and a Spec Kit extension, which never has. Its action item 1 said to
spike the extension hooks before committing to a production package.

That spike ran (`specs/008-spec-kit-hook-viability/`). It executed, was remediated
post-merge, and was independently audited across nine fresh-context passes. Its
recorded verdict is **`no-go`**, whose contractual meaning is "no production Spec
Kit integration is recommended at this time."

On the merits, the spike found the opposite. Every mechanism the extension needs
was verified working:

| Verified | Result |
|---|---|
| `after_plan` hook fires in a live agent session | yes, with genuine plan context |
| Fixture-local `scripts/*.sh` references survive rendering | yes (an execution-time hypothesis upstream does not document) |
| Shelling out to adrkit's built CLI, offline | yes, under a kernel-enforced network namespace |
| Repository mutation during hook-fire | none |
| Disable, re-enable, remove | clean and complete |
| Rendering across two independent upstream agents | both |
| Honest failure on absent context / absent CLI | non-zero, specific message, no crash |

The `no-go` fired on one axis only: `MutationBaseline` rows 0 and 3, `install`
and `remove`. Those are lifecycle operations whose entire purpose is to write
files, measured against a literal byte-identical `git status --porcelain=v1`
bar. The spike said so itself, in its own Limitations section: the verdict
procedure has "no carve-out for a lifecycle action whose entire purpose is to
write files. This tension is reported honestly rather than smoothed over."

So the record contains a `no-go` that no evidence in the bundle supports, produced
by a contract that could not have returned anything else. Two failure modes are
available here, and both are bad. Quietly building anyway makes the recorded
verdict decorative — which, in a project whose entire thesis is that recorded
decisions bind, is self-refuting. Treating the verdict as load-bearing forever
means a measurement defect permanently blocks a committed strategy.

The way out is neither: name the defect, and record the override as a decision
that is itself reviewable.

## Decision

**Ship the production Spec Kit extension at `packages/adapters/spec-kit/`, and
record spike 008's `no-go` as a measurement artifact rather than a finding.**

Concretely:

1. Spike 008's `no-go` verdict, its evidence bundle, and its audit history stand
   **unmodified**. Nothing is retro-edited, no checkbox is flipped, no verdict is
   rewritten. It remains the honest record of what that contract returned.
2. The defect is located in the spike's own verdict procedure — SC-007's
   `no-go` trigger applied `MutationBaseline` byte-identity to lifecycle actions
   that necessarily write — not in Spec Kit, not in the hook mechanism, and not
   in adrkit.
3. That procedure's finding is therefore not evidence against a production
   integration, and this decision overrides it for the purpose of authorizing
   one. Every *other* spike finding continues to bind, including the ones that
   constrain the design below.
4. The extension inherits the spike's verified constraints as production
   requirements, not as suggestions:
   - `speckit_version` pinned to `>=0.13.0,<0.14.0` — the one minor line actually
     verified. Widening it is a re-verification, not a version bump.
   - Exactly one hook, `after_plan`, `optional: true`. Never a mandatory hook.
   - Hooks may only target commands that do not write. `speckit.adrkit.draft`
     writes, and is therefore reachable only by explicit human invocation.
   - The honest-failure contract (non-zero exit, a message naming the missing
     dependency, no fabricated success) applies to every command.
5. These constraints are enforced by tests, not by convention. Each was observed
   failing under a deliberately introduced defect before being trusted
   (ADR-0016).

Per ADR-0014, this lands the extension on rung 1 only — unit and contract
evidence. It is **not** reference-verified and **not** externally validated.
Neither this decision nor the package claims otherwise.

## Options considered

### Option A: Ship, and record the override as a decision (chosen)

Costs one ADR and states plainly that a recorded verdict was set aside, why, and
on what evidence. The override is reviewable, and the reasoning survives for the
next person who finds a `no-go` in the history and wonders why a package exists
anyway.

### Option B: Treat the `no-go` as binding and leave ADR-0003 unrealized

Maximally deferential to the record. But it lets a defect in a spike's own
measurement procedure permanently veto a committed strategy, on an axis the spike
itself disclosed as spurious. It also teaches the wrong lesson: that a contract's
literal output outranks its own author's disclosure of why that output is wrong.

### Option C: Re-run the spike under a corrected verdict procedure

The most rigorous option, and the one to take if the mechanism evidence were
thin. It is not. The re-run would exercise the same hooks against the same frozen
commit and, by construction, return `go` — paying a full spike cycle to relabel
findings already in the bundle. Rejected as ceremony, and recorded here so the
choice is visible rather than skipped.

### Option D: Ship manual commands only, no hooks

The narrow reading of `manual-command-only`. But the hook is the whole point:
governance an agent must remember to ask for is governance that gets skipped. The
hook evidence is also the *strongest* part of the bundle — a live fire with real
plan context and zero mutation. Scoping it out would discard the best-verified
capability to respect a verdict that capability did not trigger.

## Trade-offs

Overriding a recorded verdict is a precedent, and precedents get reused with less
care than they were set. The mitigation is that this ADR is narrow and explicit:
it overrides one named trigger on one named axis of one named spike, on the
strength of that spike's own disclosure. It does not establish that verdicts are
advisory, and it is not authority to set aside a finding that is merely
inconvenient.

The pin to a single upstream minor means the extension breaks on the next Spec Kit
minor rather than degrading quietly. Under ADR-0007 that is the intended
behavior for an adapter — an adapter's semver contract is with its upstream — but
it does mean real maintenance rather than a floating range that appears to work
until it does not.

## Consequences

- Easier: ADR-0003's second surface exists; `packages/adapters/**` has its first
  real inhabitant and ADR-0007's boundary is now exercised rather than theoretical;
  ADR-0003 action item 1 can close.
- Harder: an upstream to track, and a documented precedent for overriding a
  recorded verdict that future decisions must be careful not to over-read.
- Revisit if: Spec Kit's extension or hook API changes shape; the pin needs
  widening (which requires re-verification, not a bump); or reference/external
  validation is attempted, at which point ADR-0014 rungs 2 and 3 apply and this
  record's rung-1 scoping should be restated, not quietly outgrown.

## Action items

1. [x] Build the extension at `packages/adapters/spec-kit/` under the constraints above
2. [x] Enforce the read-only hook boundary with a test observed failing first
3. [ ] Re-verify the `speckit_version` pin against the next Spec Kit minor before widening it
4. [ ] Decide whether to publish `@adrkit/spec-kit` to npm, or install it from the repository
