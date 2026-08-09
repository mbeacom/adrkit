// @adr 0022 — this file resolves the inbound edge, so ADR-0022's `affects` also names it
// via `packages/core/src/check/**` and the marker is a second, redundant route to the
// same record. It is kept because it is the repository's own working example of the
// declaration rendering; it does not demonstrate the marker-only case, which needs a
// file the corpus reaches by no pattern at all.
import type { Adr } from '../schema/adr.schema.ts';
import { resolveAffects, type ResolutionSnapshots } from '../affects/index.ts';
import { mergeSourceDeclarations, resolveSourceMarkers } from '../markers/resolve.ts';
import type { SourceMarkerBatchScan } from '../markers/read.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';
import {
  bucketDecisions,
  toGoverningDecisions,
  type BucketedDecisions,
  type GoverningDecision,
} from './decisions.ts';

export {
  bucketDecisions,
  toGoverningDecisions,
  type BucketedDecisions,
  type GoverningDecision,
} from './decisions.ts';

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

export interface MarkerScanReport {
  totalCandidates: number;
  limit: number;
  counts: Record<'scanned' | 'absent' | 'unreadable' | 'out-of-tree' | 'skipped', number>;
  absentPaths: string[];
  unreadablePaths: string[];
  outOfTreePaths: string[];
  truncatedPaths: string[];
  skippedPaths: string[];
}

/**
 * The stable structure `adr check --json` emits and the `@adrkit/ci` Action consumes.
 * Deterministic and pure: identical `(lint, changedFiles, snapshots, markerScans)`
 * produces identical output.
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
  /** Present when the caller supplied the pre-scanned marker boundary. */
  markerScan?: MarkerScanReport;
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
  /** Marker I/O performed by the caller; `checkChanges` only resolves these values. */
  markerScans?: SourceMarkerBatchScan;
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

function markerScanReport(batch: SourceMarkerBatchScan): MarkerScanReport {
  const absentPaths: string[] = [];
  const unreadablePaths: string[] = [];
  const outOfTreePaths: string[] = [];
  const truncatedPaths: string[] = [];
  let scanned = 0;

  for (const scan of batch.scans) {
    if (scan.state === 'scanned') scanned += 1;
    if (scan.state === 'absent') absentPaths.push(scan.path);
    if (scan.state === 'unreadable') unreadablePaths.push(scan.path);
    if (scan.state === 'out-of-tree') outOfTreePaths.push(scan.path);
    if (scan.truncated) truncatedPaths.push(scan.path);
  }

  return {
    totalCandidates: batch.totalCandidates,
    limit: batch.limit,
    counts: {
      scanned,
      absent: absentPaths.length,
      unreadable: unreadablePaths.length,
      'out-of-tree': outOfTreePaths.length,
      skipped: batch.skippedPaths.length,
    },
    absentPaths: absentPaths.sort((a, b) => a.localeCompare(b)),
    unreadablePaths: unreadablePaths.sort((a, b) => a.localeCompare(b)),
    outOfTreePaths: outOfTreePaths.sort((a, b) => a.localeCompare(b)),
    truncatedPaths: truncatedPaths.sort((a, b) => a.localeCompare(b)),
    skippedPaths: [...batch.skippedPaths].sort((a, b) => a.localeCompare(b)),
  };
}

function cappedScanFinding(report: MarkerScanReport): Finding | undefined {
  if (report.skippedPaths.length === 0) return undefined;
  const shown = report.skippedPaths.slice(0, 10);
  const remaining = report.skippedPaths.length - shown.length;
  const suffix = remaining > 0 ? `, and ${remaining} more (see markerScan.skippedPaths)` : '';
  return {
    rule: 'marker-scan-capped',
    severity: 'warn',
    message: `Marker scan reached the ${report.limit}-file cap and skipped ${shown.join(', ')}${suffix}`,
    field: 'marker',
  };
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

  const markerResolution = input.markerScans
    ? resolveSourceMarkers({
        records: input.lint.records,
        markers: input.markerScans.scans.flatMap((scan) => scan.markers),
      })
    : { matches: [], findings: [] };
  const governedBy = mergeSourceDeclarations(
    toGoverningDecisions(input.lint.records, resolution.matches),
    input.lint.records,
    markerResolution.matches,
  );
  const buckets = bucketDecisions(governedBy);

  // Findings kept only for files lint attributes to a changed record. Errors on
  // unchanged records (A5) and corpus-level findings without a record path do not
  // fail the check.
  const changedRecordFindings = input.lint.findings.filter(
    (finding) => finding.path !== undefined && changedRecordSet.has(finding.path),
  );
  const markerScan = input.markerScans ? markerScanReport(input.markerScans) : undefined;
  const capped = markerScan ? cappedScanFinding(markerScan) : undefined;
  const findings = sortFindings([
    ...resolution.findings,
    ...markerResolution.findings,
    ...(capped ? [capped] : []),
    ...changedRecordFindings,
  ]);
  const ok = !changedRecordFindings.some((finding) => finding.severity === 'error');

  return {
    changedFiles,
    governedBy,
    governing: buckets.governing,
    activeProposals: buckets.activeProposals,
    history: buckets.history,
    changedRecords,
    findings,
    ...(markerScan ? { markerScan } : {}),
    ok,
  };
}
