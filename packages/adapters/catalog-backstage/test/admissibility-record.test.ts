/**
 * T052 — FR-020: every inadmissibility record identifies **all three** of the
 * descriptor path, the failing field, and the rejecting validator — and is
 * distinguishable from a `duplicate-canonical-id` record.
 *
 * `admissibility.md` §3: "A recorded failure that says only 'descriptor invalid',
 * without naming which of the four fields and which validator produced the false,
 * does not satisfy FR-020 and MUST be treated as a reporting defect rather than as
 * a determination."
 */

import { describe, expect, test } from 'bun:test';
import { classifyAdmissibility, inadmissibleRejection } from '../src/admissibility/classify.ts';
import { PINNED_BACKSTAGE_COMMIT } from '../src/admissibility/validators.ts';
import { ADMISSIBLE, descriptor } from './descriptor-fixtures.ts';

describe('T052 — all three attributions are present', () => {
  const result = classifyAdmissibility(
    descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' }, 'packages/bulk-import/catalog-info.yaml'),
  );

  test('the record names the offending path', () => {
    expect(result.attributions[0]?.sourcePath).toBe('packages/bulk-import/catalog-info.yaml');
  });

  test('the record names the failing field', () => {
    expect(result.attributions[0]?.field).toBe('metadata.name');
  });

  test('the record names the rejecting validator', () => {
    expect(result.attributions[0]?.validator).toBe('validateEntityName');
  });

  test('the record names the pinned binding and commit the verdict is warranted by', () => {
    expect(result.attributions[0]?.pinnedBinding).toBe(
      'isValidEntityName \u2192 KubernetesValidatorFunctions.isValidObjectName',
    );
    expect(result.attributions[0]?.pinnedCommit).toBe(PINNED_BACKSTAGE_COMMIT);
  });

  test('the document index is carried, since one file may hold several documents', () => {
    expect(result.attributions[0]?.documentIndexInFile).toBe(0);
  });

  test('the rendered detail carries all three, not a bare "invalid"', () => {
    const detail = inadmissibleRejection(result).detail;
    expect(detail).toContain('packages/bulk-import/catalog-info.yaml');
    expect(detail).toContain('metadata.name');
    expect(detail).toContain('validateEntityName');
    expect(detail).not.toBe('descriptor invalid');
  });
});

describe('T052 — two failing fields produce two attributions, not one merged one', () => {
  // `admissibility.md` §3: "The composition therefore splits the descriptor's fields
  // before invoking any predicate and never after. Two fields failing produce two
  // attributions, not one merged one."
  const result = classifyAdmissibility(
    descriptor({ apiVersion: 'a/b/c', kind: 'Component', name: 'payments', namespace: 'Default' }),
  );

  test('both failures are recorded', () => {
    expect(result.admissible).toBe(false);
    expect(result.failedFields).toEqual(['apiVersion', 'metadata.namespace']);
  });

  test('each carries its own validator, not a shared one', () => {
    expect(result.attributions.map((a) => a.validator)).toEqual([
      'validateApiVersion',
      'validateNamespace',
    ]);
  });

  test('evaluation does not short-circuit at the first failure', () => {
    // A short-circuit would make the reported field a function of evaluation
    // order rather than of the descriptor.
    expect(result.attributions).toHaveLength(2);
  });

  test('all four failing at once yields four attributions', () => {
    const all = classifyAdmissibility(
      descriptor({ apiVersion: 'A/B/C', kind: '1bad', name: '-bad-', namespace: 'BAD' }),
    );
    expect(all.failedFields).toEqual([
      'apiVersion',
      'kind',
      'metadata.name',
      'metadata.namespace',
    ]);
    expect(new Set(all.attributions.map((a) => a.validator)).size).toBe(4);
  });
});

describe('T052 — distinguishable from a `duplicate-canonical-id` record', () => {
  test('the trigger class alone tells them apart, without parsing any prose', () => {
    const rejection = inadmissibleRejection(
      classifyAdmissibility(descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' })),
    );
    expect(rejection.triggerClass).toBe('inadmissible-descriptor');
    expect(rejection.triggerClass).not.toBe('duplicate-canonical-id');
  });

  test('the record contains no canonical id, so it could not be mistaken for a collision', () => {
    const rejection = inadmissibleRejection(
      classifyAdmissibility(descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' })),
    );
    expect(rejection.detail).not.toContain('component:default/');
    expect(JSON.stringify(rejection)).not.toContain('duplicate');
  });

  test('the record says what was observed, without claiming Backstage rejected it', () => {
    // `admissibility.md` §1 and §7: the warrant is a predicate return value. A
    // record asserting system behaviour would exceed it.
    const rejection = inadmissibleRejection(
      classifyAdmissibility(descriptor({ ...ADMISSIBLE, name: '${{ values.name }}' })),
    );
    expect(rejection.detail).toContain('rejected by validateEntityName');
    expect(rejection.detail).toContain('pinned at');
    expect(rejection.detail).not.toMatch(/backstage (?:rejects|would|requires)/iu);
  });

  test('an absent field is rendered as absent, not as an empty string', () => {
    const result = classifyAdmissibility(descriptor({ kind: 'Component', name: 'payments' }));
    expect(result.failedFields).toEqual(['apiVersion']);
    expect(result.attributions[0]?.observed).toBe('<absent>');
  });

  test('a non-string field is rendered by type, never coerced into a quoted string', () => {
    const document = descriptor({ ...ADMISSIBLE, name: 'payments' });
    const withNumericKind = { ...document, rawKind: 42 };
    const result = classifyAdmissibility(withNumericKind);
    expect(result.failedFields).toEqual(['kind']);
    expect(result.attributions[0]?.observed).toBe('<number>');
  });
});
