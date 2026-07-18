import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-status';

const statuses = ['draft', 'proposed', 'accepted', 'rejected', 'superseded', 'deprecated'] as const;

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('MADR status mapping', () => {
  test('recognized statuses are preserved', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    let index = 1;
    for (const status of statuses) {
      const id = String(index).padStart(4, '0');
      const extra = status === 'superseded' ? 'supersededBy: "0007"\n' : '';
      await writeText(
        join(dir, `${id}-${status}.md`),
        `---\ntitle: Preserve ${status} status\nstatus: ${status}\ndate: 2026-07-18\n${extra}---\n# Preserve ${status} status\n`,
      );
      index += 1;
    }

    await migrateMadr({ cwd: root, dir: 'docs/adr' });

    index = 1;
    for (const status of statuses) {
      const id = String(index).padStart(4, '0');
      const parsed = parseFrontmatter(await readFile(join(dir, `${id}-${status}.md`), 'utf8'));
      expect((parsed.data as { status: string }).status).toBe(status);
      index += 1;
    }
  });

  test('unrecognized status becomes proposed with a finding', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-unknown.md'),
      '---\ntitle: Coerce unknown status\nstatus: done\ndate: 2026-07-18\n---\n# Coerce unknown status\n',
    );

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const parsed = parseFrontmatter(await readFile(join(root, 'docs/adr/0001-unknown.md'), 'utf8'));

    expect((parsed.data as { status: string }).status).toBe('proposed');
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-status-unrecognized', severity: 'warn', field: 'status' }),
    );
  });
});
