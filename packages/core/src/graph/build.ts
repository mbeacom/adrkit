import type { Adr, Status as AdrStatus } from '../schema/adr.schema.ts';

export interface GraphNode {
  id: string;
  title: string;
  status: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'supersedes' | 'relatesTo' | 'conflictsWith';
}

export interface AdrGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AdrGraphFilter {
  readonly focus?: string;
  readonly kinds?: readonly GraphEdge['kind'][];
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
}

function pushEdge(edges: Map<string, GraphEdge>, ids: Set<string>, edge: GraphEdge): void {
  if (!ids.has(edge.from) || !ids.has(edge.to)) return;
  edges.set(edgeKey(edge), edge);
}

export function buildAdrGraph(records: readonly Adr[]): AdrGraph {
  const sortedRecords = [...records].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
  const ids = new Set(sortedRecords.map((record) => record.frontmatter.id));
  const edges = new Map<string, GraphEdge>();

  for (const record of sortedRecords) {
    for (const superseded of record.frontmatter.supersedes) {
      pushEdge(edges, ids, { from: record.frontmatter.id, to: superseded, kind: 'supersedes' });
    }

    if (record.frontmatter.supersededBy) {
      pushEdge(edges, ids, {
        from: record.frontmatter.supersededBy,
        to: record.frontmatter.id,
        kind: 'supersedes',
      });
    }

    for (const related of record.frontmatter.relatesTo) {
      pushEdge(edges, ids, { from: record.frontmatter.id, to: related, kind: 'relatesTo' });
    }

    for (const conflict of record.frontmatter.conflictsWith) {
      pushEdge(edges, ids, { from: record.frontmatter.id, to: conflict, kind: 'conflictsWith' });
    }
  }

  return {
    nodes: sortedRecords.map((record) => ({
      id: record.frontmatter.id,
      title: record.frontmatter.title,
      status: record.frontmatter.status,
    })),
    edges: [...edges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
    ),
  };
}

export function filterAdrGraph(graph: AdrGraph, filter: AdrGraphFilter): AdrGraph {
  const focus = filter.focus;
  const hasFocus = focus !== undefined;
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : undefined;
  const edges = graph.edges.filter(
    (edge) =>
      (!kinds || kinds.has(edge.kind)) &&
      (!hasFocus || edge.from === focus || edge.to === focus),
  );

  if (!hasFocus && !kinds) {
    return { nodes: [...graph.nodes], edges: [...graph.edges] };
  }

  const includedIds = new Set<string>();
  if (focus !== undefined && graph.nodes.some((node) => node.id === focus)) includedIds.add(focus);
  for (const edge of edges) {
    includedIds.add(edge.from);
    includedIds.add(edge.to);
  }

  return {
    nodes: graph.nodes.filter((node) => includedIds.has(node.id)),
    edges,
  };
}

function dotString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')}"`;
}

interface DotNodeStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
}

const GRAPH_NODE_STYLES = {
  accepted: { fill: '#FFFFFF', stroke: '#50709B', text: '#2B2826' },
  proposed: { fill: '#F6F6F5', stroke: '#C45D45', text: '#2B2826' },
  draft: { fill: '#F6F6F5', stroke: '#D8D3CE', text: '#2B2826' },
  rejected: { fill: '#FFFFFF', stroke: '#8F3F2F', text: '#8F3F2F' },
  superseded: { fill: '#F6F6F5', stroke: '#6B6661', text: '#6B6661' },
  deprecated: { fill: '#FFFFFF', stroke: '#C45D45', text: '#6B6661' },
} as const satisfies Record<AdrStatus, DotNodeStyle>;

const DEFAULT_DOT_NODE_STYLE: DotNodeStyle = {
  fill: '#F6F6F5',
  stroke: '#D8D3CE',
  text: '#2B2826',
};

function dotEdgeAttributes(kind: GraphEdge['kind']): string {
  switch (kind) {
    case 'supersedes':
      return 'color="#C45D45", fontcolor="#8F3F2F", penwidth="2.0"';
    case 'relatesTo':
      return 'color="#50709B", fontcolor="#50709B", style="dashed"';
    case 'conflictsWith':
      return 'color="#8F3F2F", fontcolor="#8F3F2F", style="dotted", penwidth="2.0"';
  }
}

export function renderDotGraph(graph: AdrGraph): string {
  const lines = [
    'digraph adr {',
    '  rankdir=LR;',
    '  graph [bgcolor="transparent", pad="0.25", nodesep="0.35", ranksep="0.75", outputorder="edgesfirst"];',
    '  node [shape="box", style="rounded,filled", fontname="Helvetica", fontsize="10", margin="0.14,0.08"];',
    '  edge [fontname="Helvetica", fontsize="9", arrowsize="0.7"];',
  ];
  for (const node of graph.nodes) {
    const nodeStyle = Object.hasOwn(GRAPH_NODE_STYLES, node.status)
      ? GRAPH_NODE_STYLES[node.status as AdrStatus]
      : DEFAULT_DOT_NODE_STYLE;
    lines.push(
      `  ${dotString(node.id)} [label=${dotString(`${node.id} [${node.status}]\n${node.title}`)}, status=${dotString(
        node.status,
      )}, fillcolor=${dotString(nodeStyle.fill)}, color=${dotString(nodeStyle.stroke)}, fontcolor=${dotString(
        nodeStyle.text,
      )}];`,
    );
  }
  for (const edge of graph.edges) {
    lines.push(
      `  ${dotString(edge.from)} -> ${dotString(edge.to)} [label=${dotString(edge.kind)}, ${dotEdgeAttributes(
        edge.kind,
      )}];`,
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function renderJsonGraph(graph: AdrGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function mermaidClassDefinitions(): string[] {
  return [
    ...Object.entries(GRAPH_NODE_STYLES).map(
      ([status, style]) =>
        `  classDef ${status} fill:${style.fill},stroke:${style.stroke},color:${style.text};`,
    ),
    `  classDef unknown fill:${DEFAULT_DOT_NODE_STYLE.fill},stroke:${DEFAULT_DOT_NODE_STYLE.stroke},color:${DEFAULT_DOT_NODE_STYLE.text};`,
  ];
}

function mermaidLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br/>');
}

function mermaidClass(status: string): string {
  return Object.hasOwn(GRAPH_NODE_STYLES, status) ? status : 'unknown';
}

function mermaidEdge(edge: GraphEdge, from: string, to: string): string {
  switch (edge.kind) {
    case 'supersedes':
      return `  ${from} -->|supersedes| ${to}`;
    case 'relatesTo':
      return `  ${from} -.->|relatesTo| ${to}`;
    case 'conflictsWith':
      return `  ${from} ==>|conflictsWith| ${to}`;
  }
}

export function renderMermaidGraph(graph: AdrGraph): string {
  const nodeNames = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ['flowchart LR'];

  for (const node of graph.nodes) {
    const name = nodeNames.get(node.id)!;
    lines.push(
      `  ${name}["${mermaidLabel(`${node.id} [${node.status}]\n${node.title}`)}"]:::${mermaidClass(node.status)}`,
    );
  }

  for (const edge of graph.edges) {
    const from = nodeNames.get(edge.from);
    const to = nodeNames.get(edge.to);
    if (from && to) lines.push(mermaidEdge(edge, from, to));
  }

  lines.push(...mermaidClassDefinitions());
  return `${lines.join('\n')}\n`;
}
