import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMAND_VALUE_CHOICES } from '../src/command-registry.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const SHELLS = {
  bash: Bun.which('bash'),
  zsh: Bun.which('zsh'),
  fish: Bun.which('fish'),
} as const;

type Shell = keyof typeof SHELLS;

async function runAdr(args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: process.cwd(),
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

async function writeCompletionScript(shell: Shell): Promise<{ dir: string; stdout: string }> {
  const result = await runAdr(['completion', shell]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('adrkit');
  return {
    dir: await mkdtemp(join(tmpdir(), `adr-completion-${shell}-`)),
    stdout: result.stdout,
  };
}

async function withCompletionScript(shell: Shell, run: (scriptPath: string) => Promise<void>): Promise<void> {
  const { dir, stdout } = await writeCompletionScript(shell);
  const scriptPath = join(dir, `adr.${shell}`);
  await writeFile(scriptPath, stdout, 'utf8');

  try {
    await run(scriptPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runShell(command: string[], cwd = process.cwd()) {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function fishScript(scriptPath: string, tokens: string[], body: string[]): string {
  return [
    `source ${JSON.stringify(scriptPath)}`,
    'function commandline',
    '    switch $argv[1]',
    '        case -opc',
    '            printf "%s\\n" $TEST_TOKENS',
    '        case -ct',
    '            printf "%s" $TEST_CTOKEN',
    '    end',
    'end',
    `set -g TEST_TOKENS ${tokens.join(' ')}`,
    'set -g TEST_CTOKEN ""',
    ...body,
  ].join('\n');
}

describe('adr completion CLI', () => {
  for (const shell of ['bash', 'zsh', 'fish'] as const) {
    test(`generates a deterministic ${shell} completion script`, async () => {
      const first = await runAdr(['completion', shell]);
      const second = await runAdr(['completion', shell]);

      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(first.stdout).toContain('adrkit');
      expect(first.stdout).toContain('help');
      expect(first.stdout).toContain('completion');
    });
  }

  test('rejects an unknown completion shell with a recovery hint', async () => {
    const result = await runAdr(['completion', 'bsh']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid shell "bsh". Did you mean "bash"?');
    expect(result.stderr).toContain('Expected "bash", "zsh", or "fish".');
  });

  test('completion value metadata stays aligned with the shared registry', async () => {
    const result = await runAdr(['completion', 'bash']);

    expect(result.exitCode).toBe(0);
    for (const choices of Object.values(COMMAND_VALUE_CHOICES)) {
      for (const valueChoices of Object.values(choices)) {
        for (const choice of valueChoices) {
          expect(result.stdout).toContain(choice);
        }
      }
    }
  });

  test('requires a shell argument', async () => {
    const result = await runAdr(['completion']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('adr completion requires exactly one shell');
  });

  test('bash completion passes syntax checks and covers first-slot and value completions', async () => {
    if (!SHELLS.bash) return;

    await withCompletionScript('bash', async (scriptPath) => {
      const syntax = await runShell([SHELLS.bash!, '--noprofile', '--norc', '-n', scriptPath]);
      expect(syntax.exitCode).toBe(0);
      expect(syntax.stderr).toBe('');

      const shellNames = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr completion "")',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(shellNames.stdout)).toEqual(expect.arrayContaining(['bash', 'zsh', 'fish']));

      const commandNames = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr help "")',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(commandNames.stdout)).toEqual(expect.arrayContaining(['new', 'lint', 'completion']));

      const secondSlot = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr help lint "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(secondSlot.stdout)).toEqual([]);

      const statusValues = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr new --status=)',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(statusValues.stdout)).toEqual(expect.arrayContaining(['--status=draft', '--status=proposed', '--status=rejected', '--status=deprecated']));

      const formatValues = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr queue --format "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(formatValues.stdout)).toEqual(expect.arrayContaining(['markdown', 'json']));

      const emptyTokenOptions = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr migrate "")',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(emptyTokenOptions.stdout)).toEqual(expect.arrayContaining(['--from', '--dir', '--dry-run']));
    });
  });

  test('zsh completion passes syntax checks and uses native prefix matching', async () => {
    if (!SHELLS.zsh) return;

    await withCompletionScript('zsh', async (scriptPath) => {
      const syntax = await runShell([SHELLS.zsh!, '-f', '-n', scriptPath]);
      expect(syntax.exitCode).toBe(0);
      expect(syntax.stderr).toBe('');

      const firstSlot = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr completion "")',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(firstSlot.stdout)).toEqual(expect.arrayContaining(['bash', 'zsh', 'fish']));

      const noSecondSlot = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr help lint "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(noSecondSlot.stdout)).toEqual([]);

      const statusValues = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr new --status=)',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(statusValues.stdout)).toEqual(expect.arrayContaining(['--status=draft', '--status=proposed', '--status=rejected', '--status=deprecated']));

      const emptyTokenOptions = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr migrate "")',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(emptyTokenOptions.stdout)).toEqual(expect.arrayContaining(['--from', '--dir', '--dry-run']));
    });
  });

  test('fish completion derives the real subcommand position', async () => {
    if (!SHELLS.fish) return;

    await withCompletionScript('fish', async (scriptPath) => {
      const syntax = await runShell([SHELLS.fish!, '-n', scriptPath]);
      expect(syntax.exitCode).toBe(0);
      expect(syntax.stderr).toBe('');

      const falsePositive = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', 'new', 'help'], [
          'if __adr_subcommand_is help',
          '    echo match',
          'end',
          'if __adr_first_positional',
          '    echo first',
          'end',
        ]),
      ]);
      expect(falsePositive.stdout).toBe('');

      const firstPositional = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', 'help'], [
          'if __adr_subcommand_is help',
          '    echo match',
          'end',
          'if __adr_first_positional',
          '    echo first',
          'end',
        ]),
      ]);
      expect(lines(firstPositional.stdout)).toEqual(['match', 'first']);

      const secondPositional = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', 'help', 'lint'], [
          'if __adr_subcommand_is help',
          '    echo match',
          'end',
          'if __adr_first_positional',
          '    echo first',
          'end',
        ]),
      ]);
      expect(lines(secondPositional.stdout)).toEqual(['match']);

      const optionToken = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', 'help'], [
          'set -g TEST_CTOKEN "-"',
          'if __adr_current_token_is_option',
          '    echo option',
          'end',
        ]),
      ]);
      expect(lines(optionToken.stdout)).toEqual(['option']);

      const generated = await runAdr(['completion', 'fish']);
      expect(generated.stdout).toContain('not __adr_current_token_is_option');

      const leadingDashSuppression = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C "adr help -"`,
      ]);
      expect(lines(leadingDashSuppression.stdout)).not.toEqual(expect.arrayContaining(['new', 'lint', 'completion']));
    });
  });
});
