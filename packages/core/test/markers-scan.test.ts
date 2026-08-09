import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MARKER_HEADER_WINDOW_BYTES,
  MARKER_SCAN_FILE_CAP,
  readSourceMarkers,
  readSourceMarkersBatch,
  scanSourceMarkers,
} from '../src/markers/index.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'core-markers-scan';
/** A sibling of the scan root, so "outside the tree" is a real place on disk. */
const OUTSIDE_DIR_NAME = 'core-markers-scan-outside';

/** The marker line, so the straddle test can reason about its exact byte length. */
const MARKER_LINE = '// @adr 0012';

function refsOf(source: string, path = 'src/sync.ts'): string[] {
  return scanSourceMarkers(source, path).markers.map((marker) => marker.ref);
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
  await cleanupTestDir(OUTSIDE_DIR_NAME);
});

describe('scanSourceMarkers — comment handling', () => {
  test('reads a dedicated marker line out of every common comment introducer', () => {
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
      ['leading-whitespace', '\t  // @adr 0012'],
    ];

    for (const [label, line] of cases) {
      expect([label, refsOf(line)]).toEqual([label, ['0012']]);
    }
  });

  test('ignores a marker that no comment introducer precedes', () => {
    expect(refsOf('const adr = @adr 0012;')).toEqual([]);
    expect(refsOf('@adr 0012')).toEqual([]);
  });

  test('ignores discussion prose, string literals, and trailing comments', () => {
    const source = [
      '/** Prose about // @adr 0012 does not declare it. */',
      ' * More prose before @adr 0012 does not declare it either.',
      'log("// @adr 0012");',
      'const value = 1; // @adr 0012',
    ].join('\n');

    expect(refsOf(source, 'packages/core/src/markers/scan.ts')).toEqual([]);
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

  test('treats a file-leading UTF-8 BOM as metadata in the pure string API', () => {
    expect(scanSourceMarkers('\uFEFF// @adr 0012\n', 'src/sync.ts').markers).toEqual([
      { path: 'src/sync.ts', ref: '0012', id: '0012', line: 1 },
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

  test('only the marker that leads the comment content is read', () => {
    expect(refsOf('// @adr 0012 and also @adr 0013')).toEqual(['0012']);
  });

  test('treats CR, LF, and CRLF as physical line boundaries', () => {
    const source = ['// @adr 0011', '// @adr 0012', '// @adr 0013'].join('\r');
    expect(scanSourceMarkers(source, 'src/sync.ts').markers).toEqual([
      { path: 'src/sync.ts', ref: '0011', id: '0011', line: 1 },
      { path: 'src/sync.ts', ref: '0012', id: '0012', line: 2 },
      { path: 'src/sync.ts', ref: '0013', id: '0013', line: 3 },
    ]);

    expect(refsOf('// @adr 0011\r\n// @adr 0012\n// @adr 0013')).toEqual(['0011', '0012', '0013']);
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

  test('the public scanner cannot be made unbounded with extra JavaScript arguments', () => {
    const belowWindow = `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES + 500)}\n${MARKER_LINE}\n`;
    const callFromJavaScript = scanSourceMarkers as unknown as (
      source: string,
      path: string,
      ignored: boolean,
    ) => ReturnType<typeof scanSourceMarkers>;

    const scan = callFromJavaScript(belowWindow, 'src/sync.ts', false);

    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
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

  test('uses observed byte truncation when a BOM makes decode and encode disagree', async () => {
    const root = await resetTestDir(DIR_NAME);
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf]);
    const padLength = MARKER_HEADER_WINDOW_BYTES + 1 - bom.length - MARKER_LINE.length;
    const pad = new TextEncoder().encode(`${'#'.repeat(padLength - 1)}\n`);
    const tail = new TextEncoder().encode(`${MARKER_LINE}3\ntail\n`);
    const bytes = new Uint8Array(bom.length + pad.length + tail.length);
    bytes.set(bom);
    bytes.set(pad, bom.length);
    bytes.set(tail, bom.length + pad.length);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/bom.ts'), bytes);

    const scan = await readSourceMarkers('src/bom.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
  });

  test('does not infer truncation when invalid UTF-8 expands during decoding', async () => {
    const root = await resetTestDir(DIR_NAME);
    const invalid = new Uint8Array(3000).fill(0xff);
    const marker = new TextEncoder().encode(`\n${MARKER_LINE}\n`);
    const bytes = new Uint8Array(invalid.length + marker.length);
    bytes.set(invalid);
    bytes.set(marker, invalid.length);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/latin1.ts'), bytes);

    const scan = await readSourceMarkers('src/latin1.ts', root);

    expect(scan.truncated).toBe(false);
    expect(scan.markers.map((item) => item.ref)).toEqual(['0012']);
  });
});

/**
 * ADR-0021 says the read has "no traversal" in prose. Prose is not a check — the same
 * gap `markers-purity.test.ts` closed for the purity claim. These are that check.
 *
 * The contract is the repo-relative path `resolveAffects` matches its globs against.
 * An argument that leaves the tree is not a stricter version of that contract but a
 * different one: the pattern half of `explain` can never match it, so the marker half
 * must not answer for it either.
 */
describe('readSourceMarkers — the working tree is the boundary', () => {
  test('refuses an absolute path, even one that points inside the tree', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/sync.ts'), '// @adr 0012\n');

    expect(await readSourceMarkers(join(root, 'src/sync.ts'), root)).toEqual({
      path: join(root, 'src/sync.ts'),
      state: 'out-of-tree',
      truncated: false,
      markers: [],
    });
  });

  test('refuses a relative path that climbs out of the tree', async () => {
    const root = await resetTestDir(DIR_NAME);
    const outside = await resetTestDir(OUTSIDE_DIR_NAME);
    await writeText(join(outside, 'claim.ts'), '// @adr 0012\n');

    const scan = await readSourceMarkers(`../${OUTSIDE_DIR_NAME}/claim.ts`, root);

    expect([scan.state, scan.markers]).toEqual(['out-of-tree', []]);
  });

  test('refuses an out-of-tree symlink without resolving its target', async () => {
    const root = await resetTestDir(DIR_NAME);
    const outside = await resetTestDir(OUTSIDE_DIR_NAME);
    await writeText(join(outside, 'claim.ts'), '// @adr 0012\n');
    await mkdir(join(root, 'src'), { recursive: true });
    await symlink(join(outside, 'claim.ts'), join(root, 'src/linked.ts'));

    // The lexical path stays inside the tree; only the resolved one does not. Checking
    // the argument without resolving it would report this file as governed.
    const scan = await readSourceMarkers('src/linked.ts', root);

    expect([scan.state, scan.markers]).toEqual(['unreadable', []]);
  });

  test('refuses an in-tree symlink with the same state', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/sync.ts'), '// @adr 0012\n');
    await symlink(join(root, 'src/sync.ts'), join(root, 'src/alias.ts'));

    const scan = await readSourceMarkers('src/alias.ts', root);

    expect([scan.state, scan.markers]).toEqual(['unreadable', []]);
  });

  test('refuses a broken symlink with the same state', async () => {
    const root = await resetTestDir(DIR_NAME);
    await mkdir(join(root, 'src'), { recursive: true });
    await symlink(join(root, 'src/missing.ts'), join(root, 'src/alias.ts'));

    const scan = await readSourceMarkers('src/alias.ts', root);

    expect([scan.state, scan.markers]).toEqual(['unreadable', []]);
  });

  test('refuses a symlinked parent before probing existing or missing children', async () => {
    const root = await resetTestDir(DIR_NAME);
    const outside = await resetTestDir(OUTSIDE_DIR_NAME);
    await writeText(join(outside, 'exists.ts'), '// @adr 0012\n');
    await symlink(outside, join(root, 'linked'));

    const existing = await readSourceMarkers('linked/exists.ts', root);
    const missing = await readSourceMarkers('linked/missing.ts', root);

    expect([existing.state, missing.state]).toEqual(['unreadable', 'unreadable']);
    expect([existing.markers, missing.markers]).toEqual([[], []]);
  });

  test.skipIf(process.platform === 'win32')(
    'reports a file that is not a regular file instead of blocking on it',
    async () => {
      const root = await resetTestDir(DIR_NAME);
      await mkdir(join(root, 'src'), { recursive: true });
      // A FIFO with no writer: a blocking open never returns, so a regression here
      // hangs `adr explain` forever rather than reaching the advertised state. The
      // test's own timeout is the assertion that it does not.
      Bun.spawnSync(['mkfifo', join(root, 'src/pipe.ts')]);

      const scan = await readSourceMarkers('src/pipe.ts', root);

      expect([scan.state, scan.markers]).toEqual(['unreadable', []]);
    },
  );
});

describe('readSourceMarkersBatch', () => {
  test('normalizes, deduplicates, and sorts paths before scanning', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/a.ts'), '// @adr 0012\n');
    await writeText(join(root, 'src/b.ts'), '// @adr 0013\n');

    const batch = await readSourceMarkersBatch(
      ['src\\b.ts', './src/a.ts', 'src/a.ts', '././src/b.ts'],
      root,
    );

    expect(batch.scans.map((scan) => scan.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(batch.scans.flatMap((scan) => scan.markers.map((marker) => marker.path))).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(batch.totalCandidates).toBe(2);
    expect(batch.skippedPaths).toEqual([]);
  });

  test('scans the first 1000 sorted paths and reports every path beyond the cap', async () => {
    const root = await resetTestDir(DIR_NAME);
    const paths = Array.from(
      { length: MARKER_SCAN_FILE_CAP + 2 },
      (_, index) => `src/file-${String(index).padStart(4, '0')}.ts`,
    ).reverse();

    const batch = await readSourceMarkersBatch(paths, root);

    expect(batch.scans).toHaveLength(MARKER_SCAN_FILE_CAP);
    expect(batch.scans.every((scan) => scan.state === 'absent')).toBe(true);
    expect(batch.skippedPaths).toEqual(['src/file-1000.ts', 'src/file-1001.ts']);
    expect(batch.totalCandidates).toBe(MARKER_SCAN_FILE_CAP + 2);
  });
});
