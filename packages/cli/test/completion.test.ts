import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
      expect(first.stdout).toContain('mermaid');
      expect(first.stdout).toContain('conflictsWith');
    });
  }

  test('rejects an unknown completion shell with a recovery hint', async () => {
    const result = await runAdr(['completion', 'bsh']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid shell "bsh". Did you mean "bash"?');
    expect(result.stderr).toContain('Expected "bash", "zsh", or "fish".');
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
      expect(lines(secondSlot.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

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

      const colorValues = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr --color "")',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(colorValues.stdout)).toEqual(expect.arrayContaining(['auto', 'always', 'never']));

      const colorPrefixedValues = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr --color=)',
          'COMP_CWORD=1',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(colorPrefixedValues.stdout)).toEqual(expect.arrayContaining(['--color=auto', '--color=always', '--color=never']));

      const commandColorOption = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr lint --co)',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(commandColorOption.stdout)).toEqual(expect.arrayContaining(['--color']));

      const helpColorOption = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr help --co)',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(helpColorOption.stdout)).toEqual(expect.arrayContaining(['--color']));

      const completionLateOptions = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr completion bash "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(completionLateOptions.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

      const helpLateOptions = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr help check "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(helpLateOptions.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

      const commandAfterGlobalColor = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr --color auto "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(commandAfterGlobalColor.stdout)).toEqual(expect.arrayContaining(['lint', 'completion', 'help']));

      const commandAfterEqualsColor = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr --color=auto "")',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(commandAfterEqualsColor.stdout)).toEqual(expect.arrayContaining(['lint', 'completion', 'help']));

      const exactTerminator = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr lint --)',
          'COMP_CWORD=2',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(exactTerminator.stdout)).toEqual([]);

      const priorTerminator = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr lint -- "")',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(priorTerminator.stdout)).toEqual([]);

      const afterTerminator = await runShell([
        SHELLS.bash!,
        '--noprofile',
        '--norc',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'COMP_WORDS=(adr lint -- --color)',
          'COMP_CWORD=3',
          '_adr_completion',
          'printf "%s\\n" "${COMPREPLY[@]}"',
        ].join('; '),
      ]);
      expect(lines(afterTerminator.stdout)).toEqual([]);
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
      expect(lines(noSecondSlot.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

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

      const formatValues = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr queue --format "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(formatValues.stdout)).toEqual(expect.arrayContaining(['markdown', 'json']));

      const colorValues = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr --color "")',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(colorValues.stdout)).toEqual(expect.arrayContaining(['auto', 'always', 'never']));

      const colorPrefixedValues = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr --color=)',
          'CURRENT=2',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(colorPrefixedValues.stdout)).toEqual(expect.arrayContaining(['--color=auto', '--color=always', '--color=never']));

      const commandColorOption = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr lint --co)',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(commandColorOption.stdout)).toEqual(expect.arrayContaining(['--color']));

      const helpColorOption = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr help --co)',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(helpColorOption.stdout)).toEqual(expect.arrayContaining(['--color']));

      const completionLateOptions = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr completion bash "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(completionLateOptions.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

      const helpLateOptions = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr help check "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(helpLateOptions.stdout)).toEqual(expect.arrayContaining(['-h', '--help', '--color']));

      const commandAfterGlobalColor = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr --color auto "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(commandAfterGlobalColor.stdout)).toEqual(expect.arrayContaining(['lint', 'completion', 'help']));

      const commandAfterEqualsColor = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr --color=auto "")',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(commandAfterEqualsColor.stdout)).toEqual(expect.arrayContaining(['lint', 'completion', 'help']));

      const exactTerminator = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr lint --)',
          'CURRENT=3',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(exactTerminator.stdout)).toEqual([]);

      const priorTerminator = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr lint -- "")',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(priorTerminator.stdout)).toEqual([]);

      const afterTerminator = await runShell([
        SHELLS.zsh!,
        '-f',
        '-c',
        [
          `source ${JSON.stringify(scriptPath)}`,
          'function compadd() { shift 2; print -rl -- "$@"; }',
          'words=(adr lint -- --color)',
          'CURRENT=4',
          '_adr_completion',
        ].join('; '),
      ]);
      expect(lines(afterTerminator.stdout)).toEqual([]);
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

      const commandColorOption = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr lint --co')}`,
      ]);
      expect(lines(commandColorOption.stdout).some((line) => line.startsWith('--color'))).toBe(true);

      const helpColorOption = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr help --co')}`,
      ]);
      expect(lines(helpColorOption.stdout).some((line) => line.startsWith('--color'))).toBe(true);

      const completionLateOptions = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr completion bash ')}`,
      ]);
      expect(lines(completionLateOptions.stdout).some((line) => line.startsWith('--help'))).toBe(true);
      expect(lines(completionLateOptions.stdout).some((line) => line.startsWith('--color'))).toBe(true);

      const helpLateOptions = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr help check ')}`,
      ]);
      expect(lines(helpLateOptions.stdout).some((line) => line.startsWith('--help'))).toBe(true);
      expect(lines(helpLateOptions.stdout).some((line) => line.startsWith('--color'))).toBe(true);

      const exactTerminator = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr lint --')}`,
      ]);
      expect(lines(exactTerminator.stdout)).toEqual([]);

      const priorTerminator = await runShell([
        SHELLS.fish!,
        '-c',
        `source ${JSON.stringify(scriptPath)}; complete -C ${JSON.stringify('adr lint -- ')}`,
      ]);
      expect(lines(priorTerminator.stdout)).toEqual([]);

      const colorValue = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', '--color'], [
          'if __adr_color_value',
          '    echo value',
          'end',
        ]),
      ]);
      expect(lines(colorValue.stdout)).toEqual(['value']);

      const colorPrefixedValue = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', '--color=auto'], [
          'if __adr_color_value',
          '    echo value',
          'end',
        ]),
      ]);
      expect(lines(colorPrefixedValue.stdout)).toEqual(['value']);

      const commandAfterGlobalColor = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', '--color', 'auto', 'lint'], [
          'if __adr_root_position',
          '    echo root',
          'end',
          'if __adr_subcommand_is lint',
          '    echo command',
          'end',
        ]),
      ]);
      expect(lines(commandAfterGlobalColor.stdout)).toEqual(['command']);

      const commandAfterEqualsColor = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', '--color=auto', 'lint'], [
          'if __adr_root_position',
          '    echo root',
          'end',
          'if __adr_subcommand_is lint',
          '    echo command',
          'end',
        ]),
      ]);
      expect(lines(commandAfterEqualsColor.stdout)).toEqual(['command']);

      const afterTerminator = await runShell([
        SHELLS.fish!,
        '-c',
        fishScript(scriptPath, ['adr', 'lint', '--', '--color'], [
          'if __adr_after_terminator',
          '    echo after',
          'end',
          'if __adr_subcommand_is lint',
          '    echo command',
          'end',
        ]),
      ]);
      expect(lines(afterTerminator.stdout)).toEqual(['after', 'command']);
    });
  });
});
