/**
 * T086 / SC-009 — close-out for the **rescoped** criterion (spike 009's SC-010,
 * rescoped by ADR-0020 clause 3).
 *
 * SC-009 has three limbs:
 *
 * 1. Each required pass produces **either** a populated `SnapshotEnvelope` **or** a
 *    deterministic, atomic, correctly-classified fail-closed rejection with no partial
 *    output.
 * 2. **At least one pass over a real corpus meeting ADR-0020 clause 5's conditions
 *    produces a populated envelope.**
 * 3. A correct rejection of a defective corpus satisfies the criterion; **fabricating an
 *    envelope from one never does.**
 *
 * # Limb 2 is NOT discharged by this file, and that is recorded rather than glossed
 *
 * Clause 5's conditions require a corpus of **real descriptors authored upstream and
 * otherwise unmodified**, with maintainer-authored annotations overlaid. The frozen
 * accept corpus is 24 entity documents from `github.com/backstage/community-plugins` at
 * commit `92e9e4e09c76cc57f3475029b73e5ec84498a459`
 * (`evidence/accept-corpus-freeze/accept-corpus-freeze.json`).
 *
 * **Those descriptor files are not present in this repository.** The freeze records the
 * corpus's *metadata* — source paths, canonical ids, the overlay values, the expected
 * paths — but not the descriptors themselves. Every fixture in this file is
 * maintainer-authored, so none of them meets clause 5's conditions, and asserting
 * otherwise would present a synthetic corpus as a third-party one.
 *
 * Reconstructing descriptors from the freeze was considered and rejected twice over: the
 * reconstruction would be maintainer-authored (so still not clause-5 conforming), and
 * feeding a corpus derived from the freeze back in would make the input a function of
 * the expectations — which is the circularity Barrier B exists to prevent.
 *
 * Materializing the pinned corpus is **Phase F's** concern: T088 diffs "every annotated
 * entity in the frozen accept corpus" against the frozen expectations and cannot run
 * without it either. {@link acceptCorpusIsMaterialized} below is an executable record of
 * the gap: it fails the day someone vendors the corpus, which is the day this limb
 * becomes dischargeable and this file should be completed.
 *
 * T086 is therefore left unchecked in `tasks.md`, with this reason.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readdirSync } from 'node:fs';
import { computeEnvelopeDigest, verifyEnvelopeDigest } from '../src/envelope/digest.ts';
import type { SnapshotEnvelope } from '../src/envelope/shape.ts';
import { serializeEnvelope } from '../src/envelope/write.ts';
import { generateAndWriteEnvelope, runGeneration } from '../src/pipeline.ts';
import { REPO_ROOT } from './source-scan.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let output: string;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-sc009-'));
});

afterAll(async () => {
  await checkout.dispose();
  await rm(output, { recursive: true, force: true });
});

/**
 * Whether the pinned accept corpus's descriptor files exist anywhere in this repository.
 *
 * Looks for a vendored corpus directory rather than for the freeze metadata, which is
 * committed and is not the corpus.
 */
function acceptCorpusIsMaterialized(): boolean {
  const candidates = [
    join(REPO_ROOT, 'specs', '010-catalog-backstage', 'corpus'),
    join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence', 'corpus'),
    join(REPO_ROOT, 'corpus'),
    join(REPO_ROOT, '.corpus'),
  ];
  return candidates.some((candidate) => {
    try {
      return readdirSync(candidate).length > 0;
    } catch {
      return false;
    }
  });
}

describe('T086 / SC-009 limb 1 — every pass yields an envelope or a clean rejection', () => {
  test('an accept pass yields a populated envelope', async () => {
    const { request } = await stage(
      checkout,
      {
        'sc009-a/catalog-info.yaml': validDescriptor('sconineone', '["packages/one/**"]'),
        'sc009-b/catalog-info.yaml': validDescriptor('sconinetwo', '["packages/two/**"]'),
      },
      {},
      'sc009-accept.json',
    );

    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Populated, not merely present: entities exist and carry derived ownership.
    expect(outcome.envelope.entities.length).toBeGreaterThan(0);
    expect(
      outcome.envelope.entities.some((entity) => entity.derivedPaths.length > 0),
    ).toBe(true);
    expect(verifyEnvelopeDigest(outcome.envelope).outcome).toBe('match');
  });

  test('a reject pass yields a rejection that is deterministic, atomic and classified', async () => {
    const { request } = await stage(
      checkout,
      {
        'sc009-r1/catalog-info.yaml': validDescriptor('sconinedup'),
        'sc009-r2/catalog-info.yaml': validDescriptor('sconinedup'),
      },
      {},
      'sc009-reject.json',
    );

    const first = await runGeneration(request);
    const second = await runGeneration(request);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;

    // Deterministic.
    expect(JSON.stringify(second.failure)).toBe(JSON.stringify(first.failure));
    // Correctly classified.
    expect(first.failure.triggerClass).toBe('duplicate-canonical-id');
    // Atomic, with no partial output.
    expect(Object.hasOwn(first, 'envelope')).toBe(false);
  });

  test('there is no third outcome — every pass lands on one of the two', async () => {
    const passes: readonly { readonly name: string; readonly files: Record<string, string> }[] = [
      { name: 'sc009-e1.json', files: { 'e1/catalog-info.yaml': validDescriptor('eone', '["a/**"]') } },
      { name: 'sc009-e2.json', files: { 'e2/catalog-info.yaml': validDescriptor('etwo') } },
      { name: 'sc009-e3.json', files: { 'e3/catalog-info.yaml': validDescriptor('ethree', '[]') } },
      {
        name: 'sc009-e4.json',
        files: {
          'e4/catalog-info.yaml': descriptor({
            apiVersion: 'backstage.io/v1alpha1',
            kind: 'Component',
            name: 'Bad_Name!',
          }),
        },
      },
      { name: 'sc009-e5.json', files: { 'e5/catalog-info.yaml': validDescriptor('efive', '["a{b}/**"]') } },
    ];

    for (const pass of passes) {
      const { request } = await stage(checkout, pass.files, {}, pass.name);
      const outcome = await runGeneration(request);

      if (outcome.ok) {
        expect(verifyEnvelopeDigest(outcome.envelope).outcome).toBe('match');
      } else {
        expect(outcome.failure.triggerClass.length).toBeGreaterThan(0);
        expect(Object.hasOwn(outcome, 'envelope')).toBe(false);
      }
    }
  });

  test('a rejecting pass writes no file, so "either/or" is exclusive on disk too', async () => {
    const { request } = await stage(
      checkout,
      {
        'sc009-x1/catalog-info.yaml': validDescriptor('sconinex'),
        'sc009-x2/catalog-info.yaml': validDescriptor('sconinex'),
      },
      {},
      'sc009-exclusive.json',
    );
    const directory = join(output, 'exclusive');
    const result = await generateAndWriteEnvelope(request, join(directory, 'envelope.json'));

    expect(result.ok).toBe(false);
    await expect(readdir(directory)).rejects.toThrow();
  });
});

describe('T086 / SC-009 limb 2 — NOT discharged, and why', () => {
  test('the frozen accept corpus is not materialized in this repository', () => {
    // An executable record of the gap rather than a prose note. When someone vendors
    // the pinned corpus this test fails, which is the signal that limb 2 has become
    // dischargeable and this file should be completed.
    expect(acceptCorpusIsMaterialized()).toBe(false);
  });

  test('the freeze records the corpus metadata, not the descriptors', async () => {
    // Evidence for the claim above: what is committed is the selection basis, the
    // overlay, and the expected paths — never a descriptor file.
    const freeze = (await Bun.file(
      join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence', 'accept-corpus-freeze', 'accept-corpus-freeze.json'),
    ).json()) as Record<string, unknown>;

    expect((freeze['corpusRef'] as Record<string, unknown>)['repository']).toBe(
      'github.com/backstage/community-plugins',
    );
    expect(freeze['size']).toBe(24);
    expect(Object.hasOwn(freeze, 'descriptors')).toBe(false);
    expect(Object.hasOwn(freeze, 'sources')).toBe(false);
  });

  test('every fixture in this suite is maintainer-authored, so none meets clause 5', async () => {
    // Stated as an assertion so no reader mistakes a passing accept case above for a
    // clause-5 conforming pass. Clause 5 requires descriptors "authored upstream and
    // otherwise unmodified"; these were written by this test file.
    const { request } = await stage(
      checkout,
      { 'sc009-prov/catalog-info.yaml': validDescriptor('sconineprov', '["packages/p/**"]') },
      {},
      'sc009-provenance.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    for (const entity of outcome.envelope.entities) {
      expect(entity.provenance).toBe('maintainer-overlay');
    }
  });
});

describe('T086 / SC-009 limb 3 — a fabricated or hand-edited envelope never satisfies it', () => {
  let genuine: SnapshotEnvelope;

  beforeAll(async () => {
    const { request } = await stage(
      checkout,
      { 'sc009-genuine/catalog-info.yaml': validDescriptor('sconinegenuine', '["packages/g/**"]') },
      {},
      'sc009-genuine.json',
    );
    const outcome = await runGeneration(request);
    if (!outcome.ok) throw new Error('fixture failed to generate');
    genuine = outcome.envelope;
  });

  test('a hand-edited envelope fails digest verification', () => {
    const edited: SnapshotEnvelope = {
      ...genuine,
      entities: genuine.entities.map((entity) => ({ ...entity, derivedPaths: ['fabricated/**'] })),
    };
    expect(verifyEnvelopeDigest(edited).outcome).toBe('digest-mismatch');
  });

  test('a wholly fabricated envelope fails digest verification', async () => {
    const fabricated = {
      schemaVersion: '1',
      repository: { id: 'github.com/fabricated/repo', revision: 'f'.repeat(40) },
      generatorVersion: '@adrkit/catalog-backstage@0.0.0',
      globDialect: {
        engine: 'picomatch',
        version: '4.0.5',
        options: { dot: false as const, nocase: false as const, nonegate: true as const },
      },
      capabilities: ['pathOwnership'],
      completeness: { wholeCatalog: false, identityOnly: false },
      sources: [{ path: 'catalog-info.yaml', digestAlgorithm: 'sha256' as const, digest: '0'.repeat(64) }],
      entities: [
        {
          identity: { canonicalId: 'component:default/invented', allRefs: ['component:default/invented'] },
          ownershipState: 'explicit-paths' as const,
          derivedPaths: ['invented/**'],
          sourceDocument: { sourcePath: 'catalog-info.yaml', documentIndexInFile: 0 },
          provenance: 'upstream-authored' as const,
        },
      ],
      digest: '0'.repeat(64),
    };

    const path = join(output, 'fabricated.json');
    await writeFile(path, `${JSON.stringify(fabricated)}\n`, 'utf8');
    expect(verifyEnvelopeDigest(fabricated).outcome).toBe('digest-mismatch');
  });

  test('an edited-then-re-signed envelope passes its digest but is not what a pass produces', () => {
    // The honest limit of the digest, and why SC-009 is about the **pass** rather than
    // about an artifact. FR-041: the digest detects accidental corruption and naive
    // mutation, never an adversary who recomputes it. What catches this is re-running
    // the generator over the same input and comparing bytes — which is available
    // precisely because FR-042 makes the output byte-identical.
    const { digest: _old, ...unsigned } = genuine;
    const edited = {
      ...unsigned,
      entities: unsigned.entities.map((entity) => ({ ...entity, derivedPaths: ['fabricated/**'] })),
    };
    const resigned: SnapshotEnvelope = { ...edited, digest: computeEnvelopeDigest(edited) };

    expect(verifyEnvelopeDigest(resigned).outcome).toBe('match');
    expect(serializeEnvelope(resigned)).not.toBe(serializeEnvelope(genuine));
  });

  test('re-running the generator over the same input reproduces the genuine bytes exactly', async () => {
    const { request } = await stage(
      checkout,
      { 'sc009-genuine/catalog-info.yaml': validDescriptor('sconinegenuine', '["packages/g/**"]') },
      {},
      'sc009-genuine.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(serializeEnvelope(outcome.envelope)).toBe(serializeEnvelope(genuine));
  });
});
