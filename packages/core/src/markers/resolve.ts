/**
 * @adrkit/core — resolving inbound source markers against the corpus.
 *
 * The mirror of `resolveAffects`: same `Finding` vocabulary, same determinism
 * contract (identical inputs → identical output), same purity (no filesystem, no
 * clock). The difference is only which end of the edge declared it.
 */

import type { Adr } from '../schema/adr.schema.ts';
import { toGoverningDecisions, type GoverningDecision } from '../check/decisions.ts';
import { compareCodeUnits } from '../ordering/index.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';
import type { MarkerDeclaration, MarkerMatch, SourceMarker } from './types.ts';

export interface ResolveSourceMarkersInput {
  records: readonly Adr[];
  markers: readonly SourceMarker[];
}

export interface ResolveSourceMarkersResult {
  matches: MarkerMatch[];
  findings: Finding[];
}

/** Compatibility name retained for consumers of the explain-only v0.4.0 contract. */
export type ExplainedDecision = GoverningDecision;

/**
 * A marker naming a record the corpus does not have.
 *
 * `warn`, not `error`, and the distinction is deliberate. The corpus owns its own
 * references — a dangling `relatesTo` is an `error` because the record is wrong. A
 * marker lives in a file the corpus does not own and cannot be required to be complete
 * for; the closest existing analogue is `corpus-file-skipped`, also a `warn`: a claim
 * that could not be honored, reported without failing the run.
 *
 * The path and line live in the message because `explain` renders findings without
 * their `path` field, and a marker warning is useless if you cannot find the line.
 */
function danglingFinding(marker: SourceMarker): Finding {
  return {
    rule: 'dangling-marker',
    severity: 'warn',
    message: `Source marker "@adr ${marker.ref}" in ${marker.path}:${marker.line} does not resolve to a record in the corpus`,
    path: marker.path,
    field: 'marker',
    pattern: marker.ref,
  };
}

/**
 * A log-qualified marker (`@adr payments:0012`). Nothing is wrong with it; this corpus
 * simply is not the log it names. Reported at `info` for the same reason
 * `affects-unresolvable` is: inert here, not broken.
 */
function unresolvableFinding(marker: SourceMarker): Finding {
  return {
    rule: 'marker-unresolvable',
    severity: 'info',
    message: `Source marker "@adr ${marker.ref}" in ${marker.path}:${marker.line} names another decision log and is inert against this corpus`,
    path: marker.path,
    field: 'marker',
    pattern: marker.ref,
  };
}

function terminalLiveSuccessor(
  record: Adr,
  byId: ReadonlyMap<string, Adr>,
): string | undefined {
  let next = record.frontmatter.supersededBy;
  const seen = new Set([record.frontmatter.id]);

  while (next) {
    if (seen.has(next)) return undefined;
    seen.add(next);

    const successor = byId.get(next);
    if (!successor) return undefined;
    if (successor.frontmatter.status === 'accepted') return successor.frontmatter.id;
    if (
      successor.frontmatter.status === 'draft' ||
      successor.frontmatter.status === 'proposed'
    ) {
      return successor.frontmatter.id;
    }
    if (successor.frontmatter.status !== 'superseded') return undefined;
    next = successor.frontmatter.supersededBy;
  }

  return undefined;
}

/**
 * A source declaration naming history is a stronger stale claim than ordinary prose.
 * It still binds to that historical record — no successor is silently substituted —
 * but the warning gives the author an exact line and, when the chain resolves, the
 * terminal live successor to consider. Advisory marker findings never affect an exit
 * code (ADR-0022).
 */
function staleFinding(
  marker: SourceMarker,
  record: Adr,
  byId: ReadonlyMap<string, Adr>,
): Finding | undefined {
  const status = record.frontmatter.status;
  if (status !== 'superseded' && status !== 'rejected' && status !== 'deprecated') {
    return undefined;
  }

  const successor = status === 'superseded' ? terminalLiveSuccessor(record, byId) : undefined;
  const action = successor
    ? `update it to "@adr ${successor}" or re-affirm ${marker.id}`
    : `update the marker or re-affirm ${marker.id}`;
  return {
    rule: 'stale-marker',
    severity: 'warn',
    message: `Source marker "@adr ${marker.ref}" in ${marker.path}:${marker.line} names ${status} ADR ${marker.id}; ${action}`,
    path: marker.path,
    field: 'marker',
    pattern: marker.ref,
  };
}

function compareDeclarations(a: MarkerDeclaration, b: MarkerDeclaration): number {
  return compareCodeUnits(a.path, b.path) || a.line - b.line || compareCodeUnits(a.ref, b.ref);
}

/** Bind markers to the records they name, and report the ones that bind to nothing. */
export function resolveSourceMarkers(input: ResolveSourceMarkersInput): ResolveSourceMarkersResult {
  const byId = new Map(input.records.map((record) => [record.frontmatter.id, record]));
  const byRecord = new Map<string, MarkerDeclaration[]>();
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const marker of input.markers) {
    const key = `${marker.path}\0${marker.line}\0${marker.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (marker.log) {
      findings.push(unresolvableFinding(marker));
      continue;
    }
    const record = byId.get(marker.id);
    if (!record) {
      findings.push(danglingFinding(marker));
      continue;
    }

    const stale = staleFinding(marker, record, byId);
    if (stale) findings.push(stale);

    const declarations = byRecord.get(marker.id) ?? [];
    declarations.push({ path: marker.path, line: marker.line, ref: marker.ref });
    byRecord.set(marker.id, declarations);
  }

  const matches = [...byRecord.entries()]
    .map(([recordId, declaredBy]) => ({ recordId, declaredBy: declaredBy.sort(compareDeclarations) }))
    .sort((a, b) => compareCodeUnits(a.recordId, b.recordId));

  return { matches, findings: sortFindings(findings) };
}

/**
 * Fold marker matches into the decisions the `affects` resolver produced.
 *
 * A decision reached only by a pattern comes back untouched — no `declaredBy` key at
 * all — so `adr check --json` and every consumer written against the pre-marker shape
 * see byte-identical output. A decision reached only by a marker still governs; it
 * simply has an empty `firedMatchers`, which is what tells a consumer the two apart.
 */
export function mergeSourceDeclarations(
  patternDecisions: readonly GoverningDecision[],
  records: readonly Adr[],
  markerMatches: readonly MarkerMatch[],
): ExplainedDecision[] {
  if (markerMatches.length === 0) return [...patternDecisions];

  const pending = new Map(markerMatches.map((match) => [match.recordId, match.declaredBy]));
  const merged = patternDecisions.map((decision) => {
    const declaredBy = pending.get(decision.recordId);
    if (!declaredBy) return decision;
    pending.delete(decision.recordId);
    return { ...decision, declaredBy };
  });

  const markerOnly = toGoverningDecisions(
    records,
    [...pending.keys()].map((recordId) => ({ recordId, firedMatchers: [] })),
  ).map((decision) => ({ ...decision, declaredBy: pending.get(decision.recordId) ?? [] }));

  return [...merged, ...markerOnly].sort((a, b) => compareCodeUnits(a.recordId, b.recordId));
}
