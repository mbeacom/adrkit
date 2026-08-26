import type { AdrGraph, GraphEdge, GraphNode } from '@adrkit/core';
import type { GraphFormat } from './command-registry.ts';
import type { StreamStyle } from './presentation.ts';

export type ResolvedGraphFormat = Exclude<GraphFormat, 'auto'>;

export interface TerminalGraphOptions {
  readonly columns: number;
  readonly focus?: string;
  readonly style: StreamStyle;
}

const STATUS_ORDER = ['accepted', 'proposed', 'draft', 'rejected', 'superseded', 'deprecated'] as const;
const EDGE_KIND_ORDER = ['supersedes', 'relatesTo', 'conflictsWith'] as const;
const DENSE_EDGE_THRESHOLD = 24;
const DENSE_NODE_THRESHOLD = 40;
const MAX_FOCUS_EDGES_PER_DIRECTION = 20;
const MAX_HUBS = 8;
const UNSAFE_TERMINAL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const MARK = /\p{Mark}/u;
const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function resolveGraphFormat(format: GraphFormat, stdoutIsTTY: boolean): ResolvedGraphFormat {
  return format === 'auto' ? (stdoutIsTTY ? 'terminal' : 'dot') : format;
}

function cleanText(value: string): string {
  return value.replace(UNSAFE_TERMINAL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}

function clampColumns(columns: number): number {
  return Math.max(40, Math.min(160, Number.isFinite(columns) ? Math.floor(columns) : 100));
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function graphemeWidth(grapheme: string): number {
  if (EMOJI_GRAPHEME.test(grapheme)) return 2;

  let width = 0;
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f || MARK.test(character)) {
      continue;
    }
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }
  return width;
}

function graphemes(value: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(value)].map((segment) => segment.segment);
}

export function terminalDisplayWidth(value: string): number {
  return graphemes(value).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function truncate(value: string, width: number): string {
  if (terminalDisplayWidth(value) <= width) return value;
  if (width <= 3) return '.'.repeat(Math.max(0, width));

  const limit = width - 3;
  let output = '';
  let used = 0;
  for (const grapheme of graphemes(value)) {
    const next = graphemeWidth(grapheme);
    if (used + next > limit) break;
    output += grapheme;
    used += next;
  }
  return `${output}...`;
}

function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (terminalDisplayWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = terminalDisplayWidth(word) <= width ? word : truncate(word, width);
  }
  if (current) lines.push(current);
  return lines;
}

function noteLines(text: string, style: StreamStyle, width: number, indent = ''): string[] {
  const available = Math.max(1, width - terminalDisplayWidth(indent));
  return wrapText(text, available).map((line) => `${indent}${style.note(line)}`);
}

function nodeHeader(
  node: Pick<GraphNode, 'id' | 'status'>,
  style: StreamStyle,
  width: number,
  preferredIndent = '',
): string {
  const indent =
    terminalDisplayWidth(`${preferredIndent}${node.id} [${node.status}]`) <= width
      ? preferredIndent
      : '';
  return `${indent}${style.label(node.id)} [${style.status(node.status)}]`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function statusText(status: string, style: StreamStyle): string {
  return style.status(status);
}

function edgeKindText(kind: GraphEdge['kind'], style: StreamStyle, text: string = kind): string {
  switch (kind) {
    case 'supersedes':
      return style.magenta(text);
    case 'relatesTo':
      return style.cyan(text);
    case 'conflictsWith':
      return style.red(text);
  }
}

function graphCounts(graph: AdrGraph, style: StreamStyle): string[] {
  const statusCounts = new Map<string, number>();
  for (const node of graph.nodes) statusCounts.set(node.status, (statusCounts.get(node.status) ?? 0) + 1);

  const relationshipCounts = new Map<GraphEdge['kind'], number>();
  for (const edge of graph.edges) {
    relationshipCounts.set(edge.kind, (relationshipCounts.get(edge.kind) ?? 0) + 1);
  }

  const maxStatusCount = Math.max(1, ...statusCounts.values());
  const lines = [style.heading('Status')];
  for (const status of STATUS_ORDER) {
    const count = statusCounts.get(status) ?? 0;
    if (count === 0) continue;
    const bar = '#'.repeat(Math.max(1, Math.round((count / maxStatusCount) * 20)));
    const paddedStatus = `${statusText(status, style)}${' '.repeat(Math.max(0, 12 - status.length))}`;
    lines.push(`  ${paddedStatus} ${String(count).padStart(3)}  ${bar}`);
  }

  const extraStatuses = [...statusCounts.keys()]
    .filter((status) => !STATUS_ORDER.includes(status as (typeof STATUS_ORDER)[number]))
    .sort();
  for (const status of extraStatuses) {
    const count = statusCounts.get(status)!;
    const bar = '#'.repeat(Math.max(1, Math.round((count / maxStatusCount) * 20)));
    const paddedStatus = `${statusText(status, style)}${' '.repeat(Math.max(0, 12 - status.length))}`;
    lines.push(`  ${paddedStatus} ${String(count).padStart(3)}  ${bar}`);
  }

  lines.push('', style.heading('Relationships'));
  for (const kind of EDGE_KIND_ORDER) {
    const count = relationshipCounts.get(kind) ?? 0;
    if (count > 0) {
      lines.push(`  ${edgeKindText(kind, style, kind.padEnd(14))} ${String(count).padStart(3)}`);
    }
  }
  return lines;
}

function nodeLines(node: GraphNode, style: StreamStyle, width: number): string[] {
  const prefix = `${node.id} [${node.status}] `;
  const available = width - terminalDisplayWidth(prefix);
  if (available >= 3) {
    return [
      `${nodeHeader(node, style, width)} ${truncate(cleanText(node.title), available)}`,
    ];
  }
  return [
    nodeHeader(node, style, width),
    `  ${truncate(cleanText(node.title), Math.max(1, width - 2))}`,
  ];
}

function edgeLines(edge: GraphEdge, style: StreamStyle, width: number): string[] {
  const plain = `  ${edge.from} --${edge.kind}--> ${edge.to}`;
  if (terminalDisplayWidth(plain) <= width) {
    return [`  ${edge.from} --${edgeKindText(edge.kind, style)}--> ${edge.to}`];
  }
  return [
    `  ${edge.from}`,
    `  --${edgeKindText(edge.kind, style)}-->`,
    `  ${edge.to}`,
  ];
}

function renderFocusedGraph(graph: AdrGraph, options: TerminalGraphOptions, width: number): string[] {
  const focus = graph.nodes.find((node) => node.id === options.focus);
  if (!focus) return [options.style.note(`Focus ${options.focus ?? ''} is not present in this view.`)];

  const incoming = graph.edges.filter((edge) => edge.to === focus.id);
  const outgoing = graph.edges.filter((edge) => edge.from === focus.id);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const focusHeading = `Focus ${focus.id} [${focus.status}]`;
  const lines =
    terminalDisplayWidth(focusHeading) <= width
      ? [`${options.style.heading(`Focus ${focus.id}`)} [${options.style.status(focus.status)}]`]
      : [options.style.heading(`Focus ${focus.id}`), `  [${options.style.status(focus.status)}]`];
  lines.push(
    `  ${truncate(cleanText(focus.title), Math.max(1, width - 2))}`,
    `  ${incoming.length} incoming | ${outgoing.length} outgoing`,
  );

  if (outgoing.length > 0) {
    lines.push('', options.style.heading('Outgoing'));
    const visible = outgoing.slice(0, MAX_FOCUS_EDGES_PER_DIRECTION);
    for (const edge of visible) {
      const target = nodesById.get(edge.to);
      const plainPrefix = `  --${edge.kind}--> ${edge.to}${target ? ` [${target.status}] ` : ''}`;
      const available = width - terminalDisplayWidth(plainPrefix);
      if (!target || available >= 3) {
        const suffix = target
          ? ` [${options.style.status(target.status)}] ${truncate(cleanText(target.title), available)}`
          : '';
        lines.push(`  --${edgeKindText(edge.kind, options.style)}--> ${edge.to}${suffix}`);
        continue;
      }
      lines.push(`  --${edgeKindText(edge.kind, options.style)}-->`);
      lines.push(nodeHeader(target, options.style, width, '  '));
      lines.push(`    ${truncate(cleanText(target.title), Math.max(1, width - 4))}`);
    }
    if (visible.length < outgoing.length) {
      lines.push(
        ...noteLines(
          `... ${outgoing.length - visible.length} more outgoing relationships; use --kind or --format json.`,
          options.style,
          width,
          '  ',
        ),
      );
    }
  }

  if (incoming.length > 0) {
    lines.push('', options.style.heading('Incoming'));
    const visible = incoming.slice(0, MAX_FOCUS_EDGES_PER_DIRECTION);
    for (const edge of visible) {
      const source = nodesById.get(edge.from);
      const plainPrefix = `  ${edge.from}${source ? ` [${source.status}] ` : ''}`;
      const plainSuffix = ` --${edge.kind}--> ${focus.id}`;
      const available =
        width - terminalDisplayWidth(plainPrefix) - terminalDisplayWidth(plainSuffix);
      if (!source || available >= 3) {
        const title = source ? ` ${truncate(cleanText(source.title), available)}` : '';
        const status = source ? ` [${options.style.status(source.status)}]` : '';
        lines.push(
          `  ${edge.from}${status}${title} --${edgeKindText(edge.kind, options.style)}--> ${focus.id}`,
        );
        continue;
      }
      lines.push(nodeHeader(source, options.style, width, '  '));
      lines.push(`    ${truncate(cleanText(source.title), Math.max(1, width - 4))}`);
      const relation = `  --${edge.kind}--> ${focus.id}`;
      if (terminalDisplayWidth(relation) <= width) {
        lines.push(`  --${edgeKindText(edge.kind, options.style)}--> ${focus.id}`);
      } else {
        lines.push(`  --${edgeKindText(edge.kind, options.style)}-->`, `  ${focus.id}`);
      }
    }
    if (visible.length < incoming.length) {
      lines.push(
        ...noteLines(
          `... ${incoming.length - visible.length} more incoming relationships; use --kind or --format json.`,
          options.style,
          width,
          '  ',
        ),
      );
    }
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    lines.push('', options.style.note('No relationships match this view.'));
  }
  return lines;
}

function renderSparseGraph(graph: AdrGraph, style: StreamStyle, width: number): string[] {
  const lines = [style.heading('Decisions')];
  for (const node of graph.nodes) lines.push(...nodeLines(node, style, width));

  lines.push('', style.heading('Relationship map'));
  if (graph.edges.length === 0) {
    lines.push(`  ${style.note('No relationships in this view.')}`);
  } else {
    for (const edge of graph.edges) lines.push(...edgeLines(edge, style, width));
  }
  return lines;
}

function renderDenseGraph(graph: AdrGraph, style: StreamStyle, width: number): string[] {
  const links = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    links.set(edge.from, (links.get(edge.from) ?? 0) + 1);
    links.set(edge.to, (links.get(edge.to) ?? 0) + 1);
  }

  const hubs = [...graph.nodes]
    .sort((a, b) => (links.get(b.id) ?? 0) - (links.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_HUBS);
  const lines = [style.heading('Most connected')];
  for (const node of hubs) {
    const count = links.get(node.id) ?? 0;
    const countText = String(count).padStart(3);
    const prefix = `  ${node.id} [${node.status}] ${countText} ${plural(count, 'link')}  `;
    const available = width - terminalDisplayWidth(prefix);
    if (available >= 3) {
      lines.push(
        `  ${style.label(node.id)} [${style.status(node.status)}] ${countText} ${plural(
          count,
          'link',
        )}  ${truncate(cleanText(node.title), available)}`,
      );
      continue;
    }
    lines.push(nodeHeader(node, style, width, '  '));
    const linkPrefix = `  ${count} ${plural(count, 'link')}  `;
    lines.push(
      `${linkPrefix}${truncate(
        cleanText(node.title),
        Math.max(1, width - terminalDisplayWidth(linkPrefix)),
      )}`,
    );
  }

  const suggestedFocus = hubs[0]?.id;
  lines.push(
    '',
    ...noteLines(
      suggestedFocus
        ? `Dense graph: use \`adr graph --focus ${suggestedFocus}\` or \`--kind supersedes\` for a readable subgraph.`
        : 'Dense graph: use --focus or --kind for a readable subgraph.',
      style,
      width,
    ),
  );
  return lines;
}

export function renderTerminalGraph(graph: AdrGraph, options: TerminalGraphOptions): string {
  const width = clampColumns(options.columns);
  const lines = [
    options.style.heading('ADR decision graph'),
    `${graph.nodes.length} ${plural(graph.nodes.length, 'decision')} | ${graph.edges.length} ${plural(
      graph.edges.length,
      'relationship',
    )}`,
  ];

  if (graph.nodes.length === 0) {
    lines.push('', options.style.note('No decisions match this view.'));
    return `${lines.join('\n')}\n`;
  }

  lines.push('', ...graphCounts(graph, options.style), '');
  if (options.focus) {
    lines.push(...renderFocusedGraph(graph, options, width));
  } else if (graph.nodes.length <= DENSE_NODE_THRESHOLD && graph.edges.length <= DENSE_EDGE_THRESHOLD) {
    lines.push(...renderSparseGraph(graph, options.style, width));
  } else {
    lines.push(...renderDenseGraph(graph, options.style, width));
  }
  return `${lines.join('\n')}\n`;
}
