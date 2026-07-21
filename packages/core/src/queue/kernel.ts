/**
 * @adrkit/core — the pure ARB queue kernel (contracts/kernel.md, data-model.md).
 *
 * `buildQueueReport` is referentially transparent: same `QueueKernelInput` → same
 * `QueueReport`. No ambient clock, no filesystem, no network, no adapter imports.
 * `new Date(callerSuppliedTimestamp)` is used only to normalize explicit frontmatter
 * timestamps to UTC — a deterministic operation. `crypto` (SHA-256) is deterministic
 * and acceptable here.
 */

import type { AdrFrontmatter } from '../schema/adr.schema.ts';
import type { Finding } from '../validate/findings.ts';
import { fingerprintOf } from '../fingerprint/index.ts';
import { compareCodeUnits, sortFindingsCanonical } from '../ordering/index.ts';
import { mapFindingToCorpusFinding } from './findings.ts';
import { sortCorpusFindings, sortItemFindings, sortQueueItems } from './sort.ts';
import {
  type CorpusFinding,
  type ItemFinding,
  type QueueItem,
  type QueueKernelInput,
  type QueueReport,
  type SlaState,
  type Tier,
  type TierLabel,
} from './types.ts';

const TIER_LABELS: Record<Tier, Exclude<TierLabel, null>> = {
  auto: 'expedited routing; human acceptance required',
  async: 'asynchronous human review',
  arb: 'ARB human review',
};

const ITEM_MESSAGES = {
  tierAbsent:
    'review.tier is absent; routing tier cannot be determined — add review.tier: auto|async|arb to this record',
  decidersEmpty:
    'deciders is empty; routing targets cannot be determined — add at least one decider identity to this record',
} as const;

function toUtcInstant(value: string): string {
  return new Date(value).toISOString();
}

function toUtcCalendarDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addCalendarDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function tierLabelFor(tier: Tier | null): TierLabel {
  return tier ? TIER_LABELS[tier] : null;
}

function computeDeadlineDate(frontmatter: AdrFrontmatter): string | null {
  if (frontmatter.reviewBy != null) return frontmatter.reviewBy;
  const queuedAt = frontmatter.review?.queuedAt;
  const slaDays = frontmatter.review?.slaDays;
  if (queuedAt != null && slaDays != null) {
    return addCalendarDays(toUtcCalendarDate(queuedAt), slaDays);
  }
  return null;
}

function computeSlaState(
  frontmatter: AdrFrontmatter,
  deadlineDate: string | null,
  asOf: string,
): SlaState {
  const review = frontmatter.review;
  if (review?.decidedAt != null) return 'decided';
  if (review?.escalatedAt != null) return 'escalated';
  if (deadlineDate != null) {
    if (asOf > deadlineDate) return 'overdue';
    if (asOf === deadlineDate) return 'due';
    return 'within-sla';
  }
  if (review?.queuedAt != null) return 'missing-sla';
  return 'not-queued';
}

function computeItemFindings(frontmatter: AdrFrontmatter): ItemFinding[] {
  const findings: ItemFinding[] = [];
  const review = frontmatter.review;
  const queuedAt = review?.queuedAt;

  // No item finding is generated for the absence of `review` alone (spec §Edge cases):
  // tier-absent fires only when a `review` block is present but omits `tier`.
  if (review !== undefined && review.tier == null) {
    findings.push({ code: 'item.tier-absent', severity: 'info', message: ITEM_MESSAGES.tierAbsent });
  }

  if (frontmatter.reviewBy != null && queuedAt != null) {
    const queuedAtDate = toUtcCalendarDate(queuedAt);
    if (compareCodeUnits(frontmatter.reviewBy, queuedAtDate) < 0) {
      findings.push({
        code: 'item.review-by-before-queued',
        severity: 'warn',
        message: `reviewBy (${frontmatter.reviewBy}) is before queuedAt (${queuedAtDate}); SLA deadline may be inconsistent`,
      });
    }
  }

  const deciders = frontmatter.deciders ?? [];
  if (deciders.length === 0 && queuedAt != null) {
    findings.push({ code: 'item.deciders-empty', severity: 'info', message: ITEM_MESSAGES.decidersEmpty });
  }

  return sortItemFindings(findings);
}

function buildItem(frontmatter: AdrFrontmatter, sourcePath: string, asOf: string): QueueItem {
  const review = frontmatter.review;
  const tier = (review?.tier ?? null) as Tier | null;
  const objections = review?.objections ?? [];
  const deadlineDate = computeDeadlineDate(frontmatter);

  return {
    id: frontmatter.id,
    title: frontmatter.title,
    sourcePath: normalizeSourcePath(sourcePath),
    tier,
    tierLabel: tierLabelFor(tier),
    queuedAt: review?.queuedAt != null ? toUtcInstant(review.queuedAt) : null,
    slaDays: review?.slaDays ?? null,
    reviewBy: frontmatter.reviewBy ?? null,
    slaState: computeSlaState(frontmatter, deadlineDate, asOf),
    deadlineDate,
    routingTargets: [...(frontmatter.deciders ?? [])],
    quorum: review?.quorum ?? null,
    approvalCount: review?.approvals?.length ?? 0,
    unresolvedObjectionCount: objections.filter((o) => o.resolved !== true).length,
    resolvedObjectionCount: objections.filter((o) => o.resolved === true).length,
    escalatedAt: review?.escalatedAt != null ? toUtcInstant(review.escalatedAt) : null,
    decidedAt: review?.decidedAt != null ? toUtcInstant(review.decidedAt) : null,
    itemFindings: computeItemFindings(frontmatter),
  };
}

/** Build a deterministic QueueReport from a corpus snapshot and explicit asOf date. */
export function buildQueueReport(input: QueueKernelInput): QueueReport {
  const { corpus, asOf } = input;
  const recordPaths = new Set(corpus.records.map((record) => record.path));

  // Step 1–2: project excluded-file findings into CorpusFindings.
  const excludedPaths = new Set(
    corpus.findings
      .filter((f: Finding) => f.severity === 'error' && f.path != null && !recordPaths.has(f.path))
      .map((f) => f.path as string),
  );
  const corpusFindings: CorpusFinding[] = sortCorpusFindings(
    corpus.findings
      .filter((f: Finding) => f.path != null && excludedPaths.has(f.path))
      .map((f) => mapFindingToCorpusFinding(f, normalizeSourcePath(f.path as string))),
  );

  // Step 3–6: project proposed records into sorted QueueItems.
  const items = sortQueueItems(
    corpus.records
      .filter((record) => record.frontmatter.status === 'proposed')
      .map((record) => buildItem(record.frontmatter, record.path, asOf)),
  );

  // Step 7: fingerprint over the full corpus (records ordered by id then path, ALL
  // findings canonically ordered) — byte-identical to the @adrkit/mcp projection.
  const orderedRecords = [...corpus.records].sort(
    (a, b) => compareCodeUnits(a.frontmatter.id, b.frontmatter.id) || compareCodeUnits(a.path, b.path),
  );
  const corpusFingerprint = fingerprintOf(
    orderedRecords,
    sortFindingsCanonical(corpus.findings),
    corpus.records.length,
    corpus.checked - corpus.records.length,
  );

  // Step 8: assemble the report with keys in the frozen v1 order.
  return {
    version: '1',
    asOf,
    corpusFingerprint,
    totalItems: items.length,
    totalCorpusFindings: corpusFindings.length,
    itemsWithFindings: items.filter((i) => i.itemFindings.length > 0).length,
    items,
    corpusFindings,
  };
}
