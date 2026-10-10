/**
 * Resource bounds on the Markdown subset parser (ADR-0054 clause 7): a record body is
 * untrusted input to the build, so no input may make the parser's output or time grow faster
 * than its input. Inputs are the security reviewer's probes (scratchpad `probe/scale.ts`).
 *
 * - **Table cells.** A GFM table pads every row to the delimiter row's width, so output was
 *   width × rows from an input of width + rows: `'|' + 'a|'.repeat(N) + …` at N = 10,000 gave
 *   100M cells and 9.6 GB of RSS. A table wider than `MAX_TABLE_COLUMNS` is not a table, and
 *   a document keeps at most `MAX_DOCUMENT_CELLS` cells; past either, the lines are a literal
 *   text paragraph, never padded.
 * - **Bracket deactivation.** After each link every earlier `[` became inactive by walking
 *   the bracket stack, so `'['.repeat(N) + '[a](b)'.repeat(N)` was quadratic (N = 40,000:
 *   3.6 s). Deactivation is now a watermark, O(1) per link.
 *
 * ADR-0016 clause 2: observed failing against the code before the fix, 2026-10-10, macOS,
 * Bun 1.4.2: "a table wider than the column cap is literal text", "the cells of one document
 * are capped across tables", "a wide, long table stays bounded" (4,000,000 cells at N = 2,000),
 * and both bracket timing tests (about 3.6 s and 3.9 s against a 1 s bound) failed. The
 * N = 10,000 table case was not run before the fix, because it needs about 9.6 GB. Against
 * the fixed code: the `MAX_TABLE_COLUMNS` term dropped from `isTableStart` failed "a table
 * wider than the column cap is literal text"; a stack walk put back after each link failed
 * both bracket timing tests.
 */

import { describe, expect, test } from 'bun:test';
import type { BodyBlock, BodyTable } from '../src/data/contract.ts';
import * as markdown from '../src/data/markdown.ts';

const OPTIONS = { basePath: 'docs/adr/0001-a.md', recordPaths: new Map([['docs/adr/0002-b.md', '0002']]) };
const parse = (source: string) => markdown.parseMarkdown(source, OPTIONS);
const COLUMNS = 64;
const CELLS = 10_000;

const tables = (blocks: BodyBlock[]) => blocks.filter((block): block is BodyTable => block.type === 'table');
const cellCount = (blocks: BodyBlock[]) => tables(blocks).reduce((sum, table) => sum + table.align.length * (table.rows.length + 1), 0);
const wideTable = (width: number, rows: number) => '|' + 'a|'.repeat(width) + '\n|' + '-|'.repeat(width) + '\n' + 'x\n'.repeat(rows);

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe('table bounds', () => {
  test('the caps are exported at their decided values', () => {
    expect((markdown as Record<string, unknown>)['MAX_TABLE_COLUMNS']).toBe(COLUMNS);
    expect((markdown as Record<string, unknown>)['MAX_DOCUMENT_CELLS']).toBe(CELLS);
  });

  test('a table at the column cap is still a table', () => {
    const blocks = parse(wideTable(COLUMNS, 2));
    expect(tables(blocks).map((table) => table.align.length)).toEqual([COLUMNS]);
  });

  test('a table wider than the column cap is literal text', () => {
    const source = wideTable(COLUMNS + 1, 2);
    const blocks = parse(source);
    expect(tables(blocks)).toEqual([]);
    expect(JSON.stringify(blocks)).toContain('|a|a|');
  });

  test('the cells of one document are capped across tables', () => {
    // 20 tables of 10 columns × 99 rows: 1,000 cells each, 20,000 in all.
    const source = Array.from({ length: 20 }, () => wideTable(10, 99)).join('\n');
    const blocks = parse(source);
    expect(cellCount(blocks)).toBeLessThanOrEqual(CELLS);
    expect(tables(blocks).length).toBeGreaterThan(0);
    // What the cap cut is kept as text, not dropped.
    const literal = blocks.filter((block) => block.type === 'paragraph');
    expect(literal.length).toBeGreaterThan(0);
  });

  test('a wide, long table stays bounded', () => {
    const { value, ms } = timed(() => parse(wideTable(2_000, 2_000)));
    expect(cellCount(value)).toBeLessThanOrEqual(CELLS);
    expect(ms).toBeLessThan(1_000);
  });

  test('the reviewer\'s N = 10,000 table finishes fast with bounded output', () => {
    const { value, ms } = timed(() => parse(wideTable(10_000, 10_000)));
    expect(cellCount(value)).toBeLessThanOrEqual(CELLS);
    expect(JSON.stringify(value).length).toBeLessThan(2 * 1024 * 1024);
    expect(ms).toBeLessThan(1_000);
  });

  test('a long narrow table stops at the cell cap and keeps the rest as text', () => {
    const blocks = parse(wideTable(2, 20_000));
    expect(cellCount(blocks)).toBeLessThanOrEqual(CELLS);
    expect(tables(blocks)[0]!.rows.length).toBe(CELLS / 2 - 1);
    expect(JSON.stringify(blocks.filter((block) => block.type === 'paragraph'))).toContain('x');
  });
});

describe('bracket bounds', () => {
  test('many open brackets before many links parse in linear time', () => {
    const n = 40_000;
    const { value, ms } = timed(() => parse('['.repeat(n) + '[a](b)'.repeat(n)));
    expect(ms).toBeLessThan(1_000);
    expect(value.length).toBe(1);
  });

  test('image brackets above the links do not bring the walk back', () => {
    const n = 40_000;
    const { ms } = timed(() => parse('!['.repeat(n) + '[a](b)'.repeat(n)));
    expect(ms).toBeLessThan(1_000);
  });

  test('a link still deactivates the brackets before it, and not images', () => {
    // CommonMark: links may not contain links, so the outer `[` is literal after the inner link.
    const outer = JSON.stringify(parse('[a [b](https://x.test/b) c](https://x.test/a)'));
    expect(outer.match(/"type":"link"/g)?.length).toBe(1);
    expect(outer).toContain('https://x.test/b');
    // An image's brackets stay active, so the image still closes around the inner link and
    // renders as its alt text (the link inside it flattened to text).
    const image = parse('![alt [b](https://x.test/b)](https://x.test/i.png)');
    expect(image).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'alt b' }] }]);
  });
});
