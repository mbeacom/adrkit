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

  describe('log-qualified references (ADR-0059 clauses 4 and 5)', () => {
    test('a qualified relatesTo is federated-ref-unresolved at info, not a dangling error', () => {
      const findings = validateCorpusInvariants([record('0001', { relatesTo: ['payments:0012'] })]);
      expect(findings).toEqual([
        {
          rule: 'federated-ref-unresolved',
          severity: 'info',
          message:
            'Reference "payments:0012" in relatesTo names another decision log ("payments") and is inert against this corpus',
          path: 'docs/adr/0001-test.md',
          id: '0001',
          field: 'relatesTo',
          pattern: 'payments:0012',
        },
      ]);
    });

    test('a qualified conflictsWith is federated-ref-unresolved at info, not a dangling warning', () => {
      const findings = validateCorpusInvariants([record('0001', { conflictsWith: ['payments:0012'] })]);
      expect(findings).toMatchObject([
        { rule: 'federated-ref-unresolved', severity: 'info', field: 'conflictsWith', pattern: 'payments:0012' },
      ]);
    });

    test('a qualified conflictsWith on an accepted record never reads as a known local conflict', () => {
      const findings = validateCorpusInvariants([
        record('0012'),
        record('0001', { status: 'accepted', deciders: ['@mbeacom'], conflictsWith: ['payments:0012'] }),
      ]);
      expect(findings.map((finding) => [finding.rule, finding.severity])).toEqual([
        ['federated-ref-unresolved', 'info'],
      ]);
    });

    test('a qualified reference never resolves to a local record with the same bare id', () => {
      const findings = validateCorpusInvariants([
        record('0012'),
        record('0001', { relatesTo: ['payments:0012'] }),
      ]);
      expect(findings).toMatchObject([{ rule: 'federated-ref-unresolved', severity: 'info', id: '0001' }]);
    });

    test('a qualified supersedes or supersededBy stays a dangling error', () => {
      const findings = validateCorpusInvariants([
        record('0001', { status: 'superseded', supersededBy: 'payments:0012' }),
        record('0002', { supersedes: ['payments:0013'] }),
      ]);
      expect(findings.map((finding) => [finding.rule, finding.severity])).toEqual([
        ['dangling-supersededBy', 'error'],
        ['dangling-supersedes', 'error'],
      ]);
      for (const finding of findings) {
        expect(finding.message).toContain('cross-repository supersession is not supported');
      }
    });

    test('an unqualified dangling reference is unchanged', () => {
      const findings = validateCorpusInvariants([record('0001', { relatesTo: ['9999'], conflictsWith: ['9998'] })]);
      expect(findings.map((finding) => [finding.rule, finding.severity])).toEqual([
        ['dangling-relatesTo', 'error'],
        ['dangling-conflictsWith', 'warn'],
      ]);
      for (const finding of findings) {
        expect(finding.message).toContain('does not resolve to a record in the corpus');
      }
    });
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
