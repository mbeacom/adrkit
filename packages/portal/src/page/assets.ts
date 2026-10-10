/**
 * The page bundle's files, embedded as text so the bundled generator carries them
 * ([ADR-0054](../../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clauses 2, 7, 8, 11).
 *
 * `bun build --target=node` inlines every `with { type: 'text' }` import as a string, so
 * `packages/ci/dist/portal-action.js` writes the page without finding files next to itself;
 * `import.meta.url` no longer points here after bundling. Plain `bun` and `bun test` read the
 * same imports from disk.
 *
 * The output mirrors the source tree, so the page module's relative imports
 * (`../vendor/board-layout.mjs`) resolve the same way in `src/` (where the tests import it)
 * and in the bundle:
 *
 * ```
 * index.html                 src/page/index.html, with the meta CSP of clause 7
 * app.css                    THEME_CSS, then src/page/page.css
 * page/app.mjs               src/page/app.mjs
 * vendor/board-layout.mjs    src/vendor/board-layout.mjs, the generated copy
 * vendor/board-view.mjs      src/vendor/board-view.mjs, the generated copy
 * portal-data.json           written by generate.ts
 * ```
 *
 * `canvas-theme.mjs` is not written: the page never loads it, because its whole output is
 * `THEME_CSS`, which is already the head of `app.css`. It is imported here as a module for
 * that value, and Bun's bundler holds each file under one loader, so the same file cannot
 * also be embedded as text in this bundle (measured: the text import came back `undefined`).
 */

import { THEME_CSS } from '../vendor/canvas-theme.mjs';
import * as layoutText from '../vendor/board-layout.mjs' with { type: 'text' };
import * as viewText from '../vendor/board-view.mjs' with { type: 'text' };
import * as appText from './app.mjs' with { type: 'text' };
import * as htmlText from './index.html' with { type: 'text' };
import * as cssText from './page.css' with { type: 'text' };

/** One file of the page bundle. `path` is relative to the output directory, POSIX separators. */
export interface PortalAsset {
  readonly path: string;
  readonly contents: string;
}

/** A text import's string. TypeScript types each import as its module, so the value is read untyped and checked. */
function textOf(namespace: unknown, name: string): string {
  const value = (namespace as { default?: unknown }).default;
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The portal page asset "${name}" was not embedded as text.`);
  return value;
}

/** The page's own stylesheet rules, without the theme. */
export const PAGE_CSS = textOf(cssText, 'page.css');

/** Every file of the page bundle, in write order. `portal-data.json` is not among them. */
export const PORTAL_ASSETS: readonly PortalAsset[] = Object.freeze([
  { path: 'index.html', contents: textOf(htmlText, 'index.html') },
  { path: 'app.css', contents: `${THEME_CSS}\n${PAGE_CSS}` },
  { path: 'page/app.mjs', contents: textOf(appText, 'app.mjs') },
  { path: 'vendor/board-layout.mjs', contents: textOf(layoutText, 'board-layout.mjs') },
  { path: 'vendor/board-view.mjs', contents: textOf(viewText, 'board-view.mjs') },
]);
