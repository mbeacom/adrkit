import { describe, expect, test } from 'bun:test';
import {
  existingIntegrity,
  publishEnvironment,
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

  test('keeps bootstrap credentials out of existing package publishes', () => {
    const environment = publishEnvironment('@adrkit/core', {
      NPM_BOOTSTRAP_TOKEN: 'bootstrap-token',
      NODE_AUTH_TOKEN: 'inherited-token',
      PATH: '/bin',
    });

    expect(environment).toEqual({ PATH: '/bin' });
  });

  test('maps the bootstrap credential only to a package awaiting its first publish', () => {
    const environment = publishEnvironment('@adrkit/spec-kit', {
      NPM_BOOTSTRAP_TOKEN: 'bootstrap-token',
      PATH: '/bin',
    });

    expect(environment).toEqual({
      NODE_AUTH_TOKEN: 'bootstrap-token',
      PATH: '/bin',
    });
  });

  test('an already-published package never receives the bootstrap credential', () => {
    // @adrkit/mcp bootstrapped in 0.2.0 and has used OIDC ever since. Leaving a
    // published name in the bootstrap set would hand it a token it no longer
    // needs, which is exactly the credential sprawl the set exists to bound.
    for (const published of ['@adrkit/core', '@adrkit/cli', '@adrkit/evaluator', '@adrkit/mcp']) {
      expect({
        published,
        environment: publishEnvironment(published, {
          NPM_BOOTSTRAP_TOKEN: 'bootstrap-token',
          PATH: '/bin',
        }),
      }).toEqual({ published, environment: { PATH: '/bin' } });
    }
  });

  test('uses OIDC for MCP after the bootstrap credential is removed', () => {
    expect(publishEnvironment('@adrkit/mcp', { PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });
});
