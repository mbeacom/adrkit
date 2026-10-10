// @ts-check
/**
 * The `decision-board` canvas page (ADR-0050): HTML, browser script, and
 * stylesheet, shipped as strings so the server needs no filesystem lookup.
 *
 * Every title, id, status, path, and routing target the page shows is
 * repository content, and repository content is untrusted. The script builds
 * HTML with `createElement` and the graph with `createElementNS`, and puts text
 * in through `textContent` only. It never parses a string as HTML, sets no
 * inline style, and the board test fails if any HTML-parsing sink appears. The
 * server's Content-Security-Policy allows only these same-origin files.
 *
 * SVG classes are set with `setAttribute('class', …)`: an SVG element's
 * `className` is an `SVGAnimatedString`, so assigning a string to it does
 * nothing in a browser while a fake DOM accepts it.
 *
 * Status is shown by color and by a text label, and a relationship kind by
 * line style and the legend, because color alone is not accessible. The page
 * shows a queue row's counts and never a verdict on them.
 *
 * Each open proposal has review controls (ADR-0052). They take two clicks: the
 * first asks the server for a single-use nonce bound to that kind and record,
 * and the second, a "Confirm … as <reviewer>" button in the page's own DOM,
 * posts it. No browser dialog: one can block the app. The identity shown is
 * the server's `ADRKIT_REVIEWER`; the page sends none. The page names kinds
 * (approval, objection, resolution), never the CLI's subcommands.
 *
 * The graph pans and zooms by rewriting the SVG `viewBox` through the pure
 * helpers in board-view.mjs, embedded here from their own source: pointer
 * drag, Ctrl or Cmd with the wheel (a trackpad pinch), the zoom buttons, and
 * the keys +, -, 0, and the arrows on the focused graph.
 */

import { THEME_CSS } from './canvas-theme.mjs';
import { VIEW_HELPERS_SRC } from './board-view.mjs';

const TOKEN_SLOT = '__ADRKIT_TOKEN__';

/** The page shell. The only substitution is the instance token. */
export const BOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decision board</title>
<link rel="stylesheet" href="/app.css?token=${TOKEN_SLOT}">
<script src="/app.js?token=${TOKEN_SLOT}" defer></script>
</head>
<body>
<header class="bar">
  <div class="headline">
    <h1>Decision board</h1>
    <span id="status" class="badge lg tone-neutral" role="status" aria-live="polite">loading</span>
  </div>
  <p id="cwd" class="cwd mono"></p>
  <div class="toolbar">
    <div class="buttons">
      <button type="button" id="refresh" class="secondary">Refresh</button>
      <button type="button" id="show-all" class="secondary">Show the whole corpus</button>
    </div>
    <fieldset class="filters">
      <legend>Relationship kinds</legend>
      <label class="toggle"><input type="checkbox" id="kind-supersedes"> supersedes</label>
      <label class="toggle"><input type="checkbox" id="kind-relatesTo"> relatesTo</label>
      <label class="toggle"><input type="checkbox" id="kind-conflictsWith"> conflictsWith</label>
      <button type="button" id="apply-kinds" class="secondary">Apply</button>
    </fieldset>
  </div>
  <p id="message" class="message" role="alert"></p>
</header>
<main class="board-layout">
  <section class="board-graph card" aria-label="Decision graph">
    <div id="legend" class="legend"></div>
    <div id="board" class="board-host"></div>
  </section>
  <aside id="detail" class="board-detail card" aria-live="polite"></aside>
</main>
<section id="queue" class="section"></section>
<footer>This board writes only when you confirm a review control, as ADRKIT_REVIEWER, through the adr CLI; nothing is committed. It starts no workflow, spends no AI credits, and shows the CLI's facts, not a verdict on them.</footer>
</body>
</html>
`;

/**
 * @param {string} token
 * @returns {string}
 */
export function renderBoardPage(token) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('the page token must be 64 hex characters');
  return BOARD_HTML.split(TOKEN_SLOT).join(token);
}

/** Browser script. Plain ES2017, no modules, no dependencies. */
export const BOARD_JS = `(function () {
  'use strict';

  // Pan and zoom: pure helpers over a viewBox, embedded from board-view.mjs.
${VIEW_HELPERS_SRC}

  var SVG = 'http://www.w3.org/2000/svg';
  var NODE_WIDTH = 200;
  var NODE_HEIGHT = 56;
  var TITLE_CHARS = 28;
  var KINDS = ['supersedes', 'relatesTo', 'conflictsWith'];
  var STATUSES = ['accepted', 'proposed', 'draft', 'rejected', 'superseded', 'deprecated'];
  var KIND_TEXT = { supersedes: 'supersedes', relatesTo: 'relates to', conflictsWith: 'conflicts with' };
  var KIND_STYLE = { supersedes: 'solid, arrow to the replaced record', relatesTo: 'dashed', conflictsWith: 'dotted' };
  var STATUS_TONE = { accepted: 'green', proposed: 'blue', draft: 'neutral', rejected: 'red', superseded: 'purple', deprecated: 'yellow' };
  var STATUS_GLYPH = { accepted: 'check', proposed: 'half', draft: 'ring', rejected: 'cross', superseded: 'arrow', deprecated: 'bang' };
  var SLA_TONE = { 'within-sla': 'green', 'due-soon': 'yellow', overdue: 'red', escalated: 'red' };
  var token = new URLSearchParams(window.location.search).get('token') || '';
  var query = '?token=' + encodeURIComponent(token);
  var state = null;
  var selected = null;
  var refocus = false;
  var shownFilterKey = null;
  var busy = false;
  /** The control waiting for its confirming click: { kind, id, nonce, summary?, objection? }. */
  var armed = null;
  /** What a person has typed into a row's inputs, kept across re-renders. */
  var drafts = new Map();
  var REVIEW_TEXT = { approval: 'approval', objection: 'objection', resolution: 'resolution' };
  /** The graph's current viewBox, kept across re-renders of the same graph. */
  var view = null;
  var viewKey = null;
  var viewport = { width: 0, height: 0 };
  var drawn = null;
  /** Whether the person has panned or zoomed this graph; until then a resize re-opens it. */
  var touched = false;

  function $(id) { return document.getElementById(id); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value); }
  /** A value from the repository used as a lookup key: own entries of a fixed list only. */
  function known(values, value) { return typeof value === 'string' && values.indexOf(value) >= 0; }
  function own(table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined; }
  /**
   * Clip to at most \`size\` characters without cutting one in half: by
   * grapheme where the browser can segment, else by code point, so an emoji
   * or a combining mark is never split into a replacement glyph.
   */
  function shorten(value, size) {
    var s = text(value);
    var parts;
    if (typeof Intl === 'object' && Intl && typeof Intl.Segmenter === 'function') {
      parts = [];
      var segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s);
      for (var it = segments[Symbol.iterator](), step = it.next(); !step.done; step = it.next()) parts.push(step.value.segment);
    } else {
      parts = Array.from(s);
    }
    return parts.length > size ? parts.slice(0, size - 1).join('') + '…' : s;
  }

  /** Every HTML node is built here; text only ever goes through textContent. */
  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }

  /** Every SVG node is built here. Classes go through setAttribute, never className. */
  function svg(tag, attrs, content) {
    var node = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (name) { node.setAttribute(name, String(attrs[name])); });
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }

  function count(n, noun) { return text(n) + ' ' + noun + (n === 1 ? '' : 's'); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function setMessage(message, warn) {
    var node = $('message');
    node.textContent = text(message);
    node.className = warn ? 'message warn' : 'message';
  }
  function statusClass(status) { return 'status-' + (known(STATUSES, status) ? status : 'unknown'); }
  /** A status badge: hue, glyph, and the status word itself. */
  function statusBadge(status) {
    var key = known(STATUSES, status) ? status : null;
    return el('span', 'badge tone-' + (key ? STATUS_TONE[key] : 'neutral') + ' glyph-' + (key ? STATUS_GLYPH[key] : 'ask'), text(status) || 'unknown');
  }

  function button(label, onClick, className) {
    var node = el('button', className || 'secondary', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function nodesById(graph) {
    var byId = new Map();
    list(graph && graph.nodes).forEach(function (node) { byId.set(text(node.id), node); });
    return byId;
  }

  function queueRowFor(id) {
    var found = null;
    if (state && state.queue && state.queue.available) {
      list(state.queue.items).forEach(function (item) { if (text(item.id) === id) found = item; });
    }
    return found;
  }

  function whole(value) { return typeof value === 'number' && isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }

  /** Approvals against quorum as dots and the counts. No verdict is derived from them. */
  function approvalDots(item) {
    var wrap = el('span', 'approvals');
    var have = whole(item.approvalCount);
    var need = whole(item.quorum);
    var dots = el('span', 'dots');
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < Math.min(Math.max(have, need), 12); i++) dots.appendChild(el('span', i < have ? 'dot on' : 'dot'));
    if (dots.firstChild) wrap.appendChild(dots);
    wrap.appendChild(el('span', null, 'approvals ' + text(item.approvalCount) + ' of quorum ' + (item.quorum === null || item.quorum === undefined ? 'not set' : text(item.quorum))));
    return wrap;
  }

  /** A row's raw review facts, as counts and dates. No verdict is derived from them. */
  function factRows(item) {
    var rows = el('dl', 'facts');
    function row(label, value) {
      rows.appendChild(el('dt', null, label));
      var cell = el('dd');
      if (typeof value === 'string') cell.textContent = value; else cell.appendChild(value);
      rows.appendChild(cell);
    }
    row('Approvals', approvalDots(item));
    var objections = el('span', 'objections');
    var open = whole(item.unresolvedObjectionCount), settled = whole(item.resolvedObjectionCount);
    // The badges are for the eye; a screen reader gets the one sentence after them.
    var openBadge = el('span', 'badge ' + (open > 0 ? 'tone-yellow glyph-bang' : 'tone-neutral glyph-ring'), text(item.unresolvedObjectionCount) + ' unresolved');
    var settledBadge = el('span', 'badge ' + (settled > 0 ? 'tone-green glyph-check' : 'tone-neutral glyph-ring'), text(item.resolvedObjectionCount) + ' resolved');
    openBadge.setAttribute('aria-hidden', 'true');
    settledBadge.setAttribute('aria-hidden', 'true');
    objections.appendChild(openBadge);
    objections.appendChild(settledBadge);
    objections.appendChild(el('span', 'sr-only', 'objections: ' + text(item.unresolvedObjectionCount) + ' unresolved, ' + text(item.resolvedObjectionCount) + ' resolved'));
    row('Objections', objections);
    var sla = el('span', 'sla');
    var slaState = text(item.slaState) || 'unknown';
    sla.appendChild(el('span', 'badge tone-' + (own(SLA_TONE, slaState) || 'neutral'), 'SLA ' + slaState));
    sla.appendChild(el('span', null, 'deadline ' + (item.deadlineDate ? text(item.deadlineDate) : 'none')));
    row('SLA', sla);
    var targets = list(item.routingTargets).map(text);
    row('Routing', 'routed to ' + (targets.length > 0 ? targets.join(', ') : 'nobody'));
    row('Findings', text(item.itemFindingCount) + ' finding(s)');
    return rows;
  }

  /** Where a line from one box toward another leaves the box's edge. */
  function edgePoint(from, to) {
    var cx = from.x + NODE_WIDTH / 2, cy = from.y + NODE_HEIGHT / 2;
    var dx = to.x + NODE_WIDTH / 2 - cx, dy = to.y + NODE_HEIGHT / 2 - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var sx = dx === 0 ? Infinity : (NODE_WIDTH / 2) / Math.abs(dx);
    var sy = dy === 0 ? Infinity : (NODE_HEIGHT / 2) / Math.abs(dy);
    var s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function legend() {
    var node = $('legend');
    clear(node);
    var statusGroup = el('div', 'legend-group');
    statusGroup.appendChild(el('span', 'legend-title', 'Status'));
    var statuses = el('ul', 'legend-list');
    statuses.setAttribute('aria-label', 'Status');
    STATUSES.forEach(function (status) {
      var item = el('li', 'legend-item');
      var swatch = svg('svg', { width: 18, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      swatch.appendChild(svg('rect', { x: 1, y: 1, width: 16, height: 10, rx: 3, class: 'node-box ' + statusClass(status) }));
      item.appendChild(swatch);
      item.appendChild(el('span', null, status));
      statuses.appendChild(item);
    });
    statusGroup.appendChild(statuses);
    node.appendChild(statusGroup);
    var kindGroup = el('div', 'legend-group');
    kindGroup.appendChild(el('span', 'legend-title', 'Relationships'));
    var kinds = el('ul', 'legend-list');
    kinds.setAttribute('aria-label', 'Relationship');
    KINDS.forEach(function (kind) {
      var item = el('li', 'legend-item');
      var sample = svg('svg', { width: 30, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      var attrs = { x1: 1, y1: 6, x2: kind === 'supersedes' ? 24 : 29, y2: 6, class: 'edge edge-' + kind };
      sample.appendChild(svg('line', attrs));
      if (kind === 'supersedes') sample.appendChild(svg('path', { d: 'M 23 2 L 29 6 L 23 10 z', class: 'arrow' }));
      item.appendChild(sample);
      item.appendChild(el('span', null, KIND_TEXT[kind] + ' (' + KIND_STYLE[kind] + ')'));
      kinds.appendChild(item);
    });
    kindGroup.appendChild(kinds);
    node.appendChild(kindGroup);
  }

  /** Select a record. The graph is rebuilt, so keyboard focus is put back on it. */
  function select(id) {
    selected = id;
    refocus = true;
    if (state) render(state);
  }

  /** The viewport's size in pixels, or the graph's when the page cannot measure (a test DOM). */
  function measure(root, graph) {
    var rect = root && typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
    return { width: Number(graph.width) || NODE_WIDTH, height: Math.min(Number(graph.height) || NODE_HEIGHT, 560) };
  }

  function applyView() {
    if (drawn && view) drawn.root.setAttribute('viewBox', viewBoxOf(view));
  }

  function zoomBy(factor, fx, fy) {
    if (!drawn || !view) return;
    touched = true;
    // Zooming out may reach the whole-graph fit even when that is below 0.2.
    var floor = viewport.width / fitView(drawn.width, drawn.height, viewport.width, viewport.height).w;
    view = clampView(zoomView(view, factor, fx, fy, viewport.width, floor), drawn.width, drawn.height);
    applyView();
  }

  function panBy(dx, dy) {
    if (!drawn || !view) return;
    touched = true;
    view = clampView(panView(view, dx, dy, viewport.width), drawn.width, drawn.height);
    applyView();
  }

  /**
   * Fit the view to a (possibly new) viewport size: the opening view until the
   * person pans or zooms, and after that the same scale and corner.
   */
  function fitTo(size) {
    if (!drawn) return size;
    if (!touched || !view) view = initialView(drawn.width, drawn.height, size.width, size.height);
    else if (size.width !== viewport.width || size.height !== viewport.height) view = resizeView(view, size.width, size.height, viewport.width);
    applyView();
    return size;
  }

  function resetView() {
    if (!drawn) return;
    touched = false;
    view = fitView(drawn.width, drawn.height, viewport.width, viewport.height);
    applyView();
  }

  /** Keys on the focused graph: + and - zoom, 0 fits, arrows pan. Typing elsewhere is untouched. */
  function graphKeys(event) {
    if (!event) return;
    var tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'button' || tag === 'textarea') return;
    var key = event.key;
    var step = 60;
    var handled = true;
    if (key === '+' || key === '=') zoomBy(1.25, 0.5, 0.5);
    else if (key === '-' || key === '_') zoomBy(0.8, 0.5, 0.5);
    else if (key === '0') resetView();
    else if (key === 'ArrowLeft') panBy(step, 0);
    else if (key === 'ArrowRight') panBy(-step, 0);
    else if (key === 'ArrowUp') panBy(0, step);
    else if (key === 'ArrowDown') panBy(0, -step);
    else handled = false;
    if (handled && event.preventDefault) event.preventDefault();
  }

  /** Pointer drag pans; a drag never also selects the record it started on. */
  var drag = null;
  var dragged = false;
  function wirePointer(root) {
    root.addEventListener('pointerdown', function (event) {
      if (!event || (event.button !== undefined && event.button !== 0)) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      dragged = false;
    });
    root.addEventListener('pointermove', function (event) {
      if (!drag || !event) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!dragged && typeof root.setPointerCapture === 'function') { try { root.setPointerCapture(drag.id); } catch (error) { /* not capturable */ } }
      dragged = true;
      root.setAttribute('class', 'board-svg dragging');
      drag.x = event.clientX;
      drag.y = event.clientY;
      panBy(dx, dy);
    });
    function end() {
      drag = null;
      root.setAttribute('class', 'board-svg');
    }
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // Only Ctrl or Cmd with the wheel (a trackpad pinch) belongs to the graph;
    // a plain wheel scrolls the panel, so the graph is never a scroll trap.
    root.addEventListener('wheel', function (event) {
      if (!event || !(event.ctrlKey || event.metaKey)) return;
      if (event.preventDefault) event.preventDefault();
      var rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
      var fx = rect && rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      var fy = rect && rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, fx, fy);
    }, { passive: false });
  }

  function zoomBar() {
    var bar = el('div', 'zoom-bar');
    var out = button('−', function () { zoomBy(0.8, 0.5, 0.5); });
    out.setAttribute('aria-label', 'Zoom out');
    out.title = 'Zoom out (-)';
    var into = button('+', function () { zoomBy(1.25, 0.5, 0.5); });
    into.setAttribute('aria-label', 'Zoom in');
    into.title = 'Zoom in (+)';
    var fit = button('Fit', function () { resetView(); });
    fit.setAttribute('aria-label', 'Fit the whole graph');
    fit.title = 'Fit the whole graph (0)';
    bar.appendChild(out);
    bar.appendChild(into);
    bar.appendChild(fit);
    bar.appendChild(el('span', 'hint', 'Drag to pan · Ctrl or Cmd + wheel to zoom · keys + − 0 and arrows'));
    return bar;
  }

  function drawGraph(graph) {
    var host = $('board');
    clear(host);
    drawn = null;
    if (!graph) {
      var loading = el('div', 'loading');
      loading.appendChild(el('span', 'spinner'));
      loading.appendChild(el('span', null, 'Loading the decision graph…'));
      host.appendChild(loading);
      return;
    }
    if (!graph.available) {
      var failed = el('div', 'callout tone-red');
      failed.setAttribute('role', 'alert');
      failed.appendChild(el('p', 'callout-title glyph-cross', 'The decision graph is unavailable'));
      list(graph.notes).forEach(function (note) { failed.appendChild(el('p', 'note', note)); });
      host.appendChild(failed);
      return;
    }
    if (graph.mode === 'summary') {
      var summary = el('div', 'summary');
      summary.appendChild(el('p', 'summary-lede', text(graph.totalNodes) + ' records and ' + text(graph.totalEdges) + ' relationships. Too many to draw legibly; focus on one record to see its neighborhood.'));
      var counts = el('ul', 'status-counts');
      list(graph.byStatus).forEach(function (row) {
        var item = el('li', 'status-count');
        var shown = statusBadge(text(row.status));
        shown.textContent = text(row.status) + ': ' + text(row.count);
        item.appendChild(shown);
        counts.appendChild(item);
      });
      summary.appendChild(counts);
      summary.appendChild(focusForm());
      list(graph.notes).forEach(function (note) { summary.appendChild(el('p', 'small muted note', note)); });
      host.appendChild(summary);
      return;
    }
    var nodes = list(graph.nodes);
    if (nodes.length === 0) {
      var none = el('div', 'empty');
      none.appendChild(el('strong', null, 'No records to show'));
      none.appendChild(el('span', null, 'adr graph returned an empty corpus for this filter.'));
      host.appendChild(none);
      list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'small muted note', note)); });
      return;
    }
    var byId = nodesById(graph);
    // The neighborhood of the selected record: it and everything one edge away.
    var near = new Set();
    if (selected !== null) {
      near.add(selected);
      list(graph.edges).forEach(function (edge) {
        if (text(edge.from) === selected) near.add(text(edge.to));
        if (text(edge.to) === selected) near.add(text(edge.from));
      });
    }
    var dimming = selected !== null && byId.has(selected);
    host.appendChild(zoomBar());
    // The frame's height follows the drawing at its opening scale, in fixed
    // steps (a class, never an inline size), so a small focus is not a tall
    // empty box and a large corpus still gets room.
    var wanted = (Number(graph.height) || 0) * 0.75 + 32;
    var frame = el('div', 'graph-frame ' + (wanted <= 240 ? 'h-s' : wanted <= 360 ? 'h-m' : wanted <= 480 ? 'h-l' : 'h-xl'));
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', 'Decision graph: ' + nodes.length + ' records. Use + and − to zoom, 0 to fit, arrows to pan.');
    frame.addEventListener('keydown', graphKeys);
    var root = svg('svg', {
      width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet',
      viewBox: '0 0 ' + text(graph.width) + ' ' + text(graph.height),
      role: 'group', 'aria-label': 'Decision graph: ' + nodes.length + ' records', class: 'board-svg',
    });
    // Only supersession has a direction worth an arrowhead; relatesTo and
    // conflictsWith are drawn as plain lines, as the legend says.
    var defs = svg('defs');
    var marker = svg('marker', { id: 'arrow-supersedes', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow arrow-supersedes' }));
    defs.appendChild(marker);
    root.appendChild(defs);

    var edges = svg('g', { class: 'edges' + (dimming ? ' has-selection' : '') });
    list(graph.edges).forEach(function (edge) {
      var from = byId.get(text(edge.from)), to = byId.get(text(edge.to));
      if (!from || !to || !known(KINDS, edge.kind)) return;
      var start = edgePoint(from, to), end = edgePoint(to, from);
      var touches = selected !== null && (text(edge.from) === selected || text(edge.to) === selected);
      var attrs = { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'edge edge-' + edge.kind + (touches ? ' edge-near' : dimming ? ' edge-dim' : '') };
      if (edge.kind === 'supersedes') attrs['marker-end'] = 'url(#arrow-supersedes)';
      var line = svg('line', attrs);
      line.appendChild(svg('title', {}, text(edge.from) + ' ' + KIND_TEXT[edge.kind] + ' ' + text(edge.to)));
      edges.appendChild(line);
    });
    root.appendChild(edges);

    var group = svg('g', { class: 'nodes' });
    var toFocus = null;
    nodes.forEach(function (node) {
      var id = text(node.id);
      var status = text(node.status);
      var isSelected = id === selected;
      var cls = 'node ' + statusClass(status) + (isSelected ? ' selected' : '') +
        (state && state.filter && state.filter.id === id ? ' focused' : '') +
        (dimming && !near.has(id) ? ' dim' : dimming && !isSelected ? ' neighbor' : '');
      var g = svg('g', {
        class: cls,
        transform: 'translate(' + text(node.x) + ' ' + text(node.y) + ')',
        tabindex: 0, role: 'button', 'aria-pressed': isSelected ? 'true' : 'false',
        'aria-label': id + ', ' + status + ': ' + text(node.title),
      });
      // The full title, for the pointer; the box shows a clipped one.
      g.appendChild(svg('title', {}, id + ' (' + status + '): ' + text(node.title)));
      g.appendChild(svg('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 8, class: 'node-box ' + statusClass(status) }));
      g.appendChild(svg('rect', { width: 5, height: NODE_HEIGHT - 12, x: 0, y: 6, rx: 2, class: 'node-stripe ' + statusClass(status) }));
      g.appendChild(svg('text', { x: 14, y: 22, class: 'node-id' }, id + ' · ' + status));
      g.appendChild(svg('text', { x: 14, y: 41, class: 'node-title' }, shorten(node.title, TITLE_CHARS)));
      g.addEventListener('click', function () { if (dragged) { dragged = false; return; } select(id); });
      g.addEventListener('keydown', function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (event.preventDefault) event.preventDefault();
          select(id);
        }
      });
      if (isSelected) toFocus = g;
      group.appendChild(g);
    });
    root.appendChild(group);
    frame.appendChild(root);
    host.appendChild(frame);
    wirePointer(root);

    // Keep the view while the same graph is redrawn (a selection, a queue
    // update); start fresh when the graph itself changed.
    var size = measure(root, graph);
    var key = JSON.stringify([graph.width, graph.height, graph.totalNodes, graph.totalEdges, state && state.filter]);
    drawn = { root: root, width: Number(graph.width) || 1, height: Number(graph.height) || 1 };
    if (key !== viewKey || !view) {
      viewKey = key;
      touched = false;
    }
    viewport = fitTo(size);
    if (refocus && toFocus && typeof toFocus.focus === 'function') toFocus.focus();
    refocus = false;
    list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'small muted note', note)); });
  }

  function focusForm() {
    var form = el('div', 'focus-form');
    var label = el('label', null, 'Focus on record ');
    var input = el('input', 'mono');
    input.type = 'text';
    input.id = 'focus-id';
    input.setAttribute('aria-label', 'Record id to focus on');
    input.setAttribute('placeholder', '0042');
    label.appendChild(input);
    form.appendChild(label);
    form.appendChild(button('Focus', function () { focus({ id: text(input.value).trim(), kinds: currentKinds() }); }, 'primary'));
    return form;
  }

  function detail() {
    var pane = $('detail');
    clear(pane);
    var graph = state && state.graph;
    var node = selected !== null ? nodesById(graph).get(selected) : null;
    if (!node) {
      pane.appendChild(el('h2', null, 'Record'));
      pane.appendChild(el('p', 'muted', 'Select a record (click it, or Tab to it and press Enter) to see its fields, its neighbors, and its review facts.'));
      return;
    }
    var id = text(node.id);
    var head = el('div', 'detail-head');
    head.appendChild(el('h2', 'mono', id));
    head.appendChild(statusBadge(node.status));
    pane.appendChild(head);
    pane.appendChild(el('p', 'record-title detail-title', node.title));

    pane.appendChild(el('h3', null, 'Neighbors'));
    var neighbors = el('ul', 'neighbors');
    list(graph.edges).forEach(function (edge) {
      if (!known(KINDS, edge.kind)) return;
      var other = null, phrase = '';
      if (text(edge.from) === id) { other = text(edge.to); phrase = KIND_TEXT[edge.kind] + ' '; }
      else if (text(edge.to) === id) { other = text(edge.from); phrase = (edge.kind === 'supersedes' ? 'superseded by' : KIND_TEXT[edge.kind] + ' (from)') + ' '; }
      if (other === null) return;
      var item = el('li', 'neighbor-' + edge.kind);
      item.appendChild(el('span', 'muted', phrase));
      var target = other;
      item.appendChild(button(target, function () { select(target); }, 'link'));
      neighbors.appendChild(item);
    });
    if (!neighbors.firstChild) neighbors.appendChild(el('li', 'muted', 'None in this view.'));
    pane.appendChild(neighbors);

    pane.appendChild(el('h3', null, 'Review facts'));
    var row = queueRowFor(id);
    if (row) {
      pane.appendChild(factRows(row));
      if (row.sourcePath) pane.appendChild(el('p', 'mono small muted path', row.sourcePath));
    } else {
      pane.appendChild(el('p', 'muted', 'Not in the open-proposal queue.'));
    }
    if (!(state.filter && state.filter.id === id)) {
      var actions = el('div', 'detail-actions');
      actions.appendChild(button('Focus on ' + id, function () { focus({ id: id, kinds: currentKinds() }); }));
      pane.appendChild(actions);
    }
  }

  function reviewInfo() {
    var review = state && state.review;
    if (review && typeof review === 'object' && review.enabled === true && typeof review.reviewer === 'string') return review;
    return { enabled: false, reviewer: null, note: review && typeof review.note === 'string' ? review.note : 'Recording review is unavailable on this board.' };
  }

  function draftFor(id) {
    if (!drafts.has(id)) drafts.set(id, { summary: '', objection: '' });
    return drafts.get(id);
  }

  /** What the confirming click will record, in words. */
  function describe(request, who) {
    if (request.kind === 'approval') return 'Record an approval of ADR-' + request.id + ' by ' + who + '?';
    if (request.kind === 'objection') return 'Record an objection on ADR-' + request.id + ' by ' + who + ': ' + request.summary;
    return 'Mark objection ' + text(request.objection) + ' on ADR-' + request.id + ' as resolved by ' + who + '? Only its objector can.';
  }

  /** The approve, object, and resolve controls for one open proposal. */
  function reviewControls(item) {
    var id = text(item.id);
    var info = reviewInfo();
    var box = el('div', 'review-controls');
    box.appendChild(el('h3', null, 'Record review'));
    if (!info.enabled) {
      box.setAttribute('aria-disabled', 'true');
      ['Approve', 'Raise objection', 'Resolve objection'].forEach(function (label) {
        var off = button(label, function () {});
        off.disabled = true;
        off.title = info.note;
        off.setAttribute('aria-description', info.note);
        box.appendChild(off);
      });
      // The fixed explanation is shown once, above the list; each row points to it.
      box.appendChild(el('p', 'note off-note glyph-info', 'Recording review is off on this board; the note above the list says why.'));
      return box;
    }
    var who = text(info.reviewer);
    if (armed && armed.id === id) {
      // Step 2 of 3 looks like a different place, not the idle row relabelled.
      box.setAttribute('data-step', 'confirm');
      box.appendChild(el('p', 'step', 'Step 2 of 3 · confirm here'));
      box.appendChild(el('p', 'confirm-text', describe(armed, who)));
      // Cancel takes the arming button's place and Confirm comes after it, so
      // a double click on the arming button cannot land on Confirm (review L4).
      box.appendChild(button('Cancel', function () { armed = null; setMessage(''); render(state); }));
      var yes = button('Confirm ' + REVIEW_TEXT[armed.kind] + ' as ' + who, submit, 'primary');
      yes.disabled = busy;
      box.appendChild(yes);
      box.appendChild(el('p', 'note host-step', 'Step 3 of 3 · GitHub Copilot will then ask you to confirm it again; the board writes only if you say yes there.'));
      return box;
    }
    box.appendChild(el('p', 'step', 'Step 1 of 3 · choose · recording as ' + who));
    var draft = draftFor(id);
    var approve = button('Approve as ' + who, function () { arm({ kind: 'approval', id: id }); });
    approve.disabled = busy;
    box.appendChild(approve);

    var objectRow = el('div', 'review-row');
    var summary = el('input', null);
    summary.type = 'text';
    summary.value = draft.summary;
    summary.maxLength = 500;
    summary.setAttribute('placeholder', 'One-line objection');
    summary.setAttribute('aria-label', 'One-line objection summary for ' + id);
    summary.addEventListener('input', function () { draft.summary = text(summary.value); });
    objectRow.appendChild(summary);
    var raise = button('Raise objection', function () {
      var line = text(draft.summary).trim();
      if (line === '') { setMessage('Write a one-line objection first.'); return; }
      arm({ kind: 'objection', id: id, summary: line });
    });
    raise.disabled = busy;
    objectRow.appendChild(raise);
    box.appendChild(objectRow);

    var total = whole(item.unresolvedObjectionCount) + whole(item.resolvedObjectionCount);
    if (total > 0) {
      var resolveRow = el('div', 'review-row');
      var index = el('input', 'mono');
      index.type = 'number';
      index.value = draft.objection;
      index.setAttribute('min', '1');
      index.setAttribute('max', String(total));
      index.setAttribute('placeholder', '#');
      index.setAttribute('aria-label', 'Your objection number (1 to ' + total + ') on ' + id);
      index.addEventListener('input', function () { draft.objection = text(index.value); });
      resolveRow.appendChild(index);
      var settle = button('Resolve objection', function () {
        var n = Number(text(draft.objection).trim());
        if (!(n >= 1 && n <= total && Math.floor(n) === n)) { setMessage('Choose an objection number from 1 to ' + total + '.'); return; }
        arm({ kind: 'resolution', id: id, objection: n });
      });
      settle.disabled = busy;
      resolveRow.appendChild(settle);
      box.appendChild(resolveRow);
    }
    return box;
  }

  /** First click: ask for a nonce bound to this kind and record. */
  function arm(request) {
    if (busy) return;
    busy = true;
    armed = null;
    setMessage('Preparing the confirmation…');
    render(state);
    post('/api/review/nonce', { kind: request.kind, id: request.id }).then(function (data) {
      busy = false;
      if (!data || typeof data.nonce !== 'string') throw new Error('No confirmation was issued.');
      armed = { kind: request.kind, id: request.id, nonce: data.nonce, summary: request.summary, objection: request.objection };
      setMessage('');
      render(state);
    }).catch(function (error) {
      busy = false;
      armed = null;
      setMessage(error && error.message ? error.message : 'Request failed');
      render(state);
    });
  }

  /** Second click: spend the nonce. The server chooses the identity. */
  function submit() {
    if (!armed || busy) return;
    var request = armed;
    armed = null;
    var body = { kind: request.kind, id: request.id, nonce: request.nonce };
    if (request.kind === 'objection') body.summary = request.summary;
    if (request.kind === 'resolution') body.objection = request.objection;
    busy = true;
    setMessage('Recording…');
    render(state);
    post('/api/review', body).then(function (data) {
      busy = false;
      if (data && data.outcome === 'written') {
        var draft = draftFor(request.id);
        if (request.kind === 'objection') draft.summary = '';
        if (request.kind === 'resolution') draft.objection = '';
      }
      if (data && data.state && typeof data.state === 'object' && 'workingDirectory' in data.state) render(data.state);
      else render(state);
      setMessage(data && typeof data.message === 'string' ? data.message : 'Done.');
    }, function (error) {
      busy = false;
      render(state);
      setMessage(error && error.message ? error.message : 'Request failed', Boolean(error && error.pending));
    });
  }

  function queueSection() {
    var node = $('queue');
    clear(node);
    var queue = state && state.queue;
    // The total open, not the rows kept: past the row or byte cap the note says how many are shown.
    var total = queue && queue.available ? (typeof queue.totalItems === 'number' ? queue.totalItems : list(queue.items).length) : null;
    node.appendChild(el('h2', 'section-title', 'Open proposals, corpus-wide' + (total === null ? '' : ' (' + text(total) + ')')));
    if (!queue) { node.appendChild(el('p', 'muted', 'Loading the open-proposal list…')); return; }
    if (!queue.available) { node.appendChild(el('p', 'muted note', queue.note || 'The open-proposal list is unavailable.')); return; }
    node.appendChild(el('p', 'lede', 'Raw review facts from adr queue' + (queue.asOf ? ', as of ' + text(queue.asOf) : '') + '. Listed, not judged.'));
    var items = list(queue.items);
    if (items.length === 0) node.appendChild(el('p', 'muted', 'No proposed record is open.'));
    var info = reviewInfo();
    if (items.length > 0 && !info.enabled) {
      var off = el('div', 'callout tone-neutral review-off');
      off.setAttribute('role', 'note');
      off.appendChild(el('p', 'callout-title glyph-info', 'Review controls are disabled'));
      off.appendChild(el('p', null, info.note));
      node.appendChild(off);
    }
    var rows = el('ul', 'cards');
    items.forEach(function (item) {
      var id = text(item.id);
      var row = el('li', 'card queue-row' + (id === selected ? ' is-selected' : ''));
      var top = el('div', 'card-head');
      top.appendChild(el('span', 'record-id', item.id));
      top.appendChild(el('span', 'record-title', item.title));
      row.appendChild(top);
      var body = el('div', 'queue-body');
      body.appendChild(factRows(item));
      body.appendChild(reviewControls(item));
      row.appendChild(body);
      if (state.graph && nodesById(state.graph).has(id)) {
        var actions = el('div', 'card-actions');
        actions.appendChild(button('Show ' + id + ' on the board', function () { select(id); }));
        row.appendChild(actions);
      }
      rows.appendChild(row);
    });
    if (items.length > 0) node.appendChild(rows);
    if (queue.corpusFindings > 0) node.appendChild(el('p', 'small muted', 'adr queue reported ' + text(queue.corpusFindings) + ' corpus finding(s); adr lint shows them.'));
    if (queue.note) node.appendChild(el('p', 'small muted note', queue.note));
  }

  function currentKinds() {
    return KINDS.filter(function (kind) { var box = $('kind-' + kind); return Boolean(box && box.checked); });
  }

  function render(snapshot) {
    state = snapshot;
    var graph = snapshot.graph;
    var parts = [];
    if (!graph) parts.push('loading');
    else if (!graph.available) parts.push('graph unavailable');
    else parts.push(count(graph.totalNodes, 'record') + ' · ' + count(graph.totalEdges, 'relationship'));
    var filter = snapshot.filter || { id: null, kinds: [] };
    if (filter.id) parts.push('focus ' + text(filter.id));
    if (list(filter.kinds).length > 0) parts.push(list(filter.kinds).map(text).join(', '));
    var status = $('status');
    status.textContent = parts.join(' · ');
    status.className = 'badge lg ' + (!graph ? 'tone-blue glyph-wait' : !graph.available ? 'tone-red glyph-cross' : filter.id ? 'tone-blue glyph-dot' : 'tone-neutral glyph-dot');
    var cwd = $('cwd');
    cwd.textContent = text(snapshot.workingDirectory);
    cwd.title = text(snapshot.workingDirectory);
    $('refresh').disabled = busy;
    $('show-all').disabled = busy || (!filter.id && list(filter.kinds).length === 0);
    $('apply-kinds').disabled = busy;
    // Sync the checkboxes only when the shown filter changed, so a broadcast
    // (a queue read landing) does not discard boxes the user has not applied.
    var filterKey = JSON.stringify([filter.id || null, list(filter.kinds)]);
    if (filterKey !== shownFilterKey) {
      shownFilterKey = filterKey;
      KINDS.forEach(function (kind) { var box = $('kind-' + kind); if (box) box.checked = list(filter.kinds).indexOf(kind) >= 0; });
    }
    if (selected !== null && graph && !nodesById(graph).has(selected)) selected = null;
    drawGraph(graph);
    detail();
    queueSection();
  }

  function post(path, body) {
    return fetch(path + query, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Adrkit-Token': token },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          var failure = new Error((data && data.error) || 'Request failed (' + response.status + ')');
          // A write already waiting for the host's confirmation: say so loudly (review R1-M1).
          failure.pending = Boolean(data && data.pending);
          throw failure;
        }
        return data;
      });
    });
  }

  function act(path, body, progress) {
    busy = true;
    setMessage(progress);
    if (state) render(state);
    return post(path, body).then(function (data) {
      busy = false;
      setMessage('');
      if (data && typeof data === 'object' && 'workingDirectory' in data) render(data);
      else if (state) render(state);
    }, function (error) {
      busy = false;
      setMessage(error && error.message ? error.message : 'Request failed');
      if (state) render(state);
    });
  }

  function focus(filter) { return act('/api/focus', filter, 'Re-running adr graph…'); }

  legend();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', function () {
      if (drawn) viewport = fitTo(measure(drawn.root, { width: drawn.width, height: drawn.height }));
    });
  }
  drawGraph(null);
  detail();
  queueSection();
  $('refresh').addEventListener('click', function () { act('/api/refresh', {}, 'Refreshing…'); });
  $('show-all').addEventListener('click', function () { focus({}); });
  $('apply-kinds').addEventListener('click', function () {
    focus({ id: state && state.filter ? state.filter.id : null, kinds: currentKinds() });
  });

  fetch('/api/state' + query)
    .then(function (response) { return response.json(); })
    .then(render)
    .catch(function () { setMessage('Could not load the current state.'); });

  if (typeof EventSource !== 'undefined') {
    var events = new EventSource('/events' + query);
    events.addEventListener('state', function (event) {
      try { render(JSON.parse(event.data)); } catch (error) { setMessage('Could not read an update.'); }
    });
  }
})();
`;

/** The board's own rules, after the shared canvas theme. */
const BOARD_ONLY_CSS = `
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); }
.filters { border: 1px solid var(--c-border); border-radius: var(--r-md); margin: 0; padding: 2px var(--sp-2) var(--sp-1); display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1) var(--sp-3); font-size: var(--fs-sm); }
.filters legend { padding: 0 var(--sp-1); font-size: var(--fs-xs); color: var(--c-muted); }
.toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.board-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: var(--sp-4); margin-top: var(--sp-4); align-items: start; }
@media (max-width: 720px) { .board-layout { grid-template-columns: minmax(0, 1fr); } }
.board-graph { padding: var(--sp-3); min-width: 0; }
.board-detail { position: sticky; top: var(--sp-2); }
.section-title { margin-bottom: var(--sp-2); }
.board-detail h3, .review-controls h3 { margin: var(--sp-4) 0 var(--sp-2); }
.detail-head { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.detail-title { margin: var(--sp-1) 0 0; }
.detail-actions, .card-actions { margin-top: var(--sp-3); }
.neighbors { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-sm); }
.legend { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-6); margin-bottom: var(--sp-3); font-size: var(--fs-xs); }
.legend-group { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1) var(--sp-2); }
.legend-title { font-weight: 600; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.legend-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.swatch { display: inline-block; vertical-align: middle; overflow: visible; }
.zoom-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1); margin-bottom: var(--sp-2); }
.zoom-bar button { min-width: 32px; padding: 3px var(--sp-2); }
.hint { font-size: var(--fs-xs); color: var(--c-muted); margin-left: var(--sp-2); }
.graph-frame.h-s { height: 240px; }
.graph-frame.h-m { height: 360px; }
.graph-frame.h-l { height: 480px; }
.graph-frame.h-xl { height: 640px; }
.graph-frame { border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); overflow: hidden; }
.graph-frame:focus-visible { outline: 2px solid var(--c-focus); outline-offset: 2px; }
.board-svg { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; user-select: none; }
.board-svg.dragging { cursor: grabbing; }
.node { cursor: pointer; outline: none; transition: opacity 120ms ease; }
.node-box { fill: var(--c-bg); stroke: var(--c-border); stroke-width: 1.25; }
.node-stripe { stroke: none; }
.node.selected .node-box, .node.focused .node-box { stroke-width: 3; }
.node.neighbor .node-box { stroke-width: 2.25; }
/* Dim the box, never the label or the focus ring: a dimmed record must still read. */
.node.dim .node-box, .node.dim .node-stripe { opacity: 0.3; }
.node.dim .node-id { fill: var(--c-muted); }
.node.dim:focus-visible .node-box { opacity: 1; }
.node:focus-visible .node-box { stroke: var(--c-focus); stroke-width: 3.5; }
.node-id { font-family: var(--font-code); font-size: 12px; font-weight: 600; fill: var(--c-text); }
.node-title { font-family: var(--font-ui); font-size: 12px; fill: var(--c-muted); }
.node-box.status-accepted { fill: var(--c-green-tint); stroke: var(--c-green); }
.node-box.status-proposed { fill: var(--c-blue-tint); stroke: var(--c-blue); }
.node-box.status-draft { fill: var(--c-bg); stroke: var(--c-muted); stroke-dasharray: 4 3; }
.node-box.status-rejected { fill: var(--c-red-tint); stroke: var(--c-red); }
.node-box.status-superseded { fill: var(--c-purple-tint); stroke: var(--c-purple); }
.node-box.status-deprecated { fill: var(--c-yellow-tint); stroke: var(--c-yellow); }
.node-box.status-unknown { fill: var(--c-bg); stroke: var(--c-border); }
.node-stripe.status-accepted { fill: var(--c-green); }
.node-stripe.status-proposed { fill: var(--c-blue); }
.node-stripe.status-draft { fill: var(--c-muted); }
.node-stripe.status-rejected { fill: var(--c-red); }
.node-stripe.status-superseded { fill: var(--c-purple); }
.node-stripe.status-deprecated { fill: var(--c-yellow); }
.node-stripe.status-unknown { fill: var(--c-border); }
.edge { stroke: var(--c-muted); stroke-width: 1.25; fill: none; opacity: 0.55; transition: opacity 120ms ease; }
.edge-supersedes { stroke-width: 2; opacity: 0.8; }
.edge-relatesTo { stroke-dasharray: 6 4; }
.edge-conflictsWith { stroke: var(--c-red); stroke-dasharray: 2 3; }
.edge-near { stroke-width: 2.5; opacity: 1; }
.edge-dim { opacity: 0.08; }
.arrow { fill: var(--c-muted); }
.summary-lede { font-size: var(--fs-md); }
.status-counts { list-style: none; padding: 0; margin: var(--sp-3) 0; display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.status-count .badge { font-size: var(--fs-sm); padding: 3px 10px; }
.focus-form { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; margin: var(--sp-3) 0; }
.focus-form label { display: inline-flex; align-items: center; gap: var(--sp-2); }
.focus-form input { width: 8em; }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px var(--sp-3); margin: 0; font-size: var(--fs-sm); align-items: center; }
.facts dt { color: var(--c-muted); font-weight: 600; font-size: var(--fs-xs); }
.facts dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1) var(--sp-2); overflow-wrap: anywhere; }
.approvals, .objections, .sla { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dots { display: inline-flex; gap: 3px; }
.dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--c-green); background: transparent; }
.dot.on { background: var(--c-green); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.path { overflow-wrap: anywhere; margin-top: var(--sp-2); }
.queue-row.is-selected { border-color: var(--c-blue); box-shadow: 0 0 0 1px var(--c-blue); }
.queue-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-4); margin-top: var(--sp-3); align-items: start; }
@media (max-width: 720px) { .queue-body { grid-template-columns: minmax(0, 1fr); } }
.review-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); padding: var(--sp-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); }
.review-controls h3 { margin: 0; flex-basis: 100%; }
.review-controls .note, .review-controls .confirm-text, .review-controls .step { flex-basis: 100%; margin: 0; }
.review-controls .step { font-size: var(--fs-xs); font-weight: 600; color: var(--c-muted); }
.review-controls[data-step="confirm"] { border: 2px solid var(--c-blue); background: var(--c-blue-tint); }
.review-controls[data-step="confirm"] .step { color: var(--c-blue); }
.confirm-text { font-weight: 600; overflow-wrap: anywhere; }
.host-step { font-size: var(--fs-sm); color: var(--c-text); }
.off-note { font-size: var(--fs-sm); color: var(--c-muted); display: flex; gap: 6px; }
.off-note::before { font-weight: 700; color: var(--c-blue); }
.review-row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; flex-basis: 100%; }
.review-row input[type="text"] { flex: 1 1 12em; min-width: 0; }
.review-row input[type="number"] { width: 5em; }
.loading { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-6) var(--sp-4); color: var(--c-muted); }
.review-off { margin: 0 0 var(--sp-3); }
.spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--c-border); border-top-color: var(--c-blue); animation: ak-spin 0.9s linear infinite; flex: none; }
@keyframes ak-spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) {
  body { padding: var(--sp-3) var(--sp-3) var(--sp-4); }
  .hint { flex-basis: 100%; margin: var(--sp-1) 0 0; }
  .graph-frame.h-xl { height: 520px; }
  .board-detail { position: static; }
}
`;

/** Stylesheet: the shared canvas theme, then the board's own rules. */
export const BOARD_CSS = THEME_CSS + BOARD_ONLY_CSS;
