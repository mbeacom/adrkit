/**
 * A fake document for the page module, after the plugin's `visual-pass.test.ts` fake: it
 * implements exactly the DOM surface `src/page/app.mjs` uses, so a page that reached for
 * anything else (`innerHTML`, `querySelector`, `classList`, `dataset`) would fail here as well
 * as in the static scan. `className` is a plain field on every node, as a browser's is on an
 * HTML element; on an SVG element a browser ignores the assignment, so the tests assert it
 * stays empty there.
 */

import { startPortal } from '../src/page/app.mjs';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_IDS = ['corpus', 'banner', 'app', 'footer', 'nav-overview', 'nav-graph', 'nav-queue', 'nav-paths'];

export class FakeNode {
  children: FakeNode[] = [];
  textContent = '';
  className = '';
  value = '';
  checked = false;
  focused = false;
  scrolled = false;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(event?: unknown) => void>> = {};
  static rect: { width: number; height: number } | null = null;
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
  getBoundingClientRect() {
    const rect = FakeNode.rect;
    return rect ? { left: 0, top: 0, ...rect } : { left: 0, top: 0, width: 0, height: 0 };
  }
  focus() {
    this.focused = true;
  }
  scrollIntoView() {
    this.scrolled = true;
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners[type] ?? []) listener({ target: this, preventDefault() {}, ...event });
  }
  /** Every text this node and its descendants carry, joined by spaces. */
  allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(' ').replace(/\s+/g, ' ');
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

export interface FakePage {
  readonly nodes: Map<string, FakeNode>;
  readonly window: { location: { hash: string }; listeners: Record<string, Array<() => void>> };
  readonly fetched: string[];
  readonly app: FakeNode;
  /** Change the hash and fire `hashchange`, as a browser does. */
  go(hash: string): void;
}

/**
 * Start the page against a fake document with `data` as the fetched file (or a failing
 * response when `data` is a number: the HTTP status).
 */
export async function runPortal(data: unknown, hash = '#/'): Promise<FakePage> {
  const nodes = new Map(PAGE_IDS.map((id) => [id, new FakeNode(id === 'app' ? 'main' : 'div')]));
  const listeners: Record<string, Array<() => void>> = {};
  const window = {
    location: { hash },
    listeners,
    addEventListener: (type: string, listener: () => void) => void (listeners[type] ??= []).push(listener),
    scrollTo() {},
  };
  const fetched: string[] = [];
  const document = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (ns: string, tag: string) => new FakeNode(tag, ns),
    createTextNode: (text: string) => Object.assign(new FakeNode('#text'), { textContent: text }),
  };
  const fetch = async (url: string) => {
    fetched.push(url);
    if (typeof data === 'number') return { ok: false, status: data, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  await startPortal({ document, window, fetch });
  return {
    nodes,
    window,
    fetched,
    app: nodes.get('app')!,
    go(next: string) {
      window.location.hash = next;
      for (const listener of listeners['hashchange'] ?? []) listener();
    },
  };
}
