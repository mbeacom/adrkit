import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Only the governing-decisions Action bundle carries the inbound-marker feature.
 *
 * The main Action now scans markers deliberately; the ARB queue Action still does not.
 * The positive assertion matters because these checks use readable module/export
 * fragments that a future minified build could erase and make every negative check
 * vacuously pass.
 */
const GOVERNING_BUNDLE = 'packages/ci/dist/index.js';
const QUEUE_BUNDLE = 'packages/ci/dist/queue-action.js';

/**
 * Fragments that exist only in the marker feature, and nowhere else in core. The
 * module banner is one of them: it is what appeared when the property broke.
 */
const MARKER_ONLY_FRAGMENTS = [
  'markers/read.ts',
  'MARKER_HEADER_WINDOW_BYTES',
  'scanBoundedSourceMarkerWindow',
  'readSourceMarkers',
  'readSourceMarkersBatch',
  'resolveSourceMarkers',
  'mergeSourceDeclarations',
];

describe('the committed Action bundles have deliberate marker scope', () => {
  test('the governing Action contains every readable marker fragment', async () => {
    const source = await readFile(resolve(process.cwd(), GOVERNING_BUNDLE), 'utf8');
    expect(MARKER_ONLY_FRAGMENTS.filter((fragment) => !source.includes(fragment))).toEqual([]);
  });

  test('the queue Action contains no marker fragments', async () => {
    const source = await readFile(resolve(process.cwd(), QUEUE_BUNDLE), 'utf8');
    expect(MARKER_ONLY_FRAGMENTS.filter((fragment) => source.includes(fragment))).toEqual([]);
  });
});
