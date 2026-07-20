/**
 * @adrkit/evaluator — report assembly.
 *
 * Places the eleven RuleResults in fixed rubric order, appends the routing decision
 * (never a twelfth rule), and computes `outcome`. Secondary finding ordering and
 * canonical byte serialization are added in US2 (T027/T028).
 */

import { RULE_IDS, RUBRIC_VERSION, type RuleId } from '../catalog.ts';
import type { Pass0Report, RoutingDecision, RuleResult } from '../types.ts';

/** `returned` iff any rule failed at `error` severity; otherwise `ok`. */
export function computeOutcome(results: readonly RuleResult[]): 'ok' | 'returned' {
  const returned = results.some(
    (result) => result.status === 'fail' && result.severity === 'error',
  );
  return returned ? 'returned' : 'ok';
}

/**
 * Assemble the report from a rule→result map. Exactly eleven results are emitted in
 * fixed rubric order (C11); a missing rule is a programming error.
 */
export function assembleReport(
  proposalPath: string,
  resultsByRule: ReadonlyMap<RuleId, RuleResult>,
  routing: RoutingDecision,
): Pass0Report {
  const results: RuleResult[] = RULE_IDS.map((rule) => {
    const result = resultsByRule.get(rule);
    if (!result) {
      throw new Error(`internal: missing rule result for "${rule}"`);
    }
    return result;
  });
  return {
    rubricVersion: RUBRIC_VERSION,
    proposalPath,
    results,
    routing,
    outcome: computeOutcome(results),
  };
}
