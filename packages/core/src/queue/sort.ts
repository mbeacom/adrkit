/**
 * @adrkit/core — deterministic queue orderings (research.md §R6).
 *
 * Every string comparison uses `compareCodeUnits` (never `localeCompare`). All three
 * sorts are stable and return new arrays; they never mutate their inputs.
 */

import { compareCodeUnits } from '../ordering/index.ts';
import { SLA_STATE_URGENCY_ORDER, type CorpusFinding, type ItemFinding, type QueueItem } from './types.ts';

const SEVERITY_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/** Code-unit comparison where `null` sorts after any non-null value. */
function compareNullableLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareCodeUnits(a, b);
}

/**
 * Sort by: urgency group → deadline date (null last) → queuedAt → id → sourcePath.
 * `not-queued` items have no queuedAt, so step 3 uses `''` and they order by id.
 * `sourcePath` is the final, unique tiebreak because `lintCorpus` retains schema-valid
 * duplicate-id records (id alone is therefore not a total order).
 */
export function sortQueueItems(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      SLA_STATE_URGENCY_ORDER[a.slaState] - SLA_STATE_URGENCY_ORDER[b.slaState] ||
      compareNullableLast(a.deadlineDate, b.deadlineDate) ||
      compareCodeUnits(a.queuedAt ?? '', b.queuedAt ?? '') ||
      compareCodeUnits(a.id, b.id) ||
      compareCodeUnits(a.sourcePath, b.sourcePath),
  );
}

/** Sort corpus findings by: sourcePath → code → severity rank → message. */
export function sortCorpusFindings(findings: readonly CorpusFinding[]): CorpusFinding[] {
  return [...findings].sort(
    (a, b) =>
      compareCodeUnits(a.sourcePath, b.sourcePath) ||
      compareCodeUnits(a.code, b.code) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      compareCodeUnits(a.message, b.message),
  );
}

/** Sort item findings by: code → severity rank → message. */
export function sortItemFindings(findings: readonly ItemFinding[]): ItemFinding[] {
  return [...findings].sort(
    (a, b) =>
      compareCodeUnits(a.code, b.code) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      compareCodeUnits(a.message, b.message),
  );
}
