# The consumer SDK's first surface

**ADR-0031 action item 3.** Enumerate `@adrkit/sdk`'s first surface from what a real consumer
needs — the Tier 1 capabilities of ADR-0029 clause 1 — rather than from what `@adrkit/core`
happens to export, and record the count.

> **Status: investigation supporting an accepted record.**
> [ADR-0031](adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
> was ratified by `@mbeacom` on 2026-08-24. `packages/sdk/` is now **implemented
> and unpublished**: `openDecisions` and every `DecisionSet` member run over
> `@adrkit/core`'s kernels (see [Implementation](#implementation) below), with no
> build, no release, version 0.0.0, and no entry in `RELEASE_PACKAGES`. ADR-0031
> authorizes construction only; a later record must authorize publication.

## Verdict, first

**The wrongness signal fires on one of the two counts the record could mean, and the record
does not say which. On the claim the signal actually stands for, direct measurement says it did
not fire.**

| | count | vs "roughly a dozen" |
|---|---|---|
| (A) callable entry points — functions and methods | **7** | under |
| (B) all exported symbols, including types | **17** | **over** |

ADR-0031's falsification criterion reads:

> if the SDK's surface has to grow past roughly a dozen **entry points** to serve its first real
> consumer, then it is not a facade but a re-export of core under another name, and the
> insulation is fictional.

"Entry point" is undefined. Reading (B) is the one consistent with the record's own comparison
table, which counted *symbols* (173 vs 3). On that reading, 17 > 12 and the signal has fired.

But the count is a **proxy**. The claim it stands for is stated in the same sentence: *it is a
re-export of core under another name, and the insulation is fictional.* That claim is directly
measurable, and it comes back negative:

| structural comparison against the nearest `@adrkit/core` counterpart | result |
|---|---|
| object shapes structurally identical to a core type | **0 of 12** |
| object shapes diverged from a core counterpart | 7 |
| object shapes with no core counterpart at all | 5 |
| vocabulary unions identical to a core union | 3 of 3 — *deliberate; see below* |

Not one of the twelve object types is a re-export of a core type under another name. Seven
diverge in member names and member types; five (`DecisionSet`, `PathGovernance`,
`OpenDecisionsOptions`, `QueueOptions`, `GoverningOptions`) have no counterpart in core
whatsoever, because they describe a consumption model core does not have.

**Recommendation for ratification — adopted.** The wrongness signal as written would condemn a
facade that demonstrably insulates, because it counts symbols while its stated concern is
aliasing. Worse, it never said which of the two counts it meant, so the record's own
falsification test could not be evaluated without a judgment call.

**ADR-0031's criterion has been replaced** (see that record's *Consequences*), on `@mbeacom`'s
decision, before ratification rather than after. It now reads: *more than a third of the SDK's
declared object shapes being structurally identical to a core type* — scriptable, with the
measured baseline of 0 of 12 recorded in the record itself, and with the three vocabulary unions
explicitly excluded for the reason given below. The second signal — a consumer reaching into
`@adrkit/core` directly — was sound and is kept unchanged. Both counts stay in the record so a
ratifier sees what was measured, not only the conclusion.

The honest summary for `@mbeacom`: **the surface is 7 callable entry points and 17 symbols; the
insulation is real and measured; the record's own falsification criterion was the part that
needed fixing, and measuring it is what found that out.**

> **Remeasured after the additive extension (2026-10-10).** The figures above are the first
> enumeration's and are left as measured. After the [additive extension](#additive-extension)
> the surface is **7 callable entry points** (unchanged), **19 exported symbols** (`GraphOptions`
> and `DecisionEdgeKind` added; `SupersessionEdge` renamed `DecisionEdge`), and **1 of 13**
> object shapes structurally identical to a core type: `DecisionEdge { from, to, kind }` has
> the same member names and types as core's `GraphEdge`. That is under ADR-0031's one-third
> threshold (4 of 13 would cross it), and it is reported rather than renamed away: those three
> names are `adr graph --format json`'s published edge shape, the same converge-on-published-
> vocabulary rule the three unions follow. The other twelve: seven diverged (`GraphOptions`
> against core's `AdrGraphFilter`, which also carries `focus`), five with no core counterpart.
> `DecisionEdgeKind` is a fourth vocabulary union, the frontmatter field names that
> `adr graph --kind` accepts.

## Measurements

All figures were derived by script against this revision, not asserted. This matters here
specifically: the record's own asserted count was wrong, which is what prompted measuring rather
than restating.

### Correction to ADR-0031's premise

| claim | as written | measured | status |
|---|---|---|---|
| `@adrkit/core` exports 173 symbols | 173 | 98 runtime values; ~166 incl. types by static walk | credible |
| `@adrkit/ci` imports **3** core symbols | 3 | **14** (7 values, 7 types) | **wrong by 11** |
| `@adrkit/ci` is *the only* existing consumer | "the only" | `@adrkit/catalog-envelope` imports 3 more | **incomplete** |

The 14: `ChangedDependency`, `CheckLintResult`, `CheckOutcome`, `Finding`, `GoverningDecision`,
`QueueReport`, `SourceMarkerBatchScan`, `buildQueueReport`, `checkChanges`, `compareCodeUnits`,
`deriveChangedDependenciesFromBunLockDiff`, `formatQueueReportMarkdown`, `lintCorpus`,
`readSourceMarkersBatch`.

**The conclusion survives; the framing does not.** 17 consumed symbols against 173 exported is
still a promise kept only by freezing the engine or breaking it quietly — the argument holds. But
the ratio is 5.7×, not 58×, and "protecting a consumer surface of roughly three" was the phrase
doing the rhetorical work in both ADR-0031 and the amendment note it added to the *accepted*
ADR-0029. Both are corrected, each with a visible correction note rather than a silent edit.

### The strongest argument is assembly, not symbol count

This is the finding that most changes how the SDK should be justified, and it is not the
argument ADR-0031 leads with.

Core's exports are **pure kernels**. They are not capabilities. Answering one Tier 1 question
today — *which decisions govern this path* — takes eight core calls in a specific order:

```text
lintCorpus → readSourceMarkers → resolveAffects → resolveSourceMarkers
  → mergeSourceDeclarations → toGoverningDecisions → bucketDecisions → sortFindings
```

*(measured from `runExplain` in `packages/cli/src/index.ts`)*

And the ARB queue needs a **25-line `--as-of` resolver that lives in `packages/cli/src/queue.ts`
and is not exported from core at all**. A library consumer building the queue today therefore
either reimplements that resolver or gets a different answer than CI does, for the same corpus
on the same day. That is a contract gap that no amount of additive-only discipline on core's
exports would have caught, because the missing piece was never in core to begin with.

So: a consumer importing `@adrkit/core` does not receive Tier 1 capabilities. It receives the
parts, plus the obligation to assemble them correctly and to keep assembling them correctly as
core changes. **The mapping layer is the product.** ADR-0031 clause 4 asserts this; the eight-call
chain is the evidence for it.

The `--as-of` half of that is not merely inconvenient — it is a **live defect independent of the
SDK's fate**, and it is now ADR-0031 action item 7 so it survives this document. `resolveAsOf` is
not a helper; it implements `cli-contract.md §As-Of Resolution`, including the rule that a
timezone-less datetime is rejected as ambiguous rather than guessed at. A consumer that
reimplements it and guesses differently produces a queue that disagrees with CI's about which
decisions are overdue, on the same corpus, on the same day, with no error anywhere. Whatever
happens to this record, the resolver belongs in core beside the kernel it feeds.

> **Closed 2026-08-16 — the two passages above are preserved as measured, not corrected.**
> `resolveAsOf` now lives at `packages/core/src/queue/as-of.ts` and is exported from the package
> entry point, so a library consumer computes the same calendar date the CLI does. The
> present-tense claims above ("is not exported from core at all") describe the tree **as measured
> at this document's writing**, and they are left standing because they are the evidence for the
> assembly argument this section makes — rewriting them would erase the finding while keeping the
> conclusion it produced. ADR-0031 action item 7 records the closure. The eight-call `explain`
> chain is **unchanged** and remains open.

### Both consumption modes, as found

| consumer | mode | evidence |
|---|---|---|
| `@adrkit/ci` | library | 14 symbols from `@adrkit/core` across 6 files |
| `@adrkit/catalog-envelope` | library | 3 symbols (`CatalogSnapshot`, `CatalogSnapshotEntity`, `canonicalStringify`) |
| `@adrkit/spec-kit` | CLI | `scripts/context.sh` shells to `adr check --json` / `adr queue --format json` |

`context.sh` is 16 lines and needs no types at all — it forwards paths to `adr check` and falls
back to `adr queue`. It is the clearest evidence for ADR-0031 clause 5's position that the CLI
JSON is a **sibling contract rather than an SDK adapter**: nothing this consumer needs would be
improved by a JavaScript package.

## The surface

Seven callable entry points. One I/O door, six projections of the already-loaded corpus.

```text
openDecisions(options?)              -> Promise<DecisionSet>
DecisionSet.records                     browsing the corpus
DecisionSet.issues                      corpus health
DecisionSet.get(id)                     record status, one record
DecisionSet.queue(options?)             the ARB queue and its SLA state
DecisionSet.graph(options?)             the supersession graph; relationship edges on request
DecisionSet.governing(path, options?)   path-governance, explicitly supplied path
```

Declared at [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts).

### Implementation

The surface above is implemented without changing a declared type. `openDecisions`
lives in [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts); the mapping layer
that turns each core result into an SDK shape is
[`packages/sdk/src/decision-set.ts`](../packages/sdk/src/decision-set.ts). Each entry point
follows the CLI command that answers the same question, call for call:

| Entry point | Core kernels | CLI JSON it is tested equal to |
|---|---|---|
| `openDecisions` | `lintCorpus({ dir, cwd })` | — (an unreadable corpus directory rejects with `Corpus directory not found` / `not readable`, classified by the same rule as `corpusDirectoryErrorKind` in `packages/cli/src/errors.ts`, the cases `adr` turns into exit 2; a pathless `EIO`/`ESTALE` is rethrown, as there) |
| `.records` | `lintCorpus().records`, `decisionBucketFor`; `body` is core's `Adr.body` | `adr graph --format json` nodes (id, title, status, order); `body` against each file's text after its closing fence |
| `.issues` | `lintCorpus().findings`, `sortFindings` | `adr lint --json` findings (`rule` → `code`) |
| `.get(id)` | id lookup, last duplicate wins as in `toGoverningDecisions`; `31` pads to `0031` | — |
| `.queue({ asOf })` | `buildQueueReport`; a supplied `asOf` checked with `resolveAsOf` and required to be a bare `YYYY-MM-DD` | `adr queue --format json --as-of` items (including the review counts) and `corpusFindings` |
| `.graph({ kinds })` | `buildAdrGraph`, edges filtered to `kinds` (default `['supersedes']`) | nodes: `adr graph --format json`; edges: `--kind supersedes` by default, each `--kind` for one kind, unfiltered for all three |
| `.governing(path)` | `readSourceMarkers` → `resolveAffects` → `resolveSourceMarkers` → `mergeSourceDeclarations` → `toGoverningDecisions` → `bucketDecisions` → `sortFindings` | `adr explain <path> --json` groups and findings |

Five points where the declared surface left a choice, and how each was settled:

- **Issue codes follow the CLI JSON for the same question.** `DecisionSet.issues` and
  `PathGovernance.issues` carry lint rule names verbatim (`corpus-file-skipped`), and
  `QueueView.issues` carries the queue contract's codes (`corpus.file-skipped`). The type's
  former single example named only the queue spelling.
- **`governing` keeps `adr explain`'s corpus-error gate.** A corpus with an error-severity issue
  answers with empty groups and the corpus's own issues, because an unloaded record may be the
  one that governs the path.
- **A marker scan that could not look is an issue, not silence** (ADR-0016): `marker-scan-absent`
  (`info`), `marker-scan-unreadable` and `marker-scan-out-of-tree` (`warn`). `adr explain --json`
  reports the same fact under `markers.state`, which `PathGovernance` has no key for.
- **`graph()` nodes are every record**, as unfiltered `adr graph` prints them, whatever
  `kinds` selects; `--kind` would also drop records no kept edge touches. They are the mapped records in
  `buildAdrGraph`'s stable id order, never looked up by id, so a corpus that repeats an id
  shows both records, as the CLI does. `get(id)` alone resolves a repeated id to the last
  record, the one `governing` and `adr explain` resolve it to.
- **The `asOf` default is inlined** as `new Date().toISOString().slice(0, 10)`, a fourth copy of
  the absent-input clause. ADR-0031 action item 8 — a publication gate for this package —
  replaces all four with one core export; it is deliberately not done here.

All filesystem access is `openDecisions` plus `governing`'s marker read through core's confined
reader (skipped with `readMarkers: false`). Nothing in the package writes. The returned records,
arrays, and views are frozen, so one consumer of a shared handle cannot alter another's view.

### Why a handle, not free functions

The known first consumer is a Backstage backend serving many requests against one corpus. Free
functions would re-read and re-validate the corpus on every request; a handle loads once. It
also concentrates every filesystem touch except the marker scan into a single entry point,
which is what makes the other six synchronous and trivially testable.

**Methods are counted as entry points.** The handle is a caching and cohesion decision, not a
counting trick — collapsing six functions into six methods and then reporting "1 entry point"
would be exactly the trimming-to-fit that action item 3 warns against.

### Per-entry evidence

| # | Entry point | Tier 1 capability (ADR-0029 cl. 1) | Absorbs | Evidence |
|---|---|---|---|---|
| 1 | `openDecisions` | all — single I/O door | `lintCorpus`, dir resolution, unreachable-dir handling | `runQueue` and `runExplain` each re-implement the unreachable-dir case separately |
| 2 | `.records` | browsing the corpus | `Corpus.records` → flat record, `decisionBucketFor` precomputed | `Adr` nests under `frontmatter`; consumers want `record.status` |
| 3 | `.issues` | corpus health | `sortFindings`, severity split | `corpus.file-skipped` is `warn`, not `error` — a `proposed` record can otherwise vanish silently |
| 4 | `.get(id)` | record status, one record | id normalization + lookup | a deep-link route (`/adr/0031`) resolves one record; linear-scanning `records` is the alternative |
| 5 | `.queue(options?)` | ARB queue + SLA state | `buildQueueReport` **+ the CLI's `--as-of` resolver** | that resolver was 25 lines in `packages/cli/src/queue.ts` and unexported at measurement; **closed 2026-08-16** — now `resolveAsOf` in `packages/core/src/queue/as-of.ts`, exported |
| 6 | `.graph(options?)` | supersession graph (relationship edges opt-in through `kinds`; see [Additive extension](#additive-extension)) | `buildAdrGraph` | frontmatter alone silently drops a supersession target that does not exist; the built graph reports it |
| 7 | `.governing(path)` | path-governance, explicit path | the eight-call `explain` chain, incl. the `@adr` marker scan | `runExplain`, `packages/cli/src/index.ts` |

### What is deliberately excluded, and why

Exclusions are the load-bearing half of a narrowing exercise, so each carries its reason:

- **Rendering the document layer** (ADR-0029 clause 9) — rendering ADR prose belongs to
  `@backstage-community/plugin-adr` via its `contentDecorators` / `statusComponent` extension
  points. *Reversed in part:* the first enumeration also excluded the raw `body` on this
  ground. `DecisionRecord.body` now carries it, unrendered and unsanitized, because a static
  portal and a REST API need the prose and have no other way to reach it without re-reading
  every file. Rendering and sanitizing stay out: they are the consumer's. See
  [Additive extension](#additive-extension).
- **Anything needing the entity-ownership mapping** — Tier 2, not authorized. ADR-0029 clause 2:
  *"where clauses 1 and 2 both admit a capability, clause 2 governs."*
- **`resolveAffects` against a *derived* path.** Clause 1 admits path-governance only for a path
  that is *explicitly supplied* — typed by a person, or set in configuration a person wrote.
  **This surface cannot enforce that**: a `string` does not carry its provenance, so
  `.governing(path)` will answer for a path derived from a catalog entity just as readily as for
  a typed one. The obligation sits with the caller. It is stated in the method's own doc comment
  because an unstated obligation is one that gets discharged by accident — and this is the
  precise gap ADR-0029's context section calls *"exploitable rather than merely untidy."*
- **All writers** — `adr new`, `migrate`, `evaluate`. Not Tier 1, and a read-only first surface
  is a smaller one-way door.
- **Findings/lint detail beyond `CorpusIssue`** — `adr lint`'s full finding vocabulary is a CI
  concern, and ADR-0031 clause 6 has not yet converged `lint --json` onto a core formatter.

### On the three identical unions

`DecisionStatus`, `DecisionStanding`, and `SlaState` are structurally identical to unions core
also exports. That is deliberate, and it is the one place the divergence discipline is
consciously not applied.

They are not *core's* vocabulary — they are `schema/adr.schema.json`'s and the queue contract's.
**ADR-0029 clause 6 names that schema as a contract in its own right, and ADR-0031 does not
narrow it.** Those values are therefore already committed to consumers by a different record.
Re-deriving them under new names here would buy no insulation; it would add a translation table
that can drift from the schema it claims to describe, and a consumer switching on
`'accepted'` would have to learn a second spelling of a word the schema already published.

The rule this expresses, stated so it can be applied to the next type: **diverge from core's
implementation shapes; converge on the schema's published vocabulary.** Where core and the
schema agree, matching core is a consequence rather than a re-export.

## Additive extension

Three additions made as part of the implementation scope, for a GitHub Pages portal and a REST
API built on this surface. The decision is recorded in a proposed record that lands in a separate
pull request. All
three are additive to a type a caller already holds; none adds an entry point.

| Addition | Core source | Notes |
|---|---|---|
| `DecisionRecord.body: string` | `Adr.body`, the text `parseFrontmatter` keeps after the closing `---` when `lintCorpus` reads the file | No second read. Verbatim: line endings kept, nothing rendered or sanitized. It is repository text, so a consumer that inserts it as HTML unsanitized has built an injection path. |
| `QueueEntry.approvalCount` | QueueReport v1 `approvalCount` | Distinct identities under ASCII casefold (ADR-0051), as the kernel and `adr accept` count them — not `approvals.length`. |
| `QueueEntry.quorum` | `quorum` | `null` when the record sets none. |
| `QueueEntry.unresolvedObjectionCount` / `resolvedObjectionCount` | the same names | |
| `QueueEntry.routingTargets` | `routingTargets` (the record's `deciders`) | Frozen copy. |
| `QueueEntry.itemFindingCount` | `itemFindings.length` | The count only, under the name the decision board uses. |
| `DecisionEdge.kind`, `graph({ kinds })` | `GraphEdge.kind` from `buildAdrGraph` | Direction is core's: `supersedes` runs successor → replaced; `relatesTo`/`conflictsWith` run from the declaring record. |

Decisions this left open, and how they were settled:

- **Review fields keep QueueReport v1's names.** That contract is already published (badges
  read it from `queue.json`), so a portal reading the SDK and one reading
  `adr queue --format json` see the same numbers under the same names. `path` and `deadline`
  keep their earlier SDK names.
- **No readiness verdict** (ADR-0050). Review state misses refusals such as an empty
  `deciders` that only `adr accept`'s transition catches, so the SDK reports counts and does not
  combine them.
- **`graph()` stays supersession-only by default.** Entry point 6 was enumerated as *the
  supersession graph*, `SupersessionEdge` named it, and the equivalence test pinned it to
  `--kind supersedes`. That is a documented contract, so relationship edges are an opt-in
  `kinds` option and a caller that passes nothing gets the edges it always got, now with
  `kind: 'supersedes'` on each. An empty or unknown `kinds` list throws `RangeError` rather than
  guessing between "default", "all", and "none".
- **`SupersessionEdge` is renamed `DecisionEdge`, with no alias.** The package is unpublished at
  0.0.0 with no consumers; an alias would be a symbol kept for nobody.

## What was verified

- `bun test` — full suite, including 4 new `packages/sdk/test/packaging.test.ts` assertions and
  3 new `check-deps` cases.
- `bun run typecheck`, `bun run adr lint`, `bun run check:deps`.
- **ADR-0016 clause 2 — three new checks, each observed failing first:**
  - `check:deps` had **no allowlist entry** for `@adrkit/sdk`, which means
    `allowedDependenciesFor()` returned `undefined` and the allowed-surface guard was skipped
    entirely — a green check that meant nothing, exactly as `check-deps.ts`'s own comment warns.
    Confirmed by watching `undici: '^6'` pass, then adding the entry and watching it fail.
  - The clause-8 no-release assertion, confirmed by temporarily adding `@adrkit/sdk` to
    `scripts/release-pack.ts` and watching it fail.
  - The clause-4 no-re-export assertion, confirmed by temporarily adding
    `export type { Adr } from '@adrkit/core';` and watching it fail.

## What this does not establish

- **ADR-0014 rung 1 only.** The implementation has unit, behaviour, and CLI-equivalence tests
  (`packages/sdk/test/`), the equivalence run against two fixture corpora and this repository's
  own `docs/adr`. No consumer has exercised the surface, because the one it was designed for does
  not exist yet. ADR-0031's own trade-off — *"the risk is that the guess hardens before the
  Backstage plugin tests it"* — is not mitigated by this work, only made concrete enough to
  criticize.
- **Implemented, not exercised.** The eight-call `explain` assembly the surface claims to absorb
  is now written and tested equal to `adr explain --json`; its fitness for a long-lived server
  consumer is still argued, not observed.
- **No release, and none prepared.** ADR-0031 clause 7 specifies `versioning: 'independent'`
  *when* released; wiring that into `scripts/release-pack.ts` now would prepare an act clause 8
  does not authorize, so it is deliberately absent — and asserted absent by test, so its absence
  is a fact rather than an oversight.
