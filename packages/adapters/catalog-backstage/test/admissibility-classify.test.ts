/**
 * T051 — FR-018: `inadmissible-descriptor` classification and its failure
 * semantics.
 *
 * `admissibility.md` §5: a **fatal, whole-operation** trigger — the **fifteenth**
 * member of this feature's enumeration. The entire run aborts; no envelope is
 * written, including a partial one; no entity from the same run is emitted,
 * including entities already determined admissible.
 *
 * "An inadmissible descriptor is **never skipped**, never downgraded to a warning,
 * and never excluded-and-continued. 'Continue past the bad one' is the precise
 * behaviour this contract forbids."
 */

import { describe, expect, test } from 'bun:test';
import { TRIGGER_CLASSES } from '../src/diagnostics.ts';
import {
  classifyAdmissibility,
  inadmissibleRejection,
} from '../src/admissibility/classify.ts';
import { collectAdmitted } from '../src/admissibility/index.ts';
import {
  ADMISSIBLE,
  INADMISSIBLE_AND_COLLIDING,
  INADMISSIBLE_AND_UNIQUE_BULK_IMPORT,
  descriptor,
} from './descriptor-fixtures.ts';

describe('T051 — the enumeration this feature uses has fifteen members', () => {
  test('fifteen, not fourteen', () => {
    // `admissibility.md` §5.1: fourteen is spike 009's count and "remains correct
    // *as a statement about spike 009*"; writing it as this feature's count is an
    // error against FR-035.
    expect(TRIGGER_CLASSES).toHaveLength(15);
    expect(new Set(TRIGGER_CLASSES).size).toBe(15);
  });

  test('`inadmissible-descriptor` is a member, and `other-invalid-input` remains the backstop', () => {
    expect(TRIGGER_CLASSES).toContain('inadmissible-descriptor');
    expect(TRIGGER_CLASSES.at(-1)).toBe('other-invalid-input');
  });

  test('removing `inadmissible-descriptor` would leave spike 009\u2019s fourteen', () => {
    expect(TRIGGER_CLASSES.filter((c) => c !== 'inadmissible-descriptor')).toHaveLength(14);
  });
});

describe('T051 — classification', () => {
  test('an admissible descriptor classifies with no failed fields', () => {
    const result = classifyAdmissibility(descriptor(ADMISSIBLE));
    expect(result.admissible).toBe(true);
    expect(result.failedFields).toEqual([]);
    expect(result.attributions).toEqual([]);
  });

  test('`failedFields` is empty iff admissible — no partial admissibility (\u00a72)', () => {
    for (const spec of [ADMISSIBLE, INADMISSIBLE_AND_COLLIDING]) {
      const result = classifyAdmissibility(descriptor(spec));
      expect(result.admissible).toBe(result.failedFields.length === 0);
      expect(result.admissible).toBe(result.attributions.length === 0);
    }
  });

  test('an inadmissible descriptor raises the fatal trigger', () => {
    const result = classifyAdmissibility(descriptor(INADMISSIBLE_AND_UNIQUE_BULK_IMPORT));
    expect(result.admissible).toBe(false);
    const rejection = inadmissibleRejection(result);
    expect(rejection.reason).toBe('inadmissible-descriptor');
    expect(rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('building a rejection for an admissible result throws rather than fabricating one', () => {
    const result = classifyAdmissibility(descriptor(ADMISSIBLE));
    expect(() => inadmissibleRejection(result)).toThrow(/fabricate a determination/u);
  });

  test('an omitted namespace is admissible; the validator is not invoked', () => {
    // ADR-0015's Decision: "An omitted `metadata.namespace` is admissible; §1's
    // `default` substitution applies afterwards, unchanged."
    const result = classifyAdmissibility(descriptor(ADMISSIBLE));
    expect(result.admissible).toBe(true);
    expect(result.failedFields).not.toContain('metadata.namespace');
  });

  test('a present-but-invalid namespace is inadmissible', () => {
    // "if and only if present" — present-and-empty is present.
    const result = classifyAdmissibility(descriptor({ ...ADMISSIBLE, namespace: 'Default' }));
    expect(result.admissible).toBe(false);
    expect(result.failedFields).toEqual(['metadata.namespace']);
  });

  test('the namespace is validated as authored, never after defaulting', () => {
    // If the substitution ran first, an omitted namespace would be validated as
    // the literal `default` — which happens to pass, hiding the difference. The
    // observable consequence is that no `validateNamespace` attribution exists at
    // all for an omitted namespace.
    const result = classifyAdmissibility(descriptor(ADMISSIBLE));
    expect(result.attributions.map((a) => a.validator)).not.toContain('validateNamespace');
  });
});

describe('T051 — failure semantics: never skipped, never partial', () => {
  test('one inadmissible descriptor among five valid ones rejects the whole batch', () => {
    const batch = [
      descriptor({ ...ADMISSIBLE, name: 'a' }),
      descriptor({ ...ADMISSIBLE, name: 'b' }),
      descriptor(INADMISSIBLE_AND_COLLIDING),
      descriptor({ ...ADMISSIBLE, name: 'c' }),
      descriptor({ ...ADMISSIBLE, name: 'd' }),
      descriptor({ ...ADMISSIBLE, name: 'e' }),
    ];

    const admission = collectAdmitted(batch);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('the rejected batch yields no admitted descriptors — not even the valid five', () => {
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'a' }),
      descriptor(INADMISSIBLE_AND_COLLIDING),
    ]);
    expect(admission.ok).toBe(false);
    expect(admission).not.toHaveProperty('admitted');
    expect(JSON.stringify(admission)).not.toContain('component:default/a');
  });

  test('there is no API that filters inadmissible descriptors out and continues', async () => {
    // The single most likely implementation mistake `atomic-fail-closed.md` §1
    // exists to foreclose. A `.filter(...)` over admissibility anywhere in the
    // module would be exactly it.
    const source = await Bun.file(
      new URL('../src/admissibility/index.ts', import.meta.url),
    ).text();
    const code = source.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    expect(code).not.toContain('.filter(');
    expect(code).not.toContain('continue');
  });

  test('a batch with no inadmissible member is admitted whole', () => {
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'a' }),
      descriptor({ ...ADMISSIBLE, name: 'b' }),
    ]);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.admitted).toHaveLength(2);
  });
});
