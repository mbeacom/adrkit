import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCorpusProjection, CorpusUnavailableError, MAX_SOURCE_BYTES } from '../src/corpus/projection.ts';
import { createRepo, repoFromFixture, toolConfig, makeOversizedRecord, type TempRepo } from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function track(repo: TempRepo): TempRepo {
  cleanups.push(repo.cleanup);
  return repo;
}

async function load(repo: TempRepo, overrides: Partial<Awaited<ReturnType<typeof toolConfig>>> = {}) {
  const config = { ...(await toolConfig(repo.root, repo.dir)), ...overrides };
  return loadCorpusProjection(config);
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error instanceof CorpusUnavailableError) return error.reason;
    throw error;
  }
}

describe('loadCorpusProjection — stable load', () => {
  test('loads all valid records with an id-keyed multi-value index', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    const projection = await load(repo);
    expect(projection.records.map((r) => r.frontmatter.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006']);
    expect(projection.recordCount).toBe(6);
    expect(projection.excludedCount).toBe(0);
    expect(projection.byId.get('0001')?.length).toBe(1);
    expect(projection.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a pre-read oversized source is excluded with a record-too-large error finding', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    await writeFile(join(repo.adrDir, '0007-oversized.md'), makeOversizedRecord('0007'), 'utf8');
    const projection = await load(repo);
    expect(projection.records.some((r) => r.frontmatter.id === '0007')).toBe(false);
    expect(projection.excludedCount).toBe(1);
    const finding = projection.corpusFindings.find((f) => f.rule === 'record-too-large');
    expect(finding?.severity).toBe('error');
    expect(finding?.path).toBe('docs/adr/0007-oversized.md');
    expect(finding?.id).toBeUndefined();
  });

  test('a corpus whose ONLY file is oversized yields zero records without lintCorpus re-discovery', async () => {
    const repo = track(await createRepo());
    await writeFile(join(repo.adrDir, '0100-oversized.md'), makeOversizedRecord('0100'), 'utf8');
    const projection = await load(repo);
    expect(projection.records).toHaveLength(0);
    expect(projection.recordCount).toBe(0);
    expect(projection.excludedCount).toBe(1);
    expect(projection.corpusFindings.map((f) => f.rule)).toEqual(['record-too-large']);
  });

  test('a schema-invalid record is excluded but its valid neighbors remain', async () => {
    const repo = track(await repoFromFixture('degraded-corpus'));
    const projection = await load(repo);
    expect(projection.records.map((r) => r.frontmatter.id).sort()).toEqual(['0031', '0032']);
    expect(projection.excludedCount).toBe(1);
    expect(projection.corpusFindings.some((f) => f.id === '0030')).toBe(true);
  });

  test('an invariant-flagged duplicate id keeps BOTH records and only adds a finding', async () => {
    const repo = track(await repoFromFixture('edge-corpus'));
    const projection = await load(repo);
    expect(projection.byId.get('0010')?.length).toBe(2);
    expect(projection.excludedCount).toBe(0);
    expect(projection.corpusFindings.some((f) => f.rule === 'unique-id' && f.id === '0010')).toBe(true);
  });

  test('byId buckets are sorted (id, sourcePath) and expose every duplicate', async () => {
    const repo = track(await repoFromFixture('edge-corpus'));
    const projection = await load(repo);
    const bucket = projection.byId.get('0010') ?? [];
    expect(bucket.map((r) => r.path)).toEqual([
      'docs/adr/0010-first-duplicate.md',
      'docs/adr/0010-second-duplicate.md',
    ]);
  });

  test('a changed canonical root (expected != fresh) rejects as corpus-unavailable', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    await expect(reasonOf(load(repo, { expectedCanonicalCwd: '/some/other/root' }))).resolves.not.toBe('resolved');
  });

  test('a configured root symlink retargeted after startup is rejected', async () => {
    const original = track(await repoFromFixture('status-corpus'));
    const replacement = track(await repoFromFixture('status-corpus'));
    const links = await mkdtemp(join(tmpdir(), 'adrkit-mcp-root-link-'));
    cleanups.push(() => rm(links, { recursive: true, force: true }));
    const configuredRoot = join(links, 'repo');
    await symlink(original.root, configuredRoot);
    const config = await toolConfig(configuredRoot, original.dir);
    await rm(configuredRoot);
    await symlink(replacement.root, configuredRoot);

    await expect(reasonOf(loadCorpusProjection(config))).resolves.toBe('root-not-found');
  });

  test('a configured root symlink removed after startup is rejected', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    const links = await mkdtemp(join(tmpdir(), 'adrkit-mcp-root-link-'));
    cleanups.push(() => rm(links, { recursive: true, force: true }));
    const configuredRoot = join(links, 'repo');
    await symlink(repo.root, configuredRoot);
    const config = await toolConfig(configuredRoot, repo.dir);
    await rm(configuredRoot);

    await expect(reasonOf(loadCorpusProjection(config))).resolves.toBe('root-not-found');
  });

  test('fresh reload sees an edit made between two calls', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    const before = await load(repo);
    await writeFile(
      join(repo.adrDir, '0002-draft-a-caching-layer.md'),
      (await Bun.file(join(repo.adrDir, '0002-draft-a-caching-layer.md')).text()) + '\nExtra body line.\n',
      'utf8',
    );
    const after = await load(repo);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test('concurrent calls return independent projection objects with equal content', async () => {
    const repo = track(await repoFromFixture('status-corpus'));
    const [a, b] = await Promise.all([load(repo), load(repo)]);
    expect(a).not.toBe(b);
    expect(a.records).not.toBe(b.records);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test('the guard cap matches the documented 64 KiB', () => {
    expect(MAX_SOURCE_BYTES).toBe(65536);
  });
});
