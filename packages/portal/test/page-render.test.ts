/**
 * The page module against a fake document, one block per view (ADR-0054 clauses 4 to 9), from
 * `portal-data.json` that the real builder made from hostile repository text.
 *
 * ADR-0016 clause 2: observed failing, 2026-10-10, macOS, Bun 1.4.2. Each mutation was made in
 * `src/page/app.mjs`, the suite run, and the edit reverted; the retained input is the
 * mutation named here.
 * - `const href = safeExternalHref(inline.href);` changed to `const href = inline.href;` (an
 *   external token's href trusted as given): "a link token whose href is not http(s) is shown
 *   as text" failed on the planted `javascript:` href.
 * - `if (attrs && attrs.class) node.className = attrs.class;` added to the `svg()` helper:
 *   "SVG classes are attributes; className stays empty on every SVG node" failed.
 * - `PATH_TEXT.missCapped` reworded to start "No decision reaches this path.": "a miss in a
 *   capped table says not in this table" failed.
 * - the `version !== SUPPORTED_VERSION` check removed: "a data file of another version is
 *   refused" failed (the records were drawn).
 * - `DEFAULT_KINDS` widened to all three kinds: "the graph opens on supersession alone; the
 *   other kinds are opt-in" failed.
 * - `root.appendChild(nodeGroup)` moved above `root.appendChild(edgeGroup)` (edges painted
 *   over the records), and separately the `node-base` rect removed: "edges are painted
 *   beneath the records, and every box has an opaque base" failed each time.
 * - against the code before the fix (`normalizeLookup` rewrote `\` to `/` and stripped a
 *   leading `/`): "a backslash path and a slash path are two entries, each found by its own
 *   lookup" failed (both lookups found 0002), as did the rewritten normalization test.
 * - against the code before the fix (the checkbox's `change` handler called `render()`): "a
 *   kind toggle redraws only the lines: same checkbox, same frame, same view" failed, the
 *   view's nodes and checkbox replaced and the zoom reset.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { NODE_LIMIT } from '../src/vendor/board-layout.mjs';
import { clipText, DEFAULT_KINDS, lookupPath, normalizeLookup, parseRoute, PATH_TEXT, recordHref, safeExternalHref } from '../src/page/app.mjs';
import { FakeNode, runPortal, SVG_NS } from './fake-dom.ts';
import { brokenData, COMMIT, HOSTILE_TITLE, pathTable, portalData, records, SCRIPT_BODY } from './page-fixture.ts';
import { fakeRecord } from './fake-handle.ts';
import type { PortalData } from '../src/data/contract.ts';

const ELEMENTS_NEVER_BUILT = ['script', 'img', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base'];

/** Every href the page set is a hash route or an absolute http(s) URL. */
function hrefsOf(root: FakeNode): string[] {
  return root.all().map((node) => node.attrs['href']).filter((href): href is string => href !== undefined);
}

function expectInert(root: FakeNode) {
  const tags = root.all().map((node) => node.tag.toLowerCase());
  for (const tag of ELEMENTS_NEVER_BUILT) expect({ tag, built: tags.includes(tag) }).toEqual({ tag, built: false });
  for (const node of root.all()) {
    for (const name of Object.keys(node.attrs)) expect({ name, handler: /^on/i.test(name) }).toEqual({ name, handler: false });
  }
  for (const href of hrefsOf(root)) expect({ href, ok: /^(#\/|https?:\/\/)/.test(href) }).toEqual({ href, ok: true });
}

beforeEach(() => {
  FakeNode.rect = null;
});

describe('routing and helpers', () => {
  test('hash routes parse, and anything else is not found rather than guessed', () => {
    expect(parseRoute('')).toEqual({ view: 'overview' });
    expect(parseRoute('#/')).toEqual({ view: 'overview' });
    expect(parseRoute('#/graph')).toEqual({ view: 'graph' });
    expect(parseRoute('#/queue')).toEqual({ view: 'queue' });
    expect(parseRoute('#/paths')).toEqual({ view: 'paths' });
    expect(parseRoute('#/adr/0031')).toEqual({ view: 'record', id: '0031' });
    for (const hash of ['#/adr/', '#/adr/%E0%A4%A', '#/adr/<x>', '#/adr/a/b', '#/admin', '#options']) {
      expect({ hash, route: parseRoute(hash) }).toEqual({ hash, route: { view: 'missing' } });
    }
  });

  test('links are rebuilt from validated parts', () => {
    expect(recordHref('0031')).toBe('#/adr/0031');
    expect(recordHref('javascript:alert(1)')).toBeNull();
    expect(recordHref('../x')).toBeNull();
    expect(safeExternalHref('https://example.com/a?b#c')).toBe('https://example.com/a?b#c');
    for (const href of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '//evil.example', '/root', 'mailto:a@b', 'JAVASCRIPT:x', 'http:/x']) {
      expect({ href, kept: safeExternalHref(href) }).toEqual({ href, kept: null });
    }
  });

  test('clipping never splits a grapheme', () => {
    const family = '👨‍👩‍👧‍👦';
    const clipped = clipText(`ab${family}cdef`, 4);
    expect(clipped).toBe(`ab${family}…`);
    expect(clipText('short', 28)).toBe('short');
    // No lone surrogate survives a clip.
    for (let size = 2; size < 12; size++) expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipText(`x${family.repeat(4)}`, size))).toBe(false);
  });

  test('a typed path loses only surrounding whitespace and a leading ./; a backslash stays literal', () => {
    expect(normalizeLookup('  ./src/a.ts ')).toBe('src/a.ts');
    expect(normalizeLookup('src\\a.ts')).toBe('src\\a.ts');
    expect(normalizeLookup('.\\src\\a.ts')).toBe('.\\src\\a.ts');
  });

  test('a backslash path and a slash path are two entries, each found by its own lookup', () => {
    // Core treats `src/we\ird.ts` and `src/we/ird.ts` as distinct paths
    // (packages/core/test/check.test.ts, markers-scan.test.ts); the table can hold both.
    const decision = (id: string) => [{ id, evidence: ['affects'] }];
    const table = pathTable({
      governedPathCount: 2,
      entries: [
        { path: 'src/we/ird.ts', governing: decision('0002'), activeProposals: [], history: [] },
        { path: 'src/we\\ird.ts', governing: decision('0003'), activeProposals: [], history: [] },
      ],
    } as never);
    const slash = lookupPath(table, COMMIT, 'src/we/ird.ts');
    const back = lookupPath(table, COMMIT, 'src/we\\ird.ts');
    expect(slash.kind === 'hit' && slash.entry.governing[0].id).toBe('0002');
    expect(back.kind === 'hit' && back.entry.governing[0].id).toBe('0003');
  });
});

describe('loading', () => {
  test('fetches the data file relative to the document', async () => {
    const page = await runPortal(portalData());
    expect(page.fetched).toEqual(['./portal-data.json']);
  });

  test('a data file of another version is refused', async () => {
    const page = await runPortal({ ...portalData(), version: '2' });
    expect(page.app.allText()).toContain('This page renders portal-data.json version 1; the file says version 2.');
    expect(page.app.allText()).not.toContain('Third, in review');
    expect(page.app.all().some((node) => node.attrs['role'] === 'alert')).toBe(true);
  });

  test('a failed fetch says so and draws nothing else', async () => {
    const page = await runPortal(404);
    expect(page.app.allText()).toContain('Could not load the decisions');
    expect(page.window.listeners['hashchange']).toBeUndefined();
  });
});

describe('overview', () => {
  test('status counts, the record list, and hostile titles as text', async () => {
    const page = await runPortal(portalData());
    const text = page.app.allText();
    for (const expected of ['accepted: 1', 'proposed: 1', 'rejected: 1', 'superseded: 1', 'draft: 0', 'deprecated: 0']) expect(text).toContain(expected);
    // The hostile title arrives verbatim as textContent: not parsed, not escaped twice.
    expect(page.app.all().some((node) => node.textContent === HOSTILE_TITLE)).toBe(true);
    expect(page.app.all().some((node) => node.textContent === '<i>tag</i>')).toBe(true);
    expectInert(page.app);
    expect(hrefsOf(page.app)).toContain('#/adr/0001');
    expect(page.nodes.get('nav-overview')!.attrs['aria-current']).toBe('page');
  });

  test('the filter narrows the list without leaving the page', async () => {
    const page = await runPortal(portalData());
    const input = page.app.all().find((node) => node.tag === 'input')!;
    input.value = 'review';
    input.fire('input');
    const cards = page.app.all().filter((node) => node.className === 'card record-card');
    expect(cards.map((card) => card.allText())).toHaveLength(1);
    expect(page.app.allText()).toContain('1 of 4 records');
  });
});

describe('the findings banner (clause 9)', () => {
  test('an error corpus shows every error on every view, as text', async () => {
    const page = await runPortal(brokenData());
    const banner = page.nodes.get('banner')!;
    for (const hash of ['#/', '#/adr/0001', '#/graph', '#/queue', '#/paths', '#/nowhere']) {
      page.go(hash);
      expect({ hash, text: banner.allText().includes('The corpus has 1 error.') }).toEqual({ hash, text: true });
    }
    expect(banner.all().some((node) => node.textContent === 'Bad <b>frontmatter</b> in 0009')).toBe(true);
    expect(banner.all().some((node) => node.attrs['role'] === 'alert')).toBe(true);
    expectInert(banner);
  });

  test('a clean corpus has no banner', async () => {
    const page = await runPortal(portalData());
    expect(page.nodes.get('banner')!.children).toEqual([]);
  });
});

describe('record view', () => {
  test('the body renders as tokens, raw HTML and hostile links as text', async () => {
    const page = await runPortal(portalData(), '#/adr/0001');
    const app = page.app;
    expectInert(app);
    const text = app.allText();
    expect(text).toContain(SCRIPT_BODY);
    expect(text).toContain('<a href="javascript:alert(1)">a raw anchor</a>');
    expect(text).toContain('image alt');
    // Headings sit below the record title, tables keep alignment by fixed class.
    expect(app.all().some((node) => node.tag === 'h3' && node.allText().includes('ADR-0001: The first'))).toBe(true);
    expect(app.all().find((node) => node.tag === 'td' && node.allText().trim() === '1')?.className).toBe('align-right');
    expect(app.all().find((node) => node.tag === 'code' && node.textContent.includes('<b>not bold</b>'))).toBeDefined();
    expect(app.all().find((node) => node.tag === 'ol')?.attrs['start']).toBe('3');
    expect(app.all().some((node) => node.tag === 'strong') && app.all().some((node) => node.tag === 'em')).toBe(true);

    const anchors = app.all().filter((node) => node.tag === 'a');
    const external = anchors.find((node) => node.allText().includes('external link'))!;
    expect(external.attrs['href']).toBe('https://example.com/docs');
    expect(external.attrs['rel']).toBe('noopener noreferrer nofollow');
    expect(anchors.find((node) => node.allText().includes('record link'))?.attrs['href']).toBe('#/adr/0002');
    for (const label of ['hostile link', 'data link']) {
      expect({ label, linked: anchors.some((node) => node.allText().includes(label)) }).toEqual({ label, linked: false });
    }
  });

  test('a fragment link scrolls to its heading and never touches the route', async () => {
    const page = await runPortal(portalData(), '#/adr/0001');
    const jump = page.app.all().find((node) => node.tag === 'a' && node.allText().includes('jump'))!;
    expect(jump.attrs['href']).toBeUndefined();
    jump.fire('click');
    const target = page.app.all().find((node) => node.tag === 'h4' && node.allText().includes('Options considered'))!;
    expect(target.scrolled).toBe(true);
    expect(page.window.location.hash).toBe('#/adr/0001');
  });

  test('a link token whose href is not http(s) is shown as text', async () => {
    const data = portalData();
    const planted = {
      type: 'paragraph',
      children: [
        { type: 'link', kind: 'external', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'planted external' }] },
        { type: 'link', kind: 'record', id: 'javascript:alert(1)', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'planted record' }] },
        { type: 'link', kind: 'other', href: 'https://example.com', children: [{ type: 'text', text: 'planted kind' }] },
        { type: 'html', text: '<b>unknown inline</b>' },
      ],
    };
    const tampered = { ...data, records: data.records.map((record) => (record.id === '0002' ? { ...record, body: [planted, { type: 'raw', text: '<i>unknown block</i>' }] } : record)) };
    const page = await runPortal(tampered, '#/adr/0002');
    expectInert(page.app);
    const text = page.app.allText();
    for (const label of ['planted external', 'planted record', 'planted kind', '<b>unknown inline</b>', '<i>unknown block</i>']) expect(text).toContain(label);
    const article = page.app.all().find((node) => node.tag === 'article')!;
    expect(article.all().filter((node) => node.tag === 'a')).toEqual([]);
  });

  test('facts, supersession, and the other relationships link by route', async () => {
    const page = await runPortal(portalData(), '#/adr/0002');
    const text = page.app.allText();
    expect(text).toContain('Supersedes');
    expect(text).toContain('Related from');
    expect(hrefsOf(page.app)).toEqual(expect.arrayContaining(['#/adr/0001', '#/adr/0003']));
    page.go('#/adr/0001');
    expect(page.app.allText()).toContain('Superseded by');
    expect(page.app.all().some((node) => node.textContent === HOSTILE_TITLE && node.tag === 'h2')).toBe(true);
  });

  test('a repeated id resolves to the last record, and an unknown id says so', async () => {
    const dupes = records().concat([fakeRecord('0004', { title: 'Fourth, the later copy', status: 'rejected', standing: 'history' })]);
    const page = await runPortal(portalData({ records: dupes }), '#/adr/0004');
    expect(page.app.allText()).toContain('Fourth, the later copy');
    page.go('#/adr/9999');
    expect(page.app.allText()).toContain('This bundle has no record with id 9999.');
  });
});

describe('graph view', () => {
  const svgNodes = (root: FakeNode) => root.all().filter((node) => node.ns === SVG_NS);
  const records = (root: FakeNode) => root.all().filter((node) => node.tag === 'g' && node.attrs['role'] === 'link');

  test('SVG classes are attributes; className stays empty on every SVG node', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const nodes = svgNodes(page.app);
    expect(nodes.length).toBeGreaterThan(10);
    for (const node of nodes) expect({ tag: node.tag, className: node.className }).toEqual({ tag: node.tag, className: '' });
    expect(records(page.app).map((g) => g.attrs['class'])).toEqual([
      'node status-superseded',
      'node status-accepted',
      'node status-proposed',
      'node status-rejected',
    ]);
    expectInert(page.app);
  });

  test('titles are clipped by grapheme, with the full title kept for the pointer', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const second = records(page.app).find((g) => g.attrs['aria-label']?.startsWith('0002'))!;
    const shown = second.all().find((node) => node.attrs['class'] === 'node-title')!.textContent;
    expect(shown.endsWith('…')).toBe(true);
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(shown)].length).toBeLessThanOrEqual(28);
    expect(second.all().find((node) => node.tag === 'title')!.textContent).toContain('long title that must be clipped');
    // The hostile title is an attribute value and a text node, never markup.
    expect(records(page.app).find((g) => g.attrs['aria-label']?.startsWith('0001'))!.attrs['aria-label']).toContain(HOSTILE_TITLE);
  });

  test('the graph opens on supersession alone; the other kinds are opt-in', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const boxes = page.app.all().filter((node) => node.tag === 'input');
    expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);
    expect(DEFAULT_KINDS).toEqual(['supersedes']);
    const drawnKinds = page.app.all().filter((node) => node.tag === 'line' && node.attrs['x1'] !== '1').map((node) => node.attrs['class']);
    expect(drawnKinds).toEqual(['edge edge-supersedes']);
  });

  test('the kinds filter adds and hides lines without moving boxes', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const edgeKinds = () => page.app.all().filter((node) => node.tag === 'line' && /^edge edge-/.test(node.attrs['class'] ?? '') && node.attrs['x1'] !== '1').map((node) => node.attrs['class']);
    const placed = () => records(page.app).map((g) => g.attrs['transform']);
    const before = placed();
    const tick = (index: number, checked: boolean) => {
      const box = page.app.all().filter((node) => node.tag === 'input')[index]!;
      box.checked = checked;
      box.fire('change');
    };
    tick(1, true); // relatesTo
    tick(2, true); // conflictsWith
    expect(edgeKinds()).toEqual(['edge edge-supersedes', 'edge edge-relatesTo', 'edge edge-conflictsWith']);
    expect(placed()).toEqual(before);
    tick(1, false);
    expect(edgeKinds()).toEqual(['edge edge-supersedes', 'edge edge-conflictsWith']);
    expect(placed()).toEqual(before);
  });

  test('a kind toggle redraws only the lines: same checkbox, same frame, same view', async () => {
    FakeNode.rect = { width: 600, height: 300 };
    const page = await runPortal(portalData(), '#/graph');
    const svgRoot = page.app.all().find((node) => node.tag === 'svg' && node.attrs['class']?.startsWith('graph-svg'))!;
    const frame = page.app.all().find((node) => node.attrs['role'] === 'region')!;
    frame.fire('keydown', { key: '+' });
    frame.fire('keydown', { key: 'ArrowDown' });
    const zoomed = svgRoot.attrs['viewBox'];
    const childrenBefore = [...page.app.children];
    const box = page.app.all().filter((node) => node.tag === 'input')[1]!;
    box.focus();
    box.checked = true;
    box.fire('change');
    // The view was not rebuilt: the same nodes, the same checkbox (so focus stays on it), the same zoom.
    expect(page.app.children).toEqual(childrenBefore);
    expect(page.app.children.every((child, index) => child === childrenBefore[index])).toBe(true);
    expect(page.app.all().includes(box)).toBe(true);
    expect(box.focused).toBe(true);
    expect(page.app.all().find((node) => node.tag === 'svg' && node.attrs['class']?.startsWith('graph-svg'))).toBe(svgRoot);
    expect(svgRoot.attrs['viewBox']).toBe(zoomed);
    expect(svgRoot.all().filter((node) => node.tag === 'line' && node.attrs['class'] === 'edge edge-relatesTo')).toHaveLength(1);
    // The edge group is still beneath the records, and highlighting follows the new lines.
    expect(svgRoot.children.filter((node) => node.tag === 'g').map((node) => node.attrs['class'])).toEqual(['edges', 'nodes']);
    const g = (id: string) => records(page.app).find((node) => node.attrs['aria-label']?.startsWith(id))!;
    g('0003').fire('focus');
    expect(g('0002').attrs['class']).toBe('node status-accepted neighbor');
  });

  test('edges are painted beneath the records, and every box has an opaque base', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const svgRoot = page.app.all().find((node) => node.tag === 'svg' && node.attrs['class']?.startsWith('graph-svg'))!;
    const groups = svgRoot.children.filter((node) => node.tag === 'g').map((node) => node.attrs['class']);
    expect(groups).toEqual(['edges', 'nodes']);
    for (const g of records(page.app)) {
      const rects = g.children.filter((node) => node.tag === 'rect').map((node) => node.attrs['class']!.split(' ')[0]);
      // The base comes first, under the tinted box, and is never dimmed by the stylesheet.
      expect(rects.slice(0, 2)).toEqual(['node-base', 'node-box']);
    }
  });

  test('focus dims the other boxes by class on the group, never the labels', async () => {
    const page = await runPortal(portalData(), '#/graph');
    const g = (id: string) => records(page.app).find((node) => node.attrs['aria-label']?.startsWith(id))!;
    g('0002').fire('focus');
    expect(g('0002').attrs['class']).toBe('node status-accepted selected');
    expect(g('0001').attrs['class']).toBe('node status-superseded neighbor');
    expect(g('0004').attrs['class']).toBe('node status-rejected dim');
    // Label nodes keep their own classes; the stylesheet dims .node.dim .node-box only.
    expect(g('0004').all().find((node) => node.tag === 'text' && node.attrs['class'] === 'node-title')).toBeDefined();
    g('0002').fire('blur');
    expect(g('0004').attrs['class']).toBe('node status-rejected');
  });

  test('keys and buttons rewrite the viewBox only; a drag does not open the record', async () => {
    FakeNode.rect = { width: 600, height: 300 };
    const page = await runPortal(portalData(), '#/graph');
    const svgRoot = page.app.all().find((node) => node.tag === 'svg' && node.attrs['class']?.startsWith('graph-svg'))!;
    const frame = page.app.all().find((node) => node.attrs['role'] === 'region')!;
    const box = () => svgRoot.attrs['viewBox']!.split(' ').map(Number);
    const start = box();
    frame.fire('keydown', { key: '+' });
    expect(box()[2]!).toBeLessThan(start[2]!);
    frame.fire('keydown', { key: 'ArrowRight' });
    frame.fire('keydown', { key: '+', target: new FakeNode('input') });
    const zoomOut = page.app.all().find((node) => node.attrs['aria-label'] === 'Zoom out')!;
    const beforeOut = box();
    zoomOut.fire('click');
    expect(box()[2]!).toBeGreaterThan(beforeOut[2]!);

    const target = records(page.app)[0]!;
    svgRoot.fire('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    svgRoot.fire('pointermove', { clientX: 60, clientY: 30 });
    svgRoot.fire('pointerup');
    target.fire('click');
    expect(page.window.location.hash).toBe('#/graph');
    target.fire('click');
    expect(page.window.location.hash).toBe('#/adr/0001');
  });

  test('past the layout limit the graph is a summary, with no drawing', async () => {
    const many = Array.from({ length: NODE_LIMIT + 1 }, (_, i) => fakeRecord(String(i + 1).padStart(4, '0')));
    const page = await runPortal(portalData({ records: many }), '#/graph');
    const text = page.app.allText();
    expect(text).toContain(`${NODE_LIMIT + 1} records`);
    expect(text).toContain(`more than the ${NODE_LIMIT} records the graph draws legibly`);
    expect(text).toContain(`accepted: ${NODE_LIMIT + 1}`);
    expect(page.app.all().some((node) => node.tag === 'svg' && node.attrs['class']?.startsWith('graph-svg'))).toBe(false);
  });
});

describe('queue view (clause 5)', () => {
  test('raw review facts, as text, with no control and no verdict', async () => {
    const page = await runPortal(portalData(), '#/queue');
    const text = page.app.allText();
    for (const fact of ['1 of 2 approvals', '1 unresolved, 1 resolved', 'overdue', '2026-07-11', 'ARB', 'Queue findings 2', '@dave']) {
      expect({ fact, shown: text.includes(fact) }).toEqual({ fact, shown: true });
    }
    expect(page.app.all().some((node) => node.textContent === 'Third <script>x</script>')).toBe(true);
    expect(page.app.all().some((node) => node.textContent === '<b>@eve</b>')).toBe(true);
    expect(page.app.all().filter((node) => ['button', 'input', 'select', 'textarea'].includes(node.tag))).toEqual([]);
    expect(text).not.toMatch(/\b(ready|eligible|ratifiable)\b/i);
    expectInert(page.app);
  });

  test('a record with no quorum and an empty queue are stated plainly', async () => {
    const data = portalData();
    const page = await runPortal({ ...data, queue: [{ ...data.queue[0]!, quorum: null, routingTargets: [], deadline: null, tier: null }] }, '#/queue');
    expect(page.app.allText()).toContain('1 approval, no quorum set');
    expect(page.app.allText()).toContain('none declared');
    page.go('#/queue');
    const empty = await runPortal({ ...data, queue: [] }, '#/queue');
    expect(empty.app.allText()).toContain('Nothing in review');
  });
});

describe('path view (clause 6): every table state has its own wording', () => {
  async function lookUp(data: PortalData, path: string) {
    const page = await runPortal(data, '#/paths');
    const input = page.app.all().find((node) => node.tag === 'input');
    if (input) {
      input.value = path;
      input.fire('input');
    }
    return page;
  }

  test('a hit shows the governing, proposed, and historical ids with their evidence', async () => {
    const page = await lookUp(portalData(), './src/a.ts');
    const entry = page.app.all().find((node) => node.className === 'card path-entry')!;
    const text = entry.allText();
    for (const part of ['src/a.ts', 'Governing (1)', 'Active proposals (1)', 'History (1)', 'affects matcher', '@adr marker']) expect(text).toContain(part);
    expect(hrefsOf(entry)).toEqual(['#/adr/0002', '#/adr/0003', '#/adr/0001']);
  });

  test('a miss in an uncapped table names the commit', async () => {
    const page = await lookUp(portalData(), 'README.md');
    expect(page.app.allText()).toContain(PATH_TEXT.missAtCommit(COMMIT));
    expect(PATH_TEXT.missAtCommit(COMMIT)).toBe(`No tracked file by this path at commit ${COMMIT.slice(0, 12)} is reached by any decision.`);
  });

  test('a miss with no commit speaks of the index', async () => {
    const page = await lookUp(portalData({ commit: null }), 'README.md');
    expect(page.app.allText()).toContain(PATH_TEXT.missInIndex);
  });

  test('a miss in a capped table says not in this table', async () => {
    const page = await lookUp(portalData({ pathTable: pathTable({ capped: true, governedPathCount: 9 } as never) }), 'src/z.ts');
    expect(page.app.allText()).toContain('Not in this table.');
    expect(page.app.allText()).toContain('This table is capped');
    expect(lookupPath(pathTable({ capped: true } as never), COMMIT, 'src/z.ts').message?.startsWith('Not in this table.')).toBe(true);
  });

  test('an unavailable table says resolution was withheld because the corpus has errors', async () => {
    const page = await lookUp(brokenData(), 'src/a.ts');
    expect(page.app.allText()).toContain(PATH_TEXT.unavailable);
    expect(PATH_TEXT.unavailable).toContain('withheld because the corpus has errors');
    expect(page.app.all().some((node) => node.tag === 'input')).toBe(false);
  });

  test('an absent table says this host has no table', async () => {
    const page = await lookUp(portalData({ pathTable: { state: 'absent' } }), 'src/a.ts');
    expect(page.app.allText()).toContain(PATH_TEXT.absent);
    expect(PATH_TEXT.absent).toContain('This host has no path table');
  });

  test('no state ever calls a path ungoverned or shows an empty result', async () => {
    for (const data of [portalData(), portalData({ commit: null }), brokenData(), portalData({ pathTable: { state: 'absent' } }), portalData({ pathTable: pathTable({ capped: true } as never) })]) {
      const page = await lookUp(data, 'nowhere/at/all.ts');
      expect(page.app.allText()).not.toMatch(/ungoverned/i);
      expect(page.app.allText()).not.toMatch(/\bnot governed\b/i);
    }
    for (const message of Object.values(PATH_TEXT)) expect(String(typeof message === 'function' ? message(COMMIT) : message)).not.toMatch(/ungoverned/i);
  });
});
