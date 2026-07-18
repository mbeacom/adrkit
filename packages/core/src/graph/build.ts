import type { Adr } from '../schema/adr.schema.ts';

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

function dotString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')}"`;
}

export function renderDotGraph(graph: AdrGraph): string {
  const lines = ['digraph adr {', '  rankdir=LR;'];
  for (const node of graph.nodes) {
    lines.push(
      `  ${dotString(node.id)} [label=${dotString(`${node.id}: ${node.title}`)}, status=${dotString(
        node.status,
      )}];`,
    );
  }
  for (const edge of graph.edges) {
    lines.push(`  ${dotString(edge.from)} -> ${dotString(edge.to)} [label=${dotString(edge.kind)}];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function renderJsonGraph(graph: AdrGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}
