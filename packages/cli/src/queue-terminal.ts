import type { CorpusFinding, QueueItem, QueueReport } from '@adrkit/core';
import type { StreamStyle } from './presentation.ts';
import { clampColumns, cleanText, terminalDisplayWidth, truncate, wrapText } from './terminal-text.ts';

/**
 * The interactive presentation of `adr queue` (ADR-0044, following ADR-0033's
 * boundary). Only a TTY ever receives it; pipes keep the canonical Markdown byte for
 * byte. Every corpus-derived string passes through `cleanText`, so a title cannot
 * smuggle a terminal escape, and every line is budgeted in display cells.
 */
export interface TerminalQueueOptions {
  readonly columns: number;
  readonly style: StreamStyle;
  /**
   * `adr accept`'s own refusal for each item, keyed by `sourcePath`, from a dry run
   * of the pure transition at the CLI boundary. Review state alone cannot see every
   * refusal (an accepted record must name a decider, for one), so the next-step
   * hint is shown only when this has no entry for the item.
   */
  readonly acceptRefusals?: ReadonlyMap<string, string>;
}

export type QueueFormat = 'auto' | 'terminal' | 'markdown' | 'json';

export function resolveQueueFormat(format: QueueFormat, stdoutIsTTY: boolean): Exclude<QueueFormat, 'auto'> {
  return format === 'auto' ? (stdoutIsTTY ? 'terminal' : 'markdown') : format;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const parse = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}

function deadlineText(item: QueueItem, asOf: string): string | null {
  if (item.deadlineDate === null) return null;
  const days = daysBetween(asOf, item.deadlineDate);
  const relative =
    days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} overdue`;
  return `due ${item.deadlineDate} (${relative})`;
}

/** Mirrors `acceptAdrSource`'s review-state refusals, so the hint never suggests a command that will refuse. */
export function acceptBlockers(item: QueueItem): string[] {
  const blockers: string[] = [];
  if (item.unresolvedObjectionCount > 0) {
    const n = item.unresolvedObjectionCount;
    blockers.push(`${n} unresolved objection${n === 1 ? '' : 's'}`);
  }
  if (item.quorum !== null && item.approvalCount < item.quorum) {
    blockers.push(`${item.approvalCount} of ${item.quorum} required approvals`);
  }
  return blockers;
}

function reviewLine(item: QueueItem): string {
  const approvals = item.quorum === null ? `approvals ${item.approvalCount}` : `approvals ${item.approvalCount}/${item.quorum}`;
  const objections =
    item.resolvedObjectionCount > 0
      ? `objections ${item.unresolvedObjectionCount} open, ${item.resolvedObjectionCount} resolved`
      : `objections ${item.unresolvedObjectionCount}`;
  const parts = [approvals, objections];
  if (item.routingTargets.length > 0) parts.push(`route ${item.routingTargets.join(', ')}`);
  return cleanText(parts.join(' · '));
}

function tierLine(item: QueueItem): string {
  if (item.tier === null) return 'no review tier';
  return cleanText(item.tierLabel === null ? item.tier : `${item.tier} · ${item.tierLabel}`);
}

function corpusFindingLines(findings: readonly CorpusFinding[], style: StreamStyle, width: number): string[] {
  if (findings.length === 0) return [];
  const lines = [style.heading('Corpus findings')];
  for (const finding of findings) {
    const lead = `  ${finding.severity.padEnd(5)}  `;
    const available = Math.max(1, width - lead.length);
    lines.push(`  ${style.severity(finding.severity)}${' '.repeat(Math.max(1, 7 - finding.severity.length))}${truncate(cleanText(finding.code), available)}`);
    lines.push(`${' '.repeat(lead.length)}${style.path(truncate(cleanText(finding.sourcePath), available))}`);
    for (const line of wrapText(cleanText(finding.message), available)) lines.push(`${' '.repeat(lead.length)}${line}`);
  }
  lines.push('');
  return lines;
}

function itemLines(
  item: QueueItem,
  index: number,
  numberWidth: number,
  report: QueueReport,
  options: TerminalQueueOptions,
  width: number,
): string[] {
  const { style } = options;
  const marker = `${index + 1}.`.padEnd(numberWidth + 1);
  const indent = ' '.repeat(marker.length + 1);
  const available = Math.max(1, width - indent.length);
  const lines: string[] = [];

  const id = cleanText(item.id);
  const deadline = deadlineText(item, report.asOf);
  const headPlain = `${marker} ${id}  ${item.slaState}${deadline ? ` · ${deadline}` : ''}`;
  if (terminalDisplayWidth(headPlain) <= width) {
    lines.push(`${marker} ${style.bold(id)}  ${style.status(item.slaState)}${deadline ? style.note(` · ${deadline}`) : ''}`);
  } else {
    lines.push(`${marker} ${style.bold(truncate(id, available))}  ${style.status(item.slaState)}`);
    if (deadline) lines.push(`${indent}${style.note(truncate(deadline, available))}`);
  }

  lines.push(`${indent}${truncate(cleanText(item.title), available)}`);
  for (const line of wrapText(tierLine(item), available)) lines.push(`${indent}${style.note(line)}`);
  for (const line of wrapText(reviewLine(item), available)) lines.push(`${indent}${line}`);
  lines.push(`${indent}${style.path(truncate(cleanText(item.sourcePath), available))}`);

  for (const finding of item.itemFindings) {
    const severity = finding.severity === 'warn' ? 'warn' : 'info';
    const hang = ' '.repeat(severity.length + 1);
    const text = cleanText(`${finding.code}: ${finding.message}`);
    const [first = '', ...rest] = wrapText(text, Math.max(1, available - hang.length));
    lines.push(`${indent}${style.severity(severity)} ${first}`);
    for (const line of rest) lines.push(`${indent}${hang}${line}`);
  }

  const blockers = acceptBlockers(item);
  const refusal = options.acceptRefusals?.get(item.sourcePath);
  if (blockers.length === 0 && refusal !== undefined) blockers.push(cleanText(refusal));
  if (blockers.length > 0) {
    for (const line of wrapText(`blocked: ${blockers.join('; ')}`, available)) lines.push(`${indent}${style.yellow(line)}`);
  } else {
    const command = `adr accept ${id} --by <identity>`;
    const plain = `next: ${command}`;
    lines.push(
      terminalDisplayWidth(plain) <= available
        ? `${indent}${style.note('next:')} ${style.command(command)}`
        : `${indent}${style.command(truncate(command, available))}`,
    );
  }
  return lines;
}

export function renderTerminalQueue(report: QueueReport, options: TerminalQueueOptions): string {
  const width = clampColumns(options.columns);
  const { style } = options;
  const n = report.totalItems;
  const summary = [
    `${n} proposed`,
    `${report.totalCorpusFindings} corpus finding${report.totalCorpusFindings === 1 ? '' : 's'}`,
    `${report.itemsWithFindings} with item findings`,
  ].join(' · ');

  const lines: string[] = [
    style.heading(truncate(`ARB queue — as of ${report.asOf}`, width)),
    ...wrapText(summary, width).map((line) => style.note(line)),
    '',
    ...corpusFindingLines(report.corpusFindings, style, width),
  ];

  if (report.items.length === 0) {
    lines.push(style.note('No proposed records. Nothing is waiting for a decision.'));
  } else {
    const numberWidth = String(report.items.length).length;
    report.items.forEach((item, index) => {
      lines.push(...itemLines(item, index, numberWidth, report, options, width));
      lines.push('');
    });
    lines.pop();
  }

  lines.push('', style.note(truncate(`corpus ${report.corpusFingerprint.slice(0, 12)} · --format markdown|json for the full report`, width)));
  return `${lines.join('\n')}\n`;
}
