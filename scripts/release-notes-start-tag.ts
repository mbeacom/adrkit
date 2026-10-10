/**
 * Choose the tag GitHub should start a release's generated notes from.
 *
 * `gh release create --generate-notes` with no start tag diffs against the
 * latest release of **any** kind. Lockstep (`vX.Y.Z`) and adapter
 * (`<slug>-vX.Y.Z`, ADR-0007) releases share one repository, so an adapter
 * release listed every pull request since the last lockstep release, and the
 * next lockstep release would have started at that adapter tag and dropped
 * those pull requests from both lockstep releases.
 *
 * The start tag is the highest existing tag of the **same kind** below the one
 * being released, compared by SemVer. Tags that are not stable releases are
 * never chosen: the moving Action tag `v0`, pre-releases, and
 * `action-recovery-block/<sha>` markers do not match the grammar. When no
 * earlier tag of the kind exists, nothing is printed and the workflow omits
 * `--notes-start-tag`, keeping GitHub's default.
 *
 * Usage: `bun scripts/release-notes-start-tag.ts <tag>`; reads `git tag --list`.
 */

export interface ReleaseTag {
  /** `''` for a lockstep tag, otherwise the adapter slug (`spec-kit`). */
  kind: string;
  major: number;
  minor: number;
  patch: number;
}

const RELEASE_TAG = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*)-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseReleaseTag(tag: string): ReleaseTag | undefined {
  const match = RELEASE_TAG.exec(tag);
  if (!match) return undefined;
  return {
    kind: match[1] ?? '',
    major: Number(match[2]),
    minor: Number(match[3]),
    patch: Number(match[4]),
  };
}

function compare(left: ReleaseTag, right: ReleaseTag): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

/**
 * The highest tag in `tags` of the same kind as `current` and strictly below
 * it, or `undefined` for the first release of that kind. Throws when `current`
 * is not a stable release tag, so the workflow fails rather than silently
 * falling back to GitHub's cross-kind default.
 */
export function previousTagOfSameKind(current: string, tags: readonly string[]): string | undefined {
  const target = parseReleaseTag(current);
  if (!target) throw new Error(`Release tag ${current} is not vX.Y.Z or <slug>-vX.Y.Z`);
  let best: { tag: string; parsed: ReleaseTag } | undefined;
  for (const tag of tags) {
    const parsed = parseReleaseTag(tag);
    if (!parsed || parsed.kind !== target.kind) continue;
    if (compare(parsed, target) >= 0) continue;
    if (!best || compare(parsed, best.parsed) > 0) best = { tag, parsed };
  }
  return best?.tag;
}

async function main(argv: readonly string[]): Promise<void> {
  const [current, ...rest] = argv;
  if (!current || rest.length > 0) {
    throw new Error('Usage: bun scripts/release-notes-start-tag.ts <tag>');
  }
  const git = Bun.spawn(['git', 'tag', '--list'], { stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(git.stdout).text();
  const exitCode = await git.exited;
  if (exitCode !== 0) throw new Error(`git tag --list failed with exit ${exitCode}`);
  const tags = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const start = previousTagOfSameKind(current, tags);
  if (start) process.stdout.write(`${start}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
