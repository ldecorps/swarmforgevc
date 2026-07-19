/// BL-538: Telegram Mini App shell for the console PAUSED TICKET PAGER.
/// Shows paused backlog tickets (id + title, YAML details) with Prev/Next
/// navigation and an Expedite action (confirm -> priority 0 + promotion to
/// active). Polls GET /paused-pager?token=... on the same origin for JSON
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
  :root { color-scheme: dark; }
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
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
  .meta { font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); }
  a.back {
    font-size: 12px;
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
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
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .ticket-title {
    font-size: 14px;
    font-weight: 600;
  }
  .controls {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  button {
    flex: 0 0 auto;
    padding: 6px 10px;
    font-size: 12px;
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
    font-size: 11px;
    line-height: 1.4;
    max-width: 100%;
  }
  .empty {
    font-size: 13px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Paused tickets</h1>
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
    html += '<button id="expedite"' + (item.canExpedite ? '' : ' disabled') + '>Expedite</button>';
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
      var confirmText = 'Expedite ' + item.id + '?\\n\\nThis sets priority to 0 and promotes it to active.';
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
    fetch('/paused-pager' + q, { cache: 'no-store' })
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
