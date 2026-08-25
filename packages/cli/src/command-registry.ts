export const COMMAND_ORDER = ['new', 'lint', 'check', 'explain', 'graph', 'queue', 'evaluate', 'migrate', 'completion', 'help'] as const;

export type CommandName = (typeof COMMAND_ORDER)[number];

export const COMMAND_SUMMARIES: Record<CommandName, string> = {
  new: 'Create a decision record',
  lint: 'Validate ADR files and corpus rules',
  check: 'Review changed files against governing decisions',
  explain: 'Explain which decisions govern a path',
  graph: 'Render decision relationships',
  queue: 'Show the architecture review board queue',
  evaluate: 'Evaluate a proposal from an offline snapshot',
  migrate: 'Import a MADR corpus into adrkit',
  completion: 'Generate shell completion scripts',
  help: 'Show help for a command',
};

export const TOP_LEVEL_OPTIONS = ['--help', '--version'] as const;
export const TOP_LEVEL_COMPLETION_OPTIONS = ['-h', '--help', '-V', '--version'] as const;

export const COMMAND_OPTIONS = {
  new: ['--status', '--dir', '--json', '--help'],
  lint: ['--json', '--dir', '--help'],
  check: ['--json', '--dir', '--help'],
  explain: ['--json', '--dir', '--help'],
  graph: ['--dir', '--format', '--help'],
  queue: ['--dir', '--as-of', '--format', '--help'],
  evaluate: ['--snapshot', '--date', '--json', '--dir', '--help'],
  migrate: ['--from', '--dir', '--dry-run', '--rename', '--json', '--help'],
  completion: ['--help'],
  help: ['--help'],
} as const satisfies Record<CommandName, readonly string[]>;

export const COMMAND_COMPLETION_OPTIONS = {
  new: ['-h', '--help', '--status', '--dir', '--json'],
  lint: ['-h', '--help', '--json', '--dir'],
  check: ['-h', '--help', '--json', '--dir'],
  explain: ['-h', '--help', '--json', '--dir'],
  graph: ['-h', '--help', '--dir', '--format'],
  queue: ['-h', '--help', '--dir', '--as-of', '--format'],
  evaluate: ['-h', '--help', '--snapshot', '--date', '--json', '--dir'],
  migrate: ['-h', '--help', '--from', '--dir', '--dry-run', '--rename', '--json'],
  completion: ['-h', '--help'],
  help: ['-h', '--help'],
} as const satisfies Record<CommandName, readonly string[]>;

export const COMMAND_VALUE_CHOICES = {
  new: { '--status': ['draft', 'proposed', 'rejected', 'deprecated'] },
  graph: { '--format': ['dot', 'json'] },
  queue: { '--format': ['markdown', 'json'] },
  migrate: { '--from': ['madr'] },
} as const satisfies Partial<Record<CommandName, Record<string, readonly string[]>>>;

export const COMMAND_POSITIONAL_CHOICES = {
  help: COMMAND_ORDER,
  completion: ['bash', 'zsh', 'fish'],
} as const satisfies Partial<Record<CommandName, readonly string[]>>;

export function commandOptions(command: CommandName): readonly string[] {
  return COMMAND_OPTIONS[command];
}

export function commandCompletionOptions(command: CommandName): readonly string[] {
  return COMMAND_COMPLETION_OPTIONS[command];
}

export function commandValueChoices(command: CommandName, option: string): readonly string[] | undefined {
  const choiceMap = COMMAND_VALUE_CHOICES[command as keyof typeof COMMAND_VALUE_CHOICES] as
    | Record<string, readonly string[]>
    | undefined;
  return choiceMap?.[option];
}

export function commandValueChoiceMap(command: CommandName): Record<string, readonly string[]> | undefined {
  return COMMAND_VALUE_CHOICES[command as keyof typeof COMMAND_VALUE_CHOICES] as
    | Record<string, readonly string[]>
    | undefined;
}

export function requiredCommandValueChoices(command: CommandName, option: string): readonly string[] {
  const choices = commandValueChoices(command, option);
  if (!choices) {
    throw new Error(`Missing command registry value choices for ${command} ${option}.`);
  }
  return choices;
}

export function commandPositionalChoices(command: CommandName): readonly string[] | undefined {
  return COMMAND_POSITIONAL_CHOICES[command as keyof typeof COMMAND_POSITIONAL_CHOICES];
}

export function renderTopLevelUsage(version: string): string {
  const width = Math.max(...COMMAND_ORDER.map((command) => command.length));
  const commandLines = COMMAND_ORDER.map(
    (command) => `  ${command.padEnd(width)}  ${COMMAND_SUMMARIES[command]}`,
  ).join('\n');

  return `adrkit ${version}
Decision memory for human- and agent-authored plans.

Usage:
  adr <command> [options]

Commands:
${commandLines}

Options:
  -h, --help       Show help
  -V, --version    Show version

Examples:
  adr new "Adopt PostgreSQL"
  adr lint
  adr explain src/auth/session.ts
  adr check src/auth/session.ts package.json
  adr completion bash

Run 'adr help <command>' for command-specific options and examples.
Documentation: https://adrkit.dev/commands/
`;
}
