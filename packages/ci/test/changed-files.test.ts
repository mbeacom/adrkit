import { describe, expect, test } from 'bun:test';
import { extractChanges, LIST_FILES_CAP } from '../src/changed-files.ts';
import type { PrFile } from '../src/github.ts';
import { makeFakeClient } from './fake-github.ts';

function clientWithFiles(files: PrFile[]) {
  return makeFakeClient({ files });
}

describe('extractChanges', () => {
  test('returns a deduplicated, sorted changed-file list', async () => {
    const client = clientWithFiles([
      { filename: 'src/b.ts' },
      { filename: 'src/a.ts' },
      { filename: 'src/b.ts' },
    ]);

    const changes = await extractChanges(client);

    expect(changes.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(changes.truncated).toBe(false);
    expect(changes.changedDependencies).toEqual([]);
  });

  test('surfaces both the old and new path of a rename', async () => {
    const client = clientWithFiles([{ filename: 'src/new.ts', previousFilename: 'src/old.ts', status: 'renamed' }]);

    const changes = await extractChanges(client);

    expect(changes.changedFiles).toEqual(['src/new.ts', 'src/old.ts']);
  });

  test('derives changed dependencies from the bun.lock patch', async () => {
    const patch = [
      '@@ -10,6 +10,7 @@',
      '     "picomatch": ["picomatch@4.0.2", "", {}, "sha512-aaa"],',
      '+    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-bbb"],',
    ].join('\n');
    const client = clientWithFiles([
      { filename: 'src/a.ts' },
      { filename: 'bun.lock', patch },
    ]);

    const changes = await extractChanges(client);

    expect(changes.changedDependencies).toEqual([{ name: 'left-pad', version: '1.3.0' }]);
  });

  test('finds a nested bun.lock too', async () => {
    const patch = '+    "yaml": ["yaml@2.5.1", "", {}, "sha512-ccc"],';
    const client = clientWithFiles([{ filename: 'some/dir/bun.lock', patch }]);

    const changes = await extractChanges(client);

    expect(changes.changedDependencies).toEqual([{ name: 'yaml', version: '2.5.1' }]);
  });

  test('aggregates dependencies across multiple changed lockfiles', async () => {
    const client = clientWithFiles([
      { filename: 'bun.lock', patch: '+    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-a"],' },
      { filename: 'sub/bun.lock', patch: '+    "yaml": ["yaml@2.5.1", "", {}, "sha512-b"],' },
    ]);

    const changes = await extractChanges(client);

    expect(changes.changedDependencies).toEqual([
      { name: 'left-pad', version: '1.3.0' },
      { name: 'yaml', version: '2.5.1' },
    ]);
  });

  test('a changed lockfile with an omitted patch yields no snapshot (inert), not empty', async () => {
    // The API omits `patch` for large files; treating that as "nothing changed" would
    // silently miss real dependency changes, so package matchers must go inert.
    const client = clientWithFiles([{ filename: 'bun.lock' }, { filename: 'src/a.ts' }]);

    const changes = await extractChanges(client);

    expect(changes.changedDependencies).toBeUndefined();
  });

  test('no changed lockfile yields an empty (resolvable) snapshot', async () => {
    const client = clientWithFiles([{ filename: 'src/a.ts' }, { filename: 'src/b.ts' }]);

    const changes = await extractChanges(client);

    expect(changes.changedDependencies).toEqual([]);
  });

  test('flags truncation when the file listing hits the provider cap', async () => {
    const files: PrFile[] = Array.from({ length: LIST_FILES_CAP }, (_, index) => ({ filename: `src/file-${index}.ts` }));
    const client = clientWithFiles(files);

    const changes = await extractChanges(client);

    expect(changes.truncated).toBe(true);
  });
});
