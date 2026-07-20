# Data Model: Deterministic Evaluator (Pass 0) — Phase 4

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Research**: [research.md](./research.md) | **Contract**:
[contracts/pass-0-evaluation.md](./contracts/pass-0-evaluation.md) | **Date**: 2026-07-19

These are **conceptual, TypeScript-like shapes** to fix vocabulary and boundaries for the
plan. **They are not implementation code** and are not authoritative over the committed
schema — where a TypeScript type already exists in `@adrkit/core` it is referenced and reused. Several
contracts currently exist only as exported Zod values; implementation must add **type-only
`z.infer` aliases** beside those values and export them from core rather than redefining
their shapes in the evaluator. This adds no field and changes no runtime/JSON schema. Types
marked *(new — runtime only)* exist only in `@adrkit/evaluator` and are **never** persisted
or added to the schema (Principle V; Clarification C6). All input types are **deeply
immutable** (`readonly`); the evaluator mutates none of them (FR-006).

> **Implementation gates cleared 2026-07-19.** Feature 004 T018 evidence and the
> engine decisions are recorded in research §§R0–R1.

---

## 1. Reused and contract-derived core types

```ts
// Existing exported TypeScript types from @adrkit/core.
type Adr;                    // { frontmatter: AdrFrontmatter; body: string; path: string; log?: ... }
type AdrFrontmatter;         // id, title, status, date, deciders[], scope, domain?, reversibility,
                             //   blastRadius, supersedes[], supersededBy?, relatesTo[], conflictsWith[],
                             //   affects[], assertions[], provenance{authoredBy}, complianceControls[], reviewBy?, evaluation?

// Contract-derived aliases to export from core via `z.infer<typeof ExistingZodValue>`.
// The Zod values already exist; adding aliases changes no schema.
type Assertion;              // { id; description?; engine: 'rego'|'jsonpath'|'grep'|'custom';
                             //   expression?; expressionFile?; input; severity }
type AffectsMatcher;         // { type: 'path'|'entity'|'package'|'resource'|'api'|'data'; pattern; repo?; negate? }
type AdrRef;                 // local id or `<log>:<id>`; never a filesystem path
type EscalationReason;       // 'one-way-door'|'cost-threshold'|'security-surface'|'data-residency'|'regulatory'|
                             //   'contradicts-accepted-adr'|'low-confidence'|'pass-disagreement'|
                             //   'agent-authored-production'|'novel-no-precedent'|'human-requested'
type Severity;               // 'error'|'warn'|'info'
type DeterministicFinding;   // { rule: string; severity: Severity; message?: string; adr?: AdrRef }  ← EXACTLY these fields (R8)
type Evaluation;             // { ranAt?; evaluatorVersion?; rubricVersion?; scores?; confidence?;
                             //   escalate?; escalationReasons: EscalationReason[]; deterministicFindings: DeterministicFinding[] }

// Existing exported TypeScript types from @adrkit/core validation.
type LintCorpusResult;       // { checked: number; findings: Finding[]; records: Adr[] }
type Finding;                // { rule: string; severity: Severity; message: string; path?; id?; field?; pattern? }
```

**Key reuse note (research [§R8](./research.md))**: `DeterministicFinding` has **exactly**
`{ rule, severity, message?, adr? }`. It **cannot** carry canonical target ids, source
refs/hashes, snapshot ids, or reason codes. All such evidence lives on the runtime
`Pass0Report` (§7), never on the returned schema-compatible patch (§9).

---

## 2. The evaluator input bundle

```ts
/** (new — runtime only) The complete, immutable input to the pure Pass 0 function.
 *  Assembled by the impure CLI boundary (adr evaluate); the library reads nothing else. */
interface Pass0Input<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> {
  /** Full corpus lint result INCLUDING the candidate and any malformed-file findings.
   *  The proposal is identified by `proposalPath` within this result; the typed record
   *  MAY be absent here when the proposal file failed to parse (see §3, C11). (reused) */
  readonly corpus: LintCorpusResult;

  /** Identifies the proposal inside `corpus` (its `path`). `schema-valid` maps the
   *  parse/contract findings on THIS path; only on success is a typed Adr obtained. */
  readonly proposalPath: string;

  /** Optional immutable snapshots for cross-log refs. Missing required log ⇒ orphan rule inert. */
  readonly federatedLogs?: readonly FederatedLogSnapshot[];

  /** Optional current repo/log identity for ADR-0009 `repo` matcher qualification.
   *  This is target-resolution context, not a record's source `Adr.log`. */
  readonly resolutionLog?: string;

  /** Immutable target-resolution backing (§4). Missing per-type backing ⇒ inert, never fail. */
  readonly targets: TargetInventorySnapshots;
  readonly targetRegistry: TargetResolutionRegistry;

  /** Immutable assertion evaluation backing (§5). Missing engine/content/input ⇒ inert. */
  readonly assertionInputs: AssertionInputSnapshot;
  readonly assertionEngines: AssertionEngineRegistry<
    RegoPayload,
    JsonPathPayload,
    GrepPayload,
    CustomPayload
  >;

  /** Immutable identity/decider directory (§6). Missing ⇒ decider-resolvable inert; routing unresolved. */
  readonly identity?: IdentityDirectorySnapshot;

  /** Optional deterministic scope-contradiction evidence (§5/R5). Absent ⇒ scope-hierarchy inert. */
  readonly scopeEvidence?: ScopeContradictionEvidence;

  /** Optional normalized routing-trigger evidence (§8/C4). Absent per-trigger ⇒ "not proven". */
  readonly routingEvidence?: RoutingTriggerEvidence;

  /** REQUIRED caller-supplied evaluation date (YYYY-MM-DD). expiry-sane uses this; NO clock read. */
  readonly evaluationDate: IsoDate;              // e.g. "2026-07-19"

}

type IsoDate = string;   // strict "YYYY-MM-DD"; validated by the CLI boundary before entry
interface FederatedLogSnapshot {
  readonly log: string;
  readonly adrIds: readonly string[];
  readonly sourceRef?: string;
}
```

### 2.1 Versioned JSON wire bundle

The CLI accepts one strict, data-only wire DTO. Runtime registries/ports are deliberately not
representable in JSON.

```ts
type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type TargetInventorySnapshotsJson = TargetInventorySnapshots;
type IdentityDirectorySnapshotJson = IdentityDirectorySnapshot;

interface SnapshotBundleJsonV1 {
  readonly schemaVersion: 'adrkit.pass0.snapshot/v1';
  readonly federatedLogs?: readonly FederatedLogSnapshot[];
  /** Current repo/log identity for target resolution; omitted means unnamed local context. */
  readonly log?: string;
  readonly targets?: TargetInventorySnapshotsJson;
  readonly assertionInputs?: {
    readonly sources?: Readonly<Record<AssertionKey, {
      readonly fileContent?: string;
      readonly sourceRef?: string;
      readonly compiledArtifact?: RegoWasmPolicyEnvelopeV1;
    }>>;
    readonly inputs?: Readonly<Record<AssertionKey, { readonly document: JsonValue }>>;
  };
  readonly identity?: IdentityDirectorySnapshotJson;
  readonly scopeEvidence?: {
    readonly baseInputs?: Readonly<Record<AssertionKey, { readonly document: JsonValue }>>;
  };
  readonly routingEvidence?: {
    readonly costEvidence?: { readonly normalizedCost: number; readonly threshold: number };
    readonly dataResidency?: { readonly present: boolean };
    readonly humanRequested?: { readonly requester: string };
    readonly securitySurfaceTargetKeys?: readonly CanonicalTargetKey[];
    readonly regulatedTargetKeys?: readonly CanonicalTargetKey[];
    readonly productionTargetKeys?: readonly CanonicalTargetKey[];
  };
}
```

`TargetInventorySnapshotsJson` and `IdentityDirectorySnapshotJson` use the same scalar,
array, and object fields as their runtime counterparts, but contain no `Map`, `Set`, method,
function, module name, or port selector. The CLI:

1. requires the exact `schemaVersion` and rejects unknown keys, duplicate object keys,
   non-JSON values, malformed or noncanonical assertion keys, invalid canonical target keys,
   duplicate unique identities, and wrong field types as **exit 2**. An assertion key is
   canonical only when parsing it yields exactly three strings and the original key is
   byte-equal to compact standard
   `JSON.stringify([record.log ?? "", record.path, assertion.id])`; whitespace variants are
   rejected rather than normalized;
2. interprets an omitted optional backing field as unavailable/inert, never as a malformed
   bundle and never as an invented empty authoritative source;
3. converts set-like target-key arrays to immutable runtime sets after validation and sorts
   only set-like collections by their documented canonical comparator. Fixed-order rubric
   results/routing evidence/reasons and declaration-ordered deciders, CODEOWNERS rules/owners,
   catalog owners, matchers, and assertions preserve semantic order;
4. constructs `TargetResolutionRegistry` and `AssertionEngineRegistry` from trusted,
   T002-approved composition code — never from a JSON value; and
5. for Rego, accepts only the fixed
   `RegoWasmPolicyEnvelopeV1` data shape above and passes it to an already-registered
   engine for hash/format validation. The bundle cannot import an arbitrary JS/native module
   or select an executable port.

The CLI normalizes omitted `targets`/`assertionInputs` objects to empty immutable runtime
containers so the corresponding rules can report inert. This is different from malformed
present data, which is exit 2.

---

## 3. Proposal identity & the schema-valid tension (C11)

```ts
/** (new — runtime only) Result of locating + typing the proposal within `corpus`. */
interface ProposalResolution {
  readonly proposalPath: string;
  /** Parse/contract findings on proposalPath, drawn from corpus.findings (schema-valid maps these). */
  readonly schemaFindings: readonly Finding[];
  /** The typed record — present ONLY when schema-valid passed (record parsed & contract-valid).
   *  When schema-valid FAILS this is undefined and the other 10 rules are `not-evaluated` (C11). */
  readonly proposed?: Adr;
}
type ProposalStatus = 'draft' | 'proposed';
interface Pass0InputContractError {
  readonly code: 'candidate-status-not-proposal';
  readonly proposalPath: string;
  readonly actualStatus: 'accepted' | 'rejected' | 'superseded' | 'deprecated';
}
```

**Rule of resolution (research [§R12](./research.md), C11)**:
- `schema-valid` reads only `schemaFindings` for `proposalPath`. Any parse/contract finding ⇒
  **fail (error)** ⇒ the report has **exactly 11** results: `schema-valid` fail + **10
  `not-evaluated`**. Later passes never run.
- On schema success, a typed `draft`/`proposed` ADR proceeds and the remaining ten rules run
  over it plus the corpus snapshot (which **includes the candidate**). A typed `accepted`,
  `rejected`, `superseded`, or `deprecated` record is **not a proposal**: evaluation returns
  `Pass0InputContractError`, no `Pass0Report`/patch, and the CLI exits `2`. This is an input
  precondition, not a twelfth rule. Plan→ADR conversion is **out of scope**.
- For **non-schema** errors, evaluation **continues** for all still-evaluable rules; only the
  **direct dependents** of the failed rule become `not-evaluated` (e.g. `assertions-pass` when
  `assertions-compile` failed). Later passes never run after **any** error.
- On schema failure, the routing shape still exists but no typed-proposal trigger can be
  proven: eight ordered `not-proven` trigger statuses, `escalate=false`, no reasons, and
  `target=route.target.not-required`. The patch contains only the schema violation and
  non-escalated routing fields.
- `id-unique` scopes identity by `[record.log ?? "", record.frontmatter.id]`; equal ids in
  different named logs are distinct, while duplicates inside one normalized log collide.

---

## 4. Target resolution model (research [§R4](./research.md))

```ts
/** (new — runtime only) A normalized, canonical, comparable target identity. Two matchers
 *  resolve to the SAME target iff their canonical ids are equal. Stable string form for ordering. */
interface CanonicalTargetId {
  readonly kind: AffectsType;               // 'path'|'entity'|'package'|'resource'|'api'|'data'
  readonly id: string;                      // normalized canonical string (e.g. posix path, package name@scope, urn)
}
type CanonicalTargetKey = string;           // stable `${kind}:${id}` serialization used for equality/intersection
type AffectsType = 'path' | 'entity' | 'package' | 'resource' | 'api' | 'data';

/** Immutable inventories supplied by the caller for target resolution. Each is optional;
 *  a missing inventory for a type ⇒ that type's matchers are INERT (never fail) (C3). */
interface TargetInventorySnapshots {
  readonly trackedPaths?: readonly string[];               // complete tracked-path inventory (for `path`, reuses picomatch)
  readonly dependencies?: readonly DependencyEntry[];      // complete lock/dependency inventory (for `package`)
  readonly entities?: readonly CatalogEntity[];            // catalog snapshot (for `entity`)
  readonly resources?: readonly ResourceDescriptor[];      // for `resource`
  readonly apis?: readonly ApiDescriptor[];                // for `api`
  readonly data?: readonly DataDescriptor[];               // for `data`
}
interface DependencyEntry { readonly name: string; readonly version?: string }
interface CatalogEntity    { readonly id: string; readonly owner?: PrincipalRef }
interface ResourceDescriptor { readonly id: string; readonly securitySurface?: boolean; readonly production?: boolean; readonly regulated?: boolean }
interface ApiDescriptor      { readonly id: string; readonly securitySurface?: boolean; readonly production?: boolean }
interface DataDescriptor     { readonly id: string; readonly residency?: string; readonly regulated?: boolean }

/** A deterministic, pure resolver for one AffectsType. Registered per type; no I/O. */
interface TargetResolverPort {
  readonly type: AffectsType;
  /** Pure: matcher + explicit current-log context + inventory → finite canonical id set.
   *  MUST NOT infer log context from the record or read clock/network/fs. */
  resolve(
    matcher: AffectsMatcher,
    context: TargetResolutionContext,
  ): TargetResolution;
}
interface TargetResolutionContext {
  /** Caller-supplied ADR-0009 current repo/log identity; undefined is unnamed local context. */
  readonly log?: string;
  readonly inventory: TargetInventorySnapshots;
}
interface TargetResolution {
  readonly status: 'resolved' | 'inert';    // backing absent; registry miss is handled before port invocation
  readonly ids: readonly CanonicalTargetId[];   // may be empty even when resolved ⇒ affects-resolvable warn (C3)
  readonly reason: ReasonCode;
}

/** The registry of resolver ports. Built-in path/package reuse core matcher primitives;
 *  entity/resource/api/data are caller-registered. Lookup miss ⇒ inert. */
interface TargetResolutionRegistry {
  get(type: AffectsType): TargetResolverPort | undefined;
}
```

**Resolvability / overlap semantics**:
- Every record resolves against the same caller-supplied current `resolutionLog` for the
  inventory being evaluated; `record.log` remains only the record's federated source identity
  and assertion-key component. An unqualified matcher applies in the current resolution
  context; a `repo`-qualified matcher applies only when its qualifier equals
  `resolutionLog`. A different-repo qualifier contributes no local match. The evaluator
  passes the context to the port explicitly; no resolver infers it.
- Per ADR-0009, target resolution unions non-negated matches and then subtracts any targets
  matched by applicable negated matchers. At least one non-negated matcher must match;
  negation-only does not mean "all except" and resolves to an empty set. Negation is scoped
  to the ADR that declares it.
- `affects-resolvable`: for each proposal matcher, resolve via the registry. Backing/port
  absent ⇒ **inert**, using `affects-resolvable.backing-absent` for a missing inventory and
  `affects-resolvable.resolver-absent` for a registry miss; backing present + **zero** ids ⇒
  **warn**; ≥1 id ⇒ pass.
- `affects-overlap`: **finite intersection by `CanonicalTargetKey`** of the proposal's
  canonical id set with each
  **accepted** ADR's canonical id set, computed **once per (proposal, accepted-ADR) pair**.
  Primary outcome/reason precedence is: any non-empty intersection ⇒ **warn** /
  `affects-overlap.accepted-intersection`; otherwise no accepted ADRs ⇒ pass /
  `affects-overlap.no-accepted-corpus` (no pair backing is required); otherwise missing
  required pair backing ⇒ inert; otherwise a fully evaluated accepted corpus with no
  intersection ⇒ pass / `affects-overlap.none`.

---

## 5. Assertion evaluation model (research [§R6](./research.md), [§R7](./research.md))

```ts
/** Compact standard JSON.stringify([record.log ?? "", record.path, assertion.id]).
 *  No added whitespace. Record path, not ADR id, prevents aliasing when `id-unique` fails
 *  but evaluation continues. The CLI rejects keys not byte-equal to this canonical form. */
type AssertionKey = string;

/** (new — runtime only) Caller-resolved backing for assertions. The evaluator NEVER reads
 *  expressionFile; the caller resolves it to content + a stable ref/hash here. */
interface AssertionInputSnapshot {
  /** For each declared expressionFile, resolved content (if the caller supplied it). */
  readonly sources: Readonly<Record<AssertionKey, ResolvedAssertionSource>>;
  /** Current/proposed input documents for proposal and accepted-ADR assertions. */
  readonly inputs: Readonly<Record<AssertionKey, ResolvedAssertionInput>>;
}
interface ResolvedAssertionSource {
  /** Resolved expressionFile content (undefined when the caller did not/could not resolve it). */
  readonly fileContent?: string;
  /** Stable source ref/hash for reproducibility & attribution (§7 evidence). */
  readonly sourceRef?: string;               // e.g. "sha256:…"
  /** Present only for an engine whose T002-approved profile consumes compiled artifacts. */
  readonly compiledArtifact?: RegoWasmPolicyEnvelopeV1;
}
interface ResolvedAssertionInput { readonly document?: JsonValue }   // resolved input data; absent ⇒ inert

interface RegoWasmPolicyEnvelopeV1 {
  readonly mediaType: 'application/vnd.adrkit.rego-wasm-policy.v1+json';
  readonly schemaVersion: 'adrkit.rego-wasm-policy/v1';
  readonly source: string;                    // UTF-8, <= 64 KiB
  readonly sourceSha256: string;              // 64 lowercase hex chars
  readonly moduleBase64: string;              // canonical base64, decoded <= 4 MiB
  readonly moduleSha256: string;              // hash of raw Wasm bytes
  readonly data: JsonValue;                   // canonical JSON <= 1 MiB/depth64/100k nodes
  readonly entrypoint: string;                // canonical slash path, e.g. /example/allow
  readonly abi: { readonly major: 1; readonly minor: 3 };
  readonly compiler: {
    readonly name: 'opa';
    readonly version: string;
    readonly capabilitiesProfile: 'adrkit.rego-wasm.capabilities/v1';
    readonly capabilitiesSha256: string;
  };
  /** v1 permits no caller-provided host builtin implementation. */
  readonly requiredHostBuiltins: readonly [];
  /** SHA-256 of canonical JSON for every prior field, excluding this field itself. */
  readonly envelopeSha256: string;
}

interface JsonPathCompiledPayload {
  readonly source: string;                    // <= 8 KiB UTF-8
  readonly ast: JsonPathQuery;                // immutable validation evidence
}

type AssertionEngineName = 'rego' | 'jsonpath' | 'grep' | 'custom';

/** A deterministic assertion engine port. Payload is engine-owned and opaque to the evaluator.
 *  Exactly one profile is approved per engine in T002. */
type AssertionEnginePort<E extends AssertionEngineName, Payload> =
  | SourceAssertionEnginePort<E, Payload>
  | CompiledArtifactEnginePort<E, Payload>;
interface SourceAssertionEnginePort<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  readonly profile: 'source';
  compile(effectiveSource: string, sourceRef?: string): CompileOutcome<E, Payload>;
  evaluate(compiled: CompiledAssertion<E, Payload>, input: JsonValue): EvalOutcome;
}
interface CompiledArtifactEnginePort<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  readonly profile: 'compiled-artifact';
  validateArtifact(artifact: RegoWasmPolicyEnvelopeV1): CompileOutcome<E, Payload>;
  evaluate(compiled: CompiledAssertion<E, Payload>, input: JsonValue): EvalOutcome;
}
type CompileOutcome<E extends AssertionEngineName, Payload> =
  | { readonly ok: true; readonly compiled: CompiledAssertion<E, Payload> }
  | { readonly ok: false; readonly reason: ReasonCode };   // ⇒ assertions-compile error
type EvalOutcome    = { readonly ok: true; readonly pass: boolean }          // pass=false ⇒ assertions-pass warn
                    | { readonly ok: false; readonly reason: ReasonCode };
interface CompiledAssertion<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  /** Deeply immutable by engine contract; only the owning port knows this type or inspects it. */
  readonly payload: Payload;
  readonly sourceRef?: string;
}

interface AssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> {
  readonly rego?: AssertionEnginePort<'rego', RegoPayload>;
  readonly jsonpath?: AssertionEnginePort<'jsonpath', JsonPathPayload>;
  readonly grep?: AssertionEnginePort<'grep', GrepPayload>;
  readonly custom?: AssertionEnginePort<'custom', CustomPayload>;
}
```

The evaluator dispatches on `assertion.engine` to the corresponding registry property, then
passes the successful `CompiledAssertion<E, Payload>` directly back to that same property's
`evaluate`. The four registry properties preserve each payload's static type; no
`any`/`unknown` cast, hidden mutable `ref` lookup, or recompilation is permitted. Payload
immutability and one compile/validate per evaluated assertion are conformance-test obligations.

**Effective-source rule (R6)**: source validity is based on what the ADR **declares**, not on
whether backing happened to arrive. Declared inline `expression` only ⇒ compile inline;
declared `expressionFile` only + resolved `fileContent` ⇒ compile supplied content; **neither
declared ⇒ `assertions-compile` error (`no-source`)**; **both declared ⇒ error
(`ambiguous-source`)** (schema does not forbid either case today — R8; no schema edit).
For the approved JSONPath `source` profile, declared `expressionFile` with missing resolved content
makes `assertions-compile` **inert**. For a T002-approved `compiled-artifact` profile, a
missing artifact makes it inert and artifact validation supplies the compile result; the
snapshot never selects or imports a port. A missing engine port also makes compile inert.
Missing evaluation input affects `assertions-pass` only and makes that rule **inert**.
Compile/artifact-validation failure ⇒ **error**; `evaluate.pass === false` or a deterministic
engine evaluation error ⇒ **`assertions-pass` warn**.

### 5.1 Approved engine profiles and resource limits

`jsonpath-rfc9535@1.3.0` is the only built-in engine dependency. Its port accepts the
restricted RFC 9535 selector/function set recorded in research R1, stores
`JsonPathCompiledPayload`, and defines pass as a non-empty nodelist. The package's public
evaluator accepts source rather than AST, so `evaluate` internally reparses the already
validated source; the same immutable payload still travels directly from compile to
evaluate, with no evaluator recompile or hidden cache. Input is canonical JSON <=1 MiB,
depth <=64, <=100,000 nodes.

Rego uses `RegoWasmPolicyEnvelopeV1` only. The envelope validator rejects unknown or
duplicate keys, invalid canonical JSON/base64/hash/Wasm/entrypoint/ABI/capability data,
non-empty host builtin requirements, source >64 KiB, data >1 MiB/depth64/100,000 nodes,
module >4 MiB, or decoded envelope >6.75 MiB. adrkit registers no Rego runtime by
default and does not execute the module. A trusted caller may register a typed
compiled-artifact port after accepting artifact-producer trust; `@open-policy-agent/opa-wasm`
1.10.0 is an evaluator for precompiled Wasm, not a Rego compiler, and is not an adrkit
runtime dependency.

```ts
/** (new — runtime only) Deterministic scope-hierarchy contradiction evidence (R5). */
interface ScopeContradictionEvidence {
  /** Base assertion inputs for accepted org assertions. Proposed/current-HEAD inputs come from
   *  AssertionInputSnapshot.inputs. The evaluator computes green→red through the same engines. */
  readonly baseInputs?: Readonly<Record<AssertionKey, ResolvedAssertionInput>>;
}
```

For ordinary local evaluation, the evaluator compiles the accepted org assertion through the
same engine registry and evaluates it against the explicit base input above and proposed input
in `assertionInputs`. Only `base=pass → proposed=fail` is a contradiction. Missing engine,
source/artifact, base input, or proposed input makes the rule inert. Pass 0 does not accept a
precomputed contradiction verdict.

---

## 6. Identity / decider directory (research [§R9](./research.md))

```ts
/** (new — runtime only) Immutable, normalized identity directory snapshot. */
interface IdentityDirectorySnapshot {
  readonly principals: readonly Principal[];             // normalized, canonical identities
  readonly teams: readonly Team[];                       // team → member principal refs
  readonly codeowners?: readonly CodeownersRule[];       // normalized CODEOWNERS (path glob → owners)
  readonly catalogOwners?: Readonly<Record<string /*entityId*/, readonly PrincipalRef[]>>;
}
interface Principal { readonly id: PrincipalRef; readonly active: boolean; readonly kind: 'human' | 'team' }
type PrincipalRef = string;                              // canonical e.g. "@mbeacom"
interface Team { readonly id: PrincipalRef; readonly members: readonly PrincipalRef[] }
interface CodeownersRule { readonly pattern: string; readonly owners: readonly PrincipalRef[] }
```

**`decider-resolvable`**: each declared proposal decider must resolve to exactly one active
principal through the snapshot; no declared decider, a zero match, or an ambiguous match ⇒
**warn**; snapshot absent ⇒ **inert**.
**Named-human routing target (C7)** resolves in fixed order — (1) proposal `deciders`,
(2) CODEOWNERS owners for resolved paths (§4), (3) catalog owners for resolved entities —
with these exact source-local rules:

1. deciders preserve proposal declaration order;
2. unique paths are sorted by canonical path key; for each path, the **last matching**
   CODEOWNERS rule in declaration order wins and its owners preserve declaration order;
3. unique entity ids are sorted by canonical target key; each entity's catalog-owner array
   preserves snapshot declaration order.

Candidates are stable-deduplicated on first occurrence, never globally identity-sorted. A
missing/inactive direct human is skipped. A **team** must resolve through membership to
**exactly one active human**. The first ordered team with zero or multiple active human
members is an ambiguity barrier: target resolution immediately returns **`unresolved`** and
does not consider later candidates/sources. Exhausting all candidates also returns
`unresolved` (§8).

---

## 7. Rule results & the runtime report (research [§R11](./research.md))

```ts
type RuleId =
  | 'schema-valid' | 'id-unique' | 'supersession-consistent' | 'no-orphan-refs'
  | 'affects-resolvable' | 'affects-overlap' | 'scope-hierarchy'
  | 'assertions-compile' | 'assertions-pass' | 'decider-resolvable' | 'expiry-sane';   // FIXED order (FR-002)

type RuleStatus = 'pass' | 'fail' | 'inert' | 'not-evaluated';

/** (new — runtime only) Exactly one aggregate result per rule (C11), even with many findings. */
interface RuleResult {
  readonly rule: RuleId;                     // public finding id == rubric rule id (FR-010)
  readonly status: RuleStatus;
  readonly severity?: Severity;              // the rule's FIXED severity, present only when status='fail'
  readonly reason: ReasonCode;               // §11 enumerated catalog
  readonly findings: readonly RuleFinding[]; // 0..n underlying findings aggregated into this one result
  readonly evidence?: RuleEvidence;          // richer, report-only detail (NOT in the patch, R8)
}
interface RuleFinding {
  readonly reason: ReasonCode;
  readonly message?: string;
  /** The only identity field eligible for patch projection; MUST validate as core AdrRef.
   *  A filesystem path is never stored here. */
  readonly adr?: AdrRef;
  readonly candidateAdr?: AdrRef;             // report-only ordering/identity
  readonly relatedAdr?: AdrRef;               // report-only ordering/identity
  readonly matcherKey?: string;               // report-only canonical matcher identity
  readonly assertionKey?: AssertionKey;       // report-only canonical assertion identity
  readonly target?: CanonicalTargetId;       // report-only
  readonly recordPath?: string;               // report-only path; never projected as `adr`
  readonly field?: string;                    // report-only lower-level field evidence
  readonly sourceRef?: string;               // report-only
  readonly lowerLevel?: LowerLevelFindingEvidence; // preserved source Finding evidence
}
interface LowerLevelFindingEvidence {
  readonly rule: string;
  readonly path?: string;
  readonly id?: string;
  readonly field?: string;
  readonly pattern?: string;
}
interface RuleEvidence {
  readonly resolvedTargets?: readonly CanonicalTargetId[];
  readonly overlappingWith?: readonly string[];        // accepted ADR ids sharing targets
  readonly assertionTransitions?: readonly string[];   // accepted assertion ids that went green→red
}

/** (new — runtime only) The deterministic runtime report: EXACTLY 11 results + routing. */
interface Pass0Report {
  readonly rubricVersion: string;            // in the deterministic payload (content, not run metadata)
  readonly proposalPath: string;
  readonly results: readonly RuleResult[];   // length === 11, in fixed RuleId order (C11)
  readonly routing: RoutingDecision;         // §8 — appended AFTER the 11 rule events, not a 12th rule
  readonly outcome: 'ok' | 'returned';       // 'returned' iff any status='fail' with severity='error'
  // NOTE: NO timestamp / run id here — those live in the envelope (§10), preserving byte reproduction.
}
```

For aggregate rules, status precedence is `fail > inert > pass`; `not-evaluated` is reserved
for schema-invalid results and `assertions-pass` after a compile failure. A definite
violation therefore remains visible even when another sub-check lacks backing. The primary
`reason` is the first code for the winning status in the normative per-rule catalog order
below; all sub-findings remain in `findings`.

`RuleFinding` ordering uses `candidateAdr`, `relatedAdr`, `matcherKey`/`assertionKey`,
canonical target key, `recordPath`, `field`, then `message`. The richer identity and
`lowerLevel` fields are report-only. Patch projection may copy only a valid `adr: AdrRef`;
it cannot reinterpret `recordPath` or lower-level `path` as an ADR reference.

---

## 8. Routing (research [§R10](./research.md), C4/C7)

```ts
/** (new — runtime only) Normalized, caller-supplied routing-trigger evidence. Per-trigger
 *  absence ⇒ "not proven" (recorded), never a fabricated escalation. */
interface RoutingTriggerEvidence {
  readonly costEvidence?: { readonly normalizedCost: number; readonly threshold: number };
  readonly dataResidency?: { readonly present: boolean };
  readonly humanRequested?: { readonly requester: PrincipalRef };
  readonly securitySurfaceTargets?: ReadonlySet<CanonicalTargetKey>;
  readonly regulatedTargets?: ReadonlySet<CanonicalTargetKey>;
  readonly productionTargets?: ReadonlySet<CanonicalTargetKey>;
  // one-way-door and agent provenance are derived from the proposal. Accepted-ADR contradiction
  // is derived by evaluating overlapping accepted ADR assertions against supplied proposed inputs.
}

interface RoutingDecision {
  readonly escalate: boolean;                // OR over proven triggers
  readonly reasons: readonly Pass0EscalationReason[]; // existing enum subset only
  readonly evidenceStatus: readonly TriggerEvidenceStatus[];   // per-trigger proven/not-proven (recorded)
  readonly target: RouteTarget;              // not-required, resolved named human, or unresolved (C7)
}
type Pass0EscalationReason =
  | 'one-way-door' | 'cost-threshold' | 'security-surface' | 'data-residency'
  | 'regulatory' | 'contradicts-accepted-adr' | 'agent-authored-production'
  | 'human-requested';
interface TriggerEvidenceStatus { readonly reason: Pass0EscalationReason; readonly status: 'proven' | 'not-proven'; readonly code: ReasonCode }
type RouteTarget =
  | { readonly kind: 'not-required'; readonly code: 'route.target.not-required' }
  | { readonly kind: 'resolved'; readonly human: PrincipalRef; readonly via: 'deciders' | 'codeowners' | 'catalog'; readonly code: ReasonCode }
  | { readonly kind: 'unresolved'; readonly code: ReasonCode };   // explicit unresolved route state/event
```

**Provable triggers (Pass 0)** = `one-way-door`, `cost-threshold`, `security-surface`,
`data-residency`, `regulatory`, `contradicts-accepted-adr`, `agent-authored-production`,
`human-requested`. `contradicts-accepted-adr` requires canonical overlap plus an accepted ADR
assertion that fails on supplied proposed/current-HEAD input; it is distinct from the narrower
org/base-green `scope-hierarchy` rule. Named-human resolution runs only when escalation is
true; a non-escalated run has `route.target.not-required`. **Absent** =
`low-confidence`, `pass-disagreement`, `novel-no-precedent`.

---

## 9. The schema-compatible `evaluationPatch` (research [§R12](./research.md), C6)

```ts
/** (new — runtime only) The projection the evaluator RETURNS (never writes). Schema-compatible
 *  subset of the committed Evaluation type: violations only + escalate + reasons. */
interface EvaluationPatch {
  /** Violations only (rule failures). Each maps to EXACTLY {rule, severity, message?, adr?} (R8). */
  readonly deterministicFindings: readonly DeterministicFinding[];
  readonly escalate: boolean;
  readonly escalationReasons: readonly EscalationReason[];   // existing enum values only
}
```

**Projection rule**: from the 11 `RuleResult`s, keep only `status==='fail'` (and, per rubric,
`warn`/`info` rule *violations*); drop `pass` / `inert` / `not-evaluated`. Map each to the
four committed fields; attach `escalate` + `escalationReasons` from §8. **No** reason code,
target id, source ref, or evidence field leaks into the patch (Principle V; R8). A later
caller may propose this patch via PR; the evaluator persists nothing (FR-014).

---

## 10. Result envelope & run metadata (FR-005)

```ts
/** (new — runtime only) Successful evaluated payload. */
interface Pass0Result {
  readonly report: Pass0Report;              // deterministic payload (byte-reproducible)
  readonly patch: EvaluationPatch;           // deterministic payload (byte-reproducible)
}
/** Total pure-library outcome. Input errors are not rubric findings and produce no patch. */
type Pass0Evaluation =
  | { readonly kind: 'evaluated'; readonly result: Pass0Result }
  | { readonly kind: 'input-error'; readonly error: Pass0InputContractError };

/** Caller run metadata — carried in the CLI envelope, OUTSIDE the deterministic payload,
 *  so byte-for-byte reproduction of report+patch holds regardless of version/time (FR-005). */
interface RunMetadata {
  readonly evaluatorVersion?: string;
  readonly ranAt?: string;                   // wall clock — NOT part of the hashed/compared payload
  readonly runId?: string;
}
type Pass0Envelope =
  | { readonly result: Pass0Result; readonly metadata?: RunMetadata }
  | { readonly error: Pass0InputContractError; readonly metadata?: RunMetadata };
```

---

## 11. Reason-code catalog (enumerated; research [§R12](./research.md))

```ts
/** (new — runtime only) Stable, exhaustive, namespaced reason codes. Public finding ids are
 *  the rubric RuleIds; adding or renaming a code is a versioned contract change. */
type ReasonCode =
  // schema-valid
  | 'schema-valid.ok' | 'schema-valid.file-read'
  | 'schema-valid.parse-error' | 'schema-valid.contract-error'
  // id-unique
  | 'id-unique.ok' | 'id-unique.collision'
  // supersession-consistent
  | 'supersession-consistent.ok' | 'supersession-consistent.dangling-superseded-by'
  | 'supersession-consistent.non-reciprocal' | 'supersession-consistent.cycle'
  // no-orphan-refs
  | 'no-orphan-refs.ok' | 'no-orphan-refs.dangling-supersedes'
  | 'no-orphan-refs.dangling-relates-to' | 'no-orphan-refs.federated-log-absent'
  // affects-resolvable
  | 'affects-resolvable.ok' | 'affects-resolvable.zero-targets'
  | 'affects-resolvable.backing-absent' | 'affects-resolvable.resolver-absent'
  // affects-overlap
  | 'affects-overlap.accepted-intersection' | 'affects-overlap.no-accepted-corpus'
  | 'affects-overlap.backing-absent' | 'affects-overlap.none'
  // scope-hierarchy
  | 'scope-hierarchy.ok' | 'scope-hierarchy.contradicts-org-assertion'
  | 'scope-hierarchy.evidence-absent' | 'scope-hierarchy.engine-absent'
  | 'scope-hierarchy.source-absent' | 'scope-hierarchy.base-input-absent'
  | 'scope-hierarchy.proposed-input-absent' | 'scope-hierarchy.not-applicable-scope'
  // assertions-compile
  | 'assertions-compile.ok' | 'assertions-compile.none'
  | 'assertions-compile.no-source' | 'assertions-compile.ambiguous-source'
  | 'assertions-compile.parse-error' | 'assertions-compile.engine-absent'
  | 'assertions-compile.source-absent'
  // assertions-pass
  | 'assertions-pass.ok' | 'assertions-pass.none' | 'assertions-pass.evaluates-false'
  | 'assertions-pass.evaluation-error' | 'assertions-pass.engine-absent'
  | 'assertions-pass.input-absent'
  // decider-resolvable
  | 'decider-resolvable.ok' | 'decider-resolvable.none-declared'
  | 'decider-resolvable.zero-match' | 'decider-resolvable.ambiguous-match'
  | 'decider-resolvable.directory-absent'
  // expiry-sane
  | 'expiry-sane.ok' | 'expiry-sane.past-or-equal'
  // shared not-evaluated
  | 'not-evaluated.schema-invalid' | 'not-evaluated.prereq-failed'
  // routing evidence + targets (operational, not rubric rules)
  | 'route.escalate.one-way-door' | 'route.escalate.cost-threshold' | 'route.escalate.security-surface'
  | 'route.escalate.data-residency' | 'route.escalate.regulatory' | 'route.escalate.contradicts-accepted-adr'
  | 'route.escalate.agent-authored-production' | 'route.escalate.human-requested'
  | 'route.evidence.one-way-door.not-proven'
  | 'route.evidence.cost-threshold.not-proven'
  | 'route.evidence.security-surface.not-proven'
  | 'route.evidence.data-residency.not-proven'
  | 'route.evidence.regulatory.not-proven'
  | 'route.evidence.contradicts-accepted-adr.not-proven'
  | 'route.evidence.agent-authored-production.not-proven'
  | 'route.evidence.human-requested.not-proven'
  | 'route.target.not-required' | 'route.target.deciders' | 'route.target.codeowners'
  | 'route.target.catalog-owner' | 'route.target.unresolved';
```

`affects-overlap` primary reason precedence is:

1. `accepted-intersection` for any failure;
2. `no-accepted-corpus` when there are no accepted ADRs;
3. the applicable inert reason when accepted pairs cannot all be evaluated; and
4. `none` only when accepted ADRs exist and the fully evaluated pairs have no intersection.

Thus `none` states an evaluated fact and `no-accepted-corpus` states that no pair existed.

---

## 12. Entity relationships (summary)

```text
Pass0Input
├── corpus: LintCorpusResult ───────────────┐ (reused core)
│      └── proposalPath ──► ProposalResolution
│                              ├── schemaFindings ──► RuleResult(schema-valid)
│                              └── proposed?: Adr ──► the other 10 rules (only if schema-valid passed)
├── federatedLogs? ─────────────────────────► no-orphan-refs cross-log resolution
├── resolutionLog? + targets + targetRegistry
│                                  └────────► CanonicalTargetId sets ─► affects-resolvable / affects-overlap / routing target sets
├── assertionInputs + assertionEngines ─────► assertions-compile / assertions-pass / accepted-assertion checks
├── identity? ──────────────────────────────► decider-resolvable / routing named-human target
├── scopeEvidence? ─────────────────────────► scope-hierarchy
├── routingEvidence? ───────────────────────► RoutingDecision triggers
└── evaluationDate ──────────────────────────► expiry-sane (strict future; no clock)

evaluatePass0(input) ► Pass0Evaluation
                        ├── evaluated: Pass0Result { report: 11 RuleResults + RoutingDecision, patch }
                        └── input-error: candidate-status-not-proposal (no report/patch)
                            The evaluator writes nothing (Principle I/IV; FR-014).
```
