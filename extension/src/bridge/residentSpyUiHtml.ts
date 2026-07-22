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
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.35;
    font-weight: 600;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 20%, transparent);
    word-break: break-word;
  }
  .pane-session {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    font-weight: 400;
    color: var(--tg-theme-hint-color, #8b949e);
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
  var lastOk = 0;

  function setStatus(kind, text) {
    dotEl.className = 'dot' + (kind === 'ok' ? '' : ' ' + kind);
    ageEl.textContent = text;
  }

  function tickAge() {
    if (!lastOk) return;
    var s = Math.round((Date.now() - lastOk) / 1000);
    setStatus(s > 5 ? 'stale' : 'ok', 'updated ' + s + 's ago');
  }

  function renderPane(pane, headEl, paneEl, fallbackLabel) {
    if (!pane || pane.available === false) {
      headEl.textContent = fallbackLabel + ' (unavailable)';
      paneEl.textContent = '(pane not reachable)';
      return;
    }
    headEl.innerHTML = '';
    headEl.appendChild(document.createTextNode(pane.header || (fallbackLabel + ': ' + (pane.roleLabel || 'unknown'))));
    if (pane.sessionTarget) {
      var sessionSpan = document.createElement('span');
      sessionSpan.className = 'pane-session';
      sessionSpan.textContent = pane.sessionTarget;
      headEl.appendChild(sessionSpan);
    }
    paneEl.textContent = pane.paneText || '(empty)';
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
        renderPane(data.resident, residentHeadEl, residentPaneEl, 'Resident');
        renderPane(data.coordinator, coordinatorHeadEl, coordinatorPaneEl, 'Coordinator');
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
})();
</script>
</body>
</html>`;
}
