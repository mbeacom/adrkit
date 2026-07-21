# plan.md

Implementation plan for the decision-governance layer. Derived from `docs/adr/`.
**The ADRs are normative; this file is not.** Where they disagree, the ADR wins
and this file is wrong and should be corrected.

Intended as the handoff artifact for a harness/orchestrator. Written in the
spec-driven shape (`spec` → `plan` → `tasks`) because ADR-0003 positions the
project as an extension of that workflow, and shipping a governance tool that
doesn't dogfood its own integration target would be self-refuting.

This plan is now backed by concrete spec-kit machinery. The binding constraints
below are ratified as enforceable project law in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) (Principles
I–V), and each phase is realized as a spec-kit feature under
`specs/NNN-<short-name>/` (`spec.md` → `plan.md` → `tasks.md`). The constitution
restates the ADR constraints as CI-testable gates and is subordinate to the
ADRs; the ADRs remain normative above both it and this file.

## Spec-kit realization

Each phase becomes one spec-kit feature. The mapping — and where the phase
currently stands — is tracked here so the ledger and the `specs/` tree stay in
sync.

| Phase | Feature dir | Status |
|---|---|---|
| 0 — Schema and core | `specs/001-schema-and-core/` | landed (PR #5 merged) |
| 1 — Affects resolution | `specs/002-affects-resolution/` | landed (PR #6 merged) |
| 2 — Migration | `specs/003-migration/` | landed (PR #7 merged) |
| 3 — CI surface | `specs/004-ci-surface/` | landed (PR #12 merged) |
| 4 — Deterministic evaluator | `specs/005-deterministic-evaluator/` | landed (PR #14 merged) |
| 5 — MCP server | `specs/006-mcp-server/` | landed (PR #19 merged); real-user gate met |
| 6 — ARB queue | `specs/007-arb-queue/` | implementation in progress (kernel + `adr queue` CLI + queue Action complete, all gates green); external-team rung 6 exit gate (SC-004) outstanding |

Advance **scoping** (spec → plan → tasks) of the next phase is explicitly permitted
and encouraged, so a design is review-ready when its turn comes; **implementation** of
a phase, however, MUST NOT begin until the phase below it has **landed and has a real
user**. This scoping-vs-implementation split is deliberate: writing `specs/NNN-*/`
early is cheap and reversible, whereas shipping code against an unmet lower rung is
not. Run each feature through the spec-kit loop; the Constitution Check in every
`plan.md` gates against Principles I–V. *(Maintainer decision; reviewer may override.)*

Phase 4's implementation gate is **cleared**. Phase 3 T018 was completed on
[`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood):
12 ADRs, a one-file
[PR](https://github.com/mbeacom/adrkit-t018-dogfood/pull/1), a selective comment naming
only ADRs 0001 and 0002, and a second default-token-only run updating the same
[comment](https://github.com/mbeacom/adrkit-t018-dogfood/pull/1#issuecomment-5017253372).

Phase 5's lower-phase real-user gate is also **cleared**. The maintainer ran
`adr evaluate` against the genuine, then-`proposed` ADR-0007 with the complete
tracked-file inventory and an active-human identity snapshot. The first run
found a real `assertions-compile.no-source` defect while still proving the
`one-way-door` trigger and routing to `@mbeacom`; after the two custom
assertions gained explicit symbolic expressions, the rerun exited 0 with all
eleven ordered rules, two honest warnings, the unregistered custom engine
reported inert, and deterministic routing to `@mbeacom`. The maintainer
explicitly ratified Phase 5's exact four-tool, local-only, read-only scope on
2026-07-20. Fresh cross-artifact analysis then passed without critical, high,
or medium findings, all 43 tasks were implemented, and the complete change is
recorded in PR #19.

The "real user" a rung requires is satisfied by **maintainer dogfooding** — the ladder
already says "even if that user is only you". For rung 2 specifically, the required
real user is the maintainer running `adr migrate --from madr` against a **real public
MADR corpus** (see the outcome ladder); a third-party human adopter is **not** a
precondition for opening Phase 3 *implementation*.

---

## Outcome ladder

Each rung is independently valuable and independently shippable. Do not start a
rung's **implementation** before the one below it has a real user — **even if that
user is only you** (maintainer dogfooding counts; advance scoping is exempt, per the
Spec-kit realization note above). For rung 2, that dogfood is the maintainer running
`adr migrate --from madr` against a real public MADR corpus — which *is* the required
"real user"; no external human adopter is required to proceed to rung 3.

| # | Outcome | Shipped when |
|---|---|---|
| 1 | This project's own decisions are governed by this project | `adr lint` runs green in CI on this repo |
| 2 | Someone else's existing corpus can move in | `adr migrate --from madr` round-trips a real third-party corpus |
| 3 | A PR tells you which decisions govern it | CI comment fires with correct records on a repo that isn't this one |
| 4 | An agent can read the corpus | MCP server answers retrieval queries in a real session |
| 5 | A proposal gets routed without a meeting | Deterministic evaluator pass closes or escalates without human triage |
| 6 | An org runs its ARB on it | Queue, tiers, SLAs in use by a team that isn't yours |

**Rung status.** Rung 2 is **met**: `adr migrate --from madr` round-trips a vendored
subset of the real [adr/madr](https://github.com/adr/madr) corpus offline (Phase 3
T00A). Rung 3 is also **met**: the `@adrkit/ci` Action ran twice on the separate
12-record `adrkit-t018-dogfood` repository, selected exactly two governing ADRs, and
updated one comment in place using only the default token (Phase 3 T018). Rung 5 is
**met** by the landed Pass 0 evaluator and the ADR-0007 maintainer dogfood above.
Rung 4 is also **met**: after PR #19 merged, the official MCP Inspector CLI
launched the built Node artifact over stdio against this repository's real
11-record corpus and exercised all four tools. Search returned ADRs 0010 and
0011 for `Bun`; `get_decision` returned complete ADR-0007; context for
`packages/mcp/package.json` and `.github/workflows/ci.yml` returned accepted
ADR-0010 plus proposed ADR-0007; `list_superseded` honestly returned no entries.
All calls reported zero excluded records and the same corpus fingerprint.
The four coordinated public packages then shipped as v0.2.0; `@adrkit/mcp` was
created through the documented one-time token bootstrap while the existing
packages continued to publish through OIDC. MCP Trusted Publisher setup and
temporary-secret removal remain a post-release maintainer action.

## Binding constraints

Pulled from the ADRs. These are not negotiable at implementation time; changing
one means changing a record first.

- **Git is truth.** Every machine write produces a PR, never a direct mutation.
  No decision content is written to a database. (ADR-0001, ADR-0004)
- **Clean clone builds green.** No credentials, no services, no network. This is
  a CI assertion, not a guideline. (ADR-0007)
- **Core depends on no adapter.** `@adrkit/core`, `@adrkit/cli`, and the schema import
  nothing from `packages/adapters/*`. (ADR-0007)
- **Resolution is pure.** `(matchers, fileList, catalogSnapshot)` in, matches
  out. No clock, no network, no filesystem traversal. (ADR-0009)
- **Missing backing sources are inert, never fatal.** (ADR-0009)
- **Deterministic before probabilistic.** No model call happens before the
  deterministic pass has run and passed. (ADR-0005)
- **The evaluator routes; it never approves.** (ADR-0005)
- **Parsers are deterministic.** Models may suggest field values for human
  confirmation; they never perform the parse. (ADR-0008)

## Non-goals for v0.1

Named explicitly so the orchestrator doesn't helpfully build them:

- No web UI. No database. No hosted anything.
- No round-trip sync with any source. (ADR-0008)
- No cloud-catalog adapter. (ADR-0009, as amended)
- No LLM rubric passes. Phase 4 is deterministic only.
- No ARB queue, tiers, or SLA machinery.

---

## Phases

### Phase 0 — Schema and core (rungs 1)

Deliverables: `schema/` published, `@adrkit/core` parsing and validating, `@adrkit/cli`
with `new`, `lint`, `graph`, and the CI workflow (`.github/workflows/ci.yml`)
carrying the three gate assertions.

Exit criteria:

- Every record in `docs/adr/` validates against the published schema.
- The ten seed records' (`0001`–`0010`) cross-field invariants are enforced by
  code, not by the ad-hoc validation script used during drafting.
- `bun run schema:emit` regenerates `adr.schema.json` from the Zod source and CI
  fails if the committed file differs. *(This is ADR-0002's `schema-emit-matches`
  assertion. It was violated during drafting — the two files disagreed on
  property casing — which is the argument for making it a build gate rather than
  a promise.)*
- CI green on all three gate assertions from the constitution and ADR-0007/0002:
  `clean-clone-builds`, `schema-emit-matches`, `core-has-no-adapter-deps`.
- Constitution Check (Principles I–V) recorded green in
  `specs/001-schema-and-core/plan.md`.

### Phase 1 — Affects resolution (rung 3, prerequisite)

Deliverables: the resolver in `packages/core/src/affects/`, plus
`adr explain <path>`.

Exit criteria:

- Resolver is pure; purity asserted in CI.
- Conformance fixture suite published as test data: matcher set + file list +
  expected match. **This is the artifact that lets a second implementation
  exist. Do not defer it.**
- `path` and `package` matchers fully implemented; `entity`, `resource`, `api`,
  `data` parse, validate, and resolve to inert with an `info` finding.
- `adr explain` prints every governing record *and the matcher that fired*.

### Phase 2 — Migration (rung 2)

Deliverables: `adr migrate --from madr`.

Exit criteria:

- Idempotent and in place. Body bytes unchanged; only frontmatter added.
- Output remains a valid MADR file — verified against a third-party MADR renderer.
- Source status preserved, never defaulted. Unrecognized status becomes
  `proposed` with a lint finding.
- `provenance.importedFrom` populated with a stable fingerprint.
- Exercised against at least one real public MADR corpus, not a fixture.

### Phase 3 — CI surface (rung 3)

Deliverables: `@adrkit/ci` as a GitHub Action.

Exit criteria:

- Validates changed records; comments governing decisions on PRs that touch
  governed paths.
- The comment is genuinely useful on a repo with more than ten records — if it
  lists everything, the `affects` matchers or the comment are wrong.
- Runs with no credentials beyond the default token.

### Phase 4 — Deterministic evaluator (rung 5, landed)

Deliverables: Pass 0 from `docs/EVALUATOR_RUBRIC.md`. **No model calls.**

Exit criteria:

- All eleven Pass 0 rules implemented at their specified severities.
- Escalation reason codes logged from the first run — this is the calibration
  set, and it cannot be backfilled.
- Pass 0 is independently useful: it must be worth running with no model
  configured at all. If it isn't, the rubric passes are being asked to carry
  weight they shouldn't.

### Phase 5 — MCP server (rung 4, landed and dogfooded)

Deliverables: `@adrkit/mcp`, read tools only.

Scope: exactly `search_decisions`, `get_decision`,
`get_decision_context(files[])`, and `list_superseded` over one local corpus via
stdio. No writes, fifth tool, prompts, resources, HTTP transport, authentication,
model, network access, persistent cache, database, or named-log federation.
Detailed design lives in `specs/006-mcp-server/`. The maintainer explicitly
ratified this exact scope on 2026-07-20. Fresh analysis passed after artifact
remediation, all 43 tasks completed, PR #19 merged, and the official MCP
Inspector dogfood recorded above met rung 4.

Exit criteria:

- `search_decisions`, `get_decision`, `get_decision_context(files[])`,
  `list_superseded`.
- Retrieval returns `rejected` and `superseded` records — the graveyard is where
  the "we tried that" knowledge lives, and omitting it defeats the purpose.
- Write tools deliberately absent in this phase. When they land, they open PRs.

### Phase 6+ — Deferred

Import adapters for agent logs (blocked: needs a real sample to specify a
deterministic split), Spec Kit extension, LLM rubric passes, ARB queue, index
and web UI, catalog adapters.

---

## Task seeds

Small enough to delegate, ordered by dependency. Once a phase is opened as a
spec-kit feature, its seeds are elaborated into the authoritative, dependency-
ordered checklist in `specs/NNN-<short-name>/tasks.md`; the seeds here stay as
the coarse map.

**Phase 0**

1. Bun workspace scaffold — `bunfig.toml` with `linker = "isolated"` first;
   Apache-2.0 LICENSE, NOTICE, DCO bot, CC0 `schema/LICENSE`
2. Port `schema/adr.schema.ts` into `packages/core`; wire `bun run schema:emit`
3. Emit-drift CI check (`schema-emit-matches`)
4. Frontmatter parser + `Adr` loader; corpus walker
5. Cross-field invariants as code + unit tests per invariant
6. `adr lint`, `adr new`, `adr graph`
7. Clean-clone CI job; dependency-graph check for `core-has-no-adapter-deps`

**Phase 1**
8. `path` matcher (picomatch, POSIX, case-sensitive, negation-after-include)
9. `package` matcher against lockfile
10. Inert-resolution path for unbacked matcher types
11. Purity assertion in CI
12. Conformance fixture suite + published test data
13. `adr explain <path>`

**Phase 2**
14. MADR frontmatter detection and status mapping
15. Fingerprinting + `provenance.importedFrom`
16. `adr migrate --from madr`, idempotent, in place
17. Four-bucket re-import classifier (new / updated / diverged / unchanged)
18. Divergence report emitted as a PR; never an overwrite

**Phase 3**
19. Action packaging; changed-file extraction
20. PR comment renderer
21. `adr check <changed-files>` as the CLI equivalent

**Phase 4**
22. Pass 0 rules (schema, ids, supersession, orphan refs, affects overlap, scope
    hierarchy, assertion compile/pass, decider resolution, expiry)
23. Reason-code logging and finding serialization into `evaluation`

**Phase 5**
24. MCP server scaffold; read tools; retrieval over the corpus including the
    graveyard

## Open questions

Genuinely undecided — do not let an implementer resolve these silently.

- Split granularity for append-only agent decision logs. Blocked on a real sample.
- Whether federated multi-repo aggregation uses ULIDs or log-prefixed ordinals in
  practice. ADR-0002 permits both; nothing has forced the choice.
- Whether `adr new` should infer `affects` from the branch diff by default or
  only on request. Inference is convenient and quietly wrong sometimes.
