/**
 * `src/generate.ts` — the build-time generator, against real git repositories (ADR-0054
 * clauses 3, 6, 9).
 *
 * Every git call here, the fixture's and the generator's, runs with
 * `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (AGENTS.md: a developer's
 * `commit.gpgSign`/`tag.gpgSign` would otherwise prompt for a passphrase and hang the suite).
 * The generator inherits `process.env`, so the suite sets both there for its duration.
 *
 * ADR-0016 clause 2: observed failing. Each mutation was made in `src/generate.ts`, the suite
 * run, and the edit reverted; the retained input is the mutation named here.
 * - the corpus-error branch removed (an `available` table built over a broken corpus):
 *   "writes the complete file with the errors, and the table unavailable" failed.
 * - `exitCode` hard-coded to `0`: the same test failed.
 * - `mkdir(out)` moved above the `openDecisions` call: "an unreadable corpus directory is exit
 *   2 and writes nothing" failed on the output directory's existence.
 * - tracked files listed from the caller's `cwd` without `-- :/`: "from a subdirectory, the
 *   corpus opens from the top level and the table covers the whole tree" failed (only files
 *   under `docs/` were listed, so the table was empty).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { writeBrokenCorpus, writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import type { PortalPathTableAvailable } from '../src/data/contract.ts';
import { generatePortal } from '../src/generate.ts';
import { openDecisions } from '../../sdk/src/index.ts';

const HEALTHY = 'portal-generate-healthy';
const BROKEN = 'portal-generate-broken';
const EMPTY = 'portal-generate-empty-repo';
const AS_OF = '2026-07-05';

const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
let healthyRoot: string;
let brokenRoot: string;
let emptyRepoRoot: string;
let outsideGit: string;
let healthyCommit: string;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Portal Test', '-c', 'user.email=portal@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function commitAll(root: string): Promise<string> {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

beforeAll(async () => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';

  healthyRoot = await resetTestDir(HEALTHY);
  await writeHealthyCorpus(healthyRoot);
  // A tracked file no decision reaches.
  await writeText(join(healthyRoot, 'README.md'), '# fixture\n');
  healthyCommit = await commitAll(healthyRoot);

  brokenRoot = await resetTestDir(BROKEN);
  await writeBrokenCorpus(brokenRoot);
  await commitAll(brokenRoot);

  emptyRepoRoot = await resetTestDir(EMPTY);
  await writeHealthyCorpus(emptyRepoRoot);
  git(emptyRepoRoot, 'init', '-q');

  outsideGit = await mkdtemp(join(tmpdir(), 'adrkit-portal-'));
  await writeHealthyCorpus(outsideGit);
});

afterAll(async () => {
  for (const name of [HEALTHY, BROKEN, EMPTY]) await cleanupTestDir(name);
  await rm(outsideGit, { recursive: true, force: true });
  if (savedEnv.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedEnv.global;
  if (savedEnv.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedEnv.system;
});

describe('exit 0: a healthy corpus in a git repository', () => {
  test('writes portal-data.json with the commit, asOf, and a path table of governed tracked files', async () => {
    const result = await generatePortal({ cwd: healthyRoot, out: 'site-a', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.message).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.dataFile).toBe(join(healthyRoot, 'site-a', 'portal-data.json'));
    const data = JSON.parse(await readFile(result.dataFile!, 'utf8'));
    expect(data).toMatchObject({ version: '1', dir: 'docs/adr', commit: healthyCommit, asOf: AS_OF });
    expect(data.records).toHaveLength(7);
    expect(data.queue.map((entry: { id: string }) => entry.id)).toEqual(['0005', '0006']);

    const table = data.pathTable as PortalPathTableAvailable;
    expect(table.state).toBe('available');
    expect(table.capped).toBe(false);
    // README.md and the corpus files are tracked but not governed.
    expect(table.entries.map((entry) => entry.path)).toEqual(['src/sync/protocol.ts', 'src/sync/retry.ts', 'src/sync/stale.ts']);
    expect(table.governedPathCount).toBe(3);
    expect(table.entries[0]).toEqual({
      path: 'src/sync/protocol.ts',
      governing: [
        { id: '0001', evidence: ['affects'] },
        { id: '0004', evidence: ['affects'] },
      ],
      activeProposals: [{ id: '0005', evidence: ['affects'] }],
      history: [{ id: '0003', evidence: ['affects'] }],
    });
    expect(table.entries[1]!.governing).toContainEqual({ id: '0002', evidence: ['marker'] });
    expect(table.entries[2]!.history).toContainEqual({ id: '0003', evidence: ['affects', 'marker'] });
  });

  test('identical inputs give byte-identical files', async () => {
    const first = await generatePortal({ cwd: healthyRoot, out: 'site-b', asOf: AS_OF });
    const second = await generatePortal({ cwd: healthyRoot, out: 'site-c', asOf: AS_OF, concurrency: 1 });
    expect(await readFile(second.dataFile!, 'utf8')).toBe(await readFile(first.dataFile!, 'utf8'));
  });

  test('asOf defaults to the SDK\'s own default: today in UTC, echoed by queue()', async () => {
    // The portal reads no clock: it takes `handle.queue().asOf`, which the SDK computes with
    // core's `todayUtcDate()`. The test brackets the call, since a UTC midnight may fall in it.
    const before = new Date().toISOString().slice(0, 10);
    const result = await generatePortal({ cwd: healthyRoot, out: 'site-d' });
    const after = new Date().toISOString().slice(0, 10);
    expect([before, after]).toContain(result.data!.asOf);
    const sdkDefault = (await openDecisions({ cwd: healthyRoot })).queue().asOf;
    if (before === after) expect(result.data!.asOf).toBe(sdkDefault);
  });

  test('from a subdirectory, the corpus opens from the top level and the table covers the whole tree', async () => {
    const result = await generatePortal({ cwd: join(healthyRoot, 'docs'), dir: 'adr', out: '../site-e', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.data!.dir).toBe('docs/adr');
    expect(result.dataFile).toBe(join(healthyRoot, 'site-e', 'portal-data.json'));
    expect((result.data!.pathTable as PortalPathTableAvailable).entries.map((entry) => entry.path)).toEqual([
      'src/sync/protocol.ts',
      'src/sync/retry.ts',
      'src/sync/stale.ts',
    ]);
  });

  test('caps the table and says so', async () => {
    const result = await generatePortal({ cwd: healthyRoot, out: 'site-f', asOf: AS_OF, pathTableCaps: { count: 1 } });
    const table = result.data!.pathTable as PortalPathTableAvailable;
    expect(table).toMatchObject({ capped: true, governedPathCount: 3, caps: { count: 1, bytes: 4 * 1024 * 1024 } });
    expect(table.entries.map((entry) => entry.path)).toEqual(['src/sync/protocol.ts']);
  });
});

describe('exit 1: a corpus with errors', () => {
  test('writes the complete file with the errors, and the table unavailable', async () => {
    const result = await generatePortal({ cwd: brokenRoot, out: 'site', asOf: AS_OF });
    expect(result.exitCode).toBe(1);
    expect(result.message).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((issue) => issue.severity === 'error')).toBe(true);
    const data = JSON.parse(await readFile(join(brokenRoot, 'site', 'portal-data.json'), 'utf8'));
    expect(data.pathTable).toEqual({ state: 'unavailable', reason: 'corpus-errors' });
    expect(data.issues.filter((issue: { severity: string }) => issue.severity === 'error')).toEqual(result.errors);
    expect(data.records.map((record: { id: string }) => record.id)).toContain('0001');
  });
});

describe('no table where there is nothing to enumerate', () => {
  test('outside a git work tree: commit null, table absent', async () => {
    const result = await generatePortal({ cwd: outsideGit, out: 'site', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.data!.commit).toBeNull();
    expect(result.data!.pathTable).toEqual({ state: 'absent' });
  });

  test('a repository with no commits: commit null, table of the (empty) index', async () => {
    const result = await generatePortal({ cwd: emptyRepoRoot, out: 'site', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.data!.commit).toBeNull();
    expect(result.data!.pathTable).toMatchObject({ state: 'available', governedPathCount: 0, entries: [] });
  });
});

describe('exit 2: usage errors and an unreadable corpus write nothing', () => {
  const cases: Array<[string, Parameters<typeof generatePortal>[0]]> = [
    ['an unreadable corpus directory', { dir: 'no/such/dir' }],
    ['a datetime asOf', { asOf: '2026-07-05T00:00:00Z' }],
    ['an impossible asOf', { asOf: '2026-02-30' }],
    ['a non-http base-url', { baseUrl: 'javascript:alert(1)' }],
    ['a relative base-url', { baseUrl: '/docs' }],
    ['a negative cap', { pathTableCaps: { bytes: -1 } }],
    // A corpus outside the repository is tested with a real outside corpus, and through
    // symlinks, in generate-safety.test.ts: `../elsewhere` here did not exist, so it passed
    // with the guard removed.
  ];
  let run = 0;
  test.each(cases)('%s is exit 2 and writes nothing', async (_name, options) => {
    const out = `site-usage-${run++}`;
    const result = await generatePortal({ cwd: healthyRoot, out, ...options });
    expect(result.exitCode).toBe(2);
    expect(result.dataFile).toBeNull();
    expect(result.data).toBeNull();
    expect(typeof result.message).toBe('string');
    expect(existsSync(join(healthyRoot, out))).toBe(false);
  });

  test('an unreadable corpus directory names it', async () => {
    const result = await generatePortal({ cwd: healthyRoot, dir: 'no/such/dir', out: 'never' });
    expect(result.message).toMatch(/^Corpus directory not found: "no\/such\/dir"/);
  });

  test('a valid base-url is accepted', async () => {
    const result = await generatePortal({ cwd: healthyRoot, out: 'site-g', asOf: AS_OF, baseUrl: 'https://example.github.io/repo/' });
    expect(result.exitCode).toBe(0);
  });
});
