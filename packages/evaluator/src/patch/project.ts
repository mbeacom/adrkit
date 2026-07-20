/**
 * @adrkit/evaluator — schema-compatible patch projection (§9, R8/R12, T052).
 *
 * Projects the eleven rule results down to the committed four-field
 * `DeterministicFinding` shape — VIOLATIONS ONLY (rule failures at their fixed
 * severity) — plus `escalate` and existing-enum `escalationReasons` in fixed trigger
 * order. It strips every operational-only field (reason codes, canonical target ids,
 * source refs, snapshot ids, candidate/related refs, recordPath, lower-level evidence):
 * that richness stays on `Pass0Report`. `adr` is copied only when it validates strictly
 * as a core `AdrRef`, so a filesystem path can never be reinterpreted as an ADR
 * reference. The evaluator RETURNS the patch; it never writes any record, review state,
 * database, or index.
 */

import { AdrRef, type DeterministicFinding } from '@adrkit/core';
import { RULE_SEVERITY } from '../catalog.ts';
import type { EvaluationPatch, Pass0Report, RuleFinding, RuleResult } from '../types.ts';

/** A rule result is a violation iff it failed at its fixed severity. */
export function isViolation(result: RuleResult): boolean {
  return result.status === 'fail';
}

function representativeFinding(result: RuleResult): RuleFinding | undefined {
  // Prefer the finding carrying the aggregate's primary (winning) reason; fall back to
  // the first sorted finding. Both are deterministic.
  return result.findings.find((finding) => finding.reason === result.reason) ?? result.findings[0];
}

/** Project one violating rule result into the committed DeterministicFinding shape. */
export function projectFinding(result: RuleResult): DeterministicFinding {
  const finding = representativeFinding(result);
  const adr = finding?.adr !== undefined && AdrRef.safeParse(finding.adr).success ? finding.adr : undefined;
  return {
    rule: result.rule,
    severity: RULE_SEVERITY[result.rule],
    ...(finding?.message ? { message: finding.message } : {}),
    ...(adr !== undefined ? { adr } : {}),
  };
}

export function projectPatch(report: Pass0Report): EvaluationPatch {
  // One DeterministicFinding per violating rule (rubric-id mapping, no duplicate
  // lower-level findings). Results are already in fixed rubric order.
  const deterministicFindings = report.results.filter(isViolation).map(projectFinding);
  return {
    deterministicFindings,
    escalate: report.routing.escalate,
    escalationReasons: report.routing.reasons, // already in fixed trigger order
  };
}
