import { afterEach, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerGetDecision } from '../src/tools/get-decision.ts';
import {
  openTool,
  callTool,
  resultOf,
  healthOf,
  textOf,
  repoFromFixture,
  createRepo,
  toolConfig,
  makeOversizedRecord,
  type TempRepo,
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function open(repo: TempRepo) {
  cleanups.push(repo.cleanup);
  const harness = await openTool(registerGetDecision, await toolConfig(repo.root, repo.dir));
  cleanups.push(harness.close);
  return harness;
}

describe('get_decision — full document and lookup branches', () => {
  test('retrieves every one of the six statuses with complete typed frontmatter and body', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const expected: Record<string, string> = {
      '0001': 'accepted',
      '0002': 'draft',
      '0003': 'proposed',
      '0004': 'rejected',
      '0005': 'superseded',
      '0006': 'deprecated',
    };
    for (const [id, status] of Object.entries(expected)) {
      const res = await callTool(client, 'get_decision', { ref: id });
      const result = resultOf(res);
      expect(result.outcome).toBe('found');
      expect(result.decision.id).toBe(id);
      expect(result.decision.status).toBe(status);
      expect(result.decision.frontmatter.id).toBe(id);
      expect(typeof result.decision.body).toBe('string');
      expect(result.decision.body.length).toBeGreaterThan(0);
    }
  });

  test('returns a repo-relative POSIX source path, never absolute', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const result = resultOf(await callTool(client, 'get_decision', { ref: '0001' }));
    expect(result.decision.sourcePath).toBe('docs/adr/0001-adopt-postgres-for-the-index.md');
  });

  test('leaves the four relation fields present and UNEXPANDED in frontmatter', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const result = resultOf(await callTool(client, 'get_decision', { ref: '0005' }));
    expect(result.decision.frontmatter.supersededBy).toBe('0001');
    expect(result.decision.frontmatter.supersedes).toEqual([]);
    expect(result.decision.frontmatter.relatesTo).toEqual([]);
    expect(result.decision.frontmatter.conflictsWith).toEqual([]);
    // Unexpanded: no resolved target object is inlined anywhere.
    expect(JSON.stringify(result)).not.toContain('Adopt PostgreSQL');
  });

  test('an absent id is not-found', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision', { ref: '9999' });
    const result = resultOf(res);
    expect(result.outcome).toBe('not-found');
    expect(result.requestedRef).toBe('9999');
    expect(textOf(res)).toBe('No local decision matches "9999"; 0 findings on this page.');
  });

  test('an oversized source is not-found with the record-too-large finding present', async () => {
    const repo = await repoFromFixture('status-corpus');
    await writeFile(join(repo.adrDir, '0007-oversized.md'), makeOversizedRecord('0007'), 'utf8');
    const { client } = await open(repo);
    const res = await callTool(client, 'get_decision', { ref: '0007' });
    const result = resultOf(res);
    expect(result.outcome).toBe('not-found');
    expect(result.findings.items.some((f: { rule: string }) => f.rule === 'record-too-large')).toBe(true);
    expect(result.decision).toBeUndefined();
  });

  test('a duplicate local id is ambiguous with every candidate, distinguished by sourcePath', async () => {
    const { client } = await open(await repoFromFixture('edge-corpus'));
    const res = await callTool(client, 'get_decision', { ref: '0010' });
    const result = resultOf(res);
    expect(result.outcome).toBe('ambiguous-local-id');
    expect(result.requestedRef).toBe('0010');
    expect(result.candidates.map((c: { sourcePath: string }) => c.sourcePath)).toEqual([
      'docs/adr/0010-first-duplicate.md',
      'docs/adr/0010-second-duplicate.md',
    ]);
    expect(textOf(res)).toBe('Returned 2 candidates for ambiguous local ref "0010"; 4 findings on this page.');
  });

  test('a log-qualified ref returns federated-log-unavailable and never a same-id local substitute', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision', { ref: 'payments:0001' });
    const result = resultOf(res);
    expect(result.outcome).toBe('federated-log-unavailable');
    expect(result.log).toBe('payments');
    expect(result.id).toBe('0001');
    expect(result.decision).toBeUndefined();
    expect(textOf(res)).toBe('Named-log federation is unavailable for "payments:0001"; 0 findings on this page.');
  });

  test('found text uses singular "finding" wording when the page has one finding', async () => {
    const repo = await repoFromFixture('degraded-corpus');
    const { client } = await open(repo);
    const res = await callTool(client, 'get_decision', { ref: '0032' });
    const result = resultOf(res);
    expect(result.outcome).toBe('found');
    // degraded-corpus carries exactly one corpus finding (the invalid 0030 record).
    expect(result.findings.items).toHaveLength(1);
    expect(textOf(res)).toBe('Found decision "0032"; 1 finding on this page.');
  });

  test('a corpus that cannot be loaded is corpus-unavailable with a fixed, path-free message', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const config = await toolConfig(repo.root, repo.dir);
    await rm(repo.adrDir, { recursive: true, force: true });
    const harness = await openTool(registerGetDecision, config);
    cleanups.push(harness.close);
    const res = await callTool(harness.client, 'get_decision', { ref: '0001' });
    const result = resultOf(res);
    expect(result.outcome).toBe('corpus-unavailable');
    expect(result.reason).toBe('dir-not-found');
    expect(textOf(res)).toBe('Configured ADR directory was not found.');
    expect(healthOf(res)).toBeUndefined();
  });

  test('every substantive branch carries corpusHealth', async () => {
    const { client } = await open(await repoFromFixture('status-corpus'));
    const res = await callTool(client, 'get_decision', { ref: '0001' });
    expect(healthOf(res).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
