import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-migrate';

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

describe('adr migrate CLI', () => {
  test('supports dry-run, json, and human output without writing on dry-run', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    const path = join(dir, '0001-cli.md');
    await writeText(path, '---\ntitle: Migrate through the CLI\nstatus: proposed\ndate: 2026-07-18\n---\n# Migrate through the CLI\n');

    const dryRun = await runAdr(['migrate', '--from', 'madr', '--dir', dir, '--dry-run']);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('migrated  ');
    expect(dryRun.stdout).toContain('summary: migrated 1, updated 0, unchanged 0, diverged 0, skipped 0');
    expect(dryRun.stdout).toContain('Divergence (report only):\n  none');
    expect(await readFile(path, 'utf8')).not.toContain('schemaVersion');

    const json = await runAdr(['migrate', '--from', 'madr', '--dir', dir, '--json']);
    const parsed = JSON.parse(json.stdout);
    expect(json.exitCode).toBe(0);
    expect(parsed.results).toEqual([expect.objectContaining({ outcome: 'migrated', path: expect.stringContaining('0001-cli.md') })]);

    const second = await runAdr(['migrate', '--from', 'madr', '--dir', dir]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('unchanged  ');
  });

  test('rejects non-MADR sources and documents unsupported round-trip sync', async () => {
    const result = await runAdr(['migrate', '--from', 'agent-log']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('only --from madr is available');
    expect(result.stderr).toContain('round-trip sync is unsupported');
  });
});
