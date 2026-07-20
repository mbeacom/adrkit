import { resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dir, '..');

export interface StableVersion {
  major: number;
  minor: number;
  patch: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function parseStableVersionTag(tag: string): StableVersion {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  assert(match, `Release tag ${tag} must be stable SemVer (vMAJOR.MINOR.PATCH)`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareStableVersions(left: StableVersion, right: StableVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

async function run(command: string[], repositoryRoot: string, allowEmpty = false): Promise<string> {
  const process = Bun.spawn(command, {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'inherit',
    env: Bun.env,
  });
  const output = (await new Response(process.stdout).text()).trim();
  const exitCode = await process.exited;
  assert(exitCode === 0, `${command.join(' ')} failed with exit ${exitCode}`);
  if (!allowEmpty) assert(output, `${command.join(' ')} returned no output`);
  return output;
}

export async function updateActionTag(
  releaseTag: string,
  options: { repositoryRoot?: string; remote?: string } = {},
): Promise<boolean> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const remoteName = options.remote ?? 'origin';
  const releaseVersion = parseStableVersionTag(releaseTag);
  const majorTag = `v${releaseVersion.major}`;
  const remote = await run(
    [
      'git',
      'ls-remote',
      '--tags',
      remoteName,
      `refs/tags/${majorTag}`,
      `refs/tags/${majorTag}^{}`,
    ],
    repositoryRoot,
    true,
  );

  if (remote) {
    const remoteLines = remote.split('\n').filter(Boolean);
    const remoteLine = remoteLines.find((line) => line.endsWith(`refs/tags/${majorTag}^{}`))
      ?? remoteLines.find((line) => line.endsWith(`refs/tags/${majorTag}`));
    const remoteSha = remoteLine?.split(/\s+/)[0];
    assert(remoteSha, `Could not parse remote ${majorTag} ref`);
    const releaseTags = await run(
      [
        'git',
        'for-each-ref',
        '--format=%(refname:strip=2)%09%(objectname)%09%(*objectname)',
        `refs/tags/${majorTag}.*.*`,
      ],
      repositoryRoot,
      true,
    );
    const currentVersions = releaseTags
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [tag, objectSha, peeledSha] = line.split('\t');
        if (!tag || !objectSha || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) return undefined;
        return { tag, sha: peeledSha || objectSha, version: parseStableVersionTag(tag) };
      })
      .filter((candidate) => candidate !== undefined)
      .filter(({ sha, version }) => sha === remoteSha && version.major === releaseVersion.major)
      .sort((left, right) => compareStableVersions(right.version, left.version));
    const current = currentVersions[0];
    assert(current, `Remote ${majorTag} does not point at an immutable ${majorTag}.x.y release tag`);
    if (compareStableVersions(releaseVersion, current.version) <= 0) {
      console.log(`release-action-tag: ${majorTag} remains at ${current.tag}; ${releaseTag} is not newer`);
      return false;
    }
  }

  const releaseSha = await run(['git', 'rev-list', '-n', '1', releaseTag], repositoryRoot);
  await run(['git', 'tag', '--force', majorTag, releaseSha], repositoryRoot, true);
  await run(
    ['git', 'push', '--force', remoteName, `refs/tags/${majorTag}`],
    repositoryRoot,
    true,
  );
  console.log(`release-action-tag: moved ${majorTag} to ${releaseTag} (${releaseSha})`);
  return true;
}

if (import.meta.main) {
  const [releaseTag, ...extra] = Bun.argv.slice(2);
  assert(releaseTag && extra.length === 0, 'Usage: bun scripts/update-action-tag.ts vMAJOR.MINOR.PATCH');
  await updateActionTag(releaseTag);
}
