import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { cleanupTestDir, resetTestDir } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-mistake-recovery';

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

describe('CLI mistake recovery', () => {
  test('suggests the intended top-level long option', async () => {
    const result = await runAdr(['--hepl']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown option "--hepl". Did you mean "--help"?');
  });

  test('suggests a mistyped command option for lint', async () => {
    const result = await runAdr(['lint', '--jsoon']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown option "--jsoon". Did you mean "--json"?');
  });

  test('suggests a near-miss graph format but not a far miss', async () => {
    const near = await runAdr(['graph', '--format', 'jsn']);
    expect(near.exitCode).toBe(2);
    expect(near.stdout).toBe('');
    expect(near.stderr).toContain('Did you mean "json"?');

    const far = await runAdr(['graph', '--format', 'svg']);
    expect(far.exitCode).toBe(2);
    expect(far.stdout).toBe('');
    expect(far.stderr).toContain(
      'adr graph --format must be "auto", "terminal", "dot", "json", or "mermaid".',
    );
    expect(far.stderr).not.toContain('Did you mean');
  });

  test('suggests a near-miss migrate source but not a far miss', async () => {
    const near = await runAdr(['migrate', '--from', 'mard']);
    expect(near.exitCode).toBe(2);
    expect(near.stdout).toBe('');
    expect(near.stderr).toContain('Did you mean "madr"?');

    const far = await runAdr(['migrate', '--from', 'agent-log']);
    expect(far.exitCode).toBe(2);
    expect(far.stdout).toBe('');
    expect(far.stderr).toContain('Only "madr" is available; migration is one-way.');
    expect(far.stderr).not.toContain('Did you mean');
  });

  test('suggests queue options and format values, but not unrelated flags', async () => {
    const option = await runAdr(['queue', '--formatt']);
    expect(option.exitCode).toBe(2);
    expect(option.stdout).toBe('');
    expect(option.stderr).toContain('Unknown option "--formatt". Did you mean "--format"?');

    const format = await runAdr(['queue', '--format', 'jsn']);
    expect(format.exitCode).toBe(2);
    expect(format.stdout).toBe('');
    expect(format.stderr).toContain('Did you mean "json"?');

    const far = await runAdr(['queue', '--format', 'csv']);
    expect(far.exitCode).toBe(2);
    expect(far.stdout).toBe('');
    expect(far.stderr).toContain('Invalid --format value "csv". Expected "markdown" or "json".');
    expect(far.stderr).not.toContain('Did you mean');
  });

  test('suggests a near-miss scaffold status but not a far miss', async () => {
    const root = await resetTestDir(DIR_NAME);

    const near = await runAdr(['new', 'Propose a better decision', '--status', 'propoed'], root);
    expect(near.exitCode).toBe(2);
    expect(near.stdout).toBe('');
    expect(near.stderr).toContain('Did you mean "proposed"?');

    const far = await runAdr(['new', 'Propose a better decision', '--status', 'active'], root);
    expect(far.exitCode).toBe(2);
    expect(far.stdout).toBe('');
    expect(far.stderr).toContain('Invalid status "active"');
    expect(far.stderr).not.toContain('Did you mean');
  });

  test('keeps the existing scaffold error for statuses outside the closed set', async () => {
    const root = await resetTestDir(DIR_NAME);

    const result = await runAdr(['new', 'Accepted status stays a core error', '--status', 'accepted'], root);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('adr new cannot scaffold status "accepted" without additional required fields');
    expect(result.stderr).not.toContain('Did you mean');
  });
});
