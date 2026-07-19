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
  /**
   * Changed dependencies for `package` matchers, or `undefined` when a changed
   * lockfile's diff could not be obtained (so package matchers go inert with the
   * required info finding, rather than falsely resolving to "nothing changed").
   */
  changedDependencies: ChangedDependency[] | undefined;
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
 * Build the changed-dependency snapshot from *every* changed `bun.lock`:
 * - no lockfile changed -> `[]` (resolvable: nothing changed);
 * - a changed lockfile whose diff the API omitted (large files lose their `patch`)
 *   -> `undefined` (unknown -> package matchers stay inert, not silently empty);
 * - otherwise -> the aggregated, deduplicated, sorted union of all lockfile diffs.
 */
function deriveChangedDependencies(files: readonly PrFile[]): ChangedDependency[] | undefined {
  const lockfiles = files.filter((file) => isLockfile(file.filename));
  if (lockfiles.length === 0) return [];
  if (lockfiles.some((file) => file.patch === undefined)) return undefined;

  const byKey = new Map<string, ChangedDependency>();
  for (const lockfile of lockfiles) {
    for (const dependency of deriveChangedDependenciesFromBunLockDiff(lockfile.patch as string)) {
      byKey.set(`${dependency.name}\0${dependency.version}`, dependency);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/**
 * Extract the PR's complete changed-file set from the injected client via a fully
 * paginated `pulls.listFiles`, plus the changed-dependency snapshot derived from the
 * `bun.lock` diff(s). Impurity (the API call) lives here in the Action, never in the
 * resolver (ADR-0009). The `truncated` flag lets the caller refuse to evaluate a
 * partial list rather than silently resolving against it.
 */
export async function extractChanges(client: GitHubClient): Promise<ExtractedChanges> {
  const files = await client.listPullFiles();
  const truncated = files.length >= LIST_FILES_CAP;

  const changedFiles = [...new Set(files.flatMap(pathsForFile))].sort((a, b) => a.localeCompare(b));
  const changedDependencies = deriveChangedDependencies(files);

  return { changedFiles, changedDependencies, truncated };
}
