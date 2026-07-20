/**
 * @adrkit/evaluator — built-in `path` target resolver.
 *
 * Reuses core's neutral repo-relative path-glob primitive (`matchPathPattern`) over a
 * complete tracked-path inventory — it never copies the grammar. A missing
 * `trackedPaths` inventory is inert (backing-absent); a bad/leading-slash pattern
 * resolves to the empty set (⇒ affects-resolvable zero-targets, not a throw). Pure.
 */

import { matchPathPattern } from '@adrkit/core';
import { makeTargetId } from './canonical.ts';
import type { AffectsMatcher, TargetResolution, TargetResolutionContext, TargetResolverPort } from '../types.ts';

export function createPathTargetResolver(): TargetResolverPort {
  return {
    type: 'path',
    resolve(matcher: AffectsMatcher, context: TargetResolutionContext): TargetResolution {
      const inventory = context.inventory.trackedPaths;
      if (inventory === undefined) {
        return { status: 'inert', ids: [], reason: 'affects-resolvable.backing-absent' };
      }
      const ids = inventory
        .filter((path) => matchPathPattern(matcher.pattern, [path]).matched)
        .map((path) => makeTargetId('path', path));
      return {
        status: 'resolved',
        ids,
        reason: ids.length > 0 ? 'affects-resolvable.ok' : 'affects-resolvable.zero-targets',
      };
    },
  };
}
