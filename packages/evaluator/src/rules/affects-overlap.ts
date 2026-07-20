/**
 * @adrkit/evaluator — rule 6: affects-overlap (warn).
 *
 * Finite canonical-target-key intersection of the proposal with each ACCEPTED ADR,
 * computed once per (proposal, accepted-ADR) pair (R4). Primary precedence (§3.1):
 * any non-empty intersection ⇒ warn (`accepted-intersection`); otherwise no accepted
 * ADRs ⇒ pass (`no-accepted-corpus`); otherwise absent required pair backing ⇒ inert
 * (`backing-absent`); otherwise a fully evaluated accepted corpus with no intersection
 * ⇒ pass (`none`).
 */

import { aggregate, inertResult, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import { anyMatcherInert, resolveRecordTargets } from '../targets/canonical.ts';
import { byCodeUnit } from '../compare.ts';
import type { RuleResult } from '../types.ts';

export function evaluateAffectsOverlap(ctx: RuleContext): RuleResult {
  const accepted = ctx.acceptedRecords;
  if (accepted.length === 0) {
    return passResult('affects-overlap', 'affects-overlap.no-accepted-corpus');
  }

  const proposal = resolveRecordTargets(ctx.proposed, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
  let anyInert = anyMatcherInert(proposal);
  const subs: SubResult[] = [];
  const overlapping: string[] = [];

  for (const acc of accepted) {
    const accResolution = resolveRecordTargets(acc, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
    if (anyMatcherInert(accResolution)) anyInert = true;
    const intersects = [...proposal.targetKeys].some((key) => accResolution.targetKeys.has(key));
    if (intersects) {
      overlapping.push(acc.frontmatter.id);
      subs.push({
        status: 'fail',
        reason: 'affects-overlap.accepted-intersection',
        finding: {
          reason: 'affects-overlap.accepted-intersection',
          candidateAdr: ctx.proposed.frontmatter.id,
          relatedAdr: acc.frontmatter.id,
          message: `affects overlaps accepted ADR "${acc.frontmatter.id}"`,
        },
      });
    }
  }

  if (subs.length > 0) {
    return aggregate('affects-overlap', subs, { overlappingWith: [...overlapping].sort(byCodeUnit) });
  }
  if (anyInert) {
    return inertResult('affects-overlap', 'affects-overlap.backing-absent');
  }
  return passResult('affects-overlap', 'affects-overlap.none');
}
