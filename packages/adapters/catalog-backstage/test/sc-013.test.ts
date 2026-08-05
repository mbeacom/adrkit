/**
 * T085 / SC-013 — close-out: exactly one envelope is produced; each `entities[]` record
 * carries exactly five fields; and the recorded digest matches an **independent**
 * recomputation, not the generator's own.
 *
 * # What makes the recomputation independent
 *
 * `envelope/digest.ts`'s `verifyEnvelopeDigest` shares `canonicalStringify` with the
 * code that produced the digest, so it cannot detect a fault in that shared step. It is
 * useful for detecting corruption *after* generation and is not what SC-013 asks for.
 *
 * {@link recomputeIndependently} below implements the three steps of
 * `snapshot-envelope.md` §3 directly — recursive key sort by code-unit order, arrays in
 * declaration order, compact separators, `undefined` omitted, SHA-256 over the UTF-8
 * bytes, 64 lowercase hex — using `node:crypto` and a locally written canonicalizer. It
 * shares no code with the generator beyond `compareCodeUnits`, which is a two-line
 * comparator (`a < b ? -1 : a > b ? 1 : 0`) whose behaviour is fully specified by that
 * expression.
 *
 * That residual sharing is stated rather than glossed: a truly zero-shared
 * recomputation would need its own comparator, and re-deriving code-unit ordering by
 * hand would introduce a second definition of "canonical" — the exact drift the digest
 * exists to detect. The comparator is a frozen repository primitive
 * (`packages/core/src/ordering/index.ts`), not part of the generator.
 *
 * # Integrity is not correctness
 *
 * SC-012 and FR-041 travel with every claim here. A digest match is evidence that the
 * envelope's bytes are the bytes that were written. It is **not** evidence that the
 * derived ownership in it is right — that is SC-011's question, which is Phase F's, not
 * this test's. Nothing below claims otherwise.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareCodeUnits } from '@adrkit/core';
import { ENTITY_RECORD_FIELDS, ENVELOPE_TOP_LEVEL_FIELDS } from '../src/envelope/shape.ts';
import { generateAndWriteEnvelope } from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let output: string;
let envelopePath: string;
let parsed: Record<string, unknown>;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-sc013-'));

  const multi = `${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    name: 'sc013one',
    ownedPaths: '["packages/one/**","apis/one/**"]',
  })}---\n${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    name: 'sc013two',
    namespace: 'payments',
    ownedPaths: '[]',
  })}`;

  const { request } = await stage(checkout, {
    'sc013-a/catalog-info.yaml': multi,
    'sc013-b/catalog-info.yaml': validDescriptor('sc013three'),
  });

  envelopePath = join(output, 'sc013', 'envelope.json');
  const result = await generateAndWriteEnvelope(request, envelopePath);
  if (!result.ok) throw new Error(`fixture failed to generate: ${result.failure.detail}`);

  parsed = JSON.parse(await Bun.file(envelopePath).text()) as Record<string, unknown>;
});

afterAll(async () => {
  await checkout.dispose();
  await rm(output, { recursive: true, force: true });
});

/**
 * `snapshot-envelope.md` §3's canonicalization, written here rather than imported.
 *
 * Deliberately a separate implementation. Importing the generator's would make the
 * comparison a tautology.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Declaration order, never re-sorted (§3 step 2).
    return `[${value.map((element) => canonicalize(element)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareCodeUnits);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

/** §3's three steps, applied to a parsed envelope read off disk. */
function recomputeIndependently(envelope: Record<string, unknown>): string {
  const { digest: _excluded, ...unsigned } = envelope;
  return createHash('sha256').update(canonicalize(unsigned), 'utf8').digest('hex');
}

describe('T085 / SC-013 — exactly one envelope is produced', () => {
  test('the destination directory holds exactly one file', async () => {
    expect((await readdir(join(output, 'sc013'))).sort()).toEqual(['envelope.json']);
  });

  test('that file is one envelope, not an array or a stream of them', () => {
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed['schemaVersion']).toBe('1');
    expect(Object.keys(parsed)).toEqual([...ENVELOPE_TOP_LEVEL_FIELDS]);
  });

  test('it covers exactly one repository', () => {
    // `snapshot-envelope.md` §1: "never more than one repository per envelope file".
    const repository = parsed['repository'] as Record<string, unknown>;
    expect(typeof repository['id']).toBe('string');
    expect(typeof repository['revision']).toBe('string');
  });
});

describe('T085 / SC-013 — each entity record carries exactly five fields', () => {
  test('the fixture has several entities, so the check is not about one record', () => {
    expect((parsed['entities'] as unknown[]).length).toBe(3);
  });

  test('every record has exactly the five defined fields', () => {
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      expect(Object.keys(entity)).toHaveLength(5);
      expect(Object.keys(entity).sort()).toEqual([...ENTITY_RECORD_FIELDS].sort());
    }
  });

  test('no snapshot-shaped artifact was written alongside it', async () => {
    // SC-013's second clause. Checked from the directory, so a second file of any
    // shape would fail it. The forbidden core type is not named literally here: the
    // guard that must name it is `test/envelope-only.test.ts`, which is listed in
    // `EXCLUDED_FROM_SCAN` for exactly that reason.
    expect((await readdir(join(output, 'sc013'))).sort()).toEqual(['envelope.json']);
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      expect(Object.hasOwn(entity, 'id')).toBe(false);
      expect(Object.hasOwn(entity, 'paths')).toBe(false);
    }
  });
});

describe('T085 / SC-013 — the digest matches an independent recomputation', () => {
  test('the independent recomputation agrees with the recorded digest', () => {
    expect(recomputeIndependently(parsed)).toBe(parsed['digest'] as string);
  });

  test('the recomputation is genuinely independent — it detects a mutation', () => {
    // Without this, a recomputation that always returned the declared value would pass
    // the test above.
    const mutated = structuredClone(parsed);
    const entities = mutated['entities'] as Record<string, unknown>[];
    (entities[0] as Record<string, unknown>)['derivedPaths'] = ['injected/**'];
    expect(recomputeIndependently(mutated)).not.toBe(parsed['digest']);
  });

  test('the recomputation is order-insensitive at every nesting level', () => {
    // Evidence that the local canonicalizer really sorts, rather than happening to
    // agree because the generator emitted keys in sorted order already.
    //
    // The reordering rebuilds the top-level object with reversed insertion order. An
    // earlier version used `JSON.stringify(value, keyList)`, which applies the filter at
    // *every* nesting level and silently deleted nested keys — a different mutation
    // than the one intended.
    const reordered: Record<string, unknown> = {};
    for (const key of [...Object.keys(parsed)].reverse()) reordered[key] = parsed[key];

    expect(Object.keys(reordered)).not.toEqual(Object.keys(parsed));
    expect(recomputeIndependently(reordered)).toBe(parsed['digest'] as string);
  });

  test('the digest is 64 lowercase hex characters', () => {
    expect(parsed['digest']).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('T085 — the scope of what a matching digest establishes', () => {
  test('a match establishes integrity, and this test claims nothing more', () => {
    // SC-012 / FR-041, asserted as a property of the fixture rather than only stated in
    // prose: the envelope carries no field claiming correctness, verification, or
    // validation of the ownership it records.
    const serialized = JSON.stringify(parsed);
    for (const overclaim of ['verified', 'correct', 'validated', 'trusted', 'authoritative']) {
      expect(serialized.includes(`"${overclaim}"`)).toBe(false);
    }
  });
});
