/**
 * @adrkit/evaluator — per-rule evaluation context.
 *
 * Assembled once by the orchestrator after `schema-valid` passes. Rules read only
 * from this immutable context; none performs I/O.
 */

import type { Adr } from '@adrkit/core';
import type { Pass0Input, ProposalResolution } from '../types.ts';

export interface RuleContext {
  readonly input: Pass0Input;
  /** The typed proposal (schema-valid passed). */
  readonly proposed: Adr;
  readonly resolution: ProposalResolution;
  /** Full corpus records, INCLUDING the candidate (data-model §2). */
  readonly corpusRecords: readonly Adr[];
  /** Accepted ADRs in the corpus, EXCLUDING the candidate. */
  readonly acceptedRecords: readonly Adr[];
  readonly evaluationDate: string;
}

/** Records in the corpus that are accepted and are not the candidate proposal. */
export function acceptedRecordsExcludingCandidate(
  records: readonly Adr[],
  proposalPath: string,
): readonly Adr[] {
  return records.filter(
    (record) => record.frontmatter.status === 'accepted' && record.path !== proposalPath,
  );
}
