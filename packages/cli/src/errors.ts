import { isAbsolute, resolve } from 'node:path';
import type { StreamStyle } from './presentation.ts';
import { styleUsageBlock } from './presentation.ts';

export type CorpusDirectoryErrorKind = 'not-found' | 'not-readable';

const CORPUS_DIRECTORY_NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);
const CORPUS_DIRECTORY_NOT_READABLE_CODES = new Set(['EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']);
const CORPUS_DIRECTORY_ROOT_READ_CODES = new Set(['EIO', 'ESTALE']);

export function formatUsageError(message: string, usage: string, command?: string, style?: StreamStyle): string {
  const error = style?.red ? style.red('Error:') : 'Error:';
  if (!command) return `${error} ${message}\n\n${style ? styleUsageBlock(usage, style) : usage}`;

  const usageLine = usage.split('\n', 1)[0] ?? `Usage: adr ${command} [options]`;
  const styledUsageLine = style?.heading ? style.heading(usageLine) : usageLine;
  const helpLine = style?.note
    ? style.note(`Run 'adr help ${command}' for more information.`)
    : `Run 'adr help ${command}' for more information.`;
  return `${error} ${message}\n\n${styledUsageLine}\n${helpLine}\n`;
}

export function corpusDirectoryErrorMessage(dir: string, kind: CorpusDirectoryErrorKind): string {
  const state = kind === 'not-readable' ? 'not readable' : 'not found';
  return `Corpus directory ${state}: "${dir}".`;
}

export function corpusDirectoryErrorKind(
  error: unknown,
  dir: string,
  cwd = process.cwd(),
): CorpusDirectoryErrorKind | undefined {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  if (
    code === undefined ||
    (!CORPUS_DIRECTORY_NOT_FOUND_CODES.has(code) &&
      !CORPUS_DIRECTORY_NOT_READABLE_CODES.has(code) &&
      !CORPUS_DIRECTORY_ROOT_READ_CODES.has(code))
  ) {
    return undefined;
  }

  const path = typeof error === 'object' && error !== null && 'path' in error ? error.path : undefined;
  const resolveFromCwd = (value: string): string => (isAbsolute(value) ? value : resolve(cwd, value));
  if (CORPUS_DIRECTORY_ROOT_READ_CODES.has(code) && typeof path !== 'string') return undefined;
  if (typeof path === 'string' && resolveFromCwd(path) !== resolveFromCwd(dir)) return undefined;
  return CORPUS_DIRECTORY_NOT_FOUND_CODES.has(code) ? 'not-found' : 'not-readable';
}
