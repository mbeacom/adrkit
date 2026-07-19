# Research: Deterministic Evaluator (Pass 0) — Phase 4

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-19

This document is **decision-oriented**. R0 is the blocking outcome gate; R1–R12 are the
concrete architecture decisions the plan commits to, each with rejected alternatives.
Clarifications C1–C11 in `spec.md` are binding and are cited where they force a decision.

---

## R0 — Upstream outcome gate (BLOCKING; read first)

**Decision**: **No feature-005 implementation task may start until
`specs/004-ci-surface/tasks.md` T018 is checked off with evidence.** Scoping (this plan,
research, data-model, contract, tasks) proceeds now; building does not. `tasks.md` therefore
opens with hard gate task T001 that every implementation task depends on, and CI/PR
review must refuse feature-005 source changes until the gate clears.

**What T018 requires (the rung-3 outcome, not a merged PR)**: the CI Action exercised on a
**second repository — not this one** — with a corpus of **> 10 ADR records**, producing a
**selective** PR comment that names **exactly** the governing subset (not "all ADRs"), a
**second push that updates the same comment in place** (idempotent, no duplicate), and a run
authenticated with **only the default `GITHUB_TOKEN`** (no PAT, no extra secret). Feature
004 merged its code in **PR #12**, but T018 is still unchecked, so rung 3's *outcome* is
unproven.

**Rationale**: the project runs on an **outcome ladder** — a rung is satisfied by a
demonstrated outcome, not by merged code (spec.md; SC-013). Pass 0 is the deterministic
foundation the later probabilistic passes build on; letting its implementation begin before
the CI surface it will eventually feed is proven in the wild would repeat the "merged ≠
done" failure the ladder exists to prevent.

**Alternatives rejected**:
- *Begin evaluator implementation in parallel with T018* — rejected: violates the outcome
  ladder and SC-013's explicit hard block; a second-repo regression in the CI surface could
  invalidate assumptions Pass 0's CLI composition depends on.
- *Treat PR #12 merge as satisfying rung 3* — rejected: a merged PR is not a satisfied rung;
  the checklist and spec are explicit that T018 evidence is the gate.
- *Re-run T018 inside this feature's plan* — rejected: T018 is feature 004's task and its
  own second-repo exercise; 005 only **consumes** its cleared state.

**Phase-terminology guard (C8)**: "Phase 4" here is the **project** phase whose outcome is
**rung 5 (partial)** of the outcome ladder — *not* rung 4. Rung 4 (the MCP server) is
project Phase 5. Internal task/phase headings inside this feature are a different axis from
project phases; do not conflate them.

---

## R1 — Assertion-engine technology gap: Rego & JSONPath (GATED pre-implementation decision)

**Decision**: treat the **deterministic in-process engines for Rego and JSONPath as an
unresolved technology gap** that is a **genuine maintainer decision made before
implementation, not during scoping**. The rule logic depends only on the
`AssertionEnginePort` interface (R7); the concrete engine is chosen at the gate. The gate
must pick, **per engine**, exactly one of:

- **(a) a vetted, embeddable, in-process, deterministic parser/evaluator** that runs fully
  offline with no network, no credentials, and no shell-out; **or**
- **(b) a caller-supplied *compiled-policy / compiled-query snapshot* contract** in which the
  caller provides an already-compiled, deterministically-evaluable artifact, and
  `assertions-compile` honestly reports on **that** artifact (a malformed/absent compiled
  snapshot ⇒ compile-error when present-but-invalid, inert when absent, per R6) using the
  fixed media-type/base64/hash/source-ref DTO in `data-model.md` §2.1, rather than pretending
  to compile source the
  evaluator cannot.

Rego and JSONPath are the **two required completion-conformance engines** (FR-015; C5); until
the gate resolves them they remain **port-only and inert** in fixtures. `grep` and `custom`
engines are evaluated **only when a deterministic port is registered**, otherwise inert.

**Rationale / the specific trap to avoid**: `@open-policy-agent/opa-wasm` **evaluates
pre-compiled Wasm policy bundles — it does not compile raw `.rego` source in-process.**
Claiming it "runs Rego assertions" would make `assertions-compile` dishonest: the evaluator
would either silently accept un-compilable policy or depend on an out-of-band compile step it
does not model. Shelling out to the `opa` binary is worse — an **undeclared system
dependency** that breaks clean-clone (Principle II) and injects non-determinism. JSONPath has
many libraries with **divergent, sometimes non-deterministic semantics** (ordering,
descendant handling); a specific vetted deterministic parser/evaluator must be named at the
gate, not assumed. Keeping the contract **port-based** means the technology choice is
replaceable and the rule code never changes when (a) vs (b) is decided.

**No dependency is added during scoping.** The gate task in `tasks.md` records the decision
and, only then, adds a **single vetted deterministic dependency per engine** (or the
compiled-snapshot contract) to `packages/evaluator/package.json` and the `check-deps`
allow-list.

**Alternatives rejected**:
- *Assume `@open-policy-agent/opa-wasm` compiles raw Rego* — rejected: factually wrong; it
  evaluates precompiled Wasm. Would make `assertions-compile` lie.
- *Shell out to the `opa` CLI* — rejected: undeclared system dependency; breaks clean-clone
  (Principle II) and determinism (Principle IV).
- *Pick a JSONPath library now, mid-scoping* — rejected: engine choice is a maintainer gate
  with conformance + determinism criteria; premature selection risks a non-deterministic or
  unmaintained dependency. Deferred behind the port.
- *Ship Pass 0 without Rego/JSONPath* — rejected: FR-015/C5 make them required conformance
  engines for completion; they are port-only and inert until the gate, not dropped.

---

## R2 — Package placement: first-party `@adrkit/evaluator`, not core, not an adapter

**Decision**: the pure Pass 0 library is a **new first-party surface package
`@adrkit/evaluator`** under `packages/evaluator/`, a peer of `@adrkit/cli` / `@adrkit/ci`. It
depends on `@adrkit/core` (`workspace:*`) plus the vetted deterministic engine libs (R1)
only. `check-deps` is extended with an allow-list entry, and the dependency-graph gate
asserts the evaluator imports **no** adapter / model / toolkit dependency.

**Rationale**: ADR-0005 already names `packages/evaluator/**` as the evaluator's home and
mandates a deterministic Pass 0 that is "complete and independently useful before any prompt
is written." Putting it in **core** would expand the schema/parser/resolver package with
assertion-engine and routing concerns and couple its dependency surface to evaluator-specific
technology choices; putting it in an **adapter**
(`packages/adapters/*`) would make a *deterministic, model-free* capability an optional
integration, contradicting Principle IV and ADR-0007's isolation intent. A surface peer of
the CLI is the correct tier: its own vetted public deps, never core, never an adapter (A7).

**Alternatives rejected**:
- *Add Pass 0 to `@adrkit/core`* — rejected: it would broaden core beyond
  parser/schema/resolution and couple every core consumer to evaluator-specific engine and
  routing concerns; the separate package keeps Principle III's boundary auditable.
- *Ship Pass 0 as an adapter under `packages/adapters/*`* — rejected: the deterministic pass
  must always be available (Principle IV; ADR-0005 degradation), so it cannot be an optional,
  isolated adapter.
- *Embed Pass 0 directly in `@adrkit/cli`* — rejected: couples the pure library to the impure
  CLI, blocks reuse by the future CI surface / MCP server, and makes purity harder to gate.

---

## R3 — `supersession-consistent`: new deterministic reciprocity + cycle checks

**Decision**: implement **new deterministic reciprocity and cycle checks** in the evaluator,
**reusing `buildAdrGraph` for edge construction only**. Reciprocity: if A `supersedes` B then
B must declare `supersededBy: A` (and the converse), computed as a set relation over the
corpus snapshot. Cycle: detect any directed cycle in the `supersedes` relation
(deterministic DFS / topological check over the built edges). Both emit `error`-severity
findings aggregated into the single `supersession-consistent` `RuleResult`.

**Rationale**: **`buildAdrGraph` today builds edges and does not detect cycles or
reciprocity** — the plan must not claim otherwise. The existing `validateCorpusInvariants`
provides `dangling-supersedes` / `dangling-supersededBy` (referential existence) but **not**
reciprocity or acyclicity. So these are genuinely missing checks. They are pure functions of
the corpus snapshot (no clock/network/fs), and reusing the existing edge builder + existing
dangling-ref findings avoids duplicating traversal logic while keeping the new checks
deterministic and total-ordered.

**Alternatives rejected**:
- *Claim `buildAdrGraph` already covers cycles/reciprocity* — rejected: it does not; it only
  assembles edges.
- *Fold reciprocity into `no-orphan-refs`* — rejected: orphan-refs is about **referential
  existence** (dangling pointers); reciprocity/acyclicity are **relational integrity** and
  belong to `supersession-consistent` per the rubric's rule split (FR-002).

---

## R4 — Target resolution & overlap: `TargetResolutionRegistry`, not diff-oriented `resolveAffects`

**Decision**: introduce a deterministic **`TargetResolutionRegistry`** with per-type
**resolver ports** and a **normalized canonical target-id** space. `affects-resolvable`
resolves each `affects` matcher on the proposal to a finite set of canonical target ids;
`affects-overlap` computes the **finite set intersection** of the proposal's canonical target
ids with those of each **accepted** ADR, **once per (proposal, accepted-ADR) pair**.

- **Built-in types** `path` and `package` reuse the **existing core matcher grammar and
  parsing semantics** over a **complete tracked-path inventory** and a **complete
  lock/dependency inventory** supplied as immutable snapshots. The implementation may need
  to expose the current internal path primitive and reuse `parsePackagePattern`; the existing
  diff-oriented package matcher takes changed-dependency transitions and is not itself a
  full-inventory resolver.
- **ADR-0009 set semantics remain binding**: an ADR contributes targets only when at least
  one non-negated matcher resolves; matching negated matchers subtract/suppress after positive
  matching; a negation-only matcher set resolves to the empty set rather than "everything
  except"; and a `repo` qualifier participates only in the matching normalized log context.
  The caller supplies that current target-resolution log separately from each ADR record's
  source `log`; the evaluator passes it explicitly to every resolver port. Unqualified
  matchers apply in that context, same-`repo` qualifiers resolve normally, and a
  different-`repo` qualifier contributes no local match.
- **`entity` / `resource` / `api` / `data`** resolve via **caller-supplied immutable
  snapshots + registered deterministic resolver ports**.
- **Missing snapshot/port ⇒ operational inert** (never a violation): a missing inventory uses
  `affects-resolvable.backing-absent`, while a missing registered port uses
  `affects-resolvable.resolver-absent`. **Backing present + zero resolved target ids ⇒
  `affects-resolvable` warn.** For `affects-overlap`, primary
  reason precedence is explicit: any intersection wins as
  `affects-overlap.accepted-intersection`; otherwise, zero accepted ADRs passes as
  `affects-overlap.no-accepted-corpus` without requiring pair resolution; with accepted ADRs,
  absent required backing is inert; and only a fully evaluated accepted corpus with no
  intersection passes as `affects-overlap.none`.

**Rationale**: **the existing `resolveAffects` is diff-oriented** — it answers "does this
matcher match this changed-file list?" It **cannot prove all-target resolvability** (that
every declared target maps to a known, existing target) **or overlap** (target-set
intersection across ADRs) for `resource/api/data`, which have no changed-file surface.
Resolvability/overlap need a **canonical target-id set model** with injected backing, exactly
the ADR-0009 "pure resolution, degradation-not-failure" posture: reuse the existing matcher
primitives where they are correct (`path`, `package`), and inject deterministic ports where
they are not. Canonical target ids make intersection a deterministic finite-set operation
with a stable order, and "once per pair" keeps it total-ordered and O(pairs).

**Alternatives rejected**:
- *Reuse `resolveAffects` for resolvability/overlap* — rejected: it proves diff-match, not
  target-set resolvability or intersection; wrong tool for `resource/api/data`.
- *Infer targets heuristically when a snapshot is missing* — rejected: violates Principle IV
  / ADR-0009; missing backing must be **inert**, never a fabricated resolvable/overlap
  result.
- *Treat zero resolved targets as a pass* — rejected: C3 makes "backing present but nothing
  resolved" a **warn** (`affects-resolvable`), a real signal the matcher resolves to nothing.

---

## R5 — `scope-hierarchy`: deterministic, attributable contradiction evidence (no prose inference)

**Decision**: `scope-hierarchy` **never infers contradiction from prose.** It fires only on
**deterministic evidence attributable to the proposal**. The primary evidence contract is
**explicit base/proposed assertion snapshots**: for a **component** proposal that **overlaps**
(R4) an **accepted `org` ADR** in the **applicable domain**, if that accepted org ADR carries
an assertion that was **green on the supplied base snapshot** and **fails on the supplied
proposed / current-HEAD snapshot**, that transition is the contradiction ⇒ **`scope-hierarchy`
error**. **Domain applicability** is explicit: an org ADR with **no domain is global**
(applies to any domain); otherwise it applies **only on exact domain equality**. Missing
base/proposed evidence or a missing engine ⇒ **inert**. A non-component proposal, or one with
no org overlap, ⇒ pass (rule not applicable). Precomputed or signed contradiction verdicts
are **not accepted** in Pass 0: the evaluator itself must compile and evaluate the accepted
assertion over the supplied base and proposed inputs.

**Rationale**: "a component decision must not contradict an accepted org decision" is only
sound if "contradict" is **machine-checkable and caused by the proposal**. Prose comparison is
non-deterministic and unattributable (Principle IV). A green→red transition of an accepted
org assertion **across the caller's base vs proposed snapshots** is deterministic, reuses the
assertion engine (R7), and is attributable to the proposed change. Explicit domain
applicability prevents cross-domain false positives while honoring the "org-with-no-domain is
global" intent.

**Alternatives rejected**:
- *Infer contradiction from title/body text* — rejected: non-deterministic, unattributable;
  forbidden by Principle IV.
- *Fire on overlap alone* — rejected: overlap is a `affects-overlap` **warn**, not proof of
  contradiction; scope-hierarchy needs the assertion green→red evidence.
- *Evaluate the accepted assertion only against current HEAD* — rejected: without the base
  snapshot you cannot show the proposal **caused** the failure (it may have been red already);
  the base→proposed transition is what makes it attributable.
- *Trust a caller-supplied signed contradiction verdict* — rejected: it creates an undeclared
  authority/verification contract and bypasses the deterministic engine result this rule is
  intended to report.

---

## R6 — Assertion source & compile semantics: exactly one source declaration, engine never reads files

**Decision**: the **evaluator never reads `expressionFile`**. The caller snapshot resolves
`expressionFile` to **content + a stable source ref/hash**; the evaluator consumes only that
resolved content. **Exactly one expression source must be declared per assertion**:

- ADR declares **neither** inline `expression` **nor** `expressionFile` ⇒
  **`assertions-compile` error** (`no-source`).
- ADR declares **both** inline `expression` **and** `expressionFile` ⇒ **`assertions-compile`
  error** (`ambiguous-source`) — *unless the schema is later amended to forbid it, which this
  feature does NOT do* (R8; no schema edit now).
- ADR declares `expressionFile`, but its resolved content is absent, or its engine port is
  missing ⇒ **`assertions-compile` inert** (not a violation).
- Missing declared evaluation input affects **`assertions-pass` only** ⇒ inert (not a
  violation); compilation does not depend on evaluation input.
- **Compile failure** of the effective source ⇒ **`assertions-compile` error**.
- **Compiled evaluation returning false or a deterministic evaluation error** ⇒
  **`assertions-pass` warn** (a separate rule; R7).

**Rationale**: reading `expressionFile` would make the library impure (filesystem) and
non-reproducible (file could change under it) — forbidden by Principle IV / FR-006. Pushing
resolution to the caller snapshot (content + ref/hash) keeps the library pure and makes the
compiled artifact reproducible and attributable. "Exactly one source declaration" is required for an
**honest** `assertions-compile`, but the **current `Assertion` schema does not enforce it**
(both/neither are schema-valid) — so the evaluator enforces it at compile time (R8) rather
than editing the schema (Principle V; C6).

**Alternatives rejected**:
- *Let the evaluator read `expressionFile` from disk* — rejected: impure, non-reproducible;
  violates FR-006/Principle IV.
- *Silently prefer inline `expression` when both are present* — rejected: hides ambiguity;
  the compile result must be honest (`ambiguous-source` error).
- *Amend the schema now to enforce one source* — rejected: no schema change in this feature
  (C6/Principle V); enforce in-evaluator and record the schema limitation as a gated decision
  (R8).

---

## R7 — Assertion engines through a deterministic `AssertionEngineRegistry` of ports

**Decision**: all assertion evaluation flows through a deterministic
**`AssertionEngineRegistry`** with one typed optional property per engine (`rego`,
`jsonpath`, `grep`, `custom`). Each property pairs an **`AssertionEnginePort<E, Payload>`**
with its engine-owned opaque immutable compiled-payload type. `compile` (or artifact
validation) returns `CompiledAssertion<E, Payload>` and the evaluator passes that exact value
directly to the **same port's** `evaluate`; it never inspects the payload, recompiles, or uses
a hidden registry cache keyed by a ref. The registry and `Pass0Input` are generic over the
four payload types so a switch on `assertion.engine` keeps compile/evaluate paired without
`any` or `unknown` casts. Operations consume caller-supplied content + input snapshots.
**No engine may shell out, open a socket, read the filesystem, run an arbitrary command, or
call a model.** **Rego and JSONPath are required conformance engines** (behind R1's gate);
`grep` / `custom` evaluate **only when a deterministic port is registered**, otherwise the
assertion is **inert**.

**Rationale**: ports invert the dependency so the deterministic-engine technology choice (R1)
is replaceable and testable with in-memory fakes; the typed payload handoff makes the compile
result executable without hidden mutable state or a second compile; and the registry gives a
single, auditable enforcement point for "deterministic, offline, no-shell" (Principle II/IV;
FR-015/C5). A missing engine being **inert** (not fail) preserves ADR-0009 degradation.

**Alternatives rejected**:
- *Hard-code one engine implementation in the rule module* — rejected: couples rule logic to
  a specific (unresolved, R1) library and blocks in-memory test doubles.
- *Return only an engine/ref token and look up compiled state later* — rejected: requires
  hidden mutable registry state or recompilation, breaks purity/reproducibility, and loses
  compile/evaluate type pairing.
- *Allow a `custom` engine to run a shell command* — rejected: non-deterministic, unsafe,
  breaks clean-clone; forbidden by Principle II/IV and FR-006.

---

## R8 — Schema/contract limitations surfaced as gated decisions (no schema edit)

**Decision**: two limitations are recorded as **gated implementation decisions**, resolved
**without editing the schema** (Principle V; C6):

1. **`DeterministicFinding` cannot carry evidence/ref fields.** The committed shape is
   `{ rule, severity, message?, adr? }`. Richer evidence (canonical target ids, source
   ref/hash, base/proposed snapshot ids, reason codes) therefore rides the **separate runtime
   `Pass0Report`**, and the `evaluationPatch` projection (R12) emits only the four committed
   fields. No field is silently added.
2. **The `Assertion` schema does not enforce exactly one expression source.** Both/neither
   are schema-valid today, so "exactly one source declaration" (R6) is enforced by the
   **evaluator at compile time**, not by the schema. The gate records the option to amend the
   schema **later**; this feature does not.

**Rationale**: Principle V says the schema is the contract and changes to it are decisions,
not edits — so a limitation is **surfaced**, never worked around with a silent extension. Two
channels (report vs patch) let Pass 0 be richly useful at runtime while keeping the persisted
projection strictly schema-compatible.

**Alternatives rejected**:
- *Extend `DeterministicFinding` with evidence fields now* — rejected: a schema change
  (Principle V/C6); evidence goes on the report instead.
- *Amend `Assertion` to require one source now* — rejected: same; enforce in-evaluator, gate
  the schema decision for later.

---

## R9 — Identity / decider resolution: immutable directory snapshot, ambiguity warns

**Decision**: decider and named-human resolution consume an **immutable identity-directory
snapshot** of **normalized principals + team memberships**, plus normalized **CODEOWNERS**
candidates and **catalog owners**. `decider-resolvable`: **every declared decider** must
resolve unambiguously to one active principal; none declared, zero match, or ambiguous
resolution ⇒ **warn** (never an arbitrary pick). Named-human **escalation-target** resolution
(C7) is in scope and deterministic, in **ADR-0005 order**: (1) proposal `deciders`, (2)
normalized CODEOWNERS candidates for the proposal's **resolved paths** (R4), (3) catalog
owners for the proposal's **resolved entities**. **Exact ordering**:

1. proposal deciders in declaration order;
2. unique resolved paths sorted by canonical path key; for each path, select the **last**
   matching CODEOWNERS rule in declaration order and append that rule's owners in declaration
   order;
3. unique resolved entity ids sorted by canonical target key; for each entity, append its
   catalog owners in snapshot declaration order.

Each source stable-deduplicates principals at first occurrence; identities are not globally
sorted. A missing/inactive direct human is skipped. A team resolves through snapshot
membership only when it has **exactly one named active human**. The first ordered team with
zero or multiple active human members is an **ambiguity barrier**: routing immediately returns
`unresolved` and does not fall through to any later candidate or source. Exhausting all
candidates also returns `unresolved`.

**Rationale**: routing to a *human* must be reproducible and defensible; picking arbitrarily
from an ambiguous set is non-deterministic and unfair, while silently skipping an ambiguous
higher-priority team bypasses declared authority. CODEOWNERS last-match semantics and
owner-declaration order must survive normalization. A snapshot of normalized principals +
memberships makes membership resolution pure and total-ordered; the explicit `unresolved`
state is the honest output when the snapshot cannot name exactly one active human (Principle
IV; ADR-0009 degradation).

**Alternatives rejected**:
- *Resolve identities/CODEOWNERS/catalog from disk at evaluation time* — rejected: impure,
  non-reproducible; must be a caller snapshot.
- *Pick the first human from an ambiguous team* — rejected: non-deterministic outcome for the
  affected human; must **warn / `unresolved`**.
- *Skip an ambiguous team and continue fallback* — rejected: bypasses a higher-priority
  declared owner; the safe deterministic result is immediate `unresolved`.
- *Skip named-human resolution (route to a team)* — rejected: C7 puts named-human target
  resolution in scope with a defined order.

---

## R10 — Escalation routing: declarative OR over proven triggers, evaluated after the 11 rules

**Decision**: escalation is a **declarative OR over deterministically-proven triggers**,
computed **after** the eleven rule results, and is **not** a twelfth rubric rule. The
**Pass-0-provable** triggers (C4), each mapped to an **existing `EscalationReason` enum
value**, are:

| Trigger (`EscalationReason`) | Deterministic condition (Pass 0) |
|---|---|
| `one-way-door` | proposal `reversibility` = one-way-door (irreversible) |
| `cost-threshold` | supplied **normalized cost evidence** ≥ threshold |
| `security-surface` | resolved-target intersection hits a **security-surface** target set |
| `data-residency` | supplied **data-residency evidence** present/positive |
| `regulatory` | proposal `complianceControls` non-empty **or** resolved target ∈ regulated set |
| `contradicts-accepted-adr` | **only** on overlap (R4) **plus** an accepted ADR assertion failing against the supplied proposed/current-HEAD input; unlike `scope-hierarchy`, this trigger does not require org scope, domain applicability, or a base-green transition |
| `agent-authored-production` | provenance = agent/agent-drafted **and** resolved target ∈ production set |
| `human-requested` | explicit requester flag in the input |

**Later-pass-only** reasons (`low-confidence`, `pass-disagreement`, `novel-no-precedent`) are
**absent** from Pass 0. **Missing optional trigger evidence is "not proven / no reason"** —
never a fabricated escalation — and the **routing evidence status is recorded** on the report.
Routing produces `escalate: true` + the OR-set of proven reasons and a resolved (or
`unresolved`) named-human **target** (R9). When no escalation is proven, target resolution
does not run and the target state is explicitly `not-required`.

**Rationale**: ADR-0005 makes escalation **declarative** and routes-not-approves; modelling
it as a rule would pollute the fixed eleven-rule rubric (FR-002) and the exactly-eleven-result
contract (C11). An OR over **proven** triggers, each backed by explicit evidence, is
deterministic and honest about what it could not prove (evidence status recorded). Reusing
only existing enum values keeps the patch schema-compatible (R12/Principle V).

**Alternatives rejected**:
- *Add escalation as a 12th rule* — rejected: breaks the fixed 11-rule rubric and the
  exactly-eleven-`RuleResult` contract (C11/FR-002).
- *Introduce a new `EscalationReason` (e.g. `pass-zero-error`)* — rejected: schema change
  (Principle V); the existing enum subset suffices.
- *Escalate on missing evidence "to be safe"* — rejected: non-deterministic and dishonest;
  missing evidence is **not proven**, recorded as such.

---

## R11 — Two channels: runtime `Pass0Report` vs schema-compatible `evaluationPatch`; total order + canonical bytes

**Decision** (C1/C6): produce **two** artifacts with a **total, stable ordering** and
**canonical serialization**:

- **`Pass0Report`** — the runtime channel: **exactly eleven `RuleResult`s** in **rubric
  order** (FR-002), each with status (`pass | fail | inert | not-evaluated`), the rule's
  **fixed** severity when `fail`, a **reason code** (R12 catalog), refs, and richer evidence;
  plus the routing evidence/decision (R10) and per-trigger evidence status. A rule may
  aggregate **multiple findings** but yields **exactly one `RuleResult` / event**.
- **`evaluationPatch`** — the schema-compatible channel (R12): `deterministicFindings[]`
  (**violations only**), `escalate`, `escalationReasons[]`.

**Ordering**: rubric-rule order first (the eleven, fixed), then within a rule a stable
secondary key (candidate `AdrRef`, related `AdrRef`, canonical matcher/assertion key,
canonical target key, report-only `recordPath`, field, message). `RuleFinding.adr` is
strictly an `AdrRef`; lower-level paths remain separate evidence and cannot enter patch
projection. **Routing events** follow the eleven rule events in a separate section.
**Canonical serialization**: sorted object keys; only set-like arrays sorted by their
documented stable comparator; fixed-order arrays (rubric results and routing triggers/reasons)
and declaration-ordered arrays (deciders, CODEOWNERS rules/owners, catalog owners, matchers,
assertions) preserved exactly; LF newlines; **no timestamps or accidental insertion-order
dependence** in the deterministic payload.
`rubricVersion` is content and lives exactly once on `Pass0Report`; it participates in
canonical bytes. **Caller run metadata** (evaluator version, run id, wall-clock) lives in an
**envelope OUTSIDE** the deterministic payload so byte-reproduction holds (FR-005). The
**evaluator never writes** the patch; a later caller may propose it via PR.

**Rationale**: one channel must be **schema-strict for a later caller PR** (patch), the other must
be **richly useful at runtime** (report) without a schema change (R8). A total order +
canonical bytes is what makes SC "byte-for-byte reproducible" testable and what lets the CI
surface diff two runs meaningfully. Isolating run metadata in an envelope is the only way
reproducibility survives real-world version/time stamping.

**Alternatives rejected**:
- *One combined artifact* — rejected: either it leaks non-schema evidence into the patch
  (Principle V) or it starves the runtime report; two channels resolve the tension.
- *Sort by insertion / discovery order* — rejected: non-reproducible; ordering must be a pure
  function of content.
- *Put run metadata inside the deterministic payload* — rejected: destroys byte-reproduction
  (FR-005).

---

## R12 — Reason-code catalog & finding-id mapping (rubric ids are public; no duplicates)

**Decision**: define a **stable, enumerated reason-code catalog** covering `pass / fail /
inert / not-evaluated` and routing-evidence statuses, and use the **rubric rule ids as the
public finding ids** (FR-010). Every existing lower-level core finding is **mapped onto
exactly one rubric rule** with **no duplicate** aggregate result:

| Existing core finding(s) | Rubric rule (public id) | Result kind |
|---|---|---|
| `frontmatter-parse` / `frontmatter-fence` / `file-read`; contract findings (`strict-unknown-key`, `required-field`, `invalid-type`, `invalid-enum-value`, `contract-refinement`, `superseded-requires-supersededBy`, …) | `schema-valid` | fail (error) → then 10× `not-evaluated` (C11) |
| `unique-id` | `id-unique` | fail (error) only for a duplicate within the same normalized log; same id in different named logs passes |
| *(new)* reciprocity / cycle (R3) | `supersession-consistent` | fail (error) |
| `dangling-supersededBy` | `supersession-consistent` | fail (error), reported once (C2) |
| `dangling-supersedes` / `dangling-relatesTo` | `no-orphan-refs` | fail (error); federated ref w/o log snapshot ⇒ inert (C2) |
| `affects-unresolvable` (ADR-0009 lower-level finding; backing absent) | `affects-resolvable.backing-absent` operational reason | inert; never a deterministic violation (C3) |
| registry resolves against present backing with zero targets (R4) | `affects-resolvable` | fail (warn) |
| *(new)* canonical target-id intersection (R4) | `affects-overlap` | warn / pass / inert |
| *(new)* base→proposed org-assertion transition (R5) | `scope-hierarchy` | fail (error) / inert |
| *(new)* one-source-declaration + engine compile (R6/R7) | `assertions-compile` | fail (error) / inert |
| *(new)* engine evaluate = false (R7) | `assertions-pass` | warn / inert / `not-evaluated` (after compile fail) |
| identity snapshot resolution (R9) | `decider-resolvable` | warn / inert |
| `expiry-sane` (caller date, strict future) | `expiry-sane` | info |

Reason codes are the exhaustive namespaced catalog fixed in
[`data-model.md` §11](./data-model.md) (for example `schema-valid.contract-error`,
`affects-resolvable.zero-targets`, `assertions-compile.ambiguous-source`,
`no-orphan-refs.federated-log-absent`, `route.escalate.regulatory`,
`route.target.unresolved`).
The **`evaluationPatch` projection** keeps **violations only** (`error`/`warn`/`info`
findings that represent an actual rule failure), drops `pass` / `inert` / `not-evaluated`,
maps each to `{ rule, severity, message?, adr? }`, and attaches `escalate` +
`escalationReasons[]` from R10.

**Proposal eligibility is an input contract, not a rubric rule**: the rubric evaluates only
`draft`/`proposed` records. A schema-valid selected record with status `accepted`, `rejected`,
`superseded`, or `deprecated` yields the typed `candidate-status-not-proposal` input error,
no report/patch, and CLI exit `2`. A schema-invalid candidate still enters `schema-valid` and
returns the complete eleven-result shape at exit `1`.

**`affects-overlap` pass precedence is fixed**: `accepted-intersection` wins as a failure;
otherwise an empty accepted corpus selects `no-accepted-corpus`; otherwise missing pair
backing selects the inert reason; otherwise fully evaluated no-intersection selects `none`.

**Rationale**: rubric ids as public finding ids give one stable, documented vocabulary across
CLI, report, and patch; mapping the pre-existing lower-level findings **onto** rules (rather
than emitting both) satisfies "a rule may have many findings but exactly one aggregate
result" and prevents duplicate/confusing output (FR-010; C11). An enumerated catalog makes
downstream consumers (CI comment, MCP) able to switch on codes deterministically.

**Alternatives rejected**:
- *Emit both the low-level finding and a rubric result* — rejected: duplicates; violates the
  one-aggregate-result contract (C11).
- *Free-text reasons instead of an enum* — rejected: not machine-switchable; breaks stable
  downstream consumption and canonical ordering.
- *Invent new finding ids distinct from rubric ids* — rejected: FR-010 makes the rubric ids
  the public ids; a second vocabulary would fragment the contract.

---

## Consolidated decisions

| # | Decision | Primary driver |
|---|---|---|
| R0 | Hard block until 004 **T018** evidence lands; scope now, build later | Outcome ladder; SC-013 |
| R1 | Rego/JSONPath engines = **gated** vetted-offline-lib **or** compiled-snapshot; no `opa-wasm` raw compile, no shell-out; port-based | Principle II/IV; FR-015/C5 |
| R2 | `@adrkit/evaluator` first-party surface package; not core, not adapter | Principle III; ADR-0005/0007; A7 |
| R3 | **New** reciprocity + cycle checks; `buildAdrGraph` = edges only | FR-002; core reality |
| R4 | `TargetResolutionRegistry` + canonical target ids; preserve positive/negation and `repo` log semantics; explicit overlap reason precedence | ADR-0009; C3 |
| R5 | scope-hierarchy = base→proposed org-assertion green→red, domain-explicit; no prose | Principle IV; C-scope |
| R6 | Exactly one source declaration; engine never reads files; both/neither ⇒ compile error | FR-006; Principle IV |
| R7 | Generic typed `AssertionEngineRegistry` ports carry opaque immutable compile payload directly to evaluate; Rego+JSONPath required; grep/custom inert unless registered | FR-015/C5 |
| R8 | Surface finding-evidence + one-source limits as **gated decisions**, no schema edit | Principle V; C6 |
| R9 | Immutable identity snapshot; exact decider/CODEOWNERS/catalog order; ambiguous team is an immediate unresolved barrier | C7; ADR-0005 |
| R10 | Declarative escalation OR over proven triggers, after the 11 rules; existing enum only | ADR-0005; C4 |
| R11 | Two channels (`Pass0Report` + `evaluationPatch`); total order + canonical bytes; only set-like arrays sorted; metadata in envelope | C1/C6; FR-005 |
| R12 | Enumerated reason-code catalog; rubric ids = public finding ids; map existing findings, no duplicates; non-proposal status is input error | FR-010; C10/C11 |
