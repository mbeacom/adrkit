/**
 * @adrkit/core — resolving inbound source markers against the corpus.
 *
 * The mirror of `resolveAffects`: same `Finding` vocabulary, same determinism
 * contract (identical inputs → identical output), same purity (no filesystem, no
 * clock). The difference is only which end of the edge declared it.
 */

import type { Adr } from '../schema/adr.schema.ts';
import { toGoverningDecisions, type GoverningDecision } from '../check/index.ts';
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

function compareDeclarations(a: MarkerDeclaration, b: MarkerDeclaration): number {
  return a.path.localeCompare(b.path) || a.line - b.line || a.ref.localeCompare(b.ref);
}

/** Bind markers to the records they name, and report the ones that bind to nothing. */
export function resolveSourceMarkers(input: ResolveSourceMarkersInput): ResolveSourceMarkersResult {
  const ids = new Set(input.records.map((record) => record.frontmatter.id));
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
    if (!ids.has(marker.id)) {
      findings.push(danglingFinding(marker));
      continue;
    }

    const declarations = byRecord.get(marker.id) ?? [];
    declarations.push({ path: marker.path, line: marker.line, ref: marker.ref });
    byRecord.set(marker.id, declarations);
  }

  const matches = [...byRecord.entries()]
    .map(([recordId, declaredBy]) => ({ recordId, declaredBy: declaredBy.sort(compareDeclarations) }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId));

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
): GoverningDecision[] {
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

  return [...merged, ...markerOnly].sort((a, b) => a.recordId.localeCompare(b.recordId));
}
