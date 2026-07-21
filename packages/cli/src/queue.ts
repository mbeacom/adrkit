import { stat } from 'node:fs/promises';
import { buildQueueReport, formatQueueReportJson, formatQueueReportMarkdown, lintCorpus } from '@adrkit/core';

const USAGE = `Usage: adr queue [options]

Emit the ARB operations queue report for the local ADR corpus to stdout.

Options:
  --dir <path>              ADR corpus directory (default: docs/adr)
  --as-of <date>            UTC calendar date for SLA computation (default: today, UTC).
                            Accepts YYYY-MM-DD or an ISO datetime with an explicit
                            timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).
  --format markdown|json    Output format (default: markdown)
  --help                    Show this help and exit

Exit codes: 0 = report, no error findings; 1 = report with corpus error findings;
2 = usage error (invalid flag/value or unreachable corpus directory).
`;

type AsOfResolution = { ok: true; date: string } | { ok: false; kind: 'tzless' | 'invalid' };

/** Resolve a `--as-of` value to a UTC calendar date (cli-contract.md §As-Of Resolution). */
function resolveAsOf(value: string): AsOfResolution {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) {
      return { ok: true, date: value };
    }
    return { ok: false, kind: 'invalid' };
  }

  const tIndex = value.indexOf('T');
  if (tIndex !== -1) {
    const timePart = value.slice(tIndex + 1);
    const hasTimezone = /Z$/.test(timePart) || /[+-]\d{2}:?\d{2}$/.test(timePart);
    if (!hasTimezone) return { ok: false, kind: 'tzless' };
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return { ok: true, date: parsed.toISOString().slice(0, 10) };
    return { ok: false, kind: 'invalid' };
  }

  return { ok: false, kind: 'invalid' };
}

interface ParsedFlags {
  dir: string;
  asOf?: string;
  format: string;
  help: boolean;
}

type ParseResult = { ok: true; flags: ParsedFlags } | { ok: false; unknown: string } | { ok: false; missing: string };

function parseFlags(args: string[]): ParseResult {
  const flags: ParsedFlags = { dir: 'docs/adr', format: 'markdown', help: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = eq !== -1 ? arg.slice(eq + 1) : undefined;

    if (name === '--help') {
      flags.help = true;
      continue;
    }

    const valueFlag = name === '--dir' || name === '--as-of' || name === '--format';
    if (!valueFlag) {
      return { ok: false, unknown: name };
    }

    // A value-taking flag needs a real value: either an inline `--flag=value`, or a
    // following token that is not itself a flag. Never consume a following flag.
    let value: string;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('-')) {
        return { ok: false, missing: name };
      }
      value = next;
      i += 1;
    }

    if (name === '--dir') flags.dir = value;
    else if (name === '--as-of') flags.asOf = value;
    else flags.format = value;
  }

  return { ok: true, flags };
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Entrypoint for the `adr queue` subcommand. Returns the process exit code. */
export async function runQueue(args: string[]): Promise<number> {
  const parsed = parseFlags(args);
  if (!parsed.ok) {
    if ('missing' in parsed) {
      process.stderr.write(`Missing value for flag '${parsed.missing}'. See 'adr queue --help'.\n`);
      return 2;
    }
    process.stderr.write(`Unknown flag: '${parsed.unknown}'. See 'adr queue --help'.\n`);
    return 2;
  }

  const { flags } = parsed;
  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (flags.format !== 'markdown' && flags.format !== 'json') {
    process.stderr.write(`Invalid --format value: '${flags.format}'. Expected markdown or json.\n`);
    return 2;
  }

  let asOf: string;
  if (flags.asOf !== undefined) {
    const resolution = resolveAsOf(flags.asOf);
    if (!resolution.ok) {
      const message =
        resolution.kind === 'tzless'
          ? `Invalid --as-of value: '${flags.asOf}'. Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).\n`
          : `Invalid --as-of value: '${flags.asOf}'. Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).\n`;
      process.stderr.write(message);
      return 2;
    }
    asOf = resolution.date;
  } else {
    asOf = new Date().toISOString().slice(0, 10);
  }

  if (!(await directoryExists(flags.dir))) {
    process.stderr.write(`Corpus directory not found: '${flags.dir}'.\n`);
    return 2;
  }

  const corpus = await lintCorpus({ dir: flags.dir });
  const report = buildQueueReport({ corpus, asOf });
  const output = flags.format === 'json' ? formatQueueReportJson(report) : formatQueueReportMarkdown(report);
  process.stdout.write(output);

  return report.corpusFindings.some((finding) => finding.severity === 'error') ? 1 : 0;
}
