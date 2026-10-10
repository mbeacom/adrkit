/**
 * Core's report builders for `adr lint`, `adr new`, and `adr explain` JSON (ADR-0031 action
 * item 4). The CLI goldens in `packages/cli/test/json-report.test.ts` pin the bytes; these
 * cases pin what a golden cannot: the git-ref provenance keys of an `--as-of` block (the
 * commit moves, so no golden can hold it) and the reachability of the builders from the
 * package entry point.
 *
 * ADR-0016: observed failing. Emitting `committedAt` before `commit` failed the ref case, and
 * removing the report exports from `src/index.ts` failed the reachability case; both reverted.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildExplainReport,
  buildLintReport,
  buildNewAdrReport,
  formatExplainReportJson,
  formatLintReportJson,
  formatNewAdrReportJson,
} from '../src/report/index.ts';
import type { SourceMarkerScan } from '../src/markers/read.ts';

const SCAN: SourceMarkerScan = { path: 'src/a.ts', state: 'absent', markers: [], truncated: false };

describe('report builders', () => {
  test('lint: checked, then findings', () => {
    const report = buildLintReport({ checked: 3 }, []);
    expect(Object.keys(report)).toEqual(['checked', 'findings']);
    expect(formatLintReportJson(report)).toBe('{\n  "checked": 3,\n  "findings": []\n}\n');
  });

  test('new: id and path, never the scaffolded content', () => {
    const report = buildNewAdrReport({ id: '0009', path: 'docs/adr/0009-x.md', content: '---\n' } as never);
    expect(report).toEqual({ id: '0009', path: 'docs/adr/0009-x.md' });
    expect(formatNewAdrReportJson(report)).toBe('{\n  "id": "0009",\n  "path": "docs/adr/0009-x.md"\n}\n');
  });

  test('explain: a git-ref --as-of carries commit then committedAt, before the groups', () => {
    const report = buildExplainReport({
      path: 'src/a.ts',
      scan: SCAN,
      asOf: {
        requested: 'HEAD',
        date: '2026-10-10',
        resolvedFrom: 'ref',
        commit: 'a'.repeat(40),
        committedAt: '2026-10-10T17:12:42-04:00',
      },
      findings: [],
    });
    expect(Object.keys(report)).toEqual([
      'path',
      'asOf',
      'governedBy',
      'governing',
      'activeProposals',
      'history',
      'markers',
      'findings',
    ]);
    expect(Object.keys(report.asOf ?? {})).toEqual([
      'requested',
      'date',
      'resolvedFrom',
      'commit',
      'committedAt',
      'governing',
      'activeProposals',
      'history',
      'notYetRecorded',
      'undetermined',
    ]);
    expect(formatExplainReportJson(report).endsWith('\n')).toBe(true);
  });

  test('explain: no --as-of means no asOf key, and an absent file has no extent keys', () => {
    const report = buildExplainReport({ path: 'src/a.ts', scan: SCAN, findings: [] });
    expect('asOf' in report).toBe(false);
    expect(Object.keys(report.markers)).toEqual([
      'state',
      'windowBytes',
      'truncated',
      'declarationLimit',
      'totalDeclarations',
      'omittedDeclarations',
      'declared',
    ]);
  });

  test('the builders and formatters are reachable from the package entry point', async () => {
    const core = await import('../src/index.ts');
    for (const name of [
      'buildExplainReport',
      'buildLintReport',
      'buildNewAdrReport',
      'formatExplainReportJson',
      'formatLintReportJson',
      'formatNewAdrReportJson',
    ] as const) {
      expect(typeof core[name]).toBe('function');
    }
  });
});
