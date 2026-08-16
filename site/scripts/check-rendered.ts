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
/** Every check name in run order, not only the failing ones. */
const checkNames: string[] = [];

function record(ok: boolean, check: string, detail: string): void {
  checkNames.push(check);
  if (!ok) failures.push({ check, detail });
}

/**
 * The checks the sabotage stylesheet is expected to break, by name.
 *
 * This is the negative case's assertion, and it is deliberately a list rather
 * than a ratio. A threshold derived from the live check count falls as
 * assertions are deleted, so the same edit that removes coverage also lowers the
 * bar — the self-test stays green while the checker stops looking, which is the
 * one outcome CONTRIBUTING's third hard rule exists to prevent. Naming them
 * means a pruned check is a named absence in the diff.
 *
 * Checks NOT listed here are the "element present" guards, which a stylesheet
 * cannot break; they are excluded explicitly rather than absorbed as slack.
 */
const SABOTAGE_MUST_BREAK: readonly string[] = [
  'home/light: roadmap code chip has no border',
  'home/light: roadmap code chip has no fill',
  'home/light: roadmap body copy contrast',
  'home/light: roadmap link contrast',
  'home/light: roadmap code chip contrast',
  'home/light: roadmap planned pill contrast',
  'home/light: roadmap current pill contrast',
  'home/light: roadmap focus ring is drawn',
  'home/light: shared left edge',
  'home/dark: roadmap code chip has no border',
  'home/dark: roadmap code chip has no fill',
  'home/dark: roadmap body copy contrast',
  'home/dark: roadmap link contrast',
  'home/dark: roadmap code chip contrast',
  'home/dark: roadmap planned pill contrast',
  'home/dark: roadmap current pill contrast',
  'home/dark: roadmap focus ring is drawn',
  'home/dark: shared left edge',
  'quickstart: page title aligns with body content',
  'quickstart: docs prose code chip keeps its border',
  'quickstart: docs prose code chip keeps its fill',
  'adr/light: current sidebar badge contrast',
  'adr/dark: current sidebar badge contrast',
  'print: roadmap body copy legible on paper',
  'print: roadmap code chip legible on paper',
  'print: roadmap link legible on paper',
  'print: roadmap heading legible on paper',
];

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
async function contrastAgainst(
  page: Page,
  sel: string,
  bgSel: string,
): Promise<{ ratio: number; fg: string; bg: string } | null> {
  return page.evaluate(
    ([s, b]) => {
      const el = document.querySelector(s as string);
      const bg = document.querySelector(b as string);
      if (!el || !bg) return null;
      const fg = getComputedStyle(el).color;
      const bgc = getComputedStyle(bg).backgroundColor;
      return { ratio: (window as any).__contrast(fg, bgc), fg, bg: bgc };
    },
    [sel, bgSel],
  );
}

class StylesheetMissingError extends Error {}

/**
 * Abort unless the site's own stylesheet is actually in effect.
 *
 * Without this every assertion passes on a build with no CSS at all: unstyled
 * `<code>` has no border and no background (the chip checks pass), every
 * background is transparent so contrast composites to ~21:1 (every contrast
 * check passes), block boxes share a left edge (alignment passes), and an
 * unstyled document does not overflow (every width check passes). The run then
 * prints "N invariants hold" having observed nothing — which is the precise
 * failure this whole script exists to prevent, so it is a hard abort rather
 * than a recorded failure.
 */
async function assertStylesheetLoaded(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  const state = await page.evaluate(() => {
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue('--adr-coral')
      .trim();
    const band = document.querySelector('.adr-roadmap');
    const bandBg = band ? getComputedStyle(band).backgroundColor : null;
    return { token, bandBg, sheets: document.styleSheets.length };
  });
  const opaqueBand =
    state.bandBg !== null && state.bandBg !== 'rgba(0, 0, 0, 0)' && state.bandBg !== 'transparent';
  if (state.token.length === 0 || !opaqueBand) {
    console.error(
      'check-rendered: the site stylesheet is not in effect — refusing to grade an unstyled build.\n' +
        `  --adr-coral: ${state.token || '(empty)'}\n` +
        `  .adr-roadmap background: ${state.bandBg ?? '(element missing)'}\n` +
        `  stylesheets seen: ${state.sheets}\n` +
        'Every assertion would pass vacuously. This is a build or serving failure, not a regression.',
    );
    throw new StylesheetMissingError();
  }
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
      const m = await contrastAgainst(page, sel, '.adr-roadmap');
      record(
        m !== null && m.ratio >= AA_TEXT,
        `home/${theme}: roadmap ${label} contrast`,
        m === null
          ? `element missing (${sel})`
          : `${m.ratio} (need >= ${AA_TEXT}) — ${m.fg} on ${m.bg} [${sel}]`,
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
      const cs = getComputedStyle(a);
      return {
        // Colour alone cannot tell a white ring from no ring: `outline-color`
        // initialises to `currentcolor`, and this link's text is already
        // --adr-canvas, so the fallback and the intended value are identical.
        style: cs.outlineStyle,
        width: parseFloat(cs.outlineWidth),
        ratio: (window as any).__contrast(
          cs.outlineColor,
          getComputedStyle(band).backgroundColor,
        ),
        color: cs.outlineColor,
      };
    });
    record(
      ring !== null && ring.style !== 'none' && ring.width >= 2,
      `home/${theme}: roadmap focus ring is drawn`,
      ring === null
        ? 'element missing'
        : `outline-style=${ring.style} outline-width=${ring.width}px (need a solid ring >= 2px)`,
    );
    record(
      ring !== null && ring.ratio >= AA_NON_TEXT,
      `home/${theme}: roadmap focus ring contrast`,
      ring === null
        ? 'element missing'
        : `${ring.ratio} (need >= ${AA_NON_TEXT}) — ${ring.color} on the band`,
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
        closing: L('.adr-closing h2'),
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
  'quickstart: docs prose code chip keeps its border',
  'quickstart: docs prose code chip keeps its fill',
    align ? `title=${align[0]} body=${align[1]}` : 'fewer than two content panels',
  );

  // The complementary direction of the `:not(:has(.adr-home))` carve-out. The
  // home-page chip assertions only catch docs chrome leaking onto the marketing
  // page; this catches the carve-out over-reaching and stripping the box from
  // docs prose, which is the direction the new mechanism can actually break.
  const docsChip = await page.evaluate(() => {
    const el = document.querySelector('.sl-markdown-content :not(pre) > code');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { border: parseFloat(cs.borderTopWidth), background: cs.backgroundColor };
  });
  record(
    docsChip !== null && docsChip.border > 0,
    'quickstart: docs prose code chip keeps its border',
    docsChip === null ? 'no inline code on the page' : `border-top-width=${docsChip.border}px`,
  );
  record(
    docsChip !== null &&
      docsChip.background !== 'rgba(0, 0, 0, 0)' &&
      docsChip.background !== 'transparent',
    'quickstart: docs prose code chip keeps its fill',
    docsChip === null ? 'no inline code on the page' : `background=${docsChip.background}`,
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

async function checkPrint(page: Page, origin: string): Promise<void> {
  // The roadmap band is the one section whose text is white because its
  // background is coral, and browsers drop background graphics when printing.
  // A specificity change elsewhere in the file silently re-broke exactly this
  // once already, so it is asserted rather than trusted to the cascade.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await setTheme(page, 'light');
  try {
    for (const [label, sel] of [
      ['body copy', '.adr-roadmap__item p'],
      ['code chip', '.adr-roadmap :not(pre) > code'],
      ['link', '.adr-roadmap a:not(.adr-button)'],
      ['heading', '.adr-roadmap__item h3'],
    ] as const) {
      const ratio = await page.evaluate((s) => {
        const el = document.querySelector(s as string);
        if (!el) return null;
        // Paper, not the band: print drops the background graphic.
        return (window as any).__contrast(getComputedStyle(el).color, 'rgb(255,255,255)');
      }, sel);
      record(
        ratio !== null && ratio >= AA_TEXT,
        `print: roadmap ${label} legible on paper`,
        `${ratio ?? 'element missing'} against white (need >= ${AA_TEXT})`,
      );
    }
  } finally {
    await page.emulateMedia({ media: 'screen' });
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
  .adr-roadmap a:focus-visible { outline-style: none !important; }
  .adr-hero h1 { margin-inline-start: 40px !important; }
  main > .content-panel:first-child > .sl-container { max-width: 100% !important; }
  .sidebar-content a[aria-current='page'] > .sl-badge {
    color: var(--adr-coral-deep) !important;
    background: none !important;
  }
  .adr-home__section { width: 120vw !important; }
  .sl-markdown-content :not(pre) > code { border-width: 0 !important; background: none !important; }
  @media print {
    .adr-roadmap__item p,
    .adr-roadmap :not(pre) > code,
    .adr-roadmap a:not(.adr-button),
    .adr-roadmap__item h3 { color: var(--adr-canvas) !important; }
  }
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
    try {
      browser = await chromium.launch({ executablePath });
    } catch (error) {
      console.error(
        `check-rendered: found a browser at ${executablePath} but could not launch it.\n` +
          `  ${error instanceof Error ? error.message : String(error)}\n` +
          'This is an environment failure, not a site regression.',
      );
      server.stop(true);
      process.exit(2);
    }
    // Which browser produced the numbers below. Without this a contrast failure
    // cannot be attributed to an engine change from the log alone.
    console.log(
      `check-rendered: ${executablePath}\ncheck-rendered: ${await browser.version()}`,
    );
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

    await assertStylesheetLoaded(page, origin);
    await checkHome(page, origin);
    await checkDocsPage(page, origin);
    await checkAdrSidebarBadge(page, origin);
    await checkPrint(page, origin);
  } catch (error) {
    if (error instanceof StylesheetMissingError) {
      // Infrastructure, not a site regression — same exit code as "no browser".
      await browser?.close();
      server.stop(true);
      process.exit(2);
    }
    throw error;
  } finally {
    await browser?.close();
    server.stop(true);
  }

  if (selfTest) {
    const failed = new Set(failures.map((f) => f.check));
    const ran = new Set(checkNames);
    // Named, not counted: report the checks that went silent, which is what a
    // reader needs, rather than the ones that fired, which they do not.
    const didNotBreak = SABOTAGE_MUST_BREAK.filter((name) => ran.has(name) && !failed.has(name));
    const missing = SABOTAGE_MUST_BREAK.filter((name) => !ran.has(name));

    if (didNotBreak.length > 0 || missing.length > 0) {
      console.error('check-rendered --self-test: the checker is not detecting its own sabotage.\n');
      for (const name of didNotBreak) {
        console.error(`  ✗ ran but did NOT fail under sabotage: ${name}`);
      }
      for (const name of missing) {
        console.error(`  ✗ expected check never ran (renamed or deleted?): ${name}`);
      }
      console.error(
        '\nEither the assertion stopped working, or SABOTAGE no longer reaches it. ' +
          'Fix the check, or update SABOTAGE_MUST_BREAK if the change is intended.',
      );
      process.exit(1);
    }

    console.log(
      `check-rendered --self-test: ok — all ${SABOTAGE_MUST_BREAK.length} sabotage-reachable ` +
        `check(s) failed as expected, across ${checkNames.length} total.`,
    );
    process.exit(0);
  }

  if (failures.length > 0) {
    console.error(`check-rendered: ${failures.length} of ${checkNames.length} check(s) failed:\n`);
    for (const f of failures) console.error(`  ✗ ${f.check}\n      ${f.detail}`);
    console.error(
      '\nThese are rendered-output invariants that `astro build` cannot see. ' +
        'See site/scripts/check-rendered.ts for what each one guards.',
    );
    process.exit(1);
  }

  console.log(`check-rendered: ok — ${checkNames.length} rendered invariant(s) hold.`);
}

await run();
