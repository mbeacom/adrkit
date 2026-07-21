/**
 * @adrkit/ci — side-effect-free Octokit adapter for the ARB queue Action
 * (contracts/github-action.md). No `@actions/*` imports: the entrypoint injects a
 * real Octokit; tests inject a structural fake. Marker ownership and duplicate
 * detection require exhaustive cursor traversal, so discovery uses the GraphQL
 * `repository.issues` connection (which excludes pull requests) rather than the
 * eventually-consistent Search API or REST list endpoint.
 */

import type { GitHubQueueClient } from './queue-issue.ts';

/** GraphQL over OPEN+CLOSED issues, 100 nodes per page, requesting only what we need. */
export const QUEUE_ISSUES_QUERY = `query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
      nodes { number state title body }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface QueueIssuesResponse {
  repository: {
    issues: {
      nodes: Array<{ number: number; state: string; title: string; body: string | null }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

/** The minimal Octokit surface the adapter needs; satisfied by `@actions/github`'s client. */
export interface QueueOctokit {
  graphql(query: string, variables: Record<string, unknown>): Promise<unknown>;
  rest: {
    issues: {
      create(params: { owner: string; repo: string; title: string; body: string }): Promise<{ data: { number: number } }>;
      update(params: { owner: string; repo: string; issue_number: number; body: string; state?: 'open' }): Promise<unknown>;
    };
  };
}

export function createOctokitQueueClient(octokit: QueueOctokit, owner: string, repo: string): GitHubQueueClient {
  return {
    async listAllIssues() {
      const collected: Array<{ number: number; state: 'open' | 'closed'; title: string; body: string | null }> = [];
      let cursor: string | null = null;
      do {
        const data = (await octokit.graphql(QUEUE_ISSUES_QUERY, { owner, repo, cursor })) as QueueIssuesResponse;
        const page = data.repository.issues;
        for (const node of page.nodes) {
          collected.push({
            number: node.number,
            state: node.state.toLowerCase() === 'closed' ? 'closed' : 'open',
            title: node.title,
            body: node.body ?? null,
          });
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor !== null);
      return collected;
    },
    async createIssue(title, body) {
      const { data } = await octokit.rest.issues.create({ owner, repo, title, body });
      return { number: data.number };
    },
    async updateIssue(issueNumber, update) {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: update.body,
        ...(update.state ? { state: update.state } : {}),
      });
    },
  };
}

/** Map a GitHub API failure to a `setFailed` outcome (401/403 → issues:write guidance). */
export function handleGitHubApiError(error: unknown, setFailed: (message: string) => void): void {
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 401 || status === 403) {
    setFailed(
      `GitHub API returned ${status}: insufficient permissions. Ensure the workflow grants 'issues: write' to the GITHUB_TOKEN.`,
    );
    return;
  }
  setFailed(error instanceof Error ? error.message : String(error));
}
