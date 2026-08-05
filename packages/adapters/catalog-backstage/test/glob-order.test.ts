/**
 * T068 — FR-033: `derivedPaths` is sorted with `compareCodeUnits`
 * (`packages/core/src/ordering/index.ts:12`) and deduplicated.
 *
 * The expected orderings below are derived from the comparator's own definition —
 * `a < b ? -1 : a > b ? 1 : 0` over UTF-16 code units — and from FR-033's
 * requirement that "the envelope's array ordering is a function of content alone".
 */

import { describe, expect, test } from 'bun:test';
import { compareCodeUnits } from '@adrkit/core';
import { isOrdered, orderDerivedPaths } from '../src/glob/order.ts';
import { deriveOwnership } from '../src/ownership/derive.ts';

describe('T068 — sorting uses the repository\u2019s one comparator', () => {
  test('the result agrees with `compareCodeUnits` applied directly', () => {
    const input = ['packages/b/**', 'packages/a/**', 'docs/*.md'];
    expect(orderDerivedPaths(input)).toEqual([...input].sort(compareCodeUnits));
  });

  test('ordering is by code unit, not by locale', () => {
    // The case that separates the two: under a code-unit comparison every uppercase
    // ASCII letter sorts before every lowercase one, because 'Z' (0x5A) < 'a'
    // (0x61). A locale-aware comparison typically interleaves them.
    expect(orderDerivedPaths(['a/**', 'B/**'])).toEqual(['B/**', 'a/**']);
    expect('B'.localeCompare('a')).toBeGreaterThan(0);
    expect(compareCodeUnits('B', 'a')).toBeLessThan(0);
  });

  test('the module never reaches for `localeCompare`', async () => {
    const source = await Bun.file(new URL('../src/glob/order.ts', import.meta.url)).text();
    const code = source.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    expect(code).not.toContain('localeCompare');
    expect(code).toContain('compareCodeUnits');
  });

  test('the comparator is imported from core, not reimplemented', async () => {
    const source = await Bun.file(new URL('../src/glob/order.ts', import.meta.url)).text();
    expect(source).toContain("from '@adrkit/core'");
  });
});

describe('T068 — deduplication', () => {
  test('a repeated pattern appears once', () => {
    expect(orderDerivedPaths(['a/**', 'a/**', 'a/**'])).toEqual(['a/**']);
  });

  test('deduplication is exact-string, never normalized', () => {
    // `a/**` and `A/**` are different patterns under `nocase: false`, so collapsing
    // them would change what the entity owns.
    expect(orderDerivedPaths(['a/**', 'A/**'])).toEqual(['A/**', 'a/**']);
  });

  test('an empty input yields an empty output', () => {
    expect(orderDerivedPaths([])).toEqual([]);
  });

  test('the input is never mutated', () => {
    const input = ['b/**', 'a/**', 'b/**'];
    const snapshot = [...input];
    orderDerivedPaths(input);
    expect(input).toEqual(snapshot);
  });
});

describe('T068 — ordering is a function of content alone', () => {
  test('declaration order does not affect the result', () => {
    const forward = orderDerivedPaths(['c/**', 'a/**', 'b/**']);
    const reverse = orderDerivedPaths(['b/**', 'a/**', 'c/**']);
    expect(forward).toEqual(reverse);
    expect(forward).toEqual(['a/**', 'b/**', 'c/**']);
  });

  test('duplicate placement does not affect the result', () => {
    expect(orderDerivedPaths(['a/**', 'b/**', 'a/**'])).toEqual(
      orderDerivedPaths(['a/**', 'a/**', 'b/**']),
    );
  });

  test('a `Set` insertion-order dependency cannot survive the sort', () => {
    // `owned-paths-annotation.md` §5 names "a `Set` iteration order dependency" as a
    // non-determinism source. Deduplicating with a `Set` and then sorting discards
    // insertion order entirely, which is why the combination is safe.
    const orderings = [
      ['z/**', 'a/**', 'm/**'],
      ['m/**', 'z/**', 'a/**'],
      ['a/**', 'm/**', 'z/**'],
    ].map((input) => orderDerivedPaths(input));
    expect(new Set(orderings.map((ordering) => JSON.stringify(ordering))).size).toBe(1);
  });

  test('three or more runs produce byte-identical output (SC-001)', () => {
    const input = ['packages/b/**', 'docs/*.md', 'packages/a/**', 'packages/b/**'];
    const runs = Array.from({ length: 5 }, () => JSON.stringify(orderDerivedPaths(input)));
    expect(new Set(runs).size).toBe(1);
  });
});

describe('T068 — `isOrdered`', () => {
  test('recognises an already-ordered array', () => {
    expect(isOrdered(['a/**', 'b/**', 'c/**'])).toBe(true);
  });

  test('rejects an unordered one', () => {
    expect(isOrdered(['b/**', 'a/**'])).toBe(false);
  });

  test('rejects one carrying a duplicate', () => {
    expect(isOrdered(['a/**', 'a/**'])).toBe(false);
  });

  test('an empty array is ordered', () => {
    expect(isOrdered([])).toBe(true);
  });
});

describe('T068 — derivation returns ordered, deduplicated paths', () => {
  test('an annotation declaring patterns out of order derives them in order', () => {
    const derivation = deriveOwnership(
      true,
      '["packages/z/**", "packages/a/**", "docs/*.md", "packages/a/**"]',
    );
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.derivedPaths).toEqual([
      'docs/*.md',
      'packages/a/**',
      'packages/z/**',
    ]);
    expect(isOrdered(derivation.value.derivedPaths)).toBe(true);
  });

  test('the declared order is still visible in `patterns`, for diagnostics', () => {
    // Ordering `derivedPaths` must not destroy the record of what was authored;
    // a rejection reported against a pattern needs the position it was declared at.
    const derivation = deriveOwnership(true, '["packages/z/**", "packages/a/**"]');
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.patterns.map((pattern) => pattern.raw)).toEqual([
      'packages/z/**',
      'packages/a/**',
    ]);
  });

  test('two annotations differing only in order derive identically', () => {
    const first = deriveOwnership(true, '["a/**", "b/**"]');
    const second = deriveOwnership(true, '["b/**", "a/**"]');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.derivedPaths).toEqual(second.value.derivedPaths);
  });
});
