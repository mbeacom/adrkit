import { describe, expect, test } from 'bun:test';
import {
  createOctokitQueueClient,
  handleGitHubApiError,
  QUEUE_ISSUES_QUERY,
  type QueueOctokit,
} from '../src/queue-github-client.ts';

interface GraphNode {
  number: number;
  state: 'OPEN' | 'CLOSED';
  title: string;
  body: string | null;
}

function pagedOctokit(nodes: GraphNode[], pageSize: number): { octokit: QueueOctokit; graphqlCalls: number } {
  let graphqlCalls = 0;
  const octokit: QueueOctokit = {
    async graphql(_query, vars) {
      graphqlCalls += 1;
      const cursor = (vars.cursor as string | null) ?? null;
      const start = cursor === null ? 0 : Number(cursor);
      const slice = nodes.slice(start, start + pageSize);
      const end = start + slice.length;
      return {
        repository: {
          issues: {
            nodes: slice,
            pageInfo: { hasNextPage: end < nodes.length, endCursor: String(end) },
          },
        },
      };
    },
    rest: {
      issues: {
        async create() {
          throw new Error('create must not be called during listing');
        },
        async update() {
          throw new Error('update must not be called during listing');
        },
      },
    },
  };
  return {
    octokit,
    get graphqlCalls() {
      return graphqlCalls;
    },
  } as { octokit: QueueOctokit; graphqlCalls: number };
}

describe('createOctokitQueueClient — listAllIssues pagination', () => {
  test('(a) exhausts every cursor page in page order', async () => {
    const nodes: GraphNode[] = Array.from({ length: 120 }, (_, i) => ({
      number: i + 1,
      state: i % 2 === 0 ? 'OPEN' : 'CLOSED',
      title: `t${i + 1}`,
      body: `b${i + 1}`,
    }));
    const { octokit } = pagedOctokit(nodes, 40);
    const client = createOctokitQueueClient(octokit, 'o', 'r');
    const all = await client.listAllIssues();
    expect(all).toHaveLength(120);
    expect(all.map((i) => i.number)).toEqual(nodes.map((n) => n.number));
  });

  test('(c) GraphQL OPEN/CLOSED map to open/closed', async () => {
    const nodes: GraphNode[] = [
      { number: 1, state: 'OPEN', title: 'a', body: null },
      { number: 2, state: 'CLOSED', title: 'b', body: 'x' },
    ];
    const { octokit } = pagedOctokit(nodes, 100);
    const client = createOctokitQueueClient(octokit, 'o', 'r');
    const all = await client.listAllIssues();
    expect(all.map((i) => i.state)).toEqual(['open', 'closed']);
    expect(all[0]!.body).toBeNull();
  });
});

describe('QUEUE_ISSUES_QUERY', () => {
  test('(b) requests only issue nodes with number/state/title/body over OPEN+CLOSED', () => {
    expect(QUEUE_ISSUES_QUERY).toContain('issues');
    expect(QUEUE_ISSUES_QUERY).toContain('OPEN');
    expect(QUEUE_ISSUES_QUERY).toContain('CLOSED');
    for (const field of ['number', 'state', 'title', 'body', 'hasNextPage', 'endCursor']) {
      expect(QUEUE_ISSUES_QUERY).toContain(field);
    }
    // Never the REST list endpoint or the Search API.
    expect(QUEUE_ISSUES_QUERY).not.toContain('listForRepo');
    expect(QUEUE_ISSUES_QUERY.toLowerCase()).not.toContain('search');
  });
});

describe('handleGitHubApiError', () => {
  test('(d) 401 and 403 map to the issues:write guidance and call setFailed once', () => {
    for (const status of [401, 403]) {
      const messages: string[] = [];
      handleGitHubApiError(Object.assign(new Error('nope'), { status }), (m) => messages.push(m));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe(
        `GitHub API returned ${status}: insufficient permissions. Ensure the workflow grants 'issues: write' to the GITHUB_TOKEN.`,
      );
    }
  });

  test('other failures become an explicit generic failure', () => {
    const messages: string[] = [];
    handleGitHubApiError(Object.assign(new Error('boom'), { status: 500 }), (m) => messages.push(m));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('boom');
  });
});
