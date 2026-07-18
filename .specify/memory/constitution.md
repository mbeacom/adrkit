<!--
SYNC IMPACT REPORT
Version change: (template placeholder) → 1.0.0
Ratification: initial adoption of a concrete constitution derived from docs/adr/.
Modified principles: all five template placeholders replaced with concrete,
  ADR-derived principles:
  - [PRINCIPLE_1] → I. Git Is the Source of Truth
  - [PRINCIPLE_2] → II. Clean Clone Builds Green
  - [PRINCIPLE_3] → III. Core Depends on No Adapter
  - [PRINCIPLE_4] → IV. Deterministic Before Probabilistic
  - [PRINCIPLE_5] → V. The Schema Is the Contract
Added sections:
  - Additional Constraints (toolchain, resolution purity, provenance)
  - Development Workflow & Quality Gates
Removed sections: none.
Templates reviewed:
  ✅ .specify/templates/plan-template.md — Constitution Check gate references
     this file; principle IDs below are the gate checklist.
  ✅ .specify/templates/spec-template.md — no change required; spec stays
     implementation-agnostic.
  ✅ .specify/templates/tasks-template.md — no change required; tests remain
     opt-in per feature, consistent with Principle IV/V verification tasks.
Deferred TODOs: none.
Source of authority: docs/adr/0001, 0002, 0004, 0005, 0007, 0008, 0009, 0010.
The ADRs are normative. If this file and an accepted ADR disagree, the ADR wins
and this file must be corrected by amendment.
-->

# adrkit Constitution

adrkit is a decision-governance layer: machine-readable Architecture Decision
Records that are enforceable in CI and legible to agents, without leaving git.
This constitution encodes the non-negotiable constraints that every feature,
package, and pull request MUST satisfy. It is derived from the accepted ADRs in
`docs/adr/`, which remain the normative source; this document restates their
binding constraints as testable engineering gates.

## Core Principles

### I. Git Is the Source of Truth

Decision content lives as one markdown file per decision under `docs/adr/`, with
typed YAML frontmatter and a prose body. Git is the system of record.

- Every machine-authored change to a record MUST be delivered as a pull request.
  Tooling MUST NOT mutate records in place outside a PR, and MUST NOT write
  decision content to a database. Any database or search index is a derived,
  disposable projection that can be rebuilt from git and is never authoritative.
- All lifecycle transitions (draft → proposed → accepted → superseded, etc.)
  happen through PR review, reusing existing branch protection and CODEOWNERS.

Rationale: the capability this project exists to provide — mapping a code diff
to the decisions that govern it — requires decisions to be colocated with the
code, diffable, and attributable via `git log`. (ADR-0001, ADR-0004)

### II. Clean Clone Builds Green

A fresh clone with no credentials, no running services, and no network access
MUST install, build, test, and lint successfully.

- This is a CI assertion (`clean-clone-builds`), not a guideline. A change that
  makes the default build require a secret, a device, or a network call is a
  defect regardless of its other merits.
- Any integration that needs authenticated, corporate-device, or private access
  to develop does not belong in this repository.

Rationale: contributor onboarding, IP provenance, and offline use all depend on
the build being self-contained; the constraint also mechanically enforces the
boundary between this Apache-2.0 project and any employer-internal IP. (ADR-0007)

### III. Core Depends on No Adapter

`@adrkit/core`, `@adrkit/cli`, and the schema MUST depend only on the filesystem
and their own workspace packages.

- No package outside `packages/adapters/**` may depend on an adapter package, and
  no package may depend on a source requiring authenticated access. This is
  enforced by the `core-has-no-adapter-deps` dependency-graph check in CI.
- Adapters live under `packages/adapters/*`, depend on the core, and are
  permitted to break on upstream churn. The core MUST NOT learn that any adapter
  exists; discovery is by runtime configuration.
- The `isolated` linker (`bunfig.toml`) is load-bearing: it forbids phantom
  dependencies that could let the check pass while the core imports an adapter.
  It MUST NOT be changed to unblock an install.

Rationale: coupling the core to fast-moving, pre-1.0 upstreams imports their
release cadence into ours; isolation confines breakage to one package. (ADR-0007,
ADR-0010)

### IV. Deterministic Before Probabilistic

No probabilistic step may run before the deterministic pass has run and passed.

- Parsers, validators, and the `affects` resolver MUST be deterministic. Models
  MAY suggest field values for human confirmation; they MUST NEVER perform the
  parse, the validation, or the resolution.
- The `affects` resolver MUST be pure: given `(matchers, fileList,
  catalogSnapshot)` it returns matches with no clock, no network, and no
  filesystem traversal. Purity is asserted in CI. A matcher whose backing source
  is missing resolves to inert with an informational finding — never a fatal
  error.
- The evaluator routes; it never approves. Its output MUST be a routing/escalation
  decision, never an automated acceptance. No model call happens before Pass 0
  (deterministic) has completed.

Rationale: auditability and CI-gate reliability require that the load-bearing
paths are reproducible and explainable without a model in the loop. (ADR-0005,
ADR-0008, ADR-0009)

### V. The Schema Is the Contract

The typed frontmatter schema is authored once in Zod (`schema/adr.schema.ts`) and
is the single source of truth for the record contract.

- The published JSON Schema (`schema/adr.schema.json`) MUST be generated from the
  Zod source via `bun run schema:emit`. CI MUST fail if the committed JSON Schema
  differs from a fresh emit (`schema-emit-matches`). The JSON Schema MUST NOT be
  hand-edited.
- Cross-field invariants (e.g. `superseded` requires `supersededBy`; an accepted
  decision names a decider unless imported; an agent-authored record cannot reach
  `accepted` without a named human ratifier; one-way-door decisions cannot take
  the auto tier) are enforced by code and covered by tests — never by an ad-hoc
  script.
- The schema is versioned independently of the tooling and is treated as a
  one-way door: consumers pin it, so breaking changes require an explicit,
  superseding decision.

Rationale: a shared machine-readable contract is what lets CI, IDP catalogs, and
agents act on a decision rather than merely render it. (ADR-0002)

## Additional Constraints

- **Toolchain (ADR-0010).** Bun is the runtime, package manager, test runner, and
  bundler for development: `bun install`/`bun add`, `bun run`, `bun test`,
  `bun build`, `bunx`. Do not introduce npm/yarn/pnpm/jest/vitest/webpack/esbuild
  workflows. Published artifacts target Node `>=22`. `bun.lock` stays text and is
  reviewed like any other file.
- **Provenance is captured, never backfilled.** `provenance` records authorship
  (`human` / `agent` / `agent-drafted`) and, for imported records,
  `importedFrom` (source kind, reference, content fingerprint). Its presence
  exempts a record from the deciders-required invariant. Provenance MUST be
  written at authoring/import time.
- **Imports are one-way and non-destructive.** Migration adds frontmatter without
  altering body bytes, is idempotent and in place, and never overwrites diverged
  records — divergence is surfaced as a PR. (ADR-0008)
- **Licensing.** Code is Apache-2.0; the schema carries a CC0 carve-out. New
  files respect these boundaries and the DCO sign-off requirement.

## Development Workflow & Quality Gates

- **Spec-driven flow.** Non-trivial work moves `constitution → specify → plan →
  tasks → implement` using the spec-kit machinery under `.specify/`. Each feature
  lives under `specs/NNN-<short-name>/`.
- **Constitution Check gate.** Every `plan.md` MUST pass a Constitution Check
  against Principles I–V before design and again after design. Violations go in a
  Complexity Tracking table with an explicit justification, or the design changes.
- **CI is the enforcement surface.** The gates `clean-clone-builds`,
  `schema-emit-matches`, and `core-has-no-adapter-deps` MUST be present and green.
  If any gate is disabled to unblock a release, the corresponding decision has
  been abandoned in practice and MUST be superseded explicitly rather than left
  standing as fiction.
- **Dogfooding.** This project's own decisions are governed by this project:
  `adr lint` MUST run green on this repo's `docs/adr/` corpus.

## Governance

This constitution restates the binding constraints of the accepted ADRs and is
subordinate to them: where this file and an accepted ADR conflict, the ADR
governs and this file MUST be amended to match.

- **Amendments.** Changing a principle requires first changing (or adding) an ADR,
  then updating this constitution in the same or a following PR, then propagating
  to dependent templates under `.specify/templates/`.
- **Versioning.** This document is semantically versioned: MAJOR for
  backward-incompatible governance changes or principle removals/redefinitions,
  MINOR for a newly added principle or materially expanded guidance, PATCH for
  clarifications and wording.
- **Compliance.** PRs and reviews verify compliance with Principles I–V. Added
  complexity must be justified against the simpler alternative it displaces.

**Version**: 1.0.0 | **Ratified**: 2026-07-18 | **Last Amended**: 2026-07-18
