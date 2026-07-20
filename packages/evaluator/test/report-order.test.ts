import { describe, expect, test } from 'bun:test';
import expectedOrphan from './fixtures/report-order/expected.json' with { type: 'json' };
import { RULE_IDS, canonicalize, evaluatePass0 } from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US2 / T024 — total ordering. The eleven results appear in fixed rubric order first;
 * within a rule, findings sort by the stable secondary keys (candidate AdrRef, related
 * AdrRef, matcher/assertion key, canonical target key, recordPath, field, message).
 * Lower-level evidence is preserved, `adr` never contains a path, and routing follows
 * the eleven rules in a separate section (not a twelfth rule).
 */

function orphanScenario() {
  const proposal = record(
    { id: '0002', relatesTo: ['9999', '7777', '8888'], supersedes: ['6666'] },
    { path: 'docs/adr/0002-a.md' },
  );
  return baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0002-a.md' });
}

describe('report ordering', () => {
  test('results appear in fixed rubric order', () => {
    const report = evaluateReport(orphanScenario());
    expect(report.results.map((r) => r.rule)).toEqual([...RULE_IDS]);
  });

  test('no-orphan-refs findings match the committed ordered snapshot', () => {
    const report = evaluateReport(orphanScenario());
    const orphan = ruleResult(report, 'no-orphan-refs');
    expect(canonicalize(orphan)).toEqual(canonicalize(expectedOrphan));
    // ordered by related AdrRef: supersedes 6666, then relatesTo 7777/8888/9999
    expect(orphan.findings.map((f) => f.relatedAdr)).toEqual(['6666', '7777', '8888', '9999']);
  });

  test('adr is strictly an AdrRef; the path lives only on report-only fields', () => {
    const report = evaluateReport(orphanScenario());
    for (const finding of ruleResult(report, 'no-orphan-refs').findings) {
      expect(finding.adr).toBe('0002');
      // a path is never projected into adr
      expect(finding.adr).not.toContain('/');
      expect(finding.recordPath).toBe('docs/adr/0002-a.md');
      expect(finding.lowerLevel?.path).toBe('docs/adr/0002-a.md');
    }
  });

  test('routing is a separate section after the eleven rules, not a twelfth result', () => {
    const outcome = evaluatePass0(orphanScenario());
    if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
    expect(outcome.result.report.results).toHaveLength(11);
    expect(outcome.result.report.results.some((r) => (r.rule as string).startsWith('route'))).toBe(false);
    expect(outcome.result.report.routing).toBeDefined();
  });
});
