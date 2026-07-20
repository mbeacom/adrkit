import type { Adr } from '../schema/adr.schema.ts';
import { sortFindings, type Finding, type FindingSeverity } from '../validate/findings.ts';
import type { CatalogSnapshot } from './catalog.ts';
import { isAlwaysInertType, matchEntityPattern } from './inert.ts';
import { matchPackagePattern, type ChangedDependency } from './matchers/package.ts';
import { matchPathPattern } from './matchers/path.ts';

export type { CatalogPort, CatalogSnapshot, CatalogSnapshotEntity, EntityId } from './catalog.ts';
export {
  deriveChangedDependenciesFromBunLockDiff,
  matchPackagePattern,
  parsePackagePattern,
  type ChangedDependency,
  type PackageMatcherResult,
  type ParsedPackagePattern,
} from './matchers/package.ts';
// Neutral repo-relative path-glob primitive. Exposed so `@adrkit/evaluator` can reuse
// the exact matcher grammar for `path` target resolution instead of duplicating it
// (research §R4). Evaluator-specific target-registry concepts stay out of core.
export { matchPathPattern, type PathMatcherResult } from './matchers/path.ts';

export interface ResolutionSnapshots {
  changedDependencies?: readonly ChangedDependency[];
  catalog?: CatalogSnapshot;
}

export interface ResolveAffectsInput {
  records: readonly Adr[];
  changedFiles: readonly string[];
  snapshots?: ResolutionSnapshots;
  log?: string;
}

export interface FiredMatcher {
  type: string;
  pattern: string;
}

export interface AffectsMatch {
  recordId: string;
  firedMatchers: FiredMatcher[];
}

export interface ResolveAffectsResult {
  matches: AffectsMatch[];
  findings: Finding[];
}

type Matcher = Adr['frontmatter']['affects'][number] & {
  type: string;
  pattern: string;
  repo?: string;
  negate?: boolean;
};

interface MatcherEvaluation {
  matched: boolean;
  findings: Finding[];
}

function compareFiredMatcher(a: FiredMatcher, b: FiredMatcher): number {
  return a.type.localeCompare(b.type) || a.pattern.localeCompare(b.pattern);
}

function uniqueSortedFiredMatchers(matchers: readonly FiredMatcher[]): FiredMatcher[] {
  const byKey = new Map<string, FiredMatcher>();
  for (const matcher of matchers) {
    byKey.set(`${matcher.type}\0${matcher.pattern}`, matcher);
  }
  return [...byKey.values()].sort(compareFiredMatcher);
}

function affectsFinding(
  record: Adr,
  matcher: Matcher,
  rule: string,
  severity: FindingSeverity,
  message: string,
): Finding {
  return {
    rule,
    severity,
    message,
    id: record.frontmatter.id,
    path: record.path,
    field: `affects.${matcher.type}`,
    pattern: matcher.pattern,
  };
}

function matcherAppliesToLog(matcher: Matcher, log: string | undefined): boolean {
  return !matcher.repo || matcher.repo === log;
}

function evaluateMatcher(
  record: Adr,
  matcher: Matcher,
  changedFiles: readonly string[],
  snapshots: ResolutionSnapshots | undefined,
): MatcherEvaluation {
  if (matcher.type === 'path') {
    const result = matchPathPattern(matcher.pattern, changedFiles);
    if (result.badPattern) {
      return {
        matched: false,
        findings: [
          affectsFinding(
            record,
            matcher,
            'affects-bad-pattern',
            'warn',
            result.badPattern === 'leading-slash'
              ? `Path matcher "${matcher.pattern}" must be repo-relative and must not start with "/".`
              : `Path matcher "${matcher.pattern}" is not a valid glob pattern.`,
          ),
        ],
      };
    }
    return { matched: result.matched, findings: [] };
  }

  if (matcher.type === 'package') {
    const result = matchPackagePattern(matcher.pattern, snapshots?.changedDependencies);
    if (result.unresolvable) {
      return {
        matched: false,
        findings: [
          affectsFinding(
            record,
            matcher,
            'affects-unresolvable',
            'info',
            `Package matcher "${matcher.pattern}" requires a changed-dependency snapshot and is inert.`,
          ),
        ],
      };
    }
    if (result.badPattern) {
      return {
        matched: false,
        findings: [
          affectsFinding(
            record,
            matcher,
            'affects-bad-pattern',
            'warn',
            `Package matcher "${matcher.pattern}" must be "name" or "name@<valid semver range>".`,
          ),
        ],
      };
    }
    return { matched: result.matched, findings: [] };
  }

  if (matcher.type === 'entity') {
    const result = matchEntityPattern(matcher.pattern, changedFiles, snapshots?.catalog);
    if (result.unresolvable) {
      return {
        matched: false,
        findings: [
          affectsFinding(
            record,
            matcher,
            'affects-unresolvable',
            'info',
            `Entity matcher "${matcher.pattern}" has no catalog snapshot and is inert.`,
          ),
        ],
      };
    }
    return { matched: result.matched, findings: [] };
  }

  if (isAlwaysInertType(matcher.type)) {
    return {
      matched: false,
      findings: [
        affectsFinding(
          record,
          matcher,
          'affects-unresolvable',
          'info',
          `${matcher.type} matcher "${matcher.pattern}" has no backing snapshot in this phase and is inert.`,
        ),
      ],
    };
  }

  // TODO(phase: schema-evolution): Allow unknown affects `type` values to pass
  // validation as a warning so this forward-compat branch is reachable for real records.
  // Requires an ADR-0002/0009 schema decision.
  return {
    matched: false,
    findings: [
      affectsFinding(
        record,
        matcher,
        'affects-unknown-type',
        'warn',
        `Affects matcher type "${matcher.type}" is not recognized by this adrkit version and was ignored.`,
      ),
    ],
  };
}

export function resolveAffects(input: ResolveAffectsInput): ResolveAffectsResult {
  const matches: AffectsMatch[] = [];
  const findings: Finding[] = [];

  for (const record of input.records) {
    const firedMatchers: FiredMatcher[] = [];
    let suppressed = false;

    for (const matcher of (record.frontmatter.affects ?? []) as readonly Matcher[]) {
      if (!matcherAppliesToLog(matcher, input.log)) continue;

      const result = evaluateMatcher(record, matcher, input.changedFiles, input.snapshots);
      findings.push(...result.findings);

      if (!result.matched) continue;
      if (matcher.negate) {
        suppressed = true;
      } else {
        firedMatchers.push({ type: matcher.type, pattern: matcher.pattern });
      }
    }

    if (!suppressed && firedMatchers.length > 0) {
      matches.push({
        recordId: record.frontmatter.id,
        firedMatchers: uniqueSortedFiredMatchers(firedMatchers),
      });
    }
  }

  return {
    matches: matches.sort((a, b) => a.recordId.localeCompare(b.recordId)),
    findings: sortFindings(findings),
  };
}
