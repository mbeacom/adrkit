/**
 * @adrkit/ci — the ARB queue Action entrypoint. This is the ONLY file that imports
 * `@actions/core` / `@actions/github`. It loads the corpus, builds the report, and
 * delegates the managed-issue write to the pure `publishQueueReport` orchestration.
 * A corpus-load failure fails the run BEFORE any GitHub client is constructed.
 */

import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { buildQueueReport, formatQueueReportMarkdown, lintCorpus } from '@adrkit/core';
import { publishQueueReport } from './queue-issue.ts';
import { createOctokitQueueClient, handleGitHubApiError, type QueueOctokit } from './queue-github-client.ts';

async function main(): Promise<void> {
  const dir = core.getInput('dir') || 'docs/adr';
  const token = core.getInput('token') || process.env.GITHUB_TOKEN || '';
  const issueTitle = core.getInput('issue-title') || 'ADR ARB Queue';
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  // Corpus load is the first boundary; if it throws, fail before touching GitHub.
  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ dir, cwd: workspace });
  } catch (error) {
    core.setFailed(
      `adrkit queue: could not load the ADR corpus at '${dir}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const report = buildQueueReport({ corpus, asOf });
  const markdown = formatQueueReportMarkdown(report);

  const [owner = '', repo = ''] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const octokit = getOctokit(token) as unknown as QueueOctokit;
  const client = createOctokitQueueClient(octokit, owner, repo);

  try {
    await publishQueueReport(report, markdown, client, issueTitle, {
      setOutput: (name, value) => core.setOutput(name, value),
      setFailed: (message) => core.setFailed(message),
    });
  } catch (error) {
    handleGitHubApiError(error, (message) => core.setFailed(message));
  }
}

await main().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
