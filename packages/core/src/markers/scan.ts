/**
 * @adrkit/core — the `@adr <ref>` source-marker scanner.
 *
 * Pure text in, markers out. No filesystem, no clock, no per-language parser: the
 * marker is the first content on a dedicated comment line.
 */

import { AdrRef } from '../schema/adr.schema.ts';
import { parseAdrRef } from '../schema/ref.ts';
import type { SourceMarker } from './types.ts';

/**
 * How much of a file counts as its header.
 *
 * A marker is a *claim* that the file lives under a decision. A mention 40 KB down is
 * prose about that decision — a comment discussing it, a changelog entry, a test
 * fixture. Bounding the window is what keeps the two apart, and it caps the scan cost
 * of a generated or vendored file at a constant regardless of its size.
 */
export const MARKER_HEADER_WINDOW_BYTES = 8192;

/** The marker token. Deliberately not `@adrkit`, which is the npm scope. */
const MARKER_TOKEN = '@adr';

/**
 * Comment introducers as tokens rather than as a grammar. Language-agnostic by
 * construction: adrkit never parses the file, it only requires one of these to begin
 * the physical line (after optional whitespace), with `@adr` as the comment's first
 * content.
 *
 * Requiring a dedicated line is load-bearing: prose that discusses `@adr 0012` must
 * not make an accepted decision binding, and string literals such as
 * `log("// @adr 0012")` must not either. The cost is intentional: a trailing
 * `} // @adr 0012` is not a file-level declaration.
 */
const COMMENT_INTRODUCERS = ['//', '/*', '*', '#', '--', ';', '%', '<!--', '"""', "'''"] as const;

/** Characters that can appear inside an `AdrRef` — digits, ULID letters, `-`, and the log `:`. */
function isRefChar(char: string): boolean {
  return /[0-9A-Za-z:-]/.test(char);
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t';
}

export interface HeaderWindow {
  text: string;
  /** The window did not cover the whole file: content below it was never scanned. */
  truncated: boolean;
}

/**
 * The leading {@link MARKER_HEADER_WINDOW_BYTES} of a source, cut back to the last
 * complete line when the file is longer.
 *
 * Dropping the severed line is load-bearing, not tidiness: half of `@adr 00123` is
 * `@adr 0012`, a different and perfectly valid reference. Truncation must never
 * invent a match.
 */
function completeLinePrefix(source: string): string {
  const lastNewline = Math.max(source.lastIndexOf('\n'), source.lastIndexOf('\r'));
  return lastNewline === -1 ? '' : source.slice(0, lastNewline + 1);
}

export function headerWindow(source: string): HeaderWindow {
  const bytes = new Uint8Array(MARKER_HEADER_WINDOW_BYTES);
  const encoded = new TextEncoder().encodeInto(source, bytes);
  if (encoded.read === source.length) return { text: source, truncated: false };

  const text = new TextDecoder().decode(bytes.subarray(0, encoded.written));
  return { text: completeLinePrefix(text), truncated: true };
}

function dedicatedMarkerIndex(line: string, firstLine: boolean): number | undefined {
  // A decoded UTF-8 BOM is metadata, not comment content. `TextDecoder` removes it
  // for the filesystem path; accepting it here keeps the pure string API equivalent.
  let commentStart = firstLine && line.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (commentStart < line.length && isSpace(line[commentStart] ?? '')) commentStart += 1;

  for (const introducer of COMMENT_INTRODUCERS) {
    if (!line.startsWith(introducer, commentStart)) continue;
    let markerStart = commentStart + introducer.length;
    while (markerStart < line.length && isSpace(line[markerStart] ?? '')) markerStart += 1;
    if (line.startsWith(MARKER_TOKEN, markerStart)) return markerStart;
  }

  return undefined;
}

/**
 * The references belonging to one `@adr` token.
 *
 * A comma continues the list; a bare space ends it. `@adr 0012, 0013` is two
 * declarations, `@adr 0012 1234567` is one declaration followed by a number. Guessing
 * the second case would turn ticket ids, years, and line counts into dangling
 * references, and a warning nobody can silence is worse than a marker nobody wrote.
 */
function readRefs(rest: string): string[] {
  // A separator is required, so `@adrkit/core` in a comment is not a marker.
  if (rest.length === 0 || !isSpace(rest[0] ?? '')) return [];

  const refs: string[] = [];
  let cursor = 0;
  for (;;) {
    while (cursor < rest.length && isSpace(rest[cursor] ?? '')) cursor += 1;

    const start = cursor;
    while (cursor < rest.length && isRefChar(rest[cursor] ?? '')) cursor += 1;
    const token = rest.slice(start, cursor);
    if (!token || !AdrRef.safeParse(token).success) return refs;
    refs.push(token);

    let lookahead = cursor;
    while (lookahead < rest.length && isSpace(rest[lookahead] ?? '')) lookahead += 1;
    if (rest[lookahead] !== ',') return refs;
    cursor = lookahead + 1;
  }
}

export interface ScanSourceMarkersResult {
  markers: SourceMarker[];
  /** Whether the header window stopped short of the end of the file. */
  truncated: boolean;
}

function scanWindow(window: HeaderWindow, path: string): ScanSourceMarkersResult {
  const markers: SourceMarker[] = [];

  const lines = window.text.split(/\r\n|[\r\n]/);
  for (const [index, line] of lines.entries()) {
    const markerStart = dedicatedMarkerIndex(line, index === 0);
    if (markerStart === undefined) continue;

    for (const ref of readRefs(line.slice(markerStart + MARKER_TOKEN.length))) {
      const { id, log } = parseAdrRef(ref);
      markers.push({ path, ref, id, ...(log ? { log } : {}), line: index + 1 });
    }
  }

  return { markers, truncated: window.truncated };
}

/**
 * Scan text that the filesystem reader has already bounded to the byte window.
 * Internal to `@adrkit/core`: the public scanner below always derives its own bound.
 *
 * The observed flag cannot be reconstructed from decoded text because `TextDecoder`
 * may remove a BOM or expand invalid bytes to U+FFFD.
 */
export function scanBoundedSourceMarkerWindow(
  source: string,
  path: string,
  truncated: boolean,
): ScanSourceMarkersResult {
  return scanWindow({ text: truncated ? completeLinePrefix(source) : source, truncated }, path);
}

/**
 * Every `@adr <ref>` marker in a source's header window, in the order they appear.
 *
 * `path` is echoed onto each marker verbatim — the caller owns the repo-relative,
 * forward-slash form, because it is the string the user will read back.
 */
export function scanSourceMarkers(source: string, path: string): ScanSourceMarkersResult {
  return scanWindow(headerWindow(source), path);
}
