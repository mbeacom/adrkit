import { describe, expect, test } from 'bun:test';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US1 / T015 — no-orphan-refs (error). Local `supersedes`/`relatesTo` targets must
 * exist. A federated ref resolves against a supplied federated-log snapshot; a
 * federated ref with NO snapshot is inert (`federated-log-absent`), not an orphan
 * failure (C2). `supersededBy` is not handled here (owned by supersession-consistent).
 */

describe('no-orphan-refs', () => {
  test('resolves local refs → pass', () => {
    const proposal = record({ id: '0002', relatesTo: ['0001'] }, { path: 'docs/adr/0002-a.md' });
    const target = record({ id: '0001', status: 'accepted', deciders: ['@a'] }, { path: 'docs/adr/0001-b.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal, target]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    expect(ruleResult(report, 'no-orphan-refs')).toMatchObject({ status: 'pass', reason: 'no-orphan-refs.ok' });
  });

  test('a dangling supersedes fails with dangling-supersedes', () => {
    const proposal = record({ id: '0002', supersedes: ['9999'] }, { path: 'docs/adr/0002-a.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    const result = ruleResult(report, 'no-orphan-refs');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('error');
    expect(result.reason).toBe('no-orphan-refs.dangling-supersedes');
  });

  test('a dangling relatesTo fails with dangling-relates-to', () => {
    const proposal = record({ id: '0002', relatesTo: ['9999'] }, { path: 'docs/adr/0002-a.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    expect(ruleResult(report, 'no-orphan-refs').reason).toBe('no-orphan-refs.dangling-relates-to');
  });

  test('a federated ref resolves against a supplied federated-log snapshot → pass', () => {
    const proposal = record({ id: '0002', relatesTo: ['payments:0012'] }, { path: 'docs/adr/0002-a.md' });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: 'docs/adr/0002-a.md',
        federatedLogs: [{ log: 'payments', adrIds: ['0012'] }],
      }),
    );
    expect(ruleResult(report, 'no-orphan-refs').status).toBe('pass');
  });

  test('a federated ref with a snapshot that lacks the id fails as dangling', () => {
    const proposal = record({ id: '0002', relatesTo: ['payments:0099'] }, { path: 'docs/adr/0002-a.md' });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: 'docs/adr/0002-a.md',
        federatedLogs: [{ log: 'payments', adrIds: ['0012'] }],
      }),
    );
    expect(ruleResult(report, 'no-orphan-refs').reason).toBe('no-orphan-refs.dangling-relates-to');
  });

  test('a federated ref with NO snapshot is inert (federated-log-absent), not an orphan', () => {
    const proposal = record({ id: '0002', supersedes: ['payments:0012'] }, { path: 'docs/adr/0002-a.md' });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0002-a.md' }),
    );
    const result = ruleResult(report, 'no-orphan-refs');
    expect(result.status).toBe('inert');
    expect(result.reason).toBe('no-orphan-refs.federated-log-absent');
    expect(report.outcome).toBe('ok');
  });
});
