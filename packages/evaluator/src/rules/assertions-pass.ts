/**
 * @adrkit/evaluator — rule 9: assertions-pass (warn).
 *
 * Evaluates each compiled assertion against its resolved input. A false result or a
 * deterministic engine evaluation error ⇒ warn; a missing engine/input ⇒ inert; no
 * assertions ⇒ pass (`none`). A compile FAILURE makes this whole rule
 * `not-evaluated.prereq-failed` — enforced by the orchestrator, which only calls this
 * rule when assertions-compile did not fail. Consumes the shared per-evaluation
 * outcomes (one compile per assertion). One aggregate result.
 */

import { aggregate, passResult } from './kernel.ts';
import type { AssertionOutcomes } from '../assertions/evaluate.ts';
import type { RuleResult } from '../types.ts';

export function evaluateAssertionsPass(outcomes: AssertionOutcomes): RuleResult {
  if (!outcomes.hasAssertions || outcomes.passSubs.length === 0) {
    return passResult('assertions-pass', 'assertions-pass.none');
  }
  return aggregate('assertions-pass', outcomes.passSubs);
}
