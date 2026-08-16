import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../packages/core/test/helpers.ts';
import { compareStableVersions, parseStableVersionTag, updateActionTag } from './update-action-tag.ts';

const DIR_NAME = 'update-action-tag';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'inherit' });
  const output = (await new Response(process.stdout).text()).trim();
  expect(await process.exited).toBe(0);
  return output;
}

async function remoteTagCommit(cwd: string, tag: string): Promise<string> {
  const refs = await git(
    cwd,
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  );
  const lines = refs.split('\n');
  const line = lines.find((entry) => entry.endsWith(`refs/tags/${tag}^{}`))
    ?? lines.find((entry) => entry.endsWith(`refs/tags/${tag}`));
  if (!line) throw new Error(`Remote tag ${tag} was not found`);
  const sha = line.split(/\s+/)[0];
  if (!sha) throw new Error(`Remote tag ${tag} has no object ID`);
  return sha;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('moving Action tag version guard', () => {
  test('parses stable release tags', () => {
    expect(parseStableVersionTag('v12.34.56')).toEqual({ major: 12, minor: 34, patch: 56 });
  });

  test('rejects prerelease and malformed tags', () => {
    expect(() => parseStableVersionTag('v0.2.0-rc.1')).toThrow('stable SemVer');
    expect(() => parseStableVersionTag('v01.2.3')).toThrow('stable SemVer');
  });

  test('orders versions monotonically', () => {
    expect(compareStableVersions(parseStableVersionTag('v0.2.0'), parseStableVersionTag('v0.1.9'))).toBeGreaterThan(0);
    expect(compareStableVersions(parseStableVersionTag('v1.0.0'), parseStableVersionTag('v0.99.99'))).toBeGreaterThan(0);
    expect(compareStableVersions(parseStableVersionTag('v0.1.0'), parseStableVersionTag('v0.1.0'))).toBe(0);
  });

  test('never rolls a moving major tag backward and advances it for a newer release', async () => {
    const root = await resetTestDir(DIR_NAME);
    const remote = join(root, 'remote.git');
    const work = join(root, 'work');
    await git(root, 'init', '--bare', '--initial-branch=main', remote);
    await git(root, 'init', '--initial-branch=main', work);
    await git(work, 'config', 'user.name', 'adrkit test');
    await git(work, 'config', 'user.email', 'test@adrkit.dev');
    await git(work, 'config', 'commit.gpgSign', 'false');
    await git(work, 'config', 'tag.gpgSign', 'false');
    await git(work, 'remote', 'add', 'origin', remote);

    await writeText(join(work, 'release.txt'), 'v0.1.0\n');
    await git(work, 'add', 'release.txt');
    await git(work, 'commit', '-m', 'v0.1.0');
    await git(work, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');

    await writeText(join(work, 'release.txt'), 'v0.2.0\n');
    await git(work, 'commit', '-am', 'v0.2.0');
    await git(work, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
    await git(work, 'tag', '-a', 'v0', '-m', 'v0');
    await git(work, 'push', 'origin', '--tags');

    expect(await updateActionTag('v0.1.0', { repositoryRoot: work })).toBe(false);
    const v02Sha = await git(work, 'rev-list', '-n', '1', 'v0.2.0');
    expect(await remoteTagCommit(work, 'v0')).toBe(v02Sha);

    await writeText(join(work, 'release.txt'), 'v0.3.0\n');
    await git(work, 'commit', '-am', 'v0.3.0');
    await git(work, 'tag', '-a', 'v0.3.0', '-m', 'v0.3.0');
    await git(work, 'push', 'origin', 'refs/tags/v0.3.0');

    expect(await updateActionTag('v0.3.0', { repositoryRoot: work })).toBe(true);
    const v03Sha = await git(work, 'rev-list', '-n', '1', 'v0.3.0');
    expect(await remoteTagCommit(work, 'v0')).toBe(v03Sha);
  });

  /**
   * Regression: the test above sets `tag.gpgSign false`, which is exactly the
   * condition that hid this. With `tag.gpgSign = true` — a common global default
   * — `git tag --force v0 <sha>` becomes a *signed* tag, which requires a
   * message, so it fails with "Please supply the message using either -m or -F
   * option." CI runners set no such config, so the moving tag only ever broke
   * for a human running the release step locally, and it presented as though the
   * tag were protected rather than the command being misconfigured.
   */
  test('moves the major tag even when the environment forces signed tags', async () => {
    const root = await resetTestDir(`${DIR_NAME}-gpgsign`);
    const remote = join(root, 'remote.git');
    const work = join(root, 'work');
    await git(root, 'init', '--bare', '--initial-branch=main', remote);
    await git(root, 'init', '--initial-branch=main', work);
    await git(work, 'config', 'user.name', 'adrkit test');
    await git(work, 'config', 'user.email', 'test@adrkit.dev');
    await git(work, 'config', 'commit.gpgSign', 'false');
    // The point of this test: signing is ON, and there is no signing key.
    await git(work, 'config', 'tag.gpgSign', 'true');
    await git(work, 'remote', 'add', 'origin', remote);

    await writeText(join(work, 'release.txt'), 'v0.1.0\n');
    await git(work, 'add', 'release.txt');
    await git(work, 'commit', '-m', 'v0.1.0');
    await git(work, '-c', 'tag.gpgSign=false', 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
    await git(work, '-c', 'tag.gpgSign=false', 'tag', 'v0');
    await git(work, 'push', 'origin', '--tags');

    await writeText(join(work, 'release.txt'), 'v0.2.0\n');
    await git(work, 'commit', '-am', 'v0.2.0');
    await git(work, '-c', 'tag.gpgSign=false', 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
    await git(work, 'push', 'origin', 'refs/tags/v0.2.0');

    expect(await updateActionTag('v0.2.0', { repositoryRoot: work })).toBe(true);
    const v02Sha = await git(work, 'rev-list', '-n', '1', 'v0.2.0');
    expect(await remoteTagCommit(work, 'v0')).toBe(v02Sha);
  });
});
