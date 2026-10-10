/**
 * `src/data/markdown.ts` — the in-house Markdown subset parser (ADR-0054 clause 7).
 *
 * The parser's output goes straight into a page on the consumer's origin, so the tests that
 * matter most are the hostile ones: every input either becomes a closed token tree whose
 * only links are `http:`/`https:`, a fragment, or a record route, or it becomes text.
 * `assertClosedTree` checks that shape on every input below, including a seeded fuzz run.
 *
 * ADR-0016 clause 2: observed failing. Each mutation was made in `src/data/markdown.ts`, the
 * suite run, and the edit reverted; the retained input is the mutation named here.
 * - `externalHref` widened to admit any scheme (the `http`/`https` name check dropped and
 *   `url.href` returned whatever the protocol): "javascript:, data:, vbscript: and their
 *   disguises are never links", "a disguised scheme whose disguise matches a record path is
 *   still not a link", and the seeded fuzz invariant failed.
 * - the control-character strip in `externalHref`/`resolveLink` removed (`cleaned = destination`):
 *   "a disguised scheme whose disguise matches a record path is still not a link" failed: the
 *   angle-form `<java\tscript:x>` then resolved as a relative path to a record. (The bare
 *   form never reaches the check: a tab ends a bare destination.)
 * - the `inLink` flattening in `convert` removed (nested links emitted as links): "a link
 *   never contains a link" failed.
 * - the `MAX_NESTING` check removed from `parseBlocks`: "10,000 nested quotes stay bounded",
 *   "10,000 nested list items stay bounded", and the 100k `> ` timing test failed.
 */

import { describe, expect, test } from 'bun:test';
import type { BodyBlock, BodyInline } from '../src/data/contract.ts';
import { MAX_NESTING, parseMarkdown, type MarkdownOptions } from '../src/data/markdown.ts';

const OPTIONS: MarkdownOptions = {
  basePath: 'docs/adr/0001-use-the-sync-protocol.md',
  recordPaths: new Map([
    ['docs/adr/0001-use-the-sync-protocol.md', '0001'],
    ['docs/adr/0002-retry-on-transient-failure.md', '0002'],
  ]),
};

const parse = (source: string) => parseMarkdown(source, OPTIONS);

const BLOCK_KEYS: Record<string, string[]> = {
  heading: ['children', 'level', 'slug', 'type'],
  paragraph: ['children', 'type'],
  list: ['items', 'ordered', 'start', 'type'],
  code: ['lang', 'text', 'type'],
  table: ['align', 'header', 'rows', 'type'],
  blockquote: ['children', 'type'],
};
const INLINE_KEYS: Record<string, string[]> = {
  text: ['text', 'type'],
  emphasis: ['children', 'type'],
  strong: ['children', 'type'],
  inlineCode: ['text', 'type'],
  'link:external': ['children', 'href', 'kind', 'type'],
  'link:record': ['children', 'href', 'id', 'kind', 'type'],
  'link:fragment': ['children', 'fragment', 'kind', 'type'],
};

/** Every node is one of the closed set of shapes, and every link is allowed. */
function assertClosedTree(blocks: readonly BodyBlock[]): void {
  const inline = (nodes: readonly BodyInline[], inLink: boolean, depth: number): void => {
    expect(depth).toBeLessThanOrEqual(MAX_NESTING + 1);
    for (const node of nodes) {
      const key = node.type === 'link' ? `link:${node.kind}` : node.type;
      expect(Object.keys(node).sort()).toEqual(INLINE_KEYS[key]!);
      if (node.type === 'link') {
        expect(inLink).toBe(false);
        if (node.kind === 'external') expect(node.href).toMatch(/^https?:\/\//);
        if (node.kind === 'record') expect(node.href).toBe(`#/adr/${node.id}`);
        inline(node.children, true, depth + 1);
      } else if (node.type === 'emphasis' || node.type === 'strong') {
        inline(node.children, inLink, depth + 1);
      }
    }
  };
  const block = (nodes: readonly BodyBlock[], depth: number): void => {
    expect(depth).toBeLessThanOrEqual(MAX_NESTING + 2);
    for (const node of nodes) {
      expect(Object.keys(node).sort()).toEqual(BLOCK_KEYS[node.type]!);
      if (node.type === 'heading' || node.type === 'paragraph') inline(node.children, false, 0);
      if (node.type === 'list') for (const item of node.items) block(item, depth + 1);
      if (node.type === 'blockquote') block(node.children, depth + 1);
      if (node.type === 'table') {
        for (const cell of node.header) inline(cell, false, 0);
        for (const row of node.rows) {
          expect(row).toHaveLength(node.align.length);
          for (const cell of row) inline(cell, false, 0);
        }
      }
    }
  };
  block(blocks, 0);
}

/** All links in a tree, flattened. */
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

/** The concatenated text of a tree. */
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value && typeof value === 'object') {
    const node = value as { type?: string; text?: string };
    if (node.type === 'text' || node.type === 'inlineCode') return node.text ?? '';
    return Object.values(value).map(textOf).join('');
  }
  return '';
}

describe('blocks', () => {
  test('paragraphs keep soft breaks as newlines and split on blank lines', () => {
    expect(parse('one\ntwo   \n\nthree')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'one\ntwo' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'three' }] },
    ]);
  });

  test('ATX headings, with closing sequences, levels, and unique GitHub-style slugs', () => {
    expect(parse('# Context #\n## Context\n###### Six: `x` & y\n####### seven')).toEqual([
      { type: 'heading', level: 1, slug: 'context', children: [{ type: 'text', text: 'Context' }] },
      { type: 'heading', level: 2, slug: 'context-1', children: [{ type: 'text', text: 'Context' }] },
      {
        type: 'heading',
        level: 6,
        slug: 'six-x--y',
        children: [{ type: 'text', text: 'Six: ' }, { type: 'inlineCode', text: 'x' }, { type: 'text', text: ' & y' }],
      },
      { type: 'paragraph', children: [{ type: 'text', text: '####### seven' }] },
    ]);
    expect(parse('#hashtag')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '#hashtag' }] }]);
  });

  test('bullet and ordered lists, nested by indentation, with lazy continuation', () => {
    expect(parse('- a\n  continued\n  - nested\nlazy\n- b\n\n3. three\n4. four')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: null,
        items: [
          [
            { type: 'paragraph', children: [{ type: 'text', text: 'a\ncontinued' }] },
            {
              type: 'list',
              ordered: false,
              start: null,
              items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'nested\nlazy' }] }]],
            },
          ],
          [{ type: 'paragraph', children: [{ type: 'text', text: 'b' }] }],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          [{ type: 'paragraph', children: [{ type: 'text', text: 'three' }] }],
          [{ type: 'paragraph', children: [{ type: 'text', text: 'four' }] }],
        ],
      },
    ]);
  });

  test('a different bullet character starts a new list', () => {
    const blocks = parse('- a\n* b');
    expect(blocks.map((block) => block.type)).toEqual(['list', 'list']);
  });

  test('fenced code keeps its text verbatim and its language only when it is a plain word', () => {
    expect(parse('```ts title\nconst a = `<b>`;\n  indented\n```\n~~~<script>\nx\n~~~')).toEqual([
      { type: 'code', lang: 'ts', text: 'const a = `<b>`;\n  indented' },
      { type: 'code', lang: null, text: 'x' },
    ]);
  });

  test('an unterminated fence runs to the end of its container, as text', () => {
    expect(parse('before\n\n```\n# not a heading\n[not](https://a.link)')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'before' }] },
      { type: 'code', lang: null, text: '# not a heading\n[not](https://a.link)' },
    ]);
    const inList = parse('- item\n  ```\n  code\nafter');
    expect(inList[0]).toEqual({ type: 'list', ordered: false, start: null, items: [[
      { type: 'paragraph', children: [{ type: 'text', text: 'item' }] },
      { type: 'code', lang: null, text: 'code' },
    ]] });
    expect(inList[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'after' }] });
  });

  test('GFM tables: alignment, escaped pipes, short rows padded and long rows cut', () => {
    expect(parse('| a | b |\n|:--|:-:|\n| 1 \\| 2 | **x** |\n| only |\n| p | q | r |')).toEqual([
      {
        type: 'table',
        align: ['left', 'center'],
        header: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]],
        rows: [
          [[{ type: 'text', text: '1 | 2' }], [{ type: 'strong', children: [{ type: 'text', text: 'x' }] }]],
          [[{ type: 'text', text: 'only' }], []],
          [[{ type: 'text', text: 'p' }], [{ type: 'text', text: 'q' }]],
        ],
      },
    ]);
  });

  test('a header whose cell count differs from the delimiter row is not a table', () => {
    expect(parse('a | b\n---')[0]!.type).toBe('paragraph');
  });

  test('blockquotes nest and carry lazy lines', () => {
    expect(parse('> **Status.** accepted\nlazy\n> > inner')).toEqual([
      {
        type: 'blockquote',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'strong', children: [{ type: 'text', text: 'Status.' }] }, { type: 'text', text: ' accepted\nlazy' }],
          },
          { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'inner' }] }] },
        ],
      },
    ]);
  });

  test('unsupported blocks are literal text: thematic breaks, setext, indented code, task boxes', () => {
    expect(textOf(parse('---'))).toBe('---');
    expect(textOf(parse('Title\n====='))).toBe('Title\n=====');
    expect(textOf(parse('    indented code'))).toBe('indented code');
    expect(textOf(parse('- [ ] open\n- [x] done'))).toBe('[ ] open[x] done');
  });
});

describe('inlines', () => {
  test('emphasis and strong follow CommonMark delimiter rules', () => {
    expect(parse('*a* **b** ***c*** _d_ snake_case_name 2*3*4')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'emphasis', children: [{ type: 'text', text: 'a' }] },
          { type: 'text', text: ' ' },
          { type: 'strong', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' ' },
          { type: 'emphasis', children: [{ type: 'strong', children: [{ type: 'text', text: 'c' }] }] },
          { type: 'text', text: ' ' },
          { type: 'emphasis', children: [{ type: 'text', text: 'd' }] },
          { type: 'text', text: ' snake_case_name 2' },
          { type: 'emphasis', children: [{ type: 'text', text: '3' }] },
          { type: 'text', text: '4' },
        ],
      },
    ]);
  });

  test('inline code binds tighter than everything and strips one space of padding', () => {
    expect(parse('`*no*` `` a`b `` ` x ` `open')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'inlineCode', text: '*no*' },
          { type: 'text', text: ' ' },
          { type: 'inlineCode', text: 'a`b' },
          { type: 'text', text: ' ' },
          { type: 'inlineCode', text: 'x' },
          { type: 'text', text: ' `open' },
        ],
      },
    ]);
  });

  test('backslash escapes make punctuation literal', () => {
    expect(textOf(parse('\\*not emphasis\\* \\[not a link](https://x) \\q'))).toBe('*not emphasis* [not a link](https://x) \\q');
    expect(linksOf(parse('\\[x](https://x)'))).toEqual([]);
  });

  test('http and https links are kept, normalized', () => {
    expect(parse('[docs](https://Example.com/a?b=1#c "title") <http://example.com>')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'link', kind: 'external', href: 'https://example.com/a?b=1#c', children: [{ type: 'text', text: 'docs' }] },
          { type: 'text', text: ' ' },
          { type: 'link', kind: 'external', href: 'http://example.com/', children: [{ type: 'text', text: 'http://example.com' }] },
        ],
      },
    ]);
  });

  test('a fragment link names a fragment, never an href that would replace the hash route', () => {
    expect(linksOf(parse('[see](#decision) [enc](#a%20b) [empty](#)'))).toEqual([
      { type: 'link', kind: 'fragment', fragment: 'decision', children: [{ type: 'text', text: 'see' }] },
      { type: 'link', kind: 'fragment', fragment: 'a b', children: [{ type: 'text', text: 'enc' }] },
    ]);
  });

  test('relative links that resolve to another record are rewritten to its route', () => {
    const links = linksOf(
      parse(
        '[a](./0002-retry-on-transient-failure.md) [b](0002-retry-on-transient-failure.md#section) ' +
          '[c](../adr/0002-retry-on-transient-failure.md?x) [d](/docs/adr/0002-retry-on-transient-failure.md) ' +
          '[e](0002%2Dretry-on-transient-failure.md) [self](0001-use-the-sync-protocol.md)',
      ),
    );
    expect(links.map((link) => (link.type === 'link' && link.kind === 'record' ? link.href : null))).toEqual([
      '#/adr/0002',
      '#/adr/0002',
      '#/adr/0002',
      '#/adr/0002',
      '#/adr/0002',
      '#/adr/0001',
    ]);
  });

  test('relative links to anything else keep only their text', () => {
    const blocks = parse(
      '[agents](../../AGENTS.md) [up](../../../../../etc/passwd) [missing](./0099-nope.md) [bad%](%E0%A4%A.md) [empty]()',
    );
    expect(linksOf(blocks)).toEqual([]);
    expect(textOf(blocks)).toBe('agents up missing bad% empty');
  });

  test('images become their alt text, including inside a link', () => {
    expect(parse('![alt *text*](https://img.example/x.png) [![badge](b.svg)](https://ci.example)')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'alt text ' },
          { type: 'link', kind: 'external', href: 'https://ci.example/', children: [{ type: 'text', text: 'badge' }] },
        ],
      },
    ]);
  });

  test('a link never contains a link', () => {
    const blocks = parse('[a [b](https://x)](https://y) [<https://inner>](https://outer)');
    assertClosedTree(blocks);
    const outer = linksOf(blocks).find((link) => link.type === 'link' && link.kind === 'external' && link.href === 'https://outer/');
    expect(outer).toEqual({
      type: 'link',
      kind: 'external',
      href: 'https://outer/',
      children: [{ type: 'text', text: 'https://inner' }],
    });
  });
});

describe('hostile input', () => {
  test('raw HTML, including script, is literal text', () => {
    const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> and <a href="javascript:x">y</a>\n\n<!-- c -->';
    const blocks = parse(source);
    assertClosedTree(blocks);
    expect(linksOf(blocks)).toEqual([]);
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      { type: 'paragraph', children: [{ type: 'text', text: '<img src=x onerror=alert(1)> and <a href="javascript:x">y</a>' }] },
      { type: 'paragraph', children: [{ type: 'text', text: '<!-- c -->' }] },
    ]);
  });

  test('javascript:, data:, vbscript: and their disguises are never links', () => {
    const destinations = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      '<javascript:alert(1)>',
      '<java\tscript:alert(1)>',
      'javascript&#58;alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:a@example.com',
      '//evil.example/x',
      '/\\evil.example/x',
      '\\\\evil.example\\x',
    ];
    for (const destination of destinations) {
      const blocks = parse(`[click](${destination})`);
      assertClosedTree(blocks);
      expect({ destination, links: linksOf(blocks) }).toEqual({ destination, links: [] });
    }
    for (const autolink of ['<javascript:alert(1)>', '<data:text/html,x>', '<JAVASCRIPT:alert(1)>']) {
      expect(linksOf(parse(autolink))).toEqual([]);
      expect(textOf(parse(autolink))).toBe(autolink);
    }
  });

  test('a disguised scheme whose disguise matches a record path is still not a link', () => {
    // The angle form admits a tab or control character inside the destination, so this is
    // where the control-character strip is the only thing between a record path and a scheme.
    const options: MarkdownOptions = {
      basePath: 'docs/adr/0001-a.md',
      recordPaths: new Map([
        ['docs/adr/javascript:x', '0009'],
        ['docs/adr/java\tscript:x', '0010'],
        ['docs/adr/\u0001javascript:x', '0011'],
      ]),
    };
    expect(linksOf(parseMarkdown('[x](javascript:x) [y](<java\tscript:x>) [z](<\u0001javascript:x>)', options))).toEqual([]);
  });

  test('nested and unbalanced brackets stay bounded and closed', () => {
    for (const source of ['[[[[[[a]]]]]](https://x)', '[a](https://x', '[a](<https://x)', '[a]]](https://x)(', '](((((((((']) {
      const blocks = parse(source);
      assertClosedTree(blocks);
    }
    expect(linksOf(parse('[[[[[[a]]]]]](https://x)'))).toHaveLength(1);
    expect(textOf(parse('[a](https://x'))).toBe('[a](https://x');
  });

  test('CRLF and lone CR are line endings; NUL becomes U+FFFD', () => {
    expect(parse('# T\r\n\r\npara\rline\u0000')).toEqual([
      { type: 'heading', level: 1, slug: 't', children: [{ type: 'text', text: 'T' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'para\nline\uFFFD' }] },
    ]);
  });

  test('10,000 nested quotes stay bounded', () => {
    const blocks = parse(`${'> '.repeat(10_000)}deep`);
    assertClosedTree(blocks);
    expect(textOf(blocks)).toContain('deep');
  });

  test('10,000 nested list items stay bounded', () => {
    const lines = Array.from({ length: 2_000 }, (_, depth) => `${'  '.repeat(depth)}- level ${depth}`);
    const blocks = parse(lines.join('\n'));
    assertClosedTree(blocks);
    expect(textOf(blocks)).toContain('level 1999');
  });

  test('deep emphasis is flattened past the nesting cap rather than overflowing', () => {
    const blocks = parse(`${'*'.repeat(50_000)}x${'*'.repeat(50_000)}`);
    assertClosedTree(blocks);
    expect(textOf(blocks)).toContain('x');
  });

  test.each([
    ['*', '*'.repeat(100_000)],
    ['_ a', '_a '.repeat(50_000)],
    ['[', '['.repeat(100_000)],
    ['[a](', '[a]('.repeat(25_000)],
    ['[a](b', '[a](bbbbbbbb'.repeat(10_000)],
    ['`', '`'.repeat(100_000)],
    ['` and ``', '` ``'.repeat(30_000)],
    ['|', `${'|'.repeat(100_000)}\n${'|-'.repeat(50_000)}`],
    ['#', '#'.repeat(100_000)],
    ['<', '<'.repeat(100_000)],
    ['> ', '> '.repeat(100_000)],
    ['- ', '- '.repeat(100_000)],
    ['\\', '\\'.repeat(100_000)],
  ])('100k-scale %p input parses in well under a second', (_name, source) => {
    const started = performance.now();
    const blocks = parse(source);
    const elapsed = performance.now() - started;
    assertClosedTree(blocks);
    expect(elapsed).toBeLessThan(1_000);
  });

  test('seeded fuzz: random Markdown-ish documents always give a closed tree', () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = [
      '*', '**', '_', '`', '```', '~~~', '[', ']', '(', ')', '![', '<', '>', '#', '# ', '- ', '1. ', '|', '|---|', '\\',
      '\n', '\n\n', '  ', 'a', 'word ', 'https://x.example', 'javascript:', '#frag', './0002-retry-on-transient-failure.md',
      '"', "'", ':', '\t', '\r\n', '&#58;', '<script>',
    ];
    for (let run = 0; run < 1_500; run++) {
      let source = '';
      const length = Math.floor(random() * 60);
      for (let index = 0; index < length; index++) source += alphabet[Math.floor(random() * alphabet.length)];
      const blocks = parse(source);
      assertClosedTree(blocks);
    }
  });
});
