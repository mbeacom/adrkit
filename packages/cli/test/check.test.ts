import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { MARKER_SCAN_FILE_CAP } from '@adrkit/core';
import {
  acceptedRecordMarkdown,
  cleanupTestDir,
  recordMarkdown,
  resetTestDir,
  supersededRecordMarkdown,
  writeText,
} from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-check';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function withAffects(markdown: string, affects: string): string {
  return markdown.replace('affects: []', affects);
}

const pathMatcher = (pattern: string): string => ['affects:', '  - type: path', `    pattern: "${pattern}"`].join('\n');

async function seedCorpus(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  await writeText(join(dir, '0001-core.md'), withAffects(acceptedRecordMarkdown('0001', 'Use core paths'), pathMatcher('packages/core/**')));
  await writeText(join(dir, '0002-cli.md'), withAffects(acceptedRecordMarkdown('0002', 'Use cli paths'), pathMatcher('packages/cli/**')));
  return root;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr check CLI', () => {
  test('prints the governing decisions for a fixed changed-file list', async () => {
    const root = await seedCorpus();

    const result = await runAdr(['check', 'packages/core/src/index.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Decisions governing this change:');
    expect(result.stdout).toContain('0001  [accepted] Use core paths');
    expect(result.stdout).toContain('via path: packages/core/**');
    expect(result.stdout).not.toContain('Use cli paths');
  });

  test('exits non-zero when a changed record has an error finding', async () => {
    const root = await seedCorpus();
    // A malformed record: unterminated frontmatter fence → parse error (severity error).
    await writeText(join(root, 'docs/adr/0003-broken.md'), '---\nid: "0003"\ntitle: Broken\n');

    const result = await runAdr(['check', 'docs/adr/0003-broken.md', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('0003-broken.md');
  });

  test('does not fail on an error in an unchanged record (only info/warn on changed → exit 0)', async () => {
    const root = await seedCorpus();
    await writeText(join(root, 'docs/adr/0003-broken.md'), '---\nid: "0003"\ntitle: Broken\n');

    // The malformed record exists but is NOT in the changed set; the changed file is a
    // clean source path that only produces the governing match (and inert-matcher infos).
    const result = await runAdr(['check', 'packages/core/src/index.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('0001  [accepted] Use core paths');
  });

  test('a non-accepted record that matches is reported separately, never as governing', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0001-draft.md'), withAffects(recordMarkdown('0001', 'Draft record'), pathMatcher('src/api/**')));
    await writeText(
      join(dir, '0002-superseded.md'),
      withAffects(supersededRecordMarkdown('0002', '0003', 'Superseded record'), pathMatcher('src/api/**')),
    );
    await writeText(
      join(dir, '0003-accepted.md'),
      withAffects(acceptedRecordMarkdown('0003', 'Accepted record'), pathMatcher('src/api/**')),
    );

    const result = await runAdr(['check', 'src/api/thing.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Decisions governing this change:\n  0003  [accepted] Accepted record');
    expect(result.stdout).toContain('Active proposals touching this change (not yet binding):\n  0001  [draft] Draft record');
    expect(result.stdout).toContain(
      'Historical records that once covered this change (not binding):\n  0002  [superseded] Superseded record (superseded by 0003)',
    );
    expect(result.stdout).toContain('checked: 1 governing, 1 active proposals, 1 historical,');
  });

  test('--json output is stable and deterministically sorted', async () => {
    const root = await seedCorpus();

    const first = await runAdr(['check', 'packages/cli/src/a.ts', 'packages/core/src/b.ts', '--dir', 'docs/adr', '--json'], root);
    const second = await runAdr(['check', 'packages/core/src/b.ts', 'packages/cli/src/a.ts', '--dir', 'docs/adr', '--json'], root);
    const parsed = JSON.parse(first.stdout);

    expect(first.exitCode).toBe(0);
    // Argument order does not change the output — it is sorted.
    expect(second.stdout).toBe(first.stdout);
    expect(parsed.changedFiles).toEqual(['packages/cli/src/a.ts', 'packages/core/src/b.ts']);
    expect(parsed.governedBy.map((g: { recordId: string }) => g.recordId)).toEqual(['0001', '0002']);
    expect(parsed.governing.map((g: { recordId: string }) => g.recordId)).toEqual(['0001', '0002']);
    expect(parsed.governedBy.map((g: { status: string }) => g.status)).toEqual(['accepted', 'accepted']);
    expect(parsed.activeProposals).toEqual([]);
    expect(parsed.history).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(parsed).toHaveProperty('changedRecords');
    expect(parsed).toHaveProperty('findings');
  });

  test('empty changed-file list is a no-op success', async () => {
    const root = await seedCorpus();

    const result = await runAdr(['check', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No decisions govern the changed files.');
  });

  test('resolves marker-only governance and normalizes the declared path', async () => {
    const root = await seedCorpus();
    await writeText(join(root, 'src/owned.ts'), '// @adr 0002\nexport const owned = true;\n');

    const result = await runAdr(['check', './src/owned.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('0002  [accepted] Use cli paths');
    expect(result.stdout).toContain('declared by src/owned.ts:1 (@adr 0002)');
    expect(result.stdout).toContain('marker scan: 1 scanned, 0 absent');
  });

  test('--json distinguishes an absent changed path from a scanned file with no markers', async () => {
    const root = await seedCorpus();

    const result = await runAdr(['check', 'src/deleted.ts', '--dir', 'docs/adr', '--json'], root);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.markerScan.counts).toEqual({
      scanned: 0,
      absent: 1,
      unreadable: 0,
      'out-of-tree': 0,
      truncated: 0,
      skipped: 0,
    });
    expect(parsed.markerScan.absentPaths).toEqual(['src/deleted.ts']);
  });

  test('says nothing about the marker scan when there was no path to scan', async () => {
    const root = await seedCorpus();

    const result = await runAdr(['check', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('marker scan');
  });

  test('reports truncated scans in human output with the measured per-path extent', async () => {
    const root = await seedCorpus();
    await writeText(join(root, 'src/large.ts'), `// @adr 0001\n${'x'.repeat(8192)}`);

    const result = await runAdr(['check', 'src/large.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'marker scan: 1 scanned, 0 absent, 0 unreadable, 0 out-of-tree, 1 truncated, 0 skipped',
    );
    // The measured extent, not the window. This file stops at its last complete line —
    // byte 13 — so the old "within the first 8192 bytes" was off by 8179 for this very
    // fixture, and "after 8192 bytes" before it named a byte nothing stopped at.
    // `check` can say 13/8205 because `runCheck` already holds the batch scan, so
    // `check --json` never had to change (ADR-0024 action item 3).
    expect(result.stdout).toContain(
      'marker scan truncated (bytes scanned of total): src/large.ts 13/8205',
    );
    // Order is scanned-of-total, not total-of-scanned: the reversal is still two true
    // numbers, so only pinning the sequence catches it.
    expect(result.stdout).not.toContain('8205/13');
    // Neither the old bound phrasing nor the constant may return.
    expect(result.stdout).not.toContain('truncated after 8192 bytes');
    expect(result.stdout).not.toContain('within the first 8192 bytes');
    expect(result.stdout).not.toContain('8192');
  });

  test('check --json carries no extent fields, so its contract is unchanged', async () => {
    const root = await seedCorpus();
    await writeText(join(root, 'src/large.ts'), `// @adr 0001\n${'x'.repeat(8192)}`);

    const result = await runAdr(['check', 'src/large.ts', '--dir', 'docs/adr', '--json'], root);

    expect(result.exitCode).toBe(0);
    const outcome = JSON.parse(result.stdout);
    // The human surface gained the measurement; `MarkerScanReport` deliberately did not.
    // `truncatedPaths` stays a plain sorted string list, and no extent leaks into the
    // Action's contract — that is what made closing the asymmetry a non-breaking change.
    expect(outcome.markerScan.truncatedPaths).toEqual(['src/large.ts']);
    expect(result.stdout).not.toContain('scannedBytes');
    expect(result.stdout).not.toContain('fileBytes');
  });

  // Only a local invocation can reach the cap: the Action refuses to evaluate a diff
  // that hit GitHub's 3,000-file list cap, so it never hands over that many paths.
  test('reports a non-blocking warning when the marker scan cap is reached', async () => {
    const root = await seedCorpus();
    const name = (index: number): string => `src/file-${String(index).padStart(5, '0')}.ts`;
    const paths = Array.from({ length: MARKER_SCAN_FILE_CAP + 1 }, (_, index) => name(index));

    const result = await runAdr(['check', ...paths, '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `marker scan: 0 scanned, ${MARKER_SCAN_FILE_CAP} absent, 0 unreadable, 0 out-of-tree, 0 truncated, 1 skipped`,
    );
    expect(result.stdout).toContain('marker-scan-capped');
    expect(result.stdout).toContain(name(MARKER_SCAN_FILE_CAP));
  });

  test('reports declaration overflow in human and JSON output without changing the exit code', async () => {
    const root = await seedCorpus();
    await writeText(
      join(root, 'src/amplified.ts'),
      Array.from({ length: 65 }, () => '// @adr 0001\n').join(''),
    );

    const human = await runAdr(['check', 'src/amplified.ts', '--dir', 'docs/adr'], root);
    const json = await runAdr(['check', 'src/amplified.ts', '--dir', 'docs/adr', '--json'], root);
    const outcome = JSON.parse(json.stdout);

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(human.stdout).toContain('marker declarations: 64/65 retained, 1 omitted (1 per-file, 0 per-batch)');
    expect(human.stdout.match(/marker-declarations-capped/g)).toHaveLength(1);
    expect(outcome.markerScan.declarations).toEqual({
      total: 65,
      retained: 64,
      omitted: 1,
      perFileOmitted: 1,
      batchOmitted: 0,
      perFileLimit: 64,
      batchLimit: 10_000,
    });
    expect(
      outcome.findings.filter((finding: { rule: string }) => finding.rule === 'marker-declarations-capped'),
    ).toHaveLength(1);
    expect(outcome.ok).toBe(true);
  });
});
