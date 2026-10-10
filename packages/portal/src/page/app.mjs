/**
 * The decision portal's page module (ADR-0054 clauses 4 to 9).
 *
 * It reads `./portal-data.json` (the contract in `../data/contract.ts`) and draws five
 * read-only views behind hash routes, so the bundle works at any mount point (clause 8):
 *
 * - `#/`           status counts and the record list
 * - `#/adr/<id>`   one record, its relationships, and its body tokens
 * - `#/graph`      the supersession graph, laid out by the board's own `layoutBoard`
 * - `#/queue`      the review queue's raw facts, never a verdict (clause 5)
 * - `#/paths`      governance by path, a lookup in the precomputed table (clause 6)
 *
 * Every title, body, path, tag, message, and routing target is untrusted repository text.
 * The DOM is built with `createElement`, `createElementNS`, and `createTextNode`; text goes in
 * through `textContent` only, and no string is ever parsed as markup. Repository strings
 * never pick a class or a property: statuses, kinds, and SLA states are looked up in fixed
 * tables through `own`, and an unknown value gets the neutral class. Links are rebuilt here
 * from validated parts rather than trusted from the data file.
 *
 * SVG classes go through `setAttribute('class', …)`, because an SVG element's `className`
 * is an `SVGAnimatedString` that ignores a plain assignment. A dimmed graph record dims its
 * box, never its label. A pointer drag pans and never also opens the record it ended on.
 *
 * The page has no form, sends nothing, and has no control that changes anything (clause 4).
 * It touches the browser only through the `env` given to `startPortal`, so the tests drive
 * it with a fake document.
 */

import { layoutBoard, MAX_EXTENT, NODE_HEIGHT, NODE_LIMIT, NODE_WIDTH } from '../vendor/board-layout.mjs';
import { clampView, fitView, initialView, panView, resizeView, viewBoxOf, zoomView } from '../vendor/board-view.mjs';

/** The data file, relative to the document (fetch resolves against the page, not this module). */
export const DATA_URL = './portal-data.json';
/** The one contract version this page renders. */
export const SUPPORTED_VERSION = '1';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TITLE_CHARS = 28;

const STATUSES = ['accepted', 'proposed', 'draft', 'rejected', 'superseded', 'deprecated'];
const STATUS_TONE = { accepted: 'green', proposed: 'blue', draft: 'neutral', rejected: 'red', superseded: 'purple', deprecated: 'yellow' };
const STATUS_GLYPH = { accepted: 'check', proposed: 'half', draft: 'ring', rejected: 'cross', superseded: 'arrow', deprecated: 'bang' };
const STANDING_TEXT = { governing: 'governing', activeProposals: 'active proposal', history: 'history' };
const KINDS = ['supersedes', 'relatesTo', 'conflictsWith'];
/** The kinds the graph draws when it opens. */
export const DEFAULT_KINDS = Object.freeze(['supersedes']);
const KIND_TEXT = { supersedes: 'supersedes', relatesTo: 'relates to', conflictsWith: 'conflicts with' };
const KIND_LOOK = { supersedes: 'solid, arrow to the replaced record', relatesTo: 'dashed', conflictsWith: 'dotted' };
const SLA_TONE = { overdue: 'red', escalated: 'red', due: 'yellow', 'within-sla': 'green', 'missing-sla': 'neutral', 'not-queued': 'neutral', decided: 'neutral' };
const SLA_GLYPH = { overdue: 'bang', escalated: 'bang', due: 'wait', 'within-sla': 'check', 'missing-sla': 'ask', 'not-queued': 'ring', decided: 'dot' };
const SLA_TEXT = { overdue: 'overdue', escalated: 'escalated', due: 'due', 'within-sla': 'within SLA', 'missing-sla': 'no SLA set', 'not-queued': 'not queued', decided: 'decided' };
const TIER_TEXT = { auto: 'auto', async: 'async', arb: 'ARB' };
const ALIGN_CLASS = { left: 'align-left', center: 'align-center', right: 'align-right' };
const EVIDENCE_TEXT = { affects: 'affects matcher', marker: '@adr marker' };
const SEVERITY_TEXT = { error: 'error', warn: 'warning', info: 'info' };
/** A record id as a route segment: letters, digits, `.`, `_`, `-`, at most 64. */
const ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

/**
 * What the path view says in each table state (contract.ts, `PortalPathTable`). Each is a
 * contract obligation, and none of them calls a path free of decisions.
 */
export const PATH_TEXT = {
  missAtCommit: (commit) =>
    'No tracked file by this path at commit ' + shortCommit(commit) + ' is reached by any decision.',
  missInIndex: 'No tracked file by this path in the index is reached by any decision. This repository had no commits when the portal was built.',
  missCapped:
    'Not in this table. The table is capped, so a governed path can be missing from it; run adr explain on the path for the full answer.',
  unavailable:
    'Resolution was withheld because the corpus has errors. The errors are listed above; fix them and rebuild the portal to look paths up.',
  absent:
    'This host has no path table, so it cannot say which decisions reach a path. Build the portal from a git work tree to get one, or run adr explain on the path.',
};

/* ------------------------------------------------------------------ *
 * Small pure helpers (exported for the tests)
 * ------------------------------------------------------------------ */

function list(value) {
  return Array.isArray(value) ? value : [];
}
function text(value) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}
/** A fixed table's own entry for a repository string, or undefined; never an inherited one. */
function own(table, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}
function plural(n, noun, many) {
  return text(n) + ' ' + (n === 1 ? noun : many || noun + 's');
}
export function shortCommit(commit) {
  return typeof commit === 'string' && /^[0-9a-f]{40,64}$/.test(commit) ? commit.slice(0, 12) : 'unknown';
}

/**
 * Clip to at most `size` characters without cutting one in half: by grapheme where the
 * runtime can segment, else by code point, so an emoji or a combining mark never splits.
 */
export function clipText(value, size) {
  const s = text(value);
  let parts;
  if (typeof Intl === 'object' && Intl && typeof Intl.Segmenter === 'function') {
    parts = [];
    for (const piece of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) parts.push(piece.segment);
  } else {
    parts = Array.from(s);
  }
  return parts.length > size ? parts.slice(0, Math.max(1, size - 1)).join('') + '…' : s;
}

/** The route a hash names. Unknown hashes are their own view, never a guess. */
export function parseRoute(hash) {
  const h = text(hash);
  if (h === '' || h === '#' || h === '#/') return { view: 'overview' };
  if (h === '#/graph') return { view: 'graph' };
  if (h === '#/queue') return { view: 'queue' };
  if (h === '#/paths') return { view: 'paths' };
  const match = /^#\/adr\/([^/?#]+)$/.exec(h);
  if (match) {
    let id = null;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      id = null;
    }
    if (id !== null && ID_PATTERN.test(id)) return { view: 'record', id };
  }
  return { view: 'missing' };
}

/** The hash route of a record, or null when the id is not a routable id. */
export function recordHref(id) {
  return typeof id === 'string' && ID_PATTERN.test(id) ? '#/adr/' + encodeURIComponent(id) : null;
}

/** An external link target this page will follow: absolute `http:` or `https:` only. */
export function safeExternalHref(href) {
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Trim a typed path for lookup: surrounding whitespace and a leading `./` only. A backslash is
 * a literal character in a repository path (core treats `src/we\ird.ts` and `src/we/ird.ts`
 * as two paths), so it is never rewritten.
 */
export function normalizeLookup(value) {
  let path = text(value).trim();
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

/**
 * Look a path up in the table. Returns `{ kind, entry?, message? }` where `kind` is `hit`,
 * `miss`, `unavailable`, `absent`, or `empty` (nothing typed); `message` is the contract
 * wording for every kind but `hit` and `empty`.
 */
export function lookupPath(table, commit, value) {
  const state = table && table.state;
  if (state === 'unavailable') return { kind: 'unavailable', message: PATH_TEXT.unavailable };
  if (state !== 'available') return { kind: 'absent', message: PATH_TEXT.absent };
  const path = normalizeLookup(value);
  if (path === '') return { kind: 'empty' };
  const entry = list(table.entries).find((candidate) => candidate && candidate.path === path);
  if (entry) return { kind: 'hit', entry };
  if (table.capped === true) return { kind: 'miss', message: PATH_TEXT.missCapped };
  return { kind: 'miss', message: commit ? PATH_TEXT.missAtCommit(commit) : PATH_TEXT.missInIndex };
}

/** Error-severity issues, in data order. */
export function errorIssues(data) {
  return list(data && data.issues).filter((issue) => issue && issue.severity === 'error');
}

/** Counts by status, in the fixed status order, including zeros. */
export function statusCounts(records) {
  const counts = STATUSES.map((status) => ({ status, count: 0 }));
  let other = 0;
  for (const record of list(records)) {
    const row = counts.find((candidate) => candidate.status === record.status);
    if (row) row.count += 1;
    else other += 1;
  }
  return other > 0 ? counts.concat([{ status: 'unknown', count: other }]) : counts;
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * Start the portal. `env` carries `document`, `window`, and `fetch`; nothing else of the
 * browser is reached. Returns a promise that settles after the first render, with a handle
 * the tests use to re-render a route.
 */
export function startPortal(env) {
  const doc = env.document;
  const win = env.window;
  let data = null;
  /**
   * The graph's kinds filter. It opens on supersession alone, as the SDK's graph does and as
   * clause 4 names the view; relatesTo and conflictsWith are opt-in, because on a real corpus
   * all three kinds together draw an unreadable tangle.
   */
  const shownKinds = new Set(DEFAULT_KINDS);
  /** The path last typed in the path view, kept across route changes. */
  let typedPath = '';
  /** Graph view state. */
  let view = null;
  let drawn = null;
  let viewport = { width: 0, height: 0 };
  let drag = null;
  let dragged = false;
  let nodeElements = [];
  /** Redraws the current graph's lines for the kinds filter, or null when no graph is drawn. */
  let redrawEdges = null;

  const $ = (id) => doc.getElementById(id);

  /** Every HTML node is built here; text only ever goes through textContent. */
  function el(tag, className, content) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }
  /** Every SVG node is built here. Classes go through setAttribute, never className. */
  function svg(tag, attrs, content) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const name of Object.keys(attrs || {})) node.setAttribute(name, text(attrs[name]));
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }
  function textNode(value) {
    return doc.createTextNode(text(value));
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function link(label, href, className) {
    const node = el('a', className, label);
    node.setAttribute('href', href);
    return node;
  }
  /** A record id as a link to its route, or plain text when the id is not routable. */
  function recordLink(id, label) {
    const href = recordHref(id);
    return href ? link(label === undefined ? id : label, href, 'record-link mono') : el('span', 'mono', label === undefined ? id : label);
  }
  function statusClass(status) {
    return 'status-' + (own(STATUS_TONE, status) ? status : 'unknown');
  }
  function badge(label, tone, glyph, extra) {
    return el('span', 'badge tone-' + (tone || 'neutral') + ' glyph-' + (glyph || 'ask') + (extra ? ' ' + extra : ''), label);
  }
  function statusBadge(status) {
    return badge(text(status) || 'unknown', own(STATUS_TONE, status), own(STATUS_GLYPH, status));
  }
  function facts(rows) {
    const dl = el('dl', 'facts');
    for (const [label, value] of rows) {
      dl.appendChild(el('dt', null, label));
      const dd = el('dd');
      if (value && typeof value === 'object' && 'appendChild' in value) dd.appendChild(value);
      else dd.textContent = text(value);
      dl.appendChild(dd);
    }
    return dl;
  }
  function callout(tone, glyph, title, lines) {
    const box = el('div', 'callout tone-' + tone);
    box.appendChild(el('p', 'callout-title glyph-' + glyph, title));
    for (const line of lines || []) box.appendChild(typeof line === 'string' ? el('p', null, line) : line);
    return box;
  }
  function heading(level, label) {
    const node = el(level, 'view-title', label);
    node.setAttribute('tabindex', '-1');
    return node;
  }

  /** The newest record per id, as the SDK's `get` resolves a repeated id. */
  function recordsById() {
    const map = new Map();
    for (const record of list(data.records)) map.set(record.id, record);
    return map;
  }

  /* ---------------------------- chrome ---------------------------- */

  function renderChrome() {
    const corpus = $('corpus');
    if (corpus) corpus.textContent = text(data.dir) + ' · ' + plural(list(data.records).length, 'record');
    const banner = $('banner');
    if (banner) {
      clear(banner);
      const errors = errorIssues(data);
      if (errors.length > 0) {
        const box = callout('red', 'cross', 'The corpus has ' + plural(errors.length, 'error') + '.', [
          'Every record that loaded is shown, and the data file carries every error. Governance by path is withheld until the errors are fixed.',
        ]);
        box.setAttribute('role', 'alert');
        box.appendChild(issueList(errors));
        banner.appendChild(box);
      }
    }
    const footer = $('footer');
    if (footer) {
      clear(footer);
      footer.appendChild(
        el(
          'p',
          null,
          'Read-only decision portal, built from ' + text(data.dir) + ' at commit ' + shortCommit(data.commit) +
            '; queue SLA states as of ' + text(data.asOf) + '. It has no form and changes nothing.',
        ),
      );
    }
  }

  function issueList(issues) {
    const ul = el('ul', 'issues');
    for (const issue of issues) {
      const li = el('li', 'issue');
      li.appendChild(el('span', 'chip-kind', own(SEVERITY_TEXT, issue.severity) || 'issue'));
      li.appendChild(el('code', null, issue.code));
      if (issue.path !== null && issue.path !== undefined) li.appendChild(el('span', 'mono issue-path', issue.path));
      li.appendChild(el('span', 'issue-message', issue.message));
      ul.appendChild(li);
    }
    return ul;
  }

  function markNav(route) {
    for (const [id, viewName] of [['nav-overview', 'overview'], ['nav-graph', 'graph'], ['nav-queue', 'queue'], ['nav-paths', 'paths']]) {
      const node = $(id);
      if (!node) continue;
      if (route.view === viewName) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    }
  }

  /* --------------------------- overview --------------------------- */

  function renderOverview(main) {
    main.appendChild(heading('h2', 'Records'));
    const counts = el('ul', 'status-counts plain');
    counts.setAttribute('aria-label', 'Records by status');
    for (const row of statusCounts(data.records)) {
      const li = el('li', 'status-count');
      const shown = statusBadge(row.status);
      shown.textContent = row.status + ': ' + row.count;
      li.appendChild(shown);
      counts.appendChild(li);
    }
    main.appendChild(counts);

    const others = list(data.issues).filter((issue) => issue && issue.severity !== 'error');
    if (others.length > 0) {
      const details = el('details', 'notes');
      details.appendChild(el('summary', null, 'Warnings and notes (' + others.length + ')'));
      details.appendChild(issueList(others));
      main.appendChild(details);
    }

    const filterRow = el('div', 'filter-row');
    const label = el('label', 'filter-label', 'Filter ');
    const input = el('input', 'filter-input');
    input.setAttribute('type', 'search');
    input.setAttribute('aria-label', 'Filter records by id, title, status, or tag');
    input.setAttribute('placeholder', 'id, title, status, or tag');
    label.appendChild(input);
    filterRow.appendChild(label);
    const shownCount = el('span', 'muted small');
    filterRow.appendChild(shownCount);
    main.appendChild(filterRow);

    const cards = el('ul', 'cards record-list');
    main.appendChild(cards);
    const all = list(data.records);
    const draw = () => {
      clear(cards);
      const needle = text(input.value).trim().toLowerCase();
      const matching = all.filter((record) => {
        if (needle === '') return true;
        const hay = [record.id, record.title, record.status].concat(list(record.tags)).map((part) => text(part).toLowerCase());
        return hay.some((part) => part.includes(needle));
      });
      shownCount.textContent = matching.length === all.length ? plural(all.length, 'record') : matching.length + ' of ' + plural(all.length, 'record');
      if (all.length === 0) {
        const empty = el('li', 'empty');
        empty.appendChild(el('strong', null, 'No records'));
        empty.appendChild(el('span', null, 'The corpus directory holds no record that loaded.'));
        cards.appendChild(empty);
        return;
      }
      for (const record of matching) cards.appendChild(recordCard(record));
    };
    input.addEventListener('input', draw);
    draw();
  }

  function recordCard(record) {
    const li = el('li', 'card record-card');
    const head = el('div', 'card-head');
    head.appendChild(recordLink(record.id));
    head.appendChild(statusBadge(record.status));
    head.appendChild(el('span', 'muted small', record.date));
    li.appendChild(head);
    const href = recordHref(record.id);
    li.appendChild(href ? link(record.title, href, 'record-title') : el('span', 'record-title', record.title));
    if (list(record.tags).length > 0) {
      const chips = el('div', 'chips');
      for (const tag of list(record.tags)) chips.appendChild(el('span', 'chip', tag));
      li.appendChild(chips);
    }
    return li;
  }

  /* ---------------------------- record ---------------------------- */

  function renderRecord(main, id) {
    const record = recordsById().get(id);
    if (!record) {
      main.appendChild(heading('h2', 'Record not found'));
      main.appendChild(el('p', null, 'This bundle has no record with id ' + id + '.'));
      main.appendChild(link('Back to the records', '#/'));
      return;
    }
    const head = el('div', 'record-head');
    head.appendChild(el('span', 'record-id', record.id));
    head.appendChild(statusBadge(record.status));
    head.appendChild(badge(own(STANDING_TEXT, record.standing) || 'unknown standing', 'neutral', 'info'));
    main.appendChild(head);
    main.appendChild(heading('h2', record.title));

    const rows = [
      ['Date', record.date],
      ['File', el('span', 'mono', record.path)],
    ];
    if (list(record.tags).length > 0) {
      const chips = el('span', 'chips inline');
      for (const tag of list(record.tags)) chips.appendChild(el('span', 'chip', tag));
      rows.push(['Tags', chips]);
    }
    if (list(record.supersedes).length > 0) rows.push(['Supersedes', idList(record.supersedes)]);
    if (record.supersededBy !== null && record.supersededBy !== undefined) rows.push(['Superseded by', recordLink(record.supersededBy)]);
    const edges = list(data.graph && data.graph.edges);
    for (const kind of ['relatesTo', 'conflictsWith']) {
      const outgoing = edges.filter((edge) => edge.kind === kind && edge.from === record.id).map((edge) => edge.to);
      const incoming = edges.filter((edge) => edge.kind === kind && edge.to === record.id).map((edge) => edge.from);
      if (outgoing.length > 0) rows.push([kind === 'relatesTo' ? 'Relates to' : 'Conflicts with', idList(outgoing)]);
      if (incoming.length > 0) rows.push([kind === 'relatesTo' ? 'Related from' : 'In conflict from', idList(incoming)]);
    }
    main.appendChild(facts(rows));

    const article = el('article', 'record-body');
    renderBody(article, list(record.body));
    main.appendChild(article);
  }

  function idList(ids) {
    const span = el('span', 'id-list');
    list(ids).forEach((id, index) => {
      if (index > 0) span.appendChild(textNode(', '));
      span.appendChild(recordLink(id));
    });
    return span;
  }

  /* ---------------------------- body ------------------------------ */

  function renderBody(container, blocks) {
    const slugs = new Map();
    for (const block of blocks) container.appendChild(renderBlock(block, slugs));
  }

  function renderBlock(block, slugs) {
    const type = block && block.type;
    if (type === 'heading') {
      const level = Number.isInteger(block.level) && block.level >= 1 && block.level <= 6 ? block.level : 6;
      // The record title is the page's heading, so body headings sit one level below it.
      const node = el('h' + Math.min(6, level + 2), 'md-h md-h' + level);
      appendInlines(node, list(block.children), slugs);
      if (typeof block.slug === 'string' && block.slug !== '' && !slugs.has(block.slug)) slugs.set(block.slug, node);
      return node;
    }
    if (type === 'paragraph') {
      const node = el('p');
      appendInlines(node, list(block.children), slugs);
      return node;
    }
    if (type === 'list') {
      const node = el(block.ordered === true ? 'ol' : 'ul', 'md-list');
      if (block.ordered === true && Number.isSafeInteger(block.start) && block.start >= 0 && block.start !== 1) {
        node.setAttribute('start', String(block.start));
      }
      for (const item of list(block.items)) {
        const li = el('li');
        for (const child of list(item)) li.appendChild(renderBlock(child, slugs));
        node.appendChild(li);
      }
      return node;
    }
    if (type === 'code') {
      const figure = el('div', 'md-code');
      if (typeof block.lang === 'string' && block.lang !== '') figure.appendChild(el('span', 'md-code-lang', block.lang));
      const pre = el('pre');
      pre.appendChild(el('code', null, block.text));
      figure.appendChild(pre);
      return figure;
    }
    if (type === 'table') {
      const wrap = el('div', 'md-table-wrap');
      const table = el('table', 'md-table');
      const align = list(block.align);
      const row = (cells, tag) => {
        const tr = el('tr');
        list(cells).forEach((cell, index) => {
          const td = el(tag, own(ALIGN_CLASS, align[index]) || null);
          appendInlines(td, list(cell), slugs);
          tr.appendChild(td);
        });
        return tr;
      };
      const thead = el('thead');
      thead.appendChild(row(block.header, 'th'));
      table.appendChild(thead);
      const tbody = el('tbody');
      for (const cells of list(block.rows)) tbody.appendChild(row(cells, 'td'));
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    if (type === 'blockquote') {
      const node = el('blockquote', 'md-quote');
      for (const child of list(block.children)) node.appendChild(renderBlock(child, slugs));
      return node;
    }
    // The tree is closed (contract.ts); anything else is shown as nothing but its text.
    return el('p', 'md-unknown', block && typeof block.text === 'string' ? block.text : '');
  }

  function appendInlines(parent, inlines, slugs) {
    for (const inline of inlines) parent.appendChild(renderInline(inline, slugs));
  }

  function renderInline(inline, slugs) {
    const type = inline && inline.type;
    if (type === 'text') return textNode(inline.text);
    if (type === 'inlineCode') return el('code', null, inline.text);
    if (type === 'emphasis' || type === 'strong') {
      const node = el(type === 'strong' ? 'strong' : 'em');
      appendInlines(node, list(inline.children), slugs);
      return node;
    }
    if (type === 'link') {
      const children = list(inline.children);
      if (inline.kind === 'external') {
        const href = safeExternalHref(inline.href);
        if (href) {
          const node = el('a', 'md-link external');
          node.setAttribute('href', href);
          node.setAttribute('rel', 'noopener noreferrer nofollow');
          appendInlines(node, children, slugs);
          return node;
        }
      } else if (inline.kind === 'record') {
        const href = recordHref(inline.id);
        if (href) {
          const node = el('a', 'md-link record-link');
          node.setAttribute('href', href);
          appendInlines(node, children, slugs);
          return node;
        }
      } else if (inline.kind === 'fragment' && typeof inline.fragment === 'string') {
        // A hash route owns the URL fragment, so a same-record link scrolls instead.
        const fragment = inline.fragment;
        const node = el('a', 'md-link fragment');
        node.setAttribute('role', 'link');
        node.setAttribute('tabindex', '0');
        const go = (event) => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          const target = slugs.get(fragment);
          if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
        };
        node.addEventListener('click', go);
        node.addEventListener('keydown', (event) => {
          if (event && event.key === 'Enter') go(event);
        });
        appendInlines(node, children, slugs);
        return node;
      }
      // A link that fails its check is shown as its words, never as a link.
      const span = el('span', 'md-link-text');
      appendInlines(span, children, slugs);
      return span;
    }
    return textNode(inline && typeof inline.text === 'string' ? inline.text : '');
  }

  /* ---------------------------- graph ----------------------------- */

  function renderGraph(main) {
    main.appendChild(heading('h2', 'Decision graph'));
    const graph = data.graph || { nodes: [], edges: [] };
    const nodes = list(graph.nodes);
    const edges = list(graph.edges);

    const filters = el('fieldset', 'filters');
    filters.appendChild(el('legend', null, 'Relationship kinds'));
    for (const kind of KINDS) {
      const label = el('label', 'toggle');
      const box = el('input');
      box.setAttribute('type', 'checkbox');
      box.checked = shownKinds.has(kind);
      box.addEventListener('change', () => {
        if (box.checked) shownKinds.add(kind);
        else shownKinds.delete(kind);
        // Only the lines change: the frame, the checkboxes (and so focus), and the view stay.
        if (redrawEdges) redrawEdges();
      });
      label.appendChild(box);
      label.appendChild(textNode(' ' + own(KIND_TEXT, kind)));
      filters.appendChild(label);
    }
    main.appendChild(filters);
    main.appendChild(legend());

    // Positions come from every edge, so unticking a kind hides lines without moving boxes.
    const layout = layoutBoard({ nodes, edges });
    if (layout.mode === 'summary') {
      const box = el('div', 'summary');
      const why =
        layout.reason === 'nodes'
          ? 'more than the ' + NODE_LIMIT + ' records the graph draws legibly'
          : 'a drawing wider or taller than ' + MAX_EXTENT + ' px';
      box.appendChild(
        el('p', 'summary-lede', plural(layout.totalNodes, 'record') + ' and ' + plural(layout.totalEdges, 'relationship') + ': ' + why + ', so the graph shows counts instead.'),
      );
      const counts = el('ul', 'status-counts plain');
      for (const row of list(layout.byStatus)) {
        const li = el('li', 'status-count');
        const shown = statusBadge(row.status);
        shown.textContent = text(row.status) + ': ' + text(row.count);
        li.appendChild(shown);
        counts.appendChild(li);
      }
      box.appendChild(counts);
      box.appendChild(link('Browse the records instead', '#/'));
      main.appendChild(box);
      drawn = null;
      return;
    }
    if (nodes.length === 0) {
      const empty = el('div', 'empty');
      empty.appendChild(el('strong', null, 'No records to draw'));
      empty.appendChild(el('span', null, 'The corpus holds no record that loaded.'));
      main.appendChild(empty);
      drawn = null;
      return;
    }

    const byId = new Map();
    for (const node of nodes) byId.set(node.id, node);
    const at = new Map();
    for (const position of layout.positions) at.set(position.id, position);

    main.appendChild(zoomBar());
    const wanted = layout.height * 0.75 + 32;
    const frame = el('div', 'graph-frame ' + (wanted <= 240 ? 'h-s' : wanted <= 360 ? 'h-m' : wanted <= 480 ? 'h-l' : 'h-xl'));
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', 'Decision graph: ' + plural(nodes.length, 'record') + '. Use + and − to zoom, 0 to fit, arrows to pan.');
    frame.addEventListener('keydown', graphKeys);
    const root = svg('svg', {
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
      viewBox: '0 0 ' + layout.width + ' ' + layout.height,
      role: 'group',
      'aria-label': 'Decision graph: ' + plural(nodes.length, 'record'),
      class: 'graph-svg',
    });
    const defs = svg('defs');
    const marker = svg('marker', { id: 'arrow-supersedes', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow' }));
    defs.appendChild(marker);
    root.appendChild(defs);

    // Edges are painted first, beneath the records, and every box has an opaque base, so a
    // line passing behind a record never crosses its id or title.
    const edgeGroup = svg('g', { class: 'edges' });
    const drawEdges = () => {
      clear(edgeGroup);
      for (const edge of edges) {
        if (!own(KIND_TEXT, edge.kind) || !shownKinds.has(edge.kind)) continue;
        const from = at.get(edge.from);
        const to = at.get(edge.to);
        if (!from || !to) continue;
        const start = edgePoint(from, to);
        const end = edgePoint(to, from);
        const attrs = { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'edge edge-' + edge.kind };
        if (edge.kind === 'supersedes') attrs['marker-end'] = 'url(#arrow-supersedes)';
        const line = svg('line', attrs);
        line.appendChild(svg('title', {}, text(edge.from) + ' ' + own(KIND_TEXT, edge.kind) + ' ' + text(edge.to)));
        edgeGroup.appendChild(line);
      }
      if (drawn) drawn.edges = edges.filter((edge) => shownKinds.has(edge.kind));
    };
    drawEdges();
    root.appendChild(edgeGroup);

    const nodeGroup = svg('g', { class: 'nodes' });
    nodeElements = [];
    for (const position of layout.positions) {
      const node = byId.get(position.id);
      if (!node) continue;
      const id = text(node.id);
      const status = text(node.status);
      const g = svg('g', {
        class: 'node ' + statusClass(status),
        transform: 'translate(' + position.x + ' ' + position.y + ')',
        tabindex: 0,
        role: 'link',
        'aria-label': id + ', ' + status + ': ' + text(node.title),
      });
      g.appendChild(svg('title', {}, id + ' (' + status + '): ' + text(node.title)));
      g.appendChild(svg('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 8, class: 'node-base' }));
      g.appendChild(svg('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 8, class: 'node-box ' + statusClass(status) }));
      g.appendChild(svg('rect', { width: 5, height: NODE_HEIGHT - 12, x: 0, y: 6, rx: 2, class: 'node-stripe ' + statusClass(status) }));
      g.appendChild(svg('text', { x: 14, y: 22, class: 'node-id' }, id + ' · ' + status));
      g.appendChild(svg('text', { x: 14, y: 41, class: 'node-title' }, clipText(node.title, TITLE_CHARS)));
      const open = () => {
        const href = recordHref(id);
        if (href) win.location.hash = href;
      };
      g.addEventListener('click', () => {
        if (dragged) {
          dragged = false;
          return;
        }
        open();
      });
      g.addEventListener('keydown', (event) => {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          open();
        }
      });
      g.addEventListener('focus', () => highlight(id));
      g.addEventListener('mouseenter', () => highlight(id));
      g.addEventListener('blur', () => highlight(null));
      g.addEventListener('mouseleave', () => highlight(null));
      nodeElements.push({ id, status, g });
      nodeGroup.appendChild(g);
    }
    root.appendChild(nodeGroup);
    frame.appendChild(root);
    main.appendChild(frame);
    wirePointer(root);

    drawn = { root, width: layout.width, height: layout.height, edges: edges.filter((edge) => shownKinds.has(edge.kind)) };
    redrawEdges = drawEdges;
    const size = measure(frame, layout);
    view = initialView(drawn.width, drawn.height, size.width, size.height);
    viewport = size;
    applyView();
  }

  /** Mark the record under the pointer or focus and its neighbors; dim the other boxes, never their labels. */
  function highlight(id) {
    const near = new Set();
    if (id !== null && drawn) {
      near.add(id);
      for (const edge of drawn.edges) {
        if (edge.from === id) near.add(edge.to);
        if (edge.to === id) near.add(edge.from);
      }
    }
    for (const item of nodeElements) {
      const extra = id === null ? '' : item.id === id ? ' selected' : near.has(item.id) ? ' neighbor' : ' dim';
      item.g.setAttribute('class', 'node ' + statusClass(item.status) + extra);
    }
  }

  function edgePoint(from, to) {
    const cx = from.x + NODE_WIDTH / 2;
    const cy = from.y + NODE_HEIGHT / 2;
    const dx = to.x + NODE_WIDTH / 2 - cx;
    const dy = to.y + NODE_HEIGHT / 2 - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx === 0 ? Infinity : NODE_WIDTH / 2 / Math.abs(dx);
    const sy = dy === 0 ? Infinity : NODE_HEIGHT / 2 / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function legend() {
    const box = el('div', 'legend');
    const statusGroup = el('ul', 'legend-list plain');
    statusGroup.setAttribute('aria-label', 'Status');
    for (const status of STATUSES) {
      const li = el('li', 'legend-item');
      const swatch = svg('svg', { width: 18, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      swatch.appendChild(svg('rect', { x: 1, y: 1, width: 16, height: 10, rx: 3, class: 'node-box ' + statusClass(status) }));
      li.appendChild(swatch);
      li.appendChild(el('span', null, status));
      statusGroup.appendChild(li);
    }
    box.appendChild(statusGroup);
    const kindGroup = el('ul', 'legend-list plain');
    kindGroup.setAttribute('aria-label', 'Relationship');
    for (const kind of KINDS) {
      const li = el('li', 'legend-item');
      const sample = svg('svg', { width: 30, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      sample.appendChild(svg('line', { x1: 1, y1: 6, x2: kind === 'supersedes' ? 24 : 29, y2: 6, class: 'edge edge-' + kind }));
      if (kind === 'supersedes') sample.appendChild(svg('path', { d: 'M 23 2 L 29 6 L 23 10 z', class: 'arrow' }));
      li.appendChild(sample);
      li.appendChild(el('span', null, own(KIND_TEXT, kind) + ' (' + own(KIND_LOOK, kind) + ')'));
      kindGroup.appendChild(li);
    }
    box.appendChild(kindGroup);
    return box;
  }

  function measure(frame, layout) {
    const rect = frame && typeof frame.getBoundingClientRect === 'function' ? frame.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
    return { width: layout.width || NODE_WIDTH, height: Math.min(layout.height || NODE_HEIGHT, 560) };
  }

  function applyView() {
    if (drawn && view) drawn.root.setAttribute('viewBox', viewBoxOf(view));
  }

  function zoomBy(factor, fx, fy) {
    if (!drawn || !view) return;
    const floor = viewport.width / fitView(drawn.width, drawn.height, viewport.width, viewport.height).w;
    view = clampView(zoomView(view, factor, fx, fy, viewport.width, floor), drawn.width, drawn.height);
    applyView();
  }

  function panBy(dx, dy) {
    if (!drawn || !view) return;
    view = clampView(panView(view, dx, dy, viewport.width), drawn.width, drawn.height);
    applyView();
  }

  function resetView() {
    if (!drawn) return;
    view = fitView(drawn.width, drawn.height, viewport.width, viewport.height);
    applyView();
  }

  function graphKeys(event) {
    if (!event) return;
    const tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'button' || tag === 'textarea') return;
    const step = 60;
    let handled = true;
    if (event.key === '+' || event.key === '=') zoomBy(1.25, 0.5, 0.5);
    else if (event.key === '-' || event.key === '_') zoomBy(0.8, 0.5, 0.5);
    else if (event.key === '0') resetView();
    else if (event.key === 'ArrowLeft') panBy(step, 0);
    else if (event.key === 'ArrowRight') panBy(-step, 0);
    else if (event.key === 'ArrowUp') panBy(0, step);
    else if (event.key === 'ArrowDown') panBy(0, -step);
    else handled = false;
    if (handled && typeof event.preventDefault === 'function') event.preventDefault();
  }

  /** Pointer drag pans; a drag never also opens the record it ended on. */
  function wirePointer(root) {
    root.addEventListener('pointerdown', (event) => {
      if (!event || (event.button !== undefined && event.button !== 0)) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      dragged = false;
    });
    root.addEventListener('pointermove', (event) => {
      if (!drag || !event) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!dragged && typeof root.setPointerCapture === 'function') {
        try {
          root.setPointerCapture(drag.id);
        } catch {
          // Not capturable; the drag still pans.
        }
      }
      dragged = true;
      root.setAttribute('class', 'graph-svg dragging');
      drag.x = event.clientX;
      drag.y = event.clientY;
      panBy(dx, dy);
    });
    const end = () => {
      drag = null;
      root.setAttribute('class', 'graph-svg');
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // Only Ctrl or Cmd with the wheel (a trackpad pinch) zooms; a plain wheel scrolls the page.
    root.addEventListener(
      'wheel',
      (event) => {
        if (!event || !(event.ctrlKey || event.metaKey)) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
        const fx = rect && rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
        const fy = rect && rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
        zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, fx, fy);
      },
      { passive: false },
    );
  }

  function zoomBar() {
    const bar = el('div', 'zoom-bar');
    const make = (label, aria, action) => {
      const node = el('button', 'secondary', label);
      node.setAttribute('type', 'button');
      node.setAttribute('aria-label', aria);
      node.addEventListener('click', action);
      return node;
    };
    bar.appendChild(make('−', 'Zoom out', () => zoomBy(0.8, 0.5, 0.5)));
    bar.appendChild(make('+', 'Zoom in', () => zoomBy(1.25, 0.5, 0.5)));
    bar.appendChild(make('Fit', 'Fit the whole graph', () => resetView()));
    bar.appendChild(el('span', 'hint', 'Drag to pan · Ctrl or Cmd + wheel to zoom · keys + − 0 and arrows · select a record to open it'));
    return bar;
  }

  function onResize() {
    if (!drawn || !view) return;
    const frame = drawn.root;
    const rect = typeof frame.getBoundingClientRect === 'function' ? frame.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;
    if (rect.width === viewport.width && rect.height === viewport.height) return;
    view = resizeView(view, rect.width, rect.height, viewport.width);
    viewport = { width: rect.width, height: rect.height };
    applyView();
  }

  /* ---------------------------- queue ----------------------------- */

  function renderQueue(main) {
    main.appendChild(heading('h2', 'Review queue'));
    const entries = list(data.queue);
    main.appendChild(
      el('p', 'lede', plural(entries.length, 'proposed record') + ' in review, as of ' + text(data.asOf) + '. These are the review facts each record carries; the portal adds no verdict to them.'),
    );
    if (entries.length === 0) {
      const empty = el('div', 'empty');
      empty.appendChild(el('strong', null, 'Nothing in review'));
      empty.appendChild(el('span', null, 'No record is proposed.'));
      main.appendChild(empty);
      return;
    }
    const cards = el('ul', 'cards queue-list');
    for (const entry of entries) cards.appendChild(queueCard(entry));
    main.appendChild(cards);
  }

  function queueCard(entry) {
    const li = el('li', 'card queue-row');
    const head = el('div', 'card-head');
    head.appendChild(recordLink(entry.id));
    head.appendChild(badge(own(SLA_TEXT, entry.slaState) || 'unknown SLA state', own(SLA_TONE, entry.slaState), own(SLA_GLYPH, entry.slaState)));
    li.appendChild(head);
    li.appendChild(el('p', 'record-title', entry.title));

    const approvals = Number.isSafeInteger(entry.approvalCount) ? entry.approvalCount : 0;
    const quorum = Number.isSafeInteger(entry.quorum) ? entry.quorum : null;
    const approvalText = quorum === null ? plural(approvals, 'approval') + ', no quorum set' : approvals + ' of ' + quorum + ' approvals';
    const unresolved = Number.isSafeInteger(entry.unresolvedObjectionCount) ? entry.unresolvedObjectionCount : 0;
    const resolved = Number.isSafeInteger(entry.resolvedObjectionCount) ? entry.resolvedObjectionCount : 0;
    const routing = list(entry.routingTargets);
    const routingNode = el('span', 'chips inline');
    if (routing.length === 0) routingNode.textContent = 'none declared';
    for (const target of routing) routingNode.appendChild(el('span', 'chip mono', target));
    const findings = Number.isSafeInteger(entry.itemFindingCount) ? entry.itemFindingCount : 0;

    li.appendChild(
      facts([
        ['Approvals', approvalText],
        ['Objections', unresolved + ' unresolved, ' + resolved + ' resolved'],
        ['SLA state', own(SLA_TEXT, entry.slaState) || 'unknown'],
        ['Deadline', entry.deadline === null || entry.deadline === undefined ? 'none' : entry.deadline],
        ['Tier', own(TIER_TEXT, entry.tier) || 'none declared'],
        ['Routing', routingNode],
        ['Queue findings', String(findings)],
        ['File', el('span', 'mono', entry.path)],
      ]),
    );
    return li;
  }

  /* ---------------------------- paths ----------------------------- */

  function renderPaths(main) {
    main.appendChild(heading('h2', 'Governance by path'));
    const table = data.pathTable || { state: 'absent' };
    if (table.state === 'unavailable') {
      const box = callout('red', 'cross', 'Path lookup withheld', [PATH_TEXT.unavailable]);
      box.setAttribute('role', 'status');
      main.appendChild(box);
      return;
    }
    if (table.state !== 'available') {
      main.appendChild(callout('neutral', 'info', 'No path table', [PATH_TEXT.absent]));
      return;
    }
    const entries = list(table.entries);
    const scope = data.commit ? 'at commit ' + shortCommit(data.commit) : 'in the index (no commits yet)';
    main.appendChild(
      el(
        'p',
        'lede',
        'A lookup in a table built from the tracked files ' + scope + '. ' + plural(table.governedPathCount, 'tracked path') +
          ' are reached by at least one decision. The table cannot answer for a branch, an uncommitted file, or a path added since the build.',
      ),
    );
    if (table.capped === true) {
      main.appendChild(
        callout('yellow', 'bang', 'This table is capped', [
          'It keeps ' + entries.length + ' of ' + plural(table.governedPathCount, 'governed path') + ' (at most ' + text(table.caps && table.caps.count) + ' entries and ' + text(table.caps && table.caps.bytes) + ' bytes). A path missing from it may still be governed.',
        ]),
      );
    }

    const row = el('div', 'filter-row');
    const label = el('label', 'filter-label', 'Path ');
    const input = el('input', 'filter-input mono');
    input.setAttribute('type', 'search');
    input.setAttribute('aria-label', 'Repository-relative path to look up');
    input.setAttribute('placeholder', 'src/index.ts');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocomplete', 'off');
    input.value = typedPath;
    label.appendChild(input);
    row.appendChild(label);
    main.appendChild(row);

    const result = el('div', 'path-result');
    result.setAttribute('aria-live', 'polite');
    main.appendChild(result);
    const suggestions = el('div', 'path-suggestions');
    main.appendChild(suggestions);

    const draw = () => {
      typedPath = text(input.value);
      clear(result);
      clear(suggestions);
      const outcome = lookupPath(table, data.commit, typedPath);
      if (outcome.kind === 'hit') result.appendChild(pathEntry(outcome.entry));
      else if (outcome.kind === 'miss') result.appendChild(callout('neutral', 'info', 'No entry for ' + normalizeLookup(typedPath), [outcome.message]));
      const prefix = normalizeLookup(typedPath);
      const matches = entries.filter((entry) => prefix === '' || entry.path.startsWith(prefix)).slice(0, 50);
      if (matches.length > 0 && outcome.kind !== 'hit') {
        suggestions.appendChild(el('h3', null, prefix === '' ? 'Governed paths (first ' + matches.length + ')' : 'Governed paths starting with this text'));
        const ul = el('ul', 'path-list plain');
        for (const entry of matches) {
          const li = el('li');
          const pick = el('button', 'link', entry.path);
          pick.setAttribute('type', 'button');
          pick.addEventListener('click', () => {
            input.value = entry.path;
            draw();
          });
          li.appendChild(pick);
          ul.appendChild(li);
        }
        suggestions.appendChild(ul);
      }
    };
    input.addEventListener('input', draw);
    draw();
  }

  function pathEntry(entry) {
    const box = el('div', 'card path-entry');
    box.appendChild(el('p', 'mono path', entry.path));
    for (const [key, label] of [['governing', 'Governing'], ['activeProposals', 'Active proposals'], ['history', 'History']]) {
      const decisions = list(entry[key]);
      const section = el('div', 'path-group');
      section.appendChild(el('h3', null, label + ' (' + decisions.length + ')'));
      if (decisions.length === 0) {
        section.appendChild(el('p', 'muted small', 'none'));
      } else {
        const ul = el('ul', 'plain');
        for (const decision of decisions) {
          const li = el('li', 'path-decision');
          li.appendChild(recordLink(decision.id));
          const record = recordsById().get(decision.id);
          if (record) li.appendChild(el('span', 'path-decision-title', record.title));
          for (const kind of list(decision.evidence)) li.appendChild(el('span', 'chip', own(EVIDENCE_TEXT, kind) || 'evidence'));
          ul.appendChild(li);
        }
        section.appendChild(ul);
      }
      box.appendChild(section);
    }
    return box;
  }

  /* ---------------------------- router ---------------------------- */

  function render() {
    const main = $('app');
    if (!main || !data) return;
    const route = parseRoute(win.location && win.location.hash);
    markNav(route);
    clear(main);
    drawn = null;
    redrawEdges = null;
    nodeElements = [];
    if (route.view === 'overview') renderOverview(main);
    else if (route.view === 'record') renderRecord(main, route.id);
    else if (route.view === 'graph') renderGraph(main);
    else if (route.view === 'queue') renderQueue(main);
    else if (route.view === 'paths') renderPaths(main);
    else {
      main.appendChild(heading('h2', 'Page not found'));
      main.appendChild(el('p', null, 'This portal has no view at this address.'));
      main.appendChild(link('Back to the records', '#/'));
    }
    return route;
  }

  function onRoute() {
    render();
    const title = $('app') && $('app').firstChild;
    if (title && typeof title.focus === 'function') title.focus();
    if (typeof win.scrollTo === 'function') win.scrollTo(0, 0);
  }

  function fail(title, message) {
    const main = $('app');
    if (!main) return;
    clear(main);
    const box = callout('red', 'cross', title, [message]);
    box.setAttribute('role', 'alert');
    main.appendChild(box);
  }

  const loaded = Promise.resolve()
    .then(() => env.fetch(DATA_URL, { credentials: 'same-origin' }))
    .then((response) => {
      if (!response || !response.ok) throw new Error('http ' + (response ? response.status : 'none'));
      return response.json();
    })
    .then(
      (json) => {
        if (!json || typeof json !== 'object' || json.version !== SUPPORTED_VERSION) {
          fail(
            'Unsupported portal data',
            'This page renders portal-data.json version ' + SUPPORTED_VERSION + '; the file says version ' +
              text(json && json.version) + '. Rebuild the portal with a matching generator.',
          );
          return;
        }
        data = json;
        renderChrome();
        render();
        win.addEventListener('hashchange', onRoute);
        win.addEventListener('resize', onResize);
      },
      () => fail('Could not load the decisions', 'The page could not read ' + DATA_URL + ' next to it. Serve the bundle over HTTP with every file the generator wrote.'),
    );

  return loaded.then(() => ({ render, data: () => data }));
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  startPortal({ document, window, fetch: window.fetch.bind(window) });
}
