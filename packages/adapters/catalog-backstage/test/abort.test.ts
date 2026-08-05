/**
 * T073 — whole-operation abort: non-zero exit status, and no usable partial output.
 *
 * `atomic-fail-closed.md` §1 and §3. Four properties are checked here, and they are
 * genuinely four rather than one restated:
 *
 * 1. The failure branch carries **no envelope** — a type-level property, checked at
 *    runtime because the type is erased there.
 * 2. A run that aborts writes **no file at all** — not a partial one, not an empty one.
 * 3. The exit status is **non-zero**, observed as a real process exit rather than as a
 *    constant this module also defines.
 * 4. A completed write is **atomic**: the destination path never holds a prefix of the
 *    envelope.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  EXIT_ABORT,
  EXIT_OK,
  abortRecord,
  envelopeOf,
  exitCodeFor,
} from '../src/failure/abort.ts';
import { generateAndWriteEnvelope, runGeneration } from '../src/pipeline.ts';
import { serializeEnvelope } from '../src/envelope/write.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let outputDirectory: string;

beforeAll(async () => {
  checkout = await createCheckout();
  outputDirectory = await mkdtemp(join(tmpdir(), 'adrkit-catalog-out-'));
});

afterAll(async () => {
  await checkout.dispose();
  await rm(outputDirectory, { recursive: true, force: true });
});

/** A batch of five valid entities plus a sixth with a duplicate canonical id (§3). */
async function fiveValidPlusOneDuplicate(): Promise<Awaited<ReturnType<typeof stage>>> {
  const files: Record<string, string> = {};
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    files[`entities/${name}/catalog-info.yaml`] = validDescriptor(name, `["packages/${name}/**"]`);
  }
  // The sixth canonicalizes to `component:default/alpha`, colliding with the first.
  files['entities/sixth/catalog-info.yaml'] = validDescriptor('alpha', '["packages/sixth/**"]');
  return stage(checkout, files, {}, 'manifest-duplicate.json');
}

describe('T073 — the failure branch carries no envelope', () => {
  test('a valid batch produces one, so the negative case below means something', async () => {
    const { request } = await stage(
      checkout,
      { 'ok/catalog-info.yaml': validDescriptor('ok', '["packages/ok/**"]') },
      {},
      'manifest-ok.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    expect(envelopeOf(outcome)).toBeDefined();
  });

  test('an aborting batch carries no envelope, and no field could hold one', async () => {
    const { request } = await fiveValidPlusOneDuplicate();
    const outcome = await runGeneration(request);

    expect(outcome.ok).toBe(false);
    expect(envelopeOf(outcome)).toBeUndefined();
    // Not merely "envelope is undefined": the key is absent, so there is nowhere a
    // partial snapshot could be carried even under a different name.
    expect(Object.keys(outcome).sort()).toEqual(['failure', 'ok', 'stages']);
  });

  test('exactly one failure record, never a list', async () => {
    const { request } = await fiveValidPlusOneDuplicate();
    const outcome = await runGeneration(request);
    if (outcome.ok) throw new Error('expected an abort');

    expect(Array.isArray(outcome.failure)).toBe(false);
    expect(outcome.failure.triggerClass).toBe('duplicate-canonical-id');
  });
});

describe('T073 / §3 — no output exists for the five entities that would have validated', () => {
  test('the destination path is never created', async () => {
    const { request } = await fiveValidPlusOneDuplicate();
    const destination = join(outputDirectory, 'abort-case', 'envelope.json');

    const result = await generateAndWriteEnvelope(request, destination);
    expect(result.ok).toBe(false);

    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test('no side file is left in the destination directory either', async () => {
    const { request } = await fiveValidPlusOneDuplicate();
    const directory = join(outputDirectory, 'abort-case-empty');
    const destination = join(directory, 'envelope.json');

    const result = await generateAndWriteEnvelope(request, destination);
    expect(result.ok).toBe(false);

    // The directory itself is never created, because the write is never reached.
    // `readdir` on an absent directory throws, which is the assertion.
    await expect(readdir(directory)).rejects.toThrow();
  });

  test('the five valid entities really would have validated on their own', async () => {
    // Without this, "no envelope was produced" is equally consistent with a fixture
    // that was invalid for some other reason. §3's table requires the five be
    // otherwise-valid, so that is demonstrated rather than assumed.
    const files: Record<string, string> = {};
    for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      files[`entities/${name}/catalog-info.yaml`] = validDescriptor(name, `["packages/${name}/**"]`);
    }
    const { request } = await stage(checkout, files, {}, 'manifest-five.json');
    const outcome = await runGeneration(request);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.envelope.entities).toHaveLength(5);
  });
});

describe('T073 / FR-034 — non-zero process exit status', () => {
  test('the mapping is 0 on success and 1 on abort', async () => {
    const { request: ok } = await stage(
      checkout,
      { 'exit-ok/catalog-info.yaml': validDescriptor('exitok') },
      {},
      'manifest-exit-ok.json',
    );
    expect(exitCodeFor(await runGeneration(ok))).toBe(EXIT_OK);

    const { request: bad } = await fiveValidPlusOneDuplicate();
    expect(exitCodeFor(await runGeneration(bad))).toBe(EXIT_ABORT);
  });

  test('a real process exits non-zero, observed rather than asserted', async () => {
    // FR-034 says "process exit status". A constant in this module is not one. The
    // script below is generated rather than committed so that this test cannot pass
    // by reading a file someone edited to say the right thing, and the module
    // specifier is built at runtime so it is a path this repository resolves rather
    // than a literal that could drift.
    const { request } = await fiveValidPlusOneDuplicate();
    const pipelineModule = JSON.stringify(join(import.meta.dir, '..', 'src', 'pipeline.ts'));
    const abortModule = JSON.stringify(join(import.meta.dir, '..', 'src', 'failure', 'abort.ts'));

    const scriptPath = join(outputDirectory, 'exit-status-probe.ts');
    await writeFile(
      scriptPath,
      [
        `import { runGeneration } from ${pipelineModule};`,
        `import { exitCodeFor } from ${abortModule};`,
        `const request = JSON.parse(${JSON.stringify(JSON.stringify(request))});`,
        'const outcome = await runGeneration(request);',
        'process.exit(exitCodeFor(outcome));',
      ].join('\n'),
      'utf8',
    );

    const proc = Bun.spawn(['bun', scriptPath], { stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_ABORT);
    expect(exitCode).not.toBe(0);
  });
});

describe('T073 — the write is atomic, so no truncated envelope is observable', () => {
  test('the destination holds the complete serialization, byte for byte', async () => {
    const { request } = await stage(
      checkout,
      { 'atomic/catalog-info.yaml': validDescriptor('atomic', '["packages/atomic/**"]') },
      {},
      'manifest-atomic.json',
    );
    const destination = join(outputDirectory, 'atomic', 'envelope.json');

    const result = await generateAndWriteEnvelope(request, destination);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await readFile(destination, 'utf8');
    expect(written).toBe(serializeEnvelope(result.envelope));
    expect(result.write.byteLength).toBe(new TextEncoder().encode(written).byteLength);
  });

  test('no temporary file survives a successful write', async () => {
    const directory = join(outputDirectory, 'atomic-clean');
    const { request } = await stage(
      checkout,
      { 'atomic2/catalog-info.yaml': validDescriptor('atomictwo') },
      {},
      'manifest-atomic2.json',
    );

    await generateAndWriteEnvelope(request, join(directory, 'envelope.json'));

    // Exactly one file, and it is the envelope: FR-038's "only output", checked from
    // the directory rather than from the writer's own report of what it wrote.
    expect((await readdir(directory)).sort()).toEqual(['envelope.json']);
  });
});

describe('T073 — abortRecord carries the location the pipeline knew', () => {
  test('an absent location is undefined rather than invented', () => {
    const record = abortRecord(
      { reason: 'invalid-yaml-syntax', triggerClass: 'invalid-yaml-syntax', detail: 'd' },
      'descriptor-read',
    );
    expect(record.sourcePath).toBeUndefined();
    expect(record.documentIndex).toBeUndefined();
    expect(record.reason).toBe('invalid-yaml-syntax');
    expect(record.stage).toBe('descriptor-read');
  });

  test('a supplied location is carried verbatim', () => {
    const record = abortRecord(
      { reason: 'invalid-yaml-syntax', triggerClass: 'invalid-yaml-syntax', detail: 'd' },
      'descriptor-read',
      { sourcePath: 'a/catalog-info.yaml', documentIndex: 2 },
    );
    expect(record.sourcePath).toBe('a/catalog-info.yaml');
    expect(record.documentIndex).toBe(2);
  });
});
