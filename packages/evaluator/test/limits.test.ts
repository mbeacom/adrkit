import { describe, expect, test } from 'bun:test';
import { canonicalStringify } from '../src/report/serialize.ts';
import { canonicalJsonString, withinJsonLimits, ASSERTION_INPUT_LIMITS } from '../src/assertions/limits.ts';
import type { JsonValue } from '../src/index.ts';

/**
 * Findings #5 + #7 — deterministic, bounded canonical serialization.
 *
 * #7: object keys emit in strict code-unit order, including integer-like keys that
 *     `JSON.stringify` would reorder numerically, and the hash is deterministic.
 * #5: depth/node limits are enforced by an iterative traversal BEFORE any recursive/
 *     serializing work, so hostile deep JSON returns false rather than a RangeError.
 */

function nest(depth: number): JsonValue {
  let value: JsonValue = 0;
  for (let i = 0; i < depth; i += 1) value = [value];
  return value;
}

describe('canonical serialization (#7)', () => {
  test('integer-like keys emit in code-unit order', () => {
    expect(canonicalStringify({ '2': 2, '10': 10 })).toBe('{"10":10,"2":2}');
    expect(canonicalJsonString({ '10': 10, '2': 2 })).toBe('{"10":10,"2":2}');
  });

  test('the hash is order-independent and deterministic', () => {
    expect(canonicalJsonString({ '2': 2, '10': 10 })).toBe(canonicalJsonString({ '10': 10, '2': 2 }));
    expect(canonicalJsonString({ b: [1, 2], a: { z: true } })).toBe(canonicalJsonString({ a: { z: true }, b: [1, 2] }));
  });

  test('pretty output matches JSON.stringify(x, null, 2) for a normal object', () => {
    const obj = { b: 1, a: [1, 2], c: { z: true } };
    expect(canonicalStringify(obj, true)).toBe(JSON.stringify({ a: [1, 2], b: 1, c: { z: true } }, null, 2));
  });

  test('null-prototype own keys (e.g. __proto__) are emitted, not dropped', () => {
    const dict: Record<string, unknown> = Object.create(null);
    dict['__proto__'] = 5;
    dict.a = 1;
    expect(canonicalStringify(dict)).toBe('{"__proto__":5,"a":1}');
  });
});

describe('bounded resource limits (#5)', () => {
  test('depth at the bound passes; one past the bound is rejected', () => {
    expect(withinJsonLimits(nest(63), ASSERTION_INPUT_LIMITS)).toBe(true); // depth 64 incl. root
    expect(withinJsonLimits(nest(64), ASSERTION_INPUT_LIMITS)).toBe(false); // depth 65
  });

  test('hostile deep JSON returns false without a RangeError', () => {
    expect(() => withinJsonLimits(nest(200_000), ASSERTION_INPUT_LIMITS)).not.toThrow();
    expect(withinJsonLimits(nest(200_000), ASSERTION_INPUT_LIMITS)).toBe(false);
  });

  test('node count beyond the limit is rejected', () => {
    const big: JsonValue = Array.from({ length: 100_001 }, () => 0);
    expect(withinJsonLimits(big, ASSERTION_INPUT_LIMITS)).toBe(false);
  });

  test('byte size beyond the limit is rejected (after the structure is proven bounded)', () => {
    const huge = 'x'.repeat(ASSERTION_INPUT_LIMITS.maxBytes + 10);
    expect(withinJsonLimits(huge, ASSERTION_INPUT_LIMITS)).toBe(false);
  });
});
