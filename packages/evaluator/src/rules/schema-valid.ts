/**
 * @adrkit/evaluator — rule 1: schema-valid (error).
 *
 * Reads only the parse/contract findings on `proposalPath` (data-model §3). Any such
 * finding => fail (error); the orchestrator then emits ten `not-evaluated` results
 * (C11). Lower-level rule/path/id/field/pattern evidence is preserved in report-only
 * `RuleFinding` fields; `RuleFinding.adr` stays strictly an AdrRef and never holds a
 * filesystem path (T017).
 */

import type { Finding } from '@adrkit/core';
import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { ProposalResolution, ReasonCode, RuleFinding, RuleResult } from '../types.ts';

const PARSE_RULES: ReadonlySet<string> = new Set(['frontmatter-parse', 'frontmatter-fence']);

function reasonForFinding(finding: Finding): ReasonCode {
  if (finding.rule === 'file-read') return 'schema-valid.file-read';
  if (PARSE_RULES.has(finding.rule)) return 'schema-valid.parse-error';
  return 'schema-valid.contract-error';
}

function toRuleFinding(finding: Finding): RuleFinding {
  return {
    reason: reasonForFinding(finding),
    ...(finding.message ? { message: finding.message } : {}),
    ...(finding.path ? { recordPath: finding.path } : {}),
    ...(finding.field ? { field: finding.field } : {}),
    lowerLevel: {
      rule: finding.rule,
      ...(finding.path ? { path: finding.path } : {}),
      ...(finding.id ? { id: finding.id } : {}),
      ...(finding.field ? { field: finding.field } : {}),
      ...(finding.pattern ? { pattern: finding.pattern } : {}),
    },
  };
}

export function evaluateSchemaValid(resolution: ProposalResolution): RuleResult {
  const findings = resolution.schemaFindings;
  if (findings.length === 0) {
    return passResult('schema-valid');
  }
  const subs: SubResult[] = findings.map((finding) => {
    const ruleFinding = toRuleFinding(finding);
    return { status: 'fail', reason: ruleFinding.reason, finding: ruleFinding };
  });
  return aggregate('schema-valid', subs);
}
