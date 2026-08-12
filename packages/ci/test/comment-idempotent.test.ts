import { describe, expect, test } from 'bun:test';
import { runAction, type ActionDeps } from '../src/action.ts';
import { CI_COMMENT_MARKER } from '../src/comment.ts';
import {
  findOwnComment,
  identityFromLookupFailure,
  type GitHubClient,
  type SelfIdentity,
} from '../src/github.ts';
import { makeFakeClient, makeLogger, type CapturingLogger } from './fake-github.ts';

function deps(client: GitHubClient, logger: CapturingLogger = makeLogger()): ActionDeps {
  return {
    client,
    dir: 'docs/adr',
    loadLint: async () => ({ records: [], findings: [], checked: 0 }),
    readMarkers: async (paths) => ({
      scans: [],
      skippedPaths: [],
      limit: 1000,
      totalCandidates: paths.length,
    }),
    extract: async () => ({
      changedFiles: ['src/x.ts'],
      markerFiles: ['src/x.ts'],
      changedDependencies: [],
      truncated: false,
    }),
    log: logger.log,
  };
}

const APP: SelfIdentity = { kind: 'app-installation' };
const UNKNOWN: SelfIdentity = { kind: 'unknown' };
const AS_BOT: SelfIdentity = { kind: 'login', login: 'github-actions[bot]' };

describe('governing-decisions comment idempotency', () => {
  test('first run creates the marker comment; a second run edits the same one', async () => {
    const client = makeFakeClient();

    const first = await runAction(deps(client));
    expect(first.comment).toBe('created');
    expect(client.created).toHaveLength(1);
    expect(client.updated).toHaveLength(0);
    expect(client.store).toHaveLength(1);

    const second = await runAction(deps(client));
    expect(second.comment).toBe('updated');
    expect(client.created).toHaveLength(1); // no new comment
    expect(client.updated).toHaveLength(1);
    expect(client.store).toHaveLength(1); // still exactly one comment
  });

  test('a foreign comment bearing the marker (different author) is not edited (RC5)', async () => {
    const client = makeFakeClient({
      comments: [{ id: 5, body: `${CI_COMMENT_MARKER}\nquoted by a human`, login: 'a-human', type: 'User' }],
      identity: AS_BOT,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('created');
    expect(client.updated).toHaveLength(0);
    expect(client.created).toHaveLength(1);
    // the foreign comment is untouched
    expect(client.store.find((comment) => comment.id === 5)?.body).toContain('quoted by a human');
  });

  test("the Action's own marker comment on a later page is found and edited, not duplicated (RC5)", async () => {
    const filler = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      body: `unrelated comment ${index}`,
      login: 'someone-else',
      type: 'User',
    }));
    const own = { id: 999, body: `${CI_COMMENT_MARKER}\nold body`, login: 'github-actions[bot]', type: 'Bot' };
    const client = makeFakeClient({ comments: [...filler, own], identity: AS_BOT });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('updated');
    expect(client.created).toHaveLength(0);
    expect(client.updated).toHaveLength(1);
    expect(client.updated[0]?.id).toBe(999);
  });
});

/**
 * Issue #107: in the documented workflow the token is an app installation token, so
 * `users.getAuthenticated` is refused and the exact login is unknowable. Before
 * ADR-0026 that produced a fresh comment on every push.
 */
describe('an app installation token (the default GITHUB_TOKEN) — issue #107', () => {
  test('updates its own prior comment instead of posting another', async () => {
    const client = makeFakeClient({
      comments: [{ id: 7, body: `${CI_COMMENT_MARKER}\nprevious run`, login: 'github-actions[bot]', type: 'Bot' }],
      identity: APP,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('updated');
    expect(client.created).toHaveLength(0);
    expect(client.updated[0]?.id).toBe(7);
    expect(client.store).toHaveLength(1);
  });

  test('stays at exactly one comment across repeated pushes', async () => {
    const client = makeFakeClient({ identity: APP });

    await runAction(deps(client));
    await runAction(deps(client));
    await runAction(deps(client));

    expect(client.created).toHaveLength(1);
    expect(client.updated).toHaveLength(2);
    expect(client.store).toHaveLength(1);
  });

  test('adopts a prior comment posted under a different bot login (token switched)', async () => {
    const client = makeFakeClient({
      comments: [{ id: 3, body: `${CI_COMMENT_MARKER}\nby the default bot`, login: 'github-actions[bot]', type: 'Bot' }],
      identity: APP,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('updated');
    expect(client.updated[0]?.id).toBe(3);
  });

  test("still never edits a human's comment that quotes the marker (RC5 preserved)", async () => {
    const client = makeFakeClient({
      comments: [{ id: 4, body: `${CI_COMMENT_MARKER}\nquoted by a human`, login: 'a-human', type: 'User' }],
      identity: APP,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('created');
    expect(client.updated).toHaveLength(0);
    expect(client.store.find((comment) => comment.id === 4)?.body).toContain('quoted by a human');
  });

  test('does not adopt a bot comment that merely quotes the marker below its own prose', async () => {
    const client = makeFakeClient({
      comments: [
        { id: 8, body: `Reposting for visibility:\n\n> ${CI_COMMENT_MARKER}\n> stale`, login: 'other[bot]', type: 'Bot' },
      ],
      identity: APP,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('created');
    expect(client.updated).toHaveLength(0);
    expect(client.store.find((comment) => comment.id === 8)?.body).toContain('Reposting for visibility');
  });
});

describe('an unresolvable identity', () => {
  test('adopts nothing and says so in the job log, rather than failing silently', async () => {
    const logger = makeLogger();
    const client = makeFakeClient({
      comments: [{ id: 7, body: `${CI_COMMENT_MARKER}\nby the default bot`, login: 'github-actions[bot]', type: 'Bot' }],
      identity: UNKNOWN,
    });

    const result = await runAction(deps(client, logger));

    expect(result.comment).toBe('created');
    expect(client.updated).toHaveLength(0);
    expect(client.store.find((comment) => comment.id === 7)?.body).toContain('by the default bot');
    expect(logger.warning.join('\n')).toContain('could not resolve the token identity');
  });
});

describe('findOwnComment (pure)', () => {
  const marker = CI_COMMENT_MARKER;

  test('matches marker AND author for a resolved login', () => {
    const comments = [
      { id: 1, body: `${marker} ours`, user: { login: 'github-actions[bot]', type: 'Bot' } },
      { id: 2, body: `${marker} theirs`, user: { login: 'human', type: 'User' } },
    ];
    expect(findOwnComment(comments, marker, AS_BOT)?.id).toBe(1);
  });

  test('returns undefined when only a foreign marker comment exists', () => {
    const comments = [{ id: 2, body: `${marker} theirs`, user: { login: 'human', type: 'User' } }];
    expect(findOwnComment(comments, marker, AS_BOT)).toBeUndefined();
  });

  test('an unknown identity adopts nothing, however the marker appears', () => {
    const comments = [
      { id: 1, body: `${marker} human`, user: { login: 'human', type: 'User' } },
      { id: 2, body: `${marker} bot`, user: { login: 'x[bot]', type: 'Bot' } },
    ];
    expect(findOwnComment(comments, marker, UNKNOWN)).toBeUndefined();
  });

  test('an app installation matches a leading marker on a bot comment', () => {
    const comments = [
      { id: 1, body: `${marker}\nours`, user: { login: 'anything[bot]', type: 'Bot' } },
    ];
    expect(findOwnComment(comments, marker, APP)?.id).toBe(1);
  });

  test('an app installation does not match a human, even with a leading marker', () => {
    const comments = [{ id: 1, body: `${marker}\ncopied`, user: { login: 'human', type: 'User' } }];
    expect(findOwnComment(comments, marker, APP)).toBeUndefined();
  });

  test('an app installation does not match a bot comment whose marker is not the first line', () => {
    const comments = [{ id: 1, body: `see below\n\n${marker}`, user: { login: 'x[bot]', type: 'Bot' } }];
    expect(findOwnComment(comments, marker, APP)).toBeUndefined();
  });

  test.each([
    ['LF', `${marker}\nbody`],
    ['CRLF', `${marker}\r\nbody`],
    ['CR', `${marker}\rbody`],
    ['marker only', marker],
  ])('an app installation matches a %s body', (_label, body) => {
    expect(findOwnComment([{ id: 1, body, user: { login: 'x[bot]', type: 'Bot' } }], marker, APP)?.id).toBe(1);
  });

  test('the first line must be the marker exactly, not merely start with it', () => {
    const comments = [
      { id: 1, body: `${marker} and then some\nbody`, user: { login: 'x[bot]', type: 'Bot' } },
      { id: 2, body: ` ${marker}\nbody`, user: { login: 'x[bot]', type: 'Bot' } },
    ];
    expect(findOwnComment(comments, marker, APP)).toBeUndefined();
  });

  // A PR opened before this fix carries one comment per push; the newest is the one a
  // reader reaches at the bottom of the thread, so it is the one kept current.
  test('the last match wins, not the first, for an app installation', () => {
    const comments = [1, 2, 3].map((id) => ({
      id,
      body: `${marker}\npush ${id}`,
      user: { login: 'github-actions[bot]', type: 'Bot' },
    }));
    expect(findOwnComment(comments, marker, APP)?.id).toBe(3);
  });

  test('the last match wins for a resolved login too', () => {
    const comments = [1, 2].map((id) => ({
      id,
      body: `${marker}\npush ${id}`,
      user: { login: 'github-actions[bot]', type: 'Bot' },
    }));
    expect(findOwnComment(comments, marker, AS_BOT)?.id).toBe(2);
  });
});

describe('identityFromLookupFailure (token identity guard)', () => {
  test.each([401, 403, 404])('a %i from /user means an app installation token', (status) => {
    expect(identityFromLookupFailure({ status })).toEqual({ kind: 'app-installation' });
  });

  test('any other failure proves nothing, so the identity stays unknown', () => {
    expect(identityFromLookupFailure(new Error('network exploded'))).toEqual({ kind: 'unknown' });
    expect(identityFromLookupFailure({ status: 500 })).toEqual({ kind: 'unknown' });
  });

  // Throttling also arrives as 403, but it says nothing about who we are — reading it
  // as "we are an app" would claim a comment on evidence we never obtained.
  test('a throttled request is not read as app evidence', () => {
    expect(identityFromLookupFailure({ status: 429 })).toEqual({ kind: 'unknown' });
    expect(
      identityFromLookupFailure({ status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } }),
    ).toEqual({ kind: 'unknown' });
    expect(
      identityFromLookupFailure({ status: 403, message: 'You have exceeded a secondary rate limit' }),
    ).toEqual({ kind: 'unknown' });
  });

  test('a genuine integration refusal with quota left is still app evidence', () => {
    expect(
      identityFromLookupFailure({
        status: 403,
        message: 'Resource not accessible by integration',
        response: { headers: { 'x-ratelimit-remaining': '4999' } },
      }),
    ).toEqual({ kind: 'app-installation' });
  });
});
