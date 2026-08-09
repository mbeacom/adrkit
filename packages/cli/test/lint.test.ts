import { afterEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-lint';

/**
 * Count this repository's records the way the corpus contract describes them —
 * `NNNN-*.md`, template excluded — rather than hardcoding a total that goes
 * stale the next time anyone adds a decision. Restating the rule here instead of
 * importing it from `@adrkit/core` keeps the assertion an independent check on
 * discovery: if lint silently stopped seeing a record, the counts diverge.
 */
async function countRepositoryRecords(): Promise<number> {
  const entries = await readdir(resolve(process.cwd(), 'docs/adr'), { withFileTypes: true });
  return entries.filter(
    (entry) => entry.isFile() && /^[0-9]{4,}-.+\.md$/.test(entry.name) && entry.name !== '0000-template.md',
  ).length;
}

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr lint CLI', () => {
  test('passes on this repository corpus', async () => {
    const expectedRecords = await countRepositoryRecords();
    expect(expectedRecords).toBeGreaterThan(0);

    const result = await runAdr(['lint']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`checked ${expectedRecords} records, 0 errors, 0 warnings`);
    expect(result.stderr).toBe('');
  });

  test('exits 1 on a fixture corpus containing an error', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-bad.md'),
      recordMarkdown('0001').replace('status: draft', 'status: superseded'),
    );

    const result = await runAdr(['lint', '--dir', join(root, 'docs/adr')]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('superseded-requires-supersededBy');
  });

  test('reports a missing explicit path as a finding instead of crashing', async () => {
    const root = await resetTestDir(DIR_NAME);

    const result = await runAdr(['lint', './does-not-exist.md'], root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('file-read');
    expect(result.stderr).toContain('does-not-exist.md');
  });
});
