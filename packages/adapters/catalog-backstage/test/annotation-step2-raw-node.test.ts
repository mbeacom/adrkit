/**
 * T059 — **observed failing, permanent negative case.** FR-027: step 2's
 * string-scalar check runs against the **raw YAML node**, before `JSON.parse`.
 *
 * # The exact fixture, and why it is this one
 *
 * The annotation value `["[]"]` — a YAML *sequence* containing the string `"[]"`,
 * not a string — must yield `annotation-value-not-a-string`, and must **never** be
 * silently coerced into `explicit-empty`.
 *
 * The coercion path is a language-level fact, not a hypothetical:
 * `owned-paths-annotation.md` §1 step 2 spells it out — ECMA-262 defines
 * `JSON.parse(text)` as first coercing `text` to a string via `ToString`, so
 * `["[]"]` becomes the string `"[]"`, which parses cleanly as an empty array and is
 * then misclassified.
 *
 * **A misclassification here is worse than a crash.** `explicit-empty` is a
 * legitimate, meaningful state — "this entity deliberately owns nothing". A
 * descriptor that was in fact malformed would be recorded as having made a
 * considered decision, and nothing downstream would ever question it.
 *
 * # The proof that the mechanism is what it claims
 *
 * The first test below reproduces the coercion directly: it shows that
 * `JSON.parse(["[]"] as never)` really does return `[]` without throwing. Without
 * that, "step 2 is load-bearing" would be an assertion about a danger nobody had
 * confirmed exists.
 *
 * **Retained permanently.**
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/annotation-sequence-coercion/`.
 */

import { describe, expect, test } from 'bun:test';
import { readAnnotationNode, readDescriptorDocuments } from '../src/descriptor/read.ts';
import { decodeAnnotation } from '../src/ownership/annotation.ts';
import { deriveOwnership } from '../src/ownership/derive.ts';

/** The descriptor exactly as a fixture author would write it, in YAML. */
const DESCRIPTOR = [
  'apiVersion: backstage.io/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: payments',
  '  annotations:',
  '    adrkit.io/owned-paths: ["[]"]',
  '',
].join('\n');

describe('T059 — the coercion this check exists to prevent is real', () => {
  test('`JSON.parse` coerces a one-element sequence to `"[]"` and returns `[]`', () => {
    // The cast is the point: `JSON.parse`'s TypeScript signature declares a
    // `string` parameter and therefore provides no runtime protection at all. A
    // value arriving from YAML is `unknown`, and nothing in the type system stops
    // it reaching here.
    const coerced: unknown = JSON.parse(['[]'] as unknown as string);
    expect(coerced).toEqual([]);
    expect(Array.isArray(coerced)).toBe(true);
    expect(String(['[]'])).toBe('[]');
  });

  test('so an implementation without step 2 would classify it `explicit-empty`', () => {
    // Demonstrating the wrong answer explicitly, so the right one below is a
    // contrast rather than an assertion in a vacuum.
    const withoutStepTwo = JSON.parse(['[]'] as unknown as string) as unknown[];
    const wouldBeState = withoutStepTwo.length === 0 ? 'explicit-empty' : 'explicit-paths';
    expect(wouldBeState).toBe('explicit-empty');
  });
});

describe('T059 — the YAML sequence really is a sequence by the time it is checked', () => {
  test('the raw node read from the descriptor is an array, not a string', () => {
    const [document] = readDescriptorDocuments('catalog-info.yaml', DESCRIPTOR);
    expect(document?.parseOutcome).toBe('parsed');
    if (document === undefined) return;

    const node = readAnnotationNode(document, 'adrkit.io/owned-paths');
    expect(node.present).toBe(true);
    expect(Array.isArray(node.value)).toBe(true);
    expect(typeof node.value).not.toBe('string');
    expect(node.value).toEqual(['[]']);
  });
});

describe('T059 — the correct reason is produced, and the wrong one is absent', () => {
  test('`decodeAnnotation` yields `annotation-value-not-a-string`', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
  });

  test('and never `explicit-empty` — the absence of the wrong outcome', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('explicit-empty');
  });

  test('the whole derivation, end to end from the YAML', () => {
    const [document] = readDescriptorDocuments('catalog-info.yaml', DESCRIPTOR);
    if (document === undefined) throw new Error('fixture did not parse');
    const node = readAnnotationNode(document, 'adrkit.io/owned-paths');

    const derivation = deriveOwnership(node.present, node.value);
    expect(derivation.ok).toBe(false);
    if (derivation.ok) return;

    expect(derivation.rejection.reason).toBe('annotation-value-not-a-string');
    expect(derivation.annotation.rawNodeIsString).toBe(false);
    expect(derivation.annotation.jsonParseOutcome).toBe('not-a-string');
    expect(JSON.stringify(derivation)).not.toContain('explicit-empty');
  });

  test('a genuine `explicit-empty` is still reachable — the check is not a blanket ban', () => {
    // If `["[]"]` were rejected by something that also rejected the legitimate
    // case, the fixture would prove nothing about step 2 specifically.
    const genuine = deriveOwnership(true, '[]');
    expect(genuine.ok).toBe(true);
    if (!genuine.ok) return;
    expect(genuine.value.ownershipState).toBe('explicit-empty');
  });
});

describe('T059 — step 2 runs before step 3, not merely instead of it', () => {
  test('a non-string that would ALSO fail JSON parsing still reports step 2', () => {
    // `{a: 1}` stringifies to `[object Object]`, which is not valid JSON. If step 2
    // were skipped, this would surface as `parse-error` — a different reason for
    // the same defect, and the one that would hide the ordering bug.
    const result = decodeAnnotation(true, { a: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
    expect(result.rejection.reason).not.toBe('parse-error');
  });

  test('a number that would parse cleanly still reports step 2', () => {
    // `3` stringifies to `"3"`, which parses to the number 3 — so without step 2
    // this would reach step 4 and report `wrong-shape`, again masking the ordering.
    const result = decodeAnnotation(true, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('annotation-value-not-a-string');
    expect(result.rejection.reason).not.toBe('wrong-shape');
  });

  test('the diagnostics record shows step 3 was never reached', () => {
    const result = decodeAnnotation(true, ['[]']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.jsonParseOutcome).toBe('not-a-string');
    expect(result.diagnostics.jsonParseOutcome).not.toBe('parsed');
    expect(result.diagnostics.shapeOutcome).toBeUndefined();
  });
});
