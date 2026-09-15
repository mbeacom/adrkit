---
schemaVersion: 0.1.0
id: "0038"
title: "Offer the bootstrap decision record as an offer rather than a backfill candidate"
status: proposed
date: 2026-09-08
deciders:
  - "@mbeacom"
tags:
  - agent-plugin
  - backfill
  - governance
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo:
  - "0001"
  - "0008"
  - "0016"
  - "0028"
  - "0034"
affects:
  - type: path
    pattern: "packages/adapters/agent-plugin/**"
  - type: path
    pattern: "site/src/content/docs/backfill.mdx"
  - type: path
    pattern: "site/src/content/docs/quickstart.mdx"
  - type: path
    pattern: "docs/reference-verification-agent-plugin.md"
provenance:
  authoredBy: agent-drafted
review:
  tier: auto
  tierReason: Guidance-only change to one adapter; sole decider.
reviewBy: 2027-09-08
---

# ADR-0038: Offer the bootstrap decision record as an offer rather than a backfill candidate

## Context

`/adr-backfill` audits a repository for decisions that were made but never
recorded. Run against a repository with no corpus at all, it finds the decisions
*in* the code and says nothing about the one decision the caller is in the
middle of making: whether to keep decision records here, and whether adrkit is
how they will be enforced.

That record is the one adrkit itself keeps as
[ADR-0001](./0001-record-architecture-decisions-in-git.md). Its absence in a
consumer repository is not cosmetic — it is the record that explains `docs/adr/`
to whoever finds the directory in a year, and the one that carries the rejected
alternatives (a database-backed tool, a wiki) that otherwise get re-proposed.

Two forces make this awkward rather than obvious:

- **It is not archaeology.** Every other backfill candidate is admitted on
  evidence: a source span, a commit, a plan. Nothing in a repository proves a
  human chose to keep ADRs, because at the moment backfill runs, nobody has. The
  skill's own admission rule — *code proves what exists, not why it was chosen* —
  excludes it, correctly.
- **It cannot travel through the handoff.** A `backfillHandoff` carries concrete
  `candidatePaths`, never globs, and `/adr-draft` re-runs `adr check` over
  exactly those paths before writing. The bootstrap record governs the corpus
  directory itself, which is a glob and frequently does not exist yet. There are
  no paths to snapshot.

There is also a live way to get the relationship backwards. "Adopt adrkit" is a
*tooling* decision that depends on the *process* decision to record decisions at
all. An agent that treats the two as one thing will propose superseding a
consumer's existing process ADR — reversing a decision the consumer never asked
to reverse, and reading as tooling imperialism — when the honest edge is
`relatesTo`.

## Decision

Backfill **offers** the bootstrap record and never mines it. The offer is
reported under existing corpus state and named in the recommended next action,
explicitly marked as an offer rather than a candidate. It stays out of the
candidates table and out of every `backfillHandoff`, and is routed to plain
`/adr-draft` — the non-backfill path, where the caller supplies the authority
the evidence cannot.

The edge is read off the corpus rather than assumed:

| Corpus state | Offer | Edge |
| --- | --- | --- |
| No corpus, or records exist but none govern the corpus directory | Process and tooling decision | `relatesTo` between them when split |
| A process record governs the corpus directory | Tooling decision only | `relatesTo` that record |
| A prior tooling record governs it | Tooling decision | `supersedes` that prior tooling record |

Adopting adrkit is never a supersession of the decision to record decisions.
`supersedes` is reserved for a prior *tooling* record (`adr-tools`,
`log4brains`, a bespoke MADR script). An existing MADR corpus is migrated by
`adr migrate --from madr`, not superseded.

Detection runs through the CLI — `adr check` over one record already inside the
corpus, reading the `governing` bucket — because this skill forbids hand-parsing
frontmatter, and an invalid record drops out of the parsed corpus, so a grep for
a meta tag can be confidently wrong.

The exit code is read before the bucket, and that ordering is load-bearing rather
than stylistic. Measured against a synthetic unmigrated MADR corpus, `adr check`
returns an empty `governing` bucket *and* `frontmatter-fence` errors at exit `1`,
because no record parses — including the one that is the process decision. The
empty bucket is a parse failure wearing the costume of an absence. Only on exit
`0` does it mean no process record exists; on exit `1` the offer is unverified
until the corpus is migrated or repaired.

## Options considered

### Option A: Offer it outside the candidate handoff (chosen)

| Dimension | Assessment |
|---|---|
| Handoff contract | Untouched — no exemption, no synthetic paths |
| Honesty | The record is labeled as what it is: a current decision |
| Cost | Guidance only; no CLI or schema change |
| Reach | Only where the plugin is installed |

### Option B: Admit it as a candidate with an exempted handoff

Model the bootstrap record like any other candidate and carve out an exception
to the `candidatePaths`-never-globs rule.

Rejected. The rule exists so `/adr-draft` can re-verify a candidate against the
corpus immediately before writing and refuse a stale one. A candidate exempt
from that check is a candidate nobody re-verifies, and the exemption would be
available to every future candidate that finds concrete paths inconvenient. It
also asserts evidence that does not exist.

### Option C: A CLI affordance (`adr init`, or `adr new --bootstrap`)

Rejected for now, and partly moot: `createAdr` already creates the corpus
directory and allocates `0001`, so the mechanism exists and the gap is the
prompt and the content. Baking one opinionated record body into `@adrkit/core`
puts prose in the hardest place to revise, and makes the tool write an opinion
rather than offer one. Reconsider if the offer proves valuable to people who do
not install the plugin.

### Option D: Leave it to the documentation

`site/src/content/docs/quickstart.mdx` already calls `adr new` the bootstrap
step. Rejected as insufficient alone — the documentation is read by the person
setting adrkit up, while the agent auditing the repository is the one holding
the empty-corpus finding. The quickstart is updated as well, not instead.

## Trade-offs

The offer reaches only repositories that install the plugin; a consumer driving
the CLI directly still gets nothing. Backfill's report grows a section that is
noise for the common case of a repository that already has a healthy corpus and
a process record. And the record being offered is worth writing only if the
caller can name a real rejected alternative — an ADR that says "we decided to
use ADRs" and nothing else is ceremony that `lint` will nag about forever, so
the guidance offers a decision to make rather than a template to accept.

## Consequences

- Easier: an agent auditing an empty repository names the missing process and
  tooling decisions instead of silently reporting no candidates; the
  `relatesTo`-vs-`supersedes` distinction is stated once, in a place both skills
  can be tested against.
- Harder: the backfill report has one more conditional section, and the edge
  table has to stay correct as adrkit's own relationship vocabulary evolves.
- **How we would know this was wrong:** a consumer's bootstrap record lands with
  no rejected alternative and no `affects` matcher, an agent proposes superseding
  a consumer's existing process ADR, or the offer is made to a repository that
  already has a process record it could not parse. The third was found during
  implementation against a MADR fixture and is now defended by the exit-code
  precondition; the first two remain live risks.
- Revisit if: a CLI-level affordance is requested by someone not using the
  plugin, or a functional run shows hosts do not surface the offer on an empty
  corpus.

## Action items

1. [x] Add the bootstrap section to `decision-backfill`, with the edge table and
   CLI-based detection.
2. [x] Add the matching no-corpus clause to `decision-memory`.
3. [x] Add a wiring test, observed failing first per ADR-0016.
4. [x] Measure the detection mechanic against synthetic corpora — empty, source-only,
   process-record-present, and unmigrated MADR — and record the results in
   `docs/reference-verification-agent-plugin.md`.
5. [ ] Exercise the offer in a functional host run against an empty-corpus
   consumer. Detection is measured; whether a host surfaces the offer at all is
   not.
