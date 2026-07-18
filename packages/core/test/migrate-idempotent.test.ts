import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-idempotent';

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('MADR migration idempotency', () => {
  test('a second run leaves the file byte-identical', async () => {
    const root = await resetTestDir(DIR_NAME);
    const path = join(root, 'docs/adr/0001-idempotent.md');
    await writeText(
      path,
      '---\ntitle: Keep migration idempotent\nstatus: proposed\ndate: 2026-07-18\n---\n# Keep migration idempotent\n\nBody.\n',
    );

    const first = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const afterFirst = await readFile(path, 'utf8');
    const second = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const afterSecond = await readFile(path, 'utf8');

    expect(first.results).toEqual([expect.objectContaining({ outcome: 'migrated' })]);
    expect(second.results).toEqual([{ outcome: 'unchanged', path: 'docs/adr/0001-idempotent.md' }]);
    expect(afterSecond).toBe(afterFirst);
  });
});
