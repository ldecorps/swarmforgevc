// BL-522: Telegram Mini App shell for the Mono Router Live Screen.
// Self-contained except for the official telegram-web-app.js (required by
// Telegram). Polls GET /resident-pane?token=... on the same origin.

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
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    flex: 0 0 auto;
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
  .meta { font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: inline-block; }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  .split {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }
  .pane-col {
    flex: 1 1 50%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
  }
  .pane-col:last-child { border-right: none; }
  .pane-head {
    flex: 0 0 auto;
    padding: 10px 12px;
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
    font: inherit;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--tg-theme-button-text-color, #fff);
    background: var(--tg-theme-button-color, #2ea043);
    border: none;
  }
  .split.focus-resident #coordinator-col { display: none; }
  .split.focus-resident #resident-col { flex: 1 1 100%; border-right: none; }
  .split.focus-coordinator #resident-col { display: none; }
  .split.focus-coordinator #coordinator-col { flex: 1 1 100%; }
  .pane-kind {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--tg-theme-hint-color, #8b949e);
    margin-bottom: 4px;
  }
  .pane-title {
    font-size: 13px;
    line-height: 1.35;
    font-weight: 700;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .pane-ticket {
    margin-top: 6px;
    font-size: 11px;
    line-height: 1.4;
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
    padding: 10px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
    line-height: 1.4;
  }
</style>
</head>
<body>
<header>
  <span id="dot" class="dot"></span>
  <h1>${MONO_ROUTER_LIVE_SCREEN_NAME}</h1>
  <span class="meta" id="age">connecting…</span>
  <button type="button" class="split-btn" id="split-btn" hidden>Both panes</button>
</header>
<div class="split">
  <section class="pane-col" id="resident-col">
    <div class="pane-head" id="resident-head">Resident: …</div>
    <pre id="resident-pane">Loading…</pre>
  </section>
  <section class="pane-col" id="coordinator-col">
    <div class="pane-head" id="coordinator-head">Coordinator: …</div>
    <pre id="coordinator-pane">Loading…</pre>
  </section>
</div>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var residentHeadEl = document.getElementById('resident-head');
  var residentPaneEl = document.getElementById('resident-pane');
  var coordinatorHeadEl = document.getElementById('coordinator-head');
  var coordinatorPaneEl = document.getElementById('coordinator-pane');
  var ageEl = document.getElementById('age');
  var dotEl = document.getElementById('dot');
  var splitEl = document.querySelector('.split');
  var splitBtn = document.getElementById('split-btn');
  var focusPane = null;
  var lastOk = 0;
  var lastResidentClaimEnteredAtMs = 0;

  function applyFocus() {
    splitEl.classList.remove('focus-resident', 'focus-coordinator');
    if (focusPane === 'resident') splitEl.classList.add('focus-resident');
    if (focusPane === 'coordinator') splitEl.classList.add('focus-coordinator');
    splitBtn.hidden = !focusPane;
    var hints = document.querySelectorAll('.pane-expand-hint');
    for (var i = 0; i < hints.length; i++) {
      var pane = hints[i].getAttribute('data-pane');
      hints[i].textContent = focusPane === pane ? 'Restore' : 'Expand';
    }
  }

  splitEl.addEventListener('click', function (e) {
    if (e.target.closest('.split-btn')) return;
    var col = e.target.closest('.pane-col');
    if (!col) return;
    var pane = col.id === 'resident-col' ? 'resident' : col.id === 'coordinator-col' ? 'coordinator' : null;
    if (!pane) return;
    focusPane = focusPane === pane ? null : pane;
    applyFocus();
  });

  splitBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    focusPane = null;
    applyFocus();
  });

  function setStatus(kind, text) {
    dotEl.className = 'dot' + (kind === 'ok' ? '' : ' ' + kind);
    ageEl.textContent = text;
  }

  function tickAge() {
    if (!lastOk) return;
    var s = Math.round((Date.now() - lastOk) / 1000);
    setStatus(s > 5 ? 'stale' : 'ok', 'updated ' + s + 's ago');
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

  function renderPane(pane, headEl, paneEl, fallbackLabel, showClaimEntered) {
    if (!pane || pane.available === false) {
      headEl.textContent = fallbackLabel + ' (unavailable)';
      paneEl.textContent = '(pane not reachable)';
      return;
    }
    var title = pane.roleLabel || 'unknown';
    if (pane.modelLabel) {
      title += ' on ' + pane.modelLabel;
    }
    if (showClaimEntered && pane.claimEnteredAtMs) {
      title += ' · ' + formatClaimEnteredAgo(pane.claimEnteredAtMs);
    }
    var html = '<div class="pane-head-main">';
    html += '<div class="pane-kind">' + fallbackLabel + '</div>';
    html += '<div class="pane-title">' + escapeHtml(title) + '</div>';
    if (pane.ticketId) {
      html += '<div class="pane-ticket"><span class="pane-ticket-id">' + escapeHtml(pane.ticketId) + '</span>';
      if (pane.ticketTitle) {
        html += ' — ' + escapeHtml(pane.ticketTitle);
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<span class="pane-expand-hint" data-pane="' + (fallbackLabel === 'Resident' ? 'resident' : 'coordinator') + '">Expand</span>';
    headEl.innerHTML = html;
    paneEl.textContent = pane.paneText || '(empty)';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function refresh() {
    fetch('/resident-pane?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) {
          setStatus('err', 'no data');
          return;
        }
        renderPane(data.resident, residentHeadEl, residentPaneEl, 'Resident', true);
        renderPane(data.coordinator, coordinatorHeadEl, coordinatorPaneEl, 'Coordinator', false);
        lastResidentClaimEnteredAtMs = data.resident && data.resident.claimEnteredAtMs ? data.resident.claimEnteredAtMs : 0;
        if (!data.available) {
          setStatus('err', 'resident unavailable');
        } else {
          lastOk = Date.now();
          setStatus('ok', 'updated 0s ago');
        }
      })
      .catch(function (err) {
        setStatus('err', String(err && err.message || err));
      });
  }

  refresh();
  setInterval(refresh, 1500);
  setInterval(tickAge, 500);
  setInterval(function () {
    if (!lastResidentClaimEnteredAtMs) return;
    var titleEl = residentHeadEl.querySelector('.pane-title');
    if (!titleEl) return;
    var base = titleEl.textContent.replace(/ · entered .*$/, '');
    titleEl.textContent = base + ' · ' + formatClaimEnteredAgo(lastResidentClaimEnteredAtMs);
  }, 1000);
})();
</script>
</body>
</html>`;
}
