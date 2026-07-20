import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { registerListSuperseded } from '../src/tools/list-superseded.ts';
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
  const harness = await openTool(registerListSuperseded, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

function entryFor(result: { items: Array<{ id: string }> }, id: string) {
  return result.items.find((e) => e.id === id) as any;
}

describe('list_superseded — direct edges', () => {
  test('lists every superseded record with each direct target shape', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const res = await callTool(client, 'list_superseded', {});
    const result = resultOf(res);
    expect(result.outcome).toBe('entries');
    expect(result.items.map((e: { id: string }) => e.id)).toEqual(['0011', '0012', '0013', '0014']);

    expect(entryFor(result, '0014').supersededBy).toEqual({
      resolved: true,
      target: { id: '0015', title: 'Replacement target for supersession', status: 'accepted', sourcePath: 'docs/adr/0015-replacement-target.md' },
    });
    expect(entryFor(result, '0012').supersededBy).toEqual({ resolved: false, targetRef: '0099', reason: 'dangling' });
    expect(entryFor(result, '0011').supersededBy).toEqual({ resolved: false, targetRef: '0010', reason: 'ambiguous', candidateCount: 2 });
    expect(entryFor(result, '0013').supersededBy).toEqual({
      resolved: false,
      targetRef: 'payments:0020',
      reason: 'federated-unavailable',
      log: 'payments',
      id: '0020',
    });
  });

  test('an ambiguous entry carries candidateCount only, never a nested candidates array', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const entry = entryFor(resultOf(await callTool(client, 'list_superseded', {})), '0011');
    expect('candidates' in entry.supersededBy).toBe(false);
    expect(entry.supersededBy.candidateCount).toBe(2);
  });

  test('mints exactly the two derived finding templates and keeps the core dangling findings', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const findings = resultOf(await callTool(client, 'list_superseded', {})).findings.items as Array<{
      rule: string;
      severity: string;
      id?: string;
      message: string;
    }>;
    const ambiguous = findings.find((f) => f.rule === 'superseded-target-ambiguous');
    expect(ambiguous).toEqual({
      rule: 'superseded-target-ambiguous',
      severity: 'warn',
      id: '0011',
      message: 'supersededBy target "0010" resolves to 2 local records; see get_decision("0010") for the full candidate list',
    });
    const federated = findings.find((f) => f.rule === 'superseded-target-federated-unavailable');
    expect(federated).toEqual({
      rule: 'superseded-target-federated-unavailable',
      severity: 'info',
      id: '0013',
      message: 'supersededBy target "payments:0020" is a log-qualified ref; named-log federation is not available in this phase',
    });
    // Core's own dangling-supersededBy findings remain present alongside the derived ones.
    expect(findings.some((f) => f.rule === 'dangling-supersededBy' && f.id === '0012')).toBe(true);
  });

  test('a resolved target reports its LIVE current status, not an assumed accepted', async () => {
    const repo = await createRepo();
    await writeRecords(repo, {
      '0060-superseded.md': `---
schemaVersion: 0.1.0
id: "0060"
title: Superseded record pointing at a deprecated target
status: superseded
date: 2026-05-01
supersededBy: "0061"
---

# 0060
`,
      '0061-target.md': `---
schemaVersion: 0.1.0
id: "0061"
title: A target that itself moved on to deprecated
status: deprecated
date: 2026-05-02
---

# 0061
`,
    });
    const { client } = await open(repo);
    const entry = entryFor(resultOf(await callTool(client, 'list_superseded', {})), '0060');
    expect(entry.supersededBy).toEqual({
      resolved: true,
      target: { id: '0061', title: 'A target that itself moved on to deprecated', status: 'deprecated', sourcePath: 'docs/adr/0061-target.md' },
    });
  });

  test('empty listing is the same entries branch', async () => {
    const repo = await createRepo();
    await writeRecords(repo, {
      '0070-plain.md': `---\nschemaVersion: 0.1.0\nid: "0070"\ntitle: A plain accepted record\nstatus: accepted\ndate: 2026-05-05\ndeciders:\n  - "@m"\n---\n\n# 0070\n`,
    });
    const { client } = await open(repo);
    const res = await callTool(client, 'list_superseded', {});
    expect(resultOf(res).items).toEqual([]);
    expect(textOf(res)).toBe('Returned 0 superseded decision entries; 0 findings on this page.');
  });

  test('exact entries text for one and many', async () => {
    const single = await open(await repoFromFixture('status-corpus'));
    expect(textOf(await callTool(single.client, 'list_superseded', {}))).toBe(
      'Returned 1 superseded decision entry; 0 findings on this page.',
    );
    const many = await open(await repoFromFixture('edge-corpus'));
    expect(textOf(await callTool(many.client, 'list_superseded', {}))).toBe(
      'Returned 4 superseded decision entries; 6 findings on this page.',
    );
  });

  test('a corpus that cannot be loaded is corpus-unavailable', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const config = await toolConfig(repo.root, repo.dir);
    await rm(repo.adrDir, { recursive: true, force: true });
    const harness = await openTool(registerListSuperseded, config);
    cleanups.push(harness.close);
    const res = await callTool(harness.client, 'list_superseded', {});
    expect(resultOf(res).outcome).toBe('corpus-unavailable');
    expect(healthOf(res)).toBeUndefined();
  });
});
