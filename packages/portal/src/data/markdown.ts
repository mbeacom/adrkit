/**
 * The portal's in-house Markdown subset parser
 * ([ADR-0054](../../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clause 7). ADR-0030 clause 1 rules out a library, so this is the whole of it.
 *
 * **Pure.** No clock, file, environment, process, or network; the only globals it touches are
 * `URL` (to normalize an allowed `http:`/`https:` link) and `String`/`Map`. It is called by
 * `buildPortalData`, which ADR-0055's server calls per request, so it must also be fast on
 * hostile input: every construct is a single forward pass, link destinations and titles are
 * length-capped, and block and inline nesting are capped at {@link MAX_NESTING}.
 *
 * ## Supported
 *
 * Paragraphs, ATX headings, `-`/`+`/`*` and `1.`/`1)` lists (nested), fenced code (``` and
 * `~~~`), GFM tables, `>` blockquotes, `*`/`_` emphasis and strong (CommonMark's delimiter
 * algorithm), inline code, inline links `[text](dest "title")`, and `<https://…>` autolinks.
 * Backslash escapes of ASCII punctuation are honoured.
 *
 * ## Everything else is text
 *
 * Raw HTML (block or inline), HTML entities, setext headings, thematic breaks, indented code,
 * reference links, strikethrough, and task-list boxes all arrive as literal `text`. Images
 * become their alt text. A link survives only when its destination is `http:`/`https:`, a
 * same-document `#fragment`, or a relative path that resolves to another record's file
 * (rewritten to `#/adr/<id>`); otherwise only its text survives.
 */

import type {
  BodyBlock,
  BodyCodeBlock,
  BodyHeading,
  BodyInline,
  BodyLink,
  BodyTable,
} from './contract.ts';

/** How links are resolved for one record's body. */
export interface MarkdownOptions {
  /** Repository-relative path of the record whose body this is; relative links resolve against its directory. */
  readonly basePath: string;
  /** Repository-relative record file path → record id, for rewriting links to another record. */
  readonly recordPaths: ReadonlyMap<string, string>;
}

/** Deepest block nesting (lists and quotes) and inline nesting (emphasis and links) kept as structure. */
export const MAX_NESTING = 32;
/** Longest link destination or title considered, in UTF-16 code units; longer ones are not links. */
const MAX_DESTINATION = 1024;
const MAX_TITLE = 1024;
const MAX_AUTOLINK = 2048;
/** Most nested parentheses in a bare link destination (CommonMark's own implementation limit). */
const MAX_DESTINATION_PARENS = 32;
/**
 * Widest GFM table kept as a table. A table pads every row to its delimiter row's width, so
 * output grows as width × rows from an input of width + rows; a wider one is literal text.
 */
export const MAX_TABLE_COLUMNS = 64;
/** Most table cells (header included) one document keeps; rows past it are literal text. */
export const MAX_DOCUMENT_CELLS = 10_000;

interface Context {
  readonly options: MarkdownOptions;
  /** GitHub-slugger occurrence table, one per document. */
  readonly slugs: Map<string, number>;
  /** Table cells kept so far in this document, against {@link MAX_DOCUMENT_CELLS}. */
  readonly cells: { used: number };
}

/** Parse one record body into the restricted token tree. */
export function parseMarkdown(source: string, options: MarkdownOptions): BodyBlock[] {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\u0000/g, '\uFFFD');
  const lines = normalized.split('\n').map(expandLeadingTabs);
  return parseBlocks(lines, 0, { options, slugs: new Map(), cells: { used: 0 } });
}

/* ------------------------------------------------------------------ *
 * Block structure
 * ------------------------------------------------------------------ */

function expandLeadingTabs(line: string): string {
  let column = 0;
  let index = 0;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) {
    column = line[index] === '\t' ? column + 4 - (column % 4) : column + 1;
    index++;
  }
  if (line.indexOf('\t') < 0 || line.lastIndexOf('\t', index) < 0) return line;
  return ' '.repeat(column) + line.slice(index);
}

function isBlank(line: string): boolean {
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== ' ' && line[index] !== '\t') return false;
  }
  return true;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') count++;
  return count;
}

interface Fence {
  readonly indent: number;
  readonly char: '`' | '~';
  readonly length: number;
  readonly info: string;
}

function matchFence(line: string): Fence | null {
  const indent = leadingSpaces(line);
  if (indent > 3) return null;
  const char = line[indent];
  if (char !== '`' && char !== '~') return null;
  let end = indent;
  while (line[end] === char) end++;
  const length = end - indent;
  if (length < 3) return null;
  const info = line.slice(end);
  if (char === '`' && info.includes('`')) return null;
  return { indent, char, length, info: info.trim() };
}

function closesFence(line: string, fence: Fence): boolean {
  const indent = leadingSpaces(line);
  if (indent > 3) return false;
  let end = indent;
  while (line[end] === fence.char) end++;
  return end - indent >= fence.length && isBlank(line.slice(end));
}

function matchHeading(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; content: string } | null {
  const indent = leadingSpaces(line);
  if (indent > 3) return null;
  let level = 0;
  while (line[indent + level] === '#' && level < 7) level++;
  if (level < 1 || level > 6) return null;
  const rest = line.slice(indent + level);
  if (rest.length > 0 && rest[0] !== ' ' && rest[0] !== '\t') return null;
  let content = rest.trim();
  let end = content.length;
  while (end > 0 && content[end - 1] === '#') end--;
  if (end === 0) content = '';
  else if (end < content.length && (content[end - 1] === ' ' || content[end - 1] === '\t')) {
    content = content.slice(0, end).trimEnd();
  }
  return { level: level as 1 | 2 | 3 | 4 | 5 | 6, content };
}

function isThematicBreak(line: string): boolean {
  const indent = leadingSpaces(line);
  if (indent > 3) return false;
  const char = line[indent];
  if (char !== '-' && char !== '*' && char !== '_') return false;
  let count = 0;
  for (let index = indent; index < line.length; index++) {
    const current = line[index];
    if (current === char) count++;
    else if (current !== ' ' && current !== '\t') return false;
  }
  return count >= 3;
}

function isBlockquoteLine(line: string): boolean {
  const indent = leadingSpaces(line);
  return indent <= 3 && line[indent] === '>';
}

function stripBlockquote(line: string): string {
  const index = leadingSpaces(line) + 1;
  return line[index] === ' ' ? line.slice(index + 1) : line.slice(index);
}

interface ListMarker {
  readonly ordered: boolean;
  /** The bullet character, or the ordered delimiter (`.` or `)`). */
  readonly char: string;
  readonly start: number;
  readonly contentOffset: number;
  readonly empty: boolean;
}

function matchListMarker(line: string): ListMarker | null {
  const indent = leadingSpaces(line);
  if (indent > 3) return null;
  const first = line[indent];
  let markerEnd: number;
  let ordered = false;
  let char: string;
  let start = 1;
  if (first === '-' || first === '+' || first === '*') {
    markerEnd = indent + 1;
    char = first;
  } else if (first !== undefined && first >= '0' && first <= '9') {
    let end = indent;
    while (end < line.length && end - indent < 10 && line[end]! >= '0' && line[end]! <= '9') end++;
    if (end - indent > 9) return null;
    const delimiter = line[end];
    if (delimiter !== '.' && delimiter !== ')') return null;
    ordered = true;
    char = delimiter;
    start = Number.parseInt(line.slice(indent, end), 10);
    markerEnd = end + 1;
  } else {
    return null;
  }
  if (markerEnd >= line.length) return { ordered, char, start, contentOffset: markerEnd + 1, empty: true };
  const after = line[markerEnd];
  if (after === '\t') return { ordered, char, start, contentOffset: markerEnd + 1, empty: isBlank(line.slice(markerEnd)) };
  if (after !== ' ') return null;
  let spaces = 0;
  while (line[markerEnd + spaces] === ' ') spaces++;
  if (markerEnd + spaces >= line.length) return { ordered, char, start, contentOffset: markerEnd + 1, empty: true };
  return { ordered, char, start, contentOffset: spaces > 4 ? markerEnd + 1 : markerEnd + spaces, empty: false };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < row.length; index++) {
    const char = row[index];
    if (char === '\\' && row[index + 1] === '|') {
      current += '|';
      index++;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function delimiterAlignments(line: string): ('left' | 'center' | 'right' | null)[] | null {
  if (!line.includes('-')) return null;
  const cells = splitRow(line);
  const align: ('left' | 'center' | 'right' | null)[] = [];
  for (const cell of cells) {
    let body = cell;
    const left = body.startsWith(':');
    if (left) body = body.slice(1);
    const right = body.endsWith(':');
    if (right) body = body.slice(0, -1);
    if (body.length === 0) return null;
    for (let index = 0; index < body.length; index++) if (body[index] !== '-') return null;
    align.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return align;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined || !header.includes('|')) return false;
  if (leadingSpaces(header) > 3 || leadingSpaces(delimiter) > 3) return false;
  const align = delimiterAlignments(delimiter);
  return align !== null && align.length <= MAX_TABLE_COLUMNS && align.length === splitRow(header).length;
}

/** Whether `line` begins a block that ends a paragraph, a lazy continuation, or a table. */
function startsBlock(line: string): boolean {
  return (
    matchFence(line) !== null ||
    matchHeading(line) !== null ||
    isThematicBreak(line) ||
    isBlockquoteLine(line) ||
    matchListMarker(line) !== null
  );
}

function interruptsParagraph(lines: readonly string[], index: number): boolean {
  const line = lines[index]!;
  if (matchFence(line) || matchHeading(line) || isThematicBreak(line) || isBlockquoteLine(line)) return true;
  const marker = matchListMarker(line);
  if (marker && !marker.empty && (!marker.ordered || marker.start === 1)) return true;
  return isTableStart(lines, index);
}

/** Tracks whether a fence is open across lines pushed into a container, so lazy lines never join code. */
class FenceTracker {
  private open: Fence | null = null;
  get inFence(): boolean {
    return this.open !== null;
  }
  push(line: string): void {
    if (this.open) {
      if (closesFence(line, this.open)) this.open = null;
    } else {
      this.open = matchFence(line);
    }
  }
}

function textParagraph(text: string): BodyBlock[] {
  return text.length === 0 ? [] : [{ type: 'paragraph', children: [{ type: 'text', text }] }];
}

function parseBlocks(lines: readonly string[], depth: number, context: Context): BodyBlock[] {
  if (depth > MAX_NESTING) return textParagraph(lines.join('\n').trim());
  const blocks: BodyBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (isBlank(line)) {
      index++;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const content: string[] = [];
      index++;
      while (index < lines.length && !closesFence(lines[index]!, fence)) {
        const current = lines[index]!;
        content.push(current.slice(Math.min(fence.indent, leadingSpaces(current))));
        index++;
      }
      index++; // the closing fence, or one past the end of an unterminated one
      const word = fence.info.split(/[ \t]/, 1)[0] ?? '';
      const block: BodyCodeBlock = {
        type: 'code',
        lang: /^[A-Za-z0-9_+.#-]{1,32}$/.test(word) ? word : null,
        text: content.join('\n'),
      };
      blocks.push(block);
      continue;
    }

    const heading = matchHeading(line);
    if (heading) {
      const children = parseInline(heading.content, context);
      const block: BodyHeading = {
        type: 'heading',
        level: heading.level,
        slug: slugFor(plainTextOf(children), context.slugs),
        children,
      };
      blocks.push(block);
      index++;
      continue;
    }

    if (isThematicBreak(line)) {
      blocks.push(...textParagraph(line.trim()));
      index++;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const inner: string[] = [];
      const fences = new FenceTracker();
      while (index < lines.length) {
        const current = lines[index]!;
        if (isBlockquoteLine(current)) {
          const stripped = stripBlockquote(current);
          inner.push(stripped);
          fences.push(stripped);
        } else if (
          !isBlank(current) &&
          inner.length > 0 &&
          !isBlank(inner[inner.length - 1]!) &&
          !fences.inFence &&
          !startsBlock(current)
        ) {
          inner.push(current.trim());
        } else {
          break;
        }
        index++;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(inner, depth + 1, context) });
      continue;
    }

    const marker = matchListMarker(line);
    if (marker) {
      const items: BodyBlock[][] = [];
      while (index < lines.length) {
        const current = matchListMarker(lines[index]!);
        if (!current || current.ordered !== marker.ordered || current.char !== marker.char) break;
        const itemLines: string[] = [current.empty ? '' : lines[index]!.slice(current.contentOffset)];
        const fences = new FenceTracker();
        fences.push(itemLines[0]!);
        index++;
        while (index < lines.length) {
          const next = lines[index]!;
          if (isBlank(next)) {
            itemLines.push('');
          } else if (leadingSpaces(next) >= current.contentOffset) {
            const stripped = next.slice(current.contentOffset);
            itemLines.push(stripped);
            fences.push(stripped);
          } else if (!isBlank(itemLines[itemLines.length - 1]!) && !fences.inFence && !startsBlock(next)) {
            itemLines.push(next.trim());
          } else {
            break;
          }
          index++;
        }
        while (itemLines.length > 0 && isBlank(itemLines[itemLines.length - 1]!)) itemLines.pop();
        items.push(parseBlocks(itemLines, depth + 1, context));
      }
      blocks.push({ type: 'list', ordered: marker.ordered, start: marker.ordered ? marker.start : null, items });
      continue;
    }

    const align = isTableStart(lines, index) ? delimiterAlignments(lines[index + 1]!)! : null;
    // The header row must fit the document's remaining cell budget, or the table is text.
    if (align !== null && context.cells.used + align.length <= MAX_DOCUMENT_CELLS) {
      const width = align.length;
      const cellsOf = (row: string) => {
        const cells = splitRow(row).slice(0, width);
        while (cells.length < width) cells.push('');
        context.cells.used += width;
        return cells.map((cell) => parseInline(cell, context));
      };
      const header = cellsOf(lines[index]!);
      const rows: BodyInline[][][] = [];
      index += 2;
      const continues = () => index < lines.length && !isBlank(lines[index]!) && !startsBlock(lines[index]!);
      while (continues() && context.cells.used + width <= MAX_DOCUMENT_CELLS) {
        rows.push(cellsOf(lines[index]!));
        index++;
      }
      const table: BodyTable = { type: 'table', align, header, rows };
      blocks.push(table);
      // Rows past the cell budget are kept as one literal paragraph, never padded.
      const rest: string[] = [];
      while (continues()) rest.push(lines[index++]!);
      if (rest.length > 0) blocks.push({ type: 'paragraph', children: [{ type: 'text', text: rest.join('\n') }] });
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !isBlank(lines[index]!) && !interruptsParagraph(lines, index)) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n'), context) });
  }
  return blocks;
}

/* ------------------------------------------------------------------ *
 * Heading slugs (github-slugger's algorithm)
 * ------------------------------------------------------------------ */

function slugFor(text: string, occurrences: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/gu, '-');
  let slug = base;
  while (occurrences.has(slug)) {
    const next = occurrences.get(base)! + 1;
    occurrences.set(base, next);
    slug = `${base}-${next}`;
  }
  occurrences.set(slug, 0);
  return slug;
}

function plainTextOf(inlines: readonly BodyInline[]): string {
  let text = '';
  const stack: BodyInline[] = [...inlines].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'text' || node.type === 'inlineCode') text += node.text;
    else for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!);
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Inline structure: CommonMark's delimiter and bracket stacks
 * ------------------------------------------------------------------ */

type NodeKind = 'root' | 'text' | 'code' | 'emphasis' | 'strong' | 'link' | 'image';

class InlineNode {
  prev: InlineNode | null = null;
  next: InlineNode | null = null;
  parent: InlineNode | null = null;
  first: InlineNode | null = null;
  last: InlineNode | null = null;
  constructor(
    readonly kind: NodeKind,
    public text = '',
    readonly target: LinkTarget | null = null,
  ) {}

  append(child: InlineNode): void {
    child.unlink();
    child.parent = this;
    if (this.last) {
      this.last.next = child;
      child.prev = this.last;
      this.last = child;
    } else {
      this.first = child;
      this.last = child;
    }
  }

  insertAfter(sibling: InlineNode): void {
    sibling.unlink();
    sibling.next = this.next;
    if (sibling.next) sibling.next.prev = sibling;
    sibling.prev = this;
    this.next = sibling;
    sibling.parent = this.parent;
    if (this.parent && this.parent.last === this) this.parent.last = sibling;
  }

  unlink(): void {
    if (this.prev) this.prev.next = this.next;
    else if (this.parent) this.parent.first = this.next;
    if (this.next) this.next.prev = this.prev;
    else if (this.parent) this.parent.last = this.prev;
    this.parent = null;
    this.next = null;
    this.prev = null;
  }
}

interface Delimiter {
  readonly node: InlineNode;
  readonly char: '*' | '_';
  count: number;
  readonly original: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  prev: Delimiter | null;
  next: Delimiter | null;
}

interface Bracket {
  readonly node: InlineNode;
  readonly image: boolean;
  /** Position in the bracket stack; compared against the deactivation watermark. */
  readonly seq: number;
  readonly prev: Bracket | null;
  readonly delimiterBottom: Delimiter | null;
}

type LinkTarget =
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'record'; readonly id: string }
  | { readonly kind: 'fragment'; readonly fragment: string };

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const UNICODE_WHITESPACE = /^\s$/u;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const SPECIAL = new Set(['\\', '`', '*', '_', '!', '[', ']', '<']);

function isAsciiPunctuation(char: string | undefined): boolean {
  return char !== undefined && ASCII_PUNCTUATION.test(char);
}

function unescapePunctuation(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** Maximal backtick runs, by length, as sorted start positions — so a closing run is a binary search. */
function backtickRuns(text: string): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') {
      index++;
      continue;
    }
    const start = index;
    while (text[index] === '`') index++;
    const length = index - start;
    let list = runs.get(length);
    if (!list) runs.set(length, (list = []));
    list.push(start);
  }
  return runs;
}

function firstAtOrAfter(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low < sorted.length ? sorted[low]! : -1;
}

function parseInline(text: string, context: Context): BodyInline[] {
  const root = new InlineNode('root');
  const runs = backtickRuns(text);
  let delimiters: Delimiter | null = null;
  let brackets: Bracket | null = null;
  // A link deactivates every earlier non-image bracket. Every such bracket has a smaller
  // `seq` than the link's opener, so one watermark replaces a walk of the stack, which made
  // `'['.repeat(n) + '[a](b)'.repeat(n)` quadratic.
  let bracketSeq = 0;
  let linksInactiveBelow = 0;
  let pending = '';
  const flush = () => {
    if (pending.length > 0) {
      root.append(new InlineNode('text', pending));
      pending = '';
    }
  };

  const removeDelimiter = (delimiter: Delimiter) => {
    if (delimiter.prev) delimiter.prev.next = delimiter.next;
    if (delimiter.next) delimiter.next.prev = delimiter.prev;
    else delimiters = delimiter.prev;
  };

  const processEmphasis = (bottom: Delimiter | null) => {
    let closer: Delimiter | null = delimiters === bottom ? null : delimiters;
    while (closer && closer.prev !== bottom) closer = closer.prev;
    const openersBottom = new Map<string, Delimiter | null>();
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.original % 3}`;
      const keyBottom = openersBottom.has(key) ? openersBottom.get(key)! : bottom;
      let opener: Delimiter | null = closer.prev;
      let found = false;
      while (opener && opener !== bottom && opener !== keyBottom) {
        const oddMatch =
          (closer.canOpen || opener.canClose) &&
          closer.original % 3 !== 0 &&
          (opener.original + closer.original) % 3 === 0;
        if (opener.char === closer.char && opener.canOpen && !oddMatch) {
          found = true;
          break;
        }
        opener = opener.prev;
      }
      const current: Delimiter = closer;
      if (found && opener) {
        const use = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
        opener.count -= use;
        closer.count -= use;
        opener.node.text = opener.node.text.slice(0, opener.node.text.length - use);
        closer.node.text = closer.node.text.slice(0, closer.node.text.length - use);
        const wrapper = new InlineNode(use === 1 ? 'emphasis' : 'strong');
        let node = opener.node.next;
        while (node && node !== closer.node) {
          const following: InlineNode | null = node.next;
          wrapper.append(node);
          node = following;
        }
        opener.node.insertAfter(wrapper);
        opener.next = closer;
        closer.prev = opener;
        if (opener.count === 0) {
          opener.node.unlink();
          removeDelimiter(opener);
        }
        if (closer.count === 0) {
          const following: Delimiter | null = closer.next;
          closer.node.unlink();
          removeDelimiter(closer);
          closer = following;
        }
      } else {
        closer = closer.next;
        openersBottom.set(key, current.prev);
        if (!current.canOpen) removeDelimiter(current);
      }
    }
    while (delimiters && delimiters !== bottom) removeDelimiter(delimiters);
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index]!;

    if (!SPECIAL.has(char)) {
      const start = index;
      while (index < text.length && !SPECIAL.has(text[index]!)) index++;
      pending += text.slice(start, index);
      continue;
    }

    if (char === '\\') {
      if (isAsciiPunctuation(text[index + 1])) {
        pending += text[index + 1];
        index += 2;
      } else {
        pending += '\\';
        index++;
      }
      continue;
    }

    if (char === '`') {
      let end = index;
      while (text[end] === '`') end++;
      const length = end - index;
      const close = firstAtOrAfter(runs.get(length) ?? [], end);
      if (close < 0) {
        pending += text.slice(index, end);
        index = end;
        continue;
      }
      flush();
      let code = text.slice(end, close).replace(/\n/g, ' ');
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim().length > 0) {
        code = code.slice(1, -1);
      }
      root.append(new InlineNode('code', code));
      index = close + length;
      continue;
    }

    if (char === '*' || char === '_') {
      let end = index;
      while (text[end] === char) end++;
      const length = end - index;
      const before = index === 0 ? '\n' : text[index - 1]!;
      const after = end >= text.length ? '\n' : text[end]!;
      const beforeSpace = UNICODE_WHITESPACE.test(before);
      const afterSpace = UNICODE_WHITESPACE.test(after);
      const beforePunct = UNICODE_PUNCTUATION.test(before);
      const afterPunct = UNICODE_PUNCTUATION.test(after);
      const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
      const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
      const canOpen = char === '*' ? leftFlanking : leftFlanking && (!rightFlanking || beforePunct);
      const canClose = char === '*' ? rightFlanking : rightFlanking && (!leftFlanking || afterPunct);
      flush();
      const node = new InlineNode('text', text.slice(index, end));
      root.append(node);
      if (canOpen || canClose) {
        const delimiter: Delimiter = {
          node,
          char,
          count: length,
          original: length,
          canOpen,
          canClose,
          prev: delimiters,
          next: null,
        };
        if (delimiters) delimiters.next = delimiter;
        delimiters = delimiter;
      }
      index = end;
      continue;
    }

    if (char === '!' || char === '[') {
      const image = char === '!';
      if (image && text[index + 1] !== '[') {
        pending += '!';
        index++;
        continue;
      }
      flush();
      const node = new InlineNode('text', image ? '![' : '[');
      root.append(node);
      brackets = { node, image, seq: bracketSeq++, prev: brackets, delimiterBottom: delimiters };
      index += image ? 2 : 1;
      continue;
    }

    if (char === ']') {
      const opener: Bracket | null = brackets;
      if (!opener) {
        pending += ']';
        index++;
        continue;
      }
      const active = opener.image || opener.seq >= linksInactiveBelow;
      const tail = active ? parseLinkTail(text, index + 1) : null;
      if (!tail) {
        brackets = opener.prev;
        pending += ']';
        index++;
        continue;
      }
      flush();
      const node = new InlineNode(
        opener.image ? 'image' : 'link',
        '',
        opener.image ? null : resolveLink(tail.destination, context.options),
      );
      let child = opener.node.next;
      while (child) {
        const following: InlineNode | null = child.next;
        node.append(child);
        child = following;
      }
      root.append(node);
      processEmphasis(opener.delimiterBottom);
      opener.node.unlink();
      if (!opener.image) linksInactiveBelow = opener.seq;
      brackets = opener.prev;
      index = tail.end;
      continue;
    }

    // char === '<': an autolink, or a literal '<' (raw HTML is never parsed).
    const autolink = matchAutolink(text, index);
    if (autolink) {
      flush();
      const node = new InlineNode('link', '', { kind: 'external', href: autolink.href });
      node.append(new InlineNode('text', autolink.text));
      root.append(node);
      index = autolink.end;
    } else {
      pending += '<';
      index++;
    }
  }
  flush();
  processEmphasis(null);
  return convert(root, 0, false);
}

function skipSpace(text: string, index: number): number {
  let newlines = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\n') {
      if (++newlines > 1) break;
    } else if (char !== ' ' && char !== '\t') {
      break;
    }
    index++;
  }
  return index;
}

/** Parse `(destination "title")` starting at `start` (which must be `(`). */
function parseLinkTail(text: string, start: number): { destination: string; end: number } | null {
  if (text[start] !== '(') return null;
  let index = skipSpace(text, start + 1);
  let destination: string;
  if (text[index] === '<') {
    const open = index;
    index++;
    while (index < text.length && index - open <= MAX_DESTINATION) {
      const char = text[index];
      if (char === '\n' || char === '<') return null;
      if (char === '>') break;
      index += char === '\\' && isAsciiPunctuation(text[index + 1]) ? 2 : 1;
    }
    if (text[index] !== '>') return null;
    destination = unescapePunctuation(text.slice(open + 1, index));
    index++;
  } else {
    const open = index;
    let depth = 0;
    while (index < text.length) {
      if (index - open > MAX_DESTINATION) return null;
      const char = text[index]!;
      if (char === '\\' && isAsciiPunctuation(text[index + 1])) {
        index += 2;
        continue;
      }
      if (char === '(') {
        if (++depth > MAX_DESTINATION_PARENS) return null;
      } else if (char === ')') {
        if (depth === 0) break;
        depth--;
      } else if (char <= ' ' || char === '\u007f') {
        break;
      }
      index++;
    }
    if (depth !== 0) return null;
    destination = unescapePunctuation(text.slice(open, index));
  }
  const beforeTitle = index;
  index = skipSpace(text, index);
  const quote = text[index];
  if (index > beforeTitle && (quote === '"' || quote === "'" || quote === '(')) {
    const close = quote === '(' ? ')' : quote;
    const open = index;
    index++;
    while (index < text.length && text[index] !== close) {
      if (index - open > MAX_TITLE) return null;
      if (quote === '(' && text[index] === '(') return null;
      index += text[index] === '\\' ? 2 : 1;
    }
    if (text[index] !== close) return null;
    index = skipSpace(text, index + 1);
  }
  if (text[index] !== ')') return null;
  return { destination, end: index + 1 };
}

function matchAutolink(text: string, start: number): { href: string; text: string; end: number } | null {
  let index = start + 1;
  while (index < text.length && index - start <= MAX_AUTOLINK) {
    const char = text[index]!;
    if (char === '>' || char === '<' || char <= ' ') break;
    index++;
  }
  if (text[index] !== '>') return null;
  const inner = text.slice(start + 1, index);
  const href = externalHref(inner);
  return href ? { href, text: inner, end: index + 1 } : null;
}

/* ------------------------------------------------------------------ *
 * The link allowlist
 * ------------------------------------------------------------------ */

/** `http:`/`https:` only, WHATWG-normalized; anything else is `null`. */
function externalHref(destination: string): string | null {
  // Browsers drop ASCII tab and newline anywhere in a URL and C0 controls and space at its
  // ends, so `java\tscript:` is `javascript:` to them. Judge the scheme on what they see.
  const cleaned = destination.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned);
  if (!scheme) return null;
  const name = scheme[1]!.toLowerCase();
  if (name !== 'http' && name !== 'https') return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Resolve `relative` against the directory of `basePath`, POSIX-style; `null` if it climbs above the root. */
function resolveRepoPath(basePath: string, relative: string): string | null {
  const slash = basePath.lastIndexOf('/');
  const directory = slash < 0 ? '' : basePath.slice(0, slash);
  const joined = relative.startsWith('/') ? relative.slice(1) : directory ? `${directory}/${relative}` : relative;
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function resolveLink(destination: string, options: MarkdownOptions): LinkTarget | null {
  const href = externalHref(destination);
  if (href) return { kind: 'external', href };

  const cleaned = destination.replace(/[\u0000-\u0020\u007f]/g, '');
  if (cleaned.length === 0) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(cleaned)) return null; // any other scheme
  if (cleaned.startsWith('#')) {
    const fragment = decode(cleaned.slice(1)) ?? cleaned.slice(1);
    return fragment.length > 0 ? { kind: 'fragment', fragment } : null;
  }
  // `//host` and `\` forms reach another origin in a browser; they are never record links.
  if (cleaned.startsWith('//') || cleaned.includes('\\')) return null;
  const pathPart = cleaned.split(/[?#]/, 1)[0]!;
  const decoded = decode(pathPart);
  if (decoded === null || decoded.length === 0) return null;
  const resolved = resolveRepoPath(options.basePath, decoded);
  if (resolved === null) return null;
  const id = options.recordPaths.get(resolved);
  return id === undefined ? null : { kind: 'record', id };
}

/* ------------------------------------------------------------------ *
 * Inline nodes to tokens
 * ------------------------------------------------------------------ */

function pushText(out: BodyInline[], text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + text };
  else out.push({ type: 'text', text });
}

function pushAll(out: BodyInline[], inlines: readonly BodyInline[]): void {
  for (const inline of inlines) {
    if (inline.type === 'text') pushText(out, inline.text);
    else out.push(inline);
  }
}

/** Concatenated text of a node's subtree, iteratively, so a pathologically deep tree cannot overflow the stack. */
function plainTextOfNode(node: InlineNode): string {
  let text = '';
  const stack: InlineNode[] = [];
  for (let child = node.last; child; child = child.prev) stack.push(child);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'text' || current.kind === 'code') text += current.text;
    for (let child = current.last; child; child = child.prev) stack.push(child);
  }
  return text;
}

function convert(parent: InlineNode, depth: number, inLink: boolean): BodyInline[] {
  const out: BodyInline[] = [];
  for (let node = parent.first; node; node = node.next) {
    switch (node.kind) {
      case 'text':
        pushText(out, node.text);
        break;
      case 'code':
        out.push({ type: 'inlineCode', text: node.text });
        break;
      case 'image':
        pushText(out, plainTextOfNode(node));
        break;
      case 'emphasis':
      case 'strong':
        if (depth >= MAX_NESTING) pushText(out, plainTextOfNode(node));
        else out.push({ type: node.kind, children: convert(node, depth + 1, inLink) });
        break;
      case 'link': {
        if (depth >= MAX_NESTING) {
          pushText(out, plainTextOfNode(node));
          break;
        }
        const children = convert(node, depth + 1, true);
        const target = node.target;
        if (inLink || target === null) {
          pushAll(out, children);
          break;
        }
        let link: BodyLink;
        if (target.kind === 'external') link = { type: 'link', kind: 'external', href: target.href, children };
        else if (target.kind === 'record') {
          link = { type: 'link', kind: 'record', id: target.id, href: `#/adr/${target.id}`, children };
        } else link = { type: 'link', kind: 'fragment', fragment: target.fragment, children };
        out.push(link);
        break;
      }
      default:
        break;
    }
  }
  return out;
}
