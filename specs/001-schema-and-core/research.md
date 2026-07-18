# Research & Decisions: Schema and Core (Phase 0)

Decisions made to resolve the Technical Context. Each is constrained by an ADR or
constitution principle; none re-opens a settled ADR.

## R1 — JSON Schema emission from the Zod source

**Decision**: Use Zod 4's native `z.toJSONSchema()` as the sole emitter; the
committed `schema/adr.schema.json` is regenerated from it and thereafter gated.

**Rationale**: ADR-0002 mandates a single Zod source of truth with JSON Schema
emitted from it, and warns that during drafting the two files disagreed on
property casing. Zod 4 ships JSON Schema conversion in-tree, so no extra
dependency is added (Principle II). The drift observed during drafting is
resolved by making the emitter authoritative and regenerating the committed file
to match, then asserting equality in CI.

**Alternatives rejected**: `zod-to-json-schema` (extra dependency, and a second
opinion about output shape that reintroduces the casing drift); hand-maintaining
the JSON (explicitly forbidden by Principle V).

**Note**: `.refine()` cross-field invariants do not appear in JSON Schema (no
JSON Schema construct expresses them). They are enforced in code (R4) and are not
expected in the emitted artifact — so the emit target and the invariant checks
are complementary, not redundant.

## R2 — Frontmatter parsing

**Decision**: Split the leading `---`-fenced YAML block from the markdown body by
hand (first two `---` lines), then parse the YAML with the `yaml` package.

**Rationale**: Records use real YAML (block scalars `>-`, arrays, nested maps), so
a line-oriented hack is insufficient. `yaml` is a public, dependency-free,
deterministic parser (Principle IV). Body bytes below the frontmatter are
preserved verbatim — important for the Phase 2 idempotent-migration invariant,
established early here.

**Alternatives rejected**: `gray-matter` (pulls `js-yaml` plus extra surface we
don't need); regex-only extraction (breaks on block scalars).

## R3 — Corpus discovery

**Decision**: Walk `docs/adr/` for `NNNN-*.md`, skipping `0000-template.md` and
any file whose name does not match the record pattern. Ordering is sorted by
filename for determinism.

**Rationale**: Deterministic, no globbing dependency needed for a single flat
directory. The template is not a record (spec edge case). Federated/log-prefixed
corpora are a later phase; the loader keeps an optional `log` field on the record
but does not implement multi-repo aggregation now.

## R4 — Validation: contract + invariants

**Decision**: Two layers. (a) Per-record contract validation via the Zod schema's
`safeParse` (covers required fields, enums, unique-items, strict unknown-field
rejection, and the intra-record `.refine()` rules already in the schema). (b)
Corpus-level invariants that Zod cannot see: identifier uniqueness across files,
and resolution of `supersedes`/`supersededBy`/`relatesTo`/`conflictsWith`
references to records that exist. Each invariant emits a structured `Finding`.

**Rationale**: The schema already encodes intra-record refinements (superseded↔
supersededBy, accepted-needs-decider-unless-imported, agent-accepted-needs-
ratifier, one-way-door≠auto). Reusing them satisfies "invariants enforced by
code, not an ad-hoc script" (Principle V) without duplicating logic. Cross-record
rules are layered on top because a single record cannot see its siblings.

**Severity**: contract failures and unresolved-required references are `error`
(non-zero exit); `conflictsWith` presence on accepted records is `warn` (per the
schema comment). Exit code is non-zero iff any `error` finding exists (FR-001).

## R5 — CLI shape

**Decision**: Single `adr` binary dispatching subcommands `lint`, `new`, `graph`,
parsed with `node:util` `parseArgs`. Text to stdout, errors/findings to stderr,
`--json` for machine-readable findings. No TTY-only behavior.

**Rationale**: Zero-dependency, agent-friendly text I/O with exit codes; keeps the
clean-clone surface minimal (Principle II). `--json` satisfies FR-004's
machine-readable requirement and the agent-legibility goal.

**Alternatives rejected**: `commander`/`yargs` (unnecessary dependency for three
commands).

## R6 — `graph` output format

**Decision**: Emit Graphviz DOT to stdout by default (edges for `supersededBy`
and `relatesTo`/`conflictsWith`), with `--format=json` for an edge list. Edges to
absent records are omitted (and separately reported by `lint`, not `graph`).

**Rationale**: DOT is text, diffable, and renderable by ubiquitous tooling without
adding a runtime dependency. Mermaid is a reasonable future `--format`.

## R7 — Adapter-independence check

**Decision**: `scripts/check-deps.ts` reads each workspace `package.json` and
fails if any package outside `packages/adapters/**` declares a dependency on an
adapter package, or if `@adrkit/core`/`@adrkit/cli` declare anything outside the
allowed set. Runs in CI as `core-has-no-adapter-deps`.

**Rationale**: ADR-0007 requires the boundary be a build failure, not a review
judgment. With no adapters yet, the check also guards against the first one being
wired in incorrectly.

## Open questions deferred (not resolved here)

Per plan.md, these remain open and are **not** silently decided in Phase 0:
`affects`-from-branch-diff inference in `adr new` (this phase's `new` does **not**
infer `affects`), ULID vs. log-prefixed ordinals for federation, and agent-log
split granularity.
