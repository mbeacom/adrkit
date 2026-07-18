import { describe, expect, test } from 'bun:test';
import type { Adr } from '../src/schema/adr.schema.ts';
import { validateImportIncomplete } from '../src/validate/import-incomplete.ts';

function record(overrides: Partial<Adr['frontmatter']> = {}): Adr {
  return {
    path: 'docs/adr/0001-imported.md',
    body: '# Imported\n',
    frontmatter: {
      schemaVersion: '0.1.0',
      id: '0001',
      title: 'Import a decision record',
      status: 'accepted',
      date: '2026-07-18',
      deciders: [],
      consulted: [],
      informed: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      supersedes: [],
      relatesTo: [],
      conflictsWith: [],
      affects: [],
      assertions: [],
      provenance: {
        authoredBy: 'human',
        importedFrom: { sourceKind: 'madr', sourceRef: 'legacy.md', fingerprint: 'abc' },
      },
      externalRefs: [],
      complianceControls: [],
      ...overrides,
    },
  };
}

describe('import-incomplete lint rule', () => {
  test('reports imported accepted records without deciders', () => {
    expect(validateImportIncomplete([record()])).toEqual([
      expect.objectContaining({ rule: 'import-incomplete', severity: 'info', field: 'deciders' }),
    ]);
  });

  test('is silent when the imported record is complete or not accepted', () => {
    expect(validateImportIncomplete([record({ deciders: ['@mbeacom'] })])).toEqual([]);
    expect(validateImportIncomplete([record({ status: 'proposed' })])).toEqual([]);
  });

  test('never emits errors', () => {
    expect(validateImportIncomplete([record()]).every((finding) => finding.severity !== 'error')).toBe(true);
  });
});
