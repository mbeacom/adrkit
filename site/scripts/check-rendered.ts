/**
 * Assert the rendered site still holds the invariants that `bun run build`
 * cannot see.
 *
 * The site is deliberately outside every root gate (ADR-0011), so `astro build`
 * exiting 0 is the *only* automated signal a site change gets. That signal is
 * blind to everything presentational: a rule that silently stops applying, a
 * colour pair that drops below its contrast threshold, a heading that stops
 * lining up with its own prose. Every defect fixed in #150 compiled perfectly
 * and would have deployed.
 *
 * So this loads the built output in a real browser and asserts specific observed
 * values — computed styles and geometry — rather than the absence of an error.
 *
 *   bun run scripts/check-rendered.ts [--self-test] [--allow-skip]
 *
 * **The browser is never downloaded.** `playwright-core` ships no binaries; this
 * drives a Chrome/Chromium already on the machine (GitHub's runners preinstall
 * one). That keeps the install honest about CONTRIBUTING's first hard rule: the
 * frozen install may reach the public package registry and nothing else.
 *
 * `--self-test` is the permanent negative case CONTRIBUTING's third hard rule
 * requires. It injects a stylesheet built to violate each invariant and fails
 * unless every check reports a failure. A checker that cannot fail is not
 * coverage, and "0 failures" reads identically whether it looked or could not
 * look — so the negative case is what distinguishes the two.
 *
 * `--allow-skip` downgrades "no browser found" to a skip, for a contributor who
 * has none. CI never passes it, so there the absence of a browser is a failure
 * rather than a silent pass.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const DIST = join(import.meta.dir, '..', 'dist');
const AA_TEXT = 4.5; // WCAG 2.2 SC 1.4.3, text below 18.66px
const AA_NON_TEXT = 3.0; // SC 1.4.11 / 2.4.11, focus indicators and UI boundaries

/** A record whose `superseded` badge exercises the sidebar current-entry case. */
const SUPERSEDED_PAGE = '/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema/';

/** Chrome locations to try, in order. Extend rather than replace. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

function findChrome(): string | undefined {
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

interface Failure {
  check: string;
  detail: string;
}

const failures: Failure[] = [];
let checksRun = 0;

function record(ok: boolean, check: string, detail: string): void {
  checksRun += 1;
  if (!ok) failures.push({ check, detail });
}

/**
 * Serve `dist` over HTTP. `file://` resolves the site's absolute asset paths
 * against the filesystem root, so the stylesheet never loads and every computed
 * style would be a default — a checker that passes because it saw nothing.
 */
function serveDist(): { server: ReturnType<typeof Bun.serve>; origin: string } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = Bun.file(join(DIST, path));
      if (await file.exists()) return new Response(file);
      const html = Bun.file(join(DIST, path, 'index.html'));
      if (await html.exists()) return new Response(html);
      return new Response('not found', { status: 404 });
    },
  });
  return { server, origin: `http://localhost:${server.port}` };
}

/** Colour helpers, injected into the page. */
const COLOUR_HELPERS = `
  window.__cv = document.createElement('canvas');
  window.__cv.width = window.__cv.height = 1;
  window.__ctx = window.__cv.getContext('2d', { willReadFrequently: true });
  // getComputedStyle returns oklch() in current Chrome; naive rgb() parsing
  // misreads it as three unrelated numbers. Paint it and read the pixel back.
  window.__px = (c, over) => {
    __ctx.clearRect(0, 0, 1, 1);
    __ctx.fillStyle = over || '#ffffff';
    __ctx.fillRect(0, 0, 1, 1);
    __ctx.fillStyle = c;
    __ctx.fillRect(0, 0, 1, 1);
    const d = __ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  window.__lum = (rgb) => {
    const c = rgb.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  window.__contrast = (fg, bgColor, over) => {
    const l1 = __lum(__px(fg, over));
    const l2 = __lum(__px(bgColor, over));
    return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
  };
`;

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.addScriptTag({ content: COLOUR_HELPERS });
}

/** Contrast of an element's own text against a named ancestor's background. */
async function contrastAgainst(page: Page, sel: string, bgSel: string): Promise<number | null> {
  return page.evaluate(
    ([s, b]) => {
      const el = document.querySelector(s as string);
      const bg = document.querySelector(b as string);
      if (!el || !bg) return null;
      return (window as any).__contrast(
        getComputedStyle(el).color,
        getComputedStyle(bg).backgroundColor,
      );
    },
    [sel, bgSel],
  );
}

async function checkHome(page: Page, origin: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await setTheme(page, theme);

    // The marketing chips must stay borderless and unfilled. This is the exact
    // shape of the #150 specificity regression: the rule compiles either way,
    // and losing it repaints every chip as a docs-prose box.
    const chip = await page.evaluate(() => {
      const el = document.querySelector('.adr-roadmap :not(pre) > code');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopWidth, background: cs.backgroundColor };
    });
    record(chip !== null, `home/${theme}: roadmap code chip present`, 'selector matched nothing');
    if (chip) {
      record(
        chip.border === '0px',
        `home/${theme}: roadmap code chip has no border`,
        `border-top-width=${chip.border}, expected 0px`,
      );
      record(
        chip.background === 'rgba(0, 0, 0, 0)' || chip.background === 'transparent',
        `home/${theme}: roadmap code chip has no fill`,
        `background=${chip.background}, expected transparent`,
      );
    }

    // Text on the coral band, which is coral in both themes.
    for (const [label, sel] of [
      ['body copy', '.adr-roadmap__item p'],
      ['link', '.adr-roadmap a:not(.adr-button)'],
      ['code chip', '.adr-roadmap :not(pre) > code'],
      ['planned pill', '.adr-roadmap__item .adr-status--planned'],
    ] as const) {
      const ratio = await contrastAgainst(page, sel, '.adr-roadmap');
      record(
        ratio !== null && ratio >= AA_TEXT,
        `home/${theme}: roadmap ${label} contrast`,
        `${ratio ?? 'element missing'} (need >= ${AA_TEXT})`,
      );
    }

    // The pill that was white-on-white in dark mode before #150.
    const currentPill = await page.evaluate(() => {
      const el = document.querySelector('.adr-roadmap__item .adr-status--current');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return (window as any).__contrast(cs.color, cs.backgroundColor);
    });
    record(
      currentPill !== null && currentPill >= AA_TEXT,
      `home/${theme}: roadmap current pill contrast`,
      `${currentPill ?? 'element missing'} (need >= ${AA_TEXT})`,
    );

    // The focus ring is drawn on the band itself, so it needs its own colour.
    const ring = await page.evaluate(() => {
      const a = document.querySelector<HTMLElement>('.adr-roadmap a:not(.adr-button)');
      const band = document.querySelector('.adr-roadmap');
      if (!a || !band) return null;
      a.focus();
      return (window as any).__contrast(
        getComputedStyle(a).outlineColor,
        getComputedStyle(band).backgroundColor,
      );
    });
    record(
      ring !== null && ring >= AA_NON_TEXT,
      `home/${theme}: roadmap focus ring contrast`,
      `${ring ?? 'element missing'} (need >= ${AA_NON_TEXT})`,
    );

    // One shared left edge: the hero headline and every section heading below it
    // resolve the same gutter token. Drifting them apart is invisible to a build.
    const edges = await page.evaluate(() => {
      const L = (s: string) => {
        const e = document.querySelector(s);
        return e ? Math.round(e.getBoundingClientRect().left) : null;
      };
      return {
        hero: L('.adr-hero h1'),
        section: L('.adr-section-heading h2'),
        closing: L('.adr-closing blockquote'),
      };
    });
    record(
      edges.hero !== null && edges.hero === edges.section && edges.hero === edges.closing,
      `home/${theme}: shared left edge`,
      `hero=${edges.hero} section=${edges.section} closing=${edges.closing}`,
    );
  }

  // No horizontal overflow anywhere across the responsive range.
  for (const width of [2000, 1440, 1100, 900, 700, 600, 480, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record(overflow <= 0, `home: no horizontal overflow at ${width}px`, `overflow=${overflow}px`);
  }
}

async function checkDocsPage(page: Page, origin: string): Promise<void> {
  // Wide enough that the content column stops growing, which is where the
  // unscoped full-bleed rule used to leave the title ~180px out of line.
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.goto(`${origin}/quickstart/`, { waitUntil: 'load' });
  const align = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('main > .content-panel')];
    const containers = panels
      .map((p) => p.querySelector('.sl-container'))
      .filter((c): c is Element => c !== null)
      .slice(0, 2);
    if (containers.length < 2) return null;
    return containers.map((c) => Math.round(c.getBoundingClientRect().left));
  });
  record(
    align !== null && align[0] === align[1],
    'quickstart: page title aligns with body content',
    align ? `title=${align[0]} body=${align[1]}` : 'fewer than two content panels',
  );
}

async function checkAdrSidebarBadge(page: Page, origin: string): Promise<void> {
  // Starlight outlines the badge on the current sidebar entry from inside a
  // cascade layer; this stylesheet is unlayered and outranks it. Getting that
  // wrong painted muted ink on the coral active row at 1.21:1.
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}${SUPERSEDED_PAGE}`, { waitUntil: 'load' });
    await setTheme(page, theme);
    const ratio = await page.evaluate(() => {
      const link = document.querySelector(".sidebar-content a[aria-current='page']");
      if (!link) return { error: 'no current sidebar entry' as const };
      const badge = link.querySelector('.sl-badge');
      if (!badge) return { error: 'no badge on current entry' as const };
      return {
        value: (window as any).__contrast(
          getComputedStyle(badge).color,
          getComputedStyle(link).backgroundColor,
        ),
      };
    });
    record(
      'value' in ratio && ratio.value >= AA_TEXT,
      `adr/${theme}: current sidebar badge contrast`,
      'error' in ratio ? ratio.error : `${ratio.value} (need >= ${AA_TEXT})`,
    );
  }
}

/**
 * The negative case. Every invariant above is deliberately broken, and this
 * fails unless the run reports at least as many failures as it has assertions
 * that the sabotage can reach.
 *
 * Built entirely from the site's own custom properties rather than literal
 * colours: it is a closer reproduction of the real regressions (the chip bug
 * *was* `--adr-line` on `--adr-panel`), it needs no off-palette values, and it
 * keeps working if the palette is retuned.
 */
const SABOTAGE = `
  .adr-home :is(.adr-status-band, .adr-capability, .adr-flow, .adr-roadmap) :not(pre) > code,
  .sl-markdown-content :not(pre) > code {
    border: 1px solid var(--adr-line) !important;
    background: var(--adr-panel) !important;
  }
  .adr-roadmap__item p,
  .adr-roadmap a,
  .adr-roadmap :not(pre) > code,
  .adr-roadmap__item .adr-status--planned { color: var(--adr-coral) !important; }
  .adr-roadmap__item .adr-status--current {
    background: var(--adr-coral) !important;
    color: var(--adr-coral) !important;
  }
  .adr-roadmap a:focus-visible { outline-color: var(--adr-coral) !important; }
  .adr-hero h1 { margin-inline-start: 40px !important; }
  main > .content-panel:first-child > .sl-container { max-width: 100% !important; }
  .sidebar-content a[aria-current='page'] > .sl-badge {
    color: var(--adr-coral-deep) !important;
    background: none !important;
  }
  .adr-home__section { width: 120vw !important; }
`;

async function run(): Promise<void> {
  const selfTest = process.argv.includes('--self-test');
  const allowSkip = process.argv.includes('--allow-skip');

  if (!existsSync(DIST)) {
    console.error('check-rendered: site/dist not found — run `bun run build` first.');
    process.exit(2);
  }

  const executablePath = findChrome();
  if (!executablePath) {
    const message =
      'check-rendered: no Chrome/Chromium found. Set CHROME_PATH, or install one.\n' +
      `  looked in: ${CHROME_CANDIDATES.join(', ')}`;
    if (allowSkip) {
      console.warn(`${message}\ncheck-rendered: SKIPPED (--allow-skip).`);
      process.exit(0);
    }
    console.error(`${message}\ncheck-rendered: refusing to pass without looking.`);
    process.exit(2);
  }

  const { server, origin } = serveDist();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath });
    const page = await browser.newPage();

    if (selfTest) {
      // Applies to every document this context loads, so each navigation in the
      // checks below is sabotaged.
      await page.addInitScript(`
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = ${JSON.stringify(SABOTAGE)};
          document.head.appendChild(s);
        });
      `);
    }

    await checkHome(page, origin);
    await checkDocsPage(page, origin);
    await checkAdrSidebarBadge(page, origin);
  } finally {
    await browser?.close();
    server.stop(true);
  }

  if (selfTest) {
    // Not every assertion is reachable by a stylesheet (the "element present"
    // guards are not), so require a substantial majority to have fired rather
    // than an exact count that would need editing with every new check.
    const needed = Math.ceil(checksRun * 0.6);
    if (failures.length < needed) {
      console.error(
        `check-rendered --self-test: sabotage produced only ${failures.length} failure(s) ` +
          `out of ${checksRun} checks; expected at least ${needed}.\n` +
          'The checks are not detecting the breakage they exist to detect.',
      );
      for (const f of failures) console.error(`  did fail: ${f.check}`);
      process.exit(1);
    }
    console.log(
      `check-rendered --self-test: ok — sabotage produced ${failures.length} ` +
        `failure(s) across ${checksRun} checks, so the checks can fail.`,
    );
    process.exit(0);
  }

  if (failures.length > 0) {
    console.error(`check-rendered: ${failures.length} of ${checksRun} check(s) failed:\n`);
    for (const f of failures) console.error(`  ✗ ${f.check}\n      ${f.detail}`);
    console.error(
      '\nThese are rendered-output invariants that `astro build` cannot see. ' +
        'See site/scripts/check-rendered.ts for what each one guards.',
    );
    process.exit(1);
  }

  console.log(`check-rendered: ok — ${checksRun} rendered invariant(s) hold.`);
}

await run();
