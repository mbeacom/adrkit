/**
 * Regression tests for adrkit#39 — `check`, `explain`, and the CI Action reported
 * rejected, superseded, and deprecated records as governing, while `@adrkit/mcp`'s
 * `get_decision_context` bucketed the same corpus correctly.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { bucketDecisions, checkChanges, decisionBucketFor, lintCorpus, toGoverningDecisions } from '../src/index.ts';
import { resolveAffects } from '../src/affects/index.ts';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'status-governance';
const MATCHER = ['affects:', '  - type: path', '    pattern: "src/api/**"'].join('\n');

function withMatcher(markdown: string): string {
  return markdown.replace('affects: []', MATCHER);
}

/** One record per `Status` value, all matching the same path — the issue's fixture. */
async function seedEveryStatus(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  const rows: readonly [string, string, string][] = [
    ['0001', 'draft', 'Draft record'],
    ['0002', 'proposed', 'Proposed record'],
    ['0003', 'accepted', 'Accepted record'],
    ['0004', 'rejected', 'Rejected record'],
    ['0005', 'superseded', 'Superseded record'],
    ['0006', 'deprecated', 'Deprecated record'],
  ];

  for (const [id, status, title] of rows) {
    let markdown = withMatcher(recordMarkdown(id, title));
    markdown =
      status === 'superseded'
        ? markdown.replace('status: draft', 'status: superseded\nsupersededBy: "0003"')
        : markdown.replace('status: draft', `status: ${status}`);
    if (status === 'accepted' || status === 'superseded') {
      markdown = markdown.replace('deciders: []', 'deciders: ["@tester"]');
    }
    await writeText(join(dir, `${id}-${status}.md`), markdown);
  }
  return root;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('decisionBucketFor', () => {
  test('only accepted governs', () => {
    expect(decisionBucketFor('accepted')).toBe('governing');
    expect(decisionBucketFor('draft')).toBe('activeProposals');
    expect(decisionBucketFor('proposed')).toBe('activeProposals');
    expect(decisionBucketFor('rejected')).toBe('history');
    expect(decisionBucketFor('superseded')).toBe('history');
    expect(decisionBucketFor('deprecated')).toBe('history');
  });

  test('an unknown status is history, never governing', () => {
    expect(decisionBucketFor('something-new')).toBe('history');
  });
});

describe('checkChanges status awareness (#39)', () => {
  test('buckets every status exactly as get_decision_context does', async () => {
    const root = await seedEveryStatus();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const outcome = checkChanges({ lint, changedFiles: ['src/api/thing.ts'], dir: 'docs/adr' });

    expect(outcome.governedBy).toHaveLength(6);
    expect(outcome.governing.map((d) => d.recordId)).toEqual(['0003']);
    expect(outcome.activeProposals.map((d) => d.recordId)).toEqual(['0001', '0002']);
    expect(outcome.history.map((d) => d.recordId)).toEqual(['0004', '0005', '0006']);
  });

  test('every governedBy entry carries its status, so consumers can filter', async () => {
    const root = await seedEveryStatus();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const outcome = checkChanges({ lint, changedFiles: ['src/api/thing.ts'], dir: 'docs/adr' });

    expect(outcome.governedBy.map((d) => d.status)).toEqual([
      'draft',
      'proposed',
      'accepted',
      'rejected',
      'superseded',
      'deprecated',
    ]);
  });

  test('a superseded record names the successor that replaced it', async () => {
    const root = await seedEveryStatus();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const outcome = checkChanges({ lint, changedFiles: ['src/api/thing.ts'], dir: 'docs/adr' });

    expect(outcome.history.find((d) => d.recordId === '0005')?.supersededBy).toBe('0003');
    expect(outcome.governing[0]?.supersededBy).toBeUndefined();
  });

  test('the three buckets partition governedBy without loss or duplication', async () => {
    const root = await seedEveryStatus();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const outcome = checkChanges({ lint, changedFiles: ['src/api/thing.ts'], dir: 'docs/adr' });

    const bucketed = [...outcome.governing, ...outcome.activeProposals, ...outcome.history];
    expect(bucketed).toHaveLength(outcome.governedBy.length);
    expect(new Set(bucketed.map((d) => d.recordId)).size).toBe(outcome.governedBy.length);
  });
});

describe('toGoverningDecisions', () => {
  test('a match whose record lint dropped is never reported as governing', async () => {
    const root = await seedEveryStatus();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const resolution = resolveAffects({ records: lint.records, changedFiles: ['src/api/thing.ts'] });

    // Simulate the record being absent from `records` while its match survives.
    const decisions = toGoverningDecisions([], resolution.matches);

    expect(decisions.every((d) => d.bucket !== 'governing')).toBe(true);
    expect(bucketDecisions(decisions).governing).toEqual([]);
  });
});
