/**
 * Derived-content step: render the ADR corpus as Starlight pages.
 *
 * The canonical records in `docs/adr/*.md` carry adrkit's OWN typed frontmatter
 * (id, status, reversibility, blastRadius, affects, …) — a superset of MADR that
 * deliberately does NOT match Starlight's expected `title`/`description` shape.
 * We must not edit the source files to fit the docs theme.
 *
 * Instead this script reads each source record, maps its frontmatter to Starlight
 * page metadata, surfaces the typed fields as a metadata table, preserves the
 * markdown body verbatim, and writes derived pages into
 * `src/content/docs/adr/`. The source files are never touched.
 *
 * Output is generated (git-ignored) and regenerated on every `dev`/`build`.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const siteDir = resolve(import.meta.dir, '..');
const repoRoot = resolve(siteDir, '..');
const sourceDir = join(repoRoot, 'docs', 'adr');
const outDir = join(siteDir, 'src', 'content', 'docs', 'adr');
const GITHUB_BLOB = 'https://github.com/mbeacom/adrkit/blob/main/docs/adr';

type Frontmatter = Record<string, unknown>;

interface Affect {
  type?: string;
  pattern?: string;
  repo?: string;
  negate?: boolean;
}

interface AdrDoc {
  file: string;
  num: string;
  frontmatter: Frontmatter;
  body: string;
}

/** Starlight badge variants keyed by ADR status. */
const STATUS_VARIANT: Record<string, string> = {
  accepted: 'success',
  proposed: 'note',
  draft: 'note',
  rejected: 'danger',
  superseded: 'caution',
  deprecated: 'caution',
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function splitFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const parsed = parseYaml(match[1] ?? '') as unknown;
  const frontmatter = parsed && typeof parsed === 'object' ? (parsed as Frontmatter) : {};
  return { frontmatter, body: (match[2] ?? '').trimStart() };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Pull the first markdown H1 out of the body, returning the heading text and the rest. */
function extractH1(body: string): { heading?: string; rest: string } {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trimStart();
      return { heading: (h1[1] ?? '').trim(), rest };
    }
    break; // first non-blank line is not an H1; leave the body intact
  }
  return { rest: body };
}

/** First prose paragraph of the body, collapsed to a single line for meta description. */
function firstParagraph(body: string): string | undefined {
  const blocks = body.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('|') || trimmed.startsWith('<!--')) continue;
    const oneLine = trimmed.replace(/\s+/g, ' ');
    return oneLine.length > 160 ? `${oneLine.slice(0, 157).trimEnd()}…` : oneLine;
  }
  return undefined;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function metadataTable(fm: Frontmatter, file: string): string {
  const rows: Array<[string, string]> = [];
  const push = (label: string, value: string | undefined): void => {
    if (value) rows.push([label, value]);
  };
  const code = (value: string): string => `\`${escapeCell(value)}\``;
  const codeList = (values: string[]): string =>
    values.length ? values.map(code).join(', ') : '';

  push('Status', str(fm['status']));
  push('Date', str(fm['date']));
  push('Reversibility', str(fm['reversibility']));
  push('Blast radius', str(fm['blastRadius']));
  push('Scope', str(fm['scope']));
  push('Deciders', codeList(strArray(fm['deciders'])));
  push('Tags', codeList(strArray(fm['tags'])));
  push('Supersedes', codeList(strArray(fm['supersedes'])));
  push('Superseded by', str(fm['supersededBy']) ? code(str(fm['supersededBy']) as string) : undefined);
  push('Relates to', codeList(strArray(fm['relatesTo'])));

  const affects = Array.isArray(fm['affects']) ? (fm['affects'] as Affect[]) : [];
  const affectsRendered = affects
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const prefix = a.negate ? '!' : '';
      const scope = a.repo ? `${a.repo}:` : '';
      return code(`${prefix}${scope}${a.type ?? '?'}:${a.pattern ?? ''}`);
    })
    .join(', ');
  push('Affects', affectsRendered);

  push('Source', `[\`docs/adr/${file}\`](${GITHUB_BLOB}/${file})`);

  if (rows.length === 0) return '';
  const header = '| Field | Value |\n| --- | --- |\n';
  return header + rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n';
}

function isTemplate(doc: AdrDoc): boolean {
  return doc.num === '0000' || str(doc.frontmatter['id']) === 'NNNN';
}

function pageTitle(doc: AdrDoc, heading: string | undefined): string {
  if (isTemplate(doc)) return 'ADR template';
  if (heading) return heading;
  const title = str(doc.frontmatter['title']);
  return title ? `ADR-${doc.num}: ${title}` : `ADR-${doc.num}`;
}

function renderPage(doc: AdrDoc): string {
  const { heading, rest } = extractH1(doc.body);
  const title = pageTitle(doc, heading);
  const status = str(doc.frontmatter['status']) ?? 'draft';
  const description = isTemplate(doc)
    ? 'Copy-ready template for a new adrkit decision record.'
    : firstParagraph(rest) ?? `adrkit decision record ${doc.num} (${status}).`;

  const frontmatter: Record<string, unknown> = {
    title,
    description,
    sidebar: {
      order: isTemplate(doc) ? 1 : Number(doc.num) + 1,
      badge: { text: status, variant: STATUS_VARIANT[status] ?? 'default' },
    },
  };

  const table = metadataTable(doc.frontmatter, doc.file);
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\n${table}\n${rest.trimEnd()}\n`;
}

function renderIndex(docs: AdrDoc[]): string {
  const frontmatter = {
    title: 'Decision records',
    description: 'The adrkit ADR corpus — the project governed by its own tooling.',
    sidebar: { order: 0 },
  };
  const rows = docs
    .filter((doc) => !isTemplate(doc))
    .map((doc) => {
      const title = str(doc.frontmatter['title']) ?? doc.num;
      const status = str(doc.frontmatter['status']) ?? '';
      const slug = doc.file.replace(/\.md$/, '');
      return `| [${doc.num}](/adr/${slug}/) | ${escapeCell(title)} | \`${status}\` |`;
    })
    .join('\n');

  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\nadrkit dogfoods its own format: every decision in this project is a typed\ndecision record in [\`docs/adr/\`](${GITHUB_BLOB.replace('/blob/main/docs/adr', '/tree/main/docs/adr')}).\nThese pages are generated from those source files — the records themselves are\nnever edited to fit this site.\n\n| # | Decision | Status |\n| --- | --- | --- |\n${rows}\n\nSee the [ADR template](/adr/0000-template/) for the copy-ready starting point.\n`;
}

function main(): void {
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.md'))
    .sort();

  const docs: AdrDoc[] = files.map((file) => {
    const raw = readFileSync(join(sourceDir, file), 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    const num = (/^(\d+)-/.exec(file)?.[1] ?? '0000').padStart(4, '0');
    return { file, num, frontmatter, body };
  });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const doc of docs) {
    writeFileSync(join(outDir, doc.file), renderPage(doc), 'utf8');
  }
  writeFileSync(join(outDir, 'index.md'), renderIndex(docs), 'utf8');

  console.log(`gen-adr-pages: wrote ${docs.length} record page(s) + index to src/content/docs/adr/`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`gen-adr-pages: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
