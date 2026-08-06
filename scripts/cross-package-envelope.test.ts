/**
 * T096 / FR-044 — the cross-package end-to-end: an envelope the **generator** writes is
 * validated by the **consumer**, with no import edge in either direction.
 *
 * # Why this test lives at the repository root
 *
 * It is the only test that legitimately imports both packages, and that is precisely why
 * it cannot live in either of them. `package-boundary.md` §3 forbids an import edge
 * between `@adrkit/catalog-backstage` and `@adrkit/catalog-envelope` in either direction,
 * and `envelope-shape-locality.test.ts` enforces that by scanning both trees — a
 * cross-package test inside either package would trip its own guard, correctly.
 *
 * A repository-root script is neither package, so importing both here creates no edge
 * between them. Both are consumers of this file; this file is a consumer of neither's
 * public surface as a dependency.
 *
 * # What is actually being demonstrated
 *
 * §3: *"The envelope file on disk is the entire interface."* That is a claim about
 * **data**, and it is only demonstrated by a round trip in which:
 *
 * 1. the generator writes an envelope from real descriptors, knowing nothing of the
 *    consumer;
 * 2. the bytes are read back from disk — never handed over as an in-process object;
 * 3. the consumer validates them through its own five ordered steps, and derives a
 *    `CatalogSnapshot` only after every check has passed;
 * 4. neither package's source names or imports the other.
 *
 * Step 2 is the load-bearing one. Passing the generator's in-memory envelope object
 * directly to the consumer would test the two shapes against each other while bypassing
 * the serialization that is the actual interface — and the two shapes are declared
 * **independently on purpose** (`package-boundary.md` §5), so agreement in memory is not
 * agreement on the wire.
 *
 * # The deliberate duplication is what makes this a check
 *
 * §5: *"If both packages derived their view of the envelope from one declaration, the
 * consumer could not detect a generator that had changed the shape — the shape would have
 * changed on both sides at once. Two independent declarations are what make the consumer's
 * structural validation an actual check rather than a tautology."* This round trip is
 * where that pays off, so it is asserted here that the two declarations really are
 * separate modules.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateAndWriteEnvelope } from '../packages/adapters/catalog-backstage/src/pipeline.ts';
import {
  createCheckout,
  stage,
  validDescriptor,
  type Checkout,
} from '../packages/adapters/catalog-backstage/test/pipeline-fixtures.ts';

import {
  admitEnvelope,
  checkEnvelopeDigest,
  deriveCatalogSnapshot,
  validateEnvelope,
} from '../packages/catalog-envelope/src/index.ts';

const REPO_ROOT = join(import.meta.dir, '..');

let checkout: Checkout;
let output: string;
/** The bytes the generator wrote, read back from disk. */
let wire: string;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-cross-'));

  const { request } = await stage(
    checkout,
    {
      'cross-a/catalog-info.yaml': validDescriptor('crossone', '["packages/one/**"]'),
      'cross-b/catalog-info.yaml': validDescriptor('crosstwo', '["packages/two/**","docs/**"]'),
      'cross-c/catalog-info.yaml': validDescriptor('crossthree', '[]'),
      'cross-d/catalog-info.yaml': validDescriptor('crossfour'),
    },
    {},
    'cross-package.json',
  );

  const destination = join(output, 'envelope.json');
  const result = await generateAndWriteEnvelope(request, destination);
  if (!result.ok) throw new Error(`generator refused the fixture: ${result.failure.triggerClass}`);

  wire = await readFile(destination, 'utf8');
});

afterAll(async () => {
  await checkout?.dispose();
  await rm(output, { recursive: true, force: true });
});

describe('T096 — the envelope travels as data, and the consumer accepts it', () => {
  test('the generator wrote bytes, and they are what the consumer is given', () => {
    // Read from disk, not handed over in memory. The file is the interface.
    expect(wire.length).toBeGreaterThan(0);
    expect(wire.endsWith('\n')).toBe(true);
  });

  test('the consumer validates the generator\u2019s envelope through all five steps', () => {
    const result = validateEnvelope(wire, { sourceBaseDir: checkout.root });

    // Named explicitly: a rejection here would otherwise surface as an unhelpful
    // `outcome !== 'valid'` with the reason buried.
    if (result.outcome !== 'valid') {
      throw new Error(`consumer rejected at step ${result.failedStep}: ${result.reason} — ${result.detail}`);
    }

    expect(result.outcome).toBe('valid');
    expect(result.examined.stepsReached).toBe(5);
    // Step 4 opened and hashed the generator's declared sources, so the round trip
    // reached the filesystem rather than stopping at a structural inspection.
    expect(result.examined.sourcesVerified.length).toBe(4);
    expect(result.examined.entityRecordsInspected).toBe(4);
  });

  test('the digest the generator computed is the digest the consumer recomputes', () => {
    // Independently computed on both sides from independently declared shapes. This is
    // the point at which a canonicalization disagreement would surface.
    const result = validateEnvelope(wire, { sourceBaseDir: checkout.root });
    if (result.outcome !== 'valid') throw new Error('fixture did not validate');

    const digest = checkEnvelopeDigest(result.validated);
    expect(digest.outcome).toBe('match');
    expect(digest.recomputedDigest).toBe(digest.declaredDigest);
  });

  test('a CatalogSnapshot is derived, but only after validation completes', () => {
    const admission = admitEnvelope(wire, { sourceBaseDir: checkout.root });
    if (admission.outcome !== 'admitted') {
      throw new Error(`admission refused at ${admission.refusedAt}: ${admission.reason}`);
    }

    const derived = deriveCatalogSnapshot(admission.admitted);
    expect(derived.snapshot.entities.length).toBe(4);
    for (const entity of derived.snapshot.entities) {
      expect(entity.id).toStartWith('component:');
      expect(entity.refs).toEqual([entity.id]);
    }

    // The ownership states the fixture exercises are on the ENVELOPE, and the derived
    // snapshot deliberately does not carry them: `explicit-empty` and `annotation-absent`
    // are indistinguishable downstream by design, both yielding an empty `paths`. The
    // discriminator stays on the envelope, so it is asserted there.
    const states = new Set(admission.admitted.envelope.entities.map((one) => one.ownershipState));
    expect(states).toEqual(new Set(['explicit-paths', 'explicit-empty', 'annotation-absent']));

    // ...and its absence downstream is asserted too, so a future change that leaked it
    // into the snapshot is a failure rather than a silent widening of the interface.
    for (const entity of derived.snapshot.entities) {
      expect(Object.keys(entity).sort()).toEqual(['id', 'paths', 'refs']);
    }

    // Both empty-path states collapse to the same derived shape, which is the point.
    //
    // `CatalogSnapshotEntity` types `paths` as **optional** (`@adrkit/core`), but the
    // deriver always emits it — "empty array included, so the output is deterministic".
    // That gap between the declared type and the guaranteed behaviour is asserted rather
    // than papered over with a non-null assertion.
    for (const entity of derived.snapshot.entities) {
      expect(Array.isArray(entity.paths)).toBe(true);
    }
    const empty = derived.snapshot.entities.filter((one) => (one.paths ?? []).length === 0);
    expect(empty.length).toBe(2);
  });

  test('derivation refuses anything that is not an admitted envelope', () => {
    // FR-021: the snapshot is derived from the envelope *only after* it independently
    // passes every validation and digest check. A forged token must not get through.
    expect(() => deriveCatalogSnapshot({ envelope: JSON.parse(wire) as unknown })).toThrow();
    expect(() => deriveCatalogSnapshot(undefined)).toThrow();
  });

  test('a byte the consumer did not expect is refused, so acceptance means something', () => {
    // Without this, "the consumer accepted it" is consistent with a consumer that accepts
    // anything. One mutated payload must be refused.
    //
    // It is refused at the **digest**, not at the five structural steps, and that is the
    // correct place: the mutation below is structurally perfect — a well-formed array of
    // strings in the right field. Structural validation has nothing to object to. What
    // catches it is the generator's own digest no longer matching the payload, which is
    // exactly the integrity guarantee the envelope carries.
    const tampered = wire.replace('"derivedPaths":["packages/one/**"]', '"derivedPaths":["fabricated/**"]');
    expect(tampered).not.toBe(wire);

    const structural = validateEnvelope(tampered, { sourceBaseDir: checkout.root });
    expect(structural.outcome).toBe('valid'); // structurally fine, and that is the point

    const admission = admitEnvelope(tampered, { sourceBaseDir: checkout.root });
    expect(admission.outcome).toBe('refused');
    expect(admission.refusedAt).toBe('digest');
  });
});

describe('T096 / package-boundary.md §3 — no import edge, in either direction', () => {
  test('neither package\u2019s source or tests name the other', async () => {
    // The scan lives in the adapter's test tree, where it also runs. Re-running it here
    // is deliberate: this file is the one place both packages are loaded into the same
    // process, and the boundary claim is exactly the one a reader will doubt here.
    const { scanned, violations, ADAPTER_ROOT, CONSUMER_ROOT } = await import(
      '../packages/adapters/catalog-backstage/test/source-scan.ts'
    );

    expect(
      violations(scanned(ADAPTER_ROOT), [
        {
          id: 'adapter-names-consumer',
          pattern: /@adrkit\/catalog-envelope/u,
          why: 'package-boundary.md §3 forbids an adapter → consumer edge',
        },
      ]),
    ).toEqual([]);

    expect(
      violations(scanned(CONSUMER_ROOT), [
        {
          id: 'consumer-names-adapter',
          pattern: /@adrkit\/catalog-backstage/u,
          why: 'package-boundary.md §3 forbids a consumer → adapter edge',
        },
      ]),
    ).toEqual([]);
  });

  test('neither manifest declares the other as a dependency', async () => {
    for (const [relative, forbidden] of [
      ['packages/adapters/catalog-backstage/package.json', '@adrkit/catalog-envelope'],
      ['packages/catalog-envelope/package.json', '@adrkit/catalog-backstage'],
    ] as const) {
      const manifest = JSON.parse(await readFile(join(REPO_ROOT, relative), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain(forbidden);
      expect(Object.keys(manifest.devDependencies ?? {})).not.toContain(forbidden);
    }
  });

  test('the envelope shape is declared twice, in two separate modules', async () => {
    // §5's deliberate duplication. If these ever became one module, the round trip above
    // would become a tautology and would stop being evidence of anything.
    const adapterShape = join(REPO_ROOT, 'packages/adapters/catalog-backstage/src/envelope/shape.ts');
    const consumerShape = join(REPO_ROOT, 'packages/catalog-envelope/src/envelope-shape.ts');

    for (const path of [adapterShape, consumerShape]) {
      const text = await readFile(path, 'utf8');
      expect(text).toContain('SnapshotEnvelope');
      // Neither imports the other's declaration.
      expect(text).not.toContain('catalog-envelope/src');
      expect(text).not.toContain('catalog-backstage/src');
    }
  });
});
