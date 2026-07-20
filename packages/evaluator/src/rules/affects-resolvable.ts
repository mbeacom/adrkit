/**
 * @adrkit/evaluator — rule 5: affects-resolvable (warn).
 *
 * Validates EACH proposal matcher independently, not only the union (finding #2): a
 * matcher that resolves to real targets cannot mask another positive matcher with
 * present backing that resolves to ZERO. ADR-0009 semantics are preserved — negation
 * subtracts, and a different-repo qualifier contributes no local match. Per positive
 * matcher: ≥1 resolved id ⇒ pass; present backing + zero ids ⇒ warn (`zero-targets`);
 * a missing inventory (`backing-absent`) or resolver (`resolver-absent`) ⇒ inert. A
 * negation-only record resolves to the empty set ⇒ warn. No affects ⇒ trivially pass.
 */

import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import { resolveRecordTargets } from '../targets/canonical.ts';
import type { MatcherResolution } from '../targets/canonical.ts';
import type { RuleFinding, RuleResult } from '../types.ts';

function matcherFinding(ctx: RuleContext, matcher: MatcherResolution, reason: RuleFinding['reason'], message: string): RuleFinding {
  return {
    reason,
    candidateAdr: ctx.proposed.frontmatter.id,
    matcherKey: `${matcher.type}:${matcher.pattern}`,
    recordPath: ctx.proposed.path,
    field: `affects.${matcher.type}`,
    message,
  };
}

export function evaluateAffectsResolvable(ctx: RuleContext): RuleResult {
  const resolution = resolveRecordTargets(ctx.proposed, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
  if (!resolution.hasMatchers) return passResult('affects-resolvable');

  const subs: SubResult[] = [];

  for (const matcher of resolution.matchers) {
    if (matcher.status === 'inert-resolver') {
      subs.push({
        status: 'inert',
        reason: 'affects-resolvable.resolver-absent',
        finding: matcherFinding(ctx, matcher, 'affects-resolvable.resolver-absent', `No resolver registered for "${matcher.type}" matcher "${matcher.pattern}"`),
      });
      continue;
    }
    if (matcher.status === 'inert-backing') {
      subs.push({
        status: 'inert',
        reason: 'affects-resolvable.backing-absent',
        finding: matcherFinding(ctx, matcher, 'affects-resolvable.backing-absent', `No inventory backing for "${matcher.type}" matcher "${matcher.pattern}"`),
      });
      continue;
    }
    // resolved (including a different-repo matcher, which resolves empty locally)
    if (matcher.negate) continue; // negations only subtract; they are not a zero-target warn
    if (matcher.ids.length >= 1) {
      subs.push({ status: 'pass', reason: 'affects-resolvable.ok' });
    } else {
      subs.push({
        status: 'fail',
        reason: 'affects-resolvable.zero-targets',
        finding: matcherFinding(ctx, matcher, 'affects-resolvable.zero-targets', `"${matcher.type}" matcher "${matcher.pattern}" resolves to zero targets against the supplied inventory`),
      });
    }
  }

  // A record with matchers but NO positive matcher (negation-only) resolves to empty.
  if (!resolution.hasPositiveMatcher) {
    subs.push({
      status: 'fail',
      reason: 'affects-resolvable.zero-targets',
      finding: {
        reason: 'affects-resolvable.zero-targets',
        candidateAdr: ctx.proposed.frontmatter.id,
        recordPath: ctx.proposed.path,
        field: 'affects',
        message: 'negation-only affects resolves to zero targets',
      },
    });
  }

  if (subs.length === 0) return passResult('affects-resolvable');
  return aggregate('affects-resolvable', subs, { resolvedTargets: resolution.targets });
}
