import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';

/**
 * @adrkit/ci — the GitHub port for the governing-decisions comment, plus the pure
 * identity and own-comment logic layered over it.
 *
 * This module classifies GitHub failures three different ways on purpose, because the
 * same status means different things depending on what the answer is used for:
 *
 * - {@link isPermissionError} (401/403/404) — "we cannot comment at all". Broad by
 *   design: a fork token is denied with a 404 as readily as a 403, and either way the
 *   Action degrades to a log notice rather than failing the job (FR-014).
 * - {@link isNotFound} (404 only) — "that specific comment is gone". Used where the
 *   broad reading would be wrong, namely a comment we listed moments earlier.
 * - {@link identityFromLookupFailure} — "who are we?". Narrowest, because its answer
 *   decides how much author evidence a comment needs before we edit it (ADR-0026).
 *
 * Keep them distinct. Collapsing any two re-creates a defect this module has already
 * shipped: reusing the broad reading for identity is what
 * [#107](https://github.com/mbeacom/adrkit/issues/107) turned on.
 */

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
 * Who this Action posts as, to whatever precision the token allows (R5/FR-005,
 * [ADR-0026](../../../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)).
 *
 * - `login` — `users.getAuthenticated` answered, so the exact author is known.
 * - `app-installation` — the call was refused the way an app installation token is
 *   always refused, so the exact author is unknowable but is necessarily a **bot**.
 * - `unknown` — the call failed for some other reason; assume nothing.
 */
export type SelfIdentity =
  | { readonly kind: 'login'; readonly login: string }
  | { readonly kind: 'app-installation' }
  | { readonly kind: 'unknown' };

/** Log port for identity resolution; structurally satisfied by the Action's logger. */
export interface IdentityLogger {
  info(message: string): void;
  warning(message: string): void;
}

/**
 * Thin, injectable GitHub port. The real implementation wraps `@actions/github`;
 * tests inject a fake. Confining all GitHub API access behind this port keeps the
 * toolkit out of `@adrkit/core` and out of the pure logic below (R3/FR-013), and
 * lets the whole Action run offline in CI with no token.
 */
export interface GitHubClient {
  /** The identity comments are posted under, for own-comment matching (R5). */
  getSelfIdentity(): Promise<SelfIdentity>;
  /** The PR's complete changed-file list — fully paginated (R4/FR-003). */
  listPullFiles(): Promise<PrFile[]>;
  /** All PR comments — fully paginated so a later-page comment is not missed (R5). */
  listIssueComments(): Promise<IssueComment[]>;
  createComment(body: string): Promise<{ id: number }>;
  updateComment(commentId: number, body: string): Promise<void>;
}

/**
 * Whether the marker is exactly the body's first line, rather than merely appearing
 * somewhere in it.
 *
 * Both renderers in `comment.ts` emit the marker as the body's first line, and have
 * in every revision of that file, so this holds for every comment the Action has ever
 * posted. It does not hold for the case R5 exists to exclude — a human quoting the
 * comment, where the marker arrives behind a `>` or below their own prose.
 *
 * This is the same ownership test `queue-issue.ts` already applies to the managed
 * queue issue, including its handling of LF, CRLF, and CR bodies; keeping the two
 * identical means one rule to reason about across both Actions.
 */
function markerLeadsBody(body: string, marker: string): boolean {
  return body.split(/\r\n|\n|\r/, 1)[0] === marker;
}

/**
 * Locate this Action's own prior comment by the marker AND the strongest author
 * evidence the token affords (R5/FR-005, ADR-0026), across the full (already
 * paginated) comment list. Pure — no network.
 *
 * With a resolved `login`, identity is exact and the marker may sit anywhere. An
 * `app-installation` token cannot learn its own login at all, so it substitutes two
 * weaker signals that together still exclude what R5 names: the author must be a
 * **bot** (never a human quoting the marker) and the marker must be exactly the body's
 * **first line** (never a quote of the comment). Absent both, nothing is adopted.
 *
 * The **last** match wins, not the first. A pull request opened before this fix
 * carries one comment per push, and the newest is both the one a reader reaches at
 * the bottom of the thread and the one worth keeping current.
 */
export function findOwnComment(
  comments: readonly IssueComment[],
  marker: string,
  identity: SelfIdentity,
): IssueComment | undefined {
  if (identity.kind === 'unknown') return undefined;
  let own: IssueComment | undefined;
  for (const comment of comments) {
    if (typeof comment.body !== 'string') continue;
    const matches =
      identity.kind === 'login'
        ? comment.body.includes(marker) && comment.user?.login === identity.login
        : comment.user?.type === 'Bot' && markerLeadsBody(comment.body, marker);
    if (matches) own = comment;
  }
  return own;
}

/**
 * Whether a failure is GitHub throttling us rather than refusing us.
 *
 * This matters because a throttled request also surfaces as 403, and reading that as
 * "we are an app" would let a rate-limited run claim a comment on the weaker evidence
 * when it has learned nothing about who it is.
 */
function isRateLimited(error: unknown): boolean {
  const failure = error as
    | { status?: number; message?: string; response?: { headers?: Record<string, unknown> } }
    | undefined;
  if (failure?.status === 429) return true;
  const remaining = failure?.response?.headers?.['x-ratelimit-remaining'];
  if (remaining !== undefined && String(remaining) === '0') return true;
  return typeof failure?.message === 'string' && /rate limit/i.test(failure.message);
}

/** How GitHub words its refusal of an endpoint an installation token may not call. */
const INTEGRATION_REFUSAL = /not accessible by integration/i;

/**
 * Classify a failed `users.getAuthenticated` call into the identity we may assume.
 *
 * A GitHub App installation token — which the default `GITHUB_TOKEN` is one of — is
 * refused this endpoint with **403 "Resource not accessible by integration"**. That
 * refusal is the evidence that the caller is an app, and therefore a bot.
 *
 * Deliberately narrower than {@link isPermissionError}, which folds in 401 and 404
 * because at the top of the Action either means "we cannot comment". Here the answer
 * decides how much author evidence a comment needs, so breadth is not free: 401 is
 * invalid or expired credentials and 404 is not a documented response of this
 * endpoint, and reading either as "we are an app" would hand the weaker
 * bot-plus-marker rule to a credential that is not an app at all.
 *
 * The message is the definitive signal and the status is the fallback, in that order.
 * Keying solely on the message would make a fix for
 * [#107](https://github.com/mbeacom/adrkit/issues/107) hostage to an English string
 * GitHub may reword; keying solely on the status would miss a refusal delivered with
 * a status this does not anticipate. Throttling, a network error, and a 5xx prove
 * nothing about identity, so they yield `unknown` and no comment is adopted.
 */
export function identityFromLookupFailure(error: unknown): SelfIdentity {
  const failure = error as { status?: number; message?: string } | undefined;
  // The message is checked before throttling on purpose. GitHub sends
  // `x-ratelimit-remaining` on every response, so a genuine integration refusal that
  // happens to land when the installation's quota is exhausted would otherwise be read
  // as "throttled" and cost that run a duplicate comment. Being throttled does not make
  // us not an app; the refusal names what we are, and a rate-limit header does not.
  if (typeof failure?.message === 'string' && INTEGRATION_REFUSAL.test(failure.message)) {
    return { kind: 'app-installation' };
  }
  // A bare 403 is ambiguous — it covers both an app refusal and throttling — so it is
  // only app evidence once throttling is ruled out.
  if (isRateLimited(error)) return { kind: 'unknown' };
  return failure?.status === 403 ? { kind: 'app-installation' } : { kind: 'unknown' };
}

/** A one-line, log-safe description of the resolved identity. */
export function describeIdentity(identity: SelfIdentity): string {
  switch (identity.kind) {
    case 'login':
      return `authenticated as ${identity.login}`;
    case 'app-installation':
      return 'an app installation token, whose login is not resolvable; matching on the marker and a bot author';
    case 'unknown':
      return 'unresolvable';
  }
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
  log?: IdentityLogger,
): Promise<UpsertOutcome> {
  const [comments, identity] = await Promise.all([
    client.listIssueComments(),
    client.getSelfIdentity(),
  ]);
  // An unresolvable identity means a duplicate comment on every run, which used to be
  // indistinguishable from normal operation in the job log (issue #107).
  if (identity.kind === 'unknown') {
    log?.warning(
      'adrkit: could not resolve the token identity, so an existing governing-decisions ' +
        'comment cannot be claimed; posting a new one instead.',
    );
  } else {
    log?.info(`adrkit: ${describeIdentity(identity)}.`);
  }
  const own = findOwnComment(comments, marker, identity);
  if (own) {
    try {
      await client.updateComment(own.id, body);
      return 'updated';
    } catch (error) {
      // The comment was listed a moment ago; a 404 now means it was deleted in
      // between, not that we may not comment. Before #107 the update path was
      // effectively unreachable, so this race only becomes live with that fix —
      // and letting it fall through to the caller's permission handling would drop
      // the result of one push entirely. Any other failure is not ours to reinterpret.
      if (!isNotFound(error)) throw error;
      // Warning, not info: a comment vanishing under us is unusual, and if something
      // deletes it on a loop the recreate would otherwise be invisible without
      // expanding the step log — the same "looks exactly like healthy operation"
      // failure that let #107 survive two releases.
      log?.warning(
        'adrkit: the prior governing-decisions comment was deleted between listing and ' +
          'updating it; posting a new one instead.',
      );
    }
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
    async getSelfIdentity() {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();
        return { kind: 'login', login: data.login };
      } catch (error) {
        // An installation token — which the default GITHUB_TOKEN is — cannot call
        // users.getAuthenticated and is refused with a permission status. That
        // refusal is the only reliable signal available that the caller is an app
        // (issue #107 / ADR-0026), so classify it rather than giving up.
        return identityFromLookupFailure(error);
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

/**
 * Whether a thrown error is specifically "gone", as distinct from "not allowed".
 *
 * `isPermissionError` folds 404 in with 403 because GitHub hides a forbidden resource
 * behind a 404 for fork tokens. That conflation is right at the top of the Action,
 * where either answer means "we cannot comment"; it is wrong for a comment we listed
 * seconds ago, where 404 means someone deleted it and creating a replacement is
 * exactly the correct response.
 */
export function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 404;
}

export { core, context };
