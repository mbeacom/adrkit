import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { lintCorpus, readSourceMarkersBatch } from '@adrkit/core';
import { acceptedRecordMarkdown, cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
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
    readMarkers: (paths) => readSourceMarkersBatch(paths, root),
    extract: async () => ({
      changedFiles,
      markerFiles: changedFiles,
      changedDependencies: [],
      truncated: false,
    }),
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
      withPathMatcher(acceptedRecordMarkdown('0001', 'Guard core'), 'packages/core/**'),
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
      withPathMatcher(acceptedRecordMarkdown('0001', 'Guard core'), 'packages/core/**'),
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

  test('never evaluates a truncated changed-file list; posts a notice and does not fail', async () => {
    const client = makeFakeClient();
    const logger = makeLogger();

    const result = await runAction({
      client,
      dir: 'docs/adr',
      // If the truncation guard works, the corpus is never loaded/evaluated.
      loadLint: async () => {
        throw new Error('lint must not run on a truncated diff');
      },
      readMarkers: async () => {
        throw new Error('markers must not be read on a truncated diff');
      },
      extract: async () => ({
        changedFiles: ['a.ts'],
        markerFiles: ['a.ts'],
        changedDependencies: [],
        truncated: true,
      }),
      log: logger.log,
    });

    expect(result.truncated).toBe(true);
    expect(result.outcome).toBeNull();
    expect(result.failed).toBe(false);
    expect(client.created).toHaveLength(1);
    expect(client.created[0]).toContain('more files than the GitHub API can list');
    expect(logger.warning.join('\n')).toContain('exceeded the provider cap');
  });

  test('renders marker-only governance distinctly and logs the aggregate scan states', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-core.md'),
      acceptedRecordMarkdown('0001', 'Guard marker-owned code'),
    );
    await writeText(join(root, 'src/owned.ts'), '// @adr 0001\nexport const owned = true;\n');
    const client = makeFakeClient();
    const logger = makeLogger();
    const actionDeps = deps(client, root, ['src/owned.ts', 'src/deleted.ts']);
    actionDeps.log = logger.log;

    const result = await runAction(actionDeps);

    expect(result.failed).toBe(false);
    expect(client.created[0]).toContain('**0001** — Guard marker-owned code');
    expect(client.created[0]).toContain('declared by `src/owned.ts:1` (`@adr 0001`)');
    expect(logger.info.join('\n')).toContain(
      'marker scan: 1 scanned, 1 absent, 0 unreadable, 0 out-of-tree, 0 skipped',
    );
  });

  test('scans only the current side of a rename while matching affects against both paths', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-core.md'),
      withPathMatcher(acceptedRecordMarkdown('0001', 'Guard the former path'), 'src/old.ts'),
    );
    const client = makeFakeClient();
    const scanned: string[][] = [];

    const result = await runAction({
      client,
      dir: 'docs/adr',
      loadLint: (dir) => lintCorpus({ cwd: root, dir }),
      readMarkers: async (paths) => {
        scanned.push([...paths]);
        return { scans: [], skippedPaths: [], limit: 3000, totalCandidates: paths.length };
      },
      extract: async () => ({
        changedFiles: ['src/new.ts', 'src/old.ts'],
        markerFiles: ['src/new.ts'],
        changedDependencies: [],
        truncated: false,
      }),
      log: makeLogger().log,
    });

    expect(scanned).toEqual([['src/new.ts']]);
    expect(result.outcome?.governing.map((decision) => decision.recordId)).toEqual(['0001']);
  });

  test('keeps dangling markers non-failing and out of the focused PR comment', async () => {
    const root = await resetTestDir(DIR_NAME);
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    await writeText(join(root, 'src/dangling.ts'), '// @adr 9999\n');
    const client = makeFakeClient();

    const result = await runAction(deps(client, root, ['src/dangling.ts']));

    expect(result.failed).toBe(false);
    expect(result.outcome?.ok).toBe(true);
    expect(result.outcome?.findings.map((finding) => finding.rule)).toContain('dangling-marker');
    expect(client.created[0]).not.toContain('dangling-marker');
  });

  test('warns with the exact skipped paths when the marker scan cap is reached', async () => {
    const root = await resetTestDir(DIR_NAME);
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    const client = makeFakeClient();
    const logger = makeLogger();

    const result = await runAction({
      client,
      dir: 'docs/adr',
      loadLint: (dir) => lintCorpus({ cwd: root, dir }),
      readMarkers: async () => ({
        scans: [],
        skippedPaths: ['src/z.ts', 'src/zz.ts'],
        limit: 1000,
        totalCandidates: 1002,
      }),
      extract: async () => ({
        changedFiles: ['src/z.ts', 'src/zz.ts'],
        markerFiles: ['src/z.ts', 'src/zz.ts'],
        changedDependencies: [],
        truncated: false,
      }),
      log: logger.log,
    });

    expect(result.failed).toBe(false);
    expect(logger.warning.join('\n')).toContain('skipped: src/z.ts, src/zz.ts');
    expect(result.outcome?.findings.map((finding) => finding.rule)).toContain('marker-scan-capped');
  });
});
