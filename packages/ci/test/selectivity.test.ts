import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkChanges, lintCorpus } from '@adrkit/core';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { renderComment } from '../src/comment.ts';

const DIR_NAME = 'ci-selectivity';
const RECORD_COUNT = 12;

function withPathMatcher(markdown: string, pattern: string): string {
  return markdown.replace('affects: []', ['affects:', '  - type: path', `    pattern: "${pattern}"`].join('\n'));
}

async function seedLargeCorpus(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  for (let index = 1; index <= RECORD_COUNT; index += 1) {
    const id = String(index).padStart(4, '0');
    const slug = `pkg-${String(index).padStart(2, '0')}`;
    await writeText(
      join(dir, `${id}-${slug}.md`),
      withPathMatcher(recordMarkdown(id, `Guard ${slug}`), `packages/${slug}/**`),
    );
  }
  return root;
}

async function outcomeFor(root: string, changedFiles: string[]) {
  const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
  return checkChanges({ lint, changedFiles, dir: 'docs/adr' });
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('selectivity on a large corpus', () => {
  test('a subset diff lists only the governing subset, never the whole corpus (SC-003)', async () => {
    const root = await seedLargeCorpus();
    const outcome = await outcomeFor(root, ['packages/pkg-03/src/a.ts', 'packages/pkg-07/src/b.ts']);
    const body = renderComment(outcome);

    expect(outcome.governedBy.map((decision) => decision.recordId)).toEqual(['0003', '0007']);
    expect(body).toContain('**0003** — Guard pkg-03');
    expect(body).toContain('**0007** — Guard pkg-07');

    // None of the other ten records appear — the comment is not a corpus dump.
    for (const index of [1, 2, 4, 5, 6, 8, 9, 10, 11, 12]) {
      const id = String(index).padStart(4, '0');
      expect(body).not.toContain(`**${id}**`);
    }
  });

  test('a diff nothing governs yields the concise empty note, not a corpus dump (SC-005)', async () => {
    const root = await seedLargeCorpus();
    const outcome = await outcomeFor(root, ['README.md', 'unrelated/file.ts']);
    const body = renderComment(outcome);

    expect(outcome.governedBy).toEqual([]);
    expect(body).toContain('No governing decisions for the changed files.');
    // No record ids at all.
    expect(body).not.toMatch(/\*\*\d{4}\*\*/);
  });
});
