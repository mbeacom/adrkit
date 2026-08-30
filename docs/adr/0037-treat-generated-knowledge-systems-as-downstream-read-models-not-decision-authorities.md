---
schemaVersion: 0.1.0
id: "0037"
title: Treat generated knowledge systems as downstream read models, not decision authorities
status: proposed
date: 2026-08-29
created: 2026-08-29
deciders: ["@mbeacom"]
tags: [architecture, documentation, governance, integration]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0004", "0007", "0027", "0029", "0030", "0031", "0034"]
affects:
  - type: path
    pattern: "README.md"
  - type: path
    pattern: "PRODUCT.md"
  - type: path
    pattern: "site/src/content/docs/**"
  - type: path
    pattern: "site/astro.config.mjs"
  - type: path
    pattern: "schema/adr.schema.json"
  - type: path
    pattern: "packages/core/src/schema/adr.schema.ts"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    This record sets an organization-wide authority boundary for integrations
    that can rewrite derived knowledge and for the public contracts those
    integrations consume.
  queuedAt: 2026-08-30T02:14:34Z
  slaDays: 30
externalRefs:
  - type: doc
    url: "https://www.langchain.com/blog/self-correcting-memory-openwiki"
    label: "OpenWiki grounded Claims and self-correcting memory"
  - type: doc
    url: "https://github.com/langchain-ai/openwiki/tree/c666f4262e4340e5675fa9804bb342b87bf87f1a"
    label: "OpenWiki repository at the revision reviewed for this record"
  - type: doc
    url: "https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md"
    label: "Open Knowledge Format v0.2"
reviewBy: 2027-02-28
---

# ADR-0037: Treat generated knowledge systems as downstream read models, not decision authorities

> **Status: proposed.** This record is agent-drafted and requires explicit human
> ratification before it becomes project law.

## Context

adrkit records decisions that people review and ratify. Its accepted records
constrain future work through typed lifecycle states, relationships, `affects`
resolution, pull-request context, and deterministic checks. The rejected,
superseded, and deprecated records remain part of the corpus because knowing
what no longer governs is part of decision memory.

Generated knowledge systems solve a related but different problem. They inspect
source material, synthesize documentation, and update that documentation as the
system changes. OpenWiki 0.4 is a concrete example: its grounded Claims associate
factual statements with versioned repository evidence, while OKF v0.2 exposes
page-level provenance and verification metadata.

The two categories overlap in storage and audience. Both can produce Markdown in
git, cite repository evidence, and provide context to coding agents. That overlap
can obscure the authority boundary:

- implementation evidence can show that code changed, but cannot establish that
  people changed their decision;
- machine verification can confirm generated content against its sources, but
  is not human ratification of a decision;
- a generated current-state page can omit historical decisions for readability,
  while a governance corpus must retain them to prevent re-litigation; and
- an untyped documentation link can connect two pages, while adrkit's
  `supersedes`, `relatesTo`, and `conflictsWith` edges carry different lifecycle
  consequences.

ADR-0001 and ADR-0004 already make git the decision source of truth and derived
indexes disposable. ADR-0007 keeps integrations optional. ADR-0027 states that
models produce evidence and route to people; they do not approve. This record
applies those existing commitments to generated knowledge systems and defines
the first interoperability posture.

## Decision

We will treat generated knowledge systems as downstream read models of adrkit's
human-reviewed decision corpus, not as decision authorities.

1. **The ADR corpus remains authoritative.** A decision's lifecycle, review
   state, typed relationships, and scope of effect change only through the
   repository's normal pull-request and human-review process. A generated page,
   Claim, index, verification event, or summary cannot accept, reject, deprecate,
   or supersede a decision.
2. **Generated knowledge may consume decisions as evidence.** A downstream
   system may cite ADRs, explain active decisions, present decision history, and
   connect decisions to its description of the current architecture. Its output
   is a projection and must link back to the source record when authority
   matters.
3. **Lifecycle meanings remain distinct.** Integrations must preserve the
   difference between governing (`accepted`), under-review (`draft` and
   `proposed`), and historical (`rejected`, `superseded`, and `deprecated`)
   decisions. They must not map adrkit acceptance to a documentation format's
   "stable" state, or machine verification to `provenance.ratifiedBy`, as though
   those concepts were equivalent.
4. **Typed relationships must remain legible.** A projection may render ordinary
   links, but it must label `supersedes`, `relatesTo`, and `conflictsWith` rather
   than flattening them into one relationship. When a target format cannot
   preserve a type structurally, the projection must disclose that loss and link
   to the original record.
5. **Evidence drift is advisory until evaluated.** A changed or missing source
   means the affected description or decision evidence needs review. It does not
   by itself prove that an accepted decision was violated or should change.
   Only an adrkit deterministic assertion that actually evaluates may report
   pass or fail; unavailable evidence remains explicit rather than becoming a
   successful result.
6. **Writers stay separated.** Generated knowledge tooling must not write
   `docs/adr/**`. It may update its own output in a separate branch or pull
   request. adrkit continues to surface governing decisions on the source change
   itself; downstream documentation may reconcile after that change lands.
7. **Failures and credentials remain isolated.** No generated-knowledge
   dependency, model credential, network call, or update failure may become a
   prerequisite for `@adrkit/core`, the CLI's deterministic commands, the MCP
   read path, or the governing-decisions Action.
8. **Start with a public recipe, not a runtime adapter.** The first integration
   is documentation showing how to run adrkit and OpenWiki side by side and how
   to instruct OpenWiki to treat the ADR corpus as read-only normative evidence.
   A documentation agent may read the source records directly under this
   version-bounded guidance; that is evidence consumption, not a programmatic
   parsing contract. Programmatic consumers remain bound to documented adrkit
   CLI or SDK contracts.
   A package, bidirectional synchronization protocol, persistent claims mirror,
   or evaluator input requires a separate decision supported by observed
   consumer need.
9. **Public comparisons use public evidence.** Interoperability documentation
   describes observable behavior and cites primary public sources. It does not
   publish private correspondence, non-public usage data, or speculative claims
   about another project's direction.

This record authorizes the documentation recipe and the authority boundary. It
does not authorize a schema change, an OpenWiki dependency, a generic factual
Claims store, a new evaluator pass, or publication of `@adrkit/sdk`.

## Options considered

### Option A: Separate authority from presentation and integrate by recipe

**Chosen.** adrkit remains responsible for ratified decision semantics and
enforcement. Generated knowledge systems remain responsible for synthesized
current-state documentation. A small recipe connects them without coupling
their runtimes.

### Option B: Build a generated architecture wiki inside adrkit

This would provide one product surface, but it would duplicate model-provider,
documentation-maintenance, visualization, and connector work that is not needed
to answer which decisions govern a change. It would also make model-backed
generation part of a project whose core is deliberately deterministic and
offline.

### Option C: Synchronize decision state bidirectionally

This could make generated pages appear immediately current, but it creates two
writers for lifecycle state and gives machine-generated content a path to alter
human-ratified governance. Conflict resolution would require a second authority
system beside git.

### Option D: Document no integration

This preserves the smallest surface, but leaves adopters to infer the authority
boundary and risks generated summaries presenting proposals or historical
records as current decisions.

## Trade-offs

The recipe is less seamless than a dedicated adapter, and downstream pages may
lag the ADR corpus until their own update workflow runs. Users operate two tools
and must understand which output each owns.

Preserving typed lifecycle and relationship semantics may require more explicit
prose than a generated wiki would otherwise produce. Refusing bidirectional
writeback also means a detected mismatch becomes review work rather than an
automatic correction.

The boundary narrows adrkit's product scope. It deliberately gives generated
documentation, visualization, and factual-claim maintenance to other tools, even
when those capabilities could improve adrkit's presentation.

## Consequences

- Easier: adopters can combine decision governance with generated architecture
  documentation without creating competing sources of truth.
- Easier: adrkit can use a larger documentation ecosystem as a distribution
  surface while keeping its deterministic and credential-free core.
- Harder: integrations must preserve distinctions that generic document formats
  may not encode directly.
- Harder: a code-to-decision mismatch requires explicit review instead of
  automatic reconciliation.
- **How we would know this was wrong:** a programmatic consumer cannot
  distinguish governing, under-review, and historical decisions through
  published adrkit contracts without implementing its own frontmatter parser or
  reimplementing adrkit semantics. Direct source reading by a documentation
  agent under the version-bounded recipe is not that programmatic contract.
- Revisit if: a docs-only recipe cannot preserve typed status and relationships,
  or an independently maintained integration demonstrates a safe need for a
  versioned adapter contract.

## Action items

1. [~] Draft the authority boundary near the top of the public README and
       documentation homepage; publish it only with an explicit proposed-state
       qualifier until this record is ratified.
2. [~] Draft a provisional generated-knowledge coexistence guide with an
       OpenWiki `INSTRUCTIONS.md` example.
3. [~] Keep the first integration documentation-only and dependency-free;
       reference validation remains open.
4. [ ] Exercise the recipe in a public reference repository using active,
       proposed, rejected, and superseded decisions.
5. [ ] Propose the verified recipe to OpenWiki's public documentation or examples.
6. [ ] Feed this integration's observed consumer requirements into ADR-0031's
       existing SDK publication gate rather than creating a second gate here.
7. [ ] Scope any implementation-evidence freshness feature in a separate ADR
       against the existing assertion and evidence-status vocabulary.
8. [ ] Update every public proposed-state qualifier in the same pull request that
       accepts, rejects, supersedes, or otherwise changes this record's status.
