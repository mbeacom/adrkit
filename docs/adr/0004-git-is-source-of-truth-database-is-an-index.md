---
schemaVersion: 0.1.0
id: "0004"
title: Treat git as the source of truth and the database as a derived index
status: accepted
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [core, storage, web]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0001", "0002", "0007"]
affects:
  - type: path
    pattern: "packages/index/**"
  - type: path
    pattern: "apps/web/**"
  - type: package
    pattern: "@prisma/client"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: One-way door; reversing it later means rewriting every read path.
assertions:
  - id: no-authoritative-writes
    description: The web app must not write decision content directly to the database.
    engine: grep
    input: source
    severity: error
---

# ADR-0004: Treat git as the source of truth and the database as a derived index

## Context

ADR-0001 puts decisions in git. Git is a poor query engine: "show every accepted
org-scope decision touching payments that expires this quarter" requires a full
corpus scan, and the web UI, ARB queue, and retrieval layer all need that class
of query at interactive latency.

The obvious fix is a database. The obvious failure mode is that the database
quietly becomes authoritative — someone adds an edit form, writes land in
Postgres first, and within two quarters git-based review, offline use, and
forkability are all gone. This is the single most likely way this project
degenerates into another hosted ADR app.

## Decision

Postgres (via Prisma) is a **derived, rebuildable index**. Git holds truth.

- The index is populated by a projector reading git history. It can be dropped
  and rebuilt from scratch at any time; `adr index rebuild` is a supported,
  tested, routinely exercised operation.
- Every mutation from the web UI or MCP server produces a **git commit on a
  branch and a pull request**. Nothing writes decision content to Postgres
  directly.
- The index may hold derived state that is not decision content: embeddings,
  computed graph edges, queue positions, evaluator run history, notification
  state.
- The CLI and CI action never require the index. `@adrkit/core` performs its work
  against the filesystem alone.

## Options considered

### Option A: Git truth, DB index (chosen)
Preserves review workflow, offline use, and forkability. Costs a projector and
eventual-consistency handling.

### Option B: DB truth, git export
Much simpler queries and workflow. Loses PR-based review, makes CI mapping of
diffs to decisions a network call, and makes the project uninteresting to the
audience most likely to adopt it.

### Option C: No database; in-memory index rebuilt per process
Zero infrastructure, fine to roughly a few thousand records. Fails on federated
multi-repo corpora and on any interactive multi-user queue.

## Trade-offs

We accept eventual consistency between git and the index, and the operational
burden of a projector with replay. In exchange the system stays git-native
under any failure of the index, which is the property that makes it credible.

Option C is genuinely sufficient for early adoption. The index should therefore
be optional and lazily introduced — `@adrkit/core` targets the filesystem, and
Option A's machinery only engages above a configured corpus size.

## Consequences

- Easier: rich queries, ARB queue, semantic retrieval, multi-repo aggregation.
- Harder: two representations to keep in sync; webhook/poll ingestion; replay.
- Watch for: any PR adding a direct write path to decision content in Postgres.
  That is the specific drift this record exists to catch, and `no-authoritative-writes`
  is its enforcement.
- Revisit if: sustained demand for real-time collaborative editing appears —
  which would genuinely conflict with this decision and should supersede it
  explicitly rather than erode it.

## Action items

1. [ ] Prisma schema for the projection; no unique business constraints beyond git ids
2. [ ] `adr index rebuild` as a **separate** CI job against an ephemeral
       container — never part of the default build, which ADR-0007 requires to
       pass on a clean clone with no credentials and no services
3. [ ] Grep assertion wired into `adr check`
