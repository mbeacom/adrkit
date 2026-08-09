---
schemaVersion: 0.1.0
id: "0021"
title: Resolve inbound source annotations without changing the schema
status: accepted
date: 2026-08-05
deciders: ["@mbeacom"]
tags: [core, cli, matching, governance, agents]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0009", "0012", "0014", "0016"]
affects:
  - type: path
    pattern: "packages/core/src/markers/**"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/core/src/check/**"
  - type: path
    pattern: "packages/ci/src/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: >-
    Adds an inbound edge without touching the schema. The edge now reaches
    `explain`, `check`, and the governing-decisions Action, while filesystem reads
    remain outside pure `checkChanges`. Marker claims render separately and never
    affect exit status; bounded concurrency, scan-state reporting, and rejecting
    symlinks constrain the CI capability.
reviewBy: 2027-02-05
---

# ADR-0021: Resolve inbound source annotations without changing the schema

## Context

A decision reaches a file in exactly one direction today. The record declares
`affects` patterns; `resolveAffects` matches repo-relative paths against them
(ADR-0009). There is no way for a **file** to declare the decision it lives
under. Confirmed against the tree at `742fef6`: the only annotation code is
Backstage *catalog ownership* (`packages/adapters/catalog-backstage/src/ownership/annotation.ts`),
a different concept pointed the other way.

The gap is not aesthetic; it is a measured cost. On a 1,357-file codebase,
expressing "these decisions govern the sync subsystem" with `affects` required
directory-level globs:

| | Directory patterns | Defining files only |
|---|---|---|
| Files matched | 163 (12%) | 28 (2.1%) |
| Context injected if an agent touches all of them | ~56,000 tokens | ~9,100 tokens |

`affects` patterns must be broad enough to cover a subsystem, and breadth is
exactly what costs an agent context. Narrowing them to the *defining* files
fixes the cost and silently drops the neighbourhood: files where the decision is
real but ambient get no link at all. Neither setting is right, because one field
is being asked to answer two questions — "what does this decision define?" and
"where else does it apply?"

ADR-0012 already settled the shape of the answer for the adjacent problem. It
rejected inferring catalog entity-to-path ownership from source locations and
descriptor parents, because a wrong ownership map "silently reclassifies which
decisions govern which code — the worst class of bug this project can ship," and
required an explicit annotation instead. This record applies the same argument
in the opposite direction: rather than widening `affects` until it accidentally
covers the neighbourhood, let the neighbourhood say so. There is no conflict
with ADR-0012; there is a symmetry with it.

## Decision

**A source file may declare the decision it lives under with `@adr <id>` in a
comment, and adrkit resolves that as an inbound edge discovered at resolution
time — not as a record field, and not as a new `affects` matcher type.**

### The marker

```ts
// @adr 0012
export function syncOnce() { … }
```

- The grammar is `@adr` + whitespace + an `AdrRef` (`0012`, or `payments:0012`).
  A comma continues a list (`@adr 0012, 0013`); a bare space ends it, so
  `@adr 0012 1234567` is one declaration followed by a number.
- **Language-agnostic by construction.** adrkit does not parse the file. A
  marker counts only on a dedicated comment line: after optional whitespace,
  one of `//`, `/*`, `*`, `#`, `--`, `;`, `%`, `<!--`, `"""`, `'''` begins the
  physical line and `@adr` is the comment's first content. There is no parser
  per language and there will not be one. A trailing `} // @adr 0012` is not a
  file-level declaration.
- **Bounded to a header window** of the first 8192 bytes. A marker is a *claim*
  that a file lives under a decision; a mention 40 KB down is prose about that
  decision. The bound is what separates them, and it caps scan cost at a
  constant for generated and vendored files.
- Truncation drops the severed final line, because half of `@adr 00123` is
  `@adr 0012` — a different and perfectly valid reference.

### No schema change, and why the constraint held

Nothing about a marker enters a record. `AdrFrontmatter` is untouched,
`AffectsType` gains no member, and `schema/adr.schema.json` is byte-identical.
Three reasons, in the order they mattered:

1. **Semantics.** The file is opting in. The record is not declaring it. An
   `affects` matcher that means "some file might name me" would be a matcher
   whose pattern is unknown to its author, which is not a matcher.
2. **The gate is real.** The Zod source → generated JSON Schema emit-parity gate
   is named in `CONTRIBUTING.md` as one of the two steepest on-ramps. Not paying
   it for a feature that does not need it is the whole point.
3. **The schema is CC0 and independently implemented.** A resolution-time edge
   costs a second implementation nothing until it wants the feature; a schema
   field costs it a migration whether it wants the feature or not.

### The distinction is preserved end to end

A consumer must always be able to tell which end made the claim. Fired `affects`
matchers stay in `firedMatchers`; file declarations land in a separate
`declaredBy`, present only when a file actually declared the record:

```
Decisions governing src/services/sync/retry.ts:
  0009  [accepted] Resolve affects deterministically
    via path: src/services/sync/**
  0012  [accepted] Bind catalog entities to owned paths
    declared by src/services/sync/retry.ts:3 (@adr 0012)
```

Omitting `declaredBy` rather than emitting `[]` keeps pattern-only decisions
byte-identical. `GoverningDecision` carries the optional field on `explain`,
`check`, and Action results.

### A dangling marker is a `warn`

A marker naming a record the corpus does not have is `dangling-marker` at
`warn`, not `error`. A dangling `relatesTo` is an `error` because the *record*
is wrong and the corpus owns it. A marker lives in a file the corpus does not
own and cannot be held complete for. The closest existing analogue is
`corpus-file-skipped`, also a `warn`: a claim that could not be honored,
reported without failing the run. A log-qualified marker (`@adr payments:0012`)
is `marker-unresolvable` at `info`, mirroring `affects-unresolvable` — inert
here, not broken.

### The working tree is the read boundary

`<path>` is repo-relative — the same contract `resolveAffects` matches its globs
against. An absolute or traversing argument is not a stricter form of that
contract but a different one, and it is refused rather than read.

This is a correctness constraint before it is a hardening one. `affects`
resolution retains its pre-marker behavior over the raw argument, so a broad
glob can still match an absolute or traversing string. The new capability is
opening that argument and deriving an inbound edge from its contents; that is
what this boundary refuses. A file elsewhere on disk cannot make itself governed
by this corpus on the strength of a comment nobody here wrote.

Confinement is checked lexically before I/O and again on the real path. Before
that second check, `lstat` rejects every symlink component beneath the working
tree as `unreadable` without resolving its target. Valid in-tree, broken, and
out-of-tree symlinks therefore render identically; a fork author cannot use the
scanner to distinguish target existence or permissions. The cost is explicit:
`adr explain` no longer scans a
safe in-tree symlink. Only regular files are read, so a FIFO cannot block the
command.

A separate check/open race remains: after `realpath` approves a target, a
concurrent process can replace that path before `open`. Locally, a process able
to mutate the caller's tree already has the stronger ability to edit the corpus.
The Action normally scans a static checkout; a workflow that first executes a
fork's code has already granted it substantially more capability. The race is
recorded here rather than misdescribed as closed.

The prose above said "no traversal" before anything checked it; that is the same
gap `markers-purity.test.ts` closed for the purity claim, and ADR-0016 is why it
does not count until observed failing.

### Scanning state is reported, never inferred

`adr explain --json` always carries `markers.state` (`scanned` / `absent` /
`unreadable` / `out-of-tree`), `markers.truncated`, and `markers.windowBytes`;
the human output prints one `Note:` line when the file was not scanned or the
window stopped short. ADR-0016 is explicit that "`0`, `[]`, and 'no X found'
render identically whether the tool looked and found nothing or could not look
at all." An empty marker list is exactly that shape, so the reason has to travel
with it.

`out-of-tree` is a state of its own rather than a shade of `unreadable` for the
same reason: such a file is usually perfectly readable, and saying it could not
be read would be false. The tool declined to look, and that is what it reports.

For multi-file checks, `markerScan` reports aggregate state counts plus exact,
sorted lists for absent, unreadable, out-of-tree, truncated, and skipped paths.
The reader normalizes and sorts unique paths, scans the first 1,000 with at most
16 reads in flight, and resolves the canonical working-tree root once per batch.
Paths beyond the cap remain in `affects` resolution but are listed as skipped and
produce a non-blocking `marker-scan-capped` warning.

### Marker trust stops at the source file

In CI, a marker is a claim made by the pull request author. Marker-derived edges
therefore remain visibly separate from record-authored `affects` matches, and no
marker state, declaration, dangling reference, or scan-cap warning changes
`CheckOutcome.ok` or the Action's failure status. Only validation errors on
changed ADR records retain that authority.

### Scope of this record

`adr explain <path>`, `adr check <files...>`, and the governing-decisions Action
scan markers. The callers perform bounded filesystem reads and pass complete
`SourceMarkerBatchScan` values into `checkChanges`; the resolver itself remains
deterministic and pure. The Spec Kit context script inherits marker resolution
through its existing `adr check` call.

Nor does this record rely on an MCP sandbox as an enforcement boundary. The MCP
read guard is inert unless `ADRKIT_MCP_TEST_READ_ROOTS` is set, and when armed in
tests its root is the working tree. Correcting that independent invariant belongs
to the MCP surface, not to this `explain`-only change.

## Options considered

### Option A: Inbound edge discovered at resolution time (chosen)

| Dimension | Assessment |
|---|---|
| Correctness | High — the party making the claim is the party that wrote it |
| Schema stability | Untouched; CC0 contract and emit-parity gate unaffected |
| Reversibility | Two-way door — no record, corpus, or snapshot encodes a marker |
| Cost to an adopter | One comment line, in files they already edit |
| Cost when unused | Zero until something reads the file |

### Option B: A new `affects` matcher type (e.g. `type: marker`)

**Pros:** one resolution path; markers appear in existing `firedMatchers`
output with no new field.
**Cons:** requires the schema change this design exists to avoid, and encodes a
falsehood — the record would declare a pattern it cannot know. It also erases
the pattern-vs-declaration distinction at exactly the layer that needs it, since
`firedMatchers` would carry both.

### Option C: A `declaredIn` frontmatter field listing the files

**Pros:** no scanning at all; fully declarative; deterministic.
**Cons:** it is `affects` with extra steps, and it puts the burden back on the
record author — the person who does *not* know which files will later adopt the
decision. It also rots: the list is invisible from the file it names, so a
rename silently drops the link.

### Option D: Widen the `affects` patterns (do nothing)

**Pros:** ships today; no code.
**Cons:** this is the measured status quo — 163 files and ~56,000 tokens where
28 files and ~9,100 would do. It is also the option that made the tension
visible, so "do nothing" here means accepting a 6× context cost permanently.

## Trade-offs

The dedicated-comment-line rule is a heuristic, and it is stated rather than
hidden. It rejects common inline string literals, prose that merely discusses a
marker, and trailing comments without parsing the language. A multiline string
or fenced documentation example whose `// @adr` token begins the physical line
still reads as a marker; avoiding that requires language-specific parsing, the
thing this design refuses to become.

The 8192-byte window is a chosen number, not a derived one. A file whose header
is longer than that loses a marker below it, silently as far as matching goes —
which is why `truncated` is reported rather than assumed away.

Reading changed paths from disk makes the CLI and Action orchestration depend on
the working tree. Accepted deliberately, and bounded: at most 1,000 regular files
beneath the tree, 16 reads in flight, read-only and non-blocking, 8193 bytes per
file, no traversal, no network, and no credentials. `checkChanges` keeps its
purity contract because every scan arrives precomputed.

Confining the read means an outside file cannot add marker-derived governance.
The existing `affects` result is left untouched: broad patterns may still match
the raw argument, while the marker state reports `out-of-tree`. What is given up
is a capability markers could have added and deliberately do not.

`declaredBy` is optional on the shared `GoverningDecision`, so pattern-only
results remain byte-identical while `check` and the Action can preserve the
origin of marker-derived claims.

## Consequences

- Easier: keeping `affects` narrow and declarative; giving an agent the
  decisions that govern the file in front of it without paying for the
  subsystem; adopting a decision from a file the record's author never saw.
- Harder: two places now answer "why does this decision apply here," so both
  have to stay legible; the comment heuristic will have corner cases reported
  against it.
- **How we would know this was wrong:** markers drift out of date faster than
  `affects` patterns do — measurable as a rising `dangling-marker` rate across a
  corpus — or the comment-introducer heuristic produces false positives that
  cannot be silenced without a per-language parser. Either reopens this record.
  Review by 2027-02-05.
- Revisit if: real corpora routinely exceed the 1,000-file scan cap, or another
  surface needs the header-window bound to become configurable.

## Action items

1. [x] `adr check <files...>` and the `@adrkit/ci` Action scan markers without
       letting marker-derived information influence their exit code.
2. [ ] Reassess the 8192-byte window against real corpora once markers are in
       use; it is a chosen default, not a measured one.
