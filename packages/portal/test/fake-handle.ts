/**
 * An in-memory `PortalDataSource`, so builder tests need no filesystem and can control every
 * field, including ones the builder must drop.
 */

import type {
  CorpusIssue,
  DecisionEdge,
  DecisionRecord,
  GraphOptions,
  QueueEntry,
  QueueOptions,
} from '@adrkit/sdk/src/index.ts';
import type { PortalDataSource } from '../src/data/build.ts';

export function fakeRecord(id: string, overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id,
    title: `Decision ${id}`,
    status: 'accepted',
    standing: 'governing',
    date: '2026-07-18',
    path: `docs/adr/${id}-decision.md`,
    tags: [],
    supersedes: [],
    body: `\n# ADR-${id}\n\nBody of ${id}.\n`,
    ...overrides,
  };
}

export function fakeQueueEntry(id: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id,
    title: `Decision ${id}`,
    path: `docs/adr/${id}-decision.md`,
    tier: 'async',
    slaState: 'within-sla',
    deadline: '2026-07-11',
    approvalCount: 1,
    quorum: 2,
    unresolvedObjectionCount: 1,
    resolvedObjectionCount: 1,
    routingTargets: ['@dave'],
    itemFindingCount: 0,
    ...overrides,
  };
}

export interface FakeHandleInput {
  readonly records?: readonly DecisionRecord[];
  readonly issues?: readonly CorpusIssue[];
  readonly edges?: readonly DecisionEdge[];
  readonly entries?: readonly QueueEntry[];
}

/** A fake handle; `calls` records what the builder asked for. */
export function fakeHandle(input: FakeHandleInput = {}): PortalDataSource & { calls: string[] } {
  const records = input.records ?? [
    fakeRecord('0001', { body: '\nSee [the successor](./0002-decision.md) and [docs](https://example.com).\n' }),
    fakeRecord('0002', { supersedes: ['0001'] }),
  ];
  const calls: string[] = [];
  return {
    calls,
    records,
    issues: input.issues ?? [],
    graph(options?: GraphOptions) {
      calls.push(`graph:${(options?.kinds ?? ['supersedes']).join(',')}`);
      const kinds = new Set(options?.kinds ?? ['supersedes']);
      return {
        nodes: records,
        edges: (input.edges ?? [{ from: '0002', to: '0001', kind: 'supersedes' }]).filter((edge) => kinds.has(edge.kind)),
      };
    },
    queue(options?: QueueOptions) {
      calls.push(`queue:${options?.asOf ?? 'default'}`);
      return { asOf: options?.asOf ?? 'default', entries: input.entries ?? [fakeQueueEntry('0003')], issues: [] };
    },
  };
}
