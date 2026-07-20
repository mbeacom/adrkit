/**
 * @adrkit/evaluator — rule 11: expiry-sane (info).
 *
 * `reviewBy` is compared to the caller-supplied `evaluationDate` — NO clock is read.
 * Absent `reviewBy`, or one strictly after the evaluation date, passes; a `reviewBy`
 * on or before the evaluation date is `info` (`past-or-equal`). Both are ISO `YYYY-MM-DD`
 * strings, which compare correctly lexicographically.
 */

import { aggregate, passResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import type { RuleResult } from '../types.ts';

export function evaluateExpirySane(ctx: RuleContext): RuleResult {
  const reviewBy = ctx.proposed.frontmatter.reviewBy;
  if (reviewBy === undefined) return passResult('expiry-sane');
  if (reviewBy > ctx.evaluationDate) return passResult('expiry-sane');
  return aggregate('expiry-sane', [
    {
      status: 'fail',
      reason: 'expiry-sane.past-or-equal',
      finding: {
        reason: 'expiry-sane.past-or-equal',
        candidateAdr: ctx.proposed.frontmatter.id,
        field: 'reviewBy',
        message: `reviewBy "${reviewBy}" is on or before the evaluation date "${ctx.evaluationDate}"`,
      },
    },
  ]);
}
