import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCanonicalRoots, CorpusUnavailableError } from '../src/corpus/projection.ts';
import { createRepo } from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function outsideDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'adrkit-mcp-outside-'));
  const real = await realpath(d);
  cleanups.push(() => rm(real, { recursive: true, force: true }));
  return real;
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

describe('resolveCanonicalRoots', () => {
  test('accepts an ordinary .git directory clone', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const roots = await resolveCanonicalRoots({ cwd: repo.root, dir: repo.dir });
    expect(roots.canonicalCwd).toBe(repo.root);
    expect(roots.canonicalDir).toBe(join(repo.root, 'docs/adr'));
  });

  test('accepts a linked-worktree .git FILE (never parsed, only readable)', async () => {
    const repo = await createRepo({ gitFile: true });
    cleanups.push(repo.cleanup);
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: repo.dir }))).resolves.toBe('resolved');
  });

  test('a missing root is root-not-found', async () => {
    await expect(reasonOf(resolveCanonicalRoots({ cwd: '/no/such/adrkit/root', dir: 'docs/adr' }))).resolves.toBe(
      'root-not-found',
    );
  });

  test('a readable directory with no .git entry is root-not-git', async () => {
    const bare = await outsideDir();
    await mkdir(join(bare, 'docs/adr'), { recursive: true });
    await expect(reasonOf(resolveCanonicalRoots({ cwd: bare, dir: 'docs/adr' }))).resolves.toBe('root-not-git');
  });

  test('a missing ADR directory is dir-not-found', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    await rm(repo.adrDir, { recursive: true, force: true });
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: 'docs/adr' }))).resolves.toBe('dir-not-found');
  });

  test('an absolute --dir outside the root is dir-outside-root', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const outside = await outsideDir();
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: outside }))).resolves.toBe('dir-outside-root');
  });

  test('a ".." traversal --dir is dir-outside-root', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: '../..' }))).resolves.toBe('dir-outside-root');
  });

  test('a string-prefix sibling directory does not count as contained', async () => {
    const parent = await outsideDir();
    const repoRoot = join(parent, 'repo');
    const sibling = join(parent, 'repo-secrets');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(sibling, { recursive: true });
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repoRoot, dir: sibling }))).resolves.toBe('dir-outside-root');
  });

  test('a --dir that is a symlink escaping the root is dir-outside-root (realpath containment)', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const outside = await outsideDir();
    await rm(repo.adrDir, { recursive: true, force: true });
    await mkdir(join(repo.root, 'docs'), { recursive: true });
    await symlink(outside, join(repo.root, 'docs/adr'));
    // The raw string 'docs/adr' contains no '..' yet resolves outside via the symlink.
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: 'docs/adr' }))).resolves.toBe('dir-outside-root');
  });

  test('a --dir pointing at a file is dir-not-directory', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    await writeFile(join(repo.root, 'notadir.md'), 'x', 'utf8');
    await expect(reasonOf(resolveCanonicalRoots({ cwd: repo.root, dir: 'notadir.md' }))).resolves.toBe(
      'dir-not-directory',
    );
  });
});
