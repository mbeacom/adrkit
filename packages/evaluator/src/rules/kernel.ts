/**
 * @adrkit/evaluator — rule kernel (result builders).
 *
 * Re-exports the canonical aggregation (`report/aggregate.ts`) and provides the small
 * result builders rules use for clean pass / inert / not-evaluated outcomes. Keeping a
 * single `aggregate` implementation avoids drift between rules and report assembly.
 */

import { RULE_REASON_PRECEDENCE, type ReasonCode, type RuleId } from '../catalog.ts';
import type { RuleFinding, RuleResult } from '../types.ts';

export { aggregate, type SubResult } from '../report/aggregate.ts';

/** A clean pass with no sub-findings, using the rule's `.ok` reason by default. */
export function passResult(
  rule: RuleId,
  reason: ReasonCode = RULE_REASON_PRECEDENCE[rule][0] as ReasonCode,
): RuleResult {
  return { rule, status: 'pass', reason, findings: [] };
}

/** An inert (degraded) result — backing absent, never a violation. */
export function inertResult(rule: RuleId, reason: ReasonCode, finding?: RuleFinding): RuleResult {
  return { rule, status: 'inert', reason, findings: finding ? [finding] : [] };
}

/** A not-evaluated result (schema-invalid short-circuit or prereq-failed only). */
export function notEvaluated(
  rule: RuleId,
  reason: 'not-evaluated.schema-invalid' | 'not-evaluated.prereq-failed',
): RuleResult {
  return { rule, status: 'not-evaluated', reason, findings: [] };
}
