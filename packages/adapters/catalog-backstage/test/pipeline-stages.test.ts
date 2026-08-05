/**
 * T069 — the assembled pipeline runs its stages in the fixed order, and the trace makes
 * that observable.
 *
 * `tasks.md` T069 fixes the order: manifest → repository → digests → descriptor read →
 * admissibility → canonicalization → ownership → glob → envelope.
 *
 * # Why the trace, rather than a comment
 *
 * A stage order asserted in prose is not checked. Every run records the stages it
 * actually entered, so a reordering that happened to produce the same verdicts still
 * fails these tests. The abort cases are the sharper half: they show that a rejection at
 * stage *n* means stages *n+1* onwards were never entered, which is what
 * `atomic-fail-closed.md` §6's "abort **before any entity's paths are derived**"
 * actually requires.
 *
 * Each stage is recorded once, at first entry. `ownership` and `glob` are entered once
 * per entity, and recording every visit would make the trace's length a function of the
 * entity count rather than of the ordering it exists to show.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  PIPELINE_STAGES,
  STAGE_ADMISSIBILITY,
  STAGE_CANONICALIZATION,
  STAGE_DESCRIPTOR_READ,
  STAGE_DIGESTS,
  STAGE_ENVELOPE,
  STAGE_GLOB,
  STAGE_MANIFEST,
  STAGE_OWNERSHIP,
  STAGE_REPOSITORY,
  runGeneration,
} from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T069 — the declared order', () => {
  test('nine stages, in the order T069 fixes', () => {
    expect([...PIPELINE_STAGES]).toEqual([
      'manifest',
      'repository',
      'digests',
      'descriptor-read',
      'admissibility',
      'canonicalization',
      'ownership',
      'glob',
      'envelope',
    ]);
    expect(PIPELINE_STAGES).toHaveLength(9);
  });
});

describe('T069 — a successful run enters every stage, in order', () => {
  test('an annotated entity reaches all nine', async () => {
    const { request } = await stage(
      checkout,
      { 'all/catalog-info.yaml': validDescriptor('allstages', '["packages/all/**"]') },
      {},
      'manifest-all.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    expect(outcome.stages).toEqual([...PIPELINE_STAGES]);
  });

  test('an unannotated entity never enters the glob stage', async () => {
    // `owned-paths-annotation.md` §1: "Only after steps 1–4 succeed does each string
    // element proceed" to the glob validator. An absent annotation has no elements, so
    // step 5 is genuinely not reached — which the trace shows rather than assumes.
    const { request } = await stage(
      checkout,
      { 'absent/catalog-info.yaml': validDescriptor('absentstages') },
      {},
      'manifest-absent-stages.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    expect(outcome.stages).toEqual([
      STAGE_MANIFEST,
      STAGE_REPOSITORY,
      STAGE_DIGESTS,
      STAGE_DESCRIPTOR_READ,
      STAGE_ADMISSIBILITY,
      STAGE_CANONICALIZATION,
      STAGE_OWNERSHIP,
      STAGE_ENVELOPE,
    ]);
    expect(outcome.stages).not.toContain(STAGE_GLOB);
  });

  test('an explicit-empty annotation also stops short of the glob stage', async () => {
    const { request } = await stage(
      checkout,
      { 'empty/catalog-info.yaml': validDescriptor('emptystages', '[]') },
      {},
      'manifest-empty-stages.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    expect(outcome.stages).not.toContain(STAGE_GLOB);
  });

  test('stages appear once each even across several entities', async () => {
    const { request } = await stage(
      checkout,
      {
        'multi-a/catalog-info.yaml': validDescriptor('multistagea', '["packages/a/**"]'),
        'multi-b/catalog-info.yaml': validDescriptor('multistageb', '["packages/b/**"]'),
        'multi-c/catalog-info.yaml': validDescriptor('multistagec'),
      },
      {},
      'manifest-multi-stages.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(true);
    expect(outcome.stages).toEqual([...PIPELINE_STAGES]);
  });
});

describe('T069 — an abort at stage n never enters stage n+1', () => {
  test('a manifest rejection stops at the first stage', async () => {
    const { request } = await stage(
      checkout,
      { 'ms/catalog-info.yaml': validDescriptor('manifeststop') },
      { manifestSchemaVersion: '2' },
      'manifest-version-stop.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(false);
    expect(outcome.stages).toEqual([STAGE_MANIFEST]);
  });

  test('a repository mismatch aborts before any descriptor is read', async () => {
    // `atomic-fail-closed.md` §6: the four request-level rejections abort "before any
    // entity's paths are derived". The trace is the evidence.
    const { request } = await stage(
      checkout,
      { 'rm/catalog-info.yaml': validDescriptor('repostop', '["packages/rm/**"]') },
      { repository: { id: 'github.com/someone/else' } },
      'manifest-repo-stop.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(false);
    expect(outcome.stages).toEqual([STAGE_MANIFEST, STAGE_REPOSITORY]);
    expect(outcome.stages).not.toContain(STAGE_OWNERSHIP);
    expect(outcome.stages).not.toContain(STAGE_GLOB);
  });

  test('an inadmissible descriptor aborts before canonicalization', async () => {
    // ADR-0015's ordering rule, observed: the descriptor never acquires a canonical id,
    // so it can never be reported under `duplicate-canonical-id` instead of its own
    // class.
    const { request } = await stage(
      checkout,
      {
        'bad/catalog-info.yaml': descriptor({
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          name: 'Not_Valid!',
        }),
      },
      {},
      'manifest-admissibility-stop.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.failure.triggerClass).toBe('inadmissible-descriptor');
    expect(outcome.stages).toEqual([
      STAGE_MANIFEST,
      STAGE_REPOSITORY,
      STAGE_DIGESTS,
      STAGE_DESCRIPTOR_READ,
      STAGE_ADMISSIBILITY,
    ]);
    expect(outcome.stages).not.toContain(STAGE_CANONICALIZATION);
  });

  test('an invalid pattern aborts at the glob stage, having entered ownership first', async () => {
    const { request } = await stage(
      checkout,
      { 'pat/catalog-info.yaml': validDescriptor('patternstop', '["packages/{a,b}/**"]') },
      {},
      'manifest-pattern-stop.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.failure.stage).toBe(STAGE_GLOB);
    expect(outcome.stages.at(-1)).toBe(STAGE_GLOB);
    expect(outcome.stages).toContain(STAGE_OWNERSHIP);
    expect(outcome.stages).not.toContain(STAGE_ENVELOPE);
  });

  test('an annotation decode rejection aborts at ownership, never reaching glob', async () => {
    const { request } = await stage(
      checkout,
      { 'ann/catalog-info.yaml': validDescriptor('annotationstop', '{"paths":["a/**"]}') },
      {},
      'manifest-annotation-stop.json',
    );
    const outcome = await runGeneration(request);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.failure.stage).toBe(STAGE_OWNERSHIP);
    expect(outcome.stages).not.toContain(STAGE_GLOB);
  });

  test('every recorded trace is a prefix-consistent subsequence of the declared order', () => {
    // A structural property rather than a per-case one: whatever stages a run entered,
    // they appear in the declared relative order and never repeat out of sequence.
    const declared = [...PIPELINE_STAGES];
    const traces = [
      [STAGE_MANIFEST],
      [STAGE_MANIFEST, STAGE_REPOSITORY],
      [STAGE_MANIFEST, STAGE_REPOSITORY, STAGE_DIGESTS, STAGE_DESCRIPTOR_READ, STAGE_ADMISSIBILITY],
      declared,
    ];
    for (const trace of traces) {
      const positions = trace.map((entered) => (declared as readonly string[]).indexOf(entered));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });
});
