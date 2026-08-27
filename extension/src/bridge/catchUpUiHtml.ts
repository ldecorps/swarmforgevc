/// BL-545: Telegram Mini App shell for the console CATCH UP pager.
/// Queues unread agent messages asynchronously from GET /catch-up-state,
/// then triages one at a time (newest first) with mark-as-read / keep-unread.

export function getCatchUpUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Catch up</title>
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
    padding: 12px 14px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .topic-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  .topic-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--tg-theme-link-color, #58a6ff);
  }
  .ago {
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .author {
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
    margin-bottom: 10px;
  }
  .message {
    margin: 0 0 16px;
    padding: 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 90%, #000);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.45;
    max-width: 100%;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  button {
    width: 100%;
    padding: 14px 16px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 10px;
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
  .empty, .loading {
    font-size: 15px;
    color: var(--tg-theme-hint-color, #8b949e);
    text-align: center;
    padding: 24px 8px;
  }
  .done {
    font-size: 18px;
    font-weight: 600;
    text-align: center;
    padding: 32px 8px;
    color: var(--tg-theme-text-color, #e6edf3);
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Catch up</h1>
  <span class="meta" id="status">Loading…</span>
</header>
<main>
  <div id="content"><p class="loading">Building your catch-up queue…</p></div>
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
  var queue = [];
  var queueIndex = -1;
  var queueReady = false;
  var pendingMark = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function renderDone() {
    contentEl.innerHTML = '<p class="done">All caught up</p>';
    setStatus('Done');
  }

  function renderEmpty() {
    contentEl.innerHTML = '<p class="empty">All caught up</p>';
    setStatus('Nothing unread');
  }

  function renderMessage(item) {
    var html = '';
    html += '<div class="topic-row">';
    html += '<span class="topic-label">' + escapeHtml(item.topicLabel) + '</span>';
    html += '<span class="ago">' + escapeHtml(item.agoLabel) + '</span>';
    html += '</div>';
    html += '<div class="author">From ' + escapeHtml(item.author) + '</div>';
    html += '<div class="message">' + escapeHtml(item.text) + '</div>';
    html += '<div class="actions">';
    html += '<button id="mark-read"' + (pendingMark ? ' disabled' : '') + '>Mark as read</button>';
    html += '<button id="keep-unread" class="secondary"' + (pendingMark ? ' disabled' : '') + '>Keep as unread</button>';
    html += '</div>';
    contentEl.innerHTML = html;

    document.getElementById('mark-read').onclick = function () {
      if (pendingMark) return;
      pendingMark = true;
      renderMessage(item);
      fetch('/catch-up/mark-read' + q, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
          'x-control-token': token
        },
        body: JSON.stringify({ topicId: item.topicId, seq: item.seq })
      }).catch(function () {
        // Offline triage: advance locally even if the persist fails.
      }).finally(function () {
        pendingMark = false;
        advanceToNext();
      });
    };
    document.getElementById('keep-unread').onclick = function () {
      if (pendingMark) return;
      advanceToNext();
    };

    var pos = queue.length - queueIndex;
    setStatus('Message ' + pos + ' of ' + queue.length);
  }

  function advanceToNext() {
    queueIndex -= 1;
    if (queueIndex < 0) {
      renderDone();
      return;
    }
    renderMessage(queue[queueIndex]);
  }

  function startTriage() {
    if (!queue.length) {
      renderEmpty();
      return;
    }
    queueIndex = queue.length - 1;
    renderMessage(queue[queueIndex]);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  fetch('/catch-up-state' + q, { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      queue = (data && data.items) ? data.items.slice() : [];
      queueReady = true;
      startTriage();
    })
    .catch(function (err) {
      contentEl.innerHTML = '<p class="empty">Failed to load catch-up queue.</p>';
      setStatus('Load error: ' + String(err && err.message || err));
    });
})();
</script>
</body>
</html>`;
}
