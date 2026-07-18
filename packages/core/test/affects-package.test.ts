import { describe, expect, test } from 'bun:test';
import {
  deriveChangedDependenciesFromBunLockDiff,
  resolveAffects,
  type ChangedDependency,
} from '../src/affects/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

function record(id: string, pattern: string): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Use package record ${id}`,
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects: [{ type: 'package', pattern }],
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${id}-package.md`,
  };
}

function resolvePackage(pattern: string, changedDependencies?: readonly ChangedDependency[]) {
  return resolveAffects({
    records: [record('0001', pattern)],
    changedFiles: ['bun.lock'],
    snapshots: changedDependencies === undefined ? undefined : { changedDependencies },
  });
}

describe('package affects resolution', () => {
  test('fires on a lockfile-derived change to the matching dependency name', () => {
    const diff = [
      'diff --git a/bun.lock b/bun.lock',
      '@@',
      '-    "react": ["react@18.3.1", "", {}, "sha512-old"],',
      '+    "react": ["react@19.1.0", "", {}, "sha512-new"],',
    ].join('\n');

    expect(resolvePackage('react', deriveChangedDependenciesFromBunLockDiff(diff)).matches).toEqual([
      {
        recordId: '0001',
        firedMatchers: [{ type: 'package', pattern: 'react' }],
      },
    ]);
  });

  test('preserves both removed and added dependency versions for upgrade diffs', () => {
    const diff = [
      'diff --git a/bun.lock b/bun.lock',
      '@@',
      '-    "react": ["react@18.3.0", "", {}, "sha512-old"],',
      '+    "react": ["react@19.1.0", "", {}, "sha512-new"],',
    ].join('\n');
    const changedDependencies = deriveChangedDependenciesFromBunLockDiff(diff);

    expect(changedDependencies).toEqual([
      { name: 'react', version: '18.3.0' },
      { name: 'react', version: '19.1.0' },
    ]);

    const result = resolveAffects({
      records: [record('0001', 'react@>=19'), record('0002', 'react@<19')],
      changedFiles: ['bun.lock'],
      snapshots: { changedDependencies },
    });

    expect(result.matches).toEqual([
      {
        recordId: '0001',
        firedMatchers: [{ type: 'package', pattern: 'react@>=19' }],
      },
      {
        recordId: '0002',
        firedMatchers: [{ type: 'package', pattern: 'react@<19' }],
      },
    ]);
  });

  test('honors semver ranges for changed dependency versions', () => {
    expect(resolvePackage('react@>=19', [{ name: 'react', version: '19.1.0' }]).matches).toEqual([
      {
        recordId: '0001',
        firedMatchers: [{ type: 'package', pattern: 'react@>=19' }],
      },
    ]);

    expect(resolvePackage('react@>=19', [{ name: 'react', version: '18.3.1' }]).matches).toEqual([]);
  });

  test('does not fire on manifest-only edits with no changed-dependency entry', () => {
    expect(resolvePackage('react@>=19', []).matches).toEqual([]);
  });

  test('is inert when no changed-dependency set is supplied', () => {
    const result = resolvePackage('react');

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-unresolvable',
        severity: 'info',
        message: 'Package matcher "react" requires a changed-dependency snapshot and is inert.',
        id: '0001',
        path: 'docs/adr/0001-package.md',
        field: 'affects.package',
        pattern: 'react',
      },
    ]);
  });

  test('invalid ranges warn and do not match', () => {
    const result = resolvePackage('react@not-a-range', [{ name: 'react', version: '19.1.0' }]);

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-bad-pattern',
        severity: 'warn',
        message: 'Package matcher "react@not-a-range" must be "name" or "name@<valid semver range>".',
        id: '0001',
        path: 'docs/adr/0001-package.md',
        field: 'affects.package',
        pattern: 'react@not-a-range',
      },
    ]);
  });

  test('invalid ranges warn even when no changed-dependency set is supplied', () => {
    const result = resolvePackage('react@not-a-range');

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-bad-pattern',
        severity: 'warn',
        message: 'Package matcher "react@not-a-range" must be "name" or "name@<valid semver range>".',
        id: '0001',
        path: 'docs/adr/0001-package.md',
        field: 'affects.package',
        pattern: 'react@not-a-range',
      },
    ]);
  });

  test('derives scoped and unscoped package changes from bun.lock diffs', () => {
    const diff = [
      'diff --git a/bun.lock b/bun.lock',
      '--- a/bun.lock',
      '+++ b/bun.lock',
      '@@',
      '-    "react": ["react@18.3.1", "", {}, "sha512-old"],',
      '+    "react": ["react@19.1.0", "", {}, "sha512-new"],',
      '+    "@scope/pkg": ["@scope/pkg@1.2.3", "", {}, "sha512-new"],',
      '+        "react": "^19.1.0",',
    ].join('\n');

    expect(deriveChangedDependenciesFromBunLockDiff(diff)).toEqual([
      { name: '@scope/pkg', version: '1.2.3' },
      { name: 'react', version: '18.3.1' },
      { name: 'react', version: '19.1.0' },
    ]);
  });
});
