/**
 * @adrkit/evaluator — identity directory resolution.
 *
 * Pure resolution over an immutable identity-directory snapshot (R9). Resolves a
 * principal ref (a direct human or a team) to a single active human, or reports
 * zero/ambiguous. Used by `decider-resolvable` and named-human routing. No I/O.
 */

import type { IdentityDirectorySnapshot, Principal, PrincipalRef } from '../types.ts';

export type IdentityResolution =
  | { readonly status: 'resolved'; readonly human: PrincipalRef }
  | { readonly status: 'zero' }
  | { readonly status: 'ambiguous' };

/** Indexed, pure view over an identity snapshot. */
export interface IdentityIndex {
  resolveToActiveHuman(ref: PrincipalRef): IdentityResolution;
  isActiveHuman(ref: PrincipalRef): boolean;
  isTeam(ref: PrincipalRef): boolean;
}

export function buildIdentityIndex(directory: IdentityDirectorySnapshot): IdentityIndex {
  const principalsById = new Map<PrincipalRef, Principal>();
  for (const principal of directory.principals) {
    principalsById.set(principal.id, principal);
  }
  const teamMembersById = new Map<PrincipalRef, readonly PrincipalRef[]>();
  for (const team of directory.teams) {
    teamMembersById.set(team.id, team.members);
  }

  function isActiveHuman(ref: PrincipalRef): boolean {
    const principal = principalsById.get(ref);
    return principal !== undefined && principal.kind === 'human' && principal.active;
  }

  function isTeam(ref: PrincipalRef): boolean {
    if (teamMembersById.has(ref)) return true;
    const principal = principalsById.get(ref);
    return principal !== undefined && principal.kind === 'team';
  }

  function activeHumansForTeam(ref: PrincipalRef): PrincipalRef[] {
    const members = teamMembersById.get(ref) ?? [];
    const seen = new Set<PrincipalRef>();
    const humans: PrincipalRef[] = [];
    for (const member of members) {
      if (seen.has(member)) continue;
      if (isActiveHuman(member)) {
        seen.add(member);
        humans.push(member);
      }
    }
    return humans;
  }

  function resolveToActiveHuman(ref: PrincipalRef): IdentityResolution {
    if (isTeam(ref)) {
      const humans = activeHumansForTeam(ref);
      if (humans.length === 1) return { status: 'resolved', human: humans[0] as PrincipalRef };
      return humans.length === 0 ? { status: 'zero' } : { status: 'ambiguous' };
    }
    if (isActiveHuman(ref)) return { status: 'resolved', human: ref };
    return { status: 'zero' };
  }

  return { resolveToActiveHuman, isActiveHuman, isTeam };
}
