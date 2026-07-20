/**
 * @adrkit/evaluator — built-in `package` target resolver.
 *
 * Reuses core's neutral `matchPackagePattern` grammar (name + optional semver range)
 * over a complete dependency inventory, per dependency — without copying the grammar
 * or importing semver directly (that stays a core-internal concern). A missing
 * `dependencies` inventory is inert (backing-absent); an unparseable pattern resolves
 * to the empty set. Pure.
 */

import { matchPackagePattern, parsePackagePattern } from '@adrkit/core';
import { makeTargetId } from './canonical.ts';
import type { AffectsMatcher, TargetResolution, TargetResolutionContext, TargetResolverPort } from '../types.ts';

export function createPackageTargetResolver(): TargetResolverPort {
  return {
    type: 'package',
    resolve(matcher: AffectsMatcher, context: TargetResolutionContext): TargetResolution {
      const inventory = context.inventory.dependencies;
      if (inventory === undefined) {
        return { status: 'inert', ids: [], reason: 'affects-resolvable.backing-absent' };
      }
      if (!parsePackagePattern(matcher.pattern)) {
        return { status: 'resolved', ids: [], reason: 'affects-resolvable.zero-targets' };
      }
      const ids = inventory
        .filter(
          (dependency) =>
            matchPackagePattern(matcher.pattern, [
              { name: dependency.name, version: dependency.version ?? '0.0.0-unversioned' },
            ]).matched,
        )
        .map((dependency) => makeTargetId('package', dependency.name));
      return {
        status: 'resolved',
        ids,
        reason: ids.length > 0 ? 'affects-resolvable.ok' : 'affects-resolvable.zero-targets',
      };
    },
  };
}
