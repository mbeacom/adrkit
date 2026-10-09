import { describe, expect, test } from 'bun:test';
import {
  COLUMN_GAP,
  MAX_EXTENT,
  NODE_LIMIT,
  NODE_WIDTH,
  layoutBoard,
} from '../extensions/adrkit/board-layout.mjs';

/**
 * The decision board's layout (ADR-0050), a pure function from the CLI's own
 * `adr graph --format json` shape to positions. It runs on the server, so the
 * page draws coordinates and has no layout logic of its own to disagree with.
 */

type Edge = { from: string; to: string; kind: string };
type Pos = { id: string; x: number; y: number; layer: number };
const node = (id: string, status = 'accepted') => ({ id, title: `Decision ${id}`, status });
const supersedes = (from: string, to: string): Edge => ({ from, to, kind: 'supersedes' });

function positionsOf(result: ReturnType<typeof layoutBoard>) {
  if (result.mode !== 'graph') throw new Error(`expected a graph layout, got ${result.mode}`);
  return new Map(result.positions.map((p: { id: string; x: number; y: number; layer: number }) => [p.id, p]));
}

describe('layoutBoard', () => {
  test('is deterministic: the same graph in any order lays out identically', () => {
    const nodes = ['0005', '0001', '0004', '0002', '0003'].map((id) => node(id));
    const edges = [supersedes('0002', '0001'), { from: '0004', to: '0003', kind: 'relatesTo' }, supersedes('0005', '0002')];
    const first = layoutBoard({ nodes, edges });
    const second = layoutBoard({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('ties break by id: unrelated records fill rows in id order', () => {
    const result = layoutBoard({ nodes: ['0003', '0001', '0002'].map((id) => node(id)), edges: [] });
    const positions = positionsOf(result);
    const order = [...positions.values()].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id);
    expect(order).toEqual(['0001', '0002', '0003']);
  });

  test('a supersession chain runs left to right, oldest first, on one row', () => {
    // 0002 supersedes 0001, and 0003 supersedes 0002: the successor is to the right.
    const result = layoutBoard({
      nodes: ['0001', '0002', '0003'].map((id) => node(id)),
      edges: [supersedes('0003', '0002'), supersedes('0002', '0001')],
    });
    const positions = positionsOf(result);
    const [a, b, c] = ['0001', '0002', '0003'].map((id) => positions.get(id)!) as [Pos, Pos, Pos];
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(new Set([a.y, b.y, c.y]).size).toBe(1);
    expect([a.layer, b.layer, c.layer]).toEqual([0, 1, 2]);
    expect(b.x - a.x).toBe(NODE_WIDTH + COLUMN_GAP);
  });

  test('relatesTo and conflictsWith do not move a record out of its column', () => {
    const result = layoutBoard({
      nodes: ['0001', '0002'].map((id) => node(id)),
      edges: [
        { from: '0002', to: '0001', kind: 'relatesTo' },
        { from: '0001', to: '0002', kind: 'conflictsWith' },
      ],
    });
    const positions = positionsOf(result);
    expect(positions.get('0001')!.layer).toBe(0);
    expect(positions.get('0002')!.layer).toBe(0);
  });

  test('a supersession cycle terminates and still places every record', () => {
    const result = layoutBoard({
      nodes: ['0001', '0002', '0003'].map((id) => node(id)),
      edges: [supersedes('0001', '0002'), supersedes('0002', '0003'), supersedes('0003', '0001'), supersedes('0001', '0001')],
    });
    const positions = positionsOf(result);
    expect(positions.size).toBe(3);
    for (const p of positions.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.layer).toBeLessThan(3);
    }
  });

  test('edges naming a record the graph lacks are ignored', () => {
    const result = layoutBoard({ nodes: [node('0001')], edges: [supersedes('0001', '0999'), supersedes('0998', '0001')] });
    expect(positionsOf(result).get('0001')!.layer).toBe(0);
  });

  test('the width and height cover every node', () => {
    const result = layoutBoard({
      nodes: Array.from({ length: 23 }, (_, i) => node(String(i + 1).padStart(4, '0'))),
      edges: [supersedes('0002', '0001')],
    });
    if (result.mode !== 'graph') throw new Error('expected a graph');
    for (const p of result.positions) {
      expect(p.x + NODE_WIDTH).toBeLessThanOrEqual(result.width);
      expect(p.y).toBeLessThan(result.height);
    }
  });

  test('past the node budget it returns a summary by status, not positions', () => {
    const nodes = Array.from({ length: NODE_LIMIT + 1 }, (_, i) =>
      node(String(i + 1).padStart(4, '0'), i % 3 === 0 ? 'proposed' : 'accepted'),
    );
    const result = layoutBoard({ nodes, edges: [supersedes('0002', '0001')] });
    expect(result.mode).toBe('summary');
    if (result.mode !== 'summary') return;
    expect(result.totalNodes).toBe(NODE_LIMIT + 1);
    expect(result.totalEdges).toBe(1);
    expect(result.byStatus).toEqual([
      { status: 'accepted', count: 200 },
      { status: 'proposed', count: 101 },
    ]);
    expect('positions' in result).toBe(false);
    expect(NODE_LIMIT).toBe(300);
  });

  test('an empty graph is a valid, empty layout', () => {
    const result = layoutBoard({ nodes: [], edges: [] });
    expect(result.mode).toBe('graph');
    if (result.mode === 'graph') expect(result.positions).toEqual([]);
  });

  test('a layout past the extent cap becomes a summary with reason extent (review L6)', () => {
    const n = 300;
    const nodes = Array.from({ length: n }, (_, i) => node(String(i).padStart(4, '0')));
    const edges = nodes.map((x, i) => supersedes(x.id, (nodes[(i + 1) % n] as { id: string }).id));
    const result = layoutBoard({ nodes, edges });
    expect(result.mode).toBe('summary');
    if (result.mode === 'summary') expect(result.reason).toBe('extent');
    expect(MAX_EXTENT).toBe(20_000);
    // A short chain stays drawn.
    expect(layoutBoard({ nodes: nodes.slice(0, 3), edges: [supersedes('0001', '0000')] }).mode).toBe('graph');
  });
});
