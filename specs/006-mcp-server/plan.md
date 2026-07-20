# Implementation Plan: MCP Server (Read-Only Retrieval) — Phase 5

**Feature directory**: `006-mcp-server` (scoped in place — **no git branch is created or
switched** by this work; the header note in `spec.md` already establishes this and
nothing here changes it) | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-mcp-server/spec.md` (Functional
Requirements FR-001–FR-040, Success Criteria SC-001–SC-016, Assumptions A1–A9).
**Normative sources** (ADRs win on conflict): [ADR-0001](../../docs/adr/0001-record-architecture-decisions-in-git.md)
(git is truth; every consumer, including this server, is a reader),
[ADR-0002](../../docs/adr/0002-typed-frontmatter-as-madr-superset.md) (the typed schema,
`Status`, the log-qualified `AdrRef` grammar, the four relation-ref fields),
[ADR-0004](../../docs/adr/0004-git-is-source-of-truth-database-is-an-index.md) (git is
truth; the database is a derived, optional index; names "the MCP retrieval tools" as a
reader, never a second writer), [ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md)
(adapter isolation; clean-clone build; **completed dogfood evidence recorded below**),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (pure
`affects` resolution this server reuses unchanged), [ADR-0010](../../docs/adr/0010-bun-toolchain.md)
(Bun for development; Node-targeted published artifact; names the MCP server explicitly
as launched under Node by third-party harnesses), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles
I–V.

> **✅ Phase 4 real-user gate evidence — already recorded, not re-litigated here.**
> `spec.md`'s header callout records the maintainer's `adr evaluate` run against the
> genuine, then-`proposed` ADR-0007 on 2026-07-20: a real `assertions-compile.no-source`
> failure on first run, a one-line fix (declaring the two symbolic custom-expression
> sources), and a clean rerun (`outcome: ok`, eleven ordered rules, two honest `warn`
> findings, `one-way-door` proven, routed to `@mbeacom`). This plan treats that evidence
> as **satisfied and closed** — it is the outcome-ladder rung-5 (project Phase 4)
> real-user precondition this rung-4 (project Phase 5) feature's implementation gate
> depends on, per `plan.md`'s (root) outcome-ladder rule.
>
> **✅ SC-016 satisfied 2026-07-20.** The maintainer explicitly ratified the exact
> four-tool, local-only, read-only boundary and its exclusions. Both governance
> preconditions are now closed. The 43-task graph is generated. Fresh analysis found
> one critical and five high-severity artifact defects; this revision remediates those
> contracts and tasks, and implementation remains blocked until a fresh analysis reports
> no blocking or high-severity finding.

## Summary

Build `@adrkit/mcp`: a local, stdio-only, read-only Model Context Protocol server
exposing **exactly four tools** — `search_decisions`, `get_decision`,
`get_decision_context`, `list_superseded` — over the same `@adrkit/core` parsing,
validation, graph, and `affects`-resolution primitives the CLI and CI surface already
use, plus one small, additive `@adrkit/core` export (`parseAdrRef` only — research §R3)
— used to detect whether a caller-supplied `ref` carries a `log:` qualifier, not to
build any log-aware index — together with a migration of
`packages/evaluator/src/rules/no-orphan-refs.ts` to import that export instead of its own
private, duplicated copy, preserving that rule's exact observable behavior and result
shape. This is the entire `@adrkit/core` change: one new file, one new export line, and
one existing file migrated to call it; no existing behavior changes anywhere in
`@adrkit/core` or `@adrkit/evaluator`, and no dependency changes. The server depends on
the stable, current `@modelcontextprotocol/sdk` at **exact `1.29.0`** (verified against
first-party sources and empirically against the pinned package itself — research
§§R0–R1; v2 is a separate, beta, split-package line, not this phase's dependency). This
phase serves exactly one local corpus and defers named-log/multi-repository federation
completely — `@adrkit/core` never populates a record's `log` field and this server's
discovery is non-recursive, so there is nothing to index or search by log; local
identity is a record's bare `id`, alone. The configured corpus root and ADR directory
are both realpath-canonicalized before use — the root once per server instance, the ADR
directory freshly on every corpus load — and checked for path-segment-safe containment,
not a lexical `..`/prefix check, so a symlinked directory that escapes the repository
cannot be trusted, whether the symlink existed at startup or was swapped in afterward
(research §R7; data-model.md §8). Every tool call reloads the configured corpus fresh via
`@adrkit/core`'s existing `lintCorpus()` — never `loadCorpus()`/`Corpus`/`byId`, which
remain untouched and unused — preceded by a **pre-read** 64 KiB size guard (every
candidate file `discoverAdrFiles` finds is `stat`'d, and only paths within-limit at that
check are passed to `lintCorpus`; a second metadata/cap check after loading rejects the
whole provisional projection as `corpus-changed-during-load` if any candidate changed,
so a changing or now-oversized record is never returned as stable; both guard-produced
findings are severity `error`, since the corpus is genuinely incomplete even though the
call still proceeds), a local,
multi-valued `id` index (never a single arbitrary representative when more than one
record shares an id), and a corpus fingerprint over exactly the **corpus projection** —
a canonical JSON serialization of the in-limit records, `@adrkit/mcp`'s own corpus
findings (never a tool-derived finding — see below), and the two corpus-health counts,
never a hash of raw candidate-file bytes — all ordered with one fixed, locale-independent
code-unit comparator `@adrkit/mcp` defines itself (never reusing `@adrkit/core`'s own
`localeCompare`-based finding order), entirely inside `@adrkit/mcp` (data-model.md §3).
Each tool handler builds its own response findings by concatenating that shared corpus
projection's findings with whatever it deterministically derives for its own call (a
per-record `resolveAffects` finding for `get_decision_context`; a compact
`superseded-target-ambiguous`/`-federated-unavailable` finding per affected entry for
`list_superseded`; nothing for the other two tools), re-sorting canonically before
paginating — the shared projection itself is read-only and is never mutated to accumulate
a tool's own derived findings (data-model.md §3.5). Every response is a strict, versioned,
discriminated-union output shape (verified empirically to be the one pattern the SDK's
own output-schema validation actually supports — research §R1.1) that distinguishes a
usage/input-contract problem, a well-formed empty/`ambiguous-local-id`/`not-found`/
`federated-log-unavailable` result, and a corpus finding, never conflating them
(FR-015). Every growing channel — search matches, ambiguous-local-id candidates,
decision-context matches, findings — is cursor-paginated with a base64url-encoded,
versioned, corpus-fingerprint-and-query-bound cursor (research §R6; contracts/pagination-and-cursors.md);
"opaque" here is an MCP-protocol convention about caller intent, not a confidentiality or
tamper-proofing claim — every supplied cursor is always decoded and strictly verified
(never silently skipped because a call's outcome happens to need no pagination), and a
corpus change, a parameter change, an inapplicable channel, or an out-of-range offset
between pages each fails explicitly, as a distinct `invalid-cursor` reason, rather than
silently gapping or duplicating. `list_superseded`'s per-entry ambiguity never embeds an
unbounded candidate list inside a page item — an ambiguous entry carries only a
`candidateCount`; the full candidate list remains available, already paginated, via a
follow-up `get_decision` call. No write tool, no MCP prompts/resources/subscriptions/
sampling, no model call, no network access beyond what a defense-in-depth runtime
harness plus import discipline can observe and bound, no authentication, no persistent
cache/index/database, and no absolute filesystem path in any response (FR-001–FR-011,
FR-017).

This plan was produced during the advance-scoping step root `plan.md` permits.
SC-016 was explicitly ratified on 2026-07-20, and `tasks.md` has since been
generated. These artifacts do not themselves constitute implementation; the
current cross-artifact findings must be resolved before implementation begins.

## Technical Context

**Language/Version**: TypeScript (ESNext), developed and tested with **Bun** (pinned
`1.3.14`, matching this project's existing pin — `packageManager` in root
`package.json` and every prior feature's plan). Published artifact targets Node
**`>=22`** (ADR-0010), smoke-tested under Node 22 and 24 (matching the existing
`node-smoke-built-artifacts` CI job's matrix).

**Primary Dependencies**: `@adrkit/mcp` depends on **`@adrkit/core` (`workspace:*`)**,
**`@modelcontextprotocol/sdk` (exact `1.29.0`)**, and **`zod` (`^4`**, matching the rest
of the workspace)** — nothing else. It imports only the SDK's `server/mcp.js`,
`server/stdio.js`, and `inMemory.js` subpaths in production code (`client/index.js` is
test-only); the SDK's own HTTP/OAuth transport dependency tree (`express`, `hono`,
`jose`, `cors`, `ajv`, etc.) is installed transitively but never imported or executed by
this package's code (research §R2). No adapter dependency, ever (Principle III;
ADR-0007's `core-has-no-adapter-deps`, extended to this package exactly as it already
extends to `@adrkit/evaluator`).

**Storage**: **None.** No database, no persistent cache, no on-disk index. Every tool
call reads the configured corpus directly via `@adrkit/core`'s `lintCorpus()`, fresh,
for that call (FR-010; ADR-0004: git is truth, any index is derived and never required).

**Testing**: `bun test`. Three lines of evidence (research §R8, §R10): (1) in-process, via
`InMemoryTransport.createLinkedPair()` driving the SDK's own `Client` against a
package-internal registered-server builder absent from public exports — the primary
surface for every discriminated-outcome branch, cursor/fingerprint edge case, and
adversarial-input fixture; (2) a real stdio-subprocess
byte-capture test (both under Bun against `src/bin.ts`, and under Node 22/24 against the
built `dist/bin.js` in the existing Node-smoke pipeline) proving `stdout` carries only
well-formed JSON-RPC frames; (3) dedicated side-effect-denial preloads/tests
(`packages/mcp/test/side-effect-denial-preload.mjs`) that throw on the enumerated
network, filesystem-mutation, subprocess, worker, native-addon, and Bun-shell entry
points, loaded while starting the same stdio subprocess and calling all four tools at
least once, with independent full-sandbox/parent-sentinel/`HOME`/`TMPDIR` snapshots.
This is executed-path defense-in-depth evidence, complementing (never substituting for)
the declared-dependency and import-discipline checks (research §R10; FR-002, FR-011,
SC-005, SC-013).

**Target Platform**: a local subprocess, launched by an MCP-compatible agent harness
over stdio (A6). The frozen Bun install may use only the unauthenticated public package
registry; every post-install gate and runtime path is network-disabled and uses only the
configured corpus on disk (Principle II).

**Project Type**: Bun-workspace monorepo — adds a first-party **`packages/mcp/`**
surface package (peer of `@adrkit/cli`/`@adrkit/ci`/`@adrkit/evaluator`, not an adapter
— research §R2), one small, additive `@adrkit/core` export, and one behavior-preserving
`@adrkit/evaluator` migration to use it (contracts/core-projection.md); reuses
`@adrkit/core`'s existing parser, schema validator, corpus invariants, graph builder, and
`affects` resolver verbatim — no second implementation of any of them (FR-029, FR-037).

**Performance Goals**: no numeric SLO is specified by `spec.md`; the operative property
is *cost*, not *latency* — every call's cost is linear in corpus size (one full
`lintCorpus()` read) plus, for `get_decision_context`, `O(files.length × records)`
`resolveAffects` calls (research §R4, deliberately chosen over a single ambiguous
batched call). No model call means no token cost and no external-latency variance to
budget for (ADR-0005's short-circuit posture, extended to this phase's "no model at
all").

**Constraints**: every call rereads the corpus — no caching layer may be added later
without first revisiting FR-010, which this plan treats as load-bearing, not an
optimization to relax; the size guard, canonical index, and fingerprint stay entirely
inside `@adrkit/mcp` and never modify `@adrkit/core`'s observable behavior for any
existing consumer (contracts/core-projection.md §3); every output schema's root stays an
object per the MCP `Tool.outputSchema` requirement, which rules out a bare top-level
discriminated union (research §R1.1 — verified, not assumed) and fixes the `{
corpusHealth, result }` envelope shape used identically by all four tools.

**Scale/Scope**: this project's own corpus size (tens of records today, plausibly low
thousands for an adopting organization) — no scale target beyond "the same corpus sizes
`@adrkit/core`'s other consumers already handle," since this server adds no new storage
tier and performs no aggregation beyond one linear pass per call.

## Constitution Check (pre-design gate)

*GATE: evaluated **before** Phase 1 design below. No violations — Complexity Tracking is
intentionally empty. The SC-016 maintainer-ratification callout above is an
**outcome-ladder/governance precondition on implementation**, not a Principle I–V
design violation, exactly as the equivalent T018 gate was treated in feature 005's plan.*

| Principle | Pre-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS (planned) — all four tools are read-only; none creates, edits, deletes, or proposes a change to any record, any other file, or any git ref (FR-002). No database is read or required (FR-010; ADR-0004 already names "the MCP retrieval tools" as a reader). |
| **II. Clean clone builds green** | PASS (planned) — Constitution v1.0.2 permits only `bun install --frozen-lockfile` to use the unauthenticated public registry. `@adrkit/mcp`'s exact-pinned SDK is public, MIT-licensed, and zero-advisory as checked 2026-07-20; after installation, build/typecheck/test/lint/packaging/smoke/runtime run with networking disabled, no credential, and no service (FR-005/FR-006/FR-011/FR-039; research §R0/§R2/§R10). |
| **III. Core depends on no adapter** | PASS (planned) — `@adrkit/mcp` is a first-party **surface** package (peer of `@adrkit/cli`/`@adrkit/ci`/`@adrkit/evaluator`), not `packages/adapters/*` and not core, following the exact precedent `@adrkit/evaluator` already established for a surface package depending on one additional vetted, deterministic, network-free public library beyond `zod`/`yaml` (research §R2). `@adrkit/core` never depends on `@adrkit/mcp` (FR-038) — the one new core export (`parseAdrRef`) and its one migrated caller (`@adrkit/evaluator`'s `no-orphan-refs.ts`) add no new dependency to either package at all. |
| **IV. Deterministic before probabilistic** | PASS (planned) — no model, embedding, sampling, or ranking of any kind, anywhere in this phase (FR-004). Search is deterministic normalized literal matching (FR-025/FR-026, research §R5); every result set is canonically ordered, never by relevance (FR-018/FR-027). A matcher with no backing snapshot resolves inert with an informational finding, exactly as `@adrkit/core`'s existing `resolveAffects` already does — no new degradation semantics are invented (FR-032; ADR-0009). |
| **V. The schema is the contract** | PASS (planned) — no schema change; `schema/adr.schema.json` is untouched (`schema:emit` byte-clean). `get_decision` returns `@adrkit/core`'s own `AdrFrontmatter` object reused verbatim, never a hand-redefined subset (data-model.md §4). Every tool's strict, versioned, discriminated output schema (FR-012) was verified empirically against the actual SDK before being finalized (research §R1.1), not assumed to work. |

**Result**: PASS. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/006-mcp-server/
├── spec.md                              # Feature spec (binding; FR-001–FR-040, SC-001–SC-016, A1–A9)
├── plan.md                              # This file
├── research.md                          # R0–R11: SDK version/API (empirically verified), core loading gap, resolveAffects reuse,
│                                         #   search normalization, cursor/fingerprint design, CLI conventions, stdio safety,
│                                         #   why prompts/resources/HTTP/auth/indexing are excluded, distribution wiring, limits
├── data-model.md                        # Reused core types, the one additive core export, the corpus projection, canonical
│                                         #   identity, pagination/cursor shapes, per-tool input/output shapes, server config
├── contracts/
│   ├── core-projection.md               # The ENTIRE @adrkit/core + @adrkit/evaluator change: one new core file, one new core export line, one evaluator file migrated (behavior-preserving)
│   ├── pagination-and-cursors.md        # The one shared cursor/fingerprint wire format every tool implements identically
│   └── tools.md                         # Library/bin split, shared envelope+annotations, canonical order, error/output-schema
│                                         #   reconciliation, per-tool resolution semantics, fixed limits, startup behavior
├── checklists/
│   └── requirements.md                  # Spec quality checklist (done)
└── tasks.md                             # Generated after SC-016 ratification; current Phase 5 implementation worklist
```

### Source Code (repository root — extends merged Phases 0–4; additive only)

```text
packages/core/src/
└── schema/
    └── ref.ts                           # NEW FILE — parseAdrRef(ref); detects a ref's optional "log:" qualifier only — no log-aware index anywhere, no inverse formatter (contracts/core-projection.md §1); zero new dependency
    (packages/core/src/index.ts gains exactly one new `export * from './schema/ref.ts';` line)

packages/evaluator/src/rules/
└── no-orphan-refs.ts                   # MIGRATED, behavior- and object-shape-preserving — imports parseAdrRef from @adrkit/core in place of its own private copy (contracts/core-projection.md §1); no behavior change, no dependency change
(no other file under packages/core/src/** or packages/evaluator/src/** changes)

packages/mcp/                            # NEW first-party surface package @adrkit/mcp (peer of cli/ci/evaluator)
├── package.json                         # deps: @adrkit/core workspace:* + @modelcontextprotocol/sdk (exact 1.29.0) + zod ^4 (T001; research §R0/§R2)
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts                         # PUBLIC: createAdrkitMcpServer(options?) returns only a frozen null-prototype start/close handle; SDK server/registration/transport closure-private (data-model.md §8)
│   ├── server.ts                        # INTERNAL: builds the concrete four-tool SDK server for the public handle and in-memory tests; absent from package exports
│   ├── bin.ts                           # dedicated stdio entrypoint: argv/env parsing, invokes handle.start(); no caller-supplied transport (contracts/tools.md §§1,9)
│   ├── main-module.ts                   # tiny, local isMainModule() guard mirroring packages/cli/src/main-module.ts's own pattern — not a core export, not shared
│   ├── corpus/
│   │   ├── projection.ts                # loadCorpusProjection(): revalidates root/dir, lstat+realpath+bigint-stat checks candidates before/after lintCorpus({ paths: withinLimitPaths, cwd }), rejects observed swaps, then builds byId/corpusFindings/fingerprint (data-model.md §§3, 3.5, 8)
│   │   └── ordering.ts                  # the ONE canonical (id, sourcePath) comparator, using @adrkit/mcp's own locale-independent code-unit comparison (never core's localeCompare-based sortFindings order) — every tool/channel and the findings channel uses it (contracts/tools.md §2)
│   ├── pagination/
│   │   └── cursor.ts                    # CursorPayloadV1 encode/decode/verify, query-shape hashing (contracts/pagination-and-cursors.md)
│   ├── search/
│   │   └── normalize.ts                 # trim → NFKC → toLowerCase() pipeline (research §R5) — the one normalization function every searchable field and the query both call
│   └── tools/
│       ├── search-decisions.ts          # registerTool('search_decisions', ...) — FR-025–FR-028
│       ├── get-decision.ts              # registerTool('get_decision', ...) — FR-021–FR-024; uses parseAdrRef from @adrkit/core to detect a log-qualified ref (→ federated-log-unavailable) vs. an unqualified local id (→ byId lookup)
│       ├── get-decision-context.ts      # registerTool('get_decision_context', ...) — FR-029–FR-033; calls resolveAffects() once per record (research §R4)
│       └── list-superseded.ts           # registerTool('list_superseded', ...) — FR-034; uses parseAdrRef on each supersededBy target the same way
└── test/
    ├── side-effect-denial-preload.mjs    # NEW — Node preload traps enumerated network, filesystem mutation, subprocess, worker, and native-addon APIs; Bun companion traps Bun mutation/spawn/shell paths (research §R10; SC-005/SC-013)
    └── fixtures/                        # offline corpora: one record per Status; duplicate local ids; a log-qualified ref/supersededBy target; oversized source; dangling supersededBy; inert package/entity matchers

scripts/check-deps.ts                    # T036: add '@adrkit/mcp' direct-declaration allow-list
scripts/release-pack.ts                  # T038: add RELEASE_PACKAGES/bin/installed-smoke wiring; release-publish.ts unchanged
scripts/smoke-node.mjs                   # T039: add Node 22/24 handle import + real stdio smoke under side-effect denial
docs/RELEASING.md                        # T040: add @adrkit/mcp distribution/order/coordinated-version guidance; no publication
```

**Structure Decision**: the corpus projection, ordering comparator, cursor codec, and
search normalizer are each their **own** small module inside `packages/mcp/src/`,
mirroring `@adrkit/evaluator`'s existing convention of one concern per module
(`targets/`, `assertions/`, `identity/`, `routing/`, `report/`) rather than one large
file — each is independently unit-testable against fixtures with no tool registered at
all. The four tool modules under `src/tools/` each own exactly one `registerTool` call
and its handler; internal `src/server.ts` is the only place that imports all four and
registers them, public `src/index.ts` exposes only the sealed lifecycle factory/types, and
`src/bin.ts` is the only place that ever reads `process.argv`/`process.env` or invokes
that lifecycle for a real `StdioServerTransport`.
The dependency direction is `@adrkit/mcp` → `@adrkit/core`; no reverse edge exists
(FR-038). `@adrkit/mcp` sits inside the Principle III isolation boundary exactly as
`@adrkit/cli`/`@adrkit/ci`/`@adrkit/evaluator` already do: a first-party surface package
with its own vetted public dependency, never an adapter and never core (research §R2).

## Constitution Check (post-design re-check)

*GATE: re-evaluated **after** the Phase 1 design (data-model, three contracts, research
decisions R0–R11). Still no violations; Complexity Tracking remains empty.*

| Principle | Post-design assessment |
|---|---|
| **I. Git is the source of truth** | PASS — the designed output contract (contracts/tools.md) has **no** write path anywhere: no tool's output schema includes a field that could carry a proposed mutation, no `--write` flag exists on the bin, and every one of the four tools' resolution semantics (§§4–7) only ever *reads* `CorpusProjection`. The side-effect-denial harness traps enumerated Node/Bun filesystem mutation, subprocess, worker, native-addon, and shell paths while an independent full disposable-sandbox/parent-sentinel/`HOME`/`TMPDIR` snapshot checks the exercised paths (US5 AC1; research §R10). |
| **II. Clean clone builds green** | PASS — Constitution v1.0.2 permits public-registry access only during the frozen Bun install. The new dependency is vetted, public, MIT, zero-advisory as of 2026-07-20, and exact-pinned; after install, every gate and runtime path is network-disabled. This package imports only SDK stdio/in-memory subpaths, while side-effect-denial execution plus import discipline provide bounded evidence that network/write/spawn paths do not execute (research §R10). Pre/post root, directory, and candidate validation discards every projection with an observed containment/type/identity change (data-model.md §3.3), without claiming an atomic hostile-filesystem snapshot. |
| **III. Core depends on no adapter** | PASS — the designed core change (contracts/core-projection.md) is the smallest one that satisfies the task: one new file, one new export line, and one existing `@adrkit/evaluator` file migrated to call the new export in place of its own private copy, preserving that rule's exact observable behavior and result shape — no behavior change anywhere and no new dependency added to `@adrkit/core` or `@adrkit/evaluator`. `@adrkit/mcp`'s own dependency set (`@adrkit/core`, `@modelcontextprotocol/sdk`, `zod`) contains no adapter and nothing under `packages/adapters/**`; the extended `check-deps.ts` allow-list mechanically asserts that direct-declaration boundary. Static declaration checks and the dynamic side-effect-denial harness remain distinct, bounded evidence. |
| **IV. Deterministic before probabilistic** | PASS — the designed search contract (contracts/tools.md §5) is a fixed, three-step, ICU-free, engine-builtin normalization pipeline (research §R5) with no ranking; the designed context contract (§6) reuses `@adrkit/core`'s existing pure `resolveAffects` unchanged, called per record specifically to avoid inventing any new resolution semantics (research §R4); every result set's order is the one fixed comparator (§2); no model, embedding, or heuristic weight exists anywhere in the design. |
| **V. The schema is the contract** | PASS — no schema change (`schema/adr.schema.json` untouched); `get_decision`'s `FullDecision.frontmatter` reuses `AdrFrontmatter` verbatim, nested inside a discriminated-union variant — a pattern explicitly re-verified empirically to work with the SDK's own output-schema validation despite the schema's `.refine()` cross-field checks (research §R1.1), not assumed. The reconciliation between SDK-enforced schema validation and FR-015's three structured-error cases is a specific, cited, empirically-verified mechanism (research §R1.2; contracts/tools.md §3), not a hand-wave. |

**Result**: PASS (pre- and post-design). The design introduces no new schema field, no
new severity, no new escalation reason, and no persistence or model path. SC-016
was satisfied by explicit maintainer scope ratification on 2026-07-20; the
release-version-timing question research §R10 surfaces is a scheduling decision
for actual release time, not a design gap.

## Complexity Tracking

*No constitution violations — this table is intentionally empty.* The two
precommitments carried forward from research are both closed: (1) the Phase 4
real-user gate is satisfied (recorded in `spec.md`'s header callout and restated
at the top of this plan); (2) **SC-016** was satisfied by explicit maintainer
ratification of the exact four-tool scope on 2026-07-20. They remain governance
evidence rather than Complexity Tracking justifications.
