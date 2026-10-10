---
schemaVersion: 0.1.0
id: "0005"
title: Batch sync writes
status: proposed
date: 2026-07-18
deciders: []
tags: []
scope: component
reversibility: unknown
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "src/sync/**"
provenance:
  authoredBy: human
conflictsWith: ["0004"]
review:
  tier: async
  queuedAt: 2026-07-01T00:00:00Z
  slaDays: 10
  quorum: 2
  approvals: ["@alice", "@Alice"]
  objections:
    - by: "@bob"
      summary: Batching hides write failures
      resolved: true
    - by: "@carol"
      summary: Needs a size cap
---

# ADR-0005: Batch sync writes
