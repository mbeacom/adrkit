import { describe, expect, test } from 'bun:test';
import { runAction, type ActionDeps } from '../src/action.ts';
import { CI_COMMENT_MARKER } from '../src/comment.ts';
import { fallbackSelfLogin, findOwnComment, type GitHubClient } from '../src/github.ts';
import { makeFakeClient, makeLogger } from './fake-github.ts';

function deps(client: GitHubClient): ActionDeps {
  return {
    client,
    dir: 'docs/adr',
    loadLint: async () => ({ records: [], findings: [], checked: 0 }),
    extract: async () => ({ changedFiles: ['src/x.ts'], changedDependencies: [], truncated: false }),
    log: makeLogger().log,
  };
}

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
      selfLogin: 'github-actions[bot]',
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
    const client = makeFakeClient({ comments: [...filler, own], selfLogin: 'github-actions[bot]' });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('updated');
    expect(client.created).toHaveLength(0);
    expect(client.updated).toHaveLength(1);
    expect(client.updated[0]?.id).toBe(999);
  });
});

describe('findOwnComment (pure)', () => {
  const marker = CI_COMMENT_MARKER;

  test('matches marker AND author', () => {
    const comments = [
      { id: 1, body: `${marker} ours`, user: { login: 'github-actions[bot]', type: 'Bot' } },
      { id: 2, body: `${marker} theirs`, user: { login: 'human', type: 'User' } },
    ];
    expect(findOwnComment(comments, marker, 'github-actions[bot]')?.id).toBe(1);
  });

  test('returns undefined when only a foreign marker comment exists', () => {
    const comments = [{ id: 2, body: `${marker} theirs`, user: { login: 'human', type: 'User' } }];
    expect(findOwnComment(comments, marker, 'github-actions[bot]')).toBeUndefined();
  });

  test('without a known identity, does not adopt any comment (safe for custom tokens)', () => {
    const comments = [
      { id: 1, body: `${marker} human`, user: { login: 'human', type: 'User' } },
      { id: 2, body: `${marker} bot`, user: { login: 'x[bot]', type: 'Bot' } },
    ];
    expect(findOwnComment(comments, marker, undefined)).toBeUndefined();
  });
});

describe('fallbackSelfLogin (token identity guard)', () => {
  test('assumes github-actions[bot] only for the default token', () => {
    expect(fallbackSelfLogin(true)).toBe('github-actions[bot]');
  });

  test('yields no identity for a non-default token, so no comment is adopted', () => {
    expect(fallbackSelfLogin(false)).toBeUndefined();
  });

  test("a custom token that cannot resolve its identity does not update the default bot's comment", async () => {
    // selfLogin undefined models a custom/App token whose /user lookup failed and is
    // not the default GITHUB_TOKEN.
    const client = makeFakeClient({
      comments: [{ id: 7, body: `${CI_COMMENT_MARKER}\nby the default bot`, login: 'github-actions[bot]', type: 'Bot' }],
      selfLogin: undefined,
    });

    const result = await runAction(deps(client));

    expect(result.comment).toBe('created');
    expect(client.updated).toHaveLength(0);
    expect(client.store.find((comment) => comment.id === 7)?.body).toContain('by the default bot');
  });
});
