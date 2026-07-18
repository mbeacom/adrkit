---
schemaVersion: 0.1.0
id: "0008"
title: Migrate MADR corpora in place and treat all other imports as one-way with a re-import diff
status: proposed
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [import, migration, interop, adoption]
scope: org
reversibility: two-way-door
blastRadius: cross-team
relatesTo: ["0002", "0004", "0007"]
affects:
  - type: path
    pattern: "packages/adapters/import-*/**"
  - type: path
    pattern: "packages/core/src/import/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Determines whether imported records carry governance authority they never
    earned. Low technical risk, high governance risk.
---

# ADR-0008: Migrate MADR corpora in place and treat all other imports as one-way with a re-import diff

## Context

Three import sources are in scope, serving different outcomes: an existing MADR
corpus (adoption), an agent-team framework's `decisions.md` (differentiation),
and spec-driven plan artifacts (strategy). MADR is first.

Choosing MADR first materially changes the question that looked hardest. The
open worry was what status imported records should carry — importing unreviewed
agent output as `accepted` would launder ungoverned decisions into binding
governance, while importing everything as `draft` manufactures a backlog nobody
triages.

**That dilemma is specific to sources with no status of their own.** MADR
records carry a status field natively, and those decisions were made and
reviewed by humans before this tool existed. Assigning them a uniform default
would either demote decisions already in force or fabricate authority. The right
answer is not a global default at all.

The second observation follows from ADR-0002. Because the schema is a strict
MADR superset, adding frontmatter to a MADR file leaves it a valid MADR file.
Migration is therefore **additive and in place** — existing MADR tooling keeps
rendering the same files, and there is no second copy to drift from. For the
primary adoption path, the drift problem largely does not exist.

## Decision

### Status is a function of source authority, not a global default

| Source | Status on import |
|---|---|
| MADR corpus | **Preserve the source status.** Map `accepted`/`proposed`/`deprecated`/`superseded` directly; unrecognized values become `proposed` with a lint finding. |
| Agent decision log | `proposed`, with the evaluator's deterministic pass run on ingest. Findings-free records surface as a fast-path queue; the rest queue normally. |
| Plan artifact | `draft`. A plan is a proposal by construction. |

This resolves the `proposed` vs `proposed + auto-triage` question by scoping it:
auto-triage is the right treatment for statusless agent output, and is simply not
applicable to MADR, which has status to preserve.

### MADR is a migration, not an import

`adr migrate --from madr` rewrites files in place, adding frontmatter and leaving
the body untouched. No second corpus, no sync relationship, no source to diverge
from. Idempotent: re-running on a migrated file is a no-op.

### Everything else is one-way, with a re-import diff

No round-trip sync. The upstreams are other projects' formats moving on other
projects' schedules — at least one is explicitly alpha — and bidirectional
conflict resolution against a moving target is permanent cost for a benefit
nobody has asked for yet.

Instead, each imported record carries a **source fingerprint**: a source-local
identifier plus a content hash of the source entry. Re-import classifies every
entry into exactly one bucket:

| Bucket | Condition | Action |
|---|---|---|
| **new** | fingerprint unseen | create record |
| **updated** | source hash changed, record untouched since import | update record |
| **diverged** | both source and record changed since import | **report only** |
| **unchanged** | neither changed | no-op |

**Diverged records are never auto-overwritten.** The reviewed record is the more
authoritative artifact; silently replacing it with regenerated upstream text
would discard exactly the human judgment this project exists to preserve.

Every re-import produces a pull request, never a direct mutation — ADR-0004's
git-truth rule applies to machine writes as much as to human ones.

### Imported records may be `accepted` without deciders

ADR-0002 already provides for this: `provenance.importedFrom` records the source
kind, reference, and fingerprint, and its presence exempts the record from the
deciders-required invariant. This record adds only the lint behaviour —
`import-incomplete` at `info` severity — so that gaps stay visible and
backfillable rather than silently permanent.

## Options considered

### Option A: Source-dependent status, in-place MADR migration, one-way + diff (chosen)
Honest about provenance, cheap for the primary adoption path, defers all
complexity to sources that actually need it.

### Option B: Single global import status
One rule, easy to explain. But every choice of default is wrong for at least one
source — `accepted` launders agent output, `proposed` demotes decisions already
in force.

### Option C: Round-trip sync
Keeps both representations live. Costs permanent conflict resolution against
pre-1.0 upstreams, and creates a second writer to a corpus whose whole value is
being reviewable. Revisit only if a real adopter maintains both deliberately.

### Option D: Import everything through a model
Handles arbitrary formats with no per-source parser. Non-deterministic, so the
same input can produce different records on different runs — disqualifying for a
governance artifact. Reserve models for *suggesting* field values a human
confirms, never for the parse itself.

## Trade-offs

Preserving source status means importing decisions that were never evaluated by
this tool as `accepted`. Accepted deliberately: they were in force before the
tool arrived, and demoting them would misrepresent the organization's actual
state. The evaluator can be run over them retrospectively as a separate,
opt-in pass.

Per-source status rules mean three code paths where one would do, and the rule
must be restated for every future source.

Fingerprinting an append-only log is harder than fingerprinting files — the N:1
split granularity is the real engineering problem, and it lands in the agent
decision-log adapter, not here.

## Consequences

- Easier: adopting MADR corpora (additive, reversible, non-destructive);
  explaining to a risk function why an imported record claims the status it does.
- Harder: three status rules to maintain; divergence reports need somewhere to
  live and someone to read them.
- Deliberately deferred: the N:1 split problem for agent decision logs, which
  needs a real sample of the upstream format before it can be specified
  deterministically. That work belongs in its own record.
- Revisit if: an adopter genuinely maintains a source corpus in parallel
  long-term. That is the only case where round-trip earns its cost.

## Action items

1. [ ] `import-incomplete` lint rule (schema support already lands in ADR-0002)
2. [ ] `adr migrate --from madr`, idempotent, in place, body untouched
3. [ ] Fingerprint + four-bucket classifier in `packages/core/src/import/`
4. [ ] Re-import emits a PR with a divergence report; never a direct write
5. [ ] Round-trip explicitly documented as unsupported, with this record as the
       reason
