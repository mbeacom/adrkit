import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
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
});
