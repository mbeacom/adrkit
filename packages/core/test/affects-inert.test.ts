import { describe, expect, test } from 'bun:test';
import { resolveAffects, type CatalogPort, type CatalogSnapshot } from '../src/affects/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

function record(id: string, affects: Record<string, unknown>[]): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Use inert record ${id}`,
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
    path: `docs/adr/${id}-inert.md`,
  };
}

function unsafeRecord(id: string, affects: Record<string, unknown>[]): Adr {
  const base = record(id, []);
  return {
    ...base,
    frontmatter: {
      ...base.frontmatter,
      affects: affects as never,
    },
  };
}

describe('inert affects degradation', () => {
  test('unbacked matcher types emit one info finding each and do not match', () => {
    const result = resolveAffects({
      records: [
        record('0001', [{ type: 'entity', pattern: 'component:default/payments' }]),
        record('0002', [{ type: 'resource', pattern: 'azurerm_storage_account' }]),
        record('0003', [{ type: 'api', pattern: 'GET /payments/{id}' }]),
        record('0004', [{ type: 'data', pattern: 'warehouse.payments' }]),
      ],
      changedFiles: ['packages/payments/src/index.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings.map((finding) => [finding.rule, finding.severity, finding.id])).toEqual([
      ['affects-unresolvable', 'info', '0001'],
      ['affects-unresolvable', 'info', '0002'],
      ['affects-unresolvable', 'info', '0003'],
      ['affects-unresolvable', 'info', '0004'],
    ]);
  });

  test('unknown matcher types warn and are ignored', () => {
    const result = resolveAffects({
      records: [unsafeRecord('0001', [{ type: 'workflow', pattern: 'deploy' }])],
      changedFiles: ['packages/payments/src/index.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-unknown-type',
        severity: 'warn',
        message: 'Affects matcher type "workflow" is not recognized by this adrkit version and was ignored.',
        id: '0001',
        path: 'docs/adr/0001-inert.md',
        field: 'affects.workflow',
        pattern: 'deploy',
      },
    ]);
  });

  test('a supplied catalog snapshot lets entity matchers resolve', () => {
    const snapshot: CatalogSnapshot = {
      entities: [
        {
          id: 'component:default/payments',
          refs: ['component:default/payments'],
          paths: ['packages/payments/**'],
        },
      ],
    };
    const fakeCatalog: CatalogPort = {
      resolveEntity: () => ['component:default/payments'],
      entitiesForPaths: () => ['component:default/payments'],
      snapshot: () => snapshot,
    };

    const result = resolveAffects({
      records: [record('0001', [{ type: 'entity', pattern: 'component:default/payments' }])],
      changedFiles: ['packages/payments/src/index.ts'],
      snapshots: { catalog: fakeCatalog.snapshot() },
    });

    expect(result).toEqual({
      matches: [
        {
          recordId: '0001',
          firedMatchers: [{ type: 'entity', pattern: 'component:default/payments' }],
        },
      ],
      findings: [],
    });
  });
});
