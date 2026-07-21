import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-lint';

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
    const result = await runAdr(['lint']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('checked 12 records, 0 errors');
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
