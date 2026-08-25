#!/usr/bin/env node

import { closestCandidate } from './recovery.ts';
import {
  COMMAND_ORDER,
  GLOBAL_COLOR_VALUES,
  TOP_LEVEL_COMPLETION_OPTIONS,
  TOP_LEVEL_COMPLETION_VALUE_CHOICES,
  commandCompletionOptions,
  commandPositionalChoices,
  commandValueChoiceMap,
  renderGlobalColorUsageLine,
  withGlobalColorOption,
} from './command-registry.ts';
import { formatUsageError } from './errors.ts';
import { getPresentation, styleUsageBlock } from './presentation.ts';

const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const COMPLETION_USAGE = `Usage: adr completion <shell>

Write a deterministic shell completion script to stdout.
The generated script registers both the \`adr\` and \`adrkit\` binaries where the shell format permits.

Arguments:
  <shell>         Completion shell: bash|zsh|fish

Options:
  -h, --help      Show this help and exit
${renderGlobalColorUsageLine()}

Examples:
  adr completion bash
  adr completion zsh > ~/.zsh/completions/_adr
  adr completion fish > ~/.config/fish/completions/adr.fish

Exit codes: 0 = script emitted; 2 = usage error (missing or unsupported shell).
`;

function usageError(message: string): number {
  process.stderr.write(formatUsageError(message, COMPLETION_USAGE, 'completion', getPresentation().stderr));
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
  const suggestion = closestCandidate(option, withGlobalColorOption(['--help']));
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

function renderBashScanHelpers(): string {
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

__adr_after_terminator() {
  local i=1 token
  while (( i < COMP_CWORD )); do
    token="\${COMP_WORDS[i]}"
    case "$token" in
      --)
        return 0
        ;;
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
    esac
    (( i += 1 ))
  done
  return 1
}

__adr_command_index() {
  local i=1 token
  while (( i < COMP_CWORD )); do
    token="\${COMP_WORDS[i]}"
    case "$token" in
      --)
        return 1
        ;;
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
    esac
    if [[ $token != -* ]]; then
      printf '%s' "$i"
      return 0
    fi
    return 1
  done
  return 1
}

__adr_first_positional() {
  local i=1 token command_seen=0 positionals=0
  while (( i < COMP_CWORD )); do
    token="\${COMP_WORDS[i]}"
    case "$token" in
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
      --)
        if (( command_seen == 0 )); then
          return 1
        fi
        (( i += 1 ))
        continue
        ;;
    esac
    if [[ $token != -* ]]; then
      if (( command_seen == 0 )); then
        command_seen=1
      else
        (( positionals += 1 ))
      fi
    fi
    (( i += 1 ))
  done
  (( command_seen == 1 && positionals == 0 ))
}
`;
}

function renderZshScanHelpers(): string {
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

__adr_after_terminator() {
  local i=2 token
  while (( i < CURRENT )); do
    token="\${words[i]}"
    case "$token" in
      --)
        return 0
        ;;
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
    esac
    (( i += 1 ))
  done
  return 1
}

__adr_command_index() {
  local i=2 token
  while (( i < CURRENT )); do
    token="\${words[i]}"
    case "$token" in
      --)
        return 1
        ;;
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
    esac
    if [[ $token != -* ]]; then
      printf '%s' "$i"
      return 0
    fi
    return 1
  done
  return 1
}

__adr_first_positional() {
  local i=2 token command_seen=0 positionals=0
  while (( i < CURRENT )); do
    token="\${words[i]}"
    case "$token" in
      --color)
        (( i += 2 ))
        continue
        ;;
      --color=*)
        (( i += 1 ))
        continue
        ;;
      -h|--help|-V|--version)
        (( i += 1 ))
        continue
        ;;
      --)
        if (( command_seen == 0 )); then
          return 1
        fi
        (( i += 1 ))
        continue
        ;;
    esac
    if [[ $token != -* ]]; then
      if (( command_seen == 0 )); then
        command_seen=1
      else
        (( positionals += 1 ))
      fi
    fi
    (( i += 1 ))
  done
  (( command_seen == 1 && positionals == 0 ))
}
`;
}

function renderFishScanHelpers(): string {
  return [
    `function __adr_tokens_before_cursor`,
    `    set -l tokens (commandline -opc)`,
    `    set -l current (commandline -ct)`,
    `    if test -n "$current"`,
    `        if test (count $tokens) -gt 0; and test "$tokens[(count $tokens)]" = "$current"`,
    `            set -e tokens[(count $tokens)]`,
    `        end`,
    `    end`,
    `    printf '%s\n' $tokens`,
    `end`,
    ``,
    `function __adr_after_terminator`,
    `    if test (commandline -ct) = '--'`,
    `        return 0`,
    `    end`,
    ``,
    `    set -l tokens (__adr_tokens_before_cursor)`,
    `    set -l i 2`,
    `    while test $i -le (count $tokens)`,
    `        switch $tokens[$i]`,
    `            case '--'`,
    `                return 0`,
    `            case '--color'`,
    `                set i (math $i + 2)`,
    `                continue`,
    `            case '--color=*'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '-h' '--help' '-V' '--version'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '*'`,
    `                set i (math $i + 1)`,
    `        end`,
    `    end`,
    `    return 1`,
    `end`,
    ``,
    `function __adr_command_token`,
    `    set -l tokens (__adr_tokens_before_cursor)`,
    `    set -l i 2`,
    `    while test $i -le (count $tokens)`,
    `        switch $tokens[$i]`,
    `            case '--'`,
    `                return 1`,
    `            case '--color'`,
    `                set i (math $i + 2)`,
    `                continue`,
    `            case '--color=*'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '-h' '--help' '-V' '--version'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '*'`,
    `                if not string match -q -r '^-' -- $tokens[$i]`,
    `                    echo $tokens[$i]`,
    `                    return 0`,
    `                end`,
    `                return 1`,
    `        end`,
    `    end`,
    `    return 1`,
    `end`,
    ``,
    `function __adr_root_position`,
    `    __adr_color_value; and return 1`,
    `    __adr_after_terminator; and return 1`,
    `    set -l command (__adr_command_token)`,
    `    test -z "$command"`,
    `end`,
    ``,
    `function __adr_subcommand_is`,
    `    set -l command (__adr_command_token)`,
    `    test -n "$command"; and test "$command" = "$argv[1]"`,
    `end`,
    ``,
    `function __adr_color_value`,
    `    __adr_after_terminator; and return 1`,
    `    set -l current (commandline -ct)`,
    `    if string match -q -- '--color=*' "$current"`,
    `        return 0`,
    `    end`,
    `    set -l tokens (__adr_tokens_before_cursor)`,
    `    if test (count $tokens) -gt 0; and test "$tokens[(count $tokens)]" = '--color'`,
    `        return 0`,
    `    end`,
    `    return 1`,
    `end`,
    ``,
    `function __adr_first_positional`,
    `    set -l tokens (__adr_tokens_before_cursor)`,
    `    set -l i 2`,
    `    set -l command_seen 0`,
    `    set -l positionals 0`,
    `    while test $i -le (count $tokens)`,
    `        switch $tokens[$i]`,
    `            case '--color'`,
    `                set i (math $i + 2)`,
    `                continue`,
    `            case '--color=*'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '-h' '--help' '-V' '--version'`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '--'`,
    `                if test $command_seen -eq 0`,
    `                    return 1`,
    `                end`,
    `                set i (math $i + 1)`,
    `                continue`,
    `            case '*'`,
    `                if not string match -q -r '^-' -- $tokens[$i]`,
    `                    if test $command_seen -eq 0`,
    `                        set command_seen 1`,
    `                    else`,
    `                        set positionals (math $positionals + 1)`,
    `                    end`,
    `                end`,
    `                set i (math $i + 1)`,
    `        end`,
    `    end`,
    `    test $command_seen -eq 1; and test $positionals -eq 0`,
    `end`,
    ``,
    `function __adr_current_token_is_option`,
    `    set -l token (commandline -ct)`,
    `    test -n "$token"; and test (string sub -s 1 -l 1 -- $token) = '-'`,
    `end`,
    ``,
  ].join('\n');
}

function renderValueBranches(shell: 'bash' | 'zsh', values: Record<string, readonly string[]>): string {
  return Object.entries(values)
    .map(([flag, choices]) => (shell === 'bash' ? renderBashValueBranch(flag, choices) : renderZshValueBranch(flag, choices)))
    .join('');
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
  const options = withGlobalColorOption(commandCompletionOptions(command as never));
  const valueChoices = commandValueChoiceMap(command as never) ?? {};
  const positionalChoices = commandPositionalChoices(command as never);
  const valueBranch = renderValueBranches(shell, valueChoices);
  const optionHelper = '__adr_complete_words';
  const positionalChoicesForCommand =
    command === 'help'
      ? COMMAND_ORDER
      : command === 'completion'
        ? COMPLETION_SHELLS
        : positionalChoices;
  const positionalBranch = positionalChoicesForCommand
    ? shell === 'bash'
      ? `      if __adr_first_positional; then
        if [[ $cur == -* ]]; then
          ${optionHelper} "$cur" ${shellWords(options)}
        else
          ${optionHelper} "$cur" ${shellWords(positionalChoicesForCommand)}
        fi
        return 0
      fi
`
      : `      if __adr_first_positional; then
        if [[ $cur == -* ]]; then
          ${optionHelper} "$cur" ${shellWords(options)}
        else
          ${optionHelper} "$cur" ${shellWords(positionalChoicesForCommand)}
        fi
        return 0
      fi
`
    : '';
  const lateOptionBranch =
    command === 'help' || command === 'completion'
      ? `      if [[ -z $cur || $cur == -* ]]; then
        ${optionHelper} "$cur" ${shellWords(options)}
        return 0
      fi
`
      : '';

  if (command === 'help' || command === 'completion') {
    return `    ${command})
      if [[ $cur == -- || $after_terminator -eq 1 ]]; then
        return 0
      fi
${valueBranch}${positionalBranch}${lateOptionBranch}      return 0
      ;;
`;
  }

  return `    ${command})
      if [[ $cur == -- || $after_terminator -eq 1 ]]; then
        return 0
      fi
${valueBranch}${positionalBranch}      if [[ -z $cur || $cur == -* ]]; then
        ${optionHelper} "$cur" ${shellWords(options)}
        return 0
      fi
      ;;
`;
}

function renderBashCompletion(): string {
  const rootCandidates = [...TOP_LEVEL_COMPLETION_OPTIONS, ...COMMAND_ORDER];
  const rootValueBranches = renderValueBranches('bash', TOP_LEVEL_COMPLETION_VALUE_CHOICES);
  const commandBranches = COMMAND_ORDER.map((command) => renderCommandBranch('bash', command)).join('');

  return `# shellcheck shell=bash
${renderBashScanHelpers()}
_adr_completion() {
  local cur prev command_index after_terminator command
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if __adr_after_terminator; then
    after_terminator=1
  else
    after_terminator=0
  fi

  if [[ $after_terminator -eq 0 ]]; then
${rootValueBranches}  fi

  if [[ $cur == -- || $after_terminator -eq 1 ]]; then
    return 0
  fi

  command_index="$(__adr_command_index)"
  if [[ -z $command_index ]]; then
    command_index=0
  fi

  if [[ $command_index -eq 0 ]]; then
    if [[ $after_terminator -eq 0 ]]; then
      __adr_complete_words "$cur" ${shellWords(rootCandidates)}
    fi
    return 0
  fi

  command="\${COMP_WORDS[command_index]}"

  case "$command" in
${commandBranches}  esac
}

complete -F _adr_completion adr adrkit
`;
}

function renderZshCompletion(): string {
  const rootCandidates = [...TOP_LEVEL_COMPLETION_OPTIONS, ...COMMAND_ORDER];
  const rootValueBranches = renderValueBranches('zsh', TOP_LEVEL_COMPLETION_VALUE_CHOICES);
  const commandBranches = COMMAND_ORDER.map((command) => renderCommandBranch('zsh', command)).join('');

  return `#compdef adr adrkit
${renderZshScanHelpers()}
_adr_completion() {
  emulate -L zsh
  setopt localoptions noshwordsplit
  local cur prev command_index after_terminator command
  cur="\${words[CURRENT]}"
  prev="\${words[CURRENT-1]}"

  if __adr_after_terminator; then
    after_terminator=1
  else
    after_terminator=0
  fi

  if [[ $after_terminator -eq 0 ]]; then
${rootValueBranches}  fi

  if [[ $cur == -- || $after_terminator -eq 1 ]]; then
    return 0
  fi

  command_index="$(__adr_command_index)"
  if [[ -z $command_index ]]; then
    command_index=0
  fi

  if [[ $command_index -eq 0 ]]; then
    if [[ $after_terminator -eq 0 ]]; then
      __adr_complete_words "$cur" ${shellWords(rootCandidates)}
    fi
    return 0
  fi

  command="\${words[command_index]}"

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

  lines.push(renderFishScanHelpers());
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -f -a "${shellWords(rootCandidates)}"`);
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -s h -l help -d 'Show help'`);
  lines.push(`complete ${binaryTargets} -n '__adr_root_position' -s V -l version -d 'Show version'`);
  lines.push(`complete ${binaryTargets} -n '__adr_color_value' -r -l color -a "${shellWords(GLOBAL_COLOR_VALUES)}"`);

  for (const command of COMMAND_ORDER) {
    const options = withGlobalColorOption(commandCompletionOptions(command as never).filter((option) => option !== '-h' && option !== '--help'));
    const valueChoices = commandValueChoiceMap(command as never) ?? {};
    const guard = `__adr_subcommand_is ${command}`;

    if (command === 'help' || command === 'completion') {
      const firstChoices = command === 'help' ? COMMAND_ORDER : COMPLETION_SHELLS;
      lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator; and __adr_first_positional; and not __adr_current_token_is_option' -f -a "${shellWords(firstChoices)}"`);
      lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator; and not __adr_first_positional' -f -a "${shellWords(options)}"`);
      lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator; and __adr_first_positional; and __adr_current_token_is_option' -l color -d 'Colorize output'`);
      lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator; and __adr_first_positional' -s h -l help -d 'Show help'`);
      continue;
    }

    lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator' -s h -l help -d 'Show help'`);
    lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator' -f -a "${shellWords(options)}"`);

    for (const [flag, choices] of Object.entries(valueChoices)) {
      lines.push(`complete ${binaryTargets} -n '${guard}; and not __adr_color_value; and not __adr_after_terminator' -r -l ${flag.slice(2)} -a "${shellWords(choices)}"`);
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
    process.stdout.write(styleUsageBlock(COMPLETION_USAGE, getPresentation().stdout));
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
