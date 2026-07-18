import { describe, expect, test } from 'bun:test';
import { resolveAffects } from '../src/affects/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

function record(id: string, affects: Record<string, unknown>[]): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Use affects record ${id}`,
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects,
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${id}-affects.md`,
  };
}

describe('path affects resolution', () => {
  test('matches a repo-relative path glob and reports the fired matcher', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'packages/core/**' }])],
      changedFiles: ['packages/core/src/index.ts'],
    });

    expect(result).toEqual({
      matches: [
        {
          recordId: '0001',
          firedMatchers: [{ type: 'path', pattern: 'packages/core/**' }],
        },
      ],
      findings: [],
    });
  });

  test('omits records with no matching path', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'packages/core/**' }])],
      changedFiles: ['packages/cli/src/index.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  test('a record self-negation suppresses its positive match', () => {
    const result = resolveAffects({
      records: [
        record('0001', [
          { type: 'path', pattern: 'packages/core/**' },
          { type: 'path', pattern: 'packages/core/test/**', negate: true },
        ]),
      ],
      changedFiles: ['packages/core/test/affects-path.test.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  test("one record's negation does not suppress another record", () => {
    const result = resolveAffects({
      records: [
        record('0001', [{ type: 'path', pattern: 'packages/core/**', negate: true }]),
        record('0002', [{ type: 'path', pattern: 'packages/core/**' }]),
      ],
      changedFiles: ['packages/core/src/index.ts'],
    });

    expect(result.matches).toEqual([
      {
        recordId: '0002',
        firedMatchers: [{ type: 'path', pattern: 'packages/core/**' }],
      },
    ]);
  });

  test('returns the union of all governing records', () => {
    const result = resolveAffects({
      records: [
        record('0002', [{ type: 'path', pattern: 'packages/core/src/**' }]),
        record('0001', [{ type: 'path', pattern: 'packages/core/**' }]),
      ],
      changedFiles: ['packages/core/src/index.ts'],
    });

    expect(result.matches).toEqual([
      {
        recordId: '0001',
        firedMatchers: [{ type: 'path', pattern: 'packages/core/**' }],
      },
      {
        recordId: '0002',
        firedMatchers: [{ type: 'path', pattern: 'packages/core/src/**' }],
      },
    ]);
  });

  test('honors ** crossing directories', () => {
    expect(
      resolveAffects({
        records: [record('0001', [{ type: 'path', pattern: 'docs/**/*.md' }])],
        changedFiles: ['docs/adr/0009-affects-resolution-and-catalog-binding.md'],
      }).matches,
    ).toEqual([
      {
        recordId: '0001',
        firedMatchers: [{ type: 'path', pattern: 'docs/**/*.md' }],
      },
    ]);
  });

  test('requires dotfile patterns to opt in to dot segments', () => {
    const result = resolveAffects({
      records: [
        record('0001', [{ type: 'path', pattern: '**/*' }]),
        record('0002', [{ type: 'path', pattern: '.github/**' }]),
      ],
      changedFiles: ['.github/workflows/ci.yml'],
    });

    expect(result.matches).toEqual([
      {
        recordId: '0002',
        firedMatchers: [{ type: 'path', pattern: '.github/**' }],
      },
    ]);
  });

  test('rejects leading-slash path patterns as bad-pattern warnings', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: '/packages/core/**' }])],
      changedFiles: ['packages/core/src/index.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-bad-pattern',
        severity: 'warn',
        message: 'Path matcher "/packages/core/**" must be repo-relative and must not start with "/".',
        id: '0001',
        path: 'docs/adr/0001-affects.md',
        field: 'affects.path',
        pattern: '/packages/core/**',
      },
    ]);
  });
});
