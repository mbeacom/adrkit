#!/usr/bin/env node

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
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

type CorpusDirectoryErrorKind = 'not-found' | 'not-readable';

function corpusDirectoryUsageError(dir: string, kind: CorpusDirectoryErrorKind): number {
  const state = kind === 'not-readable' ? 'not readable' : 'not found';
  writeStderr(`Corpus directory ${state}: '${dir}'.\n`);
  return 2;
}

function corpusDirectoryErrorKind(error: unknown, dir: string): CorpusDirectoryErrorKind | undefined {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES' && code !== 'EPERM') return undefined;

  const path = typeof error === 'object' && error !== null && 'path' in error ? error.path : undefined;
  if (typeof path === 'string' && resolve(path) !== resolve(dir)) return undefined;
  return code === 'EACCES' || code === 'EPERM' ? 'not-readable' : 'not-found';
}

function handleCorpusDirectoryError(error: unknown, dir: string): number | undefined {
  const kind = corpusDirectoryErrorKind(error, dir);
  return kind ? corpusDirectoryUsageError(dir, kind) : undefined;
}

async function ensureCorpusDirectoryReadable(dir: string): Promise<number | undefined> {
  try {
    await readdir(dir);
    return undefined;
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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

const USAGE = `Usage:
  adr lint [paths...] [--json] [--dir docs/adr]
  adr migrate --from madr [--dir docs/adr] [--dry-run] [--rename] [--json]
  adr new <title> [--status draft] [--dir docs/adr] [--json]
  adr graph [--dir docs/adr] [--format dot|json]
  adr explain <path> [--dir docs/adr] [--json]
  adr check <files...> [--dir docs/adr] [--json]
  adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [--json] [--dir docs/adr]
  adr queue [--dir docs/adr] [--as-of YYYY-MM-DD] [--format markdown|json]

  adr help [command]        Show this help, or help for one command
  adr --version             Print the @adrkit/cli version

Round-trip sync is explicitly unsupported (ADR-0008); migrate is one-way and non-destructive.
`;

/**
 * Per-command help, printed by `adr <command> --help` and `adr help <command>`.
 * `queue` reuses its own richer usage text so there is a single source for it.
 */
const COMMAND_USAGE: Record<string, string> = {
  lint: `Usage: adr lint [paths...] [options]

Validate the ADR corpus. With no paths, every discoverable record under --dir is checked.

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit { checked, findings } as JSON
  --help          Show this help and exit

Exit codes: 0 = no error findings; 1 = one or more error findings;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  migrate: `Usage: adr migrate --from madr [options]

Migrate a MADR corpus in place, adding adrkit frontmatter and leaving the body untouched.
One-way and non-destructive; round-trip sync is unsupported (ADR-0008).

Options:
  --from madr     Source format (required; only madr is supported)
  --dir <path>    ADR corpus directory (default: docs/adr)
  --dry-run       Report what would change without writing
  --rename        Rename each migrated file to <id>-<slug>.md so corpus discovery
                  can see it. Off by default, because migration is in place.
  --json          Emit the migration result as JSON
  --help          Show this help and exit

Exit codes: 0 = migration ran (findings are reported but do not fail the run);
2 = usage error (missing or unsupported --from, unknown flag, positional argument,
or unreachable corpus directory).
`,
  new: `Usage: adr new <title> [options]

Scaffold a new ADR record.

Options:
  --status <status>   Initial status (default: draft)
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path } as JSON
  --help              Show this help and exit

Exit codes: 0 = created; 1 = refused to overwrite an existing file; 2 = usage error.
`,
  graph: `Usage: adr graph [options]

Render the decision graph (supersedes, relatesTo, conflictsWith) for the corpus.

Options:
  --dir <path>            ADR corpus directory (default: docs/adr)
  --format dot|json       Output format (default: dot)
  --help                  Show this help and exit

Exit codes: 0 = rendered; 2 = usage error (invalid invocation or unreachable corpus directory).
`,
  explain: `Usage: adr explain <path> [options]

Report which decisions govern one repo-relative path, and why.

A decision reaches a path in two directions. The record declares an "affects" pattern
that matches it ("via path: src/**"), or the file itself declares the record in a
comment ("declared by src/sync.ts:3 (@adr 0012)"). If <path> exists, at most its first
8192 bytes are scanned for dedicated "@adr <id>" comment lines -- the scan stops at the
last complete line inside that bound, and --json reports the extent it reached. A marker
naming a record the corpus does not have is reported as a dangling-marker warning.

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit { path, governedBy, governing, activeProposals, history,
                  markers, findings }. Pattern matches carry "firedMatchers";
                  file declarations carry "declaredBy".
  --help          Show this help and exit

Exit codes: 0 = explained; 1 = corpus has error findings;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  check: `Usage: adr check <files...> [options]

Report the decisions governing a set of changed files, and validate any changed records.

Options:
  --dir <path>    ADR corpus directory (default: docs/adr)
  --json          Emit the CheckOutcome as JSON
  --help          Show this help and exit

Exit codes: 0 = ok; 1 = a changed record has an error finding;
2 = usage error (invalid invocation or unreachable corpus directory).
`,
  evaluate: `Usage: adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [options]

Run the deterministic evaluator over one proposal against an offline snapshot bundle.

Options:
  --snapshot <path>   Snapshot bundle (required)
  --date <date>       Evaluation date, YYYY-MM-DD (required)
  --dir <path>        ADR corpus directory
  --json              Emit the evaluation report as JSON
  --help              Show this help and exit

The evaluator routes; it never approves, persists, or writes. There is no --write.

Exit codes: 0 = evaluated (including warn/info/inert and escalation);
1 = the proposal was returned on a rubric error; 2 = usage error, unreachable
corpus directory, or malformed snapshot bundle.
`,
  queue: QUEUE_USAGE,
};

const COMMANDS = Object.keys(COMMAND_USAGE);

/** Own-property lookup: `adr help constructor` must be a usage error, not a crash. */
function commandUsageFor(command: string): string | undefined {
  return Object.hasOwn(COMMAND_USAGE, command) ? COMMAND_USAGE[command] : undefined;
}

/** Usage error: message + usage on stderr, exit 2. Explicit help goes to stdout at 0. */
function usage(message?: string): number {
  if (message) writeStderr(`${message}\n`);
  writeStderr(USAGE);
  return 2;
}

function isHelpFlag(arg: string): boolean {
  return arg === '--help' || arg === '-h';
}

/** `adr help [command]` — usage on stdout at 0; unknown command is still a usage error. */
function runHelp(args: string[]): number {
  const requested = args.find((arg) => !arg.startsWith('-'));
  if (requested === undefined) {
    writeStdout(USAGE);
    return 0;
  }

  const commandUsage = commandUsageFor(requested);
  if (!commandUsage) {
    return usage(`Unknown command "${requested}". Known commands: ${COMMANDS.join(', ')}`);
  }

  writeStdout(commandUsage);
  return 0;
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  const dir = String(parsed.values.dir);
  if (parsed.positionals.length > 0 && hasValueFlag(args, '--dir')) {
    const exitCode = await ensureCorpusDirectoryReadable(dir);
    if (exitCode !== undefined) return exitCode;
  }

  let result: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    result = await lintCorpus({
      dir,
      paths: parsed.positionals,
    });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  if (parsed.positionals.length > 0) return usage('adr migrate does not accept positional arguments');
  const from = parsed.values.from;
  if (from !== 'madr') {
    return usage(
      from
        ? `adr migrate --from ${String(from)} is not supported yet; only --from madr is available, and round-trip sync is unsupported (ADR-0008)`
        : 'adr migrate requires --from madr; non-MADR sources and round-trip sync are unsupported in this phase (ADR-0008)',
    );
  }

  const dir = String(parsed.values.dir);
  const dirExitCode = await ensureCorpusDirectoryReadable(dir);
  if (dirExitCode !== undefined) return dirExitCode;

  let result: Awaited<ReturnType<typeof migrateMadr>>;
  try {
    result = await migrateMadr({
      dir,
      write: parsed.values['dry-run'] !== true,
      rename: parsed.values.rename === true,
    });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  const title = parsed.positionals.join(' ').trim();
  if (!title) return usage('adr new requires a title');

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
      writeStderr(`${error.message}\n`);
      return error.code === 'exists' ? 1 : 2;
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  if (parsed.positionals.length > 0) return usage('adr graph does not accept positional arguments');
  const format = String(parsed.values.format);
  if (format !== 'dot' && format !== 'json') return usage('adr graph --format must be dot or json');

  const dir = String(parsed.values.dir);
  let result: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    result = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  if (parsed.positionals.length !== 1) return usage('adr explain requires exactly one path');
  const path = parsed.positionals[0];
  if (!path) return usage('adr explain requires exactly one path');

  const dir = String(parsed.values.dir);
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  const dir = String(parsed.values.dir);
  let lint: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    lint = await lintCorpus({ dir });
  } catch (error) {
    const exitCode = handleCorpusDirectoryError(error, dir);
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
    return usage(error instanceof Error ? error.message : String(error));
  }

  if (parsed.positionals.length !== 1) return usage('adr evaluate requires exactly one proposal path');
  const proposalPath = parsed.positionals[0];
  if (!proposalPath) return usage('adr evaluate requires a proposal path');
  const snapshot = parsed.values.snapshot;
  if (typeof snapshot !== 'string' || snapshot.length === 0) {
    return usage('adr evaluate requires --snapshot <bundle.json>');
  }
  const date = parsed.values.date;
  if (typeof date !== 'string' || date.length === 0) {
    return usage('adr evaluate requires --date YYYY-MM-DD');
  }

  const result = await evaluate({
    proposalPath,
    snapshotPath: snapshot,
    date,
    json: parsed.values.json === true,
    ...(typeof parsed.values.dir === 'string' ? { dir: parsed.values.dir } : {}),
  });
  if (result.stderr) writeStderr(result.stderr);
  if (result.stdout) writeStdout(result.stdout);
  return result.exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (command === undefined) return usage();
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
    return usage(`Unknown command "${command}"`);
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
