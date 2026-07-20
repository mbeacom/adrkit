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
    await git(work, 'tag', 'v0');
    await git(work, 'push', 'origin', '--tags');

    expect(await updateActionTag('v0.1.0', { repositoryRoot: work })).toBe(false);
    const v02Sha = await git(work, 'rev-list', '-n', '1', 'v0.2.0');
    expect((await git(work, 'ls-remote', 'origin', 'refs/tags/v0')).split(/\s+/)[0]).toBe(v02Sha);

    await writeText(join(work, 'release.txt'), 'v0.3.0\n');
    await git(work, 'commit', '-am', 'v0.3.0');
    await git(work, 'tag', '-a', 'v0.3.0', '-m', 'v0.3.0');
    await git(work, 'push', 'origin', 'refs/tags/v0.3.0');

    expect(await updateActionTag('v0.3.0', { repositoryRoot: work })).toBe(true);
    const v03Sha = await git(work, 'rev-list', '-n', '1', 'v0.3.0');
    expect((await git(work, 'ls-remote', 'origin', 'refs/tags/v0')).split(/\s+/)[0]).toBe(v03Sha);
  });
});
