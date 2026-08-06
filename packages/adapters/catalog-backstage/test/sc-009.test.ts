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
 * **When Phase E wrote this file those descriptor files were not present in this
 * repository.** The freeze records the corpus's *metadata* — source paths, canonical ids,
 * the overlay values, the expected paths — but not the descriptors themselves. Every
 * fixture in this file is maintainer-authored, so none of them meets clause 5's
 * conditions, and asserting otherwise would present a synthetic corpus as a third-party
 * one.
 *
 * Reconstructing descriptors from the freeze was considered and rejected twice over: the
 * reconstruction would be maintainer-authored (so still not clause-5 conforming), and
 * feeding a corpus derived from the freeze back in would make the input a function of
 * the expectations — which is the circularity Barrier B exists to prevent.
 *
 * **That gap is now closed.** T086a vendored the 24 descriptors verbatim from the pin
 * into `specs/010-catalog-backstage/corpus/`, verified against the content address the
 * pinned commit fixes (`scripts/vendor-accept-corpus.ts`).
 *
 * **Limb 2 is discharged, and this is where — precisely.** The clause-5 conforming pass
 * is Phase F's, not this file's. `scripts/compare-accept-corpus.test.ts` runs
 * `generateOverCorpus` against the vendored tree on every `bun test`, and Phase F
 * recorded its outcome at `evidence/comparison/step-b-record.json`: verdict `PASS`, a
 * populated envelope of **25** entities over **24** expected ones, **0** false positives
 * and **0** false negatives. The limb-2 block below asserts that recorded outcome and
 * **pins the citation**, so that if the harness ever stops running a live generation the
 * assertions here cannot keep passing while meaning nothing.
 *
 * The 25/24 gap is not a discrepancy: 24 *selected descriptor files* carry 24 annotated
 * entities, and one of those files holds a second, unselected document. Descriptor file
 * counts and entity document counts are different numbers throughout this feature.
 *
 * **What is still true, and still asserted:** every fixture authored *in this file* is
 * maintainer-authored and meets none of clause 5's conditions. Limb 2 is discharged by
 * the corpus pass, never by them — which is why the assertion that they are all
 * `maintainer-overlay` is retained rather than dropped now that the limb is closed.
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
 * Whether the pinned accept corpus's descriptor files exist in this repository.
 *
 * Looks for the vendored corpus directory rather than for the freeze metadata, which is
 * committed and is not the corpus. Phase E wrote this to record an absence; T086a made
 * it a presence, so it now reports which.
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

describe('T086 / SC-009 limb 2 — discharged over the frozen accept corpus', () => {
  test('the frozen accept corpus is materialized in this repository (T086a)', () => {
    // Phase E recorded the opposite, because it was true then. T086a vendored the 24
    // pinned descriptors, so the fact changed and this record changed with it.
    expect(acceptCorpusIsMaterialized()).toBe(true);
  });

  test('a pass over that corpus produced a POPULATED envelope — 25 entities, 0 FP / 0 FN', async () => {
    // Limb 2: "at least one pass over a real corpus meeting ADR-0020 clause 5's
    // conditions produces a populated envelope."
    //
    // The pass itself is Phase F's, and it is a **live** run, not a transcription:
    // `scripts/compare-accept-corpus.test.ts` calls `generateOverCorpus` against the
    // vendored tree on every `bun test`, and separately asserts that the committed
    // report "records the PASS and the counts it was run at". This close-out asserts
    // that recorded outcome. The citation is pinned below so it cannot rot silently.
    const record = (await Bun.file(
      join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence', 'comparison', 'step-b-record.json'),
    ).json()) as Record<string, unknown>;

    expect(record['verdict']).toBe('PASS');

    const counts = record['counts'] as Record<string, number>;
    // 24 selected descriptors carry 24 expected (annotated) entities; the envelope
    // carries 25, because one selected file holds a second, unselected document.
    // Descriptor FILE counts and entity DOCUMENT counts are not the same number.
    expect(counts['expectedEntities']).toBe(24);
    expect(counts['envelopeEntities']).toBe(25);
    expect(counts['envelopeEntities']).toBeGreaterThan(0); // populated, not merely present
    expect(counts['falsePositives']).toBe(0);
    expect(counts['falseNegatives']).toBe(0);

    // A populated envelope has a digest. Integrity, not correctness — the zero/zero
    // comparison above is what speaks to correctness.
    expect((record['ownHashes'] as Record<string, unknown>)['envelopeDigest']).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  test('the corpus the pass ran over is the frozen one, at the pinned commit', async () => {
    // Guards the substitution this limb is most vulnerable to: a PASS recorded over
    // some *other* corpus would satisfy every assertion above and none of clause 5.
    const freeze = (await Bun.file(
      join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence', 'accept-corpus-freeze', 'accept-corpus-freeze.json'),
    ).json()) as Record<string, unknown>;
    const record = (await Bun.file(
      join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence', 'comparison', 'step-b-record.json'),
    ).json()) as Record<string, unknown>;

    // Step (b) recomputes the freeze's hash rather than trusting it; that recomputed
    // value must equal the hash of the freeze as it exists right now.
    const recomputed = (record['recomputedFrozenHashes'] as Record<string, Record<string, unknown>>)[
      'accept-corpus-freeze/accept-corpus-freeze.json'
    ];
    expect(recomputed?.['match']).toBe(true);
    expect(recomputed?.['recorded']).toBe(recomputed?.['recomputed']);

    expect((freeze['corpusRef'] as Record<string, unknown>)['repository']).toBe(
      'github.com/backstage/community-plugins',
    );
    expect(freeze['size']).toBe(24);
  });

  test('the live pass this close-out cites really is a live pass, and still exists', async () => {
    // The citation, pinned. If `compare-accept-corpus.test.ts` stops running a live
    // generation over the corpus, the assertions above would still pass while meaning
    // nothing — so the thing being cited is asserted, not merely named in a comment.
    //
    // A bare `toContain` was tried first and was observed **passing** against a harness
    // whose SC-011 block had been gutted, because the same call appears in other blocks
    // of the same file. That is recorded at
    // `<EVIDENCE>/negative-cases/sc-009-limb-2/`. The pin below is therefore scoped to
    // the SC-011 block itself and counts the live calls inside it.
    const harnessTest = await Bun.file(
      join(REPO_ROOT, 'scripts', 'compare-accept-corpus.test.ts'),
    ).text();

    const start = harnessTest.indexOf('describe(\u2019T088 / SC-011');
    const blockStart =
      start === -1 ? harnessTest.indexOf('the real comparison over the frozen accept corpus') : start;
    expect(blockStart).toBeGreaterThan(-1);
    const rest = harnessTest.slice(blockStart);
    const blockEnd = rest.indexOf('\ndescribe(');
    const block = blockEnd === -1 ? rest : rest.slice(0, blockEnd);

    // Every assertion in that block is driven by a live comparison, not by a record.
    // Five live calls at the time of writing: three `await`ed directly, two inside the
    // determinism test's `Promise.all`. The floor is set below that so an added or
    // removed case does not trip it, but gutting the block does.
    const liveCalls = block.split('compareAcceptCorpus(REPO_ROOT)').length - 1;
    expect(liveCalls).toBeGreaterThanOrEqual(4);
    expect(block).toContain('report.run.envelope.entities.length');
    expect(block).toContain('the committed diff report records the PASS and the counts it was run at');

    // And that `compareAcceptCorpus` genuinely generates rather than reading a record:
    // it is the caller of `generateOverCorpus`, which runs the assembled pipeline over
    // the vendored tree with the overlay applied into a temporary directory.
    const harness = await Bun.file(join(REPO_ROOT, 'scripts', 'compare-accept-corpus.ts')).text();
    expect(harness).toContain('export async function generateOverCorpus');
    expect(harness).toContain('runGeneration');
  });

  test('the freeze still records the corpus metadata, not the descriptors', async () => {
    // Unchanged and load-bearing: the descriptors are vendored OUTSIDE the freeze tree.
    // evidence/README.md §4 requires the freeze tree to carry no corpus the generator
    // could read, because R5 mechanism 1 (input absence) depends on it.
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

  test('every fixture in THIS suite is still maintainer-authored, so none meets clause 5', async () => {
    // Stated as an assertion so no reader mistakes a passing accept case above for a
    // clause-5 conforming pass. Clause 5 requires descriptors "authored upstream and
    // otherwise unmodified"; these were written by this test file. The vendored corpus
    // is not used here — it is used by scripts/compare-accept-corpus.ts, which is
    // exactly why limb 2 is discharged by citing that run rather than by these.
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
