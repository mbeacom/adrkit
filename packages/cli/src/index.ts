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
  lintCorpus,
  MARKER_HEADER_WINDOW_BYTES,
  mergeSourceDeclarations,
  migrateMadr,
  readSourceMarkers,
  readSourceMarkersBatch,
  resolveAffects,
  resolveSourceMarkers,
  renderDotGraph,
  renderJsonGraph,
  ScaffoldError,
  sortFindings,
  toGoverningDecisions,
  type ExplainedDecision,
  type Finding,
  type SourceMarkerBatchScan,
  type SourceMarkerScan,
} from '@adrkit/core';
import { evaluate } from './evaluate.ts';
import {
  corpusDirectoryErrorKind,
  corpusDirectoryErrorMessage,
  formatUsageError,
  type CorpusDirectoryErrorKind,
} from './errors.ts';
import { QUEUE_USAGE, runQueue } from './queue.ts';
import { isMainModule } from './main-module.ts';

/**
 * The published `@adrkit/cli` version, reported by `adr --version`. Held as a literal
 * (mirroring `@adrkit/mcp`'s `SERVER_INFO`) so the bundled `dist/index.js` never has
 * to locate `package.json` at runtime. `version.test.ts` asserts the two agree.
 */
export const CLI_VERSION = '0.9.0';

function writeStdout(text: string): void {
  process.stdout.write(text);
}

function writeStderr(text: string): void {
  process.stderr.write(text);
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

const USAGE = `adrkit ${CLI_VERSION}
Decision memory for human- and agent-authored plans.

Usage:
  adr <command> [options]

Commands:
  new       Create a decision record
  lint      Validate ADR files and corpus rules
  check     Review changed files against governing decisions
  explain   Explain which decisions govern a path
  graph     Render decision relationships
  queue     Show the architecture review board queue
  evaluate  Evaluate a proposal from an offline snapshot
  migrate   Import a MADR corpus into adrkit
  help      Show help for a command

Options:
  -h, --help       Show help
  -V, --version    Show version

Examples:
  adr new "Adopt PostgreSQL"
  adr lint
  adr explain src/auth/session.ts
  adr check src/auth/session.ts package.json

Run 'adr help <command>' for command-specific options and examples.
Documentation: https://adrkit.dev/commands/
`;

/**
 * Per-command help, printed by `adr <command> --help` and `adr help <command>`.
 * `queue` reuses its own richer usage text so there is a single source for it.
 */
const COMMAND_USAGE: Record<string, string> = {
  new: `Usage: adr new <title> [options]

Create a decision record with the next available numeric ID.

Arguments:
  <title>             Decision title

Options:
  --status <status>   Initial status: draft|proposed|rejected|deprecated
                      (default: draft)
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path } as JSON
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
naming a record the corpus does not have is reported as a dangling-marker warning.

Arguments:
  <path>          Repo-relative path to explain

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit { path, governedBy, governing, activeProposals, history,
                  markers, findings }. Pattern matches carry "firedMatchers";
                  file declarations carry "declaredBy".
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
  --format dot|json     Output format (default: dot)
  -h, --help            Show this help and exit

Examples:
  adr graph > decisions.dot
  adr graph --format json

Exit codes: 0 = rendered; 2 = usage error (invalid invocation or unreachable corpus directory).
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
`,
};

const COMMANDS = Object.keys(COMMAND_USAGE);

/** Own-property lookup: `adr help constructor` must be a usage error, not a crash. */
function commandUsageFor(command: string): string | undefined {
  return Object.hasOwn(COMMAND_USAGE, command) ? COMMAND_USAGE[command] : undefined;
}

/** Usage error: concise guidance on stderr, exit 2. Explicit help goes to stdout at 0. */
function usageError(message: string, command?: string): number {
  writeStderr(formatUsageError(message, command ? commandUsageFor(command) ?? '' : USAGE, command));
  return 2;
}

function isHelpFlag(arg: string): boolean {
  return arg === '--help' || arg === '-h';
}

/** `adr help [command]` — usage on stdout at 0; unknown command is still a usage error. */
function runHelp(args: string[]): number {
  const unsupportedFlag = args.find((arg) => arg.startsWith('-') && !isHelpFlag(arg));
  if (unsupportedFlag) return usageError(`Unknown option "${unsupportedFlag}".`);

  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals.length > 1) return usageError('adr help accepts at most one command.');

  const requested = positionals[0];
  if (requested === undefined) {
    writeStdout(USAGE);
    return 0;
  }

  const commandUsage = commandUsageFor(requested);
  if (!commandUsage) {
    return usageError(unknownCommandMessage(requested));
  }

  writeStdout(commandUsage);
  return 0;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function unknownCommandMessage(command: string): string {
  const suggestion = COMMANDS
    .map((candidate) => ({ candidate, distance: editDistance(command, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))[0];
  const hint = suggestion && suggestion.distance <= 2 ? ` Did you mean "${suggestion.candidate}"?` : '';
  return `Unknown command "${command}".${hint}`;
}

function parseCommandArgs(
  args: string[],
  options: ParseArgsConfig['options'],
): ReturnType<typeof parseArgs> {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function renderFinding(finding: Finding): string {
  const field = finding.field ? ` ${finding.field}` : '';
  const id = finding.id ? ` ${finding.id}` : '';
  const pattern = finding.pattern ? ` ${finding.pattern}` : '';
  return `  ${finding.severity} ${finding.rule}${id}${field}${pattern}: ${finding.message}\n`;
}

function renderHumanLint(findings: readonly Finding[]): string {
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
    output += `${path}\n`;
    for (const finding of groupFindings) {
      output += renderFinding(finding);
    }
  }
  return output;
}

async function runLint(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    });
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
    const humanFindings = renderHumanLint(findings);
    if (humanFindings) writeStderr(humanFindings);
    writeStdout(`checked ${result.checked} records, ${counts.errors} errors, ${counts.warnings} warnings\n`);
  }

  return exitCodeForFindings(findings);
}

function renderHumanMigrate(result: Awaited<ReturnType<typeof migrateMadr>>): string {
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
    output += `${item.outcome}  ${item.path}${renamed}\n`;
  }

  output += `summary: migrated ${counts.migrated}, updated ${counts.updated}, unchanged ${counts.unchanged}, diverged ${counts.diverged}, skipped ${counts.skipped}\n`;
  output += 'Divergence (report only):\n';
  if (result.divergence.length === 0) {
    output += '  none\n';
  } else {
    for (const item of result.divergence) {
      output += `  ${item.path}  sourceRef=${item.sourceRef}\n`;
    }
  }

  if (result.findings.length > 0) {
    output += 'Findings:\n';
    for (const finding of result.findings) {
      output += renderFinding(finding);
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
    });
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'migrate');
  }

  if (parsed.positionals.length > 0) return usageError('adr migrate does not accept positional arguments.', 'migrate');
  const from = parsed.values.from;
  if (from !== 'madr') {
    return usageError(
      from
        ? `Unsupported --from value "${String(from)}". Only "madr" is available; migration is one-way.`
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
    writeStdout(renderHumanMigrate(result));
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
    });
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'new');
  }

  const title = parsed.positionals.join(' ').trim();
  if (!title) return usageError('adr new requires a title.', 'new');

  try {
    const result = await createAdr({
      title,
      status: String(parsed.values.status),
      dir: String(parsed.values.dir),
    });
    if (parsed.values.json) {
      writeStdout(`${JSON.stringify({ id: result.id, path: result.path }, null, 2)}\n`);
    } else {
      writeStdout(`${result.path}\n`);
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
      format: { type: 'string', default: 'dot' },
    });
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), 'graph');
  }

  if (parsed.positionals.length > 0) return usageError('adr graph does not accept positional arguments.', 'graph');
  const format = String(parsed.values.format);
  if (format !== 'dot' && format !== 'json') {
    return usageError('adr graph --format must be "dot" or "json".', 'graph');
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
  writeStdout(format === 'json' ? renderJsonGraph(graph) : renderDotGraph(graph));
  return 0;
}

async function runExplain(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    });
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
      const humanFindings = renderHumanLint(corpusFindings);
      if (humanFindings) writeStderr(humanFindings);
      writeStdout(renderMarkerScanNote(scan));
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
    writeStdout(`No decision governs ${path}.\n`);
  } else {
    if (buckets.governing.length === 0) {
      writeStdout(`No accepted decision governs ${path}.\n`);
    } else {
      writeStdout(renderDecisionGroup(`Decisions governing ${path}:`, buckets.governing));
    }
    writeStdout(renderDecisionGroup('Active proposals (not yet binding):', buckets.activeProposals));
    writeStdout(renderDecisionGroup('Historical records (not binding):', buckets.history));
  }

  writeStdout(renderMarkerScanNote(scan));

  if (findings.length > 0) {
    writeStdout('Findings:\n');
    for (const finding of findings) {
      writeStdout(renderFinding(finding));
    }
  }

  return 0;
}

function renderDecisionGroup(heading: string, decisions: readonly ExplainedDecision[], indent = '  '): string {
  if (decisions.length === 0) return '';
  let output = `${heading}\n`;
  for (const decision of decisions) {
    const successor = decision.supersededBy ? ` (superseded by ${decision.supersededBy})` : '';
    output += `${indent}${decision.recordId}  [${decision.status}] ${decision.title}${successor}\n`;
    // "via" is the record reaching out through its own `affects` pattern; "declared by"
    // is the file reaching in with an `@adr` marker. The two are never merged, because
    // which end made the claim is the whole point (ADR-0021).
    for (const matcher of decision.firedMatchers) {
      output += `${indent}  via ${matcher.type}: ${matcher.pattern}\n`;
    }
    for (const declaration of decision.declaredBy ?? []) {
      output += `${indent}  declared by ${declaration.path}:${declaration.line} (@adr ${declaration.ref})\n`;
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
  declared: Array<{ ref: string; line: number }>;
} {
  return {
    state: scan.state,
    windowBytes: MARKER_HEADER_WINDOW_BYTES,
    ...(scan.scannedBytes === undefined ? {} : { scannedBytes: scan.scannedBytes }),
    ...(scan.fileBytes === undefined ? {} : { fileBytes: scan.fileBytes }),
    truncated: scan.truncated,
    declared: scan.markers.map((marker) => ({ ref: marker.ref, line: marker.line })),
  };
}

/**
 * The one line of human output that keeps "this file declares nothing" from reading
 * identically to "I never opened this file" or "I stopped reading before the marker"
 * (ADR-0016). Silent when the whole file was scanned, which is the common case.
 */
function renderMarkerScanNote(scan: SourceMarkerScan): string {
  if (scan.state === 'absent') {
    return `Note: ${scan.path} is not a file in this working tree; no @adr markers were scanned.\n`;
  }
  if (scan.state === 'unreadable') {
    return `Note: ${scan.path} could not be read; no @adr markers were scanned.\n`;
  }
  if (scan.state === 'out-of-tree') {
    return `Note: ${scan.path} is not a repo-relative path inside this working tree; no @adr markers were scanned.\n`;
  }
  // The measured extent, not the window constant: the scan stops at the last complete
  // line inside the window, so the two differ for almost every real file. Only a scanned
  // state can be truncated, so the extent is present whenever this branch is — the
  // conjunction is how the types say that, not a fallback, which is why there is no
  // window-constant default to reprint if it were ever absent.
  if (scan.truncated && scan.scannedBytes !== undefined && scan.fileBytes !== undefined) {
    return `Note: only the first ${scan.scannedBytes} of ${scan.fileBytes} bytes of ${scan.path} were scanned for @adr markers.\n`;
  }
  return '';
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
): string {
  let output = '';
  if (outcome.governedBy.length === 0) {
    output += 'No decisions govern the changed files.\n';
  } else {
    if (outcome.governing.length === 0) {
      output += 'No accepted decisions govern the changed files.\n';
    } else {
      output += renderDecisionGroup('Decisions governing this change:', outcome.governing);
    }
    output += renderDecisionGroup(
      'Active proposals touching this change (not yet binding):',
      outcome.activeProposals,
    );
    output += renderDecisionGroup(
      'Historical records that once covered this change (not binding):',
      outcome.history,
    );
  }

  // Silent when there was nothing to scan: `adr check` with no paths would otherwise
  // report an all-zero scan on every run.
  if (outcome.markerScan && outcome.markerScan.totalCandidates > 0) {
    const counts = outcome.markerScan.counts;
    output +=
      `marker scan: ${counts.scanned} scanned, ${counts.absent} absent, ` +
      `${counts.unreadable} unreadable, ${counts['out-of-tree']} out-of-tree, ` +
      `${counts.truncated} truncated, ${counts.skipped} skipped\n`;

    const unavailable = [
      ...outcome.markerScan.absentPaths,
      ...outcome.markerScan.unreadablePaths,
      ...outcome.markerScan.outOfTreePaths,
      ...outcome.markerScan.skippedPaths,
    ];
    if (unavailable.length > 0) {
      const shown = unavailable.slice(0, 10);
      const remaining = unavailable.length - shown.length;
      output += `marker scan unavailable for: ${shown.join(', ')}`;
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
        return extent === undefined ? path : `${path} ${extent}`;
      });
      output += `marker scan truncated (bytes scanned of total): ${labelled.join(', ')}`;
      if (remaining > 0) output += `, and ${remaining} more (see --json for the complete list)`;
      output += '\n';
    }
  }

  if (outcome.findings.length > 0) {
    output += 'Findings:\n';
    output += renderHumanLint(outcome.findings);
  }

  const changedRecordErrors = outcome.findings.filter(
    (finding) => finding.severity === 'error' && finding.path && outcome.changedRecords.includes(finding.path),
  ).length;
  output += `checked: ${outcome.governing.length} governing, ${outcome.activeProposals.length} active proposals, ${outcome.history.length} historical, ${outcome.changedRecords.length} changed records, ${changedRecordErrors} changed-record errors\n`;
  return output;
}

async function runCheck(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseCommandArgs(args, {
      json: { type: 'boolean', default: false },
      dir: { type: 'string', default: 'docs/adr' },
    });
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
    });
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
  const [command, ...args] = argv;

  try {
    if (command === undefined) {
      writeStdout(USAGE);
      return 0;
    }
    if (command === 'help') return runHelp(args);
    if (isHelpFlag(command)) return runHelp(args);
    if (command === '--version' || command === '-V') {
      writeStdout(`${CLI_VERSION}\n`);
      return 0;
    }

    // `adr <command> --help` prints that command's usage to stdout at 0. `queue`
    // parses `--help` itself, so it is excluded here to keep one code path for it.
    const commandUsage = command === 'queue' ? undefined : commandUsageFor(command);
    if (commandUsage && args.some(isHelpFlag)) {
      writeStdout(commandUsage);
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
    return usageError(unknownCommandMessage(command));
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
