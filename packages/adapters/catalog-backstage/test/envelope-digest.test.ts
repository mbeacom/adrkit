/**
 * T081 / FR-040 — the envelope digest: SHA-256 over the canonical form of every field
 * except `digest` itself, as 64 lowercase hexadecimal characters.
 *
 * `snapshot-envelope.md` §3 and `package-boundary.md` §2.1, §2.2.
 *
 * # The scope qualification, restated here because this is where a reader meets it
 *
 * For the envelope's **closed scalar domain** the canonical bytes are *equivalent to*
 * RFC 8785 / JCS output. **No claim is made that `canonicalStringify` is a
 * general-purpose RFC 8785 implementation.** The digest proves accidental-corruption
 * and naive-mutation detection **only** (FR-041) — never adversarial tamper-resistance.
 * And integrity is not correctness (SC-012): a digest-verified envelope is evidence
 * that the bytes are the bytes that were written, not that the ownership in them is
 * right.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { canonicalStringify, compareCodeUnits } from '@adrkit/core';
import {
  DIGEST_ALGORITHM,
  ENVELOPE_DIGEST_PATTERN,
  canonicalEnvelopeForm,
  computeEnvelopeDigest,
  verifyEnvelopeDigest,
} from '../src/envelope/digest.ts';
import type { SnapshotEnvelope } from '../src/envelope/shape.ts';
import { runGeneration } from '../src/pipeline.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let envelope: SnapshotEnvelope;

beforeAll(async () => {
  checkout = await createCheckout();
  const { request } = await stage(checkout, {
    'digest-a/catalog-info.yaml': validDescriptor('digesta', '["packages/a/**","apis/a/**"]'),
    'digest-b/catalog-info.yaml': validDescriptor('digestb'),
  });
  const outcome = await runGeneration(request);
  if (!outcome.ok) throw new Error(`fixture failed to generate: ${outcome.failure.detail}`);
  envelope = outcome.envelope;
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T081 — the rendering `snapshot-envelope.md` §3 requires', () => {
  test('64 lowercase hexadecimal characters', () => {
    expect(envelope.digest).toMatch(ENVELOPE_DIGEST_PATTERN);
    expect(envelope.digest).toHaveLength(64);
    expect(envelope.digest).toBe(envelope.digest.toLowerCase());
  });

  test('the algorithm is sha256', () => {
    expect(DIGEST_ALGORITHM).toBe('sha256');
  });
});

describe('T081 — the digest field itself is excluded from its own input', () => {
  test('the canonical form has no top-level `digest` key', () => {
    // Checked at the top level specifically. `sources[].digest` is a different field
    // and is deliberately *inside* the hashed content — an earlier version of this
    // assertion searched the whole string and failed for that reason.
    const { digest: _omitted, ...unsigned } = envelope;
    const form = JSON.parse(canonicalEnvelopeForm(unsigned)) as Record<string, unknown>;
    expect(Object.hasOwn(form, 'digest')).toBe(false);
    expect(Object.keys(form).sort()).toEqual([
      'capabilities',
      'completeness',
      'entities',
      'generatorVersion',
      'globDialect',
      'repository',
      'schemaVersion',
      'sources',
    ]);
  });

  test('the canonical form does contain every other top-level field', () => {
    const { digest: _omitted, ...unsigned } = envelope;
    const form = canonicalEnvelopeForm(unsigned);
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
      expect(form).toContain(`"${field}"`);
    }
  });

  test('`sources[].digest` is not excluded — only the envelope\u2019s own digest is', () => {
    // Easy to get wrong by excluding the key name rather than the top-level field.
    const { digest: _omitted, ...unsigned } = envelope;
    expect(canonicalEnvelopeForm(unsigned)).toContain(envelope.sources[0]?.digest as string);
  });
});

describe('T081 — the canonical form is canonical', () => {
  test('keys are sorted by code units at every nesting level', () => {
    const { digest: _omitted, ...unsigned } = envelope;
    const form = canonicalEnvelopeForm(unsigned);

    // Top level: the emitted envelope declares `schemaVersion` first, so a canonical
    // form starting with `capabilities` is evidence the sort actually happened rather
    // than the declaration order being reused.
    expect(form.startsWith('{"capabilities"')).toBe(true);

    const entityForm = canonicalStringify(envelope.entities[0]);
    expect(entityForm.startsWith('{"derivedPaths"')).toBe(true);
  });

  test('arrays keep their declaration order and are never re-sorted', () => {
    // §3 step 2: "serialize arrays in their existing declaration order (never
    // re-sorted)". `derivedPaths` is already `compareCodeUnits`-sorted by `glob/order.ts`,
    // so a fixture whose ordering differs from the sort is needed to tell the two apart.
    const declared = ['zeta/**', 'alpha/**'];
    const form = canonicalStringify({ derivedPaths: declared });
    expect(form).toBe('{"derivedPaths":["zeta/**","alpha/**"]}');
    expect([...declared].sort(compareCodeUnits)).toEqual(['alpha/**', 'zeta/**']);
  });

  test('the serialization is compact — no insignificant whitespace', () => {
    const { digest: _omitted, ...unsigned } = envelope;
    const form = canonicalEnvelopeForm(unsigned);
    expect(form).not.toContain('\n');
    expect(form).not.toContain(': ');
    expect(form).not.toContain(', ');
  });

  test('an undefined field is omitted rather than serialized as null', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('T081 — an independent recomputation agrees', () => {
  test('recomputing from the canonical form with node:crypto matches the recorded digest', () => {
    // Independent of `envelope/digest.ts`'s own helper: this hashes the canonical form
    // directly, so a fault in `computeEnvelopeDigest`'s wrapper is visible.
    const { digest: declared, ...unsigned } = envelope;
    const recomputed = createHash('sha256').update(canonicalStringify(unsigned), 'utf8').digest('hex');
    expect(recomputed).toBe(declared);
  });

  test('verifyEnvelopeDigest reports a match on an untouched envelope', () => {
    expect(verifyEnvelopeDigest(envelope).outcome).toBe('match');
  });

  test('a naive mutation is detected', () => {
    // FR-041's exact scope: naive mutation, not an adversary who recomputes the digest.
    const tampered: SnapshotEnvelope = {
      ...envelope,
      entities: envelope.entities.map((entity, index) =>
        index === 0 ? { ...entity, derivedPaths: ['injected/**'] } : entity,
      ),
    };
    const result = verifyEnvelopeDigest(tampered);
    expect(result.outcome).toBe('digest-mismatch');
    expect(result.declaredDigest).toBe(envelope.digest);
    expect(result.recomputedDigest).not.toBe(envelope.digest);
  });

  test('an adversary who recomputes the digest is NOT detected, as FR-041 states', () => {
    // Asserted rather than left implicit, so no reader infers a stronger guarantee from
    // the mutation case passing above.
    const { digest: _omitted, ...unsigned } = envelope;
    const mutated = {
      ...unsigned,
      entities: unsigned.entities.map((entity, index) =>
        index === 0 ? { ...entity, derivedPaths: ['injected/**'] } : entity,
      ),
    };
    const resigned: SnapshotEnvelope = { ...mutated, digest: computeEnvelopeDigest(mutated) };
    expect(verifyEnvelopeDigest(resigned).outcome).toBe('match');
    expect(resigned.entities[0]?.derivedPaths).toEqual(['injected/**']);
  });

  test('verifyEnvelopeDigest does not mutate its input', () => {
    const before = JSON.stringify(envelope);
    verifyEnvelopeDigest(envelope);
    expect(JSON.stringify(envelope)).toBe(before);
  });
});

describe('T081 — the digest is a function of content, not of field order', () => {
  test('reordering top-level keys leaves the digest unchanged', () => {
    const { digest: declared, ...unsigned } = envelope;
    const reordered = {
      entities: unsigned.entities,
      sources: unsigned.sources,
      completeness: unsigned.completeness,
      capabilities: unsigned.capabilities,
      globDialect: unsigned.globDialect,
      generatorVersion: unsigned.generatorVersion,
      repository: unsigned.repository,
      schemaVersion: unsigned.schemaVersion,
    };
    expect(computeEnvelopeDigest(reordered)).toBe(declared);
  });

  test('changing any content changes the digest', () => {
    const { digest: declared, ...unsigned } = envelope;
    expect(computeEnvelopeDigest({ ...unsigned, generatorVersion: 'other' })).not.toBe(declared);
  });
});
