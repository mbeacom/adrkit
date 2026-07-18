import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, resetTestDir } from './helpers.ts';

const DIR_NAME = 'migrate-real-corpus';
const FIXTURE_DIR = resolve(process.cwd(), 'packages/core/test/fixtures/madr-corpus');

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('MADR corpus fixture migration', () => {
  test('migrates the synthetic real-world-shaped corpus with body preservation and clean lint', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await cp(FIXTURE_DIR, dir, { recursive: true });

    const originalBodies = new Map<string, string>();
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()) {
      originalBodies.set(file, parseFrontmatter(await readFile(join(dir, file), 'utf8')).body);
    }

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    expect(result.results.every((item) => item.outcome === 'migrated')).toBe(true);
    for (const [file, body] of originalBodies) {
      expect(parseFrontmatter(await readFile(join(dir, file), 'utf8')).body).toBe(body);
    }
    expect(lint.records).toHaveLength(5);
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
