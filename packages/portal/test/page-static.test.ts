/**
 * Static rules over the page files the portal ships (ADR-0054 clauses 5, 7, 8), read from
 * `PORTAL_ASSETS`, the exact strings the generator writes, and from `src/page/`.
 *
 * - clause 7: the meta CSP is exactly the decided policy and comes before any fetch; one
 *   external module script, one stylesheet, no inline script or style, no handler attribute;
 *   the page module has no markup-parsing sink, no inline-style sink, and no code-from-string.
 * - clause 8: every reference is relative, every in-page link is a hash route.
 * - clause 5: no ratifying or review command and no readiness word in the portal's own
 *   strings (`mentionsVerb` from `packages/mcp/test/writing-verbs.test.ts`, as the vendor test
 *   uses it), and no path is ever called ungoverned (clause 6).
 * - the page holds no form and sends nothing (clause 4).
 *
 * ADR-0016 clause 2: observed failing, 2026-10-10, macOS, Bun 1.4.2. Each edit was made, the
 * suite run, and the edit reverted; the retained input is the edit named here.
 * - `main.innerHTML = '';` added to `render()` in `src/page/app.mjs`: "the page module has no
 *   markup sink and no code from a string" failed.
 * - `box.style.display = 'none';` added to `callout()`: "no inline style sink" failed.
 * - `'unsafe-inline'` added to `style-src` in `src/page/index.html`: "the CSP meta is exactly
 *   the decided policy" failed.
 * - `.node.dim .node-base { opacity: 0.3; }` added to `page.css` (a dimmed record's base
 *   letting lines show through): "it loads nothing and dims the box, never the label" failed.
 * - the queue lede changed to end "no verdict to them, ready or not.": "no ratifying or review
 *   command, and no readiness word" failed.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAGE_CSS, PORTAL_ASSETS } from '../src/page/assets.ts';
import { THEME_CSS } from '../src/vendor/canvas-theme.mjs';

const PAGE_DIR = resolve(import.meta.dir, '../src/page');
const asset = (path: string) => {
  const found = PORTAL_ASSETS.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`no asset ${path}`);
  return found.contents;
};
const HTML = asset('index.html');
const APP = asset('page/app.mjs');
const CSS = asset('app.css');

/** Strip comments so the code rules are about code, not prose describing them. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const VERBS = ['accept', 'approve', 'object', 'resolve'] as const;
const TRANSITIONS = /\b(?:acceptAdrSource|approveAdrSource|objectAdrSource|resolveObjectionAdrSource)\b/;

/** `packages/mcp/test/writing-verbs.test.ts`'s `mentionsVerb`, unchanged. */
function mentionsVerb(text: string): boolean {
  const alt = VERBS.join('|');
  const type = `['"\`](?:null|string|array|number|boolean|integer|object)['"\`]`;
  const code = text.replace(new RegExp(`\\[\\s*${type}(?:\\s*,\\s*${type})*(?:\\s*,)?\\s*\\]`, 'g'), '');
  return [
    new RegExp(`[\\[,(]\\s*['"\`](?:${alt})['"\`]\\s*[,\\])]`),
    new RegExp(`(?<![=!<>])=\\s*['"\`](?:${alt})['"\`]`),
    new RegExp(`\\badr_(?:${alt})\\b`, 'i'),
    new RegExp(`(?:\\badr|ADRKIT_CLI\\}?"?|@adrkit\\/cli|\\$\\{[^}]*\\})[\\s\\p{Cf}]+(?:${alt})\\b`, 'iu'),
  ].some((pattern) => pattern.test(code));
}
const RATIFYING_COMMAND = /\badr\W+(accept|approve|object|resolve)\b/i;
const READINESS = /\b(ready|eligible|ratifiable)\b/i;

describe('index.html (clauses 7 and 8)', () => {
  test('the CSP meta is exactly the decided policy, first in the head', () => {
    const metas = [...HTML.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/gi)];
    expect(metas.map((match) => match[1])).toEqual([CSP]);
    const at = HTML.indexOf('Content-Security-Policy');
    expect(at).toBeLessThan(HTML.indexOf('<link'));
    expect(at).toBeLessThan(HTML.indexOf('<script'));
  });

  test('one external module script and one stylesheet, nothing inline', () => {
    // Count every opener rather than parse script elements with a regex: a closing tag
    // has spellings (`</script >`, `</script x>`) a tag pattern can miss (CodeQL
    // js/bad-tag-filter), while one opener plus the exact empty element leaves no room
    // for a second, inline script however it is closed.
    expect(HTML.match(/<script/gi) ?? []).toHaveLength(1);
    expect(HTML).toContain('<script type="module" src="./page/app.mjs"></script>');
    expect([...HTML.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0])).toEqual(['<link rel="stylesheet" href="./app.css">']);
    expect(HTML).not.toMatch(/<style\b/i);
    expect(HTML).not.toMatch(/\sstyle\s*=/i);
    expect(HTML).not.toMatch(/\son[a-z]+\s*=/i);
    expect(HTML).not.toMatch(/<form\b/i);
    expect(HTML).not.toMatch(/<base\b/i);
  });

  test('every reference is relative and every link a hash route', () => {
    const refs = [...HTML.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((match) => match[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const ref of refs) expect({ ref, ok: /^(\.\/[A-Za-z0-9_./-]+|#\/[a-z]*)$/.test(ref) }).toEqual({ ref, ok: true });
  });

  test('the page mounts the ids the module reads', () => {
    for (const id of ['corpus', 'banner', 'app', 'footer', 'nav-overview', 'nav-graph', 'nav-queue', 'nav-paths']) expect(HTML).toContain(`id="${id}"`);
  });
});

describe('the page module (clause 7)', () => {
  const code = codeOf(APP);

  test('it is the source file, shipped verbatim', () => {
    expect(APP).toBe(readFileSync(join(PAGE_DIR, 'app.mjs'), 'utf8'));
  });

  test('the page module has no markup sink and no code from a string', () => {
    for (const sink of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write/, /\bDOMParser\b/, /\bcreateContextualFragment\b/, /\bsrcdoc\b/, /\beval\s*\(/, /\bFunction\s*\(/, /\bnew\s+Function\b/, /\bsetTimeout\s*\(\s*['"`]/, /\bimport\s*\(/]) {
      expect({ sink: String(sink), found: sink.test(code) }).toEqual({ sink: String(sink), found: false });
    }
  });

  test('no inline style sink', () => {
    for (const sink of [/\.style\b/, /['"]style['"]/, /\bstyle\s*=/, /cssText/, /setProperty\s*\(/, /insertRule\s*\(/, /CSSStyleSheet/, /adoptedStyleSheets/]) {
      expect({ sink: String(sink), found: sink.test(code) }).toEqual({ sink: String(sink), found: false });
    }
  });

  test('it sends nothing and builds no form', () => {
    expect([...code.matchAll(/\bfetch\s*\(([^,)]*)/g)].map((match) => match[1]!.trim())).toEqual(['DATA_URL']);
    expect(code).toContain("export const DATA_URL = './portal-data.json';");
    for (const sink of [/\bmethod\s*:/, /\bPOST\b/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /['"`]form['"`]/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bdocument\.cookie\b/]) {
      expect({ sink: String(sink), found: sink.test(code) }).toEqual({ sink: String(sink), found: false });
    }
  });

  test('it touches the browser only through the env it is started with', () => {
    // The only bare `document`/`window` are the guarded boot line at the bottom.
    const bare = code.split('\n').filter((line) => /(^|[^.\w])(document|window)\b/.test(line));
    expect(bare).toEqual([
      "if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.fetch === 'function') {",
      '  startPortal({ document, window, fetch: window.fetch.bind(window) });',
    ]);
    expect(code).not.toMatch(/(^|[^.\w])Bun\b/);
  });

  test('every literal link it sets is a hash route', () => {
    const literals = [...code.matchAll(/['"`](#[^'"`]*)['"`]/g)].map((match) => match[1]!);
    expect(literals.length).toBeGreaterThan(3);
    // A bare `#` appears once, in `parseRoute`, as the empty route it reads as the overview.
    for (const href of literals) expect({ href, ok: href.startsWith('#/') || href === '#' }).toEqual({ href, ok: true });
    expect(literals.filter((href) => href === '#')).toHaveLength(1);
  });

  test('it imports only the two vendor modules the generator writes beside it', () => {
    const imports = [...code.matchAll(/^\s*import\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    expect(imports).toEqual(['../vendor/board-layout.mjs', '../vendor/board-view.mjs']);
    const written = new Set(PORTAL_ASSETS.map((file) => file.path));
    for (const specifier of imports) expect(written.has(new URL(specifier!, 'https://x.invalid/page/app.mjs').pathname.slice(1))).toBe(true);
  });
});

describe('the stylesheet', () => {
  test('app.css is the shared theme followed by the page rules', () => {
    expect(CSS).toBe(`${THEME_CSS}\n${PAGE_CSS}`);
    expect(PAGE_CSS).toBe(readFileSync(join(PAGE_DIR, 'page.css'), 'utf8'));
  });

  test('it loads nothing and dims the box, never the label', () => {
    expect(CSS).not.toMatch(/@import|url\s*\(|expression\s*\(/i);
    expect(PAGE_CSS).toContain('.node.dim .node-box, .node.dim .node-stripe { opacity: 0.3; }');
    // The opaque base under each box is never dimmed, so a dimmed record still hides the lines behind it.
    expect(PAGE_CSS).toContain('.node-base { fill: var(--c-bg); stroke: none; }');
    expect(PAGE_CSS).not.toMatch(/node-base[^{]*\{[^}]*opacity/);
    expect(PAGE_CSS).not.toMatch(/\.node\.dim\s*\{[^}]*opacity/);
    expect(PAGE_CSS).not.toMatch(/\.node\.dim [^{]*\.node-title[^{]*\{[^}]*opacity/);
  });
});

describe('the bundle as a whole', () => {
  test('every path is relative, inside the output directory', () => {
    expect(PORTAL_ASSETS.map((file) => file.path)).toEqual(['index.html', 'app.css', 'page/app.mjs', 'vendor/board-layout.mjs', 'vendor/board-view.mjs']);
    for (const { path } of PORTAL_ASSETS) expect({ path, ok: /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z]+$/.test(path) && !path.split('/').includes('..') }).toEqual({ path, ok: true });
  });

  test('every page source file is either shipped or a build-only declaration', () => {
    expect(readdirSync(PAGE_DIR).sort()).toEqual(['app.mjs', 'assets.ts', 'index.html', 'page.css', 'text-imports.d.ts']);
  });

  test('no ratifying or review command, and no readiness word, in the portal\'s own page strings (clause 5)', () => {
    // The vendor copies are checked by vendor.test.ts; these are the portal's own files.
    const own = PORTAL_ASSETS.filter((file) => !file.path.startsWith('vendor/')).map((file) => ({ path: file.path, text: file.contents }));
    own.push({ path: 'src/page/assets.ts', text: readFileSync(join(PAGE_DIR, 'assets.ts'), 'utf8') });
    const hits = own.filter(({ text }) => TRANSITIONS.test(text) || mentionsVerb(text) || RATIFYING_COMMAND.test(text)).map(({ path }) => path);
    expect(hits).toEqual([]);
    expect(own.filter(({ text }) => READINESS.test(text)).map(({ path }) => path)).toEqual([]);
    expect(own.filter(({ text }) => /ungoverned/i.test(text)).map(({ path }) => path)).toEqual([]);
  });

  test('the word rules catch planted forms, and not ordinary page code', () => {
    for (const plant of ["run('approve')", 'Run `adr accept 0042` to finish', 'const verb = "resolve"', 'adr_object']) {
      expect({ plant, caught: mentionsVerb(plant) || RATIFYING_COMMAND.test(plant) }).toEqual({ plant, caught: true });
    }
    for (const plant of ['Ready to ratify', 'eligible for acceptance', 'Ratifiable']) expect({ plant, caught: READINESS.test(plant) }).toEqual({ plant, caught: true });
    for (const idiom of ["typeof x === 'object'", 'Promise.resolve()', 'already drawn', 'document.readyState', 'adr explain src/a.ts']) {
      expect({ idiom, caught: mentionsVerb(idiom) || RATIFYING_COMMAND.test(idiom) || READINESS.test(idiom) }).toEqual({ idiom, caught: false });
    }
  });
});
