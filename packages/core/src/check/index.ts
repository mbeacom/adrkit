// @adr 0021 — this file carries the inbound-edge field but is not a *defining* file of
// that decision, so ADR-0021's `affects` patterns deliberately do not name it. This is
// the case the marker exists for, dogfooded on adrkit's own corpus.
import type { Adr, Status } from '../schema/adr.schema.ts';
import { resolveAffects, type AffectsMatch, type FiredMatcher, type ResolutionSnapshots } from '../affects/index.ts';
import { decisionBucketFor, type DecisionBucket } from '../status/bucket.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';

/**
 * The full result of `lintCorpus` — records, findings, and the checked count.
 * `checkChanges` takes the whole result (not just `records`) because `lintCorpus`
 * drops malformed files from `records` while keeping their `error` findings; those
 * errors must still count toward `ok` when the malformed file was changed (RC3/R1).
 */
export interface CheckLintResult {
  records: Adr[];
  findings: Finding[];
  checked: number;
}

export interface GoverningDecision {
  recordId: string;
  title: string;
  /**
   * The record's status. Present so no consumer has to assume a matched record is
   * `accepted` — a `rejected` or `superseded` record can match a path just as easily.
   */
  status: Status;
  /** Which of the three buckets this record falls into, per `decisionBucketFor`. */
  bucket: DecisionBucket;
  /** The successor, when this record was superseded. Lets a reader follow the chain. */
  supersededBy?: string;
  /** The record's own `affects` matchers that fired against the path — the outbound edge. */
  firedMatchers: FiredMatcher[];
}

/**
 * The stable structure `adr check --json` emits and the `@adrkit/ci` Action consumes.
 * Deterministic and pure: identical `(lint, changedFiles, snapshots)` → identical output.
 */
export interface CheckOutcome {
  changedFiles: string[];
  /**
   * Every record whose matchers fired, regardless of status — the resolver's raw union.
   * Retained for consumers written against the pre-bucketing shape; prefer `governing`.
   */
  governedBy: GoverningDecision[];
  /** `accepted` records only. These are the decisions that actually bind the change. */
  governing: GoverningDecision[];
  /** `draft`/`proposed` records that touch the change but have not been ratified. */
  activeProposals: GoverningDecision[];
  /** `rejected`/`superseded`/`deprecated` records that once covered the change. */
  history: GoverningDecision[];
  changedRecords: string[];
  findings: Finding[];
  ok: boolean;
}

export interface CheckChangesInput {
  lint: CheckLintResult;
  changedFiles: readonly string[];
  /** Corpus directory (default `docs/adr`) used to identify changed records. */
  dir?: string;
  snapshots?: ResolutionSnapshots;
  /** Optional current-repo identity for scoped (`repo`-qualified) matchers. */
  log?: string;
}

const RECORD_BASENAME = /^\d{4,}-.+\.md$/;
const TEMPLATE_BASENAME = '0000-template.md';

function normalizeDir(dir: string | undefined): string {
  const forward = (dir ?? 'docs/adr').replace(/\\/g, '/');
  // Strip trailing slashes without a regex (avoids super-linear scanning on
  // pathological input — the changed-file paths are attacker-controlled).
  let end = forward.length;
  while (end > 0 && forward.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  const stripped = forward.slice(0, end);
  // A root corpus ("." or now-empty) is the repo root — no path prefix, so
  // repo-relative changed files (which never start with "./") still match.
  return stripped === '.' ? '' : stripped;
}

function toForwardSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Whether a repo-relative changed file is an ADR record under `dir`, using the same
 * flat-directory + filename grammar the corpus loader enforces. Pure string logic —
 * no filesystem access — so a malformed record dropped from `lint.records` is still
 * recognized as a changed record and its `error` findings count toward `ok`.
 */
function isCorpusRecordPath(file: string, dir: string): boolean {
  // An empty dir (root corpus) yields an empty prefix, not "/".
  const prefix = dir ? `${dir}/` : '';
  if (!file.startsWith(prefix)) return false;
  const rest = file.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/')) return false;
  return rest !== TEMPLATE_BASENAME && RECORD_BASENAME.test(rest);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Turn resolver matches into status-carrying decisions. A match whose record is not in
 * `records` (dropped by lint as malformed) cannot be classified, so it is reported with
 * the neutral `draft` status and lands in `activeProposals` rather than silently
 * claiming to govern.
 */
export function toGoverningDecisions(
  records: readonly Adr[],
  matches: readonly AffectsMatch[],
): GoverningDecision[] {
  const byId = new Map(records.map((record) => [record.frontmatter.id, record]));
  return matches.map((match) => {
    const frontmatter = byId.get(match.recordId)?.frontmatter;
    const status: Status = frontmatter?.status ?? 'draft';
    return {
      recordId: match.recordId,
      title: frontmatter?.title ?? '',
      status,
      bucket: decisionBucketFor(status),
      ...(frontmatter?.supersededBy ? { supersededBy: frontmatter.supersededBy } : {}),
      firedMatchers: match.firedMatchers,
    };
  });
}

export interface BucketedDecisions<T extends GoverningDecision = GoverningDecision> {
  governing: T[];
  activeProposals: T[];
  history: T[];
}

/** Partition decisions into the three buckets, preserving the input order within each. */
export function bucketDecisions<T extends GoverningDecision>(decisions: readonly T[]): BucketedDecisions<T> {
  const buckets: BucketedDecisions<T> = { governing: [], activeProposals: [], history: [] };
  for (const decision of decisions) buckets[decision.bucket].push(decision);
  return buckets;
}

/**
 * The single, neutral "resolve governing decisions + validate changed records"
 * implementation, called by both `adr check` (CLI) and the `@adrkit/ci` Action so
 * neither surface depends on the other. Pure: no clock, network, or fs traversal
 * beyond the already-loaded lint result (ADR-0009).
 */
export function checkChanges(input: CheckChangesInput): CheckOutcome {
  const dir = normalizeDir(input.dir);
  const changedFiles = uniqueSorted(input.changedFiles.map(toForwardSlash));
  const changedRecords = changedFiles.filter((file) => isCorpusRecordPath(file, dir));
  const changedRecordSet = new Set(changedRecords);

  const resolution = resolveAffects({
    records: input.lint.records,
    changedFiles,
    snapshots: input.snapshots,
    log: input.log,
  });

  const governedBy = toGoverningDecisions(input.lint.records, resolution.matches);
  const buckets = bucketDecisions(governedBy);

  // Findings kept only for files lint attributes to a changed record. Errors on
  // unchanged records (A5) and corpus-level findings without a record path do not
  // fail the check.
  const changedRecordFindings = input.lint.findings.filter(
    (finding) => finding.path !== undefined && changedRecordSet.has(finding.path),
  );
  const findings = sortFindings([...resolution.findings, ...changedRecordFindings]);
  const ok = !changedRecordFindings.some((finding) => finding.severity === 'error');

  return {
    changedFiles,
    governedBy,
    governing: buckets.governing,
    activeProposals: buckets.activeProposals,
    history: buckets.history,
    changedRecords,
    findings,
    ok,
  };
}
