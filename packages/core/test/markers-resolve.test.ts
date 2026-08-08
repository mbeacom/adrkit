import { describe, expect, test } from 'bun:test';
import type { Adr } from '../src/schema/adr.schema.ts';
import {
  mergeSourceDeclarations,
  resolveSourceMarkers,
  type SourceMarker,
} from '../src/markers/index.ts';
import { toGoverningDecisions } from '../src/check/index.ts';

function record(id: string, status: Adr['frontmatter']['status'] = 'accepted'): Adr {
  return {
    frontmatter: {
      schemaVersion: '0.1.0',
      id,
      title: `Use decision ${id}`,
      status,
      date: '2026-07-18',
      deciders: ['@tester'],
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
      externalRefs: [],
      complianceControls: [],
    } as unknown as Adr['frontmatter'],
    body: '',
    path: `docs/adr/${id}-use-decision.md`,
  };
}

function marker(ref: string, path = 'src/sync.ts', line = 1): SourceMarker {
  const [log, id] = ref.includes(':') ? ref.split(':') : [undefined, ref];
  return { path, ref, id: id ?? ref, line, ...(log ? { log } : {}) };
}

describe('resolveSourceMarkers', () => {
  test('binds a marker to the record it names', () => {
    const result = resolveSourceMarkers({
      records: [record('0012')],
      markers: [marker('0012', 'src/sync.ts', 3)],
    });

    expect(result).toEqual({
      matches: [{ recordId: '0012', declaredBy: [{ path: 'src/sync.ts', line: 3, ref: '0012' }] }],
      findings: [],
    });
  });

  test('a marker naming a record that does not exist is a warn finding, not a match', () => {
    const result = resolveSourceMarkers({
      records: [record('0012')],
      markers: [marker('0013', 'src/sync.ts', 4)],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'dangling-marker',
        severity: 'warn',
        message:
          'Source marker "@adr 0013" in src/sync.ts:4 does not resolve to a record in the corpus',
        path: 'src/sync.ts',
        field: 'marker',
        pattern: '0013',
      },
    ]);
  });

  test('a federated marker is reported as unresolvable rather than dangling', () => {
    const result = resolveSourceMarkers({
      records: [record('0012')],
      markers: [marker('payments:0012', 'src/sync.ts', 2)],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings.map((finding) => [finding.rule, finding.severity])).toEqual([
      ['marker-unresolvable', 'info'],
    ]);
  });

  test('groups every declaring file under one record, sorted and deduplicated', () => {
    const result = resolveSourceMarkers({
      records: [record('0012'), record('0011')],
      markers: [
        marker('0012', 'src/z.ts', 2),
        marker('0011', 'src/a.ts', 1),
        marker('0012', 'src/a.ts', 9),
        marker('0012', 'src/a.ts', 9),
      ],
    });

    expect(result.matches).toEqual([
      { recordId: '0011', declaredBy: [{ path: 'src/a.ts', line: 1, ref: '0011' }] },
      {
        recordId: '0012',
        declaredBy: [
          { path: 'src/a.ts', line: 9, ref: '0012' },
          { path: 'src/z.ts', line: 2, ref: '0012' },
        ],
      },
    ]);
  });
});

describe('mergeSourceDeclarations', () => {
  const records = [record('0011'), record('0012'), record('0013', 'draft')];

  test('leaves a pattern-only decision byte-identical — no declaredBy key at all', () => {
    const patternDecisions = toGoverningDecisions(records, [
      { recordId: '0011', firedMatchers: [{ type: 'path', pattern: 'src/**' }] },
    ]);

    const merged = mergeSourceDeclarations(patternDecisions, records, []);

    expect(merged).toEqual(patternDecisions);
    expect(Object.hasOwn(merged[0] ?? {}, 'declaredBy')).toBe(false);
  });

  test('a record reached only by a marker governs, with no fired matcher', () => {
    const declaredBy = [{ path: 'src/sync.ts', line: 3, ref: '0012' }];
    const merged = mergeSourceDeclarations(toGoverningDecisions(records, []), records, [
      { recordId: '0012', declaredBy },
    ]);

    expect(merged).toEqual([
      {
        recordId: '0012',
        title: 'Use decision 0012',
        status: 'accepted',
        bucket: 'governing',
        firedMatchers: [],
        declaredBy,
      },
    ]);
  });

  test('a record reached both ways carries both, and the union stays sorted by id', () => {
    const patternDecisions = toGoverningDecisions(records, [
      { recordId: '0012', firedMatchers: [{ type: 'path', pattern: 'src/**' }] },
    ]);
    const merged = mergeSourceDeclarations(patternDecisions, records, [
      { recordId: '0012', declaredBy: [{ path: 'src/sync.ts', line: 3, ref: '0012' }] },
      { recordId: '0011', declaredBy: [{ path: 'src/sync.ts', line: 4, ref: '0011' }] },
    ]);

    expect(merged.map((decision) => decision.recordId)).toEqual(['0011', '0012']);
    expect(merged[1]).toEqual({
      recordId: '0012',
      title: 'Use decision 0012',
      status: 'accepted',
      bucket: 'governing',
      firedMatchers: [{ type: 'path', pattern: 'src/**' }],
      declaredBy: [{ path: 'src/sync.ts', line: 3, ref: '0012' }],
    });
  });

  test('a marker does not promote a draft record into the governing bucket', () => {
    const merged = mergeSourceDeclarations(toGoverningDecisions(records, []), records, [
      { recordId: '0013', declaredBy: [{ path: 'src/sync.ts', line: 1, ref: '0013' }] },
    ]);

    expect(merged.map((decision) => decision.bucket)).toEqual(['activeProposals']);
  });
});
