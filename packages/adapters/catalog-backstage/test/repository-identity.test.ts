/**
 * T041 — FR-009: repository identity and revision come from **separate git
 * tooling**, never from a descriptor annotation or any content under the
 * repository being described.
 *
 * **The fixture is a standalone scratch `git init` repository, and that is a
 * contract requirement rather than a testing preference.** `input-manifest.md`
 * §3.1: a `git worktree add` linked worktree shares its remote configuration with
 * the repository it was created from, so a linked worktree of *this* repository
 * would always report `github.com/mbeacom/adrkit` no matter what the test intended,
 * and a mismatch test run inside one would pass without ever varying the thing it
 * claims to vary. The checkout this package is developed in **is** such a worktree.
 *
 * `test('the development checkout really is a linked worktree', ...)` below asserts
 * that premise rather than assuming it, because if it ever stopped being true the
 * §3.1 constraint would be silently over-cautious rather than load-bearing, and a
 * reader deserves to know which.
 *
 * Expected values come from `research.md` R6's numbered normalization algorithm and
 * from `data-model.md` §2. None is derived by running the code under test.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INVALID_REPOSITORY_ID,
  compareRepositoryIdentity,
  normalizeRepositoryId,
  readObservedRepositoryState,
} from '../src/repository/identity.ts';

const SCRATCH_REMOTE = 'git@github.com:mbeacom/adrkit-scratch-fixture.git';
const SCRATCH_NORMALIZED = 'github.com/mbeacom/adrkit-scratch-fixture';

let scratchRoot = '';
let scratchHead = '';

async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(' ')}: ${stderr}`);
  return stdout.trim();
}

beforeAll(async () => {
  // A fresh, disposable `git init`'d directory with its own `origin` and its own
  // commit — entirely separate from this repository's `.git`, per §3.1.
  scratchRoot = await mkdtemp(join(tmpdir(), 'adrkit-scratch-repo-'));
  await git(['init', '--initial-branch=main'], scratchRoot);
  await git(['config', 'user.email', 'fixture@example.invalid'], scratchRoot);
  await git(['config', 'user.name', 'adrkit fixture'], scratchRoot);
  await git(['config', 'commit.gpgsign', 'false'], scratchRoot);
  await git(['remote', 'add', 'origin', SCRATCH_REMOTE], scratchRoot);
  await writeFile(join(scratchRoot, 'catalog-info.yaml'), 'kind: Component\n', 'utf8');
  await git(['add', '.'], scratchRoot);
  await git(['commit', '-m', 'fixture'], scratchRoot);
  scratchHead = await git(['rev-parse', 'HEAD'], scratchRoot);
});

afterAll(async () => {
  if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
});

describe('T041 — `research.md` R6 normalization, step by step', () => {
  test('step 3 — the SCP-like `git@github.com:` form', () => {
    expect(normalizeRepositoryId('git@github.com:mbeacom/adrkit.git')).toBe(
      'github.com/mbeacom/adrkit',
    );
  });

  test('step 4 — https, http, and ssh forms, with and without `git@`', () => {
    for (const raw of [
      'https://github.com/mbeacom/adrkit.git',
      'https://github.com/mbeacom/adrkit',
      'http://github.com/mbeacom/adrkit',
      'ssh://git@github.com/mbeacom/adrkit.git',
    ]) {
      expect(normalizeRepositoryId(raw)).toBe('github.com/mbeacom/adrkit');
    }
  });

  test('step 5 — an already-bare `github.com/...` form is kept', () => {
    expect(normalizeRepositoryId('github.com/mbeacom/adrkit')).toBe('github.com/mbeacom/adrkit');
  });

  test('steps 2 and 6 in that order — `.../repo.git/` loses the slash, then `.git`', () => {
    // R6 is explicit that step 6 runs after step 2, "never the reverse, which
    // would leave a dangling `/` unstripped".
    expect(normalizeRepositoryId('https://github.com/mbeacom/adrkit.git/')).toBe(
      'github.com/mbeacom/adrkit',
    );
    expect(normalizeRepositoryId('https://github.com/mbeacom/adrkit.git///')).toBe(
      'github.com/mbeacom/adrkit',
    );
  });

  test('step 7 — anything but exactly two non-empty segments is invalid', () => {
    for (const raw of [
      'https://github.com/mbeacom/adrkit/extra',
      'https://github.com/mbeacom',
      'https://github.com/mbeacom/adrkit?x=1',
      'https://github.com/mbeacom/adrkit#frag',
      'https://gitlab.com/mbeacom/adrkit.git',
      'not-a-url',
      '',
    ]) {
      expect(normalizeRepositoryId(raw)).toBe(INVALID_REPOSITORY_ID);
    }
  });

  test('step 8 — the whole string is ASCII case-folded', () => {
    expect(normalizeRepositoryId('git@github.com:MBeacom/ADRKit.git')).toBe(
      'github.com/mbeacom/adrkit',
    );
  });

  test('step 1 — trailing whitespace is stripped, as `git` output carries it', () => {
    expect(normalizeRepositoryId('git@github.com:mbeacom/adrkit.git\n')).toBe(
      'github.com/mbeacom/adrkit',
    );
  });
});

describe('T041 — identity is read from git, not from the manifest or a descriptor', () => {
  test('the development checkout really is a linked worktree (§3.1\u2019s premise)', async () => {
    // If this ever fails, §3.1's constraint has stopped being load-bearing here and
    // the scratch-repository requirement deserves re-reading rather than silent
    // inheritance.
    const gitDir = await git(['rev-parse', '--git-dir'], import.meta.dir);
    const commonDir = await git(['rev-parse', '--git-common-dir'], import.meta.dir);
    expect(gitDir).not.toBe(commonDir);
  });

  test('the scratch repository reports its own origin, not this repository\u2019s', async () => {
    const observed = await readObservedRepositoryState(scratchRoot);
    expect(observed.remoteRaw).toBe(SCRATCH_REMOTE);
    expect(normalizeRepositoryId(observed.remoteRaw)).toBe(SCRATCH_NORMALIZED);
    expect(normalizeRepositoryId(observed.remoteRaw)).not.toBe('github.com/mbeacom/adrkit');
  });

  test('the scratch repository reports its own HEAD, a 40-character hex sha', async () => {
    const observed = await readObservedRepositoryState(scratchRoot);
    expect(observed.head).toBe(scratchHead);
    expect(observed.head).toMatch(/^[0-9a-f]{40}$/u);
  });

  test('a manifest agreeing with the scratch checkout matches', async () => {
    const observed = await readObservedRepositoryState(scratchRoot);
    const result = compareRepositoryIdentity(
      { id: SCRATCH_NORMALIZED, revision: scratchHead },
      observed,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('match');
    expect(result.value.observedRemoteRaw).toBe(SCRATCH_REMOTE);
    expect(result.value.observedRepositoryId).toBe(SCRATCH_NORMALIZED);
  });

  test('an annotation-supplied slug is never consulted', () => {
    // `input-manifest.md` §3: identity is supplied only by the manifest and
    // verified against git — never inferred from `github.com/project-slug`. The
    // comparison function's signature is the enforcement: there is no parameter
    // through which a descriptor annotation could arrive.
    const parameterNames = compareRepositoryIdentity.length;
    expect(parameterNames).toBe(2);
    const source = compareRepositoryIdentity.toString();
    expect(source).not.toContain('project-slug');
    expect(source).not.toContain('annotation');
  });
});
