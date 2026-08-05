/**
 * T072 — **overlap between distinct canonical ids is not a collision**, positively
 * demonstrated.
 *
 * `entity-identity.md` §4 requires this "be **positively demonstrated** (both entities'
 * derived `paths` retain the overlapping pattern, and the changed file matches both),
 * not merely asserted by the absence of a rejection rule."
 *
 * Every block below therefore asserts something **present**: that the fixture really
 * does overlap, that both entities survive into the envelope, that both retain the
 * shared pattern, and that a changed file matching it is owned by both. "The run did
 * not abort" appears only alongside those, never instead of them — a generator that had
 * silently dropped one of the two would also not abort.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createGlobCompiler } from '../src/glob/dialect.ts';
import { hasOverlap, ownersOf, pathOverlaps } from '../src/identity/overlap.ts';
import { checkGlobalUniqueness } from '../src/identity/uniqueness.ts';
import { runGeneration } from '../src/pipeline.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

const SHARED = 'packages/shared/**';

/** §4's own worked example: `billing` and `invoicing` both declaring `packages/shared/**`. */
const CLAIMS = [
  { canonicalId: 'component:default/billing', derivedPaths: ['packages/billing/**', SHARED] },
  { canonicalId: 'component:default/invoicing', derivedPaths: ['packages/invoicing/**', SHARED] },
];

let checkout: Checkout;

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T072 — the fixture genuinely overlaps', () => {
  test('overlap is present, so nothing below passes vacuously', () => {
    expect(hasOverlap(CLAIMS)).toBe(true);
  });

  test('the overlapping pattern is named, and both claimants are listed', () => {
    expect(pathOverlaps(CLAIMS)).toEqual([
      { pattern: SHARED, canonicalIds: ['component:default/billing', 'component:default/invoicing'] },
    ]);
  });

  test('a set with no shared pattern reports no overlap', () => {
    expect(
      hasOverlap([
        { canonicalId: 'component:default/a', derivedPaths: ['packages/a/**'] },
        { canonicalId: 'component:default/b', derivedPaths: ['packages/b/**'] },
      ]),
    ).toBe(false);
  });

  test('one entity listing a pattern twice is not an overlap with itself', () => {
    expect(
      hasOverlap([{ canonicalId: 'component:default/a', derivedPaths: [SHARED, SHARED] }]),
    ).toBe(false);
  });
});

describe('T072 / §4 — overlap does not trigger the abort', () => {
  test('the distinct canonical ids pass the uniqueness check', () => {
    const outcome = checkGlobalUniqueness(
      CLAIMS.map((claim) => ({ canonicalId: claim.canonicalId, allRefs: [claim.canonicalId] })),
    );
    expect(outcome.ok).toBe(true);
  });

  test('a real run over two overlapping entities produces an envelope with both', async () => {
    const { request } = await stage(checkout, {
      'billing/catalog-info.yaml': validDescriptor('billing', `["packages/billing/**","${SHARED}"]`),
      'invoicing/catalog-info.yaml': validDescriptor('invoicing', `["packages/invoicing/**","${SHARED}"]`),
    });

    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Present-tense assertions: both entities exist, and both retain the pattern.
    expect(outcome.envelope.entities).toHaveLength(2);
    const ids = outcome.envelope.entities.map((entity) => entity.identity.canonicalId).sort();
    expect(ids).toEqual(['component:default/billing', 'component:default/invoicing']);

    for (const entity of outcome.envelope.entities) {
      expect(entity.derivedPaths).toContain(SHARED);
    }
  });
});

describe('T072 / §4 — no exclusive winner: a changed file is owned by every match', () => {
  test('both entities own a file matching the shared pattern', () => {
    const owners = ownersOf(CLAIMS, 'packages/shared/util.ts', createGlobCompiler());
    expect(owners).toEqual(['component:default/billing', 'component:default/invoicing']);
    expect(owners).toHaveLength(2);
  });

  test('a file matching only one pattern is owned by only that entity', () => {
    // Contrast case. Without it, "both entities were returned" would be equally
    // consistent with a function that returns every entity for every path.
    expect(ownersOf(CLAIMS, 'packages/billing/index.ts', createGlobCompiler())).toEqual([
      'component:default/billing',
    ]);
  });

  test('a file matching nothing is owned by nobody', () => {
    expect(ownersOf(CLAIMS, 'docs/readme.md', createGlobCompiler())).toEqual([]);
  });

  test('the result is a list, so a caller cannot read "the owner" off it', () => {
    const owners = ownersOf(CLAIMS, 'packages/shared/util.ts', createGlobCompiler());
    expect(Array.isArray(owners)).toBe(true);
    // ADR-0009's union-not-winner semantics, mirrored: the second entity is not a
    // runner-up, it is an owner.
    expect(owners[1]).toBe('component:default/invoicing');
  });

  test('ownership does not depend on the order the claims are listed in', () => {
    const forwards = ownersOf(CLAIMS, 'packages/shared/util.ts', createGlobCompiler());
    const backwards = ownersOf([...CLAIMS].reverse(), 'packages/shared/util.ts', createGlobCompiler());
    expect(backwards).toEqual(forwards);
  });
});
