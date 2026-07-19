import type { Adr } from '../schema/adr.schema.ts';
import { resolveAffects, type FiredMatcher, type ResolutionSnapshots } from '../affects/index.ts';
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
  firedMatchers: FiredMatcher[];
}

/**
 * The stable structure `adr check --json` emits and the `@adrkit/ci` Action consumes.
 * Deterministic and pure: identical `(lint, changedFiles, snapshots)` → identical output.
 */
export interface CheckOutcome {
  changedFiles: string[];
  governedBy: GoverningDecision[];
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
  return (dir ?? 'docs/adr').replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Whether a repo-relative changed file is an ADR record under `dir`, using the same
 * flat-directory + filename grammar the corpus loader enforces. Pure string logic —
 * no filesystem access — so a malformed record dropped from `lint.records` is still
 * recognized as a changed record and its `error` findings count toward `ok`.
 */
function isCorpusRecordPath(file: string, dir: string): boolean {
  const prefix = `${dir}/`;
  if (!file.startsWith(prefix)) return false;
  const rest = file.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/')) return false;
  return rest !== TEMPLATE_BASENAME && RECORD_BASENAME.test(rest);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * The single, neutral "resolve governing decisions + validate changed records"
 * implementation, called by both `adr check` (CLI) and the `@adrkit/ci` Action so
 * neither surface depends on the other. Pure: no clock, network, or fs traversal
 * beyond the already-loaded lint result (ADR-0009).
 */
export function checkChanges(input: CheckChangesInput): CheckOutcome {
  const dir = normalizeDir(input.dir);
  const changedFiles = uniqueSorted(input.changedFiles);
  const changedRecords = changedFiles.filter((file) => isCorpusRecordPath(file, dir));
  const changedRecordSet = new Set(changedRecords);

  const resolution = resolveAffects({
    records: input.lint.records,
    changedFiles,
    snapshots: input.snapshots,
    log: input.log,
  });

  const titleById = new Map(
    input.lint.records.map((record) => [record.frontmatter.id, record.frontmatter.title]),
  );
  const governedBy: GoverningDecision[] = resolution.matches.map((match) => ({
    recordId: match.recordId,
    title: titleById.get(match.recordId) ?? '',
    firedMatchers: match.firedMatchers,
  }));

  // Findings kept only for files lint attributes to a changed record. Errors on
  // unchanged records (A5) and corpus-level findings without a record path do not
  // fail the check.
  const changedRecordFindings = input.lint.findings.filter(
    (finding) => finding.path !== undefined && changedRecordSet.has(finding.path),
  );
  const findings = sortFindings([...resolution.findings, ...changedRecordFindings]);
  const ok = !changedRecordFindings.some((finding) => finding.severity === 'error');

  return { changedFiles, governedBy, changedRecords, findings, ok };
}
