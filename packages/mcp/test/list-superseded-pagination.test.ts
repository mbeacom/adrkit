import { afterEach, describe, expect, test } from 'bun:test';
import { registerListSuperseded } from '../src/tools/list-superseded.ts';
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
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function open(repo: TempRepo) {
  cleanups.push(repo.cleanup);
  const harness = await openTool(registerListSuperseded, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

describe('list_superseded — ambiguity and pagination', () => {
  test('a multi-page walk is lossless and canonical', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const entries = await walkChannel<{ id: string }>(async (cursor) => {
      const result = resultOf(await callTool(client, 'list_superseded', { limit: 1, ...(cursor ? { cursor } : {}) }));
      return { items: result.items, cursor: result.cursor };
    });
    expect(entries.map((e) => e.id)).toEqual(['0011', '0012', '0013', '0014']);
  });

  test('findings page independently and one warn finding is minted per ambiguous entry', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const findings = await walkChannel<{ rule: string }>(async (findingsCursor) => {
      const result = resultOf(await callTool(client, 'list_superseded', { findingsLimit: 1, ...(findingsCursor ? { findingsCursor } : {}) }));
      return { items: result.findings.items, cursor: result.findings.cursor };
    });
    expect(findings.filter((f) => f.rule === 'superseded-target-ambiguous')).toHaveLength(1);
    expect(findings.length).toBe(6);
  });

  test('the ambiguous target is fully retrievable via a follow-up get_decision candidate walk', async () => {
    const repo = await repoFromFixture('edge-corpus');
    cleanups.push(repo.cleanup);
    const config = await toolConfig(repo.root, repo.dir);
    const superseded = await openTool(registerListSuperseded, config);
    cleanups.push(superseded.close);
    const get = await openTool(registerGetDecision, config);
    cleanups.push(get.close);

    const entry = resultOf(await callTool(superseded.client, 'list_superseded', {})).items.find(
      (e: { id: string }) => e.id === '0011',
    );
    const targetRef = entry.supersededBy.targetRef as string;
    const candidates = await walkChannel<{ sourcePath: string }>(async (cursor) => {
      const result = resultOf(await callTool(get.client, 'get_decision', { ref: targetRef, limit: 1, ...(cursor ? { cursor } : {}) }));
      return { items: result.candidates, cursor: result.cursor };
    });
    expect(candidates).toHaveLength(2);
  });

  test('every cursor failure branch is reachable with its fixed reason', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const fp = healthOf(await callTool(client, 'list_superseded', { limit: 1 })).fingerprint;
    const qh = queryShapeHash([1]);
    const cases: Array<[string, string]> = [
      ['decode-failed', 'garbage'],
      ['wrong-channel', encodeCursor({ v: 1, scope: 'search.results', fp, qh, offset: 1 })],
      ['corpus-changed', encodeCursor({ v: 1, scope: 'superseded.results', fp: 'a'.repeat(64), qh, offset: 1 })],
      ['query-mismatch', encodeCursor({ v: 1, scope: 'superseded.results', fp, qh: queryShapeHash([2]), offset: 1 })],
      ['offset-out-of-range', encodeCursor({ v: 1, scope: 'superseded.results', fp, qh, offset: 4 })],
    ];
    for (const [reason, cursor] of cases) {
      expect(resultOf(await callTool(client, 'list_superseded', { limit: 1, cursor })).reason).toBe(reason);
    }
  });

  test('text never interpolates a corpus path and stays within the 512 cap', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const res = await callTool(client, 'list_superseded', {});
    expect(textOf(res)).not.toContain('docs/adr');
    expect(textOf(res).length).toBeLessThanOrEqual(512);
  });
});
