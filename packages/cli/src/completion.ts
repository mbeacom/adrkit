import { closestCandidate } from './recovery.ts';
import {
  COMMAND_ORDER,
  TOP_LEVEL_COMPLETION_OPTIONS,
  commandCompletionOptions,
  commandPositionalChoices,
  commandValueChoiceMap,
} from './command-registry.ts';
import { formatUsageError } from './errors.ts';

const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const COMPLETION_USAGE = `Usage: adr completion <shell>

Write a deterministic shell completion script to stdout.
The generated script registers both the \`adr\` and \`adrkit\` binaries where the shell format permits.

Arguments:
  <shell>         Completion shell: bash|zsh|fish

Options:
  -h, --help      Show this help and exit

Examples:
  adr completion bash
  adr completion zsh > ~/.zsh/completions/_adr
  adr completion fish > ~/.config/fish/completions/adr.fish

Exit codes: 0 = script emitted; 2 = usage error (missing or unsupported shell).
`;

function usageError(message: string): number {
  process.stderr.write(formatUsageError(message, COMPLETION_USAGE, 'completion'));
  return 2;
}

function formatChoiceList(values: readonly string[]): string {
  if (values.length === 1) return `"${values[0]}"`;
  if (values.length === 2) return `"${values[0]}" or "${values[1]}"`;
  return `${values.slice(0, -1).map((value) => `"${value}"`).join(', ')}, or "${values[values.length - 1]}"`;
}

function shellWords(values: readonly string[]): string {
  return values.join(' ');
}

function unknownOptionMessage(option: string): string {
  const suggestion = closestCandidate(option, ['--help']);
  return suggestion ? `Unknown option "${option}". Did you mean "${suggestion}"?` : `Unknown option "${option}".`;
}

function unknownShellMessage(shell: string): string {
  const suggestion = closestCandidate(shell, COMPLETION_SHELLS);
  const expected = formatChoiceList(COMPLETION_SHELLS);
  return suggestion
    ? `Invalid shell "${shell}". Did you mean "${suggestion}"? Expected ${expected}.`
    : `Invalid shell "${shell}". Expected ${expected}.`;
}

type ParsedArgs =
  | { ok: true; help: boolean; shell?: string }
  | { ok: false; unknown: string }
  | { ok: false; positional: string }
  | { ok: false; missing: true };

function parseFlags(args: string[]): ParsedArgs {
  let shell: string | undefined;
  let help = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg.startsWith('-')) return { ok: false, unknown: arg };
    if (shell !== undefined) return { ok: false, positional: arg };
    shell = arg;
  }

  if (!help && shell === undefined) return { ok: false, missing: true };
  return { ok: true, help, shell };
}

function renderBashWordHelper(): string {
  return `__adr_complete_words() {
  local prefix=$1
  shift
  COMPREPLY=( $(compgen -W "$*" -- "$prefix") )
}

__adr_complete_prefixed_words() {
  local prefix=$1
  local value_prefix=$2
  shift 2
  COMPREPLY=()
  local candidate
  for candidate in "$@"; do
    [[ $candidate == "$value_prefix"* ]] && COMPREPLY+=("\${prefix}\${candidate}")
  done
}
`;
}

function renderZshWordHelper(): string {
  return `__adr_complete_words() {
  local prefix=$1
  shift
  local -a matches=()
  local candidate
  for candidate in "$@"; do
    [[ $candidate == "$prefix"* ]] && matches+=("$candidate")
  done
  if (( \${#matches[@]} )); then
    compadd -Q -- "\${matches[@]}"
  fi
}

__adr_complete_prefixed_words() {
  local prefix=$1
  local value_prefix=$2
  shift 2
  local -a matches=()
  local candidate
  for candidate in "$@"; do
    [[ $candidate == "$value_prefix"* ]] && matches+=("\${prefix}\${candidate}")
  done
  if (( \${#matches[@]} )); then
    compadd -Q -- "\${matches[@]}"
  fi
}
`;
}

function renderBashValueBranch(flag: string, choices: readonly string[]): string {
  return `      if [[ $cur == ${flag}=* ]]; then
        local value_prefix="\${cur#${flag}=}"
        __adr_complete_prefixed_words "${flag}=" "$value_prefix" ${shellWords(choices)}
        return 0
      fi
      if [[ $prev == ${flag} ]]; then
        __adr_complete_words "$cur" ${shellWords(choices)}
        return 0
      fi
`;
}

function renderZshValueBranch(flag: string, choices: readonly string[]): string {
  return `      if [[ $cur == ${flag}=* ]]; then
        local value_prefix="\${cur#${flag}=}"
        __adr_complete_prefixed_words "${flag}=" "$value_prefix" ${shellWords(choices)}
        return 0
      fi
      if [[ $prev == ${flag} ]]; then
        __adr_complete_words "$cur" ${shellWords(choices)}
        return 0
      fi
`;
}

function renderCommandBranch(shell: 'bash' | 'zsh', command: string): string {
  const options = commandCompletionOptions(command as never);
  const valueChoices = commandValueChoiceMap(command as never) ?? {};
  const positionalChoices = commandPositionalChoices(command as never);
  const valueBranch =
    shell === 'bash'
      ? Object.entries(valueChoices).map(([flag, choices]) => renderBashValueBranch(flag, choices)).join('')
      : Object.entries(valueChoices).map(([flag, choices]) => renderZshValueBranch(flag, choices)).join('');
  const optionHelper = shell === 'bash' ? '__adr_complete_words' : '__adr_complete_words';
  const firstPositional =
    command === 'help'
      ? COMMAND_ORDER
      : command === 'completion'
        ? COMPLETION_SHELLS
        : positionalChoices;
  const firstPositionalBlock = firstPositional
    ? shell === 'bash'
      ? `      if [[ $COMP_CWORD -eq 2 ]]; then
        if [[ $cur == -* ]]; then
          ${optionHelper} "$cur" -h --help
        else
          ${optionHelper} "$cur" ${shellWords(firstPositional)}
        fi
        return 0
      fi
`
      : `      if (( CURRENT == 3 )); then
        if [[ $cur == -* ]]; then
          ${optionHelper} "$cur" -h --help
        else
          ${optionHelper} "$cur" ${shellWords(firstPositional)}
        fi
        return 0
      fi
`
    : '';

  if (command === 'help' || command === 'completion') {
    return `    ${command})
${valueBranch}${firstPositionalBlock}      return 0
      ;;
`;
  }

  return `    ${command})
${valueBranch}${firstPositionalBlock}      if [[ -z $cur || $cur == -* ]]; then
        ${optionHelper} "$cur" ${shellWords(options)}
        return 0
      fi
      ;;
`;
}

function renderBashCompletion(): string {
  const rootCandidates = [...TOP_LEVEL_COMPLETION_OPTIONS, ...COMMAND_ORDER];
  const commandBranches = COMMAND_ORDER.map((command) => renderCommandBranch('bash', command)).join('');

  return `# shellcheck shell=bash
${renderBashWordHelper()}
_adr_completion() {
  local cur prev command
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"

  if [[ $COMP_CWORD -le 1 ]]; then
    __adr_complete_words "$cur" ${shellWords(rootCandidates)}
    return 0
  fi

  case "$command" in
${commandBranches}  esac
}

complete -F _adr_completion adr adrkit
`;
}

function renderZshCompletion(): string {
  const rootCandidates = [...TOP_LEVEL_COMPLETION_OPTIONS, ...COMMAND_ORDER];
  const commandBranches = COMMAND_ORDER.map((command) => renderCommandBranch('zsh', command)).join('');

  return `#compdef adr adrkit
${renderZshWordHelper()}
_adr_completion() {
  emulate -L zsh
  setopt localoptions noshwordsplit
  local cur prev command
  cur="\${words[CURRENT]}"
  prev="\${words[CURRENT-1]}"
  command="\${words[2]}"

  if (( CURRENT <= 2 )); then
    __adr_complete_words "$cur" ${shellWords(rootCandidates)}
    return 0
  fi

  case "$command" in
${commandBranches}  esac
}

compdef _adr_completion adr adrkit
`;
}

function renderFishCompletion(): string {
  const lines: string[] = [];
  const binaryTargets = '-c adr -c adrkit';
  const rootCandidates = [...TOP_LEVEL_COMPLETION_OPTIONS, ...COMMAND_ORDER];

  lines.push(`function __adr_root_position`);
  lines.push(`    set -l tokens (commandline -opc)`);
  lines.push(`    test (count $tokens) -eq 1`);
  lines.push(`end`);
  lines.push(``);
  lines.push(`function __adr_subcommand_is`);
  lines.push(`    set -l tokens (commandline -opc)`);
  lines.push(`    test (count $tokens) -ge 2; and test "$tokens[2]" = "$argv[1]"`);
  lines.push(`end`);
  lines.push(``);
  lines.push(`function __adr_first_positional`);
  lines.push(`    set -l tokens (commandline -opc)`);
  lines.push(`    test (count $tokens) -eq 2`);
  lines.push(`end`);
  lines.push(``);
  lines.push(`function __adr_current_token_is_option`);
  lines.push(`    set -l token (commandline -ct)`);
  lines.push(`    test -n "$token"; and test (string sub -s 1 -l 1 -- $token) = '-'`);
  lines.push(`end`);
  lines.push(``);
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -f -a "${shellWords(rootCandidates)}"`);
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -s h -l help -d 'Show help'`);
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -s V -l version -d 'Show version'`);

  for (const command of COMMAND_ORDER) {
    const options = commandCompletionOptions(command as never).filter((option) => option !== '-h' && option !== '--help');
    const valueChoices = commandValueChoiceMap(command as never) ?? {};
    const guard = `__adr_subcommand_is ${command}`;

    if (command === 'help' || command === 'completion') {
      const firstChoices = command === 'help' ? COMMAND_ORDER : COMPLETION_SHELLS;
      lines.push(`complete ${binaryTargets} -n '${guard}; and __adr_first_positional; and not __adr_current_token_is_option' -f -a "${shellWords(firstChoices)}"`);
      lines.push(`complete ${binaryTargets} -n '${guard}; and __adr_first_positional' -s h -l help -d 'Show help'`);
      continue;
    }

    lines.push(`complete ${binaryTargets} -n '${guard}' -s h -l help -d 'Show help'`);
    lines.push(`complete ${binaryTargets} -n '${guard}' -f -a "${shellWords(options)}"`);

    for (const [flag, choices] of Object.entries(valueChoices)) {
      lines.push(`complete ${binaryTargets} -n '${guard}' -r -l ${flag.slice(2)} -a "${shellWords(choices)}"`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderCompletionScript(shell: CompletionShell): string {
  if (shell === 'bash') return renderBashCompletion();
  if (shell === 'zsh') return renderZshCompletion();
  return renderFishCompletion();
}

function parseCompletionArgs(args: string[]): ParsedArgs {
  const parsed = parseFlags(args);
  if (!parsed.ok) return parsed;
  if (parsed.help) return parsed;
  if (parsed.shell === undefined) return { ok: false, missing: true };
  return parsed;
}

export async function runCompletion(args: string[]): Promise<number> {
  const parsed = parseCompletionArgs(args);
  if (!parsed.ok) {
    if ('missing' in parsed) return usageError('adr completion requires exactly one shell: bash, zsh, or fish.');
    if ('positional' in parsed) return usageError(`Positional argument "${parsed.positional}" is not supported. Use adr completion <shell>.`);
    return usageError(unknownOptionMessage(parsed.unknown));
  }

  if (parsed.help) {
    process.stdout.write(COMPLETION_USAGE);
    return 0;
  }

  if (parsed.shell === undefined) {
    return usageError('adr completion requires exactly one shell: bash, zsh, or fish.');
  }

  if (!COMPLETION_SHELLS.includes(parsed.shell as CompletionShell)) {
    return usageError(unknownShellMessage(parsed.shell));
  }

  process.stdout.write(renderCompletionScript(parsed.shell as CompletionShell));
  return 0;
}
