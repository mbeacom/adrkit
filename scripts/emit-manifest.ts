/**
 * Render `MANIFEST.md`'s decision-corpus inventory from the corpus itself.
 *
 *   bun run emit:manifest
 *
 * # Why this exists
 *
 * The inventory — how many records there are, which ids, and how the statuses
 * split — is a pure function of `docs/adr/`. It was hand-maintained, and in #131
 * it was found publishing six records' worth of contradictory governance state.
 * A guard that merely *reports* the divergence would still leave a human to
 * hand-edit the table, which is exactly how it drifted, so this generates the
 * block and `clean-clone-builds` asserts the working tree is unchanged
 * afterwards — the same shape as `schema:emit` + `git diff --exit-code`.
 *
 * # Why it is a repo-local script and not a CLI command
 *
 * For the reason `check-doc-cli-versions.ts` states in its own docblock, plus
 * two more that are specific to writing: the public CLI's write surface is
 * deliberately small (`new` and `migrate` only), and the Spec Kit adapter holds
 * a *tested* invariant that hooks reach only non-writing commands. No new
 * public surface is needed anyway — `adr graph --format json` already emits
 * `id`, `title` and `status`, which is the whole of the derived state. So this
 * is the established pattern: read-only CLI, redirected, gated (#132).
 *
 * # What is deliberately NOT generated
 *
 * Only the block between the markers. The repository tree diagram, the planning
 * sources, and any judgment prose stay hand-written — they are editorial, not
 * derived, and generating them would be the "evaluator theater" ADR-0005 warns
 * about. Equally, nothing here claims a *file* count for `docs/adr/`: the graph
 * cannot see a file the corpus grammar rejects, so a file count sourced from it
 * would be the same silent under-report this script exists to end. `adr lint`
 * is the check that fails on an unreadable record, and it already runs in
 * `clean-clone-builds`.
 *
 * # The failure mode this script must not have
 *
 * A generator that writes nothing leaves `git diff` clean, so the gate reports
 * green while checking nothing (ADR-0016). Every way of writing nothing is
 * therefore an error here: absent markers, duplicated markers, markers in the
 * wrong order, and an empty node list all throw rather than no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareCodeUnits } from '../packages/core/src/ordering/index.ts';

const repoRoot = resolve(import.meta.dir, '..');

export const MARKER_BEGIN = '<!-- BEGIN GENERATED: adr-inventory -->';
export const MARKER_END = '<!-- END GENERATED: adr-inventory -->';

/** The `nodes` shape of `adr graph --format json`; `edges` are not inventory. */
export interface GraphNode {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

/** A contiguous run of zero-padded numeric ids, or `null` when there isn't one. */
export function describeIdRange(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  // Ids are `[0-9]{4,}` or a 26-character ULID. A ULID corpus, or a numeric one
  // with a gap, gets no range sentence rather than a wrong one.
  if (!ids.every((id) => /^[0-9]{4,}$/u.test(id))) return null;

  const width = ids[0]!.length;
  if (!ids.every((id) => id.length === width)) return null;

  const numbers = ids.map(Number);
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index]! !== numbers[index - 1]! + 1) return null;
  }
  return `\`${ids[0]}\`-\`${ids[ids.length - 1]}\``;
}

/**
 * `32 accepted, 2 superseded` — every status the corpus actually carries, in
 * code-unit order so a status this repository has never used still renders
 * deterministically the day it appears.
 */
export function describeStatusCounts(nodes: readonly GraphNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.status, (counts.get(node.status) ?? 0) + 1);

  return [...counts.entries()]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
}

/** Markdown table cells cannot carry a raw `|`, and titles are free text. */
function tableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}

/**
 * The generated block, markers included.
 *
 * Nodes are re-sorted here with `compareCodeUnits` rather than trusted in the
 * order `adr graph` supplied. That order is `localeCompare`'s, and ADR-0033
 * clause 8 pins it deliberately — "existing node and edge fields, **historical
 * locale ordering**, and missing-target omission unchanged" — so it is not this
 * script's to change, and equally not one a `git diff --exit-code` gate can rest
 * on: `localeCompare` follows the runtime's ICU locale, so two contributors
 * would regenerate different row orders from identical records and the gate
 * would fail with nothing having changed. Today's corpus is all zero-padded
 * numeric ids, which both comparators order identically, so this is inert now
 * and load-bearing the day a mixed-case ULID lands. #115 tracks the upstream
 * sort.
 */
export function renderInventoryBlock(nodes: readonly GraphNode[]): string {
  if (nodes.length === 0) {
    // A zero-record corpus is indistinguishable from a corpus the loader could
    // not see (ADR-0016), and this repository always has records.
    throw new Error(
      '`adr graph --format json` reported no records. Refusing to publish an empty inventory — ' +
        'run `bun run adr lint` and check that docs/adr/ is readable.',
    );
  }

  const ordered = [...nodes].sort((a, b) => compareCodeUnits(a.id, b.id));
  const ids = ordered.map((node) => node.id);
  const range = describeIdRange(ids);
  const plural = nodes.length === 1 ? 'record' : 'records';

  const lines = [
    MARKER_BEGIN,
    '',
    '<!-- Generated by `bun run emit:manifest`; do not hand-edit. -->',
    '',
    `There are ${nodes.length} ${plural}${range === null ? '' : `, ids ${range}`}, alongside`,
    '`0000-template.md`: ' + `${describeStatusCounts(nodes)}.`,
    '',
    '| Id | Status | Title |',
    '| --- | --- | --- |',
    ...ordered.map((node) => `| \`${tableCell(node.id)}\` | ${tableCell(node.status)} | ${tableCell(node.title)} |`),
    '',
    MARKER_END,
  ];
  return lines.join('\n');
}

/**
 * Replace the marked block in `text`.
 *
 * Every degenerate marker state throws: a silent no-op here would leave the
 * `git diff --exit-code` gate green while generating nothing.
 */
export function replaceGeneratedBlock(text: string, block: string): string {
  const begins = [...text.matchAll(new RegExp(escapeRegExp(MARKER_BEGIN), 'gu'))];
  const ends = [...text.matchAll(new RegExp(escapeRegExp(MARKER_END), 'gu'))];

  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(
      `MANIFEST.md must contain exactly one ${MARKER_BEGIN} and one ${MARKER_END} ` +
        `(found ${begins.length} and ${ends.length}). Without them nothing is generated and the ` +
        'no-diff gate would pass while checking nothing.',
    );
  }

  const start = begins[0]!.index;
  const end = ends[0]!.index + MARKER_END.length;
  if (start >= end) {
    throw new Error(`${MARKER_END} appears before ${MARKER_BEGIN} in MANIFEST.md.`);
  }

  return `${text.slice(0, start)}${block}${text.slice(end)}`;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** Parse and validate `adr graph --format json` output. */
export function parseGraphNodes(json: string): GraphNode[] {
  const parsed: unknown = JSON.parse(json);
  const nodes = (parsed as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error('`adr graph --format json` output has no `nodes` array.');
  }

  return nodes.map((node, index) => {
    const { id, title, status } = (node ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof status !== 'string') {
      throw new Error(`graph node ${index} is missing a string id, title, or status.`);
    }
    return { id, title, status };
  });
}

/** Run the read-only CLI and return its `nodes`. */
function readCorpusNodes(): GraphNode[] {
  const result = Bun.spawnSync({
    cmd: ['bun', join(repoRoot, 'packages', 'cli', 'src', 'index.ts'), 'graph', '--format', 'json'],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    // Exit 1 is a corpus error finding; the graph is still emitted, but an
    // inventory generated from a corpus that fails its own lint is not one to
    // commit.
    throw new Error(
      `adr graph --format json exited ${result.exitCode}:\n${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return parseGraphNodes(new TextDecoder().decode(result.stdout));
}

function main(): void {
  const manifestPath = join(repoRoot, 'MANIFEST.md');
  const nodes = readCorpusNodes();
  const current = readFileSync(manifestPath, 'utf8');
  const next = replaceGeneratedBlock(current, renderInventoryBlock(nodes));

  if (next === current) {
    console.log(`emit-manifest: ok - MANIFEST.md already matches the corpus (${nodes.length} records)`);
    return;
  }
  writeFileSync(manifestPath, next);
  console.log(`emit-manifest: wrote MANIFEST.md inventory for ${nodes.length} records`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`emit-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
