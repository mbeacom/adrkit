/**
 * @adrkit/mcp — the one locale-independent comparator and the canonical orderings
 * every channel uses. Never `String.prototype.localeCompare` (research §R6).
 */

import type { Finding } from '@adrkit/core';

/** The sole code-unit comparator: `a < b ? -1 : a > b ? 1 : 0` over UTF-16 units. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface OrderedSummary {
  readonly id: string;
  readonly sourcePath: string;
}

/** Canonical `(id, sourcePath)` ascending order; sourcePath is the unique tiebreak. */
export function compareByIdThenPath(a: OrderedSummary, b: OrderedSummary): number {
  return compareCodeUnits(a.id, b.id) || compareCodeUnits(a.sourcePath, b.sourcePath);
}

/** Canonical finding order using `sortFindings`' field tuple with the code-unit comparator. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    compareCodeUnits(a.rule, b.rule) ||
    compareCodeUnits(a.id ?? '', b.id ?? '') ||
    compareCodeUnits(a.pattern ?? '', b.pattern ?? '') ||
    compareCodeUnits(a.path ?? '', b.path ?? '') ||
    compareCodeUnits(a.field ?? '', b.field ?? '') ||
    compareCodeUnits(a.message, b.message)
  );
}

export function sortFindingsCanonical(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}

export function sortByIdThenPath<T extends OrderedSummary>(items: readonly T[]): T[] {
  return [...items].sort(compareByIdThenPath);
}
