/**
 * Independent digest recomputation (`snapshot-envelope.md` §3;
 * `data-model.md` §12; `spec.md` FR-040, FR-041; T031).
 *
 * **Scope, before any assertion below.** A digest match proves
 * accidental-corruption and naive-mutation detection only. It does not resist an
 * adversary who mutates content and recomputes the same digest. And separately:
 * a populated, digest-verified envelope proves **integrity, not correctness** —
 * a semantically wrong envelope can carry a perfectly valid self-digest. Nothing
 * in this file establishes that any `derivedPaths` value is *right*, and nothing
 * here may be cited as if it did.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { canonicalStringify } from '@adrkit/core';
import {
  DIGEST_GUARANTEE_SCOPE,
  admitEnvelope,
  canonicalFormOf,
  checkEnvelopeDigest,
  recomputeEnvelopeDigest,
  validateEnvelope,
} from '../src/index.ts';
import { ADMIT_OPTIONS_A, VALIDATE_OPTIONS, fixtureText, fixtureValue } from './helpers.ts';

function validatedFixture(name: string) {
  const result = validateEnvelope(fixtureText(name), VALIDATE_OPTIONS);
  if (result.outcome !== 'valid') {
    throw new Error(`${name} did not pass the five steps: ${result.reason} — ${result.detail}`);
  }
  return result.validated;
}

describe('canonicalization', () => {
  test('the digest field itself is excluded and every other field is included', () => {
    const envelope = fixtureValue('valid.json');
    const canonical = canonicalFormOf(envelope as never);

    expect(canonical).not.toContain('"digest":"08b544b4');
    for (const field of [
      'schemaVersion',
      'repository',
      'generatorVersion',
      'globDialect',
      'capabilities',
      'completeness',
      'sources',
      'entities',
    ]) {
      expect(canonical).toContain(`"${field}":`);
    }
    // `schemaVersion` is included — §3 step 1 says so explicitly, and omitting
    // it is the easy mistake because it looks like metadata about the envelope
    // rather than content of it.
    expect(canonical.startsWith('{"capabilities":["pathOwnership"],')).toBe(true);
  });

  test('object keys are sorted at every nesting level, arrays are not', () => {
    const envelope = fixtureValue('valid.json');
    const canonical = canonicalFormOf(envelope as never);

    // Top level, sorted: capabilities < completeness < entities < generatorVersion < ...
    expect(canonical.indexOf('"capabilities"')).toBeLessThan(canonical.indexOf('"completeness"'));
    expect(canonical.indexOf('"completeness"')).toBeLessThan(canonical.indexOf('"entities"'));
    // Nested, sorted: globDialect { engine, options, version }
    expect(canonical.indexOf('"engine"')).toBeLessThan(canonical.indexOf('"options"'));
    expect(canonical.indexOf('"options":{"dot"')).toBeGreaterThan(-1);
    // Arrays keep declaration order — the two payments patterns are not re-sorted
    // relative to each other by the canonicalizer.
    expect(canonical).toContain('["apis/payments/**","packages/payments/**"]');
  });

  test('the digest is 64 lowercase hex over the UTF-8 bytes of the canonical form', () => {
    const envelope = fixtureValue('valid.json');
    const recomputed = recomputeEnvelopeDigest(envelope as never);

    expect(recomputed).toMatch(/^[0-9a-f]{64}$/);

    // Recomputed the long way, independently of the module under test, so this
    // asserts a specific observed value rather than that the function agrees
    // with itself.
    const { digest: _excluded, ...rest } = envelope as Record<string, unknown>;
    const expected = createHash('sha256').update(canonicalStringify(rest), 'utf8').digest('hex');
    expect(recomputed).toBe(expected);
    expect(envelope['digest']).toBe(recomputed);
  });

  test('reordering the keys of an envelope does not change its digest', () => {
    const envelope = fixtureValue('valid.json');
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(envelope).reverse()) shuffled[key] = envelope[key];

    expect(recomputeEnvelopeDigest(shuffled as never)).toBe(recomputeEnvelopeDigest(envelope as never));
  });

  test('recomputation is stable across repeated runs', () => {
    const envelope = fixtureValue('valid.json');
    const runs = new Set([0, 1, 2, 3, 4].map(() => recomputeEnvelopeDigest(envelope as never)));
    expect(runs.size).toBe(1);
  });
});

describe('digest verification', () => {
  test('the valid fixture matches', () => {
    const result = checkEnvelopeDigest(validatedFixture('valid.json'));

    expect(result.outcome).toBe('match');
    expect(result.declaredDigest).toBe(result.recomputedDigest);
    expect(result.declaredDigest).toBe('08b544b48fb8c3f1672c249623ad7bffb3b025cd2a8cabea208d98800e279df2');
  });

  test('the tampered fixture is rejected, and the mismatch is named', () => {
    // `tampered.json` gained a third element in `entities[0].derivedPaths` after
    // the digest was computed. It passes all five validation steps — the payload
    // is structurally perfect — so the only thing that can catch it is the
    // recomputation.
    const validation = validateEnvelope(fixtureText('tampered.json'), VALIDATE_OPTIONS);
    expect(validation.outcome).toBe('valid');
    if (validation.outcome !== 'valid') return;

    const result = checkEnvelopeDigest(validation.validated);
    expect(result.outcome).toBe('digest-mismatch');
    expect(result.declaredDigest).not.toBe(result.recomputedDigest);
    expect(result.declaredDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recomputedDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('admission refuses the tampered fixture at the digest stage, not earlier', () => {
    const result = admitEnvelope(fixtureText('tampered.json'), ADMIT_OPTIONS_A);

    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('digest');
    expect(result.reason).toBe('digest-mismatch');
    expect(result.detail).toContain('but its canonical form hashes to');
    // It passed all five steps first — the rejection is attributable to the
    // digest and to nothing else.
    expect(result.validation.outcome).toBe('valid');
  });

  test('a single flipped character anywhere in the payload is detected', () => {
    const envelope = fixtureValue('valid.json');
    (envelope['repository'] as Record<string, unknown>)['revision'] =
      '1e0f3c9a8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e30';
    const validation = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);
    expect(validation.outcome).toBe('valid');
    if (validation.outcome !== 'valid') return;

    expect(checkEnvelopeDigest(validation.validated).outcome).toBe('digest-mismatch');
  });

  test('the declared digest is never trusted unconditionally', () => {
    // An envelope declaring a digest of the right *shape* but the wrong value is
    // rejected. A consumer that read `digest` and believed it would pass this.
    const envelope = fixtureValue('valid.json');
    envelope['digest'] = 'a'.repeat(64);
    const validation = validateEnvelope(JSON.stringify(envelope), VALIDATE_OPTIONS);
    expect(validation.outcome).toBe('valid');
    if (validation.outcome !== 'valid') return;

    const result = checkEnvelopeDigest(validation.validated);
    expect(result.outcome).toBe('digest-mismatch');
    expect(result.declaredDigest).toBe('a'.repeat(64));
  });
});

describe('the guarantee scope travels with the result', () => {
  test('every digest result carries the scope statement', () => {
    for (const fixture of ['valid.json', 'tampered.json']) {
      const validation = validateEnvelope(fixtureText(fixture), VALIDATE_OPTIONS);
      if (validation.outcome !== 'valid') throw new Error(`${fixture} failed validation`);
      expect(checkEnvelopeDigest(validation.validated).guaranteeScope).toBe(DIGEST_GUARANTEE_SCOPE);
    }
  });

  test('the scope statement names both limits and claims neither strength', () => {
    expect(DIGEST_GUARANTEE_SCOPE).toContain('accidental corruption and naive mutation only');
    expect(DIGEST_GUARANTEE_SCOPE).toContain('Does not resist an adversary');
    expect(DIGEST_GUARANTEE_SCOPE).toContain('integrity, not correctness');
    expect(DIGEST_GUARANTEE_SCOPE.toLowerCase()).not.toContain('tamper-proof');
    expect(DIGEST_GUARANTEE_SCOPE.toLowerCase()).not.toContain('tamper-resistant');
  });
});
