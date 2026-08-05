/**
 * T058 — FR-026: the five ordered annotation decode steps, each with its own
 * distinct rejection reason, each observed failing independently.
 *
 * Every expected value comes from `owned-paths-annotation.md` §1 — including its
 * worked-example table, which is transcribed below row for row — and from
 * `data-model.md` §6. None is derived by running the code under test.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/annotation-decode/`.
 */

import { describe, expect, test } from 'bun:test';
import {
  ANNOTATION_REJECTION_STEP,
  OWNED_PATHS_ANNOTATION,
  decodeAnnotation,
} from '../src/ownership/annotation.ts';

describe('T058 — `owned-paths-annotation.md` \u00a71\u2019s worked-example table', () => {
  // | Raw annotation node | Final rejection reason |
  // |---|---|
  // | `'["packages/payments/**"]'` (string scalar)   | none — proceeds to per-pattern validation |
  // | `["[]"]` (YAML sequence, not a string)         | `"annotation-value-not-a-string"` |
  // | `'{"paths": ["a/**"]}'` (string scalar)        | `"wrong-shape"` |
  // | `'"packages/payments/**"'` (string scalar)     | `"wrong-shape"` |
  // | `'["packages/payments/**", 3]'` (string scalar)| `"wrong-shape"` |
  // | `'["packages/payments/**'` (missing bracket)   | `"parse-error"` |

  test('row 1 — a well-formed string scalar proceeds', () => {
    const result = decodeAnnotation(true, '["packages/payments/**"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patterns).toEqual(['packages/payments/**']);
    expect(result.value.diagnostics.rejectionReason).toBeUndefined();
  });

  test('row 2 — a YAML sequence yields `annotation-value-not-a-string`', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
  });

  test('row 3 — a JSON object yields `wrong-shape`', () => {
    const result = decodeAnnotation(true, '{"paths": ["a/**"]}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('wrong-shape');
  });

  test('row 4 — a bare string yields `wrong-shape`, never a single-element array', () => {
    const result = decodeAnnotation(true, '"packages/payments/**"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('wrong-shape');
  });

  test('row 5 — an array with a non-string element yields `wrong-shape`', () => {
    const result = decodeAnnotation(true, '["packages/payments/**", 3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('wrong-shape');
    expect(result.rejection.detail).toContain('element 1');
  });

  test('row 6 — malformed JSON yields `parse-error`', () => {
    const result = decodeAnnotation(true, '["packages/payments/**');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('parse-error');
  });
});

describe('T058 step 1 — presence, via an explicit discriminant', () => {
  test('an absent annotation stops at step 1 with no rejection', () => {
    const result = decodeAnnotation(false, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.annotationPresent).toBe(false);
    expect(result.value.patterns).toBeUndefined();
  });

  test('no string check, JSON parse, or shape check is attempted for an absent key', () => {
    // §1 step 1: "No string check, no JSON parsing, and no shape check is attempted
    // for an absent key."
    const result = decodeAnnotation(false, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.rawNodeIsString).toBeUndefined();
    expect(result.value.diagnostics.jsonParseOutcome).toBeUndefined();
    expect(result.value.diagnostics.shapeOutcome).toBeUndefined();
  });

  test('presence is not inferred from the value — a present null reaches step 2', () => {
    // A YAML key authored with no value is present and `null`. Inferring absence
    // from `undefined` would silently reclassify it as `annotation-absent`.
    const result = decodeAnnotation(true, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
    expect(result.diagnostics.annotationPresent).toBe(true);
  });
});

describe('T058 step 2 — the string-scalar check, before any parse', () => {
  test.each([
    ['a YAML sequence', ['[]']],
    ['a YAML mapping', { a: 1 }],
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
  ] as const)('%s is rejected as `annotation-value-not-a-string`', (_label, node) => {
    const result = decodeAnnotation(true, node);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
    expect(result.diagnostics.rawNodeIsString).toBe(false);
    expect(result.diagnostics.jsonParseOutcome).toBe('not-a-string');
  });

  test('the detail records that the value was never passed to JSON.parse', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('not passed to JSON.parse');
    expect(result.rejection.detail).toContain('ToString');
  });
});

describe('T058 step 3 — JSON decode, reached only by a present string scalar', () => {
  test.each([
    '["packages/**"',
    '[packages/**]',
    '{"a": }',
    'not json at all',
    '',
  ])('%j is rejected as `parse-error`', (raw) => {
    const result = decodeAnnotation(true, raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('parse-error');
    expect(result.diagnostics.rawNodeIsString).toBe(true);
    expect(result.diagnostics.jsonParseOutcome).toBe('parse-error');
  });

  test('a parse failure is never coerced into a fallback empty array', () => {
    // §1 step 3: "never coerced into a fallback empty array".
    const result = decodeAnnotation(true, '["packages/**"');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('"patterns"');
  });
});

describe('T058 step 4 — shape: exactly array<string>', () => {
  test.each([
    ['a JSON object', '{"paths": []}'],
    ['a bare string', '"packages/**"'],
    ['a bare number', '3'],
    ['a bare boolean', 'true'],
    ['null', 'null'],
    ['an array containing a number', '["a/**", 3]'],
    ['an array containing an object', '["a/**", {}]'],
    ['an array containing null', '["a/**", null]'],
    ['an array containing a nested array', '["a/**", ["b/**"]]'],
  ])('%s is rejected as `wrong-shape`', (_label, raw) => {
    const result = decodeAnnotation(true, raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('wrong-shape');
    expect(result.diagnostics.jsonParseOutcome).toBe('parsed');
    expect(result.diagnostics.shapeOutcome).toBe('wrong-shape');
  });

  test('nothing is coerced — a bare string is never treated as a one-element array', () => {
    const result = decodeAnnotation(true, '"packages/payments/**"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('wrong-shape');
  });

  test('an empty array is a valid shape, and reaches step 5', () => {
    const result = decodeAnnotation(true, '[]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patterns).toEqual([]);
    expect(result.value.diagnostics.shapeOutcome).toBe('array-of-strings');
  });
});

describe('T058 — the reasons are three distinct values, one per failing step', () => {
  test('each step maps to its own reason', () => {
    expect(ANNOTATION_REJECTION_STEP).toEqual({
      'annotation-value-not-a-string': 2,
      'parse-error': 3,
      'wrong-shape': 4,
    });
  });

  test('the three reasons observed together are mutually distinct', () => {
    // §1 step 3: a decode failure is "**not** the same reason as step 2's
    // non-string failure or step 4's shape failure".
    const reasons = [
      decodeAnnotation(true, ['[]']),
      decodeAnnotation(true, '["a/**"'),
      decodeAnnotation(true, '{"a": 1}'),
    ].map((result) => (result.ok ? 'accepted' : result.rejection.reason));

    expect(reasons).toEqual(['annotation-value-not-a-string', 'parse-error', 'wrong-shape']);
    expect(new Set(reasons).size).toBe(3);
  });

  test('the annotation key is the one ADR-0012 names', () => {
    expect(OWNED_PATHS_ANNOTATION).toBe('adrkit.io/owned-paths');
  });
});
