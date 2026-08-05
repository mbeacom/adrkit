/**
 * T070 — `completeness.wholeCatalog` is `false` **unconditionally**, in every envelope,
 * on every path. There is no configuration, flag, or input that can make it `true`.
 *
 * FR-014 and `input-manifest.md` §5's fourth bullet.
 *
 * # How "no input can change it" is checked without enumerating every input
 *
 * Two complementary checks, because neither is sufficient alone:
 *
 * - **By construction**: `completeness()` takes one parameter and it is not
 *   `wholeCatalog`, so there is no argument through which a caller could set it. That is
 *   asserted by calling it with both values of the parameter it does take.
 * - **By observation**: every envelope produced across a varied set of real runs —
 *   different entity counts, ownership states, source counts — carries `false`. That
 *   catches an assembly path that bypassed `completeness()` altogether, which the first
 *   check cannot see.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  WHOLE_CATALOG_COMPLETENESS,
  completeness,
} from '../src/envelope/completeness.ts';
import { WHOLE_CATALOG_COMPLETENESS as BOUNDARY_CONSTANT } from '../src/manifest/boundary.ts';
import { runGeneration } from '../src/pipeline.ts';
import { descriptor } from './pipeline-fixtures.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T070 — the value is false, and it is one value not two', () => {
  test('the boundary constant is false', () => {
    expect(BOUNDARY_CONSTANT).toBe(false);
  });

  test('the envelope module re-exports that constant rather than declaring a second', () => {
    // A second `false` here could stay `false` while the boundary's changed, and the
    // check would then pass against a constant nothing uses.
    expect(WHOLE_CATALOG_COMPLETENESS).toBe(BOUNDARY_CONSTANT);
  });
});

describe('T070 — no parameter can set it', () => {
  test('identityOnly false leaves wholeCatalog false', () => {
    expect(completeness(false)).toEqual({ wholeCatalog: false, identityOnly: false });
  });

  test('identityOnly true still leaves wholeCatalog false', () => {
    expect(completeness(true)).toEqual({ wholeCatalog: false, identityOnly: true });
  });

  test('the function takes exactly one parameter, and it is not wholeCatalog', () => {
    // `Function.length` counts declared parameters. A second parameter appearing here
    // is the first sign someone has made the value configurable.
    expect(completeness.length).toBe(1);
  });
});

describe('T070 — every envelope a real run produces carries false', () => {
  test('a single-entity run', async () => {
    const { request } = await stage(
      checkout,
      { 'one/catalog-info.yaml': validDescriptor('one', '["packages/one/**"]') },
      {},
      'manifest-one.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.envelope.completeness.wholeCatalog).toBe(false);
  });

  test('a run over all three ownership states and several sources', async () => {
    const { request } = await stage(
      checkout,
      {
        'explicit/catalog-info.yaml': validDescriptor('explicitpaths', '["packages/explicit/**"]'),
        'empty/catalog-info.yaml': validDescriptor('explicitempty', '[]'),
        'absent/catalog-info.yaml': validDescriptor('annotationabsent'),
      },
      {},
      'manifest-states.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.envelope.entities.map((entity) => entity.ownershipState).sort()).toEqual([
      'annotation-absent',
      'explicit-empty',
      'explicit-paths',
    ]);
    expect(outcome.envelope.completeness.wholeCatalog).toBe(false);
  });

  test('a run over a multi-document source file', async () => {
    const text = `${descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      name: 'multione',
    })}---\n${descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      name: 'multitwo',
    })}`;
    const { request } = await stage(checkout, { 'multi/catalog-info.yaml': text }, {}, 'manifest-multi.json');

    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.envelope.entities).toHaveLength(2);
    expect(outcome.envelope.completeness.wholeCatalog).toBe(false);
  });

  test('a run with identityOnly requested still reports wholeCatalog false', async () => {
    const { request } = await stage(
      checkout,
      { 'idonly/catalog-info.yaml': validDescriptor('idonly') },
      {},
      'manifest-idonly.json',
    );
    const outcome = await runGeneration({ ...request, identityOnly: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.envelope.completeness).toEqual({ wholeCatalog: false, identityOnly: true });
  });
});
