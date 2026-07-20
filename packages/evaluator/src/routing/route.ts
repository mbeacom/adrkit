/**
 * @adrkit/evaluator — escalation routing (T046, R10/C4/C7).
 *
 * A declarative OR over the eight deterministically-proven Pass 0 triggers, computed
 * AFTER the eleven rule results (never a twelfth rule). Each trigger emits an ordered
 * proven/not-proven evidence status; missing optional evidence is "not-proven", never a
 * fabricated escalation. When escalation is proven, a single active human is resolved
 * (deciders -> CODEOWNERS -> catalog); otherwise the target is `not-required`.
 */

import {
  ROUTE_ESCALATE_CODE,
  ROUTE_EVIDENCE_NOT_PROVEN_CODE,
  ROUTING_TRIGGERS,
  type Pass0EscalationReason,
} from '../catalog.ts';
import { buildIdentityIndex } from '../identity/directory.ts';
import type { RuleContext } from '../rules/context.ts';
import type { RecordTargetResolution } from '../targets/canonical.ts';
import { resolveRouteTarget } from './target.ts';
import type { CanonicalTargetKey, RoutingDecision, TriggerEvidenceStatus } from '../types.ts';

/** All eight triggers as `not-proven`, in fixed order (used for schema-invalid reports). */
export function allNotProven(): readonly TriggerEvidenceStatus[] {
  return ROUTING_TRIGGERS.map(
    (reason: Pass0EscalationReason): TriggerEvidenceStatus => ({
      reason,
      status: 'not-proven',
      code: ROUTE_EVIDENCE_NOT_PROVEN_CODE[reason],
    }),
  );
}

/** The deterministic non-escalated routing decision (schema-invalid short-circuit). */
export function notRequiredRouting(): RoutingDecision {
  return {
    escalate: false,
    reasons: [],
    evidenceStatus: allNotProven(),
    target: { kind: 'not-required', code: 'route.target.not-required' },
  };
}

function intersects(a: ReadonlySet<CanonicalTargetKey>, b: ReadonlySet<CanonicalTargetKey> | undefined): boolean {
  if (!b || b.size === 0) return false;
  for (const key of a) if (b.has(key)) return true;
  return false;
}

/** Evaluate the eight triggers and resolve the target if escalation is proven. */
export function computeRouting(
  ctx: RuleContext,
  proposalTargets: RecordTargetResolution,
  contradictsAccepted: boolean,
): RoutingDecision {
  const evidence = ctx.input.routingEvidence;
  const proposalKeys = proposalTargets.targetKeys;
  const frontmatter = ctx.proposed.frontmatter;

  const proven: Record<Pass0EscalationReason, boolean> = {
    'one-way-door': frontmatter.reversibility === 'one-way-door',
    'cost-threshold':
      evidence?.costEvidence !== undefined && evidence.costEvidence.normalizedCost >= evidence.costEvidence.threshold,
    'security-surface': intersects(proposalKeys, evidence?.securitySurfaceTargets),
    'data-residency': evidence?.dataResidency?.present === true,
    regulatory: frontmatter.complianceControls.length > 0 || intersects(proposalKeys, evidence?.regulatedTargets),
    'contradicts-accepted-adr': contradictsAccepted,
    'agent-authored-production':
      (frontmatter.provenance?.authoredBy === 'agent' || frontmatter.provenance?.authoredBy === 'agent-drafted') &&
      intersects(proposalKeys, evidence?.productionTargets),
    'human-requested': evidence?.humanRequested?.requester !== undefined,
  };

  const evidenceStatus: TriggerEvidenceStatus[] = ROUTING_TRIGGERS.map((reason) =>
    proven[reason]
      ? { reason, status: 'proven', code: ROUTE_ESCALATE_CODE[reason] }
      : { reason, status: 'not-proven', code: ROUTE_EVIDENCE_NOT_PROVEN_CODE[reason] },
  );
  const reasons = ROUTING_TRIGGERS.filter((reason) => proven[reason]);
  const escalate = reasons.length > 0;

  if (!escalate) {
    return {
      escalate: false,
      reasons: [],
      evidenceStatus,
      target: { kind: 'not-required', code: 'route.target.not-required' },
    };
  }

  const directory = ctx.input.identity;
  if (!directory) {
    return { escalate: true, reasons, evidenceStatus, target: { kind: 'unresolved', code: 'route.target.unresolved' } };
  }
  const resolvedPaths = proposalTargets.targets.filter((id) => id.kind === 'path').map((id) => id.id);
  const resolvedEntities = proposalTargets.targets.filter((id) => id.kind === 'entity');
  const target = resolveRouteTarget(
    buildIdentityIndex(directory),
    frontmatter.deciders,
    directory,
    resolvedPaths,
    resolvedEntities,
  );
  return { escalate: true, reasons, evidenceStatus, target };
}
