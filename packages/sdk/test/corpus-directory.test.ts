/**
 * `@adrkit/sdk` — which rejections `openDecisions` reports as an unreadable corpus directory.
 *
 * The rule must match the CLI's, so the SDK never calls a failure a missing directory that
 * `adr` would surface as a defect (or the reverse). The parity test runs both classifiers over
 * one matrix of codes and paths.
 *
 * ADR-0016 clause 2: observed failing. With the root-read guard removed from
 * `src/corpus-directory.ts` (so a pathless `EIO`/`ESTALE` was attributed to the directory, the
 * behaviour before this rule was mirrored), "a pathless EIO or ESTALE is rethrown, not
 * relabeled" and the CLI parity test failed; the guard was restored.
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { corpusDirectoryErrorKind } from '../../cli/src/errors.ts';
import { corpusDirectoryError } from '../src/corpus-directory.ts';

const CWD = resolve('/repo');
const DIR = 'docs/adr';

function fsError(code: string, path?: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: simulated`);
  error.code = code;
  if (path !== undefined) error.path = path;
  return error;
}

describe('corpusDirectoryError', () => {
  test('a pathless EIO or ESTALE is rethrown, not relabeled', () => {
    expect(corpusDirectoryError(fsError('EIO'), DIR, CWD)).toBeUndefined();
    expect(corpusDirectoryError(fsError('ESTALE'), DIR, CWD)).toBeUndefined();
  });

  test('EIO or ESTALE naming the corpus directory is "not readable"', () => {
    for (const path of [DIR, resolve(CWD, DIR)]) {
      expect(corpusDirectoryError(fsError('EIO', path), DIR, CWD)?.message).toStartWith(
        'Corpus directory not readable: "docs/adr"',
      );
    }
    expect(corpusDirectoryError(fsError('ESTALE', DIR), DIR, CWD)?.message).toContain('not readable');
  });

  test('an error naming some other path is rethrown', () => {
    expect(corpusDirectoryError(fsError('EIO', 'docs/adr/0001-x.md'), DIR, CWD)).toBeUndefined();
    expect(corpusDirectoryError(fsError('ENOENT', 'elsewhere'), DIR, CWD)).toBeUndefined();
  });

  test('a pathless not-found or not-readable code still names the directory', () => {
    expect(corpusDirectoryError(fsError('ENOENT'), DIR, CWD)?.message).toContain('not found');
    expect(corpusDirectoryError(fsError('EACCES'), DIR, CWD)?.message).toContain('not readable');
  });

  test('keeps the original error as its cause', () => {
    const original = fsError('ENOTDIR', DIR);
    expect(corpusDirectoryError(original, DIR, CWD)?.cause).toBe(original);
  });

  test('anything else is rethrown', () => {
    expect(corpusDirectoryError(fsError('EMFILE', DIR), DIR, CWD)).toBeUndefined();
    expect(corpusDirectoryError(new Error('boom'), DIR, CWD)).toBeUndefined();
    expect(corpusDirectoryError('ENOENT', DIR, CWD)).toBeUndefined();
    expect(corpusDirectoryError(null, DIR, CWD)).toBeUndefined();
  });

  test('classifies exactly as the CLI does', () => {
    const codes = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG', 'EIO', 'ESTALE', 'EMFILE', 'EBUSY'];
    const paths = [undefined, DIR, `./${DIR}`, resolve(CWD, DIR), 'docs/adr/0001-x.md', '/elsewhere'];
    for (const code of codes) {
      for (const path of paths) {
        const error = fsError(code, path);
        const cli = corpusDirectoryErrorKind(error, DIR, CWD);
        const sdk = corpusDirectoryError(error, DIR, CWD);
        const expected = cli === undefined ? undefined : cli === 'not-found' ? 'not found' : 'not readable';
        const actual = sdk === undefined ? undefined : sdk.message.includes('not found') ? 'not found' : 'not readable';
        expect({ code, path, kind: actual }).toEqual({ code, path, kind: expected });
      }
    }
  });
});
