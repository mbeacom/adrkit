---
schemaVersion: 0.1.0
id: "0028"
title: Read Principle II as forbidding network dependence, and exempt the step that proves denial
status: accepted
date: 2026-08-13
deciders: ["@mbeacom"]
tags: [ci, governance, constitution, testing]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0007", "0010", "0014", "0016", "0020"]
affects:
  - type: path
    pattern: ".github/workflows/ci.yml"
  - type: path
    pattern: "scripts/run-network-denied.ts"
  - type: path
    pattern: "specs/**/spec.md"
  - type: path
    pattern: "specs/**/tasks.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Resolves an ambiguity in a ratified constitutional principle and records a
    named exemption to it. Either alone would route here; the combination is the
    class of change that must not be able to happen inside a feature spec, which
    is exactly how it was about to happen.
  decidedAt: 2026-08-13T00:00:00Z
  approvals: ["@mbeacom"]
reviewBy: 2027-08-13
---

# ADR-0028: Read Principle II as forbidding network dependence, and exempt the step that proves denial

## Context

Feature 010's `T093` cannot be closed, and the reason turned out not to be the
one it was recorded under.

`T093` discharges **FR-050**, which reads:

> A clean clone MUST build, typecheck, lint, and test green. Network access is
> **permitted only** during dependency installation with the committed lockfile;
> after install there MUST be no network access, no credential, and no running
> service **required by** build, test, or generator invocation (**Constitution
> Principle II**; **ADR-0007**).

The first conjunct is met and verified on the runner. The second is false as
written: `bun test` runs with ambient network available, so network is not
"permitted only during installation".

It cannot be made true by effort. The suite contains the two-sided controls that
*prove* the denial mechanism works — a control request that must connect, and the
same request under the sandbox that must be refused. **A control that establishes
denial cannot itself run under denial.** Wrapping the step was attempted on both
platforms and fails differently on each, which is what makes the obstruction
structural rather than a macOS quirk: `sandbox-exec` denies loopback outright and
3 tests fail with `Failed to start server`; Linux `unshare --net` brings `lo` up
so that failure does not occur, and **11** fail instead, because the
denial-proving tests must nest a sandbox inside the one already wrapping them.

Narrowing the exemption to the two denial-proving files was considered and
rejected: `bun test` has no exclusion filter, so it would require an explicit path
allowlist, and a stale entry in that allowlist means tests silently not running —
the same defect `check:clean-clone` exists to catch, reintroduced to tidy a
disclosure.

### The ambiguity

FR-050 cites Principle II as its source. Principle II is not self-consistent
about what it forbids:

| Principle II text | Reads as |
|---|---|
| "build, typecheck, test, lint, packaging, smoke tests, and runtime behavior MUST **require** no credentials, no running services, and no network access" | **dependence** |
| "**Network-dependent** tests and runtime behavior are forbidden" | **dependence** |
| "A change that makes any post-install gate or runtime behavior **require** a secret, a device, a service, or a network call is a defect" | **dependence** |
| "The install exception is **limited to** `bun install --frozen-lockfile`" | **availability** |

Three statements test whether a step *depends on* the network. One tests whether
the network is *available to* it. `bun test` satisfies all three of the first
kind — nothing in the suite reaches the network, and it passes with the network
gone — and fails the fourth.

FR-050 restated the principle using the fourth reading and presented it as a
faithful derivation. So `T093` has been blocked by a feature requirement that is
**stricter than the ratified law it cites**, and the record of that has been a
task comment rather than a decision.

## Decision

**Principle II's operative test is dependence, not availability. A post-install
step is compliant when it neither requires nor uses the network, whether or not
one happens to be reachable. The `bun test` step of `clean-clone-builds` is
recorded as a named, bounded exemption from the availability reading.**

### 1. The reading

"Network-dependent … are forbidden" and "MUST require no … network access" are
the binding clauses. "The install exception is limited to
`bun install --frozen-lockfile`" is hereby read as scoping which step may
*legitimately depend on* the network — installation, and nothing else — rather
than asserting that no other step may have one reachable.

This changes no observable behavior. Every gate that was green stays green, and
no step gains permission to *use* a network it could not use before.

### 2. The exemption, and its bounds

`bun test` in the `clean-clone-builds` job runs unwrapped. This is authorized,
and is the **only** authorized exemption. It carries four conditions, all of which
must hold or the exemption lapses:

- **It is named.** The workflow step and the feature's evidence must both identify
  it as the exemption and state the reason. An unwrapped step that is not recorded
  here is a defect, not an instance of this record.
- **It is justified by the nesting obstruction**, not by convenience. If the suite
  ever stops containing the denial-proving controls, the exemption ends with them.
- **Every other post-install step is wrapped.** Thirteen are. Any new post-install
  step is wrapped by default; adding a second exemption requires its own record.
- **The suite must remain network-independent in fact.** The exemption permits
  ambient availability, never use. A test that reaches the network is a defect
  under Principle II's binding clauses and is unaffected by this record.

### 3. FR-050 is amended by reference

This record **amends FR-050 in `specs/010-catalog-backstage/spec.md`** (it does
not supersede feature 010): its "permitted only during dependency installation"
clause is replaced by the dependence test above, plus the named exemption. The
remainder of FR-050 — no credential, no running service, nothing *required by*
build, test, or generator invocation — stands unchanged and unweakened.

`T093` may be closed on that basis. Its first conjunct is verified on the runner;
its second is satisfied under the corrected reading.

The same amendment-by-reference mechanism ADR-0014 used for ADR-0012 and ADR-0013
is used here, for the same reason: the feature's other requirements are correct
and should not be reopened to fix one clause.

## Options considered

### Option A: Amend the reading, record a bounded exemption (chosen)

| Dimension | Assessment |
|---|---|
| Honesty | High — states what the principle always tested, and names the one step that does not fit |
| Scope | One clause, one step, four conditions |
| Behavior change | None; no gate moves |
| Risk | The exemption becomes a precedent — bounded by condition 3 |

### Option B: Correct FR-050 in the spec, no record (rejected)

**Pros:** cheapest; arguably the spec simply overstated its source.
**Cons:** Principle II's fourth bullet genuinely supports the stricter reading, so
this is not an unambiguous typo — it is a choice between two live readings of
ratified law. Resolving that inside a feature spec is precisely how a
constitutional interpretation gets made by whoever happened to be writing a
requirement that day, which is the failure this project exists to prevent.

### Option C: Split T093, leave FR-050 alone (rejected)

**Pros:** claims the verified half honestly; no governance change at all.
**Cons:** leaves a requirement permanently unsatisfiable and a task permanently
open, with the real reason living in a task comment. The next feature to cite
Principle II inherits the same ambiguity and the same stall. It defers the
decision rather than making it.

### Option D: Wrap `bun test` and delete the denial-proving controls (rejected)

Would satisfy the letter by removing the evidence. The controls are what make
every other wrapped step meaningful; without them the wrapper is asserted rather
than demonstrated. This is the option that trades real assurance for a green
checkbox, and it is named here so that a future reader can see it was considered
and why it was refused.

## Trade-offs

An exemption is a precedent, and precedents get cited. Bounded by requiring a new
record for a second one, and by the standing requirement that every other
post-install step is wrapped by default.

Reading a principle rather than rewriting it leaves the fourth bullet's wording in
place, so a future reader may re-derive the stricter reading from the constitution
alone. Accepted: rewriting a ratified principle to resolve a feature's blocked
task is a larger act than resolving the reading, and this record is discoverable
from Principle II via its `affects` and from FR-050 by name.

The dependence test is weaker in one real sense — it does not *prevent* a future
test from quietly acquiring a network call. That is why condition 4 exists, and
why 13 of 14 steps remain wrapped: the wrapper, not the reading, is what enforces
it in practice.

## Consequences

- Easier: `T093` closes on verified evidence; the next feature citing Principle II
  gets a stated test rather than two competing readings.
- Harder: any second exemption now costs a record. Intended.
- Explicit commitment: **the exemption is reported wherever the job's coverage is
  described — as one named step of fourteen, never as "every step is denied".**
  A description that rounds it up is a defect under ADR-0016's own reasoning,
  since it would claim coverage the run does not have.
- Revisit if: the denial-proving controls leave the suite (the exemption ends with
  them), a second exemption is proposed (needs its own record), or `bun test`
  acquires a genuine network dependency (a defect under Principle II, not a
  candidate for extension).

## Action items

1. [ ] Amend FR-050 in `specs/010-catalog-backstage/spec.md` to cite this record
2. [ ] Close `T093`, citing this record and the runner evidence
3. [ ] Name the exemption in the `bun test` step of `clean-clone-builds`
4. [ ] State the exemption as one step of fourteen wherever job coverage is described
