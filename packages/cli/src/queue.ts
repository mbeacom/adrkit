import {
  buildQueueReport,
  formatQueueReportJson,
  formatQueueReportMarkdown,
  lintCorpus,
  resolveAsOf,
} from '@adrkit/core';
import { commandOptions, requiredCommandValueChoices } from './command-registry.ts';
import { corpusDirectoryErrorKind, corpusDirectoryErrorMessage, formatUsageError } from './errors.ts';
import { closestCandidate } from './recovery.ts';

const USAGE = `Usage: adr queue [options]

Show the architecture review board operations queue for the local ADR corpus.

Options:
  --dir <path>              ADR corpus directory (default: docs/adr)
  --as-of <date>            UTC calendar date for SLA computation (default: today, UTC).
                            Accepts YYYY-MM-DD or an ISO datetime with an explicit
                            timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).
  --format markdown|json    Output format (default: markdown)
  -h, --help                Show this help and exit

Examples:
  adr queue
  adr queue --as-of 2026-08-24
  adr queue --format json

Exit codes: 0 = report, no error findings; 1 = report with corpus error findings;
2 = usage error (invalid flag/value or unreachable corpus directory).
`;

/** Re-exported so `adr help queue` renders the same text as `adr queue --help`. */
export const QUEUE_USAGE = USAGE;

function usageError(message: string): number {
  process.stderr.write(formatUsageError(message, USAGE, 'queue'));
  return 2;
}

interface ParsedFlags {
  dir: string;
  asOf?: string;
  format: string;
  help: boolean;
}

const QUEUE_OPTIONS = commandOptions('queue');
const QUEUE_FORMAT_CHOICES = requiredCommandValueChoices('queue', '--format');

function formatChoiceList(values: readonly string[]): string {
  if (values.length === 1) return `"${values[0]}"`;
  if (values.length === 2) return `"${values[0]}" or "${values[1]}"`;
  return `${values.slice(0, -1).map((value) => `"${value}"`).join(', ')}, or "${values[values.length - 1]}"`;
}

function unknownOptionMessage(option: string): string {
  const suggestion = closestCandidate(option, QUEUE_OPTIONS);
  return suggestion ? `Unknown option "${option}". Did you mean "${suggestion}"?` : `Unknown option "${option}".`;
}

function formatMessage(value: string): string {
  const suggestion = closestCandidate(value, QUEUE_FORMAT_CHOICES);
  const expected = formatChoiceList(QUEUE_FORMAT_CHOICES);
  const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
  return `Invalid --format value "${value}".${hint} Expected ${expected}.`;
}

type ParseResult =
  | { ok: true; flags: ParsedFlags }
  | { ok: false; unknown: string }
  | { ok: false; positional: string }
  | { ok: false; missing: string };

function parseFlags(args: string[]): ParseResult {
  const flags: ParsedFlags = { dir: 'docs/adr', format: 'markdown', help: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = eq !== -1 ? arg.slice(eq + 1) : undefined;

    if (name === '--help' || name === '-h') {
      flags.help = true;
      continue;
    }

    const valueFlag = name === '--dir' || name === '--as-of' || name === '--format';
    if (!valueFlag) {
      if (!name.startsWith('-')) return { ok: false, positional: name };
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
    if (value.length === 0) return { ok: false, missing: name };

    if (name === '--dir') flags.dir = value;
    else if (name === '--as-of') flags.asOf = value;
    else flags.format = value;
  }

  return { ok: true, flags };
}

/** Entrypoint for the `adr queue` subcommand. Returns the process exit code. */
export async function runQueue(args: string[]): Promise<number> {
  const parsed = parseFlags(args);
  if (!parsed.ok) {
    if ('missing' in parsed) {
      return usageError(`Missing value for option "${parsed.missing}".`);
    }
    if ('positional' in parsed) {
      return usageError(`Positional argument "${parsed.positional}" is not supported. Use --dir <path> to select the ADR corpus.`);
    }
    return usageError(unknownOptionMessage(parsed.unknown));
  }

  const { flags } = parsed;
  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (flags.format !== 'markdown' && flags.format !== 'json') {
    return usageError(formatMessage(flags.format));
  }

  let asOf: string;
  if (flags.asOf !== undefined) {
    const resolution = resolveAsOf(flags.asOf);
    if (!resolution.ok) {
      const message =
        resolution.code === 'tzless'
          ? `Invalid --as-of value "${flags.asOf}". Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).`
          : `Invalid --as-of value "${flags.asOf}". Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).`;
      return usageError(message);
    }
    asOf = resolution.date;
  } else {
    asOf = new Date().toISOString().slice(0, 10);
  }

  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir: flags.dir });
  } catch (error) {
    const kind = corpusDirectoryErrorKind(error, flags.dir);
    if (kind) return usageError(corpusDirectoryErrorMessage(flags.dir, kind));
    throw error;
  }

  const report = buildQueueReport({ corpus, asOf });
  const output = flags.format === 'json' ? formatQueueReportJson(report) : formatQueueReportMarkdown(report);
  process.stdout.write(output);

  return report.corpusFindings.some((finding) => finding.severity === 'error') ? 1 : 0;
}
