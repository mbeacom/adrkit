/**
 * T075 — `other-invalid-input` is a **deliberate, always-present backstop**: never
 * removed as unreachable, never treated as dead code, and never used to absorb a case
 * that has its own class.
 *
 * `atomic-fail-closed.md` §4.2 and FR-036. The three clauses are checked separately
 * because they fail in different ways:
 *
 * - *Always present* — a membership assertion over the closed enumeration.
 * - *Not dead code* — an assertion that a real generation request reaches it. This is
 *   the clause a coverage tool would otherwise flag and someone would "fix" by deleting
 *   the branch.
 * - *Never a substitute* — an assertion that every input with a named class gets that
 *   class, checked across the whole registry rather than on a sample.
 */

import { describe, expect, test } from 'bun:test';
import { TRIGGER_CLASSES } from '../src/diagnostics.ts';
import {
  BACKSTOP_TRIGGER,
  FATAL_TRIGGER_COUNT,
  NAMED_TRIGGERS,
  isTriggerClass,
  otherInvalidInput,
} from '../src/failure/triggers.ts';
import { REASON_TRIGGER_REGISTRY } from '../src/failure/classify.ts';
import { checkProvenanceDeclaration } from '../src/envelope/provenance.ts';

describe('T074 — the enumeration is closed, and its count is fifteen', () => {
  test('there are fifteen classes, counted from the declaration', () => {
    // `contracts/atomic-fail-closed.md` §4: "Closed Type of **Fifteen** Values".
    // `data-model.md` §8 lists the same fifteen. Spike 009's fourteen is correct about
    // spike 009 and wrong here (FR-035).
    expect(FATAL_TRIGGER_COUNT).toBe(15);
    expect(TRIGGER_CLASSES).toHaveLength(15);
    expect(new Set(TRIGGER_CLASSES).size).toBe(15);
  });

  test('the fifteenth is `inadmissible-descriptor`, ADR-0015 Condition of Acceptance 2', () => {
    expect(TRIGGER_CLASSES).toContain('inadmissible-descriptor');
  });

  test('this module re-exports the one declaration rather than making a second', () => {
    // The array identity, not merely its contents. A transcribed copy would be equal
    // and would not be the same object, which is exactly the drift `src/diagnostics.ts`
    // exists to prevent.
    expect(NAMED_TRIGGERS.length + 1).toBe(TRIGGER_CLASSES.length);
    expect(TRIGGER_CLASSES.every((trigger) => isTriggerClass(trigger))).toBe(true);
  });

  test('the closed type is closed at runtime too', () => {
    expect(isTriggerClass('duplicate-canonical-id')).toBe(true);
    expect(isTriggerClass('not-a-trigger')).toBe(false);
    expect(isTriggerClass(undefined)).toBe(false);
    expect(isTriggerClass(15)).toBe(false);
  });
});

describe('T075 — the backstop is always present', () => {
  test('`other-invalid-input` is a member of the closed enumeration', () => {
    expect(TRIGGER_CLASSES).toContain(BACKSTOP_TRIGGER);
    expect(BACKSTOP_TRIGGER).toBe('other-invalid-input');
  });

  test('the other fourteen are named, and the backstop is not among them', () => {
    expect(NAMED_TRIGGERS).toHaveLength(14);
    expect(NAMED_TRIGGERS).not.toContain(BACKSTOP_TRIGGER);
  });

  test('`otherInvalidInput` produces the backstop class and keeps the reason distinct', () => {
    const rejection = otherInvalidInput('provenance-declaration-missing', 'why');
    expect(rejection.triggerClass).toBe('other-invalid-input');
    expect(rejection.reason).toBe('provenance-declaration-missing');
  });
});

describe('T075 — the backstop is not dead code: a real input reaches it', () => {
  test('a request omitting a listed source\u2019s provenance is `other-invalid-input`', () => {
    const outcome = checkProvenanceDeclaration({ bySourcePath: {} }, ['catalog-info.yaml']);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.rejection.triggerClass).toBe('other-invalid-input');
    expect(outcome.rejection.reason).toBe('provenance-declaration-missing');
  });

  test('a declaration naming a source the manifest never listed also reaches it', () => {
    const outcome = checkProvenanceDeclaration(
      { bySourcePath: { 'catalog-info.yaml': 'maintainer-overlay', 'ghost.yaml': 'maintainer-overlay' } },
      ['catalog-info.yaml'],
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('provenance-declaration-unknown-source');
    expect(outcome.rejection.triggerClass).toBe('other-invalid-input');
  });

  test('a value outside the closed provenance domain also reaches it', () => {
    const outcome = checkProvenanceDeclaration(
      { bySourcePath: { 'catalog-info.yaml': 'third-party' as 'maintainer-overlay' } },
      ['catalog-info.yaml'],
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('provenance-declaration-unrecognized-value');
    expect(outcome.rejection.triggerClass).toBe('other-invalid-input');
  });

  test('exactly three reasons map to the backstop, and none of them has a named class', () => {
    const backstopReasons = Object.entries(REASON_TRIGGER_REGISTRY)
      .filter(([, trigger]) => trigger === BACKSTOP_TRIGGER)
      .map(([reason]) => reason)
      .sort();

    expect(backstopReasons).toEqual([
      'provenance-declaration-missing',
      'provenance-declaration-unknown-source',
      'provenance-declaration-unrecognized-value',
    ]);
  });
});

describe('T075 / FR-036 — the backstop never absorbs a case that has its own class', () => {
  test('every registered reason with a named class keeps that class', () => {
    // The whole registry rather than a sample. A single reason quietly remapped to the
    // backstop is exactly the substitution FR-036 forbids, and sampling would miss it.
    const absorbed = Object.entries(REASON_TRIGGER_REGISTRY).filter(
      ([reason, trigger]) => trigger === BACKSTOP_TRIGGER && !reason.startsWith('provenance-declaration-'),
    );
    expect(absorbed).toEqual([]);
  });

  test('all fourteen named classes are actually claimed by at least one reason', () => {
    // The converse failure: a named class no reason maps to would make the backstop the
    // only route for that condition, which is the same substitution arriving by
    // omission rather than by edit.
    const claimed = new Set(Object.values(REASON_TRIGGER_REGISTRY));
    const unclaimed = NAMED_TRIGGERS.filter((trigger) => !claimed.has(trigger)).sort();
    expect(unclaimed).toEqual([]);
  });
});
