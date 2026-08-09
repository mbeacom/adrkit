import { describe, expect, test } from 'bun:test';
import { checkChanges, type CheckLintResult } from '../src/check/index.ts';
import type { Adr } from '../src/schema/adr.schema.ts';
import type { Finding } from '../src/validate/findings.ts';

const emptyLint = (findings: Finding[] = []): CheckLintResult => ({ records: [], findings, checked: 0 });

function record(id: string): Adr {
  return {
    frontmatter: {
      schemaVersion: '0.1.0',
      id,
      title: `Use decision ${id}`,
      status: 'accepted',
      date: '2026-08-08',
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
    path: `docs/adr/${id}-decision.md`,
  };
}

describe('checkChanges (core)', () => {
  test('an error finding on a changed record fails even when the file was dropped from records (RC3)', () => {
    // lintCorpus drops malformed files from `records` but keeps their error in `findings`.
    const lint = emptyLint([
      {
        rule: 'frontmatter-parse',
        severity: 'error',
        message: 'unterminated frontmatter',
        path: 'docs/adr/0003-broken.md',
        field: 'frontmatter',
      },
    ]);

    const outcome = checkChanges({ lint, changedFiles: ['docs/adr/0003-broken.md'], dir: 'docs/adr' });

    expect(outcome.changedRecords).toEqual(['docs/adr/0003-broken.md']);
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.some((f) => f.rule === 'frontmatter-parse')).toBe(true);
  });

  test('the same error on an unchanged record does not fail the check (A5)', () => {
    const lint = emptyLint([
      {
        rule: 'frontmatter-parse',
        severity: 'error',
        message: 'unterminated frontmatter',
        path: 'docs/adr/0003-broken.md',
        field: 'frontmatter',
      },
    ]);

    // The changed file is not the malformed record.
    const outcome = checkChanges({ lint, changedFiles: ['packages/core/src/index.ts'], dir: 'docs/adr' });

    expect(outcome.changedRecords).toEqual([]);
    expect(outcome.ok).toBe(true);
    // A corpus-level error not tied to a changed record is not surfaced as a changed-record finding.
    expect(outcome.findings).toEqual([]);
  });

  test('changed files are deduplicated and sorted deterministically', () => {
    const outcome = checkChanges({
      lint: emptyLint(),
      changedFiles: ['b.ts', 'a.ts', 'b.ts'],
      dir: 'docs/adr',
    });

    expect(outcome.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(outcome.governedBy).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  test('the corpus template is never treated as a changed record', () => {
    const lint = emptyLint([
      { rule: 'file-read', severity: 'error', message: 'boom', path: 'docs/adr/0000-template.md' },
    ]);

    const outcome = checkChanges({ lint, changedFiles: ['docs/adr/0000-template.md'], dir: 'docs/adr' });

    expect(outcome.changedRecords).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  test('a root corpus (".") matches repo-root record files', () => {
    const lint = emptyLint([
      { rule: 'frontmatter-parse', severity: 'error', message: 'boom', path: '0003-broken.md' },
    ]);

    const outcome = checkChanges({ lint, changedFiles: ['0003-broken.md', 'src/x.ts'], dir: '.' });

    expect(outcome.changedRecords).toEqual(['0003-broken.md']);
    expect(outcome.ok).toBe(false);
  });

  test('an empty dir yields an empty prefix, not "/"', () => {
    const outcome = checkChanges({ lint: emptyLint(), changedFiles: ['0001-x.md', 'sub/0002-y.md'], dir: '' });
    // Only the root-level record is a changed record; the nested one is not (flat corpus).
    expect(outcome.changedRecords).toEqual(['0001-x.md']);
  });

  test('a trailing slash on dir is normalized', () => {
    const outcome = checkChanges({ lint: emptyLint(), changedFiles: ['docs/adr/0001-x.md'], dir: 'docs/adr/' });
    expect(outcome.changedRecords).toEqual(['docs/adr/0001-x.md']);
  });

  test('Windows-style backslash changed paths are normalized to forward slashes', () => {
    const outcome = checkChanges({
      lint: emptyLint(),
      changedFiles: ['docs\\adr\\0001-x.md'],
      dir: 'docs/adr',
    });
    expect(outcome.changedFiles).toEqual(['docs/adr/0001-x.md']);
    expect(outcome.changedRecords).toEqual(['docs/adr/0001-x.md']);
  });

  test('resolves pre-scanned markers without performing I/O and reports scan state', () => {
    const lint: CheckLintResult = { records: [record('0012')], findings: [], checked: 1 };
    const outcome = checkChanges({
      lint,
      changedFiles: ['src/sync.ts'],
      markerScans: {
        scans: [
          {
            path: 'src/sync.ts',
            state: 'scanned',
            truncated: false,
            markers: [{ path: 'src/sync.ts', ref: '0012', id: '0012', line: 1 }],
          },
          { path: 'src/deleted.ts', state: 'absent', truncated: false, markers: [] },
        ],
        skippedPaths: [],
        limit: 1000,
        totalCandidates: 2,
      },
    });

    expect(outcome.governing[0]?.declaredBy).toEqual([
      { path: 'src/sync.ts', line: 1, ref: '0012' },
    ]);
    expect(outcome.markerScan?.counts).toEqual({
      scanned: 1,
      absent: 1,
      unreadable: 0,
      'out-of-tree': 0,
      skipped: 0,
    });
    expect(outcome.markerScan?.absentPaths).toEqual(['src/deleted.ts']);
    expect(outcome.ok).toBe(true);
  });

  test('a capped marker scan is an observable warning but never changes ok', () => {
    const outcome = checkChanges({
      lint: emptyLint(),
      changedFiles: ['src/a.ts', 'src/z.ts'],
      markerScans: {
        scans: [{ path: 'src/a.ts', state: 'absent', truncated: false, markers: [] }],
        skippedPaths: ['src/z.ts'],
        limit: 1,
        totalCandidates: 2,
      },
    });

    expect(outcome.findings.map((finding) => [finding.rule, finding.severity])).toContainEqual([
      'marker-scan-capped',
      'warn',
    ]);
    expect(outcome.markerScan?.skippedPaths).toEqual(['src/z.ts']);
    expect(outcome.ok).toBe(true);
  });
});
