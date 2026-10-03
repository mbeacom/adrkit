import type { CheckOutcome, Finding, GoverningDecision } from '@adrkit/core';

/**
 * Stable hidden marker used to locate this Action's own comment for in-place
 * updates. Comment identity is marker + author (R5/FR-005) — never stored state
 * (ADR-0004). Keep this string stable across versions.
 *
 * **It must also stay the exact first line of every rendered body.** A token whose
 * login is unknowable — the default `GITHUB_TOKEN` is one — claims its prior comment
 * by "author is a bot" plus that first-line position, so moving the marker behind a
 * preamble silently reinstates a fresh comment per push
 * ([ADR-0026](../../../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md),
 * [#107](https://github.com/mbeacom/adrkit/issues/107)). `github.ts:markerLeadsBody`
 * is the reader; `comment-render.test.ts` asserts it for both renderers below.
 */
export const CI_COMMENT_MARKER = '<!-- adrkit:ci -->';

const HEADING = '### Decisions governing this change';
const EMPTY_STATE = 'No governing decisions for the changed files.';
const NO_ACCEPTED_STATE =
  'No **accepted** decisions govern the changed files. Records below matched but do not bind this change.';
const PROPOSALS_SUMMARY = 'Active proposals touching this change';
const PROPOSALS_NOTE = 'These are not yet ratified and do not bind this change:';
const HISTORY_SUMMARY = 'Historical records that once covered this change';
const HISTORY_NOTE = 'These no longer bind this change, and are listed for context only:';

// The governing list stays expanded up to this many records, so the common case reads
// at a glance. Above it the list collapses behind a summary carrying the count; the
// one-line tally under the heading keeps the result legible either way. Proposals and
// history never bind the change, so they are always collapsed.
const GOVERNING_EXPANDED_MAX = 10;
const DETAILS_CLOSE = '</details>';

// Display cap for a pathological governing list. The underlying set is never
// trimmed semantically (R6) — this only shortens what is rendered.
const MAX_GOVERNING = 50;

// Display cap for the declarations on one decision. Unlike `firedMatchers`, which the
// corpus authors, a declaration is authored by the pull request: one file's 8 KB header
// window holds ~630 `// @adr 0021` lines, and the path in each is the author's too.
// Bounding what is rendered is what keeps that content out of the body budget below.
const MAX_DECLARATIONS = 10;
const MAX_MARKER_PATHS_PER_STATE = 10;
const MAX_MARKER_CLAIMS = 20;

/**
 * GitHub rejects a comment body over 65,536 characters with a 422. That is not a
 * permission error, so it would propagate out of the Action and fail the job — which
 * would let pull-request-authored marker content change the check's result, exactly
 * what ADR-0021 says it must never do. The body is bounded here instead.
 */
const MAX_COMMENT_CHARS = 65536;
const TRUNCATION_NOTICE =
  '- …output truncated to fit GitHub’s comment size limit; run `adr check` locally for the complete result.';

// A finding's path and rule are the blocking identity a reviewer needs. Optional
// detail must not make that whole line too large for the body limiter to retain.
const MAX_FINDING_FIELD_CHARS = 256;
const MAX_FINDING_MESSAGE_CHARS = 1024;

/**
 * Where the rendered record ids link to. Comment bodies are not rendered relative to
 * the repository, so every link is absolute: `{serverUrl}/{repository}/blob/{ref}/{path}`.
 * `serverUrl` comes from the workflow context rather than being assumed, so a GitHub
 * Enterprise Server instance links to itself.
 */
export interface CommentLinks {
  /** e.g. `https://github.com`; a trailing slash is tolerated. */
  serverUrl: string;
  /** `owner/name`. */
  repository: string;
  /** The commit record links point at: the pull request's head. */
  ref: string;
  /** Record id → repo-relative record path, from the corpus the Action linted. */
  recordPaths: ReadonlyMap<string, string>;
}

export interface RenderCommentOptions {
  /** When absent, record ids render as plain bold text, exactly as before links existed. */
  links?: CommentLinks;
}

/**
 * Percent-encode one URL path segment so it cannot end a markdown link destination.
 * `encodeURIComponent` leaves `(`, `)`, `'`, `!`, `*`, and `~` alone; an unbalanced
 * parenthesis is exactly what closes `[text](url)` early, so those are encoded too.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[()'!*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function repositoryUrl(links: CommentLinks): string {
  // Trailing slashes are trimmed without a regex, as core's `normalizeDir` does.
  let end = links.serverUrl.length;
  while (end > 0 && links.serverUrl.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return `${links.serverUrl.slice(0, end)}/${links.repository.split('/').map(encodeSegment).join('/')}`;
}

/**
 * The blob URL for a repo-relative path, or `undefined` when the path cannot be one.
 *
 * Record paths come from corpus filenames and declaration paths from the pull request,
 * so both are untrusted. Anything absolute, escaping the tree, or carrying a control
 * character renders unlinked rather than producing a link that points somewhere else.
 */
function blobUrl(links: CommentLinks, path: string, line?: number): string | undefined {
  const forward = path.replace(/\\/g, '/');
  if (forward.length === 0 || forward.startsWith('/') || /[\u0000-\u001f\u007f]/.test(forward)) {
    return undefined;
  }
  const segments = forward.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  const anchor = line !== undefined && Number.isInteger(line) && line > 0 ? `#L${line}` : '';
  return `${repositoryUrl(links)}/blob/${encodeSegment(links.ref)}/${segments.map(encodeSegment).join('/')}${anchor}`;
}

/** A record id in bold, linked to the record when the corpus knows its path. */
function recordReference(recordId: string, links: CommentLinks | undefined): string {
  const label = `**${recordId}**`;
  const path = links?.recordPaths.get(recordId);
  const url = links && path !== undefined ? blobUrl(links, path) : undefined;
  return url ? `[${label}](${url})` : label;
}

/**
 * A short provenance line, so a reader can tell which push the comment describes. It
 * names the head commit the links point at, not the merge commit the checkout linted.
 */
function footerLine(links: CommentLinks): string {
  const commit = `${repositoryUrl(links)}/commit/${encodeSegment(links.ref)}`;
  return `<sub>Records linked at head [${code(links.ref.slice(0, 7))}](${commit}). Run ${code('adr explain <path>')} locally to see why a file is governed.</sub>`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * One line that answers "what governs this?" before any detail, so the result stays
 * legible when the lists below are long or collapsed.
 */
function tallyLine(outcome: CheckOutcome): string {
  const accepted = outcome.governing.length;
  const parts = [
    `**${accepted}** accepted ${accepted === 1 ? 'decision governs' : 'decisions govern'} ${plural(outcome.changedFiles.length, 'changed file')}`,
  ];
  if (outcome.activeProposals.length > 0) parts.push(plural(outcome.activeProposals.length, 'active proposal'));
  if (outcome.history.length > 0) parts.push(plural(outcome.history.length, 'historical record'));
  return parts.join(' · ');
}

/**
 * Wrap lines in a collapsed `<details>` block. GitHub renders markdown inside it only
 * after a blank line, and the summary is fixed text plus a count, so no untrusted
 * content reaches the HTML.
 */
function collapsed(summary: string, body: readonly string[]): string[] {
  return ['<details>', `<summary>${summary}</summary>`, '', ...body, '', DETAILS_CLOSE];
}

function changedRecordFindings(outcome: CheckOutcome): Finding[] {
  const changed = new Set(outcome.changedRecords);
  return outcome.findings.filter(
    (finding) =>
      finding.field !== 'marker' && finding.path !== undefined && changed.has(finding.path),
  );
}

/**
 * Render a value as an inline code span it cannot escape.
 *
 * A changed path is named by the pull request, and a filename may legally hold a
 * backtick. `` `src/x`[Approved](https://evil.example)`y.ts` `` closes the span early
 * and the rest renders as a live link inside a comment authored by the bot. Per
 * CommonMark 6.1 a span delimited by N backticks can carry any run shorter than N, so
 * the delimiter is chosen to outrun the content; a leading or trailing backtick also
 * needs the padding space the same rule strips back out.
 *
 * Control characters are escaped rather than delimited: a filename may contain a
 * newline, which ends the bullet no matter how the span is fenced.
 */
function code(value: string): string {
  const safe = value.replace(
    /[\u0000-\u001f\u007f]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
  let longestRun = 0;
  for (const run of safe.matchAll(/`+/g)) longestRun = Math.max(longestRun, run[0].length);
  const fence = '`'.repeat(longestRun + 1);
  const pad = safe.startsWith('`') || safe.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${safe}${pad}${fence}`;
}

function boundedDetail(value: string, limit: number, label: string): string {
  if (value.length <= limit) return value;
  const suffix = `… [${label} truncated]`;
  return `${value.slice(0, Math.max(0, limit - suffix.length))}${suffix}`;
}

function renderFindingLine(finding: Finding): string {
  const where = finding.path ? code(finding.path) : '(corpus)';
  const field = finding.field
    ? ` (${code(boundedDetail(finding.field, MAX_FINDING_FIELD_CHARS, 'field'))})`
    : '';
  const message = boundedDetail(finding.message, MAX_FINDING_MESSAGE_CHARS, 'message');
  return `- ${where} — ${code(finding.rule)}${field}: ${message}`;
}

function markerScanHealthLines(report: NonNullable<CheckOutcome['markerScan']>): string[] {
  const states: readonly [string, readonly string[]][] = [
    ['absent', report.absentPaths],
    ['unreadable', report.unreadablePaths],
    ['out-of-tree', report.outOfTreePaths],
    ['skipped at the scan cap', report.skippedPaths],
  ];
  const unavailable = states.reduce((total, [, paths]) => total + paths.length, 0);
  const omitted = report.declarations.omitted;
  if (unavailable === 0 && omitted === 0) return [];

  const lines = ['#### Marker scan health', ''];
  if (unavailable > 0) {
    lines.push(
      `Marker scanning could not inspect ${unavailable} changed file${unavailable === 1 ? '' : 's'}:`,
    );
    for (const [label, paths] of states) {
      if (paths.length === 0) continue;
      const shown = paths.slice(0, MAX_MARKER_PATHS_PER_STATE).map(code).join(', ');
      const remaining = paths.length - Math.min(paths.length, MAX_MARKER_PATHS_PER_STATE);
      lines.push(
        `- ${paths.length} ${label}: ${shown}${remaining > 0 ? `, and ${remaining} more` : ''}`,
      );
    }
    lines.push(
      '',
      'These files could not be inspected for `@adr` markers; an empty result does not prove that no marker is present.',
    );
  }
  if (omitted > 0) {
    const declarations = report.declarations;
    if (unavailable > 0) lines.push('');
    lines.push(
      `Marker declaration limits retained ${declarations.retained} of ${declarations.total} declarations and omitted ${declarations.omitted}:`,
      `- ${declarations.perFileOmitted} at the ${declarations.perFileLimit}-per-file limit`,
      `- ${declarations.batchOmitted} at the ${declarations.batchLimit}-per-batch limit`,
    );
  }
  return lines;
}

function markerClaimLines(outcome: CheckOutcome): string[] {
  const changed = new Set(outcome.changedFiles);
  const claims = outcome.findings.filter(
    (finding) =>
      finding.field === 'marker' &&
      finding.path !== undefined &&
      changed.has(finding.path) &&
      finding.rule !== 'marker-scan-capped',
  );
  if (claims.length === 0) return [];

  const shown = claims.slice(0, MAX_MARKER_CLAIMS);
  const lines = [
    '#### Marker claims needing attention',
    '',
    'Marker scanning was healthy for these changed files, but these claims need attention:',
  ];
  for (const finding of shown) {
    lines.push(`- ${code(finding.path ?? '(unknown)')} — ${code(boundedDetail(finding.message, MAX_FINDING_MESSAGE_CHARS, 'message'))}`);
  }
  const remaining = claims.length - shown.length;
  if (remaining > 0) {
    lines.push(`- …and ${remaining} more marker claim${remaining === 1 ? '' : 's'}`);
  }
  return lines;
}

/**
 * One decision as a bullet, annotated with its status and — for superseded records —
 * the successor that replaced it, so a reviewer is never shown a bare record id and
 * left to assume it is in force (#39).
 */
function renderDecisionLines(
  decision: GoverningDecision,
  withStatus: boolean,
  links: CommentLinks | undefined,
): string[] {
  const status = withStatus ? ` _(${decision.status})_` : '';
  const successor = decision.supersededBy
    ? ` — superseded by ${recordReference(decision.supersededBy, links)}`
    : '';
  const lines = [`- ${recordReference(decision.recordId, links)} — ${decision.title}${status}${successor}`];
  for (const matcher of decision.firedMatchers) {
    lines.push(`  - via ${code(matcher.type)}: ${code(matcher.pattern)}`);
  }
  const declarations = decision.declaredBy ?? [];
  for (const declaration of declarations.slice(0, MAX_DECLARATIONS)) {
    const location = code(`${declaration.path}:${declaration.line}`);
    const url = links ? blobUrl(links, declaration.path, declaration.line) : undefined;
    lines.push(
      `  - declared by ${url ? `[${location}](${url})` : location} (${code(`@adr ${declaration.ref}`)})`,
    );
  }
  const remaining = declarations.length - Math.min(declarations.length, MAX_DECLARATIONS);
  if (remaining > 0) {
    lines.push(`  - …and ${remaining} more declaration${remaining === 1 ? '' : 's'}`);
  }
  return lines;
}

/**
 * Join the rendered lines, dropping whole lines from the end until the body fits.
 *
 * The hidden marker is retained unconditionally: it is the comment's identity (R5), and
 * a body that lost it would be orphaned and re-created on every run.
 */
function withinCommentLimit(lines: readonly string[]): string {
  const body = `${lines.join('\n')}\n`;
  if (body.length <= MAX_COMMENT_CHARS) return body;

  // Reserve the blank line, the notice, and the trailing newline.
  const budget = MAX_COMMENT_CHARS - (TRUNCATION_NOTICE.length + 2);
  // Cutting inside a `<details>` block would leave it open, and GitHub would then fold
  // the truncation notice into the collapsed block where no reviewer sees it. Every
  // block still open at the cut is closed, and those closers are paid for up front.
  const closersCost = (depth: number): number => (depth > 0 ? 1 + depth * (DETAILS_CLOSE.length + 1) : 0);
  const kept: string[] = [CI_COMMENT_MARKER];
  let used = CI_COMMENT_MARKER.length + 1;
  let depth = 0;
  for (const line of lines.slice(1)) {
    const next = line === '<details>' ? depth + 1 : line === DETAILS_CLOSE ? depth - 1 : depth;
    const cost = line.length + 1;
    if (used + cost + closersCost(next) > budget) break;
    kept.push(line);
    used += cost;
    depth = next;
  }
  const closers = depth > 0 ? ['', ...Array.from({ length: depth }, () => DETAILS_CLOSE)] : [];
  return `${[...kept, ...closers, '', TRUNCATION_NOTICE].join('\n')}\n`;
}

function renderDecisionList(
  decisions: readonly GoverningDecision[],
  withStatus: boolean,
  links: CommentLinks | undefined,
): string[] {
  const shown = decisions.slice(0, MAX_GOVERNING);
  const lines = shown.flatMap((decision) => renderDecisionLines(decision, withStatus, links));
  const remaining = decisions.length - shown.length;
  if (remaining > 0) lines.push(`- …and ${remaining} more record${remaining === 1 ? '' : 's'}`);
  return lines;
}

/**
 * Render the PR comment for a {@link CheckOutcome}. Selective by construction — the
 * governing list is exactly the resolver's union for the changed files (R6/FR-006),
 * one entry per governing record with the matcher(s) that fired. Includes a concise
 * empty state (FR-007) and, when a changed record has an `error` finding, a
 * validation notice naming the failing record + rule (R7).
 *
 * Only `accepted` records appear under the governing heading. Matched proposals and
 * historical records are reported in their own collapsed sections so a reviewer is
 * never told that a rejected or superseded decision governs their change (#39).
 *
 * With `options.links`, every record id links to the record at the evaluated commit.
 */
export function renderComment(outcome: CheckOutcome, options: RenderCommentOptions = {}): string {
  const { links } = options;
  const lines: string[] = [CI_COMMENT_MARKER, '', HEADING, ''];
  if (outcome.governing.length > 0) lines.push(tallyLine(outcome), '');
  const findings = changedRecordFindings(outcome);
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  // Validation is the blocking result of this Action, so keep it ahead of the
  // potentially large governance detail. If the body must be truncated, a reviewer
  // still sees the failing record and rule instead of only the lower-priority prefix.
  if (errors.length > 0) {
    lines.push('#### ⚠️ Validation errors on changed records', '');
    lines.push('These changed records fail validation and must be fixed:');
    for (const finding of errors) lines.push(renderFindingLine(finding));
    lines.push('');
  }

  if (outcome.markerScan) {
    const markerAdvisories = [
      ...markerScanHealthLines(outcome.markerScan),
      ...markerClaimLines(outcome),
    ];
    if (markerAdvisories.length > 0) lines.push(...markerAdvisories, '');
  }

  if (outcome.governedBy.length === 0) {
    lines.push(EMPTY_STATE);
  } else if (outcome.governing.length === 0) {
    lines.push(NO_ACCEPTED_STATE);
  } else if (outcome.governing.length <= GOVERNING_EXPANDED_MAX) {
    lines.push(...renderDecisionList(outcome.governing, false, links));
  } else {
    lines.push(
      ...collapsed(
        `Show all ${outcome.governing.length} governing decisions and why each applies`,
        renderDecisionList(outcome.governing, false, links),
      ),
    );
  }

  if (outcome.activeProposals.length > 0) {
    lines.push(
      '',
      ...collapsed(`${PROPOSALS_SUMMARY} (${outcome.activeProposals.length})`, [
        PROPOSALS_NOTE,
        '',
        ...renderDecisionList(outcome.activeProposals, true, links),
      ]),
    );
  }

  if (outcome.history.length > 0) {
    lines.push(
      '',
      ...collapsed(`${HISTORY_SUMMARY} (${outcome.history.length})`, [
        HISTORY_NOTE,
        '',
        ...renderDecisionList(outcome.history, true, links),
      ]),
    );
  }

  if (warnings.length > 0) {
    lines.push('', '#### Warnings on changed records', '');
    for (const finding of warnings) lines.push(renderFindingLine(finding));
  }

  if (links) lines.push('', footerLine(links));

  return withinCommentLimit(lines);
}

/**
 * Render the notice posted when the PR's changed-file list exceeded the provider cap
 * and a complete list could not be obtained. The Action does NOT compute governing
 * decisions from a partial list (FR-003); it says so instead.
 */
export function renderTruncatedNotice(): string {
  return (
    [
      CI_COMMENT_MARKER,
      '',
      HEADING,
      '',
      'This pull request changes more files than the GitHub API can list completely, ' +
        'so the governing decisions could not be computed reliably for it. Split the ' +
        'change into smaller PRs, or run `adr check` locally against the full diff.',
    ].join('\n') + '\n'
  );
}
