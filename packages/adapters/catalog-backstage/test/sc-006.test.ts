/**
 * T062 — SC-006 close-out.
 *
 * SC-006 (`spec.md`): *"Each of the annotation's ordered decode/validate steps
 * produces its own distinct rejection reason when violated in isolation, and a
 * non-string YAML node is rejected by the string-scalar check **before** any JSON
 * parse is attempted."*
 *
 * Five steps; **three** of them can produce a rejection reason of their own — steps
 * 2, 3 and 4. Step 1 (presence) has no rejection: an absent annotation is the
 * legitimate `annotation-absent` state, not an error. Step 5 delegates to the glob
 * dialect, whose reasons are that contract's and are closed out by SC-007
 * (`test/glob-rules.test.ts`).
 *
 * That asymmetry is stated here rather than left implicit, because "five steps,
 * three reasons" otherwise reads as two missing cases.
 *
 * Each step is exercised **in isolation**: every fixture below violates exactly one
 * step, so the reason it produces cannot have come from a neighbouring one.
 */

import { describe, expect, test } from 'bun:test';
import {
  ANNOTATION_REJECTION_STEP,
  type AnnotationRejectionReason,
  decodeAnnotation,
} from '../src/ownership/annotation.ts';
import { deriveOwnership } from '../src/ownership/derive.ts';

/** One violation per rejecting step, each violating that step and no other. */
const STEP_FIXTURES: readonly {
  readonly step: number;
  readonly label: string;
  readonly present: boolean;
  readonly rawNode: unknown;
  readonly reason: AnnotationRejectionReason;
}[] = [
  {
    step: 2,
    label: 'string-scalar check on the raw node',
    present: true,
    rawNode: ['[]'],
    reason: 'annotation-value-not-a-string',
  },
  {
    step: 3,
    label: 'JSON decode',
    present: true,
    rawNode: '["packages/payments/**',
    reason: 'parse-error',
  },
  {
    step: 4,
    label: 'shape: exactly array<string>',
    present: true,
    rawNode: '{"paths": ["a/**"]}',
    reason: 'wrong-shape',
  },
];

describe('SC-006 — the step/reason map', () => {
  test('three steps produce a rejection reason of their own', () => {
    expect(Object.keys(ANNOTATION_REJECTION_STEP)).toHaveLength(3);
    expect(ANNOTATION_REJECTION_STEP).toEqual({
      'annotation-value-not-a-string': 2,
      'parse-error': 3,
      'wrong-shape': 4,
    });
  });

  test('step 1 has no rejection — absence is a state, not an error', () => {
    const result = decodeAnnotation(false, undefined);
    expect(result.ok).toBe(true);
    expect(Object.values(ANNOTATION_REJECTION_STEP)).not.toContain(1);
  });

  test('step 5 delegates its reasons to the glob dialect', () => {
    // Closed out by SC-007. What SC-006 needs is that step 5's failure is reported
    // under the pattern vocabulary, not the annotation one.
    const derivation = deriveOwnership(true, '["packages/{a}/**"]');
    expect(derivation.ok).toBe(false);
    if (derivation.ok) return;
    expect(derivation.rejection.reason).toBe('invalid-pattern');
    expect(Object.keys(ANNOTATION_REJECTION_STEP)).not.toContain('invalid-pattern');
    expect(derivation.pattern?.outcome).toBe('brace');
    expect(Object.values(ANNOTATION_REJECTION_STEP)).not.toContain(5);
  });
});

describe('SC-006 — each step, violated in isolation, produces its own reason', () => {
  test.each(STEP_FIXTURES.map((fixture) => [fixture.step, fixture.label, fixture] as const))(
    'step %d — %s',
    (_step, _label, fixture) => {
      const result = decodeAnnotation(fixture.present, fixture.rawNode);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.reason).toBe(fixture.reason);
      expect(ANNOTATION_REJECTION_STEP[result.rejection.reason]).toBe(fixture.step);
    },
  );

  test('the three reasons are mutually distinct', () => {
    const reasons = STEP_FIXTURES.map((fixture) => {
      const result = decodeAnnotation(fixture.present, fixture.rawNode);
      return result.ok ? 'accepted' : result.rejection.reason;
    });
    expect(new Set(reasons).size).toBe(3);
  });

  test('each fixture violates exactly one step — the earlier ones all pass', () => {
    // Step 3's fixture is a string (step 2 passes). Step 4's fixture is a string
    // that parses (steps 2 and 3 pass). Read off the diagnostics rather than
    // asserted from the outside.
    const parseError = decodeAnnotation(true, '["packages/payments/**');
    expect(parseError.ok).toBe(false);
    if (parseError.ok) return;
    expect(parseError.diagnostics.rawNodeIsString).toBe(true);

    const wrongShape = decodeAnnotation(true, '{"paths": ["a/**"]}');
    expect(wrongShape.ok).toBe(false);
    if (wrongShape.ok) return;
    expect(wrongShape.diagnostics.rawNodeIsString).toBe(true);
    expect(wrongShape.diagnostics.jsonParseOutcome).toBe('parsed');
  });
});

describe('SC-006 — the string-scalar check runs BEFORE any JSON parse', () => {
  test('the diagnostics record shows the parse was never reached', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.jsonParseOutcome).toBe('not-a-string');
    expect(result.diagnostics.shapeOutcome).toBeUndefined();
  });

  test.each([
    ['a sequence that would parse cleanly', ['[]'], 'annotation-value-not-a-string'],
    ['a mapping that would fail to parse', { a: 1 }, 'annotation-value-not-a-string'],
    ['a number that would parse to a number', 3, 'annotation-value-not-a-string'],
    ['a boolean that would parse to a boolean', true, 'annotation-value-not-a-string'],
  ] as const)('%s still reports step 2', (_label, node, expected) => {
    // Each of these would produce a *different* downstream reason if step 2 were
    // skipped — `explicit-empty`, `parse-error`, `wrong-shape`, `wrong-shape`. That
    // they all report step 2 is what shows the ordering rather than a coincidence.
    const result = decodeAnnotation(true, node);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe(expected);
  });

  test('the misclassification step 2 prevents is named, and does not happen', () => {
    // FR-027's specific danger: `["[]"]` becoming `explicit-empty`.
    const derivation = deriveOwnership(true, ['[]']);
    expect(derivation.ok).toBe(false);
    expect(JSON.stringify(derivation)).not.toContain('explicit-empty');
  });
});

describe('SC-006 — the ordering is not reversible', () => {
  test('a valid annotation still passes every step in order', () => {
    const result = decodeAnnotation(true, '["packages/payments/**"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toEqual({
      annotationPresent: true,
      rawNodeIsString: true,
      jsonParseOutcome: 'parsed',
      shapeOutcome: 'array-of-strings',
      rejectionReason: undefined,
    });
  });

  test('an absent annotation records no downstream step outcome at all', () => {
    const result = decodeAnnotation(false, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toEqual({
      annotationPresent: false,
      rawNodeIsString: undefined,
      jsonParseOutcome: undefined,
      shapeOutcome: undefined,
      rejectionReason: undefined,
    });
  });

  test('step 5 is unreachable until steps 1\u20134 succeed', () => {
    // The decode module has no access to the glob validator, so it *cannot* have
    // validated a pattern early — structural, not a matter of call order.
    const source = Bun.file(new URL('../src/ownership/annotation.ts', import.meta.url));
    return source.text().then((text) => {
      expect(text).not.toContain("from '../glob/");
      expect(text).not.toContain('validateGlobPattern');
    });
  });
});
