/**
 * @adrkit/evaluator — public surface.
 *
 * Exports the pure `evaluatePass0` entry point, the immutable contract types, the
 * fixed catalogs, the deterministic port interfaces, and the pure in-process port
 * factories the CLI composes at its impure boundary. It exports NO CLI, CI, adapter,
 * or executable snapshot-bundle loader (T011) — those impurities live in `@adrkit/cli`.
 */

export { evaluatePass0 } from './pass0.ts';

// Fixed catalogs (data-model §7/§8/§11).
export {
  RULE_IDS,
  RULE_SEVERITY,
  ROUTING_TRIGGERS,
  REASON_CODES,
  RULE_REASON_PRECEDENCE,
  ROUTE_ESCALATE_CODE,
  ROUTE_EVIDENCE_NOT_PROVEN_CODE,
  RUBRIC_VERSION,
  isReasonCode,
  type ReasonCode,
  type RuleId,
  type Pass0EscalationReason,
} from './catalog.ts';

// Canonical key helpers.
export {
  makeAssertionKey,
  assertionKeyForAssertion,
  isCanonicalAssertionKey,
  parseAssertionKey,
  canonicalTargetKey,
} from './keys.ts';

// Immutable contract types + deterministic port interfaces.
export type * from './types.ts';

// Pure composition helpers (deterministic; no I/O). The CLI builds registries from
// these — never from snapshot JSON.
export {
  createTargetResolutionRegistry,
  emptyTargetResolutionRegistry,
} from './targets/registry.ts';
export { createPathTargetResolver } from './targets/path.ts';
export { createPackageTargetResolver } from './targets/package.ts';
export {
  makeTargetId,
  normalizePathId,
  resolveRecordTargets,
  anyMatcherInert,
  type RecordTargetResolution,
  type MatcherResolution,
} from './targets/canonical.ts';
export {
  createAssertionEngineRegistry,
  emptyAssertionEngineRegistry,
  type AssertionEnginePorts,
} from './assertions/registry.ts';
export { createJsonPathEngine } from './assertions/jsonpath.ts';
export { validateRegoWasmPolicyEnvelopeV1, type EnvelopeValidation } from './assertions/rego.ts';
export { computeAssertionOutcomes, type AssertionOutcomes } from './assertions/evaluate.ts';
export {
  buildIdentityIndex,
  type IdentityIndex,
  type IdentityResolution,
} from './identity/directory.ts';

// Canonical serialization + ordering (deterministic bytes; R11).
export {
  canonicalize,
  canonicalStringify,
  canonicalBytes,
  serializeReport,
  serializePatch,
  serializeArtifacts,
  type CanonicalArtifacts,
} from './report/serialize.ts';
export { compareRuleFindings, sortRuleFindings } from './report/order.ts';
export { aggregate, type SubResult } from './report/aggregate.ts';
