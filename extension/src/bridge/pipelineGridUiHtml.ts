// BL-526: Telegram Mini App shell for the pipeline STATUS GRID (no below-grid
// links). Polls GET /pipeline-board?token=... on the same origin.

export function getPipelineGridUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Pipeline Grid</title>
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
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: inline-block; }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  pre {
    margin: 0; padding: 12px 14px 24px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: 11px; line-height: 1.4;
    max-width: 100%;
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <span id="dot" class="dot"></span>
  <h1>Pipeline STATUS GRID</h1>
  <span class="meta" id="age">connecting…</span>
</header>
<pre id="board">Loading grid…</pre>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;
  var boardEl = document.getElementById('board');
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

  function refresh() {
    fetch('/pipeline-board?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        boardEl.textContent = (data && data.boardText) || '(empty grid)';
        lastOk = Date.now();
        setStatus('ok', 'updated 0s ago');
      })
      .catch(function (err) {
        setStatus('err', String(err && err.message || err));
      });
  }

  refresh();
  setInterval(refresh, 2000);
  setInterval(tickAge, 500);
})();
</script>
</body>
</html>`;
}
