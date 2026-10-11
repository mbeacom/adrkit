/**
 * Two boundaries of the generator (ADR-0054 clauses 2 and 9), each found by review:
 *
 * - **The corpus must resolve inside the repository.** The check on `dir` was lexical, so a
 *   committed symlink `docs/adr -> /outside` (or a `dir` naming one) published records from
 *   outside the work tree. The corpus directory is now `realpath`ed and must stay inside the
 *   real repository root, with the semantics of the agent plugin's `staysInside`.
 * - **Exit 2 writes nothing, not even half a bundle.** Page files were written into `out` in
 *   place before the data file, so a failure part way left new page files beside an old
 *   `portal-data.json`. The bundle is now built in a sibling staging directory and swapped in;
 *   on failure the staging directory is removed and `out` is byte-for-byte untouched.
 *
 * Every git call runs with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`
 * (AGENTS.md: inherited signing config hangs a suite).
 *
 * ADR-0016 clause 2: observed failing against the code before the fix, 2026-10-10, macOS,
 * Bun 1.4.2:
 * - "a real corpus outside the repository is refused by name" failed with the lexical guard
 *   removed (the outside records were published, exit 0); the earlier `../elsewhere` case in
 *   generate.test.ts passed without its guard, because that directory did not exist.
 * - "a committed symlinked docs/adr that leaves the repository is exit 2" and "a dir option
 *   through a symlink that leaves the repository is exit 2" failed (exit 0, the outside record
 *   published).
 * - "a write failure part way leaves out byte-for-byte untouched" failed: the injected
 *   failure was ignored and `out` was rewritten in place. A manual run of the old code with
 *   `out/vendor` made read-only exited 2 after `index.html`, `app.css` and `page/app.mjs` were
 *   already overwritten beside the old data file, which is the defect.
 * - "an output directory that holds the repository is refused" failed (exit 0).
 * Against the fixed code, each guard removed in turn: the `staysInside` line failed both
 * symlink tests; staging written in `out` itself failed "a write failure part way leaves out
 * byte-for-byte untouched" and "a successful run replaces out whole"; the out-contains-root
 * check disabled failed "an output directory that holds the repository is refused" (and moved
 * the fixture repository away, which is why the check exists).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import { generatePortal } from '../src/generate.ts';

const NAMES = { outside: 'portal-safety-outside', repo: 'portal-safety-repo', inner: 'portal-safety-inner' };
const AS_OF = '2026-07-05';
const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
let outside: string;
let repo: string;
let inner: string;

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}
function commitAll(root: string) {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
}

/** Every file under `dir`, relative, with its bytes. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(dir, path)] = await readFile(path, 'base64');
  }
  return files;
}

beforeAll(async () => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  outside = await resetTestDir(NAMES.outside);
  await writeHealthyCorpus(outside);

  // A repository whose own docs/adr is a committed symlink out of the work tree, plus a
  // second symlink `ext` for the `dir` option.
  repo = await resetTestDir(NAMES.repo);
  await writeText(join(repo, 'README.md'), '# repo\n');
  await mkdir(join(repo, 'docs'), { recursive: true });
  await symlink(join(outside, 'docs', 'adr'), join(repo, 'docs', 'adr'));
  await symlink(join(outside, 'docs', 'adr'), join(repo, 'ext'));
  commitAll(repo);

  // A repository whose docs/adr is a symlink that stays inside it: that one is followed.
  inner = await resetTestDir(NAMES.inner);
  await writeHealthyCorpus(join(inner, 'records'));
  await mkdir(join(inner, 'docs'), { recursive: true });
  await symlink(join(inner, 'records', 'docs', 'adr'), join(inner, 'docs', 'adr'));
  commitAll(inner);
});

afterAll(async () => {
  for (const name of Object.values(NAMES)) await cleanupTestDir(name);
  if (savedEnv.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedEnv.global;
  if (savedEnv.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedEnv.system;
});

describe('the corpus directory resolves inside the repository', () => {
  test('a real corpus outside the repository is refused by name', async () => {
    const dir = relative(inner, join(outside, 'docs', 'adr'));
    expect(existsSync(join(inner, dir, '0001-use-the-sync-protocol.md'))).toBe(true);
    const result = await generatePortal({ cwd: inner, dir, out: 'site-outside', asOf: AS_OF });
    expect(result.exitCode).toBe(2);
    expect(result.message).toBe(`Corpus directory "${dir}" is outside the repository.`);
    expect(existsSync(join(inner, 'site-outside'))).toBe(false);
  });

  test('a committed symlinked docs/adr that leaves the repository is exit 2', async () => {
    const result = await generatePortal({ cwd: repo, out: 'site-link', asOf: AS_OF });
    expect(result.exitCode).toBe(2);
    expect(result.message).toBe('Corpus directory "docs/adr" is outside the repository.');
    expect(result.data).toBeNull();
    expect(existsSync(join(repo, 'site-link'))).toBe(false);
  });

  test('a dir option through a symlink that leaves the repository is exit 2', async () => {
    const result = await generatePortal({ cwd: repo, dir: 'ext', out: 'site-ext', asOf: AS_OF });
    expect(result.exitCode).toBe(2);
    expect(result.message).toBe('Corpus directory "ext" is outside the repository.');
    expect(existsSync(join(repo, 'site-ext'))).toBe(false);
  });

  test('a symlink that stays inside the repository is followed', async () => {
    const result = await generatePortal({ cwd: inner, out: 'site-inner', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(result.data!.records.length).toBeGreaterThan(0);
  });
});

describe('exit 2 leaves out untouched', () => {
  test('a write failure part way leaves out byte-for-byte untouched', async () => {
    const out = join(inner, 'site-existing');
    await writeText(join(out, 'portal-data.json'), '{"version":"1","sentinel":true}\n');
    await writeText(join(out, 'index.html'), '<!doctype html><p>old page</p>\n');
    await writeText(join(out, 'vendor', 'board-view.mjs'), '// old\n');
    const before = await snapshot(out);
    const siblingsBefore = (await readdir(dirname(out))).sort();

    let writes = 0;
    const result = await generatePortal({
      cwd: inner,
      out: 'site-existing',
      asOf: AS_OF,
      io: {
        writeFile: async (path: string, contents: string) => {
          writes += 1;
          // Fail on the fourth file: three page files would already be in place in the old code.
          if (writes === 4) throw Object.assign(new Error('injected'), { code: 'EIO' });
          await writeFile(path, contents, 'utf8');
        },
      },
    });
    expect(writes).toBe(4);
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/\(EIO\)\.$/);
    expect(await snapshot(out)).toEqual(before);
    // The staging directory is gone too.
    expect((await readdir(dirname(out))).sort()).toEqual(siblingsBefore);
  });

  test('a successful run replaces out whole, with no stale page files', async () => {
    const out = join(inner, 'site-replaced');
    await writeText(join(out, 'stale.txt'), 'from an older bundle\n');
    const result = await generatePortal({ cwd: inner, out: 'site-replaced', asOf: AS_OF });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);
    expect(Object.keys(await snapshot(out)).sort()).toEqual(['app.css', 'index.html', 'page/app.mjs', 'page/icon.svg', 'portal-data.json', 'vendor/board-layout.mjs', 'vendor/board-view.mjs']);
    const siblings = await readdir(inner);
    expect(siblings.filter((name) => name.includes('staging') || name.includes('.old-'))).toEqual([]);
  });

  test('an output directory that holds the repository is refused', async () => {
    for (const out of ['.', '..']) {
      const result = await generatePortal({ cwd: inner, out, asOf: AS_OF });
      expect({ out, exitCode: result.exitCode }).toEqual({ out, exitCode: 2 });
      expect(result.message).toBe(`Output directory "${out}" would replace the repository or the working directory.`);
    }
    expect(existsSync(join(inner, 'records', 'docs', 'adr'))).toBe(true);
  });
});
