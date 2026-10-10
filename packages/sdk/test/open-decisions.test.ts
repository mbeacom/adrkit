/**
 * `@adrkit/sdk` — behaviour of every entry point, against fixture corpora.
 *
 * ADR-0016 clause 2: observed failing. Each mutation was made in `src/decision-set.ts`, the
 * suite run, and the edit reverted; the retained input is the mutation named here.
 * - `standing` set to the constant `'governing'` in `recordFromAdr`: "are flat, with standing
 *   precomputed from status" failed.
 * - supersession edges emitted as `{ from: edge.to, to: edge.from }`: "nodes are full records
 *   and edges are supersession only" failed (and two CLI-equivalence edge tests).
 * - the corpus-error gate in `governing` disabled: "a corpus that does not parse answers with
 *   no groups and its own findings" failed (and the broken-fixture explain equivalence).
 * - marker evidence dropped from `governingFromExplained`: both marker tests here failed (and
 *   two explain equivalence tests).
 * - `body` mapped as `adr.body.trim()`: "are flat, with standing precomputed from status" and
 *   "body is the raw text after the closing fence" failed (and three body equivalence tests).
 * - `unresolvedObjectionCount` mapped from the resolved count: "projects proposed records with
 *   SLA state" failed (and the healthy fixture's queue equivalence).
 * - every edge's `kind` hard-coded to `supersedes`: "kinds selects relationship edges" failed
 *   (and five edge equivalence tests).
 * - the default kinds set to all three: "edges are supersession only by default" and "is
 *   computed once per kinds selection" failed (and two edge equivalence tests).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { acceptedRecordMarkdown, cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { openDecisions, type DecisionSet } from '../src/index.ts';
import { writeBrokenCorpus, writeHealthyCorpus } from './fixture.ts';

const HEALTHY = 'sdk-open-healthy';
const BROKEN = 'sdk-open-broken';

let healthyRoot: string;
let brokenRoot: string;
let healthy: DecisionSet;
let broken: DecisionSet;

beforeAll(async () => {
  healthyRoot = await resetTestDir(HEALTHY);
  brokenRoot = await resetTestDir(BROKEN);
  await writeHealthyCorpus(healthyRoot);
  await writeBrokenCorpus(brokenRoot);
  healthy = await openDecisions({ cwd: healthyRoot });
  broken = await openDecisions({ cwd: brokenRoot });
});

afterAll(async () => {
  await cleanupTestDir(HEALTHY);
  await cleanupTestDir(BROKEN);
});

describe('openDecisions', () => {
  test('defaults the corpus directory to docs/adr under cwd', () => {
    expect(healthy.records.map((record) => record.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
  });

  test('accepts an explicit dir, resolved against cwd', async () => {
    const set = await openDecisions({ cwd: healthyRoot, dir: './docs/adr' });
    expect(set.records).toHaveLength(7);
  });

  test('rejects when the corpus directory does not exist, naming it', async () => {
    const attempt = openDecisions({ cwd: healthyRoot, dir: 'no/such/dir' });
    await expect(attempt).rejects.toThrow('Corpus directory not found: "no/such/dir"');
  });

  test('rejects when the corpus directory is a file', async () => {
    await expect(openDecisions({ cwd: healthyRoot, dir: 'src/sync/retry.ts' })).rejects.toThrow(
      'Corpus directory not found',
    );
  });

  test('an empty corpus directory is an empty set, not an error', async () => {
    const root = await resetTestDir('sdk-open-empty');
    try {
      await writeText(join(root, 'docs/adr/README.md'), '# Decisions\n');
      const set = await openDecisions({ cwd: root });
      expect(set.records).toEqual([]);
      expect(set.issues).toEqual([]);
      expect(set.graph()).toEqual({ nodes: [], edges: [] });
    } finally {
      await cleanupTestDir('sdk-open-empty');
    }
  });

  test('does not throw for a corpus that fails to parse', () => {
    expect(broken.records.map((record) => record.id)).toEqual(['0001', '0003']);
    expect(broken.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });
});

describe('records', () => {
  test('are flat, with standing precomputed from status', () => {
    expect(healthy.get('0001')).toEqual({
      id: '0001',
      title: 'Use the sync protocol',
      status: 'accepted',
      standing: 'governing',
      date: '2026-07-18',
      path: 'docs/adr/0001-use-the-sync-protocol.md',
      tags: [],
      supersedes: [],
      body: '\n# ADR-0001: Use the sync protocol\n',
    });
    const standings = Object.fromEntries(healthy.records.map((record) => [record.id, record.standing]));
    expect(standings).toEqual({
      '0001': 'governing',
      '0002': 'governing',
      '0003': 'history',
      '0004': 'governing',
      '0005': 'activeProposals',
      '0006': 'activeProposals',
      '0007': 'activeProposals',
    });
  });

  test('carry both halves of the supersession edge and tags', () => {
    expect(healthy.get('0003')?.supersededBy).toBe('0004');
    expect(healthy.get('0004')?.supersedes).toEqual(['0003']);
    expect(healthy.get('0007')?.tags).toEqual(['offline', 'sync']);
    expect('supersededBy' in healthy.get('0001')!).toBe(false);
  });

  test('carry their body and no core-only field', () => {
    expect(Object.keys(healthy.get('0004')!).sort()).toEqual(
      ['body', 'date', 'id', 'path', 'standing', 'status', 'supersedes', 'tags', 'title'].sort(),
    );
  });

  test('body is the raw text after the closing fence: unrendered, unsanitized, line endings kept', async () => {
    const root = await resetTestDir('sdk-open-body');
    try {
      const body = '\r\n# Title\r\n\r\n<script>alert(1)</script>\r\n\r\n---\r\n\r\n*after a thematic break*\r\n';
      const markdown = acceptedRecordMarkdown('0001', 'Keep the body verbatim').replace(/\n/g, '\r\n');
      const frontmatterEnd = markdown.indexOf('---\r\n', 4) + '---\r\n'.length;
      await writeText(join(root, 'docs/adr/0001-keep-the-body-verbatim.md'), markdown.slice(0, frontmatterEnd) + body);
      const set = await openDecisions({ cwd: root });
      expect(set.issues).toEqual([]);
      expect(set.get('0001')?.body).toBe(body);
    } finally {
      await cleanupTestDir('sdk-open-body');
    }
  });

  test('are frozen, so one consumer cannot corrupt the shared handle', () => {
    expect(Object.isFrozen(healthy.records)).toBe(true);
    expect(Object.isFrozen(healthy.get('0004'))).toBe(true);
    expect(Object.isFrozen(healthy.get('0004')!.supersedes)).toBe(true);
  });
});

describe('issues', () => {
  test('a record discovery cannot see is a warn, never an error', () => {
    expect(healthy.issues).toEqual([
      {
        code: 'corpus-file-skipped',
        severity: 'warn',
        message: expect.stringContaining('subdirectory'),
        path: 'docs/adr/notes/0008-nested-record.md',
      },
    ]);
  });

  test('a record that does not parse is an error naming its file', () => {
    const parse = broken.issues.find((issue) => issue.code === 'frontmatter-parse');
    expect(parse).toMatchObject({ severity: 'error', path: 'docs/adr/0002-broken-yaml.md' });
  });

  test('a supersession target that does not exist is reported', () => {
    expect(broken.issues.find((issue) => issue.code === 'dangling-supersedes')).toMatchObject({
      severity: 'error',
      path: 'docs/adr/0003-replace-a-ghost.md',
    });
  });
});

describe('get', () => {
  test('finds a record by its zero-padded id', () => {
    expect(healthy.get('0004')?.title).toBe('Push changes over websockets');
  });

  test('pads a short numeric id', () => {
    expect(healthy.get('4')?.id).toBe('0004');
    expect(healthy.get('04')?.id).toBe('0004');
  });

  test('misses cleanly', () => {
    expect(healthy.get('0099')).toBeUndefined();
    expect(healthy.get('ADR-0004')).toBeUndefined();
    expect(healthy.get('')).toBeUndefined();
    // A record that failed to load is absent here and present in `issues`.
    expect(broken.get('0002')).toBeUndefined();
  });
});

describe('queue', () => {
  test('projects proposed records with SLA state against the supplied date', () => {
    const view = healthy.queue({ asOf: '2026-07-05' });
    expect(view.asOf).toBe('2026-07-05');
    expect(view.entries).toEqual([
      {
        id: '0005',
        title: 'Batch sync writes',
        path: 'docs/adr/0005-batch-sync-writes.md',
        tier: 'async',
        slaState: 'within-sla',
        deadline: '2026-07-11',
        approvalCount: 1,
        quorum: 2,
        unresolvedObjectionCount: 1,
        resolvedObjectionCount: 1,
        routingTargets: [],
        itemFindingCount: 1,
      },
      {
        id: '0006',
        title: 'Adopt a queue',
        path: 'docs/adr/0006-adopt-a-queue.md',
        tier: null,
        slaState: 'not-queued',
        deadline: null,
        approvalCount: 0,
        quorum: null,
        unresolvedObjectionCount: 0,
        resolvedObjectionCount: 0,
        routingTargets: ['@dave', '@erin'],
        itemFindingCount: 0,
      },
    ]);
  });

  test('approvals are distinct identities under casefold, not raw entries', () => {
    // 0005 lists `@alice` and `@Alice`: one person, one approval, so quorum 2 is not met.
    const entry = healthy.queue({ asOf: '2026-07-05' }).entries.find((candidate) => candidate.id === '0005');
    expect(entry?.approvalCount).toBe(1);
    expect(entry?.quorum).toBe(2);
  });

  test('carry review counts only, with no readiness verdict', () => {
    const [entry] = healthy.queue({ asOf: '2026-07-05' }).entries;
    expect(Object.keys(entry!).sort()).toEqual(
      [
        'approvalCount',
        'deadline',
        'id',
        'itemFindingCount',
        'path',
        'quorum',
        'resolvedObjectionCount',
        'routingTargets',
        'slaState',
        'tier',
        'title',
        'unresolvedObjectionCount',
      ].sort(),
    );
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry!.routingTargets)).toBe(true);
  });

  test('SLA state moves with the date', () => {
    expect(healthy.queue({ asOf: '2026-08-01' }).entries[0]?.slaState).toBe('overdue');
  });

  test('reports the skipped file with the queue contract code', () => {
    expect(healthy.queue({ asOf: '2026-07-05' }).issues).toEqual([
      {
        code: 'corpus.file-skipped',
        severity: 'warn',
        message: expect.any(String),
        path: 'docs/adr/notes/0008-nested-record.md',
      },
    ]);
  });

  test('a broken corpus still queues what loaded and names what did not', () => {
    const view = broken.queue({ asOf: '2026-07-05' });
    expect(view.issues.some((issue) => issue.code === 'corpus.parse-error' && issue.severity === 'error')).toBe(true);
  });

  test('defaults to today, as a UTC calendar date', () => {
    const before = new Date().toISOString().slice(0, 10);
    const { asOf } = healthy.queue();
    const after = new Date().toISOString().slice(0, 10);
    expect([before, after]).toContain(asOf);
  });

  test('refuses anything but a real bare calendar date', () => {
    for (const asOf of ['2026-02-30', '2026-07-05T00:00:00Z', '2026-07-05T00:00:00', 'today', '']) {
      expect(() => healthy.queue({ asOf })).toThrow(RangeError);
    }
  });
});

describe('graph', () => {
  test('nodes are full records and edges are supersession only by default', () => {
    const graph = healthy.graph();
    expect(graph.nodes.map((node) => node.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
    expect(graph.nodes[3]).toBe(healthy.get('0004')!);
    // Successor -> replaced: 0004 supersedes 0003.
    expect(graph.edges).toEqual([{ from: '0004', to: '0003', kind: 'supersedes' }]);
  });

  test('kinds selects relationship edges, from the declaring record to the one it names', () => {
    expect(healthy.graph({ kinds: ['relatesTo'] }).edges).toEqual([{ from: '0002', to: '0001', kind: 'relatesTo' }]);
    expect(healthy.graph({ kinds: ['conflictsWith'] }).edges).toEqual([
      { from: '0005', to: '0004', kind: 'conflictsWith' },
    ]);
    expect(healthy.graph({ kinds: ['conflictsWith', 'relatesTo', 'supersedes'] }).edges).toEqual([
      { from: '0002', to: '0001', kind: 'relatesTo' },
      { from: '0004', to: '0003', kind: 'supersedes' },
      { from: '0005', to: '0004', kind: 'conflictsWith' },
    ]);
  });

  test('kinds filter edges, never nodes', () => {
    const relates = healthy.graph({ kinds: ['relatesTo'] });
    expect(relates.nodes).toBe(healthy.graph().nodes);
    expect(relates.nodes).toHaveLength(7);
  });

  test('refuses an empty or unknown kinds list', () => {
    expect(() => healthy.graph({ kinds: [] })).toThrow(RangeError);
    expect(() => healthy.graph({ kinds: ['supersededBy' as never] })).toThrow(RangeError);
  });

  test('a dangling supersession target is not an edge, and is an issue', () => {
    expect(broken.graph().edges).toEqual([]);
    expect(broken.issues.map((issue) => issue.code)).toContain('dangling-supersedes');
  });

  test('is computed once per kinds selection', () => {
    expect(healthy.graph()).toBe(healthy.graph());
    expect(healthy.graph({ kinds: ['supersedes'] })).toBe(healthy.graph());
    expect(healthy.graph({ kinds: ['relatesTo', 'supersedes', 'relatesTo'] })).toBe(
      healthy.graph({ kinds: ['supersedes', 'relatesTo'] }),
    );
    expect(Object.isFrozen(healthy.graph({ kinds: ['relatesTo'] }).edges[0])).toBe(true);
  });
});

describe('governing', () => {
  test('groups pattern matches by standing, with the matcher as evidence', async () => {
    const result = await healthy.governing('src/sync/protocol.ts');
    expect(result.path).toBe('src/sync/protocol.ts');
    expect(result.governing).toEqual([
      {
        id: '0001',
        title: 'Use the sync protocol',
        status: 'accepted',
        standing: 'governing',
        matchedBy: [{ kind: 'affects', type: 'path', pattern: 'src/sync/**' }],
      },
      {
        id: '0004',
        title: 'Push changes over websockets',
        status: 'accepted',
        standing: 'governing',
        matchedBy: [{ kind: 'affects', type: 'path', pattern: 'src/sync/protocol.ts' }],
      },
    ]);
    expect(result.activeProposals.map((decision) => decision.id)).toEqual(['0005']);
    expect(result.history.map((decision) => decision.id)).toEqual(['0003']);
    expect(result.issues).toEqual([]);
  });

  test('an inbound @adr marker governs, with its line as evidence', async () => {
    const result = await healthy.governing('src/sync/retry.ts');
    expect(result.governing.find((decision) => decision.id === '0002')).toEqual({
      id: '0002',
      title: 'Retry on transient failure',
      status: 'accepted',
      standing: 'governing',
      matchedBy: [{ kind: 'marker', line: 1 }],
    });
  });

  test('a marker naming a superseded record stays in history, with a stale-marker issue', async () => {
    const result = await healthy.governing('src/sync/stale.ts');
    const stale = result.history.find((decision) => decision.id === '0003');
    expect(stale?.matchedBy).toEqual([
      { kind: 'affects', type: 'path', pattern: 'src/sync/**' },
      { kind: 'marker', line: 1 },
    ]);
    expect(result.governing.map((decision) => decision.id)).toEqual(['0001']);
    expect(result.issues.map((issue) => issue.code)).toEqual(['stale-marker']);
  });

  test('readMarkers: false skips the file entirely', async () => {
    const result = await healthy.governing('src/sync/retry.ts', { readMarkers: false });
    expect(result.governing.map((decision) => decision.id)).toEqual(['0001']);
    expect(result.issues).toEqual([]);
  });

  test('a path with no file says it was not scanned, rather than reporting silence', async () => {
    const result = await healthy.governing('src/sync/not-written-yet.ts');
    expect(result.governing.map((decision) => decision.id)).toEqual(['0001']);
    expect(result.issues).toEqual([
      {
        code: 'marker-scan-absent',
        severity: 'info',
        message: expect.any(String),
        path: 'src/sync/not-written-yet.ts',
      },
    ]);
    const skipped = await healthy.governing('src/sync/not-written-yet.ts', { readMarkers: false });
    expect(skipped.issues).toEqual([]);
  });

  test('a path outside the working tree is never read, and says so', async () => {
    const result = await healthy.governing('../outside.ts');
    expect(result.issues.map((issue) => [issue.code, issue.severity])).toEqual([['marker-scan-out-of-tree', 'warn']]);
  });

  test('a path nothing governs is empty, not an error', async () => {
    const result = await healthy.governing('README.md', { readMarkers: false });
    expect(result).toEqual({ path: 'README.md', governing: [], activeProposals: [], history: [], issues: [] });
  });

  test('a corpus that does not parse answers with no groups and its own findings', async () => {
    const result = await broken.governing('src/sync/retry.ts');
    expect(result.governing).toEqual([]);
    expect(result.activeProposals).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.issues).toEqual(broken.issues);
  });
});
