/**
 * @adrkit/core — the single definition of "does this record govern?".
 *
 * Every surface that answers that question — `adr check`, `adr explain`, the
 * `@adrkit/ci` Action, and `@adrkit/mcp`'s `get_decision_context` — routes through
 * this function, so the same corpus cannot be status-aware over one surface and
 * status-blind over another.
 *
 * Only `accepted` records govern. `draft` and `proposed` are live proposals that have
 * not been ratified; `rejected`, `superseded`, and `deprecated` are history, and
 * reporting them as governing tells a reviewer that a decision the organization
 * explicitly walked away from still binds their change.
 */

import type { Status } from '../schema/adr.schema.ts';

export type DecisionBucket = 'governing' | 'activeProposals' | 'history';

export function decisionBucketFor(status: Status | string): DecisionBucket {
  if (status === 'accepted') return 'governing';
  if (status === 'draft' || status === 'proposed') return 'activeProposals';
  return 'history';
}
