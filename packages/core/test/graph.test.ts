import { describe, expect, test } from 'bun:test';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';
import { buildAdrGraph, renderDotGraph, renderJsonGraph } from '../src/graph/build.ts';

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


  test('escapes newlines in DOT labels', () => {
    const graph = buildAdrGraph([record('0001', { title: 'Use graph\nrecord 0001' })]);
    const dot = renderDotGraph(graph);
    const nodeLine = dot.split('\n').find((line) => line.includes('"0001" [label='));
    expect(nodeLine).toBeDefined();
    expect(nodeLine).toContain('label="0001: Use graph\\nrecord 0001"');
  });

  test('DOT and JSON renderers agree on the node and edge set', () => {
    const graph = buildAdrGraph([record('0001'), record('0002', { relatesTo: ['0001'] })]);
    const dot = renderDotGraph(graph);
    const json = JSON.parse(renderJsonGraph(graph));
    expect(json).toEqual(graph);
    expect(dot).toContain('"0001" [label="0001: Use graph record 0001"');
    expect(dot).toContain('"0002" -> "0001" [label="relatesTo"]');
  });
});
