/**
 * Display-width-safe text helpers shared by the terminal presentations of
 * `adr graph` (ADR-0033) and `adr queue` (ADR-0044). Widths are measured in
 * terminal cells over grapheme clusters, never UTF-16 length, so a CJK or emoji
 * title cannot overrun a budgeted line.
 */

const UNSAFE_TERMINAL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const MARK = /\p{Mark}/u;
const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function cleanText(value: string): string {
  return value.replace(UNSAFE_TERMINAL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}

export function clampColumns(columns: number): number {
  return Math.max(40, Math.min(160, Number.isFinite(columns) ? Math.floor(columns) : 100));
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function graphemeWidth(grapheme: string): number {
  if (EMOJI_GRAPHEME.test(grapheme)) return 2;

  let width = 0;
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f || MARK.test(character)) {
      continue;
    }
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }
  return width;
}

function graphemes(value: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(value)].map((segment) => segment.segment);
}

export function terminalDisplayWidth(value: string): number {
  return graphemes(value).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

export function truncate(value: string, width: number): string {
  if (terminalDisplayWidth(value) <= width) return value;
  if (width <= 3) return '.'.repeat(Math.max(0, width));

  const limit = width - 3;
  let output = '';
  let used = 0;
  for (const grapheme of graphemes(value)) {
    const next = graphemeWidth(grapheme);
    if (used + next > limit) break;
    output += grapheme;
    used += next;
  }
  return `${output}...`;
}

export function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (terminalDisplayWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = terminalDisplayWidth(word) <= width ? word : truncate(word, width);
  }
  if (current) lines.push(current);
  return lines;
}
