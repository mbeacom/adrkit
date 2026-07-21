import { describe, expect, test } from 'bun:test';
import {
  compareByIdThenPath,
  compareCodeUnits,
  sortByIdThenPath,
  sortFindingsCanonical,
  type Finding,
} from '@adrkit/core';

describe('compareCodeUnits (promoted to @adrkit/core)', () => {
  test('orders by UTF-16 code unit, not locale (ä > b)', () => {
    // ä = U+00E4 (228) sorts AFTER b = U+0062 (98) in code-unit order.
    expect(compareCodeUnits('ä', 'b')).toBeGreaterThan(0);
  });

  test('a < b', () => {
    expect(compareCodeUnits('a', 'b')).toBeLessThan(0);
  });

  test('a === a', () => {
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });
});

describe('sortByIdThenPath (promoted to @adrkit/core)', () => {
  test('sorts ascending by id then sourcePath in code-unit order, stably', () => {
    const input = [
      { id: '0002', sourcePath: 'a.md' },
      { id: '0001', sourcePath: 'b.md' },
      { id: '0001', sourcePath: 'a.md' },
    ];
    expect(sortByIdThenPath(input)).toEqual([
      { id: '0001', sourcePath: 'a.md' },
      { id: '0001', sourcePath: 'b.md' },
      { id: '0002', sourcePath: 'a.md' },
    ]);
  });

  test('does not mutate the input array', () => {
    const input = [
      { id: '0002', sourcePath: 'a.md' },
      { id: '0001', sourcePath: 'a.md' },
    ];
    const snapshot = [...input];
    sortByIdThenPath(input);
    expect(input).toEqual(snapshot);
  });
});

describe('compareByIdThenPath (promoted to @adrkit/core)', () => {
  test('id is primary, sourcePath is the tiebreak', () => {
    expect(compareByIdThenPath({ id: '0001', sourcePath: 'b.md' }, { id: '0002', sourcePath: 'a.md' })).toBeLessThan(0);
    expect(compareByIdThenPath({ id: '0001', sourcePath: 'b.md' }, { id: '0001', sourcePath: 'a.md' })).toBeGreaterThan(0);
  });
});

describe('sortFindingsCanonical (promoted to @adrkit/core)', () => {
  const findings: Finding[] = [
    { rule: 'b-rule', severity: 'error', message: 'm2', path: 'z.md' },
    { rule: 'a-rule', severity: 'warn', message: 'm1', path: 'y.md' },
    { rule: 'a-rule', severity: 'warn', message: 'm1', path: 'x.md' },
  ];

  test('is deterministic across repeated calls', () => {
    const first = sortFindingsCanonical(findings);
    const second = sortFindingsCanonical(findings);
    expect(first).toEqual(second);
  });

  test('orders by (rule, id, pattern, path, field, message) in code-unit order', () => {
    const sorted = sortFindingsCanonical(findings);
    expect(sorted.map((f) => `${f.rule}:${f.path}`)).toEqual(['a-rule:x.md', 'a-rule:y.md', 'b-rule:z.md']);
  });
});
