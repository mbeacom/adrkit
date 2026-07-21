/**
 * @adrkit/mcp — re-export shim.
 *
 * The comparator and canonical orderings were promoted to `@adrkit/core`
 * (`packages/core/src/ordering/index.ts`). This module preserves every existing
 * `../corpus/ordering` import site while the single implementation now lives in core.
 */

export {
  compareByIdThenPath,
  compareCodeUnits,
  compareFindings,
  sortByIdThenPath,
  sortFindingsCanonical,
  type OrderedSummary,
} from '@adrkit/core';
