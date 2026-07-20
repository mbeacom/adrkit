/**
 * @adrkit/evaluator — canonical target normalization + record resolution (T035, R4/ADR-0009).
 *
 * Resolves a record's `affects` matchers to a finite canonical target-id set, honoring
 * ADR-0009 semantics: union non-negated matches, subtract matching negations, require
 * at least one positive matcher (negation-only ⇒ empty), and apply a `repo` qualifier
 * only when it equals the caller-supplied current resolution `log` (a different-repo
 * qualifier contributes no local match). The current log is passed explicitly to every
 * resolver port; it is never inferred from a record's source `log`.
 */

import type { Adr, AffectsType } from '@adrkit/core';
import { canonicalTargetKey } from '../keys.ts';
import { byCodeUnit } from '../compare.ts';
import type {
  CanonicalTargetId,
  CanonicalTargetKey,
  TargetInventorySnapshots,
  TargetResolutionContext,
  TargetResolutionRegistry,
} from '../types.ts';

/** Normalize a repo-relative path id to posix form (no leading `./`, no backslashes). */
export function normalizePathId(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function makeTargetId(kind: AffectsType, id: string): CanonicalTargetId {
  return { kind, id: kind === 'path' ? normalizePathId(id) : id };
}

/** The outcome of resolving a single applied `affects` matcher. */
export interface MatcherResolution {
  readonly type: AffectsType;
  readonly pattern: string;
  readonly negate: boolean;
  /** `resolved` includes a different-repo matcher (deterministic empty locally). */
  readonly status: 'resolved' | 'inert-backing' | 'inert-resolver';
  readonly ids: readonly CanonicalTargetId[];
}

export interface RecordTargetResolution {
  /** Final, unique, canonically-ordered target ids (positive − negated). */
  readonly targets: readonly CanonicalTargetId[];
  readonly targetKeys: ReadonlySet<CanonicalTargetKey>;
  /** Per-applied-matcher outcomes, so each matcher can be validated independently (C3, finding #2). */
  readonly matchers: readonly MatcherResolution[];
  readonly hasMatchers: boolean;
  readonly hasPositiveMatcher: boolean;
}

/** True if any matcher could not be resolved (missing inventory or resolver port). */
export function anyMatcherInert(resolution: RecordTargetResolution): boolean {
  return resolution.matchers.some((matcher) => matcher.status !== 'resolved');
}

function sortedUnique(ids: Iterable<CanonicalTargetId>): CanonicalTargetId[] {
  const byKey = new Map<CanonicalTargetKey, CanonicalTargetId>();
  for (const id of ids) byKey.set(canonicalTargetKey(id), id);
  return [...byKey.values()].sort((a, b) => byCodeUnit(canonicalTargetKey(a), canonicalTargetKey(b)));
}

/** Resolve one record's affects matchers against the registry + inventory. */
export function resolveRecordTargets(
  record: Adr,
  registry: TargetResolutionRegistry,
  inventory: TargetInventorySnapshots,
  resolutionLog: string | undefined,
): RecordTargetResolution {
  const context: TargetResolutionContext = { ...(resolutionLog !== undefined ? { log: resolutionLog } : {}), inventory };
  const positive = new Map<CanonicalTargetKey, CanonicalTargetId>();
  const negated = new Set<CanonicalTargetKey>();
  const matcherResolutions: MatcherResolution[] = [];
  const matchers = record.frontmatter.affects;
  let hasPositiveMatcher = false;

  for (const matcher of matchers) {
    const type = matcher.type;
    if (!matcher.negate) hasPositiveMatcher = true;

    // repo qualifier: a different-repo matcher applies to another repo and contributes no
    // local match — it resolves deterministically to the empty set locally.
    if (matcher.repo !== undefined && matcher.repo !== resolutionLog) {
      matcherResolutions.push({ type, pattern: matcher.pattern, negate: matcher.negate, status: 'resolved', ids: [] });
      continue;
    }
    const port = registry.get(type);
    if (!port) {
      matcherResolutions.push({ type, pattern: matcher.pattern, negate: matcher.negate, status: 'inert-resolver', ids: [] });
      continue;
    }
    const resolution = port.resolve(matcher, context);
    if (resolution.status === 'inert') {
      matcherResolutions.push({ type, pattern: matcher.pattern, negate: matcher.negate, status: 'inert-backing', ids: [] });
      continue;
    }
    matcherResolutions.push({ type, pattern: matcher.pattern, negate: matcher.negate, status: 'resolved', ids: resolution.ids });
    for (const id of resolution.ids) {
      const key = canonicalTargetKey(id);
      if (matcher.negate) negated.add(key);
      else positive.set(key, id);
    }
  }

  const finalIds = [...positive.entries()].filter(([key]) => !negated.has(key)).map(([, id]) => id);
  const targets = sortedUnique(finalIds);
  return {
    targets,
    targetKeys: new Set(targets.map(canonicalTargetKey)),
    matchers: matcherResolutions,
    hasMatchers: matchers.length > 0,
    hasPositiveMatcher,
  };
}
