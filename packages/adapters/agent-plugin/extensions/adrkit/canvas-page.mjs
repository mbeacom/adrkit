// @ts-check
/**
 * The `decision-review` canvas page: HTML, browser script, and stylesheet,
 * shipped as strings so the server needs no filesystem lookup at runtime.
 *
 * Everything the page shows — ADR titles, evidence, paths, notes, CLI messages
 * — is repository content, and repository content is untrusted. The script
 * therefore builds DOM with `createElement` and `textContent` only. It never
 * parses a string as HTML, and the canvas test fails if any HTML-parsing sink
 * appears here. The Content-Security-Policy the server sends allows only these
 * same-origin files, so there is no inline script or style either.
 *
 * The stylesheet is the shared canvas theme (canvas-theme.mjs) plus this
 * page's own rules: app tokens first, with light and dark fallbacks, and no
 * inline style anywhere, so every state is a class.
 */

import { THEME_CSS } from './canvas-theme.mjs';

const TOKEN_SLOT = '__ADRKIT_TOKEN__';

/**
 * The page shell. The only substitution is the instance token, which the
 * server generated (64 hex characters); `renderPage` refuses anything else.
 * Asset URLs carry it because every route, assets included, checks it.
 */
export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decision review</title>
<link rel="stylesheet" href="/app.css?token=${TOKEN_SLOT}">
<script src="/app.js?token=${TOKEN_SLOT}" defer></script>
</head>
<body>
<header class="bar">
  <div class="headline">
    <h1>Decision review</h1>
    <span id="status" class="badge lg tone-neutral glyph-wait" role="status" aria-live="polite">loading</span>
  </div>
  <div id="meta" class="meta"></div>
  <p id="cwd" class="cwd mono"></p>
  <div class="buttons">
    <button type="button" id="run-review" class="primary" disabled>Run review (uses AI credits)</button>
    <button type="button" id="refresh" class="secondary">Refresh</button>
  </div>
  <p id="cost" class="cost"></p>
  <p id="message" class="message" role="alert"></p>
</header>
<main id="app"></main>
<footer>Read-only and advisory: this view has no exit-code authority.</footer>
</body>
</html>
`;

/**
 * @param {string} token
 * @returns {string}
 */
export function renderPage(token) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('the page token must be 64 hex characters');
  return PAGE_HTML.split(TOKEN_SLOT).join(token);
}


/** Browser script. Plain ES2017, no modules, no dependencies. */
export const PAGE_JS = `(function () {
  'use strict';

  var token = new URLSearchParams(window.location.search).get('token') || '';
  var query = '?token=' + encodeURIComponent(token);
  // Each status, verdict, and severity has a hue and a glyph, and is always
  // shown with its text label too: colour is never the only signal.
  var STATUS_TONE = { ok: 'green', findings: 'red', incomplete: 'yellow', 'usage-error': 'red', pending: 'blue' };
  var STATUS_GLYPH = { ok: 'check', findings: 'cross', incomplete: 'bang', 'usage-error': 'cross', pending: 'wait' };
  var VERDICT_TONE = { consistent: 'green', conflicts: 'red', unclear: 'yellow' };
  var VERDICT_GLYPH = { consistent: 'check', conflicts: 'cross', unclear: 'ask' };
  var SEVERITY_TONE = { error: 'red', warn: 'yellow', info: 'blue' };
  var SEVERITY_GLYPH = { error: 'cross', warn: 'bang', info: 'info' };
  var SEVERITY_TITLE = { error: 'Errors', warn: 'Warnings', info: 'Information' };
  var SEVERITIES = ['error', 'warn', 'info'];
  var RECORD_TONE = { accepted: 'green', proposed: 'blue', draft: 'neutral', rejected: 'red', superseded: 'purple', deprecated: 'yellow' };
  var RECORD_GLYPH = { accepted: 'check', proposed: 'half', draft: 'ring', rejected: 'cross', superseded: 'arrow', deprecated: 'bang' };
  var state = null;
  var busy = false;
  var loaded = false;

  function $(id) { return document.getElementById(id); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value); }
  function plural(n, noun) { return n + ' ' + noun + (n === 1 ? '' : 's'); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /** Every node is built here; text only ever goes through textContent. */
  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }

  /**
   * Look up a tone by a value that came from the repository or an agent. Own
   * properties only, so a key such as "constructor" finds nothing.
   */
  function toneOf(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  }

  /** A badge: hue, glyph, and the text label. */
  function badge(label, tone, glyph, extra) {
    return el('span', 'badge tone-' + (tone || 'neutral') + (glyph ? ' glyph-' + glyph : '') + (extra ? ' ' + extra : ''), label);
  }
  function recordBadge(status) {
    var key = text(status);
    return badge(key || 'unknown', toneOf(RECORD_TONE, key), toneOf(RECORD_GLYPH, key) || 'ask');
  }

  function button(label, onClick) {
    var node = el('button', 'secondary', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  /** A section whose heading carries its count in the same text, "Title (n)". */
  function section(title, count, lede) {
    var node = el('section', 'section');
    var head = el('div', 'section-head');
    head.appendChild(el('h2', null, count === undefined ? title : title + ' (' + count + ')'));
    node.appendChild(head);
    if (lede) node.appendChild(el('p', 'lede', lede));
    return node;
  }

  function setMessage(message) { $('message').textContent = text(message); }

  function chip(kind, value) {
    var node = el('span', 'chip');
    node.appendChild(el('span', 'chip-kind', kind));
    node.appendChild(el('span', 'mono', value));
    return node;
  }

  function describeMatcher(matcher) {
    if (!matcher || typeof matcher !== 'object') return text(matcher);
    var detail = matcher.pattern || matcher.glob || matcher.path || matcher.symbol || matcher.value;
    return text(matcher.type || 'matcher') + (detail ? ': ' + text(detail) : '');
  }

  /** Verdicts keyed by record id in a Map, since the ids are untrusted text. */
  function verdictsById(review) {
    var verdicts = new Map();
    if (review && review.result) {
      list(review.result.verdicts).forEach(function (verdict) { verdicts.set(text(verdict.recordId), verdict); });
    }
    return verdicts;
  }

  /** The check's governing list, plus any the review judged that the check no longer lists. */
  function governingOf(snapshot) {
    var seen = new Set();
    var out = [];
    list(snapshot.governing).forEach(function (decision) { seen.add(text(decision.recordId)); out.push(decision); });
    if (snapshot.review && snapshot.review.result) {
      list(snapshot.review.result.governing).forEach(function (decision) {
        if (!seen.has(text(decision.recordId))) { seen.add(text(decision.recordId)); out.push(decision); }
      });
    }
    return out;
  }

  /**
   * One record as a card: id, title, status, verdict, then what tied it to
   * the change. A marker names its file and line; an affects match names only
   * the pattern, because adr check reports no file for one, so the page does
   * not invent one (ADR-0047).
   */
  function decisionItem(decision, verdict, explainable) {
    var item = el('li', 'card decision');
    var head = el('div', 'card-head');
    head.appendChild(el('span', 'record-id', decision.recordId));
    head.appendChild(el('span', 'record-title', decision.title));
    item.appendChild(head);
    var badges = el('div', 'chips');
    if (decision.status) badges.appendChild(recordBadge(decision.status));
    if (verdict) badges.appendChild(badge(text(verdict.verdict) || 'no verdict', toneOf(VERDICT_TONE, verdict.verdict), toneOf(VERDICT_GLYPH, verdict.verdict) || 'ask'));
    if (decision.supersededBy) badges.appendChild(chip('superseded by', decision.supersededBy));
    if (badges.firstChild) item.appendChild(badges);

    var provenance = el('div', 'provenance');
    var matchers = list(decision.firedMatchers);
    var declared = list(decision.declaredBy);
    if (matchers.length > 0) {
      provenance.appendChild(el('p', 'small muted', 'Matched by affects pattern:'));
      var matched = el('div', 'chips');
      matchers.forEach(function (matcher) { matched.appendChild(chip('affects', describeMatcher(matcher))); });
      provenance.appendChild(matched);
      provenance.appendChild(el('p', 'small muted', 'adr check does not report which changed file matched a pattern.'));
    }
    if (declared.length > 0) {
      provenance.appendChild(el('p', 'small muted', 'Declared by an inbound marker in a changed file:'));
      var declaring = el('div', 'chips');
      declared.forEach(function (entry) {
        declaring.appendChild(chip('marker', text(entry.path) + ':' + text(entry.line) + ' names ' + text(entry.ref)));
      });
      provenance.appendChild(declaring);
    }
    if (!verdict && matchers.length === 0 && declared.length === 0) provenance.appendChild(el('p', 'small muted', 'No evidence recorded.'));
    item.appendChild(provenance);

    if (verdict && text(verdict.evidence)) {
      var details = el('details', 'evidence');
      details.appendChild(el('summary', null, 'Reviewer evidence'));
      details.appendChild(el('p', 'verdict-evidence', verdict.evidence));
      item.appendChild(details);
    }

    if (explainable && /^[0-9]{4}$/.test(text(decision.recordId))) {
      var actions = el('div', 'card-actions');
      actions.appendChild(button('Ask the agent to explain ' + decision.recordId, function () { explain(decision.recordId); }));
      item.appendChild(actions);
    }
    return item;
  }

  function decisionList(title, decisions, verdicts, explainable, empty, lede) {
    var node = section(title, decisions.length, lede);
    if (decisions.length === 0) {
      node.appendChild(el('p', 'muted none', empty));
      return node;
    }
    var items = el('ul', 'cards');
    decisions.forEach(function (decision) { items.appendChild(decisionItem(decision, verdicts.get(text(decision.recordId)), explainable)); });
    node.appendChild(items);
    return node;
  }

  function reviewSection(review) {
    var node = section('Review');
    var card = el('div', 'card review-card');
    var line = el('div', 'card-head');
    if (review.runId) {
      line.appendChild(el('span', 'mono small', 'adr-review run ' + text(review.runId)));
      var run = text(review.runStatus);
      line.appendChild(badge(run || 'unknown', run === 'completed' ? 'green' : run === 'running' || run === 'pending' ? 'blue' : 'yellow', run === 'completed' ? 'check' : run === 'running' || run === 'pending' ? 'wait' : 'bang'));
    } else {
      // The agent handed this over; it may have read hostile repository text,
      // so it is never dressed as a run the panel watched.
      line.appendChild(badge('supplied by the agent', 'neutral', 'ask'));
      line.appendChild(el('span', 'small muted', 'Result supplied by the agent, not a run this panel followed.'));
    }
    if (review.result) {
      line.appendChild(el('span', 'small muted', 'result'));
      line.appendChild(badge(text(review.result.status) || 'unknown', toneOf(STATUS_TONE, review.result.status), toneOf(STATUS_GLYPH, review.result.status)));
    }
    card.appendChild(line);
    if (review.result) {
      var notes = list(review.result.notes);
      if (notes.length > 0) {
        var items = el('ul', 'notes');
        notes.forEach(function (note) { items.appendChild(el('li', null, note)); });
        card.appendChild(items);
      }
    }
    node.appendChild(card);
    return node;
  }

  /** Approvals against quorum as a row of dots plus the number; no verdict on them. */
  function approvalFacts(item) {
    var wrap = el('span', 'approvals');
    var have = typeof item.approvalCount === 'number' && item.approvalCount > 0 ? Math.floor(item.approvalCount) : 0;
    var need = typeof item.quorum === 'number' && item.quorum > 0 ? Math.floor(item.quorum) : 0;
    var dots = el('span', 'dots');
    for (var i = 0; i < Math.min(Math.max(have, need), 12); i++) dots.appendChild(el('span', i < have ? 'dot on' : 'dot'));
    if (dots.firstChild) wrap.appendChild(dots);
    wrap.appendChild(el('span', null, 'approvals ' + text(item.approvalCount) + '/' + (item.quorum === null || item.quorum === undefined ? '-' : text(item.quorum))));
    return wrap;
  }

  /**
   * Open proposed records, corpus-wide, from adr queue. Listed only: no button,
   * no action, and no explain, so nothing here reaches the agent. Titles and
   * paths are untrusted text like everything else.
   */
  function queueSection(queue) {
    var items = list(queue.items);
    var node = section('Open proposals, corpus-wide', queue.available ? items.length : undefined);
    if (!queue.available) {
      node.appendChild(el('p', 'muted note', queue.note || 'The open-proposal list is unavailable.'));
      return node;
    }
    node.appendChild(el('p', 'lede', 'Listed, not judged' + (queue.asOf ? ', as of ' + text(queue.asOf) : '') + '.'));
    if (items.length === 0) {
      node.appendChild(el('p', 'muted none', 'No proposed record is open.'));
    } else {
      var rows = el('ul', 'cards');
      items.forEach(function (item) {
        var row = el('li', 'card queue-row');
        var head = el('div', 'card-head');
        head.appendChild(el('span', 'record-id', item.id));
        head.appendChild(el('span', 'record-title', item.title));
        row.appendChild(head);
        var facts = el('div', 'facts-row');
        facts.appendChild(approvalFacts(item));
        facts.appendChild(el('span', null, 'SLA ' + (text(item.slaState) || 'unknown')));
        if (item.deadlineDate) facts.appendChild(el('span', null, 'due ' + text(item.deadlineDate)));
        if (item.unresolvedObjectionCount > 0) facts.appendChild(el('span', 'objections-open', text(item.unresolvedObjectionCount) + ' unresolved objection(s)'));
        var targets = list(item.routingTargets).map(text);
        if (targets.length > 0) facts.appendChild(el('span', null, 'routed to ' + targets.join(', ')));
        row.appendChild(facts);
        if (item.sourcePath) row.appendChild(el('p', 'mono small muted path', item.sourcePath));
        rows.appendChild(row);
      });
      node.appendChild(rows);
    }
    if (queue.corpusFindings > 0) {
      node.appendChild(el('p', 'small muted', 'adr queue reported ' + text(queue.corpusFindings) + ' corpus finding(s); adr lint shows them.'));
    }
    if (queue.note) node.appendChild(el('p', 'small muted note', queue.note));
    return node;
  }

  /** Findings grouped by severity, errors first; an unknown severity is listed last. */
  function findingsSection(findings) {
    var node = section('Findings', findings.length);
    if (findings.length === 0) {
      node.appendChild(el('p', 'muted none', 'None.'));
      return node;
    }
    var groups = new Map();
    findings.forEach(function (finding) {
      var key = SEVERITIES.indexOf(text(finding.severity)) >= 0 ? text(finding.severity) : 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(finding);
    });
    SEVERITIES.concat(['other']).forEach(function (key) {
      var group = groups.get(key);
      if (!group) return;
      var block = el('div', 'finding-group');
      block.appendChild(el('h3', null, (toneOf(SEVERITY_TITLE, key) || 'Other') + ' (' + group.length + ')'));
      var items = el('ul', 'cards');
      group.forEach(function (finding) {
        var item = el('li', 'card finding');
        var head = el('div', 'card-head');
        head.appendChild(badge(text(finding.severity) || 'finding', toneOf(SEVERITY_TONE, finding.severity), toneOf(SEVERITY_GLYPH, finding.severity) || 'ask'));
        if (finding.rule) head.appendChild(el('span', 'mono small', text(finding.rule)));
        item.appendChild(head);
        item.appendChild(el('p', null, finding.message));
        if (finding.path) item.appendChild(el('p', 'mono small muted path', finding.path));
        items.appendChild(item);
      });
      block.appendChild(items);
      node.appendChild(block);
    });
    return node;
  }

  function emptyState(title, body) {
    var node = el('div', 'empty');
    node.appendChild(el('strong', null, title));
    node.appendChild(el('span', null, body));
    return node;
  }

  /**
   * The error state: the server's own fixed messages (the notes), shown first
   * and open. Exception text never reaches a snapshot, so nothing here is one.
   */
  function errorState(notes) {
    var node = el('div', 'callout tone-red error-state');
    node.setAttribute('role', 'alert');
    node.appendChild(el('p', 'callout-title glyph-cross', 'The check could not run'));
    if (notes.length === 0) {
      node.appendChild(el('p', null, 'adr check or adr lint did not succeed. Refresh to try again.'));
    } else {
      var items = el('ul', 'notes');
      notes.forEach(function (note) { items.appendChild(el('li', null, note)); });
      node.appendChild(items);
    }
    return node;
  }

  function renderMeta(snapshot, fileCount) {
    var meta = $('meta');
    if (!meta) return;
    clear(meta);
    meta.appendChild(el('span', null, plural(fileCount, 'changed file')));
    meta.appendChild(el('span', null, 'from ' + (text(snapshot.filesSource) || 'nowhere')));
    if (snapshot.updatedAt) meta.appendChild(el('span', null, 'updated ' + text(snapshot.updatedAt)));
  }

  function render(snapshot) {
    state = snapshot;
    loaded = true;
    var status = text(snapshot.status) || 'unknown';
    var statusNode = $('status');
    statusNode.textContent = status;
    statusNode.className = 'badge lg tone-' + (toneOf(STATUS_TONE, status) || 'neutral') + ' glyph-' + (toneOf(STATUS_GLYPH, status) || 'ask');
    var cwd = $('cwd');
    cwd.textContent = text(snapshot.workingDirectory);
    cwd.title = text(snapshot.workingDirectory);
    $('refresh').disabled = busy;
    var files = list(snapshot.files);
    // A wide change lists at most a fixed number of paths; the rest are counted.
    var omitted = typeof snapshot.filesOmitted === 'number' && snapshot.filesOmitted > 0 ? snapshot.filesOmitted : 0;
    var fileCount = files.length + omitted;
    renderMeta(snapshot, fileCount);
    // Cost before spend: the workflow makes one decision-checker call per
    // governing decision. With no changed files, or nothing governing them, a
    // run would judge nothing, so the button says why and stays disabled.
    var noFiles = files.length === 0;
    var calls = typeof snapshot.judgeCalls === 'number' ? snapshot.judgeCalls : list(snapshot.governing).length;
    // Governing records with no calls means the check or lint failed, and the
    // workflow skips its Judge in that case.
    var skipped = calls === 0 && list(snapshot.governing).length > 0;
    var reason = noFiles
      ? 'No changed files to review'
      : skipped
        ? 'adr check or adr lint did not succeed, so the review would make no decision-checker calls'
        : calls === 0
          ? 'No governing decision, so there is nothing to judge'
          : '';
    var runButton = $('run-review');
    runButton.disabled = busy || status === 'pending' || reason !== '';
    runButton.textContent = noFiles
      ? 'Run review (uses AI credits)'
      : skipped
        ? 'Run review: no decision-checker calls (adr check or adr lint failed)'
        : calls === 0
          ? 'Run review: nothing to judge'
          : 'Run review: ' + calls + ' decision-checker call' + (calls === 1 ? '' : 's') + ' (uses AI credits)';
    if (reason) {
      runButton.title = reason;
      runButton.setAttribute('aria-description', reason);
    } else {
      runButton.title = '';
      runButton.removeAttribute('aria-description');
    }
    var cost = $('cost');
    if (cost) {
      cost.className = 'cost' + (reason ? ' off' : '');
      cost.textContent = reason
        ? reason + '. Refresh is free.'
        : 'A review costs ' + plural(calls, 'decision-checker call') + ' (AI credits), one per governing decision. Refresh is free.';
    }

    var parts = [];
    var notes = list(snapshot.notes);
    var failed = status === 'usage-error';
    if (failed) parts.push(errorState(notes));
    else if (noFiles) parts.push(emptyState('No changed files', 'Nothing in this change to review. Edit a file, or open the panel where the change is, then refresh.'));

    if (snapshot.review) parts.push(reviewSection(snapshot.review));

    // Governing records the review gave no verdict, plus the ones it reported
    // as unverified itself: either way they were not judged.
    var verdicts = verdictsById(snapshot.review);
    var unverified = [];
    if (snapshot.review && snapshot.review.result) {
      list(snapshot.review.result.unverified).forEach(function (id) { if (unverified.indexOf(text(id)) < 0) unverified.push(text(id)); });
      list(snapshot.governing).forEach(function (decision) {
        var id = text(decision.recordId);
        if (!verdicts.has(id) && unverified.indexOf(id) < 0) unverified.push(id);
      });
    }
    if (unverified.length > 0) {
      var callout = el('div', 'callout tone-yellow');
      callout.setAttribute('role', 'note');
      callout.appendChild(el('p', 'callout-title glyph-bang', 'Unverified: ' + unverified.join(', ')));
      callout.appendChild(el('p', null, 'No usable verdict, so the review is incomplete.'));
      parts.push(callout);
    }

    parts.push(decisionList('Governing', governingOf(snapshot), verdicts, true, 'No accepted decision governs these files.'));
    parts.push(findingsSection(list(snapshot.findings)));
    parts.push(decisionList('Active proposals', list(snapshot.activeProposals), new Map(), true, 'None.'));
    parts.push(decisionList('History (listed, not judged)', list(snapshot.history), new Map(), true, 'None.'));
    if (snapshot.queue && typeof snapshot.queue === 'object') parts.push(queueSection(snapshot.queue));

    // Notes are collapsed by default; in the error state they are the error,
    // shown open above, so they are not repeated here.
    if (notes.length > 0 && !failed) {
      var notesNode = el('details', 'section notes-block');
      notesNode.appendChild(el('summary', null, 'Notes (' + notes.length + ')'));
      var noteItems = el('ul', 'notes');
      notes.forEach(function (note) { noteItems.appendChild(el('li', null, note)); });
      notesNode.appendChild(noteItems);
      parts.push(notesNode);
    }

    var filesNode = el('details', 'section files');
    filesNode.appendChild(el('summary', null, 'Changed files (' + fileCount + ')'));
    var fileItems = el('ul', 'mono small');
    files.forEach(function (file) { fileItems.appendChild(el('li', null, file)); });
    if (omitted > 0) fileItems.appendChild(el('li', 'muted', '+' + omitted + ' more'));
    filesNode.appendChild(fileItems);
    parts.push(filesNode);

    var app = $('app');
    clear(app);
    parts.forEach(function (part) { app.appendChild(part); });
  }

  /** Before the first snapshot: a distinct loading state, not a blank page. */
  function renderLoading() {
    if (loaded) return;
    var app = $('app');
    clear(app);
    var node = el('div', 'loading');
    node.setAttribute('aria-busy', 'true');
    node.appendChild(el('span', 'spinner'));
    node.appendChild(el('span', null, 'Reading the change and running adr check…'));
    app.appendChild(node);
  }

  function post(path, body) {
    return fetch(path + query, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Adrkit-Token': token },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        // The server's own fixed message, carried on a field of its own so a
        // browser exception's text is never what the page shows.
        if (!response.ok) throw { shown: (data && typeof data.error === 'string' && data.error) || 'Request failed (' + response.status + ')' };
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
      return data;
    }, function (error) {
      busy = false;
      setMessage(error && typeof error.shown === 'string' ? error.shown : 'Request failed');
      if (state) render(state);
      return null;
    });
  }

  function explain(recordId) {
    act('/api/explain', { recordId: recordId }, 'Asking the agent about ' + recordId + '…').then(function (data) {
      if (data && data.ok) setMessage('Sent to the agent: explain ' + recordId + '.');
    });
  }

  $('refresh').addEventListener('click', function () { act('/api/refresh', {}, 'Refreshing…'); });
  $('run-review').addEventListener('click', function () { act('/api/run-review', {}, 'Starting adr-review…'); });

  renderLoading();
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

/** decision-review's own rules, after the shared stylesheet. */
const REVIEW_ONLY_CSS = `
.cost { margin: 0; font-size: var(--fs-sm); color: var(--c-text); }
.cost.off { color: var(--c-muted); }
.cost:empty { display: none; }
.provenance { margin-top: var(--sp-2); }
.provenance .chips { margin-top: var(--sp-1); }
.card-actions { margin-top: var(--sp-2); }
.evidence { margin-top: var(--sp-2); }
.verdict-evidence { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: var(--sp-2) var(--sp-3); background: var(--c-surface); border-radius: var(--r-md); }
.none { margin: 0; }
.finding-group + .finding-group { margin-top: var(--sp-3); }
.finding-group h3 { margin-bottom: var(--sp-2); }
.finding p { margin: var(--sp-1) 0 0; overflow-wrap: anywhere; }
.path { overflow-wrap: anywhere; margin: var(--sp-1) 0 0; }
.facts-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1) var(--sp-3); margin-top: var(--sp-2); font-size: var(--fs-sm); color: var(--c-muted); }
.objections-open { color: var(--c-yellow); font-weight: 600; }
.approvals { display: inline-flex; align-items: center; gap: 6px; }
.dots { display: inline-flex; gap: 3px; }
.dot { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--c-green); background: transparent; }
.dot.on { background: var(--c-green); }
.notes { margin: var(--sp-1) 0 0; padding-left: 20px; }
.notes li + li { margin-top: var(--sp-1); }
.error-state { margin-top: var(--sp-4); }
.files ul { margin-top: var(--sp-1); }
.loading { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-6) var(--sp-4); color: var(--c-muted); border: 1px dashed var(--c-border); border-radius: var(--r-lg); margin-top: var(--sp-4); }
.spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--c-border); border-top-color: var(--c-blue); animation: ak-spin 0.9s linear infinite; flex: none; }
@keyframes ak-spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) {
  body { padding: var(--sp-3) var(--sp-3) var(--sp-4); }
  .buttons button { flex: 1 1 auto; }
}
`;

/** Stylesheet: the shared canvas theme, then decision-review's own rules. */
export const PAGE_CSS = THEME_CSS + REVIEW_ONLY_CSS;
