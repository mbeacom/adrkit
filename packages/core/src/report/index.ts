/**
 * @adrkit/core — canonical shapes and serializers for `adr lint --json`, `adr new --json`,
 * and `adr explain --json`.
 *
 * Until ADR-0031 action item 4 these three were assembled inline in
 * `packages/cli/src/index.ts`, so the CLI JSON contract for them existed nowhere in core
 * while `adr queue` (`formatQueueReportJson`) and `adr graph` (`renderJsonGraph`) already
 * came from core formatters. Each command now builds its report here and prints the
 * formatter's string; the CLI supplies inputs only.
 *
 * **Byte-for-byte unchanged.** Every key, its insertion order, and every conditional key's
 * presence rule is carried over exactly from the inline assembly, and the formatters are
 * `JSON.stringify(report, null, 2) + "\n"` like the queue's. The CLI JSON is a documented
 * contract with an additive-only obligation (ADR-0031 clause 5), so a convergence that moved
 * a key would have been a break dressed as hygiene. `packages/cli/test/json-report.test.ts`
 * pins the output against goldens captured from the inline assembly before it was removed.
 *
 * Pure: no clock, no filesystem, no git. The `--as-of` provenance on an explain report is
 * resolved by the CLI (it may run git) and handed in as plain fields.
 */

import type { GoverningDecision } from '../check/decisions.ts';
import type { MarkerScanState, SourceMarkerScan } from '../markers/read.ts';
import { MARKER_DECLARATION_FILE_CAP, MARKER_HEADER_WINDOW_BYTES } from '../markers/scan.ts';
import { bucketDecisions } from '../check/decisions.ts';
import type { NewAdrResult } from '../scaffold/new.ts';
import type { DecisionAsOf, DecisionsAsOf } from '../temporal/decisions.ts';
import type { Finding } from '../validate/findings.ts';
import type { LintCorpusResult } from '../validate/index.ts';

/* ------------------------------------------------------------------ *
 * adr lint --json
 * ------------------------------------------------------------------ */

/** `adr lint --json`: how many records were checked, and the findings in canonical order. */
export interface LintReport {
  checked: number;
  findings: Finding[];
}

/**
 * Build the lint report. `findings` must already be in canonical order (`sortFindings`); the
 * CLI sorts once and uses the same array for its exit code and human view.
 */
export function buildLintReport(result: Pick<LintCorpusResult, 'checked'>, findings: Finding[]): LintReport {
  return { checked: result.checked, findings };
}

export function formatLintReportJson(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * adr new --json
 * ------------------------------------------------------------------ */

/**
 * `adr new --json`: the allocated id and the display path of the written record. The
 * scaffolded `content` is deliberately not part of it — the file is on disk.
 */
export interface NewAdrReport {
  id: string;
  path: string;
}

export function buildNewAdrReport(result: Pick<NewAdrResult, 'id' | 'path'>): NewAdrReport {
  return { id: result.id, path: result.path };
}

export function formatNewAdrReportJson(report: NewAdrReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * adr explain --json
 * ------------------------------------------------------------------ */

/**
 * The `markers` block: what the inbound-marker scan of the asked-about file reached, so
 * "declares nothing" and "could not look" never render alike (ADR-0016).
 */
export interface ExplainMarkerScan {
  state: MarkerScanState;
  windowBytes: number;
  scannedBytes?: number;
  fileBytes?: number;
  truncated: boolean;
  declarationLimit: number;
  totalDeclarations: number;
  omittedDeclarations: number;
  declared: Array<{ ref: string; line: number }>;
}

export function explainMarkerScan(scan: SourceMarkerScan): ExplainMarkerScan {
  const omittedDeclarations = scan.omittedMarkers ?? 0;
  return {
    state: scan.state,
    windowBytes: MARKER_HEADER_WINDOW_BYTES,
    ...(scan.scannedBytes === undefined ? {} : { scannedBytes: scan.scannedBytes }),
    ...(scan.fileBytes === undefined ? {} : { fileBytes: scan.fileBytes }),
    truncated: scan.truncated,
    declarationLimit: MARKER_DECLARATION_FILE_CAP,
    totalDeclarations: scan.markers.length + omittedDeclarations,
    omittedDeclarations,
    declared: scan.markers.map((marker) => ({ ref: marker.ref, line: marker.line })),
  };
}

/** How an `--as-of` value was resolved. `commit`/`committedAt` are present for a git ref. */
export interface ExplainAsOfResolution {
  /** Exactly what the user typed. */
  requested: string;
  /** The UTC calendar date the corpus is placed on. */
  date: string;
  resolvedFrom: 'date' | 'ref';
  commit?: string;
  committedAt?: string;
}

/**
 * The `asOf` block, present only when `--as-of` was given. Additive: the present-tense
 * `governing`, `activeProposals`, and `history` keys beside it keep their meaning (ADR-0039).
 */
export interface ExplainAsOf {
  requested: string;
  date: string;
  resolvedFrom: 'date' | 'ref';
  commit?: string;
  committedAt?: string;
  governing: DecisionAsOf[];
  activeProposals: DecisionAsOf[];
  history: DecisionAsOf[];
  notYetRecorded: DecisionAsOf[];
  undetermined: DecisionAsOf[];
}

export interface ExplainReport {
  path: string;
  asOf?: ExplainAsOf;
  governedBy: GoverningDecision[];
  governing: GoverningDecision[];
  activeProposals: GoverningDecision[];
  history: GoverningDecision[];
  markers: ExplainMarkerScan;
  findings: Finding[];
}

export interface ExplainReportInput {
  path: string;
  /** The inbound-marker scan of `path`, reported on both branches. */
  scan: SourceMarkerScan;
  /**
   * Every decision reaching `path`, in `mergeSourceDeclarations` order. Omit on the
   * corpus-error branch, where the report answers with empty groups.
   */
  governedBy?: GoverningDecision[];
  /** The `--as-of` resolution, when the flag was given. */
  asOf?: ExplainAsOfResolution;
  /**
   * The as-of view of `governedBy`. Omitted with `asOf` set means the corpus did not parse:
   * the resolution is still reported, with empty groups, because what was asked is a fact
   * independent of whether it could be answered.
   */
  asOfView?: DecisionsAsOf;
  /** Findings in canonical order: the corpus's on the error branch, else resolution's. */
  findings: Finding[];
}

function explainAsOf(resolved: ExplainAsOfResolution, view: DecisionsAsOf | undefined): ExplainAsOf {
  return {
    requested: resolved.requested,
    date: resolved.date,
    resolvedFrom: resolved.resolvedFrom,
    ...(resolved.commit === undefined ? {} : { commit: resolved.commit }),
    ...(resolved.committedAt === undefined ? {} : { committedAt: resolved.committedAt }),
    governing: view?.governing ?? [],
    activeProposals: view?.activeProposals ?? [],
    history: view?.history ?? [],
    notYetRecorded: view?.notYetRecorded ?? [],
    undetermined: view?.undetermined ?? [],
  };
}

export function buildExplainReport(input: ExplainReportInput): ExplainReport {
  const governedBy = input.governedBy ?? [];
  const buckets = bucketDecisions(governedBy);
  return {
    path: input.path,
    ...(input.asOf === undefined ? {} : { asOf: explainAsOf(input.asOf, input.asOfView) }),
    governedBy,
    governing: buckets.governing,
    activeProposals: buckets.activeProposals,
    history: buckets.history,
    markers: explainMarkerScan(input.scan),
    findings: input.findings,
  };
}

export function formatExplainReportJson(report: ExplainReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
