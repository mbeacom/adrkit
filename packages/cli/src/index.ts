#!/usr/bin/env node

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  buildAdrGraph,
  countFindings,
  createAdr,
  exitCodeForFindings,
  lintCorpus,
  resolveAffects,
  renderDotGraph,
  renderJsonGraph,
  ScaffoldError,
  sortFindings,
  type Finding,
} from '@adrkit/core';

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
  adr new <title> [--status draft] [--dir docs/adr] [--json]
  adr graph [--dir docs/adr] [--format dot|json]
  adr explain <path> [--dir docs/adr] [--json]
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (command === 'lint') return await runLint(args);
    if (command === 'new') return await runNew(args);
    if (command === 'graph') return await runGraph(args);
    if (command === 'explain') return await runExplain(args);
    return usage(command ? `Unknown command "${command}"` : undefined);
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
