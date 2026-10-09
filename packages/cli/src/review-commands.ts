import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  approveAdrSource,
  Identity,
  MAX_OBJECTION_SUMMARY_LENGTH,
  objectAdrSource,
  objectionSummaryProblem,
  resolveObjectionAdrSource,
  type Finding,
} from '@adrkit/core';
import { commandOptions, renderGlobalColorUsageLine, withGlobalColorOption, type CommandName } from './command-registry.ts';
import { formatUsageError } from './errors.ts';
import { getPresentation } from './presentation.ts';
import { resolveWriteTarget, type WriteTarget } from './record-target.ts';
import { closestCandidate } from './recovery.ts';
import { cleanText } from './terminal-text.ts';

const COMMON_TAIL = `Nothing is committed: review the diff and open a pull request. --by is
required and is never inferred; it names the person whose review this is.`;

export const APPROVE_USAGE = `Usage: adr approve <id> --by <identity> [options]

Record an approval on a proposed decision record (ADR-0051).

Adds <identity> to review.approvals and changes no other line. Approving
twice is a no-op. Refuses a record that is not proposed or is not valid.
${COMMON_TAIL}

Arguments:
  <id>                ADR id, as shown by adr queue (e.g. 0044)

Options:
  --by <identity>     Required. The approver: @handle, team:slug, or email
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path, by, changed, approvals } as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

Examples:
  adr queue
  adr approve 0044 --by @octocat

Exit codes: 0 = approved, or already approved; 1 = refused (record unchanged);
2 = usage error.
`;

export const OBJECT_USAGE = `Usage: adr object <id> --by <identity> --summary <text> [options]

Raise an objection on a proposed decision record (ADR-0051).

Appends { by, summary, resolved: false } to review.objections and changes no
other line. An unresolved objection blocks adr accept until the objector
resolves it. Raising the same open objection twice is a no-op. Refuses a
record that is not proposed or is not valid.
${COMMON_TAIL}

Arguments:
  <id>                ADR id, as shown by adr queue (e.g. 0044)

Options:
  --by <identity>     Required. The objector: @handle, team:slug, or email
  --summary <text>    Required. One line, at most ${MAX_OBJECTION_SUMMARY_LENGTH} characters
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path, by, changed, objection } as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

Examples:
  adr object 0044 --by @octocat --summary "Needs a load test first"

Exit codes: 0 = objection recorded, or already open; 1 = refused (record
unchanged); 2 = usage error.
`;

export const RESOLVE_USAGE = `Usage: adr resolve <id> --objection <n> --by <identity> [options]

Resolve your own objection on a proposed decision record (ADR-0051).

Sets resolved: true on objection <n> (1-based, in file order) and changes no
other line. Only the objector may resolve an objection: --by must equal its
by. Resolving a resolved objection is a no-op. Refuses a record that is not
proposed or is not valid.
${COMMON_TAIL}

Arguments:
  <id>                ADR id, as shown by adr queue (e.g. 0044)

Options:
  --objection <n>     Required. Which objection, counting from 1
  --by <identity>     Required. The objector: @handle, team:slug, or email
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path, by, changed, objection } as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

Examples:
  adr resolve 0044 --objection 1 --by @octocat

Exit codes: 0 = resolved, or already resolved; 1 = refused (record unchanged);
2 = usage error.
`;

type ReviewCommand = Extract<CommandName, 'approve' | 'object' | 'resolve'>;

const USAGES: Record<ReviewCommand, string> = { approve: APPROVE_USAGE, object: OBJECT_USAGE, resolve: RESOLVE_USAGE };

interface Outcome {
  changed: boolean;
  content: string;
  /** Command-specific JSON fields, after `{ id, path, by, changed }`. */
  extra: Record<string, number>;
  /** The headline verb and the detail line of a write. */
  verb: string;
  detail: string;
  /** Why nothing was written, for a no-op. */
  noop: string;
}

interface Command {
  name: ReviewCommand;
  options: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>;
  /** Validate command-specific options; a string is a usage error. */
  validate(values: Record<string, unknown>): string | undefined;
  apply(
    source: string,
    by: string,
    path: string,
    values: Record<string, unknown>,
  ): { ok: true; outcome: Outcome } | { ok: false; message: string; findings?: Finding[] };
}

function usageErrorFor(command: ReviewCommand): (message: string) => number {
  return (message) => {
    process.stderr.write(formatUsageError(message, USAGES[command], command, getPresentation().stderr));
    return 2;
  };
}

function refusalFor(command: ReviewCommand): (message: string, findings?: readonly Finding[]) => number {
  return (message, findings = []) => {
    const style = getPresentation().stderr;
    // Messages and findings quote corpus content (ids, paths, titles), so they cross
    // the same trust boundary as the queue's terminal view.
    const lines = [`${style.severity('error')} adr ${command} refused: ${cleanText(message)}`];
    for (const finding of findings) {
      const field = finding.field ? ` (${cleanText(finding.field)})` : '';
      lines.push(`  ${style.severity(finding.severity)} ${cleanText(finding.rule)}${field}: ${cleanText(finding.message)}`);
    }
    lines.push(style.note('The record was not changed.'));
    process.stderr.write(`${lines.join('\n')}\n`);
    return 1;
  };
}

async function run(command: Command, args: string[]): Promise<number> {
  const usageError = usageErrorFor(command.name);
  const refusal = refusalFor(command.name);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        by: { type: 'string' },
        dir: { type: 'string', default: 'docs/adr' },
        json: { type: 'boolean', default: false },
        ...command.options,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /^Unknown option ['"`]([^'"`]+)['"`]/.exec(message)?.[1];
    if (unknown) {
      const suggestion = closestCandidate(unknown, withGlobalColorOption(commandOptions(command.name)));
      return usageError(suggestion ? `Unknown option "${unknown}". Did you mean "${suggestion}"?` : `Unknown option "${unknown}".`);
    }
    return usageError(message);
  }

  if (parsed.positionals.length !== 1) {
    return usageError(
      parsed.positionals.length === 0 ? `adr ${command.name} requires an ADR id.` : `adr ${command.name} takes exactly one ADR id.`,
    );
  }
  const rawId = String(parsed.positionals[0]);
  const by = parsed.values.by === undefined ? '' : String(parsed.values.by);
  if (by === '') {
    return usageError(`adr ${command.name} requires --by <identity>: the person whose review this is. It is never inferred.`);
  }
  if (!Identity.safeParse(by).success) {
    return usageError(`Invalid --by value "${by}". Expected @handle, team:slug, or an email address.`);
  }
  const invalid = command.validate(parsed.values);
  if (invalid) return usageError(invalid);

  const target: WriteTarget | number = await resolveWriteTarget(rawId, String(parsed.values.dir), { usageError, refusal });
  if (typeof target === 'number') return target;
  const { id, record, absolutePath } = target;

  const source = await readFile(absolutePath, 'utf8');
  const result = command.apply(source, by, record.path, parsed.values);
  if (!result.ok) return refusal(result.message, result.findings);

  const { outcome } = result;
  if (outcome.changed) await writeFile(absolutePath, outcome.content, 'utf8');

  if (parsed.values.json) {
    const json = { id, path: record.path, by, changed: outcome.changed, ...outcome.extra };
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    return 0;
  }
  const style = getPresentation().stdout;
  // The title and path come from the corpus; strip terminal control characters.
  const lines = outcome.changed
    ? [
        `${style.status(outcome.verb)} ADR-${cleanText(id)}: ${cleanText(record.frontmatter.title)}`,
        `  ${outcome.detail}`,
        `  ${style.path(cleanText(record.path))}`,
        style.note('Nothing was committed. Review the diff, then open a pull request.'),
      ]
    : [
        `${style.note('unchanged')} ADR-${cleanText(id)}: ${cleanText(record.frontmatter.title)}`,
        `  ${outcome.noop}`,
        style.note('Nothing was written.'),
      ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

const APPROVE: Command = {
  name: 'approve',
  options: {},
  validate: () => undefined,
  apply(source, by, path) {
    const result = approveAdrSource({ source, by, path });
    if (!result.ok) return result;
    return {
      ok: true,
      outcome: {
        changed: result.changed,
        content: result.content,
        extra: { approvals: result.approvals },
        verb: 'approved',
        detail: `by ${by}; ${result.approvals} approval(s) recorded`,
        noop: `The record already has an approval from ${by}.`,
      },
    };
  },
};

const OBJECT: Command = {
  name: 'object',
  options: { summary: { type: 'string' } },
  validate(values) {
    if (values.summary === undefined) return 'adr object requires --summary <text>: one line saying what the concern is.';
    return objectionSummaryProblem(String(values.summary));
  },
  apply(source, by, path, values) {
    const result = objectAdrSource({ source, by, summary: String(values.summary), path });
    if (!result.ok) return result;
    return {
      ok: true,
      outcome: {
        changed: result.changed,
        content: result.content,
        extra: { objection: result.objection },
        verb: 'objected',
        detail: `objection ${result.objection} raised by ${by}; adr accept refuses until it is resolved`,
        noop: `The record already has this open objection from ${by} (objection ${result.objection}).`,
      },
    };
  },
};

const OBJECTION_NUMBER = /^[1-9][0-9]*$/;

const RESOLVE: Command = {
  name: 'resolve',
  options: { objection: { type: 'string' } },
  validate(values) {
    if (values.objection === undefined) return 'adr resolve requires --objection <n>: which objection, counting from 1.';
    const raw = String(values.objection);
    if (!OBJECTION_NUMBER.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return `Invalid --objection value "${raw}". Expected a positive whole number, counting from 1.`;
    }
    return undefined;
  },
  apply(source, by, path, values) {
    const objection = Number(values.objection);
    const result = resolveObjectionAdrSource({ source, by, objection, path });
    if (!result.ok) return result;
    return {
      ok: true,
      outcome: {
        changed: result.changed,
        content: result.content,
        extra: { objection },
        verb: 'resolved',
        detail: `objection ${objection}, by its objector ${by}`,
        noop: `Objection ${objection} is already resolved.`,
      },
    };
  },
};

export const runApprove = (args: string[]): Promise<number> => run(APPROVE, args);
export const runObject = (args: string[]): Promise<number> => run(OBJECT, args);
export const runResolve = (args: string[]): Promise<number> => run(RESOLVE, args);
