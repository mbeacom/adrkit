/**
 * @adrkit/core — the `@adr <ref>` source-marker scanner.
 *
 * Pure text in, markers out. No filesystem, no clock, no per-language parser: the
 * marker is the first content on a dedicated comment line, that line is not inside a
 * fenced block, and in a markdown file the introducer is one markdown actually hides.
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

/** Maximum parsed declarations retained from one file's header window. */
export const MARKER_DECLARATION_FILE_CAP = 64;

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
const COMMENT_INTRODUCERS = [
  '//',
  '/*',
  '{/*',
  '*',
  '#',
  '--',
  ';',
  '%',
  '<!--',
  '"""',
  "'''",
] as const;

/**
 * Markdown's comment syntax, and all of it.
 *
 * The list above is a union of what *source languages* use to hide a line from their
 * own output. Markdown is not one of them: `#` opens a heading, `*` and `-` open list
 * items, and every one of those renders. Lending markdown the source-language set is
 * what let `* @adr 0012 explains this` — a sentence a reader can see — declare a
 * decision, which is the same defect class as a fenced example and not a different
 * rule. What markdown genuinely hides is an HTML comment; the `{/*` expression comment
 * is MDX's, and MDX rejects `<!-- -->` outright, so without it that dialect would have
 * no way to declare at all.
 *
 * This is a subset of the introducers above, chosen by file extension. It is a
 * statement about which constructs are comments in a format, not a parse of its
 * content: no line is read differently, only fewer line-leads count.
 */
const MARKDOWN_COMMENT_INTRODUCERS = ['{/*', '<!--'] as const;

/** Extensions whose comment syntax is markdown's rather than a source language's. */
const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'] as const;

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * A fenced block is where a file *shows* the marker syntax, so a marker inside one is
 * an example rather than a declaration. Three of the four marker-looking lines left in
 * this repository after the dedicated-line rule landed were exactly that: documentation
 * of the feature, claiming to live under the decision it was illustrating.
 *
 * CommonMark-lite, and deliberately still a line-lead rule rather than a parser. A
 * fence is a run of three or more backticks or tildes as the line's first content
 * (after at most three spaces). It closes only on a line of at least as many of the
 * *same* character and nothing else, so a longer fence closes a shorter one and never
 * the reverse, and ``` and ~~~ do not close each other. A backtick fence's info string
 * may not itself contain a backtick. An unclosed fence runs to the end of the window,
 * which is what stops an example at the end of a file from un-fencing everything above
 * it.
 *
 * The fence must lead the physical line for the same reason the marker must: that is
 * the one thing this scanner can know without knowing the language. A fence nested
 * inside a block-comment continuation (` * ``` `) is therefore not detected, and is
 * recorded as a known cost rather than chased with a parser.
 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  /** The fence character, ` or ~. The other one cannot close it. */
  char: string;
  /** The opening run's length. A closer must be at least this long. */
  length: number;
}

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

/**
 * {@link completeLinePrefix}'s cut, measured on the raw bytes: the extent of the
 * complete lines within `bytes[0, limit)`, or `0` when the window holds no line
 * terminator at all.
 *
 * Internal to `@adrkit/core`: `markers/index.ts` does not re-export it, and it is not
 * public API. It exists so the filesystem reader can report the number it cut at
 * without decoding twice.
 *
 * The byte search is equivalent to the string search rather than an approximation of
 * it. `\n` (0x0A) and `\r` (0x0D) are single-byte code points, and every UTF-8
 * continuation byte is >= 0x80, so neither terminator can occur inside a multi-byte
 * sequence. That equivalence is a rule spanning two representations and nothing in the
 * type system holds it, so it is pinned by test ("the byte cut and the text cut cannot
 * drift apart") rather than left to this comment.
 *
 * Measured here rather than by re-encoding the decoded prefix, for the same reason the
 * truncation flag is observed rather than inferred (see
 * {@link scanBoundedSourceMarkerWindow}): `TextDecoder` may drop a BOM or expand one
 * invalid byte into U+FFFD, so a re-encoded length is not the length that was read.
 */
export function completeLineByteExtent(bytes: Uint8Array, limit: number): number {
  for (let index = Math.min(limit, bytes.length) - 1; index >= 0; index -= 1) {
    const byte = bytes[index];
    if (byte === 0x0a || byte === 0x0d) return index + 1;
  }
  return 0;
}

export function headerWindow(source: string): HeaderWindow {
  const bytes = new Uint8Array(MARKER_HEADER_WINDOW_BYTES);
  const encoded = new TextEncoder().encodeInto(source, bytes);
  if (encoded.read === source.length) return { text: source, truncated: false };

  const text = new TextDecoder().decode(bytes.subarray(0, encoded.written));
  return { text: completeLinePrefix(text), truncated: true };
}

function dedicatedMarkerIndex(line: string, introducers: readonly string[]): number | undefined {
  let commentStart = 0;
  while (commentStart < line.length && isSpace(line[commentStart] ?? '')) commentStart += 1;

  for (const introducer of introducers) {
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
  /** Valid declarations parsed but not retained after the per-file cap. */
  omittedMarkers: number;
  /** Whether the header window stopped short of the end of the file. */
  truncated: boolean;
}

function scanWindow(window: HeaderWindow, path: string): ScanSourceMarkersResult {
  const markers: SourceMarker[] = [];
  let omittedMarkers = 0;
  const introducers = isMarkdownPath(path) ? MARKDOWN_COMMENT_INTRODUCERS : COMMENT_INTRODUCERS;

  let fence: OpenFence | null = null;
  const lines = window.text.split(/\r\n|[\r\n]/);
  for (const [index, line] of lines.entries()) {
    // A decoded UTF-8 BOM is metadata, not content. `TextDecoder` removes it for the
    // filesystem path; removing it here keeps the pure string API equivalent, and does
    // so before the fence test so it cannot hide an opening fence either.
    const content = index === 0 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;

    const fenceMatch = FENCE_LINE.exec(content);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      const length = fenceMatch[1]!.length;
      const info = fenceMatch[2]!;
      if (fence) {
        if (char === fence.char && length >= fence.length && info.trim() === '') fence = null;
      } else if (!(char === '`' && info.includes('`'))) {
        fence = { char, length };
      }
      continue;
    }
    // Inside a fence the file is showing the syntax, not using it.
    if (fence) continue;

    const markerStart = dedicatedMarkerIndex(content, introducers);
    if (markerStart === undefined) continue;

    for (const ref of readRefs(content.slice(markerStart + MARKER_TOKEN.length))) {
      if (markers.length < MARKER_DECLARATION_FILE_CAP) {
        const { id, log } = parseAdrRef(ref);
        markers.push({ path, ref, id, ...(log ? { log } : {}), line: index + 1 });
      } else {
        omittedMarkers += 1;
      }
    }
  }

  return { markers, omittedMarkers, truncated: window.truncated };
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
 * The first {@link MARKER_DECLARATION_FILE_CAP} `@adr <ref>` declarations in a
 * source's header window, in physical/source order. `omittedMarkers` reports the
 * exact number of additional valid declarations without allocating an object for each.
 *
 * `path` is echoed onto each marker verbatim — the caller owns the repo-relative,
 * forward-slash form, because it is the string the user will read back. Its extension
 * also selects the introducer set, since `#` is a comment in a shell script and a
 * heading in markdown; nothing else about the scan depends on it.
 */
export function scanSourceMarkers(source: string, path: string): ScanSourceMarkersResult {
  return scanWindow(headerWindow(source), path);
}
