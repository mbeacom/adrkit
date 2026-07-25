/**
 * Regression tests for adrkit#42 — `adr --help`, `adr --version`, and `adr help` were
 * all treated as unknown commands and exited 2, and there was no way to ask the CLI
 * what version it was.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLI_VERSION } from '../src/index.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const PACKAGE_JSON = resolve(process.cwd(), 'packages/cli/package.json');

async function runAdr(args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('CLI_VERSION', () => {
  test('matches the published package version', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

describe('adr --version (#42)', () => {
  for (const flag of ['--version', '-V']) {
    test(`${flag} prints the version to stdout and exits 0`, async () => {
      const result = await runAdr([flag]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${CLI_VERSION}\n`);
      expect(result.stderr).toBe('');
    });
  }
});

describe('adr help (#42)', () => {
  for (const invocation of [['--help'], ['-h'], ['help']]) {
    test(`adr ${invocation.join(' ')} prints usage to stdout and exits 0`, async () => {
      const result = await runAdr(invocation);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('adr lint');
    });
  }

  test('all three top-level help invocations print identical text', async () => {
    const [dashDash, dash, bare] = await Promise.all([runAdr(['--help']), runAdr(['-h']), runAdr(['help'])]);

    expect(dash.stdout).toBe(dashDash.stdout);
    expect(bare.stdout).toBe(dashDash.stdout);
  });

  test('adr help <command> prints that command\u2019s usage', async () => {
    const result = await runAdr(['help', 'migrate']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: adr migrate --from madr');
    expect(result.stdout).toContain('--rename');
  });

  test('adr <command> --help matches adr help <command>', async () => {
    for (const command of ['lint', 'migrate', 'new', 'graph', 'explain', 'check', 'evaluate', 'queue']) {
      const [viaFlag, viaHelp] = await Promise.all([runAdr([command, '--help']), runAdr(['help', command])]);

      expect(viaFlag.exitCode).toBe(0);
      expect(viaFlag.stderr).toBe('');
      expect(viaFlag.stdout).toBe(viaHelp.stdout);
    }
  });

  test('adr help <unknown> is still a usage error on stderr', async () => {
    const result = await runAdr(['help', 'frobnicate']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command "frobnicate"');
  });

  test('an inherited Object.prototype key is a usage error, not a crash', async () => {
    for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
      const viaHelp = await runAdr(['help', name]);
      expect(viaHelp.exitCode).toBe(2);
      expect(viaHelp.stdout).toBe('');
      expect(viaHelp.stderr).toContain(`Unknown command "${name}"`);

      const viaFlag = await runAdr([name, '--help']);
      expect(viaFlag.exitCode).toBe(2);
      expect(viaFlag.stdout).toBe('');
    }
  });
});

describe('unknown commands keep the old contract', () => {
  test('an unknown command writes usage to stderr and exits 2', async () => {
    const result = await runAdr(['frobnicate']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command "frobnicate"');
    expect(result.stderr).toContain('Usage:');
  });

  test('no arguments writes usage to stderr and exits 2', async () => {
    const result = await runAdr([]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });
});
