---
schemaVersion: 0.1.0
id: "0003"
title: Ship as a Spec Kit extension plus a standalone CLI, not a competing harness
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [strategy, integration, distribution]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0005", "0007"]
affects:
  - type: path
    pattern: "packages/adapters/spec-kit/**"
  - type: path
    pattern: "packages/cli/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: Determines distribution strategy and primary adoption channel.
externalRefs:
  - type: doc
    url: https://github.github.com/spec-kit/
    label: GitHub Spec Kit documentation
---

# ADR-0003: Ship as a Spec Kit extension plus a standalone CLI, not a competing harness

## Context

Spec-driven development consolidated fast during 2026. GitHub's Spec Kit is
MIT-licensed, agent-neutral across 30+ coding agents, and has an extension /
preset / hooks system. It structures work as specify → plan → tasks →
implement.

What it does **not** have is a governance layer. It produces a plan; nothing
evaluates that plan against the organization's accumulated decisions, routes it
for review, or records the outcome as durable memory. The next feature starts
from an empty context again.

That gap is exactly the shape of this project. It is also the most plausible
path to the outcome of Microsoft or GitHub picking this up: an extension that
makes an existing GitHub-owned tool work in regulated enterprises is adoptable;
a competing harness is a threat.

Building our own orchestrator would mean competing for attention against a
tool with two orders of magnitude more distribution, on the axis where it is
strongest.

## Decision

Position the project as **the decision-memory and governance layer for
spec-driven development**, delivered as:

1. A **Spec Kit extension** — hooks on the plan phase that retrieve governing
   decisions into agent context, run the evaluator against the produced plan,
   and emit a draft ADR from the plan artifact.
2. A **standalone CLI + CI action** with no Spec Kit dependency, for
   organizations not using it (the majority) and for non-agentic workflows.

The core (`@adrkit/core`) knows about neither. Both are thin adapters, and the
extension lives at `packages/adapters/spec-kit/` under the layout and dependency
rules ADR-0007 establishes — it is an adapter like any other, not a privileged
one.

## Options considered

### Option A: Spec Kit extension + standalone CLI (chosen)
Rides existing distribution. Complementary rather than competitive. Two
integration surfaces means neither is load-bearing alone.

### Option B: Standalone harness with its own plan→implement loop
Full control over the workflow, no upstream dependency. But it duplicates a
solved problem, competes for the same adoption slot, and makes acquisition or
upstreaming implausible.

### Option C: Spec Kit extension only
Simplest, tightest story. But it ties the project's fate to one upstream's
roadmap and excludes every organization not using it — including most of the
regulated enterprises that need decision governance most.

## Trade-offs

Extension-first means accepting upstream API churn and a subordinate position in
the narrative. The standalone CLI is the hedge: if the upstream changes
direction, the core and CLI are unaffected.

We also accept a harder positioning problem — "governance layer for AI-generated
plans" needs more explanation than "ADR tool."

## Consequences

- Easier: distribution, credibility, upstream contribution as a marketing
  channel, enterprise story ("keep your agent workflow, add the audit trail").
- Harder: two integration surfaces to maintain; roadmap partially exogenous.
- Revisit if: spec-driven tooling consolidates elsewhere, or the upstream ships
  a native governance layer. In the latter case, upstreaming this becomes the
  goal rather than the fallback.

## Action items

1. [ ] Spike the extension hooks against current Spec Kit
2. [ ] Confirm the standalone CLI has zero dependency on the extension package
3. [ ] Draft the positioning one-pager: "decision memory for agent-authored plans"
