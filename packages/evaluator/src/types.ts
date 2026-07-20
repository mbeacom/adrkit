/**
 * @adrkit/evaluator — immutable Pass 0 contract types.
 *
 * All input shapes are deeply `readonly`; the pure evaluator mutates none of them
 * (FR-006). Types marked "(runtime only)" exist only here and are never persisted or
 * added to the committed schema (Principle V; C6). Where a contract shape already
 * exists in `@adrkit/core` it is reused, never redefined (data-model §1).
 */

import type {
  Adr,
  AdrRef,
  AffectsMatcher,
  AffectsType,
  Assertion,
  DeterministicFinding,
  EscalationReason,
  Finding,
  LintCorpusResult,
  Severity,
} from '@adrkit/core';
import type { Pass0EscalationReason, ReasonCode, RuleId } from './catalog.ts';

export type { Pass0EscalationReason, ReasonCode, RuleId };

// Re-export the reused core contract types so evaluator modules and ports can import
// them from a single place without redefining shapes (data-model §1).
export type {
  Adr,
  AdrRef,
  AffectsMatcher,
  AffectsType,
  Assertion,
  DeterministicFinding,
  EscalationReason,
  Finding,
  LintCorpusResult,
  Severity,
};

/* ------------------------------------------------------------------ *
 * JSON + scalars
 * ------------------------------------------------------------------ */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Strict `YYYY-MM-DD`; validated by the CLI boundary before entry. */
export type IsoDate = string;

/**
 * Compact standard `JSON.stringify([record.log ?? "", record.path, assertion.id])`.
 * Record path (not ADR id) prevents aliasing when `id-unique` fails but evaluation
 * continues. The CLI rejects keys not byte-equal to this canonical form.
 */
export type AssertionKey = string;

/** Stable `${kind}:${id}` serialization used for equality/intersection. */
export type CanonicalTargetKey = string;

/* ------------------------------------------------------------------ *
 * Target resolution model (§4)
 * ------------------------------------------------------------------ */

export interface CanonicalTargetId {
  readonly kind: AffectsType;
  readonly id: string;
}

export interface DependencyEntry {
  readonly name: string;
  readonly version?: string;
}
export interface CatalogEntity {
  readonly id: string;
  readonly owner?: PrincipalRef;
}
export interface ResourceDescriptor {
  readonly id: string;
  readonly securitySurface?: boolean;
  readonly production?: boolean;
  readonly regulated?: boolean;
}
export interface ApiDescriptor {
  readonly id: string;
  readonly securitySurface?: boolean;
  readonly production?: boolean;
}
export interface DataDescriptor {
  readonly id: string;
  readonly residency?: string;
  readonly regulated?: boolean;
}

/** Immutable per-type inventories. A missing inventory ⇒ that type's matchers are inert (C3). */
export interface TargetInventorySnapshots {
  readonly trackedPaths?: readonly string[];
  readonly dependencies?: readonly DependencyEntry[];
  readonly entities?: readonly CatalogEntity[];
  readonly resources?: readonly ResourceDescriptor[];
  readonly apis?: readonly ApiDescriptor[];
  readonly data?: readonly DataDescriptor[];
}

export interface TargetResolutionContext {
  /** Caller-supplied ADR-0009 current repo/log identity; undefined is unnamed local context. */
  readonly log?: string;
  readonly inventory: TargetInventorySnapshots;
}

export interface TargetResolution {
  readonly status: 'resolved' | 'inert';
  readonly ids: readonly CanonicalTargetId[];
  readonly reason: ReasonCode;
}

/** A deterministic, pure resolver for one AffectsType. No I/O; never infers log context. */
export interface TargetResolverPort {
  readonly type: AffectsType;
  resolve(matcher: AffectsMatcher, context: TargetResolutionContext): TargetResolution;
}

/** Registry of resolver ports. Lookup miss ⇒ resolver-absent inert. */
export interface TargetResolutionRegistry {
  get(type: AffectsType): TargetResolverPort | undefined;
}

export interface FederatedLogSnapshot {
  readonly log: string;
  readonly adrIds: readonly string[];
  readonly sourceRef?: string;
}

/* ------------------------------------------------------------------ *
 * Assertion evaluation model (§5)
 * ------------------------------------------------------------------ */

export interface ResolvedAssertionSource {
  readonly fileContent?: string;
  readonly sourceRef?: string;
  readonly compiledArtifact?: RegoWasmPolicyEnvelopeV1;
}
export interface ResolvedAssertionInput {
  readonly document?: JsonValue;
}
export interface AssertionInputSnapshot {
  readonly sources: Readonly<Record<AssertionKey, ResolvedAssertionSource>>;
  readonly inputs: Readonly<Record<AssertionKey, ResolvedAssertionInput>>;
}

export interface RegoWasmPolicyEnvelopeV1 {
  readonly mediaType: 'application/vnd.adrkit.rego-wasm-policy.v1+json';
  readonly schemaVersion: 'adrkit.rego-wasm-policy/v1';
  readonly source: string;
  readonly sourceSha256: string;
  readonly moduleBase64: string;
  readonly moduleSha256: string;
  readonly data: JsonValue;
  readonly entrypoint: string;
  readonly abi: { readonly major: 1; readonly minor: 3 };
  readonly compiler: {
    readonly name: 'opa';
    readonly version: string;
    readonly capabilitiesProfile: 'adrkit.rego-wasm.capabilities/v1';
    readonly capabilitiesSha256: string;
  };
  readonly requiredHostBuiltins: readonly [];
  readonly envelopeSha256: string;
}

export type AssertionEngineName = 'rego' | 'jsonpath' | 'grep' | 'custom';

export interface CompiledAssertion<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  /** Deeply immutable by engine contract; only the owning port inspects this type. */
  readonly payload: Payload;
  readonly sourceRef?: string;
}

export type CompileOutcome<E extends AssertionEngineName, Payload> =
  | { readonly ok: true; readonly compiled: CompiledAssertion<E, Payload> }
  | { readonly ok: false; readonly reason: ReasonCode };

export type EvalOutcome =
  | { readonly ok: true; readonly pass: boolean }
  | { readonly ok: false; readonly reason: ReasonCode };

export interface SourceAssertionEnginePort<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  readonly profile: 'source';
  compile(effectiveSource: string, sourceRef?: string): CompileOutcome<E, Payload>;
  evaluate(compiled: CompiledAssertion<E, Payload>, input: JsonValue): EvalOutcome;
}
export interface CompiledArtifactEnginePort<E extends AssertionEngineName, Payload> {
  readonly engine: E;
  readonly profile: 'compiled-artifact';
  validateArtifact(artifact: RegoWasmPolicyEnvelopeV1): CompileOutcome<E, Payload>;
  evaluate(compiled: CompiledAssertion<E, Payload>, input: JsonValue): EvalOutcome;
}
export type AssertionEnginePort<E extends AssertionEngineName, Payload> =
  | SourceAssertionEnginePort<E, Payload>
  | CompiledArtifactEnginePort<E, Payload>;

export interface AssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> {
  readonly rego?: AssertionEnginePort<'rego', RegoPayload>;
  readonly jsonpath?: AssertionEnginePort<'jsonpath', JsonPathPayload>;
  readonly grep?: AssertionEnginePort<'grep', GrepPayload>;
  readonly custom?: AssertionEnginePort<'custom', CustomPayload>;
}

/** Engine-owned immutable payload for the restricted JSONPath source profile. */
export interface JsonPathCompiledPayload {
  readonly source: string;
  readonly ast: unknown;
}

export interface ScopeContradictionEvidence {
  readonly baseInputs?: Readonly<Record<AssertionKey, ResolvedAssertionInput>>;
}

/* ------------------------------------------------------------------ *
 * Identity / decider directory (§6)
 * ------------------------------------------------------------------ */

export type PrincipalRef = string;
export interface Principal {
  readonly id: PrincipalRef;
  readonly active: boolean;
  readonly kind: 'human' | 'team';
}
export interface Team {
  readonly id: PrincipalRef;
  readonly members: readonly PrincipalRef[];
}
export interface CodeownersRule {
  readonly pattern: string;
  readonly owners: readonly PrincipalRef[];
}
export interface IdentityDirectorySnapshot {
  readonly principals: readonly Principal[];
  readonly teams: readonly Team[];
  readonly codeowners?: readonly CodeownersRule[];
  readonly catalogOwners?: Readonly<Record<string, readonly PrincipalRef[]>>;
}

/* ------------------------------------------------------------------ *
 * Routing (§8)
 * ------------------------------------------------------------------ */

export interface RoutingTriggerEvidence {
  readonly costEvidence?: { readonly normalizedCost: number; readonly threshold: number };
  readonly dataResidency?: { readonly present: boolean };
  readonly humanRequested?: { readonly requester: PrincipalRef };
  readonly securitySurfaceTargets?: ReadonlySet<CanonicalTargetKey>;
  readonly regulatedTargets?: ReadonlySet<CanonicalTargetKey>;
  readonly productionTargets?: ReadonlySet<CanonicalTargetKey>;
}

export interface TriggerEvidenceStatus {
  readonly reason: Pass0EscalationReason;
  readonly status: 'proven' | 'not-proven';
  readonly code: ReasonCode;
}

export type RouteTarget =
  | { readonly kind: 'not-required'; readonly code: 'route.target.not-required' }
  | {
      readonly kind: 'resolved';
      readonly human: PrincipalRef;
      readonly via: 'deciders' | 'codeowners' | 'catalog';
      readonly code: ReasonCode;
    }
  | { readonly kind: 'unresolved'; readonly code: 'route.target.unresolved' };

export interface RoutingDecision {
  readonly escalate: boolean;
  readonly reasons: readonly Pass0EscalationReason[];
  readonly evidenceStatus: readonly TriggerEvidenceStatus[];
  readonly target: RouteTarget;
}

/* ------------------------------------------------------------------ *
 * Rule results & runtime report (§7)
 * ------------------------------------------------------------------ */

export type RuleStatus = 'pass' | 'fail' | 'inert' | 'not-evaluated';

export interface LowerLevelFindingEvidence {
  readonly rule: string;
  readonly path?: string;
  readonly id?: string;
  readonly field?: string;
  readonly pattern?: string;
}

export interface RuleFinding {
  readonly reason: ReasonCode;
  readonly message?: string;
  /** The ONLY identity field eligible for patch projection; MUST validate as core AdrRef. */
  readonly adr?: AdrRef;
  readonly candidateAdr?: AdrRef;
  readonly relatedAdr?: AdrRef;
  readonly matcherKey?: string;
  readonly assertionKey?: AssertionKey;
  readonly target?: CanonicalTargetId;
  readonly recordPath?: string;
  readonly field?: string;
  readonly sourceRef?: string;
  readonly lowerLevel?: LowerLevelFindingEvidence;
}

export interface RuleEvidence {
  readonly resolvedTargets?: readonly CanonicalTargetId[];
  readonly overlappingWith?: readonly string[];
  readonly assertionTransitions?: readonly string[];
}

export interface RuleResult {
  readonly rule: RuleId;
  readonly status: RuleStatus;
  readonly severity?: Severity;
  readonly reason: ReasonCode;
  readonly findings: readonly RuleFinding[];
  readonly evidence?: RuleEvidence;
}

export interface Pass0Report {
  readonly rubricVersion: string;
  readonly proposalPath: string;
  readonly results: readonly RuleResult[];
  readonly routing: RoutingDecision;
  readonly outcome: 'ok' | 'returned';
}

/* ------------------------------------------------------------------ *
 * Patch (§9) + envelope (§10)
 * ------------------------------------------------------------------ */

export interface EvaluationPatch {
  readonly deterministicFindings: readonly DeterministicFinding[];
  readonly escalate: boolean;
  readonly escalationReasons: readonly EscalationReason[];
}

export interface Pass0Result {
  readonly report: Pass0Report;
  readonly patch: EvaluationPatch;
}

export interface RunMetadata {
  readonly evaluatorVersion?: string;
  readonly ranAt?: string;
  readonly runId?: string;
}

/* ------------------------------------------------------------------ *
 * Proposal resolution & input contract (§3)
 * ------------------------------------------------------------------ */

export type ProposalStatus = 'draft' | 'proposed';

export interface ProposalResolution {
  readonly proposalPath: string;
  readonly schemaFindings: readonly Finding[];
  /** Present ONLY when schema-valid passed. When it fails, the other 10 rules are not-evaluated. */
  readonly proposed?: Adr;
}

export interface Pass0InputContractError {
  readonly code: 'candidate-status-not-proposal';
  readonly proposalPath: string;
  readonly actualStatus: 'accepted' | 'rejected' | 'superseded' | 'deprecated';
}

export type Pass0Evaluation =
  | { readonly kind: 'evaluated'; readonly result: Pass0Result }
  | { readonly kind: 'input-error'; readonly error: Pass0InputContractError };

/* ------------------------------------------------------------------ *
 * The evaluator input bundle (§2)
 * ------------------------------------------------------------------ */

export interface Pass0Input<RegoPayload = unknown, JsonPathPayload = unknown, GrepPayload = unknown, CustomPayload = unknown> {
  /** Full corpus lint result INCLUDING the candidate and malformed-file findings. */
  readonly corpus: LintCorpusResult;
  /** Identifies the proposal inside `corpus` (its `path`). */
  readonly proposalPath: string;
  readonly federatedLogs?: readonly FederatedLogSnapshot[];
  /** Current repo/log identity for ADR-0009 `repo` qualification — NOT a record source log. */
  readonly resolutionLog?: string;
  readonly targets: TargetInventorySnapshots;
  readonly targetRegistry: TargetResolutionRegistry;
  readonly assertionInputs: AssertionInputSnapshot;
  readonly assertionEngines: AssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload>;
  readonly identity?: IdentityDirectorySnapshot;
  readonly scopeEvidence?: ScopeContradictionEvidence;
  readonly routingEvidence?: RoutingTriggerEvidence;
  /** REQUIRED caller-supplied evaluation date (YYYY-MM-DD). expiry-sane uses this; NO clock read. */
  readonly evaluationDate: IsoDate;
}

/* ------------------------------------------------------------------ *
 * Versioned JSON wire bundle (§2.1) — data only, no ports/modules
 * ------------------------------------------------------------------ */

export type TargetInventorySnapshotsJson = TargetInventorySnapshots;
export type IdentityDirectorySnapshotJson = IdentityDirectorySnapshot;

export interface SnapshotBundleJsonV1 {
  readonly schemaVersion: 'adrkit.pass0.snapshot/v1';
  readonly federatedLogs?: readonly FederatedLogSnapshot[];
  /** Current repo/log identity for target resolution; omitted means unnamed local context. */
  readonly log?: string;
  readonly targets?: TargetInventorySnapshotsJson;
  readonly assertionInputs?: {
    readonly sources?: Readonly<
      Record<
        AssertionKey,
        {
          readonly fileContent?: string;
          readonly sourceRef?: string;
          readonly compiledArtifact?: RegoWasmPolicyEnvelopeV1;
        }
      >
    >;
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
