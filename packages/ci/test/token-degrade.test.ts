import { describe, expect, test } from 'bun:test';
import { runAction, type ActionDeps, type Logger } from '../src/action.ts';
import type { CheckLintResult } from '@adrkit/core';
import type { ExtractedChanges } from '../src/changed-files.ts';
import { makeFakeClient, makeLogger } from './fake-github.ts';

const cleanLint: CheckLintResult = { records: [], findings: [], checked: 0 };

function baseDeps(overrides: Partial<ActionDeps> & { log: Logger }): ActionDeps {
  return {
    client: overrides.client ?? makeFakeClient(),
    dir: 'docs/adr',
    loadLint: overrides.loadLint ?? (async () => cleanLint),
    extract: overrides.extract ?? (async (): Promise<ExtractedChanges> => ({ changedFiles: ['src/x.ts'], changedDependencies: [], truncated: false })),
    log: overrides.log,
  };
}

describe('read-only token degradation', () => {
  test('a comment-permission error does not fail the job; the check still runs (SC-006)', async () => {
    const client = makeFakeClient({ rejectWrites: 403 });
    const logger = makeLogger();

    const result = await runAction(baseDeps({ client, log: logger.log }));

    expect(result.failed).toBe(false);
    expect(result.comment).toBe('skipped');
    expect(logger.setFailed).toHaveLength(0);
    // the result is surfaced to the job log instead of the PR
    expect(logger.notice.join('\n')).toContain('read-only token');
  });

  test('a 404 (fork PR) is treated as a degrade, not a job failure', async () => {
    const client = makeFakeClient({ rejectWrites: 404 });
    const logger = makeLogger();

    const result = await runAction(baseDeps({ client, log: logger.log }));

    expect(result.failed).toBe(false);
    expect(logger.setFailed).toHaveLength(0);
  });

  test('validation still fails the job even when commenting is skipped', async () => {
    const client = makeFakeClient({ rejectWrites: 403 });
    const logger = makeLogger();
    const brokenLint: CheckLintResult = {
      records: [],
      findings: [{ rule: 'frontmatter-parse', severity: 'error', message: 'boom', path: 'docs/adr/0003-broken.md' }],
      checked: 1,
    };

    const result = await runAction(
      baseDeps({
        client,
        log: logger.log,
        loadLint: async () => brokenLint,
        extract: async () => ({ changedFiles: ['docs/adr/0003-broken.md'], changedDependencies: [], truncated: false }),
      }),
    );

    expect(result.comment).toBe('skipped'); // could not comment
    expect(result.failed).toBe(true); // but validation failure still fails the job
    expect(logger.setFailed).toHaveLength(1);
  });

  test('an unexpected (non-permission) error is not swallowed', async () => {
    const client = makeFakeClient();
    client.createComment = async () => {
      throw new Error('network exploded');
    };
    const logger = makeLogger();

    await expect(runAction(baseDeps({ client, log: logger.log }))).rejects.toThrow('network exploded');
  });
});
