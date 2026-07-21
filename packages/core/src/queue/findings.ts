/**
 * @adrkit/core — corpus finding mapping (data-model.md §6, research.md §R2).
 *
 * Maps a core `Finding` for an EXCLUDED file (one that could not be projected into a
 * QueueItem) to a queue `CorpusFinding`. Schema-valid records with warn/info lint
 * findings are never routed through here — that filtering is the kernel's job.
 */

import type { Finding } from '../validate/findings.ts';
import type { CorpusFinding } from './types.ts';

const ONE_WAY_DOOR_AUTO_MESSAGE =
  'one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)';

/**
 * Closed `Finding.rule` → `CorpusFinding.code` map (data-model.md §6). Any rule not
 * listed here — including any future/unknown rule — falls back to `corpus.schema-invalid`.
 */
export const RULE_TO_CORPUS_CODE: Readonly<Record<string, string>> = {
  'file-read': 'corpus.read-error',
  'frontmatter-parse': 'corpus.parse-error',
  'frontmatter-fence': 'corpus.parse-error',
  'one-way-door-disallows-auto': 'corpus.one-way-door-auto-tier',
  'required-field': 'corpus.schema-invalid',
  'invalid-type': 'corpus.schema-invalid',
  'invalid-enum-value': 'corpus.schema-invalid',
  'invalid-format': 'corpus.schema-invalid',
  'invalid-size': 'corpus.schema-invalid',
  'strict-unknown-key': 'corpus.schema-invalid',
  'unique-items': 'corpus.schema-invalid',
  'contract-refinement': 'corpus.schema-invalid',
  'superseded-requires-supersededBy': 'corpus.schema-invalid',
  'supersededBy-requires-superseded-status': 'corpus.schema-invalid',
  'accepted-requires-decider-unless-imported': 'corpus.schema-invalid',
  'agent-accepted-requires-ratifier': 'corpus.schema-invalid',
};

function messageFor(code: string, finding: Finding): string {
  switch (code) {
    case 'corpus.read-error':
      return `Cannot read file: ${finding.message}`;
    case 'corpus.one-way-door-auto-tier':
      return ONE_WAY_DOOR_AUTO_MESSAGE;
    default:
      // corpus.parse-error and corpus.schema-invalid pass the finding message through.
      return finding.message;
  }
}

/** Map a single excluded-file `Finding` to a `CorpusFinding` (always error severity). */
export function mapFindingToCorpusFinding(finding: Finding, sourcePath: string): CorpusFinding {
  const code = RULE_TO_CORPUS_CODE[finding.rule] ?? 'corpus.schema-invalid';
  return { sourcePath, code, severity: 'error', message: messageFor(code, finding) };
}
