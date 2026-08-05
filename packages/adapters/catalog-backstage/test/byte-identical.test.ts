/**
 * T083 / FR-042 — **byte-identical** output across repeated runs over identical input.
 *
 * ADR-0012 and Constitution Principle IV. FR-042: "Identical inputs MUST produce
 * **byte-identical** output across repeated runs, including array ordering and
 * serialization details."
 *
 * # Compared as bytes, not as objects
 *
 * `toEqual` on two parsed envelopes would pass for two serializations differing in key
 * order, whitespace, or number formatting — all of which are "serialization details"
 * FR-042 names explicitly. So every comparison here is on the **serialized string** and,
 * for the strongest one, on the actual file bytes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serializeEnvelope } from '../src/envelope/write.ts';
import { generateAndWriteEnvelope, runGeneration } from '../src/pipeline.ts';
import type { GenerationRequest } from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let output: string;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-bytes-'));
});

afterAll(async () => {
  await checkout.dispose();
  await rm(output, { recursive: true, force: true });
});

/**
 * A deliberately varied corpus.
 *
 * All three ownership states, several kinds, a namespaced entity, a multi-document
 * file, overlapping patterns, and patterns whose declared order differs from their
 * sorted order — so a run that failed to sort, or sorted the wrong array, differs
 * observably rather than coincidentally matching.
 */
async function variedCorpus(manifestName: string): Promise<GenerationRequest> {
  const multi = `${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    name: 'zulu',
    ownedPaths: '["zeta/**","alpha/**","middle/**","alpha/**"]',
  })}---\n${descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    name: 'yankee',
    namespace: 'payments',
    ownedPaths: '[]',
  })}`;

  const { request } = await stage(
    checkout,
    {
      'zzz/catalog-info.yaml': validDescriptor('zzzlast', '["shared/**","packages/z/**"]'),
      'aaa/catalog-info.yaml': multi,
      'mmm/catalog-info.yaml': validDescriptor('mmmmiddle'),
      'nnn/catalog-info.yaml': validDescriptor('nnnother', '["shared/**"]'),
    },
    {},
    manifestName,
  );
  return request;
}

describe('T083 — the fixture is varied enough for a difference to show', () => {
  test('it spans all three ownership states and several source files', async () => {
    const outcome = await runGeneration(await variedCorpus('bytes-shape.json'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.envelope.entities).toHaveLength(5);
    expect(new Set(outcome.envelope.entities.map((entity) => entity.ownershipState)).size).toBe(3);
    expect(outcome.envelope.sources).toHaveLength(4);
  });

  test('a declared pattern order differing from the sorted order is normalized', async () => {
    // Without this the byte comparison could pass on a corpus that never needed
    // sorting, which would leave the ordering half of FR-042 untested.
    const outcome = await runGeneration(await variedCorpus('bytes-order.json'));
    if (!outcome.ok) throw new Error('expected success');

    const zulu = outcome.envelope.entities.find(
      (entity) => entity.identity.canonicalId === 'component:default/zulu',
    );
    expect(zulu?.derivedPaths).toEqual(['alpha/**', 'middle/**', 'zeta/**']);
  });
});

describe('T083 / FR-042 — repeated runs are byte-identical', () => {
  test('two runs over identical input serialize identically', async () => {
    const first = await runGeneration(await variedCorpus('bytes-two-a.json'));
    const second = await runGeneration(await variedCorpus('bytes-two-a.json'));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(serializeEnvelope(second.envelope)).toBe(serializeEnvelope(first.envelope));
    expect(second.envelope.digest).toBe(first.envelope.digest);
  });

  test('two files written by two runs have identical bytes', async () => {
    const request = await variedCorpus('bytes-files.json');
    const a = join(output, 'a', 'envelope.json');
    const b = join(output, 'b', 'envelope.json');

    await generateAndWriteEnvelope(request, a);
    await generateAndWriteEnvelope(request, b);

    const [bytesA, bytesB] = await Promise.all([readFile(a), readFile(b)]);
    expect(bytesB.equals(bytesA)).toBe(true);
  });

  test('the stage trace is identical too', async () => {
    const first = await runGeneration(await variedCorpus('bytes-trace.json'));
    const second = await runGeneration(await variedCorpus('bytes-trace.json'));
    expect(second.stages).toEqual(first.stages);
  });
});

describe('T083 — output is a function of content, not of input ordering', () => {
  test('listing the same sources in a different manifest order yields the same entities', async () => {
    // The entity list follows manifest declaration order, so the two envelopes differ
    // in `entities` order by design — but each entity's own record, and the source
    // list, must be identical. Anything else would mean an entity's content depended on
    // where its file was listed.
    const forwards = await stage(
      checkout,
      {
        'ord-a/catalog-info.yaml': validDescriptor('ordone', '["packages/one/**"]'),
        'ord-b/catalog-info.yaml': validDescriptor('ordtwo', '["packages/two/**"]'),
      },
      {},
      'bytes-order-forwards.json',
    );
    const backwards = await stage(
      checkout,
      {
        'ord-b/catalog-info.yaml': validDescriptor('ordtwo', '["packages/two/**"]'),
        'ord-a/catalog-info.yaml': validDescriptor('ordone', '["packages/one/**"]'),
      },
      {},
      'bytes-order-backwards.json',
    );

    const first = await runGeneration(forwards.request);
    const second = await runGeneration(backwards.request);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // `sources` is sorted by path, so it is order-independent outright.
    expect(second.envelope.sources).toEqual(first.envelope.sources);

    const byId = (outcome: typeof first) =>
      outcome.ok
        ? new Map(outcome.envelope.entities.map((entity) => [entity.identity.canonicalId, entity]))
        : new Map();
    expect(byId(second).get('component:default/ordone')).toEqual(
      byId(first).get('component:default/ordone'),
    );
  });

  test('any content change changes the bytes', async () => {
    // The converse. Without it, "identical bytes" would be equally consistent with a
    // serializer that ignored its input.
    // Distinct paths, deliberately: staging two contents at one path would leave the
    // first manifest declaring a digest for bytes that are no longer there, and the run
    // would abort with `digest-mismatch` — which is the digest check working, not the
    // property under test here.
    const original = await stage(
      checkout,
      { 'chg-a/catalog-info.yaml': validDescriptor('changecase', '["packages/a/**"]') },
      {},
      'bytes-change-a.json',
    );
    const changed = await stage(
      checkout,
      { 'chg-b/catalog-info.yaml': validDescriptor('changecase', '["packages/b/**"]') },
      {},
      'bytes-change-b.json',
    );

    const first = await runGeneration(original.request);
    const second = await runGeneration(changed.request);
    if (!first.ok || !second.ok) throw new Error('expected both to succeed');

    expect(serializeEnvelope(second.envelope)).not.toBe(serializeEnvelope(first.envelope));
    expect(second.envelope.digest).not.toBe(first.envelope.digest);
  });
});
