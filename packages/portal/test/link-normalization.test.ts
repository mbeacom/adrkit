/**
 * Link targets keep what the author wrote (ADR-0054 clause 7; PR #292 review findings 2 and 3).
 *
 * The parser strips characters only where a browser would: ASCII tab, LF, and CR anywhere,
 * and C0 controls and space at the ends (the WHATWG URL parser). An embedded space is part of
 * the URL, which `new URL` percent-encodes. The fully stripped form is used for one thing: to
 * spot a scheme disguised with controls or spaces (`java\tscript:`), which is refused. A
 * relative record link is resolved from the original path, and a path holding a control
 * character is not a link at all.
 *
 * ADR-0016 clause 2: observed failing against the code before the fix, 2026-10-10, macOS,
 * Bun 1.4.2: "an embedded space in an external URL is percent-encoded, not removed" (the
 * href was `https://example.test/ab`), "a record link with a space resolves the spaced file,
 * not the squeezed one" (it resolved `0002retry.md` to 0003), and "a relative path with a
 * control character is text" (it resolved to the squeezed record). The scheme-disguise tests
 * in markdown.test.ts passed before and after.
 */

import { describe, expect, test } from 'bun:test';
import type { BodyBlock, BodyInline } from '../src/data/contract.ts';
import { parseMarkdown, type MarkdownOptions } from '../src/data/markdown.ts';

const OPTIONS: MarkdownOptions = {
  basePath: 'docs/adr/0001-a.md',
  recordPaths: new Map([
    ['docs/adr/0002 retry.md', '0002'],
    ['docs/adr/0002retry.md', '0003'],
    ['docs/adr/javascript:x', '0009'],
  ]),
};

function linksOf(blocks: readonly BodyBlock[]): BodyInline[] {
  const found: BodyInline[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if ((value as BodyInline).type === 'link') found.push(value as BodyInline);
      Object.values(value).forEach(walk);
    }
  };
  walk(blocks);
  return found;
}
const linkOf = (source: string) => {
  const links = linksOf(parseMarkdown(source, OPTIONS));
  return links.length === 0 ? null : (({ children: _children, ...rest }) => rest)(links[0] as BodyInline & { children: unknown });
};

describe('external links', () => {
  test('an embedded space in an external URL is percent-encoded, not removed', () => {
    expect(linkOf('[a](<https://example.test/a b>)')).toEqual({ type: 'link', kind: 'external', href: 'https://example.test/a%20b' });
  });

  test('tab, LF, and CR are dropped anywhere, and controls and spaces only at the ends', () => {
    expect(linkOf('[a](<https://exa\tmple.test/x>)')).toEqual({ type: 'link', kind: 'external', href: 'https://example.test/x' });
    expect(linkOf('[a](< https://example.test/x >)')).toEqual({ type: 'link', kind: 'external', href: 'https://example.test/x' });
    expect(linkOf('[a](<\u0001https://example.test/x\u0002>)')).toEqual({ type: 'link', kind: 'external', href: 'https://example.test/x' });
  });

  test('a disguised scheme is still refused', () => {
    for (const destination of ['<java\tscript:x>', '<java script:x>', '<java\u0001script:x>', '< javascript:x>', '<\u0001javascript:x>']) {
      expect({ destination, link: linkOf(`[a](${destination})`) }).toEqual({ destination, link: null });
    }
  });
});

describe('record links', () => {
  test('a record link with a space resolves the spaced file, not the squeezed one', () => {
    expect(linkOf('[a](<./0002 retry.md>)')).toEqual({ type: 'link', kind: 'record', id: '0002', href: '#/adr/0002' });
    expect(linkOf('[a](./0002%20retry.md)')).toEqual({ type: 'link', kind: 'record', id: '0002', href: '#/adr/0002' });
    expect(linkOf('[a](./0002retry.md)')).toEqual({ type: 'link', kind: 'record', id: '0003', href: '#/adr/0003' });
  });

  test('a relative path with a control character is text', () => {
    for (const destination of ['<./0002\tretry.md>', '<./0002\u0001retry.md>', '<./0002\u007fretry.md>']) {
      expect({ destination, link: linkOf(`[a](${destination})`) }).toEqual({ destination, link: null });
    }
  });
});
