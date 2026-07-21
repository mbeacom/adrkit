/**
 * @adrkit/core — ARB queue types (data-model.md §1, §4–§9).
 *
 * Pure type declarations plus the single frozen `SLA_STATE_URGENCY_ORDER` constant.
 * No runtime logic lives here; the kernel, sort, findings, and format modules own it.
 */

import type { LintCorpusResult } from '../validate/index.ts';

/** The seven SLA states (data-model.md §1). */
export type SlaState =
  | 'decided'
  | 'escalated'
  | 'overdue'
  | 'due'
  | 'within-sla'
  | 'missing-sla'
  | 'not-queued';

/** Ascending urgency rank; lower is more urgent. Sort key #1 (research.md §R6). */
export const SLA_STATE_URGENCY_ORDER: Record<SlaState, number> = {
  overdue: 0,
  escalated: 1,
  due: 2,
  'within-sla': 3,
  'missing-sla': 4,
  'not-queued': 5,
  decided: 6,
};

/** Closed set of routing tier values (schema `review.tier`). */
export type Tier = 'auto' | 'async' | 'arb';

/** Deterministic human label derived from `tier` (FR-016); null when tier is absent. */
export type TierLabel =
  | 'expedited routing; human acceptance required'
  | 'asynchronous human review'
  | 'ARB human review'
  | null;

/** A finding for a file that could not be projected into a QueueItem. Always error. */
export interface CorpusFinding {
  sourcePath: string;
  code: string;
  severity: 'error';
  message: string;
}

/** A finding attached to a specific QueueItem. Always info or warn severity. */
export interface ItemFinding {
  code: string;
  severity: 'info' | 'warn';
  message: string;
}

/** A single schema-valid `proposed` ADR record projected into the queue. */
export interface QueueItem {
  id: string;
  title: string;
  sourcePath: string;

  tier: Tier | null;
  tierLabel: TierLabel;

  queuedAt: string | null;
  slaDays: number | null;
  reviewBy: string | null;

  slaState: SlaState;
  deadlineDate: string | null;

  routingTargets: string[];
  quorum: number | null;

  approvalCount: number;
  unresolvedObjectionCount: number;
  resolvedObjectionCount: number;

  escalatedAt: string | null;
  decidedAt: string | null;

  itemFindings: ItemFinding[];
}

/** The top-level queue report. `version` is always the string "1". */
export interface QueueReport {
  version: '1';
  asOf: string;
  corpusFingerprint: string;
  totalItems: number;
  totalCorpusFindings: number;
  itemsWithFindings: number;
  items: QueueItem[];
  corpusFindings: CorpusFinding[];
}

/** All inputs required by the queue kernel. No defaults; every value is explicit. */
export interface QueueKernelInput {
  /** Direct result of `lintCorpus()`; the kernel does all projection internally. */
  corpus: LintCorpusResult;
  /** UTC calendar date `"YYYY-MM-DD"` for SLA computation; resolved by the caller. */
  asOf: string;
}
