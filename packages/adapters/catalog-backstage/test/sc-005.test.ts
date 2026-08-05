/**
 * T061 — SC-005 close-out.
 *
 * SC-005 (`spec.md`): *"Across a fixture set containing all three ownership states,
 * each entity's recorded `ownershipState` is exactly one of `explicit-paths`,
 * `explicit-empty`, `annotation-absent`; no two are treated as equivalent; and no
 * path is ever derived for an `annotation-absent` entity."*
 *
 * This file consolidates over a single fixture set containing all three, rather than
 * restating T057–T060's individual contract citations. The fixture set is
 * hand-authored YAML, decoded through the real descriptor reader, so the three
 * states arise the way they would in a run rather than by being constructed
 * directly.
 */

import { describe, expect, test } from 'bun:test';
import { readAnnotationNode, readDescriptorDocuments } from '../src/descriptor/read.ts';
import { createGlobCompiler } from '../src/glob/dialect.ts';
import { OWNED_PATHS_ANNOTATION } from '../src/ownership/annotation.ts';
import { type OwnershipDerivation, deriveOwnership } from '../src/ownership/derive.ts';
import { OWNERSHIP_STATES, type OwnershipState } from '../src/ownership/states.ts';

/** One descriptor per state, in one file, as a real corpus file might hold them. */
const FIXTURE_SET = [
  // explicit-paths
  'apiVersion: backstage.io/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: payments',
  '  annotations:',
  '    adrkit.io/owned-paths: \'["packages/payments/**", "docs/payments/*.md"]\'',
  '---',
  // explicit-empty
  'apiVersion: backstage.io/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: billing',
  '  annotations:',
  "    adrkit.io/owned-paths: '[]'",
  '---',
  // annotation-absent
  'apiVersion: backstage.io/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: shipping',
  '',
].join('\n');

const compiler = createGlobCompiler();

const derivations: readonly { readonly name: string; readonly derivation: OwnershipDerivation }[] =
  readDescriptorDocuments('catalog-info.yaml', FIXTURE_SET).map((document) => {
    const node = readAnnotationNode(document, OWNED_PATHS_ANNOTATION);
    const metadata = document.rawMetadata as { name: string };
    return { name: metadata.name, derivation: deriveOwnership(node.present, node.value, compiler) };
  });

function stateOf(name: string): OwnershipState {
  const found = derivations.find((entry) => entry.name === name);
  if (found === undefined || !found.derivation.ok) {
    throw new Error(`fixture ${name} did not derive`);
  }
  return found.derivation.value.ownershipState;
}

function pathsOf(name: string): readonly string[] {
  const found = derivations.find((entry) => entry.name === name);
  if (found === undefined || !found.derivation.ok) {
    throw new Error(`fixture ${name} did not derive`);
  }
  return found.derivation.value.derivedPaths;
}

describe('SC-005 — the fixture set contains all three states', () => {
  test('three descriptors parsed, each deriving successfully', () => {
    expect(derivations).toHaveLength(3);
    expect(derivations.every((entry) => entry.derivation.ok)).toBe(true);
  });

  test('all three states are present, and they are the three the contract names', () => {
    const observed = derivations.map((entry) =>
      entry.derivation.ok ? entry.derivation.value.ownershipState : 'failed',
    );
    expect(observed).toEqual(['explicit-paths', 'explicit-empty', 'annotation-absent']);
    expect([...new Set(observed)].sort()).toEqual([...OWNERSHIP_STATES].sort());
  });
});

describe('SC-005 — each recorded state is exactly one of the three', () => {
  test.each(['payments', 'billing', 'shipping'])('%s', (name) => {
    const state = stateOf(name);
    expect(OWNERSHIP_STATES).toContain(state);
    expect(OWNERSHIP_STATES.filter((candidate) => candidate === state)).toHaveLength(1);
  });

  test('no entity carries a fourth state, or two', () => {
    for (const entry of derivations) {
      expect(entry.derivation.ok).toBe(true);
      if (!entry.derivation.ok) continue;
      expect(typeof entry.derivation.value.ownershipState).toBe('string');
      expect(OWNERSHIP_STATES).toContain(entry.derivation.value.ownershipState);
    }
  });
});

describe('SC-005 — no two states are treated as equivalent', () => {
  test('the three states are three distinct values', () => {
    expect(new Set([stateOf('payments'), stateOf('billing'), stateOf('shipping')]).size).toBe(3);
  });

  test('`explicit-empty` and `annotation-absent` are distinguished despite identical paths', () => {
    expect(pathsOf('billing')).toEqual(pathsOf('shipping'));
    expect(stateOf('billing')).not.toBe(stateOf('shipping'));
  });

  test('the distinction survives serialization, so an envelope could carry it', () => {
    // The non-conflation rule is about what the *record* preserves, not only about
    // what an in-memory value happens to hold.
    const billing = JSON.parse(
      JSON.stringify(derivations.find((entry) => entry.name === 'billing')),
    ) as { derivation: { value: { ownershipState: string } } };
    const shipping = JSON.parse(
      JSON.stringify(derivations.find((entry) => entry.name === 'shipping')),
    ) as { derivation: { value: { ownershipState: string } } };

    expect(billing.derivation.value.ownershipState).toBe('explicit-empty');
    expect(shipping.derivation.value.ownershipState).toBe('annotation-absent');
  });

  test('the presence discriminant differs even where the state name were ignored', () => {
    const billing = derivations.find((entry) => entry.name === 'billing');
    const shipping = derivations.find((entry) => entry.name === 'shipping');
    if (billing === undefined || shipping === undefined) return;
    if (!billing.derivation.ok || !shipping.derivation.ok) return;
    expect(billing.derivation.value.annotation.annotationPresent).toBe(true);
    expect(shipping.derivation.value.annotation.annotationPresent).toBe(false);
  });
});

describe('SC-005 — no path is ever derived for an `annotation-absent` entity', () => {
  test('`shipping` derives nothing', () => {
    expect(stateOf('shipping')).toBe('annotation-absent');
    expect(pathsOf('shipping')).toEqual([]);
  });

  test('and no pattern was even classified for it', () => {
    const shipping = derivations.find((entry) => entry.name === 'shipping');
    if (shipping === undefined || !shipping.derivation.ok) return;
    expect(shipping.derivation.value.patterns).toEqual([]);
  });

  test('the glob compiler was never invoked on its behalf', () => {
    // Two patterns exist in the whole fixture set, both on `payments`. If an absent
    // annotation had derived anything, the count would be higher.
    expect(compiler.patternCount).toBe(2);
    expect(compiler.compileCount).toBe(2);
  });

  test('`explicit-paths` did derive, so "derives nothing" is not vacuous', () => {
    expect(pathsOf('payments')).toEqual(['docs/payments/*.md', 'packages/payments/**']);
  });
});
