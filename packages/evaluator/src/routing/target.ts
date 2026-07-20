/**
 * @adrkit/evaluator — named-human routing target (T047, R9/C7).
 *
 * Resolves a single active human in fixed source order: (1) proposal `deciders`, (2)
 * CODEOWNERS owners for the proposal's resolved paths, (3) catalog owners for its
 * resolved entities. Exact source-local ordering: deciders in declaration order; unique
 * paths sorted by canonical path key, each taking the LAST matching CODEOWNERS rule's
 * owners in declaration order; unique entities sorted by canonical target key, each
 * appending catalog owners in snapshot order. Candidates are stable-deduplicated at
 * first occurrence (never globally identity-sorted). A missing/inactive direct human is
 * skipped; the first team that does not resolve to exactly one active human is an
 * ambiguity barrier that immediately yields `unresolved`.
 */

import { matchPathPattern } from '@adrkit/core';
import { canonicalTargetKey } from '../keys.ts';
import { byCodeUnit } from '../compare.ts';
import type { IdentityIndex } from '../identity/directory.ts';
import type { CanonicalTargetId, IdentityDirectorySnapshot, PrincipalRef, RouteTarget } from '../types.ts';

type Via = 'deciders' | 'codeowners' | 'catalog';

interface Candidate {
  readonly ref: PrincipalRef;
  readonly via: Via;
}

const VIA_CODE: Record<Via, 'route.target.deciders' | 'route.target.codeowners' | 'route.target.catalog-owner'> = {
  deciders: 'route.target.deciders',
  codeowners: 'route.target.codeowners',
  catalog: 'route.target.catalog-owner',
};

function orderedCandidates(
  deciders: readonly PrincipalRef[],
  directory: IdentityDirectorySnapshot,
  resolvedPaths: readonly string[],
  resolvedEntities: readonly CanonicalTargetId[],
): Candidate[] {
  const candidates: Candidate[] = [];

  // (1) deciders in declaration order
  for (const decider of deciders) candidates.push({ ref: decider, via: 'deciders' });

  // (2) CODEOWNERS for unique resolved paths sorted by canonical path key
  const codeowners = directory.codeowners ?? [];
  const uniquePaths = [...new Set(resolvedPaths)].sort(byCodeUnit);
  for (const path of uniquePaths) {
    let lastMatch: readonly PrincipalRef[] | undefined;
    for (const rule of codeowners) {
      if (matchPathPattern(rule.pattern, [path]).matched) lastMatch = rule.owners;
    }
    if (lastMatch) {
      for (const owner of lastMatch) candidates.push({ ref: owner, via: 'codeowners' });
    }
  }

  // (3) catalog owners for unique resolved entities sorted by canonical target key
  const catalogOwners = directory.catalogOwners;
  const uniqueEntities = [...new Map(resolvedEntities.map((id) => [canonicalTargetKey(id), id])).values()].sort((a, b) =>
    byCodeUnit(canonicalTargetKey(a), canonicalTargetKey(b)),
  );
  for (const entity of uniqueEntities) {
    const owners =
      catalogOwners !== undefined && Object.hasOwn(catalogOwners, entity.id)
        ? catalogOwners[entity.id] ?? []
        : [];
    for (const owner of owners) candidates.push({ ref: owner, via: 'catalog' });
  }

  return candidates;
}

/**
 * Resolve the escalation target. Called only when escalation is proven; a non-escalated
 * run uses `route.target.not-required` at the routing layer.
 */
export function resolveRouteTarget(
  index: IdentityIndex,
  deciders: readonly PrincipalRef[],
  directory: IdentityDirectorySnapshot,
  resolvedPaths: readonly string[],
  resolvedEntities: readonly CanonicalTargetId[],
): RouteTarget {
  const candidates = orderedCandidates(deciders, directory, resolvedPaths, resolvedEntities);
  const seen = new Set<PrincipalRef>();

  for (const candidate of candidates) {
    if (seen.has(candidate.ref)) continue; // stable dedupe at first occurrence
    seen.add(candidate.ref);

    const resolution = index.resolveToActiveHuman(candidate.ref);
    if (resolution.status === 'resolved') {
      return { kind: 'resolved', human: resolution.human, via: candidate.via, code: VIA_CODE[candidate.via] };
    }
    // A team that does not resolve to exactly one active human is an ambiguity barrier.
    if (index.isTeam(candidate.ref)) {
      return { kind: 'unresolved', code: 'route.target.unresolved' };
    }
    // Otherwise a missing/inactive direct human is skipped.
  }

  return { kind: 'unresolved', code: 'route.target.unresolved' };
}
