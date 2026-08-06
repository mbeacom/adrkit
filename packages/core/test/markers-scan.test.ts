import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { MARKER_HEADER_WINDOW_BYTES, readSourceMarkers, scanSourceMarkers } from '../src/markers/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'core-markers-scan';

/** The marker line, so the straddle test can reason about its exact byte length. */
const MARKER_LINE = '// @adr 0012';

function refsOf(source: string, path = 'src/sync.ts'): string[] {
  return scanSourceMarkers(source, path).markers.map((marker) => marker.ref);
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('scanSourceMarkers — comment handling', () => {
  test('reads a marker out of every common comment introducer', () => {
    const cases: Array<[string, string]> = [
      ['c-line', '// @adr 0012'],
      ['c-block-open', '/* @adr 0012 */'],
      ['c-block-continuation', ' * @adr 0012'],
      ['hash', '# @adr 0012'],
      ['sql-lua', '-- @adr 0012'],
      ['lisp-ini', '; @adr 0012'],
      ['tex-erlang', '% @adr 0012'],
      ['html-xml', '<!-- @adr 0012 -->'],
      ['python-docstring', '""" @adr 0012 """'],
      ['trailing', 'const x = 1; // @adr 0012'],
    ];

    for (const [label, line] of cases) {
      expect([label, refsOf(line)]).toEqual([label, ['0012']]);
    }
  });

  test('ignores a marker that no comment introducer precedes', () => {
    expect(refsOf('const adr = @adr 0012;')).toEqual([]);
    expect(refsOf('@adr 0012')).toEqual([]);
  });

  test('does not mistake the @adrkit package scope for a marker', () => {
    expect(refsOf("// import { lintCorpus } from '@adrkit/core';")).toEqual([]);
  });

  test('records the 1-based line and the path it was declared in', () => {
    const source = ['#!/usr/bin/env node', '', '// @adr 0012', 'export const x = 1;'].join('\n');
    expect(scanSourceMarkers(source, 'src/sync.ts').markers).toEqual([
      { path: 'src/sync.ts', ref: '0012', id: '0012', line: 3 },
    ]);
  });

  test('keeps the log qualifier of a federated reference', () => {
    expect(scanSourceMarkers('// @adr payments:0012', 'src/sync.ts').markers).toEqual([
      { path: 'src/sync.ts', ref: 'payments:0012', id: '0012', log: 'payments', line: 1 },
    ]);
  });
});

describe('scanSourceMarkers — reference list grammar', () => {
  test('a comma continues the list', () => {
    expect(refsOf('// @adr 0012, 0013')).toEqual(['0012', '0013']);
    expect(refsOf('// @adr 0012,0013')).toEqual(['0012', '0013']);
  });

  test('a bare space ends the list, so an adjacent number is not swallowed', () => {
    expect(refsOf('// @adr 0012 1234567 is the ticket')).toEqual(['0012']);
  });

  test('trailing prose and punctuation end the list without dropping the reference', () => {
    expect(refsOf('// @adr 0012. See the record for why.')).toEqual(['0012']);
    expect(refsOf('// @adr 0012 governs this file')).toEqual(['0012']);
  });

  test('a token that is not a valid reference yields nothing', () => {
    expect(refsOf('// @adr 12')).toEqual([]);
    expect(refsOf('// @adr')).toEqual([]);
  });

  test('two markers on one line are both read', () => {
    expect(refsOf('// @adr 0012 and also @adr 0013')).toEqual(['0012', '0013']);
  });
});

describe('scanSourceMarkers — the header window', () => {
  test('a marker below the header window is prose, not a declaration', () => {
    const belowWindow = `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES + 500)}\n${MARKER_LINE}\n`;
    const scan = scanSourceMarkers(belowWindow, 'src/sync.ts');

    expect(scan.markers).toEqual([]);
    expect(scan.truncated).toBe(true);

    // Control: the identical marker at the top of the identical file is a declaration.
    const inWindow = `${MARKER_LINE}\n${'#'.repeat(MARKER_HEADER_WINDOW_BYTES + 500)}\n`;
    expect(scanSourceMarkers(inWindow, 'src/sync.ts').markers.map((m) => m.ref)).toEqual(['0012']);
  });

  test('a file that ends exactly at the window boundary is not reported as truncated', () => {
    const exact = `${MARKER_LINE}\n${'#'.repeat(MARKER_HEADER_WINDOW_BYTES - MARKER_LINE.length - 2)}\n`;
    expect(exact.length).toBe(MARKER_HEADER_WINDOW_BYTES);

    const scan = scanSourceMarkers(exact, 'src/sync.ts');
    expect(scan.truncated).toBe(false);
    expect(scan.markers.map((m) => m.ref)).toEqual(['0012']);
  });

  test('truncation cannot invent a shorter reference by severing a longer one', () => {
    // The window boundary falls between "0012" and the "3" of "@adr 00123": half of a
    // five-digit id is a different, perfectly valid four-digit id.
    const pad = `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES - MARKER_LINE.length - 1)}\n`;
    const source = `${pad}// @adr 00123\ntail\n`;
    expect(pad.length + MARKER_LINE.length).toBe(MARKER_HEADER_WINDOW_BYTES);

    const scan = scanSourceMarkers(source, 'src/sync.ts');
    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
  });
});

describe('readSourceMarkers', () => {
  test('reports a scanned file, its markers, and an untruncated window', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/sync.ts'), '// @adr 0012\nexport const sync = true;\n');

    expect(await readSourceMarkers('src/sync.ts', root)).toEqual({
      path: 'src/sync.ts',
      state: 'scanned',
      truncated: false,
      markers: [{ path: 'src/sync.ts', ref: '0012', id: '0012', line: 1 }],
    });
  });

  test('distinguishes "looked and found none" from "could not look"', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/sync.ts'), 'export const sync = true;\n');

    const scanned = await readSourceMarkers('src/sync.ts', root);
    const absent = await readSourceMarkers('src/missing.ts', root);
    const unreadable = await readSourceMarkers('src', root);

    expect([scanned.state, absent.state, unreadable.state]).toEqual(['scanned', 'absent', 'unreadable']);
    expect([scanned.markers, absent.markers, unreadable.markers]).toEqual([[], [], []]);
  });

  test('reads at most the header window, and says so', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'src/big.ts'),
      `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES + 500)}\n// @adr 0012\n`,
    );

    const scan = await readSourceMarkers('src/big.ts', root);
    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
  });
});
