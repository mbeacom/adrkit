import { afterEach, describe, expect, test } from 'bun:test';
import { registerGetDecision } from '../src/tools/get-decision.ts';
import { encodeCursor, queryShapeHash } from '../src/pagination/cursor.ts';
import {
  openTool,
  callTool,
  resultOf,
  healthOf,
  textOf,
  walkChannel,
  repoFromFixture,
  toolConfig,
  type TempRepo,
  type OpenServer,
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function open(repo: TempRepo): Promise<OpenServer> {
  cleanups.push(repo.cleanup);
  const harness = await openTool(registerGetDecision, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

describe('get_decision — pagination and cursor contracts', () => {
  test('a duplicate-id ambiguous walk returns every candidate exactly once, in canonical order', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const candidates = await walkChannel<{ sourcePath: string }>(async (cursor) => {
      const result = resultOf(await callTool(client, 'get_decision', { ref: '0010', limit: 1, ...(cursor ? { cursor } : {}) }));
      return { items: result.candidates, cursor: result.cursor };
    });
    expect(candidates.map((c) => c.sourcePath)).toEqual([
      'docs/adr/0010-first-duplicate.md',
      'docs/adr/0010-second-duplicate.md',
    ]);
  });

  test('candidate and findings channels page independently', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const first = resultOf(await callTool(client, 'get_decision', { ref: '0010', limit: 1, findingsLimit: 1 }));
    // Walk the candidate channel; the findings first page must stay put throughout.
    let cursor: string | undefined = first.cursor ?? undefined;
    while (cursor) {
      const page = resultOf(await callTool(client, 'get_decision', { ref: '0010', limit: 1, findingsLimit: 1, cursor }));
      expect(page.findings.items).toEqual(first.findings.items);
      cursor = page.cursor ?? undefined;
    }
  });

  test('the findings channel walks losslessly and independently of candidates', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const findings = await walkChannel<{ rule: string }>(async (findingsCursor) => {
      const result = resultOf(
        await callTool(client, 'get_decision', { ref: '0010', findingsLimit: 1, ...(findingsCursor ? { findingsCursor } : {}) }),
      );
      return { items: result.findings.items, cursor: result.findings.cursor };
    });
    expect(findings.length).toBe(4);
    expect(findings.filter((f) => f.rule === 'unique-id')).toHaveLength(2);
  });

  test('a primary cursor supplied against a found outcome is cursor-not-applicable, never ignored', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const first = await callTool(client, 'get_decision', { ref: '0001' });
    const fp = healthOf(first).fingerprint;
    const cursor = encodeCursor({ v: 1, scope: 'get_decision.candidates', fp, qh: queryShapeHash(['0001', 20]), offset: 1 });
    const res = await callTool(client, 'get_decision', { ref: '0001', cursor });
    const result = resultOf(res);
    expect(result.outcome).toBe('invalid-cursor');
    expect(result.reason).toBe('cursor-not-applicable');
    expect(textOf(res)).toBe('Cursor does not apply to this outcome.');
    expect(healthOf(res).fingerprint).toBe(fp); // corpusHealth still present on invalid-cursor
  });

  test('every invalid-cursor reason is reachable with its fixed message', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const first = await callTool(client, 'get_decision', { ref: '0010', limit: 1 });
    const fp = healthOf(first).fingerprint;
    const qh = queryShapeHash(['0010', 1]);

    const cases: Array<[string, string, string]> = [
      ['decode-failed', 'Cursor could not be decoded.', 'not-a-cursor'],
      ['version-unsupported', 'Cursor version is not supported.', Buffer.from(JSON.stringify({ v: 2, scope: 'get_decision.candidates', fp, qh, offset: 1 })).toString('base64url')],
      ['wrong-channel', 'Cursor does not belong to this tool channel.', encodeCursor({ v: 1, scope: 'search.results', fp, qh, offset: 1 })],
      ['corpus-changed', 'Corpus changed after this cursor was issued.', encodeCursor({ v: 1, scope: 'get_decision.candidates', fp: 'f'.repeat(64), qh, offset: 1 })],
      ['query-mismatch', 'Cursor was issued for different request parameters.', encodeCursor({ v: 1, scope: 'get_decision.candidates', fp, qh: queryShapeHash(['9999', 1]), offset: 1 })],
      ['offset-out-of-range', 'Cursor offset is outside the current result set.', encodeCursor({ v: 1, scope: 'get_decision.candidates', fp, qh, offset: 2 })],
    ];
    for (const [reason, message, cursor] of cases) {
      const res = await callTool(client, 'get_decision', { ref: '0010', limit: 1, cursor });
      const result = resultOf(res);
      expect(result.outcome).toBe('invalid-cursor');
      expect(result.reason).toBe(reason);
      expect(textOf(res)).toBe(message);
    }
  });

  test('responses carry schema-valid structured content and never interpolate a corpus path', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    for (const ref of ['0001', '9999', 'payments:0001']) {
      const res = await callTool(client, 'get_decision', { ref });
      expect(res.structuredContent).toBeDefined();
      expect(textOf(res)).not.toContain('docs/adr');
      expect(textOf(res).length).toBeLessThanOrEqual(512);
    }
  });

  test('bounded strict inputs are rejected by the SDK before the handler runs', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const unknown = await callTool(client, 'get_decision', { ref: '0001', bogus: 1 });
    expect(unknown.isError).toBe(true);
    const overLong = await callTool(client, 'get_decision', { ref: 'x'.repeat(200) });
    expect(overLong.isError).toBe(true);
  });
});
