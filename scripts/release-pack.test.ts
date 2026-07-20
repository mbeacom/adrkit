import { describe, expect, test } from 'bun:test';
import {
  RELEASE_PACKAGES,
  findWorkspaceProtocols,
  validatePackedManifest,
  validateSourceManifests,
  type PackageManifest,
} from './release-pack.ts';

function sourceManifest(name: string, directory: string, version = '0.1.0'): PackageManifest {
  return {
    name,
    version,
    description: `${name} description`,
    repository: {
      type: 'git',
      url: 'git+https://github.com/mbeacom/adrkit.git',
      directory,
    },
    engines: { node: '>=22' },
    publishConfig: { access: 'public' },
    files: ['dist', 'README.md'],
  };
}

describe('release package validation', () => {
  test('accepts aligned public source manifests and matching tag', () => {
    const manifests = new Map(
      RELEASE_PACKAGES.map((definition) => [
        definition.name,
        sourceManifest(definition.name, definition.directory),
      ]),
    );
    expect(validateSourceManifests(manifests, 'v0.1.0')).toBe('0.1.0');
  });

  test('rejects version drift before packing', () => {
    const manifests = new Map(
      RELEASE_PACKAGES.map((definition, index) => [
        definition.name,
        sourceManifest(definition.name, definition.directory, index === 2 ? '0.2.0' : '0.1.0'),
      ]),
    );
    expect(() => validateSourceManifests(manifests)).toThrow('versions must match');
  });

  test('finds workspace protocols at any manifest depth', () => {
    expect(
      findWorkspaceProtocols({
        dependencies: { '@adrkit/core': 'workspace:*' },
        overrides: { nested: ['workspace:^'] },
      }),
    ).toEqual(['package.json.dependencies.@adrkit/core', 'package.json.overrides.nested[0]']);
  });

  test('requires packed workspace dependencies to resolve to the release version', () => {
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

  test('all four public manifests must share one identical stable SemVer', () => {
    const aligned = new Map(
      RELEASE_PACKAGES.map((d) => [d.name, sourceManifest(d.name, d.directory)]),
    );
    expect(validateSourceManifests(aligned, 'v0.1.0')).toBe('0.1.0');

    const drifted = new Map(
      RELEASE_PACKAGES.map((d) => [
        d.name,
        sourceManifest(d.name, d.directory, d.name === '@adrkit/mcp' ? '0.2.0' : '0.1.0'),
      ]),
    );
    expect(() => validateSourceManifests(drifted)).toThrow('versions must match');
  });

  test('a leaked workspace protocol in the packed @adrkit/mcp manifest is rejected', () => {
    const mcp = RELEASE_PACKAGES.find((p) => p.name === '@adrkit/mcp')!;
    expect(() =>
      validatePackedManifest(
        mcp,
        { name: '@adrkit/mcp', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*' } },
        '0.1.0',
      ),
    ).toThrow('leaked workspace protocols');
  });
});
