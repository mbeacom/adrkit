import { describe, expect, test } from 'bun:test';
import {
  formatQueueReportJson,
  formatQueueReportMarkdown,
  type ItemFinding,
  type QueueItem,
  type QueueReport,
  type SlaState,
} from '@adrkit/core';

const FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function item(overrides: Partial<QueueItem> & { id: string; slaState: SlaState }): QueueItem {
  return {
    id: overrides.id,
    title: overrides.title ?? `Title ${overrides.id}`,
    sourcePath: overrides.sourcePath ?? `docs/adr/${overrides.id}-x.md`,
    tier: overrides.tier ?? null,
    tierLabel: overrides.tierLabel ?? null,
    queuedAt: overrides.queuedAt ?? null,
    slaDays: overrides.slaDays ?? null,
    reviewBy: overrides.reviewBy ?? null,
    slaState: overrides.slaState,
    deadlineDate: overrides.deadlineDate ?? null,
    routingTargets: overrides.routingTargets ?? [],
    quorum: overrides.quorum ?? null,
    approvalCount: overrides.approvalCount ?? 0,
    unresolvedObjectionCount: overrides.unresolvedObjectionCount ?? 0,
    resolvedObjectionCount: overrides.resolvedObjectionCount ?? 0,
    escalatedAt: overrides.escalatedAt ?? null,
    decidedAt: overrides.decidedAt ?? null,
    itemFindings: overrides.itemFindings ?? [],
  };
}

const findingWithPipe: ItemFinding = {
  code: 'item.tier-absent',
  severity: 'info',
  message: 'use auto|async|arb',
};

const fullReport: QueueReport = {
  version: '1',
  asOf: '2026-01-08',
  corpusFingerprint: FINGERPRINT,
  totalItems: 3,
  totalCorpusFindings: 1,
  itemsWithFindings: 1,
  items: [
    item({
      id: '0001',
      title: 'Introduce ARB queue',
      sourcePath: 'docs/adr/0001-arb-queue.md',
      tier: 'arb',
      tierLabel: 'ARB human review',
      queuedAt: '2026-01-01T00:00:00.000Z',
      slaDays: 14,
      slaState: 'within-sla',
      deadlineDate: '2026-01-15',
      routingTargets: ['@alice', '@bob'],
      quorum: 2,
      approvalCount: 1,
      unresolvedObjectionCount: 0,
      resolvedObjectionCount: 1,
      itemFindings: [findingWithPipe],
    }),
    item({
      id: '0002',
      title: 'Line1\r\nLine2\rLine3',
      tier: null,
      tierLabel: null,
      slaState: 'not-queued',
    }),
    item({
      id: '0003',
      title: 'x|y\\z`w',
      tier: 'async',
      tierLabel: 'asynchronous human review',
      slaState: 'missing-sla',
      queuedAt: '2026-01-02T00:00:00.000Z',
    }),
  ],
  corpusFindings: [
    { sourcePath: 'docs/adr/9999-bad.md', code: 'corpus.schema-invalid', severity: 'error', message: 'Missing id field' },
  ],
};

const emptyReport: QueueReport = {
  version: '1',
  asOf: '2026-02-01',
  corpusFingerprint: FINGERPRINT,
  totalItems: 0,
  totalCorpusFindings: 0,
  itemsWithFindings: 0,
  items: [],
  corpusFindings: [],
};

describe('formatQueueReportJson', () => {
  const output = formatQueueReportJson(fullReport);

  test('ends with exactly one newline and has no trailing whitespace on any line', () => {
    expect(output.endsWith('}\n')).toBe(true);
    expect(output.endsWith('}\n\n')).toBe(false);
    for (const line of output.split('\n')) {
      expect(line).toBe(line.replace(/\s+$/, ''));
    }
  });

  test('is valid JSON with version as the string "1"', () => {
    const parsed = JSON.parse(output) as QueueReport;
    expect(parsed.version).toBe('1');
    expect(typeof parsed.version).toBe('string');
  });

  test('top-level keys are in construction order', () => {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'version',
      'asOf',
      'corpusFingerprint',
      'totalItems',
      'totalCorpusFindings',
      'itemsWithFindings',
      'items',
      'corpusFindings',
    ]);
  });

  test('QueueItem keys are in the frozen order', () => {
    const parsed = JSON.parse(output) as { items: Record<string, unknown>[] };
    expect(Object.keys(parsed.items[0]!)).toEqual([
      'id',
      'title',
      'sourcePath',
      'tier',
      'tierLabel',
      'queuedAt',
      'slaDays',
      'reviewBy',
      'slaState',
      'deadlineDate',
      'routingTargets',
      'quorum',
      'approvalCount',
      'unresolvedObjectionCount',
      'resolvedObjectionCount',
      'escalatedAt',
      'decidedAt',
      'itemFindings',
    ]);
  });

  test('null fields are present as JSON null (not omitted)', () => {
    const parsed = JSON.parse(output) as { items: QueueItem[] };
    expect(parsed.items[1]!.tier).toBeNull();
    expect('tier' in parsed.items[1]!).toBe(true);
  });

  test('is deterministic', () => {
    expect(formatQueueReportJson(fullReport)).toBe(output);
  });
});

describe('formatQueueReportMarkdown', () => {
  const output = formatQueueReportMarkdown(fullReport);
  const lines = output.split('\n');

  test('first line is the dated title heading', () => {
    expect(lines[0]).toBe('# ARB Queue — 2026-01-08');
  });

  test('second non-blank line is the backtick-wrapped 64-char fingerprint', () => {
    const nonBlank = lines.filter((l) => l.trim().length > 0);
    expect(nonBlank[1]).toBe(`Corpus fingerprint: \`${FINGERPRINT}\``);
  });

  test('overview Tier renders "{tier} ({tierLabel})" and "(none)" for null tier', () => {
    expect(output).toContain('arb (ARB human review)');
    expect(output).toContain('(none)');
  });

  test('null field values render as "-"', () => {
    // item 0002 has null deadline → detail Deadline row is "-".
    expect(output).toContain('| Deadline | - |');
  });

  test('pipe in a title is escaped in the overview cell', () => {
    // item 0003 title "x|y\z`w": backslash then pipe then backtick escaped.
    expect(output).toContain('x\\|y\\\\z\\`w');
  });

  test('pipe in an item finding bullet is escaped', () => {
    expect(output).toContain('`item.tier-absent` (info): use auto\\|async\\|arb');
  });

  test('a multiline title is normalized to a single-line detail heading', () => {
    expect(output).toContain('### 0002 — Line1 Line2 Line3');
    // No injected heading/table from the title newlines.
    expect(output).not.toContain('Line2\nLine3');
  });

  test('every item detail section has a Tier Label row', () => {
    expect(output).toContain('| Tier Label | ARB human review |');
    expect(output).toContain('| Tier Label | - |');
  });

  test('corpus findings section backtick-wraps sourcePath and code', () => {
    expect(output).toContain('`docs/adr/9999-bad.md`');
    expect(output).toContain('`corpus.schema-invalid`');
  });

  test('output ends with exactly one newline', () => {
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  test('is deterministic', () => {
    expect(formatQueueReportMarkdown(fullReport)).toBe(output);
  });

  test('empty items render the exact empty-state text and omit the corpus findings section', () => {
    const empty = formatQueueReportMarkdown(emptyReport);
    expect(empty).toContain('*No proposed records found.*');
    expect(empty).not.toContain('## Corpus Findings');
  });
});
