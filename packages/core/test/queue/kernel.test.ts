import { describe, expect, test } from 'bun:test';
import { buildQueueReport, type Adr, type Finding, type LintCorpusResult } from '@adrkit/core';

const TIER_ABSENT_MESSAGE =
  'review.tier is absent; routing tier cannot be determined — add review.tier: auto|async|arb to this record';
const DECIDERS_EMPTY_MESSAGE =
  'deciders is empty; routing targets cannot be determined — add at least one decider identity to this record';
const ONE_WAY_DOOR_MESSAGE =
  'one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)';

function rec(frontmatter: Record<string, unknown>, path = 'docs/adr/0001-x.md', body = 'Body'): Adr {
  return { frontmatter: { id: '0001', title: 'X', status: 'proposed', ...frontmatter }, body, path } as unknown as Adr;
}

function corpus(records: Adr[], findings: Finding[] = [], checked = records.length + findings.filter((f) => f.severity === 'error' && f.path && !records.some((r) => r.path === f.path)).length): LintCorpusResult {
  return { records, findings, checked };
}

function single(frontmatter: Record<string, unknown>): LintCorpusResult {
  return corpus([rec(frontmatter)]);
}

describe('buildQueueReport — SLA states', () => {
  test('overdue: deadline before asOf, no escalated/decided', () => {
    const report = buildQueueReport({
      corpus: single({ review: { tier: 'arb', queuedAt: '2025-12-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('overdue');
    expect(report.items[0]?.deadlineDate).toBe('2025-12-15');
  });

  test('due: deadline equals asOf', () => {
    const report = buildQueueReport({
      corpus: single({ review: { tier: 'async', queuedAt: '2025-12-25T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('due');
  });

  test('within-sla: deadline after asOf', () => {
    const report = buildQueueReport({
      corpus: single({ review: { tier: 'arb', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('within-sla');
  });

  test('missing-sla: queuedAt present, no slaDays/reviewBy', () => {
    const report = buildQueueReport({
      corpus: single({ deciders: ['@a'], review: { tier: 'async', queuedAt: '2026-01-01T00:00:00Z' } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('missing-sla');
    expect(report.items[0]?.deadlineDate).toBeNull();
  });

  test('not-queued: no review block', () => {
    const report = buildQueueReport({ corpus: single({ deciders: ['@a'] }), asOf: '2026-01-08' });
    expect(report.items[0]?.slaState).toBe('not-queued');
    expect(report.items[0]?.itemFindings).toEqual([]);
  });

  test('escalated beats overdue', () => {
    const report = buildQueueReport({
      corpus: single({
        review: { tier: 'arb', queuedAt: '2025-11-01T00:00:00Z', slaDays: 14, escalatedAt: '2025-11-20T00:00:00Z' },
      }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('escalated');
  });

  test('decided beats escalated', () => {
    const report = buildQueueReport({
      corpus: single({
        review: {
          tier: 'arb',
          queuedAt: '2026-01-01T00:00:00Z',
          slaDays: 14,
          escalatedAt: '2026-01-04T00:00:00Z',
          decidedAt: '2026-01-05T00:00:00Z',
        },
      }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.slaState).toBe('decided');
  });
});

describe('buildQueueReport — deadline computation', () => {
  test('timezone normalization to UTC calendar date', () => {
    const build = (asOf: string) =>
      buildQueueReport({
        corpus: single({ review: { tier: 'arb', queuedAt: '2026-03-08T23:59:59-05:00', slaDays: 1 } }),
        asOf,
      }).items[0];
    // queuedAt UTC date = 2026-03-09; deadline = 2026-03-10.
    expect(build('2026-03-10')?.deadlineDate).toBe('2026-03-10');
    expect(build('2026-03-10')?.slaState).toBe('due');
    expect(build('2026-03-11')?.slaState).toBe('overdue');
  });

  test('slaDays:0 → deadline equals queuedAt date; due that day, overdue next', () => {
    const build = (asOf: string) =>
      buildQueueReport({
        corpus: single({ review: { tier: 'arb', queuedAt: '2026-05-01T00:00:00Z', slaDays: 0 } }),
        asOf,
      }).items[0];
    expect(build('2026-05-01')?.deadlineDate).toBe('2026-05-01');
    expect(build('2026-05-01')?.slaState).toBe('due');
    expect(build('2026-05-02')?.slaState).toBe('overdue');
  });

  test('reviewBy takes precedence over slaDays for the deadline', () => {
    const item = buildQueueReport({
      corpus: single({ reviewBy: '2026-04-01', review: { tier: 'arb', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-03-01',
    }).items[0];
    expect(item?.deadlineDate).toBe('2026-04-01');
    expect(item?.slaDays).toBe(14);
    expect(item?.slaState).toBe('within-sla');
  });
});

describe('buildQueueReport — corpus shape', () => {
  test('empty corpus', () => {
    const report = buildQueueReport({ corpus: { records: [], findings: [], checked: 0 }, asOf: '2026-01-08' });
    expect(report.items).toEqual([]);
    expect(report.corpusFindings).toEqual([]);
    expect(report.totalItems).toBe(0);
  });

  test('no proposed records → empty items; corpus findings may be non-empty', () => {
    const report = buildQueueReport({
      corpus: corpus([rec({ status: 'accepted', deciders: ['@a'] })]),
      asOf: '2026-01-08',
    });
    expect(report.items).toEqual([]);
  });

  test('version field is the string "1"', () => {
    const report = buildQueueReport({ corpus: { records: [], findings: [], checked: 0 }, asOf: '2026-01-08' });
    expect(report.version).toBe('1');
  });
});

describe('buildQueueReport — item findings', () => {
  test('item.tier-absent when review block present but tier absent', () => {
    const report = buildQueueReport({
      corpus: single({ deciders: ['@a'], review: { queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.tier).toBeNull();
    expect(report.items[0]?.itemFindings).toContainEqual({
      code: 'item.tier-absent',
      severity: 'info',
      message: TIER_ABSENT_MESSAGE,
    });
  });

  test('item.deciders-empty when queuedAt present and deciders empty', () => {
    const report = buildQueueReport({
      corpus: single({ deciders: [], review: { tier: 'arb', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.itemFindings).toContainEqual({
      code: 'item.deciders-empty',
      severity: 'info',
      message: DECIDERS_EMPTY_MESSAGE,
    });
  });

  test('item.review-by-before-queued when reviewBy strictly before queuedAt date', () => {
    const report = buildQueueReport({
      corpus: single({
        reviewBy: '2025-12-31',
        deciders: ['@a'],
        review: { tier: 'async', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 },
      }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.itemFindings).toContainEqual({
      code: 'item.review-by-before-queued',
      severity: 'warn',
      message: 'reviewBy (2025-12-31) is before queuedAt (2026-01-01); SLA deadline may be inconsistent',
    });
  });

  test('equal reviewBy/queuedAt date generates NO review-by-before-queued finding', () => {
    const report = buildQueueReport({
      corpus: single({
        reviewBy: '2026-01-01',
        deciders: ['@a'],
        review: { tier: 'async', queuedAt: '2026-01-01T12:00:00Z', slaDays: 14 },
      }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.itemFindings.some((f) => f.code === 'item.review-by-before-queued')).toBe(false);
  });

  test('decidedAt + approvalCount < quorum generates no item finding', () => {
    const report = buildQueueReport({
      corpus: single({
        deciders: ['@a'],
        review: {
          tier: 'arb',
          queuedAt: '2026-01-01T00:00:00Z',
          slaDays: 14,
          decidedAt: '2026-01-05T00:00:00Z',
          quorum: 3,
          approvals: ['@a'],
        },
      }),
      asOf: '2026-01-08',
    });
    expect(report.items[0]?.approvalCount).toBe(1);
    expect(report.items[0]?.quorum).toBe(3);
    expect(report.items[0]?.itemFindings).toEqual([]);
  });
});

describe('buildQueueReport — corpus findings and fingerprint', () => {
  test('schema-valid proposed record with warn finding is not a corpus finding but affects fingerprint', () => {
    const record = rec({ deciders: ['@a'], review: { tier: 'arb', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } });
    const warn: Finding = { rule: 'duplicate-id', severity: 'warn', message: 'dup', path: record.path };
    const withWarn = buildQueueReport({ corpus: { records: [record], findings: [warn], checked: 1 }, asOf: '2026-01-08' });
    const without = buildQueueReport({ corpus: { records: [record], findings: [], checked: 1 }, asOf: '2026-01-08' });
    expect(withWarn.corpusFindings).toEqual([]);
    // The warn finding is part of the fingerprint input, so fingerprints differ.
    expect(withWarn.corpusFingerprint).not.toBe(without.corpusFingerprint);
  });

  test('excluded one-way-door-disallows-auto file → corpus.one-way-door-auto-tier with canonical message', () => {
    const report = buildQueueReport({
      corpus: {
        records: [],
        findings: [
          {
            rule: 'one-way-door-disallows-auto',
            severity: 'error',
            message: 'one-way-door decisions may not take the auto-approve fast path',
            path: 'docs/adr/0009-bad.md',
          },
        ],
        checked: 1,
      },
      asOf: '2026-01-08',
    });
    expect(report.corpusFindings[0]).toEqual({
      sourcePath: 'docs/adr/0009-bad.md',
      code: 'corpus.one-way-door-auto-tier',
      severity: 'error',
      message: ONE_WAY_DOOR_MESSAGE,
    });
  });

  test('corpusFingerprint is 64 lowercase hex chars and deterministic', () => {
    const input = {
      corpus: single({ review: { tier: 'arb', queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
      asOf: '2026-01-08',
    } as const;
    const a = buildQueueReport(input);
    const b = buildQueueReport(input);
    expect(a.corpusFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.corpusFingerprint).toBe(b.corpusFingerprint);
  });
});

describe('buildQueueReport — tier semantics (FR-016)', () => {
  test('derives exact tierLabel per tier and null when absent', () => {
    const label = (tier: string | undefined) =>
      buildQueueReport({
        corpus: single({ deciders: ['@a'], review: tier ? { tier, queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } : { queuedAt: '2026-01-01T00:00:00Z', slaDays: 14 } }),
        asOf: '2026-01-08',
      }).items[0];
    expect(label('auto')?.tierLabel).toBe('expedited routing; human acceptance required');
    expect(label('async')?.tierLabel).toBe('asynchronous human review');
    expect(label('arb')?.tierLabel).toBe('ARB human review');
    expect(label(undefined)?.tierLabel).toBeNull();
    // auto label explicitly requires human acceptance.
    expect(label('auto')?.tierLabel).toContain('human acceptance required');
  });
});
