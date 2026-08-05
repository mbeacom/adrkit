/**
 * T084 / SC-001 — determinism across **at least three** runs, on the **accept path and
 * the reject path alike**.
 *
 * SC-001: "Running the generator three or more times over identical inputs produces
 * byte-identical output on every run, including every array's ordering — on the accept
 * path and on the reject path alike."
 *
 * # The reject path is half the criterion, not an afterthought
 *
 * A deterministic rejection matters for the same reason a deterministic envelope does:
 * ADR-0016 records the **exact emitted string** as evidence, and a reason string that
 * varies between runs is not evidence of anything. A rejection is deterministic when the
 * trigger class, the reason, the detail, the stage, and the location are all identical
 * across runs — including for inputs violating **several** rules at once, where a
 * non-deterministic implementation would report whichever the iteration order surfaced.
 *
 * # Three is a floor, not the number
 *
 * {@link RUNS} is 5. SC-001 says "three or more".
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { serializeEnvelope } from '../src/envelope/write.ts';
import { runGeneration } from '../src/pipeline.ts';
import type { GenerationRequest } from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

/** SC-001 requires three or more. */
const RUNS = 5;

let checkout: Checkout;

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

async function repeat<T>(times: number, run: () => Promise<T>): Promise<readonly T[]> {
  const results: T[] = [];
  for (let index = 0; index < times; index += 1) results.push(await run());
  return results;
}

describe('T084 / SC-001 — the accept path', () => {
  let request: GenerationRequest;

  beforeAll(async () => {
    const multi = `${descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      name: 'zulu',
      ownedPaths: '["zeta/**","alpha/**","alpha/**","middle/**"]',
    })}---\n${descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      name: 'yankee',
      namespace: 'payments',
      ownedPaths: '[]',
    })}`;

    ({ request } = await stage(
      checkout,
      {
        'zzz/catalog-info.yaml': validDescriptor('zzzlast', '["shared/**","packages/z/**"]'),
        'aaa/catalog-info.yaml': multi,
        'mmm/catalog-info.yaml': validDescriptor('mmmnone'),
      },
      {},
      'sc001-accept.json',
    ));
  });

  test(`${RUNS} runs all succeed`, async () => {
    const outcomes = await repeat(RUNS, () => runGeneration(request));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  test(`${RUNS} runs serialize byte-identically`, async () => {
    const outcomes = await repeat(RUNS, () => runGeneration(request));
    const serialized = outcomes.map((outcome) => (outcome.ok ? serializeEnvelope(outcome.envelope) : 'ABORTED'));

    expect(new Set(serialized).size).toBe(1);
    expect(serialized[0]).not.toBe('ABORTED');
  });

  test('every array\u2019s ordering is identical across runs', async () => {
    const outcomes = await repeat(RUNS, () => runGeneration(request));
    const arrays = outcomes.map((outcome) =>
      outcome.ok
        ? JSON.stringify({
            capabilities: outcome.envelope.capabilities,
            sources: outcome.envelope.sources.map((source) => source.path),
            entities: outcome.envelope.entities.map((entity) => entity.identity.canonicalId),
            derivedPaths: outcome.envelope.entities.map((entity) => entity.derivedPaths),
            allRefs: outcome.envelope.entities.map((entity) => entity.identity.allRefs),
          })
        : 'ABORTED',
    );
    expect(new Set(arrays).size).toBe(1);
  });

  test('the digest is identical across runs', async () => {
    const outcomes = await repeat(RUNS, () => runGeneration(request));
    const digests = outcomes.map((outcome) => (outcome.ok ? outcome.envelope.digest : 'ABORTED'));
    expect(new Set(digests).size).toBe(1);
  });
});

describe('T084 / SC-001 — the reject path', () => {
  /** Every rejection fixture, each violating a different rule. */
  const REJECTIONS: readonly { readonly label: string; readonly files: Record<string, string> }[] = [
    {
      label: 'a duplicate canonical id',
      files: {
        'rej-dup-a/catalog-info.yaml': validDescriptor('rejdup'),
        'rej-dup-b/catalog-info.yaml': validDescriptor('rejdup'),
      },
    },
    {
      label: 'an inadmissible descriptor',
      files: {
        'rej-adm/catalog-info.yaml': descriptor({
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          name: 'Bad_Name!',
        }),
      },
    },
    {
      label: 'a rejected pattern',
      files: { 'rej-pat/catalog-info.yaml': validDescriptor('rejpat', '["a{b}/**"]') },
    },
    {
      label: 'a repeated YAML key',
      files: { 'rej-yaml/catalog-info.yaml': `${validDescriptor('rejyaml')}kind: API\n` },
    },
  ];

  for (const [index, rejection] of REJECTIONS.entries()) {
    test(`${RUNS} runs over ${rejection.label} reject identically`, async () => {
      const { request } = await stage(checkout, rejection.files, {}, `sc001-reject-${index}.json`);
      const outcomes = await repeat(RUNS, () => runGeneration(request));

      expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);

      // The whole failure record, not only the class: reason, detail, stage and
      // location are all evidence, and any of them varying is non-determinism.
      const records = outcomes.map((outcome) => (outcome.ok ? 'OK' : JSON.stringify(outcome.failure)));
      expect(new Set(records).size).toBe(1);
      expect(records[0]).not.toBe('OK');

      const traces = outcomes.map((outcome) => JSON.stringify(outcome.stages));
      expect(new Set(traces).size).toBe(1);
    });
  }

  test('an input violating several rules at once reports the same one every run', async () => {
    // The sharpest reject-path case. A run that reported whichever violation its
    // iteration order surfaced first would pass every single-violation test above.
    const { request } = await stage(
      checkout,
      {
        'rej-many-a/catalog-info.yaml': descriptor({
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          name: 'Bad_Name!',
        }),
        'rej-many-b/catalog-info.yaml': validDescriptor('rejmany', '["a{b}/**"]'),
        'rej-many-c/catalog-info.yaml': `${validDescriptor('rejmanyc')}kind: API\n`,
        'rej-many-d/catalog-info.yaml': validDescriptor('rejmany'),
      },
      {},
      'sc001-reject-many.json',
    );

    const outcomes = await repeat(RUNS, () => runGeneration(request));
    const records = outcomes.map((outcome) => (outcome.ok ? 'OK' : JSON.stringify(outcome.failure)));
    expect(new Set(records).size).toBe(1);
    expect(records[0]).not.toBe('OK');
  });

  test('a rejecting run writes nothing on any of the runs', async () => {
    const { request } = await stage(
      checkout,
      {
        'rej-none-a/catalog-info.yaml': validDescriptor('rejnone'),
        'rej-none-b/catalog-info.yaml': validDescriptor('rejnone'),
      },
      {},
      'sc001-reject-none.json',
    );
    const outcomes = await repeat(RUNS, () => runGeneration(request));
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(Object.hasOwn(outcome, 'envelope')).toBe(false);
    }
  });
});
