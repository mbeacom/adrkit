/**
 * @adrkit/evaluator — fixed Pass 0 catalog.
 *
 * The eleven rule ids (fixed rubric order + fixed severity), the exhaustive,
 * namespaced reason-code catalog, the per-rule primary-reason precedence, and the
 * eight ordered routing triggers. These are the frozen contract vocabulary
 * (data-model §7/§8/§11; research §R12). Adding or renaming a code is a versioned
 * contract change, never a silent edit.
 */

import type { Severity } from '@adrkit/core';

/** The eleven rubric rule ids, in fixed order (FR-002, C11). */
export const RULE_IDS = [
  'schema-valid',
  'id-unique',
  'supersession-consistent',
  'no-orphan-refs',
  'affects-resolvable',
  'affects-overlap',
  'scope-hierarchy',
  'assertions-compile',
  'assertions-pass',
  'decider-resolvable',
  'expiry-sane',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** Fixed severity per rule. Present on a result only when `status === 'fail'`. */
export const RULE_SEVERITY: Readonly<Record<RuleId, Severity>> = {
  'schema-valid': 'error',
  'id-unique': 'error',
  'supersession-consistent': 'error',
  'no-orphan-refs': 'error',
  'affects-resolvable': 'warn',
  'affects-overlap': 'warn',
  'scope-hierarchy': 'error',
  'assertions-compile': 'error',
  'assertions-pass': 'warn',
  'decider-resolvable': 'warn',
  'expiry-sane': 'info',
};

/** The eight Pass-0-provable escalation triggers, in fixed order (C4, R10). */
export const ROUTING_TRIGGERS = [
  'one-way-door',
  'cost-threshold',
  'security-surface',
  'data-residency',
  'regulatory',
  'contradicts-accepted-adr',
  'agent-authored-production',
  'human-requested',
] as const;

export type Pass0EscalationReason = (typeof ROUTING_TRIGGERS)[number];

/**
 * Exhaustive, stable, namespaced reason codes (data-model §11). The order within a
 * rule's group is that rule's primary-reason precedence: the aggregate `reason` is
 * the first code in this order among the sub-findings that share the winning status.
 */
export const REASON_CODES = [
  // schema-valid
  'schema-valid.ok',
  'schema-valid.file-read',
  'schema-valid.parse-error',
  'schema-valid.contract-error',
  // id-unique
  'id-unique.ok',
  'id-unique.collision',
  // supersession-consistent
  'supersession-consistent.ok',
  'supersession-consistent.dangling-superseded-by',
  'supersession-consistent.non-reciprocal',
  'supersession-consistent.cycle',
  // no-orphan-refs
  'no-orphan-refs.ok',
  'no-orphan-refs.dangling-supersedes',
  'no-orphan-refs.dangling-relates-to',
  'no-orphan-refs.federated-log-absent',
  // affects-resolvable
  'affects-resolvable.ok',
  'affects-resolvable.zero-targets',
  'affects-resolvable.backing-absent',
  'affects-resolvable.resolver-absent',
  // affects-overlap (special primary precedence, §3.1)
  'affects-overlap.accepted-intersection',
  'affects-overlap.no-accepted-corpus',
  'affects-overlap.backing-absent',
  'affects-overlap.none',
  // scope-hierarchy
  'scope-hierarchy.ok',
  'scope-hierarchy.contradicts-org-assertion',
  'scope-hierarchy.evidence-absent',
  'scope-hierarchy.engine-absent',
  'scope-hierarchy.source-absent',
  'scope-hierarchy.base-input-absent',
  'scope-hierarchy.proposed-input-absent',
  'scope-hierarchy.not-applicable-scope',
  // assertions-compile
  'assertions-compile.ok',
  'assertions-compile.none',
  'assertions-compile.no-source',
  'assertions-compile.ambiguous-source',
  'assertions-compile.parse-error',
  'assertions-compile.engine-absent',
  'assertions-compile.source-absent',
  // assertions-pass
  'assertions-pass.ok',
  'assertions-pass.none',
  'assertions-pass.evaluates-false',
  'assertions-pass.evaluation-error',
  'assertions-pass.engine-absent',
  'assertions-pass.input-absent',
  // decider-resolvable
  'decider-resolvable.ok',
  'decider-resolvable.none-declared',
  'decider-resolvable.zero-match',
  'decider-resolvable.ambiguous-match',
  'decider-resolvable.directory-absent',
  // expiry-sane
  'expiry-sane.ok',
  'expiry-sane.past-or-equal',
  // shared not-evaluated
  'not-evaluated.schema-invalid',
  'not-evaluated.prereq-failed',
  // routing evidence (escalate)
  'route.escalate.one-way-door',
  'route.escalate.cost-threshold',
  'route.escalate.security-surface',
  'route.escalate.data-residency',
  'route.escalate.regulatory',
  'route.escalate.contradicts-accepted-adr',
  'route.escalate.agent-authored-production',
  'route.escalate.human-requested',
  // routing evidence (not-proven)
  'route.evidence.one-way-door.not-proven',
  'route.evidence.cost-threshold.not-proven',
  'route.evidence.security-surface.not-proven',
  'route.evidence.data-residency.not-proven',
  'route.evidence.regulatory.not-proven',
  'route.evidence.contradicts-accepted-adr.not-proven',
  'route.evidence.agent-authored-production.not-proven',
  'route.evidence.human-requested.not-proven',
  // route targets
  'route.target.not-required',
  'route.target.deciders',
  'route.target.codeowners',
  'route.target.catalog-owner',
  'route.target.unresolved',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

const REASON_CODE_SET: ReadonlySet<string> = new Set(REASON_CODES);

export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}

/**
 * Per-rule primary-reason precedence, derived from the catalog groupings above.
 * The aggregate reason is the first entry present among the winning-status
 * sub-findings; a clean rule with no sub-findings uses its first (`.ok`) entry,
 * except `affects-overlap`, whose fixed precedence is documented in §3.1.
 */
export const RULE_REASON_PRECEDENCE: Readonly<Record<RuleId, readonly ReasonCode[]>> = {
  'schema-valid': [
    'schema-valid.ok',
    'schema-valid.file-read',
    'schema-valid.parse-error',
    'schema-valid.contract-error',
  ],
  'id-unique': ['id-unique.ok', 'id-unique.collision'],
  'supersession-consistent': [
    'supersession-consistent.ok',
    'supersession-consistent.dangling-superseded-by',
    'supersession-consistent.non-reciprocal',
    'supersession-consistent.cycle',
  ],
  'no-orphan-refs': [
    'no-orphan-refs.ok',
    'no-orphan-refs.dangling-supersedes',
    'no-orphan-refs.dangling-relates-to',
    'no-orphan-refs.federated-log-absent',
  ],
  'affects-resolvable': [
    'affects-resolvable.ok',
    'affects-resolvable.zero-targets',
    'affects-resolvable.backing-absent',
    'affects-resolvable.resolver-absent',
  ],
  'affects-overlap': [
    'affects-overlap.accepted-intersection',
    'affects-overlap.no-accepted-corpus',
    'affects-overlap.backing-absent',
    'affects-overlap.none',
  ],
  'scope-hierarchy': [
    'scope-hierarchy.ok',
    'scope-hierarchy.contradicts-org-assertion',
    'scope-hierarchy.evidence-absent',
    'scope-hierarchy.engine-absent',
    'scope-hierarchy.source-absent',
    'scope-hierarchy.base-input-absent',
    'scope-hierarchy.proposed-input-absent',
    'scope-hierarchy.not-applicable-scope',
  ],
  'assertions-compile': [
    'assertions-compile.ok',
    'assertions-compile.none',
    'assertions-compile.no-source',
    'assertions-compile.ambiguous-source',
    'assertions-compile.parse-error',
    'assertions-compile.engine-absent',
    'assertions-compile.source-absent',
  ],
  'assertions-pass': [
    'assertions-pass.ok',
    'assertions-pass.none',
    'assertions-pass.evaluates-false',
    'assertions-pass.evaluation-error',
    'assertions-pass.engine-absent',
    'assertions-pass.input-absent',
  ],
  'decider-resolvable': [
    'decider-resolvable.ok',
    'decider-resolvable.none-declared',
    'decider-resolvable.zero-match',
    'decider-resolvable.ambiguous-match',
    'decider-resolvable.directory-absent',
  ],
  'expiry-sane': ['expiry-sane.ok', 'expiry-sane.past-or-equal'],
};

/** Trigger → its proven escalate reason code. */
export const ROUTE_ESCALATE_CODE: Readonly<Record<Pass0EscalationReason, ReasonCode>> = {
  'one-way-door': 'route.escalate.one-way-door',
  'cost-threshold': 'route.escalate.cost-threshold',
  'security-surface': 'route.escalate.security-surface',
  'data-residency': 'route.escalate.data-residency',
  regulatory: 'route.escalate.regulatory',
  'contradicts-accepted-adr': 'route.escalate.contradicts-accepted-adr',
  'agent-authored-production': 'route.escalate.agent-authored-production',
  'human-requested': 'route.escalate.human-requested',
};

/** Trigger → its not-proven evidence reason code. */
export const ROUTE_EVIDENCE_NOT_PROVEN_CODE: Readonly<Record<Pass0EscalationReason, ReasonCode>> = {
  'one-way-door': 'route.evidence.one-way-door.not-proven',
  'cost-threshold': 'route.evidence.cost-threshold.not-proven',
  'security-surface': 'route.evidence.security-surface.not-proven',
  'data-residency': 'route.evidence.data-residency.not-proven',
  regulatory: 'route.evidence.regulatory.not-proven',
  'contradicts-accepted-adr': 'route.evidence.contradicts-accepted-adr.not-proven',
  'agent-authored-production': 'route.evidence.agent-authored-production.not-proven',
  'human-requested': 'route.evidence.human-requested.not-proven',
};

/** The rubric version recorded on `Pass0Report` (part of the deterministic payload). */
export const RUBRIC_VERSION = '0.1.0' as const;
