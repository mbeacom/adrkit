import { describe, expect, test } from 'bun:test';
import type { IdentityDirectorySnapshot, Pass0Input } from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US3 / T033 — decider-resolvable (warn) + expiry-sane (info). Deciders resolve through
 * an immutable identity directory to exactly one active principal; none/zero/ambiguous
 * warn; an absent directory is inert. `expiry-sane` compares `reviewBy` to the explicit
 * `evaluationDate` with no clock read.
 */

const directory: IdentityDirectorySnapshot = {
  principals: [
    { id: '@alice', active: true, kind: 'human' },
    { id: '@bob', active: false, kind: 'human' },
    { id: '@carol', active: true, kind: 'human' },
    { id: 'team:solo', active: true, kind: 'team' },
    { id: 'team:many', active: true, kind: 'team' },
    { id: 'team:none', active: true, kind: 'team' },
  ],
  teams: [
    { id: 'team:solo', members: ['@alice', '@bob'] }, // exactly one active human
    { id: 'team:many', members: ['@alice', '@carol'] }, // two active humans
    { id: 'team:none', members: ['@bob'] }, // no active humans
  ],
};

function withIdentity(
  overrides: Partial<Pass0Input> & { corpus: ReturnType<typeof corpusOf>; proposalPath: string },
): Pass0Input {
  return baseInput({ identity: directory, ...overrides });
}

describe('decider-resolvable', () => {
  test('every declared decider resolving to one active principal passes', () => {
    const proposal = record({ id: '0001', deciders: ['@alice', 'team:solo'] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(withIdentity({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(ruleResult(report, 'decider-resolvable')).toMatchObject({ status: 'pass', reason: 'decider-resolvable.ok' });
  });

  test('no declared deciders ⇒ warn none-declared', () => {
    const proposal = record({ id: '0001', deciders: [] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(withIdentity({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(ruleResult(report, 'decider-resolvable')).toMatchObject({ status: 'fail', severity: 'warn', reason: 'decider-resolvable.none-declared' });
  });

  test('an unknown decider ⇒ warn zero-match', () => {
    const proposal = record({ id: '0001', deciders: ['@nobody'] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(withIdentity({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(ruleResult(report, 'decider-resolvable').reason).toBe('decider-resolvable.zero-match');
  });

  test('an ambiguous team decider ⇒ warn ambiguous-match', () => {
    const proposal = record({ id: '0001', deciders: ['team:many'] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(withIdentity({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(ruleResult(report, 'decider-resolvable').reason).toBe('decider-resolvable.ambiguous-match');
  });

  test('an absent identity directory is inert (directory-absent)', () => {
    const proposal = record({ id: '0001', deciders: ['@alice'] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(ruleResult(report, 'decider-resolvable')).toMatchObject({ status: 'inert', reason: 'decider-resolvable.directory-absent' });
  });
});

describe('expiry-sane', () => {
  test('absent reviewBy passes', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', evaluationDate: '2026-07-19' }));
    expect(ruleResult(report, 'expiry-sane')).toMatchObject({ status: 'pass', reason: 'expiry-sane.ok' });
  });

  test('reviewBy strictly after the evaluation date passes', () => {
    const proposal = record({ id: '0001', reviewBy: '2026-08-01' }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', evaluationDate: '2026-07-19' }));
    expect(ruleResult(report, 'expiry-sane').status).toBe('pass');
  });

  test('reviewBy equal to the evaluation date is info past-or-equal', () => {
    const proposal = record({ id: '0001', reviewBy: '2026-07-19' }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', evaluationDate: '2026-07-19' }));
    const result = ruleResult(report, 'expiry-sane');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('info');
    expect(result.reason).toBe('expiry-sane.past-or-equal');
    expect(report.outcome).toBe('ok'); // info never returns
  });

  test('reviewBy before the evaluation date is info past-or-equal', () => {
    const proposal = record({ id: '0001', reviewBy: '2026-07-01' }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', evaluationDate: '2026-07-19' }));
    expect(ruleResult(report, 'expiry-sane').reason).toBe('expiry-sane.past-or-equal');
  });
});
