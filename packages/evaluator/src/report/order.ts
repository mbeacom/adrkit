/**
 * @adrkit/evaluator — deterministic ordering (R11).
 *
 * Stable secondary comparators for `RuleFinding`s within a rule and for the patch's
 * `deterministicFindings`. Precedence (data-model §5/§7): candidate `AdrRef`, related
 * `AdrRef`, matcher/assertion key, canonical target key, `recordPath`, `field`,
 * `message`. `RuleFinding.adr` is strictly an `AdrRef`; a path never enters this order
 * as `adr`. The eleven rule results keep fixed rubric order and routing keeps trigger
 * order — those arrays are never sorted.
 */

import { RULE_IDS, type RuleId } from '../catalog.ts';
import { canonicalTargetKey } from '../keys.ts';
import { byCodeUnit } from '../compare.ts';
import type { CanonicalTargetId, RuleFinding } from '../types.ts';

function cmp(a: string | undefined, b: string | undefined): number {
  return byCodeUnit(a ?? '', b ?? '');
}

function targetKey(target: CanonicalTargetId | undefined): string {
  return target ? canonicalTargetKey(target) : '';
}

/** Stable secondary comparator for RuleFindings within a single rule. */
export function compareRuleFindings(a: RuleFinding, b: RuleFinding): number {
  return (
    cmp(a.candidateAdr, b.candidateAdr) ||
    cmp(a.relatedAdr, b.relatedAdr) ||
    cmp(a.matcherKey ?? a.assertionKey, b.matcherKey ?? b.assertionKey) ||
    cmp(targetKey(a.target), targetKey(b.target)) ||
    cmp(a.recordPath, b.recordPath) ||
    cmp(a.field, b.field) ||
    cmp(a.adr, b.adr) ||
    cmp(a.message, b.message)
  );
}

export function sortRuleFindings(findings: readonly RuleFinding[]): RuleFinding[] {
  return [...findings].sort(compareRuleFindings);
}

const RULE_INDEX: ReadonlyMap<RuleId, number> = new Map(RULE_IDS.map((rule, index) => [rule, index]));

/** Index of a rule in the fixed rubric order (for assembly). */
export function ruleIndex(rule: RuleId): number {
  return RULE_INDEX.get(rule) ?? RULE_IDS.length;
}

/** Comparator for a set-like array of canonical target ids (evidence). */
export function compareCanonicalTargetIds(a: CanonicalTargetId, b: CanonicalTargetId): number {
  return byCodeUnit(canonicalTargetKey(a), canonicalTargetKey(b));
}
