/**
 * @adrkit/evaluator — deterministic finding aggregation (T026, C11).
 *
 * A rule may make several observations but yields exactly one aggregate `RuleResult`.
 * Status precedence is `fail > inert > pass`; `not-evaluated` is set only by the
 * orchestrator (schema-invalid or `assertions-pass` after a compile failure). The
 * aggregate `reason` is the first code, in the rule's fixed catalog precedence, among
 * the winning-status sub-findings — so mixed fail/inert fixtures are byte-stable
 * rather than discovery-order dependent. All sub-findings are retained and sorted by
 * the stable secondary comparator.
 */

import type { Severity } from '@adrkit/core';
import { RULE_REASON_PRECEDENCE, RULE_SEVERITY, type ReasonCode, type RuleId } from '../catalog.ts';
import type { RuleEvidence, RuleFinding, RuleResult } from '../types.ts';
import { sortRuleFindings } from './order.ts';

/** One underlying observation a rule makes; aggregated into a single RuleResult. */
export interface SubResult {
  readonly status: 'pass' | 'fail' | 'inert';
  readonly reason: ReasonCode;
  readonly finding?: RuleFinding;
}

const STATUS_RANK: Record<'pass' | 'fail' | 'inert', number> = { fail: 3, inert: 2, pass: 1 };

function winningStatus(subs: readonly SubResult[]): 'pass' | 'fail' | 'inert' {
  let winner: 'pass' | 'fail' | 'inert' = 'pass';
  for (const sub of subs) {
    if (STATUS_RANK[sub.status] > STATUS_RANK[winner]) winner = sub.status;
  }
  return winner;
}

function primaryReason(rule: RuleId, winners: readonly SubResult[]): ReasonCode {
  const present = new Set<ReasonCode>(winners.map((sub) => sub.reason));
  for (const code of RULE_REASON_PRECEDENCE[rule]) {
    if (present.has(code)) return code;
  }
  return RULE_REASON_PRECEDENCE[rule][0] as ReasonCode;
}

/** Aggregate one rule's sub-results into its single RuleResult (findings sorted). */
export function aggregate(rule: RuleId, subs: readonly SubResult[], evidence?: RuleEvidence): RuleResult {
  const status: 'pass' | 'fail' | 'inert' = subs.length === 0 ? 'pass' : winningStatus(subs);
  const winners = subs.filter((sub) => sub.status === status);
  const reason =
    winners.length === 0 ? (RULE_REASON_PRECEDENCE[rule][0] as ReasonCode) : primaryReason(rule, winners);
  const findings = sortRuleFindings(subs.flatMap((sub) => (sub.finding ? [sub.finding] : [])));
  const severity: Severity | undefined = status === 'fail' ? RULE_SEVERITY[rule] : undefined;
  return {
    rule,
    status,
    ...(severity ? { severity } : {}),
    reason,
    findings,
    ...(evidence ? { evidence } : {}),
  };
}
