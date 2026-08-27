#!/usr/bin/env node

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { readdir } from 'node:fs/promises';
import {
  buildAdrGraph,
  bucketDecisions,
  checkChanges,
  countFindings,
  createAdr,
  exitCodeForFindings,
  filterAdrGraph,
  lintCorpus,
  MARKER_DECLARATION_FILE_CAP,
  MARKER_HEADER_WINDOW_BYTES,
  mergeSourceDeclarations,
  migrateMadr,
  readSourceMarkers,
  readSourceMarkersBatch,
  resolveAffects,
  resolveSourceMarkers,
  renderDotGraph,
  renderJsonGraph,
  renderMermaidGraph,
  ScaffoldError,
  sortFindings,
  toGoverningDecisions,
  type ExplainedDecision,
  type Finding,
  type SourceMarkerBatchScan,
  type SourceMarkerScan,
} from '@adrkit/core';
import { evaluate } from './evaluate.ts';
import { renderTerminalGraph, resolveGraphFormat } from './graph.ts';
import { closestCandidate } from './recovery.ts';
import {
  COMMAND_ORDER,
  GLOBAL_COLOR_VALUES,
  TOP_LEVEL_OPTIONS,
  commandOptions,
  isGraphFormat,
  isGraphKind,
  renderGlobalColorUsageLine,
  renderTopLevelUsage,
  requiredCommandValueChoices,
  withGlobalColorOption,
  type CommandName,
  type GraphKind,
} from './command-registry.ts';
import { COMPLETION_USAGE, runCompletion } from './completion.ts';
import {
  corpusDirectoryErrorKind,
  corpusDirectoryErrorMessage,
  formatUsageError,
  type CorpusDirectoryErrorKind,
} from './errors.ts';
import { QUEUE_USAGE, runQueue } from './queue.ts';
import { isMainModule } from './main-module.ts';
import { getPresentation, setPresentation, styleUsageBlock, type ColorMode, type StreamStyle } from './presentation.ts';

/**
 * The published `@adrkit/cli` version, reported by `adr --version`. Held as a literal
 * (mirroring `@adrkit/mcp`'s `SERVER_INFO`) so the bundled `dist/index.js` never has
 * to locate `package.json` at runtime. `version.test.ts` asserts the two agree.
 */
export const CLI_VERSION = '0.12.0';

function topLevelUsage(style?: StreamStyle): string {
  return renderTopLevelUsage(CLI_VERSION, style);
}

function writeStdout(text: string): void {
  process.stdout.write(text);
}

function writeStderr(text: string): void {
  process.stderr.write(text);
}

function extractColorMode(argv: string[]): { colorMode: ColorMode; args: string[] } | { error: string } {
  let colorMode: ColorMode = 'auto';
  const args: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') {
      args.push(...argv.slice(index));
      break;
    }
    if (arg !== '--color' && !arg.startsWith('--color=')) {
      args.push(arg);
      continue;
    }

    let value = '';
    if (arg === '--color') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        return { error: 'Missing value for option "--color".' };
      }
      value = next;
      index += 1;
    } else {
      value = arg.slice('--color='.length);
      if (value.length === 0) return { error: 'Missing value for option "--color".' };
    }

    if (!GLOBAL_COLOR_VALUES.includes(value as (typeof GLOBAL_COLOR_VALUES)[number])) {
      return { error: `Invalid --color value "${value}". Expected "auto", "always", or "never".` };
    }
    colorMode = value as ColorMode;
  }

  return { colorMode, args };
}

function extractUnknownOption(message: string): string | undefined {
  const match = /^Unknown option ['"`]([^'"`]+)['"`]/.exec(message);
  return match?.[1];
}

function unknownOptionMessage(option: string, candidates: readonly string[]): string {
  const suggestion = closestCandidate(option, candidates);
  return suggestion ? `Unknown option "${option}". Did you mean "${suggestion}"?` : `Unknown option "${option}".`;
}

function corpusDirectoryUsageError(dir: string, kind: CorpusDirectoryErrorKind, command: string): number {
  return usageError(corpusDirectoryErrorMessage(dir, kind), command);
}

function handleCorpusDirectoryError(error: unknown, dir: string, command: string): number | undefined {
  const kind = corpusDirectoryErrorKind(error, dir);
  return kind ? corpusDirectoryUsageError(dir, kind, command) : undefined;
}

async function ensureCorpusDirectoryReadable(dir: string, command: string): Promise<number | undefined> {
  try {
    await readdir(dir);
    return undefined;
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, command);
    if (exitCode !== undefined) return exitCode;
    throw error;
  }
}

function hasValueFlag(args: readonly string[], flag: string): boolean {
  for (const arg of args) {
    if (arg === '--') return false;
    if (arg === flag || arg.startsWith(`${flag}=`)) return true;
  }
  return false;
}

function hasHelpFlagBeforeTerminator(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === '--') return false;
    if (isHelpFlag(arg)) return true;
  }
  return false;
}

/**
 * Per-command help, printed by `adr <command> --help` and `adr help <command>`.
 * `queue` reuses its own richer usage text so there is a single source for it.
 */
const COMMAND_USAGE = {
  new: `Usage: adr new <title> [options]

Create a decision record with the next available numeric ID.

Arguments:
  <title>             Decision title

Options:
  --status <status>   Initial status: draft|proposed|rejected|deprecated
                      (default: draft)
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path } as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

Examples:
  adr new "Adopt PostgreSQL"
  adr new "Trial a regional cache" --status proposed

Exit codes: 0 = created; 1 = refused to overwrite an existing file; 2 = usage error.
`,
  lint: `Usage: adr lint [paths...] [options]

Validate the ADR corpus. With no paths, every discoverable record under --dir is checked.

Arguments:
  [paths...]      Optional ADR files to validate

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit { checked, findings } as JSON
${renderGlobalColorUsageLine()}
    -h, --help      Show this help and exit

Examples:
  adr lint
  adr lint docs/adr/0012-adopt-postgresql.md
  adr lint --json

Exit codes: 0 = no error findings; 1 = one or more error findings;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  check: `Usage: adr check [files...] [options]

Report the decisions governing changed files and validate changed ADRs.
With no files, the command performs a successful no-op.

Arguments:
  [files...]      Optional repo-relative paths to review

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit the CheckOutcome as JSON
${renderGlobalColorUsageLine()}
  -h, --help      Show this help and exit

Examples:
  adr check src/auth/session.ts package.json
  adr check --json src/auth/session.ts

Exit codes: 0 = ok; 1 = a changed record has an error finding;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  explain: `Usage: adr explain <path> [options]

Report which decisions govern one repo-relative path, and why.

A decision reaches a path in two directions. The record declares an "affects" pattern
that matches it ("via path: src/**"), or the file itself declares the record in a
comment ("declared by src/sync.ts:3 (@adr 0012)"). If <path> exists, at most its first
8192 bytes are scanned for dedicated "@adr <id>" comment lines -- the scan stops at the
last complete line inside that bound, and --json reports the extent it reached. A marker
naming a record the corpus does not have is reported as a dangling-marker warning. A
marker naming a superseded, rejected, or deprecated record is reported as a stale-marker
warning; a resolvable supersession chain names its terminal live successor.

Arguments:
  <path>          Repo-relative path to explain

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit { path, governedBy, governing, activeProposals, history,
                  markers, findings }. Pattern matches carry "firedMatchers";
                  file declarations carry "declaredBy".
${renderGlobalColorUsageLine()}
  -h, --help      Show this help and exit

Examples:
  adr explain src/auth/session.ts
  adr explain --json src/auth/session.ts

Exit codes: 0 = explained; 1 = corpus has error findings;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  graph: `Usage: adr graph [options]

Render supersedes, relatesTo, and conflictsWith relationships for the corpus.

Options:
  --dir <path>          ADR corpus directory (default: docs/adr)
  --format <format>     auto|terminal|dot|json|mermaid (default: auto)
  --focus <id>          Keep one ADR and its directly connected decisions
  --kind <kind>         Keep one relationship kind; repeat to include more
${renderGlobalColorUsageLine()}
  -h, --help            Show this help and exit

Examples:
  adr graph
  adr graph --focus 0014
  adr graph --kind supersedes
  adr graph --format mermaid
  adr graph --format dot > decisions.dot
  adr graph --format json

Exit codes: 0 = rendered without corpus errors; 1 = rendered with corpus errors;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  queue: QUEUE_USAGE,
  evaluate: `Usage: adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [options]

Run the deterministic evaluator over one proposal against an offline snapshot bundle.

Arguments:
  <proposal-path>      Proposed ADR to evaluate

Options:
  --snapshot <path>   Snapshot bundle (required)
  --date <date>       Evaluation date, YYYY-MM-DD (required)
  --dir <path>        ADR corpus directory (default: proposal directory)
  --json              Emit the evaluation report as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

The evaluator routes; it never approves, persists, or writes. There is no --write.

Examples:
  adr evaluate docs/adr/0042-adopt-postgresql.md \\
    --snapshot evidence/bundle.json --date 2026-08-24
  adr evaluate proposals/0042-adopt-postgresql.md --dir docs/adr \\
    --snapshot evidence/bundle.json --date 2026-08-24

Exit codes: 0 = evaluated (including warn/info/inert and escalation);
1 = the proposal was returned on a rubric error; 2 = usage error, unreachable
corpus directory, or malformed snapshot bundle.
`,
  migrate: `Usage: adr migrate --from madr [options]

Import a MADR corpus in place by adding adrkit frontmatter and preserving each body.
Migration is one-way: adrkit does not sync later changes back to MADR.

Options:
  --from madr     Source format (required; only madr is supported)
  --dir <path>    ADR corpus directory (default: docs/adr)
  --dry-run       Report what would change without writing
  --rename        Rename each migrated file to <id>-<slug>.md so corpus discovery
                  can see it. Off by default, because migration is in place.
  --json          Emit the migration result as JSON
${renderGlobalColorUsageLine()}
  -h, --help      Show this help and exit

Examples:
  adr migrate --from madr --dry-run
  adr migrate --from madr --rename

Exit codes: 0 = migration ran (findings are reported but do not fail the run);
2 = usage error (missing or unsupported --from, unknown flag, positional argument,
or unreachable corpus directory).
`,
  help: `Usage: adr help [command]

Show top-level help or detailed help for one command.

Arguments:
  [command]       Optional command to describe

Examples:
  adr help
  adr help check

Options:
${renderGlobalColorUsageLine()}
`,
  completion: COMPLETION_USAGE,
} satisfies Record<CommandName, string>;

const COMMANDS = COMMAND_ORDER;
const LINT_OPTIONS = withGlobalColorOption(commandOptions('lint'));
const MIGRATE_OPTIONS = withGlobalColorOption(commandOptions('migrate'));
const NEW_OPTIONS = withGlobalColorOption(commandOptions('new'));
const GRAPH_OPTIONS = withGlobalColorOption(commandOptions('graph'));
const EXPLAIN_OPTIONS = withGlobalColorOption(commandOptions('explain'));
const CHECK_OPTIONS = withGlobalColorOption(commandOptions('check'));
const EVALUATE_OPTIONS = withGlobalColorOption(commandOptions('evaluate'));
const NEW_ALLOWED_STATUSES = requiredCommandValueChoices('new', '--status');
const GRAPH_FORMAT_CHOICES = requiredCommandValueChoices('graph', '--format');
const GRAPH_KIND_CHOICES = requiredCommandValueChoices('graph', '--kind');
const MIGRATE_FROM_CHOICES = requiredCommandValueChoices('migrate', '--from');

/** Own-property lookup: `adr help constructor` must be a usage error, not a crash. */
function commandUsageFor(command: string): string | undefined {
  return Object.hasOwn(COMMAND_USAGE, command) ? COMMAND_USAGE[command as CommandName] : undefined;
}

/** Usage error: concise guidance on stderr, exit 2. Explicit help goes to stdout at 0. */
function usageError(message: string, command?: string): number {
  writeStderr(formatUsageError(message, command ? commandUsageFor(command) ?? '' : topLevelUsage(getPresentation().stderr), command, getPresentation().stderr));
  return 2;
}

function isHelpFlag(arg: string): boolean {
  return arg === '--help' || arg === '-h';
}

/** `adr help [command]` — usage on stdout at 0; unknown command is still a usage error. */
function runHelp(args: string[]): number {
  const unsupportedFlag = args.find((arg) => arg.startsWith('-') && !isHelpFlag(arg));
  if (unsupportedFlag) return usageError(unknownOptionMessage(unsupportedFlag, withGlobalColorOption(['--help'])));

  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals.length > 1) return usageError('adr help accepts at most one command.');

  const requested = positionals[0];
  if (requested === undefined) {
    writeStdout(topLevelUsage(getPresentation().stdout));
    return 0;
  }

  const commandUsage = commandUsageFor(requested);
  if (!commandUsage) {
    return usageError(unknownCommandMessage(requested));
  }

  writeStdout(styleUsageBlock(commandUsage, getPresentation().stdout));
  return 0;
}

function unknownCommandMessage(command: string): string {
  const suggestion = closestCandidate(command, COMMANDS);
  return suggestion ? `Unknown command "${command}". Did you mean "${suggestion}"?` : `Unknown command "${command}".`;
}

function parseCommandArgs(
  args: string[],
  options: ParseArgsConfig['options'],
  allowedOptions: readonly string[],
): ReturnType<typeof parseArgs> {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unsupported = extractUnknownOption(message);
    if (unsupported) throw new Error(unknownOptionMessage(unsupported, allowedOptions));
    throw error;
  }
}

function renderFinding(finding: Finding, style = getPresentation().stdout): string {
  const field = finding.field ? ` ${finding.field}` : '';
  const id = finding.id ? ` ${finding.id}` : '';
  const pattern = finding.pattern ? ` ${finding.pattern}` : '';
  return `  ${style.severity(finding.severity)} ${style.label(finding.rule)}${id}${field}${pattern}: ${finding.message}\n`;
}

function renderHumanLint(findings: readonly Finding[], style = getPresentation().stdout): string {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = finding.path ?? '(corpus)';
    let list = grouped.get(group);
    if (!list) {
      list = [];
      grouped.set(group, list);
    }
    list.push(finding);
  }

  let output = '';
  for (const [path, groupFindings] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    output += `${style.path(path)}\n`;
    for (const finding of groupFindings) {
      output += renderFinding(finding, style);
    }
  }
  return output;
}

function findingBelongsToRecord(finding: Finding, id: string): boolean {
  if (finding.id === id) return true;
  const fileName = finding.path?.replace(/\\/g, '/').split('/').at(-1);
  return fileName?.startsWith(`${id}-`) === true && fileName.endsWith('.md');
}

async function runLint(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    }, LINT_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'lint');
  }

  const dir = String(parsed.values.dir);
  if (parsed.positionals.length > 0 && hasValueFlag(args, '--dir')) {
    const exitCode = await ensureCorpusDirectoryReadable(dir, 'lint');
    if (exitCode !== undefined) return exitCode;
  }

  let result: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    result = await lintCorpus({
      dir,
      paths: parsed.positionals,
    });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, 'lint');
    if (exitCode !== undefined) return exitCode;
    throw error;
  }
  const findings = sortFindings(result.findings);
  const counts = countFindings(findings);

  if (parsed.values.json) {
    writeStdout(`${JSON.stringify({ checked: result.checked, findings }, null, 2)}\n`);
  } else {
    const humanFindings = renderHumanLint(findings, getPresentation().stderr);
    if (humanFindings) writeStderr(humanFindings);
    writeStdout(
      `${getPresentation().stdout.label('checked')} ${result.checked} records, ${counts.errors} errors, ${counts.warnings} warnings\n`,
    );
  }

  return exitCodeForFindings(findings);
}

function renderHumanMigrate(result: Awaited<ReturnType<typeof migrateMadr>>, style = getPresentation().stdout): string {
  const counts = {
    migrated: 0,
    updated: 0,
    unchanged: 0,
    diverged: 0,
    skipped: 0,
  };

  let output = '';
  for (const item of result.results) {
    counts[item.outcome] += 1;
    const renamed = item.renamedTo ? ` -> ${item.renamedTo}` : '';
    output += `${style.outcome(item.outcome)}  ${style.path(item.path)}${renamed}\n`;
  }

  output += `${style.label('summary:')} migrated ${counts.migrated}, updated ${counts.updated}, unchanged ${counts.unchanged}, diverged ${counts.diverged}, skipped ${counts.skipped}\n`;
  output += `${style.heading('Divergence (report only):')}\n`;
  if (result.divergence.length === 0) {
    output += `  ${style.note('none')}\n`;
  } else {
    for (const item of result.divergence) {
      output += `  ${style.path(item.path)}  ${style.label('sourceRef')}=${item.sourceRef}\n`;
    }
  }

  if (result.findings.length > 0) {
    output += `${style.heading('Findings:')}\n`;
    for (const finding of result.findings) {
      output += renderFinding(finding, style);
    }
  }

  return output;
}

async function runMigrate(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      from: { type: 'string' },
      dir: { type: 'string', default: 'docs/adr' },
      'dry-run': { type: 'boolean', default: false },
      rename: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    }, MIGRATE_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'migrate');
  }

  if (parsed.positionals.length > 0) return usageError('adr migrate does not accept positional arguments.', 'migrate');
  const from = parsed.values.from;
  if (typeof from !== 'string' || !MIGRATE_FROM_CHOICES.includes(from)) {
    const suggestion = typeof from === 'string' ? closestCandidate(from, MIGRATE_FROM_CHOICES) : undefined;
    return usageError(
      from
        ? suggestion
          ? `Unsupported --from value "${String(from)}". Did you mean "${suggestion}"? Only "madr" is available; migration is one-way.`
          : `Unsupported --from value "${String(from)}". Only "madr" is available; migration is one-way.`
        : 'adr migrate requires --from madr.',
      'migrate',
    );
  }

  const dir = String(parsed.values.dir);
  const dirExitCode = await ensureCorpusDirectoryReadable(dir, 'migrate');
  if (dirExitCode !== undefined) return dirExitCode;

  let result: Awaited<ReturnType<typeof migrateMadr>>;
  try {
    result = await migrateMadr({
      dir,
      write: parsed.values['dry-run'] !== true,
      rename: parsed.values.rename === true,
    });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, 'migrate');
    if (exitCode !== undefined) return exitCode;
    throw error;
  }

  if (parsed.values.json) {
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeStdout(renderHumanMigrate(result, getPresentation().stdout));
  }

  return 0;
}

async function runNew(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
      status: { type: 'string', default: 'draft' },
    }, NEW_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'new');
  }

  const title = parsed.positionals.join(' ').trim();
  if (!title) return usageError('adr new requires a title.', 'new');
  const status = String(parsed.values.status);
  const suggestion = closestCandidate(status, NEW_ALLOWED_STATUSES);
  if (suggestion && !NEW_ALLOWED_STATUSES.includes(status as (typeof NEW_ALLOWED_STATUSES)[number])) {
    return usageError(
      `Invalid status "${status}". Did you mean "${suggestion}"?`,
      'new',
    );
  }

  try {
    const result = await createAdr({
      title,
      status,
      dir: String(parsed.values.dir),
    });
    if (parsed.values.json) {
      writeStdout(`${JSON.stringify({ id: result.id, path: result.path }, null, 2)}\n`);
    } else {
      writeStdout(`${getPresentation().stdout.path(result.path)}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      if (error.code === 'usage') return usageError(error.message, 'new');
      writeStderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

async function runGraph(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      dir: { type: 'string', default: 'docs/adr' },
      format: { type: 'string', default: 'auto' },
      focus: { type: 'string' },
      kind: { type: 'string', multiple: true },
    }, GRAPH_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'graph');
  }

  if (parsed.positionals.length > 0) return usageError('adr graph does not accept positional arguments.', 'graph');
  const format = String(parsed.values.format);
  if (!isGraphFormat(format)) {
    const suggestion = closestCandidate(format, GRAPH_FORMAT_CHOICES);
    return usageError(
      suggestion
        ? `adr graph --format must be "auto", "terminal", "dot", "json", or "mermaid". Did you mean "${suggestion}"?`
        : 'adr graph --format must be "auto", "terminal", "dot", "json", or "mermaid".',
      'graph',
    );
  }

  const kinds: GraphKind[] = [];
  for (const rawKind of (Array.isArray(parsed.values.kind) ? parsed.values.kind : []).map(String)) {
    if (isGraphKind(rawKind)) {
      kinds.push(rawKind);
      continue;
    }
    const suggestion = closestCandidate(rawKind, GRAPH_KIND_CHOICES);
    return usageError(
      suggestion
        ? `adr graph --kind must be "supersedes", "relatesTo", or "conflictsWith". Did you mean "${suggestion}"?`
        : 'adr graph --kind must be "supersedes", "relatesTo", or "conflictsWith".',
      'graph',
    );
  }

  const focus = parsed.values.focus === undefined ? undefined : String(parsed.values.focus);
  if (focus === '') {
    return usageError('adr graph --focus requires a non-empty ADR id.', 'graph');
  }

  const dir = String(parsed.values.dir);
  let result: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    result = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, 'graph');
    if (exitCode !== undefined) return exitCode;
    throw error;
  }
  const graph = buildAdrGraph(result.records);
  const errorFindings = result.findings.filter((finding) => finding.severity === 'error');
  if (focus !== undefined && !graph.nodes.some((node) => node.id === focus)) {
    const focusFindings = errorFindings.filter((finding) => findingBelongsToRecord(finding, focus));
    if (focusFindings.length > 0) {
      writeStderr(`ADR "${focus}" exists but is invalid:\n`);
      writeStderr(renderHumanLint(focusFindings, getPresentation().stderr));
      return 1;
    }
    return usageError(`No ADR with id "${focus}" exists in "${dir}".`, 'graph');
  }

  const filtered = filterAdrGraph(graph, {
    focus,
    kinds,
  });
  const resolvedFormat = resolveGraphFormat(format, process.stdout.isTTY === true);
  switch (resolvedFormat) {
    case 'terminal':
      writeStdout(
        renderTerminalGraph(filtered, {
          columns: process.stdout.columns ?? 100,
          focus,
          style: getPresentation().stdout,
        }),
      );
      break;
    case 'dot':
      writeStdout(renderDotGraph(filtered));
      break;
    case 'json':
      writeStdout(renderJsonGraph(filtered));
      break;
    case 'mermaid':
      writeStdout(renderMermaidGraph(filtered));
      break;
  }
  if (errorFindings.length > 0) {
    writeStderr(renderHumanLint(errorFindings, getPresentation().stderr));
    return 1;
  }
  return 0;
}

async function runExplain(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    }, EXPLAIN_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'explain');
  }

  if (parsed.positionals.length !== 1) return usageError('adr explain requires exactly one path.', 'explain');
  const path = parsed.positionals[0];
  if (!path) return usageError('adr explain requires exactly one path.', 'explain');

  const dir = String(parsed.values.dir);
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, 'explain');
    if (exitCode !== undefined) return exitCode;
    throw error;
  }

  // Scanned before the corpus-error gate below so the reported scan state is the same
  // fact either way: what the file says does not depend on whether the corpus parses.
  const scan = await readSourceMarkers(path);

  const corpusFindings = sortFindings(corpus.findings);
  if (exitCodeForFindings(corpusFindings) !== 0) {
    if (parsed.values.json) {
      writeStdout(
        `${JSON.stringify(
          {
            path,
            governedBy: [],
            governing: [],
            activeProposals: [],
            history: [],
            markers: markerScanJson(scan),
            findings: corpusFindings,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      const humanFindings = renderHumanLint(corpusFindings, getPresentation().stderr);
      if (humanFindings) writeStderr(humanFindings);
      writeStdout(renderMarkerScanNote(scan, getPresentation().stdout));
    }
    return 1;
  }

  const resolution = resolveAffects({ records: corpus.records, changedFiles: [path] });
  const markerResolution = resolveSourceMarkers({ records: corpus.records, markers: scan.markers });
  const governedBy = mergeSourceDeclarations(
    toGoverningDecisions(corpus.records, resolution.matches),
    corpus.records,
    markerResolution.matches,
  );
  const buckets = bucketDecisions(governedBy);
  const findings = sortFindings([...resolution.findings, ...markerResolution.findings]);

  if (parsed.values.json) {
    writeStdout(
      `${JSON.stringify({ path, governedBy, ...buckets, markers: markerScanJson(scan), findings }, null, 2)}\n`,
    );
    return 0;
  }

  if (governedBy.length === 0) {
    writeStdout(`${getPresentation().stdout.note('No decision governs')} ${getPresentation().stdout.path(path)}.\n`);
  } else {
    if (buckets.governing.length === 0) {
      writeStdout(`${getPresentation().stdout.note('No accepted decision governs')} ${getPresentation().stdout.path(path)}.\n`);
    } else {
      writeStdout(renderDecisionGroup(`Decisions governing ${path}:`, buckets.governing, '  ', getPresentation().stdout));
    }
    writeStdout(renderDecisionGroup('Active proposals (not yet binding):', buckets.activeProposals, '  ', getPresentation().stdout));
    writeStdout(renderDecisionGroup('Historical records (not binding):', buckets.history, '  ', getPresentation().stdout));
  }

  writeStdout(renderMarkerScanNote(scan, getPresentation().stdout));

  if (findings.length > 0) {
    writeStdout(`${getPresentation().stdout.heading('Findings:')}\n`);
    for (const finding of findings) {
      writeStdout(renderFinding(finding, getPresentation().stdout));
    }
  }

  return 0;
}

function renderDecisionGroup(
  heading: string,
  decisions: readonly ExplainedDecision[],
  indent = '  ',
  style = getPresentation().stdout,
): string {
  if (decisions.length === 0) return '';
  let output = `${style.heading(heading)}\n`;
  for (const decision of decisions) {
    const successor = decision.supersededBy ? ` (superseded by ${decision.supersededBy})` : '';
    output += `${indent}${style.label(decision.recordId)}  [${style.status(decision.status)}] ${decision.title}${successor}\n`;
    // "via" is the record reaching out through its own `affects` pattern; "declared by"
    // is the file reaching in with an `@adr` marker. The two are never merged, because
    // which end made the claim is the whole point (ADR-0021).
    for (const matcher of decision.firedMatchers) {
      output += `${indent}  ${style.note('via')} ${matcher.type}: ${style.path(matcher.pattern)}\n`;
    }
    for (const declaration of decision.declaredBy ?? []) {
      output += `${indent}  ${style.note('declared by')} ${style.path(declaration.path)}:${declaration.line} (@adr ${style.label(declaration.ref)})\n`;
    }
  }
  return output;
}

/**
 * The `markers` block of `adr explain --json`: what was scanned, and what was found.
 *
 * `truncated` says bytes were left unscanned, but not how many — and the window constant
 * does not answer that either, because the scan stops at the last complete line inside it.
 * `scannedBytes` / `fileBytes` report the measurement, so a consumer can size the
 * unscanned remainder and set its own policy instead of inheriting one (#108). Both are
 * omitted for a state that never opened the file, rather than reported as `0`.
 */
function markerScanJson(scan: SourceMarkerScan): {
  state: SourceMarkerScan['state'];
  windowBytes: number;
  scannedBytes?: number;
  fileBytes?: number;
  truncated: boolean;
  declarationLimit: number;
  totalDeclarations: number;
  omittedDeclarations: number;
  declared: Array<{ ref: string; line: number }>;
} {
  const omittedDeclarations = scan.omittedMarkers ?? 0;
  return {
    state: scan.state,
    windowBytes: MARKER_HEADER_WINDOW_BYTES,
    ...(scan.scannedBytes === undefined ? {} : { scannedBytes: scan.scannedBytes }),
    ...(scan.fileBytes === undefined ? {} : { fileBytes: scan.fileBytes }),
    truncated: scan.truncated,
    declarationLimit: MARKER_DECLARATION_FILE_CAP,
    totalDeclarations: scan.markers.length + omittedDeclarations,
    omittedDeclarations,
    declared: scan.markers.map((marker) => ({ ref: marker.ref, line: marker.line })),
  };
}

/**
 * The one line of human output that keeps "this file declares nothing" from reading
 * identically to "I never opened this file" or "I stopped reading before the marker"
 * (ADR-0016). Silent when the whole file was scanned, which is the common case.
 */
function renderMarkerScanNote(scan: SourceMarkerScan, style = getPresentation().stdout): string {
  if (scan.state === 'absent') {
    return `${style.note('Note:')} ${style.path(scan.path)} is not a file in this working tree; no @adr markers were scanned.\n`;
  }
  if (scan.state === 'unreadable') {
    return `${style.note('Note:')} ${style.path(scan.path)} could not be read; no @adr markers were scanned.\n`;
  }
  if (scan.state === 'out-of-tree') {
    return `${style.note('Note:')} ${style.path(scan.path)} is not a repo-relative path inside this working tree; no @adr markers were scanned.\n`;
  }
  let output = '';
  if ((scan.omittedMarkers ?? 0) > 0) {
    output += `${style.note('Note:')} retained the first ${MARKER_DECLARATION_FILE_CAP} @adr declarations in ${style.path(scan.path)} and omitted ${scan.omittedMarkers} more.\n`;
  }
  // The measured extent, not the window constant: the scan stops at the last complete
  // line inside the window, so the two differ for almost every real file. Only a scanned
  // state can be truncated, so the extent is present whenever this branch is — the
  // conjunction is how the types say that, not a fallback, which is why there is no
  // window-constant default to reprint if it were ever absent.
  if (scan.truncated && scan.scannedBytes !== undefined && scan.fileBytes !== undefined) {
    output += `${style.note('Note:')} only the first ${scan.scannedBytes} of ${scan.fileBytes} bytes of ${style.path(scan.path)} were scanned for @adr markers.\n`;
  }
  return output;
}

/**
 * Per-path measured extents for `check`'s human warning, keyed by the same normalized
 * path `MarkerScanReport` sorts on.
 *
 * Built from the batch scan the caller already holds rather than from `MarkerScanReport`,
 * which carries paths only. That is the whole reason the asymmetry closes without a
 * contract change: `check --json` stays byte-identical while the human surface stops
 * printing a bound where it can print the measurement (ADR-0024 action item 3).
 */
function markerScanExtents(batch: SourceMarkerBatchScan): Map<string, string> {
  const extents = new Map<string, string>();
  for (const scan of batch.scans) {
    if (!scan.truncated) continue;
    if (scan.scannedBytes === undefined || scan.fileBytes === undefined) continue;
    extents.set(scan.path, `${scan.scannedBytes}/${scan.fileBytes}`);
  }
  return extents;
}

function renderHumanCheck(
  outcome: ReturnType<typeof checkChanges>,
  extents: Map<string, string> = new Map(),
  style = getPresentation().stdout,
): string {
  let output = '';
  if (outcome.governedBy.length === 0) {
    output += `${style.note('No decisions govern the changed files.')}\n`;
  } else {
    if (outcome.governing.length === 0) {
      output += `${style.note('No accepted decisions govern the changed files.')}\n`;
    } else {
      output += renderDecisionGroup('Decisions governing this change:', outcome.governing, '  ', style);
    }
    output += renderDecisionGroup(
      'Active proposals touching this change (not yet binding):',
      outcome.activeProposals,
      '  ',
      style,
    );
    output += renderDecisionGroup(
      'Historical records that once covered this change (not binding):',
      outcome.history,
      '  ',
      style,
    );
  }

  // Silent when there was nothing to scan: `adr check` with no paths would otherwise
  // report an all-zero scan on every run.
  if (outcome.markerScan && outcome.markerScan.totalCandidates > 0) {
    const counts = outcome.markerScan.counts;
    output +=
      `${style.label('marker scan:')} ${counts.scanned} scanned, ${counts.absent} absent, ` +
      `${counts.unreadable} unreadable, ${counts['out-of-tree']} out-of-tree, ` +
      `${counts.truncated} truncated, ${counts.skipped} skipped\n`;
    const declarations = outcome.markerScan.declarations;
    output +=
      `${style.label('marker declarations:')} ${declarations.retained}/${declarations.total} retained, ` +
      `${declarations.omitted} omitted (${declarations.perFileOmitted} per-file, ${declarations.batchOmitted} per-batch)\n`;

    const unavailable = [
      ...outcome.markerScan.absentPaths,
      ...outcome.markerScan.unreadablePaths,
      ...outcome.markerScan.outOfTreePaths,
      ...outcome.markerScan.skippedPaths,
    ];
    if (unavailable.length > 0) {
      const shown = unavailable.slice(0, 10);
      const remaining = unavailable.length - shown.length;
      output += `${style.label('marker scan unavailable for:')} ${shown.map((path) => style.path(path)).join(', ')}`;
      if (remaining > 0) output += `, and ${remaining} more (see --json for the complete lists)`;
      output += '\n';
    }

    if (outcome.markerScan.truncatedPaths.length > 0) {
      const shown = outcome.markerScan.truncatedPaths.slice(0, 10);
      const remaining = outcome.markerScan.truncatedPaths.length - shown.length;
      // The measured extent per path, not the window constant: the scan stops at the last
      // complete line inside the window, so the window is a bound on the extent and was
      // wrong for every over-window file in this repository. `check` can report the
      // measurement without touching `MarkerScanReport` because `runCheck` already holds
      // the batch scan, so `check --json` stays byte-identical (ADR-0024 action item 3).
      // A path whose extent is missing degrades to the bare path rather than to the
      // constant — reprinting the bound is the error this replaced.
      const labelled = shown.map((path) => {
        const extent = extents.get(path);
        return extent === undefined ? style.path(path) : `${style.path(path)} ${extent}`;
      });
      output += `${style.label('marker scan truncated (bytes scanned of total):')} ${labelled.join(', ')}`;
      if (remaining > 0) output += `, and ${remaining} more (see --json for the complete list)`;
      output += '\n';
    }
  }

  if (outcome.findings.length > 0) {
    output += `${style.heading('Findings:')}\n`;
    output += renderHumanLint(outcome.findings, style);
  }

  const changedRecordErrors = outcome.findings.filter(
    (finding) => finding.severity === 'error' && finding.path && outcome.changedRecords.includes(finding.path),
  ).length;
  output += `${style.label('checked:')} ${outcome.governing.length} governing, ${outcome.activeProposals.length} active proposals, ${outcome.history.length} historical, ${outcome.changedRecords.length} changed records, ${changedRecordErrors} changed-record errors\n`;
  return output;
}

async function runCheck(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    }, CHECK_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'check');
  }

  const dir = String(parsed.values.dir);
  let lint: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    lint = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir, 'check');
    if (exitCode !== undefined) return exitCode;
    throw error;
  }
  const markerScans = await readSourceMarkersBatch(parsed.positionals);
  const outcome = checkChanges({ lint, changedFiles: parsed.positionals, dir, markerScans });

  if (parsed.values.json) {
    writeStdout(`${JSON.stringify(outcome, null, 2)}\n`);
  } else {
    writeStdout(renderHumanCheck(outcome, markerScanExtents(markerScans)));
  }

  return outcome.ok ? 0 : 1;
}

async function runEvaluate(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      snapshot: { type: 'string' },
      date: { type: 'string' },
      json: { type: 'boolean', default: false },
      dir: { type: 'string' },
    }, EVALUATE_OPTIONS);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'evaluate');
  }

  if (parsed.positionals.length !== 1) {
    return usageError('adr evaluate requires exactly one proposal path.', 'evaluate');
  }
  const proposalPath = parsed.positionals[0];
  if (!proposalPath) return usageError('adr evaluate requires a proposal path.', 'evaluate');
  const snapshot = parsed.values.snapshot;
  if (typeof snapshot !== 'string' || snapshot.length === 0) {
    return usageError('adr evaluate requires --snapshot <bundle.json>.', 'evaluate');
  }
  const date = parsed.values.date;
  if (typeof date !== 'string' || date.length === 0) {
    return usageError('adr evaluate requires --date YYYY-MM-DD.', 'evaluate');
  }

  const result = await evaluate({
    proposalPath,
    snapshotPath: snapshot,
    date,
    json: parsed.values.json === true,
    ...(typeof parsed.values.dir === 'string' ? { dir: parsed.values.dir } : {}),
  });
  if (result.corpusDirectoryError) {
    return usageError(
      corpusDirectoryErrorMessage(result.corpusDirectoryError.dir, result.corpusDirectoryError.kind),
      'evaluate',
    );
  }
  if (result.stderr) writeStderr(result.stderr);
  if (result.stdout) writeStdout(result.stdout);
  return result.exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const color = extractColorMode(argv);
  if ('error' in color) {
    writeStderr(formatUsageError(color.error, topLevelUsage(getPresentation().stderr), undefined, getPresentation().stderr));
    return 2;
  }
  setPresentation({ colorMode: color.colorMode });

  const [command, ...args] = color.args;

  try {
    if (command === undefined) {
      writeStdout(topLevelUsage(getPresentation().stdout));
      return 0;
    }
    if (command === 'help') return runHelp(args);
    if (isHelpFlag(command)) return runHelp(args);
    if (command === '--version' || command === '-V') {
      writeStdout(`${CLI_VERSION}\n`);
      return 0;
    }
    if (command.startsWith('-')) return usageError(unknownOptionMessage(command, TOP_LEVEL_OPTIONS));

    // `adr <command> --help` prints that command's usage to stdout at 0. `queue`
    // and `completion` parse `--help` themselves, so they are excluded here to keep
    // one code path for each.
    const commandUsage = command === 'queue' || command === 'completion' ? undefined : commandUsageFor(command);
    if (commandUsage && hasHelpFlagBeforeTerminator(args)) {
      writeStdout(styleUsageBlock(commandUsage, getPresentation().stdout));
      return 0;
    }

    if (command === 'lint') return await runLint(args);
    if (command === 'migrate') return await runMigrate(args);
    if (command === 'new') return await runNew(args);
    if (command === 'graph') return await runGraph(args);
    if (command === 'explain') return await runExplain(args);
    if (command === 'check') return await runCheck(args);
    if (command === 'evaluate') return await runEvaluate(args);
    if (command === 'queue') return await runQueue(args);
    if (command === 'completion') return await runCompletion(args);
    return usageError(unknownCommandMessage(command));
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
