import { describe, expect, test } from 'bun:test';
import type { Adr } from '../src/schema/adr.schema.ts';
import {
  mergeSourceDeclarations,
  resolveSourceMarkers,
  type SourceMarker,
} from '../src/markers/index.ts';
import { toGoverningDecisions } from '../src/check/index.ts';

function record(
  id: string,
  status: Adr['frontmatter']['status'] = 'accepted',
  supersededBy?: string,
): Adr {
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
      ...(supersededBy ? { supersededBy } : {}),
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

  test('historical markers warn without losing their matches, following supersession to the terminal successor', () => {
    const result = resolveSourceMarkers({
      records: [
        record('0001', 'superseded', '0002'),
        record('0002', 'superseded', '0003'),
        record('0003'),
        record('0004', 'rejected'),
        record('0005', 'deprecated'),
      ],
      markers: [
        marker('0005', 'src/deprecated.ts', 5),
        marker('0001', 'src/superseded.ts', 3),
        marker('0004', 'src/rejected.ts', 4),
        marker('0001', 'src/superseded.ts', 3),
      ],
    });

    expect(result.matches.map((match) => match.recordId)).toEqual(['0001', '0004', '0005']);
    expect(result.findings).toEqual([
      {
        rule: 'stale-marker',
        severity: 'warn',
        message:
          'Source marker "@adr 0001" in src/superseded.ts:3 names superseded ADR 0001; update it to "@adr 0003" or re-affirm 0001',
        path: 'src/superseded.ts',
        field: 'marker',
        pattern: '0001',
      },
      {
        rule: 'stale-marker',
        severity: 'warn',
        message:
          'Source marker "@adr 0004" in src/rejected.ts:4 names rejected ADR 0004; update the marker or re-affirm 0004',
        path: 'src/rejected.ts',
        field: 'marker',
        pattern: '0004',
      },
      {
        rule: 'stale-marker',
        severity: 'warn',
        message:
          'Source marker "@adr 0005" in src/deprecated.ts:5 names deprecated ADR 0005; update the marker or re-affirm 0005',
        path: 'src/deprecated.ts',
        field: 'marker',
        pattern: '0005',
      },
    ]);
  });

  test('accepted and active-proposal markers do not warn', () => {
    const result = resolveSourceMarkers({
      records: [record('0001'), record('0002', 'draft'), record('0003', 'proposed')],
      markers: [marker('0001'), marker('0002'), marker('0003')],
    });

    expect(result.matches.map((match) => match.recordId)).toEqual(['0001', '0002', '0003']);
    expect(result.findings).toEqual([]);
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

  test('sorts declaration paths by code unit rather than the host locale', () => {
    const result = resolveSourceMarkers({
      records: [record('0012')],
      markers: [marker('0012', 'src/ä.ts', 1), marker('0012', 'src/z.ts', 1)],
    });

    expect(result.matches[0]?.declaredBy.map((declaration) => declaration.path)).toEqual([
      'src/z.ts',
      'src/ä.ts',
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
