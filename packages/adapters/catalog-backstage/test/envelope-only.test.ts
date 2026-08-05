/**
 * T079 / FR-038 — the versioned envelope is the **only** output: no side files, no logs
 * presented as output, no auxiliary artifacts, and never a `CatalogSnapshot`-shaped
 * artifact.
 *
 * ADR-0020 clause 7, quoted by FR-038: "The generator writes the envelope and nothing
 * else."
 *
 * # Checked from the filesystem, not from the writer's own report
 *
 * Every assertion about what was written reads the **directory**. A writer that
 * reported one file while creating two would pass a check that trusted its return
 * value, and that is precisely the failure "no side files" is about.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serializeEnvelope, writeEnvelope } from '../src/envelope/write.ts';
import { generateAndWriteEnvelope, runGeneration } from '../src/pipeline.ts';
import { ADAPTER_ROOT, scanned, violations } from './source-scan.ts';
import type { Rule } from './source-scan.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let output: string;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-only-'));
});

afterAll(async () => {
  await checkout.dispose();
  await rm(output, { recursive: true, force: true });
});

async function generateInto(directory: string, name: string): Promise<void> {
  const { request } = await stage(
    checkout,
    {
      [`${name}/catalog-info.yaml`]: validDescriptor(name, `["packages/${name}/**"]`),
      [`${name}-two/catalog-info.yaml`]: validDescriptor(`${name}two`),
    },
    {},
    `manifest-${name}.json`,
  );
  const result = await generateAndWriteEnvelope(request, join(directory, 'envelope.json'));
  if (!result.ok) throw new Error(`generation failed: ${result.failure.detail}`);
}

describe('T079 — exactly one file is written', () => {
  test('a successful run leaves one file, and it is the envelope', async () => {
    const directory = join(output, 'one-file');
    await generateInto(directory, 'onlyone');

    expect((await readdir(directory)).sort()).toEqual(['envelope.json']);
  });

  test('a second run into the same directory still leaves one file', async () => {
    // Catches an implementation that accumulates timestamped or numbered side files.
    const directory = join(output, 'twice');
    await generateInto(directory, 'twicea');
    await generateInto(directory, 'twiceb');

    expect((await readdir(directory)).sort()).toEqual(['envelope.json']);
  });

  test('a pre-existing unrelated file is left alone rather than cleaned up', async () => {
    // "Writes nothing else" is not a licence to delete. The writer's scope is one path.
    const directory = join(output, 'preexisting');
    await generateInto(directory, 'preexistinga');
    await writeFile(join(directory, 'unrelated.txt'), 'kept', 'utf8');
    await generateInto(directory, 'preexistingb');

    expect((await readdir(directory)).sort()).toEqual(['envelope.json', 'unrelated.txt']);
    expect(await Bun.file(join(directory, 'unrelated.txt')).text()).toBe('kept');
  });

  test('the write reports the one path it wrote', async () => {
    const { request } = await stage(
      checkout,
      { 'reported/catalog-info.yaml': validDescriptor('reported') },
      {},
      'manifest-reported.json',
    );
    const destination = join(output, 'reported', 'envelope.json');
    const result = await generateAndWriteEnvelope(request, destination);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.path).toBe(destination);
  });
});

describe('T079 — no CatalogSnapshot-shaped artifact is ever written', () => {
  test('the written file is envelope-shaped and not snapshot-shaped', async () => {
    const directory = join(output, 'shape-check');
    await generateInto(directory, 'shapecheck');

    const parsed = JSON.parse(await Bun.file(join(directory, 'envelope.json')).text()) as Record<
      string,
      unknown
    >;

    // A `CatalogSnapshot` is `{ entities: CatalogSnapshotEntity[] }` where each entity
    // is `{ id, refs?, paths? }` (`packages/core/src/affects/catalog.ts`). The envelope
    // also has `entities`, so the discriminating check is the entity record's fields.
    expect(parsed['schemaVersion']).toBe('1');
    expect(parsed['digest']).toBeDefined();
    for (const entity of parsed['entities'] as Record<string, unknown>[]) {
      expect(Object.hasOwn(entity, 'id')).toBe(false);
      expect(Object.hasOwn(entity, 'refs')).toBe(false);
      expect(Object.hasOwn(entity, 'paths')).toBe(false);
      expect(Object.hasOwn(entity, 'identity')).toBe(true);
    }
  });

  test('no adapter source names the core catalog snapshot types', () => {
    // Reaching for `CatalogSnapshot` at all is the step before writing one. This is a
    // source-level check because the runtime one above can only observe the shapes a
    // fixture happened to produce.
    const rules: readonly Rule[] = [
      {
        id: 'catalog-snapshot-type',
        pattern: /\bCatalogSnapshotEntity\b|\bCatalogSnapshot\b/,
        why: 'FR-038 / ADR-0020 clause 7: the generator writes the envelope and nothing else; deriving a CatalogSnapshot belongs to the consumer package',
      },
      {
        id: 'core-affects-catalog',
        pattern: /affects\/catalog/,
        why: 'the core catalog port is not part of the generator surface (FR-020: those types are unchanged by this feature)',
      },
    ];
    expect(violations(scanned(ADAPTER_ROOT), rules)).toEqual([]);
  });

  test('that rule has been observed firing, so its silence means something', () => {
    const rules: readonly Rule[] = [
      {
        id: 'catalog-snapshot-type',
        pattern: /\bCatalogSnapshotEntity\b|\bCatalogSnapshot\b/,
        why: 'fixture',
      },
    ];
    expect(
      violations([{ path: 'fixture.ts', code: 'const s: CatalogSnapshot = { entities: [] };' }], rules).map(
        (violation) => violation.ruleId,
      ),
    ).toEqual(['catalog-snapshot-type']);
  });
});

describe('T079 — diagnostics are returned, never written', () => {
  test('the stage trace is a returned value and appears in no file', async () => {
    const directory = join(output, 'no-logs');
    const { request } = await stage(
      checkout,
      { 'nologs/catalog-info.yaml': validDescriptor('nologs') },
      {},
      'manifest-nologs.json',
    );

    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stages.length).toBeGreaterThan(0);

    await generateAndWriteEnvelope(request, join(directory, 'envelope.json'));
    const written = await Bun.file(join(directory, 'envelope.json')).text();
    expect(written).not.toContain('"stages"');
    expect((await readdir(directory)).sort()).toEqual(['envelope.json']);
  });

  test('the serialization contains only the envelope\u2019s own fields', async () => {
    const { request } = await stage(
      checkout,
      { 'serial/catalog-info.yaml': validDescriptor('serial') },
      {},
      'manifest-serial.json',
    );
    const outcome = await runGeneration(request);
    if (!outcome.ok) throw new Error('expected success');

    const text = serializeEnvelope(outcome.envelope);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(outcome.envelope)));
  });
});

describe('T079 — writeEnvelope writes one file and creates its directory', () => {
  test('a nested destination directory is created', async () => {
    const { request } = await stage(
      checkout,
      { 'nested/catalog-info.yaml': validDescriptor('nested') },
      {},
      'manifest-nested.json',
    );
    const outcome = await runGeneration(request);
    if (!outcome.ok) throw new Error('expected success');

    const directory = join(output, 'deep', 'deeper', 'deepest');
    const result = await writeEnvelope(outcome.envelope, join(directory, 'envelope.json'));

    expect(result.path).toBe(join(directory, 'envelope.json'));
    expect((await readdir(directory)).sort()).toEqual(['envelope.json']);
  });
});
