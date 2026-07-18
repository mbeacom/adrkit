import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { resolveAffects, type ResolutionSnapshots, type ResolveAffectsResult } from '../../src/affects/index.ts';
import { AdrFrontmatter, type Adr } from '../../src/schema/adr.schema.ts';

interface ConformanceRecord {
  id: string;
  affects: Record<string, unknown>[];
}

interface ConformanceCase {
  records: ConformanceRecord[];
  changedFiles: string[];
  snapshots?: ResolutionSnapshots;
  expected: ResolveAffectsResult;
}

function record(entry: ConformanceRecord): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id: entry.id,
      title: `Use conformance record ${entry.id}`,
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects: entry.affects,
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${entry.id}-case.md`,
  };
}

const CASES_DIR = join(process.cwd(), 'packages/core/test/conformance/cases');
const caseFiles = (await readdir(CASES_DIR)).filter((file) => file.endsWith('.json')).sort();

describe('affects conformance fixtures', () => {
  for (const file of caseFiles) {
    test(basename(file, '.json'), async () => {
      const testCase = JSON.parse(await readFile(join(CASES_DIR, file), 'utf8')) as ConformanceCase;
      const result = resolveAffects({
        records: testCase.records.map(record),
        changedFiles: testCase.changedFiles,
        snapshots: testCase.snapshots,
      });

      expect(result).toEqual(testCase.expected);
    });
  }
});
