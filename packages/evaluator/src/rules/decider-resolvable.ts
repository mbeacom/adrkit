/**
 * @adrkit/evaluator — rule 10: decider-resolvable (warn).
 *
 * Every declared proposal decider must resolve through the immutable identity
 * directory to exactly one active principal (R9). None declared, a zero match, or an
 * ambiguous match is a warn; an absent directory is inert. Exactly one aggregate result.
 */

import { aggregate, inertResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import { buildIdentityIndex } from '../identity/directory.ts';
import type { RuleResult } from '../types.ts';

export function evaluateDeciderResolvable(ctx: RuleContext): RuleResult {
  const directory = ctx.input.identity;
  if (!directory) {
    return inertResult('decider-resolvable', 'decider-resolvable.directory-absent');
  }

  const deciders = ctx.proposed.frontmatter.deciders;
  if (deciders.length === 0) {
    return aggregate('decider-resolvable', [
      {
        status: 'fail',
        reason: 'decider-resolvable.none-declared',
        finding: {
          reason: 'decider-resolvable.none-declared',
          candidateAdr: ctx.proposed.frontmatter.id,
          field: 'deciders',
          message: 'No deciders are declared on the proposal',
        },
      },
    ]);
  }

  const index = buildIdentityIndex(directory);
  const subs: SubResult[] = deciders.map((decider) => {
    const resolution = index.resolveToActiveHuman(decider);
    if (resolution.status === 'resolved') {
      return { status: 'pass', reason: 'decider-resolvable.ok' };
    }
    const reason = resolution.status === 'ambiguous' ? 'decider-resolvable.ambiguous-match' : 'decider-resolvable.zero-match';
    return {
      status: 'fail',
      reason,
      finding: {
        reason,
        candidateAdr: ctx.proposed.frontmatter.id,
        field: 'deciders',
        message: `Decider "${decider}" ${resolution.status === 'ambiguous' ? 'resolves ambiguously' : 'does not resolve to one active principal'}`,
      },
    };
  });
  return aggregate('decider-resolvable', subs);
}
