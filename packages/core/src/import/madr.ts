import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { FrontmatterError, parseFrontmatter } from '../parse/frontmatter.ts';
import { isConventionalNonRecordFileName, normalizeDisplayPath } from '../load/corpus.ts';

export interface MadrSourceFile {
  kind: 'madr';
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  source: string;
  title?: string;
  /**
   * Fields recovered from the markdown body for MADR dialects that do not carry YAML
   * frontmatter. Consulted only when the corresponding frontmatter key is absent, so
   * frontmatter always wins and an already-migrated file re-migrates identically.
   */
  bodyFields: MadrBodyFields;
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

/** Fields the body-dialect readers can recover when YAML frontmatter does not carry them. */
export interface MadrBodyFields {
  status?: string;
  date?: string;
  deciders?: string[];
}

/**
 * The MADR 2.x header-bullet region: everything before the first `##` section heading.
 * Restricting the bullet scan to this region keeps a `Status:`-shaped line in ordinary
 * prose (Context, Consequences, …) from being mistaken for the record's status.
 */
function headerRegion(body: string): string {
  const heading = /^##[^\n]*$/m.exec(body);
  return heading?.index === undefined ? body : body.slice(0, heading.index);
}

/**
 * Upper bound on a field value before cleaning. Real `Status:`/`Date:` values are a few
 * dozen characters; the cap keeps a pathological one-line file from driving the cleanup
 * regexes over megabytes of attacker-supplied text.
 */
const MAX_FIELD_VALUE_LENGTH = 512;

/**
 * Strip the markdown decoration MADR corpora put around a field value — bold/italic
 * runs, inline code, link syntax, and a trailing period — without touching the words.
 * Every character class here is negated on both delimiters so no pattern can rescan the
 * remainder of the string from each start position.
 */
function cleanFieldValue(value: string): string {
  return value
    .slice(0, MAX_FIELD_VALUE_LENGTH)
    .replace(/`/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/\[([^[\]]*)\]\([^()]*\)/g, '$1')
    .replace(/^[[<]+|[\]>]+$/g, '')
    .replace(/[.,;]+$/, '')
    .trim();
}

type BodyField = 'status' | 'date' | 'deciders';

/** `* Status: accepted`, `- Date: 2025-03-14`, `**Status:** accepted` — MADR 2.x. */
function headerBulletValue(region: string, field: BodyField): string | undefined {
  const pattern = new RegExp(`^[ \\t]*(?:[*+-][ \\t]+)?\\*{0,2}_{0,2}${field}_{0,2}\\*{0,2}[ \\t]*:[ \\t]*(.+)$`, 'im');
  const value = cleanFieldValue(pattern.exec(region)?.[1] ?? '');
  return value.length > 0 ? value : undefined;
}

/** `## Status` followed by the value on its own line — the Nygard dialect. */
function sectionValue(body: string, field: BodyField): string | undefined {
  const heading = new RegExp(`^#{2,6}[ \\t]+${field}[ \\t]*#*[ \\t]*$`, 'im').exec(body);
  if (!heading) return undefined;

  const rest = body.slice(heading.index + heading[0].length);
  for (const line of rest.split('\n')) {
    if (/^#{1,6}[ \t]/.test(line)) break;
    const value = cleanFieldValue(line);
    if (value.length > 0) return value;
  }
  return undefined;
}

/** `@handle`, `team:slug`, or an email address — the schema's `Identity` grammar. */
const IDENTITY_PATTERN = /^(@[A-Za-z0-9-]+|team:[a-z0-9-]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

/**
 * Split a `* Deciders: @a, @b` value into schema-valid identities. MADR leaves this
 * field free-form, so entries that are not identities — the template's own
 * `[list everyone involved in the decision]` placeholder, or a bare name — are dropped
 * rather than written as frontmatter the schema would then reject.
 */
function parseDeciders(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const identities = value
    .split(/[,;]|\s+and\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => IDENTITY_PATTERN.test(entry));
  const unique = [...new Set(identities)];
  return unique.length > 0 ? unique : undefined;
}

/**
 * Recover `status`, `date`, and `deciders` from the two widely deployed MADR dialects
 * that keep them in the body rather than in YAML frontmatter: MADR 2.x header bullets
 * and Nygard `## Status` sections. Without this, both dialects import as `proposed`
 * dated `1970-01-01` with no deciders — a silent downgrade of decisions that were
 * already accepted, attributed to nobody (#40, #50).
 */
export function extractMadrBodyFields(body: string): MadrBodyFields {
  const region = headerRegion(body);
  const status = headerBulletValue(region, 'status') ?? sectionValue(body, 'status');
  const date = headerBulletValue(region, 'date') ?? sectionValue(body, 'date');
  const deciders = parseDeciders(headerBulletValue(region, 'deciders') ?? sectionValue(body, 'deciders'));
  return {
    ...(status !== undefined ? { status } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(deciders !== undefined ? { deciders } : {}),
  };
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
        bodyFields: extractMadrBodyFields(parsed.body),
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
    bodyFields: extractMadrBodyFields(source),
  };
}

async function discoverMarkdownFilesInDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverMarkdownFilesInDir(path)));
    } else if (entry.isFile() && entry.name.endsWith('.md') && !isConventionalNonRecordFileName(entry.name)) {
      // Conventional corpus documentation (README, CONTRIBUTING, the template) is never
      // a migration candidate: rewriting it would be wrong, and `--rename` would move
      // it out from under every inbound link.
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
