---
schemaVersion: 0.1.0
id: "0033"
title: Select interactive graph presentation at the CLI boundary while preserving piped DOT
status: accepted
date: 2026-08-26
deciders: ["@mbeacom"]
tags: [cli, graph, visualization, compatibility, determinism]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0004", "0007", "0010", "0014", "0016", "0031"]
affects:
  - type: path
    pattern: "packages/core/src/graph/**"
  - type: path
    pattern: "packages/cli/src/graph.ts"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/cli/src/command-registry.ts"
  - type: path
    pattern: "site/src/content/docs/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Changes the documented default-selection policy of a published CLI command
    while preserving its machine channels and adding public core renderers.
reviewBy: 2027-02-26
---

# ADR-0033: Select interactive graph presentation at the CLI boundary while preserving piped DOT

> **Status: accepted.** Agent-drafted and ratified by `@mbeacom` on
> 2026-08-26. This supersedes the Phase 0 choice to make DOT the unconditional
> default and to avoid TTY-sensitive graph presentation. It does not change the
> graph model or JSON envelope.

## Context

`adr graph` originally emitted Graphviz DOT by default and JSON on request. DOT
is a useful interchange format, but its source is not a useful interactive
answer. The dogfood corpus now contains 33 decisions and 144 relationships; raw
DOT resembles a pasted corpus, while a terminal network drawing of the same
graph becomes a crossing-heavy hairball.

The machine paths are already useful and consumed. Agents can request JSON,
renderers can consume DOT, and scripts may rely on bare `adr graph` through a
pipe. Improving the human experience must not turn those invocations into
terminal prose or ANSI output.

Mermaid is also a useful text renderer: GitHub and documentation systems can
lay it out visually without adrkit carrying a browser, Graphviz executable, or
layout dependency. Native SVG or HTML would require one of those costs.

## Decision

We will select graph presentation at the CLI boundary:

1. The requested format defaults to `auto`.
2. `auto` resolves to `terminal` only when stdout is a TTY. It resolves to `dot`
   for pipes, redirects, captured subprocesses, and CI.
3. Explicit `terminal`, `dot`, `json`, and `mermaid` formats always win.
4. TTY detection, terminal width, and ANSI styling remain in `@adrkit/cli`.
   Graph construction, filtering, DOT, JSON, and Mermaid rendering remain pure
   in `@adrkit/core`.
5. `--focus <id>` keeps the named node, matching incident edges, and their
   endpoints. Repeatable `--kind` values are ORed across `supersedes`,
   `relatesTo`, and `conflictsWith`. Every concrete format renders the same
   filtered graph.
6. Sparse terminal views list decisions and relationships. Focused views split
   incoming from outgoing relationships. Dense views report status and edge
   counts plus the most connected decisions, then direct the user to a focused
   filter rather than drawing a misleading network. Node and per-direction
   relationship budgets keep large sparse and focused views bounded.
7. DOT gains visible statuses and deterministic styles from the portable
   adrkit palette. Mermaid labels also include status text; neither renderer
   relies on color alone.
8. The graph JSON shape remains exactly `{ nodes, edges }`, with existing node
   and edge fields, historical locale ordering, and missing-target omission
   unchanged.
9. Terminal title truncation uses grapheme boundaries and terminal display
   cells so multilingual titles do not overflow or split.
10. Invalid corpus records do not suppress the valid projection: graph emits
   the selected format from valid records, writes error findings to stderr, and
   exits `1`. A focused invalid record is diagnosed as invalid rather than absent.
11. We will not spawn Graphviz or ship native SVG/HTML in this surface. DOT piped
   to `dot -Tsvg` is the explicit SVG path; a dependency-bearing renderer
   remains downstream scope under ADR-0030.

## Options considered

### Option A: TTY-aware presentation with explicit deterministic formats

**Chosen.** It improves the direct command while preserving bare piped output
and all explicit machine channels. Focus filters solve the dense-corpus problem
without inventing a layout engine.

### Option B: Add formats but keep DOT as the interactive default

This is maximally conservative, but most humans never discover the better view.
It leaves the primary command experience in the state that forced this
decision.

### Option C: Make terminal prose the unconditional default

This breaks scripts and agents that capture bare `adr graph`. Requiring every
consumer to add `--format dot` is unnecessary when stdout already provides a
reliable compatibility boundary.

### Option D: Render native SVG/HTML inside the CLI

This produces a file that opens directly, but it requires a system Graphviz
dependency, a substantial layout/WASM package, or an in-house layout engine.
Those costs are disproportionate while deterministic DOT and Mermaid already
feed mature renderers.

## Trade-offs

- Bare `adr graph` is now environment-sensitive by design. The same invocation
  differs between a terminal and a pipe, so documentation must state the
  boundary precisely.
- Polished DOT intentionally changes DOT bytes. Its node ids, relationship
  directions, edge labels, and `status` attributes remain stable; consumers
  requiring byte-level output must pin their expected adrkit version.
- The terminal overview is an instrument, not a complete visualization of every
  dense edge. Completeness remains available through DOT, JSON, Mermaid, and
  filtered terminal views.
- Graph now gives corpus errors exit-code authority after emitting the valid
  projection; callers that previously ignored invalid records will observe
  exit `1` and diagnostics on stderr.
- Mermaid source is deterministic, but final layout depends on the downstream
  Mermaid renderer version.

## Consequences

- Easier: a human can run `adr graph`, identify corpus shape and hubs, and focus
  a useful neighborhood without leaving the terminal.
- Easier: GitHub and docs users have a dependency-free Mermaid channel.
- Easier: Graphviz output carries useful status and relationship styling before
  external rendering.
- Harder: help, completions, tests, and docs must cover five requested format
  values and the TTY negotiation rule.
- **How we would know this was wrong:** users report that redirected bare output
  is no longer DOT, JSON changes shape, terminal views hide the route to full
  output, or focused views still recover most of the dense corpus.
- Revisit if a stable, dependency-appropriate layout engine can produce
  self-contained accessible SVG without compromising deterministic Node 22
  packaging.

## Action items

1. [x] Add pure graph filtering and Mermaid rendering to `@adrkit/core`.
2. [x] Add the TTY-aware terminal renderer and `auto` selection to the CLI.
3. [x] Add `--focus` and repeatable `--kind` to help and shell completions.
4. [x] Preserve piped DOT and the graph JSON envelope with contract tests.
5. [x] Document terminal, Mermaid, Graphviz SVG, and JSON workflows.
6. [x] Add installed-tarball Node canaries for every graph channel.
7. [ ] Gather external evidence for the interactive view under ADR-0014.
