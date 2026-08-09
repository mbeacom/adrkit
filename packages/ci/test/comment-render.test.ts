import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkChanges, lintCorpus } from '@adrkit/core';
import { acceptedRecordMarkdown, cleanupTestDir, recordMarkdown, resetTestDir, supersededRecordMarkdown, writeText } from '../../core/test/helpers.ts';
import { CI_COMMENT_MARKER, renderComment } from '../src/comment.ts';

const DIR_NAME = 'ci-comment-render';

function withAffects(markdown: string, matcherLines: string[]): string {
  return markdown.replace('affects: []', ['affects:', ...matcherLines].join('\n'));
}

const path = (pattern: string): string[] => [`  - type: path`, `    pattern: "${pattern}"`];
const entity = (pattern: string): string[] => [`  - type: entity`, `    pattern: "${pattern}"`];

async function seed(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0001-api.md'),
    withAffects(acceptedRecordMarkdown('0001', 'Guard the API package'), [...path('packages/api/**'), ...entity('component:default/api')]),
  );
  await writeText(join(dir, '0002-web.md'), withAffects(acceptedRecordMarkdown('0002', 'Guard the web package'), path('packages/web/**')));
  return root;
}

async function outcomeFor(root: string, changedFiles: string[]) {
  const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
  return checkChanges({ lint, changedFiles, dir: 'docs/adr' });
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('renderComment', () => {
  test('renders the governing entry shape and carries the marker', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
    const body = renderComment(outcome);

    expect(body.startsWith(CI_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('**0001** — Guard the API package');
    expect(body).toContain('via `path`: `packages/api/**`');
    // Selective: the unrelated web record is not listed.
    expect(body).not.toContain('0002');
  });

  test('lists the union of multiple governing records', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/a.ts', 'packages/web/src/b.ts']);
    const body = renderComment(outcome);

    expect(body).toContain('**0001** — Guard the API package');
    expect(body).toContain('**0002** — Guard the web package');
  });

  test('inert matchers are absent from the governing list but present as info findings (FR-009)', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
    const body = renderComment(outcome);

    // The entity matcher fired nothing, so it is not in the governing list...
    expect(body).not.toContain('component:default/api');
    expect(body).not.toContain('entity');
    // ...but the resolver surfaced it as an info finding in the outcome.
    const inert = outcome.findings.find((finding) => finding.rule === 'affects-unresolvable' && finding.pattern === 'component:default/api');
    expect(inert?.severity).toBe('info');
  });

  test('renders a concise empty state when nothing governs the change', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['README.md']);
    const body = renderComment(outcome);

    expect(body).toContain('No governing decisions for the changed files.');
    expect(body).not.toContain('**0001**');
    expect(body).not.toContain('**0002**');
  });

  test('keeps marker reference warnings out of the focused PR comment', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['docs/adr/0001-api.md']);
    outcome.findings.push({
      rule: 'dangling-marker',
      severity: 'warn',
      message: 'Source marker does not resolve',
      path: 'docs/adr/0001-api.md',
      field: 'marker',
      pattern: '9999',
    });

    const body = renderComment(outcome);

    expect(body).not.toContain('dangling-marker');
    expect(body).not.toContain('Source marker does not resolve');
  });
});

/**
 * adrkit#39 — a reviewer must never be told that a rejected, superseded, or deprecated
 * decision governs their change.
 */
describe('renderComment status awareness (#39)', () => {
  async function seedMixed(): Promise<string> {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-accepted.md'),
      withAffects(acceptedRecordMarkdown('0001', 'Accepted record'), path('src/api/**')),
    );
    await writeText(join(dir, '0002-draft.md'), withAffects(recordMarkdown('0002', 'Draft record'), path('src/api/**')));
    await writeText(
      join(dir, '0003-superseded.md'),
      withAffects(supersededRecordMarkdown('0003', '0001', 'Superseded record'), path('src/api/**')),
    );
    return root;
  }

  test('only accepted records appear under the governing heading', async () => {
    const root = await seedMixed();
    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    const governingSection = body.slice(
      body.indexOf('### Decisions governing this change'),
      body.indexOf('#### Active proposals'),
    );
    expect(governingSection).toContain('**0001** — Accepted record');
    expect(governingSection).not.toContain('0002');
    expect(governingSection).not.toContain('0003');
  });

  test('proposals and history are labelled with their status under their own headings', async () => {
    const root = await seedMixed();
    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    expect(body).toContain('#### Active proposals touching this change');
    expect(body).toContain('**0002** — Draft record _(draft)_');
    expect(body).toContain('#### Historical records that once covered this change');
    expect(body).toContain('**0003** — Superseded record _(superseded)_ — superseded by **0001**');
  });

  test('a change matched only by non-accepted records says no accepted decision governs it', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-draft.md'),
      withAffects(recordMarkdown('0001', 'Draft record'), path('src/api/**')),
    );

    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    expect(body).toContain('No **accepted** decisions govern the changed files.');
    expect(body).toContain('#### Active proposals touching this change');
  });
});
