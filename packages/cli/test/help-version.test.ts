/**
 * Regression tests for adrkit#42 — `adr --help`, `adr --version`, and `adr help` were
 * all treated as unknown commands and exited 2, and there was no way to ask the CLI
 * what version it was.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { COMMAND_ORDER } from '../src/command-registry.ts';
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
      expect(result.stdout).toContain(`adrkit ${CLI_VERSION}`);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('adr lint');
    });
  }

  test('all three top-level help invocations print identical text', async () => {
    const [dashDash, dash, bare] = await Promise.all([runAdr(['--help']), runAdr(['-h']), runAdr(['help'])]);

    expect(dash.stdout).toBe(dashDash.stdout);
    expect(bare.stdout).toBe(dashDash.stdout);
  });

  test('top-level help is task-oriented and does not expose internal ADR references', async () => {
    const result = await runAdr(['--help']);

    expect(result.stdout).toContain('Commands:');
    expect(result.stdout).toContain('Create a decision record');
    expect(result.stdout).toContain('Review changed files against governing decisions');
    expect(result.stdout).toContain('Generate shell completion scripts');
    expect(result.stdout).toContain('adr completion bash');
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain("Run 'adr help <command>'");
    expect(result.stdout).toContain('Documentation: https://adrkit.dev/commands/');
    expect(result.stdout).not.toContain('https://adrkit.dev/docs/commands/');
    expect(result.stdout).not.toContain('ADR-0008');
  });

  test('adr help <command> prints that command\u2019s usage', async () => {
    const result = await runAdr(['help', 'migrate']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: adr migrate --from madr');
    expect(result.stdout).toContain('--rename');
    expect(result.stdout).toContain('--color <auto|always|never>');
  });

  test('adr help help documents the help command without suggesting itself', async () => {
    const result = await runAdr(['help', 'help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: adr help [command]');
  });

  test('adr help check documents its successful empty-input behavior', async () => {
    const result = await runAdr(['help', 'check']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: adr check [files...]');
    expect(result.stdout).toContain('With no files, the command performs a successful no-op.');
  });

  test('adr help evaluate documents its proposal-relative corpus default', async () => {
    const result = await runAdr(['help', 'evaluate']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--dir <path>        ADR corpus directory (default: proposal directory)');
    expect(result.stdout).toContain('proposals/0042-adopt-postgresql.md --dir docs/adr');
  });

  test('command help stays literal after -- and still parses command options before it', async () => {
    const dir = await mkdtemp(`${tmpdir()}/adr-help-literal-`);
    try {
      const dashDash = await runAdr(['new', '--dir', dir, '--', '--help']);
      const dash = await runAdr(['new', '--dir', dir, '--', '-h']);

      expect(dashDash.exitCode).toBe(0);
      expect(dashDash.stderr).toBe('');
      expect(dashDash.stdout).not.toContain('Usage: adr new');
      expect(dashDash.stdout).toContain(dir);

      expect(dash.exitCode).toBe(2);
      expect(dash.stdout).toBe('');
      expect(dash.stderr).toContain('Title must be between 3 and 120 characters');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('adr new reports supported statuses and focused help for an invalid value', async () => {
    const help = await runAdr(['help', 'new']);
    const invalid = await runAdr(['new', 'Adopt PostgreSQL', '--status', 'active']);

    expect(help.stdout).toContain('draft|proposed|rejected|deprecated');
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('Error: Invalid status "active"');
    expect(invalid.stderr).toContain("Run 'adr help new' for more information.");
  });

  test('command-scoped typo recovery suggests the global color option', async () => {
    const result = await runAdr(['lint', '--colr', 'always']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown option "--colr". Did you mean "--color"?');
  });

  test('adr help explain states the scan bound as a bound, not as the extent', async () => {
    const result = await runAdr(['help', 'explain']);

    expect(result.exitCode).toBe(0);
    // The window bounds the scan; the scan stops at the last complete line inside it, so
    // "its first 8192 bytes are scanned" would promise an extent the tool does not reach
    // (ADR-0024). Pinned because help text is otherwise only compared against itself.
    expect(result.stdout).toContain('at most its first');
    expect(result.stdout).not.toContain('its first 8192\nbytes are scanned');
  });

  test('adr <command> --help matches adr help <command>', async () => {
    for (const command of COMMAND_ORDER) {
      const [viaFlag, viaHelp] = await Promise.all([runAdr([command, '--help']), runAdr(['help', command])]);

      expect(viaFlag.exitCode).toBe(0);
      expect(viaHelp.exitCode).toBe(0);
      expect(viaFlag.stderr).toBe('');
      expect(viaFlag.stdout).toContain('Examples:');

      expect(viaHelp.stderr).toBe('');

      if (command === 'help') {
        expect(viaFlag.stdout).toContain('adrkit');
        expect(viaHelp.stdout).toContain('Usage: adr help [command]');
        continue;
      }

      expect(viaFlag.stdout).toContain('--color <auto|always|never>');
      expect(viaFlag.stdout).toBe(viaHelp.stdout);
    }
  });

  test('adr help <unknown> is still a usage error on stderr', async () => {
    const result = await runAdr(['help', 'frobnicate']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command "frobnicate"');
  });

  test('a likely command typo includes a suggestion', async () => {
    const result = await runAdr(['lnit']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown command "lnit". Did you mean "lint"?');
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

describe('top-level invocation behavior', () => {
  test('an unknown command writes usage to stderr and exits 2', async () => {
    const result = await runAdr(['frobnicate']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command "frobnicate"');
    expect(result.stderr).toContain('Usage:');
  });

  test('no arguments shows help on stdout and exits 0', async () => {
    const result = await runAdr([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).toBe('');
  });

  test('command usage errors point to focused help', async () => {
    const result = await runAdr(['graph', '--format', 'svg']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Error: adr graph --format must be "auto", "terminal", "dot", "json", or "mermaid".',
    );
    expect(result.stderr).toContain('Usage: adr graph [options]');
    expect(result.stderr).toContain("Run 'adr help graph' for more information.");
    expect(result.stderr).not.toContain('Commands:');
  });
});
