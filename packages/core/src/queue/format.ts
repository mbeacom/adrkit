/**
 * @adrkit/core — canonical QueueReport serializers (contracts/queue-report.md §II, §IV).
 *
 * Shared byte-for-byte by the CLI and the Action. `formatQueueReportJson` is
 * `JSON.stringify(report, null, 2) + "\n"` (insertion-order keys). The Markdown
 * formatter is complete (every field has a representation), deterministic, and
 * CommonMark-safe: table cells escape pipe/backtick/backslash and neutralize CR/LF,
 * and detail headings are normalized to a single line so a multiline title cannot
 * inject structure.
 */

import type { CorpusFinding, ItemFinding, QueueItem, QueueReport } from './types.ts';

export function formatQueueReportJson(report: QueueReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Escape a table-cell value per contract order: CRLF→LF, CR→space, LF→<br>, then \ | `. */
function escapeCell(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, ' ')
    .replace(/\n/g, '<br>')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`');
}

/** Bullet-list text (item finding messages) only escapes the pipe character. */
function escapeBullet(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** Collapse a heading title to one line: CRLF→LF, then any CR/LF → a single space. */
function normalizeHeading(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[\r\n]/g, ' ');
}

function dash(value: string | number | null): string {
  return value === null ? '-' : String(value);
}

function tierOverview(item: QueueItem): string {
  return item.tier === null ? '(none)' : `${item.tier} (${item.tierLabel})`;
}

function objectionsCell(item: QueueItem): string {
  return item.resolvedObjectionCount > 0
    ? `${item.unresolvedObjectionCount} (${item.resolvedObjectionCount} resolved)`
    : String(item.unresolvedObjectionCount);
}

function corpusFindingsBlock(findings: readonly CorpusFinding[]): string | null {
  if (findings.length === 0) return null;
  const rows = findings.map(
    (f) => `| \`${escapeCell(f.sourcePath)}\` | \`${escapeCell(f.code)}\` | ${f.severity} | ${escapeCell(f.message)} |`,
  );
  return ['## Corpus Findings', '', '| Source Path | Code | Severity | Message |', '|-------------|------|----------|---------|', ...rows].join('\n');
}

function overviewBlock(items: readonly QueueItem[]): string {
  if (items.length === 0) return ['## Queue Items', '', '*No proposed records found.*'].join('\n');
  const rows = items.map((item, index) => {
    const approvals = `${item.approvalCount}/${item.quorum === null ? '-' : item.quorum}`;
    return `| ${index + 1} | \`${escapeCell(item.id)}\` | ${escapeCell(item.title)} | ${escapeCell(
      tierOverview(item),
    )} | ${item.slaState} | ${dash(item.deadlineDate)} | ${approvals} | ${objectionsCell(item)} |`;
  });
  return [
    '## Queue Items',
    '',
    '| # | ID | Title | Tier | SLA State | Deadline | Approvals | Objections |',
    '|---|----|-------|------|-----------|----------|-----------|------------|',
    ...rows,
  ].join('\n');
}

function findingBullet(finding: ItemFinding): string {
  return `- \`${finding.code}\` (${finding.severity}): ${escapeBullet(finding.message)}`;
}

function detailBlock(item: QueueItem): string {
  const rows = [
    `| Source | \`${escapeCell(item.sourcePath)}\` |`,
    `| Tier | ${item.tier === null ? '(none)' : escapeCell(item.tier)} |`,
    `| Tier Label | ${item.tierLabel === null ? '-' : escapeCell(item.tierLabel)} |`,
    `| SLA State | ${item.slaState} |`,
    `| Queued At | ${dash(item.queuedAt)} |`,
    `| SLA Days | ${dash(item.slaDays)} |`,
    `| Review By | ${dash(item.reviewBy)} |`,
    `| Deadline | ${dash(item.deadlineDate)} |`,
    `| Routing Targets | ${item.routingTargets.length > 0 ? escapeCell(item.routingTargets.join(', ')) : '-'} |`,
    `| Quorum | ${dash(item.quorum)} |`,
    `| Approvals | ${item.approvalCount} |`,
    `| Unresolved Objections | ${item.unresolvedObjectionCount} |`,
    `| Resolved Objections | ${item.resolvedObjectionCount} |`,
    `| Escalated At | ${dash(item.escalatedAt)} |`,
    `| Decided At | ${dash(item.decidedAt)} |`,
  ];
  const table = [`### ${item.id} — ${normalizeHeading(item.title)}`, '', '| Field | Value |', '|-------|-------|', ...rows].join('\n');
  if (item.itemFindings.length === 0) return table;
  const findings = ['#### Findings', '', ...item.itemFindings.map(findingBullet)].join('\n');
  return `${table}\n\n${findings}`;
}

export function formatQueueReportMarkdown(report: QueueReport): string {
  const blocks: string[] = [
    [
      `# ARB Queue — ${report.asOf}`,
      '',
      `Corpus fingerprint: \`${report.corpusFingerprint}\``,
      `${report.totalItems} item(s) | ${report.totalCorpusFindings} corpus finding(s) | ${report.itemsWithFindings} item(s) with findings`,
    ].join('\n'),
  ];

  const corpusBlock = corpusFindingsBlock(report.corpusFindings);
  if (corpusBlock) blocks.push(corpusBlock);

  blocks.push(overviewBlock(report.items));
  for (const item of report.items) blocks.push(detailBlock(item));

  return `${blocks.join('\n\n')}\n`;
}
