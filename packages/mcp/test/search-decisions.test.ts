import { afterEach, describe, expect, test } from 'bun:test';
import { registerSearchDecisions } from '../src/tools/search-decisions.ts';
import { openTool, callTool, resultOf, textOf, repoFromFixture, toolConfig, type TempRepo } from './helpers.ts';

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

async function search(repo: TempRepo, args: Record<string, unknown>) {
  const { client } = await open(repo);
  return resultOf(await callTool(client, 'search_decisions', args));
}

function ids(result: { items: Array<{ id: string }> }): string[] {
  return result.items.map((m) => m.id);
}

describe('search_decisions — matching', () => {
  test('a body-only term matches only via the body field', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'pgvector' });
    expect(ids(result)).toEqual(['0001']);
    expect(result.items[0].matchedFields).toEqual(['body']);
  });

  test('a title term also matches the body (the H1 heading repeats the title), in canonical field order', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'mongodb' });
    expect(ids(result)).toEqual(['0004']);
    expect(result.items[0].matchedFields).toEqual(['body', 'title']);
  });

  test('a tag term matches via the tag field', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'storage' });
    expect(ids(result)).toEqual(['0001']);
    expect(result.items[0].matchedFields).toEqual(['tag']);
  });

  test('trim + NFKC + lowercase normalization applies to the query', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: '  ＰＯＳＴＧＲＥＳＱＬ  ' });
    expect(ids(result)).toEqual(['0001']);
  });

  test('graveyard records are included by default', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'legacy' });
    expect(ids(result)).toEqual(['0005']); // superseded record, no status filter supplied
  });

  test('empty results are the same results branch with items []', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'zzzznomatch' });
    expect(result.outcome).toBe('results');
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  test('summaries never include the body', async () => {
    const result = await search(await repoFromFixture('status-corpus'), { query: 'the' });
    expect('body' in result.items[0]).toBe(false);
  });

  test('status is any-of, tags is all-of, and categories are ANDed', async () => {
    const repo = await repoFromFixture('status-corpus');
    const { client } = await open(repo);
    // any-of status: rejected only -> 0004
    expect(ids(resultOf(await callTool(client, 'search_decisions', { query: 'the', status: ['rejected'] })))).toEqual(['0004']);
    // all-of tags: [database, storage] -> only 0001 carries both
    expect(ids(resultOf(await callTool(client, 'search_decisions', { query: 'the', tags: ['database', 'storage'] })))).toEqual(['0001']);
    // ANDed: accepted AND tag storage -> 0001
    expect(ids(resultOf(await callTool(client, 'search_decisions', { query: 'the', status: ['accepted'], tags: ['storage'] })))).toEqual(['0001']);
    // scope any-of: org -> 0006
    expect(ids(resultOf(await callTool(client, 'search_decisions', { query: 'the', scope: ['org'] })))).toEqual(['0006']);
  });

  test('a whitespace-only query is rejected before any corpus access', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'search_decisions', { query: '   ' });
    expect(res.isError).toBe(true);
  });

  test('exact results text for zero, one, and many', async () => {
    const repo = await repoFromFixture('status-corpus');
    const { client } = await open(repo);
    expect(textOf(await callTool(client, 'search_decisions', { query: 'zzzz' }))).toBe(
      'Returned 0 decision results; 0 findings on this page.',
    );
    expect(textOf(await callTool(client, 'search_decisions', { query: 'pgvector' }))).toBe(
      'Returned 1 decision result; 0 findings on this page.',
    );
    expect(textOf(await callTool(client, 'search_decisions', { query: 'the' }))).toBe(
      'Returned 4 decision results; 0 findings on this page.',
    );
  });
});
