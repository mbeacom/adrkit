import { describe, expect, test } from 'bun:test';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';
import { validateCorpusInvariants } from '../src/validate/corpus-invariants.ts';

function record(id: string, overrides: Record<string, unknown> = {}): Adr {
  const frontmatter = AdrFrontmatter.parse({
    schemaVersion: '0.1.0',
    id,
    title: `Use record ${id}`,
    status: 'draft',
    date: '2026-07-18',
    deciders: [],
    tags: [],
    scope: 'component',
    reversibility: 'unknown',
    blastRadius: 'component',
    affects: [],
    provenance: { authoredBy: 'human' },
    ...overrides,
  });
  return { frontmatter, body: '', path: `docs/adr/${id}-test.md` };
}

describe('corpus invariants', () => {
  test('detects duplicate ids', () => {
    const findings = validateCorpusInvariants([
      record('0001'),
      { ...record('0001'), path: 'docs/adr/0001-other.md' },
    ]);
    expect(findings.filter((finding) => finding.rule === 'unique-id')).toHaveLength(2);
  });

  test('detects dangling supersededBy, supersedes, and relatesTo references', () => {
    const findings = validateCorpusInvariants([
      record('0001', { status: 'superseded', supersededBy: '9999' }),
      record('0002', { supersedes: ['9998'], relatesTo: ['9997'] }),
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual([
      'dangling-supersededBy',
      'dangling-supersedes',
      'dangling-relatesTo',
    ]);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  test('reports dangling conflictsWith as a warning', () => {
    const findings = validateCorpusInvariants([record('0001', { conflictsWith: ['9999'] })]);
    expect(findings).toMatchObject([{ rule: 'dangling-conflictsWith', severity: 'warn' }]);
  });


  test('resolved supersedes references yield no error', () => {
    const findings = validateCorpusInvariants([
      record('0001'),
      record('0002', { supersedes: ['0001'] }),
    ]);
    expect(findings.filter((finding) => finding.rule === 'dangling-supersedes')).toHaveLength(0);
    expect(findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
  });

  test('conflictsWith on a non-accepted record yields no warning when resolved', () => {
    const findings = validateCorpusInvariants([
      record('0001'),
      record('0002', { status: 'proposed', conflictsWith: ['0001'] }),
    ]);
    expect(findings).toEqual([]);
  });

  test('accepted conflictsWith on a resolved record yields the conflict warning', () => {
    const findings = validateCorpusInvariants([
      record('0001'),
      record('0002', { status: 'accepted', deciders: ['@mbeacom'], conflictsWith: ['0001'] }),
    ]);
    expect(findings).toEqual([
      {
        rule: 'accepted-conflictsWith',
        severity: 'warn',
        message: 'Accepted ADR declares a known conflict with "0001"',
        path: 'docs/adr/0002-test.md',
        id: '0002',
        field: 'conflictsWith',
      },
    ]);
  });

  test('clean corpus yields zero errors', () => {
    const findings = validateCorpusInvariants([
      record('0001'),
      record('0002', { relatesTo: ['0001'] }),
      record('0003', { status: 'superseded', supersededBy: '0002' }),
    ]);
    expect(findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
  });
});
