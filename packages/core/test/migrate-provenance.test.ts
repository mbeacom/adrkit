import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-provenance';

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('MADR migration provenance', () => {
  test('writes importedFrom with a stable fingerprint and reports accepted gaps as info', async () => {
    const root = await resetTestDir(DIR_NAME);
    const path = join(root, 'docs/adr/0001-imported.md');
    await writeText(
      path,
      '---\ntitle: Import an accepted decision\nstatus: accepted\ndate: 2026-07-18\n---\n# Import an accepted decision\n\nBody.\n',
    );

    const first = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const afterFirst = parseFrontmatter(await readFile(path, 'utf8')).data as {
      provenance: { importedFrom: { sourceKind: string; sourceRef: string; fingerprint: string; importedAt?: string } };
    };
    const second = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const afterSecond = parseFrontmatter(await readFile(path, 'utf8')).data as typeof afterFirst;
    const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });

    expect(afterFirst.provenance.importedFrom).toMatchObject({
      sourceKind: 'madr',
      sourceRef: 'docs/adr/0001-imported.md',
    });
    expect(afterFirst.provenance.importedFrom.importedAt).toBeUndefined();
    expect(afterFirst.provenance.importedFrom.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(afterSecond.provenance.importedFrom.fingerprint).toBe(afterFirst.provenance.importedFrom.fingerprint);
    expect(second.results).toEqual([{ outcome: 'unchanged', path: 'docs/adr/0001-imported.md' }]);
    expect(first.findings.filter((finding) => finding.rule === 'import-incomplete')).toHaveLength(1);
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(lint.findings.filter((finding) => finding.rule === 'import-incomplete')).toEqual([
      expect.objectContaining({ severity: 'info', field: 'deciders' }),
    ]);
  });
});
