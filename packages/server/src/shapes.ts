/**
 * The response shapes of `/api/v1`, projected field by field from the SDK's
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md)
 * clauses 1, 3, and 7).
 *
 * Projected rather than passed through, for two reasons. The canonical serializer refuses
 * `undefined`, and the SDK leaves optional fields absent; here "no value" is always `null`, so
 * every object of one kind has the same keys. And a field the SDK adds later does not reach
 * this API until it is added here, so the route shapes change only by an edit to this file.
 * Every string is repository text, served as data.
 */

import type {
  CorpusIssue,
  DecisionEdge,
  DecisionRecord,
  GovernanceEvidence,
  GoverningDecision,
  PathGovernance,
  QueueEntry,
  QueueView,
} from '@adrkit/sdk/src/index.ts';

export function recordSummaryOf(record: DecisionRecord) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    standing: record.standing,
    date: record.date,
    path: record.path,
    tags: [...record.tags],
    supersedes: [...record.supersedes],
    supersededBy: record.supersededBy ?? null,
  };
}

/** `records/{id}`: the summary plus the raw, unrendered Markdown body. */
export function recordOf(record: DecisionRecord) {
  return { ...recordSummaryOf(record), body: record.body };
}

export function issueOf(issue: CorpusIssue) {
  return { code: issue.code, severity: issue.severity, message: issue.message, path: issue.path ?? null };
}

export function edgeOf(edge: DecisionEdge) {
  return { from: edge.from, to: edge.to, kind: edge.kind };
}

export function queueOf(view: QueueView) {
  return { entries: view.entries.map(queueEntryOf), issues: view.issues.map(issueOf) };
}

function queueEntryOf(entry: QueueEntry) {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    tier: entry.tier,
    slaState: entry.slaState,
    deadline: entry.deadline,
    approvalCount: entry.approvalCount,
    quorum: entry.quorum,
    unresolvedObjectionCount: entry.unresolvedObjectionCount,
    resolvedObjectionCount: entry.resolvedObjectionCount,
    routingTargets: [...entry.routingTargets],
    itemFindingCount: entry.itemFindingCount,
  };
}

/** Fixed text for `governing` (clause 7). Never built from a request or an error. */
export const GOVERNING_TEXT = Object.freeze({
  evidence:
    'This server holds the corpus, not the source tree, so it never reads the file at this path: inbound @adr markers are not scanned, and evidence is affects matches only. Run adr explain in a checkout for marker evidence.',
  withheld:
    'Resolution was withheld because the corpus has errors: a record that failed to load may be the one that governs this path. The corpus issues are listed; this is not an "ungoverned" answer.',
});

/**
 * `governing`'s data. `resolution` says whether the groups are an answer or were withheld,
 * so an empty `governing` list never reads as "ungoverned" when the corpus has errors.
 */
export function governingOf(answer: PathGovernance, corpusHasErrors: boolean) {
  return {
    path: answer.path,
    governing: answer.governing.map(governingDecisionOf),
    activeProposals: answer.activeProposals.map(governingDecisionOf),
    history: answer.history.map(governingDecisionOf),
    issues: answer.issues.map(issueOf),
    evidence: { markers: 'not-read', note: GOVERNING_TEXT.evidence },
    resolution: corpusHasErrors ? { state: 'withheld', note: GOVERNING_TEXT.withheld } : { state: 'resolved', note: null },
  };
}

function governingDecisionOf(decision: GoverningDecision) {
  return {
    id: decision.id,
    title: decision.title,
    status: decision.status,
    standing: decision.standing,
    matchedBy: decision.matchedBy.map(evidenceOf),
  };
}

function evidenceOf(evidence: GovernanceEvidence) {
  return evidence.kind === 'affects'
    ? { kind: 'affects', type: evidence.type, pattern: evidence.pattern, line: null }
    : { kind: 'marker', type: null, pattern: null, line: evidence.line };
}
