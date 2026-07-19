import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, resetTestDir } from './helpers.ts';

const DIR_NAME = 'migrate-real-corpus';
const FIXTURE_DIR = resolve(process.cwd(), 'packages/core/test/fixtures/madr-corpus');

// Real MADR records vendored from github.com/adr/madr @ 835fc94 (MIT OR CC0-1.0);
// see PROVENANCE.md in the fixture dir. Non-record docs (e.g. PROVENANCE.md) are
// excluded the same way the corpus loader ignores non `NNNN-*.md` files.
const RECORD_FILE = /^\d{4,}-.+\.md$/;

async function recordFileNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => RECORD_FILE.test(name)).sort();
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('real MADR corpus fixture migration', () => {
  test('migrates the real vendored adr/madr corpus with body preservation and clean lint', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    const fixtureRecords = await recordFileNames(FIXTURE_DIR);
    for (const name of fixtureRecords) {
      await cp(join(FIXTURE_DIR, name), join(dir, name));
    }

    // The vendored subset is real third-party prose, not a fixture authored to pass.
    expect(fixtureRecords).toHaveLength(5);

    const originalBodies = new Map<string, string>();
    for (const file of fixtureRecords) {
      originalBodies.set(file, parseFrontmatter(await readFile(join(dir, file), 'utf8')).body);
    }

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    // Every real record migrates.
    expect(result.results).toHaveLength(fixtureRecords.length);
    expect(result.results.every((item) => item.outcome === 'migrated')).toBe(true);

    // Body bytes are preserved on the real prose.
    for (const [file, body] of originalBodies) {
      expect(parseFrontmatter(await readFile(join(dir, file), 'utf8')).body).toBe(body);
    }

    // The migrated corpus lints with zero error-severity findings.
    expect(lint.records).toHaveLength(fixtureRecords.length);
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);

    // Idempotent: a second migrate is a byte-for-byte no-op.
    const migratedBytes = new Map<string, string>();
    for (const file of fixtureRecords) {
      migratedBytes.set(file, await readFile(join(dir, file), 'utf8'));
    }
    const second = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    expect(second.results.every((item) => item.outcome === 'unchanged')).toBe(true);
    for (const [file, bytes] of migratedBytes) {
      expect(await readFile(join(dir, file), 'utf8')).toBe(bytes);
    }
  });
});
