#!/usr/bin/env node

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  buildAdrGraph,
  checkChanges,
  countFindings,
  createAdr,
  exitCodeForFindings,
  lintCorpus,
  migrateMadr,
  resolveAffects,
  renderDotGraph,
  renderJsonGraph,
  ScaffoldError,
  sortFindings,
  type Finding,
} from '@adrkit/core';
import { evaluate } from './evaluate.ts';

function writeStdout(text: string): void {
  process.stdout.write(text);
}

function writeStderr(text: string): void {
  process.stderr.write(text);
}

function usage(message?: string): number {
  if (message) writeStderr(`${message}\n`);
  writeStderr(`Usage:
  adr lint [paths...] [--json] [--dir docs/adr]
  adr migrate --from madr [--dir docs/adr] [--dry-run] [--json]
  adr new <title> [--status draft] [--dir docs/adr] [--json]
  adr graph [--dir docs/adr] [--format dot|json]
  adr explain <path> [--dir docs/adr] [--json]
  adr check <files...> [--dir docs/adr] [--json]
  adr evaluate <proposal-path> --snapshot <bundle.json> --date YYYY-MM-DD [--json] [--dir docs/adr]

Round-trip sync is explicitly unsupported (ADR-0008); migrate is one-way and non-destructive.
`);
  return 2;
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

  const result = await lintCorpus({
    dir: String(parsed.values.dir),
    paths: parsed.positionals,
  });
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
    output += `${item.outcome}  ${item.path}\n`;
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

  const result = await migrateMadr({
    dir: String(parsed.values.dir),
    write: parsed.values['dry-run'] !== true,
  });

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

  const result = await lintCorpus({ dir: String(parsed.values.dir) });
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

  const corpus = await lintCorpus({ dir: String(parsed.values.dir) });
  const corpusFindings = sortFindings(corpus.findings);
  if (exitCodeForFindings(corpusFindings) !== 0) {
    if (parsed.values.json) {
      writeStdout(`${JSON.stringify({ path, governedBy: [], findings: corpusFindings }, null, 2)}\n`);
    } else {
      const humanFindings = renderHumanLint(corpusFindings);
      if (humanFindings) writeStderr(humanFindings);
    }
    return 1;
  }

  const recordsById = new Map(corpus.records.map((record) => [record.frontmatter.id, record]));
  const resolution = resolveAffects({ records: corpus.records, changedFiles: [path] });
  const governedBy = resolution.matches.map((match) => ({
    recordId: match.recordId,
    title: recordsById.get(match.recordId)?.frontmatter.title ?? '',
    firedMatchers: match.firedMatchers,
  }));
  const findings = sortFindings(resolution.findings);

  if (parsed.values.json) {
    writeStdout(`${JSON.stringify({ path, governedBy, findings }, null, 2)}\n`);
    return 0;
  }

  if (governedBy.length === 0) {
    writeStdout(`No decision governs ${path}.\n`);
  } else {
    for (const match of governedBy) {
      writeStdout(`${match.recordId}  ${match.title}\n`);
      for (const matcher of match.firedMatchers) {
        writeStdout(`  via ${matcher.type}: ${matcher.pattern}\n`);
      }
    }
  }

  if (findings.length > 0) {
    writeStdout('Findings:\n');
    for (const finding of findings) {
      writeStdout(renderFinding(finding));
    }
  }

  return 0;
}

function renderHumanCheck(outcome: ReturnType<typeof checkChanges>): string {
  let output = '';
  if (outcome.governedBy.length === 0) {
    output += 'No decisions govern the changed files.\n';
  } else {
    output += 'Decisions governing this change:\n';
    for (const decision of outcome.governedBy) {
      output += `  ${decision.recordId}  ${decision.title}\n`;
      for (const matcher of decision.firedMatchers) {
        output += `    via ${matcher.type}: ${matcher.pattern}\n`;
      }
    }
  }

  if (outcome.findings.length > 0) {
    output += 'Findings:\n';
    output += renderHumanLint(outcome.findings);
  }

  const changedRecordErrors = outcome.findings.filter(
    (finding) => finding.severity === 'error' && finding.path && outcome.changedRecords.includes(finding.path),
  ).length;
  output += `checked: ${outcome.governedBy.length} governing, ${outcome.changedRecords.length} changed records, ${changedRecordErrors} changed-record errors\n`;
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
  const lint = await lintCorpus({ dir });
  const outcome = checkChanges({ lint, changedFiles: parsed.positionals, dir });

  if (parsed.values.json) {
    writeStdout(`${JSON.stringify(outcome, null, 2)}\n`);
  } else {
    writeStdout(renderHumanCheck(outcome));
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
    if (command === 'lint') return await runLint(args);
    if (command === 'migrate') return await runMigrate(args);
    if (command === 'new') return await runNew(args);
    if (command === 'graph') return await runGraph(args);
    if (command === 'explain') return await runExplain(args);
    if (command === 'check') return await runCheck(args);
    if (command === 'evaluate') return await runEvaluate(args);
    return usage(command ? `Unknown command "${command}"` : undefined);
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
