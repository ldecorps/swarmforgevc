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
  :root {
    color-scheme: dark;
    --app-height: 100dvh;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: var(--app-height);
    max-height: var(--app-height);
    overflow: hidden;
  }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    display: flex;
    flex-direction: column;
  }
  .dot {
    position: fixed;
    bottom: max(6px, env(safe-area-inset-bottom));
    left: max(6px, env(safe-area-inset-left));
    z-index: 40;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3fb950;
    pointer-events: none;
  }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  .split-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  body.pane-fullscreen-active .split-view {
    display: none;
  }
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
  .pane-col {
    flex: 1 1 50%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
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
    -webkit-tap-highlight-color: transparent;
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
  .pane-fullscreen {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 30;
    flex-direction: column;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    padding:
      max(0px, env(safe-area-inset-top))
      max(0px, env(safe-area-inset-right))
      max(0px, env(safe-area-inset-bottom))
      max(0px, env(safe-area-inset-left));
  }
  body.pane-fullscreen-active .pane-fullscreen {
    display: flex;
  }
  .fs-top {
    flex: 0 0 auto;
    padding: 8px 10px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #000);
  }
  .fs-restore {
    font: inherit;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--tg-theme-button-text-color, #fff);
    background: var(--tg-theme-button-color, #2ea043);
    border: none;
    margin-bottom: 8px;
  }
  #fs-pre {
    flex: 1 1 auto;
    min-height: 0;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
</style>
</head>
<body>
<span id="dot" class="dot" hidden></span>
<div class="split-view" id="split-view">
  <div id="ticket-strip" class="ticket-strip" hidden>
    <div class="ticket-strip-id" id="ticket-strip-id"></div>
    <div class="ticket-strip-title" id="ticket-strip-title"></div>
    <div class="ticket-strip-meta" id="ticket-strip-meta"></div>
  </div>
  <div class="split" id="pane-split"></div>
</div>
<div id="pane-fullscreen" class="pane-fullscreen" hidden>
  <div class="fs-top" id="fs-top">
    <button type="button" class="fs-restore" id="fs-restore">Both panes</button>
    <div id="fs-head"></div>
  </div>
  <pre id="fs-pre"></pre>
</div>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
  }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var splitEl = document.getElementById('pane-split');
  var dotEl = document.getElementById('dot');
  var ticketStripEl = document.getElementById('ticket-strip');
  var ticketStripIdEl = document.getElementById('ticket-strip-id');
  var ticketStripTitleEl = document.getElementById('ticket-strip-title');
  var ticketStripMetaEl = document.getElementById('ticket-strip-meta');
  var paneFullscreenEl = document.getElementById('pane-fullscreen');
  var fsTopEl = document.getElementById('fs-top');
  var fsHeadEl = document.getElementById('fs-head');
  var fsPreEl = document.getElementById('fs-pre');
  var fsRestoreBtn = document.getElementById('fs-restore');
  var focusPane = null;
  var lastOk = 0;
  var paneCount = 0;
  var claimEnteredByPaneId = {};
  var ticketStripClaimEnteredAtMs = null;
  var ticketStripMetaBase = '';
  var fsClaimEnteredAtMs = null;
  var fsTitleBase = '';
  var lastPanes = [];

  function applyViewportHeight() {
    if (!tg) return;
    var h = tg.viewportStableHeight || tg.viewportHeight;
    if (h && h > 0) {
      document.documentElement.style.setProperty('--app-height', h + 'px');
    }
  }

  if (tg && typeof tg.onEvent === 'function') {
    tg.onEvent('viewportChanged', applyViewportHeight);
    if (typeof tg.on === 'function') tg.on('viewportChanged', applyViewportHeight);
  }
  applyViewportHeight();

  function enterTelegramFullscreen() {
    if (!tg) return;
    tg.expand();
    applyViewportHeight();
    if (typeof tg.requestFullscreen === 'function') {
      tg.requestFullscreen();
    }
  }

  function exitTelegramFullscreen() {
    if (!tg) return;
    if (typeof tg.exitFullscreen === 'function' && tg.isFullscreen) {
      tg.exitFullscreen();
    }
    tg.expand();
    applyViewportHeight();
  }

  function paneEntryById(paneId) {
    for (var i = 0; i < lastPanes.length; i++) {
      if (lastPanes[i].id === paneId) return lastPanes[i];
    }
    return null;
  }

  function buildPaneHeadHtml(pane, label, paneId, showClaimEntered) {
    if (!pane || pane.available === false) {
      return '<div class="pane-kind">' + escapeHtml(label) + '</div><div class="pane-title">' + escapeHtml(label) + ' (unavailable)</div>';
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
    var html = '<div class="pane-kind">' + escapeHtml(label) + '</div>';
    html += '<div class="pane-title" data-pane-title="' + escapeHtml(paneId) + '">' + escapeHtml(title) + '</div>';
    if (pane.ticketId) {
      html += '<div class="pane-ticket"><span class="pane-ticket-id">' + escapeHtml(pane.ticketId) + '</span>';
      if (pane.ticketTitle) {
        html += ' — ' + escapeHtml(pane.ticketTitle);
      }
      html += '</div>';
    }
    return html;
  }

  function buildTicketBlockHtml(pane) {
    if (!pane || !pane.ticketId) return '';
    var html = '<div class="ticket-strip-id">' + escapeHtml(pane.ticketId) + '</div>';
    html += '<div class="ticket-strip-title">' + escapeHtml(pane.ticketTitle || '(untitled)') + '</div>';
    var meta = pane.roleLabel || '';
    if (pane.modelLabel) {
      meta += (meta ? ' · ' : '') + pane.modelLabel;
    }
    if (pane.claimEnteredAtMs) {
      meta += (meta ? ' · ' : '') + formatClaimEnteredAgo(pane.claimEnteredAtMs);
    }
    if (meta) {
      html += '<div class="ticket-strip-meta">' + escapeHtml(meta) + '</div>';
    }
    return html;
  }

  function applyFullscreenMode() {
    var active = !!focusPane;
    document.body.classList.toggle('pane-fullscreen-active', active);
    paneFullscreenEl.hidden = !active;
    if (active) {
      enterTelegramFullscreen();
      syncFullscreenContent();
    } else {
      exitTelegramFullscreen();
    }
  }

  function syncFullscreenContent() {
    if (!focusPane) return;
    var entry = paneEntryById(focusPane);
    if (!entry) return;
    var pane = entry.pane;
    var showClaim = entry.id === 'resident' || entry.id === 'coder';
    var ticketHtml = buildTicketBlockHtml(pane);
    fsHeadEl.innerHTML = ticketHtml + buildPaneHeadHtml(pane, entry.label, entry.id, showClaim);
    if (pane && pane.claimEnteredAtMs) {
      fsClaimEnteredAtMs = pane.claimEnteredAtMs;
      var titleEl = fsHeadEl.querySelector('[data-pane-title="' + entry.id + '"]');
      fsTitleBase = titleEl ? titleEl.textContent.replace(/ · entered .*$/, '') : '';
    } else {
      fsClaimEnteredAtMs = null;
      fsTitleBase = '';
    }
    var text = pane && pane.available !== false ? (pane.paneText || '(empty)') : '(pane not reachable)';
    if (fsPreEl.textContent !== text) {
      var atBottom = fsPreEl.scrollHeight - fsPreEl.scrollTop - fsPreEl.clientHeight < 24;
      fsPreEl.textContent = text;
      if (atBottom) fsPreEl.scrollTop = fsPreEl.scrollHeight;
    }
  }

  function enterFullscreen(paneId) {
    focusPane = paneId;
    applyFullscreenMode();
  }

  function exitFullscreen() {
    focusPane = null;
    applyFullscreenMode();
    updateTicketStrip(lastPanes);
  }

  splitEl.addEventListener('click', function (e) {
    var head = e.target.closest('.pane-head');
    if (!head) return;
    var col = head.closest('.pane-col');
    if (!col) return;
    var pane = col.getAttribute('data-pane-id');
    if (!pane) return;
    enterFullscreen(pane);
  });

  fsRestoreBtn.addEventListener('click', function (e) {
    e.preventDefault();
    exitFullscreen();
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
    if (focusPane) return;
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
    fsRestoreBtn.textContent = paneCount > 2 ? 'All panes' : 'Both panes';
    focusPane = null;
    paneFullscreenEl.hidden = true;
    document.body.classList.remove('pane-fullscreen-active');
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
  }

  function renderPane(pane, headEl, paneEl, label, paneId, showClaimEntered) {
    if (!pane || pane.available === false) {
      headEl.innerHTML = buildPaneHeadHtml(null, label, paneId, false) + '<span class="pane-expand-hint">Expand</span>';
      paneEl.textContent = '(pane not reachable)';
      return;
    }
    headEl.innerHTML = '<div class="pane-head-main">' + buildPaneHeadHtml(pane, label, paneId, showClaimEntered) + '</div><span class="pane-expand-hint">Expand</span>';
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
    if (focusPane) {
      syncFullscreenContent();
    }
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
      if (col) {
        var titleEl = col.querySelector('.pane-title');
        if (titleEl) {
          var base = titleEl.textContent.replace(/ · entered .*$/, '');
          titleEl.textContent = base + ' · ' + formatClaimEnteredAgo(claimEnteredByPaneId[paneId]);
        }
      }
      if (focusPane === paneId && fsTitleBase) {
        var fsTitleEl = fsHeadEl.querySelector('[data-pane-title="' + paneId + '"]');
        if (fsTitleEl) {
          fsTitleEl.textContent = fsTitleBase + ' · ' + formatClaimEnteredAgo(claimEnteredByPaneId[paneId]);
        }
      }
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
