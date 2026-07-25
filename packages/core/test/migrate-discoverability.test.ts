/**
 * Regression tests for adrkit#41 — `migrate --from madr` wrote records under filenames
 * corpus discovery cannot see, so migration reported success while `lint` reported
 * `checked 0 records, 0 errors` at exit 0: a silent false bill of governance health.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { discoverSkippedMarkdownFiles } from '../src/load/corpus.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-discoverability';

const SOURCE = '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n';

async function seedUndiscoverableCorpus(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  for (const name of ['a-yaml.md', 'b-bullet.md', 'c-nygard.md']) {
    await writeText(join(dir, name), SOURCE);
  }
  return root;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('discoverSkippedMarkdownFiles', () => {
  test('reports markdown that the record-filename grammar excludes', async () => {
    const root = await seedUndiscoverableCorpus();

    const skipped = await discoverSkippedMarkdownFiles(join(root, 'docs/adr'), root);

    expect(skipped.map((s) => s.path.split('/').pop())).toEqual(['a-yaml.md', 'b-bullet.md', 'c-nygard.md']);
    expect(skipped.every((s) => s.reason === 'filename')).toBe(true);
  });

  test('reports nested markdown regardless of filename, since discovery never reads it', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-top.md'), SOURCE);
    await writeText(join(root, 'docs/adr/nested/0002-deep.md'), SOURCE);
    await writeText(join(root, 'docs/adr/nested/deeper/0003-deeper.md'), SOURCE);

    const skipped = await discoverSkippedMarkdownFiles(join(root, 'docs/adr'), root);

    expect(skipped.map((s) => s.path.split('/').slice(-2).join('/'))).toEqual([
      'nested/0002-deep.md',
      'deeper/0003-deeper.md',
    ]);
    expect(skipped.every((s) => s.reason === 'nested')).toBe(true);
  });

  test('does not report records, the template, or conventional companion files', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0001-real.md'), SOURCE);
    await writeText(join(dir, '0000-template.md'), SOURCE);
    await writeText(join(dir, 'README.md'), '# Corpus readme\n');
    await writeText(join(dir, 'index.md'), '# Index\n');

    expect(await discoverSkippedMarkdownFiles(dir, root)).toEqual([]);
  });

  test('a missing directory yields no findings rather than throwing', async () => {
    const root = await resetTestDir(DIR_NAME);
    expect(await discoverSkippedMarkdownFiles(join(root, 'nope'), root)).toEqual([]);
  });
});

describe('lint visibility of skipped files (#41)', () => {
  test('"checked 0 records" is never silent', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    expect(result.checked).toBe(0);
    expect(result.findings.filter((f) => f.rule === 'corpus-file-skipped')).toHaveLength(3);
    // Warn, not error: a misnamed file is a gap to close, not a corpus that fails to parse.
    expect(result.findings.every((f) => f.severity !== 'error')).toBe(true);
  });

  test('a corpus whose only records are nested is not reported as clean', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/nested/0001-decision.md'), SOURCE);

    const result = await lintCorpus({ cwd: root, dir: 'docs/adr' });
    const skipped = result.findings.filter((f) => f.rule === 'corpus-file-skipped');

    expect(result.checked).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.message).toContain('subdirectory');
  });

  test('an explicit directory positional is scanned like a bare corpus run', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await lintCorpus({ cwd: root, dir: 'docs/adr', paths: [join(root, 'docs/adr')] });

    expect(result.checked).toBe(0);
    expect(result.findings.filter((f) => f.rule === 'corpus-file-skipped')).toHaveLength(3);
  });

  test('explicit file positionals are the caller\u2019s choice and are never reported as skipped', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await lintCorpus({ cwd: root, dir: 'docs/adr', paths: [join(root, 'docs/adr/a-yaml.md')] });

    expect(result.findings.filter((f) => f.rule === 'corpus-file-skipped')).toEqual([]);
  });

  test('a file that was explicitly checked is not also reported as skipped', async () => {
    const root = await seedUndiscoverableCorpus();
    const dir = join(root, 'docs/adr');

    const result = await lintCorpus({ cwd: root, dir: 'docs/adr', paths: [dir, join(dir, 'a-yaml.md')] });
    const skipped = result.findings.filter((f) => f.rule === 'corpus-file-skipped');

    expect(skipped.map((f) => f.path)).toEqual(['docs/adr/b-bullet.md', 'docs/adr/c-nygard.md']);
  });
});

describe('migrate discoverability reporting (#41)', () => {
  test('an in-place migration that produces an invisible record says so', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect(result.results.filter((r) => r.outcome === 'migrated')).toHaveLength(3);
    const undiscoverable = result.findings.filter((f) => f.rule === 'import-undiscoverable');
    expect(undiscoverable).toHaveLength(3);
    expect(undiscoverable[0]).toMatchObject({ severity: 'warn', field: 'path' });
  });

  test('a corpus that already uses record filenames reports nothing', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-postgres.md'), SOURCE);

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect(result.findings.filter((f) => f.rule === 'import-undiscoverable')).toEqual([]);
  });

  test('--rename writes <id>-<slug>.md and the corpus becomes visible', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });
    const files = (await readdir(join(root, 'docs/adr'))).sort();
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    expect(files).toEqual(['0001-use-postgresql.md', '0002-use-postgresql.md', '0003-use-postgresql.md']);
    expect(result.results.every((r) => r.renamedTo !== undefined)).toBe(true);
    expect(result.findings.filter((f) => f.rule === 'import-undiscoverable')).toEqual([]);
    expect(lint.checked).toBe(3);
    expect(lint.findings.filter((f) => f.rule === 'corpus-file-skipped')).toEqual([]);
  });

  test('--rename leaves an already-discoverable filename untouched', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-some-other-slug.md'), SOURCE);

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });

    expect(await readdir(join(root, 'docs/adr'))).toEqual(['0001-some-other-slug.md']);
    expect(result.results[0]?.renamedTo).toBeUndefined();
  });

  test('--dry-run with --rename does not touch the filesystem', async () => {
    const root = await seedUndiscoverableCorpus();

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true, write: false });

    expect((await readdir(join(root, 'docs/adr'))).sort()).toEqual(['a-yaml.md', 'b-bullet.md', 'c-nygard.md']);
    expect(result.results.every((r) => r.renamedTo !== undefined)).toBe(true);
  });

  test('--rename never clobbers a file already occupying the target name', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    // A source that pins its own id, so its rename target is predictable.
    await writeText(
      join(dir, 'a-source.md'),
      '---\nid: "0001"\nstatus: accepted\ndate: 2025-03-14\n---\n# Use PostgreSQL\n',
    );
    await writeText(join(dir, '0001-use-postgresql.md'), '# Pre-existing unrelated record\n');

    // Scoped to the one source, so the occupying file is not itself migrated.
    const result = await migrateMadr({
      cwd: root,
      dir: 'docs/adr',
      rename: true,
      files: [join(dir, 'a-source.md')],
    });

    expect(await readFile(join(dir, '0001-use-postgresql.md'), 'utf8')).toContain('Pre-existing unrelated record');
    expect((await readdir(dir)).sort()).toContain('a-source.md');
    expect(result.results[0]?.renamedTo).toBeUndefined();
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-undiscoverable', severity: 'warn' }),
    );
  });

  test('a record in a corpus subdirectory is reported as undiscoverable and is not renamed', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/nested/0001-deep.md'), SOURCE);

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });

    expect(await readdir(join(root, 'docs/adr/nested'))).toEqual(['0001-deep.md']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: 'import-undiscoverable',
        severity: 'warn',
        message: expect.stringContaining('subdirectory'),
      }),
    );
  });

  test('conventional corpus documentation is never migrated or moved', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    const readme = '# Architecture decision records\n\nSee [CONTRIBUTING.md](CONTRIBUTING.md).\n';
    await writeText(join(dir, 'README.md'), readme);
    await writeText(join(dir, 'CONTRIBUTING.md'), '# How to write an ADR\n');
    await writeText(join(dir, 'index.md'), '# Index\n');
    await writeText(join(dir, '0000-template.md'), '# Template\n');
    await writeText(join(dir, '0001-real.md'), SOURCE);

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });

    expect((await readdir(dir)).sort()).toEqual([
      '0000-template.md',
      '0001-real.md',
      'CONTRIBUTING.md',
      'README.md',
      'index.md',
    ]);
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe(readme);
    expect(result.results.map((r) => r.path)).toEqual(['docs/adr/0001-real.md']);
  });

  test('--rename converges: the run after a rename reports unchanged, not a rewrite', async () => {
    const root = await seedUndiscoverableCorpus();

    const first = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });
    const second = await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });

    expect(first.results.every((r) => r.outcome === 'migrated')).toBe(true);
    expect(second.results.every((r) => r.outcome === 'unchanged')).toBe(true);
  });

  test('a --rename run leaves the corpus byte-stable on re-migration', async () => {
    const root = await seedUndiscoverableCorpus();
    const dir = join(root, 'docs/adr');

    await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });
    const after = await Promise.all(
      (await readdir(dir)).sort().map(async (name) => [name, await readFile(join(dir, name), 'utf8')] as const),
    );
    await migrateMadr({ cwd: root, dir: 'docs/adr', rename: true });

    for (const [name, content] of after) {
      expect(await readFile(join(dir, name), 'utf8')).toBe(content);
    }
  });
});
