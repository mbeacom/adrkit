# Feature Specification: Schema and Core (Phase 0)

**Feature Branch**: `001-schema-and-core`

**Created**: 2026-07-18

**Status**: Draft

**Input**: plan.md Phase 0 — "Schema and core (rung 1)". Ship the published record
schema, `@adrkit/core` parsing/validation, and `@adrkit/cli` (`new`, `lint`,
`graph`), enforced in CI. Shipped when `adr lint` runs green in CI on this repo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate a decision corpus (Priority: P1)

A maintainer of a repository that keeps its decisions as markdown records wants a
single command that tells them, deterministically, whether every record is
well-formed: correct required fields, valid enumerated values, and satisfied
cross-record rules (a superseded record points at its successor; an accepted
record names a decider unless it was imported; an agent-authored record that is
accepted names a human ratifier; a one-way-door decision is not on the
auto-approve path). The command is safe to run on every pull request.

**Why this priority**: This is rung 1 of the outcome ladder — the project
governing its own decisions. Nothing else in the ladder is trustworthy until the
corpus can be validated mechanically, and it is the first slice that delivers
standalone value to any team already keeping records.

**Independent Test**: Run the validate command against this repository's existing
record corpus and observe a clean pass; introduce a malformed record (missing
required field, illegal status transition, duplicate identifier) and observe a
non-zero exit with a specific, located message naming the offending record, field,
and rule.

**Acceptance Scenarios**:

1. **Given** a corpus where every record is well-formed, **When** the maintainer
   runs validate, **Then** the command exits zero and reports the number of
   records checked.
2. **Given** a record whose status is "superseded" but which omits its successor
   reference, **When** validate runs, **Then** it exits non-zero and names the
   record, the field, and the violated rule.
3. **Given** an accepted record authored by an agent with no named human
   ratifier, **When** validate runs, **Then** it reports a rule violation.
4. **Given** two records sharing the same identifier, **When** validate runs,
   **Then** it reports the collision and both file paths.
5. **Given** a record referencing a superseded/related record that does not exist
   in the corpus, **When** validate runs, **Then** it reports the dangling
   reference.

---

### User Story 2 - Trust the published schema contract (Priority: P2)

A downstream consumer — a CI job in another language, an editor plugin, an IDP
integration — wants to validate records against a stable, machine-readable schema
contract without reading the tool's source. They need certainty that the
published contract always matches the tool's own understanding, so their
validation never silently diverges from ours.

**Why this priority**: The published contract is what lets anything outside this
repository act on a record. Its integrity is the precondition for migration (Phase
2) and CI comments (Phase 3). It ranks below validation only because validation is
what a first user runs today.

**Independent Test**: Regenerate the published contract from its authoring source
and confirm the working tree is unchanged; hand-edit the published contract and
confirm the drift check fails.

**Acceptance Scenarios**:

1. **Given** the published schema is in sync with its source, **When** the emit
   step runs, **Then** the published file is byte-identical and the drift check
   passes.
2. **Given** the published schema has been hand-edited to disagree with its
   source, **When** the drift check runs, **Then** it fails and identifies the
   divergence.
3. **Given** a third-party validator loads the published schema, **When** it
   validates a record this tool accepts, **Then** it also accepts it (the two
   agree on field names and shapes).

---

### User Story 3 - Scaffold a new record (Priority: P3)

An author starting a new decision wants to generate a correctly-structured record
with the required fields present and sensible defaults filled in, so the record
validates on the first try and receives the next available identifier without
colliding with an existing one.

**Why this priority**: Lowers authoring friction and keeps the corpus consistent,
but a maintainer can hand-write a record from the template today; convenience, not
capability.

**Independent Test**: Scaffold a new record from a title, then run validate on the
resulting file and observe a clean pass.

**Acceptance Scenarios**:

1. **Given** an existing corpus, **When** the author scaffolds a record from a
   title, **Then** a new file is created with the next sequential identifier, a
   populated frontmatter block, and a body skeleton.
2. **Given** the freshly scaffolded record, **When** validate runs on it, **Then**
   it passes.

---

### User Story 4 - See how decisions relate (Priority: P3)

A maintainer or agent wants to see the relationships between records —
supersession chains and related/conflicting links — as a graph, so the shape of
the decision history is legible without opening every file.

**Why this priority**: Useful for orientation and for spotting broken chains, but
purely derivative of data the validator already parses; it can follow the first
three stories.

**Independent Test**: Run the graph command on this corpus and confirm every
supersession and relates edge present in the records appears in the output, with
no edges to nonexistent records.

**Acceptance Scenarios**:

1. **Given** a corpus containing a supersession chain, **When** the maintainer
   runs graph, **Then** the output contains a directed edge from the superseding
   record to the superseded one.
2. **Given** a corpus with related-record links, **When** graph runs, **Then**
   those links appear as edges and no edge points to a record absent from the
   corpus.

### Edge Cases

- A record file with malformed frontmatter (unparseable) is reported as a located
  parse error, not a crash, and does not abort validation of the rest of the
  corpus.
- An unknown/extra frontmatter field is rejected (the record contract is strict),
  with the offending key named.
- A file under the records directory that is not a record (e.g. the template) is
  skipped rather than failing validation.
- An empty corpus validates cleanly and reports zero records checked.
- Running any command in a fresh clone with no credentials and no network
  succeeds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a validate command that loads every record
  in the corpus and reports pass/fail with a process exit code suitable for CI
  (zero on success, non-zero on any error-severity finding).
- **FR-002**: Validation MUST enforce the record contract: required fields, field
  types, enumerated value sets, unique-item constraints, and rejection of unknown
  fields.
- **FR-003**: Validation MUST enforce every cross-field and cross-record
  invariant defined by the record contract, including: superseded-requires-
  successor and its converse; accepted-requires-decider (waived for imported
  records); agent-authored-accepted-requires-human-ratifier; one-way-door records
  may not use the auto tier; identifiers are unique across the corpus; and
  supersedes/relates/conflicts references resolve to records that exist.
- **FR-004**: Each finding MUST identify the record (path and/or identifier), the
  field where applicable, a severity, and the rule violated. Findings MUST be
  available in a human-readable form and in a machine-readable form.
- **FR-005**: The system MUST publish the record contract as a language-neutral,
  machine-readable schema artifact generated from a single authoring source.
- **FR-006**: The system MUST provide a drift check that fails when the published
  schema artifact differs from a fresh generation of it, so the two can never
  disagree in a merged state.
- **FR-007**: The system MUST provide a scaffold command that creates a new,
  valid record with the next available identifier, populated required fields, and
  a body skeleton.
- **FR-008**: The system MUST provide a graph command that emits the supersession
  and relationship edges among records, omitting edges to records not present in
  the corpus.
- **FR-009**: All commands and checks MUST run to completion on a clean clone with
  no credentials, no external services, and no network access.
- **FR-010**: The validation/parsing library MUST NOT depend on any integration
  adapter; this independence MUST be checkable mechanically.
- **FR-011**: Parsing and validation MUST be deterministic — identical inputs
  always produce identical findings — with no reliance on wall-clock time,
  network, or nondeterministic ordering.
- **FR-012**: A malformed or non-record file MUST NOT abort validation of the rest
  of the corpus; it is reported and validation continues.

### Key Entities *(include if feature involves data)*

- **Decision Record**: one file combining typed metadata (identifier, title,
  status, dates, deciders/consulted/informed, scope and governance attributes,
  supersession and relationship references, provenance, affects matchers,
  assertions) and a prose body. The unit the corpus is made of.
- **Corpus**: the collection of decision records discovered under the records
  directory; may be single-repo or, in later phases, federated by log name.
- **Finding**: a validation result — rule id, severity, message, and the record
  (and field) it concerns.
- **Published Schema Artifact**: the language-neutral contract derived from the
  authoring source, consumed by external tools.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running validate on this repository's own record corpus exits zero
  in CI (rung 1 achieved).
- **SC-002**: Every cross-field/cross-record invariant has at least one test that
  fails when the invariant is violated and passes when it holds.
- **SC-003**: The published schema drift check fails on any hand-edit of the
  published artifact and passes immediately after a fresh generation.
- **SC-004**: A record scaffolded by the scaffold command validates with zero
  findings without manual edits.
- **SC-005**: A clean clone with no credentials completes install, build, test,
  and lint successfully.
- **SC-006**: The independence check confirms the core library pulls in no
  integration adapter.
- **SC-007**: A maintainer can go from a malformed record to a precise, located
  error message in a single command invocation (no log spelunking).

## Assumptions

- Records live under `docs/adr/` as one markdown file per decision with YAML
  frontmatter and a markdown body (ADR-0001); the corpus to validate first is
  this repository's own `0001`–`0010`.
- The authoring source for the contract is the existing typed schema in
  `schema/adr.schema.ts`; the published artifact is `schema/adr.schema.json`
  (ADR-0002). Property casing must match between them (a drift caught during
  drafting).
- The contract is the strict MADR-superset already defined; this phase enforces
  it, it does not redesign it.
- Commands are consumed via a CLI (text in/out, exit codes) by both humans and
  agents; no UI or service is in scope (plan.md non-goals).
- The identifier scheme is the zero-padded sequential form used by the existing
  corpus; ULID support in the contract is out of scope to exercise here.
- Determinism and adapter-independence are verifiable in CI, per the constitution
  (Principles II, III, IV) and ADR-0007.
