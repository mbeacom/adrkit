import { describe, expect, test } from 'bun:test';
import {
  RELEASE_PACKAGES,
  findWorkspaceProtocols,
  validatePackedManifest,
  validateSourceManifests,
  versionFor,
  type PackageManifest,
  type ReleasePackageDefinition,
} from './release-pack.ts';

/**
 * Build a source manifest shaped like the definition expects. A package that
 * ships no Node artifact must not carry `dist` or an engine constraint — using
 * one fixture shape for both kinds would let the packaging rules pass by
 * accident.
 */
function sourceManifest(
  definition: ReleasePackageDefinition,
  version = '0.1.0',
): PackageManifest {
  const base: PackageManifest = {
    name: definition.name,
    version,
    description: `${definition.name} description`,
    repository: {
      type: 'git',
      url: 'git+https://github.com/mbeacom/adrkit.git',
      directory: definition.directory,
    },
    publishConfig: { access: 'public' },
    files: definition.shipsNodeArtifact ? ['dist', 'README.md'] : ['extension.yml', 'README.md'],
  };
  if (definition.shipsNodeArtifact) base.engines = { node: '>=22' };
  return base;
}

/** Every package at the version its own `versioning` mode implies. */
function alignedManifests(lockstepVersion = '0.1.0'): Map<string, PackageManifest> {
  return new Map(
    RELEASE_PACKAGES.map((definition) => [
      definition.name,
      sourceManifest(
        definition,
        definition.versioning === 'lockstep' ? lockstepVersion : '9.9.9',
      ),
    ]),
  );
}

const resolveTo = (version: string) => () => version;

describe('release package validation', () => {
  test('accepts aligned public source manifests and matching tag', () => {
    expect(validateSourceManifests(alignedManifests(), 'v0.1.0')).toBe('0.1.0');
  });

  test('rejects lockstep version drift before packing', () => {
    const manifests = alignedManifests();
    const drifting = RELEASE_PACKAGES.find((d) => d.versioning === 'lockstep' && d.name !== RELEASE_PACKAGES[0]!.name)!;
    manifests.set(drifting.name, sourceManifest(drifting, '0.2.0'));
    expect(() => validateSourceManifests(manifests)).toThrow('versions must match');
  });

  test('an independently versioned package does not have to match the tag', () => {
    // ADR-0007: an adapter's semver contract is with its upstream. The release
    // tag names the lockstep surface's version and says nothing about it.
    const independent = RELEASE_PACKAGES.filter((d) => d.versioning === 'independent');
    expect(independent.length).toBeGreaterThan(0);

    const manifests = alignedManifests('0.1.0');
    for (const definition of independent) {
      expect(manifests.get(definition.name)?.version).toBe('9.9.9');
    }
    expect(validateSourceManifests(manifests, 'v0.1.0')).toBe('0.1.0');
  });

  test('versionFor gives each package the version it publishes at', () => {
    const manifests = alignedManifests('0.1.0');
    for (const definition of RELEASE_PACKAGES) {
      expect({
        name: definition.name,
        version: versionFor(definition, manifests, '0.1.0'),
      }).toEqual({
        name: definition.name,
        version: definition.versioning === 'lockstep' ? '0.1.0' : '9.9.9',
      });
    }
  });

  test('a package shipping no Node artifact may not publish dist', () => {
    const independent = RELEASE_PACKAGES.find((d) => !d.shipsNodeArtifact)!;
    const manifests = alignedManifests();
    manifests.set(independent.name, {
      ...sourceManifest(independent),
      files: ['dist', 'README.md'],
    });
    expect(() => validateSourceManifests(manifests)).toThrow('publishes dist');
  });

  test('a package shipping a Node artifact must still declare dist and an engine', () => {
    const nodePackage = RELEASE_PACKAGES.find((d) => d.shipsNodeArtifact)!;
    const missingDist = alignedManifests();
    missingDist.set(nodePackage.name, {
      ...sourceManifest(nodePackage),
      files: ['README.md'],
    });
    expect(() => validateSourceManifests(missingDist)).toThrow('must publish dist');

    const missingEngine = alignedManifests();
    const withoutEngine = sourceManifest(nodePackage);
    delete withoutEngine.engines;
    missingEngine.set(nodePackage.name, withoutEngine);
    expect(() => validateSourceManifests(missingEngine)).toThrow('must require Node >=22');
  });

  test('rejects a non-SemVer version on any package, lockstep or not', () => {
    const independent = RELEASE_PACKAGES.find((d) => d.versioning === 'independent')!;
    const manifests = alignedManifests();
    manifests.set(independent.name, sourceManifest(independent, '1.0.0-beta'));
    expect(() => validateSourceManifests(manifests)).toThrow('must be stable SemVer');
  });

  test('finds workspace protocols at any manifest depth', () => {
    expect(
      findWorkspaceProtocols({
        dependencies: { '@adrkit/core': 'workspace:*' },
        overrides: { nested: ['workspace:^'] },
      }),
    ).toEqual(['package.json.dependencies.@adrkit/core', 'package.json.overrides.nested[0]']);
  });

  test('requires packed workspace dependencies to resolve to the dependency own version', () => {
    const evaluator = RELEASE_PACKAGES[1]!;
    expect(() =>
      validatePackedManifest(
        evaluator,
        {
          name: evaluator.name,
          version: '0.1.0',
          dependencies: { '@adrkit/core': '^0.1.0' },
        },
        '0.1.0',
        resolveTo('0.1.0'),
      ),
    ).toThrow('must resolve @adrkit/core to 0.1.0');
  });
});

describe('release package validation — @adrkit/mcp (Phase 5)', () => {
  test('@adrkit/mcp is the fourth public release package with a packed bin and dist/bin.js', () => {
    expect(RELEASE_PACKAGES.map((p) => p.name)).toEqual([
      '@adrkit/core',
      '@adrkit/evaluator',
      '@adrkit/cli',
      '@adrkit/mcp',
      '@adrkit/spec-kit',
    ]);
    const mcp = RELEASE_PACKAGES.find((p) => p.name === '@adrkit/mcp');
    expect(mcp).toBeDefined();
    expect(mcp?.directory).toBe('packages/mcp');
    expect(mcp?.workspaceDependencies).toEqual(['@adrkit/core']);
    expect(mcp?.expectedFiles).toContain('dist/bin.js');
    expect(mcp?.expectedFiles).toContain('dist/index.js');
    expect(mcp?.expectedFiles).toContain('dist/index.d.ts');
    expect(mcp?.expectedFiles).toContain('src/index.ts');
    // No internal test/builder export leaks into the packed file list.
    expect(mcp?.expectedFiles).not.toContain('dist/server.js');
  });

  test('every lockstep manifest must share one identical stable SemVer', () => {
    expect(validateSourceManifests(alignedManifests(), 'v0.1.0')).toBe('0.1.0');

    const drifted = alignedManifests();
    const mcp = RELEASE_PACKAGES.find((d) => d.name === '@adrkit/mcp')!;
    drifted.set(mcp.name, sourceManifest(mcp, '0.2.0'));
    expect(() => validateSourceManifests(drifted)).toThrow('versions must match');
  });

  test('a leaked workspace protocol in the packed @adrkit/mcp manifest is rejected', () => {
    const mcp = RELEASE_PACKAGES.find((p) => p.name === '@adrkit/mcp')!;
    expect(() =>
      validatePackedManifest(
        mcp,
        { name: '@adrkit/mcp', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*' } },
        '0.1.0',
        resolveTo('0.1.0'),
      ),
    ).toThrow('leaked workspace protocols');
  });
});
