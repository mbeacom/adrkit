# Research & Decisions: CI Surface (Phase 3)

Decisions resolving the Technical Context, each constrained by ADR-0009/ADR-0007/
ADR-0004 or the constitution. None reopens a settled ADR. **R0 is a gate
assessment, not a design decision — read it first.**

## R0 — ⚠️ Upstream gate: is rung 2 actually met? (BLOCKING for implementation)

**Question (per the phase brief and plan.md)**: The outcome ladder is strict — a rung's
*implementation* must not start before the one below it has landed **and has a real
user**. Rung 2 is *"`adr migrate --from madr` round-trips a real third-party corpus."*
ADR-0008's exit criterion and Phase 2 **SC-007** both say migration must be *"exercised
against at least one real public MADR corpus, **not a fixture**."* **Has it been?**

**Resolved reading of the gate (maintainer decision; reviewer may override).** Rung 2
clears when **both** of these hold — and nothing more:

1. a **vendored subset of a genuinely real, permissively-licensed public MADR corpus**
   exists as an **offline** fixture, and
2. it is **exercised through `adr migrate --from madr`** with idempotency + body-byte
   preservation (+ clean lint).

That maintainer dogfood exercise **is** the required "real user" — the ladder says "even
if that user is only you" — so **no live external human adopter is required** to start
Phase 3 implementation. Both the real corpus **and** the exercise are required; a real
corpus that is never migrated, or a migration only ever run on synthetic prose, does not
clear it.

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
  keeps CI offline (good), **but it does not satisfy the rung-2 shipping condition** —
  the migration has never been exercised on **real** third-party MADR prose.

**What this means against the resolved gate:** criterion 1 (a real, permissively-licensed
public MADR corpus, vendored offline) is **not** met — today's fixture is synthetic — and
therefore criterion 2 (the `adr migrate` exercise **on real prose**) is not met either.
The "real user" half is **not** a separate missing third-party human: per the resolved
reading it is the maintainer dogfood exercise, which lands *with* criterion 2. So exactly
one thing is missing — the real corpus and its migration run. The ledger flip to "landed"
reflects *code merged*, not this *outcome achieved*.

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

**Detailed constraints — what the gating corpus MUST satisfy (maintainer decision;
reviewer may override).** Restating the resolved gate above as an actionable checklist;
the corpus subset MUST satisfy all of:

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

## R1 — `adr check` and the Action share one neutral core function; both are thin

**Decision (revised per PR #9 review, RC3)**: The shared "resolve + validate over a
changed-file set" logic lives in **`@adrkit/core`** as a neutral, pure function
(`checkChanges`), **not** in `@adrkit/ci`. `adr check` (in `@adrkit/cli`) and the Action
(`@adrkit/ci`) each build its input and call it; neither surface depends on the other.
The function takes the **full `lintCorpus` result** (`{ records, findings, checked }`) —
not just `records` — plus the optional resolution snapshots
(`changedDependencies`, `catalog`). It returns the `CheckOutcome` (data-model).

**Why the full lint result, not `(records, changedFiles)`**: `lintCorpus` **drops
malformed files from `records` but keeps their errors in `findings`**. A function given
only `records` would silently lose those errors and could pass a PR that introduced an
unparseable record. Passing the whole lint result preserves every finding. Likewise,
`package` matching needs the `changedDependencies` snapshot the Action derives from the
lockfile diff (R4/T007), so the input carries optional `snapshots` rather than assuming
`path`-only.

**Why in core, not in `@adrkit/ci`**: putting the neutral function in the Action package
would force `@adrkit/cli` to depend on `@adrkit/ci` **and its GitHub toolkit deps** just
to run `adr check` — violating R2 (the CLI must not pull the Action's `@actions/*` tree)
and Principle III. Core is the one place both surfaces already depend on.

**Rationale**: Principle IV — one deterministic implementation of "what governs this +
are the changed records valid," reused by both surfaces, with no probabilistic step and
no second source of truth. It stays pure (ADR-0009): given the lint result + file list +
snapshots, it computes the outcome with no clock, network, or fs traversal. Seed 21 makes
the CLI equivalent first-class.

**Alternatives rejected**: a `(records, changedFiles)` signature (loses dropped-file
errors and the package snapshot — the specific defect this revision fixes); putting the
shared function in `@adrkit/ci` (forces the CLI onto the Action's dependency tree,
violates R2); duplicating resolution/validation inside the Action (unversioned, untestable
offline, two sources of truth).

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

## R4 — Complete changed-file extraction (paginated PR files or merge-base diff); resolution stays pure

**Decision (revised per PR #9 review, RC4)**: The Action produces the **complete**
changed-file list via **either** a **fully paginated `pulls.listFiles`** listing (all
pages) **or** a local **merge-base (`base…head`) `git diff`** on the checkout, and
passes it to `checkChanges`/`resolveAffects`. It MUST **not** rely on the **compare
API's** file list, which GitHub **caps** (documented at 300 files) and silently
truncates. The provider's hard limit is handled **explicitly**: paginate to the end,
or when the listing would exceed the cap fall back to the local merge-base diff, and
surface a notice if a complete list cannot be obtained. For `package` matchers, the
Action derives the changed-dependency snapshot from the lockfile diff using the
**existing** `deriveChangedDependenciesFromBunLockDiff` helper.

**Rationale**: ADR-0009 — resolution is a pure function of `(matchers, fileList,
catalogSnapshot)`; the `resolution-is-pure` assertion must keep passing. A **truncated**
file list would silently drop governed files — a correctness bug in exactly the mapping
this phase exists to provide — so completeness is a requirement, not a nicety. Impurity
(git, network, pagination) is quarantined in the Action, which is allowed to touch the
environment.

**Alternatives rejected**: the compare API file list (capped/truncated — the specific
defect this revision fixes); letting the resolver diff the working tree (violates
ADR-0009 purity and the CI assertion); requiring the adopter to pass the file list
manually (the Action exists precisely to compute it).

## R5 — Comment identity: marker AND author, across all comment pages

**Decision (revised per PR #9 review, RC5)**: The comment carries a stable hidden HTML
marker (e.g. `<!-- adrkit:ci -->`). On each run the Action **paginates the PR's comments
to completion** and selects the one matching **both** the marker **and** the Action's own
author identity (the bot/app user that posts it); it **edits** that comment, else
**creates** one. Marker-only matching is insufficient: a human could quote the marker,
and the Action's own comment could sit on a later page. No external state is stored
(ADR-0004 — nothing but git and the PR itself).

**Rationale**: FR-005/SC-004. Matching on marker **and** author prevents two failure
modes — editing a foreign comment that contains the marker, and posting a duplicate
because the real comment was on an unfetched page. It remains stateless (no stored
comment id), so it does not introduce the side database ADR-0004 forbids.

**Test coverage (required)**: fake-client tests for (a) a **foreign/pre-existing comment
bearing the marker** (must be ignored, a new one created or the Action's own edited) and
(b) the Action's **own marker comment on a later page** (must be found and edited, not
duplicated).

**Alternatives rejected**: marker-only matching (edits foreign comments / misses paged
comments — the defect this revision fixes); a fresh comment per push (spam — the exact
anti-pattern exit criterion b guards against); a commit status/check-run only (loses the
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

## R10 — Ship a committed, self-contained Node bundle (RC6)

**Decision (per PR #9 review)**: `@adrkit/ci` is a **JavaScript Action** that runs
directly from the referenced repo; GitHub does **not** run `bun/npm install` in the
consumer checkout. Therefore the Action ships a **committed, self-contained Node
bundle** — `bun build` bundling `@adrkit/core` **and** the GitHub toolkit into a single
`dist/` entrypoint — and `action.yml`'s `runs.main` points at it. CI adds a **bundle
drift check** (rebuild and fail if the committed artifact differs, mirroring
`schema-emit-matches`) and a **Node smoke test** that the bundle runs on the target
runtime.

**Rationale**: FR-015. Without a committed bundle the Action would fail at consumer
runtime with unresolved imports (`@adrkit/core`, `@actions/*`). Committing the built
artifact is the standard JS-Action distribution model; the drift check keeps the
committed bundle honest the same way the schema emit-check does.

**Alternatives rejected**: a **composite/Docker Action** (Docker adds a container build
and violates the lightweight, clean-clone spirit; composite would still need an install
step in the consumer); publishing to npm and `npx`-ing at runtime (adds a network
install to every run, and a release step the repo does not yet have); assuming the
consumer installs deps (a JS Action does not — the defect this addresses).

## R11 — Action runtime is Node 24 (RC7)

**Decision (maintainer decision; reviewer may override)**: `action.yml` uses
`runs.using: node24`. The project requires Node `>=22` and smoke-tests **22/24**
(ADR-0010); Node 24 is the current supported GitHub Actions runner and is already in the
smoke matrix, so it is the consistent choice.

**Rationale**: FR-016. The earlier draft said `node20`, which is inconsistent with the
project's `>=22` floor and its smoke matrix — an Action targeting an unsupported/older
runtime than the code it bundles is a latent break. Picking Node 24 aligns the runtime
with what CI already verifies.

**Alternatives rejected**: `node20` (below the project's `>=22` floor and not in the
smoke matrix — the inconsistency this fixes); deliberately targeting a runtime **without**
adding it to the Node smoke matrix (would ship an unverified runtime).

## Resolved open questions (from PR #9 review)

Round 1 (feature-open questions) and round 2 (7 review comments) are now **resolved as
maintainer decisions the reviewer may still override**:

1. **`packages/ci/` vs `packages/adapters/*` placement** — CONFIRMED: `@adrkit/ci` is a
   first-party surface package (peer of `@adrkit/cli`), not an adapter and not core.
   See **R2**, and the extended `check-deps` boundary assertion in **R3**.
2. **What clears the rung-2 gate** — RESOLVED (governance, RC8): a vendored subset of a
   genuinely real, permissively-licensed public MADR corpus (offline fixture, attribution
   + provenance, exercised via `adr migrate`) clears it and unblocks Phase 3
   implementation; the maintainer dogfood exercise **is** the required "real user" — no
   external human adopter needed. See **R0**, plan.md policy, and tasks **T000**/**T00A**.
3. **Shared-function API & placement** (RC3) — the neutral `checkChanges` lives in
   `@adrkit/core`, takes the **full lint result** + snapshots, and is called by both
   `adr check` and the Action (neither imports the other). See **R1**.
4. **Changed-file source** (RC4) — complete paginated PR-files listing or local
   merge-base diff, provider cap handled explicitly; not the truncating compare API.
   See **R4**.
5. **Comment idempotency** (RC5) — match marker **and** author across all comment pages;
   tests for a foreign marker and a marker on a later page. See **R5**.
6. **Packaged distribution** (RC6) — committed self-contained Node bundle + drift/smoke
   checks. See **R10**.
7. **Action runtime** (RC7) — `node24`, consistent with the `>=22` floor and smoke
   matrix. See **R11**.

## Deferred (not decided here)

Non-GitHub CI provider packaging; catalog/IaC/OpenAPI backing for the inert matcher
types; wiring the Phase 2 divergence report into a PR; any evaluator/rubric pass
(Phase 4); comment summarization or ranking.
