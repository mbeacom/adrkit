# Feature Specification: Affects Resolution

**Feature Branch**: `002-affects-resolution`
**Created**: 2026-07-18
**Status**: Draft
**Phase**: 1 (outcome ladder rung 3 prerequisite)
**Normative source**: [ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (one-way-door). Where this spec and ADR-0009 disagree, the ADR wins.

## Overview

A decision record is only useful for governance if a tool can answer: *given a set
of changed files, which decisions govern them?* Phase 0 made records valid and
legible. This phase makes them **locatable**: a pure resolver maps each record's
`affects` matchers onto a changed-file set (plus optional backing snapshots) and
returns the governing records, and `adr explain` shows a human *why* each record
was selected.

Because match semantics are a one-way door — once corpora exist in the wild,
changing them silently reclassifies which decisions govern which code — the
resolver ships with a **published conformance fixture suite** so the semantics are
pinned and independently verifiable.

## User Scenarios & Testing

### User Story 1 — Which decisions govern these files? (Priority: P1) 🎯 MVP

As someone reviewing a change, I give the resolver the list of files a change
touches and get back exactly the decision records that govern those files via
`path` matchers — reproducibly, with no catalog, network, or services.

**Why this priority**: This is the rung-3 core ("a PR tells you which decisions
govern it") and the only part that is fully reproducible in a clean clone with no
adapters. It is independently valuable and is the MVP.

**Independent Test**: Run the resolver over a matcher set and a changed-file list
from the conformance fixtures; assert the returned governing-record set equals the
expected set.

**Acceptance Scenarios**:

1. **Given** an ADR with `affects: [{type: path, pattern: "packages/core/**"}]`
   **and** a changed-file list containing `packages/core/src/x.ts`, **When** the
   resolver runs, **Then** that ADR is in the result, tagged with the matcher that
   fired.
2. **Given** the same ADR **and** a changed-file list with no matching path,
   **When** the resolver runs, **Then** the ADR is absent from the result.
3. **Given** an ADR with a positive matcher **and** a negated matcher
   (`negate: true`) that matches a changed file, **When** the resolver runs,
   **Then** that ADR does **not** govern (its own negation suppresses it).
4. **Given** two ADRs whose matchers both match the same file, **When** the
   resolver runs, **Then** **both** appear in the result (union, no winner).
5. **Given** ADR A's negated matcher matches file `f`, **When** the resolver runs,
   **Then** A's negation does **not** suppress ADR B's match on `f`.

### User Story 2 — Dependency decisions fire when the dependency actually changes (Priority: P2)

As an adopter with a decision about a dependency (e.g. "we standardize on React
≥19"), I want that decision flagged when a change alters that dependency in the
lockfile — and *not* flagged on a manifest-only edit that was never realized.

**Why this priority**: `package` is the second fully-deterministic matcher and the
first that resolves against a supplied backing snapshot rather than the raw file
list. It broadens usefulness beyond path globs without requiring an adapter.

**Independent Test**: Provide a changed-dependency set derived from a lockfile
change; assert `name` and `name@range` matchers fire iff a matching dependency is
in that set.

**Acceptance Scenarios**:

1. **Given** an ADR with `affects: [{type: package, pattern: "react@>=19"}]`
   **and** a lockfile change that bumps `react` to `19.1.0`, **When** the resolver
   runs, **Then** the ADR governs.
2. **Given** the same ADR **and** a change that edits only the manifest
   (dependency intent) without a lockfile change, **When** the resolver runs,
   **Then** the ADR does **not** govern.
3. **Given** a `package` matcher with a semver range **and** a lockfile change to
   the same package at a version outside the range, **When** the resolver runs,
   **Then** the ADR does **not** govern.

### User Story 3 — Explain why a decision was flagged (Priority: P2)

As a developer surprised that a decision governs my change, I run
`adr explain <path>` and see every governing record **and the specific matcher
that fired**, so a match is never unexplainable.

**Why this priority**: ADR-0009 states an unexplainable match is as bad as a wrong
one. Explainability is what makes the union-without-precedence output actionable
rather than noise.

**Independent Test**: Run `adr explain` for a path governed by two records; assert
output names both records and, for each, the matcher (type + pattern) that fired.

**Acceptance Scenarios**:

1. **Given** a path governed by one record via a `path` matcher, **When** I run
   `adr explain <path>`, **Then** output names the record and that matcher.
2. **Given** a path governed by no record, **When** I run `adr explain <path>`,
   **Then** output clearly states no decision governs it (exit 0).
3. **Given** a record whose `entity` matcher is inert (no catalog), **When** I run
   `adr explain` for a related path, **Then** the inert matcher is reported as
   unresolved (info), not as a governing match.

### User Story 4 — Stay valid without a catalog, IaC plan, or API docs (Priority: P3)

As an adopter with no developer-portal catalog, no IaC plan, and no OpenAPI
documents, I want records that use `entity`/`resource`/`api`/`data` matchers to
remain valid and simply not fire, so the tool is useful with zero infrastructure.

**Why this priority**: Degradation-not-failure (ADR-0009) extends the clean-clone
guarantee to matching. It is essential for adoption but not required for the MVP's
path-based value.

**Independent Test**: Resolve a matcher set containing `entity`/`resource`/`api`/
`data` matchers with no backing snapshots; assert zero errors, an
`affects-unresolvable` info finding per unbacked matcher, and no governing match
from them.

**Acceptance Scenarios**:

1. **Given** an ADR with an `entity` matcher **and** no catalog snapshot, **When**
   the resolver runs, **Then** it emits `affects-unresolvable` at `info` and the
   matcher contributes no match; the run is not an error.
2. **Given** a matcher whose `type` is unknown to this tool version, **When** the
   resolver runs, **Then** it emits a warning and ignores the matcher (a newer
   corpus never breaks an older tool).

### Edge Cases

- **Negation-only matcher set** (no positive matcher): the ADR never governs (a
  match requires at least one non-negated matcher to match).
- **Empty changed-file list**: `path`/`package` matchers produce no matches; run
  succeeds with an empty result.
- **`repo` qualifier** present on a matcher for a different repo/log than the one
  being resolved: the matcher does not match here (same-repo when omitted).
- **Invalid `package` semver range** or **`path` pattern with a leading slash**:
  surfaced as a finding rather than crashing; such a matcher does not match.
- **A file governed by many records**: all are returned; `explain` lists all.
- **Lockfile absent** while a `package` matcher exists: the matcher is inert with
  an `affects-unresolvable` info finding (same degradation rule).

## Requirements

### Functional Requirements

- **FR-001**: An ADR governs a changed artifact when **at least one non-negated
  matcher matches and no negated matcher matches**. Negations are scoped to the
  ADR that declares them and never suppress another ADR's match.
- **FR-002**: The result is the **union** of governing ADRs. Precedence between
  conflicting decisions is out of scope and MUST NOT be resolved at match time.
- **FR-003**: `path` matchers use picomatch glob semantics: POSIX separators,
  repo-relative with no leading slash, **case-sensitive**, `**` crosses directory
  boundaries, dotfiles matched only when the pattern says so; resolved against the
  changed-file list.
- **FR-004**: `package` matchers (`name` or `name@<semver range>`) resolve against
  a **lockfile** change set, not the manifest. A decision fires when a matching
  dependency is added/updated/removed in the lockfile; it does not fire on a
  manifest-only edit.
- **FR-005**: `entity`, `resource`, `api`, and `data` matchers MUST parse and
  validate, and MUST resolve **inert** (contribute no match) when their backing
  source is absent, emitting `affects-unresolvable` at `info` severity. Absence is
  never an error.
- **FR-006**: An unknown matcher `type` MUST produce a warning and be ignored.
- **FR-007**: Resolution MUST be a **pure function** of `(matchers, changedFiles,
  snapshots)` — no clock, no network, no filesystem traversal beyond the supplied
  inputs. This purity MUST be asserted in CI (`resolution-is-pure`).
- **FR-008**: `@adrkit/core` MUST define a minimal, serializable **catalog port**
  (`resolveEntity`, `entitiesForPaths`, `snapshot`) and MUST NOT depend on any
  adapter implementation of it (Principle III / ADR-0007).
- **FR-009**: `adr explain <path>` MUST print every governing record **and, for
  each, the matcher (type + pattern) that fired**. A path governed by nothing is
  reported clearly and exits 0.
- **FR-010**: A **conformance fixture suite** — matcher set + changed-file list
  (+ optional snapshots) + expected result — MUST be published as test data that a
  second implementation can run. This artifact MUST NOT be deferred.
- **FR-011**: Output MUST be deterministic and stably ordered; identical inputs
  yield identical results (Principle IV).
- **FR-012**: A matcher's `repo` qualifier scopes it to a specific log/repo;
  omitted means same-repo. A matcher scoped to another repo does not match here.

### Key Entities

- **Matcher**: `{ type, pattern, repo?, negate }` from the record's `affects`
  array (schema-defined in Phase 0).
- **Changed-file set**: repo-relative POSIX paths supplied by the caller.
- **Backing snapshots**: supplied, serializable inputs that keep resolution pure —
  the changed-dependency set (from a lockfile diff), and later a catalog snapshot,
  IaC plan, and OpenAPI set. Absent snapshots make their matcher types inert.
- **Governing match**: a `(recordId, firedMatcher)` pair; the resolver returns the
  set of these for a given input.
- **Catalog port / snapshot**: the core-defined interface an `entity` catalog
  adapter implements; the snapshot is serializable, cacheable, and diffable.

## Success Criteria

- **SC-001**: On the published conformance fixtures, the resolver returns exactly
  the expected governing-record set for every `path`-matcher case (100%).
- **SC-002**: A `package` decision fires on a lockfile change to the matching
  dependency and does **not** fire on a manifest-only edit.
- **SC-003**: With no catalog, IaC plan, or OpenAPI documents present, resolution
  produces zero errors; each unbacked matcher yields exactly one
  `affects-unresolvable` info finding; the corpus remains valid.
- **SC-004**: For every governing match, `adr explain` names the specific matcher
  (type + pattern) that fired; no match is unexplained.
- **SC-005**: The `resolution-is-pure` assertion runs green in CI (no clock,
  network, or filesystem traversal beyond supplied inputs).
- **SC-006**: The conformance fixture suite is published and runnable by an
  independent implementation without adrkit internals.
- **SC-007**: Identical inputs produce byte-identical resolver output across runs.

## Assumptions

Documented, ADR-consistent choices for this phase (revisit at plan stage; none is
a one-way door beyond what ADR-0009 already fixes):

- **A1 — Lockfile format**: v1 derives the changed-dependency set from this repo's
  `bun.lock`. Other lockfile formats (npm/pnpm/yarn) are treated as unsupported →
  their `package` matchers are inert with a finding, and support is extensible
  later. The *firing semantics* (lockfile, not manifest) are fixed by ADR-0009.
- **A2 — Purity boundary**: the caller supplies the changed-dependency set (and any
  catalog/IaC/OpenAPI snapshot). The resolver never reads a lockfile or catalog
  itself; this is what makes it pure and CI-reproducible.
- **A3 — Adapters are ports only**: no catalog/IaC/OpenAPI adapter is implemented
  this phase; core ships the interfaces and the inert path (ADR-0009, ADR-0007).

## Out of Scope

- Implementing any catalog, IaC, or OpenAPI **adapter** (ports + inert path only).
- Resolving decision **precedence / winners** (scope hierarchy + supersession;
  intentionally not a match-time concern).
- CI Action packaging and the PR comment renderer (Phase 3).
- Evaluator `affects`-overlap detection (Phase 4).
- Inferring `affects` from a branch diff in `adr new` (open question in plan.md).
