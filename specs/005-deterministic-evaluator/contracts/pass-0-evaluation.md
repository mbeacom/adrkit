# Contract: Pass 0 Evaluation — library + CLI

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) |
**Research**: [research.md](../research.md) |
**Data model**: [data-model.md](../data-model.md) | **Date**: 2026-07-19

This contract defines the **behavioral surface** of Pass 0: the pure library function, the
thin CLI composition boundary, the semantics of each of the eleven rubric rules, the reason
codes, the total ordering + canonical serialization, escalation routing, the schema-compatible
`evaluationPatch` projection, and the exit codes. Types are the conceptual shapes from
[data-model.md](../data-model.md). Clarifications **C1–C11** and **FR-001…FR-016** in
`spec.md` are binding.

> **⛔ Implementation of this contract is HARD-BLOCKED until `specs/004-ci-surface/tasks.md`
> T018 is checked off with second-repo evidence** (research [§R0](../research.md); SC-013).
> This document specifies behavior; it authorizes no build.

---

## 1. Library surface (`@adrkit/evaluator`)

### 1.1 Signature

```ts
function evaluatePass0(input: Pass0Input): Pass0Result;
// Pass0Result = { report: Pass0Report; patch: EvaluationPatch }   (data-model §7, §9, §10)
```

### 1.2 Purity contract (FR-006; Principle IV) — CI-asserted

The function **MUST**:
- be a **pure, total function of `input`** — same input ⇒ **byte-identical** `report` + `patch`
  (excluding the caller `runMetadata` envelope, which is outside the deterministic payload);
- perform **no** clock read, **no** network, **no** database/index access, **no** filesystem
  traversal or read (including **never** reading `Assertion.expressionFile` — the caller
  resolves it into `assertionInputs`, research [§R6](../research.md));
- **not mutate** any part of `input` (all inputs are deeply `readonly`; a no-mutation test
  asserts this);
- import **no** model client, prompt/embedding/retrieval library, adapter package, or
  network/clock/fs dependency (dependency-graph gate, research [§R2](../research.md));
- **route, never approve** — it returns data and **writes/persists/mutates nothing** (no ADR,
  no acceptance state, no `review` field, no DB); persistence of `patch` is a **separate later
  caller PR** (FR-014; Principle I).

Missing backing (target inventory, resolver port, engine port, assertion content/input,
identity directory, scope evidence, routing evidence) yields an **explicit inert / not-proven**
result — **never** a fabricated pass/fail and **never** a thrown error (FR-007; ADR-0009).

---

## 2. CLI surface (`@adrkit/cli`) — the impure composition boundary

### 2.1 Invocation

```text
adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [--json]
```

- `<proposal-path>` — path to the proposal ADR file (draft/proposed) under evaluation.
- `--snapshot <bundle.json>` — path to the caller **snapshot bundle** (JSON) supplying the
  immutable target inventories, optional federated-log snapshots, resolved assertion
  sources/inputs, optional identity directory, optional scope-contradiction evidence, and
  optional routing-trigger evidence (data-model §2).
- `--date YYYY-MM-DD` — **required** evaluation date for `expiry-sane` (no clock is read).
- `--json` — emit the machine envelope (`report` + `patch` + `metadata`) as canonical JSON;
  default (no `--json`) emits a human-readable rendering of the same content.
- **There is NO `--write` flag.** The CLI **prints** the `Pass0Report` and `evaluationPatch`;
  it never writes them back to any ADR or store (FR-014; Principle I).

### 2.2 CLI responsibilities (impurity lives here, not in the library)

1. Read the proposal file and the **whole corpus** from disk/git and build the full
   **`LintCorpusResult`** via `@adrkit/core` `lintCorpus` (this result **includes** malformed
   files and the candidate; the candidate's typed record MAY be absent when it failed to parse).
2. Identify the proposal within that result by `proposalPath`.
3. Load + validate the `--snapshot` bundle into immutable **data snapshots only**. Snapshot
   JSON MUST NOT identify, import, or execute code.
4. Construct the vetted in-process target/assertion registries at the composition boundary.
   A resolver/engine unavailable in that registry yields the specified inert result; the CLI
   never loads executable ports from the bundle.
5. Resolve `--date` into `evaluationDate`.
6. Call `evaluatePass0(input)`.
7. Serialize the result canonically (with `--json`) or render it; set the process exit code
   per §7.

The CLI **MUST** treat malformed usage or a **malformed snapshot-bundle contract** as an
**exit 2** condition (§7) — it does **not** invent defaults for a broken bundle.

### 2.3 Snapshot wire contract

`--snapshot` accepts only `SnapshotBundleJsonV1` from data-model §2.1 with exact
`schemaVersion: "adrkit.pass0.snapshot/v1"`. Unknown/duplicate keys, wrong field types,
malformed canonical assertion/target keys, non-JSON values, and invalid identity uniqueness
are malformed-bundle **exit 2** errors. Omitted optional backing is valid and normalizes to
an unavailable/empty runtime container so the affected rule reports inert. Set-like JSON
arrays normalize to validated immutable sets; declared CODEOWNERS order is preserved.

No JSON field may select/import a registry, module, command, or executable port. The CLI
injects trusted registries separately. If T002 approves a compiled-artifact profile, the
fixed base64/hash/media-type artifact DTO is data passed only to the already-registered
engine for validation/evaluation; it cannot choose an implementation.

---

## 3. Rule semantics (the eleven, in fixed rubric order — FR-002)

Every rule yields **exactly one** aggregate `RuleResult` (C11) even when it aggregates several
underlying findings. Severity is **fixed per rule** (never inferred) and present only when
`status='fail'`. "inert" = backing absent (degradation, never a violation).

| # | Rule (public id) | Fixed sev. | Pass | Fail | Inert / not-evaluated |
|---|---|---|---|---|---|
| 1 | `schema-valid` | error | proposal parses + contract-valid | any parse/contract finding on `proposalPath` ⇒ **fail**, then **10× `not-evaluated`** (C11) | — |
| 2 | `id-unique` | error | id unique in corpus | corpus `unique-id` collision | `not-evaluated.schema-invalid` |
| 3 | `supersession-consistent` | error | reciprocal + acyclic `supersedes` | dangling `supersededBy` (reported here once), non-reciprocal pair, or cycle (**new** checks — `buildAdrGraph` gives edges only, research [§R3](../research.md)) | `not-evaluated.schema-invalid` |
| 4 | `no-orphan-refs` | error | all refs resolve | `dangling-supersedes` / `dangling-relatesTo` | federated ref with **no external-log snapshot** ⇒ **inert** (`no-orphan-refs.federated-log-absent`, C2); `not-evaluated.schema-invalid` |
| 5 | `affects-resolvable` | warn | ≥1 target resolves | backing present + **zero** targets ⇒ **warn** (`affects-resolvable.zero-targets`, C3) | backing/port absent ⇒ **inert** (`affects-resolvable.backing-absent`); `not-evaluated.schema-invalid` |
| 6 | `affects-overlap` | warn | no accepted ADRs, or no canonical intersection | non-empty **canonical target-key intersection** with an accepted ADR ⇒ **warn** (once per pair, research [§R4](../research.md)) | required resolution backing absent ⇒ **inert**; `not-evaluated.schema-invalid` |
| 7 | `scope-hierarchy` | error | no attributable contradiction | component proposal overlapping an **applicable accepted `org` ADR** whose assertion was **green on base, fails on proposed** ⇒ **fail** (research [§R5](../research.md)) | missing base/proposed input, assertion source, or engine ⇒ **inert**; non-component/no-overlap ⇒ pass; `not-evaluated.schema-invalid` |
| 8 | `assertions-compile` | error | each assertion declares exactly one source and the T002-approved source or compiled-artifact profile validates it | ADR declares **neither** source (`no-source`) / **both** (`ambiguous-source`) / present source or artifact fails validation (`parse-error`) ⇒ **fail** (research [§R6](../research.md)) | required resolved file content, compiled artifact, or engine absent ⇒ **inert**; missing evaluation input does not affect compile; no assertions ⇒ pass (`assertions-compile.none`); `not-evaluated.schema-invalid` |
| 9 | `assertions-pass` | warn | compiled evaluation true | compiled evaluation **false** or deterministic engine evaluation error ⇒ **warn** | missing engine/input ⇒ **inert**; **compile failed ⇒ `not-evaluated.prereq-failed`** (C11); no assertions ⇒ pass |
| 10 | `decider-resolvable` | warn | every declared decider resolves unambiguously to one active principal | none declared (`none-declared`), zero (`zero-match`), or ambiguous (`ambiguous-match`) ⇒ **warn** (research [§R9](../research.md)) | identity directory absent ⇒ **inert**; `not-evaluated.schema-invalid` |
| 11 | `expiry-sane` | info | `reviewBy` absent, or **strictly after** `evaluationDate` | `reviewBy` ≤ `evaluationDate` ⇒ **info** (`expiry-sane.past-or-equal`); **no clock read** | `not-evaluated.schema-invalid` |

### 3.1 Aggregate status and primary reason

One rule may inspect multiple references, matchers, assertions, or accepted ADRs but still
returns one aggregate result. Its status precedence is **`fail` > `inert` > `pass`**:

- any proven violation makes the aggregate `fail`, even if another sub-check is inert;
- with no violation, any required sub-check blocked by absent backing makes it `inert`;
- it is `pass` only when every applicable sub-check was evaluated and none violated;
- `not-evaluated` is reserved for the two explicit prerequisite cases in §3.2.

All underlying sub-findings remain in `findings`. The aggregate `reason` is selected
deterministically from the winning status using the per-rule order in the exhaustive reason
catalog (data-model §11). This makes mixed fail/inert fixtures byte-stable rather than
dependent on discovery order.

### 3.2 Short-circuit & continuation (C11; research [§R12](../research.md))

- **`schema-valid` fail** ⇒ the report is **exactly** `schema-valid` fail + **ten
  `not-evaluated`** (`not-evaluated.schema-invalid`). No typed rule runs. The required
  routing block is still deterministic: all eight trigger statuses are `not-proven`,
  `escalate=false`, `reasons=[]`, and `target=route.target.not-required`. The patch contains
  only the schema violation, `escalate=false`, and no escalation reasons.
- **Any other `error` fail** ⇒ evaluation **continues** for every still-evaluable rule; only
  the **direct dependents** become `not-evaluated` (only `assertions-pass` depends on
  `assertions-compile`; `not-evaluated.prereq-failed`).
- **Later passes NEVER run after any `error`.** The proposal `outcome` is `returned` iff any
  rule is `fail` at `error` severity; otherwise `ok` (even with warns/infos, escalation, or an
  unresolved route).

---

## 4. Reason codes (enumerated; research [§R12](../research.md), data-model §11)

Reason codes are **stable, namespaced strings** (`<rule>.<code>` and `route.<...>`); the
**public finding ids are the rubric RuleIds** (FR-010). The complete, versioned catalog is in
[data-model.md §11](../data-model.md). Consumers (CLI render, future CI comment, MCP) switch on
these codes deterministically. **Existing lower-level core findings are mapped onto exactly one
rubric rule** with **no duplicate aggregate result** (mapping table in research
[§R12](../research.md)).

---

## 5. Ordering & canonical serialization (FR-005; research [§R11](../research.md))

- **Primary order**: the eleven `RuleResult`s appear in **fixed rubric order** (the table in
  §3), always length 11 (C11).
- **Secondary order** (within a rule's findings, and for the patch `deterministicFindings`):
  stable keys in this precedence — candidate id, related ADR id, matcher/assertion id,
  canonical target id, path, field, message.
- **Routing** events (§6) follow the eleven rule events in a **separate section** — routing is
  **not** a twelfth rule.
- **Routing trigger order** is the §6.1 table order. `evidenceStatus` contains exactly one
  `proven`/`not-proven` entry for each of the eight Pass 0 triggers in that order; the proven
  `reasons` array is the stable subset in the same order. The target event follows those
  eight statuses.
- **Canonical bytes**: sorted object keys; arrays sorted by the stable keys above; LF newlines;
  **no timestamps, run ids, or insertion-order dependence** in the deterministic payload. Caller
  `runMetadata` (version, `ranAt`, `runId`) lives in the **envelope**, excluded from the hashed
  / compared payload, so `report` + `patch` reproduce **byte-for-byte** across runs and machines.

---

## 6. Escalation routing (C4/C7; research [§R10](../research.md))

Routing is a **declarative OR over deterministically-proven triggers**, computed **after** the
eleven rules, mapping only to **existing** `EscalationReason` enum values.

### 6.1 Provable triggers (Pass 0)

| `EscalationReason` | Proven when |
|---|---|
| `one-way-door` | proposal reversibility is irreversible (one-way-door) |
| `cost-threshold` | supplied normalized cost evidence ≥ threshold |
| `security-surface` | a resolved target ∈ the security-surface target set |
| `data-residency` | supplied data-residency evidence present/positive |
| `regulatory` | `complianceControls` non-empty **or** a resolved target ∈ regulated set |
| `contradicts-accepted-adr` | **only** on overlap (rule 6) **and** an overlapping accepted ADR assertion failing against supplied proposed/current-HEAD input; unlike rule 7, this trigger does not require org scope, domain applicability, or a base-green transition |
| `agent-authored-production` | provenance is agent/agent-drafted **and** a resolved target ∈ production set |
| `human-requested` | explicit requester present in input |

**Absent in Pass 0** (later-pass only): `low-confidence`, `pass-disagreement`,
`novel-no-precedent`. **Missing optional trigger evidence ⇒ "not proven"**, recorded on
`routing.evidenceStatus` — never a fabricated escalation.

### 6.2 Named-human target resolution (C7)

When `escalate=false`, routing stops with `target.kind='not-required'` and
`route.target.not-required`. When escalation is proven, resolve a single active human in
fixed order: **(1)** proposal `deciders` → **(2)** normalized
CODEOWNERS owners for the proposal's **resolved paths** → **(3)** catalog owners for the
proposal's **resolved entities**. Ordered by source priority, then declared/normalized owner
order, then canonical identity. A **team** must resolve through snapshot membership to **exactly
one active human**; zero or many ⇒ **`unresolved`** (an explicit route state/event, code
`route.target.unresolved`) — never an arbitrary pick.

Routing (escalation and/or an unresolved route) **does not** change the exit code by itself
(§7): a warn/info/inert-only proposal exits **0** even when it escalates or routes to
`unresolved`.

---

## 7. Exit codes (FR-013; C10)

| Exit | Condition |
|---|---|
| **2** | Invalid CLI usage, **or** a malformed `--snapshot` bundle / broken input contract (the CLI cannot form a valid `Pass0Input`). |
| **1** | A **rubric error** — any rule `status='fail'` at `error` severity (proposal `outcome='returned'`). |
| **0** | Only warn / info / inert / pass results — **even if** the proposal escalates or routes to `unresolved`. |

Exit selection is a pure function of the returned `report.outcome` plus CLI usage/bundle
validity; escalation and unresolved routing **never** raise the exit code.

---

## 8. `evaluationPatch` projection (C6; research [§R12](../research.md), [§R8](../research.md))

The returned `evaluationPatch` is a **strict schema-compatible subset** of the committed
`Evaluation` type:

```ts
EvaluationPatch = {
  deterministicFindings: DeterministicFinding[];   // violations only; each EXACTLY {rule, severity, message?, adr?}
  escalate: boolean;
  escalationReasons: EscalationReason[];            // existing enum values only
}
```

- **Include** only rule **violations** (rule failures at their fixed severity). **Exclude**
  `pass` / `inert` / `not-evaluated`.
- **Map** each violation onto the four committed `DeterministicFinding` fields. **No** reason
  code, canonical target id, source ref, snapshot id, or evidence field is added to the patch —
  that richness stays on the `Pass0Report` (the schema `DeterministicFinding` cannot carry it,
  research [§R8](../research.md)).
- `escalate` + `escalationReasons` come from §6.
- The patch **MUST validate against the current committed schema** (a test task asserts this);
  `schema:emit` stays byte-clean (no schema change).
- The evaluator **returns** the patch; it **never writes** it. A later caller may propose it via
  PR (FR-014; Principle I).

---

## 9. Non-goals (contract boundaries)

- **No** later pass (rubric scoring, adversarial, decision) runs here (FR-011).
- **No** plan→ADR conversion (the proposal is already an ADR file; data-model §3).
- **No** schema change: neither `DeterministicFinding` evidence fields nor an `Assertion`
  one-source constraint is added; both are gated decisions handled off-schema (research
  [§R8](../research.md); Principle V; C6).
- **No** engine that shells out, opens a socket, reads the fs, runs an arbitrary command, or
  calls a model; Rego/JSONPath are required conformance engines behind a **gated** deterministic
  technology choice (research [§R1](../research.md), [§R7](../research.md)); `grep`/`custom` are
  inert unless a deterministic port is registered.
- **No** persistence, acceptance, merge, or mutation of any record or state (Principle I/IV;
  FR-014).

---

## 10. Conformance tests this contract implies (offline only)

For each of the eleven rules: a **pass**, a **fail**, and (where applicable) an **inert**
fixture, all **model-free**. Plus: `schema-valid` short-circuit ⇒ 10× `not-evaluated`;
`assertions-pass` `not-evaluated` after compile fail; **byte-for-byte** ordering / canonical
reproduction; `evaluationPatch` validates against the **current** schema; input immutability /
no mutation; engine-port present vs absent; target fallback + overlap; routing triggers +
`unresolved` route; CLI exits **0/1/2**; rubric-id mapping with **no duplicates**; and the
`clean-clone-builds` + dependency-graph + purity gates extended to `@adrkit/evaluator`. **No
live external service, model, network, clock, or filesystem read** enters any test's evaluator
path.
