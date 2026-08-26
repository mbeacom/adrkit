import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { stripAnsi } from '../src/presentation.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-color';
const QUEUE_FIX = 'packages/core/test/fixtures/queue';

async function runAdr(args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
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

describe('CLI color presentation', () => {
  test('explicit color turns on ANSI in human help output', async () => {
    const result = await runAdr(['--color', 'always', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('\u001b[');
    expect(result.stdout).toContain('adrkit 0.11.0');
  });

  test('forced color keeps lint stdout and stderr separated', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0001-bad.md'), recordMarkdown('0001', 'Bad').replace('status: draft', 'status: superseded'));

    const result = await runAdr(['--color', 'always', 'lint'], root);

    expect(result.exitCode).toBe(1);
    expect(stripAnsi(result.stdout)).toContain('checked 1 records');
    expect(result.stdout).toContain('\u001b[');
    expect(result.stdout).not.toContain('superseded-requires-supersededBy');
    expect(result.stderr).toContain('superseded-requires-supersededBy');
    expect(result.stderr).toContain('\u001b[');
    expect(result.stderr).not.toContain('checked 1 records');
  });

  test('JSON output stays ANSI-free even when color is forced', async () => {
    const result = await runAdr(
      ['--color', 'always', 'queue', '--dir', `${QUEUE_FIX}/within-sla-corpus`, '--as-of', '2026-01-08', '--format', 'json'],
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(JSON.parse(result.stdout).version).toBe('1');
  });

  test('queue markdown stays canonical and ANSI-free even when color is forced', async () => {
    const result = await runAdr(
      ['--color', 'always', 'queue', '--dir', `${QUEUE_FIX}/within-sla-corpus`, '--as-of', '2026-01-08', '--format', 'markdown'],
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(stripAnsi(result.stdout));
  });

  test('graph machine formats stay ANSI-free while terminal output can be forced', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0001-graph.md'), recordMarkdown('0001', 'Graph').replace('status: draft', 'status: proposed'));

    for (const format of ['dot', 'json', 'mermaid']) {
      const result = await runAdr(['--color', 'always', 'graph', '--format', format], root);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('\u001b[');
    }

    const terminal = await runAdr(['--color', 'always', 'graph', '--format', 'terminal'], root);
    expect(terminal.exitCode).toBe(0);
    expect(terminal.stdout).toContain('\u001b[');
    expect(terminal.stdout).toContain('\u001b[33m\u001b[1mproposed\u001b[0m');
    expect(stripAnsi(terminal.stdout)).toContain('ADR decision graph');
  });

  test('completion scripts stay ANSI-free even when color is forced', async () => {
    const result = await runAdr(['--color', 'always', 'completion', 'bash']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toContain('complete -F _adr_completion adr adrkit');
  });

  test('global color parsing stops at -- and leaves the literal positional untouched', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, '--color'), recordMarkdown('0001', 'Color').replace('status: draft', 'status: proposed'));

    const result = await runAdr(['--color', 'always', 'lint', '--', '--color'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(stripAnsi(result.stdout)).toContain('checked 1 records');
    expect(result.stderr).not.toContain('Invalid --color value');
  });
});
