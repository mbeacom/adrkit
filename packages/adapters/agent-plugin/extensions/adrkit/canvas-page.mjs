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
 * Theme values come from the app's documented canvas tokens, each with a
 * fallback so the page still reads when opened outside the app.
 */

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
    <span id="status" class="badge tone-neutral" role="status" aria-live="polite">loading</span>
  </div>
  <p id="cwd" class="cwd mono muted"></p>
  <div class="buttons">
    <button type="button" id="refresh">Refresh</button>
    <button type="button" id="run-review">Run review (uses AI credits)</button>
  </div>
  <p id="message" class="message" role="alert"></p>
</header>
<main id="app"></main>
<footer class="muted">Read-only and advisory: this view has no exit-code authority.</footer>
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
  var STATUS_TONE = { ok: 'green', findings: 'red', incomplete: 'yellow', 'usage-error': 'red', pending: 'blue' };
  var VERDICT_TONE = { consistent: 'green', conflicts: 'red', unclear: 'yellow' };
  var SEVERITY_TONE = { error: 'red', warn: 'yellow', info: 'blue' };
  var state = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value); }

  /** Every node is built here; text only ever goes through textContent. */
  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = text(content);
    return node;
  }

  function badge(label, tone) { return el('span', 'badge tone-' + (tone || 'neutral'), label); }

  /**
   * Look up a tone by a value that came from the repository or an agent. Own
   * properties only, so a key such as "constructor" finds nothing.
   */
  function toneOf(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  }

  function button(label, onClick) {
    var node = el('button', 'secondary', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function section(title, count) {
    var node = el('section', 'section');
    node.appendChild(el('h2', null, count === undefined ? title : title + ' (' + count + ')'));
    return node;
  }

  function setMessage(message) { $('message').textContent = text(message); }

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

  function decisionItem(decision, verdict, explainable) {
    var item = el('li', 'decision');
    var head = el('div', 'decision-head');
    head.appendChild(el('span', 'record-id mono', decision.recordId));
    head.appendChild(el('span', 'record-title', decision.title));
    if (verdict) head.appendChild(badge(verdict.verdict, toneOf(VERDICT_TONE, verdict.verdict)));
    if (decision.status) head.appendChild(el('span', 'muted', decision.status));
    item.appendChild(head);

    var details = el('details', 'evidence');
    details.appendChild(el('summary', null, 'Evidence'));
    if (verdict) details.appendChild(el('p', 'verdict-evidence', verdict.evidence));
    // Provenance: what tied this record to the change. A marker names its file
    // and line; an affects match names only the pattern, because adr check
    // reports no file for one, so the page does not invent one.
    var matchers = list(decision.firedMatchers);
    if (matchers.length > 0) {
      var matched = el('ul', 'matchers');
      matchers.forEach(function (matcher) { matched.appendChild(el('li', 'mono', describeMatcher(matcher))); });
      details.appendChild(el('p', 'muted', 'Matched by affects pattern:'));
      details.appendChild(matched);
      details.appendChild(el('p', 'muted', 'adr check does not report which changed file matched a pattern.'));
    }
    var declared = list(decision.declaredBy);
    if (declared.length > 0) {
      var declaring = el('ul', 'matchers');
      declared.forEach(function (entry) {
        declaring.appendChild(el('li', 'mono', text(entry.path) + ':' + text(entry.line) + ' names ' + text(entry.ref)));
      });
      details.appendChild(el('p', 'muted', 'Declared by an inbound marker in a changed file:'));
      details.appendChild(declaring);
    }
    if (decision.supersededBy) details.appendChild(el('p', 'muted', 'Superseded by ' + text(decision.supersededBy)));
    if (!verdict && matchers.length === 0 && declared.length === 0) details.appendChild(el('p', 'muted', 'No evidence recorded.'));
    item.appendChild(details);

    if (explainable && /^[0-9]{4}$/.test(text(decision.recordId))) {
      item.appendChild(button('Ask the agent to explain ' + decision.recordId, function () { explain(decision.recordId); }));
    }
    return item;
  }

  function decisionList(title, decisions, verdicts, explainable, empty) {
    var node = section(title, decisions.length);
    if (decisions.length === 0) {
      node.appendChild(el('p', 'muted', empty));
      return node;
    }
    var items = el('ul', 'decisions');
    decisions.forEach(function (decision) { items.appendChild(decisionItem(decision, verdicts.get(text(decision.recordId)), explainable)); });
    node.appendChild(items);
    return node;
  }

  function reviewSection(review) {
    var node = section('Review');
    var line = el('p', 'review-line');
    if (review.runId) {
      line.appendChild(el('span', null, 'adr-review run ' + text(review.runId) + ': '));
      line.appendChild(badge(review.runStatus, review.runStatus === 'completed' ? 'green' : review.runStatus === 'running' || review.runStatus === 'pending' ? 'blue' : 'yellow'));
    } else {
      // The agent handed this over; it may have read hostile repository text,
      // so it is never dressed as a run the panel watched.
      line.appendChild(badge('supplied by the agent', 'neutral'));
      line.appendChild(el('span', 'muted', ' Result supplied by the agent, not a run this panel followed.'));
    }
    if (review.result) {
      line.appendChild(el('span', 'muted', ' result '));
      line.appendChild(badge(review.result.status, toneOf(STATUS_TONE, review.result.status)));
    }
    node.appendChild(line);
    if (review.result) {
      var notes = list(review.result.notes);
      if (notes.length > 0) {
        var items = el('ul', 'notes');
        notes.forEach(function (note) { items.appendChild(el('li', null, note)); });
        node.appendChild(items);
      }
    }
    return node;
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
    node.appendChild(el('p', 'muted', 'Listed, not judged' + (queue.asOf ? ', as of ' + text(queue.asOf) : '') + '.'));
    if (items.length === 0) {
      node.appendChild(el('p', 'muted', 'No proposed record is open.'));
    } else {
      var rows = el('ul', 'decisions');
      items.forEach(function (item) {
        var row = el('li', 'decision');
        var head = el('div', 'decision-head');
        head.appendChild(el('span', 'record-id mono', item.id));
        head.appendChild(el('span', 'record-title', item.title));
        row.appendChild(head);
        var facts = ['SLA ' + (text(item.slaState) || 'unknown')];
        if (item.deadlineDate) facts.push('due ' + text(item.deadlineDate));
        facts.push('approvals ' + text(item.approvalCount) + '/' + (item.quorum === null || item.quorum === undefined ? '-' : text(item.quorum)));
        if (item.unresolvedObjectionCount > 0) facts.push(text(item.unresolvedObjectionCount) + ' unresolved objection(s)');
        var targets = list(item.routingTargets).map(text);
        if (targets.length > 0) facts.push('routed to ' + targets.join(', '));
        row.appendChild(el('p', 'muted', facts.join(' · ')));
        if (item.sourcePath) row.appendChild(el('p', 'mono muted', item.sourcePath));
        rows.appendChild(row);
      });
      node.appendChild(rows);
    }
    if (queue.corpusFindings > 0) {
      node.appendChild(el('p', 'muted', 'adr queue reported ' + text(queue.corpusFindings) + ' corpus finding(s); adr lint shows them.'));
    }
    if (queue.note) node.appendChild(el('p', 'muted note', queue.note));
    return node;
  }

  function findingsSection(findings) {
    var node = section('Findings', findings.length);
    if (findings.length === 0) {
      node.appendChild(el('p', 'muted', 'None.'));
      return node;
    }
    var items = el('ul', 'findings');
    findings.forEach(function (finding) {
      var item = el('li');
      item.appendChild(badge(finding.severity || 'finding', toneOf(SEVERITY_TONE, finding.severity)));
      if (finding.rule) item.appendChild(el('span', 'mono', ' ' + text(finding.rule) + ' '));
      item.appendChild(el('span', null, finding.message));
      if (finding.path) item.appendChild(el('span', 'mono muted', ' ' + text(finding.path)));
      items.appendChild(item);
    });
    node.appendChild(items);
    return node;
  }

  function render(snapshot) {
    state = snapshot;
    var status = text(snapshot.status) || 'unknown';
    var statusNode = $('status');
    statusNode.textContent = status;
    statusNode.className = 'badge tone-' + (toneOf(STATUS_TONE, status) || 'neutral');
    $('cwd').textContent = text(snapshot.workingDirectory);
    $('refresh').disabled = busy;
    var files = list(snapshot.files);
    // Cost before spend: the workflow makes one decision-checker call per
    // governing decision. With no changed files, or nothing governing them, a
    // run would judge nothing, so the button says why and stays disabled.
    var noFiles = files.length === 0;
    var calls = typeof snapshot.judgeCalls === 'number' ? snapshot.judgeCalls : list(snapshot.governing).length;
    var reason = noFiles ? 'No changed files to review' : calls === 0 ? 'No governing decision, so there is nothing to judge' : '';
    var runButton = $('run-review');
    runButton.disabled = busy || status === 'pending' || reason !== '';
    runButton.textContent = noFiles
      ? 'Run review (uses AI credits)'
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

    var parts = [];
    var source = el('p', 'muted', files.length + ' changed file(s) from ' + (text(snapshot.filesSource) || 'nowhere') +
      (snapshot.updatedAt ? ' · updated ' + text(snapshot.updatedAt) : ''));
    parts.push(source);

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
      callout.appendChild(el('strong', null, 'Unverified: '));
      callout.appendChild(el('span', null, unverified.join(', ') + '. No usable verdict, so the review is incomplete.'));
      parts.push(callout);
    }

    parts.push(decisionList('Governing', governingOf(snapshot), verdicts, true, 'No accepted decision governs these files.'));
    parts.push(decisionList('Active proposals', list(snapshot.activeProposals), new Map(), true, 'None.'));
    parts.push(decisionList('History (listed, not judged)', list(snapshot.history), new Map(), true, 'None.'));
    if (snapshot.queue && typeof snapshot.queue === 'object') parts.push(queueSection(snapshot.queue));
    parts.push(findingsSection(list(snapshot.findings)));

    var notes = list(snapshot.notes);
    if (notes.length > 0) {
      var notesNode = section('Notes', notes.length);
      var noteItems = el('ul', 'notes');
      notes.forEach(function (note) { noteItems.appendChild(el('li', null, note)); });
      notesNode.appendChild(noteItems);
      parts.push(notesNode);
    }

    var filesNode = el('details', 'files');
    filesNode.appendChild(el('summary', null, 'Changed files (' + files.length + ')'));
    var fileItems = el('ul', 'mono');
    files.forEach(function (file) { fileItems.appendChild(el('li', null, file)); });
    filesNode.appendChild(fileItems);
    parts.push(filesNode);

    var app = $('app');
    while (app.firstChild) app.removeChild(app.firstChild);
    parts.forEach(function (part) { app.appendChild(part); });
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
      return data;
    }, function (error) {
      busy = false;
      setMessage(error && error.message ? error.message : 'Request failed');
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

/** Stylesheet: documented app tokens only, each with a fallback. */
export const PAGE_CSS = `:root { color-scheme: light dark; }
body {
  margin: 0;
  padding: 12px 16px 24px;
  background: var(--background-color-default, #ffffff);
  color: var(--text-color-default, #1f2328);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--text-body-medium, 14px);
  line-height: var(--leading-body-medium, 20px);
}
.mono, code { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); }
.muted { color: var(--text-color-muted, #59636e); }
h1 { font-size: 1.15em; margin: 0; }
h2 { font-size: 1em; margin: 16px 0 8px; }
.bar { border-bottom: 1px solid var(--border-color-default, #d1d9e0); padding-bottom: 8px; }
.headline { display: flex; align-items: center; gap: 8px; }
.cwd { margin: 4px 0 8px; overflow-wrap: anywhere; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.message:empty { display: none; }
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color-default, #d1d9e0);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
button.secondary { margin-top: 6px; padding: 2px 8px; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--color-focus-outline, #0969da);
  outline-offset: 2px;
}
ul { margin: 0; padding-left: 20px; }
ul.decisions { list-style: none; padding-left: 0; }
.decision { border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.decision-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.record-title { font-weight: 600; overflow-wrap: anywhere; }
.evidence { margin-top: 4px; }
.evidence summary, .files summary { cursor: pointer; }
.verdict-evidence { white-space: pre-wrap; overflow-wrap: anywhere; }
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 0.85em;
  border: 1px solid currentColor;
}
.callout { border-radius: 6px; padding: 8px; margin: 12px 0; border: 1px solid currentColor; }
.tone-neutral { color: var(--text-color-muted, #59636e); }
.tone-green { color: var(--true-color-green, #1a7f37); background: var(--true-color-green-muted, rgba(26, 127, 55, 0.12)); }
.tone-red { color: var(--true-color-red, #d1242f); background: var(--true-color-red-muted, rgba(209, 36, 47, 0.12)); }
.tone-yellow { color: var(--true-color-yellow, #9a6700); background: var(--true-color-yellow-muted, rgba(154, 103, 0, 0.12)); }
.tone-blue { color: var(--true-color-blue, #0969da); background: var(--true-color-blue-muted, rgba(9, 105, 218, 0.12)); }
footer { margin-top: 16px; font-size: 0.85em; }
`;
