import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AdrFrontmatter, type Adr } from '../schema/adr.schema.ts';
import { compareCodeUnits } from '../ordering/index.ts';
import { parseFrontmatter } from '../parse/frontmatter.ts';

export const RECORD_FILE_PATTERN = /^[0-9]{4,}-.+\.md$/;
export const TEMPLATE_FILE_NAME = '0000-template.md';

/**
 * Conventional non-record markdown that legitimately lives alongside a corpus. These
 * are not reported as skipped records, so the `corpus-file-skipped` warning stays
 * signal rather than noise — and migration never rewrites or moves them.
 */
const NON_RECORD_FILE_NAMES = new Set(['readme.md', 'index.md', 'contributing.md', 'template.md']);

/** Whether a markdown filename is conventional corpus documentation rather than a record. */
export function isConventionalNonRecordFileName(fileName: string): boolean {
  return fileName === TEMPLATE_FILE_NAME || NON_RECORD_FILE_NAMES.has(fileName.toLowerCase());
}

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

/**
 * Compare two paths by their normalized display form, by code unit.
 *
 * Every corpus ordering goes through here rather than repeating the compound
 * `compareCodeUnits(normalizeDisplayPath(…), normalizeDisplayPath(…))` per call site,
 * so a future sort cannot quietly normalize one side and not the other, and so the
 * locale-independence of the whole family is settled in one place (#115).
 */
export function compareByDisplayPath(a: string, b: string, cwd = process.cwd()): number {
  return compareCodeUnits(normalizeDisplayPath(a, cwd), normalizeDisplayPath(b, cwd));
}

/**
 * Discovery order is a determinism contract, not display polish: it survives into
 * `lintCorpus`'s `records` whenever two records share an id (the `frontmatter.id`
 * tiebreak is then a no-op over a stable sort), and `checkChanges` reads whichever
 * duplicate landed later as that id's canonical record. Ordering by `compareCodeUnits`
 * rather than the runtime's ICU locale is what keeps `governing` / `activeProposals` /
 * `governedBy` identical for byte-identical corpus files (#115).
 */
export async function discoverAdrFiles(dir = 'docs/adr', cwd = process.cwd()): Promise<string[]> {
  const absoluteDir = toAbsolutePath(dir, cwd);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isRecordFileName(entry.name))
    .map((entry) => join(absoluteDir, entry.name))
    .sort((a, b) => compareByDisplayPath(a, b, cwd));
}

/**
 * Why {@link discoverAdrFiles} did not pick a markdown file up: its filename does not
 * match the record grammar, or it sits in a subdirectory that discovery never reads.
 */
export type SkippedMarkdownReason = 'filename' | 'nested';

export interface SkippedMarkdownFile {
  path: string;
  reason: SkippedMarkdownReason;
}

/**
 * Depth cap for the skipped-file scan. Corpora are flat by construction; this only
 * bounds the walk over an unexpected tree so a deep or generated directory cannot turn
 * a lint run into a full-repository traversal.
 */
const MAX_SKIP_SCAN_DEPTH = 8;

async function collectSkippedMarkdown(
  absoluteDir: string,
  depth: number,
  found: SkippedMarkdownFile[],
): Promise<void> {
  // Symlinked directories report `isDirectory() === false`, so the walk cannot loop.
  const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && depth < MAX_SKIP_SCAN_DEPTH) {
        await collectSkippedMarkdown(path, depth + 1, found);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;
    if (isConventionalNonRecordFileName(entry.name)) continue;
    // Below the top level, discovery cannot see the file whatever it is called.
    if (depth > 0) found.push({ path, reason: 'nested' });
    else if (!isRecordFileName(entry.name)) found.push({ path, reason: 'filename' });
  }
}

/**
 * Markdown under the corpus directory that {@link discoverAdrFiles} skipped — either
 * because the filename does not match {@link RECORD_FILE_PATTERN} or because the file
 * is nested and discovery reads only the top level. Surfacing these is what keeps
 * "checked 0 records" from being silently reported as a healthy corpus when a migrated
 * or hand-authored record is simply misplaced or misnamed (#41).
 */
export async function discoverSkippedMarkdownFiles(
  dir = 'docs/adr',
  cwd = process.cwd(),
): Promise<SkippedMarkdownFile[]> {
  const found: SkippedMarkdownFile[] = [];
  await collectSkippedMarkdown(toAbsolutePath(dir, cwd), 0, found);
  return found.sort((a, b) => compareByDisplayPath(a.path, b.path, cwd));
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

  return Array.from(new Set(expanded)).sort((a, b) => compareByDisplayPath(a, b, cwd));
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
