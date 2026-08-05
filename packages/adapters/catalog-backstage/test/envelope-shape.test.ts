/**
 * T080 / FR-039 — the envelope's declared fields, and **exactly five** fields per
 * `entities[]` record. The flatter triple shape is forbidden.
 *
 * # Every assertion here is made against the emitted JSON
 *
 * A TypeScript interface does not enforce field counts at run time — excess-property
 * checking applies to object literals only and is erased entirely once compiled. So the
 * checks below round-trip the envelope through `serializeEnvelope` and `JSON.parse`
 * and inspect the **parsed object's own keys**, which is where the constraint is
 * actually observable and where a consumer will meet it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  ENTITY_RECORD_FIELDS,
  ENVELOPE_CAPABILITIES,
  ENVELOPE_SCHEMA_VERSION,
  ENVELOPE_TOP_LEVEL_FIELDS,
  FORBIDDEN_FLAT_ENTITY_FIELDS,
  IDENTITY_PROJECTION_FIELDS,
  entityRecord,
} from '../src/envelope/shape.ts';
import { serializeEnvelope } from '../src/envelope/write.ts';
import { GLOB_OPTIONS } from '../src/glob/dialect.ts';
import { runGeneration } from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let parsed: Record<string, unknown>;

beforeAll(async () => {
  checkout = await createCheckout();

  const multiDocument = `${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    name: 'shapeone',
    ownedPaths: '["packages/one/**"]',
  })}---\n${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    name: 'shapetwo',
    namespace: 'payments',
    ownedPaths: '[]',
  })}`;

  const { request } = await stage(checkout, {
    'a/catalog-info.yaml': multiDocument,
    'b/catalog-info.yaml': validDescriptor('shapethree'),
  });

  const outcome = await runGeneration(request);
  if (!outcome.ok) throw new Error(`fixture failed to generate: ${outcome.failure.detail}`);
  parsed = JSON.parse(serializeEnvelope(outcome.envelope)) as Record<string, unknown>;
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T080 — the fixture is rich enough for the checks to mean something', () => {
  test('three entities, spanning several kinds, namespaces and ownership states', () => {
    const entities = parsed['entities'] as Record<string, unknown>[];
    expect(entities).toHaveLength(3);
    expect(new Set(entities.map((entity) => entity['ownershipState'])).size).toBe(3);
  });
});

describe('T080 / data-model.md §9 — nine top-level fields', () => {
  test('the declared list has nine entries', () => {
    expect(ENVELOPE_TOP_LEVEL_FIELDS).toHaveLength(9);
  });

  test('the emitted object carries exactly those nine, no more and no fewer', () => {
    expect(Object.keys(parsed).sort()).toEqual([...ENVELOPE_TOP_LEVEL_FIELDS].sort());
  });

  test('field order in the emitted JSON follows the contract\u2019s order', () => {
    // Irrelevant to the digest, which sorts keys, but it is what makes the *file*
    // byte-identical across runs independently of the digest (FR-042).
    expect(Object.keys(parsed)).toEqual([...ENVELOPE_TOP_LEVEL_FIELDS]);
  });

  test('schemaVersion and capabilities are the exact values the consumer validates', () => {
    // `snapshot-envelope.md` §2 step 3 validates both "by **exact value**, not merely
    // 'recognized'". A generator able to emit anything else could emit an envelope its
    // own consumer rejects.
    expect(parsed['schemaVersion']).toBe(ENVELOPE_SCHEMA_VERSION);
    expect(parsed['schemaVersion']).toBe('1');
    expect(parsed['capabilities']).toEqual([...ENVELOPE_CAPABILITIES]);
    expect(parsed['capabilities']).toEqual(['pathOwnership']);
  });

  test('globDialect records the engine and options actually used', () => {
    expect(parsed['globDialect']).toEqual({
      engine: 'picomatch',
      version: expect.any(String),
      options: { ...GLOB_OPTIONS },
    });
  });

  test('the nested objects carry their declared fields', () => {
    expect(Object.keys(parsed['repository'] as object).sort()).toEqual(['id', 'revision']);
    expect(Object.keys(parsed['completeness'] as object).sort()).toEqual([
      'identityOnly',
      'wholeCatalog',
    ]);
    for (const source of parsed['sources'] as Record<string, unknown>[]) {
      expect(Object.keys(source).sort()).toEqual(['digest', 'digestAlgorithm', 'path']);
    }
  });
});

describe('T080 / data-model.md §10 — exactly five fields per entity record', () => {
  test('the declared list has five entries', () => {
    expect(ENTITY_RECORD_FIELDS).toHaveLength(5);
  });

  test('every emitted record carries exactly those five', () => {
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      expect(Object.keys(entity).sort()).toEqual([...ENTITY_RECORD_FIELDS].sort());
      expect(Object.keys(entity)).toHaveLength(5);
    }
  });

  test('the identity projection is `{ canonicalId, allRefs }` and nothing else', () => {
    // `snapshot-envelope.md` §1: the pre-lowercase authoring inputs are "already fully
    // captured by `canonicalId` and `allRefs`". Serializing them would put the authored
    // casing back into an artifact whose point is the canonical form.
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      const identity = entity['identity'] as Record<string, unknown>;
      expect(Object.keys(identity).sort()).toEqual([...IDENTITY_PROJECTION_FIELDS].sort());
      expect(Array.isArray(identity['allRefs'])).toBe(true);
      expect((identity['allRefs'] as string[]).length).toBeGreaterThan(0);
    }
  });

  test('the sourceDocument reference is `{ sourcePath, documentIndexInFile }`', () => {
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      const reference = entity['sourceDocument'] as Record<string, unknown>;
      expect(Object.keys(reference).sort()).toEqual(['documentIndexInFile', 'sourcePath']);
      expect(Number.isInteger(reference['documentIndexInFile'])).toBe(true);
    }
  });

  test('a multi-document file yields distinct documentIndexInFile values', () => {
    const fromA = (parsed['entities'] as Record<string, unknown>[])
      .map((entity) => entity['sourceDocument'] as Record<string, unknown>)
      .filter((reference) => reference['sourcePath'] === 'a/catalog-info.yaml')
      .map((reference) => reference['documentIndexInFile']);
    expect(fromA).toEqual([0, 1]);
  });
});

describe('T080 — the flatter shape is forbidden', () => {
  test('no entity record carries a flat canonicalId, refs or paths field', () => {
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      for (const forbidden of FORBIDDEN_FLAT_ENTITY_FIELDS) {
        expect(Object.hasOwn(entity, forbidden)).toBe(false);
      }
    }
  });

  test('the forbidden list is checked by name, not inferred from a field count', () => {
    // A `{ canonicalId, refs, paths }` triple has three fields, so a count-only check
    // would reject it for the wrong reason and would keep passing if two more fields
    // were later added to reach five.
    expect(FORBIDDEN_FLAT_ENTITY_FIELDS).toContain('canonicalId');
    expect(FORBIDDEN_FLAT_ENTITY_FIELDS).toContain('refs');
    expect(FORBIDDEN_FLAT_ENTITY_FIELDS).toContain('paths');
  });

  test('the authoring fields §1 excludes are not serialized', () => {
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      const identity = entity['identity'] as Record<string, unknown>;
      for (const excluded of ['rawKind', 'rawNamespace', 'rawName', 'fixtureAuthoredAliasRefs']) {
        expect(Object.hasOwn(identity, excluded)).toBe(false);
      }
    }
  });
});

describe('T080 — entityRecord projects rather than spreads', () => {
  test('an input carrying extra fields does not leak them into the record', () => {
    const record = entityRecord({
      canonicalId: 'component:default/a',
      allRefs: ['component:default/a'],
      ownershipState: 'annotation-absent',
      derivedPaths: [],
      sourcePath: 'a.yaml',
      documentIndexInFile: 0,
      provenance: 'maintainer-overlay',
      // A field the projection must ignore. A spread-based implementation would carry
      // it through, which is the failure this check exists for.
      ...({ rawKind: 'Component' } as unknown as Record<string, never>),
    });

    expect(Object.keys(record).sort()).toEqual([...ENTITY_RECORD_FIELDS].sort());
    expect(Object.hasOwn(record, 'rawKind')).toBe(false);
  });
});
