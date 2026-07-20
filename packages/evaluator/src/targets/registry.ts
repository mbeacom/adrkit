/**
 * @adrkit/evaluator — target resolver registry.
 *
 * A registry is a pure lookup from `AffectsType` to a deterministic resolver port.
 * A lookup miss makes the corresponding matcher inert (`resolver-absent`), never a
 * failure. Ports are built only by trusted composition code — never selected by JSON.
 */

import type { AffectsType } from '@adrkit/core';
import type { TargetResolutionRegistry, TargetResolverPort } from '../types.ts';

export function createTargetResolutionRegistry(
  ports: readonly TargetResolverPort[],
): TargetResolutionRegistry {
  const byType = new Map<AffectsType, TargetResolverPort>();
  for (const port of ports) byType.set(port.type, port);
  return { get: (type: AffectsType) => byType.get(type) };
}

/** A registry with no resolvers — every target matcher is `resolver-absent` inert. */
export const emptyTargetResolutionRegistry: TargetResolutionRegistry = {
  get: () => undefined,
};
