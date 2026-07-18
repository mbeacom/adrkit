import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-inplace';

function madr(frontmatter: string, body: string): string {
  return `---\n${frontmatter.trim()}\n---\n${body}`;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('MADR in-place migration', () => {
  test('adds adrkit frontmatter while preserving body bytes and later fences', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    const body = '# Use the existing platform decision\n\nContext stays byte-for-byte.\n\n---\n\nThat fence is prose, not frontmatter.\n';
    const source = madr('title: Use the existing platform decision\nstatus: accepted\ndate: 2026-07-18', body);
    await writeText(join(dir, '0001-existing-platform.md'), source);
    await writeText(join(dir, 'notes.md'), 'This is just a note without a title.\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const migrated = await readFile(join(dir, '0001-existing-platform.md'), 'utf8');
    const parsed = parseFrontmatter(migrated);
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    expect(parsed.body).toBe(body);
    expect(parsed.body).toContain('\n---\n\nThat fence is prose');
    expect(parsed.data).toMatchObject({
      schemaVersion: '0.1.0',
      id: '0001',
      title: 'Use the existing platform decision',
      status: 'accepted',
      provenance: {
        importedFrom: {
          sourceKind: 'madr',
          sourceRef: 'docs/adr/0001-existing-platform.md',
        },
      },
    });
    expect(result.results).toEqual([
      expect.objectContaining({ outcome: 'migrated', path: 'docs/adr/0001-existing-platform.md' }),
      { outcome: 'skipped', path: 'docs/adr/notes.md' },
    ]);
    expect(result.findings.some((finding) => finding.rule === 'import-not-madr' && finding.path === 'docs/adr/notes.md')).toBe(true);
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
