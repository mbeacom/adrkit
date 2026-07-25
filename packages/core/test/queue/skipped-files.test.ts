/**
 * Regression tests for adrkit#51 — `adr queue` omitted records corpus discovery could
 * not see just as silently as `lint` used to before #41: a `proposed` ARB-tier record
 * with a non-discoverable filename produced `0 item(s) | 0 corpus finding(s)`, which
 * reads as a healthy, empty queue rather than a governance gap.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildQueueReport } from '../../src/queue/kernel.ts';
import { formatQueueReportMarkdown } from '../../src/queue/format.ts';
import { mapFindingToCorpusFinding } from '../../src/queue/findings.ts';
import { lintCorpus } from '../../src/validate/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from '../helpers.ts';

const DIR_NAME = 'queue-skipped';
const AS_OF = '2026-07-21';

/** A schema-valid `proposed`, ARB-tier, one-way-door record — the highest-stakes shape. */
function arbRecord(id: string, title: string): string {
  return `---
schemaVersion: 0.1.0
id: "${id}"
title: ${title}
status: proposed
date: 2026-07-10
deciders: ["@mbeacom"]
tags: []
scope: org
reversibility: one-way-door
blastRadius: cross-team
relatesTo: []
affects: []
review:
  tier: arb
  queuedAt: 2026-07-10T00:00:00Z
  slaDays: 11
provenance:
  authoredBy: human
---

# ADR-${id}: ${title}
`;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('queue visibility of skipped files (#51)', () => {
  test('an undiscoverable proposed record is reported instead of vanishing', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/arb-ledger-migration.md'), arbRecord('0001', 'Migrate the order ledger'));

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });

    expect(report.totalItems).toBe(0);
    expect(report.corpusFindings).toHaveLength(1);
    expect(report.corpusFindings[0]).toMatchObject({
      sourcePath: 'docs/adr/arb-ledger-migration.md',
      code: 'corpus.file-skipped',
      severity: 'warn',
    });
  });

  test('a nested proposed record is reported too', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/nested/0001-deep.md'), arbRecord('0001', 'Migrate the order ledger'));

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });

    expect(report.totalItems).toBe(0);
    expect(report.corpusFindings.map((f) => f.code)).toEqual(['corpus.file-skipped']);
  });

  test('the same bytes under a discoverable filename still queue normally', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-migrate-the-order-ledger.md'), arbRecord('0001', 'Migrate the order ledger'));

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });

    expect(report.totalItems).toBe(1);
    expect(report.items[0]).toMatchObject({ id: '0001', tier: 'arb', slaState: 'due' });
    expect(report.corpusFindings).toEqual([]);
  });

  test('a clean corpus still reports zero corpus findings and renders no section', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-real.md'), arbRecord('0001', 'Migrate the order ledger'));
    // Conventional corpus documentation must not be mistaken for a skipped record —
    // consumers assert on the absence of this section.
    await writeText(join(root, 'docs/adr/README.md'), '# Corpus readme\n');
    await writeText(join(root, 'docs/adr/0000-template.md'), '# Template\n');

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });

    expect(report.totalCorpusFindings).toBe(0);
    expect(formatQueueReportMarkdown(report)).not.toContain('Corpus Findings');
  });

  test('a skipped file is a warning, so it never fails the run', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/arb-ledger-migration.md'), arbRecord('0001', 'Migrate the order ledger'));

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });

    // Both the CLI exit code and the Action's setFailed path key off error severity.
    expect(report.corpusFindings.some((f) => f.severity === 'error')).toBe(false);
  });

  test('a genuinely broken file is still an error alongside a skipped one', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/arb-ledger-migration.md'), arbRecord('0001', 'Migrate the order ledger'));
    await writeText(join(root, 'docs/adr/0002-broken.md'), '---\nid: "0002"\ntitle: Broken\n');

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const report = buildQueueReport({ corpus, asOf: AS_OF });
    const bySeverity = Object.fromEntries(report.corpusFindings.map((f) => [f.code, f.severity]));

    expect(bySeverity['corpus.file-skipped']).toBe('warn');
    expect(bySeverity['corpus.parse-error']).toBe('error');
    expect(report.corpusFindings.some((f) => f.severity === 'error')).toBe(true);
  });

  test('the report stays deterministic with a skipped file present', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/b-second.md'), arbRecord('0002', 'Second decision'));
    await writeText(join(root, 'docs/adr/a-first.md'), arbRecord('0001', 'First decision'));

    const corpus = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const first = buildQueueReport({ corpus, asOf: AS_OF });
    const second = buildQueueReport({ corpus, asOf: AS_OF });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.corpusFindings.map((f) => f.sourcePath)).toEqual([
      'docs/adr/a-first.md',
      'docs/adr/b-second.md',
    ]);
  });
});

describe('mapFindingToCorpusFinding severity', () => {
  test('corpus-file-skipped maps to a warn-severity corpus.file-skipped', () => {
    const mapped = mapFindingToCorpusFinding(
      { rule: 'corpus-file-skipped', severity: 'warn', message: 'skipped', path: 'docs/adr/x.md' },
      'docs/adr/x.md',
    );

    expect(mapped).toEqual({
      sourcePath: 'docs/adr/x.md',
      code: 'corpus.file-skipped',
      severity: 'warn',
      message: 'skipped',
    });
  });

  test('every other rule still maps to error severity', () => {
    for (const rule of ['file-read', 'frontmatter-parse', 'strict-unknown-key', 'some-future-rule']) {
      const mapped = mapFindingToCorpusFinding(
        { rule, severity: 'error', message: 'boom', path: 'docs/adr/x.md' },
        'docs/adr/x.md',
      );
      expect(mapped.severity).toBe('error');
    }
  });
});
