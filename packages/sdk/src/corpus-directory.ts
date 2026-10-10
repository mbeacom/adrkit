/**
 * `@adrkit/sdk` — which `lintCorpus` rejections mean "the corpus directory cannot be read".
 *
 * Internal: `openDecisions` uses it, and the unit tests import it directly. It is not exported
 * from the package entry point.
 *
 * The rule mirrors `corpusDirectoryErrorKind` in `packages/cli/src/errors.ts` exactly — the
 * classification `adr queue`, `adr lint`, `adr graph`, and `adr explain` turn into exit 2 — so
 * the SDK and the CLI agree on which failures are a missing or unreadable directory. Anything
 * else is rethrown untouched, so a defect is never relabeled as a missing directory.
 */

import { isAbsolute, resolve } from 'node:path';

const CORPUS_DIRECTORY_NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);
const CORPUS_DIRECTORY_NOT_READABLE_CODES = new Set(['EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']);
/**
 * Codes that name the directory only when the error carries a `path` equal to it. A pathless
 * `EIO` or `ESTALE` could come from any read in the pass, so — as in the CLI — it is not
 * attributed to the directory and is rethrown.
 */
const CORPUS_DIRECTORY_ROOT_READ_CODES = new Set(['EIO', 'ESTALE']);

/**
 * The `Error` `openDecisions` rejects with when `error` means the corpus directory itself
 * could not be read, or `undefined` when `error` should be rethrown as it is.
 */
export function corpusDirectoryError(error: unknown, dir: string, cwd: string): Error | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = 'code' in error ? String(error.code) : undefined;
  if (
    code === undefined ||
    (!CORPUS_DIRECTORY_NOT_FOUND_CODES.has(code) &&
      !CORPUS_DIRECTORY_NOT_READABLE_CODES.has(code) &&
      !CORPUS_DIRECTORY_ROOT_READ_CODES.has(code))
  ) {
    return undefined;
  }
  const path = 'path' in error ? error.path : undefined;
  const resolveFromCwd = (value: string): string => (isAbsolute(value) ? value : resolve(cwd, value));
  if (CORPUS_DIRECTORY_ROOT_READ_CODES.has(code) && typeof path !== 'string') return undefined;
  if (typeof path === 'string' && resolveFromCwd(path) !== resolveFromCwd(dir)) return undefined;
  const state = CORPUS_DIRECTORY_NOT_FOUND_CODES.has(code) ? 'not found' : 'not readable';
  return new Error(`Corpus directory ${state}: "${dir}" (resolved against "${cwd}").`, { cause: error });
}
