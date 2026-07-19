# Research & Decisions: CI Surface (Phase 3)

Decisions resolving the Technical Context, each constrained by ADR-0009/ADR-0007/
ADR-0004 or the constitution. None reopens a settled ADR. **R0 is a gate
assessment, not a design decision — read it first.**

## R0 — ⚠️ Upstream gate: is rung 2 actually met? (BLOCKING for implementation)

**Question (per the phase brief and plan.md)**: The outcome ladder is strict — do
not open a phase before the one below it has landed **and has a real user**. Rung 2
is *"`adr migrate --from madr` round-trips a real third-party corpus."* ADR-0008's
exit criterion and Phase 2 **SC-007** both say migration must be *"exercised against
at least one real public MADR corpus, **not a fixture**."* **Has it been?**

**Finding: NO — not by the letter of the ladder.** Phase 2's code landed (PR #7,
`ed5b3d4`), and a "real corpus" test exists, but it exercises a **synthetic**
sample, not a real third-party corpus:

- `packages/core/test/migrate-real-corpus.test.ts` — the test name is literally
  *"migrates the **synthetic** real-world-shaped corpus with body preservation and
  clean lint."*
- Its fixture `packages/core/test/fixtures/madr-corpus/` is hand-authored. The first
  record's own `context` says: *"A small **synthetic**, real-world-shaped MADR
  sample is used here **to avoid vendoring third-party ADR prose** while still
  exercising block scalars."*
- Phase 2's own `research.md` **R8** anticipated exactly this: *"If licensing
  prevents vendoring, the test documents the external corpus + command instead and a
  synthetic-but-realistic corpus covers CI."* The synthetic path was taken. That
  keeps CI offline (good), **but it does not satisfy the rung-2 shipping condition**,
  which demands a real corpus **and** a real user.

**Second half of the gate — the "real user":** there is no evidence in-repo of
`adr migrate` having been run against an external adopter's corpus, nor of a
third-party user. The ledger flip to "landed" reflects *code merged*, not the
*outcome achieved*. So the gate is unmet on **both** counts: (a) no real public
corpus exercised end-to-end, and (b) no real third-party user.

**Also flag — stale ledger**: at the time this feature was opened, `plan.md`'s phase
table still showed Phase 2 as *"scoping"* despite PR #7 having merged the
implementation. This scoping change corrects it to *"landed (PR #7 merged)"*, but the
correction is bookkeeping and does **not** assert the rung-2 outcome is met.

**Consequence**:

- **Scoping (this spec cycle) proceeds** — that is this thread's mandate, and having
  the design ready de-risks the moment the gate clears.
- **Phase 3 _implementation_ is BLOCKED** until the gate is cleared per the resolved
  condition below. `tasks.md` records this as a hard precondition (**T000**), plus a
  scoped task to source and vendor the gating corpus (**T00A**).

**RESOLVED — what "cleared" means (maintainer decision; reviewer may override).**
A vendored **subset of a genuinely real, permissively-licensed public MADR corpus**
clears the rung-2 corpus gate and unblocks Phase 3 implementation. A live external
**human user** is **not** a Phase-3 precondition — that is a higher rung (3+), not
this gate. To count as cleared, the corpus subset MUST satisfy all of:

- **Real third-party prose** — not synthetic or authored-to-pass. The point is to
  exercise real-world MADR frontmatter/body variance the current synthetic fixture
  cannot reproduce.
- **Committed as an OFFLINE fixture** — vendored into the repo, never fetched at test
  time (ADR-0007 forbids network at CI time).
- **Licensing respected** — a permissive/public-domain license (e.g. CC0/CC-BY/MIT/
  Apache, or the MADR project's own example records). Vendor a **small** subset with
  **attribution + provenance** (source URL, license, commit/date) recorded in the
  fixture directory. **If no cleanly-licensed real corpus can be found, stop and
  flag it — do not vendor prose of unknown license.**
- **Exercised through `adr migrate --from madr`** with the same assertions as the
  synthetic test: idempotency + body-byte preservation + clean lint.

**Not this thread's job — and Phase 2 is NOT reopened.** Clearing the gate is a small,
well-scoped Phase-2 follow-up / Phase-3 precondition: source + vendor the corpus
subset and point the existing corpus test at it. It does **not** re-implement or
re-open Phase 2's migration logic; it only supplies the gating fixture.

## R1 — `adr check` is the deterministic substrate; the Action is a thin wrapper

**Decision**: Implement `adr check <changed-files> [--dir] [--json]` in `@adrkit/cli`
as the portable, provider-agnostic core: it loads the corpus, runs the **existing**
`resolveAffects` over the supplied changed-file list, validates the changed records
with the **existing** validators, and returns a stable result. `@adrkit/ci` (the
GitHub Action) extracts the changed-file list and renders/posts the comment, calling
into the same core logic — it adds **no** new resolution or validation.

**Rationale**: Principle IV — the CI surface introduces no probabilistic step and
no second source of truth for "what governs this." Seed 21 makes the CLI equivalent
first-class. Keeping the Action thin means it is testable without GitHub and portable
to other providers, and it keeps all governance logic in the already-pinned,
CI-asserted resolver (ADR-0009), not duplicated in an Action.

**Alternatives rejected**: putting resolution logic inside the Action (duplicates
ADR-0009 semantics, unversioned, untestable offline); a GitHub-only surface with no
CLI (fails seed 21 and locks adopters to one provider).

## R2 — `@adrkit/ci` is a surface package, not core and not an adapter

**Decision (RESOLVED — maintainer-confirmed; reviewer may override)**: Add
`packages/ci/` as a first-party **surface** package (`@adrkit/ci`), a peer of
`@adrkit/cli`, **not** under `packages/adapters/*` and **not** in core. It depends on
`@adrkit/core` (`workspace:*`) and public GitHub Action libraries; it MUST NOT import
from `packages/adapters/*`. The `core-has-no-adapter-deps` check is extended to assert
`@adrkit/ci` carries no adapter dependency **and** that the GitHub toolkit dependency
never reaches `@adrkit/core` or the schema (see R3).

**Rationale**: ADR-0007 forbids *core* and *cli* from importing adapters and bounds
what may enter the default build. Adapters (`packages/adapters/*`) are **external-source
integrations** (import/catalog) that are *allowed to break* on upstream churn. An
Action that consumes core to render governing decisions is a **consumer surface** —
the same category as the CLI — not an integration with a churning third-party
governance target, and it must not be allowed to break. `@adrkit/ci` is therefore
analogous to `@adrkit/cli`: a consumer surface permitted its own public dependencies,
but not core and not an adapter. Placing it under `packages/ci/` keeps it inside the
isolation boundary the constitution's Principle III draws.

**Alternatives rejected**: `packages/adapters/ci-github` (wrong — the Action is a
first-party surface, not an optional integration; and adapters are *allowed to
break*, which a shipped Action must not); building the Action into `@adrkit/cli`
(pulls the GitHub toolkit into the CLI's dependency tree for a non-CLI concern).

## R3 — GitHub API dependency is confined to the surface and stubbed in tests

**Decision**: `@adrkit/ci` may depend on the public GitHub Action toolkit
(`@actions/core`, `@actions/github`/Octokit). All GitHub API access is behind a small
internal port so tests inject a fake client; no test performs a real network call or
requires a token. `clean-clone-builds` therefore stays green with **no** credentials.

**Rationale**: ADR-0007 permits building against *publicly documented, publicly
fetchable* surfaces; the GitHub API with the default token qualifies. The binding
constraint is that *install/build/test/lint* pass on a clean clone with no secrets —
satisfied by stubbing the client. Runtime token use happens only when the Action
actually runs in CI (FR-008).

**Boundary assertion (RESOLVED — maintainer decision; reviewer may override)**:
`scripts/check-deps.ts` (the `core-has-no-adapter-deps` gate) is extended so it also
asserts the GitHub toolkit dependency (`@actions/*`, Octokit) **never reaches
`@adrkit/core` or the schema** — it stays confined to the `@adrkit/ci` surface. This
turns "the toolkit is confined" from a review-time promise into a CI-enforced gate,
the same posture ADR-0007 takes for adapter isolation.

**Alternatives rejected**: shelling out to `gh` (an undeclared system dependency,
breaks clean-clone determinism); raw `fetch` against the REST API (re-implements what
the toolkit already does, including auth and pagination).

## R4 — Changed-file extraction lives in the Action; resolution stays pure

**Decision**: The Action produces the changed-file list from the `pull_request` event
(head/base SHAs → compare API, or a `base…head` diff on the checkout) and passes it
to `resolveAffects`. The resolver is never given a repo to walk; it receives the file
list, exactly as in Phase 1. For `package` matchers, the Action derives the
changed-dependency snapshot from the lockfile diff using the **existing**
`deriveChangedDependenciesFromBunLockDiff` helper (already exported from
`@adrkit/core`'s affects module).

**Rationale**: ADR-0009 — resolution is a pure function of `(matchers, fileList,
catalogSnapshot)`; the `resolution-is-pure` assertion must keep passing. Impurity
(git, network) is quarantined in the Action, which is allowed to touch the
environment.

**Alternatives rejected**: letting the resolver diff the working tree (violates
ADR-0009 purity and the CI assertion); requiring the adopter to pass the file list
manually (the Action exists precisely to compute it).

## R5 — Comment identity and idempotency via a hidden marker

**Decision**: The rendered comment carries a stable hidden HTML marker (e.g.
`<!-- adrkit:ci -->`). On each run the Action lists the PR's comments, finds the one
bearing the marker, and **edits** it; absent, it **creates** one. No external state
is stored (ADR-0004 — nothing but git and the PR itself).

**Rationale**: FR-005/SC-004. The marker is the minimal, stateless mechanism for
"one comment, updated in place." Storing a comment id anywhere else would introduce a
side database, which ADR-0004 forbids for this surface.

**Alternatives rejected**: a fresh comment per push (spam — the exact anti-pattern
exit criterion b guards against); a commit status/check-run only (loses the
human-readable governing list); an external key/value store (violates ADR-0004).

## R6 — Selectivity is the resolver's union, rendered verbatim

**Decision**: The comment lists **exactly** the resolver's union output for the
changed files — each governing record with its fired matcher(s) — and nothing else.
There is no "related decisions" padding. If the list is large, it is because many
records genuinely fire; if it is *everything*, that is surfaced as a signal that a
matcher is over-broad, not smoothed over.

**Rationale**: Exit criterion (b) and ADR-0009's union semantics. The comment's job
is to reflect the mapping faithfully; making it *pretty* by adding or trimming
records would make it lie. The renderer MAY group by matcher type and MAY cap an
absurd list with a "+N more" tail for readability, but the underlying set is the
resolver's, unmodified.

**Alternatives rejected**: heuristic "top-N most relevant" ranking (that is a
probabilistic judgment — Principle IV — and hides conflicts ADR-0009 wants surfaced);
always listing the whole corpus "for context" (defeats the phase).

## R7 — Empty and error outcomes

**Decision**: When the resolver returns **no** governing records, the Action renders
a one-line "no governing decisions for the changed files" note (still a single
marker-bearing comment, so it updates cleanly next push) — never a corpus dump
(FR-007). When a **changed record** has an **error** finding, `adr check` exits
non-zero (the job fails, FR-002) and the comment surfaces the validation failure
alongside (or instead of) the governing list.

**Rationale**: FR-002/FR-007/SC-005. The two axes — "what governs this" and "are the
changed records valid" — are independent; the outcome must communicate both, and a
quiet empty state keeps the surface trustworthy on unrelated PRs.

## R8 — Degrade on read-only tokens; never fail the job on a comment permission

**Decision**: On a fork PR (or any context where the token lacks
`pull-requests: write`), the Action runs the deterministic `adr check` and, if it
cannot comment, downgrades to a job-log annotation/notice rather than throwing.
Validation failures (FR-002) still fail the job; a **commenting** permission error
does not.

**Rationale**: FR-014/SC-006 and ADR-0009's "degrade, never fail" posture applied to
the runtime. Fork PRs with read-only `GITHUB_TOKEN` are a normal GitHub reality;
failing the whole job because the bot could not comment would make the Action hostile
to the exact contributors it should serve.

**Alternatives rejected**: requiring a PAT to guarantee comment rights (violates
FR-008 "default token only"); silently succeeding with no signal at all (the reviewer
should still see the check result).

## R9 — No index, no write path, routes-not-decides

**Decision**: `adr check`/`@adrkit/ci` read the corpus + supplied file list and write
**only** the PR comment. No database/projection is touched (ADR-0004); no record is
mutated; nothing is approved or merged. The only failure signal is a changed record
failing validation.

**Rationale**: ADR-0004 ("the CLI and CI action never require the index") and the
evaluator boundary (Phase 4 routes/escalates; Phase 3 does even less — it informs).
Keeping the surface read-only + comment-only preserves "git is truth" and defers all
judgment to humans and the later evaluator.

## Resolved open questions (from PR #9 review)

The two questions raised when this feature was opened are now **resolved as maintainer
decisions the reviewer may still override**:

1. **`packages/ci/` vs `packages/adapters/*` placement** — CONFIRMED: `@adrkit/ci` is a
   first-party surface package (peer of `@adrkit/cli`), not an adapter and not core.
   See **R2**, and the extended `check-deps` boundary assertion in **R3**.
2. **What clears the rung-2 gate** — RESOLVED: a vendored subset of a genuinely real,
   permissively-licensed public MADR corpus (offline fixture, attribution + provenance,
   exercised via `adr migrate`) clears it and unblocks Phase 3 implementation; a live
   external human user is a higher rung, not a Phase-3 precondition. See **R0** and
   tasks **T000** / **T00A**.

## Deferred (not decided here)

Non-GitHub CI provider packaging; catalog/IaC/OpenAPI backing for the inert matcher
types; wiring the Phase 2 divergence report into a PR; any evaluator/rubric pass
(Phase 4); comment summarization or ranking.
