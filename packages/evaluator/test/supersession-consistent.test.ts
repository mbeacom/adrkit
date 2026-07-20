import { describe, expect, test } from 'bun:test';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US1 / T014 — supersession-consistent (error). Reciprocity + acyclicity over the
 * corpus snapshot (research §R3). `dangling-supersededBy` is owned here and not
 * duplicated as an orphan finding.
 */

describe('supersession-consistent', () => {
  test('reciprocal + acyclic supersession passes', () => {
    const proposal = record({ id: '0002', supersedes: ['0001'] }, { path: 'docs/adr/0002-a.md' });
    const superseded = record(
      { id: '0001', status: 'superseded', supersededBy: '0002' },
      { path: 'docs/adr/0001-b.md' },
    );
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, superseded]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    expect(ruleResult(report, 'supersession-consistent')).toMatchObject({
      status: 'pass',
      reason: 'supersession-consistent.ok',
    });
  });

  test('a non-reciprocal supersedes edge fails', () => {
    const proposal = record({ id: '0002', supersedes: ['0001'] }, { path: 'docs/adr/0002-a.md' });
    // 0001 is accepted and does NOT declare supersededBy back
    const target = record({ id: '0001', status: 'accepted', deciders: ['@a'] }, { path: 'docs/adr/0001-b.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, target]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    const result = ruleResult(report, 'supersession-consistent');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('error');
    expect(result.reason).toBe('supersession-consistent.non-reciprocal');
  });

  test('a supersession cycle fails with the cycle reason', () => {
    const a = record(
      { id: '0001', status: 'superseded', supersededBy: '0002', supersedes: ['0002'] },
      { path: 'docs/adr/0001-a.md' },
    );
    const b = record(
      { id: '0002', status: 'superseded', supersededBy: '0001', supersedes: ['0001'] },
      { path: 'docs/adr/0002-b.md' },
    );
    const proposal = record({ id: '0003' }, { path: 'docs/adr/0003-c.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([a, b, proposal]), proposalPath: 'docs/adr/0003-c.md' }),
    );
    const result = ruleResult(report, 'supersession-consistent');
    expect(result.status).toBe('fail');
    expect(result.reason).toBe('supersession-consistent.cycle');
  });

  test('a dangling supersededBy is owned here (not by no-orphan-refs)', () => {
    const dangling = record(
      { id: '0001', status: 'superseded', supersededBy: '9999' },
      { path: 'docs/adr/0001-a.md' },
    );
    const proposal = record({ id: '0003' }, { path: 'docs/adr/0003-c.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([dangling, proposal]), proposalPath: 'docs/adr/0003-c.md' }),
    );
    expect(ruleResult(report, 'supersession-consistent').reason).toBe(
      'supersession-consistent.dangling-superseded-by',
    );
    // no-orphan-refs must NOT re-report the dangling supersededBy
    const orphan = ruleResult(report, 'no-orphan-refs');
    expect(orphan.findings.some((f) => f.reason === 'supersession-consistent.dangling-superseded-by')).toBe(false);
    expect(orphan.status).not.toBe('fail');
  });
});
