// @ts-check
/**
 * The stylesheet both canvases share: `decision-review` (ADR-0046) and
 * `decision-board` (ADR-0050). Each page's `/app.css` is this block followed by
 * the page's own rules, so the two cannot drift apart on colour, spacing, type,
 * badges, buttons, or the focus ring.
 *
 * Theming is the app's. The app injects `<style>` elements that define its
 * documented tokens (which is why the CSP allows inline style; see
 * panel-http.mjs), and every colour here is an alias that reads the app token
 * first: `--c-bg: var(--background-color-default, var(--ak-bg))`. The `--ak-*`
 * fallbacks are used only when the app supplies nothing, and they follow
 * `prefers-color-scheme`, so a render outside the app is light or dark with
 * the system instead of always light.
 *
 * The fallback values live in `THEME_TOKENS`, and the CSS is generated from
 * them, so the contrast test reads the values the page actually ships.
 *
 * No rule here is built from data, and the pages set no inline style: every
 * state is a class.
 */

/**
 * Fallback colours, light and dark. Text tokens are checked for 4.5:1 against
 * `bg` and `surface` by a test, and each status hue against its own tint.
 */
export const THEME_TOKENS = {
  light: {
    bg: '#ffffff',
    surface: '#f6f8fa',
    text: '#1f2328',
    muted: '#59636e',
    border: '#d1d9e0',
    focus: '#0969da',
    green: '#116329',
    red: '#c21c2c',
    yellow: '#7d4e00',
    blue: '#0a5cc2',
    purple: '#6639ba',
  },
  dark: {
    bg: '#0d1117',
    surface: '#151b23',
    text: '#f0f6fc',
    muted: '#9198a1',
    border: '#3d444d',
    focus: '#4493f8',
    green: '#3fb950',
    red: '#ff7b72',
    yellow: '#d29922',
    blue: '#58a6ff',
    purple: '#bc8cff',
  },
};

/** The tint alpha behind a status hue, per theme. */
export const TINT_ALPHA = { light: 0.12, dark: 0.15 };

/** Which app token wins over each fallback. `purple` has none. */
const APP_TOKEN = {
  bg: '--background-color-default',
  surface: '--background-color-muted',
  text: '--text-color-default',
  muted: '--text-color-muted',
  border: '--border-color-default',
  focus: '--color-focus-outline',
  green: '--true-color-green',
  red: '--true-color-red',
  yellow: '--true-color-yellow',
  blue: '--true-color-blue',
};

const HUES = /** @type {const} */ (['green', 'red', 'yellow', 'blue', 'purple']);

/** @param {string} hex @param {number} alpha */
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** @param {'light' | 'dark'} theme */
function fallbackBlock(theme) {
  const tokens = THEME_TOKENS[theme];
  const lines = Object.entries(tokens).map(([name, value]) => `  --ak-${name}: ${value};`);
  for (const hue of HUES) lines.push(`  --ak-${hue}-tint: ${rgba(tokens[hue], TINT_ALPHA[theme])};`);
  return lines.join('\n');
}

function aliasBlock() {
  const lines = Object.keys(THEME_TOKENS.light).map((name) => {
    const app = /** @type {Record<string, string>} */ (APP_TOKEN)[name];
    return app ? `  --c-${name}: var(${app}, var(--ak-${name}));` : `  --c-${name}: var(--ak-${name});`;
  });
  for (const hue of HUES) {
    lines.push(hue === 'purple' ? `  --c-${hue}-tint: var(--ak-${hue}-tint);` : `  --c-${hue}-tint: var(--true-color-${hue}-muted, var(--ak-${hue}-tint));`);
  }
  return lines.join('\n');
}

/** Status words to the hue and glyph that sit beside their text label. */
const TONES = `
.tone-green { --tone: var(--c-green); --tone-tint: var(--c-green-tint); }
.tone-red { --tone: var(--c-red); --tone-tint: var(--c-red-tint); }
.tone-yellow { --tone: var(--c-yellow); --tone-tint: var(--c-yellow-tint); }
.tone-blue { --tone: var(--c-blue); --tone-tint: var(--c-blue-tint); }
.tone-purple { --tone: var(--c-purple); --tone-tint: var(--c-purple-tint); }
.tone-neutral { --tone: var(--c-muted); --tone-tint: transparent; }
.glyph-check::before { content: "\\2713" / ""; }
.glyph-cross::before { content: "\\2715" / ""; }
.glyph-bang::before { content: "!" / ""; }
.glyph-dot::before { content: "\\25CF" / ""; }
.glyph-ring::before { content: "\\25CB" / ""; }
.glyph-half::before { content: "\\25D0" / ""; }
.glyph-arrow::before { content: "\\21B7" / ""; }
.glyph-info::before { content: "i" / ""; font-style: italic; }
.glyph-wait::before { content: "\\2026" / ""; }
.glyph-ask::before { content: "?" / ""; }
`;

/** The shared stylesheet: tokens, base, controls, badges, cards, callouts. */
export const THEME_CSS = `:root {
  color-scheme: light dark;
${fallbackBlock('light')}
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: var(--text-body-medium, 14px); --fs-lg: 16px; --fs-xl: 18px;
  --r-sm: 4px; --r-md: 6px; --r-lg: 10px; --r-pill: 999px;
  --font-ui: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
  --font-code: var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
}
@media (prefers-color-scheme: dark) {
  :root {
${fallbackBlock('dark')}
  }
}
:root {
${aliasBlock()}
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: var(--sp-4) var(--sp-4) var(--sp-6);
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
  line-height: var(--leading-body-medium, 20px);
}
.mono, code { font-family: var(--font-code); font-size: 0.95em; }
.muted { color: var(--c-muted); }
.small { font-size: var(--fs-xs); }
h1 { font-size: var(--fs-xl); line-height: 1.3; margin: 0; font-weight: 600; }
h2 { font-size: var(--fs-lg); margin: 0; font-weight: 600; }
h3 { font-size: var(--fs-sm); margin: 0; font-weight: 600; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.04em; }
p { margin: var(--sp-1) 0; }
ul { margin: 0; padding-left: 20px; }
.plain { list-style: none; padding: 0; margin: 0; }

/* Header */
.bar { display: flex; flex-direction: column; gap: var(--sp-2); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--c-border); }
.headline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3); }
.meta { display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); color: var(--c-muted); font-size: var(--fs-sm); }
.cwd { margin: 0; color: var(--c-muted); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.buttons { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.message { margin: 0; font-size: var(--fs-sm); }
.message:empty { display: none; }
.message.warn { font-weight: 600; border: 2px solid var(--c-yellow); background: var(--c-yellow-tint); border-radius: var(--r-md); padding: var(--sp-2) var(--sp-3); }

/* Controls */
button {
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 5px var(--sp-3);
  min-height: 30px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
button:hover:not(:disabled) { border-color: var(--c-muted); }
button.primary { background: var(--c-blue); border-color: var(--c-blue); color: var(--c-bg); }
button.primary:hover:not(:disabled) { border-color: var(--c-text); }
button.secondary { background: transparent; }
button.link { background: transparent; border: none; padding: 0 2px; min-height: 0; color: var(--c-blue); text-decoration: underline; font-family: var(--font-code); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
input[type="text"], input[type="number"], input:not([type]) {
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--c-text);
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 4px var(--sp-2);
  min-height: 30px;
}
input[type="checkbox"] { accent-color: var(--c-blue); }
button:focus-visible, summary:focus-visible, input:focus-visible, [tabindex]:focus-visible, a:focus-visible {
  outline: 2px solid var(--c-focus);
  outline-offset: 2px;
}

/* Badges: a glyph and a text label, never colour alone */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--r-pill);
  padding: 1px var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  color: var(--tone, var(--c-muted));
  background: var(--tone-tint, transparent);
  border: 1px solid var(--tone, var(--c-border));
}
.badge::before { font-weight: 700; }
.badge.lg { font-size: var(--fs-sm); padding: 2px 10px; line-height: 20px; }
${TONES}
/* Layout pieces */
.section { margin-top: var(--sp-6); }
.section-head { display: flex; align-items: baseline; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.count { font-size: var(--fs-xs); font-weight: 600; color: var(--c-muted); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-pill); padding: 0 var(--sp-2); }
.lede { color: var(--c-muted); font-size: var(--fs-sm); margin: 0 0 var(--sp-2); }
.card { background: var(--c-bg); border: 1px solid var(--c-border); border-radius: var(--r-lg); padding: var(--sp-3); }
.cards { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.card-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1) var(--sp-2); }
.record-id { font-family: var(--font-code); font-size: var(--fs-sm); font-weight: 600; color: var(--c-muted); }
.record-title { font-weight: 600; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-2); }
.chip { display: inline-flex; gap: 6px; align-items: baseline; max-width: 100%; font-size: var(--fs-xs); border: 1px solid var(--c-border); background: var(--c-surface); border-radius: var(--r-md); padding: 2px var(--sp-2); overflow-wrap: anywhere; }
.chip-kind { font-weight: 600; color: var(--c-muted); white-space: nowrap; }
.callout { border-radius: var(--r-lg); padding: var(--sp-3); margin: var(--sp-3) 0 0; border: 1px solid var(--tone, var(--c-border)); background: var(--tone-tint, var(--c-surface)); }
.callout-title { font-weight: 600; color: var(--tone, var(--c-text)); display: flex; gap: 6px; align-items: center; }
.callout p, .callout li { color: var(--c-text); }
.empty { text-align: center; padding: var(--sp-6) var(--sp-4); border: 1px dashed var(--c-border); border-radius: var(--r-lg); color: var(--c-muted); }
.empty strong { display: block; color: var(--c-text); font-size: var(--fs-lg); margin-bottom: var(--sp-1); }
details > summary { cursor: pointer; color: var(--c-muted); font-size: var(--fs-sm); }
details[open] > summary { margin-bottom: var(--sp-2); }
footer { margin-top: var(--sp-6); padding-top: var(--sp-3); border-top: 1px solid var(--c-border); font-size: var(--fs-xs); color: var(--c-muted); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;
