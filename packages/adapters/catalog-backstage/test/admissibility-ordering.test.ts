/**
 * T048 — FR-015: admissibility is evaluated **before** canonicalization,
 * structurally rather than by convention.
 *
 * `admissibility.md` §4.1 gives the reason the ordering must be structural: reversing
 * it "would make some descriptors collide *before* being found inadmissible, and the
 * trigger class reported for the run would then depend on document order within the
 * manifest. Order-dependence of the reported trigger is exactly the failure mode
 * ADR-0015's ordering rule exists to prevent."
 *
 * A test that merely called the two functions in the right order would demonstrate
 * the *test's* ordering, not the module's. What is asserted here instead is that
 * the wrong order is **unavailable**: the type `canonicalize` consumes can only be
 * produced by an admissibility pass, and the failure branch carries no such value.
 */

import { describe, expect, test } from 'bun:test';
import * as admissibilityModule from '../src/admissibility/index.ts';
import { admit, collectAdmitted } from '../src/admissibility/index.ts';
import { canonicalize } from '../src/identity/canonicalize.ts';
import { readDescriptorDocuments } from '../src/descriptor/read.ts';
import {
  ADMISSIBLE,
  INADMISSIBLE_AND_COLLIDING,
  INADMISSIBLE_AND_UNIQUE_BULK_IMPORT,
  descriptor,
} from './descriptor-fixtures.ts';
import { ADAPTER_ROOT, importSpecifiers, scanned } from './source-scan.ts';

describe('T048 — the failure branch carries nothing canonicalizable', () => {
  test('an admissible descriptor yields an admitted value', () => {
    const outcome = admit(descriptor(ADMISSIBLE));
    expect(outcome.admissible).toBe(true);
    if (!outcome.admissible) return;
    expect(canonicalize(outcome.admitted).canonicalId).toBe('component:default/payments');
  });

  test('an inadmissible descriptor yields no admitted value at all', () => {
    const outcome = admit(descriptor(INADMISSIBLE_AND_UNIQUE_BULK_IMPORT));
    expect(outcome.admissible).toBe(false);
    expect(outcome).not.toHaveProperty('admitted');
  });

  test('the inadmissible outcome carries no canonical identity of any kind', () => {
    // §4.1: an inadmissible descriptor "never acquires a canonical id".
    const outcome = admit(descriptor(INADMISSIBLE_AND_COLLIDING));
    expect(outcome.admissible).toBe(false);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('canonicalId');
    expect(serialized).not.toContain('allRefs');
    expect(serialized.toLowerCase()).not.toContain('component:default');
  });
});

describe('T048 — canonicalization is unreachable without an admission', () => {
  test('`canonicalize` takes one parameter, and it is the branded admitted type', () => {
    expect(canonicalize.length).toBe(1);
  });

  test('a hand-built object shaped like an admitted descriptor is rejected at compile time', async () => {
    // The brand is a module-private `unique symbol`, so this cannot be expressed
    // in TypeScript at all. Asserting that in a runtime test would require an
    // `as never` cast, which would test the cast rather than the type. What is
    // asserted instead is the property that makes the guarantee real in both
    // directions: the brand is a real runtime symbol, and it is never exported.
    const source = await Bun.file(
      new URL('../src/admissibility/index.ts', import.meta.url),
    ).text();
    expect(source).toContain('const ADMITTED: unique symbol = Symbol(');
    expect(source).not.toContain('export const ADMITTED');
    expect(source).not.toContain('export { ADMITTED');
  });

  test('the brand is not reachable from the module\u2019s exports', () => {
    // Even a cast cannot forge an admission without the symbol, and the symbol is
    // not in the module namespace. `admissibilityModule` is a static namespace
    // import: ADR-0013/FR-002 forbid a dynamic `import()` anywhere in this package.
    const namespace = admissibilityModule as unknown as Record<string, unknown>;
    expect(Object.values(namespace).filter((value) => typeof value === 'symbol')).toEqual([]);
    expect(Object.keys(namespace)).not.toContain('ADMITTED');
  });

  test('the canonicalization module imports from admissibility, never the reverse', () => {
    // If admissibility imported canonicalization, the ordering would be a matter of
    // which function happened to be called first.
    const files = scanned(ADAPTER_ROOT);
    const admissibilityModules = files.filter((file) =>
      file.path.includes('/src/admissibility/'),
    );
    const identityModules = files.filter((file) => file.path.includes('/src/identity/'));

    expect(admissibilityModules.length).toBeGreaterThan(0);
    expect(identityModules.length).toBeGreaterThan(0);

    for (const file of admissibilityModules) {
      for (const specifier of importSpecifiers(file.code)) {
        expect(specifier).not.toContain('identity/');
      }
    }

    const identityImports = identityModules.flatMap((file) => importSpecifiers(file.code));
    expect(identityImports.some((specifier) => specifier.includes('admissibility/'))).toBe(true);
  });
});

describe('T048 — the ordering holds over a batch, in either document order', () => {
  const inadmissibleFirst = readDescriptorDocuments(
    'batch.yaml',
    [
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: "${{ values.name | dump }}"',
      '---',
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: payments',
      '',
    ].join('\n'),
  );

  const inadmissibleLast = readDescriptorDocuments(
    'batch.yaml',
    [
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: payments',
      '---',
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: "${{ values.name | dump }}"',
      '',
    ].join('\n'),
  );

  test('both orderings report the same trigger class', () => {
    // This is §4.1's actual requirement: the reported trigger must not depend on
    // document order within the manifest.
    const first = collectAdmitted(inadmissibleFirst);
    const last = collectAdmitted(inadmissibleLast);

    expect(first.ok).toBe(false);
    expect(last.ok).toBe(false);
    if (first.ok || last.ok) return;

    expect(first.rejection.triggerClass).toBe('inadmissible-descriptor');
    expect(last.rejection.triggerClass).toBe('inadmissible-descriptor');
    expect(first.rejection.reason).toBe(last.rejection.reason);
  });

  test('neither ordering emits an admitted descriptor, including the valid one', () => {
    // §5: "no entity from the same run is emitted, including entities already
    // determined admissible".
    for (const batch of [inadmissibleFirst, inadmissibleLast]) {
      const admission = collectAdmitted(batch);
      expect(admission.ok).toBe(false);
      expect(admission).not.toHaveProperty('admitted');
    }
  });

  test('a wholly admissible batch is admitted in full', () => {
    const admission = collectAdmitted([descriptor(ADMISSIBLE), descriptor({ ...ADMISSIBLE, name: 'billing' })]);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.admitted).toHaveLength(2);
  });
});
