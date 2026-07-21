/**
 * @adrkit/ci — pure managed-issue logic for the ARB queue Action
 * (contracts/github-action.md). No `@actions/*` imports: the `GitHubQueueClient`
 * port is injected so every branch is testable with a hand-rolled fake — no token,
 * no network. `managedQueueIssue` owns marker/title/state discovery and the single
 * issue mutation; `publishQueueReport` owns the write → output → conditional-failure
 * ordering.
 */

import type { QueueReport } from '@adrkit/core';

/** Hidden ownership marker; always the exact first line of a managed issue body. */
export const MARKER = '<!-- adrkit-managed-queue-issue -->';

export interface GitHubQueueClient {
  /** ALL issues (open AND closed). Pull requests are excluded by the GraphQL type. */
  listAllIssues(): Promise<Array<{ number: number; state: 'open' | 'closed'; title: string; body: string | null }>>;
  createIssue(title: string, body: string): Promise<{ number: number }>;
  updateIssue(issueNumber: number, update: { body: string; state?: 'open' }): Promise<void>;
}

export interface PublishCallbacks {
  setOutput(name: string, value: string | number): void;
  setFailed(message: string): void;
}

/** Exact first-line ownership check (accepts marker-only, LF, CRLF, and CR bodies). */
function isManaged(body: string | null): boolean {
  return (body ?? '').split(/\r\n|\n|\r/, 1)[0] === MARKER;
}

/**
 * Create, update, or reopen+update exactly the one managed queue issue, or fail
 * (naming conflicts/duplicates) without writing. At most one write call per run.
 */
export async function managedQueueIssue(
  markdownReport: string,
  client: GitHubQueueClient,
  issueTitle: string,
): Promise<{ issueNumber: number }> {
  const issues = await client.listAllIssues();
  const managed = issues.filter((issue) => isManaged(issue.body));
  const body = `${MARKER}\n${markdownReport}`;

  if (managed.length === 0) {
    const unowned = issues.filter((issue) => issue.title === issueTitle && !isManaged(issue.body));
    if (unowned.length > 0) {
      const conflicts = [...unowned].sort((a, b) => a.number - b.number).map((issue) => `#${issue.number}`);
      throw new Error(
        `Found ${conflicts.length} issue(s) titled '${issueTitle}' without adrkit marker: ${conflicts.join(', ')}. Resolve conflicts before running the queue Action.`,
      );
    }
    const created = await client.createIssue(issueTitle, body);
    return { issueNumber: created.number };
  }

  if (managed.length === 1) {
    const target = managed[0]!;
    await client.updateIssue(target.number, target.state === 'closed' ? { body, state: 'open' } : { body });
    return { issueNumber: target.number };
  }

  const numbers = [...managed].sort((a, b) => a.number - b.number).map((issue) => issue.number);
  throw new Error(
    `Found ${managed.length} issues with adrkit managed queue marker: #${numbers.join(', #')}. Remove the marker from all but one and re-run.`,
  );
}

/**
 * Orchestrate one queue publish: write the managed issue, set the `issue-number`
 * output, then fail iff the report carries error-severity corpus findings. The write
 * always happens first so the managed issue reflects the current corpus health.
 */
export async function publishQueueReport(
  report: QueueReport,
  markdownReport: string,
  client: GitHubQueueClient,
  issueTitle: string,
  callbacks: PublishCallbacks,
): Promise<void> {
  const { issueNumber } = await managedQueueIssue(markdownReport, client, issueTitle);
  callbacks.setOutput('issue-number', issueNumber);

  const errorCount = report.corpusFindings.filter((finding) => finding.severity === 'error').length;
  if (errorCount > 0) {
    callbacks.setFailed(`Queue report contains ${errorCount} corpus error(s). See issue #${issueNumber} for details.`);
  }
}
