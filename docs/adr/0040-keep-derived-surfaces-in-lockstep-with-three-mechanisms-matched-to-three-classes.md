---
schemaVersion: 0.1.0
id: "0040"
title: "Keep derived surfaces in lockstep with three mechanisms matched to three classes of drift"
status: proposed
date: 2026-09-23
deciders:
  - "@mbeacom"
tags:
  - governance
  - ci
  - docs
  - cli
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo:
  - "0004"
  - "0005"
  - "0007"
  - "0008"
  - "0016"
  - "0022"
  - "0023"
  - "0031"
  - "0033"
  - "0039"
affects:
  - type: path
    pattern: "scripts/emit-manifest.ts"
  - type: path
    pattern: "scripts/check-stale-adr-references.ts"
  - type: path
    pattern: "MANIFEST.md"
  - type: path
    pattern: "AGENTS.md"
  - type: path
    pattern: "CONTRIBUTING.md"
  - type: path
    pattern: ".github/workflows/ci.yml"
provenance:
  authoredBy: agent-drafted
review:
  tier: auto
  tierReason: Repo-local guards and a scoping decision; no public surface added; sole decider.
reviewBy: 2027-09-23
---

# ADR-0040: Keep derived surfaces in lockstep with three mechanisms matched to three classes of drift

## Context

A single pull request ([#129](https://github.com/mbeacom/adrkit/pull/129))
produced two drift incidents that no gate caught. ADR action-item checkboxes
claimed work that the tree did not contain. `MANIFEST.md` published a record
inventory that had drifted six records — 19 records where there were 25, six
`proposed` where one was. Both were hand-maintained mirrors of state the corpus
already defines, and both were corrected by hand, which is how they drifted in
the first place.

The tempting generalisation — "make the CLI keep the docs in sync" — is one
feature only if you do not look closely. Three different kinds of artifact were
involved, and they do not have the same answer. Conflating them produces either
an unbuildable feature or, worse, a gate that reports green while checking
nothing. [ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
exists because this repository has shipped that second failure before.

Three existing constraints are load-bearing on anything built here, and each
one rules out part of the obvious design:

1. **The public write surface is deliberately small.** Only `new` and `migrate`
   write. The Spec Kit adapter holds a *tested* invariant that hooks reach only
   non-writing commands, so any new writing command must stay unreachable from
   hooks or that test breaks.
2. **Machine writes go through pull requests.**
   [ADR-0008](./0008-import-and-migration-semantics.md) applies
   [ADR-0004](./0004-git-is-source-of-truth-database-is-an-index.md)'s
   git-truth rule to machine writes explicitly. A command that silently rewrites
   tracked documentation contradicts it.
3. **Public CLI surface is a semver commitment**, maintained indefinitely
   ([ADR-0031](./0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)).
   `adr graph --format json` already emits `id`, `title`, `status`, and
   `supersedes` edges, so a new command would largely reformat data that ships
   today.

The scoping discussion is [#132](https://github.com/mbeacom/adrkit/issues/132),
with the split below refined by @davesheffer in that thread.

## Decision

We will treat "derived surfaces" as **three classes with three different
mechanisms**, and we will not build one feature that claims to cover all three.

| # | Class | Example | Derivable? | Mechanism |
|---|---|---|---|---|
| 1 | Derived inventory | `MANIFEST.md` record table and counts | Yes — a pure function of the corpus | Generate, then `git diff --exit-code` |
| 2 | Referential integrity | A doc citing `ADR-0021` without noting it is superseded | Checkable, not generatable | Lint — two rules, one successor definition |
| 3 | Implementation claims | ADR action-item checkboxes | Neither | Process only; explicitly out of scope for tooling |

Four specific commitments follow.

**Class 3 is the honest limit, and we say so.** No tool can decide whether
"conformance fixture suite" is *done*; that is a judgment about the tree. The
mechanism is the review expectation set in #129 — verify each claim against the
repository before ticking, and leave items unchecked when the evidence does not
support them. Automating it would be precisely the evaluator theater
[ADR-0005](./0005-deterministic-first-evaluator-with-declarative-escalation.md)
warns against, and
[ADR-0027](./0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
supersedes 0005 without relaxing that warning.

**Class 2 is two rules, not one.** They share one definition of "successor" and
nothing else:

- *Markers* — `@adr 0021` in source. High-confidence grammar, exact source
  location, an inbound governance declaration. Shipped as advisory
  `stale-marker` findings on the `explain` / `check` marker-resolution path
  under [ADR-0022](./0022-scan-inbound-markers-in-check-and-ci-without-giving-them-exit-code-authority.md)
  and re-dated by `--as-of` under
  [ADR-0039](./0039-derive-a-valid-time-window-from-date-and-supersession-and-resolve-a-git-ref-at-th.md).
- *Prose* — `ADR-0021` in a sentence. A different scan scope, a different
  syntax, a different acknowledgement grammar, and a materially different
  false-positive policy. It is a **repo-local guard**, and it never treats
  prose as an inbound governance declaration.

**The inventory formatter stays repo-local.** `adr graph --format json` already
exposes the data; `scripts/emit-manifest.ts` renders it here. A public Markdown
inventory contract is a genuinely new surface and waits for adopter demand.

**Neither rule gains exit-code authority over the corpus.** The prose guard
fails its own `clean-clone-builds` step — that is a repository gate over this
repository's documentation. It does not change `adr lint`, `adr check`, or the
governing-decisions Action, and no `--strict` promotion of marker findings is
authorized here; ADR-0022 denies them exit-code authority deliberately, and
reversing that needs its own record.

### In scope for the prose guard

`MANIFEST.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
`docs/` (excluding `docs/adr/`), and `site/src/content/docs/` (excluding the
generated corpus mirror at `site/src/content/docs/adr/`).

### Deliberately out of scope

- **`docs/adr/` itself.** A record narrating its predecessor — "ADR-0021
  refused per-language parsing, and this record keeps that refusal" — is the
  corpus working correctly. The supersession edge is already in frontmatter and
  already linted.
- **`CHANGELOG.md`, `specs/`, `plan.md`.** Historical by construction. A
  changelog entry describing what shipped in v0.4.0 must keep naming ADR-0021;
  rewriting it would be falsifying a record of the past.
- **Source and test files.** Code comments narrating history are not prose
  documentation, and a source file that wants to declare governance has `@adr`,
  which is already covered by rule 1.

At today's corpus those exclusions are the difference between one finding and
149 mentions, nearly all of them legitimate.

## Options considered

### Option A (chosen): three mechanisms, two class-2 rules, no new public surface

| Dimension | Assessment |
|---|---|
| Public surface added | None. `graph --format json` is the only data source. |
| Write surface | Unchanged; the Spec Kit hook invariant holds untouched. |
| Honesty | Class 3 is named as unautomatable rather than faked. |
| False-positive cost | Bounded by an explicit, recorded scan scope. |
| Adopter benefit | Deferred — adopters get the pattern, not a shipped formatter. |
| Cost | Two guards to maintain; the scope list is itself hand-maintained state. |

### Option B: one `adr sync` command that rewrites tracked docs

**Pros:** one obvious verb; adopters get the capability immediately.
**Cons:** contradicts ADR-0008's machine-writes-through-PRs rule; enlarges the
write surface from two commands to three; breaks the Spec Kit adapter's tested
hook invariant or forces an exception to it; commits forever to a Markdown
rendering contract that no adopter has yet asked for; and still cannot touch
class 3, so it would ship as "keeps your docs in sync" while silently covering
one class of three.

### Option C: one lint rule covering markers and prose together

**Pros:** one code path, one finding vocabulary, one definition of successor.
**Cons:** the two differ in every dimension that governs a lint rule — scan
scope (a declared marker window versus whole documents), syntax (`@adr 0021`
versus `ADR-0021`), acknowledgement grammar (there is none for a marker; prose
needs one), and false-positive policy. Folding them makes prose an inbound
governance declaration, which it is not: a sentence *about* a decision is not a
claim to live under it. It would also have to inherit ADR-0022's exit-code
denial, which is right for markers and wrong for a repository's own docs gate.

### Option D: do nothing

**Pros:** no new guards; review catches it.
**Cons:** review already did not — twice, in one pull request. The inventory is
derived state, and derived state that a human maintains by hand drifts the
moment attention moves. This is the failure mode the project exists to end.

## Trade-offs

- **The scan scope is hand-maintained state, and this record says so.** A new
  top-level prose document is not guarded until someone adds it to the list.
  That is the price of avoiding 149 findings; the alternative — scan
  everything, suppress by rule — was worse because the suppression list would
  have been longer and less legible than the inclusion list.
- **Guard count grows.** `clean-clone-builds` gains a step, and every gate is
  something to keep honest.
- **The acknowledgement grammar is a heuristic.** A paragraph naming both a
  superseded record and its successor passes. A doc that names them three
  paragraphs apart does not. The rule is deliberately mechanical so its failures
  are predictable, not clever so they are surprising.
- **Adopters get no shipped inventory formatter**, only the pattern. Someone
  will ask.

## Consequences

- **Easier:** the inventory cannot reach `main` stale; a user-facing doc cannot
  keep citing a superseded record as live authority; and a future "why isn't
  there an `adr sync`?" has an answer with reasons rather than a shrug.
- **Harder:** adding a guarded document requires an edit to the scope list; a
  contributor citing history in `README.md` must name the successor alongside.
- **How we would know this was wrong:**
  - The prose guard fires on more than a handful of legitimate historical
    citations in a quarter, or contributors start splitting sentences to appease
    it — the acknowledgement grammar is then wrong, not the citation.
  - A drift incident lands on `main` in a guarded file that the guard did not
    catch — the scope list or the grammar has a hole.
  - Two or more adopters ask for a supported Markdown inventory — the
    repo-local-only half of this decision expires and a public formatter gets
    its own record.
  - Class 3 checkbox drift recurs after #129's review expectation — process
    alone is insufficient and the answer is a smaller claim vocabulary, not
    automation.
- **Revisit if:** adopter demand justifies a public `stale-reference` lint or a
  Markdown inventory formatter; or a decision is taken to give marker findings
  exit-code authority, which would change ADR-0022's contract and want one
  record covering both rules' severities.

## Action items

1. [x] Generate the `MANIFEST.md` inventory and gate it on no-diff
       (`scripts/emit-manifest.ts`, [#131](https://github.com/mbeacom/adrkit/issues/131)).
2. [x] Ship advisory `stale-marker` findings on the marker-resolution path
       ([#116](https://github.com/mbeacom/adrkit/issues/116) part A, ADR-0022).
3. [x] Ship `scripts/check-stale-adr-references.ts` with the scan scope above,
       observed failing against a real defect before it counts as coverage
       (ADR-0016).
4. [x] Record the class-3 review expectation in `CONTRIBUTING.md` so it is a
       stated expectation rather than folklore from one pull request.
5. [ ] Revisit the public Markdown inventory formatter when a second adopter
       asks, or close this item at the `reviewBy` date.
6. [ ] When this record is accepted, update every public proposed-state
       qualifier naming it in the same pull request that flips the status —
       `AGENTS.md` carries one. ADR-0037 lacked this item and needed
       [#216](https://github.com/mbeacom/adrkit/pull/216) to clean up after its
       acceptance.
7. [ ] Decide whether the network-denial step count in
       `specs/010-catalog-backstage/` should be derived rather than restated in
       four places. Correcting it by hand here found it already drifted by one,
       which is this record's own argument arriving from outside its scope.
