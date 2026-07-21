import { describe, expect, test } from 'bun:test';
import {
  SLA_STATE_URGENCY_ORDER,
  sortCorpusFindings,
  sortItemFindings,
  sortQueueItems,
  type CorpusFinding,
  type ItemFinding,
  type QueueItem,
  type SlaState,
} from '@adrkit/core';

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

describe('SLA_STATE_URGENCY_ORDER', () => {
  test('assigns the frozen urgency ranks', () => {
    expect(SLA_STATE_URGENCY_ORDER).toEqual({
      overdue: 0,
      escalated: 1,
      due: 2,
      'within-sla': 3,
      'missing-sla': 4,
      'not-queued': 5,
      decided: 6,
    });
  });
});

describe('sortQueueItems', () => {
  test('orders strictly by urgency group', () => {
    const items = [
      item({ id: '0001', slaState: 'decided' }),
      item({ id: '0002', slaState: 'not-queued' }),
      item({ id: '0003', slaState: 'missing-sla' }),
      item({ id: '0004', slaState: 'within-sla', deadlineDate: '2026-02-01' }),
      item({ id: '0005', slaState: 'due', deadlineDate: '2026-01-08' }),
      item({ id: '0006', slaState: 'escalated', escalatedAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: '0007', slaState: 'overdue', deadlineDate: '2025-12-01' }),
    ];
    expect(sortQueueItems(items).map((i) => i.slaState)).toEqual([
      'overdue',
      'escalated',
      'due',
      'within-sla',
      'missing-sla',
      'not-queued',
      'decided',
    ]);
  });

  test('within a group, earlier deadline first and null deadline last', () => {
    const items = [
      item({ id: '0003', slaState: 'overdue', deadlineDate: null, queuedAt: '2025-01-01T00:00:00.000Z' }),
      item({ id: '0002', slaState: 'overdue', deadlineDate: '2025-12-10' }),
      item({ id: '0001', slaState: 'overdue', deadlineDate: '2025-12-01' }),
    ];
    expect(sortQueueItems(items).map((i) => i.id)).toEqual(['0001', '0002', '0003']);
  });

  test('equal urgency + deadline + queuedAt breaks ties by ascending id', () => {
    const items = [
      item({ id: '0002', slaState: 'overdue', deadlineDate: '2025-12-15', queuedAt: '2025-12-01T00:00:00.000Z' }),
      item({ id: '0001', slaState: 'overdue', deadlineDate: '2025-12-15', queuedAt: '2025-12-01T00:00:00.000Z' }),
    ];
    expect(sortQueueItems(items).map((i) => i.id)).toEqual(['0001', '0002']);
  });

  test('not-queued group (no queuedAt, no deadline) sorts by id', () => {
    const items = [
      item({ id: '0003', slaState: 'not-queued' }),
      item({ id: '0001', slaState: 'not-queued' }),
      item({ id: '0002', slaState: 'not-queued' }),
    ];
    expect(sortQueueItems(items).map((i) => i.id)).toEqual(['0001', '0002', '0003']);
  });

  test('duplicate id with equal state/deadline/queuedAt breaks the tie by sourcePath', () => {
    // lintCorpus retains schema-valid duplicate-id records (unique-id is a warn/info
    // finding, not an exclusion), so id alone is not a total order.
    const items = [
      item({ id: '0001', slaState: 'overdue', deadlineDate: '2025-12-15', queuedAt: '2025-12-01T00:00:00.000Z', sourcePath: 'docs/adr/0001-z.md' }),
      item({ id: '0001', slaState: 'overdue', deadlineDate: '2025-12-15', queuedAt: '2025-12-01T00:00:00.000Z', sourcePath: 'docs/adr/0001-a.md' }),
    ];
    expect(sortQueueItems(items).map((i) => i.sourcePath)).toEqual([
      'docs/adr/0001-a.md',
      'docs/adr/0001-z.md',
    ]);
  });

  test('is deterministic across repeated calls', () => {
    const items = [
      item({ id: '0002', slaState: 'due', deadlineDate: '2026-01-08' }),
      item({ id: '0001', slaState: 'overdue', deadlineDate: '2025-12-01' }),
    ];
    expect(sortQueueItems(items)).toEqual(sortQueueItems(items));
  });
});

describe('sortCorpusFindings', () => {
  test('orders by sourcePath → code → severity → message', () => {
    const findings: CorpusFinding[] = [
      { sourcePath: 'b.md', code: 'corpus.parse-error', severity: 'error', message: 'm' },
      { sourcePath: 'a.md', code: 'corpus.schema-invalid', severity: 'error', message: 'zeta' },
      { sourcePath: 'a.md', code: 'corpus.schema-invalid', severity: 'error', message: 'alpha' },
      { sourcePath: 'a.md', code: 'corpus.parse-error', severity: 'error', message: 'm' },
    ];
    expect(sortCorpusFindings(findings)).toEqual([
      { sourcePath: 'a.md', code: 'corpus.parse-error', severity: 'error', message: 'm' },
      { sourcePath: 'a.md', code: 'corpus.schema-invalid', severity: 'error', message: 'alpha' },
      { sourcePath: 'a.md', code: 'corpus.schema-invalid', severity: 'error', message: 'zeta' },
      { sourcePath: 'b.md', code: 'corpus.parse-error', severity: 'error', message: 'm' },
    ]);
  });
});

describe('sortItemFindings', () => {
  test('orders by code → severity rank → message', () => {
    const findings: ItemFinding[] = [
      { code: 'item.tier-absent', severity: 'info', message: 'b' },
      { code: 'item.deciders-empty', severity: 'info', message: 'z' },
      { code: 'item.deciders-empty', severity: 'info', message: 'a' },
    ];
    expect(sortItemFindings(findings).map((f) => `${f.code}:${f.message}`)).toEqual([
      'item.deciders-empty:a',
      'item.deciders-empty:z',
      'item.tier-absent:b',
    ]);
  });

  test('warn sorts before info at equal code (severity rank error=0,warn=1,info=2)', () => {
    const findings: ItemFinding[] = [
      { code: 'item.x', severity: 'info', message: 'm' },
      { code: 'item.x', severity: 'warn', message: 'm' },
    ];
    expect(sortItemFindings(findings).map((f) => f.severity)).toEqual(['warn', 'info']);
  });
});
