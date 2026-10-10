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

  // ADR-0059 clause 4: a log-qualified supersededBy stays the dangling failure, with or
  // without a snapshot of the named log, and its message says why.
  test('a log-qualified supersededBy fails as dangling, even with a snapshot of that log', () => {
    const superseded = record(
      { id: '0001', status: 'superseded', supersededBy: 'payments:0012' },
      { path: 'docs/adr/0001-a.md' },
    );
    const proposal = record({ id: '0003' }, { path: 'docs/adr/0003-c.md' });
    for (const federatedLogs of [undefined, [{ log: 'payments', adrIds: ['0012'] }]]) {
      const report = evaluateReport(
        baseInput({
          corpus: corpusOf([superseded, proposal]),
          proposalPath: 'docs/adr/0003-c.md',
          ...(federatedLogs ? { federatedLogs } : {}),
        }),
      );
      const result = ruleResult(report, 'supersession-consistent');
      expect(result.status).toBe('fail');
      expect(result.reason).toBe('supersession-consistent.dangling-superseded-by');
      expect(result.findings[0]?.message).toContain('ADR-0059 clause 4');
    }
  });

  // A ref qualified with the evaluator's own resolution log names a local record, so every
  // supersession check reads it by its bare id (no-orphan-refs already does).
  describe('refs qualified with the resolution log itself', () => {
    test('a same-log supersededBy resolves and reciprocates → pass', () => {
      const superseded = record(
        { id: '0001', status: 'superseded', supersededBy: 'here:0002' },
        { path: 'docs/adr/0001-a.md' },
      );
      const successor = record({ id: '0002', supersedes: ['0001'] }, { path: 'docs/adr/0002-b.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([superseded, successor]), proposalPath: 'docs/adr/0002-b.md', resolutionLog: 'here' }),
      );
      expect(ruleResult(report, 'supersession-consistent')).toMatchObject({
        status: 'pass',
        reason: 'supersession-consistent.ok',
      });
    });

    test('a same-log supersedes reciprocates a bare supersededBy → pass', () => {
      const superseded = record(
        { id: '0001', status: 'superseded', supersededBy: '0002' },
        { path: 'docs/adr/0001-a.md' },
      );
      const successor = record({ id: '0002', supersedes: ['here:0001'] }, { path: 'docs/adr/0002-b.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([superseded, successor]), proposalPath: 'docs/adr/0002-b.md', resolutionLog: 'here' }),
      );
      expect(ruleResult(report, 'supersession-consistent').status).toBe('pass');
      expect(ruleResult(report, 'no-orphan-refs').status).toBe('pass');
    });

    test('a same-log supersedes that is not reciprocated fails as non-reciprocal', () => {
      const target = record({ id: '0001', status: 'accepted', deciders: ['@a'] }, { path: 'docs/adr/0001-a.md' });
      const successor = record({ id: '0002', supersedes: ['here:0001'] }, { path: 'docs/adr/0002-b.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([target, successor]), proposalPath: 'docs/adr/0002-b.md', resolutionLog: 'here' }),
      );
      expect(ruleResult(report, 'supersession-consistent').reason).toBe('supersession-consistent.non-reciprocal');
    });

    test('a supersession cycle through same-log refs is detected', () => {
      const a = record(
        { id: '0001', status: 'superseded', supersededBy: 'here:0002', supersedes: ['here:0002'] },
        { path: 'docs/adr/0001-a.md' },
      );
      const b = record(
        { id: '0002', status: 'superseded', supersededBy: 'here:0001', supersedes: ['here:0001'] },
        { path: 'docs/adr/0002-b.md' },
      );
      const proposal = record({ id: '0003' }, { path: 'docs/adr/0003-c.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([a, b, proposal]), proposalPath: 'docs/adr/0003-c.md', resolutionLog: 'here' }),
      );
      const result = ruleResult(report, 'supersession-consistent');
      expect(result.status).toBe('fail');
      expect(result.findings.map((f) => f.reason)).toEqual(['supersession-consistent.cycle']);
    });

    test('a same-log supersededBy whose id is missing is dangling without the clause-4 wording', () => {
      const superseded = record(
        { id: '0001', status: 'superseded', supersededBy: 'here:0009' },
        { path: 'docs/adr/0001-a.md' },
      );
      const proposal = record({ id: '0003' }, { path: 'docs/adr/0003-c.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([superseded, proposal]), proposalPath: 'docs/adr/0003-c.md', resolutionLog: 'here' }),
      );
      const result = ruleResult(report, 'supersession-consistent');
      expect(result.reason).toBe('supersession-consistent.dangling-superseded-by');
      expect(result.findings[0]?.relatedAdr).toBe('here:0009');
      expect(result.findings[0]?.message).not.toContain('ADR-0059');
    });

    test('without a resolution log, a qualified supersededBy is another log and stays the clause-4 failure', () => {
      const superseded = record(
        { id: '0001', status: 'superseded', supersededBy: 'here:0002' },
        { path: 'docs/adr/0001-a.md' },
      );
      const successor = record({ id: '0002', supersedes: ['0001'] }, { path: 'docs/adr/0002-b.md' });
      const report = evaluateReport(
        baseInput({ corpus: corpusOf([superseded, successor]), proposalPath: 'docs/adr/0002-b.md' }),
      );
      const result = ruleResult(report, 'supersession-consistent');
      expect(result.status).toBe('fail');
      expect(result.findings.some((f) => f.message?.includes('ADR-0059 clause 4') === true)).toBe(true);
    });
  });
});
