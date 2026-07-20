/**
 * @adrkit/evaluator — accepted-ADR assertion routing evidence (T048, C4).
 *
 * The `contradicts-accepted-adr` trigger is proven when the proposal canonically
 * overlaps an accepted ADR (rule 6) AND an assertion on that overlapping accepted ADR
 * FAILS against the supplied proposed / current-HEAD input. Unlike `scope-hierarchy`,
 * this does NOT require org scope, domain applicability, or a base-green transition —
 * only the proposed-side failure. Pure; reuses the same engine registry.
 */

import { compileAssertionForScope } from '../assertions/evaluate.ts';
import { makeAssertionKey } from '../keys.ts';
import { resolveRecordTargets } from '../targets/canonical.ts';
import type { RuleContext } from '../rules/context.ts';
import type { CanonicalTargetKey } from '../types.ts';

export function contradictsAcceptedAdr(
  ctx: RuleContext,
  proposalTargetKeys: ReadonlySet<CanonicalTargetKey>,
): boolean {
  if (proposalTargetKeys.size === 0) return false;

  for (const accepted of ctx.acceptedRecords) {
    const acceptedTargets = resolveRecordTargets(accepted, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
    const overlaps = [...proposalTargetKeys].some((key) => acceptedTargets.targetKeys.has(key));
    if (!overlaps) continue;

    for (const assertion of accepted.frontmatter.assertions) {
      const key = makeAssertionKey(accepted.log, accepted.path, assertion.id);
      const compiled = compileAssertionForScope(ctx, accepted, assertion);
      if (!compiled.ok) continue;
      const proposedInput = ctx.input.assertionInputs.inputs[key]?.document;
      if (proposedInput === undefined) continue;
      const evaluated = compiled.evaluate(proposedInput);
      if (evaluated.ok && !evaluated.pass) return true;
    }
  }
  return false;
}
