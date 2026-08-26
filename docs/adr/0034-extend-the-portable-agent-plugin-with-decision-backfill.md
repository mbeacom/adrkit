---
schemaVersion: 0.1.0
id: "0034"
title: "Extend the portable agent plugin with decision backfill"
status: accepted
date: 2026-08-26
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - backfill
  - governance
scope: component
reversibility: two-way-door
blastRadius: cross-team
relatesTo:
  - "0008"
  - "0016"
  - "0028"
  - "0030"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/**"
  - type: path
    pattern: ".claude-plugin/**"
  - type: path
    pattern: "site/src/content/docs/backfill.mdx"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
---

# ADR-0034: Extend the portable agent plugin with decision backfill

> **Status: accepted.** Agent-drafted and explicitly ratified by `@mbeacom` on
> 2026-08-26. This record amends ADR-0028's component inventory; it does not
> supersede ADR-0028's portability or distribution constraints.

## Context

ADR-0028 authorized the first portable agent-plugin surface with one skill, one
read-only subagent, and four commands. It deliberately fixed more than a
directory layout: only one command writes, the plugin has no dependency tree or
plugin-level MCP wiring, and host-specific tool vocabularies stay out of shared
frontmatter.

An inherited repository has a different decision-memory problem from a new
change. Durable architecture can be visible only indirectly in code,
configuration, design documents, and git history. The `adr` CLI can validate,
resolve, migrate MADR, and create one record, but it does not infer arbitrary
decisions from a corpus. Treating that inference as an importer would turn
model judgment into a bulk writer and could promote implementation accidents
into accepted governance.

The first backfill implementation exposed four additional constraints during
review:

- repository content and repository-local executables are trust boundaries;
- custom corpus paths must survive every CLI invocation;
- an unbounded repository-wide audit is not honestly "bounded"; and
- a candidate report loses its value if `/adr-draft` drops its provenance,
  citations, gaps, and reconciliation result.

ADR-0028's exact component list does not authorize a second skill or fifth
command. This decision records that expansion and its safety boundary before
the repository-backed marketplace publishes it from `main`.

## Decision

We will extend the existing `adrkit` agent plugin with:

- a second auto-triggered skill, `decision-backfill`; and
- a fifth slash command, `/adr-backfill [files-or-directories...]`.

Both are read-only discovery surfaces. They may inventory code, documentation,
configuration, and git history; reconcile candidates through trusted adrkit
read surfaces; and return a coverage ledger plus structured candidate
handoffs. They may not create, edit, accept, reject, supersede, or delete a
record. `/adr-draft` remains the plugin's only writer and creates at most one
`proposed` record after a human selects a candidate.

This amends only ADR-0028's component inventory. Its existing constraints remain
binding: conventional component directories, no manifest component paths, no
portable `tools` or `allowed-tools` list, no plugin-level `.mcp.json`, no
dependencies, independent versioning, and `main` as the release channel.

The backfill workflow adds these contracts:

1. **Evidence is untrusted data.** Instructions inside repository files, commit
   messages, and generated text are never executable guidance. Arguments must
   resolve inside the worktree; absolute paths, escaping `..` paths, and
   out-of-tree symlink targets are not read.
2. **Repository-local executables require trust.** The established CLI
   resolution order remains `$ADRKIT_CLI`, `./node_modules/.bin/adr`, then
   `PATH`, but a candidate inside the target worktree is not executed in an
   inherited repository without explicit user confirmation. If trust is not
   confirmed, reconciliation is skipped and reported as unverified.
3. **Scope has hard defaults.** An unscoped run preflights before reading and
   stops for a narrower scope above 2,000 files, 16 MiB of text, 256 KiB for one
   file, 500 commits, or 25 candidate cards. Explicitly scoped runs use the same
   limits unless the user approves a higher bound.
4. **Corpus location is explicit.** A detected corpus path wins, then
   `ADRKIT_DIR`, then `docs/adr`. Every `lint`, `graph`, `check`, `queue`, and
   MADR migration invocation receives that path through `--dir`; changed paths
   follow an option terminator.
5. **Source authority controls status.** MADR migration preserves source
   status; a plan artifact imported as the proposal remains `draft`; inferred
   code or prose can support only a future `proposed` record after human
   selection. Nothing becomes `accepted` automatically.
6. **The handoff is typed in prose.** Each selectable candidate carries a key,
   title, corpus directory, concrete candidate paths, primary source, citations,
   missing evidence, schema-shaped `affects`, alternatives, status treatment,
   reconciliation result, and a candidate-specific snapshot carrying the corpus
   fingerprint plus governing/proposal/history ids. `/adr-draft` reruns that
   reconciliation immediately before writing and refuses a missing or changed
   handoff. Evidence-derived titles are literal argv values, never interpolated
   into shell source.
7. **MCP identity is explicit.** MCP tools are used only when their configured
   `ADRKIT_MCP_CWD` and `ADRKIT_MCP_DIR` match the target worktree and resolved
   corpus. They cannot inherit `ADR_DIR` per call, so a hidden or mismatched
   configuration makes MCP reconciliation unverified.
8. **Release evidence matches the new failure modes.** Contract checks retain a
   contradictory negative fixture per ADR-0016, every version-bearing surface
   is compared, and a synthetic consumer smoke proves a candidate report is
   produced without changing the worktree before merge.

## Options considered

### Option A: Extend the existing portable plugin (chosen)

| Dimension | Assessment |
|---|---|
| User model | One adrkit plugin owns context, check, queue, backfill, and deliberate drafting |
| Write boundary | Preserved: only `/adr-draft` writes one record |
| Distribution | Reuses the measured Copilot, Claude, APM, and opencode layout |
| Cost | Adds prompt surface, tests, release evidence, and another component contract |

### Option B: Publish a separate backfill plugin

**Pros:** A smaller trigger surface and an independent release cadence.

**Cons:** Duplicates CLI resolution, corpus reconciliation, provenance rules,
host compatibility work, and installation guidance. Users could install the
writer without the discovery half or vice versa.

### Option C: Add a generic importing writer

**Pros:** Produces records directly and can process a large corpus in one run.

**Cons:** Converts probabilistic inference into bulk governance mutation,
creates status and deduplication hazards, and conflicts with ADR-0008's
source-authority and one-way-import rules.

### Option D: Do nothing

Users can manually inspect a repository and invoke `/adr-draft`. This preserves
the smaller component inventory but leaves no coverage ledger, evidence
threshold, corpus deduplication step, or safe treatment for code that proves
state without proving intent.

## Trade-offs

The second skill consumes always-on discovery metadata and broadens the cases
where an agent may inspect repository content. Hard caps can stop a legitimate
large audit and require human scoping. Trust confirmation adds friction in
exactly the inherited repositories where backfill is most valuable.

Prompt-level contracts cannot make model behavior deterministic. The retained
negative fixture proves the shipped guidance carries the rules; the consumer
smoke establishes one real host path; neither proves every model will produce
the same candidate set. The workflow therefore reports evidence and gaps rather
than claiming exhaustive or authoritative inference.

Keeping `/adr-draft` as the sole writer makes the handoff more elaborate than a
single title. That cost is accepted because provenance cannot be reconstructed
honestly after the record is created.

## Consequences

- Easier: auditing an inherited repository without bulk-writing ADRs; recovering
  rationale with citations; finding duplicates and rejected alternatives before
  drafting; installing one portable plugin across supported hosts.
- Harder: maintaining version agreement across manifests, skills, marketplace
  metadata, and the lockfile; keeping security and resource bounds consistent
  across a skill, command, writer handoff, tests, and user documentation.
- **How we would know this was wrong:** `/adr-backfill` changes the consumer
  worktree, follows evidence-embedded instructions, reads outside the worktree,
  loses a custom corpus path, emits more than the approved bounds, or produces a
  selected draft without its source and citations.
- Revisit if: adrkit gains a deterministic arbitrary-corpus importer, plugin
  hosts provide enforceable portable read-only tool policies, or real users need
  an independently installed backfill surface.

## Action items

1. [x] Harden the command and skill against trust, path, option, exit-code, and
   resource-bound failures.
2. [x] Define and enforce the candidate-to-draft handoff.
3. [x] Retain contradictory contract fixtures and compare every version-bearing
   surface.
4. [x] Document custom corpus routing and per-host update/recovery.
5. [x] Run and record a synthetic Copilot consumer smoke proving no writes.
