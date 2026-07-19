import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';

/** A PR comment as this surface needs it — minimal, provider-shaped. */
export interface CommentUser {
  login?: string;
  type?: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user?: CommentUser | null;
}

/** A PR file entry — new path, optional prior path (renames), and unified-diff patch. */
export interface PrFile {
  filename: string;
  previousFilename?: string;
  status?: string;
  patch?: string;
}

/**
 * Thin, injectable GitHub port. The real implementation wraps `@actions/github`;
 * tests inject a fake. Confining all GitHub API access behind this port keeps the
 * toolkit out of `@adrkit/core` and out of the pure logic below (R3/FR-013), and
 * lets the whole Action run offline in CI with no token.
 */
export interface GitHubClient {
  /** The author identity comments are posted under (for own-comment matching, R5). */
  getAuthenticatedLogin(): Promise<string | undefined>;
  /** The PR's complete changed-file list — fully paginated (R4/FR-003). */
  listPullFiles(): Promise<PrFile[]>;
  /** All PR comments — fully paginated so a later-page comment is not missed (R5). */
  listIssueComments(): Promise<IssueComment[]>;
  createComment(body: string): Promise<{ id: number }>;
  updateComment(commentId: number, body: string): Promise<void>;
}

/**
 * Locate this Action's own prior comment by BOTH the marker AND author identity
 * (R5/FR-005), across the full (already-paginated) comment list. A foreign comment
 * bearing the marker (different author) is never adopted; the Action's own comment
 * on a later page is still found. Pure — no network.
 */
export function findOwnComment(
  comments: readonly IssueComment[],
  marker: string,
  selfLogin: string | undefined,
): IssueComment | undefined {
  const marked = comments.filter((comment) => typeof comment.body === 'string' && comment.body.includes(marker));
  if (marked.length === 0) return undefined;

  if (selfLogin) {
    return marked.find((comment) => comment.user?.login === selfLogin);
  }
  // Without a known identity, only adopt a bot-authored marker comment rather than
  // risk editing a human's comment that quoted the marker.
  return marked.find((comment) => comment.user?.type === 'Bot');
}

export type UpsertOutcome = 'created' | 'updated';

/**
 * Create the marker comment, or update the Action's own prior one in place. Uses
 * {@link findOwnComment} for identity. Stateless — comment identity is the marker
 * + author, never stored (ADR-0004).
 */
export async function upsertMarkedComment(
  client: GitHubClient,
  marker: string,
  body: string,
): Promise<UpsertOutcome> {
  const [comments, selfLogin] = await Promise.all([
    client.listIssueComments(),
    client.getAuthenticatedLogin(),
  ]);
  const own = findOwnComment(comments, marker, selfLogin);
  if (own) {
    await client.updateComment(own.id, body);
    return 'updated';
  }
  await client.createComment(body);
  return 'created';
}

/**
 * Real GitHub client backed by `@actions/github`. All `@actions/*` usage is
 * confined to this factory (and the entrypoint) — the pure logic above never
 * imports the toolkit.
 */
export function createOctokitClient(token: string): GitHubClient {
  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const pullNumber = context.issue.number;

  return {
    async getAuthenticatedLogin() {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();
        return data.login;
      } catch {
        // The default GITHUB_TOKEN cannot call users.getAuthenticated; it posts as
        // github-actions[bot], which is the identity to match against.
        return 'github-actions[bot]';
      }
    },
    async listPullFiles() {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });
      return files.map((file) => ({
        filename: file.filename,
        previousFilename: file.previous_filename ?? undefined,
        status: file.status,
        patch: file.patch ?? undefined,
      }));
    },
    async listIssueComments() {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
      });
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? '',
        user: comment.user ? { login: comment.user.login, type: comment.user.type } : null,
      }));
    },
    async createComment(body) {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body,
      });
      return { id: data.id };
    },
    async updateComment(commentId, body) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
    },
  };
}

/** Whether a thrown error is a GitHub permission/authorization failure (fork PRs). */
export function isPermissionError(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  return status === 403 || status === 401 || status === 404;
}

export { core, context };
