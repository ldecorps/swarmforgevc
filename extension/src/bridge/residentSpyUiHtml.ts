// BL-522: Telegram Mini App shell for the swarm live screen (mono-router or
// full stack). Self-contained except telegram-web-app.js. Polls GET
// /resident-pane?token=... on the same origin.

import { MONO_ROUTER_LIVE_SCREEN_NAME } from '../concierge/residentPaneSpy';

export function getResidentSpyUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${MONO_ROUTER_LIVE_SCREEN_NAME}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html {
    height: 100%;
    overflow: hidden;
  }
  body {
    margin: 0;
    height: 100%;
    max-height: 100dvh;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  body.pane-focused {
    height: 100dvh;
    max-height: 100dvh;
  }
  body.pane-focused .ticket-strip {
    display: none;
  }
  .dot {
    position: fixed;
    bottom: max(6px, env(safe-area-inset-bottom));
    left: max(6px, env(safe-area-inset-left));
    z-index: 10;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3fb950;
    pointer-events: none;
  }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  .ticket-strip {
    flex: 0 0 auto;
    padding: 8px 10px;
    padding-top: max(8px, env(safe-area-inset-top));
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #000);
  }
  .ticket-strip-id {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .ticket-strip-title {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .ticket-strip-meta {
    margin-top: 3px;
    font-size: 10px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .split {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: stretch;
    min-height: 0;
    overflow: hidden;
  }
  body.pane-focused .split {
    flex: 1 1 100%;
    height: 100%;
    flex-wrap: nowrap;
  }
  .pane-col {
    flex: 1 1 50%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
  }
  .pane-col.hidden-pane {
    display: none !important;
  }
  body.pane-focused .pane-col.focused {
    flex: 1 1 100% !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: 0 !important;
    height: 100% !important;
    border-right: none;
    border-bottom: none;
  }
  .split.pane-count-3 .pane-col,
  .split.pane-count-4 .pane-col { flex-basis: 33.33%; }
  .split.pane-count-5 .pane-col,
  .split.pane-count-6 .pane-col { flex-basis: 33.33%; min-height: 100px; }
  .split.pane-count-7 .pane-col,
  .split.pane-count-8 .pane-col { flex-basis: 25%; min-height: 90px; }
  .split.pane-count-7 pre,
  .split.pane-count-8 pre { font-size: 9px; padding: 6px; }
  .pane-head {
    flex: 0 0 auto;
    padding: 8px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 20%, transparent);
    word-break: break-word;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }
  .pane-head-main { flex: 1 1 auto; min-width: 0; }
  .pane-expand-hint {
    flex: 0 0 auto;
    font-size: 10px;
    line-height: 1.2;
    padding: 3px 6px;
    border-radius: 4px;
    color: var(--tg-theme-hint-color, #8b949e);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
    white-space: nowrap;
  }
  .split-btn {
    position: fixed;
    top: max(8px, env(safe-area-inset-top));
    right: max(8px, env(safe-area-inset-right));
    z-index: 10;
    font: inherit;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--tg-theme-button-text-color, #fff);
    background: var(--tg-theme-button-color, #2ea043);
    border: none;
    box-shadow: 0 2px 8px color-mix(in srgb, #000 40%, transparent);
  }
  .pane-kind {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--tg-theme-hint-color, #8b949e);
    margin-bottom: 4px;
  }
  .pane-title {
    font-size: 12px;
    line-height: 1.35;
    font-weight: 700;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .split.pane-count-7 .pane-title,
  .split.pane-count-8 .pane-title { font-size: 11px; }
  .pane-ticket {
    margin-top: 4px;
    font-size: 10px;
    line-height: 1.35;
    font-weight: 500;
    color: color-mix(in srgb, var(--tg-theme-text-color, #e6edf3) 88%, var(--tg-theme-hint-color, #8b949e));
  }
  .pane-ticket-id {
    font-weight: 700;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  pre {
    flex: 1 1 auto;
    margin: 0;
    padding: 8px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
    line-height: 1.35;
    min-height: 0;
    -webkit-overflow-scrolling: touch;
  }
  body.pane-focused .pane-col.focused pre {
    flex: 1 1 auto;
    min-height: 0;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
</style>
</head>
<body>
<span id="dot" class="dot" hidden></span>
<div id="ticket-strip" class="ticket-strip" hidden>
  <div class="ticket-strip-id" id="ticket-strip-id"></div>
  <div class="ticket-strip-title" id="ticket-strip-title"></div>
  <div class="ticket-strip-meta" id="ticket-strip-meta"></div>
</div>
<button type="button" class="split-btn" id="split-btn" hidden>All panes</button>
<div class="split" id="pane-split"></div>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var splitEl = document.getElementById('pane-split');
  var dotEl = document.getElementById('dot');
  var splitBtn = document.getElementById('split-btn');
  var ticketStripEl = document.getElementById('ticket-strip');
  var ticketStripIdEl = document.getElementById('ticket-strip-id');
  var ticketStripTitleEl = document.getElementById('ticket-strip-title');
  var ticketStripMetaEl = document.getElementById('ticket-strip-meta');
  var focusPane = null;
  var lastOk = 0;
  var paneCount = 0;
  var claimEnteredByPaneId = {};
  var ticketStripClaimEnteredAtMs = null;
  var ticketStripMetaBase = '';
  var lastPanes = [];

  function applyFocus() {
    document.body.classList.toggle('pane-focused', !!focusPane);
    splitBtn.hidden = !focusPane;
    if (tg) {
      if (focusPane && typeof tg.requestFullscreen === 'function') {
        tg.requestFullscreen();
      } else if (!focusPane && typeof tg.exitFullscreen === 'function') {
        tg.exitFullscreen();
      }
    }
    var cols = splitEl.querySelectorAll('.pane-col');
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      var id = col.getAttribute('data-pane-id');
      var isFocused = !!focusPane && id === focusPane;
      col.classList.toggle('focused', isFocused);
      col.classList.toggle('hidden-pane', !!focusPane && !isFocused);
    }
    var hints = splitEl.querySelectorAll('.pane-expand-hint');
    for (var j = 0; j < hints.length; j++) {
      var paneId = hints[j].getAttribute('data-pane');
      hints[j].textContent = focusPane === paneId ? 'Restore' : 'Expand';
    }
  }

  splitEl.addEventListener('click', function (e) {
    if (e.target.closest('.split-btn')) return;
    var head = e.target.closest('.pane-head');
    if (!head) return;
    var col = head.closest('.pane-col');
    if (!col) return;
    var pane = col.getAttribute('data-pane-id');
    if (!pane) return;
    focusPane = focusPane === pane ? null : pane;
    applyFocus();
    updateTicketStrip(lastPanes);
  });

  splitBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    focusPane = null;
    applyFocus();
    updateTicketStrip(lastPanes);
  });

  function setStatus(kind) {
    dotEl.hidden = false;
    dotEl.className = 'dot' + (kind === 'ok' ? '' : ' ' + kind);
  }

  function tickAge() {
    if (!lastOk) return;
    var s = Math.round((Date.now() - lastOk) / 1000);
    setStatus(s > 5 ? 'stale' : 'ok');
  }

  function formatClaimEnteredAgo(claimEnteredAtMs) {
    var elapsedSec = Math.max(0, Math.floor((Date.now() - claimEnteredAtMs) / 1000));
    if (elapsedSec < 60) return 'entered ' + elapsedSec + 's ago';
    var elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return 'entered ' + elapsedMin + 'm ago';
    var elapsedHr = Math.floor(elapsedMin / 60);
    if (elapsedHr < 48) return 'entered ' + elapsedHr + 'h ago';
    return 'entered ' + Math.floor(elapsedHr / 24) + 'd ago';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizePanes(data) {
    if (data.panes && data.panes.length) {
      return data.panes;
    }
    return [
      { id: 'resident', label: 'Resident', pane: data.resident },
      { id: 'coordinator', label: 'Coordinator', pane: data.coordinator }
    ];
  }

  function pickTicketPane(panes) {
    if (focusPane) {
      for (var i = 0; i < panes.length; i++) {
        if (panes[i].id === focusPane && panes[i].pane && panes[i].pane.ticketId) {
          return panes[i].pane;
        }
      }
    }
    for (var j = 0; j < panes.length; j++) {
      if ((panes[j].id === 'resident' || panes[j].id === 'coder') && panes[j].pane && panes[j].pane.ticketId) {
        return panes[j].pane;
      }
    }
    for (var k = 0; k < panes.length; k++) {
      if (panes[k].pane && panes[k].pane.ticketId) {
        return panes[k].pane;
      }
    }
    return null;
  }

  function updateTicketStrip(panes) {
    var pane = pickTicketPane(panes);
    if (!pane || !pane.ticketId) {
      ticketStripEl.hidden = true;
      ticketStripClaimEnteredAtMs = null;
      ticketStripMetaBase = '';
      return;
    }
    ticketStripEl.hidden = false;
    ticketStripIdEl.textContent = pane.ticketId;
    ticketStripTitleEl.textContent = pane.ticketTitle || '(untitled)';
    ticketStripClaimEnteredAtMs = pane.claimEnteredAtMs || null;
    var meta = pane.roleLabel || '';
    if (pane.modelLabel) {
      meta += (meta ? ' · ' : '') + pane.modelLabel;
    }
    ticketStripMetaBase = meta;
    if (ticketStripClaimEnteredAtMs) {
      meta += (meta ? ' · ' : '') + formatClaimEnteredAgo(ticketStripClaimEnteredAtMs);
    }
    ticketStripMetaEl.textContent = meta;
    ticketStripMetaEl.hidden = !meta;
  }

  function ensurePaneColumns(panes) {
    var ids = panes.map(function (p) { return p.id; }).join(',');
    if (splitEl.getAttribute('data-pane-ids') === ids) {
      return;
    }
    splitEl.setAttribute('data-pane-ids', ids);
    splitEl.className = 'split pane-count-' + panes.length;
    splitEl.innerHTML = '';
    paneCount = panes.length;
    splitBtn.textContent = paneCount > 2 ? 'All panes' : 'Both panes';
    focusPane = null;
    for (var i = 0; i < panes.length; i++) {
      var entry = panes[i];
      var col = document.createElement('section');
      col.className = 'pane-col';
      col.setAttribute('data-pane-id', entry.id);
      var head = document.createElement('div');
      head.className = 'pane-head';
      var pre = document.createElement('pre');
      col.appendChild(head);
      col.appendChild(pre);
      splitEl.appendChild(col);
    }
    applyFocus();
  }

  function renderPane(pane, headEl, paneEl, label, paneId, showClaimEntered) {
    if (!pane || pane.available === false) {
      headEl.textContent = label + ' (unavailable)';
      paneEl.textContent = '(pane not reachable)';
      return;
    }
    var title = pane.roleLabel || 'unknown';
    if (pane.modelLabel) {
      title += ' on ' + pane.modelLabel;
    }
    if (showClaimEntered && pane.claimEnteredAtMs) {
      title += ' · ' + formatClaimEnteredAgo(pane.claimEnteredAtMs);
      claimEnteredByPaneId[paneId] = pane.claimEnteredAtMs;
    } else {
      delete claimEnteredByPaneId[paneId];
    }
    var html = '<div class="pane-head-main">';
    html += '<div class="pane-kind">' + escapeHtml(label) + '</div>';
    html += '<div class="pane-title">' + escapeHtml(title) + '</div>';
    if (pane.ticketId) {
      html += '<div class="pane-ticket"><span class="pane-ticket-id">' + escapeHtml(pane.ticketId) + '</span>';
      if (pane.ticketTitle) {
        html += ' — ' + escapeHtml(pane.ticketTitle);
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<span class="pane-expand-hint" data-pane="' + escapeHtml(paneId) + '">Expand</span>';
    headEl.innerHTML = html;
    paneEl.textContent = pane.paneText || '(empty)';
  }

  function renderAllPanes(panes) {
    ensurePaneColumns(panes);
    var cols = splitEl.querySelectorAll('.pane-col');
    for (var i = 0; i < panes.length; i++) {
      var col = cols[i];
      if (!col) continue;
      var showClaim = panes[i].id === 'resident' || panes[i].id === 'coder';
      renderPane(
        panes[i].pane,
        col.querySelector('.pane-head'),
        col.querySelector('pre'),
        panes[i].label,
        panes[i].id,
        showClaim
      );
    }
    updateTicketStrip(panes);
  }

  function refresh() {
    fetch('/resident-pane?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) {
          setStatus('err');
          return;
        }
        var panes = normalizePanes(data);
        lastPanes = panes;
        renderAllPanes(panes);
        if (!data.available) {
          setStatus('err');
        } else {
          lastOk = Date.now();
          setStatus('ok');
        }
      })
      .catch(function () {
        setStatus('err');
      });
  }

  refresh();
  setInterval(refresh, 1500);
  setInterval(tickAge, 500);
  setInterval(function () {
    for (var paneId in claimEnteredByPaneId) {
      if (!Object.prototype.hasOwnProperty.call(claimEnteredByPaneId, paneId)) continue;
      var col = splitEl.querySelector('.pane-col[data-pane-id="' + paneId + '"]');
      if (!col) continue;
      var titleEl = col.querySelector('.pane-title');
      if (!titleEl) continue;
      var base = titleEl.textContent.replace(/ · entered .*$/, '');
      titleEl.textContent = base + ' · ' + formatClaimEnteredAgo(claimEnteredByPaneId[paneId]);
    }
    if (ticketStripClaimEnteredAtMs && !ticketStripEl.hidden) {
      ticketStripMetaEl.textContent = ticketStripMetaBase
        ? ticketStripMetaBase + ' · ' + formatClaimEnteredAgo(ticketStripClaimEnteredAtMs)
        : formatClaimEnteredAgo(ticketStripClaimEnteredAtMs);
    }
  }, 1000);
})();
</script>
</body>
</html>`;
}
