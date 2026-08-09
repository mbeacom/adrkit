/**
 * @adrkit/core — reading the header window of one source file.
 *
 * The only filesystem half of the marker feature, kept apart from the pure scanner so
 * every grammar rule can be tested as text. No network, no credentials, no traversal:
 * bounded regular files beneath the working tree, at most
 * {@link MARKER_HEADER_WINDOW_BYTES} bytes plus one truncation sentinel, opened
 * read-only and non-blocking.
 *
 * "No traversal" is enforced here rather than asserted — confinement is checked
 * lexically before I/O and on the real path, while symlink components are refused
 * before their descendants or targets are resolved.
 */

import { constants, lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MARKER_HEADER_WINDOW_BYTES, scanBoundedSourceMarkerWindow } from './scan.ts';
import { mapConcurrent } from './pool.ts';
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
  /** Normalized repo-relative path used for matching and output. */
  path: string;
  state: MarkerScanState;
  markers: SourceMarker[];
  /** Whether the header window stopped short of the end of the file. */
  truncated: boolean;
}

/**
 * Maximum number of unique paths one `check` run will scan.
 *
 * Set to GitHub's `pulls.listFiles` ceiling rather than below it. The Action refuses to
 * evaluate a changed-file list that reached that ceiling, so every diff it does
 * evaluate contributes at most 2,999 current/head-side paths, and the Action passes
 * exactly those paths to this reader. A rename's previous path still participates in
 * `affects` matching but is not a file whose contents can be scanned. The cap therefore
 * cannot silently drop a current file: marker-only governance is complete for any PR
 * the Action answers at all. Its remaining job is to bound a local `adr check` handed a
 * runaway glob.
 *
 * `@adrkit/ci` asserts `MARKER_SCAN_FILE_CAP >= LIST_FILES_CAP`; core cannot import the
 * provider constant, because the dependency runs the other way.
 */
export const MARKER_SCAN_FILE_CAP = 3000;

/** Maximum number of marker file reads in flight at once. */
export const MARKER_SCAN_CONCURRENCY = 16;

/** Pre-scanned marker input passed across the pure `checkChanges` boundary. */
export interface SourceMarkerBatchScan {
  scans: SourceMarkerScan[];
  skippedPaths: string[];
  limit: number;
  totalCandidates: number;
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
 * Inspect each lexical component beneath `root` without following a symlink.
 * Checking only the leaf is insufficient when a PR replaces a directory with a
 * symlink while the provider still lists the directory's former children as deleted.
 */
async function lstatWithoutSymlink(
  root: string,
  target: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  const segments = relative(root, target).split(sep);
  let current = root;
  let info: Awaited<ReturnType<typeof lstat>> | undefined;
  for (const segment of segments) {
    current = resolve(current, segment);
    info = await lstat(current);
    if (info.isSymbolicLink()) return undefined;
  }
  return info;
}

/**
 * Normalize a caller path once, before it becomes marker identity.
 *
 * A backslash is a separator only where the platform says so. On POSIX it is an
 * ordinary filename character, and rewriting it would make `src/we\ird.ts` scan
 * `src/we/ird.ts` — a different file, reported as `scanned` rather than `absent`, with
 * the wrong file's markers attributed to the path the caller never named.
 */
function normalizeMarkerPath(path: string): string {
  const forward = sep === '\\' ? path.replace(/\\/g, '/') : path;
  let start = 0;
  while (forward.startsWith('./', start)) start += 2;
  return forward.slice(start);
}

interface PreparedRoot {
  root: string;
  realRoot?: string;
  errorState?: MarkerScanState;
}

async function prepareRoot(cwd: string): Promise<PreparedRoot> {
  const root = resolve(cwd);
  try {
    return { root, realRoot: await realpath(root) };
  } catch (error) {
    return { root, errorState: scanStateForError(error) };
  }
}

/**
 * `O_NONBLOCK` so the open cannot hang. A FIFO opened for reading with no writer
 * blocks forever, which would wedge `adr explain` on `mkfifo src/pipe` instead of
 * reaching the state this module promises to report. It is absent on Windows, where
 * that case cannot arise; on a regular file it does nothing.
 *
 * Computed per call rather than held in a module constant on purpose: a top-level
 * initializer the bundler cannot prove side-effect-free keeps this module — and its
 * `node:fs/promises` import — alive in unrelated bundles. The governing Action now
 * imports this boundary intentionally; the queue Action still proves it tree-shakes
 * away.
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
 * contract but a different one, and it is refused rather than read. `affects`
 * resolution keeps its pre-marker behavior for a raw argument, including broad globs;
 * this boundary ensures an outside file's contents cannot add an inbound edge.
 */
async function readWithPreparedRoot(path: string, prepared: PreparedRoot): Promise<SourceMarkerScan> {
  const normalizedPath = normalizeMarkerPath(path);
  const refuse = (state: MarkerScanState): SourceMarkerScan => ({
    path: normalizedPath,
    state,
    markers: [],
    truncated: false,
  });

  if (prepared.errorState || !prepared.realRoot) return refuse(prepared.errorState ?? 'unreadable');

  // Lexically, before any I/O — so a path that leaves the tree is refused without the
  // reply distinguishing whether the file it named happens to exist.
  const candidate = resolve(prepared.root, normalizedPath);
  if (isAbsolute(normalizedPath) || !isInsideRoot(prepared.root, candidate)) return refuse('out-of-tree');

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Refuse any symlink component before resolving or probing its descendants. This
    // gives valid, broken, and out-of-tree symlinks the same result, so CI cannot use
    // marker scanning as an existence or permission oracle for the target.
    const link = await lstatWithoutSymlink(prepared.root, candidate);
    if (!link || !link.isFile()) return refuse('unreadable');

    // With every component proven not to be a symlink, the canonical location is the
    // canonical root plus the lexical remainder. It is derived rather than asked of
    // `realpath`, which rewrites a backslash *inside* a POSIX filename into a separator:
    // `realpath('src/we\ird.ts')` answers `src/we/ird.ts`, so the scan would open a
    // different file and report its markers under the path the caller named.
    const target = resolve(prepared.realRoot, relative(prepared.root, candidate));
    if (!isInsideRoot(prepared.realRoot, target)) return refuse('out-of-tree');

    handle = await open(candidate, readFlags());
    // Check the opened handle rather than a path before `open`, so the file-type check
    // applies to the object we read. This does not close the `lstat` -> `open` race:
    // a concurrent process can still replace the approved path before it is opened.
    if (!(await handle.stat()).isFile()) return refuse('unreadable');

    const buffer = new Uint8Array(MARKER_HEADER_WINDOW_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }

    const truncated = bytesRead > MARKER_HEADER_WINDOW_BYTES;
    const source = new TextDecoder().decode(
      buffer.subarray(0, Math.min(bytesRead, MARKER_HEADER_WINDOW_BYTES)),
    );
    const scan = scanBoundedSourceMarkerWindow(source, normalizedPath, truncated);
    return { path: normalizedPath, state: 'scanned', markers: scan.markers, truncated: scan.truncated };
  } catch (error) {
    return refuse(scanStateForError(error));
  } finally {
    await handle?.close();
  }
}

export async function readSourceMarkers(path: string, cwd = process.cwd()): Promise<SourceMarkerScan> {
  return readWithPreparedRoot(path, await prepareRoot(cwd));
}

/**
 * Scan a deterministic, bounded set of source paths with fixed concurrency.
 *
 * Paths are normalized, deduplicated, and sorted before the first
 * {@link MARKER_SCAN_FILE_CAP} are chosen.
 * Anything beyond the cap is returned verbatim in `skippedPaths`, never silently
 * discarded. The working-tree real path is resolved once for the entire batch.
 */
export async function readSourceMarkersBatch(
  paths: readonly string[],
  cwd = process.cwd(),
): Promise<SourceMarkerBatchScan> {
  const candidates = [...new Set(paths.map(normalizeMarkerPath))].sort((a, b) => a.localeCompare(b));
  const selected = candidates.slice(0, MARKER_SCAN_FILE_CAP);
  const skippedPaths = candidates.slice(MARKER_SCAN_FILE_CAP);
  const prepared = selected.length > 0 ? await prepareRoot(cwd) : undefined;
  const scans = prepared
    ? await mapConcurrent(selected, MARKER_SCAN_CONCURRENCY, (path) =>
        readWithPreparedRoot(path, prepared),
      )
    : [];

  return {
    scans,
    skippedPaths,
    limit: MARKER_SCAN_FILE_CAP,
    totalCandidates: candidates.length,
  };
}
