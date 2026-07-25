import type { CheckOutcome, Finding, GoverningDecision } from '@adrkit/core';

/**
 * Stable hidden marker used to locate this Action's own comment for in-place
 * updates. Comment identity is marker + author (R5/FR-005) — never stored state
 * (ADR-0004). Keep this string stable across versions.
 */
export const CI_COMMENT_MARKER = '<!-- adrkit:ci -->';

const HEADING = '### Decisions governing this change';
const EMPTY_STATE = 'No governing decisions for the changed files.';
const NO_ACCEPTED_STATE =
  'No **accepted** decisions govern the changed files. Records below matched but do not bind this change.';
const PROPOSALS_HEADING = '#### Active proposals touching this change';
const PROPOSALS_NOTE = 'These are not yet ratified and do not bind this change:';
const HISTORY_HEADING = '#### Historical records that once covered this change';
const HISTORY_NOTE = 'These no longer bind this change, and are listed for context only:';

// Display cap for a pathological governing list. The underlying set is never
// trimmed semantically (R6) — this only shortens what is rendered.
const MAX_GOVERNING = 50;

function changedRecordFindings(outcome: CheckOutcome): Finding[] {
  const changed = new Set(outcome.changedRecords);
  return outcome.findings.filter((finding) => finding.path !== undefined && changed.has(finding.path));
}

function renderFindingLine(finding: Finding): string {
  const where = finding.path ? `\`${finding.path}\`` : '(corpus)';
  const field = finding.field ? ` (\`${finding.field}\`)` : '';
  return `- ${where} — \`${finding.rule}\`${field}: ${finding.message}`;
}

/**
 * One decision as a bullet, annotated with its status and — for superseded records —
 * the successor that replaced it, so a reviewer is never shown a bare record id and
 * left to assume it is in force (#39).
 */
function renderDecisionLines(decision: GoverningDecision, withStatus: boolean): string[] {
  const status = withStatus ? ` _(${decision.status})_` : '';
  const successor = decision.supersededBy ? ` — superseded by **${decision.supersededBy}**` : '';
  const lines = [`- **${decision.recordId}** — ${decision.title}${status}${successor}`];
  for (const matcher of decision.firedMatchers) {
    lines.push(`  - via \`${matcher.type}\`: \`${matcher.pattern}\``);
  }
  return lines;
}

function renderDecisionList(decisions: readonly GoverningDecision[], withStatus: boolean): string[] {
  const shown = decisions.slice(0, MAX_GOVERNING);
  const lines = shown.flatMap((decision) => renderDecisionLines(decision, withStatus));
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
 * historical records are reported under their own headings so a reviewer is never told
 * that a rejected or superseded decision governs their change (#39).
 */
export function renderComment(outcome: CheckOutcome): string {
  const lines: string[] = [CI_COMMENT_MARKER, '', HEADING, ''];

  if (outcome.governedBy.length === 0) {
    lines.push(EMPTY_STATE);
  } else if (outcome.governing.length === 0) {
    lines.push(NO_ACCEPTED_STATE);
  } else {
    lines.push(...renderDecisionList(outcome.governing, false));
  }

  if (outcome.activeProposals.length > 0) {
    lines.push('', PROPOSALS_HEADING, '', PROPOSALS_NOTE);
    lines.push(...renderDecisionList(outcome.activeProposals, true));
  }

  if (outcome.history.length > 0) {
    lines.push('', HISTORY_HEADING, '', HISTORY_NOTE);
    lines.push(...renderDecisionList(outcome.history, true));
  }

  const findings = changedRecordFindings(outcome);
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  if (errors.length > 0) {
    lines.push('', '#### ⚠️ Validation errors on changed records', '');
    lines.push('These changed records fail validation and must be fixed:');
    for (const finding of errors) lines.push(renderFindingLine(finding));
  }

  if (warnings.length > 0) {
    lines.push('', '#### Warnings on changed records', '');
    for (const finding of warnings) lines.push(renderFindingLine(finding));
  }

  return `${lines.join('\n')}\n`;
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
