import { describe, expect, test } from 'bun:test';
import { parseAdrRef } from '@adrkit/core';

// Behavior- and object-shape-preserving promotion of no-orphan-refs.ts's private
// parseRef (contracts/core-projection.md §1). Split on the FIRST ':'; a leading
// colon or no colon at all is unqualified and returns { id: ref } untouched.
describe('parseAdrRef', () => {
  test('an unqualified numeric ref returns { id } with no log key', () => {
    expect(parseAdrRef('0042')).toEqual({ id: '0042' });
    expect('log' in parseAdrRef('0042')).toBe(false);
  });

  test('a leading-colon ref is unqualified and keeps the original string, colon included', () => {
    expect(parseAdrRef(':0042')).toEqual({ id: ':0042' });
    expect('log' in parseAdrRef(':0042')).toBe(false);
  });

  test('a first-colon-qualified ref splits into { log, id }', () => {
    expect(parseAdrRef('payments:0012')).toEqual({ log: 'payments', id: '0012' });
  });

  test('only the first colon splits; later colons stay in the id', () => {
    expect(parseAdrRef('a:b:c')).toEqual({ log: 'a', id: 'b:c' });
  });

  test('a ULID id is preserved verbatim', () => {
    const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(parseAdrRef(ulid)).toEqual({ id: ulid });
  });
});
