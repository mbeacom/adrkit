import { describe, expect, test } from 'bun:test';
import { aggregate, type SubResult } from '../src/report/aggregate.ts';
import { notEvaluated } from '../src/rules/kernel.ts';
import type { RuleFinding } from '../src/index.ts';

/**
 * US2 / T023 — deterministic aggregation. Status precedence `fail > inert > pass`;
 * the primary reason is the first catalog-precedence code among the winning-status
 * sub-findings; subordinate findings are retained; and `assertions-pass`'s
 * prerequisite `not-evaluated` is produced outside ordinary aggregation.
 */

function finding(reason: RuleFinding['reason'], extra: Partial<RuleFinding> = {}): RuleFinding {
  return { reason, ...extra };
}

describe('aggregate', () => {
  test('fail beats inert beats pass and selects the winning-status reason', () => {
    const subs: SubResult[] = [
      { status: 'pass', reason: 'affects-resolvable.ok' },
      { status: 'inert', reason: 'affects-resolvable.backing-absent', finding: finding('affects-resolvable.backing-absent') },
      { status: 'fail', reason: 'affects-resolvable.zero-targets', finding: finding('affects-resolvable.zero-targets') },
    ];
    const result = aggregate('affects-resolvable', subs);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('warn');
    expect(result.reason).toBe('affects-resolvable.zero-targets');
    // subordinate findings retained
    expect(result.findings.map((f) => f.reason).sort()).toEqual([
      'affects-resolvable.backing-absent',
      'affects-resolvable.zero-targets',
    ]);
  });

  test('with no violation, inert wins over pass and picks the earliest inert reason', () => {
    const subs: SubResult[] = [
      { status: 'inert', reason: 'affects-resolvable.resolver-absent', finding: finding('affects-resolvable.resolver-absent') },
      { status: 'inert', reason: 'affects-resolvable.backing-absent', finding: finding('affects-resolvable.backing-absent') },
      { status: 'pass', reason: 'affects-resolvable.ok' },
    ];
    const result = aggregate('affects-resolvable', subs);
    expect(result.status).toBe('inert');
    // backing-absent precedes resolver-absent in the catalog
    expect(result.reason).toBe('affects-resolvable.backing-absent');
    expect(result.severity).toBeUndefined();
  });

  test('a clean rule with no sub-findings is a pass with the .ok reason', () => {
    const result = aggregate('id-unique', []);
    expect(result).toMatchObject({ status: 'pass', reason: 'id-unique.ok', findings: [] });
  });

  test('assertions-pass prerequisite not-evaluated is produced outside aggregation', () => {
    const result = notEvaluated('assertions-pass', 'not-evaluated.prereq-failed');
    expect(result).toEqual({
      rule: 'assertions-pass',
      status: 'not-evaluated',
      reason: 'not-evaluated.prereq-failed',
      findings: [],
    });
  });

  test('findings are sorted by the stable secondary comparator (candidate, related, …)', () => {
    const subs: SubResult[] = [
      { status: 'fail', reason: 'no-orphan-refs.dangling-relates-to', finding: finding('no-orphan-refs.dangling-relates-to', { candidateAdr: '0002', relatedAdr: '9999' }) },
      { status: 'fail', reason: 'no-orphan-refs.dangling-relates-to', finding: finding('no-orphan-refs.dangling-relates-to', { candidateAdr: '0002', relatedAdr: '7777' }) },
      { status: 'fail', reason: 'no-orphan-refs.dangling-relates-to', finding: finding('no-orphan-refs.dangling-relates-to', { candidateAdr: '0002', relatedAdr: '8888' }) },
    ];
    const result = aggregate('no-orphan-refs', subs);
    expect(result.findings.map((f) => f.relatedAdr)).toEqual(['7777', '8888', '9999']);
  });
});
