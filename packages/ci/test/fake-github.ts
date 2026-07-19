import type { GitHubClient, IssueComment, PrFile } from '../src/github.ts';

export interface FakeCommentSeed {
  id?: number;
  body: string;
  login?: string;
  type?: string;
}

export interface FakeClientOptions {
  files?: PrFile[];
  comments?: FakeCommentSeed[];
  selfLogin?: string | undefined;
  /** When set, createComment/updateComment throw a GitHub-shaped permission error. */
  rejectWrites?: boolean | number;
}

export interface FakeGitHubClient extends GitHubClient {
  readonly store: IssueComment[];
  readonly created: string[];
  readonly updated: { id: number; body: string }[];
}

const DEFAULT_SELF = 'github-actions[bot]';

class PermissionError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/**
 * An injected, in-memory GitHub client for Action tests — no network, no token.
 * `store` mirrors the PR's comments (all "pages" concatenated); `created`/`updated`
 * record the writes the Action performed.
 */
export function makeFakeClient(options: FakeClientOptions = {}): FakeGitHubClient {
  const selfLogin = 'selfLogin' in options ? options.selfLogin : DEFAULT_SELF;
  const rejectStatus =
    options.rejectWrites === true ? 403 : typeof options.rejectWrites === 'number' ? options.rejectWrites : undefined;

  let nextId = 1000;
  const store: IssueComment[] = (options.comments ?? []).map((seed, index) => ({
    id: seed.id ?? index + 1,
    body: seed.body,
    user: { login: seed.login ?? selfLogin ?? DEFAULT_SELF, type: seed.type ?? 'Bot' },
  }));
  for (const comment of store) nextId = Math.max(nextId, comment.id + 1);

  const created: string[] = [];
  const updated: { id: number; body: string }[] = [];

  return {
    store,
    created,
    updated,
    async getAuthenticatedLogin() {
      return selfLogin;
    },
    async listPullFiles() {
      return options.files ?? [];
    },
    async listIssueComments() {
      return store.map((comment) => ({ ...comment, user: comment.user ? { ...comment.user } : comment.user }));
    },
    async createComment(body: string) {
      if (rejectStatus) throw new PermissionError(rejectStatus);
      const id = nextId++;
      store.push({ id, body, user: { login: selfLogin ?? DEFAULT_SELF, type: 'Bot' } });
      created.push(body);
      return { id };
    },
    async updateComment(commentId: number, body: string) {
      if (rejectStatus) throw new PermissionError(rejectStatus);
      const target = store.find((comment) => comment.id === commentId);
      if (target) target.body = body;
      updated.push({ id: commentId, body });
    },
  };
}

export interface CapturingLogger {
  info: string[];
  notice: string[];
  warning: string[];
  setFailed: string[];
  log: {
    info(message: string): void;
    notice(message: string): void;
    warning(message: string): void;
    setFailed(message: string): void;
  };
}

export function makeLogger(): CapturingLogger {
  const info: string[] = [];
  const notice: string[] = [];
  const warning: string[] = [];
  const setFailed: string[] = [];
  return {
    info,
    notice,
    warning,
    setFailed,
    log: {
      info: (message) => info.push(message),
      notice: (message) => notice.push(message),
      warning: (message) => warning.push(message),
      setFailed: (message) => setFailed.push(message),
    },
  };
}
