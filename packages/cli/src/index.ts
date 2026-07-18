#!/usr/bin/env bun

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  buildAdrGraph,
  countFindings,
  createAdr,
  exitCodeForFindings,
  lintCorpus,
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
  return `  ${finding.severity} ${finding.rule}${id}${field}: ${finding.message}\n`;
}

function renderHumanLint(findings: readonly Finding[]): string {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = finding.path ?? '(corpus)';
    grouped.set(group, [...(grouped.get(group) ?? []), finding]);
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (command === 'lint') return await runLint(args);
    if (command === 'new') return await runNew(args);
    if (command === 'graph') return await runGraph(args);
    return usage(command ? `Unknown command "${command}"` : undefined);
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
