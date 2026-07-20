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
