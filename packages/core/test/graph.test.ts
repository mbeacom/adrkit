import { describe, expect, test } from 'bun:test';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';
import {
  buildAdrGraph,
  filterAdrGraph,
  renderDotGraph,
  renderJsonGraph,
  renderMermaidGraph,
} from '../src/graph/build.ts';

function record(id: string, overrides: Record<string, unknown> = {}): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Use graph record ${id}`,
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects: [],
      provenance: { authoredBy: 'human' },
      ...overrides,
    }),
    body: '',
    path: `docs/adr/${id}-graph.md`,
  };
}

describe('ADR graph', () => {
  test('known superseding pair yields an edge from successor to superseded', () => {
    const graph = buildAdrGraph([
      record('0001', { status: 'superseded', supersededBy: '0002' }),
      record('0002'),
    ]);
    expect(graph.edges).toContainEqual({ from: '0002', to: '0001', kind: 'supersedes' });
  });

  test('edges to missing records are omitted', () => {
    const graph = buildAdrGraph([record('0001', { relatesTo: ['9999'], conflictsWith: ['9998'] })]);
    expect(graph.edges).toEqual([]);
  });


  test('renders polished DOT with visible status and escaped newlines', () => {
    const graph = buildAdrGraph([record('0001', { title: 'Use graph\nrecord 0001' })]);
    const dot = renderDotGraph(graph);
    const nodeLine = dot.split('\n').find((line) => line.includes('"0001" [label='));
    expect(nodeLine).toBeDefined();
    expect(dot).toContain('node [shape="box", style="rounded,filled"');
    expect(nodeLine).toContain('label="0001 [draft]\\nUse graph\\nrecord 0001"');
    expect(nodeLine).toContain('status="draft"');
    expect(nodeLine).toContain('fillcolor="#F6F6F5"');
  });

  test('DOT and JSON renderers agree on the node and edge set', () => {
    const graph = buildAdrGraph([record('0001'), record('0002', { relatesTo: ['0001'] })]);
    const dot = renderDotGraph(graph);
    const json = JSON.parse(renderJsonGraph(graph));
    expect(json).toEqual(graph);
    expect(dot).toContain('"0001" [label="0001 [draft]\\nUse graph record 0001"');
    expect(dot).toContain('"0002" -> "0001" [label="relatesTo",');
  });

  test('filters a graph by focus and relationship kind without mutating it', () => {
    const graph = buildAdrGraph([
      record('0001'),
      record('0002', { supersedes: ['0001'], relatesTo: ['0001'] }),
      record('0003', { relatesTo: ['0002'] }),
    ]);

    const focused = filterAdrGraph(graph, { focus: '0002', kinds: ['relatesTo'] });
    expect(focused.nodes.map((node) => node.id)).toEqual(['0001', '0002', '0003']);
    expect(focused.edges).toEqual([
      { from: '0002', to: '0001', kind: 'relatesTo' },
      { from: '0003', to: '0002', kind: 'relatesTo' },
    ]);

    const supersession = filterAdrGraph(graph, { kinds: ['supersedes'] });
    expect(supersession.nodes.map((node) => node.id)).toEqual(['0001', '0002']);
    expect(supersession.edges).toEqual([{ from: '0002', to: '0001', kind: 'supersedes' }]);
    expect(filterAdrGraph(graph, { focus: '' })).toEqual({ nodes: [], edges: [] });
    expect(graph.edges).toHaveLength(3);
  });

  test('renders deterministic GitHub-compatible Mermaid with escaped labels', () => {
    const graph = buildAdrGraph([
      record('0001', { title: 'Use "quoted" <nodes> & edges' }),
      record('0002', { supersedes: ['0001'], relatesTo: ['0001'], conflictsWith: ['0001'] }),
    ]);

    const mermaid = renderMermaidGraph(graph);
    expect(mermaid).toStartWith('flowchart LR\n');
    expect(mermaid).toContain('n0["0001 [draft]<br/>Use &quot;quoted&quot; &lt;nodes&gt; &amp; edges"]:::draft');
    expect(mermaid).toContain('n1 -->|supersedes| n0');
    expect(mermaid).toContain('n1 -.->|relatesTo| n0');
    expect(mermaid).toContain('n1 ==>|conflictsWith| n0');
    expect(mermaid).toEndWith('\n');
  });

  test('preserves the historical locale ordering used by graph JSON', () => {
    const ids = [`B${'0'.repeat(25)}`, `a${'0'.repeat(25)}`];
    const graph = buildAdrGraph(ids.map((id) => record(id)));

    expect(graph.nodes.map((node) => node.id)).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  test('uses only portable colors documented by the design system', async () => {
    const graph = buildAdrGraph([
      record('0001'),
      record('0002', { status: 'proposed', relatesTo: ['0001'] }),
    ]);
    const colors = new Set(
      `${renderDotGraph(graph)}\n${renderMermaidGraph(graph)}`.match(/#[0-9A-F]{6}/g) ?? [],
    );
    const design = await Bun.file('DESIGN.md').text();

    for (const color of colors) expect(design).toContain(color);
  });
});
