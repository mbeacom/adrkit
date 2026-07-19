import type { CheckOutcome, Finding } from '@adrkit/core';

/**
 * Stable hidden marker used to locate this Action's own comment for in-place
 * updates. Comment identity is marker + author (R5/FR-005) — never stored state
 * (ADR-0004). Keep this string stable across versions.
 */
export const CI_COMMENT_MARKER = '<!-- adrkit:ci -->';

const HEADING = '### Decisions governing this change';
const EMPTY_STATE = 'No governing decisions for the changed files.';

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
 * Render the PR comment for a {@link CheckOutcome}. Selective by construction — the
 * governing list is exactly the resolver's union for the changed files (R6/FR-006),
 * one entry per governing record with the matcher(s) that fired. Includes a concise
 * empty state (FR-007) and, when a changed record has an `error` finding, a
 * validation notice naming the failing record + rule (R7).
 */
export function renderComment(outcome: CheckOutcome): string {
  const lines: string[] = [CI_COMMENT_MARKER, '', HEADING, ''];

  if (outcome.governedBy.length === 0) {
    lines.push(EMPTY_STATE);
  } else {
    const shown = outcome.governedBy.slice(0, MAX_GOVERNING);
    for (const decision of shown) {
      lines.push(`- **${decision.recordId}** — ${decision.title}`);
      for (const matcher of decision.firedMatchers) {
        lines.push(`  - via \`${matcher.type}\`: \`${matcher.pattern}\``);
      }
    }
    const remaining = outcome.governedBy.length - shown.length;
    if (remaining > 0) {
      lines.push(`- …and ${remaining} more governing decision${remaining === 1 ? '' : 's'}`);
    }
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
