import { describe, expect, test } from 'bun:test';
import { checkChanges, type CheckLintResult } from '../src/check/index.ts';
import type { Finding } from '../src/validate/findings.ts';

const emptyLint = (findings: Finding[] = []): CheckLintResult => ({ records: [], findings, checked: 0 });

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
});
