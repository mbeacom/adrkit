import { describe, expect, test } from 'bun:test';
import {
  existingIntegrity,
  shouldPublishArtifact,
} from './release-publish.ts';
import type { ReleaseArtifact } from './release-pack.ts';

const artifact: ReleaseArtifact = {
  name: '@adrkit/core',
  version: '0.1.0',
  tarball: 'adrkit-core-0.1.0.tgz',
  integrity: 'sha512-local',
};

function fetchResponse(status: number, body?: unknown): (url: string) => Promise<Response> {
  return async () =>
    new Response(body === undefined ? undefined : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('release registry safety', () => {
  test('treats a registry 404 as an unpublished artifact', async () => {
    await expect(existingIntegrity(artifact, fetchResponse(404))).resolves.toBeUndefined();
  });

  test('rejects non-success registry responses', async () => {
    await expect(existingIntegrity(artifact, fetchResponse(503))).rejects.toThrow(
      'failed with 503',
    );
  });

  test('rejects registry metadata without integrity', async () => {
    await expect(existingIntegrity(artifact, fetchResponse(200, { dist: {} }))).rejects.toThrow(
      'has no integrity',
    );
  });

  test('returns the published registry integrity', async () => {
    await expect(
      existingIntegrity(artifact, fetchResponse(200, { dist: { integrity: artifact.integrity } })),
    ).resolves.toBe(artifact.integrity);
  });

  test('publishes only absent artifacts and skips exact reruns', () => {
    expect(shouldPublishArtifact(artifact, undefined)).toBe(true);
    expect(shouldPublishArtifact(artifact, artifact.integrity)).toBe(false);
  });

  test('hard-fails when an existing version has different bytes', () => {
    expect(() => shouldPublishArtifact(artifact, 'sha512-other')).toThrow(
      'already exists with different integrity',
    );
  });
});
