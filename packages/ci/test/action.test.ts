import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { lintCorpus } from '@adrkit/core';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { runAction, type ActionDeps } from '../src/action.ts';
import { CI_COMMENT_MARKER } from '../src/comment.ts';
import type { GitHubClient } from '../src/github.ts';
import { makeFakeClient, makeLogger } from './fake-github.ts';

const DIR_NAME = 'ci-action';

function withPathMatcher(markdown: string, pattern: string): string {
  return markdown.replace('affects: []', ['affects:', '  - type: path', `    pattern: "${pattern}"`].join('\n'));
}

function deps(client: GitHubClient, root: string, changedFiles: string[]): ActionDeps {
  return {
    client,
    dir: 'docs/adr',
    loadLint: (dir) => lintCorpus({ cwd: root, dir }),
    extract: async () => ({ changedFiles, changedDependencies: [], truncated: false }),
    log: makeLogger().log,
  };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('runAction (end to end with a fake client)', () => {
  test('posts a governing-decisions comment and does not fail a clean PR', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-core.md'),
      withPathMatcher(recordMarkdown('0001', 'Guard core'), 'packages/core/**'),
    );
    const client = makeFakeClient();

    const result = await runAction(deps(client, root, ['packages/core/src/index.ts']));

    expect(result.failed).toBe(false);
    expect(result.comment).toBe('created');
    expect(client.created).toHaveLength(1);
    expect(client.created[0]).toContain(CI_COMMENT_MARKER);
    expect(client.created[0]).toContain('**0001** — Guard core');
  });

  test('fails the job and surfaces the failing record when a changed record has an error', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-core.md'),
      withPathMatcher(recordMarkdown('0001', 'Guard core'), 'packages/core/**'),
    );
    // A malformed changed record: unterminated frontmatter fence → parse error.
    await writeText(join(root, 'docs/adr/0002-broken.md'), '---\nid: "0002"\ntitle: Broken\n');
    const client = makeFakeClient();

    const result = await runAction(deps(client, root, ['docs/adr/0002-broken.md']));

    expect(result.failed).toBe(true);
    expect(result.comment).toBe('created');
    expect(client.created[0]).toContain('Validation errors on changed records');
    expect(client.created[0]).toContain('0002-broken.md');
  });
});
