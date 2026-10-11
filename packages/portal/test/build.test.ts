/**
 * `src/data/build.ts` — `buildPortalData`, `buildPathTable`, and the canonical serializer
 * (ADR-0054 clauses 3, 5, 6).
 *
 * ADR-0016 clause 2: observed failing. Each mutation was made in `src/data/build.ts`, the
 * suite run, and the edit reverted; the retained input is the mutation named here.
 * - the corpus-error guard in `buildPortalData` removed: "refuses an available table over a
 *   corpus with errors" failed.
 * - `canonicalJson` keys left in insertion order (the `.sort(...)` dropped): "serializes
 *   canonically" and "canonicalJson refuses values the contract cannot carry" failed. (The
 *   key-order test still passed: the builder constructs every object in a fixed order, so
 *   it does not depend on the serializer's sort; the sort is what makes a hand-built file
 *   canonical.)
 * - the byte check in `buildPathTable` changed from `bytes + size > limits.bytes` to
 *   `bytes > limits.bytes`: "the byte cap keeps the longest prefix whose serialized entries
 *   fit" failed.
 * - the graph called with no `kinds`: "maps a real SDK handle" (missing `relatesTo` and
 *   `conflictsWith` edges) and "asks the handle for all three edge kinds" failed.
 * - `pathLookup` written as `options.pathLookup` (not rebuilt from `route`): "the pathLookup
 *   hint is rebuilt from its route" failed on the leaked key; the `absent`-only guard
 *   removed: "a pathLookup hint is refused beside a table" failed; the route check removed:
 *   "a pathLookup route must be page-relative" failed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTestDir, resetTestDir } from '../../core/test/helpers.ts';
import { openDecisions, type DecisionSet, type PathGovernance } from '@adrkit/sdk/src/index.ts';
import { writeBrokenCorpus, writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import {
  buildPathTable,
  buildPortalData,
  canonicalJson,
  serializePortalData,
  type BuildPortalDataOptions,
} from '../src/data/build.ts';
import type { PortalPathTableAvailable } from '../src/data/contract.ts';
import { fakeHandle, fakeQueueEntry, fakeRecord } from './fake-handle.ts';

const HEALTHY = 'portal-build-healthy';
const BROKEN = 'portal-build-broken';
const COMMIT = 'a'.repeat(40);
const OPTIONS: BuildPortalDataOptions = { dir: 'docs/adr', commit: COMMIT, asOf: '2026-07-05', pathTable: { state: 'absent' } };

let healthy: DecisionSet;
let broken: DecisionSet;
let healthyRoot: string;

beforeAll(async () => {
  healthyRoot = await resetTestDir(HEALTHY);
  const brokenRoot = await resetTestDir(BROKEN);
  await writeHealthyCorpus(healthyRoot);
  await writeBrokenCorpus(brokenRoot);
  healthy = await openDecisions({ cwd: healthyRoot });
  broken = await openDecisions({ cwd: brokenRoot });
});

afterAll(async () => {
  await cleanupTestDir(HEALTHY);
  await cleanupTestDir(BROKEN);
});

function governance(path: string, groups: Partial<Record<'governing' | 'activeProposals' | 'history', string[]>>): PathGovernance {
  const decision = (id: string) => ({
    id,
    title: `Decision ${id}`,
    status: 'accepted' as const,
    standing: 'governing' as const,
    matchedBy: [{ kind: 'marker' as const, line: 1 }, { kind: 'affects' as const, type: 'path', pattern: '**' }, { kind: 'marker' as const, line: 9 }],
  });
  return {
    path,
    governing: (groups.governing ?? []).map(decision),
    activeProposals: (groups.activeProposals ?? []).map(decision),
    history: (groups.history ?? []).map(decision),
    issues: [],
  };
}

describe('buildPortalData', () => {
  test('maps a real SDK handle: records, issues, all three edge kinds, and the queue', () => {
    const data = buildPortalData(healthy, OPTIONS);
    expect(data.version).toBe('1');
    expect(data.dir).toBe('docs/adr');
    expect(data.commit).toBe(COMMIT);
    expect(data.asOf).toBe('2026-07-05');
    expect(data.records.map((record) => record.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
    expect(data.records[2]).toMatchObject({ id: '0003', status: 'superseded', standing: 'history', supersededBy: '0004' });
    expect(data.records[0]!.supersededBy).toBeNull();
    expect(data.records[6]!.tags).toEqual(['offline', 'sync']);
    expect(data.issues.map((issue) => [issue.code, issue.severity])).toEqual([['corpus-file-skipped', 'warn']]);
    expect(data.graph.nodes[0]).toEqual({ id: '0001', title: 'Use the sync protocol', status: 'accepted' });
    expect(data.graph.edges).toEqual([
      { from: '0002', to: '0001', kind: 'relatesTo' },
      { from: '0004', to: '0003', kind: 'supersedes' },
      { from: '0005', to: '0004', kind: 'conflictsWith' },
    ]);
    expect(data.queue.map((entry) => entry.id)).toEqual(['0005', '0006']);
    expect(data.queue[0]).toEqual({
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
    });
    expect(data.records[0]!.body[0]).toEqual({
      type: 'heading',
      level: 1,
      slug: 'adr-0001-use-the-sync-protocol',
      children: [{ type: 'text', text: 'ADR-0001: Use the sync protocol' }],
    });
  });

  test('asks the handle for all three edge kinds and the given asOf, and never for governance', () => {
    const handle = fakeHandle();
    buildPortalData(handle, OPTIONS);
    expect(handle.calls).toEqual(['graph:supersedes,relatesTo,conflictsWith', 'queue:2026-07-05']);
    expect('governing' in handle).toBe(false);
  });

  test('rewrites a body link to another record into its route', () => {
    const data = buildPortalData(fakeHandle(), OPTIONS);
    expect(data.records[0]!.body).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'See ' },
          { type: 'link', kind: 'record', id: '0002', href: '#/adr/0002', children: [{ type: 'text', text: 'the successor' }] },
          { type: 'text', text: ' and ' },
          { type: 'link', kind: 'external', href: 'https://example.com/', children: [{ type: 'text', text: 'docs' }] },
          { type: 'text', text: '.' },
        ],
      },
    ]);
  });

  test('publishes only the contract fields, whatever else a handle carries', () => {
    const record = { ...fakeRecord('0001'), secret: 'do not publish', frontmatter: { x: 1 } };
    const entry = { ...fakeQueueEntry('0002'), ready: true };
    const data = buildPortalData(
      fakeHandle({ records: [record], entries: [entry], issues: [{ code: 'x', severity: 'warn', message: 'm', extra: 1 } as never] }),
      {
        ...OPTIONS,
        pathTable: {
          state: 'available',
          capped: false,
          caps: { count: 1, bytes: 1000, extra: 1 } as never,
          governedPathCount: 1,
          entries: [{ path: 'a', governing: [{ id: '0001', evidence: ['affects'], note: 'x' } as never], activeProposals: [], history: [] }],
          extra: true,
        } as never,
      },
    );
    const json = serializePortalData(data);
    for (const leaked of ['secret', 'frontmatter', 'ready', 'extra', 'note']) expect(json).not.toContain(`"${leaked}"`);
    expect(data.issues).toEqual([{ code: 'x', severity: 'warn', message: 'm', path: null }]);
  });

  test('refuses an available table over a corpus with errors (clause 6)', () => {
    const table = buildPathTable([governance('src/a.ts', { governing: ['0001'] })]);
    expect(() => buildPortalData(broken, { ...OPTIONS, pathTable: table })).toThrow(TypeError);
    const unavailable = buildPortalData(broken, { ...OPTIONS, pathTable: { state: 'unavailable', reason: 'corpus-errors' } });
    expect(unavailable.pathTable).toEqual({ state: 'unavailable', reason: 'corpus-errors' });
    expect(unavailable.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(buildPortalData(broken, OPTIONS).pathTable).toEqual({ state: 'absent' });
  });

  test('validates its options', () => {
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, dir: '' })).toThrow(TypeError);
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, commit: 'HEAD' })).toThrow(TypeError);
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, commit: 'A'.repeat(40) })).toThrow(TypeError);
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, asOf: '2026-07-05T00:00:00Z' })).toThrow(TypeError);
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, pathTable: { state: 'nope' } as never })).toThrow(TypeError);
    expect(() => buildPortalData(healthy, { ...OPTIONS, asOf: '2026-02-30' })).toThrow(RangeError);
    expect(buildPortalData(fakeHandle(), { ...OPTIONS, commit: null }).commit).toBeNull();
    expect(buildPortalData(fakeHandle(), { ...OPTIONS, commit: 'b'.repeat(64) }).commit).toBe('b'.repeat(64));
  });
});

describe('the pathLookup hint (ADR-0055 clause 9)', () => {
  const LOOKUP = { route: '../../api/v1/corpora/demo/governing' };

  test('is null unless a host passes one', () => {
    expect(buildPortalData(fakeHandle(), OPTIONS).pathLookup).toBeNull();
    expect(buildPortalData(fakeHandle(), { ...OPTIONS, pathLookup: null }).pathLookup).toBeNull();
    expect(serializePortalData(buildPortalData(fakeHandle(), OPTIONS))).toContain('"pathLookup":null,"pathTable":');
  });

  test('the pathLookup hint is rebuilt from its route', () => {
    const data = buildPortalData(fakeHandle(), { ...OPTIONS, pathLookup: { ...LOOKUP, extra: 'x' } as never });
    expect(data.pathLookup).toEqual(LOOKUP);
    expect(serializePortalData(data)).not.toContain('"extra"');
  });

  test('a pathLookup hint is refused beside a table', () => {
    const table = buildPathTable([governance('src/a.ts', { governing: ['0001'] })]);
    expect(() => buildPortalData(healthy, { ...OPTIONS, pathTable: table, pathLookup: LOOKUP })).toThrow(TypeError);
    expect(() => buildPortalData(broken, { ...OPTIONS, pathTable: { state: 'unavailable', reason: 'corpus-errors' }, pathLookup: LOOKUP })).toThrow(TypeError);
    // The server always passes `absent`, so a corpus with errors still carries the hint.
    expect(buildPortalData(broken, { ...OPTIONS, pathLookup: LOOKUP }).pathLookup).toEqual(LOOKUP);
  });

  test('a pathLookup route must be page-relative', () => {
    for (const route of ['./governing', 'governing', '../../api/v1/corpora/a.b_c-d/governing']) {
      expect({ route, kept: buildPortalData(fakeHandle(), { ...OPTIONS, pathLookup: { route } }).pathLookup?.route }).toEqual({ route, kept: route });
    }
    for (const route of ['', '/api/v1/governing', '//evil.invalid/x', 'https://evil.invalid/x', 'javascript:alert(1)', 'governing?path=a', 'governing#x', '../a/../b', 'a b', 'a/<b>', `a/${'x'.repeat(512)}`, 42]) {
      expect({ route, threw: (() => { try { buildPortalData(fakeHandle(), { ...OPTIONS, pathLookup: { route } as never }); return false; } catch (error) { return error instanceof TypeError; } })() }).toEqual({ route, threw: true });
    }
    expect(() => buildPortalData(fakeHandle(), { ...OPTIONS, pathLookup: 'governing' as never })).toThrow(TypeError);
  });

  test('is byte-identical across calls, with and without the hint', () => {
    const without = serializePortalData(buildPortalData(healthy, OPTIONS));
    expect(serializePortalData(buildPortalData(healthy, { ...OPTIONS, pathLookup: null }))).toBe(without);
    const withHint = serializePortalData(buildPortalData(healthy, { ...OPTIONS, pathLookup: LOOKUP }));
    expect(serializePortalData(buildPortalData(healthy, { ...OPTIONS, pathLookup: { ...LOOKUP } }))).toBe(withHint);
    expect(withHint).toBe(without.replace('"pathLookup":null', `"pathLookup":{"route":"${LOOKUP.route}"}`));
  });
});

describe('determinism', () => {
  test('is byte-identical across calls and across separately opened handles', async () => {
    const first = serializePortalData(buildPortalData(healthy, OPTIONS));
    expect(serializePortalData(buildPortalData(healthy, OPTIONS))).toBe(first);
    const reopened = await openDecisions({ cwd: healthyRoot });
    expect(serializePortalData(buildPortalData(reopened, OPTIONS))).toBe(first);
  });

  test('is byte-identical whatever order a handle\'s objects list their keys in', () => {
    const reorder = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const records = [fakeRecord('0001'), fakeRecord('0002')];
    const entries = [fakeQueueEntry('0003')];
    const forward = serializePortalData(buildPortalData(fakeHandle({ records, entries }), OPTIONS));
    const backward = serializePortalData(
      buildPortalData(fakeHandle({ records: records.map(reorder), entries: entries.map(reorder) }), {
        pathTable: { state: 'absent' },
        asOf: OPTIONS.asOf,
        commit: OPTIONS.commit,
        dir: OPTIONS.dir,
      }),
    );
    expect(backward).toBe(forward);
  });

  test('serializes canonically: sorted keys, no whitespace, one trailing newline', () => {
    const json = serializePortalData(buildPortalData(fakeHandle(), OPTIONS));
    expect(json.endsWith('}\n')).toBe(true);
    expect(json.indexOf('\n')).toBe(json.length - 1);
    expect(json.startsWith('{"asOf":"2026-07-05","commit":"' + COMMIT + '","dir":"docs/adr","graph":')).toBe(true);
    expect(JSON.parse(json).version).toBe('1');
  });

  test('canonicalJson refuses values the contract cannot carry', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError);
    expect(() => canonicalJson({ a: new Map() })).toThrow(TypeError);
    expect(canonicalJson({ b: [1, 'x', null, true], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[1,"x",null,true]}');
  });
});

describe('buildPathTable', () => {
  const resolutions = [
    governance('src/b.ts', { governing: ['0001'] }),
    governance('README.md', {}),
    governance('src/a.ts', { activeProposals: ['0005'], history: ['0003'] }),
    governance('Src/Z.ts', { governing: ['0004'] }),
    governance('src/é-🙂.ts', { governing: ['0001'] }),
  ];

  test('keeps governed paths only, sorted by code unit, with evidence kinds deduplicated and ordered', () => {
    const table = buildPathTable(resolutions);
    expect(table.capped).toBe(false);
    expect(table.governedPathCount).toBe(4);
    expect(table.entries.map((entry) => entry.path)).toEqual(['Src/Z.ts', 'src/a.ts', 'src/b.ts', 'src/é-🙂.ts']);
    expect(table.entries[1]).toEqual({
      path: 'src/a.ts',
      governing: [],
      activeProposals: [{ id: '0005', evidence: ['affects', 'marker'] }],
      history: [{ id: '0003', evidence: ['affects', 'marker'] }],
    });
  });

  test('the count cap keeps the leading entries and says it capped', () => {
    const table = buildPathTable(resolutions, { count: 2, bytes: 1_000_000 });
    expect(table.entries.map((entry) => entry.path)).toEqual(['Src/Z.ts', 'src/a.ts']);
    expect(table).toMatchObject({ capped: true, governedPathCount: 4, caps: { count: 2, bytes: 1_000_000 } });
  });

  test('the byte cap keeps the longest prefix whose serialized entries fit', () => {
    const full = buildPathTable(resolutions);
    const exact = new TextEncoder().encode(canonicalJson(full.entries)).length;
    expect(buildPathTable(resolutions, { count: 100, bytes: exact }).capped).toBe(false);
    const short = buildPathTable(resolutions, { count: 100, bytes: exact - 1 });
    expect(short.capped).toBe(true);
    expect(short.entries.map((entry) => entry.path)).toEqual(['Src/Z.ts', 'src/a.ts', 'src/b.ts']);
    expect(new TextEncoder().encode(canonicalJson(short.entries)).length).toBeLessThanOrEqual(exact - 1);
    expect(buildPathTable(resolutions, { count: 100, bytes: 0 })).toMatchObject({ capped: true, entries: [] });
  });

  test('round-trips through the builder unchanged', () => {
    const table: PortalPathTableAvailable = buildPathTable(resolutions, { count: 3, bytes: 1_000_000 });
    expect(buildPortalData(fakeHandle(), { ...OPTIONS, pathTable: table }).pathTable).toEqual(table);
  });

  test('refuses malformed caps', () => {
    expect(() => buildPathTable(resolutions, { count: -1, bytes: 1 })).toThrow(TypeError);
    expect(() => buildPathTable(resolutions, { count: 1, bytes: 1.5 })).toThrow(TypeError);
  });
});
