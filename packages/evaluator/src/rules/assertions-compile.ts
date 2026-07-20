/**
 * @adrkit/evaluator — rule 8: assertions-compile (error).
 *
 * Each assertion declares exactly one source and the approved engine profile validates
 * it. Neither/both source ⇒ error; a failed source/artifact validation ⇒ error; a
 * missing engine, resolved file content, or compiled artifact ⇒ inert; no assertions ⇒
 * pass (`none`). Consumes the shared per-evaluation assertion outcomes so each assertion
 * is compiled/validated exactly once (R7). One aggregate result.
 */

import { aggregate, passResult } from './kernel.ts';
import type { AssertionOutcomes } from '../assertions/evaluate.ts';
import type { RuleResult } from '../types.ts';

export function evaluateAssertionsCompile(outcomes: AssertionOutcomes): RuleResult {
  if (!outcomes.hasAssertions) return passResult('assertions-compile', 'assertions-compile.none');
  return aggregate('assertions-compile', outcomes.compileSubs);
}
