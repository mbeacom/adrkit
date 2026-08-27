/**
 * `emit-manifest` — and the negative cases that make the gate mean something.
 *
 * The gate `clean-clone-builds` runs is `bun run emit:manifest && git diff
 * --exit-code MANIFEST.md`. That composition has exactly one failure mode worth
 * fearing: a generator that writes *nothing* leaves the diff clean, so the gate
 * reports green while checking nothing — the ADR-0016 shape this repository
 * keeps finding. So the cases below drive the degenerate marker states, the
 * empty corpus, and a deliberately stale MANIFEST, and assert each is caught
 * rather than passed over.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MARKER_BEGIN,
  MARKER_END,
  describeIdRange,
  describeStatusCounts,
  parseGraphNodes,
  renderInventoryBlock,
  replaceGeneratedBlock,
  type GraphNode,
} from './emit-manifest.ts';

const REPO_ROOT = join(import.meta.dir, '..');

const node = (id: string, status = 'accepted', title = `Title ${id}`): GraphNode => ({ id, title, status });

const THREE: GraphNode[] = [node('0001'), node('0002', 'superseded'), node('0003')];

function surround(block: string): string {
  return `# Manifest\n\nPreamble.\n\n${block}\n\nTrailing prose.\n`;
}

describe('describeIdRange', () => {
  test('a contiguous numeric run is reported as a range', () => {
    expect(describeIdRange(['0001', '0002', '0003'])).toBe('`0001`-`0003`');
  });

  test('a gap yields no range rather than a wrong one', () => {
    // The failure this prevents: `0001`-`0004` claiming a record that is not there.
    expect(describeIdRange(['0001', '0002', '0004'])).toBeNull();
  });

  test('ULID ids yield no range', () => {
    // The grammar admits 26-character Crockford base32; "from X to Y" means
    // nothing over those, so the sentence is omitted.
    expect(describeIdRange(['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01BX5ZZKBKACTAV9WEVGEMMVRZ'])).toBeNull();
  });

  test('mixed widths yield no range', () => {
    expect(describeIdRange(['0001', '00002'])).toBeNull();
  });

  test('a single record is its own range', () => {
    expect(describeIdRange(['0007'])).toBe('`0007`-`0007`');
  });

  test('an empty corpus has no range', () => {
    expect(describeIdRange([])).toBeNull();
  });
});

describe('describeStatusCounts', () => {
  test('counts every status the corpus carries', () => {
    expect(describeStatusCounts(THREE)).toBe('2 accepted, 1 superseded');
  });

  test('orders statuses by code unit, not by locale', () => {
    // 'S' (0x53) sorts before 'a' (0x61) by code unit; a locale-aware
    // comparison typically interleaves the cases instead.
    const mixed = [node('0001', 'accepted'), node('0002', 'Superseded')];
    expect('S'.localeCompare('a')).toBeGreaterThan(0);
    expect(describeStatusCounts(mixed)).toBe('1 Superseded, 1 accepted');
  });
});

describe('renderInventoryBlock', () => {
  const block = renderInventoryBlock(THREE);

  test('carries both markers and a row per record', () => {
    expect(block.startsWith(MARKER_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(MARKER_END)).toBe(true);
    expect(block).toContain('| `0001` | accepted | Title 0001 |');
    expect(block).toContain('| `0002` | superseded | Title 0002 |');
    expect(block).toContain('There are 3 records, ids `0001`-`0003`, alongside');
    expect(block).toContain('2 accepted, 1 superseded.');
  });

  test('orders rows by code unit whatever order the graph supplied', () => {
    const reversed = renderInventoryBlock([...THREE].reverse());
    const ids = [...reversed.matchAll(/^\| `(\d+)`/gmu)].map((match) => match[1]);
    expect(ids).toEqual(['0001', '0002', '0003']);
    expect(reversed).toBe(renderInventoryBlock(THREE));
  });

  test('normalizes away the upstream locale ordering', () => {
    // `buildAdrGraph` sorts with `localeCompare`, and ADR-0033 clause 8 pins
    // that ordering, so the gate cannot rest on it: the same records would
    // render in a different row order under a different ICU locale and
    // `git diff --exit-code` would fail with nothing changed. The id grammar
    // admits mixed-case ULIDs, where the two comparators genuinely disagree.
    const upper = `A${'0'.repeat(25)}`;
    const lower = `b${'0'.repeat(25)}`;
    expect(upper.localeCompare(lower)).toBeLessThan(0);

    const localeOrder = [node(lower), node(upper)].sort((a, b) => a.id.localeCompare(b.id));
    expect(localeOrder.map((n) => n.id)).toEqual([upper, lower]);

    // And the reverse pair, where locale and code unit disagree outright.
    const zeta = `Z${'0'.repeat(25)}`;
    const alpha = `a${'0'.repeat(25)}`;
    expect(zeta.localeCompare(alpha)).toBeGreaterThan(0);

    const rendered = renderInventoryBlock([node(alpha), node(zeta)]);
    expect(rendered.indexOf(zeta)).toBeLessThan(rendered.indexOf(alpha));
    expect(rendered).toBe(renderInventoryBlock([node(zeta), node(alpha)]));
  });

  test('escapes a pipe in a title rather than breaking the table', () => {
    const rendered = renderInventoryBlock([node('0001', 'accepted', 'Use auto|async|arb')]);
    expect(rendered).toContain('| `0001` | accepted | Use auto\\|async\\|arb |');
  });

  test('a multiline title stays on one row', () => {
    // `title` is `z.string().min(3).max(120)`, which a YAML block scalar can
    // satisfy with an embedded newline. A raw newline in a cell splits one row
    // into two lines of markdown — and the gate would still pass, because the
    // broken table is what regeneration reproduces. Same order as the queue
    // formatter's `escapeCell`: CRLF -> LF, CR -> space, LF -> <br>.
    const rendered = renderInventoryBlock([node('0001', 'accepted', 'First line\r\nsecond\rthird\nfourth')]);
    expect(rendered).toContain('| `0001` | accepted | First line<br>second third<br>fourth |');

    const rows = rendered.split('\n').filter((line) => line.startsWith('| `0001`'));
    expect(rows).toHaveLength(1);
    expect(rendered).not.toMatch(/\r/u);
  });

  test('a title cannot forge a marker on a line of its own', () => {
    // The composition that closes the hole: newline normalization means a title
    // can never *start* a line, so it can never become a standalone marker.
    const rendered = renderInventoryBlock([
      node('0001', 'accepted', `A title\n${MARKER_END}\nand more`),
    ]);
    const forged = rendered
      .split('\n')
      .filter((line) => line.trim() === MARKER_END || line.trim() === MARKER_BEGIN);
    expect(forged).toEqual([MARKER_BEGIN, MARKER_END]);
  });

  test('escapes a backtick, so a title cannot open a code span across the row', () => {
    const rendered = renderInventoryBlock([node('0001', 'accepted', 'Use `adr queue`')]);
    expect(rendered).toContain('| `0001` | accepted | Use \\`adr queue\\` |');
  });

  test('refuses to publish an empty inventory', () => {
    // Negative case: zero records is what a corpus the loader could not see
    // looks like, and it would otherwise be committed as a truthful-looking "0".
    expect(() => renderInventoryBlock([])).toThrow(/no records/u);
  });
});

describe('replaceGeneratedBlock', () => {
  const block = renderInventoryBlock(THREE);

  test('replaces the marked region and leaves the surrounding prose alone', () => {
    const before = surround(`${MARKER_BEGIN}\nstale\n${MARKER_END}`);
    const after = replaceGeneratedBlock(before, block);
    expect(after).toContain('Preamble.');
    expect(after).toContain('Trailing prose.');
    expect(after).not.toContain('stale');
    expect(after).toContain('| `0001` | accepted | Title 0001 |');
  });

  test('is idempotent', () => {
    const once = replaceGeneratedBlock(surround(`${MARKER_BEGIN}\n${MARKER_END}`), block);
    expect(replaceGeneratedBlock(once, block)).toBe(once);
  });

  test('throws when the markers were deleted', () => {
    // Negative case: without this, deleting the markers turns the CI gate into
    // a no-op that still reports success.
    expect(() => replaceGeneratedBlock('# Manifest\n\nNo markers here.\n', block)).toThrow(
      /exactly one .*found 0 and 0/su,
    );
  });

  test('throws when only one marker survives', () => {
    expect(() => replaceGeneratedBlock(surround(MARKER_BEGIN), block)).toThrow(/found 1 and 0/u);
  });

  test('throws when a marker is duplicated', () => {
    const doubled = surround(`${MARKER_BEGIN}\n${MARKER_END}\n${MARKER_BEGIN}\n${MARKER_END}`);
    expect(() => replaceGeneratedBlock(doubled, block)).toThrow(/found 2 and 2/u);
  });

  test('ignores a marker embedded in a table cell', () => {
    // A record whose *title* contains the end marker renders it into a row
    // inside the block. Counting the substring anywhere made that a second
    // marker, so every later run threw `found 1 and 2` — one corpus record
    // permanently disabling the generator that has to render it.
    const poisoned = renderInventoryBlock([
      node('0001', 'accepted', `Ship the thing ${MARKER_END} carefully`),
    ]);
    const document = surround(poisoned);

    // Round-trips: the poisoned row survives, and regeneration is still stable.
    expect(document).toContain(`Ship the thing ${MARKER_END} carefully`);
    expect(replaceGeneratedBlock(document, poisoned)).toBe(document);
    expect(replaceGeneratedBlock(document, block)).toContain('| `0002` | superseded | Title 0002 |');
    expect(replaceGeneratedBlock(document, block)).not.toContain('Ship the thing');
  });

  test('ignores a marker mentioned in prose', () => {
    // The section above the block explains the markers by name; prose that
    // names one must not be mistaken for the delimiter itself.
    const document = `# Manifest\n\nEdit outside ${MARKER_BEGIN} and ${MARKER_END} only.\n\n${MARKER_BEGIN}\n${MARKER_END}\n`;
    expect(replaceGeneratedBlock(document, block)).toContain('| `0001` | accepted | Title 0001 |');
    expect(replaceGeneratedBlock(document, block)).toContain(`Edit outside ${MARKER_BEGIN} and`);
  });

  test('tolerates indentation, trailing whitespace, and CRLF around a real marker', () => {
    const document = `# Manifest\r\n\r\n  ${MARKER_BEGIN}  \r\nstale\r\n${MARKER_END}\t\r\ntail\r\n`;
    const replaced = replaceGeneratedBlock(document, block);
    expect(replaced).not.toContain('stale');
    expect(replaced).toContain('| `0001` | accepted | Title 0001 |');
    expect(replaced).toContain('tail');
  });

  test('throws when the markers are inverted', () => {
    expect(() => replaceGeneratedBlock(surround(`${MARKER_END}\n${MARKER_BEGIN}`), block)).toThrow(
      /appears before/u,
    );
  });
});

describe('parseGraphNodes', () => {
  test('reads the nodes of a graph payload', () => {
    const json = JSON.stringify({ nodes: [{ id: '0001', title: 'T', status: 'accepted' }], edges: [] });
    expect(parseGraphNodes(json)).toEqual([{ id: '0001', title: 'T', status: 'accepted' }]);
  });

  test('throws when the payload has no nodes array', () => {
    expect(() => parseGraphNodes('{"edges":[]}')).toThrow(/no `nodes` array/u);
  });

  test('throws when a node is missing a field', () => {
    // A renamed field would otherwise render as `undefined` in the table.
    expect(() => parseGraphNodes('{"nodes":[{"id":"0001","title":"T"}]}')).toThrow(/node 0 is missing/u);
  });
});

describe('the committed MANIFEST.md is what the corpus says', () => {
  const manifest = readFileSync(join(REPO_ROOT, 'MANIFEST.md'), 'utf8');

  test('it carries exactly one marked block', () => {
    // Guard on the guard: if the markers were removed, every assertion that
    // follows — and the CI gate itself — would be inspecting nothing.
    expect(manifest.split(MARKER_BEGIN).length - 1).toBe(1);
    expect(manifest.split(MARKER_END).length - 1).toBe(1);
  });

  test('the block is populated, not an empty shell', () => {
    const rows = [...manifest.matchAll(/^\| `\d+` \| \w+ \|/gmu)];
    expect(rows.length).toBeGreaterThan(30);
  });

  test('a stale MANIFEST is detected by regeneration', () => {
    // The ADR-0016 negative case for the CI gate, run against the real file:
    // drop a row from the committed inventory and confirm regeneration puts it
    // back — i.e. that `git diff --exit-code` would have something to report.
    const stale = manifest.replace(/^\| `0001` \|.*\n/mu, '');
    expect(stale).not.toBe(manifest);

    const regenerated = replaceGeneratedBlock(
      stale,
      manifest.slice(manifest.indexOf(MARKER_BEGIN), manifest.indexOf(MARKER_END) + MARKER_END.length),
    );
    expect(regenerated).toBe(manifest);
  });
});
