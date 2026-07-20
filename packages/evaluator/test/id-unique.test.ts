import { describe, expect, test } from 'bun:test';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US1 / T013 — id-unique is scoped by `[record.log ?? "", id]`. Duplicate ids inside
 * one local or one named log fail; the same id in two different named logs passes.
 */

describe('id-unique', () => {
  test('passes when the proposal id is unique in its (local) log', () => {
    const proposal = record({ id: '0042' }, { path: 'docs/adr/0042-a.md' });
    const other = record({ id: '0043' }, { path: 'docs/adr/0043-b.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, other]), proposalPath: 'docs/adr/0042-a.md' }),
    );
    expect(ruleResult(report, 'id-unique')).toMatchObject({ status: 'pass', reason: 'id-unique.ok' });
  });

  test('fails on a duplicate id inside one local log', () => {
    const proposal = record({ id: '0042' }, { path: 'docs/adr/0042-a.md' });
    const clash = record({ id: '0042' }, { path: 'docs/adr/0042-b.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, clash]), proposalPath: 'docs/adr/0042-a.md' }),
    );
    const result = ruleResult(report, 'id-unique');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('error');
    expect(result.reason).toBe('id-unique.collision');
    expect(report.outcome).toBe('returned');
  });

  test('fails on a duplicate id inside one named log', () => {
    const proposal = record({ id: '0050' }, { path: 'p/0050-a.md', log: 'payments' });
    const clash = record({ id: '0050' }, { path: 'p/0050-b.md', log: 'payments' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, clash]), proposalPath: 'p/0050-a.md' }),
    );
    expect(ruleResult(report, 'id-unique').reason).toBe('id-unique.collision');
  });

  test('passes when the same id appears in two different named logs', () => {
    const proposal = record({ id: '0042' }, { path: 'a/0042.md', log: 'alpha' });
    const other = record({ id: '0042' }, { path: 'b/0042.md', log: 'beta' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, other]), proposalPath: 'a/0042.md' }),
    );
    expect(ruleResult(report, 'id-unique')).toMatchObject({ status: 'pass', reason: 'id-unique.ok' });
  });

  test('a federated-log id in a different log does not collide with a local candidate', () => {
    const proposal = record({ id: '0042' }, { path: 'docs/adr/0042-a.md' });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: 'docs/adr/0042-a.md',
        federatedLogs: [{ log: 'payments', adrIds: ['0042'] }],
      }),
    );
    expect(ruleResult(report, 'id-unique').status).toBe('pass');
  });
});
