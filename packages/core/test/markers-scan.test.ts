import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  MARKER_HEADER_WINDOW_BYTES,
  MARKER_SCAN_FILE_CAP,
  readSourceMarkers,
  readSourceMarkersBatch,
  scanSourceMarkers,
} from '../src/markers/index.ts';
// Reached through the module rather than the barrel: both are internal to `@adrkit/core`
// and deliberately unexported from `markers/index.ts`. Importing them here pins their
// behaviour without widening the package's public surface.
import { completeLineByteExtent, scanBoundedSourceMarkerWindow } from '../src/markers/scan.ts';
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

/**
 * A fenced block is where a file *shows* the syntax. Issue #101 measured the cost of
 * not knowing that: three of the four marker-looking lines left in this repository
 * after the dedicated-line rule landed were documentation of the feature, and all
 * three declared `0012` — an `accepted` record, the bucket an agent treats as binding.
 */
describe('scanSourceMarkers — a fenced example is not a declaration', () => {
  test('a marker inside a fenced block does not declare', () => {
    expect(refsOf(['Example:', '```ts', '// @adr 0012', '```'].join('\n'))).toEqual([]);

    // Control: the identical line, one fence removed, is still a declaration.
    expect(refsOf(['Example:', '// @adr 0012'].join('\n'))).toEqual(['0012']);
  });

  test('a marker below a closed fence declares again', () => {
    expect(refsOf(['```', '// @adr 0011', '```', '// @adr 0012'].join('\n'))).toEqual(['0012']);
  });

  test('an unclosed fence runs to the end of the window', () => {
    // Otherwise an example at the end of a document un-fences everything above it.
    expect(refsOf(['```', '// @adr 0012'].join('\n'))).toEqual([]);
  });

  test('a longer fence closes a shorter one, and a shorter one never closes a longer', () => {
    expect(refsOf(['```', 'x', '````', '// @adr 0012'].join('\n'))).toEqual(['0012']);
    expect(refsOf(['````', 'x', '```', '// @adr 0012'].join('\n'))).toEqual([]);
  });

  test('backtick and tilde fences do not close each other', () => {
    expect(refsOf(['```', '~~~', '// @adr 0012'].join('\n'))).toEqual([]);
    expect(refsOf(['~~~', '```', '// @adr 0012'].join('\n'))).toEqual([]);
  });

  test('a closing line may not carry an info string', () => {
    expect(refsOf(['```ts', '```ts', '// @adr 0012'].join('\n'))).toEqual([]);
  });

  test('a backtick fence info string may not itself contain a backtick', () => {
    // CommonMark 4.5: this line does not open a fence at all, so what follows is code
    // only in appearance and the marker below it is a real declaration.
    expect(refsOf(['``` `js`', '// @adr 0012'].join('\n'))).toEqual(['0012']);
  });

  test('a fence may be indented three spaces, and four spaces is not a fence', () => {
    expect(refsOf(['   ```', '// @adr 0012'].join('\n'))).toEqual([]);
    expect(refsOf(['    ```', '// @adr 0012'].join('\n'))).toEqual(['0012']);
  });

  test('a fence inside a block-comment continuation is a known blind spot', () => {
    // The fence has to lead the physical line for the same reason the marker does:
    // it is the one thing the scanner can know without knowing the language. Pinned as
    // a negative case so that closing it later is a visible change, not a silent one.
    const source = ['/**', ' * ```', ' * @adr 0012', ' * ```', ' */'].join('\n');
    expect(refsOf(source)).toEqual(['0012']);
  });

  test('fence state holds in a window that stopped short of the end of the file', () => {
    // The marker sits *inside* the window and inside an unclosed fence, with enough
    // below it to truncate. Putting it below the window instead would pass with or
    // without fence tracking, which would make this assertion decorative.
    const source = `\`\`\`\n${MARKER_LINE}\n${'x'.repeat(MARKER_HEADER_WINDOW_BYTES + 500)}\n`;
    const scan = scanSourceMarkers(source, 'src/sync.ts');

    expect([scan.markers, scan.truncated]).toEqual([[], true]);
  });
});

/**
 * The introducer list is a union of what *source languages* hide from their own
 * output. Markdown is not one of them: `#` is a heading and `*` is a list bullet, so
 * lending markdown that list let a sentence a reader can see declare a decision.
 */
describe('scanSourceMarkers — markdown declares in markdown comments', () => {
  test('an HTML comment declares, and so does an MDX expression comment', () => {
    expect(refsOf('<!-- @adr 0012 -->', 'docs/guide.md')).toEqual(['0012']);
    expect(refsOf('{/* @adr 0012 */}', 'site/src/content/docs/commands.mdx')).toEqual(['0012']);
  });

  test('a heading and a list bullet are content in markdown, not comments', () => {
    expect(refsOf('# @adr 0012', 'docs/guide.md')).toEqual([]);
    expect(refsOf('* @adr 0012 explains this', 'docs/guide.md')).toEqual([]);

    // Control: the same two line shapes are real comments in a shell script and a
    // block comment, and still declare there.
    expect(refsOf('# @adr 0012', 'scripts/sync.sh')).toEqual(['0012']);
    expect(refsOf(' * @adr 0012', 'src/sync.ts')).toEqual(['0012']);
  });

  test('no source-language introducer declares in markdown', () => {
    const lines = [
      '// @adr 0012',
      '/* @adr 0012 */',
      '-- @adr 0012',
      '; @adr 0012',
      '% @adr 0012',
      '""" @adr 0012 """',
    ];

    for (const line of lines) {
      expect([line, refsOf(line, 'docs/guide.md')]).toEqual([line, []]);
      // Control: each one is a declaration in a file whose language uses it.
      expect([line, refsOf(line, 'src/sync.ts')]).toEqual([line, ['0012']]);
    }
  });

  test('the extension test is case-insensitive and covers the markdown dialects', () => {
    for (const path of ['README.MD', 'notes.markdown', 'site/docs/commands.MDX']) {
      expect([path, refsOf('# @adr 0012', path)]).toEqual([path, []]);
    }
  });

  test('a JSX expression comment declares, closing one recorded false negative', () => {
    // ADR-0021 recorded `{/* @adr 0021 */}` as a form that could not declare. Markdown
    // needs it — MDX rejects `<!-- -->` — so it is answered for every file at once
    // rather than only where this change forced the question.
    expect(refsOf('{/* @adr 0012 */}', 'src/App.tsx')).toEqual(['0012']);
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
    const source = '// @adr 0012\nexport const sync = true;\n';
    await writeText(join(root, 'src/sync.ts'), source);
    const bytes = new TextEncoder().encode(source).length;

    expect(await readSourceMarkers('src/sync.ts', root)).toEqual({
      path: 'src/sync.ts',
      state: 'scanned',
      truncated: false,
      markers: [{ path: 'src/sync.ts', ref: '0012', id: '0012', line: 1 }],
      scannedBytes: bytes,
      fileBytes: bytes,
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

  test('a multi-byte code point split at the byte window cannot invent a marker', async () => {
    const root = await resetTestDir(DIR_NAME);
    const markerPrefix = new TextEncoder().encode(`${MARKER_LINE} `);
    const splitCodePoint = new TextEncoder().encode('é');
    const padLength = MARKER_HEADER_WINDOW_BYTES - markerPrefix.length - 1;
    const pad = new TextEncoder().encode(`${'#'.repeat(padLength - 1)}\n`);
    const tail = new TextEncoder().encode('\ntail\n');
    const bytes = new Uint8Array(pad.length + markerPrefix.length + splitCodePoint.length + tail.length);
    bytes.set(pad);
    bytes.set(markerPrefix, pad.length);
    bytes.set(splitCodePoint, pad.length + markerPrefix.length);
    bytes.set(tail, pad.length + markerPrefix.length + splitCodePoint.length);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/split.ts'), bytes);

    // The window ends after the first byte of `é`. TextDecoder emits U+FFFD, but the
    // whole severed line must be discarded; otherwise its valid marker prefix matches.
    expect(pad.length + markerPrefix.length + 1).toBe(MARKER_HEADER_WINDOW_BYTES);
    const scan = await readSourceMarkers('src/split.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
  });
});

/**
 * Issue #108: `truncated` says bytes were left unscanned but not how many, and the window
 * constant does not answer that either — the scan stops at the last complete line inside
 * it, so `min(fileBytes, windowBytes)` is not the extent. `scannedBytes` / `fileBytes`
 * report the measurement, making `fileBytes - scannedBytes` the size of the unscanned
 * remainder. They do NOT say whether a marker sits past the window; nothing can, short of
 * reading further (ADR-0024).
 *
 * These cases pin the boundary from both sides and assert exact extents rather than
 * `< fileBytes` bounds, which any wrong smaller number satisfies.
 */
describe('readSourceMarkers — the scanned extent', () => {
  /** Reads what the scanner reports it read, so the claim is checked against the file. */
  async function scannedPrefix(root: string, path: string, scannedBytes: number): Promise<Uint8Array> {
    return (await readFile(join(root, path))).subarray(0, scannedBytes);
  }

  test('a fully scanned file reports equal extents, so an empty result is complete', async () => {
    const root = await resetTestDir(DIR_NAME);
    const source = 'export const sync = true;\n';
    await writeText(join(root, 'src/sync.ts'), source);

    const scan = await readSourceMarkers('src/sync.ts', root);

    expect(scan.markers).toEqual([]);
    expect(scan.truncated).toBe(false);
    expect(scan.scannedBytes).toBe(new TextEncoder().encode(source).length);
    expect(scan.scannedBytes).toBe(scan.fileBytes);
  });

  test('the #108 shape: markers in the header of a large file, reported as found and bounded', async () => {
    const root = await resetTestDir(DIR_NAME);
    const header = `${MARKER_LINE}\n`;
    const body = `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES * 2)}\n`;
    await writeText(join(root, 'src/big.ts'), `${header}${body}`);

    const scan = await readSourceMarkers('src/big.ts', root);

    // Every marker in the file was found, and the extent says the search was partial —
    // which is exactly the pair `truncated` alone could not express.
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
    expect(scan.truncated).toBe(true);
    // The exact extent: the body is one unbroken run, so the header's terminator is the
    // last one inside the window. A `< fileBytes` bound would accept any wrong smaller
    // number, which is the assertion this pair replaces.
    expect(scan.scannedBytes).toBe(header.length);
    expect(scan.fileBytes).toBe(header.length + body.length);
  });

  test('the extent is the cut-back line, not the window constant', async () => {
    const root = await resetTestDir(DIR_NAME);
    // One enormous line after the header, so the last complete line inside the window
    // ends far short of it: `min(fileBytes, windowBytes)` would be wrong by 8 KB.
    const header = `${MARKER_LINE}\n`;
    await writeText(join(root, 'src/oneline.ts'), `${header}${'#'.repeat(MARKER_HEADER_WINDOW_BYTES * 3)}\n`);

    const scan = await readSourceMarkers('src/oneline.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(header.length);
    expect(scan.scannedBytes).toBeLessThan(MARKER_HEADER_WINDOW_BYTES);
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
  });

  test('the extent is the LAST complete line in the window, not the first', async () => {
    const root = await resetTestDir(DIR_NAME);
    // 100-byte lines, so 81 of them (8100 bytes) fit under the window and the 82nd does
    // not. The marker sits on line 81 — the last complete line inside the window — so a
    // cut at any earlier terminator both misreports the extent and loses the marker.
    const LINE_BYTES = 100;
    const filler = `${'x'.repeat(LINE_BYTES - 1)}\n`.repeat(80);
    const markerLine = `${MARKER_LINE}${' '.repeat(LINE_BYTES - MARKER_LINE.length - 1)}\n`;
    expect(markerLine.length).toBe(LINE_BYTES);
    await writeText(join(root, 'src/lines.ts'), `${filler}${markerLine}${filler}`);

    const scan = await readSourceMarkers('src/lines.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(LINE_BYTES * 81);
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
    expect(scan.markers.map((marker) => marker.line)).toEqual([81]);
  });

  test('a window holding no line terminator reports nothing scanned rather than 8192', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/blob.ts'), '#'.repeat(MARKER_HEADER_WINDOW_BYTES + 500));

    const scan = await readSourceMarkers('src/blob.ts', root);

    // The scanner was handed no complete line, so it examined nothing. Reporting the
    // window here would claim 8192 bytes were searched when none were.
    expect(scan.scannedBytes).toBe(0);
    expect(scan.truncated).toBe(true);
    expect(scan.markers).toEqual([]);
  });

  test('a line completed only by the probe byte is outside the window, in both the extent and the scan', async () => {
    const root = await resetTestDir(DIR_NAME);
    // The reader probes one byte past the window to observe truncation. Here that probe
    // byte is the terminator of a MARKER line whose content fills the window exactly, so
    // the fixture pins both halves of the coupling at once:
    //   - measuring the cut over what was READ rather than over the window would report
    //     8193, more than the window it is meant to bound;
    //   - decoding what was READ rather than the measured extent would complete this line
    //     and turn it into a declaration, while the reported extent still said 0.
    // The reported number and the scanned text have to be the same computation.
    const overWindow = `${MARKER_LINE}${' '.repeat(MARKER_HEADER_WINDOW_BYTES - MARKER_LINE.length)}\n`;
    expect(overWindow.length).toBe(MARKER_HEADER_WINDOW_BYTES + 1);
    await writeText(join(root, 'src/probe.ts'), `${overWindow}export const tail = 1;\n`);

    const scan = await readSourceMarkers('src/probe.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(0);
    expect(scan.scannedBytes).toBeLessThanOrEqual(MARKER_HEADER_WINDOW_BYTES);
    expect(scan.markers).toEqual([]);
  });

  test('a line ending exactly at the window boundary is inside it', async () => {
    const root = await resetTestDir(DIR_NAME);
    // Last byte of the window is this line's terminator, so the whole window is complete
    // lines: the extent is the window exactly. A cut that stopped a byte short would
    // fall back to the header's terminator and lose 8179 bytes of scanned text.
    const header = `${MARKER_LINE}\n`;
    const filler = `${'#'.repeat(MARKER_HEADER_WINDOW_BYTES - header.length - 1)}\n`;
    expect(header.length + filler.length).toBe(MARKER_HEADER_WINDOW_BYTES);
    await writeText(join(root, 'src/edge.ts'), `${header}${filler}tail\n`);

    const scan = await readSourceMarkers('src/edge.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(MARKER_HEADER_WINDOW_BYTES);
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
  });

  test('a file of exactly the window size is complete, not truncated', async () => {
    const root = await resetTestDir(DIR_NAME);
    const header = `${MARKER_LINE}\n`;
    const source = `${header}${'#'.repeat(MARKER_HEADER_WINDOW_BYTES - header.length - 1)}\n`;
    expect(source.length).toBe(MARKER_HEADER_WINDOW_BYTES);
    await writeText(join(root, 'src/exact.ts'), source);

    const scan = await readSourceMarkers('src/exact.ts', root);

    // Nothing was left unread, so reporting `truncated` here would call a provably
    // complete scan partial — and would pair it with equal extents, which is incoherent.
    expect(scan.truncated).toBe(false);
    expect([scan.scannedBytes, scan.fileBytes]).toEqual([
      MARKER_HEADER_WINDOW_BYTES,
      MARKER_HEADER_WINDOW_BYTES,
    ]);
  });

  test('a file with no trailing terminator is still measured whole', async () => {
    const root = await resetTestDir(DIR_NAME);
    // Untruncated, so the extent is what was read, not a cut: cutting an untruncated
    // window back to its last terminator would drop the final line from both the
    // measurement and the scan, and here that line is the whole body.
    const source = `${MARKER_LINE}\nexport const x = 1;`;
    await writeText(join(root, 'src/notrail.ts'), source);

    const scan = await readSourceMarkers('src/notrail.ts', root);

    expect(scan.truncated).toBe(false);
    expect([scan.scannedBytes, scan.fileBytes]).toEqual([source.length, source.length]);
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
  });

  test('a CR-only file is measured and scanned like any other', async () => {
    const root = await resetTestDir(DIR_NAME);
    // `\r` alone is a line terminator to this scanner (`completeLinePrefix` cuts on it
    // and `scanWindow` splits on it), so the byte-level cut has to honour 0x0D as well
    // as 0x0A. Recognising only 0x0A would report nothing scanned for this file and lose
    // a header marker the pre-measurement decode found.
    const header = `${MARKER_LINE}\r`;
    const body = `${'x'.repeat(99)}\r`.repeat(200);
    await writeText(join(root, 'src/mac.ts'), `${header}${body}`);

    const scan = await readSourceMarkers('src/mac.ts', root);

    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(header.length + 100 * 81);
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
  });

  test('a terminator at the very first byte is inside the window', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/leading.ts'), `\n${'#'.repeat(MARKER_HEADER_WINDOW_BYTES + 100)}`);

    const scan = await readSourceMarkers('src/leading.ts', root);

    // One complete line — an empty one — was scanned. Byte 0 is a byte like any other.
    expect(scan.truncated).toBe(true);
    expect(scan.scannedBytes).toBe(1);
  });

  test('the extent lands on a code-point boundary when the window splits one', async () => {
    const root = await resetTestDir(DIR_NAME);
    const head = new TextEncoder().encode(`${MARKER_LINE}\n`);
    // Fill to one byte short of the window, then straddle it with a 2-byte code point.
    const filler = new TextEncoder().encode('#'.repeat(MARKER_HEADER_WINDOW_BYTES - head.length - 1));
    const straddle = new TextEncoder().encode('é\ntail\n');
    const bytes = new Uint8Array(head.length + filler.length + straddle.length);
    bytes.set(head);
    bytes.set(filler, head.length);
    bytes.set(straddle, head.length + filler.length);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/straddle.ts'), bytes);

    const scan = await readSourceMarkers('src/straddle.ts', root);

    expect(scan.truncated).toBe(true);
    // The only complete line inside the window is the header, so the extent stops there
    // and the split code point is never part of what was scanned. Decoding the reported
    // prefix in fatal mode proves the boundary claim rather than assuming it.
    expect(scan.scannedBytes).toBe(head.length);
    const prefix = await scannedPrefix(root, 'src/straddle.ts', scan.scannedBytes as number);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(prefix)).not.toThrow();
    expect(scan.markers.map((marker) => marker.ref)).toEqual(['0012']);
  });

  test('a state that read nothing carries no extent, and a scanned one always does', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'src/sync.ts'), '// @adr 0012\n');
    const outside = await resetTestDir(OUTSIDE_DIR_NAME);
    await writeText(join(outside, 'claim.ts'), '// @adr 0012\n');

    const refused = [
      await readSourceMarkers('src/missing.ts', root),
      await readSourceMarkers('src', root),
      await readSourceMarkers(`..${sep}${OUTSIDE_DIR_NAME}/claim.ts`, root),
    ];
    const scanned = await readSourceMarkers('src/sync.ts', root);

    expect(refused.map((scan) => scan.state)).toEqual(['absent', 'unreadable', 'out-of-tree']);
    // The scanned control is what makes the absences meaningful: without it this test
    // would pass just as well if the extent were never reported at all.
    expect([scanned.scannedBytes, scanned.fileBytes]).toEqual([13, 13]);
    // `0` would be a measurement, and nothing was measured. Absent is the honest report.
    for (const scan of refused) {
      expect(scan.scannedBytes).toBeUndefined();
      expect(scan.fileBytes).toBeUndefined();
    }
  });
});

/**
 * The reproduction from issue #101, run against the real files rather than a fixture.
 * A fixture would prove the rule; only the repository's own documentation proves the
 * three reported instances are gone. If a marker is ever added to one of these files
 * on purpose, this test is where that shows up.
 */
describe('readSourceMarkers — this repository stops declaring from its own docs', () => {
  const REPORTED_IN_ISSUE_101 = [
    'packages/cli/README.md',
    'docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md',
    'site/src/content/docs/commands.mdx',
  ];

  test('the three documentation files reported no longer declare a decision', async () => {
    for (const path of REPORTED_IN_ISSUE_101) {
      const scan = await readSourceMarkers(path, process.cwd());
      // `scanned` and not `absent`: the tool looked at the real file and found none.
      expect([path, scan.state, scan.markers]).toEqual([path, 'scanned', []]);
    }
  });

  test('the repository still has a real declaration, so the scan is not simply blind', async () => {
    const scan = await readSourceMarkers('packages/core/src/check/index.ts', process.cwd());

    // The *location* is asserted and the ref deliberately is not: #106 renumbers this
    // marker from 0021 to 0022 when ADR-0022 lands, and pinning the id here would make
    // this file fail on a change that has nothing to do with it. What has to stay true
    // is that one real declaration survives, or the empty results above prove nothing.
    expect(scan.state).toBe('scanned');
    expect(scan.markers).toHaveLength(1);
    expect({ path: scan.markers[0]?.path, line: scan.markers[0]?.line }).toEqual({
      path: 'packages/core/src/check/index.ts',
      line: 1,
    });
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
      ['./src/b.ts', './src/a.ts', 'src/a.ts', '././src/b.ts'],
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

  test.skipIf(sep === '\\')(
    'treats a backslash as a filename character where the platform does, not a separator',
    async () => {
      const root = await resetTestDir(DIR_NAME);
      // Two distinct POSIX files. Rewriting the backslash would scan the second and
      // report its marker under the first's name — a wrong answer that reads as
      // `scanned`, not `absent`.
      const plain = 'export const plain = true;\n';
      await writeText(join(root, 'src/we\\ird.ts'), plain);
      await writeText(join(root, 'src/we/ird.ts'), '// @adr 0012\n');
      const bytes = new TextEncoder().encode(plain).length;

      const batch = await readSourceMarkersBatch(['src/we\\ird.ts'], root);

      expect(batch.scans).toEqual([
        {
          path: 'src/we\\ird.ts',
          state: 'scanned',
          markers: [],
          truncated: false,
          scannedBytes: bytes,
          fileBytes: bytes,
        },
      ]);
    },
  );

  test('uses code-unit order to select capped paths and report every path beyond the cap', async () => {
    const root = await resetTestDir(DIR_NAME);
    const name = (index: number): string => `src/file-${String(index).padStart(5, '0')}.ts`;
    const selectedNames = Array.from({ length: MARKER_SCAN_FILE_CAP }, (_, index) => name(index));
    const paths = [...selectedNames, 'src/z-last.ts', 'src/ä-last.ts'].reverse();

    const batch = await readSourceMarkersBatch(paths, root);

    expect(batch.scans).toHaveLength(MARKER_SCAN_FILE_CAP);
    expect(batch.scans.every((scan) => scan.state === 'absent')).toBe(true);
    expect(batch.scans.map((scan) => scan.path)).toEqual(selectedNames);
    expect(batch.skippedPaths).toEqual(['src/z-last.ts', 'src/ä-last.ts']);
    expect(batch.totalCandidates).toBe(MARKER_SCAN_FILE_CAP + 2);
  });
});

/**
 * ADR-0024 leaves one invariant unguarded by the type system: the cut back to the last
 * complete line is now implemented twice — `completeLineByteExtent` on raw bytes, which
 * produces the reported `scannedBytes`, and `completeLinePrefix` on decoded text, which
 * produces the string the scanner actually reads. The record states the requirement as
 * "any future change to the cut must keep the reported number and the scanned text one
 * computation", and nothing enforces it: a change to either alone compiles, and the
 * damage is a `scannedBytes` that claims bytes the scanner discarded.
 *
 * These tests are the enforcement. They assert the property rather than re-implementing
 * the search, so they cannot drift with it in the way a copied algorithm would.
 */
describe('the byte cut and the text cut cannot drift apart', () => {
  const PROBE_PATH = 'src/probe.ts';

  function assertCutsAgree(bytes: Uint8Array, limit: number): void {
    const extent = completeLineByteExtent(bytes, limit);
    const capped = Math.min(limit, bytes.length);
    const isTerminator = (byte: number | undefined): boolean => byte === 0x0a || byte === 0x0d;

    expect(extent).toBeGreaterThanOrEqual(0);
    expect(extent).toBeLessThanOrEqual(capped);

    // Stated as a boundary property, independent of how the boundary is found: the
    // extent ends just past a terminator, and no terminator is left unclaimed behind it.
    // A forward search, an off-by-one, or dropping `0x0D` each breaks one of these.
    if (extent === 0) {
      for (let index = 0; index < capped; index += 1) {
        expect(isTerminator(bytes[index])).toBe(false);
      }
    } else {
      expect(isTerminator(bytes[extent - 1])).toBe(true);
      for (let index = extent; index < capped; index += 1) {
        expect(isTerminator(bytes[index])).toBe(false);
      }
    }

    // The behavioural half. `scanBoundedSourceMarkerWindow` applies the *text* cut only
    // when told the read was truncated, so identical markers under both flags means the
    // text cut removed nothing from what the byte cut produced — i.e. the two agree.
    const source = new TextDecoder().decode(bytes.subarray(0, extent));
    expect(scanBoundedSourceMarkerWindow(source, PROBE_PATH, true).markers).toEqual(
      scanBoundedSourceMarkerWindow(source, PROBE_PATH, false).markers,
    );
  }

  test.each([
    ['no terminator anywhere', '// @adr 0012 with no newline at all'],
    ['lone CR only', '// @adr 0012\r'],
    ['lone LF only', '// @adr 0012\n'],
    ['CRLF', '// @adr 0012\r\n'],
    ['trailing partial line', '// @adr 0012\n// @adr 001'],
    ['terminator as the very first byte', '\n// @adr 0012'],
    ['blank lines after the marker', '// @adr 0012\n\n\n'],
    ['BOM then a marker', '\ufeff// @adr 0012\nrest'],
    ['multi-byte content around the marker', '// @adr 0012\n// caf\u00e9 \u00e9\u00e9\u00e9 \ud83d\ude80\nx'],
    ['CR inside a longer body', 'a\rb\rc'],
  ])('agrees for %s', (_name, source) => {
    const bytes = new TextEncoder().encode(source);
    for (const limit of [0, 1, 2, bytes.length - 1, bytes.length, bytes.length + 5]) {
      if (limit >= 0) assertCutsAgree(bytes, limit);
    }
  });

  test('agrees on invalid UTF-8, which the decoder rewrites but the byte search must not', () => {
    // A truncated multi-byte sequence and a stray continuation byte. `TextDecoder`
    // expands each into U+FFFD, so a re-encoded length would not be the length that was
    // read — the reason the extent is measured on bytes in the first place.
    const bytes = new Uint8Array([0x2f, 0x2f, 0x20, 0xe2, 0x82, 0x0a, 0x80, 0xff, 0x0a, 0x78]);
    for (let limit = 0; limit <= bytes.length + 2; limit += 1) assertCutsAgree(bytes, limit);
  });

  test('agrees across a deterministic fuzz corpus spanning the window boundary', () => {
    // Seeded so a failure is reproducible; the repository treats determinism as a
    // property worth pinning rather than a coincidence.
    let seed = 0x9e3779b9;
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Terminators and marker-ish bytes are over-weighted so the interesting cases are
    // actually hit; the tail covers multi-byte and invalid sequences.
    const alphabet = [0x0a, 0x0d, 0x20, 0x2f, 0x40, 0x61, 0x30, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xff];

    for (let trial = 0; trial < 400; trial += 1) {
      const length = Math.floor(next() * 40) + 1;
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = alphabet[Math.floor(next() * alphabet.length)]!;
      }
      assertCutsAgree(bytes, Math.floor(next() * (length + 3)));
    }
  });

  test('agrees at the real window boundary, where the probe byte sits just past the limit', () => {
    // The shape `read.ts` actually produces: a full window plus one truncation probe
    // byte. The extent must never reach into the probe, whatever the probe happens to be.
    for (const probe of [0x0a, 0x0d, 0x78]) {
      for (const lastWindowByte of [0x0a, 0x0d, 0x78]) {
        const bytes = new Uint8Array(MARKER_HEADER_WINDOW_BYTES + 1);
        bytes.fill(0x78);
        bytes[0] = 0x0a;
        bytes[MARKER_HEADER_WINDOW_BYTES - 1] = lastWindowByte;
        bytes[MARKER_HEADER_WINDOW_BYTES] = probe;

        const extent = completeLineByteExtent(bytes, MARKER_HEADER_WINDOW_BYTES);
        expect(extent).toBeLessThanOrEqual(MARKER_HEADER_WINDOW_BYTES);
        expect(extent).toBe(lastWindowByte === 0x78 ? 1 : MARKER_HEADER_WINDOW_BYTES);
        assertCutsAgree(bytes, MARKER_HEADER_WINDOW_BYTES);
      }
    }
  });
});
