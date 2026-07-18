import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAdr, ScaffoldError, slugifyTitle } from '../src/scaffold/new.ts';
import { parseAdrFile } from '../src/load/corpus.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'scaffold';

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('ADR scaffold', () => {
  test('generated record parses and lints clean', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0010-existing.md'), recordMarkdown('0010'));

    const result = await createAdr({
      title: 'Adopt example decision',
      cwd: root,
      dir: 'docs/adr',
      date: '2026-07-18',
    });

    expect(result.id).toBe('0011');
    expect(result.path).toBe('docs/adr/0011-adopt-example-decision.md');
    const parsed = await parseAdrFile(join(root, result.path), root);
    expect((parsed.data as { id: string }).id).toBe('0011');
    expect(await readFile(join(root, result.path), 'utf8')).toBe(result.content);

    const lint = await lintCorpus({ cwd: root, paths: [result.path] });
    expect(lint.findings).toEqual([]);
  });

  test('slugifies title and enforces title bounds', async () => {
    expect(slugifyTitle('Use Café APIs!')).toBe('use-cafe-apis');
    await expect(createAdr({ title: 'no', write: false })).rejects.toThrow(ScaffoldError);
  });

  test('refuses statuses that cannot lint clean without extra fields', async () => {
    await expect(createAdr({ title: 'Accept impossible default', status: 'accepted', write: false })).rejects.toThrow(
      ScaffoldError,
    );
  });
});
