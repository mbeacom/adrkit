/**
 * The generator's reading of git and of `out` (ADR-0054 clauses 3, 6, 9; PR #292 review
 * findings 1, 4, and 5).
 *
 * - **`out` is checked through symlinks.** A lexical check let `repo/up -> ..` with
 *   `out: 'up/<repo>'` name the repository itself, and the swap then moved the repository
 *   aside. `out` is now resolved through its existing components with `realpath`, and a real
 *   target that is, or holds, the repository root or the working directory is exit 2 before
 *   anything is staged.
 * - **A dirty checkout is attributed to no commit.** The corpus is read from the working tree
 *   and the path list from the index, so a bundle built from changes HEAD does not contain
 *   was stamped with HEAD. Now any staged or unstaged change to a tracked file, or an
 *   untracked file inside the corpus directory, publishes `commit: null`; an untracked file
 *   elsewhere does not change the output, and keeps the SHA.
 * - **Only "not a git repository" means outside a work tree.** Every `git rev-parse` failure
 *   used to read as "no repository", so a missing git or git's ownership refusal published a
 *   bundle with no table and exit 0. Those are now exit 2 with a fixed message, never git's
 *   stderr, and nothing is written.
 *
 * Every git call runs with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`
 * (AGENTS.md). `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` reproduces the ownership refusal
 * (AGENTS.md, measured for the plugin's `git-unsafe-directory`).
 *
 * ADR-0016 clause 2: observed failing against the code before the fix, 2026-10-10, macOS,
 * Bun 1.4.2:
 * - "an out that reaches the repository through a symlink is refused, and the repository is
 *   untouched" failed: exit 0, and the fixture repository was moved aside and replaced by the
 *   bundle (run alone, since it destroys its fixture).
 * - "a modified record publishes no commit", "a staged change publishes no commit", and "an
 *   untracked file inside the corpus directory publishes no commit" failed (HEAD's SHA was
 *   published); "a clean checkout keeps HEAD" and "an untracked file elsewhere keeps HEAD"
 *   passed before and after.
 * - "git's ownership refusal is exit 2 and writes nothing" and "a missing git is exit 2 and
 *   writes nothing" failed (exit 0, an absent table); "outside any repository the table is
 *   absent and the run succeeds" passed before and after.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import { generatePortal } from '../src/generate.ts';

const NAMES = { up: 'portal-git-up', dirty: 'portal-git-dirty', owner: 'portal-git-owner' };
const AS_OF = '2026-07-05';
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
let upRepo: string;
let dirty: string;
let owner: string;
let outsideGit: string;
let head: string;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function commitAll(root: string): string {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

beforeAll(async () => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  upRepo = await resetTestDir(NAMES.up);
  await writeHealthyCorpus(upRepo);
  await symlink('..', join(upRepo, 'up'));
  commitAll(upRepo);

  dirty = await resetTestDir(NAMES.dirty);
  await writeHealthyCorpus(dirty);
  head = commitAll(dirty);

  owner = await resetTestDir(NAMES.owner);
  await writeHealthyCorpus(owner);
  commitAll(owner);

  outsideGit = await mkdtemp(join(tmpdir(), 'adrkit-portal-nogit-'));
  await writeHealthyCorpus(outsideGit);
});

afterAll(async () => {
  for (const name of Object.values(NAMES)) await cleanupTestDir(name);
  await rm(outsideGit, { recursive: true, force: true });
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = saved.global;
  if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = saved.system;
});

describe('out is resolved through symlinks before anything is staged', () => {
  test('an out that reaches the repository through a symlink is refused, and the repository is untouched', async () => {
    const before = (await readdir(upRepo)).sort();
    const parentBefore = (await readdir(join(upRepo, '..'))).sort();
    const out = `up/${basename(upRepo)}`;
    const result = await generatePortal({ cwd: upRepo, out, asOf: AS_OF });
    expect(result.exitCode).toBe(2);
    expect(result.message).toBe(`Output directory "${out}" would replace the repository or the working directory.`);
    expect((await readdir(upRepo)).sort()).toEqual(before);
    expect(existsSync(join(upRepo, '.git'))).toBe(true);
    expect((await readdir(join(upRepo, '..'))).sort()).toEqual(parentBefore);
  });

  test('a symlinked out that leads somewhere else is still written', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'adrkit-portal-out-'));
    try {
      await symlink(elsewhere, join(dirty, 'site-link-parent'));
      const result = await generatePortal({ cwd: dirty, out: 'site-link-parent/site', asOf: AS_OF });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(elsewhere, 'site', 'portal-data.json'))).toBe(true);
    } finally {
      await rm(join(dirty, 'site-link-parent'), { force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('a dirty checkout is attributed to no commit', () => {
  const commitOf = async (label: string) => {
    const result = await generatePortal({ cwd: dirty, out: join(tmpdir(), `adrkit-portal-dirty-${process.pid}-${label}`), asOf: AS_OF });
    await rm(join(tmpdir(), `adrkit-portal-dirty-${process.pid}-${label}`), { recursive: true, force: true });
    expect(result.exitCode).toBe(0);
    return result.data!.commit;
  };

  test('a clean checkout keeps HEAD', async () => {
    expect(await commitOf('clean')).toBe(head);
  });

  test('an untracked file elsewhere keeps HEAD', async () => {
    await writeText(join(dirty, 'scratch.txt'), 'not part of the output\n');
    try {
      expect(await commitOf('untracked-elsewhere')).toBe(head);
    } finally {
      await rm(join(dirty, 'scratch.txt'), { force: true });
    }
  });

  test('a modified record publishes no commit', async () => {
    const record = join(dirty, 'docs/adr/0001-use-the-sync-protocol.md');
    await writeFile(record, (await Bun.file(record).text()) + '\nAn uncommitted line.\n');
    try {
      expect(await commitOf('modified')).toBeNull();
    } finally {
      git(dirty, 'checkout', '--', 'docs/adr/0001-use-the-sync-protocol.md');
    }
  });

  test('a staged change publishes no commit', async () => {
    await writeText(join(dirty, 'src/new.ts'), 'export {};\n');
    git(dirty, 'add', 'src/new.ts');
    try {
      expect(await commitOf('staged')).toBeNull();
    } finally {
      git(dirty, 'rm', '-q', '--cached', 'src/new.ts');
      await rm(join(dirty, 'src/new.ts'), { force: true });
    }
  });

  test('an untracked file inside the corpus directory publishes no commit', async () => {
    await writeText(join(dirty, 'docs/adr/notes.txt'), 'a draft, not yet committed\n');
    try {
      expect(await commitOf('untracked-corpus')).toBeNull();
    } finally {
      await rm(join(dirty, 'docs/adr/notes.txt'), { force: true });
    }
    expect(await commitOf('clean-again')).toBe(head);
  });
});

describe('only "not a git repository" means outside a work tree', () => {
  test('outside any repository the table is absent and the run succeeds', async () => {
    const result = await generatePortal({ cwd: outsideGit, out: 'site', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.data!.commit).toBeNull();
    expect(result.data!.pathTable).toEqual({ state: 'absent' });
  });

  test('git\'s ownership refusal is exit 2 and writes nothing', async () => {
    const savedOwner = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
    try {
      const result = await generatePortal({ cwd: owner, out: 'site-owner', asOf: AS_OF });
      expect(result.exitCode).toBe(2);
      expect(result.message).toBe('git refused to read this repository, or could not read it; check its ownership and permissions (safe.directory).');
      expect(result.message).not.toContain(owner);
      expect(existsSync(join(owner, 'site-owner'))).toBe(false);
    } finally {
      if (savedOwner === undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
      else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = savedOwner;
    }
  });

  test('a missing git is exit 2 and writes nothing', async () => {
    const emptyBin = await mkdtemp(join(tmpdir(), 'adrkit-portal-nopath-'));
    const savedPath = process.env.PATH;
    process.env.PATH = emptyBin;
    try {
      const result = await generatePortal({ cwd: owner, out: 'site-nogit', asOf: AS_OF });
      expect(result.exitCode).toBe(2);
      expect(result.message).toBe('git could not be started, so the repository could not be read; install git or put it on PATH.');
      expect(existsSync(join(owner, 'site-nogit'))).toBe(false);
    } finally {
      process.env.PATH = savedPath;
      await rm(emptyBin, { recursive: true, force: true });
    }
  });
});
