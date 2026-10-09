// @ts-check
/**
 * The decision board's layout (ADR-0050): a pure, deterministic function from
 * the `{ nodes, edges }` that `adr graph --format json` prints to positions.
 *
 * It runs on the server, never in the page, so it can be tested under Node and
 * the page only draws coordinates. It reads no clock, no file, and no process.
 *
 * - Columns come from supersession alone. A `supersedes` edge runs from the
 *   successor to the record it replaces (that is how `buildAdrGraph` emits both
 *   `supersedes` and `supersededBy`), so the replaced record sits one column to
 *   the left and a chain reads left to right, oldest first. `relatesTo` and
 *   `conflictsWith` have no direction worth a column and do not move a record.
 * - A cycle (which only a malformed corpus can hold) cannot hang it: layering
 *   relaxes at most once per record and is capped below the record count.
 * - Every tie breaks by id, compared by code unit, so the same graph in any
 *   order lays out identically.
 * - Past `maxNodes` it returns counts by status instead of positions, as the
 *   terminal view of `adr graph` (ADR-0033) summarizes a dense corpus and asks
 *   for a focus rather than drawing an unreadable network.
 */

/** The most records the board draws; past it, the board shows a summary. */
export const NODE_LIMIT = 300;
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 56;
export const COLUMN_GAP = 72;
export const ROW_GAP = 20;
export const MARGIN = 16;
/** Columns for records outside any supersession chain, when chains are narrower. */
export const LOOSE_COLUMNS = 4;

/**
 * @typedef {{ id: string, title?: string, status?: string }} LayoutNode
 * @typedef {{ from: string, to: string, kind: string }} LayoutEdge
 * @typedef {{ id: string, x: number, y: number, layer: number }} Position
 * @typedef {{ mode: 'graph', width: number, height: number, positions: Position[] }} GraphLayout
 * @typedef {{ mode: 'summary', totalNodes: number, totalEdges: number, byStatus: Array<{ status: string, count: number }> }} SummaryLayout
 */

/** Code-unit order, independent of locale. @param {string} a @param {string} b */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {{ nodes: LayoutNode[], edges: LayoutEdge[] }} graph
 * @param {{ maxNodes?: number }} [options]
 * @returns {GraphLayout | SummaryLayout}
 */
export function layoutBoard({ nodes, edges }, { maxNodes = NODE_LIMIT } = {}) {
  const ids = [...new Set(nodes.map((node) => node.id))].sort(byCodeUnit);

  if (ids.length > maxNodes) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    const seen = new Set();
    for (const node of nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const status = typeof node.status === 'string' ? node.status : 'unknown';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return {
      mode: 'summary',
      totalNodes: ids.length,
      totalEdges: edges.length,
      byStatus: [...counts.entries()]
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([status, count]) => ({ status, count })),
    };
  }

  const known = new Set(ids);
  /** Successor → replaced, deduplicated and sorted. */
  const chain = [
    ...new Map(
      edges
        .filter((edge) => edge.kind === 'supersedes' && edge.from !== edge.to && known.has(edge.from) && known.has(edge.to))
        .map((edge) => [`${edge.from}\0${edge.to}`, { from: edge.from, to: edge.to }]),
    ).values(),
  ].sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to));

  // Longest path from the oldest record: relax at most once per record, and
  // never past the record count, so a cycle stops instead of climbing.
  /** @type {Map<string, number>} */
  const layer = new Map(ids.map((id) => [id, 0]));
  const cap = Math.max(0, ids.length - 1);
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const { from, to } of chain) {
      const next = Math.min(cap, /** @type {number} */ (layer.get(to)) + 1);
      if (next > /** @type {number} */ (layer.get(from))) {
        layer.set(from, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Records joined by supersession form a component; each component gets its
  // own band of rows, in order of its smallest id.
  /** @type {Map<string, string>} */
  const parent = new Map(ids.map((id) => [id, id]));
  /** @param {string} id @returns {string} */
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
    parent.set(id, root);
    return root;
  };
  for (const { from, to } of chain) {
    const a = find(from);
    const b = find(to);
    if (a !== b) parent.set(byCodeUnit(a, b) <= 0 ? b : a, byCodeUnit(a, b) <= 0 ? a : b);
  }
  /** @type {Map<string, string[]>} */
  const components = new Map();
  for (const id of ids) {
    const root = find(id);
    const members = components.get(root) ?? [];
    members.push(id);
    components.set(root, members);
  }
  const chained = [...components.values()].filter((members) => members.length > 1);
  const loose = [...components.values()].filter((members) => members.length === 1).map((members) => /** @type {string} */ (members[0]));
  chained.sort((a, b) => byCodeUnit(/** @type {string} */ (a[0]), /** @type {string} */ (b[0])));

  /** @type {Map<string, { col: number, row: number }>} */
  const cells = new Map();
  let row = 0;
  let maxLayer = 0;
  for (const members of chained) {
    /** @type {Map<number, string[]>} */
    const columns = new Map();
    for (const id of members) {
      const at = /** @type {number} */ (layer.get(id));
      maxLayer = Math.max(maxLayer, at);
      const column = columns.get(at) ?? [];
      column.push(id);
      columns.set(at, column);
    }
    let rows = 0;
    for (const [col, column] of columns) {
      column.sort(byCodeUnit);
      column.forEach((id, index) => cells.set(id, { col, row: row + index }));
      rows = Math.max(rows, column.length);
    }
    row += rows;
  }
  const looseColumns = Math.max(maxLayer + 1, LOOSE_COLUMNS);
  loose.sort(byCodeUnit);
  loose.forEach((id, index) => cells.set(id, { col: index % looseColumns, row: row + Math.floor(index / looseColumns) }));

  let cols = 0;
  let rowsUsed = 0;
  /** @type {Position[]} */
  const positions = ids.map((id) => {
    const cell = /** @type {{ col: number, row: number }} */ (cells.get(id));
    cols = Math.max(cols, cell.col + 1);
    rowsUsed = Math.max(rowsUsed, cell.row + 1);
    return {
      id,
      x: MARGIN + cell.col * (NODE_WIDTH + COLUMN_GAP),
      y: MARGIN + cell.row * (NODE_HEIGHT + ROW_GAP),
      layer: /** @type {number} */ (layer.get(id)),
    };
  });
  const span = (/** @type {number} */ count, /** @type {number} */ size, /** @type {number} */ gap) =>
    count === 0 ? 0 : count * size + (count - 1) * gap;
  return {
    mode: 'graph',
    width: MARGIN * 2 + span(cols, NODE_WIDTH, COLUMN_GAP),
    height: MARGIN * 2 + span(rowsUsed, NODE_HEIGHT, ROW_GAP),
    positions,
  };
}
