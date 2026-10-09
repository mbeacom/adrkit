/**
 * The default change set, measured against real git repositories (0.9.1).
 *
 * Before 0.9.1 the change was `git diff <base>...HEAD` alone whenever that
 * range resolved, so an app session's own edits, which are uncommitted until
 * someone commits them, were invisible: on the dogfood repository the panel,
 * the workflow, and the tools saw 0 files while `adr check` on the same three
 * paths reported 3 governing records. The change is now the union of the
 * committed branch changes, staged and unstaged edits, and untracked files.
 *
 * Every repository here is a temp directory with global and system git config
 * switched off (a global `tag.gpgSign` or `log.showSignature` changes what git
 * does), and `origin/main` is a plain ref rather than a remote.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectChangedFiles, publicMessage, REVIEW_MESSAGES, runCommand } from '../extensions/adrkit/review.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'adrkit test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'adrkit test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adrkit-changed-'));
  temps.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

function write(root: string, path: string, text: string) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A repository with one commit holding `files`, and `origin/main` equal to HEAD. */
function repo(files: Record<string, string>): string {
  const root = tempDir();
  git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

/** The real runner the extension uses, with git config isolated. */
function runnerIn(cwd: string, extraEnv: Record<string, string> = {}) {
  const spawn = (command: string, args: string[], options: Record<string, unknown>) =>
    nodeSpawn(command, args, { ...options, env: { ...GIT_ENV, ...extraEnv } });
  return (command: string, args: string[]) => runCommand(command, args, { cwd, spawn });
}

describe('the default change is the union of branch, index, working tree, and untracked files', () => {
  test('with origin/main equal to HEAD, an unstaged edit, a staged edit, and an untracked file all show', async () => {
    const root = repo({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'README.md': 'r\n' });
    write(root, 'src/a.ts', 'a changed\n'); // unstaged
    write(root, 'src/b.ts', 'b changed\n');
    git(root, 'add', 'src/b.ts'); // staged
    write(root, 'src/new.ts', 'new\n'); // untracked
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result.files).toEqual(['src/a.ts', 'src/b.ts', 'src/new.ts']);
    expect(result.source).toBe('git:origin/main...HEAD+worktree');
    expect(result.notes).toEqual([]);
  });

  test('committed branch changes and working-tree edits are unioned, deduplicated, and sorted', async () => {
    const root = repo({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' });
    git(root, 'switch', '-q', '-c', 'feature');
    write(root, 'src/c.ts', 'c committed\n');
    write(root, 'src/b.ts', 'b committed\n');
    git(root, 'commit', '-q', '-am', 'branch work');
    write(root, 'src/b.ts', 'b committed, then edited\n'); // in both sets
    write(root, 'src/a.ts', 'a edited\n'); // working tree only
    write(root, 'docs/z.md', 'untracked\n');
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result.files).toEqual(['docs/z.md', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(result.source).toBe('git:origin/main...HEAD+worktree');
  });

  test('an explicit base that resolves is unioned with the working tree too', async () => {
    const root = repo({ 'src/a.ts': 'a\n' });
    git(root, 'branch', 'release');
    write(root, 'src/a.ts', 'edited\n');
    const result = await collectChangedFiles({ base: 'release' }, runnerIn(root));
    expect(result.files).toEqual(['src/a.ts']);
    expect(result.source).toBe('git:release...HEAD+worktree');
  });

  test('a deleted file is part of the change, staged or not', async () => {
    const root = repo({ 'src/gone.ts': 'g\n', 'src/staged-gone.ts': 's\n', 'src/kept.ts': 'k\n' });
    unlinkSync(join(root, 'src/gone.ts'));
    git(root, 'rm', '-q', 'src/staged-gone.ts');
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result.files).toEqual(['src/gone.ts', 'src/staged-gone.ts']);
  });

  test('an ignored file is not part of the change', async () => {
    const root = repo({ '.gitignore': '*.log\nbuild/\n', 'src/a.ts': 'a\n' });
    write(root, 'debug.log', 'noise\n');
    write(root, 'build/out.js', 'noise\n');
    write(root, 'src/real.ts', 'real\n');
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result.files).toEqual(['src/real.ts']);
  });

  test('from a subdirectory, every path is repository-relative and the whole repository is listed', async () => {
    // `git ls-files` is cwd-relative and cwd-scoped by default, unlike
    // `git diff --name-only`; mixing the two would hand adr check two path
    // conventions and miss untracked files outside the subdirectory.
    const root = repo({ 'src/a.ts': 'a\n', 'pkg/x.ts': 'x\n' });
    write(root, 'src/a.ts', 'edited\n');
    write(root, 'pkg/new.ts', 'new\n');
    write(root, 'top.ts', 'new\n');
    const result = await collectChangedFiles({}, runnerIn(join(root, 'pkg')));
    expect(result.files).toEqual(['pkg/new.ts', 'src/a.ts', 'top.ts']);
  });

  test('a clean tree with origin/main equal to HEAD is an empty change, not an error', async () => {
    const root = repo({ 'src/a.ts': 'a\n' });
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result).toEqual({ files: [], source: 'git:origin/main...HEAD+worktree', notes: [] });
  });
});

describe('the fallback when origin/main does not resolve', () => {
  test('lists uncommitted and untracked edits, labelled partial, with the fixed note', async () => {
    const root = repo({ 'src/a.ts': 'a\n' });
    git(root, 'update-ref', '-d', 'refs/remotes/origin/main');
    write(root, 'src/a.ts', 'edited\n');
    write(root, 'src/new.ts', 'new\n');
    const result = await collectChangedFiles({}, runnerIn(root));
    expect(result.files).toEqual(['src/a.ts', 'src/new.ts']);
    expect(result.source).toBe('git:worktree');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/origin\/main.*fell back/);
  });

  test('a clean tree with no origin/main is still no-changes', async () => {
    const root = repo({ 'src/a.ts': 'a\n' });
    git(root, 'update-ref', '-d', 'refs/remotes/origin/main');
    await expect(collectChangedFiles({}, runnerIn(root))).rejects.toMatchObject({ code: 'no-changes' });
  });

  test('an explicit base that does not resolve is base-unresolved, even with edits present', async () => {
    const root = repo({ 'src/a.ts': 'a\n' });
    write(root, 'src/a.ts', 'edited\n');
    await expect(collectChangedFiles({ base: 'nope' }, runnerIn(root))).rejects.toMatchObject({ code: 'base-unresolved' });
  });
});

describe('a directory git does not treat as a work tree (the Windows "--no-index" report)', () => {
  test('outside any repository is not-work-tree, with a fixed message and no stderr', async () => {
    const dir = tempDir();
    const error = await collectChangedFiles({}, runnerIn(dir)).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'not-work-tree' });
    expect(publicMessage(error)).toBe(REVIEW_MESSAGES['not-work-tree']);
    expect(publicMessage(error)).not.toMatch(/fatal|usage|no-index/i);
    expect(publicMessage(error)).not.toContain(dir);
  });

  test('inside the .git directory, where rev-parse prints false with exit 0, is not-work-tree', async () => {
    const root = repo({ 'a.ts': 'a\n' });
    await expect(collectChangedFiles({}, runnerIn(join(root, '.git')))).rejects.toMatchObject({ code: 'not-work-tree' });
  });

  test("a repository git refuses for its owner is git-unsafe-directory, naming safe.directory, not the path", async () => {
    // GIT_TEST_ASSUME_DIFFERENT_OWNER is git's own test knob for the ownership
    // check. Under it, measured with git 2.50.1, `git diff --name-only HEAD`
    // prints exactly the reported `usage: git diff --no-index` text.
    const root = repo({ 'a.ts': 'a\n' });
    write(root, 'a.ts', 'edited\n');
    const error = await collectChangedFiles({}, runnerIn(root, { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' })).catch(
      (caught) => caught,
    );
    expect(error).toMatchObject({ code: 'git-unsafe-directory' });
    expect(publicMessage(error)).toContain('safe.directory');
    expect(publicMessage(error)).not.toContain(root);
  });
});
