import { checkChanges, type CheckLintResult, type CheckOutcome } from '@adrkit/core';
import { extractChanges, type ExtractedChanges } from './changed-files.ts';
import { CI_COMMENT_MARKER, renderComment, renderTruncatedNotice } from './comment.ts';
import { isPermissionError, upsertMarkedComment, type GitHubClient, type UpsertOutcome } from './github.ts';

/** Minimal logger port so the orchestrator can be driven with a fake in tests. */
export interface Logger {
  info(message: string): void;
  notice(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
}

export interface ActionDeps {
  client: GitHubClient;
  dir: string;
  loadLint: (dir: string) => Promise<CheckLintResult>;
  extract?: (client: GitHubClient) => Promise<ExtractedChanges>;
  log: Logger;
}

export interface ActionResult {
  /** `null` when the diff was too large to list completely, so it was not evaluated. */
  outcome: CheckOutcome | null;
  comment: UpsertOutcome | 'skipped';
  failed: boolean;
  truncated: boolean;
}

/** Post or update the comment, degrading (not failing) on a comment-permission error. */
async function comment(deps: ActionDeps, body: string): Promise<UpsertOutcome | 'skipped'> {
  try {
    const result = await upsertMarkedComment(deps.client, CI_COMMENT_MARKER, body);
    deps.log.info(`adrkit: ${result} the governing-decisions comment.`);
    return result;
  } catch (error) {
    if (isPermissionError(error)) {
      // Fork PRs get a read-only GITHUB_TOKEN. Surface the result in the job log
      // instead of failing the job for a permission we cannot have (FR-014).
      deps.log.notice(
        `adrkit: no permission to comment on this PR (read-only token); posting the result to the job log instead.\n\n${body}`,
      );
      return 'skipped';
    }
    throw error;
  }
}

/**
 * The Action's orchestration, with every impure edge injected: extract the PR's
 * complete changed-file list, run the neutral core `checkChanges`, render the
 * comment, and create-or-update it. Fails the job iff a changed record has an
 * `error` finding (FR-002); a commenting-permission failure degrades to a log
 * notice and does NOT fail the job (FR-014/R8).
 */
export async function runAction(deps: ActionDeps): Promise<ActionResult> {
  const extract = deps.extract ?? extractChanges;
  const changes = await extract(deps.client);

  // Never evaluate a truncated changed-file list — that would silently miss governed
  // files (FR-003). Post an actionable notice and stop before checkChanges.
  if (changes.truncated) {
    deps.log.warning(
      'adrkit: the PR changed-file list exceeded the provider cap and could not be obtained ' +
        'completely; governing decisions were not computed for this PR.',
    );
    const result = await comment(deps, renderTruncatedNotice());
    return { outcome: null, comment: result, failed: false, truncated: true };
  }

  const lint = await deps.loadLint(deps.dir);
  const outcome = checkChanges({
    lint,
    changedFiles: changes.changedFiles,
    dir: deps.dir,
    snapshots: { changedDependencies: changes.changedDependencies },
  });

  const result = await comment(deps, renderComment(outcome));

  const changedRecordErrors = outcome.findings.filter(
    (finding) =>
      finding.severity === 'error' && finding.path !== undefined && outcome.changedRecords.includes(finding.path),
  );
  const failed = changedRecordErrors.length > 0;
  if (failed) {
    deps.log.setFailed(
      `adrkit: ${changedRecordErrors.length} changed ADR record(s) failed validation.`,
    );
  }

  return { outcome, comment: result, failed, truncated: false };
}
