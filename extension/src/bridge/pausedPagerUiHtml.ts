/// BL-538: Telegram Mini App shell for the console PAUSED TICKET PAGER.
/// Shows paused backlog tickets (id + title, YAML details) with Prev/Next
/// navigation and an Expedite action (confirm -> priority 0 + promotion to
/// active). Polls GET /paused-pager-state?token=... on the same origin for JSON
/// state. Empty state ("No paused tickets") when there are none.

export function getPausedPagerUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Paused Tickets</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    color-scheme: dark;
    --pp-font-px: 15px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    font-size: calc(var(--pp-font-px) + 1px);
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.02em;
    flex: 1 1 auto;
    min-width: 0;
  }
  .meta { font-size: calc(var(--pp-font-px) - 2px); color: var(--tg-theme-hint-color, #8b949e); width: 100%; }
  a.back {
    font-size: calc(var(--pp-font-px) - 2px);
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    flex: 0 0 auto;
  }
  .font-controls {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
    margin-left: auto;
  }
  button.font-btn {
    padding: 2px 7px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 45%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 70%, #fff 8%);
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
  }
  main {
    padding: 12px 14px 16px;
  }
  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }
  .ticket-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: calc(var(--pp-font-px) - 1px);
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .ticket-title {
    font-size: calc(var(--pp-font-px) + 2px);
    font-weight: 600;
  }
  .controls {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  button {
    flex: 0 0 auto;
    padding: 8px 12px;
    font-size: calc(var(--pp-font-px) - 1px);
    font-weight: 500;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-button-color, #238636) 60%, #000);
    background: var(--tg-theme-button-color, #238636);
    color: var(--tg-theme-button-text-color, #fff);
    cursor: pointer;
  }
  button.secondary {
    background: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 85%, #111);
    border-color: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 55%, #000);
  }
  button[disabled] {
    opacity: 0.4;
    cursor: default;
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #000);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: var(--pp-font-px);
    line-height: 1.45;
    max-width: 100%;
  }
  .empty {
    font-size: calc(var(--pp-font-px) + 1px);
    color: var(--tg-theme-hint-color, #8b949e);
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Paused tickets</h1>
  <div class="font-controls">
    <button type="button" class="font-btn" id="font-dec" aria-label="Smaller text">A-</button>
    <button type="button" class="font-btn" id="font-inc" aria-label="Larger text">A+</button>
  </div>
  <span class="meta" id="status">Loading…</span>
</header>
<main>
  <div id="content"></div>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;

  var statusEl = document.getElementById('status');
  var contentEl = document.getElementById('content');
  var index = 0;
  var lastData = null;
  var loading = false;

  var FONT_KEY = 'swarmforge-paused-pager-font-px';
  var FONT_MIN = 12;
  var FONT_MAX = 26;
  var FONT_DEFAULT = 15;
  var FONT_STEP = 2;

  function currentFontPx() {
    var raw = document.documentElement.style.getPropertyValue('--pp-font-px');
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : FONT_DEFAULT;
  }

  function applyFont(px) {
    var clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    document.documentElement.style.setProperty('--pp-font-px', clamped + 'px');
    try { localStorage.setItem(FONT_KEY, String(clamped)); } catch (_) {}
    document.getElementById('font-dec').disabled = clamped <= FONT_MIN;
    document.getElementById('font-inc').disabled = clamped >= FONT_MAX;
  }

  function loadFont() {
    var stored = parseInt(localStorage.getItem(FONT_KEY), 10);
    applyFont(Number.isFinite(stored) ? stored : FONT_DEFAULT);
  }

  document.getElementById('font-dec').onclick = function () {
    applyFont(currentFontPx() - FONT_STEP);
  };
  document.getElementById('font-inc').onclick = function () {
    applyFont(currentFontPx() + FONT_STEP);
  };
  loadFont();

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function renderEmpty() {
    contentEl.innerHTML = '<p class="empty">No paused tickets.</p>';
  }

  function renderTicket(data) {
    if (!data || !data.items || data.items.length === 0) {
      renderEmpty();
      return;
    }
    var total = data.items.length;
    if (index < 0) index = 0;
    if (index >= total) index = total - 1;
    var item = data.items[index];

    var disablePrev = index === 0;
    var disableNext = index === total - 1;

    var html = '';
    html += '<div class="title-row">';
    html += '<span class="ticket-id">' + item.id + '</span>';
    html += '<span class="ticket-title">' + (item.title || '(untitled)') + '</span>';
    html += '</div>';
    html += '<div class="controls">';
    html += '<button id="prev" class="secondary"' + (disablePrev ? ' disabled' : '') + '>Prev</button>';
    html += '<button id="next" class="secondary"' + (disableNext ? ' disabled' : '') + '>Next</button>';
    html += '<button id="expedite"' + (item.canExpedite ? '' : ' disabled') + '>Set highest priority, expedite</button>';
    html += '</div>';
    html += '<pre id="yaml"></pre>';
    contentEl.innerHTML = html;
    var yamlEl = document.getElementById('yaml');
    yamlEl.textContent = item.yaml || '(no YAML available)';

    document.getElementById('prev').onclick = function () {
      if (index > 0) {
        index -= 1;
        renderTicket(lastData);
        setStatus('Ticket ' + (index + 1) + ' of ' + total);
      }
    };
    document.getElementById('next').onclick = function () {
      if (index < total - 1) {
        index += 1;
        renderTicket(lastData);
        setStatus('Ticket ' + (index + 1) + ' of ' + total);
      }
    };
    document.getElementById('expedite').onclick = function () {
      if (!item.canExpedite || loading) return;
      var confirmText = 'Set highest priority and expedite ' + item.id + '?\\n\\nThis sets priority to 0, promotes it to active, and may dispatch immediately.';
      if (!window.confirm(confirmText)) {
        return;
      }
      loading = true;
      setStatus('Expediting ' + item.id + '…');
      fetch('/paused-pager/expedite' + q, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id })
      }).then(function (r) {
        loading = false;
        if (!r.ok) {
          setStatus('Expedite failed (HTTP ' + r.status + ')');
          return r.json().catch(function () { return {}; });
        }
        return r.json().then(function (payload) {
          if (payload && payload.success) {
            setStatus('Expedited ' + item.id + ' (priority 0)');
            // Re-fetch to reflect updated paused list (ticket may have moved to active).
            refresh();
          } else {
            setStatus('Expedite failed');
          }
        });
      }).catch(function (err) {
        loading = false;
        setStatus('Expedite error: ' + String(err && err.message || err));
      });
    };

    setStatus('Ticket ' + (index + 1) + ' of ' + total);
  }

  function refresh() {
    fetch('/paused-pager-state' + q, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        lastData = data;
        if (!data || !data.items || data.items.length === 0) {
          renderEmpty();
          setStatus('No paused tickets');
        } else {
          renderTicket(data);
        }
      })
      .catch(function (err) {
        setStatus('Load error: ' + String(err && err.message || err));
        contentEl.innerHTML = '<p class="empty">Failed to load paused tickets.</p>';
      });
  }

  refresh();
})();
</script>
</body>
</html>`;
}
