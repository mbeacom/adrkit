# Contract: `@adrkit/core`/`@adrkit/evaluator` additive projection surface

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md) |
**Research**: [../research.md](../research.md) §R3 | **Data model**:
[../data-model.md](../data-model.md) §§1–3 | **Date**: 2026-07-20

This contract defines the **entire** change this feature requires outside
`packages/mcp/`: one new `@adrkit/core` file, one new `@adrkit/core` export line, and
one existing `@adrkit/evaluator` file migrated (behavior-preservingly) to call that new
export instead of its own private, duplicated copy. It also defines the boundary between
what stays in `@adrkit/core` (because it is genuinely shared, previously-duplicated
parsing logic with a second real caller today) and what stays entirely inside
`@adrkit/mcp` (because it is a policy or an indexing detail specific to one consumer). It
exists as a separate contract from contracts/tools.md because it governs the **library
boundary** between packages, not tool behavior over the wire.

This contract promotes exactly **one** function — `parseAdrRef` — because it is the only
one with a real, today caller (`no-orphan-refs.ts`'s private copy) and a real, planned
second caller (`@adrkit/mcp`'s `get_decision`/`list_superseded`). There is no
`formatAdrRef`: nothing in this feature's planned production call sites ever needs to
re-serialize a `(log, id)` pair back into a `log:id` string — every place this design
echoes a ref back to a caller (`requestedRef`, a `targetRef`) simply reuses the caller's
own original input string verbatim, never reconstructs one from parsed parts. Adding an
inverse function with no production caller would be speculative surface this contract's
"smallest change that satisfies the task" posture rejects.

---

## 1. What changes in `@adrkit/core`, and in `@adrkit/evaluator`

**One new file**: `packages/core/src/schema/ref.ts`.

```ts
export interface ParsedAdrRef {
  readonly id: string;
  readonly log?: string;
}

export function parseAdrRef(ref: string): ParsedAdrRef {
  const idx = ref.indexOf(':');
  if (idx <= 0) return { id: ref };
  return { log: ref.slice(0, idx), id: ref.slice(idx + 1) };
}
```

`parseAdrRef` is **specified to preserve the exact observable behavior and object shape**
of the private `parseRef` formerly shipped in `packages/evaluator/src/rules/no-orphan-refs.ts`
(identical `indexOf`/`idx <= 0` logic: an unqualified ref, or one with a **leading**
colon, returns `{ id: ref }` — `id` is the untouched original string, colon included when
present, because it was never split; a qualified ref returns `{ log, id }`, split on the
first colon) — this is a promotion of already-proven logic to one shared, exported,
tested location, not a behavior change or a reinterpretation of the grammar. "Byte-identical"
is deliberately not the claim made here: the promoted function is behavior- and
object-shape-preserving for every input, which is the property that actually matters (the
two implementations produce the same return value for the same input and agree on which
keys are present), not that the two source files were ever literally byte-for-byte the
same text.

**One new export line** in `packages/core/src/index.ts`:

```ts
export * from './schema/ref.ts';   // ADDED — sits alongside the existing 13 lines, none of which change
```

**One migrated caller, in the same change — not deferred**:
`packages/evaluator/src/rules/no-orphan-refs.ts`'s private `parseRef` function is
**removed**, and its one call site is replaced with an import of `parseAdrRef` from
`@adrkit/core` (already a direct dependency of `@adrkit/evaluator` — no new dependency).
Because the two functions are specified to be behavior- and object-shape-preserving for
every input, this is a safe substitution: `no-orphan-refs.ts`'s own existing test suite is
expected to pass unchanged, with no new or updated assertions required to prove the
migration correct beyond "the suite still passes." This migration is included **in this
same change** — not deferred to "a separate, optional follow-up" — because the
duplication this promotion exists to close already has a second, real caller today
(`no-orphan-refs.ts`); promoting the logic to a shared export while leaving that caller's
own private copy in place would recreate the exact duplication the promotion is meant to
close, just with an unused third copy sitting beside it.

**Future changes this promotion enables, stated precisely so its cost is not
understated**: adding a second real caller inside `@adrkit/mcp` (`get_decision`,
`list_superseded` — contracts/tools.md §§4, 7) later requires exactly: one import line
per call site, and zero changes to `ref.ts` itself or to `no-orphan-refs.ts`. No further
`@adrkit/core` surface is anticipated by this feature.

**Nothing else changes.** `packages/core/src/load/corpus.ts` (`loadCorpus`, `Corpus`,
`byId`, `discoverAdrFiles`, `expandRecordInputs`, `parseAdrFile`,
`normalizeDisplayPath`), `packages/core/src/validate/*.ts` (`lintCorpus` and every
validation rule, including `unique-id` and the dangling-reference checks), every other
`@adrkit/evaluator` rule module, `packages/core/src/graph/build.ts`,
`packages/core/src/affects/*.ts`, and `packages/core/src/check/index.ts` are
**byte-for-byte unmodified**. `packages/core/package.json`'s and
`packages/evaluator/package.json`'s `dependencies` are unmodified — `ref.ts` uses no
dependency at all, and `no-orphan-refs.ts`'s migration adds no new import target beyond
`@adrkit/core`, which it already imports from.

## 2. What deliberately stays out of `@adrkit/core`

| Concept | Why it is `@adrkit/mcp`-only, not a core export |
|---|---|
| The local, multi-valued `id` index (`byId: Map<string, readonly Adr[]>`) | Builds directly off `Adr.frontmatter.id` — no string parsing involved, so there is no shared *parser* to deduplicate. A six-line loop over `lintCorpus()`'s own output, specific to how `@adrkit/mcp` needs to answer "zero/one/many" — not a general-purpose corpus concern any other consumer has asked for, and deliberately **not** log-qualified: this phase has no `log` dimension to index by at all (`@adrkit/core` never populates `Adr.log`), so there is nothing log-shaped to promote either. |
| The 64 KiB source-size guard, stable-load verification, and their `record-too-large`/`record-stat-error`/`corpus-changed-during-load` outcomes | Product policy of this one feature (FR-012), not a property of `@adrkit/core`'s loading contract. Adding it to `lintCorpus` would silently change `adr lint`/`graph`/`check` for every existing consumer. It runs on top of the already-exported `discoverAdrFiles`: pre-stat candidates, call `lintCorpus` only on initial survivors, then post-stat those survivors and reject the provisional projection if identity/size changed (data-model.md §3.3). No new core surface is needed. |
| The corpus fingerprint (research §R6) | Specific to this feature's pagination-staleness design; no other consumer has a cursor to bind it to. Computed by `@adrkit/mcp` over the **parsed wire projection** it already builds for other reasons (the records, the findings, the two health counts) — never over raw file bytes — so it needs no new core surface to get at that data; it is a pure, additional CPU pass over structures `@adrkit/mcp` already holds. |
| The locale-independent code-unit comparator (research §R6) | A one-line, self-contained function (`a < b ? -1 : a > b ? 1 : 0`) with no dependency and no reason to live anywhere but beside its one caller; promoting a five-token function to a shared export would be the wrong kind of "shared logic" this contract's §1 promotion is reserved for. |
| Any output/wire shape (`DecisionSummary`, `FullDecision`, the four tools' result unions, `federated-log-unavailable`, `ambiguous-local-id`) | Entirely presentation-layer concerns of one MCP server; `@adrkit/core` has and needs no concept of "search match," "candidate list," or "federated-log-unavailable" — the last of these is a decision about how *one tool* responds to a grammar `@adrkit/core` already validates, not a new core capability. |

## 3. Verification this contract implies

- **Unmodified existing behavior, everywhere except the one migrated call site**:
  `git diff` against `packages/core/src/**` (excluding the one new `ref.ts` file and the
  one new export line) is empty after this feature lands. `git diff` against
  `packages/evaluator/src/**` shows exactly one file changed
  (`rules/no-orphan-refs.ts`), and that diff is limited to replacing the private
  `parseRef` definition and its one call site with an import of `parseAdrRef` — no other
  line changes. `adr lint`/`graph`/`explain`/`check`/`evaluate`, `@adrkit/ci`, and every
  `@adrkit/evaluator` rule **other than** `no-orphan-refs` are unaffected without needing
  to be re-run against different behavior, only re-run to confirm they still pass
  unchanged; `no-orphan-refs.ts`'s own test suite must still pass unchanged, which is the
  direct evidence the migration preserved behavior and object shape.
- **`core-has-no-adapter-deps` / clean-clone**: `ref.ts` adds no dependency, so
  `scripts/check-deps.ts`'s existing `@adrkit/core` allow-list needs no change at all —
  the new file is pure TypeScript with no imports beyond nothing. `@adrkit/evaluator`'s
  allow-list entry likewise needs no change: `no-orphan-refs.ts` already imports from
  `@adrkit/core`, and the migration adds no new package to its import graph.
- **`schema:emit` byte-clean**: `ref.ts` does not touch `AdrFrontmatter` or any other
  Zod schema value; `bun run schema:emit && git diff --exit-code schema/adr.schema.json`
  reports no diff.
- **Unit coverage for the new file**: deep-equality assertions on `parseAdrRef`'s return
  value for the two shapes the grammar actually produces — an unqualified ref (e.g.
  `"0042"`) and a leading-colon ref (e.g. `":0042"`) each assert `toEqual({ id: ref })`
  (the whole original string, colon included when present, since neither case is ever
  split); a qualified ref (e.g. `"payments:0012"`) asserts
  `toEqual({ log: 'payments', id: '0012' })`. There is deliberately **no** format/
  round-trip test (e.g. no assertion of the shape `format(parse(ref)) === ref`), because
  no such inverse function exists in this design (see the note above §1) — a round-trip
  test would be asserting behavior of a function this contract does not add. A small,
  fast, `@adrkit/core`-local test, independent of anything in `@adrkit/mcp`.
- **Unit coverage for the migration**: `no-orphan-refs.ts`'s existing fixture set
  (resolved/dangling/federated-log-absent refs) continues to pass with zero fixture
  changes required — the migration's entire correctness claim is "nothing observable
  moved," and an unchanged test suite passing unchanged is exactly the evidence for that
  claim, not a weaker substitute for it.
