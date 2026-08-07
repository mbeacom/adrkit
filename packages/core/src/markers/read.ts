/**
 * @adrkit/core — reading the header window of one source file.
 *
 * The only filesystem half of the marker feature, kept apart from the pure scanner so
 * every grammar rule can be tested as text. No network, no credentials, no traversal:
 * one regular file beneath the working tree, at most
 * {@link MARKER_HEADER_WINDOW_BYTES} bytes, opened read-only and non-blocking.
 *
 * "No traversal" is enforced here rather than asserted — confinement is checked twice,
 * once lexically before any I/O and once on the real path so a symlink cannot walk out
 * of the tree.
 */

import { constants, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MARKER_HEADER_WINDOW_BYTES, scanSourceMarkers } from './scan.ts';
import type { SourceMarker } from './types.ts';

/**
 * Why a scan produced the markers it did.
 *
 * `scanned` with an empty marker list means the file was read and declares nothing.
 * `absent`, `unreadable`, and `out-of-tree` mean the tool could not look — a
 * distinction that has to survive into the output, because "no markers" and "I am
 * blind" otherwise render identically
 * ([ADR-0016](../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
 *
 * `out-of-tree` is separate from `unreadable` for the same reason: the file may be
 * perfectly readable, and saying otherwise would be false. It means the argument was
 * not a repo-relative path into this working tree, so nothing was opened.
 */
export type MarkerScanState = 'scanned' | 'absent' | 'unreadable' | 'out-of-tree';

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
 * Whether `target` lies strictly beneath `root`.
 *
 * Both are expected to be resolved already — for the confinement check that matters,
 * resolved through symlinks — so this is pure path arithmetic and cannot be fooled by
 * a `..` segment that a later resolution would have collapsed.
 */
function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * `O_NONBLOCK` so the open cannot hang. A FIFO opened for reading with no writer
 * blocks forever, which would wedge `adr explain` on `mkfifo src/pipe` instead of
 * reaching the state this module promises to report. It is absent on Windows, where
 * that case cannot arise; on a regular file it does nothing.
 *
 * Computed per call rather than held in a module constant on purpose: a top-level
 * initializer the bundler cannot prove side-effect-free keeps this module — and its
 * `node:fs/promises` import — alive in the `@adrkit/ci` bundle, which never scans a
 * marker. Measured, not assumed: as a constant it added three lines to both entry
 * points; as a function `packages/ci/dist` rebuilds byte-identical.
 */
function readFlags(): number {
  return constants.O_RDONLY | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
}

/**
 * Scan one source file for `@adr` markers.
 *
 * Reads one byte past the window so truncation is observed rather than inferred, and
 * never reads more than that however large the file is.
 *
 * `path` is repo-relative to `cwd` — the same contract `resolveAffects` matches its
 * globs against. An absolute or traversing argument is not a stricter form of that
 * contract but a different one, and it is refused rather than read: the pattern half
 * of `adr explain` can never match such a path, so the marker half must not answer for
 * it either, or a file outside the tree could be reported as governed by this corpus.
 */
export async function readSourceMarkers(path: string, cwd = process.cwd()): Promise<SourceMarkerScan> {
  const refuse = (state: MarkerScanState): SourceMarkerScan => ({ path, state, markers: [], truncated: false });

  // Lexically, before any I/O — so a path that leaves the tree is refused without the
  // reply distinguishing whether the file it named happens to exist.
  const root = resolve(cwd);
  if (isAbsolute(path) || !isInsideRoot(root, resolve(root, path))) return refuse('out-of-tree');

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Then again on the real paths. A symlink inside the tree pointing outside it is
    // lexically indistinguishable from an ordinary file, and following one would let
    // an out-of-tree file's marker be reported as this repository's.
    const realRoot = await realpath(root);
    const target = await realpath(resolve(realRoot, path));
    if (!isInsideRoot(realRoot, target)) return refuse('out-of-tree');

    handle = await open(target, readFlags());
    // Rejected on the open handle rather than by a preceding `stat`, so nothing can be
    // swapped in between the check and the read.
    if (!(await handle.stat()).isFile()) return refuse('unreadable');

    const buffer = new Uint8Array(MARKER_HEADER_WINDOW_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const scan = scanSourceMarkers(new TextDecoder().decode(buffer.subarray(0, bytesRead)), path);
    return { path, state: 'scanned', markers: scan.markers, truncated: scan.truncated };
  } catch (error) {
    return refuse(scanStateForError(error));
  } finally {
    await handle?.close();
  }
}
