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

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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
 * `ADR-0021`, `ADR 0021`, `adr-0021` — and a link whose target names a record,
 * which is how a successor is often cited without repeating the id in prose.
 *
 * The link half is anchored on an `adr/` path segment and accepts a repository
 * file (`docs/adr/0021-….md`), a published site route (`/adr/0021-…/`, which
 * `site/scripts/gen-adr-pages.ts` emits with **no extension** and eight pages
 * already link that way), and a blob URL. Requiring `.md` missed every site
 * route, in both directions: a citation written that way was invisible, and a
 * successor cited that way never acknowledged one.
 *
 * The anchor also removes a false positive the unanchored form had — it matched
 * any `NNNN-slug.md`, so `notes/2026-09-22-release.md` read as a citation of
 * record `2026`. A bare four-digit number is likewise deliberately not a
 * reference: `8192`, `2026` and `0.14.0` all appear in these documents, and a
 * guard that fires on them would be switched off within a week.
 *
 * The anchor is a **path-segment** boundary, not `\b`. A word boundary exists
 * between the hyphen and the `a` of `not-adr`, so `\badr/` read `/not-adr/0005-old/`
 * as a local citation — an unrelated route failing a required check. The lookbehind
 * rejects a preceding word character or hyphen, which leaves the segment starts that
 * actually occur: start of string, `/`, and `./`.
 *
 * Built fresh per call: `matchAll` seeds from the source regex's `lastIndex`,
 * so a shared global instance any caller had poked would start mid-string.
 */
export function referencePattern(): RegExp {
  return new RegExp(
    String.raw`\bADR[-\s]?(\d{4,})\b|(?<![\w-])adr/(\d{4,})-[a-z0-9-]+(?:\.mdx?|/|\b)`,
    'giu',
  );
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

  // Frontmatter: only when the very first line opens it **and** a closing
  // delimiter exists. Advancing to EOF on an unterminated block stepped one past
  // the last line, so the loop below never ran and the whole document was
  // dropped — a file could then hide every stale citation while the command
  // reported a clean run, which is the fail-open this file exists to avoid
  // (ADR-0016). A lone `---` on line 1 is a legal thematic break, so the answer
  // is to scan the document, not to fail on it.
  if (lines[0]?.trim() === '---') {
    let close = 1;
    while (close < lines.length && lines[close]?.trim() !== '---') close += 1;
    if (close < lines.length) index = close + 1;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const fenceOpen = /^\s*(`{3,}|~{3,})/u.exec(line);

    if (fence !== undefined) {
      // A closing fence uses the same character, is at least as long, and carries
      // **nothing** after it. Accepting an info string let ```js … ```py close the
      // block, and the code after it was then scanned as prose.
      const fenceClose = /^\s*(`{3,}|~{3,})\s*$/u.exec(line);
      const run = fenceClose?.[1];
      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length) fence = undefined;
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
  const successorOf = successorIndex(corpus);

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

/**
 * superseded id → the record that supersedes it.
 *
 * `adr graph` sorts its edges with `localeCompare`, which follows the runtime's
 * ICU locale, so first-wins over the supplied order would make the successor this
 * guard names depend on the machine that ran it. `emit-manifest.ts` refuses to
 * rest a gate on that same order, for the same reason. Re-sorted with
 * `compareCodeUnits` here, so the lowest id wins deterministically.
 *
 * A lint-clean corpus has exactly one successor per superseded record anyway:
 * `supersedes`/`supersededBy` are reciprocal, `supersession-consistent` is an
 * **error** rule, `adr graph` exits non-zero on an error finding, and
 * {@link parseCorpus}'s caller throws on a non-zero exit. The sort is what makes
 * the guard deterministic on the corpora that never reach that gate.
 */
function successorIndex(corpus: Corpus): Map<string, string> {
  const supersedes = corpus.edges
    .filter((edge) => edge.kind === 'supersedes')
    .sort((a, b) => compareCodeUnits(a.to, b.to) || compareCodeUnits(a.from, b.from));

  const successorOf = new Map<string, string>();
  for (const edge of supersedes) if (!successorOf.has(edge.to)) successorOf.set(edge.to, edge.from);
  return successorOf;
}

/** Every id in the supersession chain above `id`, terminal or not. */
function chainAbove(id: string, corpus: Corpus): Set<string> {
  const successorOf = successorIndex(corpus);
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

/**
 * A repository-relative path in the one spelling the rest of this file assumes.
 *
 * `node:path.relative()` returns `docs\\adr\\0005-x.md` on Windows, and {@link SCANNED}
 * writes its exclusions with forward slashes, so every exclusion silently missed
 * there and the guard reported dozens of findings inside the corpus it is supposed
 * to skip. @davesheffer reproduced it on Windows/Bun 1.3.14 against PR #217's head
 * while all 68 tests passed — which is why the separator is a parameter rather than
 * read from `node:path` inside: a POSIX-only suite can otherwise never reach the bug.
 *
 * Conditional on the separator, and deliberately so, exactly as core's
 * `normalizeMarkerPath` is. On POSIX a backslash is an ordinary filename character,
 * and rewriting it would make `docs/we\\ird.md` report a path that does not exist.
 */
export function normalizeRelative(path: string, separator: string = sep): string {
  return separator === '\\' ? path.replaceAll('\\', '/') : path;
}

/**
 * Whether a normalized repo-relative path falls under one of the excluded prefixes.
 *
 * Segment-aware: `docs/adr` excludes `docs/adr/0005-x.md` but not `docs/adrs/x.md`
 * or `docs/adr-notes.md`, which a bare `startsWith` would also swallow.
 */
export function excludes(rel: string, exclude: readonly string[]): boolean {
  return exclude.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

/**
 * Read every scanned document.
 *
 * Throws when a configured path is missing, and throws on **any** symlink at or
 * beneath a scanned path. `statSync` follows links and `readdirSync` then recurses
 * through whatever it reaches, so on a pull-request-authored tree a link under
 * `docs/` could send this guard outside the worktree or into an unbounded cycle.
 * Core's marker reader already refuses every symlink component
 * (`packages/core/src/markers/read.ts`); this refuses rather than skips, because a
 * skip is the silent-pass failure the rest of this file exists to avoid — a
 * documentation tree has no reason to contain one, so the answer is to check the
 * file in rather than link to it.
 *
 * Three properties of that check are each load-bearing, and the first two were
 * wrong in the round that introduced it:
 *
 * - **Every component is checked, not the leaf.** `lstatSync` on a constructed
 *   path examines only its final entry; the OS still traverses every ancestor,
 *   following links. Replacing `site/src/content` with a link let the walk read
 *   `outside/docs/leak.md` and report it under `site/src/content/docs/`.
 * - **The check precedes the exclusion.** An excluded path is not read, but it is
 *   inside the boundary this guard claims, and {@link main} hands the same tree to
 *   `adr graph` — whose corpus loader *does* follow a symlinked `docs/adr` root.
 *   Checking first is what lets this refuse before the CLI is spawned.
 * - **Refusal, not omission.** See above.
 *
 * The corpus loader's own behavior on a symlinked root is core's boundary and is
 * unchanged here; `adr lint` already loads the same corpus earlier in the same job.
 */
export function collectDocs(root: string = repoRoot): DocFile[] {
  const out: DocFile[] = [];

  const refuseSymlink = (absolute: string, rel: string): void => {
    throw new Error(
      `"${rel}" is a symlink. This guard refuses to follow one: a link under a scanned path can ` +
        'leave the worktree or cycle, and following it would let a pull request choose what CI ' +
        `reads. Check the file in instead of linking to it. (${absolute})`,
    );
  };

  /**
   * `lstat` each component from `root` down to `target`, refusing the first
   * symlink. Mirrors core's `lstatWithoutSymlink`; checking only the leaf is
   * insufficient because the OS resolves every ancestor on the way to it.
   */
  const lstatEveryComponent = (target: string): ReturnType<typeof lstatSync> => {
    let current = root;
    let stats = lstatSync(current);
    for (const segment of normalizeRelative(relative(root, target)).split('/')) {
      if (segment === '') continue;
      current = join(current, segment);
      stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        refuseSymlink(current, normalizeRelative(relative(root, current)));
      }
    }
    return stats;
  };

  const walk = (absolute: string, exclude: readonly string[]): void => {
    const rel = normalizeRelative(relative(root, absolute));
    // Before the exclusion, not after: an excluded path is not read, but it is
    // inside the boundary, and `adr graph` follows a symlinked `docs/adr` root.
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) refuseSymlink(absolute, rel);
    if (excludes(rel, exclude)) return;

    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolute).sort(compareCodeUnits)) walk(join(absolute, entry), exclude);
      return;
    }
    if (/\.mdx?$/u.test(absolute)) out.push({ path: rel, text: readFileSync(absolute, 'utf8') });
  };

  for (const entry of SCANNED) {
    const absolute = join(root, entry.path);
    try {
      lstatSync(absolute);
    } catch {
      throw new Error(
        `scanned path "${entry.path}" does not exist. A guard that scans nothing reports nothing ` +
          '(ADR-0016) — remove it from SCANNED deliberately, or restore the file.',
      );
    }
    // Every component from the root, so a symlinked ancestor is refused too.
    lstatEveryComponent(absolute);
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

/**
 * The message a contributor reads when this fails.
 *
 * The footer states only the rules that actually apply to the findings reported.
 * A single footer claiming every citation is acknowledged by naming a successor
 * contradicted the per-finding line for a `rejected` record, which asks for the
 * status word — and sent the author looking for a successor that state does not
 * have.
 */
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

  const rules: string[] = [];
  if (stale.some((reference) => reference.status === 'superseded')) {
    rules.push(
      'A superseded record is acknowledged when the same paragraph or list item names its successor.',
    );
  }
  if (stale.some((reference) => reference.status !== 'superseded')) {
    rules.push(
      'A rejected or deprecated record has no successor to name; its window must carry the status word instead.',
    );
  }

  return (
    `Prose cites a record that is no longer live without saying so:\n  ${lines.join('\n  ')}\n` +
    `${rules.join(' ')} (ADR-0040)\n` +
    'Narration of history belongs in docs/adr/, CHANGELOG.md or specs/, which are not scanned.'
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
