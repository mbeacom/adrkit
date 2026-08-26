import { resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dir, '..');

export interface StableVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface ActionTagUpdate {
  changed: boolean;
  majorTag: string;
  previousReleaseTag?: string;
  previousSha?: string;
  targetReleaseTag: string;
  targetSha: string;
}

interface RemoteTag {
  objectSha?: string;
  peeledSha?: string;
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

function parseRemoteTags(output: string): Map<string, RemoteTag> {
  const tags = new Map<string, RemoteTag>();
  for (const line of output.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref?.startsWith('refs/tags/')) continue;
    const peeled = ref.endsWith('^{}');
    const tag = ref.slice('refs/tags/'.length, peeled ? -3 : undefined);
    const current = tags.get(tag) ?? {};
    if (peeled) current.peeledSha = sha;
    else current.objectSha = sha;
    tags.set(tag, current);
  }
  return tags;
}

async function remoteTags(
  remoteName: string,
  patterns: string[],
  repositoryRoot: string,
): Promise<Map<string, RemoteTag>> {
  const output = await run(
    ['git', 'ls-remote', '--tags', remoteName, ...patterns],
    repositoryRoot,
    true,
  );
  return parseRemoteTags(output);
}

async function moveActionTag(
  releaseTag: string,
  options: {
    repositoryRoot?: string;
    remote?: string;
    recovery: boolean;
  },
): Promise<ActionTagUpdate> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const remoteName = options.remote ?? 'origin';
  const releaseVersion = parseStableVersionTag(releaseTag);
  const majorTag = `v${releaseVersion.major}`;
  const targetRemote = (await remoteTags(
    remoteName,
    [`refs/tags/${releaseTag}`, `refs/tags/${releaseTag}^{}`],
    repositoryRoot,
  )).get(releaseTag);
  assert(
    targetRemote?.objectSha && targetRemote.peeledSha,
    `Remote release ${releaseTag} must be an existing annotated tag`,
  );
  const localTagType = await run(
    ['git', 'cat-file', '-t', `refs/tags/${releaseTag}`],
    repositoryRoot,
  );
  assert(localTagType === 'tag', `Local release ${releaseTag} must be an annotated tag`);
  const releaseSha = await run(
    ['git', 'rev-parse', `${releaseTag}^{commit}`],
    repositoryRoot,
  );
  assert(
    targetRemote.peeledSha === releaseSha,
    `Local ${releaseTag} resolves to ${releaseSha}, but ${remoteName} resolves to ${targetRemote.peeledSha}`,
  );

  const movingRemote = (await remoteTags(
    remoteName,
    [`refs/tags/${majorTag}`, `refs/tags/${majorTag}^{}`],
    repositoryRoot,
  )).get(majorTag);
  const remoteRefSha = movingRemote?.objectSha;
  const remoteSha = movingRemote?.peeledSha ?? movingRemote?.objectSha;
  let current: { tag: string; sha: string; version: StableVersion } | undefined;

  if (remoteSha) {
    const releaseTags = await remoteTags(
      remoteName,
      [`refs/tags/${majorTag}.*.*`, `refs/tags/${majorTag}.*.*^{}`],
      repositoryRoot,
    );
    const currentVersions = [...releaseTags.entries()]
      .map(([tag, remoteTag]) => {
        if (!remoteTag.objectSha || !remoteTag.peeledSha) return undefined;
        if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) return undefined;
        return { tag, sha: remoteTag.peeledSha, version: parseStableVersionTag(tag) };
      })
      .filter((candidate) => candidate !== undefined)
      .filter(({ sha, version }) => sha === remoteSha && version.major === releaseVersion.major)
      .sort((left, right) => compareStableVersions(right.version, left.version));
    current = currentVersions[0];
    assert(current, `Remote ${majorTag} does not point at an immutable ${majorTag}.x.y release tag`);
    if (releaseSha === remoteSha) {
      console.log(`release-action-tag: ${majorTag} remains at ${current.tag} (${remoteSha})`);
      return {
        changed: false,
        majorTag,
        previousReleaseTag: current.tag,
        previousSha: remoteSha,
        targetReleaseTag: releaseTag,
        targetSha: releaseSha,
      };
    }
    if (!options.recovery && compareStableVersions(releaseVersion, current.version) <= 0) {
      console.log(`release-action-tag: ${majorTag} remains at ${current.tag}; ${releaseTag} is not newer`);
      return {
        changed: false,
        majorTag,
        previousReleaseTag: current.tag,
        previousSha: remoteSha,
        targetReleaseTag: releaseTag,
        targetSha: releaseSha,
      };
    }
  }

  // `-c tag.gpgSign=false` rather than a bare `git tag`: the moving major tag is
  // a pointer, not a release artifact, and it is created unannotated so it peels
  // to the commit directly. A developer with `tag.gpgSign = true` in their global
  // config — a common and sensible default — turns this into a signed tag, which
  // requires a message, and the command fails with "Please supply the message
  // using either -m or -F option." CI runners carry no such config, so this only
  // ever breaks the local path, and it reads as though the tag were protected
  // rather than misconfigured.
  await run(['git', '-c', 'tag.gpgSign=false', 'tag', '--force', majorTag, releaseSha], repositoryRoot, true);
  await run(
    [
      'git',
      'push',
      `--force-with-lease=refs/tags/${majorTag}:${remoteRefSha ?? ''}`,
      remoteName,
      `refs/tags/${majorTag}`,
    ],
    repositoryRoot,
    true,
  );
  const previous = current && remoteSha ? ` from ${current.tag} (${remoteSha})` : '';
  const mode = options.recovery ? 'recovered' : 'moved';
  console.log(`release-action-tag: ${mode} ${majorTag}${previous} to ${releaseTag} (${releaseSha})`);
  return {
    changed: true,
    majorTag,
    previousReleaseTag: current?.tag,
    previousSha: remoteSha,
    targetReleaseTag: releaseTag,
    targetSha: releaseSha,
  };
}

export async function updateActionTag(
  releaseTag: string,
  options: { repositoryRoot?: string; remote?: string } = {},
): Promise<boolean> {
  return (await moveActionTag(releaseTag, { ...options, recovery: false })).changed;
}

export async function recoverActionTag(
  releaseTag: string,
  options: { repositoryRoot?: string; remote?: string } = {},
): Promise<boolean> {
  return (await moveActionTag(releaseTag, { ...options, recovery: true })).changed;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const recovery = args[0] === '--recover';
  const [releaseTag, ...extra] = recovery ? args.slice(1) : args;
  assert(
    releaseTag && extra.length === 0,
    'Usage: bun scripts/update-action-tag.ts [--recover] vMAJOR.MINOR.PATCH',
  );
  if (recovery) await recoverActionTag(releaseTag);
  else await updateActionTag(releaseTag);
}
