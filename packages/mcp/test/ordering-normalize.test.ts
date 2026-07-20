import { describe, expect, test } from 'bun:test';
import { compareCodeUnits, compareByIdThenPath, sortByIdThenPath, sortFindingsCanonical } from '../src/corpus/ordering.ts';
import { normalize } from '../src/search/normalize.ts';
import type { Finding } from '@adrkit/core';

describe('code-unit comparator (never localeCompare)', () => {
  test('orders by UTF-16 code unit', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1);
    expect(compareCodeUnits('b', 'a')).toBe(1);
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });

  test('uppercase sorts before lowercase (code-unit, not locale collation)', () => {
    // localeCompare typically returns the OPPOSITE for 'B' vs 'a'; code-unit is fixed.
    expect(compareCodeUnits('B', 'a')).toBe(-1);
    expect('B'.localeCompare('a')).not.toBe(-1);
  });

  test('zero-padded numeric ids sort correctly under plain string order', () => {
    expect(sortByIdThenPath([
      { id: '0010', sourcePath: 'a' },
      { id: '0002', sourcePath: 'a' },
      { id: '0001', sourcePath: 'a' },
    ]).map((x) => x.id)).toEqual(['0001', '0002', '0010']);
  });
});

describe('canonical (id, sourcePath) order', () => {
  test('id first, then sourcePath tiebreak', () => {
    expect(compareByIdThenPath({ id: '0001', sourcePath: 'b.md' }, { id: '0001', sourcePath: 'a.md' })).toBe(1);
    expect(compareByIdThenPath({ id: '0001', sourcePath: 'a.md' }, { id: '0002', sourcePath: 'a.md' })).toBe(-1);
  });

  test('sortByIdThenPath breaks ties within one id by sourcePath', () => {
    const sorted = sortByIdThenPath([
      { id: '0010', sourcePath: 'docs/adr/z.md' },
      { id: '0010', sourcePath: 'docs/adr/a.md' },
    ]);
    expect(sorted.map((x) => x.sourcePath)).toEqual(['docs/adr/a.md', 'docs/adr/z.md']);
  });
});

describe('canonical finding order (sortFindings tuple, code-unit compared)', () => {
  test('orders by rule, then id, then pattern, then path, then field, then message', () => {
    const findings: Finding[] = [
      { rule: 'b', severity: 'info', message: 'm' },
      { rule: 'a', severity: 'info', message: 'z', id: '2' },
      { rule: 'a', severity: 'info', message: 'z', id: '1' },
    ];
    expect(sortFindingsCanonical(findings).map((f) => `${f.rule}/${f.id ?? ''}`)).toEqual(['a/1', 'a/2', 'b/']);
  });
});

describe('search normalization: trim -> NFKC -> toLowerCase', () => {
  test('trims incidental whitespace', () => {
    expect(normalize('  Hello  ')).toBe('hello');
  });

  test('lowercases without locale sensitivity', () => {
    expect(normalize('POSTGRES')).toBe('postgres');
  });

  test('applies NFKC compatibility folding (full-width forms)', () => {
    expect(normalize('ＡＢＣ')).toBe('abc');
    expect(normalize('ﬁ')).toBe('fi');
  });

  test('whitespace-only normalizes to empty (the input schema, not normalize, rejects it)', () => {
    expect(normalize('   ')).toBe('');
  });

  test('order is trim then NFKC then lowercase', () => {
    expect(normalize('  Ａ ')).toBe('a');
  });
});
