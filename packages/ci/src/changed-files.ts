import { deriveChangedDependenciesFromBunLockDiff, type ChangedDependency } from '@adrkit/core';
import type { GitHubClient, PrFile } from './github.ts';

/**
 * GitHub's `pulls.listFiles` paginates to at most 3000 files. Beyond that even the
 * paginated listing truncates, so we detect the cap explicitly and surface it (R4).
 * (The compare API's 300-file list is never used — it truncates far sooner.)
 */
export const LIST_FILES_CAP = 3000;

const LOCKFILE = 'bun.lock';

export interface ExtractedChanges {
  /** Complete, deduplicated, sorted repo-relative changed-file list (base…head). */
  changedFiles: string[];
  /** Changed dependencies derived from the `bun.lock` diff, for `package` matchers. */
  changedDependencies: ChangedDependency[];
  /** True when the file listing hit the provider cap and may be incomplete. */
  truncated: boolean;
}

function pathsForFile(file: PrFile): string[] {
  const paths = [file.filename];
  // A rename touches both the old and new path; surface both so matchers on either fire.
  if (file.previousFilename && file.previousFilename !== file.filename) {
    paths.push(file.previousFilename);
  }
  return paths;
}

function isLockfile(filename: string): boolean {
  return filename === LOCKFILE || filename.endsWith(`/${LOCKFILE}`);
}

/**
 * Extract the PR's complete changed-file set from the injected client via a fully
 * paginated `pulls.listFiles`, plus the changed-dependency snapshot derived from the
 * `bun.lock` diff. Impurity (the API call) lives here in the Action, never in the
 * resolver (ADR-0009). The `truncated` flag lets the caller emit a notice when the
 * cap is hit rather than silently resolving against a partial list.
 */
export async function extractChanges(client: GitHubClient): Promise<ExtractedChanges> {
  const files = await client.listPullFiles();
  const truncated = files.length >= LIST_FILES_CAP;

  const changedFiles = [...new Set(files.flatMap(pathsForFile))].sort((a, b) => a.localeCompare(b));

  const lockfile = files.find((file) => isLockfile(file.filename));
  const changedDependencies = lockfile?.patch
    ? deriveChangedDependenciesFromBunLockDiff(lockfile.patch)
    : [];

  return { changedFiles, changedDependencies, truncated };
}
