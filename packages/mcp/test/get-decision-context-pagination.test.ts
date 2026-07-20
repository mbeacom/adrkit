import { afterEach, describe, expect, test } from 'bun:test';
import { registerGetDecisionContext } from '../src/tools/get-decision-context.ts';
import { registerGetDecision } from '../src/tools/get-decision.ts';
import { encodeCursor, queryShapeHash } from '../src/pagination/cursor.ts';
import { compareCodeUnits } from '../src/corpus/ordering.ts';
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
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function open(repo: TempRepo) {
  cleanups.push(repo.cleanup);
  const harness = await openTool(registerGetDecisionContext, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

const filesQh = (files: string[], limit: number) => queryShapeHash([[...new Set(files)].sort(compareCodeUnits), limit]);

describe('get_decision_context — pagination and determinism', () => {
  test('one flat canonical result walk, partitioned per page, returns every match once', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const collected = await walkChannel<{ id: string }>(async (cursor) => {
      const result = resultOf(
        await callTool(client, 'get_decision_context', { files: ['src/app.ts'], limit: 2, ...(cursor ? { cursor } : {}) }),
      );
      return { items: [...result.governing, ...result.activeProposals, ...result.history], cursor: result.cursor };
    });
    expect(collected.map((e) => e.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006']);
  });

  test('files[] query binding is canonical and de-duplicated (order and dups do not matter)', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const first = resultOf(await callTool(client, 'get_decision_context', { files: ['src/app.ts', 'src/lib.ts'], limit: 2 }));
    // Same set, different order + a duplicate: the returned cursor must still apply.
    const next = resultOf(
      await callTool(client, 'get_decision_context', { files: ['src/lib.ts', 'src/app.ts', 'src/app.ts'], limit: 2, cursor: first.cursor }),
    );
    expect(next.outcome).toBe('matches');
  });

  test('derived findings are NOT part of the fingerprint (context vs get_decision agree)', async () => {
    const repo = await repoFromFixture('degraded-corpus');
    cleanups.push(repo.cleanup);
    const config = await toolConfig(repo.root, repo.dir);
    const ctx = await openTool(registerGetDecisionContext, config);
    cleanups.push(ctx.close);
    const get = await openTool(registerGetDecision, config);
    cleanups.push(get.close);

    const ctxRes = await callTool(ctx.client, 'get_decision_context', { files: ['src/app.ts'] });
    const getRes = await callTool(get.client, 'get_decision', { ref: '0032' });
    // The context call has an extra derived affects-unresolvable finding get_decision lacks.
    const ctxFindings = resultOf(ctxRes).findings.items.map((f: { rule: string }) => f.rule);
    const getFindings = resultOf(getRes).findings.items.map((f: { rule: string }) => f.rule);
    expect(ctxFindings).toContain('affects-unresolvable');
    expect(getFindings).not.toContain('affects-unresolvable');
    // Yet the fingerprint (which hashes corpus projection only) is identical.
    expect(healthOf(ctxRes).fingerprint).toBe(healthOf(getRes).fingerprint);
  });

  test('the fingerprint is unchanged across two different files[] inputs', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const a = healthOf(await callTool(client, 'get_decision_context', { files: ['src/app.ts'] })).fingerprint;
    const b = healthOf(await callTool(client, 'get_decision_context', { files: ['docs/readme.md'] })).fingerprint;
    expect(a).toBe(b);
  });

  test('every applicable-channel cursor failure is reported with its fixed message', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const files = ['src/app.ts'];
    const first = await callTool(client, 'get_decision_context', { files, limit: 2 });
    const fp = healthOf(first).fingerprint;
    const qh = filesQh(files, 2);
    const cases: Array<[string, string]> = [
      ['decode-failed', 'not-a-cursor'],
      ['wrong-channel', encodeCursor({ v: 1, scope: 'search.results', fp, qh, offset: 1 })],
      ['corpus-changed', encodeCursor({ v: 1, scope: 'context.results', fp: 'f'.repeat(64), qh, offset: 1 })],
      ['query-mismatch', encodeCursor({ v: 1, scope: 'context.results', fp, qh: filesQh(['other.ts'], 2), offset: 1 })],
      ['offset-out-of-range', encodeCursor({ v: 1, scope: 'context.results', fp, qh, offset: 6 })],
    ];
    for (const [reason, cursor] of cases) {
      const result = resultOf(await callTool(client, 'get_decision_context', { files, limit: 2, cursor }));
      expect(result.outcome).toBe('invalid-cursor');
      expect(result.reason).toBe(reason);
    }
  });

  test('text never interpolates a corpus path and stays within the 512 cap', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision_context', { files: ['src/app.ts'] });
    expect(textOf(res)).not.toContain('docs/adr');
    expect(textOf(res).length).toBeLessThanOrEqual(512);
  });
});
