/**
 * @adrkit/core — reading the header window of one source file.
 *
 * The only filesystem half of the marker feature, kept apart from the pure scanner so
 * every grammar rule can be tested as text. No network, no credentials, no traversal:
 * one file, at most {@link MARKER_HEADER_WINDOW_BYTES} bytes, opened read-only.
 */

import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { MARKER_HEADER_WINDOW_BYTES, scanSourceMarkers } from './scan.ts';
import type { SourceMarker } from './types.ts';

/**
 * Why a scan produced the markers it did.
 *
 * `scanned` with an empty marker list means the file was read and declares nothing.
 * `absent` and `unreadable` mean the tool could not look — a distinction that has to
 * survive into the output, because "no markers" and "I am blind" otherwise render
 * identically ([ADR-0016](../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
 */
export type MarkerScanState = 'scanned' | 'absent' | 'unreadable';

export interface SourceMarkerScan {
  /** The path as the caller supplied it, echoed so output reads back what was asked. */
  path: string;
  state: MarkerScanState;
  markers: SourceMarker[];
  /** Whether the header window stopped short of the end of the file. */
  truncated: boolean;
}

function scanStateForError(error: unknown): MarkerScanState {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unreadable';
}

/**
 * Scan one source file for `@adr` markers.
 *
 * Reads one byte past the window so truncation is observed rather than inferred, and
 * never reads more than that however large the file is.
 */
export async function readSourceMarkers(path: string, cwd = process.cwd()): Promise<SourceMarkerScan> {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolutePath, 'r');
    const buffer = new Uint8Array(MARKER_HEADER_WINDOW_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const scan = scanSourceMarkers(new TextDecoder().decode(buffer.subarray(0, bytesRead)), path);
    return { path, state: 'scanned', markers: scan.markers, truncated: scan.truncated };
  } catch (error) {
    return { path, state: scanStateForError(error), markers: [], truncated: false };
  } finally {
    await handle?.close();
  }
}
