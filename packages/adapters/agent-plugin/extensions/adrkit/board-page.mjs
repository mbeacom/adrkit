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
 */

import { PAGE_CSS } from './canvas-page.mjs';

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
    <span id="status" class="badge tone-neutral" role="status" aria-live="polite">loading</span>
  </div>
  <p id="cwd" class="cwd mono muted"></p>
  <div class="buttons">
    <button type="button" id="refresh">Refresh</button>
    <button type="button" id="show-all">Show the whole corpus</button>
  </div>
  <fieldset class="filters">
    <legend>Relationship kinds</legend>
    <label><input type="checkbox" id="kind-supersedes"> supersedes</label>
    <label><input type="checkbox" id="kind-relatesTo"> relatesTo</label>
    <label><input type="checkbox" id="kind-conflictsWith"> conflictsWith</label>
    <button type="button" id="apply-kinds">Apply</button>
  </fieldset>
  <p id="message" class="message" role="alert"></p>
</header>
<main class="board-layout">
  <section class="board-graph" aria-label="Decision graph">
    <div id="legend" class="legend"></div>
    <div id="board" class="board-scroll"></div>
  </section>
  <aside id="detail" class="board-detail" aria-live="polite"></aside>
</main>
<section id="queue" class="section"></section>
<footer class="muted">Read-only: this board writes nothing, starts nothing, and spends no AI credits. It shows the CLI's facts, not a verdict on them.</footer>
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

  var SVG = 'http://www.w3.org/2000/svg';
  var NODE_WIDTH = 200;
  var NODE_HEIGHT = 56;
  var KINDS = ['supersedes', 'relatesTo', 'conflictsWith'];
  var STATUSES = ['accepted', 'proposed', 'draft', 'rejected', 'superseded', 'deprecated'];
  var KIND_TEXT = { supersedes: 'supersedes', relatesTo: 'relates to', conflictsWith: 'conflicts with' };
  var token = new URLSearchParams(window.location.search).get('token') || '';
  var query = '?token=' + encodeURIComponent(token);
  var state = null;
  var selected = null;
  var refocus = false;
  var shownFilterKey = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value); }
  /** A value from the repository used as a lookup key: own entries of a fixed list only. */
  function known(values, value) { return typeof value === 'string' && values.indexOf(value) >= 0; }
  function shorten(value, size) { var s = text(value); return s.length > size ? s.slice(0, size - 1) + '…' : s; }

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
  function setMessage(message) { $('message').textContent = text(message); }
  function statusClass(status) { return 'status-' + (known(STATUSES, status) ? status : 'unknown'); }

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

  /** A row's raw review facts, as counts and dates. No verdict is derived from them. */
  function queueFacts(item) {
    var facts = [];
    facts.push('approvals ' + text(item.approvalCount) + ' of quorum ' + (item.quorum === null || item.quorum === undefined ? 'not set' : text(item.quorum)));
    facts.push('objections: ' + text(item.unresolvedObjectionCount) + ' unresolved, ' + text(item.resolvedObjectionCount) + ' resolved');
    facts.push('SLA ' + (text(item.slaState) || 'unknown'));
    facts.push('deadline ' + (item.deadlineDate ? text(item.deadlineDate) : 'none'));
    var targets = list(item.routingTargets).map(text);
    facts.push('routed to ' + (targets.length > 0 ? targets.join(', ') : 'nobody'));
    facts.push(text(item.itemFindingCount) + ' finding(s)');
    return facts;
  }

  function factList(facts) {
    var items = el('ul', 'facts');
    facts.forEach(function (fact) { items.appendChild(el('li', null, fact)); });
    return items;
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
    var statuses = el('ul', 'legend-list');
    statuses.setAttribute('aria-label', 'Status');
    STATUSES.forEach(function (status) {
      var item = el('li', 'legend-item');
      var swatch = svg('svg', { width: 18, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      swatch.appendChild(svg('rect', { x: 1, y: 1, width: 16, height: 10, rx: 2, class: 'node-box ' + statusClass(status) }));
      item.appendChild(swatch);
      item.appendChild(el('span', null, status));
      statuses.appendChild(item);
    });
    node.appendChild(statuses);
    var kinds = el('ul', 'legend-list');
    kinds.setAttribute('aria-label', 'Relationship');
    KINDS.forEach(function (kind) {
      var item = el('li', 'legend-item');
      var sample = svg('svg', { width: 30, height: 12, 'aria-hidden': 'true', class: 'swatch' });
      sample.appendChild(svg('line', { x1: 1, y1: 6, x2: 29, y2: 6, class: 'edge edge-' + kind }));
      item.appendChild(sample);
      item.appendChild(el('span', null, KIND_TEXT[kind] + (kind === 'supersedes' ? ' (solid, arrow to the replaced record)' : kind === 'relatesTo' ? ' (dashed)' : ' (dotted)')));
      kinds.appendChild(item);
    });
    node.appendChild(kinds);
  }

  /** Select a record. The graph is rebuilt, so keyboard focus is put back on it. */
  function select(id) {
    selected = id;
    refocus = true;
    if (state) render(state);
  }

  function drawGraph(graph) {
    var host = $('board');
    clear(host);
    if (!graph) { host.appendChild(el('p', 'muted', 'Loading the decision graph…')); return; }
    if (!graph.available) {
      list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'muted note', note)); });
      return;
    }
    if (graph.mode === 'summary') {
      host.appendChild(el('p', null, text(graph.totalNodes) + ' records and ' + text(graph.totalEdges) + ' relationships. Counts by status:'));
      var counts = el('ul', 'facts');
      list(graph.byStatus).forEach(function (row) { counts.appendChild(el('li', null, text(row.status) + ': ' + text(row.count))); });
      host.appendChild(counts);
      host.appendChild(focusForm());
      list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'muted note', note)); });
      return;
    }
    var nodes = list(graph.nodes);
    if (nodes.length === 0) {
      host.appendChild(el('p', 'muted', 'No records to show.'));
      list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'muted note', note)); });
      return;
    }
    var byId = nodesById(graph);
    var root = svg('svg', {
      width: graph.width, height: graph.height, viewBox: '0 0 ' + text(graph.width) + ' ' + text(graph.height),
      role: 'group', 'aria-label': 'Decision graph: ' + nodes.length + ' records', class: 'board-svg',
    });
    // Only supersession has a direction worth an arrowhead; relatesTo and
    // conflictsWith are drawn as plain lines, as the legend says.
    var defs = svg('defs');
    var marker = svg('marker', { id: 'arrow-supersedes', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow arrow-supersedes' }));
    defs.appendChild(marker);
    root.appendChild(defs);

    var edges = svg('g', { class: 'edges' });
    list(graph.edges).forEach(function (edge) {
      var from = byId.get(text(edge.from)), to = byId.get(text(edge.to));
      if (!from || !to || !known(KINDS, edge.kind)) return;
      var start = edgePoint(from, to), end = edgePoint(to, from);
      var near = selected !== null && (text(edge.from) === selected || text(edge.to) === selected);
      var attrs = { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'edge edge-' + edge.kind + (near ? ' edge-near' : '') };
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
      var g = svg('g', {
        class: 'node ' + statusClass(status) + (isSelected ? ' selected' : '') + (state && state.filter && state.filter.id === id ? ' focused' : ''),
        transform: 'translate(' + text(node.x) + ' ' + text(node.y) + ')',
        tabindex: 0, role: 'button', 'aria-pressed': isSelected ? 'true' : 'false',
        'aria-label': id + ', ' + status + ': ' + text(node.title),
      });
      g.appendChild(svg('title', {}, id + ' (' + status + '): ' + text(node.title)));
      g.appendChild(svg('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 6, class: 'node-box ' + statusClass(status) }));
      g.appendChild(svg('text', { x: 10, y: 20, class: 'node-id' }, id + ' · ' + status));
      g.appendChild(svg('text', { x: 10, y: 40, class: 'node-title' }, shorten(node.title, 30)));
      g.addEventListener('click', function () { select(id); });
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
    host.appendChild(root);
    if (refocus && toFocus && typeof toFocus.focus === 'function') toFocus.focus();
    refocus = false;
    list(graph.notes).forEach(function (note) { host.appendChild(el('p', 'muted note', note)); });
  }

  function focusForm() {
    var form = el('div', 'focus-form');
    var label = el('label', null, 'Focus on record ');
    var input = el('input', 'mono');
    input.type = 'text';
    input.id = 'focus-id';
    input.setAttribute('aria-label', 'Record id to focus on');
    label.appendChild(input);
    form.appendChild(label);
    form.appendChild(button('Focus', function () { focus({ id: text(input.value).trim() }); }));
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
    pane.appendChild(el('h2', null, id));
    pane.appendChild(el('p', 'record-title', node.title));
    var head = el('p');
    head.appendChild(el('span', 'badge status-badge ' + statusClass(node.status), node.status));
    pane.appendChild(head);

    pane.appendChild(el('h3', null, 'Neighbors'));
    var neighbors = el('ul', 'facts');
    list(graph.edges).forEach(function (edge) {
      if (!known(KINDS, edge.kind)) return;
      var other = null, phrase = '';
      if (text(edge.from) === id) { other = text(edge.to); phrase = KIND_TEXT[edge.kind] + ' '; }
      else if (text(edge.to) === id) { other = text(edge.from); phrase = (edge.kind === 'supersedes' ? 'superseded by' : KIND_TEXT[edge.kind] + ' (from)') + ' '; }
      if (other === null) return;
      var item = el('li');
      item.appendChild(el('span', null, phrase));
      var target = other;
      item.appendChild(button(target, function () { select(target); }, 'link'));
      neighbors.appendChild(item);
    });
    if (!neighbors.firstChild) neighbors.appendChild(el('li', 'muted', 'None in this view.'));
    pane.appendChild(neighbors);

    pane.appendChild(el('h3', null, 'Review facts'));
    var row = queueRowFor(id);
    if (row) {
      pane.appendChild(factList(queueFacts(row)));
      if (row.sourcePath) pane.appendChild(el('p', 'mono muted', row.sourcePath));
    } else {
      pane.appendChild(el('p', 'muted', 'Not in the open-proposal queue.'));
    }
    if (!(state.filter && state.filter.id === id)) {
      pane.appendChild(button('Focus on ' + id, function () { focus({ id: id, kinds: currentKinds() }); }));
    }
  }

  function queueSection() {
    var node = $('queue');
    clear(node);
    var queue = state && state.queue;
    node.appendChild(el('h2', null, 'Open proposals, corpus-wide' + (queue && queue.available ? ' (' + list(queue.items).length + ')' : '')));
    if (!queue) { node.appendChild(el('p', 'muted', 'Loading the open-proposal list…')); return; }
    if (!queue.available) { node.appendChild(el('p', 'muted note', queue.note || 'The open-proposal list is unavailable.')); return; }
    node.appendChild(el('p', 'muted', 'Raw review facts from adr queue' + (queue.asOf ? ', as of ' + text(queue.asOf) : '') + '. Listed, not judged.'));
    var items = list(queue.items);
    if (items.length === 0) node.appendChild(el('p', 'muted', 'No proposed record is open.'));
    var rows = el('ul', 'decisions');
    items.forEach(function (item) {
      var row = el('li', 'decision');
      var head = el('div', 'decision-head');
      head.appendChild(el('span', 'record-id mono', item.id));
      head.appendChild(el('span', 'record-title', item.title));
      row.appendChild(head);
      row.appendChild(el('p', 'muted', queueFacts(item).join(' · ')));
      var id = text(item.id);
      if (state.graph && nodesById(state.graph).has(id)) row.appendChild(button('Show ' + id + ' on the board', function () { select(id); }));
      rows.appendChild(row);
    });
    if (items.length > 0) node.appendChild(rows);
    if (queue.corpusFindings > 0) node.appendChild(el('p', 'muted', 'adr queue reported ' + text(queue.corpusFindings) + ' corpus finding(s); adr lint shows them.'));
    if (queue.note) node.appendChild(el('p', 'muted note', queue.note));
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
    $('status').textContent = parts.join(' · ');
    $('cwd').textContent = text(snapshot.workingDirectory);
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
        if (!response.ok) throw new Error((data && data.error) || 'Request failed (' + response.status + ')');
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

/** The board's own rules, after the shared decision-review stylesheet. */
const BOARD_ONLY_CSS = `
.filters { border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 6px; margin: 8px 0 0; padding: 4px 10px 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.filters legend { padding: 0 4px; }
.board-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 320px); gap: 16px; margin-top: 12px; }
@media (max-width: 720px) { .board-layout { grid-template-columns: minmax(0, 1fr); } }
.board-scroll { overflow: auto; max-height: 70vh; border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 6px; }
.board-detail { border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 6px; padding: 8px 12px; align-self: start; }
.board-detail h2 { margin-top: 4px; }
.board-detail h3 { font-size: 0.95em; margin: 12px 0 4px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 24px; margin-bottom: 8px; }
.legend-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.legend-item { display: inline-flex; align-items: center; gap: 4px; }
.swatch { display: inline-block; vertical-align: middle; }
ul.facts { padding-left: 18px; }
button.link { border: none; padding: 0 2px; text-decoration: underline; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); }
.focus-form { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.focus-form input { font: inherit; color: inherit; background: transparent; border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 6px; padding: 2px 6px; }
.board-svg { display: block; }
.node { cursor: pointer; outline: none; }
.node-box { stroke-width: 1.5; }
.node.selected .node-box, .node.focused .node-box { stroke-width: 3; }
.node:focus-visible .node-box { stroke: var(--color-focus-outline, #0969da); stroke-width: 3; }
.node-id { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 12px; fill: var(--text-color-default, #1f2328); }
.node-title { font-size: 12px; fill: var(--text-color-muted, #59636e); }
.status-accepted { fill: var(--true-color-green-muted, rgba(26, 127, 55, 0.12)); stroke: var(--true-color-green, #1a7f37); }
.status-proposed { fill: var(--true-color-blue-muted, rgba(9, 105, 218, 0.12)); stroke: var(--true-color-blue, #0969da); }
.status-draft { fill: var(--background-color-default, #ffffff); stroke: var(--text-color-muted, #59636e); stroke-dasharray: 4 3; }
.status-rejected { fill: var(--true-color-red-muted, rgba(209, 36, 47, 0.12)); stroke: var(--true-color-red, #d1242f); }
.status-superseded { fill: var(--background-color-default, #ffffff); stroke: var(--text-color-muted, #59636e); }
.status-deprecated { fill: var(--true-color-yellow-muted, rgba(154, 103, 0, 0.12)); stroke: var(--true-color-yellow, #9a6700); }
.status-unknown { fill: var(--background-color-default, #ffffff); stroke: var(--border-color-default, #d1d9e0); }
.status-badge { color: var(--text-color-default, #1f2328); }
.edge { stroke: var(--text-color-muted, #59636e); stroke-width: 1.5; fill: none; }
.edge-supersedes { stroke-width: 2; }
.edge-relatesTo { stroke-dasharray: 6 4; }
.edge-conflictsWith { stroke: var(--true-color-red, #d1242f); stroke-dasharray: 2 3; }
.edge-near { stroke-width: 3; }
.arrow { fill: var(--text-color-muted, #59636e); }
`;

/** Stylesheet: decision-review's (the same app tokens) plus the board's rules. */
export const BOARD_CSS = PAGE_CSS + BOARD_ONLY_CSS;
