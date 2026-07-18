import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AdrFrontmatter, type Adr } from '../schema/adr.schema.ts';
import { parseFrontmatter } from '../parse/frontmatter.ts';

export const RECORD_FILE_PATTERN = /^[0-9]{4,}-.+\.md$/;
export const TEMPLATE_FILE_NAME = '0000-template.md';

export interface ParsedAdrFile {
  data: unknown;
  body: string;
  path: string;
  absolutePath: string;
}

export interface Corpus {
  records: Adr[];
  byId: Map<string, Adr>;
}

export function isRecordFileName(fileName: string): boolean {
  return fileName !== TEMPLATE_FILE_NAME && RECORD_FILE_PATTERN.test(fileName);
}

export function normalizeDisplayPath(path: string, cwd = process.cwd()): string {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
  const displayPath = relative(cwd, absolutePath) || basename(absolutePath);
  return displayPath.split(sep).join('/');
}

function toAbsolutePath(path: string, cwd = process.cwd()): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export async function discoverAdrFiles(dir = 'docs/adr', cwd = process.cwd()): Promise<string[]> {
  const absoluteDir = toAbsolutePath(dir, cwd);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isRecordFileName(entry.name))
    .map((entry) => join(absoluteDir, entry.name))
    .sort((a, b) => normalizeDisplayPath(a, cwd).localeCompare(normalizeDisplayPath(b, cwd)));
}

export async function expandRecordInputs(
  paths: string[] | undefined,
  dir = 'docs/adr',
  cwd = process.cwd(),
): Promise<string[]> {
  if (!paths || paths.length === 0) {
    return discoverAdrFiles(dir, cwd);
  }

  const expanded: string[] = [];
  for (const inputPath of paths) {
    const absolutePath = toAbsolutePath(inputPath, cwd);
    try {
      const inputStat = await stat(absolutePath);
      if (inputStat.isDirectory()) {
        expanded.push(...(await discoverAdrFiles(absolutePath, cwd)));
      } else if (inputStat.isFile()) {
        expanded.push(absolutePath);
      }
    } catch {
      expanded.push(absolutePath);
    }
  }

  return Array.from(new Set(expanded)).sort((a, b) =>
    normalizeDisplayPath(a, cwd).localeCompare(normalizeDisplayPath(b, cwd)),
  );
}

export async function parseAdrFile(path: string, cwd = process.cwd()): Promise<ParsedAdrFile> {
  const absolutePath = toAbsolutePath(path, cwd);
  const source = await readFile(absolutePath, 'utf8');
  const parsed = parseFrontmatter(source);
  return {
    ...parsed,
    absolutePath,
    path: normalizeDisplayPath(absolutePath, cwd),
  };
}

export async function loadAdrFile(path: string, cwd = process.cwd()): Promise<Adr> {
  const parsed = await parseAdrFile(path, cwd);
  return {
    frontmatter: AdrFrontmatter.parse(parsed.data),
    body: parsed.body,
    path: parsed.path,
  };
}

export async function loadCorpus(dir = 'docs/adr', cwd = process.cwd()): Promise<Corpus> {
  const files = await discoverAdrFiles(dir, cwd);
  const records = await Promise.all(files.map((file) => loadAdrFile(file, cwd)));
  const byId = new Map<string, Adr>();
  for (const record of records) {
    byId.set(record.frontmatter.id, record);
  }
  return { records, byId };
}
