import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { FrontmatterError, parseFrontmatter } from '../parse/frontmatter.ts';
import { normalizeDisplayPath } from '../load/corpus.ts';

export interface MadrSourceFile {
  kind: 'madr';
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  source: string;
  title?: string;
}

export interface NotMadrFile {
  kind: 'not-madr';
  path: string;
  absolutePath: string;
  reason: string;
}

export type ReadMadrFileResult = MadrSourceFile | NotMadrFile;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstLine(source: string): string {
  const lineEnd = source.indexOf('\n');
  const line = lineEnd === -1 ? source : source.slice(0, lineEnd);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function extractMadrTitle(frontmatter: Record<string, unknown>, body: string): string | undefined {
  const frontmatterTitle = frontmatter.title;
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim().length > 0) {
    return frontmatterTitle.trim();
  }

  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  const title = heading?.[1]?.trim();
  return title && title.length > 0 ? title : undefined;
}

function notMadr(path: string, absolutePath: string, reason: string): NotMadrFile {
  return { kind: 'not-madr', path, absolutePath, reason };
}

export async function readMadrFile(path: string, cwd = process.cwd()): Promise<ReadMadrFileResult> {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
  const displayPath = normalizeDisplayPath(absolutePath, cwd);
  const source = await readFile(absolutePath, 'utf8');
  const hasLeadingFence = firstLine(source) === '---';

  if (hasLeadingFence) {
    try {
      const parsed = parseFrontmatter(source);
      const frontmatter = isPlainRecord(parsed.data) ? parsed.data : {};
      return {
        kind: 'madr',
        path: displayPath,
        absolutePath,
        frontmatter,
        body: parsed.body,
        source,
        title: extractMadrTitle(frontmatter, parsed.body),
      };
    } catch (error) {
      const reason = error instanceof FrontmatterError ? error.message : String(error);
      return notMadr(displayPath, absolutePath, reason);
    }
  }

  const title = extractMadrTitle({}, source);
  if (!title) {
    return notMadr(displayPath, absolutePath, 'File has no leading YAML frontmatter or top-level title');
  }

  return {
    kind: 'madr',
    path: displayPath,
    absolutePath,
    frontmatter: {},
    body: source,
    source,
    title,
  };
}

async function discoverMarkdownFilesInDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverMarkdownFilesInDir(path)));
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '0000-template.md') {
      files.push(path);
    }
  }
  return files;
}

export async function discoverMadrCandidateFiles(dir = 'docs/adr', cwd = process.cwd()): Promise<string[]> {
  const absoluteDir = isAbsolute(dir) ? dir : resolve(cwd, dir);
  const files = await discoverMarkdownFilesInDir(absoluteDir).catch(() => []);
  return files.sort((a, b) => normalizeDisplayPath(a, cwd).localeCompare(normalizeDisplayPath(b, cwd)));
}

export function sourceRefForPath(path: string, cwd = process.cwd()): string {
  return normalizeDisplayPath(path, cwd);
}

export function fileNameId(path: string): string | undefined {
  return /^([0-9]{4,})-/.exec(basename(path))?.[1];
}
