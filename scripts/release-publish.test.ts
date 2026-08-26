import { describe, expect, test } from 'bun:test';
import {
  assertPublishTag,
  existingIntegrity,
  publishArtifacts,
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

  test('dry runs skip matching artifacts and publish absent ones', async () => {
    const existing = { ...artifact, name: '@adrkit/spec-kit', version: '0.1.2' };
    const next = { ...artifact, version: '0.11.0' };
    const lookups: string[] = [];
    const published: Array<{ name: string; dryRun: boolean }> = [];

    await publishArtifacts(
      [existing, next],
      true,
      async (candidate) => {
        lookups.push(candidate.name);
        return candidate === existing ? candidate.integrity : undefined;
      },
      async (candidate, dryRun) => {
        published.push({ name: candidate.name, dryRun });
      },
    );

    expect(lookups).toEqual(['@adrkit/spec-kit', '@adrkit/core']);
    expect(published).toEqual([{ name: '@adrkit/core', dryRun: true }]);
  });

  test('requires the exact tag the manifest names, not one rebuilt from the version', () => {
    // A lockstep manifest and an adapter manifest can carry the same version and
    // still require different tags. Deriving the expectation from the version
    // would accept the wrong tag for the adapter.
    const lockstep = { version: '0.3.0', tag: 'v0.3.0', artifacts: [] };
    const adapter = { version: '0.1.0', tag: 'spec-kit-v0.1.0', artifacts: [] };

    expect(() => assertPublishTag(lockstep, 'v0.3.0')).not.toThrow();
    expect(() => assertPublishTag(adapter, 'spec-kit-v0.1.0')).not.toThrow();

    expect(() => assertPublishTag(adapter, 'v0.1.0')).toThrow('must match spec-kit-v0.1.0');
    expect(() => assertPublishTag(lockstep, 'spec-kit-v0.3.0')).toThrow('must match v0.3.0');
    expect(() => assertPublishTag(adapter, undefined)).toThrow('(missing)');
  });

  test('keeps bootstrap credentials out of existing package publishes', () => {
    const environment = publishEnvironment('@adrkit/core', {
      NPM_BOOTSTRAP_TOKEN: 'bootstrap-token',
      NODE_AUTH_TOKEN: 'inherited-token',
      PATH: '/bin',
    });

    expect(environment).toEqual({ PATH: '/bin' });
  });

  test('no package receives the bootstrap credential once all names exist', () => {
    // The steady state. @adrkit/mcp bootstrapped for 0.2.0 and @adrkit/spec-kit
    // for 0.1.0; both now publish over OIDC. A name left in the bootstrap set
    // after Trusted Publishing is configured keeps receiving a long-lived token
    // it no longer needs — exactly the credential sprawl the set bounds.
    for (const name of [
      '@adrkit/core',
      '@adrkit/cli',
      '@adrkit/evaluator',
      '@adrkit/mcp',
      '@adrkit/spec-kit',
    ]) {
      expect({
        name,
        environment: publishEnvironment(name, {
          NPM_BOOTSTRAP_TOKEN: 'bootstrap-token',
          PATH: '/bin',
        }),
      }).toEqual({ name, environment: { PATH: '/bin' } });
    }
  });

  test('uses OIDC for MCP after the bootstrap credential is removed', () => {
    expect(publishEnvironment('@adrkit/mcp', { PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });
});
