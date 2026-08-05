/**
 * T060 — FR-028: the three ownership states, kept distinct and never conflated,
 * with `explicit-empty` decided on the **decoded** value.
 *
 * Expected values come from `owned-paths-annotation.md` §3 and §4, and from
 * `data-model.md` §7.2. None is derived by running the code under test.
 */

import { describe, expect, test } from 'bun:test';
import { deriveOwnership } from '../src/ownership/derive.ts';
import {
  OWNERSHIP_STATES,
  bothYieldEmptyDerivedPaths,
  classifyOwnershipState,
} from '../src/ownership/states.ts';
import { decodeAnnotation } from '../src/ownership/annotation.ts';

function decoded(present: boolean, raw: unknown) {
  const result = decodeAnnotation(present, raw);
  if (!result.ok) throw new Error(`fixture failed to decode: ${result.rejection.detail}`);
  return result.value;
}

describe('T060 — exactly three states, and no fourth', () => {
  test('the three, in `data-model.md` \u00a77.2\u2019s order', () => {
    expect([...OWNERSHIP_STATES]).toEqual([
      'explicit-paths',
      'explicit-empty',
      'annotation-absent',
    ]);
    expect(OWNERSHIP_STATES).toHaveLength(3);
  });

  test('every classifiable input lands on one of the three', () => {
    const observed = new Set([
      classifyOwnershipState(decoded(true, '["packages/**"]')),
      classifyOwnershipState(decoded(true, '[]')),
      classifyOwnershipState(decoded(false, undefined)),
    ]);
    expect([...observed].sort()).toEqual([...OWNERSHIP_STATES].sort());
  });
});

describe('T060 — `explicit-empty` is decided on the decoded value', () => {
  test.each(['[]', '[ ]', '[\n]', '[\t]', '[  \n  ]'])(
    '%j decodes to an empty array and qualifies identically',
    (raw) => {
      // §3: "This is a decoded-value check, never a raw-string equality check —
      // `'[]'`, `'[ ]'`, `'[\n]'`, and any other JSON text that decodes to `[]` all
      // qualify identically".
      expect(classifyOwnershipState(decoded(true, raw))).toBe('explicit-empty');
    },
  );

  test('an implementation comparing the raw string to `[]` would get `[ ]` wrong', () => {
    // Naming the wrong answer explicitly, so the right one is a contrast.
    const rawStringEquality = (raw: string) => (raw === '[]' ? 'explicit-empty' : 'something-else');
    expect(rawStringEquality('[ ]')).toBe('something-else');
    expect(classifyOwnershipState(decoded(true, '[ ]'))).toBe('explicit-empty');
  });

  test('the classifier takes a decoded annotation, never a raw string', () => {
    // The signature is the enforcement: there is no parameter through which `'[ ]'`
    // could arrive for someone to compare against `'[]'`.
    expect(classifyOwnershipState.length).toBe(1);
  });

  test('classification happens strictly after decoding, so a parse failure never reaches it', () => {
    const derivation = deriveOwnership(true, '[');
    expect(derivation.ok).toBe(false);
    if (derivation.ok) return;
    expect(derivation.rejection.reason).toBe('parse-error');
    expect(JSON.stringify(derivation)).not.toContain('explicit-empty');
  });
});

describe('T060 — the non-conflation rule', () => {
  const explicitEmpty = deriveOwnership(true, '[]');
  const absent = deriveOwnership(false, undefined);

  test('both yield an empty `derivedPaths`', () => {
    expect(explicitEmpty.ok).toBe(true);
    expect(absent.ok).toBe(true);
    if (!explicitEmpty.ok || !absent.ok) return;
    expect(explicitEmpty.value.derivedPaths).toEqual([]);
    expect(absent.value.derivedPaths).toEqual([]);
    expect(bothYieldEmptyDerivedPaths('explicit-empty', 'annotation-absent')).toBe(true);
  });

  test('and are nevertheless different states', () => {
    if (!explicitEmpty.ok || !absent.ok) return;
    expect(explicitEmpty.value.ownershipState).toBe('explicit-empty');
    expect(absent.value.ownershipState).toBe('annotation-absent');
    expect(explicitEmpty.value.ownershipState).not.toBe(absent.value.ownershipState);
  });

  test('the distinction is not recoverable from `derivedPaths` alone', () => {
    // §3's own reason for requiring an explicit discriminator field.
    if (!explicitEmpty.ok || !absent.ok) return;
    expect(explicitEmpty.value.derivedPaths).toEqual(absent.value.derivedPaths);
  });

  test('the discriminant is carried in the annotation record too', () => {
    if (!explicitEmpty.ok || !absent.ok) return;
    expect(explicitEmpty.value.annotation.annotationPresent).toBe(true);
    expect(absent.value.annotation.annotationPresent).toBe(false);
  });
});

describe('T060 — `explicit-paths`', () => {
  test('a non-empty, fully valid array yields `explicit-paths`', () => {
    const derivation = deriveOwnership(true, '["packages/payments/**", "docs/*.md"]');
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.ownershipState).toBe('explicit-paths');
    expect(derivation.value.derivedPaths).toEqual(['docs/*.md', 'packages/payments/**']);
  });

  test('`explicit-paths` is this spec\u2019s own label and must not be renamed', () => {
    // §3: ADR-0012 and the Ratification Record name only `explicit-empty` and
    // `annotation-absent`; `explicit-paths` is `spec.md`'s complementary third
    // label. "A future execution session MUST use `explicit-paths` for the
    // non-empty, valid case — never leave it unlabeled or invent an alternate term."
    expect(OWNERSHIP_STATES).toContain('explicit-paths');
  });

  test('no path is ever derived for an `annotation-absent` entity', () => {
    const derivation = deriveOwnership(false, undefined);
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.derivedPaths).toEqual([]);
    expect(derivation.value.patterns).toEqual([]);
  });
});

describe('T060 — `[""]` is not `explicit-empty` (\u00a74)', () => {
  test('a single empty-string element is a per-pattern failure, not an empty array', () => {
    // §4: `["", "packages/**"]` and `[""]` are "**not** `explicit-empty` — an
    // `explicit-empty` value is `[]` exactly."
    const derivation = deriveOwnership(true, '[""]');
    expect(derivation.ok).toBe(false);
    if (derivation.ok) return;
    expect(derivation.rejection.reason).toBe('invalid-pattern');
    expect(derivation.pattern?.outcome).toBe('empty');
    expect(derivation.pattern?.rule).toBe(1);
  });

  test('the same holds inside an otherwise well-formed array', () => {
    const derivation = deriveOwnership(true, '["", "packages/**"]');
    expect(derivation.ok).toBe(false);
    if (derivation.ok) return;
    expect(derivation.rejection.reason).toBe('invalid-pattern');
    expect(derivation.pattern?.outcome).toBe('empty');
  });

  test('it is never conflated with the `[]`-versus-absent distinction', () => {
    const derivation = deriveOwnership(true, '[""]');
    expect(derivation.ok).toBe(false);
    expect(JSON.stringify(derivation)).not.toContain('explicit-empty');
    expect(JSON.stringify(derivation)).not.toContain('annotation-absent');
  });
});

describe('T060 — determinism (\u00a75, SC-001)', () => {
  test('three runs over the same input produce byte-identical output', () => {
    const runs = Array.from({ length: 3 }, () =>
      deriveOwnership(true, '["b/**", "a/**", "b/**", "c/*"]'),
    );
    const serialized = runs.map((run) => JSON.stringify(run));
    expect(new Set(serialized).size).toBe(1);

    const [first] = runs;
    expect(first?.ok).toBe(true);
    if (first === undefined || !first.ok) return;
    expect(first.value.derivedPaths).toEqual(['a/**', 'b/**', 'c/*']);
  });
});
