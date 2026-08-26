import type { GraphEdge } from '@adrkit/core';
import type { StreamStyle } from './presentation.ts';

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

export const TOP_LEVEL_OPTIONS = ['--help', '--version', '--color'] as const;
export const GLOBAL_COLOR_OPTIONS = ['--color'] as const;
export const GLOBAL_COLOR_VALUES = ['auto', 'always', 'never'] as const;
export const TOP_LEVEL_COMPLETION_OPTIONS = ['-h', '--help', '-V', '--version', ...GLOBAL_COLOR_OPTIONS] as const;
export const TOP_LEVEL_COMPLETION_VALUE_CHOICES = {
  '--color': GLOBAL_COLOR_VALUES,
} as const satisfies Record<string, readonly string[]>;

export const GRAPH_FORMAT_VALUES = ['auto', 'terminal', 'dot', 'json', 'mermaid'] as const;
export const GRAPH_KIND_VALUES = ['supersedes', 'relatesTo', 'conflictsWith'] as const satisfies readonly GraphEdge['kind'][];
export type GraphFormat = (typeof GRAPH_FORMAT_VALUES)[number];
export type GraphKind = (typeof GRAPH_KIND_VALUES)[number];

export function isGraphFormat(value: string): value is GraphFormat {
  return GRAPH_FORMAT_VALUES.includes(value as GraphFormat);
}

export function isGraphKind(value: string): value is GraphKind {
  return GRAPH_KIND_VALUES.includes(value as GraphKind);
}

export const COMMAND_OPTIONS = {
  new: ['--status', '--dir', '--json', '--help'],
  lint: ['--json', '--dir', '--help'],
  check: ['--json', '--dir', '--help'],
  explain: ['--json', '--dir', '--help'],
  graph: ['--dir', '--format', '--focus', '--kind', '--help'],
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
  graph: ['-h', '--help', '--dir', '--format', '--focus', '--kind'],
  queue: ['-h', '--help', '--dir', '--as-of', '--format'],
  evaluate: ['-h', '--help', '--snapshot', '--date', '--json', '--dir'],
  migrate: ['-h', '--help', '--from', '--dir', '--dry-run', '--rename', '--json'],
  completion: ['-h', '--help'],
  help: ['-h', '--help'],
} as const satisfies Record<CommandName, readonly string[]>;

export const COMMAND_VALUE_CHOICES = {
  new: { '--status': ['draft', 'proposed', 'rejected', 'deprecated'] },
  graph: { '--format': GRAPH_FORMAT_VALUES, '--kind': GRAPH_KIND_VALUES },
  queue: { '--format': ['markdown', 'json'] },
  migrate: { '--from': ['madr'] },
} as const satisfies Partial<Record<CommandName, Record<string, readonly string[]>>>;

export const COMMAND_POSITIONAL_CHOICES = {
  help: COMMAND_ORDER,
  completion: ['bash', 'zsh', 'fish'],
} as const satisfies Partial<Record<CommandName, readonly string[]>>;

export function withGlobalColorOption(options: readonly string[]): readonly string[] {
  return [...new Set([...options, ...GLOBAL_COLOR_OPTIONS])];
}

export function renderGlobalColorUsageLine(indent = '  '): string {
  return `${indent}--color <auto|always|never>  Colorize human-readable output (default: auto; honors NO_COLOR)`;
}

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

export function topLevelValueChoices(option: string): readonly string[] | undefined {
  return TOP_LEVEL_COMPLETION_VALUE_CHOICES[option as keyof typeof TOP_LEVEL_COMPLETION_VALUE_CHOICES];
}

export function renderTopLevelUsage(version: string, style?: StreamStyle): string {
  const heading = style?.heading ?? ((text: string) => text);
  const commandStyle = style?.command ?? ((text: string) => text);
  const note = style?.note ?? ((text: string) => text);
  const label = style?.label ?? ((text: string) => text);
  const width = Math.max(...COMMAND_ORDER.map((command) => command.length));
  const commandLines = COMMAND_ORDER.map(
    (command) => `  ${commandStyle(command.padEnd(width))}  ${style?.note?.(COMMAND_SUMMARIES[command]) ?? COMMAND_SUMMARIES[command]}`,
  ).join('\n');

  return `${heading(`adrkit ${version}`)}
${note('Decision memory for human- and agent-authored plans.')}

${heading('Usage:')}
  adr <command> [options]

${heading('Commands:')}
${commandLines}

${heading('Options:')}
  ${label('--color')} auto|always|never  Colorize human-readable output (default: auto; honors NO_COLOR)
  ${label('-h, --help')}                 Show help
  ${label('-V, --version')}              Show version

${heading('Examples:')}
  adr new "Adopt PostgreSQL"
  adr lint
  adr explain src/auth/session.ts
  adr check src/auth/session.ts package.json
  adr completion bash

${note("Run 'adr help <command>' for command-specific options and examples.")}
${note('Documentation: https://adrkit.dev/commands/')}
`;
}
