/**
 * @adrkit/core — the `@adr <ref>` source-marker scanner.
 *
 * Pure text in, markers out. No filesystem, no clock, no per-language parser: the
 * marker is a token in a comment, and the only thing this module knows about any
 * language is that *something* opened a comment earlier on the line.
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
 * construction: adrkit never parses the file, it only requires one of these to appear
 * before the marker on the same physical line.
 *
 * The trade-off is stated rather than hidden. `log("// @adr 0012")` inside a string
 * literal is read as a marker, and a marker on a bare continuation line of a `/* … *\/`
 * block is not. Both are visible in the reported line number, and the alternative — a
 * parser per language — is the thing this design refuses to become.
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
export function headerWindow(source: string): HeaderWindow {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length <= MARKER_HEADER_WINDOW_BYTES) return { text: source, truncated: false };

  const text = new TextDecoder().decode(bytes.subarray(0, MARKER_HEADER_WINDOW_BYTES));
  const lastNewline = text.lastIndexOf('\n');
  return { text: lastNewline === -1 ? '' : text.slice(0, lastNewline + 1), truncated: true };
}

function hasCommentIntroducer(line: string, markerIndex: number): boolean {
  const prefix = line.slice(0, markerIndex);
  return COMMENT_INTRODUCERS.some((introducer) => prefix.includes(introducer));
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

/**
 * Every `@adr <ref>` marker in a source's header window, in the order they appear.
 *
 * `path` is echoed onto each marker verbatim — the caller owns the repo-relative,
 * forward-slash form, because it is the string the user will read back.
 */
export function scanSourceMarkers(source: string, path: string): ScanSourceMarkersResult {
  const window = headerWindow(source);
  const markers: SourceMarker[] = [];

  const lines = window.text.split('\n');
  for (const [index, line] of lines.entries()) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(MARKER_TOKEN, from);
      if (at === -1) break;
      from = at + MARKER_TOKEN.length;
      if (!hasCommentIntroducer(line, at)) continue;

      for (const ref of readRefs(line.slice(from))) {
        const { id, log } = parseAdrRef(ref);
        markers.push({ path, ref, id, ...(log ? { log } : {}), line: index + 1 });
      }
    }
  }

  return { markers, truncated: window.truncated };
}
