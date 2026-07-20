import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { registerGetDecisionContext } from '../src/tools/get-decision-context.ts';
import {
  openTool,
  callTool,
  resultOf,
  healthOf,
  textOf,
  repoFromFixture,
  createRepo,
  writeRecords,
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

function record(id: string, status: string, affects: string): string {
  return `---
schemaVersion: 0.1.0
id: "${id}"
title: Context record ${id}
status: ${status}
date: 2026-04-01
${status === 'accepted' ? 'deciders:\n  - "@m"\n' : ''}affects:
${affects}
---

# ${id}
`;
}

describe('get_decision_context — resolution and partitioning', () => {
  test('partitions all six statuses across governing / activeProposals / history', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision_context', { files: ['src/app.ts'] });
    const result = resultOf(res);
    expect(result.outcome).toBe('matches');
    expect(result.governing.map((e: { id: string }) => e.id)).toEqual(['0001']);
    expect(result.activeProposals.map((e: { id: string }) => e.id)).toEqual(['0002', '0003']);
    expect(result.history.map((e: { id: string }) => e.id)).toEqual(['0004', '0005', '0006']);
    expect(textOf(res)).toBe(
      'Returned 6 context matches: 1 governing, 2 active proposals, 3 historical; 0 findings on this page.',
    );
  });

  test('reports fired matchers and unexpanded relations on each entry', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const result = resultOf(await callTool(client, 'get_decision_context', { files: ['src/app.ts'] }));
    const superseded = result.history.find((e: { id: string }) => e.id === '0005');
    expect(superseded.firedMatchers).toEqual([{ type: 'path', pattern: 'src/**' }]);
    expect(superseded.relations.supersededBy).toBe('0001');
    expect(superseded.relations.supersedes).toEqual([]);
  });

  test('zero matches is still the matches branch with three empty arrays', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision_context', { files: ['unrelated/elsewhere.txt'] });
    const result = resultOf(res);
    expect(result.outcome).toBe('matches');
    expect([result.governing, result.activeProposals, result.history]).toEqual([[], [], []]);
    expect(textOf(res)).toBe('Returned 0 context matches: 0 governing, 0 active proposals, 0 historical; 0 findings on this page.');
  });

  test('a repo-qualified matcher is inactive in this single-log phase', async () => {
    const repo = await createRepo();
    await writeRecords(repo, {
      '0050-repo-qualified.md': record('0050', 'accepted', '  - type: path\n    pattern: "src/**"\n    repo: other'),
    });
    const { client } = await open(repo);
    const result = resultOf(await callTool(client, 'get_decision_context', { files: ['src/app.ts'] }));
    expect(result.governing).toEqual([]);
  });

  test('an inert package matcher surfaces an informational affects-unresolvable finding', async () => {
    const { client } = await open(await repoFromFixture('degraded-corpus'));
    const result = resultOf(await callTool(client, 'get_decision_context', { files: ['src/app.ts'] }));
    const inert = result.findings.items.find((f: { rule: string }) => f.rule === 'affects-unresolvable');
    expect(inert.severity).toBe('info');
  });

  test('files[] are never opened — a nonexistent path still resolves against patterns', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const result = resultOf(await callTool(client, 'get_decision_context', { files: ['src/does-not-exist.ts'] }));
    expect(result.governing.map((e: { id: string }) => e.id)).toEqual(['0001']);
  });

  test('a corpus that cannot be loaded is corpus-unavailable', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const config = await toolConfig(repo.root, repo.dir);
    await rm(repo.adrDir, { recursive: true, force: true });
    const harness = await openTool(registerGetDecisionContext, config);
    cleanups.push(harness.close);
    const res = await callTool(harness.client, 'get_decision_context', { files: ['src/app.ts'] });
    expect(resultOf(res).outcome).toBe('corpus-unavailable');
    expect(healthOf(res)).toBeUndefined();
  });
});
