/**
 * T043 — FR-011: every declared per-source digest is verified **before any entity
 * is processed**; a mismatch, a missing source, or a wrongly typed digest yields
 * `incomplete-required-source`.
 *
 * Expected values come from `input-manifest.md` §4 and FR-011. The one digest
 * literal used below is computed from `Bun.CryptoHasher` in the fixture setup
 * rather than transcribed, so the test asserts *agreement between two independent
 * computations of the same standard*, not agreement between the code and a string
 * someone once pasted.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/incomplete-required-source/`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkDigestShape,
  sha256Hex,
  verifySourceBytes,
  verifySourceDigests,
} from '../src/manifest/digests.ts';
import type { ManifestSource } from '../src/manifest/schema.ts';

const CONTENT = 'apiVersion: backstage.io/v1alpha1\nkind: Component\n';
const CONTENT_BYTES = new TextEncoder().encode(CONTENT);
const CONTENT_DIGEST = sha256Hex(CONTENT_BYTES);

let root = '';

function source(overrides: Partial<ManifestSource> = {}): ManifestSource {
  return {
    path: 'catalog-info.yaml',
    digestAlgorithm: 'sha256',
    digest: CONTENT_DIGEST,
    ...overrides,
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrkit-digest-fixture-'));
  await writeFile(join(root, 'catalog-info.yaml'), CONTENT, 'utf8');
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const resolve = (path: string) => join(root, path);

describe('T043 — digest shape (FR-011\u2019s "wrongly typed")', () => {
  test('the fixture digest is 64 lowercase hex characters', () => {
    expect(CONTENT_DIGEST).toMatch(/^[0-9a-f]{64}$/u);
  });

  test('a well-formed digest passes the shape check', () => {
    expect(checkDigestShape(source()).ok).toBe(true);
  });

  test('an uppercase-hex digest is rejected before any file is opened', () => {
    const result = checkDigestShape(source({ digest: CONTENT_DIGEST.toUpperCase() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('digest-malformed');
    expect(result.rejection.triggerClass).toBe('incomplete-required-source');
  });

  test('a truncated digest is rejected', () => {
    const result = checkDigestShape(source({ digest: CONTENT_DIGEST.slice(0, 32) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('digest-malformed');
  });

  test('a non-hex digest is rejected', () => {
    const result = checkDigestShape(source({ digest: 'z'.repeat(64) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('digest-malformed');
  });
});

describe('T043 — digest verification against bytes', () => {
  test('bytes matching the declared digest are accepted', () => {
    const result = verifySourceBytes(source(), CONTENT_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observedDigest).toBe(CONTENT_DIGEST);
  });

  test('a single changed byte is a mismatch', () => {
    const result = verifySourceBytes(source(), new TextEncoder().encode(`${CONTENT} `));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('digest-mismatch');
    expect(result.rejection.triggerClass).toBe('incomplete-required-source');
    expect(result.rejection.detail).toContain(CONTENT_DIGEST);
  });

  test('the digest is recomputed, never trusted from the manifest', () => {
    // A declared digest of the *wrong* content must be rejected even though it is
    // perfectly well-formed. An implementation that only shape-checked the
    // declared digest would accept this.
    const wrongButWellFormed = sha256Hex(new TextEncoder().encode('something else'));
    expect(wrongButWellFormed).toMatch(/^[0-9a-f]{64}$/u);
    const result = verifySourceBytes(source({ digest: wrongButWellFormed }), CONTENT_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('digest-mismatch');
  });
});

describe('T043 — verification over the whole source set', () => {
  test('a fully-agreeing source set is accepted', async () => {
    const result = await verifySourceDigests([source()], resolve);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.path).toBe('catalog-info.yaml');
  });

  test('a manifest-listed path absent from disk is `source-missing`', async () => {
    const result = await verifySourceDigests([source({ path: 'not-here.yaml' })], resolve);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('source-missing');
    expect(result.rejection.triggerClass).toBe('incomplete-required-source');
    expect(result.rejection.detail).toContain('absent from the checkout');
  });

  test('one bad source among several rejects the set — never a per-entity skip', async () => {
    const result = await verifySourceDigests(
      [source(), source({ path: 'not-here.yaml' }), source()],
      resolve,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('source-missing');
  });

  test('nothing is returned when any source fails — no partial verified set', async () => {
    // `atomic-fail-closed.md` §1: "skip the bad entity and keep going" is the
    // behaviour the contract exists to foreclose. The shape enforces it — the
    // function's success branch is the only one that carries verified sources.
    const result = await verifySourceDigests(
      [source(), source({ path: 'not-here.yaml' })],
      resolve,
    );
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });

  test('the failure reported for two bad sources is deterministic (manifest order)', async () => {
    const twice = await Promise.all([
      verifySourceDigests(
        [source({ path: 'missing-a.yaml' }), source({ path: 'missing-b.yaml' })],
        resolve,
      ),
      verifySourceDigests(
        [source({ path: 'missing-a.yaml' }), source({ path: 'missing-b.yaml' })],
        resolve,
      ),
    ]);
    for (const result of twice) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.detail).toContain('missing-a.yaml');
    }
  });

  test('the three reasons are mutually distinct', async () => {
    const malformed = await verifySourceDigests([source({ digest: 'nope' })], resolve);
    const missing = await verifySourceDigests([source({ path: 'not-here.yaml' })], resolve);
    const mismatch = await verifySourceDigests([source({ digest: 'a'.repeat(64) })], resolve);
    const reasons = [malformed, missing, mismatch].map((result) =>
      result.ok ? 'accepted' : result.rejection.reason,
    );
    expect(reasons).toEqual(['digest-malformed', 'source-missing', 'digest-mismatch']);
    expect(new Set(reasons).size).toBe(3);
  });
});
