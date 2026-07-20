import { afterEach, describe, expect, test } from 'bun:test';
import { registerSearchDecisions } from '../src/tools/search-decisions.ts';
import { encodeCursor, queryShapeHash } from '../src/pagination/cursor.ts';
import { normalize } from '../src/search/normalize.ts';
import {
  openTool,
  callTool,
  resultOf,
  healthOf,
  walkChannel,
  repoFromFixture,
  toolConfig,
  type TempRepo,
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function open(repo: TempRepo) {
  cleanups.push(repo.cleanup);
  const harness = await openTool(registerSearchDecisions, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

const resultsQh = (query: string, limit: number) => queryShapeHash([normalize(query), [], [], [], limit]);

describe('search_decisions — determinism and pagination', () => {
  test('results are in canonical (id, sourcePath) order, byte-identical across repeated calls', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const first = resultOf(await callTool(client, 'search_decisions', { query: 'the' }));
    const second = resultOf(await callTool(client, 'search_decisions', { query: 'the' }));
    expect(first.items.map((m: { id: string }) => m.id)).toEqual(['0001', '0004', '0005', '0006']);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('a multi-page walk is lossless and returns every match exactly once', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const collected = await walkChannel<{ id: string }>(async (cursor) => {
      const result = resultOf(await callTool(client, 'search_decisions', { query: 'the', limit: 1, ...(cursor ? { cursor } : {}) }));
      return { items: result.items, cursor: result.cursor };
    });
    expect(collected.map((m) => m.id)).toEqual(['0001', '0004', '0005', '0006']);
  });

  test('a cursor bound to a different query is rejected as query-mismatch', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const first = await callTool(client, 'search_decisions', { query: 'the', limit: 1 });
    const cursor = resultOf(first).cursor as string;
    const res = await callTool(client, 'search_decisions', { query: 'legacy', limit: 1, cursor });
    expect(resultOf(res).reason).toBe('query-mismatch');
  });

  test('a stale-corpus cursor (wrong fp) is corpus-changed', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const cursor = encodeCursor({ v: 1, scope: 'search.results', fp: 'f'.repeat(64), qh: resultsQh('the', 1), offset: 1 });
    const res = await callTool(client, 'search_decisions', { query: 'the', limit: 1, cursor });
    expect(resultOf(res).reason).toBe('corpus-changed');
  });

  test('a schema-invalid record degrades to a finding without suppressing valid matches', async () => {
    const { client } = await open(await repoFromFixture('degraded-corpus'));
    const result = resultOf(await callTool(client, 'search_decisions', { query: 'record' }));
    // 0031 and 0032 titles contain "record"; the invalid 0030 is excluded from matches.
    expect(result.items.map((m: { id: string }) => m.id).sort()).toEqual(['0031', '0032']);
    expect(result.items.some((m: { id: string }) => m.id === '0030')).toBe(false);
  });

  test('result and findings cursors are independent', async () => {
    const { client } = await open(await repoFromFixture('degraded-corpus'));
    const first = resultOf(await callTool(client, 'search_decisions', { query: 'record', limit: 1, findingsLimit: 1 }));
    expect(first.findings.items).toHaveLength(1);
    // Walking results does not disturb the findings first page.
    let cursor: string | undefined = first.cursor ?? undefined;
    while (cursor) {
      const page = resultOf(await callTool(client, 'search_decisions', { query: 'record', limit: 1, findingsLimit: 1, cursor }));
      expect(page.findings.items).toEqual(first.findings.items);
      cursor = page.cursor ?? undefined;
    }
  });

  test('every cursor failure branch is reachable with its fixed reason', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const fp = healthOf(await callTool(client, 'search_decisions', { query: 'the', limit: 1 })).fingerprint;
    const qh = resultsQh('the', 1);
    const cases: Array<[string, string]> = [
      ['decode-failed', 'garbage'],
      ['wrong-channel', encodeCursor({ v: 1, scope: 'get_decision.candidates', fp, qh, offset: 1 })],
      ['corpus-changed', encodeCursor({ v: 1, scope: 'search.results', fp: 'a'.repeat(64), qh, offset: 1 })],
      ['query-mismatch', encodeCursor({ v: 1, scope: 'search.results', fp, qh: resultsQh('other', 1), offset: 1 })],
      ['offset-out-of-range', encodeCursor({ v: 1, scope: 'search.results', fp, qh, offset: 4 })],
    ];
    for (const [reason, cursor] of cases) {
      expect(resultOf(await callTool(client, 'search_decisions', { query: 'the', limit: 1, cursor })).reason).toBe(reason);
    }
  });
});
