import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { PAGE_CSS, PAGE_HTML, PAGE_JS } from '../extensions/adrkit/canvas-page.mjs';
import { BOARD_CSS, BOARD_HTML, BOARD_JS } from '../extensions/adrkit/board-page.mjs';
import { THEME_CSS, THEME_TOKENS, TINT_ALPHA } from '../extensions/adrkit/canvas-theme.mjs';
import {
  VIEW_HELPERS_SRC,
  clampScale,
  clampView,
  fitView,
  initialView,
  panView,
  resizeView,
  viewBoxOf,
  zoomView,
} from '../extensions/adrkit/board-view.mjs';

/**
 * The 0.11.0 visual pass on both canvases: the shared theme and its contrast,
 * the inline-style ban, the board's pan and zoom helper, and the states the
 * pages now draw (loading, error, grouped findings, collapsed notes, the
 * neighborhood highlight, and the review controls' steps).
 */

type View = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- contrast

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** WCAG contrast of two opaque colours. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** A tint (`hue` at `alpha`) composited over an opaque background. */
function over(hue: string, alpha: number, background: string): [number, number, number] {
  const top = rgb(hue);
  const bottom = rgb(background);
  return [0, 1, 2].map((i) => Math.round(top[i]! * alpha + bottom[i]! * (1 - alpha))) as [number, number, number];
}

describe('shared canvas theme', () => {
  test('contrast: the helper agrees with known WCAG values', () => {
    expect(contrast(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrast(rgb('#777777'), rgb('#ffffff'))).toBeCloseTo(4.48, 2);
  });

  for (const theme of ['light', 'dark'] as const) {
    const t = THEME_TOKENS[theme];
    test(`${theme}: every text token reads at 4.5:1 or more on bg and surface`, () => {
      for (const fg of ['text', 'muted', 'green', 'red', 'yellow', 'blue', 'purple'] as const) {
        for (const bg of ['bg', 'surface'] as const) {
          const ratio = contrast(rgb(t[fg]), rgb(t[bg]));
          expect({ theme, fg, bg, ok: ratio >= 4.5 }).toEqual({ theme, fg, bg, ok: true });
        }
      }
    });

    test(`${theme}: a status badge's text reads at 4.5:1 on its own tint`, () => {
      for (const hue of ['green', 'red', 'yellow', 'blue', 'purple'] as const) {
        for (const bg of ['bg', 'surface'] as const) {
          const ratio = contrast(rgb(t[hue]), over(t[hue], TINT_ALPHA[theme], t[bg]));
          expect({ theme, hue, bg, ok: ratio >= 4.5 }).toEqual({ theme, hue, bg, ok: true });
        }
      }
    });

    test(`${theme}: a primary button's label reads at 4.5:1`, () => {
      expect(contrast(rgb(t.bg), rgb(t.blue))).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('both pages ship the one shared block first, so their tokens cannot drift', () => {
    expect(PAGE_CSS.startsWith(THEME_CSS)).toBe(true);
    expect(BOARD_CSS.startsWith(THEME_CSS)).toBe(true);
  });

  test('the app token wins and the fallback follows the system theme', () => {
    // The app injects its tokens as <style>; each alias reads it first.
    for (const app of ['--background-color-default', '--text-color-default', '--text-color-muted', '--border-color-default', '--color-focus-outline', '--true-color-green', '--true-color-red', '--true-color-yellow', '--true-color-blue']) {
      expect({ app, aliased: new RegExp(`var\\(${app}, var\\(--ak-`).test(THEME_CSS) }).toEqual({ app, aliased: true });
    }
    expect(THEME_CSS).toContain('@media (prefers-color-scheme: dark)');
    for (const [name, value] of Object.entries(THEME_TOKENS.dark)) expect(THEME_CSS).toContain(`--ak-${name}: ${value};`);
    expect(THEME_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(THEME_CSS).toMatch(/:focus-visible[^{]*\{\s*outline: 2px solid var\(--c-focus\)/);
  });

  test('a status badge always carries a glyph class beside its text', () => {
    for (const glyph of ['check', 'cross', 'bang', 'dot', 'ring', 'half', 'arrow', 'info', 'wait', 'ask']) {
      expect(THEME_CSS).toContain(`.glyph-${glyph}::before`);
    }
  });
});

// ------------------------------------------------------------ inline style

describe('no inline style on either page', () => {
  const pages = { review: { html: PAGE_HTML, js: PAGE_JS }, board: { html: BOARD_HTML, js: BOARD_JS } };
  for (const [name, page] of Object.entries(pages)) {
    test(`${name}: no style attribute, no style element, no .style assignment`, () => {
      expect(page.html).not.toMatch(/\sstyle\s*=/i);
      expect(page.html).not.toMatch(/<style\b/i);
      for (const sink of [/\.style\b/, /['"]style['"]/, /\bstyle\s*=/, /cssText/, /setProperty\s*\(/, /insertRule\s*\(/, /CSSStyleSheet/]) {
        expect({ name, sink: String(sink), found: sink.test(page.js) }).toEqual({ name, sink: String(sink), found: false });
      }
    });
  }
});

// ---------------------------------------------------------- pan and zoom

const near = (a: View, b: View) => {
  for (const key of ['x', 'y', 'w', 'h'] as const) expect(a[key]).toBeCloseTo(b[key], 6);
};

describe('board-view: pan and zoom over a viewBox', () => {
  test('clampScale keeps the zoom range and repairs nonsense', () => {
    expect(clampScale(0.01)).toBe(0.2);
    expect(clampScale(10)).toBe(3);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(-2)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test('fitView centres the whole graph, keeps the viewport aspect, and never upscales', () => {
    const big = fitView(2000, 1000, 500, 500);
    expect(500 / big.w).toBeCloseTo(0.25, 6);
    expect(big.w / big.h).toBeCloseTo(1, 6);
    expect(big.x + big.w / 2).toBeCloseTo(1000, 6);
    expect(big.y + big.h / 2).toBeCloseTo(500, 6);
    const small = fitView(100, 50, 800, 400);
    expect(800 / small.w).toBe(1);
    expect(small.x).toBeCloseTo(-350, 6);
    // Far past the zoom range, the fit stops at the minimum scale.
    expect(400 / fitView(100000, 100, 400, 400).w).toBeCloseTo(0.2, 6);
  });

  test('initialView fits a graph that stays readable, and otherwise opens at the top at 0.6 or more', () => {
    near(initialView(400, 300, 800, 600), fitView(400, 300, 800, 600));
    const tall = initialView(1000, 3000, 500, 400);
    expect(500 / tall.w).toBeCloseTo(0.6, 6);
    expect(tall.x).toBe(0);
    expect(tall.y).toBe(0);
    // Three board columns in a narrow pane still fit (about 0.65), so nothing is clipped.
    near(initialView(776, 240, 505, 240), fitView(776, 240, 505, 240));
    // A height-bound fit of about 0.69 is still readable, so it fits rather than crops.
    near(initialView(600, 350, 1000, 240), fitView(600, 350, 1000, 240));
    // A wide, short graph is centred vertically rather than pinned to the top.
    const wide = initialView(3000, 120, 500, 400);
    expect(wide.y).toBeLessThan(0);
    expect(wide.y + wide.h / 2).toBeCloseTo(60, 6);
    // Unknown viewport (a test DOM): falls back to the graph's own size.
    near(initialView(300, 200, 0, 0), { x: 0, y: 0, w: 300, h: 200 });
  });

  test('zoomView keeps the graph point under the anchor fixed', () => {
    const view = { x: 100, y: 50, w: 800, h: 400 };
    for (const [fx, fy] of [[0.5, 0.5], [0, 0], [1, 1], [0.25, 0.8]] as const) {
      const before = { x: view.x + view.w * fx, y: view.y + view.h * fy };
      const next = zoomView(view, 2, fx, fy, 800);
      expect(next.w).toBeCloseTo(400, 6);
      expect(next.x + next.w * fx).toBeCloseTo(before.x, 6);
      expect(next.y + next.h * fy).toBeCloseTo(before.y, 6);
    }
  });

  test('zoomView stops at the zoom range and treats a bad factor or anchor as neutral', () => {
    const view = { x: 0, y: 0, w: 800, h: 400 };
    expect(800 / zoomView(view, 100, 0.5, 0.5, 800).w).toBeCloseTo(3, 6);
    expect(800 / zoomView(view, 0.001, 0.5, 0.5, 800).w).toBeCloseTo(0.2, 6);
    near(zoomView(view, Number.NaN, 0.5, 0.5, 800), view);
    near(zoomView(view, 2, 7, -1, 800), zoomView(view, 2, 0.5, 0.5, 800));
  });

  test('panView moves by pixels converted to graph units, opposite to the drag', () => {
    const view = { x: 0, y: 0, w: 1600, h: 800 };
    near(panView(view, 100, 50, 800), { x: -200, y: -100, w: 1600, h: 800 });
    near(panView(view, Number.NaN, 0, 800), view);
  });

  test('clampView keeps at least half the viewport over the graph', () => {
    near(clampView({ x: -5000, y: -5000, w: 400, h: 200 }, 1000, 600), { x: -200, y: -100, w: 400, h: 200 });
    near(clampView({ x: 5000, y: 5000, w: 400, h: 200 }, 1000, 600), { x: 800, y: 500, w: 400, h: 200 });
    near(clampView({ x: 10, y: 10, w: 400, h: 200 }, 1000, 600), { x: 10, y: 10, w: 400, h: 200 });
  });

  test('resizeView keeps scale and origin for a new viewport', () => {
    near(resizeView({ x: 5, y: 6, w: 400, h: 300 }, 1000, 500, 800), { x: 5, y: 6, w: 500, h: 250 });
  });

  test('viewBoxOf rounds to two places', () => {
    expect(viewBoxOf({ x: 1 / 3, y: 2, w: 10.005, h: -0.004 })).toBe('0.33 2 10.01 0');
  });

  test('the page embeds these exact functions, and the embedded copies behave the same', () => {
    expect(BOARD_JS).toContain(VIEW_HELPERS_SRC);
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${VIEW_HELPERS_SRC}\nout.zoom = zoomView({ x: 0, y: 0, w: 800, h: 400 }, 2, 0.25, 0.75, 800); out.init = initialView(1000, 3000, 500, 400);`, { out: sandbox, Math, isFinite });
    near(sandbox['zoom'] as View, zoomView({ x: 0, y: 0, w: 800, h: 400 }, 2, 0.25, 0.75, 800));
    near(sandbox['init'] as View, initialView(1000, 3000, 500, 400));
  });
});

// ------------------------------------------------------------- fake DOM

class FakeNode {
  children: FakeNode[] = [];
  textContent = '';
  className = '';
  type = '';
  id = '';
  value = '';
  title = '';
  checked = false;
  disabled = false;
  focused = false;
  maxLength = 0;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(event?: unknown) => void>> = {};
  static rect: { width: number; height: number } | null = null;
  getBoundingClientRect() {
    const rect = FakeNode.rect;
    return rect ? { left: 0, top: 0, ...rect } : { left: 0, top: 0, width: 0, height: 0 };
  }
  constructor(
    readonly tag: string,
    readonly ns: string | null = null,
  ) {}
  get tagName() {
    return this.tag.toUpperCase();
  }
  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode) {
    this.children = this.children.filter((node) => node !== child);
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  setAttribute(name: string, value: unknown) {
    this.attrs[name] = String(value);
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  addEventListener(type: string, listener: (event?: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  focus() {
    this.focused = true;
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners[type] ?? []) listener({ target: this, preventDefault() {}, ...event });
  }
  allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(' ');
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const windowListeners: Record<string, Array<() => void>> = {};
async function runPage(js: string, ids: string[], state: unknown, { hold = false } = {}) {
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id)]));
  for (const key of Object.keys(windowListeners)) delete windowListeners[key];
  const context = {
    window: { location: { search: '?token=t' }, addEventListener: (type: string, listener: () => void) => void (windowListeners[type] ??= []).push(listener) },
    document: {
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: (tag: string) => new FakeNode(tag),
      createElementNS: (ns: string, tag: string) => new FakeNode(tag, ns),
    },
    fetch: (path: string, init?: { body?: string }) =>
      hold && init === undefined ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: async () => (path.includes('nonce') ? { nonce: 'n'.repeat(64) } : state) }),
    URLSearchParams,
    Map,
    Set,
    JSON,
  };
  runInNewContext(js, context);
  await settle();
  return nodes;
}

const REVIEW_IDS = ['status', 'meta', 'cwd', 'refresh', 'run-review', 'cost', 'message', 'app'];
const BOARD_IDS = ['status', 'cwd', 'refresh', 'show-all', 'kind-supersedes', 'kind-relatesTo', 'kind-conflictsWith', 'apply-kinds', 'message', 'legend', 'board', 'detail', 'queue'];

// ------------------------------------------------------- decision-review

describe('decision-review states', () => {
  const base = { workingDirectory: '/repo', status: 'ok', files: ['src/a.ts'], filesSource: 'git', governing: [], history: [], activeProposals: [], findings: [], notes: [], review: null, judgeCalls: 0 };
  const governed = { recordId: '0003', title: 'Use Redis', status: 'accepted', firedMatchers: [{ type: 'path', pattern: 'src/**' }], declaredBy: [{ path: 'src/a.ts', line: 1, ref: '0003' }] };

  test('the paid button starts disabled, so nothing can be spent before the first snapshot', () => {
    expect(PAGE_HTML).toMatch(/<button[^>]*id="run-review"[^>]*\bdisabled\b/);
  });

  test('loading is drawn before the first snapshot arrives', async () => {
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, base, { hold: true });
    const app = nodes.get('app') as FakeNode;
    expect(app.allText()).toContain('Reading the change');
    expect(app.all().some((node) => node.attrs['aria-busy'] === 'true')).toBe(true);
  });

  test('the error state shows the fixed not-a-work-tree note open, and not again under Notes', async () => {
    const note = 'the session directory is not inside a git work tree as seen by git; open the session in the repository or pass files';
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, status: 'usage-error', files: [], notes: [note] });
    const app = nodes.get('app') as FakeNode;
    const alert = app.all().find((node) => node.attrs['role'] === 'alert');
    expect(alert?.className).toContain('tone-red');
    expect(alert?.allText()).toContain(note);
    expect(app.all().filter((node) => node.tag === 'details' && node.allText().includes('Notes'))).toEqual([]);
    expect((nodes.get('status') as FakeNode).className).toContain('glyph-cross');
  });

  test('notes are a collapsed disclosure when they are not the error', async () => {
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, notes: ['one note'] });
    const details = (nodes.get('app') as FakeNode).all().find((node) => node.tag === 'details' && node.allText().includes('Notes (1)'));
    expect(details).toBeDefined();
    expect(details?.attrs['open']).toBeUndefined();
  });

  test('no changed files is its own empty state', async () => {
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, files: [] });
    const empty = (nodes.get('app') as FakeNode).all().find((node) => node.className === 'empty');
    expect(empty?.allText()).toContain('No changed files');
  });

  test('findings are grouped by severity, errors first', async () => {
    const findings = [
      { severity: 'info', rule: 'i', message: 'an info' },
      { severity: 'warn', rule: 'w', message: 'a warning' },
      { severity: 'error', rule: 'e', message: 'an error' },
      { severity: 'weird', rule: 'x', message: 'odd' },
    ];
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, findings });
    const groups = (nodes.get('app') as FakeNode).all().filter((node) => node.className === 'finding-group');
    expect(groups.map((group) => group.children[0]?.textContent)).toEqual(['Errors (1)', 'Warnings (1)', 'Information (1)', 'Other (1)']);
  });

  test('a governing card shows provenance as chips and the cost line in plain words', async () => {
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, status: 'incomplete', governing: [governed], judgeCalls: 1 });
    const card = (nodes.get('app') as FakeNode).all().find((node) => node.className === 'card decision') as FakeNode;
    const chips = card.all().filter((node) => node.className === 'chip').map((node) => node.allText().trim());
    expect(chips).toEqual(['affects path: src/**', 'marker src/a.ts:1 names 0003']);
    expect(card.all().some((node) => /\bbadge\b/.test(node.className) && node.className.includes('glyph-check') && node.textContent === 'accepted')).toBe(true);
    expect((nodes.get('cost') as FakeNode).textContent).toBe('A review costs 1 decision-checker call (AI credits), one per governing decision. Refresh is free.');
    expect((nodes.get('meta') as FakeNode).allText()).toContain('1 changed file');
  });

  test('a hostile status cannot pick a tone or glyph class', async () => {
    const nodes = await runPage(PAGE_JS, REVIEW_IDS, { ...base, status: 'constructor' });
    expect((nodes.get('status') as FakeNode).className).toBe('badge lg tone-neutral glyph-ask');
  });
});

// -------------------------------------------------------- decision-board

describe('decision-board view and highlight', () => {
  const node = (id: string, x: number, status = 'accepted') => ({ id, title: `Decision ${id}`, status, x, y: 16 });
  const graph = {
    available: true, mode: 'graph', totalNodes: 3, totalEdges: 1, width: 700, height: 88, byStatus: [], notes: [],
    nodes: [node('0001', 16), node('0002', 288), node('0003', 560, 'proposed')],
    edges: [{ from: '0002', to: '0001', kind: 'supersedes' }],
  };
  const state = { workingDirectory: '/repo', filter: { id: null, kinds: [] }, graph, queue: { available: true, items: [], totalItems: 0 }, review: { enabled: false, reviewer: null, note: 'off because.' } };
  const svgRoot = (nodes: Map<string, FakeNode>) => (nodes.get('board') as FakeNode).all().find((n) => n.tag === 'svg') as FakeNode;
  const records = (nodes: Map<string, FakeNode>) => (nodes.get('board') as FakeNode).all().filter((n) => n.tag === 'g' && n.attrs['role'] === 'button');

  test('the graph keys zoom, fit, and pan by rewriting the viewBox only', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, state);
    const frame = (nodes.get('board') as FakeNode).all().find((n) => n.attrs['tabindex'] === '0' && n.attrs['role'] === 'region') as FakeNode;
    expect(frame).toBeDefined();
    const box = () => svgRoot(nodes).attrs['viewBox']!.split(' ').map(Number) as [number, number, number, number];
    const start = box();
    frame.fire('keydown', { key: '+' });
    expect(box()[2]).toBeCloseTo(start[2] / 1.25, 1);
    frame.fire('keydown', { key: 'ArrowRight' });
    expect(box()[0]).toBeGreaterThan(start[0]);
    frame.fire('keydown', { key: '0' });
    expect(box()).toEqual(viewBoxOf(fitView(700, 88, 700, 88)).split(' ').map(Number) as typeof start);
    // Typing in a field is left alone.
    const before = box();
    frame.fire('keydown', { key: '+', target: new FakeNode('input') });
    expect(box()).toEqual(before);
    // The zoom buttons do the same thing.
    const zoomIn = (nodes.get('board') as FakeNode).all().find((n) => n.tag === 'button' && n.attrs['aria-label'] === 'Zoom in') as FakeNode;
    zoomIn.fire('click');
    expect(box()[2]).toBeLessThan(before[2]);
  });

  test('a drag pans and does not select the record it ended on', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, state);
    const root = svgRoot(nodes);
    const start = root.attrs['viewBox'];
    root.fire('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    root.fire('pointermove', { clientX: 60, clientY: 10 });
    root.fire('pointerup', {});
    expect(root.attrs['viewBox']).not.toBe(start);
    // A plain wheel is the panel's scroll, not the graph's: untouched, not prevented.
    const panned = root.attrs['viewBox'];
    let prevented = false;
    root.fire('wheel', { deltaY: 120, clientX: 5, clientY: 5, preventDefault: () => void (prevented = true) });
    expect({ viewBox: root.attrs['viewBox'], prevented }).toEqual({ viewBox: panned, prevented: false });
    root.fire('wheel', { deltaY: -120, ctrlKey: true, clientX: 5, clientY: 5, preventDefault: () => void (prevented = true) });
    expect(prevented).toBe(true);
    expect(root.attrs['viewBox']).not.toBe(panned);
    (records(nodes)[0] as FakeNode).fire('click');
    expect((nodes.get('detail') as FakeNode).allText()).not.toContain('Neighbors');
    (records(nodes)[0] as FakeNode).fire('click');
    expect((nodes.get('detail') as FakeNode).allText()).toContain('Neighbors');
  });

  test('selecting a record keeps its neighbors and dims the rest, by class', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, state);
    (records(nodes).find((n) => n.attrs['aria-label']!.startsWith('0001')) as FakeNode).fire('keydown', { key: 'Enter' });
    const byId = (id: string) => records(nodes).find((n) => n.attrs['aria-label']!.startsWith(id)) as FakeNode;
    expect(byId('0001').attrs['class']).toContain('selected');
    expect(byId('0002').attrs['class']).toContain('neighbor');
    expect(byId('0003').attrs['class']).toContain('dim');
    for (const record of records(nodes)) expect(record.className).toBe('');
    // The full title rides on an SVG title element, built with createElementNS.
    const title = byId('0003').children.find((n) => n.tag === 'title');
    expect(title?.ns).toBe('http://www.w3.org/2000/svg');
    expect(title?.textContent).toBe('0003 (proposed): Decision 0003');
  });

  test('a resize re-opens an untouched graph, and keeps the scale once it has been zoomed', async () => {
    const wide = { ...state, graph: { ...state.graph, width: 776, height: 88 } };
    FakeNode.rect = { width: 900, height: 240 };
    try {
      const nodes = await runPage(BOARD_JS, BOARD_IDS, wide);
      const box = () => svgRoot(nodes).attrs['viewBox']!.split(' ').map(Number);
      expect(box()).toEqual(viewBoxOf(initialView(776, 88, 900, 240)).split(' ').map(Number));
      FakeNode.rect = { width: 490, height: 240 };
      for (const listener of windowListeners['resize'] ?? []) listener();
      expect(box()).toEqual(viewBoxOf(initialView(776, 88, 490, 240)).split(' ').map(Number));
      const frame = (nodes.get('board') as FakeNode).all().find((n) => n.attrs['role'] === 'region') as FakeNode;
      frame.fire('keydown', { key: '+' });
      const zoomed = box();
      FakeNode.rect = { width: 980, height: 240 };
      for (const listener of windowListeners['resize'] ?? []) listener();
      // Same scale (pixels per unit) and the same top-left corner.
      expect(980 / box()[2]!).toBeCloseTo(490 / zoomed[2]!, 6);
      expect(box()[0]).toBeCloseTo(zoomed[0]!, 6);
    } finally {
      FakeNode.rect = null;
    }
  });

  test('the frame height is a class step, chosen from the drawing', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, state);
    const frame = (nodes.get('board') as FakeNode).all().find((n) => n.attrs['role'] === 'region') as FakeNode;
    expect(frame.className).toBe('graph-frame h-s');
    for (const step of ['h-s', 'h-m', 'h-l', 'h-xl']) expect(BOARD_CSS).toContain(`.graph-frame.${step} {`);
  });

  test('before the snapshot, the graph, detail, and queue each say they are loading', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, state, { hold: true });
    expect((nodes.get('board') as FakeNode).allText()).toContain('Loading the decision graph');
    expect((nodes.get('detail') as FakeNode).allText()).toContain('Select a record');
    expect((nodes.get('queue') as FakeNode).allText()).toContain('Loading the open-proposal list');
  });
});

describe('decision-board review facts and controls', () => {
  const row = { id: '0004', title: 'Expire widgets', sourcePath: 'docs/adr/0004.md', slaState: 'within-sla', deadlineDate: '2026-10-15', approvalCount: 2, quorum: 3, unresolvedObjectionCount: 1, resolvedObjectionCount: 1, routingTargets: ['@o'], itemFindingCount: 0 };
  const graph = { available: true, mode: 'graph', totalNodes: 1, totalEdges: 0, width: 232, height: 88, byStatus: [], notes: [], nodes: [{ id: '0004', title: 'Expire widgets', status: 'proposed', x: 16, y: 16 }], edges: [] };
  const snapshot = (review: unknown) => ({ workingDirectory: '/repo', filter: { id: null, kinds: [] }, graph, queue: { available: true, items: [row], totalItems: 1 }, review });

  test('approvals are dots plus the counts, objections two labelled counts; nothing more', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, snapshot({ enabled: false, reviewer: null, note: 'off because.' }));
    const queue = nodes.get('queue') as FakeNode;
    const dots = queue.all().filter((n) => /^dot( on)?$/.test(n.className));
    expect(dots.map((n) => n.className)).toEqual(['dot on', 'dot on', 'dot']);
    const text = queue.allText();
    expect(text).toContain('approvals 2 of quorum 3');
    expect(text).toContain('1 unresolved');
    expect(text).toContain('1 resolved');
    expect(text).toContain('SLA within-sla');
    expect(text).not.toMatch(/\bready\b|\beligible\b|can be/i);
  });

  test('disabled: the fixed note is shown once above the list, and every control carries it', async () => {
    const note = 'Recording review is off: a fixed reason.';
    const nodes = await runPage(BOARD_JS, BOARD_IDS, snapshot({ enabled: false, reviewer: null, note }));
    const queue = nodes.get('queue') as FakeNode;
    expect(queue.allText().split(note).length - 1).toBe(1);
    const controls = queue.all().filter((n) => n.tag === 'button' && /Approve|objection/.test(n.textContent));
    expect(controls.length).toBe(3);
    for (const control of controls) expect({ disabled: control.disabled, why: control.attrs['aria-description'] }).toEqual({ disabled: true, why: note });
  });

  test('enabled: step 1 names the reviewer; arming moves to a distinct step 2 and names step 3, the host', async () => {
    const nodes = await runPage(BOARD_JS, BOARD_IDS, snapshot({ enabled: true, reviewer: '@alice', note: null }));
    const queue = nodes.get('queue') as FakeNode;
    expect(queue.allText()).toContain('Step 1 of 3');
    const approve = queue.all().find((n) => n.tag === 'button' && n.textContent === 'Approve as @alice') as FakeNode;
    approve.fire('click');
    await settle();
    const box = queue.all().find((n) => n.className === 'review-controls') as FakeNode;
    expect(box.attrs['data-step']).toBe('confirm');
    expect(box.allText()).toContain('Step 2 of 3');
    expect(box.allText()).toContain('Step 3 of 3');
    expect(box.allText()).toContain('GitHub Copilot will then ask you to confirm it again');
    expect(BOARD_CSS).toContain('.review-controls[data-step="confirm"]');
  });
});
