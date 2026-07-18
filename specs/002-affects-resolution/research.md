# Research & Decisions: Affects Resolution (Phase 1)

Decisions resolving the Technical Context. Each is constrained by ADR-0009 or the
constitution; none reopens a settled ADR.

## R1 — `path` matcher engine

**Decision**: Use `picomatch` for `path` matchers, configured for POSIX
separators, case-sensitive matching, `**` crossing directory boundaries, and
dotfiles matched only when the pattern opts in (`dot: false`).

**Rationale**: ADR-0009 pins picomatch semantics explicitly. picomatch is a
vetted, deterministic, network-free library (permitted by amended Principle III)
and is the de-facto glob engine, so patterns behave the way authors expect.
Patterns are repo-relative with no leading slash; the resolver rejects a leading
slash as a finding rather than silently normalizing.

**Alternatives rejected**: `minimatch` (different edge semantics than the ADR
names); hand-rolled globbing (would drift from the pinned semantics — the one
thing ADR-0009 forbids since match semantics are a one-way door).

## R2 — Negation semantics

**Decision**: The resolver, not the matcher, applies negation. For each record:
it governs a file iff **at least one non-negated matcher matches AND no negated
matcher matches** that file. Negation is scoped to the declaring record.

**Rationale**: This is FR-001/FR-004 verbatim from ADR-0009. Keeping negation in
the resolver (rather than in per-matcher code) makes the "positive-then-exclude"
rule a single, testable place and prevents one record's negation from leaking
into another's evaluation.

## R3 — `package` matcher firing model

**Decision**: A `package` matcher (`name` or `name@<range>`) fires when the
**changed-dependency set** contains a dependency whose name equals `name` and
(if a range is present) whose resolved version satisfies the range. The
changed-dependency set is **supplied by the caller**, derived from a lockfile
diff — not read by the resolver.

**Rationale**: ADR-0009 fixes "lockfile, not manifest" and its trade-off note
("won't fire on a manifest-only edit") makes the firing condition a *change to the
dependency in the lockfile*. Supplying the changed-dependency set (rather than
having the resolver read a lockfile) is what preserves purity (FR-007) and keeps
CI reproducible. Semver satisfaction uses a small, deterministic semver check.

**v1 scope (Assumption A1)**: the changed-dependency set is produced from this
repo's `bun.lock`. Other lockfile formats are unsupported in v1 → a `package`
matcher with no changed-dependency set available is inert with an
`affects-unresolvable` info finding, extensible later. The *semantics* are fixed;
only the set of parseable lockfile formats grows.

## R4 — Degradation for unbacked matcher types

**Decision**: `entity`, `resource`, `api`, and `data` matchers parse and validate
(already guaranteed by the Phase 0 schema) but resolve **inert** — contributing
no match and emitting one `affects-unresolvable` finding at `info` severity — when
their backing snapshot (catalog / IaC plan / OpenAPI set / adapter data) is
absent. An **unknown** matcher `type` emits a `warn` and is ignored.

**Rationale**: FR-005/FR-006 and ADR-0009's "degradation, not failure": a corpus
stays valid offline and in a clean clone, and a newer corpus never breaks an older
tool. Absence is never an error.

## R5 — Catalog binding is a core port, not an adapter

**Decision**: `@adrkit/core` defines the catalog **port** interface
(`resolveEntity(ref)`, `entitiesForPaths(paths)`, `snapshot()`), with a
serializable `CatalogSnapshot`. No adapter is implemented this phase; `entity`
resolution is inert until a snapshot is supplied.

**Rationale**: ADR-0009 + ADR-0007 require the boundary be structural. Shipping
only the port keeps `core-has-no-adapter-deps` green while pinning the interface a
future `packages/adapters/catalog-*` adapter implements. The snapshot is
serializable so it can be committed/cached, keeping resolution pure.

## R6 — Purity enforcement

**Decision**: `resolveAffects` takes only its explicit inputs and returns a value
with no side effects — no `Date`, no `process`/env reads, no `fs`, no network.
A `resolution-is-pure` test asserts referential transparency (same inputs → same
output across repeated calls) and the module is structured so the resolver cannot
import `node:fs`/`node:child_process`/network modules. CI runs this as a gate.

**Rationale**: ADR-0009's `resolution-is-pure` assertion (severity error). Purity
is the property that makes CI reproducible and the conformance suite meaningful.

## R7 — `adr explain` output

**Decision**: `adr explain <path>` loads the corpus, resolves which records govern
`<path>` (treating `<path>` as a single-element changed-file list), and prints each
governing record id + title **and the specific matcher (type + pattern) that
fired**. `--json` emits a stable, sorted structure. A path governed by nothing
prints a clear "no decision governs" line and exits 0. Inert matchers are shown as
unresolved (info), never as matches.

**Rationale**: FR-009 and ADR-0009 ("an unexplainable match is as bad as a wrong
one"). Explainability is what makes union-without-precedence actionable.

## R8 — Conformance fixtures as portable data

**Decision**: Publish the suite as plain JSON cases under
`packages/core/test/conformance/cases/*.json`, each `{matchers, changedFiles,
snapshots?, expected}`, with a README describing the format so a second
implementation can run them without adrkit internals. The core test harness loads
and asserts them; they are simultaneously the spec's executable truth.

**Rationale**: FR-010 / SC-006, and ADR-0009 calls this "the artifact that lets a
second implementation exist. Do not defer it."

## Deferred (not decided here)

Catalog/IaC/OpenAPI **adapters** and their snapshot producers (ports + inert path
only this phase); additional lockfile-format parsers beyond `bun.lock`;
`affects`-from-branch-diff inference in `adr new` (open question in plan.md).
