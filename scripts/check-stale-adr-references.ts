/**
 * Fail when this repository's prose cites a record that is no longer live
 * without saying so.
 *
 *   bun run check:stale-refs
 *
 * # Why this exists
 *
 * ADR-0040 splits derived-surface drift into three classes. This is the prose
 * half of class 2, *referential integrity*: a sentence in `README.md` or
 * `site/` that names `ADR-0021` as the authority for current behavior is wrong
 * the moment ADR-0022 supersedes it, and nothing catches it. The corpus already
 * knows the supersession — it is in frontmatter, and `adr lint` already fails on
 * a dangling link — but a doc is not a record and no gate ever read it.
 *
 * # Why it is not one rule with the `@adr` marker lint
 *
 * `stale-marker` (ADR-0022, re-dated under ADR-0039) covers the *other* half:
 * `@adr 0021` in a source file. The two share one definition of "successor" and
 * nothing else. A marker is an inbound governance declaration with a grammar, a
 * bounded scan window and an exact source location; prose is a sentence *about*
 * a decision, with no grammar, whole-document scope, and an acknowledgement
 * notion that markers do not have at all. Folding them would make prose a
 * governance declaration, which it is not, and would inherit ADR-0022's
 * deliberate denial of exit-code authority — right for a consumer's source
 * tree, wrong for this repository's own documentation gate.
 *
 * # Why it is a repo-local script and not CLI surface
 *
 * The same reasons `emit-manifest.ts` and `check-doc-cli-versions.ts` give. The
 * public CLI is a semver commitment maintained indefinitely (ADR-0031), and
 * `adr graph --format json` already emits every node's `status` and every
 * `supersedes` edge, so no new surface is needed to answer the question. A
 * public `stale-reference` lint waits for adopter demand (ADR-0040).
 *
 * # Scope is the load-bearing decision
 *
 * At today's corpus, `ADR-0005` and `ADR-0021` are mentioned 149 times across
 * the tree and almost every mention is legitimate. `docs/adr/` narrating its own
 * history, `CHANGELOG.md` recording what shipped, `specs/` describing the plan
 * of the day, and source comments explaining why a line exists are all correct
 * as written; rewriting them would be falsifying the past. Only documents that
 * speak in the present tense to a reader are scanned, and the list is explicit
 * rather than derived so that what is guarded is legible (ADR-0040 records the
 * cost: a new prose document is unguarded until someone adds it here).
 *
 * # The failure mode this script must not have
 *
 * A guard that matches nothing reports nothing (ADR-0016). Every way of
 * scanning nothing is therefore an error: an empty corpus, an empty file set,
 * and a configured path that does not exist all throw rather than pass green.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { compareCodeUnits } from '../packages/core/src/ordering/index.ts';

const repoRoot = resolve(import.meta.dir, '..');

/**
 * Documents that address a reader in the present tense.
 *
 * A directory entry is scanned recursively for `.md`/`.mdx`; `exclude` is
 * matched against the repo-relative path prefix.
 */
export const SCANNED: ReadonlyArray<{ path: string; exclude?: readonly string[] }> = [
  { path: 'AGENTS.md' },
  { path: 'CLAUDE.md' },
  { path: 'CONTRIBUTING.md' },
  { path: 'MANIFEST.md' },
  { path: 'README.md' },
  // The corpus narrating itself is the corpus working correctly, and its
  // supersession edges are already linted.
  { path: 'docs', exclude: ['docs/adr'] },
  // `site/src/content/docs/adr/` is generated from the corpus by
  // `site/scripts/gen-adr-pages.ts` and is not committed; excluded so a local
  // build cannot change this guard's result.
  { path: 'site/src/content/docs', exclude: ['site/src/content/docs/adr'] },
];

/** Statuses that make a citation a claim about history rather than about now. */
const NOT_LIVE = new Set(['superseded', 'rejected', 'deprecated']);

export interface GraphNode {
  readonly id: string;
  readonly status: string;
}

export interface GraphEdge {
  /** The successor. */
  readonly from: string;
  /** The record it supersedes. */
  readonly to: string;
  readonly kind: string;
}

export interface Corpus {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface StaleReference {
  readonly path: string;
  readonly line: number;
  readonly id: string;
  readonly status: string;
  /** Terminal live successor when the chain resolves, else `undefined`. */
  readonly successor?: string;
}

/**
 * `ADR-0021`, `ADR 0021`, `adr-0021` — and a corpus link target such as
 * `0021-resolve-inbound-source-annotations-without-changing-the-schema.md`,
 * which is how a successor is often cited without repeating the id in prose.
 *
 * A bare four-digit number is deliberately *not* a reference. `8192`, `2026`
 * and `0.14.0` all appear in these documents, and a guard that fires on them
 * would be turned off within a week.
 *
 * Built fresh per call: `matchAll` seeds from the source regex's `lastIndex`,
 * so a shared global instance any caller had poked would start mid-string.
 */
export function referencePattern(): RegExp {
  return new RegExp(String.raw`\bADR[-\s]?(\d{4,})\b|\b(\d{4,})-[a-z0-9-]+\.mdx?\b`, 'giu');
}

/** Ids named anywhere in one block of text, in first-appearance order. */
export function referencedIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(referencePattern())) {
    const id = match[1] ?? match[2];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface Block {
  readonly text: string;
  /** 1-based line of the block's first line. */
  readonly line: number;
}

/**
 * Split a document into acknowledgement windows.
 *
 * A window is a run of non-blank lines, and a list-item line (`-`, `*`, `+`,
 * `1.`) starts a new one. Both halves are load-bearing. Blank-line paragraphs
 * alone are too loose — a tight bullet list becomes one window, so naming the
 * successor in an unrelated bullet would excuse every other bullet in the list.
 * A per-line window is too tight: the positive control in `AGENTS.md` names
 * ADR-0021 on one line and links ADR-0022 two lines later, in the same
 * sentence, which is exactly the acknowledgement this guard wants to accept.
 *
 * Fenced blocks (` ``` ` / `~~~`) and YAML frontmatter are dropped entirely.
 * A doc showing sample `stale-marker` output, or an MDX page whose frontmatter
 * carries a record title, must not fail a required check — the same reason
 * ADR-0023 stopped reading markers inside fences.
 */
export function splitBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let current: string[] = [];
  let start = 0;
  let fence: string | undefined;
  let index = 0;

  const flush = (): void => {
    if (current.length > 0) blocks.push({ text: current.join('\n'), line: start + 1 });
    current = [];
  };

  // Frontmatter: only when the very first line opens it.
  if (lines[0]?.trim() === '---') {
    index = 1;
    while (index < lines.length && lines[index]?.trim() !== '---') index += 1;
    index += 1;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const fenceOpen = /^\s*(`{3,}|~{3,})/u.exec(line);

    if (fence !== undefined) {
      if (fenceOpen && (fenceOpen[1] as string).startsWith(fence[0] as string) && (fenceOpen[1] as string).length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fenceOpen) {
      flush();
      fence = fenceOpen[1] as string;
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/u.test(line)) flush();
    if (current.length === 0) start = index;
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * The terminal live successor of a superseded record, or `undefined` when the
 * chain does not resolve.
 *
 * Mirrors `terminalLiveSuccessor` in `@adrkit/core`'s marker resolver, including
 * the part that is easy to miss: a chain ending at a `rejected` or `deprecated`
 * record resolves to **nothing**, not to that record. Only `accepted`, `draft`
 * and `proposed` are live. Without that clause the failure message would tell a
 * contributor to cite a rejected record as the successor — advice this guard
 * would then have to reject on the next run.
 *
 * It is reimplemented over `adr graph --format json` rather than imported
 * because the core function is not exported and exporting it would be consumer
 * SDK surface under ADR-0031 — a semver commitment this repository's own guard
 * should not create. `scripts/check-stale-adr-references.test.ts` pins the two
 * to the same behavior, which is what makes Dave's "one definition of
 * successor" true rather than merely intended. ADR-0040 records the choice.
 */
export function terminalSuccessor(id: string, corpus: Corpus): string | undefined {
  const statusOf = new Map(corpus.nodes.map((node) => [node.id, node.status]));
  const successorOf = new Map<string, string>();
  for (const edge of corpus.edges) {
    if (edge.kind === 'supersedes' && !successorOf.has(edge.to)) successorOf.set(edge.to, edge.from);
  }

  const seen = new Set([id]);
  let next = successorOf.get(id);
  while (next !== undefined) {
    if (seen.has(next)) return undefined;
    seen.add(next);
    const status = statusOf.get(next);
    if (status === undefined) return undefined;
    if (status === 'accepted' || status === 'draft' || status === 'proposed') return next;
    if (status !== 'superseded') return undefined;
    next = successorOf.get(next);
  }
  return undefined;
}

/** Every id in the supersession chain above `id`, terminal or not. */
function chainAbove(id: string, corpus: Corpus): Set<string> {
  const successorOf = new Map<string, string>();
  for (const edge of corpus.edges) {
    if (edge.kind === 'supersedes' && !successorOf.has(edge.to)) successorOf.set(edge.to, edge.from);
  }
  const chain = new Set<string>();
  let next = successorOf.get(id);
  while (next !== undefined && !chain.has(next)) {
    chain.add(next);
    next = successorOf.get(next);
  }
  return chain;
}

/**
 * Pure: the unacknowledged citations in one document.
 *
 * A citation of a `superseded` record is acknowledged when its window also
 * names a record from its supersession chain — the successor is the only thing
 * that tells the reader where to go next, so the status word alone is not
 * enough. A `rejected` or `deprecated` record has no successor to name, so its
 * window must carry the status word instead.
 */
export function findStaleReferences(path: string, text: string, corpus: Corpus): StaleReference[] {
  const statusOf = new Map(corpus.nodes.map((node) => [node.id, node.status]));
  const stale: StaleReference[] = [];

  for (const block of splitBlocks(text)) {
    const ids = referencedIds(block.text);
    for (const id of ids) {
      const status = statusOf.get(id);
      if (status === undefined || !NOT_LIVE.has(status)) continue;

      if (status === 'superseded') {
        const chain = chainAbove(id, corpus);
        if (ids.some((other) => chain.has(other))) continue;
        stale.push({ path, line: block.line, id, status, successor: terminalSuccessor(id, corpus) });
        continue;
      }
      if (new RegExp(String.raw`\b${status}\b`, 'iu').test(block.text)) continue;
      stale.push({ path, line: block.line, id, status });
    }
  }
  return stale;
}

export interface DocFile {
  readonly path: string;
  readonly text: string;
}

/** Read every scanned document. Throws when a configured path is missing. */
export function collectDocs(root: string = repoRoot): DocFile[] {
  const out: DocFile[] = [];

  const walk = (absolute: string, exclude: readonly string[]): void => {
    const rel = relative(root, absolute);
    if (exclude.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return;

    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolute).sort(compareCodeUnits)) walk(join(absolute, entry), exclude);
      return;
    }
    if (/\.mdx?$/u.test(absolute)) out.push({ path: rel, text: readFileSync(absolute, 'utf8') });
  };

  for (const entry of SCANNED) {
    const absolute = join(root, entry.path);
    try {
      statSync(absolute);
    } catch {
      throw new Error(
        `scanned path "${entry.path}" does not exist. A guard that scans nothing reports nothing ` +
          '(ADR-0016) — remove it from SCANNED deliberately, or restore the file.',
      );
    }
    walk(absolute, entry.exclude ?? []);
  }

  if (out.length === 0) throw new Error('no documents were scanned; refusing to report a clean run.');
  return out;
}

/** Run the read-only CLI and return its nodes and edges. */
function readCorpus(): Corpus {
  const result = Bun.spawnSync({
    cmd: ['bun', join(repoRoot, 'packages', 'cli', 'src', 'index.ts'), 'graph', '--format', 'json'],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `adr graph --format json exited ${result.exitCode}:\n${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return parseCorpus(new TextDecoder().decode(result.stdout));
}

/** Parse and validate `adr graph --format json` output. */
export function parseCorpus(json: string): Corpus {
  const parsed: unknown = JSON.parse(json);
  const { nodes, edges } = (parsed ?? {}) as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new Error('`adr graph --format json` output has no `nodes` and `edges` arrays.');
  }
  if (nodes.length === 0) {
    throw new Error(
      '`adr graph --format json` reported no records. Refusing to report a clean run against an ' +
        'empty corpus — run `bun run adr lint` and check that docs/adr/ is readable.',
    );
  }

  return {
    nodes: nodes.map((node, index) => {
      const { id, status } = (node ?? {}) as Record<string, unknown>;
      if (typeof id !== 'string' || typeof status !== 'string') {
        throw new Error(`graph node ${index} is missing a string id or status.`);
      }
      return { id, status };
    }),
    edges: edges.map((edge, index) => {
      const { from, to, kind } = (edge ?? {}) as Record<string, unknown>;
      if (typeof from !== 'string' || typeof to !== 'string' || typeof kind !== 'string') {
        throw new Error(`graph edge ${index} is missing a string from, to, or kind.`);
      }
      return { from, to, kind };
    }),
  };
}

/** The message a contributor reads when this fails. */
export function formatFailure(stale: readonly StaleReference[]): string {
  const lines = stale.map((reference) => {
    const action =
      reference.status === 'superseded'
        ? reference.successor === undefined
          ? 'name its successor here, or move the sentence to the past tense'
          : `name ADR-${reference.successor} here, or move the sentence to the past tense`
        : `say "${reference.status}" here, or move the sentence to the past tense`;
    return `${reference.path}:${reference.line}  ADR-${reference.id} is ${reference.status} — ${action}`;
  });
  return (
    `Prose cites a record that is no longer live without saying so:\n  ${lines.join('\n  ')}\n` +
    'A citation is acknowledged when the same paragraph or list item names the successor ' +
    '(ADR-0040). Narration of history belongs in docs/adr/, CHANGELOG.md or specs/, which are not scanned.'
  );
}

function main(): void {
  const corpus = readCorpus();
  const docs = collectDocs();
  const stale = docs.flatMap((doc) => findStaleReferences(doc.path, doc.text, corpus));

  if (stale.length > 0) throw new Error(formatFailure(stale));
  console.log(
    `check-stale-adr-references: ok — ${docs.length} documents cite no superseded, rejected, or deprecated record without saying so`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      `check-stale-adr-references: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
