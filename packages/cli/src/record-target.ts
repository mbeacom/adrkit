import { resolve } from 'node:path';
import { lintCorpus, type Finding } from '@adrkit/core';
import { corpusDirectoryErrorKind, corpusDirectoryErrorMessage } from './errors.ts';

type CorpusRecord = Awaited<ReturnType<typeof lintCorpus>>['records'][number];

export interface WriteTarget {
  ok: true;
  id: string;
  record: CorpusRecord;
  absolutePath: string;
}

export interface TargetReporters {
  usageError(message: string): number;
  refusal(message: string, findings?: readonly Finding[]): number;
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

/**
 * A record whose YAML does not parse yields findings with a `path` and no `id`, so
 * the file name is the only place its id can be read from.
 */
function namesRecord(finding: Finding, id: string): boolean {
  if (finding.id === id) return true;
  const file = finding.path?.split(/[\\/]/).pop() ?? '';
  return file.startsWith(`${id}-`);
}

/**
 * Resolve the one record a writing command (`accept`, `approve`, `object`, `resolve`)
 * acts on. An unknown id or an unreachable corpus is a usage error (exit 2); a record
 * that exists but is invalid, has lint errors, or shares its id is a refusal (exit 1).
 * Anything other than a target is the exit code the command returns.
 */
export async function resolveWriteTarget(rawId: string, dir: string, report: TargetReporters): Promise<WriteTarget | number> {
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir });
  } catch (error) {
    const kind = corpusDirectoryErrorKind(error, dir);
    if (kind) return report.usageError(corpusDirectoryErrorMessage(dir, kind));
    throw error;
  }

  const errors = corpus.findings.filter((finding) => finding.severity === 'error');
  let id: string | undefined;
  let matches: CorpusRecord[] = [];
  for (const candidate of candidateIds(rawId)) {
    matches = corpus.records.filter((record) => record.frontmatter.id === candidate);
    const invalid = errors.filter((finding) => namesRecord(finding, candidate));
    if (matches.length > 0 || invalid.length > 0) {
      id = candidate;
      if (matches.length === 0) return report.refusal(`ADR "${candidate}" exists but is invalid; fix it first.`, invalid);
      break;
    }
  }
  if (id === undefined) return report.usageError(`No ADR with id "${rawId}" exists in "${dir}".`);
  if (matches.length > 1) {
    return report.refusal(`more than one record declares id "${id}": ${matches.map((record) => record.path).join(', ')}.`);
  }

  const record = matches[0]!;
  const recordErrors = errors.filter((finding) => belongsTo(finding, id!, record.path));
  if (recordErrors.length > 0) return report.refusal(`ADR-${id} has lint errors; fix them first.`, recordErrors);

  return { ok: true, id, record, absolutePath: resolve(process.cwd(), record.path) };
}
