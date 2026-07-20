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

> **Implementation gates cleared 2026-07-19.** Feature 004 T018 evidence is linked in
> tasks T001 and the per-engine decision is fixed in research R1.

---

## 1. Library surface (`@adrkit/evaluator`)

### 1.1 Signature

```ts
function evaluatePass0<R, J, G, C>(
  input: Pass0Input<R, J, G, C>,
): Pass0Evaluation;
// Pass0Evaluation =
//   | { kind: 'evaluated'; result: { report: Pass0Report; patch: EvaluationPatch } }
//   | { kind: 'input-error'; error: Pass0InputContractError }
```

### 1.2 Purity contract (FR-006; Principle IV) — CI-asserted

The function **MUST**:
- be a **pure, total function of `input`** — same input ⇒ either the same typed input error or
  **byte-identical** `report` + `patch` (excluding the caller `runMetadata` envelope, which is
  outside the deterministic payload);
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
  optional current target-resolution `log`, immutable target inventories, optional
  federated-log snapshots, resolved assertion sources/inputs, optional identity directory,
  optional scope-contradiction evidence, and optional routing-trigger evidence (data-model
  §2). Bundle `log` is ADR-0009's current repo/log context, not an ADR record's source log.
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
3. If that candidate is schema-valid, require status `draft` or `proposed`. A selected
   `accepted`, `rejected`, `superseded`, or `deprecated` ADR is the typed
   `candidate-status-not-proposal` input-contract error: emit no report/patch and exit `2`.
   A schema-invalid candidate still proceeds to the evaluator's `schema-valid` rule.
4. Load + validate the `--snapshot` bundle into immutable **data snapshots only**. Snapshot
   JSON MUST NOT identify, import, or execute code.
5. Construct the vetted in-process target/assertion registries at the composition boundary.
   A resolver/engine unavailable in that registry yields the specified inert result; the CLI
   never loads executable ports from the bundle.
6. Resolve `--date` into `evaluationDate`.
7. Call `evaluatePass0(input)`.
8. Serialize the result canonically (with `--json`) or render it; set the process exit code
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
An assertion object key is canonical only if it parses as exactly three strings and is
byte-equal to compact standard
`JSON.stringify([record.log ?? "", record.path, assertion.id])`; whitespace-equivalent or
otherwise noncanonical spellings are rejected, not normalized.

No JSON field may select/import a registry, module, command, or executable port. The CLI
injects trusted registries separately. The approved Rego compiled-artifact profile's
fixed base64/hash/media-type envelope is data passed only to an already-registered
trusted engine for validation/evaluation; it cannot choose an implementation.

### 2.4 Approved assertion-engine profiles

**JSONPath** uses exact `jsonpath-rfc9535@1.3.0` in process. The accepted source
language is restricted RFC 9535: root/child/wildcard/index/slice/descendant/filter
selectors, comparisons, logical/existence tests, and only `length()`, `count()`, and
`value()`. Reject `match()`/`search()`, custom functions, scripts, parent/backtick/type
selectors, JSONPath-Plus/JavaScript extensions, source >8 KiB, or input canonical JSON
over 1 MiB/depth 64/100,000 nodes. A result passes iff the nodelist is non-empty;
selecting `false` passes. Compile validates and records an immutable source+AST payload.
The dependency's evaluator only accepts source and internally reparses; it cannot consume
the AST. This implementation truth is explicit and does not create a second evaluator
compile, hidden mutable cache, or unsafe cast.

**Rego** has no default executable engine. The data-only artifact is the exact strict
`application/vnd.adrkit.rego-wasm-policy.v1+json` /
`adrkit.rego-wasm-policy/v1` envelope from data-model §5: source+hash, raw canonical
base64 Wasm+hash, data, slash entrypoint, ABI 1.3, OPA compiler/capabilities metadata,
empty `requiredHostBuiltins`, and an envelope hash over canonical prior fields. Reject
unknown/duplicate keys, malformed/noncanonical base64, bad hashes, invalid Wasm
magic/module, unsupported ABI/profile, missing entrypoint, disallowed builtins, source
>64 KiB, data >1 MiB/depth64/100,000 nodes, module >4 MiB, or decoded envelope
>6.75 MiB. adrkit validates the envelope boundary but does not execute untrusted Wasm.
An absent registered port is explicit inert behavior.

A trusted caller may implement that typed port with exact
`@open-policy-agent/opa-wasm@1.10.0` only after accepting the artifact-producer trust
boundary and lack of deterministic fuel/step metering. Wall-clock worker timeouts are
not permitted. Caller compilation is outside Pass 0; opa-wasm evaluates precompiled
Wasm and does not compile Rego. Never invoke an OPA binary/service. `grep` and `custom`
remain inert unless trusted composition code registers deterministic ports.

---

## 3. Rule semantics (the eleven, in fixed rubric order — FR-002)

Every rule yields **exactly one** aggregate `RuleResult` (C11) even when it aggregates several
underlying findings. Severity is **fixed per rule** (never inferred) and present only when
`status='fail'`. "inert" = backing absent (degradation, never a violation).

| # | Rule (public id) | Fixed sev. | Pass | Fail | Inert / not-evaluated |
|---|---|---|---|---|---|
| 1 | `schema-valid` | error | proposal parses + contract-valid | any parse/contract finding on `proposalPath` ⇒ **fail**, then **10× `not-evaluated`** (C11) | — |
| 2 | `id-unique` | error | id unique inside `record.log ?? ""`; same id in a different named log passes | same-log `unique-id` collision | `not-evaluated.schema-invalid` |
| 3 | `supersession-consistent` | error | reciprocal + acyclic `supersedes` | dangling `supersededBy` (reported here once), non-reciprocal pair, or cycle (**new** checks — `buildAdrGraph` gives edges only, research [§R3](../research.md)) | `not-evaluated.schema-invalid` |
| 4 | `no-orphan-refs` | error | all refs resolve | `dangling-supersedes` / `dangling-relatesTo` | federated ref with **no external-log snapshot** ⇒ **inert** (`no-orphan-refs.federated-log-absent`, C2); `not-evaluated.schema-invalid` |
| 5 | `affects-resolvable` | warn | ≥1 target resolves | backing present + **zero** targets ⇒ **warn** (`affects-resolvable.zero-targets`, C3) | inventory absent ⇒ **inert** (`affects-resolvable.backing-absent`); resolver port absent ⇒ **inert** (`affects-resolvable.resolver-absent`); `not-evaluated.schema-invalid` |
| 6 | `affects-overlap` | warn | no accepted ADRs ⇒ `no-accepted-corpus`; accepted ADRs fully evaluated with no canonical intersection ⇒ `none` | non-empty **canonical target-key intersection** with an accepted ADR ⇒ **warn** (once per pair, research [§R4](../research.md)) | accepted corpus exists but required resolution backing is absent ⇒ **inert**; `not-evaluated.schema-invalid` |
| 7 | `scope-hierarchy` | error | no attributable contradiction | component proposal overlapping an **applicable accepted `org` ADR** whose assertion was **green on base, fails on proposed** ⇒ **fail** (research [§R5](../research.md)) | missing base/proposed input, assertion source, or engine ⇒ **inert**; non-component/no-overlap ⇒ pass; `not-evaluated.schema-invalid` |
| 8 | `assertions-compile` | error | each assertion declares exactly one source and the T002-approved source or compiled-artifact profile validates it | ADR declares **neither** source (`no-source`) / **both** (`ambiguous-source`) / present source or artifact fails validation (`parse-error`) ⇒ **fail** (research [§R6](../research.md)) | required resolved file content, compiled artifact, or engine absent ⇒ **inert**; missing evaluation input does not affect compile; no assertions ⇒ pass (`assertions-compile.none`); `not-evaluated.schema-invalid` |
| 9 | `assertions-pass` | warn | compiled evaluation true | compiled evaluation **false** or deterministic engine evaluation error ⇒ **warn** | missing engine/input ⇒ **inert**; **compile failed ⇒ `not-evaluated.prereq-failed`** (C11); no assertions ⇒ pass |
| 10 | `decider-resolvable` | warn | every declared decider resolves unambiguously to one active principal | none declared (`none-declared`), zero (`zero-match`), or ambiguous (`ambiguous-match`) ⇒ **warn** (research [§R9](../research.md)) | identity directory absent ⇒ **inert**; `not-evaluated.schema-invalid` |
| 11 | `expiry-sane` | info | `reviewBy` absent, or **strictly after** `evaluationDate` | `reviewBy` ≤ `evaluationDate` ⇒ **info** (`expiry-sane.past-or-equal`); **no clock read** | `not-evaluated.schema-invalid` |

Target-set rules preserve ADR-0009 semantics: the evaluator passes the bundle's optional
current target-resolution `log` explicitly to every target resolver; it never infers that
context from `record.log`. They require at least one positive matcher, apply matching
negations after positive matching, make negation-only resolve empty, and make a
different-`repo` qualifier contribute no local match. Assertion compile/artifact validation
carries the engine-owned generic opaque
immutable payload directly into the same typed port's `evaluate` call. No recompile, hidden
mutable registry lookup, or unsafe cast may bridge the two rules.

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

For `affects-overlap`, the primary sequence is binding: any
`accepted-intersection` failure wins; otherwise an empty accepted corpus passes as
`no-accepted-corpus`; otherwise absent required pair backing is inert; otherwise a fully
evaluated accepted corpus with no intersection passes as `none`.

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
  stable keys in this precedence — candidate `AdrRef`, related `AdrRef`,
  `matcherKey`/`assertionKey`, canonical target key, `recordPath`, `field`, `message`.
  `RuleFinding.adr`, when present, is strictly an `AdrRef`; paths and lower-level evidence use
  separate report-only fields and can never be projected into `adr`.
- **Routing** events (§6) follow the eleven rule events in a **separate section** — routing is
  **not** a twelfth rule.
- **Routing trigger order** is the §6.1 table order. `evidenceStatus` contains exactly one
  `proven`/`not-proven` entry for each of the eight Pass 0 triggers in that order; the proven
  `reasons` array is the stable subset in the same order. The target event follows those
  eight statuses.
- **Canonical bytes**: sorted object keys; only set-like arrays sorted by their documented
  stable comparator; fixed arrays (rubric results, routing evidence/reasons) and
  declaration-ordered arrays (deciders, CODEOWNERS rules/owners, catalog owners, matchers,
  assertions) preserved; LF newlines; **no timestamps, run ids, or accidental
  insertion-order dependence** in the deterministic payload. Caller `runMetadata` (version,
  `ranAt`, `runId`) lives in the **envelope**, excluded from the hashed / compared payload,
  so `report` + `patch` reproduce **byte-for-byte** across runs and machines.

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
proposal's **resolved entities**. Exact source-local ordering is:

1. deciders in proposal declaration order;
2. unique paths sorted by canonical path key; for each path, select the **last matching**
   CODEOWNERS rule in declaration order and append that rule's owners in declaration order;
3. unique entities sorted by canonical target key; for each entity, append catalog owners in
   snapshot declaration order.

Stable-deduplicate candidates at first occurrence; do not globally sort identities. Skip a
missing/inactive direct human. A **team** resolves only with **exactly one active human**.
The first ordered team with zero or multiple active humans is an ambiguity barrier:
immediately emit **`unresolved`** (`route.target.unresolved`) and do not inspect later
candidates or sources. Exhausting the ordered candidates also emits `unresolved`.

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

A schema-valid selected record with status `accepted`, `rejected`, `superseded`, or
`deprecated` is specifically a broken proposal-input contract
(`candidate-status-not-proposal`): no report/patch is emitted and the CLI exits `2`.

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
  research [§R8](../research.md)). `adr`, when emitted, must already be a valid core `AdrRef`;
  `RuleFinding.recordPath` and lower-level `path` evidence are never reinterpreted as `adr`.
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
  calls a model; JSONPath uses the approved restricted source profile, Rego uses the fixed
  inert-by-default artifact boundary, and `grep`/`custom` are inert unless a deterministic
  port is registered (research [§R1](../research.md), [§R7](../research.md)).
- **No** persistence, acceptance, merge, or mutation of any record or state (Principle I/IV;
  FR-014).

---

## 10. Conformance tests this contract implies (offline only)

For each of the eleven rules: a **pass**, a **fail**, and (where applicable) an **inert**
fixture, all **model-free**. Plus: `schema-valid` short-circuit ⇒ 10× `not-evaluated`;
`assertions-pass` `not-evaluated` after compile fail; **byte-for-byte** ordering / canonical
reproduction; `evaluationPatch` validates against the **current** schema; input immutability /
no mutation; same-id/same-log collision plus same-id/different-log pass; affects
include+negation, negation-only, same-`repo`, and different-`repo` against an explicit current
target-resolution log distinct from record source logs; exact `affects-overlap`
pass reasons; compact canonical assertion-key acceptance plus whitespace/noncanonical
rejection; one compile/validate whose opaque payload is passed directly to evaluate; only
set-like arrays sorted while semantic arrays preserve order; target fallback + overlap;
last-match CODEOWNERS plus team-ambiguity barrier routing; all four non-proposal statuses as
input-error exit `2`; report-only matcher/assertion/path/field/lower-level evidence with
`adr: AdrRef`; routing triggers + `unresolved` route; CLI exits **0/1/2**; rubric-id mapping
with **no duplicates**; and the `clean-clone-builds` + dependency-graph + purity gates extended
to `@adrkit/evaluator`. **No live external service, model, network, clock, or filesystem read**
enters any test's evaluator path.
