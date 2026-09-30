import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { acceptAdrSource, Identity, lintCorpus, type Finding } from '@adrkit/core';
import { commandOptions, renderGlobalColorUsageLine, withGlobalColorOption } from './command-registry.ts';
import { corpusDirectoryErrorKind, corpusDirectoryErrorMessage, formatUsageError } from './errors.ts';
import { getPresentation, type StreamStyle } from './presentation.ts';
import { closestCandidate } from './recovery.ts';

const USAGE = `Usage: adr accept <id> --by <identity> [options]

Accept a proposed decision record as its named ratifier (ADR-0044).

Sets status: accepted, provenance.ratifiedBy, and review.decidedAt (now, UTC),
and changes no other line. Nothing is committed: review the diff and open a
pull request. Refuses a record that is not proposed, has an unresolved
objection, lacks its review.quorum of approvals, or would not be valid.

Arguments:
  <id>                ADR id, as shown by adr queue (e.g. 0044)

Options:
  --by <identity>     Required. The human ratifier: @handle, team:slug, or email
  --dir <path>        ADR corpus directory (default: docs/adr)
  --json              Emit { id, path, status, ratifiedBy, decidedAt } as JSON
${renderGlobalColorUsageLine()}
  -h, --help          Show this help and exit

Examples:
  adr queue
  adr accept 0044 --by @octocat

Exit codes: 0 = accepted; 1 = refused (record unchanged); 2 = usage error.
`;

export const ACCEPT_USAGE = USAGE;

const ACCEPT_OPTIONS = withGlobalColorOption(commandOptions('accept'));

function usageError(message: string): number {
  process.stderr.write(formatUsageError(message, USAGE, 'accept', getPresentation().stderr));
  return 2;
}

function refusal(message: string, findings: readonly Finding[] = []): number {
  const style = getPresentation().stderr;
  const lines = [`${style.severity('error')} adr accept refused: ${message}`];
  for (const finding of findings) {
    const field = finding.field ? ` (${finding.field})` : '';
    lines.push(`  ${style.severity(finding.severity)} ${finding.rule}${field}: ${finding.message}`);
  }
  lines.push(style.note('The record was not changed.'));
  process.stderr.write(`${lines.join('\n')}\n`);
  return 1;
}

/** `ADR-0044`, `adr-0044`, and `44` all name `0044`; an exact id always wins. */
function candidateIds(raw: string): string[] {
  const stripped = raw.replace(/^adr-/i, '');
  const padded = /^[0-9]+$/.test(stripped) ? stripped.padStart(4, '0') : stripped;
  return [...new Set([raw, stripped, padded])];
}

function belongsTo(finding: Finding, id: string, path: string): boolean {
  return finding.id === id || finding.path === path;
}

function renderAccepted(
  result: { id: string; title: string; path: string; ratifiedBy: string; decidedAt: string },
  style: StreamStyle,
): string {
  return [
    `${style.status('accepted')} ADR-${result.id}: ${result.title}`,
    `  ${style.label('ratified by')} ${result.ratifiedBy} ${style.note(`at ${result.decidedAt}`)}`,
    `  ${style.path(result.path)}`,
    style.note('Nothing was committed. Review the diff, then open a pull request.'),
    '',
  ].join('\n');
}

export async function runAccept(args: string[]): Promise<number> {
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
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /^Unknown option ['"`]([^'"`]+)['"`]/.exec(message)?.[1];
    if (unknown) {
      const suggestion = closestCandidate(unknown, ACCEPT_OPTIONS);
      return usageError(suggestion ? `Unknown option "${unknown}". Did you mean "${suggestion}"?` : `Unknown option "${unknown}".`);
    }
    return usageError(message);
  }

  if (parsed.positionals.length !== 1) {
    return usageError(
      parsed.positionals.length === 0 ? 'adr accept requires an ADR id.' : 'adr accept takes exactly one ADR id.',
    );
  }
  const rawId = String(parsed.positionals[0]);
  const by = parsed.values.by === undefined ? '' : String(parsed.values.by);
  if (by === '') {
    return usageError('adr accept requires --by <identity>: the human ratifying this decision. It is never inferred.');
  }
  if (!Identity.safeParse(by).success) {
    return usageError(`Invalid --by value "${by}". Expected @handle, team:slug, or an email address.`);
  }

  const dir = String(parsed.values.dir);
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir });
  } catch (error) {
    const kind = corpusDirectoryErrorKind(error, dir);
    if (kind) return usageError(corpusDirectoryErrorMessage(dir, kind));
    throw error;
  }

  const errors = corpus.findings.filter((finding) => finding.severity === 'error');
  let id: string | undefined;
  let matches: typeof corpus.records = [];
  for (const candidate of candidateIds(rawId)) {
    matches = corpus.records.filter((record) => record.frontmatter.id === candidate);
    const invalid = errors.filter((finding) => finding.id === candidate);
    if (matches.length > 0 || invalid.length > 0) {
      id = candidate;
      if (matches.length === 0) return refusal(`ADR "${candidate}" exists but is invalid; fix it first.`, invalid);
      break;
    }
  }
  if (id === undefined) return usageError(`No ADR with id "${rawId}" exists in "${dir}".`);
  if (matches.length > 1) {
    return refusal(`more than one record declares id "${id}": ${matches.map((record) => record.path).join(', ')}.`);
  }

  const record = matches[0]!;
  const recordErrors = errors.filter((finding) => belongsTo(finding, id!, record.path));
  if (recordErrors.length > 0) return refusal(`ADR-${id} has lint errors; fix them first.`, recordErrors);

  const absolutePath = resolve(process.cwd(), record.path);
  const source = await readFile(absolutePath, 'utf8');
  // The clock is read here, at the boundary; the transition itself is pure.
  const decidedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const result = acceptAdrSource({ source, by, decidedAt, path: record.path });
  if (!result.ok) return refusal(result.message, result.findings);

  await writeFile(absolutePath, result.content, 'utf8');

  const accepted = { id, title: record.frontmatter.title, path: record.path, ratifiedBy: by, decidedAt };
  if (parsed.values.json) {
    const json = { id, path: record.path, status: 'accepted', ratifiedBy: by, decidedAt };
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    process.stdout.write(renderAccepted(accepted, getPresentation().stdout));
  }
  return 0;
}
