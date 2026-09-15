---
schemaVersion: 0.1.0
id: "0038"
title: "Offer the bootstrap decision record as an offer rather than a backfill candidate"
status: accepted
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
  ratifiedBy: "@mbeacom"
review:
  tier: auto
  tierReason: Guidance-only change to one adapter; sole decider.
reviewBy: 2027-09-08
---

# ADR-0038: Offer the bootstrap decision record as an offer rather than a backfill candidate

> **Status: accepted.** Agent-drafted and explicitly ratified by `@mbeacom` on
> 2026-09-15, after the 0.3.1 corrections to the detection mechanic and the
> first functional run of the write path. The decision is unchanged from the
> original proposal; the mechanic that implements it was wrong three times over
> and is recorded in Consequences. Action items 5, 7 and 8 remain open.

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
| No corpus, or no record in any bucket covers the corpus directory | Process and tooling decisions | `relatesTo` between them when split |
| An `accepted` process record governs the corpus directory | Tooling decision only | `relatesTo` that record |
| A process record covering it is already `draft`/`proposed` | Nothing; name ratification as the next step | none |
| A process record covering it is `rejected`/`superseded`/`deprecated` | Nothing; report the record | none — never re-propose |
| A prior tooling record governs it | Tooling decision | `supersedes` that prior tooling record |

Adopting adrkit is never a supersession of the decision to record decisions.
`supersedes` is reserved for a prior *tooling* record (`adr-tools`,
`log4brains`, a bespoke MADR script). An existing MADR corpus is migrated by
`adr migrate --from madr`, not superseded.

Detection runs through the CLI — `adr check` over one record already inside the
corpus — because this skill forbids hand-parsing frontmatter, and an invalid
record drops out of the parsed corpus, so a grep for a meta tag can be
confidently wrong.

**All three buckets are read, not `governing` alone.** `governing` holds
`accepted` records only; `activeProposals` holds `draft` and `proposed`, and
`history` holds `rejected`, `superseded`, and `deprecated`. Reading `governing`
by itself reports the other two as absence, and two of those misreadings are
reachable through ordinary use:

- `/adr-draft` writes a new record as `proposed`, so the record this very offer
  produces lands in `activeProposals`. Backfill run again before a human
  ratifies it would offer the same decision a second time — the tool
  re-offering its own output.
- A repository that explicitly `rejected` keeping decision records would have
  that decision re-proposed, which is the third failure the decision-memory
  skill exists to prevent.

The exit code is read before the buckets, and that ordering is load-bearing
rather than stylistic. Measured against a synthetic unmigrated MADR corpus,
`adr check` returns empty buckets *and* `frontmatter-fence` errors at exit `1`,
because no record parses — including the one that is the process decision. The
empty result is a parse failure wearing the costume of an absence.

**The corpus-wide signal is `adr lint`, not `adr check`.** `adr check`'s exit
code is scoped to the paths it was handed (ADR-0022), so a malformed record
*elsewhere* in the corpus leaves it at exit `0` with an empty result while the
process record sits unparsed and undetected. Corpus-wide `adr lint` must reach
exit `0` before an empty result is read as absence.

The offer category is fenced: the bootstrap record is the **only** recognized
offer. Any future non-evidence-backed entry in the report requires its own
decision record, so that "Existing corpus state" does not become a side channel
around the candidate admission rule.

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
- **Amended 2026-09-15 (0.3.1), after review of the 0.3.0 implementation.** Three
  further ways this was wrong were found by executing the CLI rather than
  reasoning about it, and all three shipped in 0.3.0:
  - Reading `governing` alone treated a `proposed` or `rejected` process record
    as absent. Executed: a record with `affects: docs/adr/**` at `status:
    proposed` returns exit `0`, `governing: []`, `activeProposals: ["0001"]`; at
    `status: rejected` it returns `history: ["0001"]`. Because `/adr-draft`
    writes `proposed`, the offer re-offered its own output.
  - The exit-code guard read `adr check`'s exit code, which is path-scoped, as
    though it certified the corpus. Executed: a malformed process record beside
    a healthy record returns exit `0` with *empty* findings when the healthy
    record is probed, while corpus-wide `adr lint` exits `1`.
  - The offer named `/adr-draft`, whose gate stopped on `adr lint` exit `2` —
    exactly what a repository with no corpus returns — so the headline case
    could not be written at all. Executed: `adr lint` exits `2` there while
    `adr new` exits `0` and creates the corpus.
  - A fourth, found by the first functional run of the write path rather than by
    review: `adr new` scaffolds `affects: []`, so the bootstrap record written
    through this offer's own prescribed path binds nothing and is invisible to
    detection — every bucket empty, and the next audit offers it again. This is
    the failure named directly above under *how we would know this was wrong*,
    and it was the default behavior all along. The offer now states that the
    record must carry an `affects` matcher covering the corpus directory.
- Revisit if: a CLI-level affordance is requested by someone not using the
  plugin, or a functional run shows hosts do not surface the offer on an empty
  corpus.

## Ratification

Ratified 2026-09-15 by @mbeacom, after the 0.3.1 corrections and the first
functional run of the write path. The decision itself — offer the bootstrap
record, never mine it — is unchanged from the original proposal; what changed
before ratification was the detection mechanic, the reachability of the
guidance from the command, and the requirement that the record bind the corpus
directory. Action items 5, 7 and 8 remain open and are tracked, not closed by
ratification.

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
   not, and neither is whether the write path it names completes end to end.
6. [x] **0.3.1** — read all three buckets, gate on corpus-wide `adr lint`, port
   the detection procedure into `commands/adr-backfill.md` so it is reachable
   from the entry point, and narrow `/adr-draft`'s exit-`2` gate so an absent
   corpus directory proceeds to `adr new`. Re-measured against `proposed`,
   `rejected`, and mixed-validity corpora.
7. [ ] Resolve whether `ADR_DIR` resolution should consult step-1 discovery. A
   pre-adrkit MADR corpus at a non-default path (`docs/decisions/` is MADR's own
   convention) resolves to a nonexistent `docs/adr`, exits `2`, and is read as
   "no corpus" rather than routed to migration. Narrowed in guidance for 0.3.1;
   not yet fixed in resolution order.
8. [ ] Mirror the no-corpus clause into `/adr-context` and `/adr-check`, or
   record why decision-memory's sibling commands are deliberately excluded.
