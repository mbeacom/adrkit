import { type AffectsMatch } from '../affects/index.ts';
import type { MarkerDeclaration } from '../markers/types.ts';
import type { Adr, Status } from '../schema/adr.schema.ts';
import { decisionBucketFor, type DecisionBucket } from '../status/bucket.ts';

export interface GoverningDecision {
  recordId: string;
  title: string;
  /** The record's status; a matched record is not necessarily accepted. */
  status: Status;
  /** Which governance bucket this record belongs to. */
  bucket: DecisionBucket;
  /** The successor, when this record was superseded. */
  supersededBy?: string;
  /** The record's own `affects` matchers that fired — the outbound edge. */
  firedMatchers: AffectsMatch['firedMatchers'];
  /** Source locations that declared this record — the inbound edge. */
  declaredBy?: MarkerDeclaration[];
}

/** Turn resolver matches into status-carrying decisions. */
export function toGoverningDecisions(
  records: readonly Adr[],
  matches: readonly AffectsMatch[],
): GoverningDecision[] {
  const byId = new Map(records.map((record) => [record.frontmatter.id, record]));
  return matches.map((match) => {
    const frontmatter = byId.get(match.recordId)?.frontmatter;
    const status: Status = frontmatter?.status ?? 'draft';
    return {
      recordId: match.recordId,
      title: frontmatter?.title ?? '',
      status,
      bucket: decisionBucketFor(status),
      ...(frontmatter?.supersededBy ? { supersededBy: frontmatter.supersededBy } : {}),
      firedMatchers: match.firedMatchers,
    };
  });
}

export interface BucketedDecisions<T extends GoverningDecision = GoverningDecision> {
  governing: T[];
  activeProposals: T[];
  history: T[];
}

/** Partition decisions into the three buckets, preserving input order. */
export function bucketDecisions<T extends GoverningDecision>(
  decisions: readonly T[],
): BucketedDecisions<T> {
  const buckets: BucketedDecisions<T> = { governing: [], activeProposals: [], history: [] };
  for (const decision of decisions) buckets[decision.bucket].push(decision);
  return buckets;
}
